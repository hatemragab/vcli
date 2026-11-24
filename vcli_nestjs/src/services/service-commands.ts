import path from 'node:path';
import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { BoundedFailure } from '../contracts.js';
import { formatYaml } from '../recipes/format-files.js';
import { localCompose } from '../recipes/render-services.js';
import { serviceResourceName } from '../recipes/service-plan.js';
import { projectPath, readRegular } from '../engine/paths.js';
import { withLocalOperationLock } from './local-operation-lock.js';
import type {
  ServiceAction,
  ServiceCommandPlan,
  ServiceExecutionOptions,
  ServiceRunner,
  ServiceExecutionResult,
} from './service-types.js';
import { runOwnedProcess } from './owned-process.js';

function port(value: number): number {
  if (!Number.isInteger(value) || value < 1024 || value > 65535)
    throw new Error('INVALID_SERVICE_PORT');
  return value;
}
/** Dry planning deliberately does not inspect files, environment, ports or processes. */
export function planServiceCommand(
  action: ServiceAction,
  options: ServiceExecutionOptions,
): ServiceCommandPlan {
  const { plan } = options;
  if (
    !['up', 'down', 'status'].includes(action) ||
    plan.target !== 'local' ||
    !['development', 'test'].includes(plan.environment)
  )
    throw new Error('UNSUPPORTED_LOCAL_SERVICE_ACTION');
  const database = plan.services.find(
    (service) => service.id === 'database' && service.execution === 'compose',
  );
  if (options.databasePort !== undefined) port(options.databasePort);
  const composeProject = serviceResourceName(plan.project, plan.environment);
  const prefix = [
    'compose',
    '--project-name',
    composeProject,
    '--project-directory',
    path.resolve(options.root),
    '-f',
    `ops/local/${plan.environment}/compose.yaml`,
  ];
  const commandArgs =
    action === 'up'
      ? ['up', '--detach', '--wait', '--wait-timeout', '60', 'database']
      : action === 'down'
        ? ['down', '--timeout', '30']
        : ['ps', '--all', '--format', 'json'];
  const mongo = database?.image?.startsWith('mongo:');
  return {
    schemaVersion: 1,
    action,
    project: plan.project,
    environment: plan.environment,
    composeProject,
    command: 'docker',
    args: [...prefix, ...commandArgs],
    ...(action === 'up' && mongo
      ? {
          setupArgs: [...prefix, 'run', '--rm', '--no-deps', 'database-init'],
          readinessArgs: [
            ...prefix,
            'exec',
            '-T',
            'database',
            'mongosh',
            '--quiet',
            '--eval',
            'for(let i=0;i<40;i++){if(db.hello().isWritablePrimary)quit(0);sleep(250)}quit(2)',
          ],
        }
      : {}),
    noServices: !database,
    preservesVolumes: true,
  };
}

function outputRows(stdout: string): unknown[] {
  if (!stdout.trim()) return [];
  try {
    if (stdout.trim().startsWith('[')) {
      const value: unknown = JSON.parse(stdout);
      if (!Array.isArray(value)) throw new Error();
      return value;
    }
    return stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as unknown);
  } catch {
    throw new Error('INVALID_COMPOSE_STATUS');
  }
}

function labelMap(raw: unknown): Record<string, unknown> {
  return typeof raw === 'string'
    ? Object.fromEntries(
        raw.split(',').map((pair) => {
          const i = pair.indexOf('=');
          return [pair.slice(0, i), pair.slice(i + 1)];
        }),
      )
    : raw && typeof raw === 'object'
      ? (raw as Record<string, unknown>)
      : {};
}

/** Every discovered container must belong to this exact project directory and selected service. */
export function assertServiceOwnership(
  stdout: string,
  options: ServiceExecutionOptions,
  composeProject: string,
): void {
  for (const row of outputRows(stdout)) {
    if (!row || typeof row !== 'object' || !('Labels' in row))
      throw new Error('SERVICE_OWNERSHIP_CONFLICT');
    const labels = labelMap(row.Labels);
    if (
      labels['com.docker.compose.project'] !== composeProject ||
      labels['com.docker.compose.project.working_dir'] !==
        path.resolve(options.root) ||
      labels['io.vcli.project'] !== options.plan.project ||
      labels['io.vcli.environment'] !== options.plan.environment ||
      !['database', 'database-init'].includes(
        String(labels['com.docker.compose.service']),
      )
    )
      throw new Error('SERVICE_OWNERSHIP_CONFLICT');
  }
}

/** Read-only ownership preflight, then a bounded native Compose invocation; no installs or resets. */
export async function executeServiceCommand(
  action: ServiceAction,
  options: ServiceExecutionOptions,
  runner: ServiceRunner = (invocation) =>
    runOwnedProcess(invocation, { capture: true }),
): Promise<ServiceExecutionResult> {
  const planned = planServiceCommand(action, options);
  if (options.dryRun) return { plan: planned, status: 'planned' };
  if (planned.noServices) return { plan: planned, status: 'no-services' };
  const root = await realpath(options.root);
  const verifyArtifacts = async () => {
    // Detect stale/tampered selected metadata without exposing any private content.
    let installed: unknown;
    try {
      installed = JSON.parse(
        (await readRegular(
          await projectPath(
            root,
            `ops/local/${options.plan.environment}/service-plan.json`,
            false,
          ),
        ))!.toString('utf8'),
      );
    } catch {
      throw new Error('LOCAL_SERVICE_ARTIFACT_UNAVAILABLE');
    }
    if (JSON.stringify(installed) !== JSON.stringify(options.plan))
      throw new Error('STALE_LOCAL_SERVICE_PLAN');
    const desired = JSON.stringify(localCompose(options.plan), null, 2) + '\n';
    const formatted = await formatYaml(desired);
    const actual = (
      await readRegular(
        await projectPath(
          root,
          `ops/local/${options.plan.environment}/compose.yaml`,
          false,
        ),
      )
    )?.toString('utf8');
    if (actual !== desired && actual !== formatted)
      throw new Error('LOCAL_SERVICE_ARTIFACT_CONFLICT');
  };
  await verifyArtifacts();
  const cgroup =
    options.cgroupParent ??
    options.environment.VCLI_CGROUP_PARENT ??
    options.plan.cgroupParent;
  if (
    cgroup !== undefined &&
    !/^[a-zA-Z0-9][a-zA-Z0-9_.@/-]{0,127}$/.test(cgroup)
  )
    throw new Error('INVALID_CGROUP_PARENT');
  if (
    options.plan.cgroupParent !== undefined &&
    cgroup !== options.plan.cgroupParent
  )
    throw new BoundedFailure(
      'CGROUP_ARTIFACT_MISMATCH',
      'services',
      'Regenerate selected service artifacts with the explicit host cgroup parent.',
    );
  const environment = {
    ...options.environment,
    COMPOSE_DISABLE_ENV_FILE: '1',
    VCLI_WORKSPACE_ID: createHash('sha256').update(root).digest('hex'),
    ...(cgroup ? { VCLI_CGROUP_PARENT: cgroup } : {}),
    ...(options.databasePort !== undefined
      ? { VCLI_DATABASE_PORT: String(port(options.databasePort)) }
      : {}),
  };
  const invoke = (args: readonly string[]) =>
    runner({ command: 'docker', args, cwd: root, environment });
  const prefix = planned.args.slice(0, planned.args.indexOf('-f') + 2);
  const execute = async (): Promise<ServiceExecutionResult> => {
    const existing = await invoke([
      ...prefix,
      'ps',
      '--all',
      '--format',
      'json',
    ]);
    if (existing.code !== 0) throw new Error('SERVICE_INSPECTION_FAILED');
    assertServiceOwnership(existing.stdout, options, planned.composeProject);
    if (action === 'status')
      return {
        plan: planned,
        status: 'completed',
        services: outputRows(existing.stdout).map((row) => {
          const item = row as Record<string, unknown>;
          const service = String(item.Service),
            state = String(item.State);
          if (
            !['database', 'database-init'].includes(service) ||
            ![
              'running',
              'exited',
              'created',
              'restarting',
              'paused',
              'removing',
              'dead',
            ].includes(state)
          )
            throw new Error('INVALID_COMPOSE_STATUS');
          return { service, state };
        }),
      };
    if (action === 'up') {
      const volume = options.plan.volumes.find(
        (item) => item.id === 'database-data',
      );
      if (!volume) throw new Error('LOCAL_DATABASE_VOLUME_REQUIRED');
      const inventory = await invoke([
        'volume',
        'ls',
        '--filter',
        'name=' + volume.resourceRef,
        '--format',
        'json',
      ]);
      if (inventory.code !== 0)
        throw new Error('SERVICE_VOLUME_INSPECTION_FAILED');
      for (const item of outputRows(inventory.stdout)) {
        if (!item || typeof item !== 'object' || !('Name' in item))
          throw new Error('INVALID_VOLUME_STATUS');
        if (item.Name !== volume.resourceRef) continue;
        const labels = labelMap('Labels' in item ? item.Labels : undefined);
        if (
          labels['com.docker.compose.project'] !== planned.composeProject ||
          labels['com.docker.compose.volume'] !== 'database-data' ||
          labels['io.vcli.project'] !== options.plan.project ||
          labels['io.vcli.environment'] !== options.plan.environment ||
          labels['io.vcli.workspace'] !== environment.VCLI_WORKSPACE_ID
        )
          throw new Error('SERVICE_VOLUME_OWNERSHIP_CONFLICT');
      }
    }
    await verifyArtifacts();
    const result = await invoke(planned.args);
    if (result.code !== 0) throw new Error('SERVICE_COMMAND_FAILED');
    for (const args of [planned.setupArgs, planned.readinessArgs])
      if (args) {
        const step = await invoke(args);
        if (step.code !== 0)
          throw new Error('SERVICE_SETUP_OR_READINESS_FAILED');
      }
    return { plan: planned, status: 'completed' };
  };
  return action === 'status'
    ? execute()
    : withLocalOperationLock(
        root,
        `services-${options.plan.environment}`,
        execute,
      );
}
