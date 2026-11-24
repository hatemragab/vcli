import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled } from './bundle.js';
import { selection } from './selection.js';
import { replaceExact } from './template-markers.js';

function selectNotesMedia(source: string, media: boolean): string {
  const selected = source.replace(
    /^[ \t]*(?:\/\/ vcli:notes-media:start|<!-- vcli:notes-media:start -->)\n([\s\S]*?)^[ \t]*(?:\/\/ vcli:notes-media:end|<!-- vcli:notes-media:end -->)\n/gm,
    (_marker, content: string) => (media ? content : ''),
  );
  if (selected.includes('vcli:notes-media:'))
    throw new Error('INVALID_NOTES_MEDIA_TEMPLATE');
  return selected;
}

function withMediaModule(
  source: string,
  path: string,
  native: 'MongoDatabase' | 'PostgresDatabase',
): string {
  const changes = [
    [
      'import { NotesController }',
      "import { MediaModule } from '../media/media.module.js';\nimport { MediaService } from '../media/media.service.js';\nimport { NotesController }",
    ],
    [
      'const notesServiceBinding = bootstrapBinding(NotesService);\nexport const bindNotesService = notesServiceBinding.bind;',
      `type NotesDependencies = Readonly<{
  database: ${native};
  authority: PrincipalAuthority;
  publisher?: EventPublisher;
}>;
const NOTES_DEPENDENCIES = Symbol('NotesDependencies');
const notesBinding = bootstrapBinding<NotesDependencies>(NOTES_DEPENDENCIES);`,
    ],
    [
      'imports: [HttpSecurityModule]',
      'imports: [HttpSecurityModule, MediaModule]',
    ],
    [
      'providers: [notesServiceBinding.provider]',
      `providers: [
    notesBinding.provider,
    {
      provide: NotesService,
      inject: [NOTES_DEPENDENCIES, MediaService],
      useFactory: (dependencies: NotesDependencies, media: MediaService) =>
        new NotesService(dependencies.database, dependencies.authority, dependencies.publisher, media),
    },
  ]`,
    ],
    [
      'bindNotesService(new NotesService(database, authority, publisher))',
      'notesBinding.bind({ database, authority, publisher })',
    ],
  ] as const;
  return changes.reduce(
    (content, [before, after]) => replaceExact(content, before, after, path),
    source,
  );
}

/** The functional example is selected explicitly; name-only scaffolds stay unexposed. */
export async function notesFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const selected = selection(config, 'notes');
  if (!selected) return [];
  if (selected !== 'example.notes') throw new Error('UNSUPPORTED_NOTES_RECIPE');
  if (Object.keys(config.capabilities.notes!.options).length)
    throw new Error('UNSUPPORTED_NOTES_OPTIONS');
  const database = selection(config, 'database');
  if (
    selection(config, 'foundation') !== 'foundation.nest' ||
    !['database.mongodb', 'database.postgres'].includes(database ?? '') ||
    !selection(config, 'auth')
  )
    throw new Error('NOTES_REQUIRES_FOUNDATION_DATABASE_AUTH');
  const variant = database === 'database.mongodb' ? 'mongodb' : 'postgres';
  const media = selection(config, 'media') === 'media.private';
  const common = [
    'notes-input.ts',
    'notes-result.ts',
    'notes-authority.ts',
    'notes.controller.ts',
    'notes.seed.ts',
    'README.md',
    ...(media ? ['notes-image.ts'] : []),
  ];
  const native = [
    'notes.entity.ts',
    'notes.service.ts',
    'notes.module.ts',
    'notes-seed-store.ts',
    'initialize-notes.ts',
    ...(media ? ['initialize-notes-image.ts'] : []),
  ];
  const files = await Promise.all([
    ...common.map((name) => bundled('src/modules/notes/' + name)),
    ...native.map((name) => bundled('src/modules/notes/' + name, variant)),
    bundled('clients/notes-client.mjs'),
    bundled('test/notes.test.mjs'),
    ...(!selection(config, 'realtime')
      ? [bundled('src/core/realtime/event-publisher.ts')]
      : []),
  ]);
  for (const item of files) {
    item.content = selectNotesMedia(item.content, media);
    if (!media) continue;
    if (item.path.endsWith('/notes.module.ts'))
      item.content = withMediaModule(
        item.content,
        item.path,
        variant === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase',
      );
    if (item.path.endsWith('/notes.entity.ts')) {
      // The baseline entity bytes also identify the existing notes v1 release.
      const anchor =
        variant === 'mongodb' ? '    createdAt: {' : '  createdAt: bigint(';
      const imageField =
        variant === 'mongodb'
          ? '    imageId: { type: String },\n'
          : "  imageId: uuid('image_id'),\n";
      item.content = replaceExact(
        item.content,
        anchor,
        imageField + anchor,
        item.path,
      );
    }
  }
  if (!selection(config, 'realtime')) {
    for (const item of files)
      if (item.path.endsWith('notes.controller.ts'))
        item.content = item.content.replace(
          'Save an owned note, then attempt one advisory realtime hint',
          'Save an owned note for the verified principal',
        );
  }
  return files;
}
