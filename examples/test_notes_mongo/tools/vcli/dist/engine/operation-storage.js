import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { hash, json, parseJson } from './data.js';
import { EngineError } from './engine-error.js';
import { assertNoSymlinks, isErrno, projectPath, readRegular, statOrNull, } from './paths.js';
import { validateJournal } from './state.js';
export const journalRelative = (id) => `.vcli/local/operations/${id}.json`;
export async function listJournals(projectDir) {
    const directory = await projectPath(projectDir, '.vcli/local/operations', true);
    if (!(await statOrNull(directory)))
        return [];
    const journals = [];
    for (const entry of (await readdir(directory)).sort()) {
        if (!/^[a-f0-9-]{36}\.json$/.test(entry))
            throw new EngineError('INVALID_STATE', 'journal', 'Inspect the unexpected local operation artifact before continuing.');
        const content = await readRegular(await projectPath(projectDir, `.vcli/local/operations/${entry}`, true));
        if (!content)
            throw new EngineError('INVALID_STATE', 'journal', 'Restore the missing operation journal.');
        const journal = validateJournal(parseJson(content.toString('utf8')), projectDir);
        if (`${journal.id}.json` !== entry)
            throw new EngineError('INVALID_STATE', 'journal', 'Restore the matching operation journal identity.');
        journals.push(journal);
    }
    return journals;
}
export const unfinishedJournals = (journals) => journals.filter((journal) => ['applying', 'failed', 'conflicted'].includes(journal.status) &&
    journal.outcomes.source !== 'completed');
export async function privateDirectory(projectDir, relative) {
    const full = await projectPath(projectDir, relative, true);
    let cursor = projectDir;
    for (const part of relative.split('/')) {
        cursor = path.join(cursor, part);
        await assertNoSymlinks(cursor);
        try {
            await mkdir(cursor, { mode: 0o700 });
        }
        catch (error) {
            if (!isErrno(error, 'EEXIST'))
                throw error;
        }
        if (!(await statOrNull(cursor))?.isDirectory())
            throw new EngineError('UNSAFE_PATH', 'journal', 'Use regular private operation directories.');
    }
    return full;
}
export async function writePrivate(file, content) {
    await assertNoSymlinks(file);
    const temporary = `${file}.${randomUUID()}.tmp`;
    let handle;
    try {
        handle = await open(temporary, constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW, 0o600);
        await handle.writeFile(content);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await assertNoSymlinks(file);
        await rename(temporary, file);
    }
    finally {
        await handle?.close();
        try {
            await unlink(temporary);
        }
        catch (error) {
            if (!isErrno(error, 'ENOENT')) {
                /* Preserve the original failure; a private temporary artifact may remain. */
            }
        }
    }
}
export async function writeJournal(journal) {
    await privateDirectory(journal.projectDir, '.vcli/local/operations');
    const file = await projectPath(journal.projectDir, journalRelative(journal.id), true);
    await writePrivate(file, json(journal));
}
function lockPath(projectDir) {
    return path.join(path.dirname(projectDir), `.vcli-${hash(projectDir).slice(0, 24)}.operation.lock`);
}
/** The sibling lock also serializes initialization before its target exists. */
export async function withProjectLock(projectDir, action, abandonLock = false) {
    const file = lockPath(projectDir);
    await assertNoSymlinks(file);
    if (abandonLock) {
        const current = await readRegular(file);
        if (current) {
            const value = parseJson(current.toString('utf8'), 'lock');
            if (!value ||
                typeof value !== 'object' ||
                !('host' in value) ||
                !('pid' in value) ||
                value.host !== hostname() ||
                typeof value.pid !== 'number' ||
                !Number.isSafeInteger(value.pid) ||
                value.pid < 1)
                throw new EngineError('PROJECT_BUSY', 'lock', 'Verify the previous lock owner manually; unknown ownership cannot be abandoned.');
            let alive = true;
            try {
                process.kill(value.pid, 0);
            }
            catch (error) {
                if (isErrno(error, 'ESRCH'))
                    alive = false;
            }
            if (alive)
                throw new EngineError('PROJECT_BUSY', 'lock', 'Wait for the active operation owner before recovery.');
            if (hash((await readRegular(file)) ?? '') !== hash(current))
                throw new EngineError('PROJECT_BUSY', 'lock', 'The lock changed; inspect the active owner.');
            await unlink(file);
        }
    }
    const token = json({
        pid: process.pid,
        host: hostname(),
        nonce: randomUUID(),
    });
    let lock;
    try {
        lock = await open(file, constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW, 0o600);
    }
    catch (error) {
        if (isErrno(error, 'EEXIST'))
            throw new EngineError('PROJECT_BUSY', 'lock', 'Another operation owns this project; wait or explicitly recover a dead owner.');
        throw new EngineError('UNSAFE_PATH', 'lock', 'Check the operation-lock parent directory and permissions.');
    }
    try {
        await lock.writeFile(token);
        await lock.sync();
        await lock.close();
        lock = undefined;
        return await action();
    }
    finally {
        await lock?.close();
        const current = await readRegular(file);
        if (current && current.toString('utf8') === token)
            await unlink(file);
    }
}
//# sourceMappingURL=operation-storage.js.map