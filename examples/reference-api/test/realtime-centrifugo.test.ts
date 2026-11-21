import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { CentrifugoConnectionService } from '../dist/modules/realtime/centrifugo-connection.service.js';
import { CentrifugoApiService } from '../dist/modules/realtime/centrifugo-api.service.js';
import { RealtimeTicketService } from '../dist/modules/realtime/realtime-ticket.service.js';
import { RealtimeService } from '../dist/modules/realtime/realtime.service.js';
import type { PrincipalAuthority } from '../dist/core/auth/principal-authority.js';
test('Centrifugo callback envelopes, server-assigned audience, refresh and private API requests (fake provider)', async () => {
  let revoked = false;
  const principal = {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  const authority: PrincipalAuthority = {
    async verify() {
      throw new Error('Credential required');
    },
    async current() {
      if (revoked) throw new Error('REVOKED');
      return principal;
    },
  };
  const calls: {
    url: string;
    body: Record<string, unknown>;
  }[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(
      new Headers(init?.headers).get('X-API-Key'),
      'fixture-private-api-key',
    );
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ result: {} });
  };
  const registry = new RealtimeService(
    authority,
    { record() {} },
    'centrifugo',
  );
  const vault = new RealtimeTicketService(authority, 30);
  const secret = 'fixture-callback-secret-that-is-separate';
  const adapter = new CentrifugoConnectionService(
    authority,
    vault,
    registry,
    new CentrifugoApiService(
      'http://private.invalid/api',
      'fixture-private-api-key',
      request,
    ),
    secret,
  );
  const client = randomUUID();
  const grant = await vault.issue(principal, 'centrifugo');
  const connect = {
    client,
    transport: 'websocket',
    protocol: 'json',
    encoding: 'json',
    data: { ticket: grant.ticket },
    channels: ['private:foreign'],
  };
  try {
    assert.deepEqual(await adapter.connect('forged', connect), {
      disconnect: { code: 4501, reason: 'unauthorized' },
    });
    const accepted = (await adapter.connect(secret, connect)) as {
      result: {
        user: string;
        subs: Record<string, unknown>;
      };
    };
    assert.equal(accepted.result.user, principal.accountId);
    const channels = Object.keys(accepted.result.subs);
    assert.equal(channels.length, 1);
    assert.notEqual(channels[0], 'private:foreign');
    const result = await registry.publish(principal.accountId, {
      id: randomUUID(),
      type: 'notes.created',
      payload: { noteId: randomUUID() },
    });
    assert.equal(result.status, 'provider-accepted');
    assert.equal(calls[0]?.url, 'http://private.invalid/api/publish');
    assert.equal(calls[0]?.body.channel, channels[0]);
    const refresh = {
      client,
      user: principal.accountId,
      transport: 'websocket',
      protocol: 'json',
      encoding: 'json',
    };
    assert.ok('result' in ((await adapter.refresh(secret, refresh)) as object));
    revoked = true;
    assert.deepEqual(await adapter.refresh(secret, refresh), {
      result: { expired: true },
    });
    assert.equal(
      (
        await registry.publish(principal.accountId, {
          id: randomUUID(),
          type: 'notes.created',
          payload: {},
        })
      ).status,
      'audience-ineligible',
    );
    assert.ok(
      calls.some(
        (call) =>
          call.url.endsWith('/disconnect') && call.body.client === client,
      ),
    );
    assert.deepEqual(
      await adapter.connect(secret, { ...connect, client: randomUUID() }),
      { disconnect: { code: 4501, reason: 'unauthorized' } },
    );
  } finally {
    registry.close();
    await adapter.close();
    vault.close();
  }
});
