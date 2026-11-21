import test from 'node:test';
import {
  databaseTest,
  postgresFixture,
  configDatabaseUrl,
  type TestCleanup,
} from './helpers/postgres-fixture.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadConfig } from '../dist/core/config/load-config.js';
import {
  renderMessage,
  approvedActionUrl,
} from '../dist/modules/mail/render-message.js';
import {
  createMailSender,
  createTestMailCapture,
} from '../dist/modules/mail/mail.module.js';
import { translateSmtpError } from '../dist/modules/mail/smtp-mail.service.js';
import { PushService } from '../dist/modules/push/push.service.js';
import { PostgresPushStateStore } from '../dist/modules/push/postgres-push-state-store.js';
import { PushRepository } from '../dist/modules/push/push.repository.js';
import { decodePushState } from '../dist/modules/push/push-storage-mapping.js';
import { translateFcmError } from '../dist/modules/push/fcm-push.service.js';
import {
  apnsEnvelope,
  translateApnsResponse,
} from '../dist/modules/push/apns-payload.js';
import { destinationProjection } from '../dist/modules/push/push.entity.js';
import type {
  PushMessage,
  PushOutcome,
} from '../dist/modules/push/push.entity.js';
import type { PushSender } from '../dist/modules/push/push.entity.js';
import type { Principal } from '../dist/core/auth/principal.js';
const principal: Principal = {
  accountId: 'owner',
  sessionId: 'session',
  installationId: 'installation',
  expiresAt: 100000,
};
const message = (): PushMessage => ({
  operationId: randomUUID(),
  purpose: 'ordinary',
  title: 'Private application update',
  data: {},
  expiresAt: 60000,
});
async function pushFixture(
  t: TestCleanup,
  submit: PushSender['submit'] = async () => ({
    status: 'accepted',
    reference: 'provider-reference',
  }),
) {
  const testDatabase = await postgresFixture();
  const store = await PostgresPushStateStore.connect(testDatabase.url, true);
  t.after(async () => {
    await store.close();
    await testDatabase.close();
  });
  const destinations = new PushRepository(store);
  let authority = principal;
  let now = 1000;
  const service = new PushService(
    destinations,
    { fcm: { submit }, apns: { submit } },
    { current: async () => authority },
    async (ms) => {
      now += ms;
      return now;
    },
    { ordinary: 'fcm', background: 'apns', voip: 'apns' },
    'test-scope',
  );
  const register = (
    token = 'token-with-private-contents',
    purpose: 'ordinary' | 'voip' = 'ordinary',
    actor = principal,
  ) =>
    service.register(actor, {
      id: randomUUID(),
      generation: randomUUID(),
      token,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      scope: 'test-scope',
      purpose,
      platform: purpose === 'voip' ? 'ios' : 'android',
      now,
    });
  return {
    store,
    destinations,
    service,
    register,
    setAuthority: (next: Principal) => {
      authority = next;
    },
  };
}
test('mail renders escaped text for any selected transport and rejects header injection', () => {
  const rendered = renderMessage({
    operationId: 'operation',
    to: 'person@example.test',
    subject: 'Verify account',
    text: '<script>"& unsafe</script>',
    html: '<script>ignored</script>',
    purpose: 'verification',
  });
  assert.match(rendered.html ?? '', /&lt;script&gt;&quot;&amp;/);
  assert.equal(rendered.html?.includes('<script>'), false);
  assert.throws(
    () =>
      renderMessage({
        ...rendered,
        subject: 'hello\r\nBcc: other@example.test',
      }),
    { code: 'INVALID_MAIL_MESSAGE' },
  );
  assert.throws(
    () => approvedActionUrl('https://evil.test/reset', 'https://app.test'),
    { code: 'UNAPPROVED_ACTION_URL' },
  );
  assert.throws(
    () =>
      approvedActionUrl(
        'https://user:secret@app.test/reset',
        'https://app.test',
      ),
    { code: 'UNAPPROVED_ACTION_URL' },
  );
  assert.equal(
    approvedActionUrl(
      'https://app.test/reset?token=private',
      'https://app.test',
    ),
    'https://app.test/reset?token=private',
  );
});
test('capture inspection is private, bounded, expiring and refused in production', async () => {
  let now = 1000;
  const capture = createTestMailCapture(2, () => now);
  const draft = {
    operationId: 'one',
    to: 'person@example.test',
    subject: 'Action',
    text: 'private-link',
    purpose: 'verification' as const,
  };
  assert.deepEqual(await capture.sender.submit(draft), {
    status: 'captured',
    reference: 'one',
  });
  await capture.sender.submit({ ...draft, operationId: 'two' });
  await capture.sender.submit({ ...draft, operationId: 'three' });
  assert.deepEqual(
    capture.inspect().map((entry) => entry.message.operationId),
    ['two', 'three'],
  );
  now += 900001;
  assert.equal(capture.inspect().length, 0);
  const config = loadConfig({ DATABASE_URL: configDatabaseUrl });
  assert.equal('inspect' in createMailSender(config), false);
  assert.throws(
    () => createMailSender({ ...config, environment: 'production' }),
    { code: 'UNSAFE_PRODUCTION_PROFILE' },
  );
  capture.clear();
});
test('SMTP translates explicit rejections and ambiguous submission without unsafe retry claims', () => {
  assert.equal(translateSmtpError({ responseCode: 550 }).status, 'rejected');
  assert.equal(translateSmtpError({ responseCode: 451 }).status, 'unavailable');
  assert.equal(translateSmtpError({ code: 'EAUTH' }).status, 'rejected');
  assert.equal(
    translateSmtpError({ code: 'ETIMEDOUT', command: 'CONN' }).status,
    'unavailable',
  );
  assert.equal(
    translateSmtpError({ code: 'ETIMEDOUT', command: 'DATA' }).status,
    'unknown',
  );
});
databaseTest(
  'push projection omits secrets and rotation fences delayed invalid-token cleanup',
  async (t) => {
    let finish: ((value: PushOutcome) => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const f = await pushFixture(t, async () => {
      entered?.();
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    const first = await f.register();
    const projection = destinationProjection(first);
    assert.equal('token' in projection, false);
    assert.equal('tokenHash' in projection, false);
    assert.equal('accountId' in projection, false);
    const dispatch = f.service.notifyAccount('owner', message(), 1000);
    await started;
    const rotated = await f.register('new-token-with-private-contents');
    finish?.({
      status: 'rejected',
      code: 'FCM_INVALID_DESTINATION',
      invalidDestination: true,
    });
    await dispatch;
    assert.equal(
      (await f.service.list(principal))[0]?.generation,
      rotated.generation,
    );
    assert.equal(
      await f.service.remove(principal, first.id, first.generation),
      false,
    );
  },
);
databaseTest(
  'push dispatch rechecks session binding and never redirects old-account work',
  async (t) => {
    let calls = 0;
    const f = await pushFixture(t, async () => {
      calls += 1;
      return { status: 'accepted', reference: 'accepted' };
    });
    const old = await f.register();
    f.setAuthority({
      ...principal,
      accountId: 'new-account',
      sessionId: 'new-session',
    });
    const result = await f.service.notifyAccount('owner', message(), 1000);
    assert.equal(result[0]?.outcome.status, 'rejected');
    assert.equal(calls, 0);
    const replacement = await f.register(
      'replacement-token-with-private-contents',
      'ordinary',
      { ...principal, accountId: 'new-account', sessionId: 'new-session' },
    );
    assert.equal(await f.destinations.current(old), false);
    assert.equal(
      (await f.destinations.list('new-account'))[0]?.id,
      replacement.id,
    );
    assert.deepEqual(
      await f.service.notifyAccount('owner', message(), 1000),
      [],
    );
  },
);
databaseTest(
  'provider token uniqueness refuses ownership theft between installations',
  async (t) => {
    const f = await pushFixture(t);
    await f.register();
    const second = {
      ...principal,
      installationId: 'another-installation',
      sessionId: 'another-session',
    };
    f.setAuthority(second);
    await assert.rejects(
      f.register('token-with-private-contents', 'ordinary', second),
      { code: 'PUSH_TOKEN_ALREADY_BOUND' },
    );
  },
);
databaseTest(
  'push persistence rejects malformed storage and permits same-installation APNs purpose references',
  async (t) => {
    const f = await pushFixture(t);
    const destination = await f.register('a'.repeat(64), 'voip');
    assert.equal(
      decodePushState({ revision: 1, destinations: [destination] })
        .destinations[0]?.id,
      destination.id,
    );
    assert.throws(
      () =>
        decodePushState({
          revision: 1,
          destinations: [{ ...destination, tokenHash: null }],
        }),
      { code: 'INVALID_PUSH_PERSISTENCE' },
    );
    await f.destinations.register({
      ...destination,
      id: randomUUID(),
      generation: randomUUID(),
      purpose: 'background',
    });
    assert.equal((await f.service.list(principal)).length, 2);
  },
);
databaseTest(
  'push retries explicit transient failures at most three times; unknown is never retried',
  async (t) => {
    let calls = 0;
    const f = await pushFixture(t, async () => {
      calls += 1;
      return { status: 'unavailable', code: 'TEMPORARY', retryAfterMs: 100 };
    });
    await f.register();
    assert.equal(
      (await f.service.notifyAccount('owner', message(), 1000))[0]?.outcome
        .status,
      'unavailable',
    );
    assert.equal(calls, 3);
    let unknownCalls = 0;
    const unknown = await pushFixture(t, async () => {
      unknownCalls += 1;
      return { status: 'unknown', code: 'UNKNOWN' };
    });
    await unknown.register();
    await unknown.service.notifyAccount('owner', message(), 1000);
    assert.equal(unknownCalls, 1);
  },
);
databaseTest(
  'FCM ordinary and APNs VoIP routing stay distinct; configuration failures do not prune tokens',
  async (t) => {
    const seen: string[] = [];
    const f = await pushFixture(t, async (destination) => {
      seen.push(`${destination.provider}:${destination.purpose}`);
      return {
        status: 'rejected',
        code: 'PROVIDER_CONFIGURATION',
        invalidDestination: false,
      };
    });
    await f.register();
    await f.register('a'.repeat(64), 'voip');
    await f.service.notifyAccount('owner', message(), 1000);
    await f.service.notifyAccount(
      'owner',
      {
        ...message(),
        purpose: 'voip',
        title: undefined,
        data: { callId: randomUUID() },
      },
      1000,
    );
    assert.deepEqual(seen, ['fcm:ordinary', 'apns:voip']);
    assert.equal((await f.service.list(principal)).length, 2);
  },
);
test('provider translations distinguish invalid tokens, configuration, throttling and unknown results', () => {
  assert.deepEqual(
    translateFcmError({ code: 'messaging/registration-token-not-registered' }),
    {
      status: 'rejected',
      code: 'FCM_INVALID_DESTINATION',
      invalidDestination: true,
    },
  );
  assert.equal(
    translateFcmError({ code: 'messaging/invalid-argument' }).status,
    'rejected',
  );
  assert.equal(translateFcmError(new Error('socket closed')).status, 'unknown');
  assert.equal(
    translateApnsResponse(429, 'TooManyRequests', '', 60000).status,
    'unavailable',
  );
  assert.deepEqual(translateApnsResponse(400, 'BadDeviceToken', ''), {
    status: 'rejected',
    code: 'APNS_REQUEST_REJECTED',
    invalidDestination: false,
  });
  assert.deepEqual(
    translateApnsResponse(410, 'Unregistered', '', 1000, 2000, 3000),
    {
      status: 'rejected',
      code: 'APNS_INVALID_DESTINATION',
      invalidDestination: false,
    },
  );
  assert.deepEqual(
    translateApnsResponse(410, 'Unregistered', '', 1000, 4000, 3000),
    {
      status: 'rejected',
      code: 'APNS_INVALID_DESTINATION',
      invalidDestination: true,
    },
  );
});
test('APNs payload translation uses explicit ordinary/background/VoIP headers and topics', () => {
  const ordinary = apnsEnvelope(message(), 'com.example.app');
  assert.equal(ordinary.headers['apns-push-type'], 'alert');
  const background = apnsEnvelope(
    { ...message(), purpose: 'background', title: undefined },
    'com.example.app',
  );
  assert.equal(background.headers['apns-priority'], '5');
  const voip = apnsEnvelope(
    {
      ...message(),
      purpose: 'voip',
      title: undefined,
      data: { callId: randomUUID() },
    },
    'com.example.app',
  );
  assert.equal(voip.headers['apns-topic'], 'com.example.app.voip');
  assert.equal(voip.headers['apns-push-type'], 'voip');
  assert.equal(voip.headers['apns-expiration'], '0');
});
databaseTest(
  'missing selected push sender returns a safe rejection without pruning registration',
  async (t) => {
    const testDatabase = await postgresFixture();
    const store = await PostgresPushStateStore.connect(testDatabase.url, true);
    t.after(async () => {
      await store.close();
      await testDatabase.close();
    });
    const destinations = new PushRepository(store);
    const service = new PushService(
      destinations,
      {},
      { current: async () => principal },
      async () => 1000,
      { ordinary: 'fcm' },
      'test-scope',
    );
    await service.register(principal, {
      id: randomUUID(),
      generation: randomUUID(),
      token: 'private-provider-token',
      tokenHash: createHash('sha256')
        .update('private-provider-token')
        .digest('hex'),
      scope: 'test-scope',
      purpose: 'ordinary',
      platform: 'android',
      now: 1000,
    });
    assert.deepEqual(
      (await service.notifyAccount('owner', message(), 1000))[0]?.outcome,
      {
        status: 'rejected',
        code: 'PUSH_PROVIDER_NOT_CONFIGURED',
        invalidDestination: false,
      },
    );
    assert.equal((await service.list(principal)).length, 1);
    await store.close();
  },
);
