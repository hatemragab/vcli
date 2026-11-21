import path from 'node:path';
import { CONFIG_ERROR_CODES } from './contracts.js';
const relativePath = /^(?!\/)(?!.*\.\.)[A-Za-z0-9_./:-]{1,180}$/;
const diagnosticCode = /^(?!.*\.\.)@?[A-Za-z][A-Za-z0-9_/-]{1,80}$/;
function normalizeDiagnosticPath(raw, cwd) {
    const trimmed = raw.trim();
    if (!trimmed || !/\.[A-Za-z0-9]+$/.test(trimmed))
        return undefined;
    if (relativePath.test(trimmed))
        return trimmed;
    if (cwd && path.isAbsolute(trimmed)) {
        const rel = path.relative(cwd, trimmed).split(path.sep).join('/');
        if (relativePath.test(rel))
            return rel;
    }
    return undefined;
}
/** Pull path, line, and code from compiler output. Messages and raw text are dropped. */
export function parseCheckDiagnostics(text, cwd) {
    const diagnostics = [];
    const lines = text.split(/\r?\n/).slice(0, 400);
    let currentPath;
    for (const line of lines) {
        const typescript = /^((?:[A-Za-z0-9_@./-]+\/)*[A-Za-z0-9_@.-]+\.[A-Za-z0-9]+)\((\d+),(\d+)\):\s+error\s+(TS\d+)\b/.exec(line);
        if (typescript) {
            const normalized = normalizeDiagnosticPath(typescript[1], cwd);
            if (normalized) {
                diagnostics.push({
                    path: normalized,
                    line: Number(typescript[2]),
                    column: Number(typescript[3]),
                    code: typescript[4],
                });
            }
        }
        else {
            const candidatePath = normalizeDiagnosticPath(line, cwd);
            if (candidatePath) {
                currentPath = candidatePath;
            }
            else if (!line.trim() || !/^\s+/.test(line)) {
                currentPath = undefined;
            }
            else if (currentPath) {
                const stylish = /^\s+(\d+):(\d+)\s+error\s+.*?\s{2,}(@?[A-Za-z][A-Za-z0-9_/-]{1,80})\s*$/.exec(line);
                const compact = stylish ??
                    /^\s+(\d+):(\d+)\s+error\s+(@?[A-Za-z][A-Za-z0-9_/-]{1,80})\s*$/.exec(line);
                if (compact && diagnosticCode.test(compact[3]))
                    diagnostics.push({
                        path: currentPath,
                        line: Number(compact[1]),
                        column: Number(compact[2]),
                        code: compact[3],
                    });
            }
        }
        if (diagnostics.length >= 20)
            break;
    }
    return diagnostics;
}
const scriptCodes = new Set([
    'RELEASE_APPLIED',
    'RELEASE_RECONCILED',
    'RELEASE_AMBIGUOUS',
    'RELEASE_FAILED',
    ...CONFIG_ERROR_CODES,
    'INVALID_ARGUMENTS',
    'BACKUP_COMPLETED',
    'RESTORE_COMPLETED',
    'BACKUP_FAILED',
    'RESTORE_FAILED',
]);
/** One allowlisted JSON object. Anything else, including extra text, is ignored. */
export function parseScriptResult(text) {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') ||
        !trimmed.endsWith('}') ||
        trimmed.length > 4000)
        return undefined;
    let value;
    try {
        value = JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return undefined;
    const record = value;
    const allowed = new Set([
        'schemaVersion',
        'status',
        'code',
        'releaseId',
        'owners',
        'step',
        'next',
        'keys',
    ]);
    if (Object.keys(record).some((key) => !allowed.has(key)))
        return undefined;
    if (record.schemaVersion !== 1 ||
        (record.status !== 'completed' &&
            record.status !== 'failed' &&
            record.status !== 'reconciled') ||
        typeof record.code !== 'string' ||
        !scriptCodes.has(record.code))
        return undefined;
    const result = {
        schemaVersion: 1,
        status: record.status,
        code: record.code,
    };
    if (record.releaseId !== undefined) {
        if (typeof record.releaseId !== 'string' ||
            !/^[a-z0-9-]{8,128}$/i.test(record.releaseId))
            return undefined;
        result.releaseId = record.releaseId;
    }
    if (record.step !== undefined) {
        if (typeof record.step !== 'string' ||
            !/^[a-z0-9-]{1,40}$/.test(record.step))
            return undefined;
        result.step = record.step;
    }
    if (record.next !== undefined) {
        if (typeof record.next !== 'string' ||
            !/^vcli(?: [A-Za-z0-9_.:<>-]+){0,8}$/.test(record.next))
            return undefined;
        result.next = record.next;
    }
    if (record.owners !== undefined) {
        if (!Array.isArray(record.owners) ||
            record.owners.length > 16 ||
            record.owners.some((owner) => typeof owner !== 'string' || !/^[a-z0-9.-]{1,64}$/.test(owner)))
            return undefined;
        result.owners = [...record.owners];
    }
    if (record.keys !== undefined) {
        if (!Array.isArray(record.keys) ||
            record.keys.length > 20 ||
            record.keys.some((key) => typeof key !== 'string' || !/^[A-Z][A-Z0-9_]{0,64}$/.test(key)))
            return undefined;
        result.keys = [...record.keys];
    }
    return result;
}
//# sourceMappingURL=script-result.js.map