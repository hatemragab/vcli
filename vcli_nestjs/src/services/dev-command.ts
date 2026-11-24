import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import type { ServicePlan } from '../recipes/service-plan-types.js';
import type {
  CommandResult,
  ServiceInvocation,
  ServiceRunner,
} from './service-types.js';
import { runOwnedProcess } from './owned-process.js';
import { withLocalOperationLock } from './local-operation-lock.js';

export interface DevOptions {
  root: string;
  plan: ServicePlan;
  port: number;
  environment: NodeJS.ProcessEnv;
  envFile?: string;
  dryRun?: boolean;
}
export function planDevCommand(options: DevOptions): {
  command: string;
  args: readonly string[];
  environment: string;
  port: number;
} {
  if (
    options.plan.target !== 'local' ||
    !['development', 'test'].includes(options.plan.environment)
  )
    throw new Error('DEV_REQUIRES_LOCAL_ENVIRONMENT');
  if (
    !Number.isInteger(options.port) ||
    options.port < 1024 ||
    options.port > 65535
  )
    throw new Error('INVALID_DEV_PORT');
  return {
    command: process.execPath,
    args: [
      path.join(
        path.resolve(options.root),
        'node_modules/@nestjs/cli/bin/nest.js',
      ),
      'start',
      '--watch',
    ],
    environment: options.plan.environment,
    port: options.port,
  };
}

/** Owner-only regular file. Dry-run callers must not invoke this. */
export async function assertOwnerEnvFile(envFile: string): Promise<void> {
  const info = await lstat(envFile).catch(() => {
    throw new Error('PRIVATE_ENV_FILE_UNAVAILABLE');
  });
  if (
    !path.isAbsolute(envFile) ||
    !info.isFile() ||
    info.isSymbolicLink() ||
    (process.getuid && info.uid !== process.getuid()) ||
    (info.mode & 0o077) !== 0
  )
    throw new Error('UNSAFE_PRIVATE_ENV_FILE');
}

/** Probe only the requested local listener, never scan or kill another process. */
export async function assertDevPortAvailable(port: number): Promise<void> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('INVALID_DEV_PORT');
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error('DEV_PORT_UNAVAILABLE')));
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () =>
      server.close((error) =>
        error ? reject(new Error('DEV_PORT_UNAVAILABLE')) : resolve(),
      ),
    );
  });
}

/** One explicit Nest invocation; lock release never removes a replaced user file. */
export async function executeDevCommand(
  options: DevOptions,
  runner: ServiceRunner = (invocation) => runOwnedProcess(invocation),
): Promise<{
  status: 'planned' | 'completed';
  plan: ReturnType<typeof planDevCommand>;
  code?: number;
}> {
  const plan = planDevCommand(options);
  if (options.dryRun) return { status: 'planned', plan };
  const root = await realpath(options.root);
  const nest = path.join(root, 'node_modules/@nestjs/cli/bin/nest.js');
  const resolved = await realpath(nest).catch(() => {
    throw new Error('LOCAL_NEST_NOT_INSTALLED');
  });
  if (!resolved.startsWith(path.join(root, 'node_modules') + path.sep))
    throw new Error('UNSAFE_LOCAL_NEST_PATH');
  const envFile = options.envFile ?? options.environment.APP_ENV_FILE;
  if (envFile) await assertOwnerEnvFile(envFile);
  await assertDevPortAvailable(options.port);
  return withLocalOperationLock(
    root,
    `dev-${options.plan.environment}`,
    async () => {
      const invocation: ServiceInvocation = {
        command: plan.command,
        args: [nest, ...plan.args.slice(1)],
        cwd: root,
        environment: {
          ...options.environment,
          NODE_ENV: options.plan.nodeEnvironment,
          HOST: '127.0.0.1',
          PORT: String(options.port),
          ...(envFile ? { APP_ENV_FILE: envFile } : {}),
        },
      };
      const result: CommandResult = await runner(invocation);
      return { status: 'completed', plan, code: result.code };
    },
  );
}
