import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { EventEmitter, once } from 'node:events';
import { pathToFileURL } from 'node:url';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
import type { PrincipalAuthority } from '../templates/runtime/common/src/core/auth/principal-authority.js';
import type { RealtimeStore } from '../templates/runtime/common/src/core/realtime/realtime-store.js';
import type {
  ApplicationEvent,
  PublicationOutcome,
} from '../templates/runtime/common/src/core/realtime/event-publisher.js';
import { realtimeFixture } from './realtime-scale-fixture.ts';

type NativeDatabase = { close(): Promise<void> };
type Tickets = {
  issue(
    p: Principal,
    purpose: 'ws',
  ): Promise<{ ticket: string; expiresAt: number }>;
  consume(ticket: string, purpose: 'ws'): Promise<Principal>;
  close(): void;
};
type Registry = {
  publish(
    account: string,
    event: ApplicationEvent,
  ): Promise<PublicationOutcome>;
  sweep(): Promise<void>;
  close(): void;
};
type Protocol = {
  attach(server: Server): Promise<void>;
  close(): Promise<void>;
};
type Peer = EventEmitter & { connect(): void; close(): void };
async function listen(server: Server): Promise<string> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
for (const kind of ['mongodb', 'postgres'] as const) {
  const url =
    process.env[
      kind === 'mongodb'
        ? 'TEST_REALTIME_MONGODB_URL'
        : 'TEST_REALTIME_POSTGRES_URL'
    ] ??
    (process.env.TEST_DATABASE_KIND === kind
      ? process.env.TEST_DATABASE_URL
      : undefined);
  test(
    kind +
      ' native shared-ticket race, exact lease fencing and official two-runtime Socket.IO fanout',
    {
      skip: !url
        ? 'Requires explicit isolated TEST_REALTIME_' +
          kind.toUpperCase() +
          '_URL (or TEST_DATABASE_URL + TEST_DATABASE_KIND), no fallback'
        : false,
      timeout: 60000,
    },
    async () => {
      const fixture = await realtimeFixture(kind),
        databaseName =
          kind === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase';
      const module = await fixture.load<
        Record<
          string,
          {
            connect(url: string, initialized: boolean): Promise<NativeDatabase>;
          }
        >
      >(
        'core/database/' +
          (kind === 'mongodb' ? 'mongo' : 'postgres') +
          '-database',
      );
      const one = await module[databaseName]!.connect(url!, false);
      let two: NativeDatabase | undefined;
      const registries: Registry[] = [],
        protocols: Protocol[] = [],
        servers: Server[] = [],
        peers: Peer[] = [],
        tickets: Tickets[] = [];
      try {
        const { initializeRealtime } = await fixture.load<{
          initializeRealtime(db: NativeDatabase): Promise<void>;
        }>('modules/realtime/initialize-realtime');
        await initializeRealtime(one);
        await initializeRealtime(one);
        // Raw template fixtures do not receive the renderer's selected cluster hook.
        // Prepare the official adapter schema explicitly, just like a generated release command.
        const { initializeSocketIoCluster } = await fixture.load<{
          initializeSocketIoCluster(db: NativeDatabase): Promise<void>;
        }>('modules/realtime/initialize-socket-io-cluster');
        await initializeSocketIoCluster(one);
        await initializeSocketIoCluster(one);
        two = await module[databaseName]!.connect(url!, false);
        const { RealtimeStoreService } = await fixture.load<{
          RealtimeStoreService: new (db: NativeDatabase) => RealtimeStore;
        }>('modules/realtime/realtime-store.service');
        const first = new RealtimeStoreService(one),
          second = new RealtimeStoreService(two);
        await first.assertInitialized();
        await second.assertInitialized();
        let p: Principal = {
          accountId: randomUUID(),
          sessionId: randomUUID(),
          installationId: randomUUID(),
          installationGeneration: 1,
          expiresAt: Date.now() + 45000,
        };
        const authority: PrincipalAuthority = {
          async verify() {
            return p;
          },
          async current() {
            return p;
          },
        };
        const { RealtimeTicketService } = await fixture.load<{
          RealtimeTicketService: new (
            authority: PrincipalAuthority,
            ttl: number,
            store: RealtimeStore,
          ) => Tickets;
        }>('modules/realtime/realtime-ticket.service');
        const issuer = new RealtimeTicketService(authority, 30, first),
          consumer = new RealtimeTicketService(authority, 30, second);
        tickets.push(issuer, consumer);
        const grant = await issuer.issue(p, 'ws');
        const results = await Promise.allSettled(
          Array.from({ length: 32 }, (_, index) =>
            (index % 2 ? issuer : consumer).consume(grant.ticket, 'ws'),
          ),
        );
        assert.equal(
          results.filter((item) => item.status === 'fulfilled').length,
          1,
        );
        const stale = await issuer.issue(p, 'ws');
        p = { ...p, installationGeneration: 2 };
        await assert.rejects(consumer.consume(stale.ticket, 'ws'));
        const binding = {
          client: randomUUID(),
          principal: p,
          user: 'a'.repeat(64),
          channel: 'private:' + 'b'.repeat(64),
          expiresAt: Date.now() + 10000,
        };
        await first.addBinding(binding, Date.now());
        assert.deepEqual(await second.binding(binding.client), binding);
        assert.equal(
          await second.touchBinding(binding, binding.expiresAt + 1),
          true,
        );
        assert.equal(
          await first.removeBinding(binding),
          false,
          'late old lease must not delete refreshed binding',
        );
        const fresh = await second.binding(binding.client);
        assert.ok(fresh);
        assert.equal(await second.removeBinding(fresh), true);
        const { RealtimeService } = await fixture.load<{
          RealtimeService: new (
            authority: PrincipalAuthority,
            events: { record(input: unknown): void },
            transport: string,
            max: number,
          ) => Registry;
        }>('modules/realtime/realtime.service');
        const { SocketIoClusterService } = await fixture.load<{
          SocketIoClusterService: new (
            store: RealtimeStore,
            configure: (io: unknown) => Promise<void>,
            max: number,
          ) => unknown;
        }>('modules/realtime/socket-io-cluster.service');
        const { configureSocketIoCluster } = await fixture.load<{
          configureSocketIoCluster(
            io: unknown,
            db: NativeDatabase,
          ): Promise<void>;
        }>('modules/realtime/configure-socket-io-cluster');
        const { SocketIoService } = await fixture.load<{
          SocketIoService: new (
            config: unknown,
            authority: PrincipalAuthority,
            registry: Registry,
            cluster: unknown,
          ) => Protocol;
        }>('modules/realtime/socket-io.service');
        const { io } = (await import(
          pathToFileURL(
            fixture.root +
              '/node_modules/socket.io-client/build/esm-debug/index.js',
          ).href
        )) as { io: (origin: string, options: unknown) => Peer };
        for (const [store, db] of [
          [first, one],
          [second, two],
        ] as const) {
          const registry = new RealtimeService(
            authority,
            { record() {} },
            'socketio',
            16384,
          );
          registries.push(registry);
          const cluster = new SocketIoClusterService(
            store,
            (io) => configureSocketIoCluster(io, db),
            16384,
          );
          const protocol = new SocketIoService(
            {
              allowedOrigins: ['http://client.test'],
              auth: { driver: 'local' },
              realtime: { path: '/realtime', maxPayloadBytes: 16384 },
            },
            authority,
            registry,
            cluster,
          );
          protocols.push(protocol);
          const server = createServer();
          servers.push(server);
          await protocol.attach(server);
          const peer = io(await listen(server), {
            path: '/realtime',
            transports: ['websocket'],
            reconnection: false,
            autoConnect: false,
            extraHeaders: { Origin: 'http://client.test' },
            auth: { kind: 'local', accessToken: 'synthetic-proof' },
          });
          peers.push(peer);
          const admitted = once(peer, 'admitted', {
            signal: AbortSignal.timeout(4000),
          });
          peer.connect();
          await admitted;
        }
        const event = {
          id: randomUUID(),
          type: 'native.changed',
          payload: { revision: 1 },
        };
        let localHints = 0,
          remoteHints = 0;
        peers[0]!.on('notification', () => localHints++);
        peers[1]!.on('notification', () => remoteHints++);
        const result = await registries[0]!.publish(p.accountId, event);
        assert.ok(['attempted', 'unknown'].includes(result.status));
        // Official adapter discovery is asynchronous; native membership prevents a false complete result during warmup.
        for (let attempt = 0; remoteHints === 0 && attempt < 15; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await registries[0]!.publish(p.accountId, {
            ...event,
            id: randomUUID(),
          });
        }
        assert.ok(localHints > 0);
        assert.ok(
          remoteHints > 0,
          'official adapter must carry hints to the other native runtime',
        );
        p = { ...p, installationGeneration: 3 };
        const closed = peers.map((peer) =>
          once(peer, 'disconnect', { signal: AbortSignal.timeout(4000) }),
        );
        await Promise.all(registries.map((registry) => registry.sweep()));
        await Promise.all(closed);
      } finally {
        for (const peer of peers) peer.close();
        for (const ticket of tickets) ticket.close();
        for (const registry of registries) registry.close();
        for (const protocol of protocols) await protocol.close();
        for (const server of servers) {
          server.closeAllConnections();
          if (server.listening)
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        await two?.close();
        await one.close();
      }
    },
  );
}
