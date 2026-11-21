import { createHash } from 'node:crypto';
import { z } from 'zod';
import { NODE_ENGINE_RANGE, projectNameSchema, SUPPORTED_TOOL_VERSIONS, TOOL_VERSION, } from '../contracts.js';
import { EngineError } from './engine-error.js';
export { SUPPORTED_TOOL_VERSIONS, TOOL_VERSION };
export const hash = (content) => createHash('sha256').update(content).digest('hex');
export const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(',')}]`;
    if (value !== null && typeof value === 'object')
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b, 'en'))
            .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
            .join(',')}}`;
    return JSON.stringify(value) ?? 'null';
}
export function parseJson(content, stage = 'state') {
    try {
        const value = JSON.parse(content);
        // JSON.parse accepts duplicate keys; configuration/state must not hide earlier choices.
        const objects = [];
        for (let index = 0; index < content.length; index += 1) {
            const char = content[index];
            if (char === '{')
                objects.push(new Set());
            else if (char === '[')
                objects.push(null);
            else if (char === '}' || char === ']')
                objects.pop();
            else if (char === '"') {
                const start = index;
                index += 1;
                while (index < content.length) {
                    if (content[index] === '\\')
                        index += 2;
                    else if (content[index] === '"')
                        break;
                    else
                        index += 1;
                }
                let next = index + 1;
                while (/\s/.test(content[next] ?? '') && next < content.length)
                    next += 1;
                if (content[next] === ':') {
                    const key = JSON.parse(content.slice(start, index + 1));
                    const current = objects.at(-1);
                    if (current?.has(key))
                        throw new Error('duplicate key');
                    current?.add(key);
                }
            }
        }
        return value;
    }
    catch {
        throw new EngineError('INVALID_STATE', stage, 'Repair the invalid or duplicate-key JSON using a trusted nonsecret configuration.');
    }
}
export const identifierSchema = z
    .string()
    .regex(/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/)
    .max(100);
export function validateIdentifier(value) {
    if (!identifierSchema.safeParse(value).success ||
        ['constructor', 'prototype', '__proto__'].includes(value))
        throw new EngineError('INVALID_IDENTIFIER', 'validation', 'Use a bounded lowercase identifier with safe letters, numbers, dots and hyphens.');
}
export const jsonValueSchema = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    z.string(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
]));
export const configSchema = z
    .object({
    schemaVersion: z.literal(1),
    project: z
        .object({ name: projectNameSchema, packageManager: z.literal('npm') })
        .strict(),
    capabilities: z.record(identifierSchema, z
        .object({
        recipe: identifierSchema,
        options: z.record(z.string(), jsonValueSchema),
    })
        .strict()),
})
    .strict();
export function rejectPrivateValues(value) {
    if (!value || typeof value !== 'object')
        return;
    for (const [key, item] of Object.entries(value)) {
        if (/^(?:__proto__|constructor|prototype)$/.test(key) ||
            /(?:password|credential|private.?key|access.?token|refresh.?token|client.?secret|api.?key)$/i.test(key))
            throw new EngineError('INVALID_OPTIONS', 'validation', 'Keep credential values in runtime secret storage; recipe options contain only nonsecret choices.');
        rejectPrivateValues(item);
    }
}
export function validateConfig(input) {
    if (input &&
        typeof input === 'object' &&
        'schemaVersion' in input &&
        input.schemaVersion !== 1)
        throw new EngineError('UNSUPPORTED_SCHEMA', 'validation', 'Use the supported schema version or an explicit migration.');
    const result = configSchema.safeParse(input);
    if (!result.success)
        throw new EngineError('INVALID_CONFIG', 'validation', 'Provide a schema-1 project name, npm package manager and explicit family selections.');
    rejectPrivateValues(result.data);
    return result.data;
}
export function validateToolchain(version = process.versions.node) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match ||
        Number(match[1]) !== 26 ||
        Number(match[2]) < 13 ||
        (Number(match[2]) === 13 && Number(match[3]) < 1))
        throw new EngineError('UNSUPPORTED_TOOLCHAIN', 'toolchain', `Run the supported Node ${NODE_ENGINE_RANGE} toolchain.`);
}
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const idSchema = z.string().uuid();
export const outcomeSchema = z.enum(['pending', 'completed', 'failed']);
export const outcomesSchema = z
    .object({
    source: outcomeSchema,
    install: outcomeSchema,
    checks: outcomeSchema,
})
    .strict();
export const checkSchema = z
    .object({
    name: identifierSchema,
    command: z.literal('npm'),
    args: z.tuple([
        z.literal('run'),
        z.string().regex(/^[a-z][a-z0-9:-]{0,99}$/),
    ]),
})
    .strict();
//# sourceMappingURL=data.js.map