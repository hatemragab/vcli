import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import type { ProjectConfig } from '../src/contracts.js';
import { describeThrown } from '../dist/contracts.js';
import { retainSelectedMediaRoutes } from '../dist/recipes/media-routes.js';
import { configuration } from '../dist/recipes/render-config.js';
import {
  parseCheckDiagnostics,
  parseScriptResult,
} from '../dist/script-result.js';

const diagnosticsConfig: ProjectConfig = {
  schemaVersion: 1,
  project: { name: 'config-api', packageManager: 'npm' },
  capabilities: {
    diagnostics: {
      recipe: 'diagnostics.local',
      options: { sources: ['application'], reader: 'local-same-user' },
    },
  },
};

test('check diagnostics keep path, line and code and drop raw text', () => {
  const diagnostics = parseCheckDiagnostics(
    'SECRET_VALUE leaked\nsrc/main.ts(12,3): error TS2322: Type SECRET is not assignable\n',
  );
  assert.deepEqual(diagnostics[0], {
    path: 'src/main.ts',
    line: 12,
    column: 3,
    code: 'TS2322',
  });
  assert.equal(JSON.stringify(diagnostics).includes('SECRET'), false);
});

test('release results distinguish config, completion and ambiguous writes', () => {
  assert.equal(
    parseScriptResult(
      JSON.stringify({
        schemaVersion: 1,
        status: 'failed',
        code: 'INVALID_CONFIG',
        next: 'vcli config check',
        keys: ['JWT_KEYS_JSON'],
        leaked: 'SECRET',
      }),
    ),
    undefined,
  );
  assert.equal(
    parseScriptResult(
      JSON.stringify({
        schemaVersion: 1,
        status: 'failed',
        code: 'INVALID_CONFIG',
        next: 'vcli config check',
        keys: ['JWT_KEYS_JSON'],
      }),
    )?.next,
    'vcli config check',
  );
  assert.equal(
    parseScriptResult(
      JSON.stringify({
        schemaVersion: 1,
        status: 'completed',
        code: 'RELEASE_APPLIED',
        releaseId: 'selected-v1-0123456789abcdef01234567',
        owners: ['identity'],
      }),
    )?.code,
    'RELEASE_APPLIED',
  );
  assert.equal(
    parseScriptResult(
      JSON.stringify({
        schemaVersion: 1,
        status: 'failed',
        code: 'RELEASE_AMBIGUOUS',
        next: 'vcli release reconcile',
      }),
    )?.next,
    'vcli release reconcile',
  );
});

test('missing mail stays a validation failure with the recipe name', () => {
  const failure = describeThrown(new Error('MISSING_CAPABILITY:mail'));
  assert.equal(failure?.code, 'MISSING_CAPABILITY');
  assert.equal(failure?.details.recipe, 'mail');
  assert.equal(failure?.details.origin, 'validation');
  assert.equal(String(failure).includes('Error:'), false);
});

test('evidence byte bound is shared with selected config', () => {
  const selected = configuration(diagnosticsConfig);
  const field = selected.fields.find(
    (item) => item.key === 'EVIDENCE_MAX_BYTES',
  );
  assert.equal(field?.minimum, 512);
  assert.equal(field?.maximum, 10485760);
  const source = selected.files.find((item) =>
    item.path.endsWith('load-config.ts'),
  )!.content;
  assert.match(source, /\.min\(512\)/);
});

test('mediated media keeps reconcile and drops unselected upload routes', async () => {
  const source = await readFile(
    'templates/runtime/common/src/modules/media/media.controller.ts',
    'utf8',
  );
  const selected = retainSelectedMediaRoutes(source, ['mediated']);
  assert.equal(selected.includes('/grant'), false);
  assert.equal(selected.includes('vcli-route:multipart'), false);
  assert.equal(selected.includes('reconcile'), true);
  assert.match(selected, /z\.enum\(\['mediated'\]\)\.default\('mediated'\)/);
});
