import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file } from './bundle.js';
import { basicLocalAuth, selection } from './selection.js';

export async function seedFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  if (!selection(config, 'database')) return [];
  const notes = Boolean(selection(config, 'notes'));
  const assets = await Promise.all(
    [
      'scripts/seed.mjs',
      'src/core/database/module-seeder.ts',
      'src/core/database/seed-error.ts',
      'src/seed/run-seeds.ts',
    ].map((path) => bundled(path)),
  );
  for (const asset of assets) asset.ownership = 'managed';
  return [
    ...assets,
    file(
      'src/generated/selected-seeders.ts',
      `import type {ModuleSeed} from '../core/database/module-seeder.js';
${notes ? "import {seedNotes} from '../modules/notes/notes.seed.js';" : ''}
export const requiresIdentitySchema = ${Boolean(selection(config, 'auth')) && !basicLocalAuth(config)};
export const selectedSeeders: readonly ModuleSeed[] = [${notes ? "{module:'notes',run:seedNotes}" : ''}];
`,
    ),
    file(
      'src/seed/custom-seeders.ts',
      `import type {ModuleSeed} from '../core/database/module-seeder.js';

// Import a feature's seed function and add { module: 'orders', run: seedOrders }.
// List seeders in dependency order. The runner owns and closes the database connection.
export const customSeeders: readonly ModuleSeed[] = [];
`,
      'scaffold',
    ),
  ];
}
