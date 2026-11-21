import { format } from 'prettier';
const prettierOptions = {
    singleQuote: true,
    trailingComma: 'all',
    proseWrap: 'preserve',
};
export function formatYaml(content) {
    return format(content, { parser: 'yaml', ...prettierOptions });
}
/** Format returned bytes in memory; never walk or mutate the user's project. */
export async function formatFiles(files) {
    return Promise.all(files.map(async (item) => {
        const extension = item.path.split('.').at(-1);
        const parser = extension === 'ts'
            ? 'typescript'
            : extension === 'mjs'
                ? 'babel'
                : extension === 'json'
                    ? 'json'
                    : extension === 'md'
                        ? 'markdown'
                        : extension === 'yml' || extension === 'yaml'
                            ? 'yaml'
                            : undefined;
        return parser
            ? {
                ...item,
                content: await format(item.content, {
                    parser,
                    ...prettierOptions,
                }),
            }
            : item;
    }));
}
//# sourceMappingURL=format-files.js.map