import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readProject } from '../engine/state.js';
import { configuration } from '../recipes/render-config.js';
import { assertOwnerEnvFile } from '../services/dev-command.js';
import { CliError } from './cli-error.js';

function fileFlag(file: string | undefined): string {
  if (!file || file.split('/').includes('..')) return '';
  const safe =
    /^(?:\.?[A-Za-z0-9_-]+\/)*\.?[A-Za-z0-9._-]+$/.test(file) ||
    /^\/(?:\.?[A-Za-z0-9_-]+\/)*\.?[A-Za-z0-9._-]+$/.test(file);
  return safe ? ` --config-file ${file}` : '';
}

const keyName = /^[A-Z][A-Z0-9_]{0,64}$/;
const probeCode = /^[A-Z][A-Z0-9_]{1,80}$/;

function probeScript(): string {
  return fileURLToPath(
    new URL('../../bin/config-schema-probe.mjs', import.meta.url),
  );
}

function parseProbe(text: string):
  | {
      status: 'valid' | 'invalid' | 'schema-unavailable';
      code?: string;
      invalid: string[];
      reason?: string;
    }
  | undefined {
  const line =
    text
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .at(-1) ?? '';
  if (!line.startsWith('{') || line.length > 4000) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.schemaVersion !== 1 ||
    (record.status !== 'valid' &&
      record.status !== 'invalid' &&
      record.status !== 'schema-unavailable')
  )
    return undefined;
  const invalid = Array.isArray(record.invalid)
    ? record.invalid
        .filter((item) => typeof item === 'string' && keyName.test(item))
        .slice(0, 40)
    : [];
  const code =
    typeof record.code === 'string' && probeCode.test(record.code)
      ? record.code
      : undefined;
  const reason =
    typeof record.reason === 'string' && /^[a-z0-9-]{1,64}$/.test(record.reason)
      ? record.reason
      : undefined;
  return {
    status: record.status,
    invalid,
    ...(code ? { code } : {}),
    ...(reason ? { reason } : {}),
  };
}

/** Run the project startup module. The child result is an allowlist; stdout is not kept. */
function runStartupSchema(
  root: string,
  configFile: string,
): Promise<ReturnType<typeof parseProbe>> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [probeScript(), root, configFile], {
      cwd: root,
      env: { ...process.env, APP_ENV_FILE: configFile },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    let stdout = '';
    let settled = false;
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 8000) {
        stdout = stdout.slice(-8000);
        child.kill('SIGKILL');
      }
    });
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(parseProbe(stdout));
    };
    child.once('error', finish);
    child.once('close', finish);
  });
}

/** Startup schema and dotenv precedence. Dry-run lists selected names and does not read the file. */
export async function checkSelectedConfig(
  root: string,
  options: { configFile?: string; dryRun?: boolean },
): Promise<Record<string, unknown>> {
  const state = await readProject(root);
  const fields = configuration(state.config).fields;
  const required = fields
    .filter((field) => field.required)
    .map((field) => field.key);
  const flag = fileFlag(options.configFile);
  if (options.dryRun || !options.configFile) {
    return {
      status: options.dryRun ? 'not-run' : 'missing-file',
      schema: 'selected-model',
      configFile: options.configFile ? 'selected' : 'absent',
      required,
      invalid: [],
      next: `vcli config check${flag || ' --config-file <file>'}`,
    };
  }
  const absolute = path.resolve(root, options.configFile);
  await assertOwnerEnvFile(absolute);
  const info = await stat(absolute);
  if (info.size > 200_000)
    throw new CliError(
      'UNSAFE_PRIVATE_ENV_FILE',
      'Use an owner-only config file smaller than 200000 bytes.',
    );
  const probed = await runStartupSchema(root, absolute);
  const ran = probed?.status === 'valid' || probed?.status === 'invalid';
  const status = probed?.status ?? 'failed';
  const names = probed?.invalid ?? [];
  const next =
    status === 'valid'
      ? state.config.capabilities.database
        ? `vcli release apply${flag}`
        : `vcli dev${flag}`
      : status === 'schema-unavailable'
        ? 'vcli inspect'
        : `vcli config check${flag}`;
  return {
    status,
    schema: ran ? 'startup' : 'unavailable',
    configFile: 'selected',
    required,
    invalid: names,
    ...(probed?.code
      ? { code: probed.code }
      : status === 'failed'
        ? { code: 'CONFIG_CHECK_FAILED' }
        : {}),
    ...(probed?.reason ? { reason: probed.reason } : {}),
    next,
  };
}
