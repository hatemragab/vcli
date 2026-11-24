import assert from 'node:assert/strict';
import { test, before } from 'node:test';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { randomUUID } from 'node:crypto';
import type {
  MailMessage,
  MailSubmitter,
} from '../templates/runtime/common/src/core/mail/mail-submitter.js';
import type { HttpMailFetch } from '../templates/runtime/common/src/modules/mail/http-mail-protocol.js';
import {
  httpMailModule,
  maintenanceModule,
  prepareMaintenanceFixture,
} from './maintenance-fixture.ts';

before(prepareMaintenanceFixture);
const credential = 're_HTTP_PRIVATE_SENTINEL_17c7';
const privateBody = 'ACTION_BODY_SENTINEL_98f <img src=x> & "';
const options = {
  from: 'sender@example.invalid',
  apiKey: credential,
  timeoutMs: 500,
  maxConcurrency: 2,
};
const message = (): MailMessage => ({
  operationId: randomUUID(),
  purpose: 'notification',
  to: 'recipient@example.invalid',
  subject: 'Notice',
  text: privateBody,
  html: '<script>untrusted HTML</script>',
});
async function withPeer<T>(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: (url: string) => Promise<T>,
): Promise<T> {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    return await run(`http://127.0.0.1:${address.port}/emails`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
function loopback(url: string): HttpMailFetch {
  return async (input, init) => {
    assert.equal(input, 'https://api.resend.com/emails');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.method, 'POST');
    return fetch(url, init);
  };
}
async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks).toString('utf8');
}

test('HTTP Resend protocol uses fixed TLS boundary, one recipient, canonical escaped rendering and stable idempotency', async () => {
  const { HttpMailService } = await httpMailModule();
  const requests: { headers: IncomingMessage['headers']; body: string }[] = [];
  await withPeer(
    (request, response) => {
      void (async () => {
        requests.push({ headers: request.headers, body: await body(request) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({ id: '12345678-1234-4123-8123-123456789abc' }),
        );
      })();
    },
    async (url) => {
      const sender = new HttpMailService(options, loopback(url));
      try {
        const input = message();
        // Unchanged caller capability; no provider condition in business consumers.
        const consumer = (mail: MailSubmitter) => mail.submit(input);
        assert.deepEqual(await consumer(sender), {
          status: 'accepted',
          reference: input.operationId,
        });
        assert.deepEqual(await consumer(sender), {
          status: 'accepted',
          reference: input.operationId,
        });
        assert.equal(requests.length, 2);
        assert.equal(
          requests[0]!.headers.authorization,
          `Bearer ${credential}`,
        );
        assert.equal(
          requests[0]!.headers['idempotency-key'],
          `vcli-mail/${input.operationId}`,
        );
        assert.equal(
          requests[0]!.headers['idempotency-key'],
          requests[1]!.headers['idempotency-key'],
        );
        assert.equal(requests[0]!.body, requests[1]!.body);
        const parsed = JSON.parse(requests[0]!.body);
        assert.deepEqual(parsed.to, [input.to]);
        assert.equal(parsed.text, input.text);
        assert.ok(parsed.html.includes('&lt;img'));
        assert.ok(!parsed.html.includes('<script>'));
        assert.ok(!requests[0]!.body.includes(credential));
        assert.ok(!JSON.stringify(sender).includes(credential));
      } finally {
        sender.close();
      }
    },
  );
});

test('documented HTTP failures have finite redacted permanent/retryable/unknown translation with no implicit retry', async () => {
  const { HttpMailService } = await httpMailModule();
  let status = 429,
    name = 'rate_limit_exceeded',
    attempts = 0,
    retry = '2.5';
  await withPeer(
    (request, response) => {
      attempts++;
      request.resume();
      response.writeHead(status, {
        'content-type': 'application/json',
        'retry-after': retry,
      });
      response.end(
        JSON.stringify({ name, message: `${credential} ${privateBody}` }),
      );
    },
    async (url) => {
      const sender = new HttpMailService(options, loopback(url));
      try {
        const cases: [number, string, string, string][] = [
          [429, 'rate_limit_exceeded', 'unavailable', 'HTTP_MAIL_RATE_LIMIT'],
          [500, 'application_error', 'unavailable', 'HTTP_MAIL_UNAVAILABLE'],
          [503, 'service_unavailable', 'unavailable', 'HTTP_MAIL_UNAVAILABLE'],
          [502, 'upstream_unknown', 'unknown', 'HTTP_MAIL_ACCEPTANCE_UNKNOWN'],
          [400, 'validation_error', 'rejected', 'HTTP_MAIL_REJECTED'],
          [401, 'missing_api_key', 'rejected', 'HTTP_MAIL_REJECTED'],
          [403, 'validation_error', 'rejected', 'HTTP_MAIL_REJECTED'],
          [422, 'invalid_parameter', 'rejected', 'HTTP_MAIL_REJECTED'],
          [
            409,
            'invalid_idempotent_request',
            'rejected',
            'HTTP_MAIL_IDEMPOTENCY_CONFLICT',
          ],
          [
            409,
            'concurrent_idempotent_requests',
            'unknown',
            'HTTP_MAIL_IDEMPOTENCY_UNKNOWN',
          ],
        ];
        for (const [code, type, expected, expectedCode] of cases) {
          status = code;
          name = type;
          const result = await sender.submit(message());
          assert.equal(result.status, expected);
          assert.ok('code' in result);
          assert.equal(result.code, expectedCode);
          if (code === 429) assert.equal(result.retryAfterMs, 2500);
          assert.ok(!JSON.stringify(result).includes(credential));
          assert.ok(!JSON.stringify(result).includes('ACTION_BODY_SENTINEL'));
        }
        status = 429;
        retry = '999999';
        assert.deepEqual(await sender.submit(message()), {
          status: 'unavailable',
          code: 'HTTP_MAIL_RATE_LIMIT',
          retryAfterMs: 86400000,
        });
        retry = credential;
        assert.deepEqual(await sender.submit(message()), {
          status: 'unavailable',
          code: 'HTTP_MAIL_RATE_LIMIT',
        });
        assert.equal(attempts, cases.length + 2);
      } finally {
        sender.close();
      }
    },
  );
});

test('HTTP timeout after request, oversized response and invalid success receipt remain unknown', async () => {
  const { HttpMailService } = await httpMailModule();
  for (const mode of [
    'timeout',
    'declared-size',
    'stream-size',
    'invalid-receipt',
    'disconnect',
    'redirect',
    'trickle',
  ]) {
    let requests = 0;
    await withPeer(
      (request, response) => {
        requests++;
        request.resume();
        if (mode === 'timeout') return;
        if (mode === 'disconnect') {
          request.socket.destroy();
          return;
        }
        if (mode === 'declared-size') {
          response.writeHead(200, { 'content-length': 999999 });
          response.end('{}');
        } else if (mode === 'stream-size') {
          response.writeHead(200);
          response.write('{"id":"');
          response.end('s'.repeat(20000));
        } else if (mode === 'redirect') {
          response.writeHead(302, {
            location: 'https://example.invalid/steal',
          });
          response.end('{}');
        } else if (mode === 'trickle') {
          response.writeHead(200);
          response.write('{');
          const interval = setInterval(() => response.write(' '), 5);
          response.once('close', () => clearInterval(interval));
        } else {
          response.writeHead(200);
          response.end(JSON.stringify({ id: credential }));
        }
      },
      async (url) => {
        const sender = new HttpMailService(
          { ...options, timeoutMs: 70 },
          loopback(url),
        );
        try {
          const result = await sender.submit(message());
          assert.equal(result.status, 'unknown', mode);
          assert.ok(!JSON.stringify(result).includes(credential));
          assert.equal(requests, 1, mode);
        } finally {
          sender.close();
        }
      },
    );
  }
});

test('bounded HTTP concurrency, body, configuration and close provide positive and negative controls', async () => {
  const { HttpMailService } = await httpMailModule();
  assert.throws(
    () => new HttpMailService({ ...options, apiKey: 'bad\nheader' }),
    /INVALID_HTTP_MAIL_CONFIGURATION/,
  );
  assert.throws(
    () => new HttpMailService({ ...options, timeoutMs: 0 }),
    /INVALID_HTTP_MAIL_CONFIGURATION/,
  );
  assert.throws(
    () => new HttpMailService({ ...options, maxConcurrency: 99 }),
    /INVALID_HTTP_MAIL_CONFIGURATION/,
  );
  let started!: () => void;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  await withPeer(
    (request) => {
      request.resume();
      started();
    },
    async (url) => {
      const sender = new HttpMailService(
        { ...options, timeoutMs: 500, maxConcurrency: 1 },
        loopback(url),
      );
      try {
        const pending = sender.submit(message());
        await requestStarted;
        assert.deepEqual(await sender.submit(message()), {
          status: 'unavailable',
          code: 'MAIL_CONCURRENCY_LIMIT',
          retryAfterMs: 1000,
        });
        sender.close();
        assert.equal((await pending).status, 'unknown');
        assert.deepEqual(await sender.submit(message()), {
          status: 'unavailable',
          code: 'HTTP_MAIL_CLOSED',
        });
      } finally {
        sender.close();
      }
    },
  );
  let calls = 0;
  const bounded = new HttpMailService(options, async () => {
    calls++;
    throw new Error(credential);
  });
  try {
    assert.deepEqual(
      await bounded.submit({ ...message(), text: '&'.repeat(32768) }),
      { status: 'rejected', code: 'HTTP_MAIL_MESSAGE_TOO_LARGE' },
    );
    assert.equal(calls, 0);
  } finally {
    bounded.close();
  }
});

test('selected HTTP renderer preserves immediate/reliable composition and emits no SMTP SDK source', async () => {
  const { mailFiles } = await maintenanceModule<
    typeof import('../src/recipes/render-mail.ts')
  >('recipes/render-mail');
  const config = {
    schemaVersion: 1 as const,
    project: { name: 'http-fixture', packageManager: 'npm' as const },
    capabilities: {
      foundation: { recipe: 'foundation.nest', options: {} },
      mail: {
        recipe: 'mail.http',
        options: { provider: 'resend', reliableActions: false },
      },
    },
  };
  const files = await mailFiles(config);
  assert.ok(files.some(({ path }) => path.endsWith('/http-mail.service.ts')));
  assert.ok(files.some(({ path }) => path.endsWith('/http-mail-protocol.ts')));
  assert.ok(
    !files.some(({ path }) => /smtp|capture|database|intent/.test(path)),
  );
  const module = files.find(({ path }) =>
    path.endsWith('/mail.module.ts'),
  )!.content;
  assert.ok(module.includes('new HttpMailService(config.mail)'));
  assert.match(
    module,
    /dependencies\.sender\?\?\(ownedSender=createMailSender\(config\)\)/,
  );
  assert.ok(module.includes('ownedSender?.close()'));
  const reliable = await mailFiles({
    ...config,
    capabilities: {
      ...config.capabilities,
      database: { recipe: 'database.postgres', options: {} },
      mail: {
        recipe: 'mail.http',
        options: { provider: 'resend', reliableActions: true },
      },
    },
  });
  assert.ok(
    reliable.some(({ path }) => path.endsWith('mail-intent.service.ts')),
  );
  assert.ok(
    reliable
      .find(({ path }) => path.endsWith('mail.module.ts'))!
      .content.includes('new MailIntentService('),
  );
});
