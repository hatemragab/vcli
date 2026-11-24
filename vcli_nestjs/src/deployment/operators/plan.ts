import { z } from 'zod';
import {
  parseServicePlan,
  parseDeploymentSnapshot,
  parseReleaseFacts,
} from './input-schemas.js';
import type { ServicePlan } from '../../recipes/service-plan-types.js';
import type {
  DeploymentPlan,
  DeploymentSnapshot,
  ReleaseFacts,
} from './types.js';
import { digest, fail, httpsUrl, same } from './validation.js';

/** Pure operator planning. This function performs no I/O and does not accept a credential profile. */
export function planDeployment(
  services: ServicePlan,
  snapshot: DeploymentSnapshot,
  input: ReleaseFacts,
): DeploymentPlan {
  return planFromInput(services, snapshot, input);
}

function planFromInput(
  serviceInput: unknown,
  snapshotInput: unknown,
  releaseInput: unknown,
): DeploymentPlan {
  const services = parseServicePlan(serviceInput);
  const snapshot = parseDeploymentSnapshot(snapshotInput);
  const release = parseReleaseFacts(releaseInput);
  if (
    services.target === 'local' ||
    services.target !== snapshot.target ||
    services.targetVersion !== snapshot.targetVersion
  )
    fail('UNSUPPORTED_TARGET_VERSION');
  const readiness = httpsUrl(release.readinessUrl);
  if (readiness.pathname !== '/health/ready' || readiness.port)
    fail('INVALID_READINESS_URL');
  if (readiness.origin === snapshot.origin)
    fail('APP_AND_OPERATOR_ORIGIN_MUST_DIFFER');
  if (snapshot.resources.length > 1) fail('AMBIGUOUS_RESOURCE_DISCOVERY');
  if (
    snapshot.scope.resourceId &&
    snapshot.resources[0]?.id !== snapshot.scope.resourceId
  )
    fail('EXPECTED_RESOURCE_MISSING');
  if (
    services.environment !== 'production' &&
    services.environment !== 'staging'
  )
    fail('UNSUPPORTED_OPERATOR_ENVIRONMENT');
  if (
    (services.topology === 'single' && services.replicas !== 1) ||
    (services.topology === 'cluster' && services.replicas < 2)
  )
    fail('UNSUPPORTED_OPERATOR_TOPOLOGY');
  if (
    services.topology === 'cluster' &&
    (services.volumes.length ||
      !services.externalRequirements.some((r) => r.id === 'database'))
  )
    fail('UNSUPPORTED_OPERATOR_TOPOLOGY');
  if (
    services.services.some((s) => s.id !== 'api' && s.execution !== 'external')
  )
    fail('UNSUPPORTED_OPERATOR_SERVICE');
  const api = services.services.find((s) => s.id === 'api');
  if (
    !api ||
    !same(api.command, ['node', 'dist/main.js']) ||
    api.ports.length !== 1 ||
    api.ports[0]?.port !== 3100
  )
    fail('UNSUPPORTED_API_PROFILE');
  if (
    services.nodeEnvironment !== 'production' ||
    !same(api.resources, { memoryMiB: 512, cpus: 1, pids: 256 })
  )
    fail('UNSUPPORTED_API_PROFILE');
  for (const entries of [
    services.services.map((s) => s.id),
    services.volumes.map((v) => v.id),
    services.volumes.map((v) => v.resourceRef),
    services.externalRequirements.map((r) => r.id),
    services.jobs.map((j) => j.id),
    api.environment.map((f) => f.key),
  ])
    if (new Set(entries).size !== entries.length)
      fail('DUPLICATE_SERVICE_REQUIREMENT');
  for (const job of services.jobs) {
    const expected =
      job.id === 'release'
        ? ['node', 'dist/initialize-database.js']
        : job.id === 'mail-drain'
          ? ['node', 'dist/drain-mail.js', '--limit', '20']
          : ['node', 'dist/drain-identity-cleanup.js', '--limit', '10'];
    if (
      !same(job.command, expected) ||
      !same(job.dependsOn, ['database']) ||
      job.concurrency !==
        (job.id === 'release' ? 'database-lock' : 'bounded-cas-lease')
    )
      fail('UNSUPPORTED_OPERATOR_JOB');
  }
  const needsSchema = services.jobs.some((j) => j.id === 'release');
  if (
    needsSchema !==
    services.externalRequirements.some((r) => r.id === 'database')
  )
    fail('SCHEMA_RELEASE_JOB_REQUIRED');
  if (needsSchema !== !!release.schemaReleaseId)
    fail('SCHEMA_RELEASE_ID_REQUIRED');
  if (services.target === 'coolify') {
    if (!release.source || release.image)
      fail('COOLIFY_REQUIRES_IMMUTABLE_GIT_SOURCE');
    const repo = httpsUrl(release.source.repository);
    if (repo.pathname === '/' || /\.\./.test(repo.pathname))
      fail('INVALID_GIT_SOURCE');
  } else if (!release.image || release.source) fail('IMMUTABLE_IMAGE_REQUIRED');
  for (const requirement of services.externalRequirements)
    if (
      !requirement.resourceRef ||
      !Object.hasOwn(
        release.preconditions.externalResources,
        requirement.resourceRef,
      )
    )
      fail('EXTERNAL_RESOURCE_PRECONDITION_REQUIRED');
  if (
    Object.keys(release.preconditions.externalResources).some(
      (ref) =>
        !services.externalRequirements.some((r) => r.resourceRef === ref),
    )
  )
    fail('UNSELECTED_EXTERNAL_RESOURCE');
  for (const volume of services.volumes)
    if (
      volume.owner !== 'node' ||
      !Object.hasOwn(release.preconditions.volumes, volume.resourceRef) ||
      !['/app/var/storage', '/app/var/evidence'].includes(volume.containerPath)
    )
      fail('DURABLE_VOLUME_PRECONDITION_REQUIRED');
  if (
    Object.keys(release.preconditions.volumes).some(
      (ref) => !services.volumes.some((v) => v.resourceRef === ref),
    )
  )
    fail('UNSELECTED_DURABLE_VOLUME');
  if (
    services.target === 'caprover' &&
    services.volumes.length &&
    (!release.preconditions.nodeId ||
      release.preconditions.nodeId !== snapshot.scope.nodeId)
  )
    fail('PERSISTENT_NODE_REQUIRED');
  if (
    services.target === 'caprover' &&
    release.preconditions.nodeId !== snapshot.scope.nodeId
  )
    fail('NATIVE_NODE_SCOPE_MISMATCH');
  const current = snapshot.resources[0];
  if (current) {
    const bindings = (
      services.target === 'caprover'
        ? current.settings.volumes
        : current.settings.volumeBindings
    ) as { resourceRef?: string; volumeName?: string; containerPath: string }[];
    if (
      bindings.some(
        (old) =>
          !services.volumes.some(
            (v) =>
              v.resourceRef === (old.resourceRef ?? old.volumeName) &&
              v.containerPath === old.containerPath,
          ),
      )
    )
      fail('DURABLE_VOLUME_IDENTITY_MISMATCH');
  }
  const keys = release.managedEnvironmentKeys;
  if (new Set(keys).size !== keys.length)
    fail('DUPLICATE_MANAGED_ENVIRONMENT_KEY');
  const fields = api.environment;
  if (keys.some((key) => !fields.some((f) => f.key === key)))
    fail('UNSELECTED_MANAGED_ENVIRONMENT_KEY');
  if (
    fields.some(
      (f) =>
        (f.required || services.operatorReview.includes(f.key)) &&
        !keys.includes(f.key),
    )
  )
    fail('REQUIRED_ENVIRONMENT_KEY_MISSING');
  if (keys.includes('APP_ENV_FILE'))
    fail('PRIVATE_FILE_RUNTIME_MOUNT_REQUIRES_SEPARATE_PROFILE');
  // Filesystem credential mounts are external setup; never pretend a string value mounts a file.
  if (
    keys.some(
      (key) =>
        /_PATH$|_FILE$/.test(key) || key === 'GOOGLE_APPLICATION_CREDENTIALS',
    )
  )
    fail('CREDENTIAL_MOUNT_REQUIRES_SEPARATE_PROFILE');
  const steps: DeploymentPlan['steps'] = [
    ...(snapshot.resources.length ? [] : ['create' as const]),
    'configure',
    'environment',
    ...(services.target === 'caprover'
      ? ['domain' as const, 'ssl' as const]
      : services.target === 'dokploy'
        ? ['domain' as const]
        : []),
    'deploy',
  ];
  const core = {
    schemaVersion: 1 as const,
    services,
    snapshot,
    release,
    steps,
  };
  return { ...core, id: digest(core) };
}
export function assertPlan(plan: DeploymentPlan): void {
  parseDeploymentPlan(plan);
}

/** Bounded structural parsing and full semantic re-planning of saved public input. */
export function parseDeploymentPlan(value: unknown): DeploymentPlan {
  const parsed = z
    .object({
      schemaVersion: z.literal(1),
      id: z.string().regex(/^[a-f0-9]{64}$/),
      services: z.unknown(),
      snapshot: z.unknown(),
      release: z.unknown(),
      steps: z
        .array(
          z.enum([
            'create',
            'configure',
            'environment',
            'domain',
            'ssl',
            'deploy',
          ]),
        )
        .max(6),
    })
    .strict()
    .safeParse(value);
  if (!parsed.success) fail('INVALID_DEPLOYMENT_PLAN');
  const input = parsed.data;
  const result = planFromInput(input.services, input.snapshot, input.release);
  if (result.id !== input.id || !same(result.steps, input.steps))
    fail('STALE_OR_TAMPERED_DEPLOYMENT_PLAN');
  return result;
}
