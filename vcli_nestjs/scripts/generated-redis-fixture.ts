import { createHash } from 'node:crypto';
import { createClient } from '@redis/client';

type RedisTestUrlKey =
  | 'VCLI_GENERATED_REDIS_TEST_URL'
  | 'VCLI_GENERATED_REDIS_CONTAINER_TEST_URL'
  | 'VCLI_IDENTITY_REDIS_TEST_URL';
type FixtureEnvironment = 'test' | 'development' | 'production';

export function requireGeneratedRedisTestUrl(
  env: NodeJS.ProcessEnv,
  key: RedisTestUrlKey = 'VCLI_GENERATED_REDIS_TEST_URL',
): string {
  const input = env[key];
  if (!input) throw new Error(key + '_REQUIRED');
  const url = URL.parse(input);
  if (
    !url?.hostname ||
    !['redis:', 'rediss:'].includes(url.protocol) ||
    url.hash ||
    input.includes('#') ||
    input.includes('\0') ||
    /\s/u.test(input)
  )
    throw new Error(key + '_INVALID');
  try {
    decodeURIComponent(url.username);
    decodeURIComponent(url.password);
  } catch {
    throw new Error(key + '_INVALID');
  }
  return input;
}

export function redactGeneratedRedisOutput(
  text: string,
  urls: readonly string[],
): string {
  const credentials = new Set<string>();
  for (const value of urls) {
    const url = URL.parse(value);
    for (const credential of [url?.username, url?.password]) {
      if (credential) {
        credentials.add(credential);
        credentials.add(decodeURIComponent(credential));
      }
    }
  }
  const safeUrl = text.replace(
    /rediss?:\/\/[^\s"'<>]+/giu,
    '[REDACTED-REDIS-URL]',
  );
  return [...credentials]
    .sort((a, b) => b.length - a.length)
    .reduce(
      (safe, credential) => safe.replaceAll(credential, '[REDACTED]'),
      safeUrl,
    );
}

export function generatedRedisRatePrefix(
  projectName: string,
  environment: FixtureEnvironment,
): string {
  const namespace = createHash('sha256')
    .update(projectName + ':' + environment)
    .digest('hex');
  return 'vcli:identity-rate:{' + namespace + '}:';
}

function createTestClient(url: string) {
  return createClient({
    url,
    RESP: 2,
    disableClientInfo: true,
    disableOfflineQueue: true,
    socket: { connectTimeout: 1_000, reconnectStrategy: false },
  }).on('error', () => {});
}

type RedisTestClient = ReturnType<typeof createTestClient>;

export async function withGeneratedRedisClient<T>(
  url: string,
  work: (client: RedisTestClient) => Promise<T>,
): Promise<T> {
  let client: RedisTestClient | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const connection = (client = createTestClient(url));
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('GENERATED_REDIS_FIXTURE_DEADLINE')),
        5_000,
      );
    });
    return await Promise.race([
      connection.connect().then(() => work(connection)),
      deadline,
    ]);
  } catch {
    throw new Error('GENERATED_REDIS_FIXTURE_OPERATION_FAILED');
  } finally {
    clearTimeout(timer);
    if (client?.isOpen) client.destroy();
  }
}

/** Clear only the disposable generated application's rate scopes. */
export async function clearGeneratedRedisRates(
  url: string,
  projectName: string,
  environment: FixtureEnvironment,
): Promise<void> {
  const prefix = generatedRedisRatePrefix(projectName, environment);
  await withGeneratedRedisClient(url, async (client) => {
    for await (const keys of client.scanIterator({
      MATCH: prefix + '*',
      COUNT: 128,
    })) {
      if (keys.length) await client.unlink(keys);
    }
  });
}
