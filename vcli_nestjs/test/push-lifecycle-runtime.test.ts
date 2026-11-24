import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { generateKeyPairSync, randomUUID, verify } from 'node:crypto';
import { chmod, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import {
  connect,
  createServer,
  type ClientHttp2Session,
  type ServerHttp2Stream,
} from 'node:http2';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
import type {
  PushDestination,
  PushState,
  PushMessage,
  PushOutcome,
  PushSender,
  PurposeRoutes,
  DestinationResult,
} from '../templates/runtime/common/src/modules/push/push.entity.js';
import type { PushStateStore } from '../templates/runtime/common/src/modules/push/push-state-store.js';
import type { TrustedCallInvitationPolicy } from '../templates/runtime/common/src/modules/push/trusted-call-invitation-policy.js';
import { pushFixture, pushFixtureRoot } from './push-lifecycle-fixture.ts';

type Summary = Omit<
  PushDestination,
  'token' | 'tokenHash' | 'accountId' | 'sessionId' | 'scope'
>;
type Service = {
  register(
    principal: Principal,
    input: {
      token: string;
      purpose: 'ordinary' | 'background' | 'voip';
      platform: 'android' | 'ios' | 'web';
      now: number;
      id?: string;
      generation?: string;
      scope?: string;
      tokenHash?: string;
    },
  ): Promise<Summary>;
  list(principal: Principal): Promise<readonly Summary[]>;
  remove(
    principal: Principal,
    id: string,
    generation: string,
  ): Promise<boolean>;
  notifyAccount(
    accountId: string,
    message: PushMessage,
    now: number,
    installationId?: string,
  ): Promise<readonly DestinationResult[]>;
  notifySelf(
    principal: Principal,
    message: PushMessage,
    now: number,
  ): Promise<readonly DestinationResult[]>;
};
type Repository = {
  register(destination: PushDestination): Promise<PushDestination>;
  current(destination: PushDestination): Promise<boolean>;
  removeExact(destination: PushDestination): Promise<boolean>;
};
type Runtime = {
  Service: new (...args: unknown[]) => Service;
  Repository: new (store: PushStateStore) => Repository;
  decode(value: unknown): PushState;
};
type FcmRuntime = {
  FcmPushService: new (
    app: unknown,
    options: {
      messaging: { send(message: unknown): Promise<string> };
      clock?: () => number;
      timeoutMs?: number;
    },
  ) => PushSender;
  translateFcmError(error: unknown, now?: number): PushOutcome;
};
const fcmUnregisteredDetail = {
  '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError',
  errorCode: 'UNREGISTERED',
};
const runtimes = new Map<string, Runtime>();
const loaders = new Map<string, Awaited<ReturnType<typeof pushFixture>>>();
before(async () => {
  for (const database of ['mongodb', 'postgres'] as const) {
    const load = await pushFixture(database);
    loaders.set(database, load);
    const { PushService } = await load<{ PushService: Runtime['Service'] }>(
      'modules/push/push.service',
    );
    const { PushRepository } = await load<{
      PushRepository: Runtime['Repository'];
    }>('modules/push/push.repository');
    const { decodePushState } = await load<{
      decodePushState: Runtime['decode'];
    }>('modules/push/push-storage-mapping');
    runtimes.set(database, {
      Service: PushService,
      Repository: PushRepository,
      decode: decodePushState,
    });
  }
});
function testStore(
  initial: PushState = { revision: 0, destinations: [] },
): PushStateStore & {
  state: PushState;
  beforeChange?: () => void;
  beforeRead?: () => void;
} {
  return {
    state: structuredClone(initial),
    async read() {
      this.beforeRead?.();
      return structuredClone(this.state);
    },
    async change(update) {
      this.beforeChange?.();
      this.state = update(structuredClone(this.state));
      return structuredClone(this.state);
    },
    async close() {},
  };
}
const now = Date.now();
const actor = (
  installationId: string = randomUUID(),
  generation = 1,
  accountId: string = randomUUID(),
): Principal => ({
  accountId,
  sessionId: randomUUID(),
  installationId,
  installationGeneration: generation,
  expiresAt: now + 3600000,
});
const message = (
  purpose: PushMessage['purpose'] = 'ordinary',
  ttl = 60000,
): PushMessage => ({
  operationId: randomUUID(),
  purpose,
  expiresAt: now + ttl,
  ...(purpose === 'ordinary' ? { title: 'Reference only' } : {}),
  data: purpose === 'voip' ? { callId: randomUUID() } : { reference: 'opaque' },
});
const outcome = (status: PushOutcome['status'] = 'accepted'): PushOutcome =>
  status === 'accepted'
    ? { status, reference: 'provider-reference' }
    : status === 'unavailable'
      ? { status, code: 'TEST_TRANSIENT', retryAfterMs: 1000 }
      : status === 'unknown'
        ? { status, code: 'TEST_UNKNOWN' }
        : { status, code: 'TEST_INVALID', invalidDestination: true };
function harness(
  database: string,
  options: {
    store?: ReturnType<typeof testStore>;
    senders?: Partial<Record<'fcm' | 'apns', PushSender>>;
    routes?: PurposeRoutes;
    policy?: TrustedCallInvitationPolicy;
  } = {},
) {
  const runtime = runtimes.get(database)!;
  const store = options.store ?? testStore();
  const principals = new Map<string, Principal>();
  const observed: PushDestination[] = [];
  const delays: number[] = [];
  let clock = now;
  const authority = {
    async current(id: string) {
      const p = principals.get(id);
      if (!p) throw new Error('revoked');
      return p;
    },
  };
  const sender = {
    async submit(destination: PushDestination) {
      observed.push(destination);
      return outcome();
    },
  };
  const repo = new runtime.Repository(store);
  const service = new runtime.Service(
    repo,
    options.senders ?? { fcm: sender, apns: sender },
    authority,
    async (ms: number) => {
      delays.push(ms);
      clock += ms;
      return clock;
    },
    options.routes ?? { ordinary: 'fcm', background: 'apns', voip: 'apns' },
    'scope',
    { environment: 'sandbox', clock: () => clock, voipPolicy: options.policy },
  );
  const enroll = (p: Principal) => {
    principals.set(p.sessionId, p);
    return p;
  };
  const register = (
    p: Principal,
    purpose: PushMessage['purpose'] = 'ordinary',
    token = purpose === 'ordinary' ? `fcm-${randomUUID()}` : 'ab'.repeat(32),
  ) =>
    service.register(p, {
      purpose,
      platform: purpose === 'ordinary' ? 'android' : 'ios',
      token,
      now: clock,
    });
  return {
    service,
    store,
    principals,
    observed,
    delays,
    register,
    enroll,
    repo,
    setClock(value: number) {
      clock = value;
    },
  };
}
for (const database of ['mongodb', 'postgres']) {
  test(`${database} isolated source: exact authority, safe projection, stable ID and fresh token generation`, async () => {
    const h = harness(database),
      p = h.enroll(actor());
    const first = await h.register(p),
      second = await h.register(p);
    assert.equal(first.id, second.id);
    assert.notEqual(first.generation, second.generation);
    assert.equal(second.installationGeneration, 1);
    assert.equal(h.store.state.destinations.length, 1);
    for (const key of ['token', 'tokenHash', 'accountId', 'sessionId', 'scope'])
      assert.equal(key in second, false);
    assert.deepEqual(await h.service.list(p), [second]);
    assert.equal(await h.service.remove(p, first.id, first.generation), false);
    const stale = { ...p, installationGeneration: 2 };
    await assert.rejects(h.service.list(stale), /UNAUTHENTICATED/);
    await assert.rejects(
      h.service.remove(stale, second.id, second.generation),
      /UNAUTHENTICATED/,
    );
    await assert.rejects(h.register(stale), /UNAUTHENTICATED/);
    assert.equal(await h.service.remove(p, second.id, second.generation), true);
  });
  test(`${database} isolated source: sibling fanout, rebind, logout and exact generation fence`, async () => {
    const h = harness(database),
      p = h.enroll(actor()),
      sibling = h.enroll(actor(randomUUID(), 1, p.accountId));
    await h.register(p);
    await h.register(sibling);
    assert.equal(
      (await h.service.notifyAccount(p.accountId, message(), now)).length,
      2,
    );
    assert.equal(h.observed.length, 2);
    const replacement = h.enroll(actor(p.installationId, 2));
    h.principals.delete(p.sessionId);
    h.observed.length = 0;
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.observed.length, 1);
    assert.equal(h.observed[0]?.installationId, sibling.installationId);
    await h.register(
      replacement,
      'ordinary',
      h.store.state.destinations.find(
        (d) => d.installationId === p.installationId,
      )!.token,
    );
    assert.equal((await h.service.list(replacement)).length, 1);
    await assert.rejects(h.service.list(p), /revoked/);
    await assert.rejects(h.service.notifySelf(p, message(), now), /revoked/);
    h.principals.delete(replacement.sessionId);
    h.observed.length = 0;
    await h.service.notifyAccount(replacement.accountId, message(), now);
    assert.equal(h.observed.length, 0);
  });
  test(`${database} isolated source: registration race leaves only fenced old-generation rows`, async () => {
    const h = harness(database),
      p = h.enroll(actor());
    h.store.beforeChange = () => {
      h.principals.delete(p.sessionId);
      h.enroll(actor(p.installationId, 2));
    };
    await assert.rejects(h.register(p), /revoked/);
    assert.equal(h.store.state.destinations[0]?.installationGeneration, 1);
    h.observed.length = 0;
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.observed.length, 0);
  });
  test(`${database} isolated source: active foreign token cannot be stolen and caller IDs cannot claim ownership`, async () => {
    const h = harness(database),
      p = h.enroll(actor()),
      foreign = h.enroll(actor());
    const token = `fcm-${randomUUID()}`;
    const owned = await h.register(p, 'ordinary', token);
    await assert.rejects(
      h.register(foreign, 'ordinary', token),
      /PUSH_TOKEN_ALREADY_BOUND/,
    );
    const other = await h.service.register(foreign, {
      token: `fcm-${randomUUID()}`,
      purpose: 'ordinary',
      platform: 'android',
      now,
      id: owned.id,
      generation: owned.generation,
    });
    assert.notEqual(other.id, owned.id);
    assert.notEqual(other.generation, owned.generation);
    assert.equal(
      await h.service.remove(foreign, owned.id, owned.generation),
      false,
    );
  });
  test(`${database} isolated source: delayed invalidation preserves rotated token and replacement binding`, async () => {
    let afterSend: () => Promise<void> = async () => {};
    const sender = {
      async submit() {
        await afterSend();
        return outcome('rejected');
      },
    };
    const h = harness(database, { senders: { fcm: sender } }),
      p = h.enroll(actor());
    await h.register(p);
    afterSend = async () => {
      await h.register(p);
    };
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.store.state.destinations.length, 1);
    const replacement = actor(p.installationId, 2);
    afterSend = async () => {
      h.principals.delete(p.sessionId);
      h.enroll(replacement);
      await h.register(replacement);
    };
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.store.state.destinations.length, 1);
    assert.equal(
      h.store.state.destinations[0]?.accountId,
      replacement.accountId,
    );
  });
  test(`${database} isolated source: retry rechecks current generation; unknown/payload/config never prune`, async () => {
    let calls = 0;
    let next = outcome('unknown');
    let race = () => {};
    const h = harness(database, {
        senders: {
          fcm: {
            async submit() {
              calls++;
              race();
              return next;
            },
          },
        },
      }),
      p = h.enroll(actor());
    await h.register(p);
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(calls, 1);
    assert.equal(h.store.state.destinations.length, 1);
    next = {
      status: 'rejected',
      code: 'PROVIDER_CONFIGURATION',
      invalidDestination: false,
    };
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.store.state.destinations.length, 1);
    next = outcome('unavailable');
    race = () => {
      h.principals.set(p.sessionId, { ...p, installationGeneration: 2 });
    };
    calls = 0;
    const results = await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(calls, 1);
    assert.equal(results[0]?.outcome.status, 'rejected');
    assert.deepEqual(h.delays, [1000]);
  });
  test(`${database} isolated source: retry-after, attempt, expiry and concurrent operation bounds`, async () => {
    let calls = 0;
    let delay = 1000;
    const h = harness(database, {
        senders: {
          fcm: {
            async submit() {
              calls++;
              return {
                status: 'unavailable',
                code: 'THROTTLE',
                retryAfterMs: delay,
              };
            },
          },
        },
      }),
      p = h.enroll(actor());
    await h.register(p);
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(calls, 3);
    assert.deepEqual(h.delays, [1000, 2000]);
    h.setClock(now);
    delay = 60000;
    calls = 0;
    h.delays.length = 0;
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(calls, 1);
    assert.deepEqual(h.delays, []);
    delay = 1000;
    calls = 0;
    await h.service.notifyAccount(p.accountId, message('ordinary', 500), now);
    assert.equal(calls, 1);
    assert.deepEqual(h.delays, []);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const busy = harness(database, {
        senders: {
          fcm: {
            async submit() {
              await gate;
              return outcome();
            },
          },
        },
      }),
      q = busy.enroll(actor());
    await busy.register(q);
    const pending = Array.from({ length: 4 }, () =>
      busy.service.notifyAccount(q.accountId, message(), now),
    );
    await assert.rejects(
      busy.service.notifyAccount(q.accountId, message(), now),
      /PUSH_BUSY/,
    );
    release();
    await Promise.all(pending);
  });
  test(`${database} isolated source: exact purpose routes, trusted VoIP allow/deny and no self wakeup`, async () => {
    let allowed = false,
      policyCalls = 0;
    const h = harness(database, {
        policy: {
          async authorize(input) {
            policyCalls++;
            assert.equal(input.callId.length, 36);
            return allowed;
          },
        },
      }),
      p = h.enroll(actor());
    await h.register(p);
    await h.register(p, 'voip');
    await h.register(p, 'background', 'cd'.repeat(32));
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.observed.length, 1);
    assert.equal(h.observed[0]?.provider, 'fcm');
    h.observed.length = 0;
    const denied = await h.service.notifyAccount(
      p.accountId,
      message('voip'),
      now,
    );
    assert.equal(denied[0]?.outcome.status, 'rejected');
    assert.equal(h.observed.length, 0);
    allowed = true;
    await h.service.notifyAccount(p.accountId, message('voip'), now);
    assert.equal(h.observed[0]?.provider, 'apns');
    assert.equal(policyCalls, 2);
    await assert.rejects(
      h.service.notifySelf(p, message('voip'), now),
      /VOIP_REQUIRES_AUTHORIZED_CALL/,
    );
    const missing = harness(database);
    await assert.rejects(
      missing.service.notifyAccount(p.accountId, message('voip'), now),
      /VOIP_POLICY_NOT_CONFIGURED/,
    );
    h.observed.length = 0;
    await h.service.notifyAccount(p.accountId, message('background'), now);
    assert.equal(h.observed[0]?.purpose, 'background');
  });
  test(`${database} isolated source: legacy rows never acquire implicit generation or environment`, async () => {
    const h = harness(database),
      p = h.enroll(actor());
    await h.register(p);
    const raw = structuredClone(h.store.state) as unknown as {
      revision: number;
      destinations: Record<string, unknown>[];
    };
    delete raw.destinations[0]!.installationGeneration;
    h.store.state = runtimes.get(database)!.decode(raw);
    assert.equal(h.store.state.destinations[0]?.installationGeneration, 0);
    await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(h.observed.length, 0);
    assert.deepEqual(await h.service.list(p), []);
    await h.register(p);
    assert.equal(h.store.state.destinations.length, 1);
    assert.equal(h.store.state.destinations[0]?.installationGeneration, 1);
    const rawEnvironment = structuredClone(
      h.store.state,
    ) as unknown as typeof raw;
    delete rawEnvironment.destinations[0]!.environment;
    assert.equal(
      runtimes.get(database)!.decode(rawEnvironment).destinations[0]
        ?.installationGeneration,
      0,
    );
  });
  test(`${database} isolated source: provider thrown secrets become unknown; bounds validate before I/O`, async () => {
    const h = harness(database, {
        senders: {
          fcm: {
            async submit() {
              throw new Error('token secret credential');
            },
          },
        },
      }),
      p = h.enroll(actor());
    await h.register(p);
    const results = await h.service.notifyAccount(p.accountId, message(), now);
    assert.equal(JSON.stringify(results).includes('secret'), false);
    assert.equal(results[0]?.outcome.status, 'unknown');
    for (const invalid of [
      { ...message(), data: { googleForbidden: 'x' } },
      { ...message(), title: 'a'.repeat(101) },
      { ...message(), expiresAt: now + 300001 },
      { ...message('background'), title: 'Alert' },
    ])
      await assert.rejects(h.service.notifyAccount(p.accountId, invalid, now));
    assert.equal(h.store.state.destinations.length, 1);
  });
}
test('controlled FCM SDK: exact ordinary payload, explicit error mapping, retry-after and timeout unknown', async () => {
  const load = loaders.get('postgres')!;
  const { FcmPushService, translateFcmError } = await load<FcmRuntime>(
    'modules/push/fcm-push.service',
  );
  const h = harness('postgres'),
    p = h.enroll(actor());
  await h.register(p);
  const destination = h.store.state.destinations[0]!;
  const sent: unknown[] = [];
  const fcm = new FcmPushService(undefined, {
    clock: () => now,
    messaging: {
      async send(message) {
        sent.push(message);
        return 'projects/test/messages/accepted';
      },
    },
  });
  const m = message();
  assert.equal((await fcm.submit(destination, m, now)).status, 'accepted');
  const wire = sent[0] as {
    token: string;
    android: { ttl: number };
    apns: { headers: Record<string, string> };
    data: Record<string, string>;
  };
  assert.equal(wire.token, destination.token);
  assert.equal(wire.data.operationId, m.operationId);
  assert.equal(wire.android.ttl, 60000);
  assert.equal(wire.apns.headers['apns-push-type'], 'alert');
  assert.equal(
    (await fcm.submit(destination, message('voip'), now)).status,
    'rejected',
  );
  assert.equal(sent.length, 1);
  assert.equal(
    (await fcm.submit(destination, m, now, async () => false)).status,
    'rejected',
  );
  assert.equal(sent.length, 1);
  for (const code of [
    'messaging/invalid-argument',
    'messaging/invalid-payload',
    'messaging/mismatched-credential',
    'messaging/authentication-error',
    'messaging/third-party-auth-error',
  ]) {
    const result = translateFcmError({ code });
    assert.equal(result.status, 'rejected');
    assert.equal(
      result.status === 'rejected' && result.invalidDestination,
      false,
    );
  }
  const transient = translateFcmError(
    {
      code: 'messaging/server-unavailable',
      httpResponse: { headers: { 'retry-after': '120' } },
    },
    now,
  );
  assert.deepEqual(transient, {
    status: 'unavailable',
    code: 'FCM_UNAVAILABLE',
    retryAfterMs: 120000,
  });
  assert.deepEqual(
    translateFcmError({ code: 'messaging/message-rate-exceeded' }),
    { status: 'unavailable', code: 'FCM_THROTTLED', retryAfterMs: 60000 },
  );
  assert.equal(
    translateFcmError(new Error('network-after-send')).status,
    'unknown',
  );
  let release = () => {};
  const gate = new Promise<string>((resolve) => {
    release = () => resolve('late accepted');
  });
  const timeout = new FcmPushService(undefined, {
    clock: () => now,
    timeoutMs: 15,
    messaging: { send: () => gate },
  });
  assert.equal((await timeout.submit(destination, m, now)).status, 'unknown');
  release();
  await gate;
});
test('controlled FCM SDK: only explicit invalid-token evidence can retire a destination', async () => {
  const { translateFcmError } = await loaders.get('postgres')!<FcmRuntime>(
    'modules/push/fcm-push.service',
  );
  const ambiguousCode = 'messaging/registration-token-not-registered';
  const invalid = {
    status: 'rejected',
    code: 'FCM_INVALID_DESTINATION',
    invalidDestination: true,
  };
  const unconfirmed = {
    status: 'rejected',
    code: 'FCM_DESTINATION_UNCONFIRMED',
    invalidDestination: false,
  };
  assert.deepEqual(
    translateFcmError({
      code: 'messaging/invalid-registration-token',
      message: 'raw secret',
    }),
    invalid,
  );
  assert.deepEqual(
    translateFcmError({
      code: ambiguousCode,
      httpResponse: {
        status: 404,
        data: { error: { details: [fcmUnregisteredDetail] } },
      },
    }),
    invalid,
  );
  assert.deepEqual(translateFcmError({ code: ambiguousCode }), unconfirmed);

  // The Admin SDK can map a generic HTTP 404 to the same local error code.
  for (const details of [
    undefined,
    fcmUnregisteredDetail,
    [null, 'UNREGISTERED'],
    [{ ...fcmUnregisteredDetail, '@type': 'example.invalid/FcmError' }],
    [{ ...fcmUnregisteredDetail, errorCode: 'NOT_FOUND' }],
  ]) {
    const result = translateFcmError({
      code: ambiguousCode,
      httpResponse: {
        status: 404,
        data: { error: { status: 'NOT_FOUND', details } },
      },
    });
    assert.deepEqual(result, unconfirmed);
  }
  assert.deepEqual(
    translateFcmError({
      code: ambiguousCode,
      httpResponse: {
        status: 404,
        get data() {
          throw new Error('private non-JSON response body');
        },
      },
    }),
    unconfirmed,
  );
});
test('controlled FCM SDK: inline account fan-out retires only the explicitly invalid installation', async () => {
  const { FcmPushService } = await loaders.get('postgres')!<FcmRuntime>(
    'modules/push/fcm-push.service',
  );
  const rejectedToken = `fcm-${randomUUID()}`;
  const acceptedToken = `fcm-${randomUUID()}`;
  let details: unknown[] = [];
  const sent: string[] = [];
  const fcm = new FcmPushService(undefined, {
    clock: () => now,
    messaging: {
      async send(input) {
        const { token } = input as { token: string };
        sent.push(token);
        if (token === rejectedToken)
          throw {
            code: 'messaging/registration-token-not-registered',
            httpResponse: { status: 404, data: { error: { details } } },
          };
        return 'projects/test/messages/accepted';
      },
    },
  });
  const h = harness('postgres', { senders: { fcm } }),
    first = h.enroll(actor()),
    sibling = h.enroll(actor(randomUUID(), 1, first.accountId));
  const rejected = await h.register(first, 'ordinary', rejectedToken);
  const accepted = await h.register(sibling, 'ordinary', acceptedToken);
  const delivery = () =>
    h.service.notifyAccount(first.accountId, message(), now);
  const acceptedOutcome = {
    status: 'accepted',
    reference: 'projects/test/messages/accepted',
  };

  const unconfirmed = await delivery();
  assert.deepEqual(
    unconfirmed.map(({ destinationId, outcome }) => [destinationId, outcome]),
    [
      [
        rejected.id,
        {
          status: 'rejected',
          code: 'FCM_DESTINATION_UNCONFIRMED',
          invalidDestination: false,
        },
      ],
      [accepted.id, acceptedOutcome],
    ],
  );
  assert.deepEqual(await h.service.list(first), [rejected]);
  assert.deepEqual(await h.service.list(sibling), [accepted]);

  details = [fcmUnregisteredDetail];
  const confirmed = await delivery();
  assert.deepEqual(
    confirmed.map(({ destinationId, outcome }) => [destinationId, outcome]),
    [
      [
        rejected.id,
        {
          status: 'rejected',
          code: 'FCM_INVALID_DESTINATION',
          invalidDestination: true,
        },
      ],
      [accepted.id, acceptedOutcome],
    ],
  );
  assert.deepEqual(sent, [
    rejectedToken,
    acceptedToken,
    rejectedToken,
    acceptedToken,
  ]);
  assert.deepEqual(await h.service.list(first), []);
  assert.deepEqual(await h.service.list(sibling), [accepted]);
});
test('controlled loopback APNs HTTP2: purpose headers, JWT, retry-after, invalid timestamp and post-send disconnect', async () => {
  const load = loaders.get('postgres')!;
  const { ApnsPushService } = await load<{
    ApnsPushService: {
      create(
        config: Record<string, unknown>,
        options: {
          connection: (origin: string) => ClientHttp2Session;
          timeoutMs: number;
          clock: () => number;
        },
      ): Promise<PushSender>;
    };
  }>('modules/push/apns-push.service');
  const { apnsEnvelope, translateApnsResponse } = await load<{
    apnsEnvelope(
      m: PushMessage,
      topic: string,
    ): { headers: Record<string, string>; body: string };
    translateApnsResponse(
      status: number,
      reason: string,
      reference: string,
      retry?: number,
      invalidatedAt?: number,
      registeredAt?: number,
    ): PushOutcome;
  }>('modules/push/apns-payload');
  const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const keyPath = `${pushFixtureRoot}/apns-test.p8`;
  await writeFile(
    keyPath,
    key.privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { mode: 0o600 },
  );
  await chmod(keyPath, 0o600);
  let mode = 'accepted';
  const origins: string[] = [],
    requests: { headers: Record<string, unknown>; body: string }[] = [];
  const server = createServer();
  const sessions = new Set<import('node:http2').ServerHttp2Session>();
  server.on('session', (session) => {
    sessions.add(session);
    session.once('close', () => sessions.delete(session));
  });
  server.on('stream', (stream: ServerHttp2Stream, headers) => {
    let body = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      body += chunk;
    });
    stream.on('error', () => {});
    stream.on('end', () => {
      requests.push({ headers, body });
      if (mode === 'disconnect') {
        stream.session?.destroy();
        return;
      }
      if (mode === 'stall') return;
      const status =
        mode === 'throttle'
          ? 429
          : mode === 'transient'
            ? 503
            : mode === 'invalid'
              ? 410
              : mode === 'config'
                ? 403
                : 200;
      stream.respond({
        ':status': status,
        'apns-id': randomUUID(),
        ...(status === 429 ? { 'retry-after': '120' } : {}),
      });
      stream.end(
        status === 410
          ? JSON.stringify({ reason: 'Unregistered', timestamp: now + 1000 })
          : status === 403
            ? JSON.stringify({ reason: 'InvalidProviderToken' })
            : status === 200
              ? ''
              : JSON.stringify({ reason: 'ServiceUnavailable' }),
      );
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as AddressInfo).port;
  const config = {
    apnsTeamId: 'ABCDEFGHIJ',
    apnsKeyId: '0123456789',
    apnsKeyPath: keyPath,
    apnsTopic: 'com.example.calls',
    apnsProduction: false,
  };
  const connection = (origin: string) => {
    origins.push(origin);
    return connect(`http://127.0.0.1:${port}`);
  };
  try {
    const apns = await ApnsPushService.create(config, {
      connection,
      timeoutMs: 100,
      clock: () => now,
    });
    const h = harness('postgres'),
      p = h.enroll(actor());
    await h.register(p, 'voip');
    const d = h.store.state.destinations[0]!;
    for (const purpose of ['ordinary', 'background', 'voip'] as const) {
      const m = message(purpose);
      const outcome = await apns.submit({ ...d, purpose }, m, now);
      assert.equal(outcome.status, 'accepted');
      const wire = requests.at(-1)!;
      assert.equal(
        wire.headers['apns-topic'],
        purpose === 'voip' ? 'com.example.calls.voip' : 'com.example.calls',
      );
      assert.equal(
        wire.headers['apns-push-type'],
        purpose === 'ordinary' ? 'alert' : purpose,
      );
      assert.equal(
        wire.headers['apns-priority'],
        purpose === 'background' ? '5' : '10',
      );
      assert.equal(
        wire.headers['apns-expiration'],
        purpose === 'voip' ? '0' : String(Math.floor(m.expiresAt / 1000)),
      );
      assert.equal(wire.headers[':path'], `/3/device/${d.token}`);
      const jwt = String(wire.headers.authorization).slice(7).split('.');
      assert.equal(
        verify(
          'sha256',
          Buffer.from(jwt[0] + '.' + jwt[1]),
          { key: key.publicKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(jwt[2]!, 'base64url'),
        ),
        true,
      );
      assert.equal(
        JSON.parse(Buffer.from(jwt[0]!, 'base64url').toString()).alg,
        'ES256',
      );
      assert.equal(
        JSON.parse(Buffer.from(jwt[1]!, 'base64url').toString()).iss,
        config.apnsTeamId,
      );
      assert.equal(JSON.parse(wire.body).data.reference, m.data.reference);
    }
    assert.equal(
      origins.every(
        (origin) => origin === 'https://api.sandbox.push.apple.com',
      ),
      true,
    );
    mode = 'throttle';
    assert.deepEqual(await apns.submit(d, message('voip'), now), {
      status: 'unavailable',
      code: 'APNS_THROTTLED',
      retryAfterMs: 120000,
    });
    mode = 'transient';
    assert.equal(
      (await apns.submit(d, message('voip'), now)).status,
      'unavailable',
    );
    mode = 'invalid';
    const invalid = await apns.submit(d, message('voip'), now);
    assert.equal(
      invalid.status === 'rejected' && invalid.invalidDestination,
      true,
    );
    mode = 'config';
    const configuration = await apns.submit(d, message('voip'), now);
    assert.equal(
      configuration.status === 'rejected' && configuration.invalidDestination,
      false,
    );
    mode = 'disconnect';
    assert.equal(
      (await apns.submit(d, message('voip'), now)).status,
      'unknown',
    );
    mode = 'stall';
    assert.equal(
      (await apns.submit(d, message('voip'), now)).status,
      'unknown',
    );
    const beforeFence = requests.length;
    const guarded = await apns.submit(
      d,
      message('voip'),
      now,
      async () => false,
    );
    assert.equal(guarded.status, 'rejected');
    assert.equal(requests.length, beforeFence);
    const count = requests.length;
    await apns.submit(
      { ...d, environment: 'production' },
      message('voip'),
      now,
    );
    assert.equal(requests.length, count);
    const early = translateApnsResponse(
      410,
      'Unregistered',
      'id',
      1000,
      now - 1,
      now,
    );
    assert.equal(
      early.status === 'rejected' && early.invalidDestination,
      false,
    );
    const absent = translateApnsResponse(
      410,
      'Unregistered',
      'id',
      1000,
      undefined,
      now,
    );
    assert.equal(
      absent.status === 'rejected' && absent.invalidDestination,
      false,
    );
    assert.equal(
      apnsEnvelope(message('background'), 'topic').body.includes('alert'),
      false,
    );
    const failed = await ApnsPushService.create(config, {
      connection() {
        throw new Error('connection refused');
      },
      timeoutMs: 100,
      clock: () => now,
    });
    assert.equal(
      (await failed.submit(d, message('voip'), now)).status,
      'unavailable',
    );
    await assert.rejects(
      ApnsPushService.create(
        { ...config, apnsTopic: 'com.example.calls.voip' },
        { connection, timeoutMs: 100, clock: () => now },
      ),
      /INVALID_APNS_CONFIG/,
    );
  } finally {
    for (const session of sessions) session.destroy();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
test('private credential references: bad permissions, symlinks, project mismatch and safe errors', async () => {
  const load = loaders.get('postgres')!;
  const { fcmCredential } = await load<{
    fcmCredential(project: string, path?: string): Promise<unknown>;
  }>('modules/push/fcm-credentials');
  const directory = `${pushFixtureRoot}/credentials`;
  await mkdir(directory, { recursive: true });
  const path = `${directory}/account.json`;
  await writeFile(
    path,
    JSON.stringify({
      type: 'service_account',
      project_id: 'other',
      client_email: 'test@example.invalid',
      private_key: 'private secret',
    }),
    { mode: 0o644 },
  );
  await chmod(path, 0o644);
  await assert.rejects(
    fcmCredential('selected', path),
    /^ApplicationError: INVALID_FCM_CREDENTIALS$/,
  );
  await chmod(path, 0o600);
  await assert.rejects(
    fcmCredential('selected', path),
    /^ApplicationError: INVALID_FCM_CREDENTIALS$/,
  );
  const link = `${directory}/link.json`;
  try {
    await symlink(path, link);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await assert.rejects(
    fcmCredential('selected', link),
    /^ApplicationError: INVALID_FCM_CREDENTIALS$/,
  );
  await assert.rejects(
    fcmCredential('selected', `${directory}/missing-secret-path`),
    /^ApplicationError: INVALID_FCM_CREDENTIALS$/,
  );
});
test('client and HTTP boundary: no VoIP self route, no token echo or raw response errors', async () => {
  const controller = await readFile(
    'templates/runtime/common/src/modules/push/push.controller.ts',
    'utf8',
  );
  assert.match(
    controller,
    /const purpose = z.enum\(\['ordinary', 'background'\]\)/,
  );
  // Exercise the generated client against a controlled Fetch peer; no external requests.
  const { pushClient } = (await import(
    new URL(
      '../templates/runtime/common/clients/push-client.mjs',
      import.meta.url,
    ).href
  )) as {
    pushClient(options: Record<string, unknown>): {
      register(input: Record<string, string>): Promise<unknown>;
      list(): Promise<unknown>;
      revoke(input: Record<string, string>): Promise<unknown>;
    };
  };
  const requests: { url: string; init: RequestInit }[] = [];
  const client = pushClient({
    origin: 'https://example.invalid',
    accessToken: 'private',
    fetch: async (url: URL, init: RequestInit) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: 'safe', generation: randomUUID() });
    },
  });
  await client.register({
    purpose: 'ordinary',
    platform: 'android',
    token: 'not-logged',
  });
  await client.list();
  const id = randomUUID();
  await client.revoke({ id, generation: randomUUID() });
  assert.equal(
    requests[0]?.url,
    'https://example.invalid/api/push/destinations',
  );
  assert.equal(requests[0]?.init.redirect, 'error');
  assert.equal(requests[2]?.init.method, 'DELETE');
  const denied = pushClient({
    origin: 'https://example.invalid',
    accessToken: 'private',
    fetch: async () => new Response('raw token secret', { status: 401 }),
  });
  await assert.rejects(denied.list(), /^Error: PUSH_HTTP_401$/);
});

test('compiled HTTP controller validates no public VoIP wake and returns only a safe registration', async () => {
  const load = loaders.get('postgres')!;
  const { PushController } = await load<{
    PushController: new (
      service: Service,
      scope: string,
    ) => {
      self(
        principal: Principal,
        body: unknown,
        response: unknown,
      ): Promise<unknown>;
      register(principal: Principal, body: unknown): Promise<unknown>;
    };
  }>('modules/push/push.controller');
  const h = harness('postgres'),
    p = h.enroll(actor());
  const controller = new PushController(h.service, 'scope');
  await assert.rejects(
    controller.self(p, { purpose: 'voip', data: { callId: randomUUID() } }, {}),
    /INVALID_REQUEST/,
  );
  const safe = await controller.register(p, {
    purpose: 'ordinary',
    platform: 'android',
    token: 'registration-secret-token',
  });
  assert.equal(
    JSON.stringify(safe).includes('registration-secret-token'),
    false,
  );
  assert.equal(
    (safe as Summary).installationGeneration,
    p.installationGeneration,
  );
});

test('controlled FCM: a timed-out final authority check cannot start a later provider send', async () => {
  const load = loaders.get('postgres')!;
  const { FcmPushService } = await load<{
    FcmPushService: new (
      app: unknown,
      options: {
        messaging: { send(message: unknown): Promise<string> };
        clock: () => number;
        timeoutMs: number;
      },
    ) => PushSender;
  }>('modules/push/fcm-push.service');
  const h = harness('postgres'),
    p = h.enroll(actor());
  await h.register(p);
  let calls = 0,
    release: () => void = () => {};
  const gate = new Promise<boolean>((resolve) => {
    release = () => resolve(true);
  });
  const fcm = new FcmPushService(undefined, {
    clock: () => now,
    timeoutMs: 15,
    messaging: {
      async send() {
        calls++;
        return 'accepted';
      },
    },
  });
  assert.equal(
    (
      await fcm.submit(
        h.store.state.destinations[0]!,
        message(),
        now,
        () => gate,
      )
    ).status,
    'unknown',
  );
  release();
  await gate;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(calls, 0);
});
