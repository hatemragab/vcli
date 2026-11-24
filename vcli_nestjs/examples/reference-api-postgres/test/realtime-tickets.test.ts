import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { RealtimeTicketService } from '../dist/modules/realtime/realtime-ticket.service.js';
import { RealtimeService } from '../dist/modules/realtime/realtime.service.js';
import type { PrincipalAuthority } from '../dist/core/auth/principal-authority.js';
import type { Principal } from '../dist/core/auth/principal.js';

test('one-use admission rejects competing consumption, wrong purpose, expiry and revoked current authority', async () => {
  let revoked = false;
  const principal: Principal = {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  const authority: PrincipalAuthority = {
    async verify() {
      throw new Error('Credentials required');
    },
    async current(id) {
      assert.equal(id, principal.sessionId);
      if (revoked) throw new Error('REVOKED');
      return principal;
    },
  };
  const vault = new RealtimeTicketService(authority, 30);
  const issued = await vault.issue(principal, 'ws');
  const race = await Promise.allSettled([
    vault.consume(issued.ticket, 'ws'),
    vault.consume(issued.ticket, 'ws'),
  ]);
  assert.equal(
    race.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(race.filter((result) => result.status === 'rejected').length, 1);
  const wrongPurpose = await vault.issue(principal, 'ws');
  await assert.rejects(() => vault.consume(wrongPurpose.ticket, 'centrifugo'));
  await assert.rejects(() => vault.consume(principal.sessionId, 'ws'));
  const expiredVault = new RealtimeTicketService(authority, 0);
  const expired = await expiredVault.issue(principal, 'ws');
  await assert.rejects(() => expiredVault.consume(expired.ticket, 'ws'));
  const revokedTicket = await vault.issue(principal, 'ws');
  revoked = true;
  await assert.rejects(() => vault.consume(revokedTicket.ticket, 'ws'));
  await assert.rejects(() => vault.issue(principal, 'ws'));
  vault.close();
});

test('publication rechecks authority and preserves sibling connection identity and audiences', async () => {
  const principal = {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  let revoked = false;
  const authority: PrincipalAuthority = {
    async verify() {
      return principal;
    },
    async current() {
      if (revoked) throw new Error('REVOKED');
      return principal;
    },
  };
  const registry = new RealtimeService(authority, { record() {} }, 'ws');
  let received = 0;
  let closed = 0;
  const connection = (id: string) => ({
    id,
    principal,
    send() {
      received++;
      return true;
    },
    close() {
      closed++;
    },
  });
  registry.add(connection('old'));
  registry.add(connection('sibling'));
  registry.remove('old');
  const event = {
    id: randomUUID(),
    type: 'notes.created',
    payload: { noteId: randomUUID() },
  };
  assert.equal(
    (await registry.publish(principal.accountId, event)).status,
    'attempted',
  );
  assert.equal(received, 1);
  assert.equal(
    (await registry.publish(randomUUID(), event)).status,
    'audience-ineligible',
  );
  revoked = true;
  assert.equal(
    (await registry.publish(principal.accountId, event)).status,
    'audience-ineligible',
  );
  assert.equal(received, 1);
  assert.equal(closed, 1);
  assert.equal(registry.count(), 0);
  registry.close();
});

test('per-session counts and publication concurrency are bounded and delayed authorization fails closed', async () => {
  const principal = {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  let release: (() => void) | undefined;
  let revoked = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const authority: PrincipalAuthority = {
    async verify() {
      return principal;
    },
    async current() {
      await gate;
      if (revoked) throw new Error('REVOKED');
      return principal;
    },
  };
  const registry = new RealtimeService(authority, { record() {} }, 'ws');
  let received = 0;
  try {
    for (let i = 0; i < 8; i++)
      registry.add({
        id: String(i),
        principal,
        send() {
          received++;
          return true;
        },
        close() {},
      });
    assert.throws(
      () =>
        registry.add({
          id: 'overflow',
          principal,
          send() {
            return true;
          },
          close() {},
        }),
      /REALTIME_LIMIT/,
    );
    const event = { id: randomUUID(), type: 'notes.created', payload: {} };
    const inFlight = Array.from({ length: 8 }, () =>
      registry.publish(principal.accountId, event),
    );
    assert.equal(
      (await registry.publish(principal.accountId, event)).status,
      'unavailable',
    );
    revoked = true;
    release?.();
    const outcomes = await Promise.all(inFlight);
    assert.ok(
      outcomes.every((result) => result.status === 'audience-ineligible'),
    );
    assert.equal(received, 0);
    assert.equal(registry.count(), 0);
  } finally {
    release?.();
    registry.close();
  }
});
