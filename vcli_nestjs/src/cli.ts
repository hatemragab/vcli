import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { recipeCatalog } from './recipes/index.js';
import { withLocalDistribution } from './distribution.js';
import {
  publicError,
  writeResult,
  type CommandResult,
} from './commands/command-output.js';
import { DeploymentOperatorError } from './deployment/operators/deployment-operator-error.js';
import { registerOperationalCommands } from './commands/operational-commands.js';
import { registerDeploymentCommands } from './commands/deployment-commands.js';
import { registerGenerationCommands } from './commands/generation-commands.js';
import { registerProjectCommands } from './commands/project-commands.js';
import { registerMaintenanceCommands } from './commands/maintenance-commands.js';
import { registerFirebaseCommands } from './commands/firebase-commands.js';
import { registerOpenApiCommands } from './commands/openapi-commands.js';

interface GlobalOptions {
  json?: boolean;
  verbose?: boolean;
  project: string;
}

export async function runCli(argv: string[]): Promise<void> {
  const jsonRequested = argv.includes('--json');
  const program = new Command();
  const catalog = withLocalDistribution(recipeCatalog);
  let operation = 'cli';
  let help = '';
  const emit = (result: CommandResult) => {
    writeResult(
      result,
      !!program.opts<GlobalOptions>().json,
      !!program.opts<GlobalOptions>().verbose,
    );
    if (result.status === 'failed') process.exitCode = 1;
  };
  const project = () => resolve(program.opts<GlobalOptions>().project);
  const run =
    (name: string, action: () => Promise<CommandResult>) => async () => {
      operation = name;
      emit(await action());
    };
  const setOperation = (name: string) => {
    operation = name;
  };
  const manifest: { version: string } = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  );
  program
    .name('vcli')
    .description(
      'Generate ordinary NestJS projects and safely add selected capabilities.',
    )
    .version(manifest.version)
    .option('--json', 'One structured result on stdout')
    .option('--verbose', 'Print the full result payload in text mode')
    .option('--project <directory>', 'Existing project directory', '.')
    .exitOverride()
    .showSuggestionAfterError(false)
    .configureOutput({
      writeOut: (value) => {
        if (jsonRequested) help += value;
        else process.stdout.write(value);
      },
      writeErr: () => undefined,
      outputError: () => undefined,
    });
  const runtime = {
    catalog,
    project,
    emit,
    run,
    setOperation,
    manifestVersion: manifest.version,
    interactive:
      !jsonRequested && !!process.stdin.isTTY && !!process.stdout.isTTY,
  };
  registerOperationalCommands(program, {
    project,
    emit,
    setOperation,
    json: () => !!program.opts<GlobalOptions>().json,
  });
  registerDeploymentCommands(program, { project, emit, setOperation });
  registerGenerationCommands(program, runtime);
  registerProjectCommands(program, runtime, () => ({ ...process.env }));
  registerMaintenanceCommands(program, runtime);
  registerFirebaseCommands(program, runtime);
  registerOpenApiCommands(program, runtime);
  try {
    await program.parseAsync(argv);
  } catch (error: unknown) {
    if (error instanceof CommanderError && error.exitCode === 0) {
      if (jsonRequested)
        writeResult(
          {
            schemaVersion: 1,
            status: 'completed',
            operation: 'help',
            data: { output: help.trim() },
          },
          true,
        );
      return;
    }
    writeResult(
      {
        schemaVersion: 1,
        status: 'failed',
        operation,
        errors: [publicError(error)],
        ...(error instanceof DeploymentOperatorError && error.summary
          ? { data: error.summary }
          : {}),
      },
      jsonRequested,
      argv.includes('--verbose'),
    );
    process.exitCode = 1;
  }
}
