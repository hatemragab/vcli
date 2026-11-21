import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Command, CommanderError } from 'commander';
import { recipeCatalog } from './recipes/index.js';
import { withLocalDistribution } from './distribution.js';
import { publicError, writeResult, } from './commands/command-output.js';
import { DeploymentOperatorError } from './deployment/operators/deployment-operator-error.js';
import { registerOperationalCommands } from './commands/operational-commands.js';
import { registerDeploymentCommands } from './commands/deployment-commands.js';
import { registerGenerationCommands } from './commands/generation-commands.js';
import { registerProjectCommands } from './commands/project-commands.js';
import { registerMaintenanceCommands } from './commands/maintenance-commands.js';
export async function runCli(argv) {
    const jsonRequested = argv.includes('--json');
    const program = new Command();
    const catalog = withLocalDistribution(recipeCatalog);
    let operation = 'cli';
    let help = '';
    const emit = (result) => {
        writeResult(result, !!program.opts().json, !!program.opts().verbose);
        if (result.status === 'failed')
            process.exitCode = 1;
    };
    const project = () => resolve(program.opts().project);
    const run = (name, action) => async () => {
        operation = name;
        emit(await action());
    };
    const setOperation = (name) => {
        operation = name;
    };
    const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
    program
        .name('vcli')
        .description('Generate ordinary NestJS projects and safely add selected capabilities.')
        .version(manifest.version)
        .option('--json', 'One structured result on stdout')
        .option('--verbose', 'Print the full result payload in text mode')
        .option('--project <directory>', 'Existing project directory', '.')
        .exitOverride()
        .showSuggestionAfterError(false)
        .configureOutput({
        writeOut: (value) => {
            if (jsonRequested)
                help += value;
            else
                process.stdout.write(value);
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
        interactive: !jsonRequested && !!process.stdin.isTTY && !!process.stdout.isTTY,
    };
    registerOperationalCommands(program, {
        project,
        emit,
        setOperation,
        json: () => !!program.opts().json,
    });
    registerDeploymentCommands(program, { project, emit, setOperation });
    registerGenerationCommands(program, runtime);
    registerProjectCommands(program, runtime, () => ({ ...process.env }));
    registerMaintenanceCommands(program, runtime);
    try {
        await program.parseAsync(argv);
    }
    catch (error) {
        if (error instanceof CommanderError && error.exitCode === 0) {
            if (jsonRequested)
                writeResult({
                    schemaVersion: 1,
                    status: 'completed',
                    operation: 'help',
                    data: { output: help.trim() },
                }, true);
            return;
        }
        writeResult({
            schemaVersion: 1,
            status: 'failed',
            operation,
            errors: [publicError(error)],
            ...(error instanceof DeploymentOperatorError && error.summary
                ? { data: error.summary }
                : {}),
        }, jsonRequested, argv.includes('--verbose'));
        process.exitCode = 1;
    }
}
//# sourceMappingURL=cli.js.map