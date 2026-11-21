import { z } from 'zod';
import { targetCompose } from '../../recipes/render-deployment.js';
import type { DeploymentPlan } from './types.js';
import {
  commitSchema,
  digest,
  fail,
  idSchema,
  imageSchema,
  keySchema,
} from './validation.js';

export function imageCompose(plan: DeploymentPlan): Record<string, unknown> {
  const compose = targetCompose(plan.services);
  // targetCompose creates this ordinary JSON object; validation below also checks the resulting shape.
  const services = compose.services as Record<string, Record<string, unknown>>;
  for (const service of Object.values(services)) {
    delete service.build;
    service.image = plan.release.image;
    service.labels = {
      ...(service.labels as Record<string, string>),
      'io.vcli.operation': plan.release.operationId,
      'io.vcli.source-commit': plan.release.sourceCommit,
    };
  }
  return compose;
}
const health = z.union([
  z.object({ disable: z.literal(true) }).strict(),
  z
    .object({
      test: z.tuple([
        z.literal('CMD'),
        z.literal('node'),
        z.literal('-e'),
        z.literal(
          "fetch('http://127.0.0.1:3100/health/ready',{signal:AbortSignal.timeout(4000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ),
      ]),
      interval: z.literal('30s'),
      timeout: z.literal('5s'),
      start_period: z.literal('20s'),
      retries: z.literal(3),
    })
    .strict(),
]);
const serviceSchema = z
  .object({
    image: imageSchema,
    init: z.literal(true),
    restart: z.enum(['unless-stopped', 'no']),
    stop_grace_period: z.literal('30s'),
    mem_limit: z.literal('512m'),
    cpus: z.literal(1),
    pids_limit: z.literal(256),
    deploy: z.object({ replicas: z.number().int().min(1).max(8) }).strict(),
    cgroup_parent: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_.@/-]{0,127}$/)
      .optional(),
    environment: z.record(keySchema, z.union([z.string().max(4096), z.null()])),
    expose: z.array(z.literal('3100')).max(1),
    cap_drop: z.tuple([z.literal('ALL')]),
    security_opt: z.tuple([z.literal('no-new-privileges:true')]),
    volumes: z
      .array(
        z
          .string()
          .regex(/^app-(storage|evidence):\/app\/var\/(storage|evidence)$/),
      )
      .max(2),
    labels: z
      .object({
        'io.vcli.project': idSchema,
        'io.vcli.environment': z.enum(['production', 'staging']),
        'io.vcli.operation': z.uuid(),
        'io.vcli.source-commit': commitSchema,
      })
      .strict(),
    healthcheck: health,
    profiles: z.tuple([z.literal('operations')]).optional(),
    command: z.array(z.string()).max(4).optional(),
  })
  .strict();
const schema = z
  .object({
    services: z
      .object({
        api: serviceSchema,
        release: serviceSchema.optional(),
        'mail-drain': serviceSchema.optional(),
        'identity-cleanup': serviceSchema.optional(),
      })
      .strict(),
    volumes: z
      .partialRecord(
        z.enum(['app-storage', 'app-evidence']),
        z.object({ name: idSchema, external: z.literal(true) }).strict(),
      )
      .optional(),
  })
  .strict();
/** Only validated technical settings are hashed; runtime environment contents are excluded. */
export function composeFingerprint(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') fail('UNSUPPORTED_NATIVE_COMPOSE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('UNSUPPORTED_NATIVE_COMPOSE');
  }
  const result = schema.safeParse(parsed);
  if (!result.success) fail('UNMANAGED_NATIVE_COMPOSE');
  const services: Record<string, unknown> = {};
  for (const [name, service] of Object.entries(result.data.services)) {
    if (!service) continue;
    if (name === 'api') {
      if (
        service.command ||
        service.profiles ||
        service.restart !== 'unless-stopped' ||
        !('test' in service.healthcheck)
      )
        fail('UNMANAGED_NATIVE_COMPOSE');
    } else {
      const expected =
        name === 'release'
          ? ['node', 'dist/initialize-database.js']
          : name === 'mail-drain'
            ? ['node', 'dist/drain-mail.js', '--limit', '20']
            : ['node', 'dist/drain-identity-cleanup.js', '--limit', '10'];
      if (
        JSON.stringify(service.command) !== JSON.stringify(expected) ||
        !service.profiles ||
        service.restart !== 'no' ||
        !('disable' in service.healthcheck)
      )
        fail('UNMANAGED_NATIVE_COMPOSE');
    }
    services[name] = {
      ...service,
      environment: Object.keys(service.environment).sort(),
    };
  }
  return digest({ services, volumes: result.data.volumes ?? {} });
}

/** Stable native volume references only; never accepts a private host path or environment value. */
export function composeVolumeBindings(
  value: unknown,
): { resourceRef: string; containerPath: string }[] {
  if (value === undefined || value === null || value === '') return [];
  if (typeof value !== 'string') fail('UNMANAGED_NATIVE_COMPOSE');
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    fail('UNMANAGED_NATIVE_COMPOSE');
  }
  const result = schema.safeParse(raw);
  if (!result.success) fail('UNMANAGED_NATIVE_COMPOSE');
  return result.data.services.api.volumes.map((mount) => {
    const [key, containerPath] = mount.split(':');
    const definition =
      result.data.volumes?.[key as 'app-storage' | 'app-evidence'];
    if (!definition || !containerPath) fail('UNMANAGED_NATIVE_COMPOSE');
    return { resourceRef: definition.name, containerPath };
  });
}
