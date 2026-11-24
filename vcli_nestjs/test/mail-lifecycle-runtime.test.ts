import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type Socket } from 'node:net';
import { randomBytes, randomUUID } from 'node:crypto';
import type {
  MailMessage,
  MailOutcome,
} from '../templates/runtime/common/src/core/mail/mail-submitter.js';
import type { FirebaseActionPolicy } from '../templates/runtime/common/src/modules/mail/firebase-action-policy.js';

// Worker-owned isolated compilation; no installs, root dist, shared services or network.
const fixture = resolve('var/cli-mail-lifecycle');
async function runtime<T>(path: string, driver = 'postgres'): Promise<T> {
  return (await import(
    pathToFileURL(`${fixture}/${driver}/dist/${path}.js`).href
  )) as T;
}
// Expected consumer contracts. Actual runtime/SDK types are checked by each native fixture compiler.
type TransactionContext = Readonly<object>;
type Prepared = {
  operationId: string;
  purpose: MailMessage['purpose'];
  expiresAt: number;
  keyId: string;
  payload: string;
};
type Status =
  | 'pending'
  | 'retry'
  | 'dispatching'
  | 'unknown'
  | 'accepted'
  | 'rejected'
  | 'expired';
type MailIntent = {
  id: string;
  purpose: MailMessage['purpose'];
  expiresAt: number;
  keyId: string;
  payload: string | null;
  contentTag: string;
  status: Status;
  attempts: number;
  fence: number;
  leaseUntil: number;
  nextAttemptAt: number;
  updatedAt: number;
};
type Summary = Pick<
  MailIntent,
  'id' | 'status' | 'attempts' | 'fence' | 'expiresAt'
>;
type MailIntentPersistence = {
  stage(p: Prepared, context: TransactionContext): Promise<void>;
  claim(now: number, lease: number, max: number): Promise<MailIntent | null>;
  complete(
    id: string,
    fence: number,
    now: number,
    result: {
      status: 'retry' | 'unknown' | 'accepted' | 'rejected';
      nextAttemptAt: number;
    },
  ): Promise<boolean>;
  reconcile(
    id: string,
    fence: number,
    now: number,
    decision: 'accepted' | 'retry' | 'rejected',
    maxAttempts?: number,
  ): Promise<boolean>;
  maintain(now: number, limit: number): Promise<void>;
  list(limit: number): Promise<Summary[]>;
};
type TemplateInput = {
  operationId: string;
  to: string;
  template: 'verification' | 'password-reset';
  version: 1;
  locale: 'en';
  variables: { actionUrl: string; applicationName: string };
};
type Rendering = {
  renderMessage(m: MailMessage): MailMessage;
  approvedActionUrl(value: string, origin: string): string;
  renderActionTemplate(input: TemplateInput, origin: string): MailMessage;
};
type CaptureBuffer = {
  entries: { capturedAt: number; message: MailMessage }[];
  bytes: number;
};
type Capture = {
  CaptureMailService: new (
    max: number,
    now: () => number,
    buffer?: CaptureBuffer,
    retention?: number,
    environment?: string,
  ) => { submit(m: MailMessage): Promise<MailOutcome> };
  pruneCapture(buffer: CaptureBuffer, now: number, retention?: number): void;
};
type Sender = { submit(m: MailMessage): Promise<MailOutcome> };
type Smtp = {
  SmtpMailService: new (
    options: {
      from: string;
      host: string;
      port: number;
      secure: boolean;
      timeoutMs?: number;
      maxConcurrency?: number;
    },
    production: boolean,
  ) => Sender & { close(): void };
  translateSmtpError(error: unknown): MailOutcome;
};
type PayloadCipher = {
  encrypt(message: MailMessage, expiresAt: number): Prepared;
  decrypt(p: Prepared): MailMessage;
};
type Cipher = {
  MailPayloadCipher: new (
    active: string,
    keys: Record<string, string>,
  ) => PayloadCipher;
};
type IntentService = {
  prepare(m: MailMessage, expiry: number): Prepared;
  stage(p: Prepared, context: TransactionContext): Promise<void>;
  drain(limit?: number): Promise<{ processed: number }>;
  list(limit?: number): Promise<Summary[]>;
  reconcile(
    id: string,
    fence: number,
    decision: 'accepted' | 'retry' | 'rejected',
  ): Promise<boolean>;
};
type Delivery = {
  MailIntentService: new (
    store: MailIntentPersistence,
    cipher: PayloadCipher,
    sender: Sender,
    options: { maxAttempts: number; leaseMs: number; maxLifetimeMs: number },
    now?: () => number,
  ) => IntentService;
};
type Policy = {
  firebaseActionSettings(
    policy: FirebaseActionPolicy,
    purpose: 'verification' | 'password-reset',
    url: string,
  ): { linkDomain?: string };
  classifyFirebaseActionError(error: unknown): string;
  publicEmailActionResponse(): { accepted: true };
};
type LinkPreparation =
  | { status: 'prepared'; message: MailMessage }
  | { status: 'suppressed' | 'unavailable' | 'configuration' };
type Links = {
  FirebaseActionLinksService: new (
    auth: {
      generateEmailVerificationLink(email: string): Promise<string>;
      generatePasswordResetLink(email: string): Promise<string>;
    },
    policy: FirebaseActionPolicy,
    name: string,
  ) => {
    prepare(input: {
      operationId: string;
      to: string;
      purpose: 'verification' | 'password-reset';
      continueUrl: string;
    }): Promise<LinkPreparation>;
  };
};
before(async () => {
  for (const driver of ['mongodb', 'postgres']) {
    const root = `${fixture}/${driver}`;
    await mkdir(`${root}/src/core/errors`, { recursive: true });
    await cp(
      'templates/runtime/common/src/core/errors/application-error.ts',
      `${root}/src/core/errors/application-error.ts`,
    );
    for (const sub of ['core/mail', 'modules/mail'])
      await cp(`templates/runtime/common/src/${sub}`, `${root}/src/${sub}`, {
        recursive: true,
      });
    for (const sub of ['core/database', 'modules/mail'])
      await cp(`templates/runtime/${driver}/src/${sub}`, `${root}/src/${sub}`, {
        recursive: true,
      });
    const modules = resolve(
      `examples/reference-api${driver === 'postgres' ? '-postgres' : ''}/node_modules`,
    );
    try {
      await symlink(modules, `${root}/node_modules`, 'dir');
    } catch (error: unknown) {
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'EEXIST'
      )
        throw error;
    }
    await writeFile(`${root}/package.json`, JSON.stringify({ type: 'module' }));
    await writeFile(
      `${root}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
          outDir: 'dist',
          rootDir: 'src',
          noUncheckedIndexedAccess: true,
          types: ['node'],
        },
        include: ['src/**/*.ts'],
        exclude: ['src/core/database/database.ts'],
      }),
    );
    const result = spawnSync(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '-p', `${root}/tsconfig.json`],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
});
const message = (id: string = randomUUID()): MailMessage => ({
  operationId: id,
  to: 'owner@example.invalid',
  purpose: 'verification',
  subject: 'Verify email',
  text: 'https://app.example.invalid/verify?token=secret',
});

test('versioned templates escape hostile variables and reject unsupported assets/locales/variables', async () => {
  const { renderActionTemplate, renderMessage, approvedActionUrl } =
    await runtime<Rendering>('modules/mail/render-message');
  const input = {
    operationId: 'template-1',
    to: 'owner@example.invalid',
    template: 'verification' as const,
    version: 1 as const,
    locale: 'en' as const,
    variables: {
      applicationName: '<script>&"\'test',
      actionUrl: 'https://app.example.invalid/verify?t=%3Cscript%3E',
    },
  };
  const rendered = renderActionTemplate(input, 'https://app.example.invalid');
  assert.ok(rendered.text.includes('<script>'));
  assert.ok(rendered.html?.includes('&lt;script&gt;&amp;&quot;&#39;test'));
  assert.ok(!rendered.html?.includes('<script>'));
  assert.ok(
    !renderMessage({
      ...message(),
      html: '<img onerror="evil()">',
    }).html?.includes('<img'),
  );
  for (const patch of [
    { template: '../../private' },
    { version: 2 },
    { locale: 'ar' },
    { variables: { ...input.variables, file: '/private' } },
  ])
    assert.throws(() =>
      renderActionTemplate(
        { ...input, ...patch } as typeof input,
        'https://app.example.invalid',
      ),
    );
  for (const url of [
    'https://evil.invalid/',
    'https://u:p@app.example.invalid/',
    'javascript:evil()',
    '//app.example.invalid',
    'http://app.example.invalid',
  ])
    assert.throws(() => approvedActionUrl(url, 'https://app.example.invalid'));
  assert.throws(() =>
    renderMessage({ ...message(), to: 'a@example.invalid,b@example.invalid' }),
  );
  assert.throws(() =>
    renderMessage({ ...message(), to: 'a\0b@example.invalid' }),
  );
  assert.throws(() =>
    renderMessage({ ...message(), subject: 'hello\r\nBcc: bad' }),
  );
});

test('private capture validates direct constructors and enforces count, bytes, retention, production denial', async () => {
  const { CaptureMailService, pruneCapture } = await runtime<Capture>(
    'modules/mail/capture-mail.service',
  );
  for (const maximum of [0, -1, 1001, Infinity, 1.2])
    assert.throws(() => new CaptureMailService(maximum, Date.now));
  assert.throws(
    () => new CaptureMailService(1, Date.now, undefined, 1000, 'production'),
  );
  let now = 1000;
  const buffer: CaptureBuffer = { entries: [], bytes: 0 };
  const capture = new CaptureMailService(1, () => now, buffer, 1000);
  assert.equal((await capture.submit(message('first'))).status, 'captured');
  await capture.submit(message('second'));
  assert.equal(buffer.entries.length, 1);
  assert.equal(buffer.entries[0]!.message.operationId, 'second');
  now += 1000;
  pruneCapture(buffer, now, 1000);
  assert.equal(buffer.entries.length, 0);
  assert.equal(buffer.bytes, 0);
  const many: CaptureBuffer = { entries: [], bytes: 0 },
    bounded = new CaptureMailService(1000, () => now, many);
  for (let i = 0; i < 80; i++)
    await bounded.submit({ ...message(`bytes-${i}`), text: 'x'.repeat(32768) });
  assert.ok(many.bytes <= 1048576);
  assert.ok(many.entries.length < 80);
});

type PeerMode =
  | 'accept'
  | 'rcpt450'
  | 'rcpt550'
  | 'data450'
  | 'data550'
  | 'stall'
  | 'drop'
  | 'trickle';
async function smtpPeer(
  mode: PeerMode,
  run: (port: number, bodies: string[]) => Promise<void>,
) {
  const sockets = new Set<Socket>(),
    bodies: string[] = [];
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.write('220 controlled-loopback SMTP\r\n');
    let buffer = '',
      data = false,
      body = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      while (buffer.includes('\r\n')) {
        const end = buffer.indexOf('\r\n'),
          line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line !== '.') {
            body += line + '\r\n';
            continue;
          }
          data = false;
          bodies.push(body);
          if (mode === 'stall') continue;
          if (mode === 'trickle') {
            socket.write('250-');
            const timer = setInterval(() => socket.write('waiting'), 20);
            socket.once('close', () => clearInterval(timer));
            continue;
          }
          if (mode === 'drop') {
            socket.destroy();
            continue;
          }
          socket.write(
            mode === 'data450'
              ? '450 4.3.0 transient\r\n'
              : mode === 'data550'
                ? '550 5.7.0 rejected\r\n'
                : '250 2.0.0 accepted\r\n',
          );
        } else if (/^EHLO/.test(line))
          socket.write('250-controlled-loopback\r\n250 SIZE 1048576\r\n');
        else if (/^MAIL FROM/.test(line)) socket.write('250 sender ok\r\n');
        else if (/^RCPT TO/.test(line))
          socket.write(
            mode === 'rcpt450'
              ? '450 4.2.0 retry\r\n'
              : mode === 'rcpt550'
                ? '550 5.1.1 rejected\r\n'
                : '250 recipient ok\r\n',
          );
        else if (line === 'DATA') {
          data = true;
          socket.write('354 end with dot\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  try {
    await new Promise<void>((yes, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', yes);
    });
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    await run(address.port, bodies);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((yes) => server.close(() => yes()));
  }
}
for (const [mode, expected] of Object.entries({
  accept: 'accepted',
  rcpt450: 'unavailable',
  rcpt550: 'rejected',
  data450: 'unavailable',
  data550: 'rejected',
  stall: 'unknown',
  drop: 'unknown',
  trickle: 'unknown',
})) {
  test(`real loopback SMTP ${mode} maps to ${expected}`, async () => {
    const { SmtpMailService } = await runtime<Smtp>(
      'modules/mail/smtp-mail.service',
    );
    await smtpPeer(mode as PeerMode, async (port, bodies) => {
      const sender = new SmtpMailService(
        {
          from: 'sender@example.invalid',
          host: '127.0.0.1',
          port,
          secure: false,
          timeoutMs: 150,
        },
        false,
      );
      try {
        const result = await sender.submit(message());
        assert.equal(result.status, expected);
        assert.ok(!JSON.stringify(result).includes('owner@example.invalid'));
        if (['accept', 'drop', 'stall', 'trickle'].includes(mode))
          assert.equal(bodies.length, 1);
      } finally {
        sender.close();
      }
    });
  });
}

test('SMTP rejects multi-recipient envelopes, preserves accepted recipient and bounds concurrent submissions', async () => {
  const { SmtpMailService, translateSmtpError } = await runtime<Smtp>(
    'modules/mail/smtp-mail.service',
  );
  assert.equal(
    translateSmtpError({
      responseCode: 451,
      response: 'Retry-After: 99999 private',
    }).status,
    'unavailable',
  );
  assert.ok(!('retryAfterMs' in translateSmtpError({ responseCode: 451 })));
  assert.throws(
    () =>
      new SmtpMailService(
        { from: 'bad', host: 'localhost', port: 25, secure: false },
        false,
      ),
  );
  await smtpPeer('stall', async (port) => {
    const sender = new SmtpMailService(
      {
        from: 'sender@example.invalid',
        host: '127.0.0.1',
        port,
        secure: false,
        timeoutMs: 150,
        maxConcurrency: 1,
      },
      false,
    );
    try {
      const first = sender.submit(message('one'));
      assert.equal((await sender.submit(message('two'))).status, 'unavailable');
      await assert.rejects(
        sender.submit({
          ...message(),
          to: 'a@example.invalid,b@example.invalid',
        }),
      );
      assert.equal((await first).status, 'unknown');
    } finally {
      sender.close();
    }
  });
  // Separate recipient submissions never collapse a partially accepted group into a retryable batch.
  const results: MailOutcome[] = [];
  for (const mode of ['accept', 'rcpt550'] as const)
    await smtpPeer(mode, async (port) => {
      const sender = new SmtpMailService(
        {
          from: 'sender@example.invalid',
          host: '127.0.0.1',
          port,
          secure: false,
        },
        false,
      );
      try {
        results.push(await sender.submit(message()));
      } finally {
        sender.close();
      }
    });
  assert.deepEqual(
    results.map((r) => r.status),
    ['accepted', 'rejected'],
  );
});

test('Firebase policy fakes enforce purpose, redirects, custom Hosting and enumeration-safe mappings', async () => {
  const {
    firebaseActionSettings,
    classifyFirebaseActionError,
    publicEmailActionResponse,
  } = await runtime<Policy>('modules/mail/firebase-action-policy');
  const { FirebaseActionLinksService } = await runtime<Links>(
    'modules/mail/firebase-action-links.service',
  );
  const policy: FirebaseActionPolicy = {
    continueOrigins: ['https://app.example.invalid'],
    linkDomain: 'links.example.invalid',
  };
  assert.equal(
    firebaseActionSettings(
      policy,
      'verification',
      'https://app.example.invalid/done',
    ).linkDomain,
    'links.example.invalid',
  );
  for (const linkDomain of [
    'project.web.app',
    'project.firebaseapp.com',
    'https://bad.invalid',
    'bad/path',
  ])
    assert.throws(() =>
      firebaseActionSettings(
        { ...policy, linkDomain },
        'verification',
        'https://app.example.invalid/',
      ),
    );
  for (const url of [
    'https://app.example.invalid.evil.invalid/',
    'https://user@app.example.invalid/',
    'http://app.example.invalid/',
    'javascript:evil()',
  ])
    assert.throws(() => firebaseActionSettings(policy, 'password-reset', url));
  const calls: string[] = [];
  const provider = {
    async generateEmailVerificationLink(email: string) {
      calls.push(email);
      return 'https://project.firebaseapp.com/__/auth/action?mode=verifyEmail&oobCode=private';
    },
    async generatePasswordResetLink() {
      return 'https://project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=private';
    },
  };
  const helper = new FirebaseActionLinksService(
    provider,
    policy,
    'Application',
  );
  const result = await helper.prepare({
    operationId: 'action-1',
    to: 'user@example.invalid',
    purpose: 'verification',
    continueUrl: 'https://app.example.invalid/done',
  });
  assert.equal(result.status, 'prepared');
  assert.equal(calls.length, 1);
  assert.equal(
    (
      await helper.prepare({
        operationId: 'reset-1',
        to: 'user@example.invalid',
        purpose: 'password-reset',
        continueUrl: 'https://app.example.invalid/done',
      })
    ).status,
    'prepared',
  );
  for (const code of [
    'auth/user-not-found',
    'auth/user-disabled',
    'auth/invalid-email',
  ])
    assert.equal(classifyFirebaseActionError({ code }), 'suppressed');
  assert.equal(
    classifyFirebaseActionError({ code: 'auth/unauthorized-continue-uri' }),
    'configuration',
  );
  assert.equal(
    classifyFirebaseActionError(new Error('private provider detail')),
    'unavailable',
  );
  assert.deepEqual(publicEmailActionResponse(), { accepted: true });
  const wrongPurpose = new FirebaseActionLinksService(
    {
      ...provider,
      async generateEmailVerificationLink() {
        return 'https://project.firebaseapp.com/__/auth/action?mode=resetPassword&oobCode=secret';
      },
    },
    policy,
    'App',
  );
  assert.equal(
    (
      await wrongPurpose.prepare({
        operationId: 'wrong-1',
        to: 'user@example.invalid',
        purpose: 'verification',
        continueUrl: 'https://app.example.invalid/',
      })
    ).status,
    'configuration',
  );
});

function controlledStore() {
  const rows = new Map<string, MailIntent>();
  const context = Object.freeze({}) as TransactionContext;
  const store: MailIntentPersistence = {
    async stage(input, supplied) {
      assert.equal(supplied, context);
      if (rows.has(input.operationId)) {
        assert.equal(rows.get(input.operationId)!.payload, input.payload);
        return;
      }
      rows.set(input.operationId, {
        id: input.operationId,
        purpose: input.purpose,
        expiresAt: input.expiresAt,
        keyId: input.keyId,
        payload: input.payload,
        contentTag: 'controlled',
        status: 'pending',
        attempts: 0,
        fence: 0,
        leaseUntil: 0,
        nextAttemptAt: 0,
        updatedAt: 0,
      });
    },
    async claim(now, lease, max) {
      const row = [...rows.values()].find(
        (r) =>
          ['pending', 'retry'].includes(r.status) &&
          r.nextAttemptAt <= now &&
          r.expiresAt > now &&
          r.attempts < max,
      );
      if (!row) return null;
      row.status = 'dispatching';
      row.fence++;
      row.attempts++;
      row.leaseUntil = now + lease;
      return structuredClone(row);
    },
    async complete(id, fence, now, result) {
      const row = rows.get(id);
      if (
        !row ||
        row.fence !== fence ||
        row.status !== 'dispatching' ||
        row.leaseUntil <= now ||
        row.expiresAt <= now
      )
        return false;
      row.status = result.status;
      row.nextAttemptAt = result.nextAttemptAt;
      if (['accepted', 'rejected'].includes(result.status)) row.payload = null;
      return true;
    },
    async reconcile(id, fence, now, decision, maxAttempts = 10) {
      const row = rows.get(id);
      if (
        !row ||
        row.status !== 'unknown' ||
        row.fence !== fence ||
        row.expiresAt <= now ||
        (decision === 'retry' && row.attempts >= maxAttempts)
      )
        return false;
      row.status = decision;
      row.fence++;
      row.nextAttemptAt = now;
      if (decision !== 'retry') row.payload = null;
      return true;
    },
    async maintain(now) {
      for (const row of rows.values()) {
        if (row.expiresAt <= now) {
          row.status = 'expired';
          row.payload = null;
          row.fence++;
        } else if (row.status === 'dispatching' && row.leaseUntil <= now) {
          row.status = 'unknown';
          row.fence++;
        }
      }
    },
    async list(limit) {
      return [...rows.values()]
        .slice(0, limit)
        .map(({ id, status, attempts, fence, expiresAt }) => ({
          id,
          status,
          attempts,
          fence,
          expiresAt,
        }));
    },
  };
  return { store, rows, context };
}

test('encrypted intent controlled persistence: same payload retries, retry-after, bounds, unknown and retention', async () => {
  const { MailPayloadCipher } = await runtime<Cipher>(
    'modules/mail/mail-payload-cipher',
  );
  const { MailIntentService } = await runtime<Delivery>(
    'modules/mail/mail-intent.service',
  );
  const key = randomBytes(32).toString('base64'),
    cipher = new MailPayloadCipher('k1', { k1: key });
  assert.throws(() => new MailPayloadCipher('missing', { k1: key }));
  assert.throws(() => new MailPayloadCipher('k1', { k1: 'short' }));
  const { store, rows, context } = controlledStore();
  let now = 1000;
  const submitted: MailMessage[] = [];
  const outcomes: MailOutcome[] = [
    { status: 'unavailable', code: 'RATE_LIMITED', retryAfterMs: 5000 },
    { status: 'accepted', reference: 'safe' },
  ];
  const service = new MailIntentService(
    store,
    cipher,
    {
      async submit(value) {
        submitted.push(value);
        return outcomes.shift()!;
      },
    },
    { maxAttempts: 3, leaseMs: 30000, maxLifetimeMs: 60000 },
    () => now,
  );
  const prepared = service.prepare(message('encrypted-1'), now + 60000);
  assert.ok(!JSON.stringify(prepared).includes('secret'));
  assert.ok(!JSON.stringify(prepared).includes('owner@'));
  assert.deepEqual(cipher.decrypt(prepared).text, message().text);
  assert.throws(() => cipher.decrypt({ ...prepared, operationId: 'tampered' }));
  assert.throws(() =>
    cipher.decrypt({ ...prepared, expiresAt: prepared.expiresAt + 1 }),
  );
  assert.throws(() =>
    cipher.decrypt({
      ...prepared,
      payload: prepared.payload.slice(0, -4) + 'AAAA',
    }),
  );
  await service.stage(prepared, context);
  await service.stage(prepared, context);
  await service.drain();
  assert.equal(submitted.length, 1);
  await service.drain();
  assert.equal(submitted.length, 1);
  now += 5000;
  await service.drain();
  assert.equal(submitted.length, 2);
  assert.deepEqual(submitted[0], submitted[1]);
  assert.equal(rows.get(prepared.operationId)!.payload, null);
  assert.ok(!JSON.stringify(await service.list()).includes('secret'));
  const unknown = new MailIntentService(
    store,
    cipher,
    {
      async submit() {
        return { status: 'unknown', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
      },
    },
    { maxAttempts: 2, leaseMs: 30000, maxLifetimeMs: 60000 },
    () => now,
  );
  const uncertain = unknown.prepare(message('uncertain'), now + 60000);
  await unknown.stage(uncertain, context);
  await unknown.drain();
  assert.equal(rows.get('uncertain')!.status, 'unknown');
  assert.deepEqual(await unknown.drain(), { processed: 0 });
  assert.equal(await unknown.reconcile('uncertain', 99, 'retry'), false);
  assert.equal(
    await unknown.reconcile('uncertain', rows.get('uncertain')!.fence, 'retry'),
    true,
  );
  await unknown.drain();
  assert.equal(rows.get('uncertain')!.attempts, 2);
  assert.equal(
    await unknown.reconcile('uncertain', rows.get('uncertain')!.fence, 'retry'),
    false,
  );
  now += 60000;
  await unknown.drain();
  assert.equal(rows.get('uncertain')!.payload, null);
  await assert.rejects(service.drain(101));
});

test('controlled lease interruption fences stale completion and never automatically resends', async () => {
  const { store, rows, context } = controlledStore();
  await store.stage(
    {
      operationId: 'interrupted',
      purpose: 'verification',
      expiresAt: 100000,
      keyId: 'k',
      payload: 'encrypted',
    },
    context,
  );
  const claim = await store.claim(1000, 1000, 3);
  assert.ok(claim);
  await store.maintain(2001, 100);
  assert.equal(rows.get('interrupted')!.status, 'unknown');
  assert.equal(
    await store.complete('interrupted', claim.fence, 2001, {
      status: 'accepted',
      nextAttemptAt: 0,
    }),
    false,
  );
  assert.equal(await store.claim(2001, 1000, 3), null);
});

// Root runs these serially against dedicated disposable databases. Default worker run skips them.
// TEST_DATABASE_URL is never printed. Native schema calls are explicit, never startup migrations.
type NativeDatabase = {
  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
for (const driver of ['mongodb', 'postgres'])
  test(
    `native ${driver} atomic staging, claims, crash leases and stale fences`,
    {
      skip:
        process.env.VCLI_MAIL_DATABASE !== driver ||
        !process.env.TEST_DATABASE_URL,
    },
    async () => {
      const name = driver === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase';
      const databaseModule = await runtime<
        Record<
          string,
          {
            connect(url: string, initialized: boolean): Promise<NativeDatabase>;
          }
        >
      >(
        `core/database/${driver === 'mongodb' ? 'mongo' : 'postgres'}-database`,
        driver,
      );
      const database = await databaseModule[name]!.connect(
        process.env.TEST_DATABASE_URL!,
        false,
      );
      const { MailIntentStore } = await runtime<{
        MailIntentStore: new (db: NativeDatabase) => MailIntentPersistence;
      }>('modules/mail/mail-intent-store', driver);
      const { initializeMail } = await runtime<{
        initializeMail(db: NativeDatabase): Promise<void>;
      }>('modules/mail/initialize-mail', driver);
      const { MailPayloadCipher } = await runtime<Cipher>(
        'modules/mail/mail-payload-cipher',
        driver,
      );
      const { MailIntentService } = await runtime<Delivery>(
        'modules/mail/mail-intent.service',
        driver,
      );
      try {
        await initializeMail(database);
        const store = new MailIntentStore(database),
          cipher = new MailPayloadCipher('native-test', {
            'native-test': randomBytes(32).toString('base64'),
          });
        const now = Date.now(),
          service = new MailIntentService(
            store,
            cipher,
            {
              async submit() {
                return { status: 'accepted', reference: 'safe' };
              },
            },
            { maxAttempts: 3, leaseMs: 1000, maxLifetimeMs: 60000 },
          );
        const rollback = service.prepare(
          message(`rollback-${randomUUID()}`),
          now + 60000,
        );
        await assert.rejects(
          database.run(async (context) => {
            await service.stage(rollback, context);
            throw new Error('controlled rollback');
          }),
        );
        assert.ok(
          !(await store.list(100)).some((r) => r.id === rollback.operationId),
        );
        const prepared = service.prepare(
          message(`native-${randomUUID()}`),
          now + 60000,
        );
        await database.run(async (context) => {
          await service.stage(prepared, context);
        });
        await Promise.all(
          Array.from({ length: 4 }, () =>
            database.run((context) => service.stage(prepared, context)),
          ),
        );
        const different = service.prepare(
          message(prepared.operationId),
          now + 60000,
        );
        await assert.rejects(
          database.run((context) => service.stage(different, context)),
        );
        const claims = await Promise.all(
          Array.from({ length: 8 }, () => store.claim(now, 1000, 3)),
        );
        const ours = claims.filter(
          (claim) => claim?.id === prepared.operationId,
        );
        assert.equal(ours.length, 1);
        const claim = ours[0]!;
        // Simulate process interruption after external send and before recording its outcome.
        await store.maintain(now + 1001, 100);
        const row = (await store.list(100)).find(
          (r) => r.id === prepared.operationId,
        )!;
        assert.equal(row.status, 'unknown');
        assert.equal(
          await store.complete(row.id, claim.fence, now + 1001, {
            status: 'accepted',
            nextAttemptAt: 0,
          }),
          false,
        );
        const otherClaims = await Promise.all(
          Array.from({ length: 3 }, () => store.claim(now + 1001, 1000, 3)),
        );
        assert.ok(!otherClaims.some((r) => r?.id === row.id));
        assert.equal(
          await store.reconcile(row.id, claim.fence, now + 1001, 'retry'),
          false,
        );
        assert.equal(
          await store.reconcile(row.id, row.fence, now + 1001, 'retry'),
          true,
        );
        const replacement = await store.claim(now + 1001, 1000, 3);
        assert.equal(replacement?.id, row.id);
        assert.equal(
          await store.complete(row.id, claim.fence, now + 1002, {
            status: 'accepted',
            nextAttemptAt: 0,
          }),
          false,
        );
        assert.equal(
          await store.complete(row.id, replacement!.fence, now + 1002, {
            status: 'accepted',
            nextAttemptAt: 0,
          }),
          true,
        );
        assert.deepEqual(
          Object.keys(
            (await store.list(100)).find((r) => r.id === row.id)!,
          ).sort(),
          ['attempts', 'expiresAt', 'fence', 'id', 'status'],
        );
      } finally {
        await database.close();
      }
    },
  );

test('configured Firebase client asset: purpose, used/expired codes and redirect checks with controlled SDK', async () => {
  const { readFile } = await import('node:fs/promises');
  const asset = await readFile(
    'templates/runtime/common/clients/mail-firebase-actions.mjs',
    'utf8',
  );
  assert.ok(asset.includes("from 'firebase/auth'"));
  await writeFile(
    `${fixture}/firebase-client-fake.mjs`,
    `
export const calls=[];const used=new Set();
export async function sendEmailVerification(user,settings){calls.push(['sendVerification',user.uid,settings.url]);}
export async function sendPasswordResetEmail(auth,email,settings){calls.push(['sendReset',settings.url]);if(email==='missing@example.invalid')throw {code:'auth/user-not-found'};}
export async function checkActionCode(auth,code){if(code==='expired'||used.has(code))throw new Error('INVALID_ACTION');return {operation:code==='wrong'?'PASSWORD_RESET':'VERIFY_EMAIL'};}
export async function applyActionCode(auth,code){calls.push(['apply',code]);used.add(code);}
export async function verifyPasswordResetCode(auth,code){if(code==='expired'||used.has(code))throw new Error('INVALID_ACTION');calls.push(['verifyReset',code]);return 'private@example.invalid';}
export async function confirmPasswordReset(auth,code,password){calls.push(['confirmReset',code]);used.add(code);}
`,
  );
  await writeFile(
    `${fixture}/firebase-client-asset.mjs`,
    asset.replace("from 'firebase/auth'", "from './firebase-client-fake.mjs'"),
  );
  const client = (await import(
    pathToFileURL(`${fixture}/firebase-client-asset.mjs`).href
  )) as {
    sendManagedVerification(user: object, settings: object): Promise<unknown>;
    requestManagedReset(
      auth: object,
      email: string,
      settings: object,
    ): Promise<unknown>;
    completeFirebaseAction(
      auth: object,
      href: string,
      purpose: string,
      handlers: string[],
      origins: string[],
      password?: string,
    ): Promise<unknown>;
  };
  const fake = (await import(
    pathToFileURL(`${fixture}/firebase-client-fake.mjs`).href
  )) as { calls: unknown[][] };
  const base = 'https://project.firebaseapp.com/__/auth/action';
  const handlers = ['https://project.firebaseapp.com'],
    origins = ['https://app.example.invalid'];
  const action = (
    mode: string,
    code: string,
    redirect = 'https://app.example.invalid/done',
  ) =>
    `${base}?mode=${mode}&oobCode=${code}&continueUrl=${encodeURIComponent(redirect)}`;
  assert.deepEqual(
    await client.sendManagedVerification(
      { uid: 'verified-user' },
      { url: 'https://app.example.invalid/done' },
    ),
    { accepted: true },
  );
  assert.deepEqual(
    await client.requestManagedReset({}, 'missing@example.invalid', {
      url: 'https://app.example.invalid/done',
    }),
    { accepted: true },
  );
  await assert.rejects(
    client.completeFirebaseAction(
      {},
      action('verifyEmail', 'safe', 'https://evil.invalid'),
      'verification',
      handlers,
      origins,
    ),
  );
  assert.ok(!fake.calls.some((call) => call[0] === 'apply'));
  await assert.rejects(
    client.completeFirebaseAction(
      {},
      action('resetPassword', 'safe'),
      'verification',
      handlers,
      origins,
    ),
  );
  await assert.rejects(
    client.completeFirebaseAction(
      {},
      action('verifyEmail', 'wrong'),
      'verification',
      handlers,
      origins,
    ),
  );
  await assert.rejects(
    client.completeFirebaseAction(
      {},
      action('verifyEmail', 'expired'),
      'verification',
      handlers,
      origins,
    ),
  );
  assert.deepEqual(
    await client.completeFirebaseAction(
      {},
      action('verifyEmail', 'usable'),
      'verification',
      handlers,
      origins,
    ),
    { completed: true, continueUrl: 'https://app.example.invalid/done' },
  );
  await assert.rejects(
    client.completeFirebaseAction(
      {},
      action('verifyEmail', 'usable'),
      'verification',
      handlers,
      origins,
    ),
  );
  await client.completeFirebaseAction(
    {},
    action('resetPassword', 'reset-usable'),
    'password-reset',
    handlers,
    origins,
    'new password',
  );
  assert.ok(fake.calls.some((call) => call[0] === 'verifyReset'));
  assert.ok(fake.calls.some((call) => call[0] === 'confirmReset'));
});

test('bounded durable attempts and cipher key rotation preserve original action and clear terminal secrets', async () => {
  const { MailPayloadCipher } = await runtime<Cipher>(
    'modules/mail/mail-payload-cipher',
  );
  const { MailIntentService } = await runtime<Delivery>(
    'modules/mail/mail-intent.service',
  );
  const oldKey = randomBytes(32).toString('base64'),
    newKey = randomBytes(32).toString('base64');
  const oldCipher = new MailPayloadCipher('old', { old: oldKey });
  const prepared = oldCipher.encrypt(message('rotating-action'), 100000);
  const rotating = new MailPayloadCipher('new', { old: oldKey, new: newKey });
  assert.equal(rotating.decrypt(prepared).operationId, 'rotating-action');
  assert.equal(rotating.encrypt(message('next-action'), 100000).keyId, 'new');
  assert.throws(() =>
    new MailPayloadCipher('new', { new: newKey }).decrypt(prepared),
  );
  const { store, rows, context } = controlledStore();
  let now = 1000,
    calls = 0;
  const service = new MailIntentService(
    store,
    rotating,
    {
      async submit() {
        calls++;
        return {
          status: 'unavailable',
          code: 'SMTP_REJECTED',
          retryAfterMs: 0,
        };
      },
    },
    { maxAttempts: 2, leaseMs: 1000, maxLifetimeMs: 60000 },
    () => now,
  );
  await service.stage(
    service.prepare(message('attempt-bound'), now + 60000),
    context,
  );
  assert.deepEqual(await service.drain(), { processed: 2 });
  assert.equal(calls, 2);
  assert.equal(rows.get('attempt-bound')!.status, 'rejected');
  assert.equal(rows.get('attempt-bound')!.payload, null);
  now += 10000;
  await service.drain();
  assert.equal(calls, 2);
});
