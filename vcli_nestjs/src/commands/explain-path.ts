import path from 'node:path';
import type { RenderedFile } from '../contracts.js';
import { resolveRecipes } from '../engine/resolve-recipes.js';
import { readProject } from '../engine/state.js';
import { recipeCatalog } from '../recipes/catalog.js';
import { CliError } from './cli-error.js';

function focused(
  relative: string,
  ownership: string,
  hasNotesTest: boolean,
): string {
  if (relative.startsWith('tools/vcli/')) return 'npm test';
  if (relative.includes('load-config.ts')) return 'vcli config check';
  if (
    relative.startsWith('src/modules/notes/') ||
    relative === 'test/notes.test.mjs'
  )
    return hasNotesTest
      ? 'npm run build && node --test test/notes.test.mjs'
      : 'npm run check';
  if (relative.startsWith('src/modules/diagnostics/'))
    return 'vcli logs status';
  if (ownership === 'managed') return 'vcli check --only typecheck';
  return 'npm test';
}

/** Read-only owner lookup. Older locks without provenance say unknown. */
export async function explainPath(
  root: string,
  relative: string,
): Promise<Record<string, unknown>> {
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative.split(/[\\/]/).includes('..') ||
    !/^[A-Za-z0-9_./:-]{1,180}$/.test(relative)
  )
    throw new CliError(
      'UNSAFE_PATH',
      'Explain one relative project path without parent segments.',
    );
  if (relative.startsWith('tools/vcli/'))
    return {
      path: relative,
      owner: 'pinned-tooling',
      provenance: 'distribution',
      hint: 'Fix the generator source. Do not edit the pinned copy under tools/vcli.',
      check: 'npm test',
      evidence: 'generator-source',
    };
  const state = await readProject(root);
  const recorded = state.lock.files[relative];
  let rendered: RenderedFile | undefined;
  if (!recorded?.provenance) {
    try {
      const resolved = resolveRecipes(state.config, recipeCatalog);
      const project = await recipeCatalog.render(
        resolved.config,
        resolved.recipes,
      );
      rendered = project.files.find((file) => file.path === relative);
    } catch {
      rendered = undefined;
    }
  }
  const provenance = recorded?.provenance ?? rendered?.provenance;
  const ownership = recorded?.ownership ?? rendered?.ownership ?? 'unknown';
  return {
    path: relative,
    owner: ownership,
    renderer: provenance?.renderer ?? 'unknown',
    ...(provenance?.template ? { template: provenance.template } : {}),
    provenance: recorded?.provenance
      ? 'project-lock'
      : rendered?.provenance
        ? 'selected-render'
        : 'unknown',
    check: focused(
      relative,
      ownership,
      Object.hasOwn(state.lock.files, 'test/notes.test.mjs'),
    ),
    evidence: recorded?.provenance ? 'project-lock' : 'selected-render',
  };
}
