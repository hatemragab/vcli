import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';
import { WebSocket } from 'ws';
import { loadConfig } from '../dist/core/config/load-config.js';
import { SocketIoService } from '../dist/modules/realtime/socket-io.service.js';
import { NativeWsService } from '../dist/modules/realtime/native-ws.service.js';
import { RealtimeTicketService } from '../dist/modules/realtime/realtime-ticket.service.js';
import { RealtimeService } from '../dist/modules/realtime/realtime.service.js';
import type { AccessProof } from '../dist/core/auth/principal.js';
import type { PrincipalAuthority } from '../dist/core/auth/principal-authority.js';
import { onceSocket } from './helpers/once-socket.ts';
function fixture() {
  let revoked = false;
  const principal = {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    installationId: randomUUID(),
    expiresAt: Date.now() + 60000,
  };
  const authority: PrincipalAuthority = {
    async verify(proof: AccessProof) {
      if (
        proof.kind !== 'local' ||
        proof.accessToken !== 'fixture-credential' ||
        revoked
      )
        throw new Error('DENIED');
      return principal;
    },
    async current(id: string) {
      if (id !== principal.sessionId || revoked) throw new Error('DENIED');
      return principal;
    },
  };
  const config = loadConfig({ NODE_ENV: 'test' });
  return {
    config,
    principal,
    authority,
    revoke() {
      revoked = true;
    },
  };
}
test(
  'real Socket.IO handshake, private fanout, forged room rejection and idle revocation',
  {
    timeout: 10000,
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async () => {
    const f = fixture();
    const registry = new RealtimeService(
      f.authority,
      { record() {} },
      'socketio',
    );
    const adapter = new SocketIoService(f.config, f.authority, registry);
    const server = createServer();
    await adapter.attach(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening', { signal: AbortSignal.timeout(3000) });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const options = {
      path: '/realtime',
      transports: ['websocket'],
      extraHeaders: { Origin: f.config.publicOrigin },
      reconnection: false,
      autoConnect: false,
    };
    const denied = io(`http://127.0.0.1:${address.port}`, {
      ...options,
      auth: { sessionId: f.principal.sessionId },
    });
    const client = io(`http://127.0.0.1:${address.port}`, {
      ...options,
      auth: { kind: 'local', accessToken: 'fixture-credential' },
    });
    const forged = io(`http://127.0.0.1:${address.port}`, {
      ...options,
      auth: { kind: 'local', accessToken: 'fixture-credential' },
    });
    try {
      const denial = onceSocket(denied, 'connect_error', 3000);
      denied.connect();
      await denial;
      assert.equal(registry.count(), 0);
      const admitted = onceSocket(client, 'admitted', 3000);
      client.connect();
      await admitted;
      const event = {
        id: randomUUID(),
        type: 'notes.created',
        payload: { noteId: randomUUID() },
      };
      const notification = onceSocket(client, 'notification', 3000);
      assert.equal(
        (await registry.publish(f.principal.accountId, event)).status,
        'attempted',
      );
      assert.deepEqual((await notification)[0], event);
      const siblingAdmission = onceSocket(forged, 'admitted', 3000);
      forged.connect();
      await siblingAdmission;
      const forgedClosed = onceSocket(forged, 'disconnect', 3000);
      forged.emit('subscribe', { accountId: randomUUID(), room: 'foreign' });
      await forgedClosed;
      assert.equal(registry.count(), 1);
      const disconnected = onceSocket(client, 'disconnect', 3000);
      f.revoke();
      await disconnected;
      assert.equal(registry.count(), 0);
    } finally {
      denied.disconnect();
      client.disconnect();
      forged.disconnect();
      registry.close();
      await adapter.close();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
test(
  'real native ws requires first-frame admission and denies replay, expiry and revoked tickets',
  {
    timeout: 10000,
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async () => {
    const f = fixture();
    const config = {
      ...f.config,
      realtime: { ...f.config.realtime, driver: 'ws' as const },
    };
    const vault = new RealtimeTicketService(f.authority, 30);
    const registry = new RealtimeService(f.authority, { record() {} }, 'ws');
    const adapter = new NativeWsService(config, f.authority, vault, registry);
    const server = createServer();
    await adapter.attach(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening', { signal: AbortSignal.timeout(3000) });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const clients: WebSocket[] = [];
    const openClient = async () => {
      const client = new WebSocket(`ws://127.0.0.1:${address.port}/realtime`, {
        origin: config.publicOrigin,
      });
      clients.push(client);
      await once(client, 'open', { signal: AbortSignal.timeout(3000) });
      return client;
    };
    const auth = (client: WebSocket, ticket: string) =>
      client.send(JSON.stringify({ version: 1, type: 'authenticate', ticket }));
    try {
      const client = await openClient();
      assert.equal(registry.count(), 0);
      const issued = await vault.issue(f.principal, 'ws');
      const admitted = once(client, 'message', {
        signal: AbortSignal.timeout(3000),
      });
      auth(client, issued.ticket);
      assert.equal(JSON.parse((await admitted)[0].toString()).type, 'admitted');
      const incoming = once(client, 'message', {
        signal: AbortSignal.timeout(3000),
      });
      await registry.publish(f.principal.accountId, {
        id: randomUUID(),
        type: 'notes.created',
        payload: { noteId: randomUUID() },
      });
      assert.equal(
        JSON.parse((await incoming)[0].toString()).type,
        'notification',
      );
      const replay = await openClient();
      const replayClosed = once(replay, 'close', {
        signal: AbortSignal.timeout(3000),
      });
      auth(replay, issued.ticket);
      await replayClosed;
      const unauthenticated = await openClient();
      const earlyClosed = once(unauthenticated, 'close', {
        signal: AbortSignal.timeout(3000),
      });
      unauthenticated.send(
        JSON.stringify({ version: 1, type: 'ping', requestId: randomUUID() }),
      );
      await earlyClosed;
      const expired = await vault.issue(
        { ...f.principal, expiresAt: Date.now() + 20 },
        'ws',
      );
      await delay(25);
      const expiredClient = await openClient();
      const expiredClosed = once(expiredClient, 'close', {
        signal: AbortSignal.timeout(3000),
      });
      auth(expiredClient, expired.ticket);
      await expiredClosed;
      const pending = await vault.issue(f.principal, 'ws');
      const closed = once(client, 'close', {
        signal: AbortSignal.timeout(3000),
      });
      f.revoke();
      const revokedClient = await openClient();
      const revokedClosed = once(revokedClient, 'close', {
        signal: AbortSignal.timeout(3000),
      });
      auth(revokedClient, pending.ticket);
      await revokedClosed;
      await closed;
      assert.equal(registry.count(), 0);
    } finally {
      for (const client of clients) client.terminate();
      registry.close();
      vault.close();
      await adapter.close();
      if (server.listening)
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
