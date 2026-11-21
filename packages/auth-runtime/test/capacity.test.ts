import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { AuthRuntimeError } from '../dist/errors.js';

// Controlled library boundary only: these tests prove admission/release behavior,
// not native Argon timing, memory use or host pressure. Real crypto is in password.test.ts.
const stored =
  '$argon2id$v=19$m=19456,t=2,p=1$' +
  Buffer.alloc(16, 1).toString('base64').replace(/=+$/u, '') +
  '$' +
  Buffer.alloc(32, 2).toString('base64').replace(/=+$/u, '');
type Pending = {
  resolve: (value: string | boolean) => void;
  reject: (error: Error) => void;
};
const pending: Pending[] = [];
let hold = false;
let calls = 0;
function work(value: string | boolean): Promise<string | boolean> {
  calls++;
  return hold
    ? new Promise((resolve, reject) => {
        pending.push({ resolve, reject });
      })
    : Promise.resolve(value);
}
mock.module('argon2', {
  exports: {
    argon2id: 2,
    hash: () => work(stored),
    verify: () => work(false),
    needsRehash: () => false,
  },
});
const { ArgonPasswords } = await import('../dist/password.js');
const hasCode = (code: string) => (error: unknown) =>
  error instanceof AuthRuntimeError &&
  error.code === code &&
  error.message === code;

test('controlled Argon boundary: one shared capacity limit across hash/verify/dummy; no hidden queue', async () => {
  const passwords = await ArgonPasswords.create();
  hold = true;
  const first = passwords.hash('one');
  const second = passwords.verify(stored, 'two');
  const before = calls;
  await assert.rejects(
    passwords.verifyDummy('three'),
    hasCode('HASH_CAPACITY'),
  );
  await assert.rejects(passwords.hash('three'), hasCode('HASH_CAPACITY'));
  assert.equal(calls, before);
  pending.shift()!.resolve(stored);
  assert.equal(await first, stored);
  const dummy = passwords.verifyDummy('four');
  assert.equal(calls, before + 1);
  pending.shift()!.resolve(false);
  assert.equal(await second, false);
  pending.shift()!.resolve(false);
  assert.equal(await dummy, undefined);
  hold = false;
});

test('controlled Argon boundary: failures release capacity and never leak library diagnostics', async () => {
  const passwords = await ArgonPasswords.create({ maxConcurrent: 1 });
  hold = true;
  const failed = passwords.hash('private-password');
  const assertion = assert.rejects(failed, hasCode('CRYPTO_FAILURE'));
  pending
    .shift()!
    .reject(new Error('private-password raw-hash library-detail'));
  await assertion;
  const next = passwords.verifyDummy('next');
  pending.shift()!.resolve(false);
  await next;
  hold = false;
});

test('controlled Argon boundary: hostile records/inputs/policies never reach expensive work', async () => {
  const passwords = await ArgonPasswords.create();
  const before = calls;
  await assert.rejects(
    passwords.verify(stored.replace('m=19456', 'm=999999999999'), 'password'),
    hasCode('CREDENTIAL_STORAGE_INVALID'),
  );
  assert.throws(
    () => passwords.needsRehash(stored.replace('p=1', 'p=9')),
    hasCode('CREDENTIAL_STORAGE_INVALID'),
  );
  await assert.rejects(
    passwords.hash('🔐'.repeat(257)),
    hasCode('PASSWORD_INPUT_INVALID'),
  );
  await assert.rejects(
    passwords.verifyDummy('\ud800'),
    hasCode('PASSWORD_INPUT_INVALID'),
  );
  await assert.rejects(
    ArgonPasswords.create({ maxConcurrent: 3 }),
    hasCode('PASSWORD_POLICY_INVALID'),
  );
  assert.equal(calls, before);
});
