import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import {
  clearGeneratedRedisRates,
  generatedRedisRatePrefix,
  redactGeneratedRedisOutput,
  requireGeneratedRedisTestUrl,
  withGeneratedRedisClient,
} from '../scripts/generated-redis-fixture.ts';

test('generated gates consume explicit private Redis fixture settings', () => {
  assert.throws(
    () => requireGeneratedRedisTestUrl({ REDIS_URL: 'redis://localhost' }),
    /^Error: VCLI_GENERATED_REDIS_TEST_URL_REQUIRED$/,
  );
  const host = 'redis://127.0.0.1:6380/2';
  const container = 'rediss://redis.fixture.invalid:6381/2';
  const env = {
    VCLI_GENERATED_REDIS_TEST_URL: host,
    VCLI_GENERATED_REDIS_CONTAINER_TEST_URL: container,
    VCLI_IDENTITY_REDIS_TEST_URL: host,
  };
  assert.equal(requireGeneratedRedisTestUrl(env), host);
  assert.equal(
    requireGeneratedRedisTestUrl(env, 'VCLI_IDENTITY_REDIS_TEST_URL'),
    host,
  );
  assert.equal(
    requireGeneratedRedisTestUrl(
      env,
      'VCLI_GENERATED_REDIS_CONTAINER_TEST_URL',
    ),
    container,
  );
  for (const input of [
    'https://PRIVATE_SENTINEL',
    'redis:///2',
    'redis://:PRIVATE_SENTINEL%ZZ@localhost',
    'redis://localhost#PRIVATE_SENTINEL',
    'redis://localhost\nPRIVATE_SENTINEL',
  ]) {
    assert.throws(
      () =>
        requireGeneratedRedisTestUrl({ VCLI_GENERATED_REDIS_TEST_URL: input }),
      /^Error: VCLI_GENERATED_REDIS_TEST_URL_INVALID$/,
    );
  }
});

test('generated gate logs redact both Redis endpoint URLs and credential forms', () => {
  const host = 'redis://fixture-user:Synthetic%40password@localhost:6380/2';
  const container =
    'rediss://container-user:Another%40password@redis.fixture.invalid:6381/2';
  const safe = redactGeneratedRedisOutput(
    [
      'VCLI_ACCEPTANCE {"ok":true}',
      host,
      container,
      'fixture-user Synthetic%40password Synthetic@password',
      'container-user Another%40password Another@password',
    ].join('\n'),
    [host, container],
  );
  assert.ok(safe.includes('VCLI_ACCEPTANCE {"ok":true}'));
  assert.doesNotMatch(
    safe,
    /redis:\/\/|rediss:\/\/|fixture-user|container-user|password/,
  );
});

test('generated Redis client failures report a stable code', async () => {
  await assert.rejects(
    withGeneratedRedisClient('https://PRIVATE_SENTINEL', async () => true),
    { message: 'GENERATED_REDIS_FIXTURE_OPERATION_FAILED' },
  );
});

test(
  'native generated Redis setup clears only counters for the exact project and environment',
  { skip: !process.env.VCLI_GENERATED_REDIS_TEST_URL },
  async () => {
    const url = requireGeneratedRedisTestUrl(process.env);
    const project = 'gate-test-' + randomUUID();
    const prefix = generatedRedisRatePrefix(project, 'test');
    const counters = Array.from(
      { length: 300 },
      (_, index) => prefix + 'rate-' + index,
    );
    const untouched = [
      generatedRedisRatePrefix(project, 'production') + 'rate',
      generatedRedisRatePrefix(project + '-other', 'test') + 'rate',
      prefix.slice(0, -1) + '-different:rate',
    ];
    const all = [...counters, ...untouched];
    await withGeneratedRedisClient(url, async (client) => {
      await client.mSet(Object.fromEntries(all.map((key) => [key, '1'])));
    });
    try {
      await clearGeneratedRedisRates(url, project, 'test');
      await clearGeneratedRedisRates(url, project, 'test');
      const actual = await withGeneratedRedisClient(url, (client) =>
        client.mGet(all),
      );
      assert.deepEqual(
        actual.slice(0, counters.length),
        counters.map(() => null),
      );
      assert.deepEqual(actual.slice(counters.length), ['1', '1', '1']);
    } finally {
      await withGeneratedRedisClient(url, (client) => client.unlink(all));
    }
  },
);
