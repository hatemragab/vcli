import { resolve } from 'node:path';
import type { Command } from 'commander';
import {
  applyDeployment,
  assertDeploymentProfile,
  discoverDeployment,
  inspectDeployment,
  loadDeploymentPlan,
  loadDeploymentSnapshot,
  loadReconciliationDecision,
  loadReleaseFacts,
  loadTargetProfile,
  planDeployment,
  reconcileDeployment,
  saveDeploymentPlan,
  saveDeploymentSnapshot,
  verifyDeployment,
  type DeploymentPlan,
} from '../deployment/operators/index.js';
import { configuration } from '../recipes/render-config.js';
import { describeServices } from '../recipes/service-plan.js';
import type { ResourceId } from '../recipes/service-plan-types.js';
import { inspectProject } from '../engine/inspection.js';
import { readProjectConfig } from './read-project-config.js';
import type { CommandResult } from './command-output.js';
import { CliError } from './cli-error.js';

export interface DeploymentCommandContext {
  project(): string;
  emit(result: CommandResult): void;
  setOperation(name: string): void;
}
const summary = (plan: DeploymentPlan) => ({
  planId: plan.id,
  target: plan.services.target,
  targetVersion: plan.services.targetVersion,
  environment: plan.services.environment,
  steps: plan.steps,
  sourceCommit: plan.release.sourceCommit,
  schemaReleaseId: plan.release.schemaReleaseId,
});
function resources(
  bindings: readonly string[],
): Partial<Record<ResourceId, string>> {
  const allowed: readonly string[] = [
    'database',
    'storage',
    'firebase',
    'smtp',
    'http-mail',
    'fcm',
    'apns',
    'centrifugo',
    'redis',
    'diagnostic-reader',
  ];
  const result: Partial<Record<ResourceId, string>> = {};
  for (const binding of bindings) {
    const index = binding.indexOf('=');
    const key = binding.slice(0, index);
    const value = binding.slice(index + 1);
    if (
      index < 1 ||
      !allowed.includes(key) ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value) ||
      Object.hasOwn(result, key)
    )
      throw new CliError(
        'INVALID_RESOURCE_BINDING',
        'Supply each selected resource once as --resource database=actual-resource-id; URLs and credentials are prohibited.',
      );
    result[key as ResourceId] = value;
  }
  return result;
}
export function registerDeploymentCommands(
  program: Command,
  context: DeploymentCommandContext,
): void {
  const commands = program
    .command('deploy')
    .description('Explicit scoped native deployment operations');
  commands
    .command('discover')
    .requiredOption('--profile <file>', 'Private target profile')
    .option('--save-snapshot <file>', 'Explicit new private snapshot file')
    .option('--dry-run', 'Validate input without network, writes or probes')
    .action(
      async (options: {
        profile: string;
        saveSnapshot?: string;
        dryRun?: boolean;
      }) => {
        context.setOperation('deploy.discover');
        const profile = await loadTargetProfile(resolve(options.profile));
        if (options.dryRun) {
          context.emit({
            schemaVersion: 1,
            status: 'preview',
            operation: 'deploy.discover',
            data: {
              target: profile.target,
              targetVersion: profile.targetVersion,
              network: false,
              saved: false,
            },
          });
          return;
        }
        const snapshot = await discoverDeployment(profile);
        if (options.saveSnapshot)
          await saveDeploymentSnapshot(resolve(options.saveSnapshot), snapshot);
        context.emit({
          schemaVersion: 1,
          status: 'completed',
          operation: 'deploy.discover',
          data: {
            target: snapshot.target,
            targetVersion: snapshot.targetVersion,
            resourceCount: snapshot.resources.length,
            saved: !!options.saveSnapshot,
          },
        });
      },
    );
  commands
    .command('plan')
    .requiredOption('--profile <file>', 'Private target profile')
    .requiredOption(
      '--snapshot <file>',
      'Explicit saved scoped native snapshot; no implicit discovery',
    )
    .requiredOption(
      '--release <file>',
      'Private release facts and evidence references',
    )
    .option(
      '--environment <environment>',
      'staging or production',
      'production',
    )
    .option('--save-plan <file>', 'Explicit new private plan file')
    .option(
      '--resource <binding>',
      'Selected family=actual resource reference (repeatable)',
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option('--dry-run', 'Pure planning without file writes or network')
    .action(
      async (options: {
        profile: string;
        snapshot: string;
        release: string;
        environment: string;
        resource: string[];
        savePlan?: string;
        dryRun?: boolean;
      }) => {
        context.setOperation('deploy.plan');
        if (
          options.environment !== 'staging' &&
          options.environment !== 'production'
        )
          throw new CliError(
            'INVALID_DEPLOYMENT_ENVIRONMENT',
            'Select staging or production.',
          );
        const project = context.project();
        await inspectProject(project);
        const config = await readProjectConfig(project);
        const profile = await loadTargetProfile(resolve(options.profile));
        if (
          config.capabilities.deployment?.recipe !==
          'deployment.' + profile.target
        )
          throw new CliError(
            'DEPLOYMENT_SELECTION_MISMATCH',
            'Select the matching reviewed deployment recipe first.',
          );
        const services = describeServices(
          config,
          configuration(config).fields,
          {
            environment: options.environment,
            targetVersion: profile.targetVersion,
            externalResources: resources(options.resource),
            requireExternalResources: true,
            topology:
              config.capabilities.realtime?.options.scale === 'cluster'
                ? 'cluster'
                : 'single',
          },
        );
        const snapshot = await loadDeploymentSnapshot(
          resolve(options.snapshot),
        );
        const release = await loadReleaseFacts(resolve(options.release));
        const plan = planDeployment(services, snapshot, release);
        assertDeploymentProfile(plan, profile);
        if (options.savePlan && !options.dryRun)
          await saveDeploymentPlan(resolve(options.savePlan), plan);
        context.emit({
          schemaVersion: 1,
          status: 'preview',
          operation: 'deploy.plan',
          data: {
            ...summary(plan),
            saved: !!options.savePlan && !options.dryRun,
            network: false,
          },
        });
      },
    );
  for (const action of ['apply', 'inspect', 'reconcile', 'verify'] as const) {
    const command = commands
      .command(action)
      .requiredOption('--profile <file>', 'Private target profile')
      .requiredOption('--plan <file>', 'Exact saved deployment plan')
      .option('--dry-run', 'Validate saved input without probes or writes');
    if (action === 'reconcile')
      command.requiredOption(
        '--decision <file>',
        'Private explicit fenced reconciliation decision',
      );
    command.action(
      async (options: {
        profile: string;
        plan: string;
        decision?: string;
        dryRun?: boolean;
      }) => {
        const operation = 'deploy.' + action;
        context.setOperation(operation);
        const plan = await loadDeploymentPlan(resolve(options.plan));
        const profile = await loadTargetProfile(resolve(options.profile));
        assertDeploymentProfile(plan, profile);
        const decision =
          action === 'reconcile'
            ? await loadReconciliationDecision(resolve(options.decision!))
            : undefined;
        if (options.dryRun) {
          context.emit({
            schemaVersion: 1,
            status: 'preview',
            operation,
            data: { ...summary(plan), network: false, writes: false },
          });
          return;
        }
        if (action === 'inspect') {
          const result = await inspectDeployment(plan, profile);
          context.emit({
            schemaVersion: 1,
            status: 'completed',
            operation,
            data: {
              ...summary(plan),
              summary: result.summary,
              resourceCount: result.snapshot.resources.length,
              ...(result.lockId ? { lockId: result.lockId } : {}),
            },
          });
          return;
        }
        const result =
          action === 'apply'
            ? await applyDeployment(plan, profile)
            : action === 'verify'
              ? await verifyDeployment(plan, profile)
              : await reconcileDeployment(plan, profile, decision!);
        context.emit({
          schemaVersion: 1,
          status: result.outcome === 'verified' ? 'completed' : 'pending',
          operation,
          data: result,
        });
      },
    );
  }
}
