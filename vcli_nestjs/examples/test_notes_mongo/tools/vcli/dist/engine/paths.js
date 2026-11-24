import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { EngineError } from './engine-error.js';
import { hash } from './data.js';
export function relativePath(value, internal = false) {
    if (!value ||
        value.length > 300 ||
        value.includes('\\') ||
        value.includes('\0') ||
        path.posix.isAbsolute(value) ||
        value
            .split('/')
            .some((part) => !part ||
            part === '.' ||
            part === '..' ||
            !/^[A-Za-z0-9_.@-]+$/.test(part)))
        throw new EngineError('UNSAFE_PATH', 'path', 'Use a normalized relative project path without traversal or shell syntax.');
    const parts = value.split('/');
    if (parts.some((part) => [
        '.git',
        'node_modules',
        '__proto__',
        'constructor',
        'prototype',
    ].includes(part)) ||
        (!internal && parts[0] === '.vcli') ||
        parts.some((part) => part.startsWith('.env') && !part.endsWith('.example')))
        throw new EngineError('UNSAFE_PATH', 'path', 'Keep generated paths outside private environments, repository internals and dependency storage.');
    return value;
}
export function contained(root, candidate) {
    const relative = path.relative(root, candidate);
    if (relative.startsWith(`..${path.sep}`) ||
        relative === '..' ||
        path.isAbsolute(relative))
        throw new EngineError('UNSAFE_PATH', 'path', 'Keep the destination inside the intended workspace.');
}
export async function statOrNull(file) {
    try {
        return await lstat(file);
    }
    catch (error) {
        if (isErrno(error, 'ENOENT'))
            return null;
        throw new EngineError('UNSAFE_PATH', 'path', 'Check filesystem permissions and regular directory ancestors.');
    }
}
export function isErrno(error, code) {
    return error instanceof Error && 'code' in error && error.code === code;
}
/** Check every existing ancestor, including the target, before any content access. */
export async function assertNoSymlinks(file) {
    const absolute = path.resolve(file);
    let cursor = path.parse(absolute).root;
    const parts = absolute.slice(cursor.length).split(path.sep).filter(Boolean);
    for (const [index, part] of parts.entries()) {
        cursor = path.join(cursor, part);
        const stat = await statOrNull(cursor);
        if (!stat)
            return;
        if (stat.isSymbolicLink() ||
            (index < parts.length - 1 && !stat.isDirectory()))
            throw new EngineError('UNSAFE_PATH', 'path', 'Replace symlink or non-directory ancestors with an explicit regular project path.');
    }
}
export async function projectPath(projectDir, relative, internal = false) {
    relativePath(relative, internal);
    const full = path.join(projectDir, relative);
    contained(projectDir, full);
    await assertNoSymlinks(full);
    return full;
}
export async function readRegular(file) {
    await assertNoSymlinks(file);
    const stat = await statOrNull(file);
    if (!stat)
        return null;
    if (!stat.isFile() || stat.size > 16_000_000)
        throw new EngineError('UNSAFE_PATH', 'read', 'Use a bounded regular generated file.');
    let handle;
    try {
        handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        const opened = await handle.stat();
        if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev)
            throw new EngineError('STALE_PLAN', 'read', 'Replan after the path changed.');
        return await handle.readFile();
    }
    catch (error) {
        if (error instanceof EngineError)
            throw error;
        throw new EngineError('UNSAFE_PATH', 'read', 'Read a regular accessible project file.');
    }
    finally {
        await handle?.close();
    }
}
export async function expectedFile(file) {
    const bytes = await readRegular(file);
    return bytes === null
        ? { kind: 'absent' }
        : { kind: 'hash', hash: hash(bytes) };
}
export async function checkExpected(file, expected) {
    const actual = await expectedFile(file);
    if (actual.kind !== expected.kind ||
        (actual.kind === 'hash' &&
            expected.kind === 'hash' &&
            actual.hash !== expected.hash))
        throw new EngineError('STALE_PLAN', 'preconditions', 'A touched file changed; review it and create a fresh plan.');
}
export async function resolveDestination(workspaceDir, projectDir) {
    const root = path.resolve(workspaceDir);
    const destination = path.resolve(root, projectDir);
    contained(root, destination);
    await assertNoSymlinks(root);
    await assertNoSymlinks(destination);
    if (!(await statOrNull(root))?.isDirectory() ||
        (await realpath(root)) !== root)
        throw new EngineError('UNSAFE_PATH', 'path', 'Choose an existing regular workspace directory.');
    if (!(await statOrNull(path.dirname(destination)))?.isDirectory())
        throw new EngineError('UNSAFE_PATH', 'path', 'Create the intended parent directory explicitly before initialization.');
    return { workspaceDir: root, projectDir: destination };
}
export async function initEntries(projectDir) {
    await assertNoSymlinks(projectDir);
    const stat = await statOrNull(projectDir);
    if (!stat)
        return [];
    if (!stat.isDirectory())
        throw new EngineError('NONEMPTY_DESTINATION', 'init', 'Choose a new or empty regular directory.');
    const entries = (await readdir(projectDir)).sort();
    if (entries.some((entry) => entry !== '.git'))
        throw new EngineError('NONEMPTY_DESTINATION', 'init', 'Choose an empty directory; only a regular existing .git directory is permitted.');
    if (entries.includes('.git') &&
        !(await statOrNull(path.join(projectDir, '.git')))?.isDirectory())
        throw new EngineError('UNSAFE_PATH', 'init', 'An existing .git entry must be a regular directory.');
    if (entries.includes('.git'))
        await assertNoSymlinks(path.join(projectDir, '.git'));
    return entries;
}
//# sourceMappingURL=paths.js.map