import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as argon2 from 'argon2';
import { ArgonPasswords, DEFAULT_PASSWORD_POLICY } from '../dist/password.js';
import { AuthRuntimeError } from '../dist/errors.js';

let passwords: ArgonPasswords;
before(async () => {
  passwords = await ArgonPasswords.create();
});

const hasCode = (code: string) => (error: unknown) =>
  error instanceof AuthRuntimeError &&
  error.code === code &&
  error.message === code;

test('real Argon2id hash/verify, random salt and measured creation facts', async () => {
  const password = 'correct horse 🔐 battery';
  const hash = await passwords.hash(password);
  const other = await passwords.hash(password);
  assert.notEqual(hash, other);
  assert.match(hash, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
  assert.equal(await passwords.verify(hash, password), true);
  assert.equal(await passwords.verify(hash, 'wrong'), false);
  assert.equal(await argon2.verify(hash, password), true);
  assert.equal(passwords.needsRehash(hash), false);
  assert.deepEqual(passwords.policy, DEFAULT_PASSWORD_POLICY);
  assert.ok(Object.isFrozen(passwords.policy));
  assert.ok(
    Number.isFinite(passwords.measuredHashMs) && passwords.measuredHashMs > 0,
  );
  assert.equal('dummyHash' in passwords, false);
});

test('real verifier preserves exact Unicode bytes, including canonical distinctions and NUL', async () => {
  const password = 'e\u0301\0🔐';
  const hash = await passwords.hash(password);
  assert.equal(await passwords.verify(hash, password), true);
  assert.equal(await passwords.verify(hash, 'é\0🔐'), false);
  const limit = '🔐'.repeat(256);
  assert.equal(Buffer.byteLength(limit), 1024);
  const boundaryHash = await passwords.hash(limit);
  assert.equal(await passwords.verify(boundaryHash, limit), true);
  for (const invalid of ['a'.repeat(1025), limit + 'a', '\ud800', '\udc00']) {
    await assert.rejects(
      passwords.hash(invalid),
      hasCode('PASSWORD_INPUT_INVALID'),
    );
    await assert.rejects(
      passwords.verify(boundaryHash, invalid),
      hasCode('PASSWORD_INPUT_INVALID'),
    );
    await assert.rejects(
      passwords.verifyDummy(invalid),
      hasCode('PASSWORD_INPUT_INVALID'),
    );
  }
});

test('real dummy verification consumes native work without returning authentication', async () => {
  assert.equal(
    await passwords.verifyDummy('unknown account password'),
    undefined,
  );
  assert.equal(await passwords.verifyDummy(''), undefined);
  const hash = await passwords.hash('still usable');
  assert.equal(await passwords.verify(hash, 'still usable'), true);
});

test('real legacy hashes verify and require rehash; length changes supplement library policy', async () => {
  const legacy = await argon2.hash('legacy', {
    type: argon2.argon2id,
    memoryCost: 1024,
    timeCost: 1,
    parallelism: 1,
    hashLength: 32,
  });
  assert.equal(await passwords.verify(legacy, 'legacy'), true);
  assert.equal(passwords.needsRehash(legacy), true);
  const shortHash = await argon2.hash('legacy', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
    hashLength: 16,
    salt: Buffer.alloc(8, 7),
  });
  assert.equal(
    argon2.needsRehash(shortHash, {
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    }),
    false,
  );
  assert.equal(passwords.needsRehash(shortHash), true);
  assert.equal(await passwords.verify(shortHash, 'legacy'), true);
  const upgraded = await ArgonPasswords.create({
    memoryCostKiB: 32768,
    timeCost: 3,
    parallelism: 2,
    hashLength: 48,
    saltLength: 32,
  });
  const current = await upgraded.hash('legacy');
  assert.equal(upgraded.needsRehash(current), false);
  assert.equal(passwords.needsRehash(current), true);
  assert.equal(await passwords.verify(current, 'legacy'), true);
  assert.equal(upgraded.needsRehash(await passwords.hash('legacy')), true);
});

test('real Argon2 accepts the exact stored-resource ceiling and rejects larger headers', async () => {
  const hash = await argon2.hash('bounded ceiling', {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 5,
    parallelism: 2,
    hashLength: 64,
    salt: Buffer.alloc(64, 9),
  });
  assert.equal(await passwords.verify(hash, 'bounded ceiling'), true);
  assert.equal(passwords.needsRehash(hash), true);
  await assert.rejects(
    passwords.verify(hash.replace('m=65536', 'm=65537'), 'bounded ceiling'),
    hasCode('CREDENTIAL_STORAGE_INVALID'),
  );
});

test('malformed/resource-inflated stored records are rejected safely', async () => {
  const hash = await passwords.hash('sensitive');
  for (const bad of [
    '',
    hash + '$extra',
    hash.replace('argon2id', 'argon2i'),
    hash.replace('v=19', 'v=16'),
    hash.replace('m=19456', 'm=65537'),
    hash.replace('m=19456', 'm=999999999999'),
    hash.replace('m=19456', 'm=0'),
    hash.replace('m=19456', 'm=7'),
    hash.replace('t=2', 't=6'),
    hash.replace('t=2', 't=0'),
    hash.replace('p=1', 'p=3'),
    hash.replace('p=1', 'p=0'),
    hash.replace('m=19456', 'm=019456'),
    hash.replace('m=19456,t=2,p=1', 'p=1,t=2,m=19456'),
    hash + '=',
    hash.replace(/\$[^$]+$/u, '$tiny'),
    'sensitive'.repeat(100),
  ]) {
    await assert.rejects(
      passwords.verify(bad, 'sensitive'),
      hasCode('CREDENTIAL_STORAGE_INVALID'),
    );
    assert.throws(
      () => passwords.needsRehash(bad),
      hasCode('CREDENTIAL_STORAGE_INVALID'),
    );
  }
});

test('unsafe static policies fail before native work and input policy is copied/frozen', async () => {
  for (const policy of [
    { memoryCostKiB: 65537 },
    { memoryCostKiB: 19455 },
    { timeCost: 1 },
    { timeCost: 6 },
    { parallelism: 0 },
    { parallelism: 3 },
    { maxConcurrent: 3 },
    { maxConcurrent: 0 },
    { hashLength: 31 },
    { hashLength: 65 },
    { saltLength: 15 },
    { maxPasswordBytes: 63 },
    { maxPasswordBytes: 4097 },
    { memoryCostKiB: NaN },
    { timeCost: 2.1 },
  ])
    await assert.rejects(
      ArgonPasswords.create(policy),
      hasCode('PASSWORD_POLICY_INVALID'),
    );
  const policy = { maxPasswordBytes: 64 };
  const limited = await ArgonPasswords.create(policy);
  policy.maxPasswordBytes = 4096;
  assert.equal(limited.policy.maxPasswordBytes, 64);
  await assert.rejects(
    limited.hash('🔐'.repeat(17)),
    hasCode('PASSWORD_INPUT_INVALID'),
  );
});
