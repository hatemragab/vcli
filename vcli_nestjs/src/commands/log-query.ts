import { spawn } from 'node:child_process';
import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { projectPath } from '../engine/paths.js';
import { readProject } from '../engine/state.js';
import { assertOwnerEnvFile } from '../services/dev-command.js';
import { CliError } from './cli-error.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventFields = new Set([
  'timestamp',
  'event',
  'severity',
  'requestId',
  'operationId',
  'statusCode',
  'errorCode',
  'route',
  'method',
  'source',
  'stage',
]);

export interface LogQueryOptions {
  action: 'status' | 'query';
  requestId?: string;
  operationId?: string;
  configFile?: string;
  dryRun?: boolean;
  environment: NodeJS.ProcessEnv;
}

function parseLogResult(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || trimmed.length > 32000) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== 1 || typeof record.status !== 'string')
    return undefined;
  const output: Record<string, unknown> = {
    schemaVersion: 1,
    status: record.status,
  };
  for (const key of ['code', 'next', 'cursor'] as const) {
    if (typeof record[key] === 'string' && record[key].length <= 160)
      output[key] = record[key];
  }
  if (typeof record.truncated === 'boolean')
    output.truncated = record.truncated;
  for (const key of ['retainedFiles', 'retainedBytes'] as const) {
    if (
      typeof record[key] === 'number' &&
      Number.isInteger(record[key]) &&
      record[key] >= 0 &&
      record[key] <= 1_000_000_000
    )
      output[key] = record[key];
  }
  for (const key of ['sources', 'unavailableSources', 'gaps']) {
    if (Array.isArray(record[key]))
      output[key] = (record[key] as unknown[])
        .filter((item) => typeof item === 'string')
        .slice(0, 20);
  }
  if (Array.isArray(record.events)) {
    output.events = record.events.slice(0, 50).map((event) => {
      if (!event || typeof event !== 'object' || Array.isArray(event))
        return {};
      const safe: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(event))
        if (eventFields.has(key)) safe[key] = item;
      return safe;
    });
  }
  return output;
}

/** Read retained evidence through the generated reader. No new collector is started. */
export async function queryLogs(
  root: string,
  options: LogQueryOptions,
): Promise<Record<string, unknown>> {
  if (options.action === 'query') {
    const chosen = [options.requestId, options.operationId].filter(Boolean);
    if (chosen.length !== 1 || !uuid.test(chosen[0]!))
      throw new CliError(
        'INVALID_LOG_QUERY',
        'Pass one --request-id or --operation-id UUID.',
      );
  }
  const preview = {
    action: options.action,
    ...(options.requestId ? { requestId: options.requestId } : {}),
    ...(options.operationId ? { operationId: options.operationId } : {}),
    configFile: options.configFile ? 'selected' : 'absent',
  };
  if (options.dryRun)
    return { status: 'not-run', ...preview, next: 'vcli logs status' };
  const state = await readProject(root);
  if (!state.config.capabilities.diagnostics)
    return {
      status: 'failed',
      code: 'DIAGNOSTICS_NOT_SELECTED',
      next: 'vcli add diagnostics.local',
      ...preview,
    };
  const script = await projectPath(root, 'dist/query-logs.js');
  const info = await lstat(script).catch(() => undefined);
  if (!info?.isFile() || info.isSymbolicLink())
    return {
      status: 'failed',
      code: 'LOG_QUERY_BUILD_REQUIRED',
      next: 'npm run build',
      ...preview,
    };
  const environment = { ...options.environment };
  if (options.configFile) {
    const absolute = path.resolve(root, options.configFile);
    await assertOwnerEnvFile(absolute);
    environment.APP_ENV_FILE = absolute;
  }
  const args = [script, options.action];
  if (options.requestId) args.push('--request-id', options.requestId);
  if (options.operationId) args.push('--operation-id', options.operationId);
  const text = await new Promise<string>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: environment,
      shell: false,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const finish = (value: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 32000) {
        child.kill('SIGKILL');
        finish('');
      }
    });
    child.once('error', () => finish(''));
    child.once('close', () => finish(stdout));
  });
  return (
    parseLogResult(text) ?? {
      status: 'failed',
      code: 'LOG_QUERY_FAILED',
      next: 'vcli logs status',
      ...preview,
    }
  );
}
