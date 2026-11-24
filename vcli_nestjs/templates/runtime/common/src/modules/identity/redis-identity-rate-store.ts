import { createHash } from 'node:crypto';
import { createClient } from '@redis/client';
import { ApplicationError } from '../../core/errors/application-error.js';

const deadlineMs = 1_000;
// Every scope is charged independently, including when another scope denies the
// request. A saturated counter stays at its limit and expires at the same boundary.
const spendWindow = `
redis.replicate_commands()
local now = redis.call('TIME')
local expires = (math.floor(tonumber(now[1]) / 60) + 1) * 60000
local counts = {}
for i, key in ipairs(KEYS) do
  counts[i] = tonumber(redis.call('GET', key) or '0')
  if not counts[i] or counts[i] < 0 or counts[i] % 1 ~= 0 then
    return redis.error_reply('Invalid identity rate counter')
  end
end
local allowed = 1
for i, key in ipairs(KEYS) do
  if counts[i] >= tonumber(ARGV[i]) then
    allowed = 0
  else
    redis.call('SET', key, counts[i] + 1, 'PXAT', expires)
  end
end
return allowed
`;

function createRateClient(url: string) {
  const client = createClient({
    url,
    RESP: 2,
    disableClientInfo: true,
    disableOfflineQueue: true,
    commandsQueueMaxLength: 256,
    socket: { connectTimeout: deadlineMs, reconnectStrategy: false },
  });
  // Transport errors may contain connection details. The request reports a
  // stable 503, and the next request can open a fresh connection.
  client.on('error', () => {});
  return client;
}

type Client = ReturnType<typeof createRateClient>;
type Connection = Readonly<{ client: Client; ready: Promise<Client> }>;
type RateEntries = readonly Readonly<{ key: string; limit: number }>[];

export class RedisIdentityRateStore {
  private readonly namespace: string;
  private connection?: Connection;
  private closed = false;

  constructor(
    private readonly url: string,
    namespace: string,
  ) {
    const scope = createHash('sha256').update(namespace).digest('hex');
    this.namespace = 'vcli:identity-rate:{' + scope + '}:';
  }

  async spend(entries: RateEntries): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    let result: unknown;
    try {
      if (entries.length < 1 || entries.length > 2)
        throw new Error('Invalid number of identity rate scopes');
      const { client, ready } = this.connect();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          this.disconnect(client);
          reject(new Error('Identity rate deadline exceeded'));
        }, deadlineMs);
      });
      result = await Promise.race([
        ready.then(() =>
          client.eval(spendWindow, {
            keys: entries.map(({ key }) => this.namespace + key),
            arguments: entries.map(({ limit }) => String(limit)),
          }),
        ),
        timeout,
      ]);
    } catch {
      throw new ApplicationError('IDENTITY_RATE_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
    }
    if (result === 0) throw new ApplicationError('RATE_LIMITED', 429);
    if (result !== 1)
      throw new ApplicationError('IDENTITY_RATE_UNAVAILABLE', 503);
  }

  close(): void {
    this.closed = true;
    if (this.connection) this.disconnect(this.connection.client);
  }

  private connect(): Connection {
    if (this.closed) throw new Error('Identity rate store is closed');
    if (this.connection?.client.isOpen) return this.connection;
    const client = createRateClient(this.url);
    return (this.connection = { client, ready: client.connect() });
  }

  private disconnect(client: Client): void {
    if (this.connection?.client !== client) return;
    this.connection = undefined;
    if (client.isOpen) client.destroy();
  }
}
