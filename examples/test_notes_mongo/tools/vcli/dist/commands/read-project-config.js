import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CliError } from './cli-error.js';
const schema = z
    .object({
    schemaVersion: z.literal(1),
    project: z
        .object({ name: z.string(), packageManager: z.literal('npm') })
        .strict(),
    capabilities: z.record(z.string(), z
        .object({ recipe: z.string(), options: z.record(z.string(), z.json()) })
        .strict()),
})
    .strict();
export async function readProjectConfig(projectDir) {
    const handle = await open(join(projectDir, 'vcli.json'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const input = JSON.parse(await handle.readFile('utf8'));
        const parsed = schema.safeParse(input);
        if (!parsed.success)
            throw new Error();
        return parsed.data;
    }
    catch {
        throw new CliError('INVALID_CONFIG', 'Restore a supported nonsecret vcli.json and run doctor.');
    }
    finally {
        await handle.close();
    }
}
//# sourceMappingURL=read-project-config.js.map