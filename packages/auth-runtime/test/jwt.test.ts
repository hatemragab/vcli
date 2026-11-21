import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { SignJWT, decodeProtectedHeader } from 'jose';
import type { JWTPayload, JWTHeaderParameters } from 'jose';
import { JoseAccessTokens, generateHs256Key } from '../dist/jwt.js';
import type { JwtPolicy } from '../dist/jwt.js';
import { AuthRuntimeError } from '../dist/errors.js';

const now = 1800000000123;
const seconds = Math.floor(now / 1000);
const key = generateHs256Key();
const nextKey = generateHs256Key();
const policy: JwtPolicy = {
  issuer: 'https://issuer.example',
  audience: 'example-api',
  activeSigningKeyId: 'old-v1',
  keys: [{ id: 'old-v1', key }],
  maxLifetimeSeconds: 900,
};
const tokens = new JoseAccessTokens(policy);
const input = {
  accountId: 'account-1',
  sessionId: 'session-1',
  installationId: 'installation-1',
  now,
  expiresAt: now + 60000,
};
const baseClaims: JWTPayload = {
  sub: input.accountId,
  sid: input.sessionId,
  iid: input.installationId,
  iss: policy.issuer,
  aud: policy.audience,
  iat: seconds,
  exp: seconds + 60,
};
const baseHeader: JWTHeaderParameters = {
  alg: 'HS256',
  typ: 'JWT',
  kid: 'old-v1',
};
const hasCode = (code: string) => (error: unknown) =>
  error instanceof AuthRuntimeError &&
  error.code === code &&
  error.message === code;

function signed(
  claims: JWTPayload = {},
  header: JWTHeaderParameters = baseHeader,
  signingKey: Uint8Array = key,
) {
  return new SignJWT({ ...baseClaims, ...claims })
    .setProtectedHeader(header)
    .sign(signingKey);
}

test('real JOSE positive control returns exact frozen facts with explicit millisecond clock', async () => {
  const token = await tokens.issue(input);
  assert.deepEqual(decodeProtectedHeader(token), baseHeader);
  const facts = await tokens.verify(token, now);
  assert.deepEqual(facts, {
    accountId: input.accountId,
    sessionId: input.sessionId,
    installationId: input.installationId,
    issuedAt: seconds * 1000,
    expiresAt: (seconds + 60) * 1000,
  });
  assert.ok(Object.isFrozen(facts));
  assert.equal(
    (await tokens.verify(token, (seconds + 59) * 1000)).sessionId,
    input.sessionId,
  );
  await assert.rejects(
    tokens.verify(token, (seconds + 60) * 1000),
    hasCode('INVALID_ACCESS_TOKEN'),
  );
});

test('real JOSE rejects wrong issuer, audience, algorithm, key, kid and exact token type', async () => {
  const controls = [
    await signed({ iss: 'other-issuer' }),
    await signed({ aud: 'other-api' }),
    await signed({ aud: [policy.audience, 'other-api'] }),
    await signed({}, { ...baseHeader, alg: 'HS384' }, randomBytes(48)),
    await signed({}, baseHeader, nextKey),
    await signed({}, { ...baseHeader, kid: 'untrusted' }),
    await signed({}, { alg: 'HS256', typ: 'JWT' }),
    await signed({}, { ...baseHeader, typ: 'jwt' }),
    await signed({}, { ...baseHeader, typ: 'at+jwt' }),
    await signed({}, { alg: 'HS256', kid: 'old-v1' }),
  ];
  for (const token of controls)
    await assert.rejects(
      tokens.verify(token, now),
      hasCode('INVALID_ACCESS_TOKEN'),
    );
  assert.equal(
    (await tokens.verify(await signed(), now)).accountId,
    input.accountId,
  );
});

test('real JOSE rejects key injection/remote locations, extra headers and malformed signatures', async () => {
  for (const header of [
    { ...baseHeader, jku: 'https://attacker.example/keys' },
    {
      ...baseHeader,
      jwk: { kty: 'oct', k: Buffer.from(key).toString('base64url') },
    },
    { ...baseHeader, x5u: 'https://attacker.example/cert' },
    { ...baseHeader, x5c: ['fake-cert'] },
    { ...baseHeader, extra: 'untrusted' },
    { ...baseHeader, kid: '../old-v1' },
  ])
    await assert.rejects(
      tokens.verify(await signed({}, header), now),
      hasCode('INVALID_ACCESS_TOKEN'),
    );
  const good = await signed();
  const parts = good.split('.');
  const signature = parts[2]!;
  const tampered = `${parts[0]}.${parts[1]}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  for (const bad of [
    '',
    'secret-token',
    good + '.extra',
    good + '=',
    'x'.repeat(4097),
    `${parts[0]}.${parts[1]}.`,
    tampered,
  ])
    await assert.rejects(
      tokens.verify(bad, now),
      hasCode('INVALID_ACCESS_TOKEN'),
    );
});

test('real JOSE enforces claim shape, expiry, lifetime and future-issued bounds', async () => {
  for (const claims of [
    { exp: seconds },
    { exp: seconds - 1 },
    { iat: seconds + 1 },
    { iat: -1 },
    { iat: seconds + 0.5 },
    { exp: seconds + 60.5 },
    { exp: seconds + 901 },
    { iat: seconds - 901 },
    { iat: seconds + 60, exp: seconds + 60 },
    { sub: '' },
    { sid: [] },
    { iid: 2 },
    { sub: 'a'.repeat(129) },
    { sid: '../session' },
    { extra: 'unexpected' },
    { nbf: seconds - 1 },
    { exp: 8640000000001 },
  ])
    await assert.rejects(
      tokens.verify(await signed(claims), now),
      hasCode('INVALID_ACCESS_TOKEN'),
    );
  for (const name of ['sub', 'sid', 'iid', 'iss', 'aud', 'iat', 'exp']) {
    const missing = { ...baseClaims };
    delete missing[name];
    const token = await new SignJWT(missing)
      .setProtectedHeader(baseHeader)
      .sign(key);
    await assert.rejects(
      tokens.verify(token, now),
      hasCode('INVALID_ACCESS_TOKEN'),
    );
  }
  const tolerance = new JoseAccessTokens({
    ...policy,
    maxFutureIssuedSeconds: 2,
  });
  assert.equal(
    (await tolerance.verify(await signed({ iat: seconds + 2 }), now)).issuedAt,
    (seconds + 2) * 1000,
  );
  await assert.rejects(
    tolerance.verify(await signed({ iat: seconds + 3 }), now),
    hasCode('INVALID_ACCESS_TOKEN'),
  );
  await assert.rejects(
    tolerance.verify(await signed({ exp: seconds }), now),
    hasCode('INVALID_ACCESS_TOKEN'),
  );
});

test('real JOSE bounded overlap signs with active key; removal and hard replacement retire old tokens', async () => {
  const overlap = new JoseAccessTokens({
    ...policy,
    activeSigningKeyId: 'new-v2',
    keys: [...policy.keys, { id: 'new-v2', key: nextKey }],
  });
  const retired = new JoseAccessTokens({
    ...policy,
    activeSigningKeyId: 'new-v2',
    keys: [{ id: 'new-v2', key: nextKey }],
  });
  const oldToken = await tokens.issue(input);
  const newToken = await overlap.issue(input);
  assert.equal(decodeProtectedHeader(newToken).kid, 'new-v2');
  assert.equal(
    (await overlap.verify(oldToken, now)).sessionId,
    input.sessionId,
  );
  assert.equal(
    (await overlap.verify(newToken, now)).sessionId,
    input.sessionId,
  );
  await assert.rejects(
    tokens.verify(newToken, now),
    hasCode('INVALID_ACCESS_TOKEN'),
  );
  await assert.rejects(
    retired.verify(oldToken, now),
    hasCode('INVALID_ACCESS_TOKEN'),
  );
  assert.equal(
    (await retired.verify(newToken, now)).sessionId,
    input.sessionId,
  );
  const replacement = new JoseAccessTokens({
    ...policy,
    keys: [{ id: 'old-v1', key: nextKey }],
  });
  await assert.rejects(
    replacement.verify(oldToken, now),
    hasCode('INVALID_ACCESS_TOKEN'),
  );
  assert.equal(
    (await replacement.verify(await replacement.issue(input), now)).sessionId,
    input.sessionId,
  );
});

test('key policy rejects short/weak/aliased keys, unknown active keys and excessive rings', () => {
  for (const bad of [
    { ...policy, keys: [] },
    { ...policy, keys: [{ id: 'old-v1', key: randomBytes(31) }] },
    { ...policy, keys: [{ id: 'old-v1', key: randomBytes(33) }] },
    { ...policy, keys: [{ id: 'old-v1', key: new Uint8Array(32) }] },
    {
      ...policy,
      keys: [
        {
          id: 'old-v1',
          key: Uint8Array.from(
            [...randomBytes(8)].flatMap((x) => [x, x, x, x]),
          ),
        },
      ],
    },
    { ...policy, keys: [policy.keys[0]!, policy.keys[0]!] },
    { ...policy, keys: [...policy.keys, { id: 'alias', key }] },
    { ...policy, activeSigningKeyId: 'missing' },
    { ...policy, issuer: '' },
    { ...policy, audience: 'line\nbreak' },
    { ...policy, maxLifetimeSeconds: 86401 },
    { ...policy, maxLifetimeSeconds: 0 },
    { ...policy, maxFutureIssuedSeconds: 61 },
    { ...policy, maxFutureIssuedSeconds: -1 },
    { ...policy, maxLifetimeSeconds: 1.1 },
    {
      ...policy,
      keys: Array.from({ length: 5 }, (_, i) => ({
        id: `key-${i}`,
        key: generateHs256Key(),
      })),
    },
  ])
    assert.throws(
      () => new JoseAccessTokens(bad),
      hasCode('JWT_POLICY_INVALID'),
    );
});

test('key bytes and policy are snapshotted; caller mutation cannot silently rotate live keys', async () => {
  const mutableKey = generateHs256Key();
  const mutablePolicy = {
    ...policy,
    keys: [{ id: 'old-v1', key: mutableKey }],
  };
  const isolated = new JoseAccessTokens(mutablePolicy);
  const token = await isolated.issue(input);
  mutableKey.fill(0);
  mutablePolicy.issuer = 'changed';
  mutablePolicy.keys.length = 0;
  assert.equal((await isolated.verify(token, now)).accountId, input.accountId);
  assert.ok(Object.isFrozen(isolated.policy));
  assert.ok(Object.isFrozen(isolated.policy.acceptedKeyIds));
});

test('invalid issue inputs and invalid explicit clocks never use an ambient clock', async () => {
  for (const bad of [
    { ...input, accountId: '' },
    { ...input, sessionId: '../bad' },
    { ...input, expiresAt: now },
    { ...input, expiresAt: now + 901000 },
    { ...input, now: NaN },
    { ...input, now: -1 },
    { ...input, now: 1.5 },
    { ...input, expiresAt: Infinity },
  ])
    await assert.rejects(tokens.issue(bad), hasCode('TOKEN_INPUT_INVALID'));
  const token = await tokens.issue(input);
  for (const bad of [NaN, Infinity, -1, 1.1, 8640000000000001])
    await assert.rejects(
      tokens.verify(token, bad),
      hasCode('INVALID_ACCESS_TOKEN'),
    );
});
