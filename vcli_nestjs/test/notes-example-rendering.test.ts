import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  notesConfig,
  notesFixture,
  notesRenderers,
  sourceText,
} from './notes-example-fixture.ts';
import type { RenderedFile } from '../src/contracts.ts';

type Manifest = {
  id: string;
  components: { component: string; version: number; digest: string }[];
};
function manifest(files: RenderedFile[]): Manifest {
  const source = files.find(
    (file) => file.path === 'src/generated/selected-release.ts',
  )!.content;
  return JSON.parse(
    /builtInRelease:ReleaseManifest=(.+);/.exec(source)![1]!,
  ) as Manifest;
}
for (const database of ['mongodb', 'postgres'] as const) {
  test(`notes ${database}: deterministic selected native closure, no fictional transport, scaffold ownership`, async () => {
    const { notes } = await notesRenderers();
    const config = notesConfig(database);
    const files = await notes.notesFiles(config);
    assert.deepEqual(files, await notes.notesFiles(config));
    assert.equal(new Set(files.map((file) => file.path)).size, files.length);
    assert(files.every((file) => file.ownership === 'scaffold'));
    assert(
      files.some(
        (file) => file.path === 'src/core/realtime/event-publisher.ts',
      ),
    );
    assert(files.some((file) => file.path === 'clients/notes-client.mjs'));
    assert(files.some((file) => file.path === 'test/notes.test.mjs'));
    for (const source of files) {
      assert.doesNotMatch(
        source.content,
        /examples\/|reference_notes|RepositoryAdapter|forwardRef|ModuleRef|@Global|\/home\//,
      );
      assert.doesNotMatch(
        source.content,
        database === 'mongodb'
          ? /from ['"](?:drizzle-orm|pg)/
          : /from ['"](?:mongoose|mongodb)/,
      );
    }
    const native = files.find(
      (file) => file.path === 'src/modules/notes/notes.entity.ts',
    )!;
    assert.match(native.content, /app_notes/);
    const module = files.find(
      (file) => file.path === 'src/modules/notes/notes.module.ts',
    )!.content;
    assert.match(module, /assertNotesInitialized\(database\)/);
    assert.doesNotMatch(
      module,
      /openDatabase|\.close\(|initializeNotes\(database\)/,
    );
    const realtimeFiles = await notes.notesFiles(
      notesConfig(database, 'native-ws'),
    );
    assert(
      !realtimeFiles.some(
        (file) => file.path === 'src/core/realtime/event-publisher.ts',
      ),
    );
    assert.deepEqual(
      await notes.notesFiles({
        ...config,
        capabilities: { foundation: config.capabilities.foundation! },
      }),
      [],
    );
  });
  test(`notes ${database}: release contribution, exact callback order and unchanged existing owner digests`, async () => {
    const { schema } = await notesRenderers();
    const config = notesConfig(database, 'socket-io');
    config.capabilities.realtime!.options.scale = 'cluster';
    config.capabilities.mail = {
      recipe: 'mail.capture',
      options: { reliableActions: true },
    };
    config.capabilities.media = { recipe: 'media.private', options: {} };
    config.capabilities['push-fcm'] = { recipe: 'push.fcm', options: {} };
    const files = schema.schemaFiles(config),
      selected = manifest(files);
    const notes = selected.components.find(
      (component) => component.component === 'notes',
    );
    assert.equal(notes?.version, 1);
    assert.match(notes!.digest, /^[0-9a-f]{64}$/);
    const baseline = structuredClone(config);
    delete baseline.capabilities.notes;
    const previous = manifest(schema.schemaFiles(baseline));
    assert.deepEqual(
      selected.components.filter(
        (component) => component.component !== 'notes',
      ),
      previous.components,
    );
    assert.notEqual(selected.id, previous.id);
    const initializer = files.find(
      (file) => file.path === 'src/generated/initialize-selected-schemas.ts',
    )!.content;
    assert.deepEqual(
      [...initializer.matchAll(/component:'([^']+)'/g)].map(
        (match) => match[1],
      ),
      selected.components.map((component) => component.component),
    );
    assert.match(initializer, /initializeNotes\(database\)/);
    assert.match(initializer, /finally\{await database.close\(\);\}/);
    assert(
      !schema
        .schemaFiles(baseline)
        .some((file) => file.content.includes('initializeNotes')),
    );
  });
  test(`notes ${database}: isolated strict compilation and acyclic ordinary Nest source`, async () => {
    const { root } = await notesFixture(database);
    const { checkArchitecture } = (await import(
      new URL(
        `../var/cli-notes/${database}/architecture-rules.ts`,
        import.meta.url,
      ).href
    )) as {
      checkArchitecture(path: string): Promise<{ failures: readonly string[] }>;
    };
    assert.deepEqual((await checkArchitecture(root + '/src')).failures, []);
  });
}
test('notes: reject absent requirements/options and reserve built-in owner name', async () => {
  const { notes, scaffold } = await notesRenderers();
  const config = notesConfig('postgres');
  for (const family of ['foundation', 'database', 'auth']) {
    const invalid = structuredClone(config);
    delete invalid.capabilities[family];
    await assert.rejects(
      notes.notesFiles(invalid),
      /NOTES_REQUIRES_FOUNDATION_DATABASE_AUTH/,
    );
  }
  const options = structuredClone(config);
  options.capabilities.notes!.options = { public: true };
  await assert.rejects(notes.notesFiles(options), /UNSUPPORTED_NOTES_OPTIONS/);
  await assert.rejects(
    scaffold.renderScaffold(config, { kind: 'feature', name: 'notes' }),
    /INVALID_OR_RESERVED_SCAFFOLD_NAME/,
  );
  const generated = await scaffold.renderScaffold(config, {
    kind: 'feature',
    name: 'note-reports',
    uses: ['notes'],
  });
  assert(
    generated.files.some((file) =>
      file.content.includes("from '../notes/notes.service.js'"),
    ),
  );
  assert(
    generated.pending.some((message) =>
      message.includes('notes:capabilities.notes!'),
    ),
  );
  const absent = structuredClone(config);
  delete absent.capabilities.notes;
  await assert.rejects(
    scaffold.renderScaffold(absent, {
      kind: 'feature',
      name: 'note-reports',
      uses: ['notes'],
    }),
    /SCAFFOLD_CAPABILITY_NOT_SELECTED/,
  );
  assert.match(
    await sourceText('templates/runtime/common/clients/notes-client.mjs'),
    /Never automatically retry POST/,
  );
});
