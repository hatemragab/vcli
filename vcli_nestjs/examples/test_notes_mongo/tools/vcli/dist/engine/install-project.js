import path from 'node:path';
import { hash, parseJson } from './data.js';
import { EngineError } from './engine-error.js';
import { checkManagedManifest, executableState, remember, spawnCommand, updateState, } from './execution-shared.js';
import { installationHealthy, localFileDependencyHealthy, } from './inspection.js';
import { withProjectLock } from './operation-storage.js';
import { assertNoSymlinks, projectPath, readRegular, relativePath, statOrNull, } from './paths.js';
async function selectedLocalInstallArgs(projectDir, fields, files) {
    const args = [];
    for (const [field, value] of Object.entries(fields)) {
        const match = /^\/(?:dependencies|devDependencies)\/([^/]+)$/.exec(field);
        if (!match || typeof value !== 'string' || !value.startsWith('file:'))
            continue;
        const name = match[1].replaceAll('~1', '/').replaceAll('~0', '~');
        if (!/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/i.test(name))
            throw new EngineError('INVALID_STATE', 'install', 'Use a valid selected local package name.');
        const directory = relativePath(value.slice(5));
        const manifestPath = directory + '/package.json';
        const manifest = await readRegular(await projectPath(projectDir, manifestPath));
        const provenance = files[manifestPath];
        if (!manifest ||
            provenance?.ownership !== 'managed' ||
            !provenance.hash ||
            provenance.region ||
            hash(manifest) !== provenance.hash)
            throw new EngineError('MANAGED_CONFLICT', 'install', 'Restore the recorded selected local package manifest before installation.');
        const facts = parseJson(manifest.toString('utf8'), 'install');
        if (!facts ||
            typeof facts !== 'object' ||
            Array.isArray(facts) ||
            !('name' in facts) ||
            facts.name !== name)
            throw new EngineError('MANAGED_CONFLICT', 'install', 'The selected local package manifest must match its declared package name.');
        args.push(name + '@' + value);
    }
    return args;
}
export async function installProject(projectDir, options = {}) {
    const absolute = path.resolve(projectDir);
    return withProjectLock(absolute, async () => {
        const state = await executableState(absolute);
        const lock = state.lock;
        const localArgs = await selectedLocalInstallArgs(absolute, lock.packageFields, lock.files);
        const staleLocalNames = [];
        for (const argument of localArgs) {
            const separator = argument.indexOf('@file:');
            const name = argument.slice(0, separator);
            const directory = argument.slice(separator + '@file:'.length);
            if (!(await localFileDependencyHealthy(absolute, name, directory, lock.files))) {
                const installedDirectory = path.join(absolute, 'node_modules', name);
                await assertNoSymlinks(installedDirectory);
                if (await statOrNull(installedDirectory))
                    staleLocalNames.push(name);
            }
        }
        const resolveLocal = localArgs.length > 0 &&
            (lock.outcomes.install !== 'completed' ||
                !(await installationHealthy(absolute)));
        lock.outcomes.install = 'pending';
        lock.outcomes.checks = 'pending';
        await updateState(absolute, lock, hash(state.lockBytes));
        const before = await readRegular(await projectPath(absolute, 'vcli.lock.json'));
        let succeeded;
        let failure;
        const facts = (step, script, result) => ({
            step,
            script,
            exitCode: result?.exitCode ?? 1,
            ...(result?.signal ? { signal: result.signal } : {}),
            ...(result?.diagnostics?.length
                ? { diagnostics: result.diagnostics }
                : {}),
            rerun: 'vcli install',
            outcomes: { ...lock.outcomes, install: 'failed' },
            operationId: lock.operationId,
        });
        try {
            const runner = options.runner ?? spawnCommand;
            const args = ['install', '--no-audit', '--no-fund', '--install-links'];
            if (staleLocalNames.length) {
                // npm retains same-version file payloads even with --force. Ask npm to
                // remove only stale selected derived packages, retaining declarations/lock.
                const removed = await runner({
                    command: 'npm',
                    args: [
                        'uninstall',
                        '--offline',
                        '--no-save',
                        '--package-lock=false',
                        '--ignore-scripts',
                        '--no-audit',
                        '--no-fund',
                        ...staleLocalNames,
                    ],
                    cwd: absolute,
                });
                await checkManagedManifest(absolute, lock.packageFields);
                if (removed.exitCode !== 0) {
                    failure = facts('remove-stale', 'npm:uninstall', removed);
                    throw new EngineError('INSTALL_FAILED', 'install', 'Stale selected local package removal failed; retry installation explicitly.', failure);
                }
            }
            if (resolveLocal) {
                const resolved = await runner({
                    command: 'npm',
                    args: [...args, ...localArgs],
                    cwd: absolute,
                });
                await checkManagedManifest(absolute, lock.packageFields);
                if (resolved.exitCode !== 0) {
                    failure = facts('resolve-local', 'npm:install', resolved);
                    throw new EngineError('INSTALL_FAILED', 'install', 'Selected local package resolution failed; retry installation explicitly.', failure);
                }
            }
            // A named npm install skips root lifecycle hooks. Finish with the ordinary
            // project install so existing developer install hooks retain their meaning.
            const result = await runner({ command: 'npm', args, cwd: absolute });
            await checkManagedManifest(absolute, lock.packageFields);
            succeeded =
                result.exitCode === 0 && (await installationHealthy(absolute));
            if (!succeeded)
                failure = facts('install', 'npm:install', result);
        }
        catch {
            succeeded = false;
            failure ??= facts('install', 'npm:install');
        }
        lock.outcomes.install = succeeded ? 'completed' : 'failed';
        await updateState(absolute, lock, hash(before));
        await remember(absolute, {
            schemaVersion: 1,
            at: new Date().toISOString(),
            operationId: lock.operationId,
            scope: 'install',
            status: succeeded ? 'completed' : 'failed',
            ...(failure?.step ? { step: failure.step } : {}),
            ...(failure?.script ? { script: failure.script } : {}),
            ...(failure?.exitCode !== undefined
                ? { exitCode: failure.exitCode }
                : {}),
            ...(succeeded ? {} : { code: 'INSTALL_FAILED' }),
            rerun: succeeded ? undefined : 'vcli install',
        });
        if (!succeeded)
            throw new EngineError('INSTALL_FAILED', 'install', 'Dependency installation failed or local locks/manifests are incomplete; source is preserved and installation must be retried explicitly.', failure);
        return {
            outcomes: { ...lock.outcomes },
            pending: [...lock.pending],
            commands: [{ name: 'install', status: 'completed' }],
        };
    });
}
//# sourceMappingURL=install-project.js.map