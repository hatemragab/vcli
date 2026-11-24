import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  fetchOpenApi,
  writeOpenApi,
} from '../dist/commands/openapi-commands.js';
import {
  applyOpenApiContract,
  openApiOperationId,
} from '../templates/runtime/common/src/core/http/openapi-contract.ts';

const api = {
  openapi: '3.0.0',
  info: { title: 'Fixture', version: '1' },
  paths: {},
};

test('OpenAPI exporter reads only /docs-json and emits the raw document', async () => {
  const result = await fetchOpenApi(
    'http://127.0.0.1:3101',
    async (url, options) => {
      assert.equal(String(url), 'http://127.0.0.1:3101/docs-json');
      assert.equal(options?.redirect, 'error');
      assert.equal(options?.credentials, 'omit');
      assert.equal(new Headers(options?.headers).get('Authorization'), null);
      assert.ok(options?.signal instanceof AbortSignal);
      return Response.json(api);
    },
  );
  assert.deepEqual(JSON.parse(result), api);
  assert.equal(result.at(-1), '\n');
});

test('OpenAPI exporter rejects unsafe origins, oversized/non-OpenAPI bodies, and private error text', async () => {
  for (const url of [
    'http://private:fixture@example.invalid',
    'http://example.invalid/api',
    'http://example.invalid?secret=fixture',
    'file:///etc/passwd',
  ]) {
    let called = false;
    await assert.rejects(
      fetchOpenApi(url, async () => {
        called = true;
        return Response.json(api);
      }),
      { code: 'INVALID_OPENAPI_ORIGIN' },
    );
    assert.equal(called, false);
  }
  const origin = 'https://example.invalid';
  await assert.rejects(
    fetchOpenApi(
      origin,
      async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
    ),
    { code: 'OPENAPI_TOO_LARGE' },
  );
  await assert.rejects(
    fetchOpenApi(origin, async () => Response.json({ ...api, paths: [] })),
    { code: 'INVALID_OPENAPI_DOCUMENT' },
  );
  await assert.rejects(
    fetchOpenApi(
      origin,
      async () => new Response('private fixture data', { status: 503 }),
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'OPENAPI_UNAVAILABLE' &&
      !String(error).includes('private'),
  );
});

test('OpenAPI export creates a new file only and leaves no staging artifacts', async (t) => {
  const folder = await mkdtemp(join(tmpdir(), 'vcli-openapi-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const path = join(folder, 'openapi.json');
  await writeOpenApi(path, JSON.stringify(api));
  await assert.rejects(writeOpenApi(path, 'overwritten'), {
    code: 'OPENAPI_OUTPUT_EXISTS',
  });
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), api);
  assert.deepEqual(await readdir(folder), ['openapi.json']);
});

test('OpenAPI contract preserves operation naming and documents safe response details', () => {
  assert.equal(
    openApiOperationId('LocalIdentityController', 'login'),
    'LocalIdentityController_login',
  );
  assert.equal(
    openApiOperationId('NotesController', 'get', '2'),
    'NotesController_get_2',
  );
  const document: OpenAPIObject = {
    ...api,
    paths: {
      '/api/identity/local/login': {
        post: {
          responses: {
            '200': { description: '' },
            '429': { description: 'Rate limited' },
          },
        },
      },
    },
  };
  applyOpenApiContract(document, 'full');
  const responses =
    document.paths['/api/identity/local/login']!.post!.responses;
  assert.deepEqual(responses.default, {
    $ref: '#/components/responses/VcliHttpError',
  });
  const failure = responses['429'];
  assert.ok(failure && 'headers' in failure && 'content' in failure);
  assert.ok(failure.headers?.['X-Request-Id']);
  assert.ok(failure.headers?.['Retry-After']);
  assert.deepEqual(failure.content?.['application/json']?.schema, {
    $ref: '#/components/schemas/VcliHttpError',
  });
  assert.ok(document.components?.schemas?.VcliHttpError);
  const success = responses['200'];
  assert.ok(success && 'headers' in success && 'content' in success);
  assert.ok(success.headers?.['X-Operation-Id']);
  const schema = success.content?.['application/json']?.schema;
  assert.ok(schema && 'properties' in schema);
  assert.ok(schema.properties?.accessToken);
  assert.ok(schema.properties?.refreshToken);
});

test('generated client errors retain safe detail and support fresh Push authorization', async () => {
  const { pushClient } = (await import(
    new URL(
      '../templates/runtime/common/clients/push-client.mjs',
      import.meta.url,
    ).href
  )) as {
    pushClient(options: Record<string, unknown>): { list(): Promise<unknown> };
  };
  const used: string[] = [];
  const requestId = '238240bf-2c5f-44ed-b44e-ba29c8fee626';
  let token = 'initial';
  const push = pushClient({
    origin: 'https://example.invalid',
    accessToken: async () => token,
    fetch: async (_url: URL, init: RequestInit) => {
      used.push(new Headers(init.headers).get('Authorization') ?? '');
      return Response.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            fields: ['token', '<private>'],
            message: 'private data',
          },
        },
        {
          status: 400,
          headers: { 'X-Request-Id': requestId, 'Retry-After': '60' },
        },
      );
    },
  });
  const safe = {
    status: 400,
    code: 'INVALID_REQUEST',
    fields: ['token'],
    requestId,
    retryAfter: '60',
  };
  await assert.rejects(push.list(), safe);
  token = 'rotated';
  await assert.rejects(push.list(), safe);
  assert.deepEqual(used, ['Bearer initial', 'Bearer rotated']);
});
