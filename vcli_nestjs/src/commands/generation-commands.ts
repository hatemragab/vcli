import { resolve } from 'node:path';
import type { Command } from 'commander';
import { planAdd, planScaffold, readPlan } from '../engine/index.js';
import { readProject } from '../engine/state.js';
import { renderScaffold } from '../recipes/index.js';
import {
  injectableCapabilities,
  scaffoldKinds,
  type ScaffoldKind,
} from '../recipes/render-scaffold.js';
import {
  applyGeneration,
  initWorkflow,
  type ApplyCommandOptions,
  type InitCommandOptions,
} from './generation-workflows.js';
import { selectRecipes, type SelectionOptions } from './selection-options.js';
import { applyOptions, capabilityOptions, collect } from './command-options.js';
import { CliError } from './cli-error.js';
import type { CliRuntime } from './command-context.js';

export function registerGenerationCommands(
  program: Command,
  runtime: CliRuntime,
): void {
  const init = capabilityOptions(
    applyOptions(
      program
        .command('init [directory]')
        .description(
          'Create a new project or initialize a verified empty directory',
        ),
    ),
  )
    .option('--name <name>', 'Package/project name')
    .option(
      '--redis-docker',
      'Generate optional local Redis Compose for the selected authentication recipe',
    )
    .option(
      '-y, --yes',
      'Use documented safe defaults without interactive prompts',
    )
    .option(
      '--preset <preset>',
      'minimal or api (requires a database; defaults to basic local auth with storage and diagnostics)',
    );
  init.action(
    async (directory: string | undefined, options: InitCommandOptions) => {
      runtime.setOperation('init');
      runtime.emit(
        await initWorkflow(
          runtime.catalog,
          directory,
          options,
          runtime.interactive,
        ),
      );
    },
  );
  const add = capabilityOptions(
    applyOptions(
      program
        .command('add <recipe>')
        .description(
          'Add a curated recipe without rewriting custom feature source',
        ),
    ),
  ).option('--options <json>', 'Nonsecret options for the named recipe');
  add.action(
    async (recipe: string, options: SelectionOptions & ApplyCommandOptions) => {
      runtime.setOperation('add');
      const plan = await planAdd({
        projectDir: runtime.project(),
        selections: selectRecipes(runtime.catalog, options, recipe),
        catalog: runtime.catalog,
      });
      runtime.emit(await applyGeneration(plan, options));
    },
  );
  const uses = Object.keys(injectableCapabilities).join(', ');
  const generate = applyOptions(
    program
      .command('g <kind> <name>')
      .description(
        'Generate a typed scaffold; name-only operations remain unexposed',
      ),
  ).option(
    '--use <capability>',
    `Explicit feature dependency: ${uses} (repeatable)`,
    collect,
    [],
  );
  generate.action(
    async (
      kind: string,
      name: string,
      options: ApplyCommandOptions & { use: string[] },
    ) => {
      runtime.setOperation('g');
      const state = await readProject(runtime.project());
      if (!scaffoldKinds.includes(kind))
        throw new CliError(
          'UNKNOWN_SCAFFOLD_KIND',
          `Choose ${scaffoldKinds.join(', ')}.`,
        );
      const generated = await renderScaffold(state.config, {
        kind: kind as ScaffoldKind,
        name,
        uses: options.use,
      });
      const plan = await planScaffold({
        projectDir: runtime.project(),
        files: generated.files,
        checks: generated.checks,
        pending: [...generated.pending, ...generated.warnings],
      });
      runtime.emit(await applyGeneration(plan, options));
    },
  );
  const apply = applyOptions(
    program
      .command('apply <plan>')
      .description('Recheck and apply an explicitly saved plan'),
  );
  apply.action(async (file: string, options: ApplyCommandOptions) => {
    runtime.setOperation('apply');
    runtime.emit(await applyGeneration(await readPlan(resolve(file)), options));
  });
}
