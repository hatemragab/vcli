import { basename, resolve } from 'node:path';
import { input, select } from '@inquirer/prompts';
import { projectNameSchema, } from '../contracts.js';
import { applyPlan, checkProject, installProject, planInit, savePlan, summarizePlan, } from '../engine/index.js';
import { CliError } from './cli-error.js';
import { packageRunner } from './package-runner.js';
import { selectRecipes } from './selection-options.js';
export async function initWorkflow(catalog, directory, options, interactive) {
    let target = directory;
    const choices = { ...options };
    if (interactive && !choices.yes && !choices.name) {
        const suggested = target ? basename(resolve(target)) : 'example-api';
        choices.name = await input({
            message: 'Project name',
            default: projectNameSchema.safeParse(suggested).success
                ? suggested
                : 'example-api',
            validate: (value) => projectNameSchema.safeParse(value).success ||
                'Use up to 64 lowercase letters, numbers, hyphens, dots or underscores; start with a letter.',
        });
    }
    if (!target && !choices.name) {
        throw new CliError('MISSING_INPUT', 'Supply a project directory or --name; init . uses a verified empty directory.');
    }
    target ??= choices.name;
    if (!target)
        throw new CliError('MISSING_INPUT', 'Supply a project directory.');
    if (!choices.database && interactive && !choices.yes) {
        const database = await select({
            message: 'Database selected for this project',
            choices: [
                ...(choices.preset === 'api'
                    ? []
                    : [{ name: 'No database — minimal foundation', value: 'none' }]),
                { name: 'MongoDB / Mongoose', value: 'mongodb' },
                { name: 'PostgreSQL / Drizzle + pg', value: 'postgres' },
            ],
        });
        if (database !== 'none')
            choices.database = database;
    }
    if (!choices.auth && choices.database && interactive && !choices.yes) {
        const auth = await select({
            message: 'Authentication',
            choices: [
                ...(choices.preset === 'api'
                    ? []
                    : [{ name: 'No authentication', value: 'none' }]),
                { name: 'Local email/password + JWT', value: 'local' },
                {
                    name: 'Local username/password + JWT (no email or recovery)',
                    value: 'local-username',
                },
                {
                    name: 'Firebase identity + revocable application sessions',
                    value: 'firebase',
                },
            ],
        });
        if (auth === 'local-username') {
            choices.auth = 'local';
            choices.localIdentifier = 'username';
        }
        else if (auth !== 'none')
            choices.auth = auth;
    }
    if (choices.preset && !['minimal', 'api'].includes(choices.preset))
        throw new CliError('INVALID_PRESET', 'Choose minimal or api; the api preset requires an explicit database.');
    if (choices.preset === 'api') {
        if (!choices.database)
            throw new CliError('MISSING_CAPABILITY', 'Select --database mongodb or postgres for the api preset.');
        choices.auth ??= 'local';
        choices.storage ??= 'local';
        choices.realtime ??= 'socket-io';
        choices.media = true;
        choices.notes = true;
        choices.diagnostics = true;
    }
    if (choices.auth === 'local' &&
        choices.localIdentifier !== 'username' &&
        !choices.mail &&
        !choices.with?.some((id) => id.startsWith('mail.'))) {
        if (interactive && !choices.yes)
            choices.mail = await select({
                message: 'Mail provider for email verification and password recovery',
                choices: [
                    {
                        name: 'Capture for development/test (production startup rejects it)',
                        value: 'capture',
                    },
                    { name: 'SMTP (credentials configured privately)', value: 'smtp' },
                    {
                        name: 'Resend HTTP (API credential configured privately)',
                        value: 'http',
                    },
                ],
            });
        else if (choices.yes || choices.preset === 'api')
            choices.mail = 'capture';
    }
    const config = {
        schemaVersion: 1,
        project: {
            name: choices.name ?? basename(resolve(target)),
            packageManager: 'npm',
        },
        capabilities: {
            foundation: { recipe: 'foundation.nest', options: {} },
            ...selectRecipes(catalog, choices),
        },
    };
    const plan = await planInit({
        workspaceDir: process.cwd(),
        projectDir: resolve(target),
        config,
        catalog,
    });
    return applyGeneration(plan, choices);
}
export async function applyGeneration(plan, options) {
    const summary = summarizePlan(plan);
    if (options.savePlan) {
        await savePlan(plan, resolve(options.savePlan));
        return {
            schemaVersion: 1,
            status: 'preview',
            operation: plan.kind,
            data: { ...summary, savedPlan: true },
        };
    }
    if (options.dryRun)
        return {
            schemaVersion: 1,
            status: 'preview',
            operation: plan.kind,
            data: summary,
        };
    const applied = await applyPlan(plan);
    let outcomes = applied.outcomes;
    let pending = applied.pending;
    const runner = packageRunner(!!options.offline);
    if (!options.skipInstall) {
        const install = await installProject(plan.projectDir, { runner });
        outcomes = install.outcomes;
        pending = install.pending;
    }
    if (options.check) {
        const checks = await checkProject(plan.projectDir, { runner });
        outcomes = checks.outcomes;
        pending = checks.pending;
    }
    return {
        schemaVersion: 1,
        status: Object.values(outcomes).includes('failed')
            ? 'failed'
            : Object.values(outcomes).includes('pending')
                ? 'pending'
                : 'completed',
        operation: plan.kind,
        data: { ...summary, changed: applied.changed, outcomes, pending },
    };
}
//# sourceMappingURL=generation-workflows.js.map