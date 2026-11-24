import path from 'node:path';
import { canonical, hash } from './data.js';
import { EngineError } from './engine-error.js';
import { executableState, remember, scriptName, spawnCommand, updateState, } from './execution-shared.js';
import { installationHealthy } from './inspection.js';
import { validatePackageFields } from './managed-content.js';
import { withProjectLock } from './operation-storage.js';
import { projectPath, readRegular } from './paths.js';
import { readProject } from './state.js';
export async function checkProject(projectDir, options = {}) {
    const absolute = path.resolve(projectDir);
    return withProjectLock(absolute, async () => {
        const state = await executableState(absolute);
        const lock = state.lock;
        if (lock.outcomes.install !== 'completed' ||
            !(await installationHealthy(absolute)))
            throw new EngineError('INSTALL_INCOMPLETE', 'checks', 'Complete a verified local dependency installation before running checks.');
        const focused = options.only;
        const checks = focused
            ? lock.checks.filter((check) => check.name === focused)
            : lock.checks;
        if (!checks.length || (focused && !/^[a-z0-9:_-]{1,40}$/.test(focused)))
            throw new EngineError('CHECK_FAILED', 'checks', focused
                ? 'Choose one declared check name.'
                : 'Declare meaningful selected-project npm checks before verification.', {
                step: focused && /^[a-z0-9:_-]{1,40}$/.test(focused) ? focused : 'check',
                rerun: 'vcli check',
                operationId: lock.operationId,
            });
        const commands = [];
        if (!focused) {
            lock.outcomes.checks = 'pending';
            await updateState(absolute, lock, hash(state.lockBytes));
        }
        const previousHash = hash((await readRegular(await projectPath(absolute, 'vcli.lock.json'))));
        for (const check of checks) {
            let succeeded;
            let result;
            try {
                result = await (options.runner ?? spawnCommand)({
                    command: 'npm',
                    args: check.args,
                    cwd: absolute,
                });
                succeeded = result.exitCode === 0;
            }
            catch {
                succeeded = false;
            }
            commands.push({
                name: check.name,
                status: succeeded ? 'completed' : 'failed',
            });
            if (!succeeded) {
                const details = {
                    step: check.name,
                    script: scriptName(check.args),
                    exitCode: result?.exitCode ?? 1,
                    ...(result?.signal ? { signal: result.signal } : {}),
                    ...(result?.diagnostics?.length
                        ? { diagnostics: result.diagnostics }
                        : {}),
                    rerun: `vcli check --only ${check.name}`,
                    outcomes: {
                        ...lock.outcomes,
                        checks: focused ? lock.outcomes.checks : 'failed',
                    },
                    operationId: lock.operationId,
                };
                if (!focused) {
                    lock.outcomes.checks = 'failed';
                    await updateState(absolute, lock, previousHash);
                }
                await remember(absolute, {
                    schemaVersion: 1,
                    at: new Date().toISOString(),
                    operationId: lock.operationId,
                    scope: focused ? 'focused-check' : 'check',
                    status: 'failed',
                    step: check.name,
                    script: scriptName(check.args),
                    exitCode: result?.exitCode ?? 1,
                    code: 'CHECK_FAILED',
                    rerun: `vcli check --only ${check.name}`,
                });
                throw new EngineError('CHECK_FAILED', 'checks', 'A declared check failed; subprocess output is excluded from public results.', details);
            }
            // An editor or npm script cannot silently mutate the declared stack mid-check.
            const current = await readProject(absolute);
            if (canonical(current.config) !== canonical(state.config) ||
                hash(current.lockBytes) !== previousHash)
                throw new EngineError('STALE_PLAN', 'checks', 'Project metadata changed during checks; inspect it before retrying.');
        }
        const manifest = await readRegular(await projectPath(absolute, 'package.json'));
        if (!manifest)
            throw new EngineError('MANAGED_CONFLICT', 'checks', 'Restore the package manifest.');
        validatePackageFields(manifest.toString('utf8'), lock.packageFields);
        if (!(await installationHealthy(absolute))) {
            if (!focused) {
                lock.outcomes.install = 'failed';
                lock.outcomes.checks = 'failed';
                await updateState(absolute, lock, previousHash);
            }
            throw new EngineError('CHECK_FAILED', 'checks', 'Dependency installation changed during checks; repair it explicitly.', {
                step: focused ?? 'install',
                rerun: focused ? `vcli check --only ${focused}` : 'vcli install',
                operationId: lock.operationId,
                outcomes: { ...lock.outcomes },
            });
        }
        if (focused) {
            await remember(absolute, {
                schemaVersion: 1,
                at: new Date().toISOString(),
                operationId: lock.operationId,
                scope: 'focused-check',
                status: 'completed',
                step: focused,
            });
            return {
                outcomes: { ...lock.outcomes },
                pending: [...lock.pending],
                commands,
            };
        }
        lock.outcomes.checks = 'completed';
        await updateState(absolute, lock, previousHash);
        await remember(absolute, {
            schemaVersion: 1,
            at: new Date().toISOString(),
            operationId: lock.operationId,
            scope: 'check',
            status: 'completed',
        });
        return {
            outcomes: { ...lock.outcomes },
            pending: [...lock.pending],
            commands,
        };
    });
}
//# sourceMappingURL=check-project.js.map