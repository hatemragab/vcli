import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderedRealtime } from './realtime-scale-fixture.ts';
for (const database of ['mongodb', 'postgres'] as const) {
  for (const transport of ['socket-io', 'native-ws', 'centrifugo']) {
    for (const scale of transport === 'native-ws'
      ? ['single-instance']
      : ['single-instance', 'cluster']) {
      test(
        database +
          '/' +
          transport +
          '/' +
          scale +
          ' emits selected native store, explicit schema, protocol and topology only',
        async () => {
          const files = await renderedRealtime(database, transport, scale),
            source = (path: string) => {
              const file = files.find((file) => file.path === path);
              assert.ok(file, path);
              return file.content;
            };
          const module = source('src/modules/realtime/realtime.module.ts');
          assert.match(
            module,
            /events:DiagnosticEvents,database:(MongoDatabase|PostgresDatabase)/,
          );
          assert.match(module, /await store.assertInitialized/);
          assert.doesNotMatch(module, /initializeRealtime\(/);
          const ticketPath = 'src/modules/realtime/realtime-ticket.service.ts';
          const issuesTickets = transport !== 'socket-io';
          assert.equal(
            files.some((file) => file.path === ticketPath),
            issuesTickets,
          );
          assert.equal(module.includes('RealtimeTicketService'), issuesTickets);
          assert.equal(module.includes('tickets.close()'), issuesTickets);
          assert.match(
            source('src/modules/realtime/initialize-realtime.ts'),
            /realtime-v1/,
          );
          assert.equal(
            source('src/modules/realtime/initialize-realtime.ts').includes(
              'await initializeSocketIoCluster(database)',
            ),
            transport === 'socket-io' && scale === 'cluster',
          );
          assert.equal(
            files.some((file) =>
              file.path.endsWith('initialize-socket-io-cluster.ts'),
            ),
            transport === 'socket-io' && scale === 'cluster',
          );
          assert.match(
            source('src/modules/realtime/realtime-store.service.ts'),
            database === 'mongodb'
              ? /findOneAndDelete/
              : /DELETE FROM vcli_realtime_records/,
          );
          assert.doesNotMatch(
            files.map((file) => file.content).join('\n'),
            database === 'mongodb'
              ? /PostgresDatabase|drizzle-orm|postgres-adapter/
              : /MongoDatabase|mongoose|mongo-adapter/,
          );
          assert.match(
            source('src/modules/realtime/protocol-validation.ts'),
            /installationGeneration !== original.installationGeneration/,
          );
          assert.match(
            source('src/modules/realtime/realtime.controller.ts'),
            new RegExp("scale:'" + scale + "'"),
          );
          assert.equal(
            files.some((file) =>
              file.path.endsWith('configure-socket-io-cluster.ts'),
            ),
            transport === 'socket-io' && scale === 'cluster',
          );
          if (transport === 'centrifugo') {
            const config = JSON.parse(source('ops/centrifugo/config.json')) as {
              engine: { type: string };
              client: {
                proxy: Record<
                  string,
                  { http_headers: string[]; emulated_headers: string[] }
                >;
              };
            };
            assert.equal(
              config.engine.type,
              scale === 'cluster' ? 'redis' : 'memory',
            );
            for (const proxy of Object.values(config.client.proxy)) {
              assert.deepEqual(proxy.http_headers, []);
              assert.deepEqual(proxy.emulated_headers, []);
            }
            const manifest = JSON.parse(
              source('ops/centrifugo/service-requirements.json'),
            ) as { dependencies: unknown[]; image: string };
            assert.equal(
              manifest.dependencies.length,
              scale === 'cluster' ? 1 : 0,
            );
            assert.equal(manifest.image, 'centrifugo/centrifugo:v6.10.3');
            assert.equal(
              source('ops/centrifugo/compose.yml').includes(
                'CENTRIFUGO_ENGINE_REDIS_ADDRESS',
              ),
              scale === 'cluster',
            );
          } else
            assert.equal(
              files.some((file) => file.path.startsWith('ops/centrifugo')),
              false,
            );
        },
      );
    }
  }
}
test('native ws cluster and unknown scale fail before returning a desired file set', async () => {
  await assert.rejects(
    renderedRealtime('postgres', 'native-ws', 'cluster'),
    /UNSUPPORTED_REALTIME_SCALE/,
  );
  await assert.rejects(
    renderedRealtime('postgres', 'socket-io', 'invented'),
    /UNSUPPORTED_REALTIME_SCALE/,
  );
});
