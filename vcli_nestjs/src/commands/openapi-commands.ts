import { randomUUID } from 'node:crypto';
import { link, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Command } from 'commander';
import { isErrno } from '../engine/paths.js';
import { CliError } from './cli-error.js';
import type { CliRuntime } from './command-context.js';

const maximumBytes = 4 * 1024 * 1024;
const timeoutMs = 10_000;

function openApiEndpoint(origin: string): URL {
  const error = () =>
    new CliError(
      'INVALID_OPENAPI_ORIGIN',
      'Supply the running API origin as an HTTP or HTTPS URL without credentials, a path, a query, or a fragment.',
    );
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw error();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.href !== url.origin + '/'
  )
    throw error();
  return new URL('/docs-json', url);
}

export async function fetchOpenApi(
  origin: string,
  request: typeof fetch = fetch,
): Promise<string> {
  const url = openApiEndpoint(origin);
  const signal = AbortSignal.timeout(timeoutMs);
  let response: Response;
  try {
    response = await request(url, {
      signal,
      redirect: 'error',
      credentials: 'omit',
      headers: { Accept: 'application/json' },
    });
  } catch {
    throw new CliError(
      'OPENAPI_UNREACHABLE',
      'Start the selected API and check its origin. OpenAPI export does not follow redirects.',
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new CliError(
      'OPENAPI_UNAVAILABLE',
      `The API returned HTTP ${response.status} for /docs-json. Check that Swagger is enabled for the selected profile.`,
    );
  }

  let bytes = 0;
  const stream = response.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        bytes += chunk.byteLength;
        if (bytes > maximumBytes)
          throw new CliError(
            'OPENAPI_TOO_LARGE',
            'The OpenAPI document exceeds the 4 MiB export limit.',
          );
        controller.enqueue(chunk);
      },
    }),
  );
  const invalid = () =>
    new CliError(
      'INVALID_OPENAPI_DOCUMENT',
      'The running API must return an OpenAPI 3 JSON document from /docs-json.',
    );
  let value: unknown;
  try {
    value = await new Response(stream).json();
  } catch (error: unknown) {
    if (error instanceof CliError) throw error;
    if (signal.aborted)
      throw new CliError(
        'OPENAPI_UNREACHABLE',
        'The OpenAPI request timed out.',
      );
    throw invalid();
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('openapi' in value) ||
    typeof value.openapi !== 'string' ||
    !/^3\.\d+\.\d+$/.test(value.openapi) ||
    !('info' in value) ||
    !value.info ||
    typeof value.info !== 'object' ||
    !('title' in value.info) ||
    typeof value.info.title !== 'string' ||
    !('version' in value.info) ||
    typeof value.info.version !== 'string' ||
    !('paths' in value) ||
    !value.paths ||
    typeof value.paths !== 'object' ||
    Array.isArray(value.paths)
  )
    throw invalid();
  return JSON.stringify(value, null, 2) + '\n';
}

export async function writeOpenApi(
  out: string,
  document: string,
): Promise<void> {
  const target = path.resolve(out);
  const temporary = path.join(
    path.dirname(target),
    '.vcli-openapi-' + randomUUID(),
  );
  try {
    await writeFile(temporary, document, { flag: 'wx', mode: 0o600 });
    await link(temporary, target);
  } catch (error: unknown) {
    if (isErrno(error, 'EEXIST'))
      throw new CliError(
        'OPENAPI_OUTPUT_EXISTS',
        'Choose a new --out file. Existing files are preserved.',
      );
    throw new CliError(
      'OPENAPI_OUTPUT_FAILED',
      'Choose a new --out file in an existing writable directory.',
    );
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export function registerOpenApiCommands(
  program: Command,
  runtime: Pick<CliRuntime, 'setOperation'>,
): void {
  program
    .command('openapi')
    .description('Read the API contract of a running project')
    .command('export')
    .description('Export /docs-json as raw OpenAPI JSON')
    .requiredOption('--url <origin>', 'Running API origin')
    .option('--out <file>', 'Write a new file instead of stdout')
    .action(async ({ url, out }: { url: string; out?: string }) => {
      runtime.setOperation('openapi.export');
      const document = await fetchOpenApi(url);
      if (out !== undefined) await writeOpenApi(out, document);
      else process.stdout.write(document);
    });
}
