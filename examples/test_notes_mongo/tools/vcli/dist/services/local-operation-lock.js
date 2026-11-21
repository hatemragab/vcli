import path from 'node:path';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
/** A local invocation lock is ownership, not stale-process discovery or a supervisor. */
export async function withLocalOperationLock(root, name, work) {
    if (!/^(?:services|dev)-(?:development|test)$/.test(name))
        throw new Error('INVALID_LOCAL_OPERATION_LOCK');
    let directory = root;
    for (const part of ['.vcli', 'local']) {
        directory = path.join(directory, part);
        try {
            await mkdir(directory, { mode: 0o700 });
        }
        catch (error) {
            if (!(error &&
                typeof error === 'object' &&
                'code' in error &&
                error.code === 'EEXIST'))
                throw error;
        }
        const info = await lstat(directory);
        if (!info.isDirectory() ||
            info.isSymbolicLink() ||
            (process.getuid && info.uid !== process.getuid()) ||
            (info.mode & 0o077) !== 0)
            throw new Error('UNSAFE_LOCAL_STATE_DIRECTORY');
    }
    const lock = path.join(directory, name + '.lock');
    const handle = await open(lock, constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW, 0o600).catch(() => {
        throw new Error('LOCAL_OPERATION_OWNERSHIP_CONFLICT');
    });
    const owned = await handle.stat();
    const token = JSON.stringify({ pid: process.pid, token: randomUUID() });
    try {
        await handle.writeFile(token);
        return await work();
    }
    finally {
        await handle.close();
        const current = await lstat(lock).catch(() => undefined);
        if (current?.ino === owned.ino &&
            current.dev === owned.dev &&
            (await readFile(lock, 'utf8')) === token)
            await unlink(lock);
    }
}
//# sourceMappingURL=local-operation-lock.js.map