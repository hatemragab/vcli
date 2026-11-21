import { canonical, json, parseJson, rejectPrivateValues } from './data.js';
import { EngineError } from './engine-error.js';
export const isManagedDocumentation = (file) => file === 'README.md' || file === 'AGENTS.md';
export const REGION_START = '<!-- vcli:managed:start -->';
export const REGION_END = '<!-- vcli:managed:end -->';
export function managedRegion(content) {
    const start = content.indexOf(REGION_START);
    const endStart = content.indexOf(REGION_END);
    if (start < 0 && endStart < 0)
        return null;
    if (start < 0 ||
        endStart < start ||
        content.indexOf(REGION_START, start + 1) >= 0 ||
        content.indexOf(REGION_END, endStart + 1) >= 0)
        throw new EngineError('MANAGED_CONFLICT', 'planning', 'Restore one well-formed bounded VCLI documentation region.');
    const end = endStart + REGION_END.length;
    return { start, end, content: content.slice(start, end) };
}
export function replaceRegion(before, next) {
    const previous = managedRegion(before);
    const rendered = managedRegion(next);
    if (!previous || !rendered)
        throw new EngineError('MANAGED_CONFLICT', 'planning', 'Restore the documented managed region anchors before regenerating.');
    return (before.slice(0, previous.start) +
        rendered.content +
        before.slice(previous.end));
}
function packageObject(content) {
    const value = parseJson(content, 'package');
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new EngineError('INVALID_STATE', 'package', 'Use an ordinary JSON package manifest.');
    rejectPrivateValues(value);
    return value;
}
function escapeKey(key) {
    return key.replaceAll('~', '~0').replaceAll('/', '~1');
}
function unescapeKey(key) {
    return key.replaceAll('~1', '/').replaceAll('~0', '~');
}
// Older locks recorded the app version. Treat it as app-owned when reading them too.
const appVersionField = '/version';
function fieldsOf(value, prefix = '') {
    const fields = {};
    for (const [key, item] of Object.entries(value)) {
        const field = `${prefix}/${escapeKey(key)}`;
        if (field === appVersionField)
            continue;
        if (item &&
            typeof item === 'object' &&
            !Array.isArray(item) &&
            Object.keys(item).length)
            Object.assign(fields, fieldsOf(item, field));
        else
            fields[field] = item;
    }
    return fields;
}
function getField(value, field) {
    let cursor = value;
    for (const key of field.slice(1).split('/').map(unescapeKey)) {
        if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor))
            return undefined;
        cursor = Object.hasOwn(cursor, key) ? cursor[key] : undefined;
    }
    return cursor;
}
function setField(value, field, item) {
    const keys = field.slice(1).split('/').map(unescapeKey);
    let cursor = value;
    for (const key of keys.slice(0, -1)) {
        const child = cursor[key];
        if (child === undefined)
            cursor[key] = {};
        else if (child === null ||
            typeof child !== 'object' ||
            Array.isArray(child))
            throw new EngineError('MANAGED_CONFLICT', 'package', 'Preserve the declared package object shape or resolve the conflict manually.');
        cursor = cursor[key];
    }
    const last = keys.at(-1);
    if (item === undefined)
        delete cursor[last];
    else
        cursor[last] = item;
}
export function validatePackageFields(content, fields) {
    const current = packageObject(content);
    for (const [field, item] of Object.entries(fields))
        if (field !== appVersionField &&
            canonical(getField(current, field)) !== canonical(item))
            throw new EngineError('MANAGED_CONFLICT', 'package', 'Restore changed selected scripts, dependencies or managed package fields before generation.');
}
export function mergePackage(before, rendered, oldFields) {
    const target = packageObject(rendered);
    const fields = fieldsOf(target);
    if (before === null)
        return { content: json(target), fields };
    validatePackageFields(before, oldFields);
    const current = packageObject(before);
    for (const [field, item] of Object.entries(fields)) {
        const existing = getField(current, field);
        if (!Object.hasOwn(oldFields, field) &&
            existing !== undefined &&
            canonical(existing) !== canonical(item))
            throw new EngineError('MANAGED_CONFLICT', 'package', 'Resolve the custom package field collision explicitly before adding this capability.');
        // A package must not be installed in conflicting dependency sections.
        if (/^\/(?:dependencies|devDependencies)\//.test(field)) {
            const opposite = field.startsWith('/dependencies/')
                ? field.replace('/dependencies/', '/devDependencies/')
                : field.replace('/devDependencies/', '/dependencies/');
            if (getField(current, opposite) !== undefined &&
                !Object.hasOwn(oldFields, opposite))
                throw new EngineError('MANAGED_CONFLICT', 'package', 'Resolve the selected dependency already declared in another dependency section.');
        }
        setField(current, field, item);
    }
    for (const field of Object.keys(oldFields))
        if (field !== appVersionField && !Object.hasOwn(fields, field))
            setField(current, field, undefined);
    return { content: json(current), fields };
}
//# sourceMappingURL=managed-content.js.map