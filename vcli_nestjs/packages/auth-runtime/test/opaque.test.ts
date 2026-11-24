import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  createOpaqueCapability,
  hashOpaqueCapability,
  opaqueCapabilityMatches,
} from '../dist/opaque.js';
import { AuthRuntimeError } from '../dist/errors.js';
import type { AuthRuntimeErrorCode } from '../dist/errors.js';

function code(expected: AuthRuntimeErrorCode) {
  return (error: unknown) =>
    error instanceof AuthRuntimeError &&
    error.code === expected &&
    error.message === expected;
}

test('256-bit canonical capabilities have domain-separated repeatable hashes', () => {
  const capability = createOpaqueCapability();
  const other = createOpaqueCapability();
  assert.match(capability, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(Buffer.from(capability, 'base64url').length, 32);
  assert.notEqual(capability, other);
  const hash = hashOpaqueCapability(capability, 'session-capability');
  assert.match(hash, /^[a-f0-9]{64}$/u);
  assert.equal(hashOpaqueCapability(capability, 'session-capability'), hash);
  assert.notEqual(hashOpaqueCapability(capability, 'refresh-token'), hash);
  assert.notEqual(hashOpaqueCapability(capability, 'action-token'), hash);
  assert.notEqual(hashOpaqueCapability(capability, 'realtime-ticket'), hash);
  const installation = hashOpaqueCapability(
    capability,
    'installation-capability',
  );
  assert.notEqual(installation, hash);
  assert.equal(
    opaqueCapabilityMatches(
      capability,
      installation,
      'installation-capability',
    ),
    true,
  );
  assert.equal(
    opaqueCapabilityMatches(capability, installation, 'session-capability'),
    false,
  );
  assert.equal(
    opaqueCapabilityMatches(capability, hash, 'session-capability'),
    true,
  );
  assert.equal(
    opaqueCapabilityMatches(other, hash, 'session-capability'),
    false,
  );
  assert.equal(
    opaqueCapabilityMatches(capability, hash, 'refresh-token'),
    false,
  );
});

test('rejects aliases, malformed capability/hash encodings and unsupported purposes safely', () => {
  const capability = createOpaqueCapability();
  // Last base64url sextet has two unused bits; B is a noncanonical alias for A.
  for (const malformed of [
    '',
    'x'.repeat(42),
    'x'.repeat(44),
    `${capability}=`,
    'A'.repeat(42) + 'B',
    '\0'.repeat(43),
  ])
    assert.throws(
      () => hashOpaqueCapability(malformed, 'refresh-token'),
      code('INVALID_OPAQUE_CAPABILITY'),
    );
  for (const hash of ['', 'a'.repeat(63), 'A'.repeat(64), 'z'.repeat(64)])
    assert.throws(
      () => opaqueCapabilityMatches(capability, hash, 'action-token'),
      code('INVALID_CAPABILITY_HASH'),
    );
  assert.throws(
    () => hashOpaqueCapability(capability, 'unknown' as 'action-token'),
    code('INVALID_OPAQUE_PURPOSE'),
  );
  const error = new AuthRuntimeError(capability as AuthRuntimeErrorCode);
  assert.equal(error.message, 'CRYPTO_FAILURE');
  assert.equal(JSON.stringify(error).includes(capability), false);
});

test('main, errors and opaque entries load with optional peer resolution forbidden', () => {
  const script = `
    import { registerHooks } from 'node:module';
    registerHooks({ resolve(specifier, context, next) {
      if (/^(?:argon2|jose)(?:\\/|$)/u.test(specifier)) throw new Error('optional peer loaded');
      return next(specifier, context);
    }});
    await import(${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)});
    await import(${JSON.stringify(new URL('../dist/errors.js', import.meta.url).href)});
    const opaque = await import(${JSON.stringify(new URL('../dist/opaque.js', import.meta.url).href)});
    opaque.hashOpaqueCapability(opaque.createOpaqueCapability(), 'session-capability');
  `;
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', script],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
});
