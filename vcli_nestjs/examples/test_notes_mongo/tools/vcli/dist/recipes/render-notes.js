import { bundled } from './bundle.js';
import { selection } from './selection.js';
/** The functional example is selected explicitly; name-only scaffolds stay unexposed. */
export async function notesFiles(config) {
    const selected = selection(config, 'notes');
    if (!selected)
        return [];
    if (selected !== 'example.notes')
        throw new Error('UNSUPPORTED_NOTES_RECIPE');
    if (Object.keys(config.capabilities.notes.options).length)
        throw new Error('UNSUPPORTED_NOTES_OPTIONS');
    const database = selection(config, 'database');
    if (selection(config, 'foundation') !== 'foundation.nest' ||
        !['database.mongodb', 'database.postgres'].includes(database ?? '') ||
        !selection(config, 'auth'))
        throw new Error('NOTES_REQUIRES_FOUNDATION_DATABASE_AUTH');
    const variant = database === 'database.mongodb' ? 'mongodb' : 'postgres';
    const common = [
        'notes-input.ts',
        'notes-result.ts',
        'notes-authority.ts',
        'notes.controller.ts',
        'README.md',
    ];
    const native = [
        'notes.entity.ts',
        'notes.service.ts',
        'notes.module.ts',
        'initialize-notes.ts',
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
    if (!selection(config, 'realtime')) {
        for (const item of files)
            if (item.path.endsWith('notes.controller.ts'))
                item.content = item.content.replace('Save an owned note, then attempt one advisory realtime hint', 'Save an owned note for the verified principal');
    }
    return files;
}
//# sourceMappingURL=render-notes.js.map