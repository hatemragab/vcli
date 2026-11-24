import { spawn } from 'node:child_process';
import { hash, json, validateToolchain } from './data.js';
import { EngineError } from './engine-error.js';
import { writeLastResult } from './last-result.js';
import { validatePackageFields } from './managed-content.js';
import { listJournals, unfinishedJournals, writeJournal, writePrivate, } from './operation-storage.js';
import { checkExpected, projectPath, readRegular } from './paths.js';
import { readProject } from './state.js';
export function scriptName(args) {
    if (args[0] === 'run' && args[1] && /^[a-z0-9:_-]{1,40}$/.test(args[1]))
        return args[1];
    if (args[0] === 'install')
        return 'npm:install';
    if (args[0] === 'uninstall')
        return 'npm:uninstall';
    return 'npm';
}
export async function remember(projectDir, result) {
    await writeLastResult(projectDir, result).catch(() => undefined);
}
/** No shell, output collection, or forwarding of potentially secret subprocess text. */
export const spawnCommand = async ({ command, args, cwd }) => new Promise((resolve, reject) => {
    const child = spawn(command, [...args], {
        cwd,
        shell: false,
        stdio: 'ignore',
    });
    child.once('error', () => reject(new EngineError('INSTALL_FAILED', 'process', 'Check the selected npm executable and retry explicitly.')));
    child.once('exit', (exitCode) => resolve({ exitCode }));
});
export async function updateState(projectDir, lock, previousHash) {
    const target = await projectPath(projectDir, 'vcli.lock.json');
    await checkExpected(target, { kind: 'hash', hash: previousHash });
    const content = json(lock);
    // Track the updated state postimage so conditional source recovery remains possible.
    const journal = (await listJournals(projectDir)).find((entry) => entry.id === lock.operationId);
    if (journal) {
        const metadata = journal.entries.find((entry) => entry.path === 'vcli.lock.json');
        if (metadata)
            metadata.afterHash = hash(content);
        journal.outcomes = { ...lock.outcomes };
        await writeJournal(journal);
    }
    await checkExpected(target, { kind: 'hash', hash: previousHash });
    await writePrivate(target, content);
}
export async function checkManagedManifest(projectDir, fields) {
    const manifest = await readRegular(await projectPath(projectDir, 'package.json'));
    if (!manifest)
        throw new EngineError('MANAGED_CONFLICT', 'install', 'Restore the selected project package manifest.');
    validatePackageFields(manifest.toString('utf8'), fields);
}
export async function executableState(projectDir) {
    validateToolchain();
    const state = await readProject(projectDir);
    if (state.lock.outcomes.source !== 'completed' ||
        unfinishedJournals(await listJournals(state.projectDir)).length)
        throw new EngineError('INCOMPLETE_OPERATION', 'execute', 'Complete or recover source generation before installation or checks.');
    const registration = state.lock.files['src/generated/vcli-app.module.ts'];
    if (registration?.ownership === 'managed') {
        const bytes = await readRegular(await projectPath(state.projectDir, 'src/generated/vcli-app.module.ts'));
        if (!bytes || hash(bytes) !== registration.hash)
            throw new EngineError('MANAGED_CONFLICT', 'execute', 'Restore the selected generated module registration before installation or verification.');
    }
    await checkManagedManifest(state.projectDir, state.lock.packageFields);
    return state;
}
//# sourceMappingURL=execution-shared.js.map