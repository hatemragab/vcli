import { json, parseJson } from './data.js';
import { privateDirectory, writePrivate } from './operation-storage.js';
import { projectPath, readRegular } from './paths.js';
const scopes = new Set(['install', 'check', 'focused-check', 'release']);
export function validateLastResult(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const record = value;
    if (record.schemaVersion !== 1 ||
        typeof record.at !== 'string' ||
        Number.isNaN(Date.parse(record.at)) ||
        typeof record.scope !== 'string' ||
        !scopes.has(record.scope) ||
        (record.status !== 'completed' && record.status !== 'failed'))
        return undefined;
    const result = {
        schemaVersion: 1,
        at: record.at,
        scope: record.scope,
        status: record.status,
    };
    if (record.operationId !== undefined) {
        if (typeof record.operationId !== 'string' ||
            !/^[0-9a-f-]{36}$/i.test(record.operationId))
            return undefined;
        result.operationId = record.operationId;
    }
    for (const key of ['step', 'script', 'signal', 'code', 'rerun']) {
        if (record[key] === undefined)
            continue;
        if (typeof record[key] !== 'string' || record[key].length > 160)
            return undefined;
        result[key] = record[key];
    }
    if (record.exitCode !== undefined && record.exitCode !== null) {
        if (typeof record.exitCode !== 'number' ||
            !Number.isInteger(record.exitCode) ||
            record.exitCode < 0 ||
            record.exitCode > 255)
            return undefined;
        result.exitCode = record.exitCode;
    }
    return result;
}
/** Separate from the recovery journal so a check fact cannot rewrite source history. */
export async function writeLastResult(projectDir, result) {
    await privateDirectory(projectDir, '.vcli/local');
    await writePrivate(await projectPath(projectDir, '.vcli/local/last-result.json', true), json(result));
}
export async function readLastResult(projectDir) {
    const bytes = await readRegular(await projectPath(projectDir, '.vcli/local/last-result.json', true)).catch(() => undefined);
    if (!bytes)
        return undefined;
    try {
        return validateLastResult(parseJson(bytes.toString('utf8'), 'state'));
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=last-result.js.map