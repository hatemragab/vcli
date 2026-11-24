import { readFile } from 'node:fs/promises';
function missingTemplate(error) {
    return (!!error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT');
}
/** All asset paths are code-owned; callers cannot select arbitrary filesystem input. */
export async function bundled(path, variant = 'common') {
    if (!/^[a-z0-9/_.-]+$/i.test(path) ||
        path.split('/').includes('..') ||
        !['common', 'mongodb', 'postgres'].includes(variant))
        throw new Error('INVALID_BUNDLED_TEMPLATE');
    let content;
    try {
        content = await readFile(new URL(`../../templates/runtime/${variant}/${path}`, import.meta.url), 'utf8');
    }
    catch (error) {
        if (missingTemplate(error))
            throw error;
        throw new Error('INVALID_BUNDLED_TEMPLATE', { cause: error });
    }
    const template = `${variant}/${path}`;
    return {
        path,
        content,
        ownership: 'scaffold',
        ...(/^[a-z0-9./_-]{1,160}$/.test(template)
            ? { provenance: { renderer: 'template', template } }
            : {}),
    };
}
export const file = (path, content, ownership = 'managed') => ({ path, content, ownership });
export const json = (value) => JSON.stringify(value, null, 2) + '\n';
export async function runtime(path, variant) {
    try {
        return await bundled(path, variant);
    }
    catch (error) {
        if (!error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== 'ENOENT')
            throw error;
        return bundled(path);
    }
}
//# sourceMappingURL=bundle.js.map