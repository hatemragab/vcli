import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { canonical, hash, json, TOOL_VERSION, validateConfig, validateIdentifier, validateToolchain, } from './data.js';
import { EngineError } from './engine-error.js';
import { recordedFile } from './plan-assembly.js';
import { managedRegion, isManagedDocumentation, mergePackage, replaceRegion, validatePackageFields, } from './managed-content.js';
import { expectedFile, initEntries, projectPath, readRegular, relativePath, resolveDestination, } from './paths.js';
import { applySourceMigrationsToPlan } from './plan-migrations.js';
import { activeGuard, renderCatalog, validatedChecks, validateFiles, } from './plan-validation.js';
import { readProject, validateLock } from './state.js';
async function constructPlan(options) {
    const { projectDir, workspaceDir, kind, config, recipes, rendered, previous, } = options;
    const id = randomUUID();
    const plan = {
        schemaVersion: 1,
        toolVersion: TOOL_VERSION,
        id,
        kind,
        projectDir,
        workspaceDir,
        config,
        recipes,
        changes: [],
        guards: [],
        checks: validatedChecks(rendered.checks),
        warnings: [...rendered.warnings],
        pending: [
            ...new Set([...(previous?.lock.pending ?? []), ...rendered.pending]),
        ],
        outcomes: previous
            ? { ...previous.lock.outcomes }
            : { source: 'pending', install: 'pending', checks: 'pending' },
    };
    if (kind === 'init')
        plan.initialEntries = options.initialEntries ?? [];
    const lock = previous
        ? structuredClone(previous.lock)
        : {
            schemaVersion: 1,
            toolVersion: TOOL_VERSION,
            config,
            recipes,
            files: {},
            packageFields: {},
            checks: plan.checks,
            pending: plan.pending,
            outcomes: {
                source: 'completed',
                install: 'pending',
                checks: 'pending',
            },
            operationId: id,
            migrations: [],
        };
    lock.toolVersion = TOOL_VERSION;
    lock.config = config;
    lock.recipes = recipes;
    lock.checks = plan.checks;
    lock.pending = plan.pending;
    for (const migrationId of options.migrationIds ?? []) {
        validateIdentifier(migrationId);
        if (!lock.migrations.includes(migrationId))
            lock.migrations.push(migrationId);
    }
    if (previous) {
        plan.guards.push({
            path: 'vcli.json',
            expected: { kind: 'hash', hash: hash(previous.configBytes) },
        }, {
            path: 'vcli.lock.json',
            expected: { kind: 'hash', hash: hash(previous.lockBytes) },
        });
        const packageBytes = await readRegular(await projectPath(projectDir, 'package.json'));
        if (!packageBytes)
            throw new EngineError('MANAGED_CONFLICT', 'planning', 'Restore the selected package manifest.');
        validatePackageFields(packageBytes.toString('utf8'), lock.packageFields);
        plan.guards.push({
            path: 'package.json',
            expected: { kind: 'hash', hash: hash(packageBytes) },
        });
    }
    async function change(file, content) {
        const full = await projectPath(projectDir, file.path);
        const expected = await expectedFile(full);
        if (expected.kind === 'hash' && expected.hash === hash(content))
            return;
        plan.changes.push({
            path: file.path,
            ownership: file.ownership,
            expected,
            content,
            hash: hash(content),
        });
    }
    for (const file of [...rendered.files].sort((a, b) => a.path.localeCompare(b.path, 'en'))) {
        const previousOwnership = previous?.lock.files[file.path];
        if (previousOwnership && previousOwnership.ownership !== file.ownership)
            throw new EngineError('MANAGED_CONFLICT', 'planning', 'Keep established file ownership or provide an explicit supported migration.');
        const full = await projectPath(projectDir, file.path);
        if (file.path === 'package.json') {
            if (file.ownership !== 'managed')
                throw new EngineError('INVALID_CATALOG', 'planning', 'Package declarations must use bounded managed ownership.');
            const before = await readRegular(full);
            if (before && !previousOwnership)
                throw new EngineError('MANAGED_CONFLICT', 'planning', 'Do not adopt an unowned package manifest.');
            const merged = mergePackage(before?.toString('utf8') ?? null, file.content, lock.packageFields);
            lock.packageFields = merged.fields;
            lock.files[file.path] = recordedFile(file, { ownership: 'managed' });
            await change(file, merged.content);
            continue;
        }
        if (file.ownership === 'scaffold' && previousOwnership) {
            // Developer source is deliberately not read or hashed during unrelated additions.
            if (kind === 'upgrade' &&
                canonical(recipes) !== canonical(previous?.lock.recipes)) {
                const instruction = `Review copied developer-owned source manually: ${file.path}`;
                if (!plan.pending.includes(instruction))
                    plan.pending.push(instruction);
            }
            continue;
        }
        const region = file.ownership === 'managed' && isManagedDocumentation(file.path)
            ? managedRegion(file.content)
            : null;
        const nextHash = hash(region?.content ?? file.content);
        if (previousOwnership &&
            previousOwnership.hash === nextHash &&
            file.path !== 'src/generated/vcli-app.module.ts')
            continue;
        const before = await readRegular(full);
        if (previousOwnership) {
            const beforeRegion = previousOwnership.region && before
                ? managedRegion(before.toString('utf8'))
                : null;
            if (!before ||
                (previousOwnership.region && !beforeRegion) ||
                hash(beforeRegion?.content ?? before) !== previousOwnership.hash)
                throw new EngineError('MANAGED_CONFLICT', 'planning', 'A relevant managed file changed; restore its managed region or review a manual patch.');
            plan.guards.push({
                path: file.path,
                expected: { kind: 'hash', hash: hash(before) },
            });
        }
        else if (before)
            throw new EngineError('MANAGED_CONFLICT', 'planning', 'A generated path already belongs to the developer; choose a different name or resolve it manually.');
        const content = before && region
            ? replaceRegion(before.toString('utf8'), file.content)
            : file.content;
        await change(file, content);
        lock.files[file.path] = recordedFile(file, file.ownership === 'scaffold'
            ? { ownership: 'scaffold' }
            : {
                ownership: 'managed',
                hash: nextHash,
                ...(region ? { region: true } : {}),
            });
    }
    await applySourceMigrationsToPlan({
        projectDir,
        kind,
        previous,
        sourceMigrations: options.sourceMigrations,
        plan,
        lock,
        recordChange: change,
    });
    const configChanged = !previous || canonical(config) !== canonical(previous.config);
    if (configChanged)
        await change({ path: 'vcli.json', content: '', ownership: 'managed' }, json(config));
    const stateChanged = !previous ||
        canonical({ ...lock, operationId: '', outcomes: undefined }) !==
            canonical({ ...previous.lock, operationId: '', outcomes: undefined });
    if (plan.changes.length || stateChanged) {
        const dependenciesChanged = !previous ||
            canonical(lock.packageFields) !==
                canonical(previous.lock.packageFields) ||
            Object.entries(lock.packageFields).some(([field, value]) => {
                if (!/^\/(?:dependencies|devDependencies)\//.test(field) ||
                    typeof value !== 'string' ||
                    !value.startsWith('file:'))
                    return false;
                const directory = relativePath(value.slice(5));
                return plan.changes.some((change) => change.path === directory ||
                    change.path.startsWith(directory + '/'));
            });
        lock.operationId = id;
        lock.outcomes = {
            source: 'completed',
            install: dependenciesChanged
                ? 'pending'
                : (previous?.lock.outcomes.install ?? 'pending'),
            checks: 'pending',
        };
        plan.outcomes = { ...lock.outcomes, source: 'pending' };
        validateLock(lock);
        await change({ path: 'vcli.lock.json', content: '', ownership: 'managed' }, json(lock));
    }
    plan.changes.sort((a, b) => a.path === 'vcli.lock.json'
        ? 1
        : b.path === 'vcli.lock.json'
            ? -1
            : a.path.localeCompare(b.path, 'en'));
    return plan;
}
export async function planInit(options) {
    validateToolchain();
    const destination = await resolveDestination(options.workspaceDir, options.projectDir);
    const entries = await initEntries(destination.projectDir);
    const result = await renderCatalog(validateConfig(options.config), options.catalog);
    if (!result.rendered.files.some((file) => file.path === 'package.json'))
        throw new EngineError('INVALID_CATALOG', 'planning', 'Foundation must render a package manifest.');
    return constructPlan({
        ...destination,
        kind: 'init',
        ...result,
        initialEntries: entries,
    });
}
export async function planAdd(options) {
    validateToolchain();
    const previous = await readProject(options.projectDir);
    await activeGuard(previous.projectDir);
    const desired = validateConfig({
        ...previous.config,
        capabilities: { ...previous.config.capabilities, ...options.selections },
    });
    const result = await renderCatalog(desired, options.catalog);
    for (const [family, selection] of Object.entries(previous.config.capabilities))
        if (canonical(result.config.capabilities[family]) !== canonical(selection))
            throw new EngineError('STATE_DRIFT', 'planning', 'Ordinary add cannot replace an installed provider or its realized options; use a supported migration.');
    for (const installed of previous.lock.recipes)
        if (!result.recipes.some((recipe) => canonical(recipe) === canonical(installed)))
            throw new EngineError('STATE_DRIFT', 'planning', 'Use the explicit upgrade lifecycle for changed recipe versions.');
    return constructPlan({
        projectDir: previous.projectDir,
        workspaceDir: path.dirname(previous.projectDir),
        kind: 'add',
        previous,
        ...result,
    });
}
export async function planScaffold(options) {
    validateToolchain();
    const previous = await readProject(options.projectDir);
    await activeGuard(previous.projectDir);
    validateFiles(options.files);
    if (options.files.some((file) => file.ownership !== 'scaffold' ||
        ['package.json', 'README.md', 'AGENTS.md'].includes(file.path) ||
        previous.lock.files[file.path]))
        throw new EngineError('MANAGED_CONFLICT', 'planning', 'Scaffold only new developer-owned paths and choose unused names.');
    return constructPlan({
        projectDir: previous.projectDir,
        workspaceDir: path.dirname(previous.projectDir),
        kind: 'scaffold',
        previous,
        config: previous.config,
        recipes: previous.lock.recipes,
        rendered: {
            files: options.files,
            checks: options.checks ?? previous.lock.checks,
            pending: [
                ...new Set([...previous.lock.pending, ...(options.pending ?? [])]),
            ],
            warnings: [],
        },
    });
}
/** Exact curated release edges reuse the source lifecycle; provider changes and arbitrary codemods are excluded. */
export async function planUpgrade(options) {
    validateToolchain();
    const previous = await readProject(options.projectDir);
    await activeGuard(previous.projectDir);
    const result = await renderCatalog(previous.config, options.catalog);
    if (new Set(options.sourceMigrations ?? []).size !==
        (options.sourceMigrations ?? []).length)
        throw new EngineError('INVALID_OPTIONS', 'migration', 'Request each named copied-source migration once.');
    const migrationIds = [];
    for (const old of previous.lock.recipes) {
        const next = result.recipes.find((recipe) => recipe.id === old.id && recipe.family === old.family);
        if (!next)
            throw new EngineError('STATE_DRIFT', 'upgrade', 'Installed recipe removal or provider switching requires a separate supported migration.');
        if (next.version !== old.version) {
            const edges = (options.upgrades ?? []).filter((edge) => edge.recipe === old.id &&
                edge.from === old.version &&
                edge.to === next.version);
            if (edges.length !== 1)
                throw new EngineError('STATE_DRIFT', 'upgrade', 'Supply exactly one curated migration edge for each changed recipe version; release gaps are not inferred.');
            validateIdentifier(edges[0].migrationId);
            migrationIds.push(edges[0].migrationId);
        }
    }
    if (canonical(previous.config) !== canonical(result.config))
        throw new EngineError('STATE_DRIFT', 'upgrade', 'Recipe option changes require an explicit migration; retain the installed choices.');
    return constructPlan({
        projectDir: previous.projectDir,
        workspaceDir: path.dirname(previous.projectDir),
        kind: 'upgrade',
        previous,
        migrationIds,
        sourceMigrations: options.sourceMigrations,
        ...result,
    });
}
export function summarizePlan(plan) {
    return {
        schemaVersion: 1,
        operationId: plan.id,
        kind: plan.kind,
        project: plan.config.project.name,
        recipes: structuredClone(plan.recipes),
        changes: plan.changes.map(({ path, expected, ownership }) => ({
            path,
            action: expected.kind === 'absent' ? 'create' : 'replace',
            ownership,
        })),
        outcomes: { ...plan.outcomes },
        warnings: [...plan.warnings],
        pending: [...plan.pending],
    };
}
//# sourceMappingURL=planning.js.map