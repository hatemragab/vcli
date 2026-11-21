import { hash } from '../engine/data.js';
import { projectPath, readRegular } from '../engine/paths.js';
import { MaintenanceError } from './maintenance-error.js';
/** Finite reviewed runtime contract; this is not admission by version label alone. */
export const CURATED_CAPTURE_PROFILE = 'curated-capture-immediate-v1';
const contracts = {
    'src/app.module.ts': [
        'managed',
        'a4a2a31dff92675d19a4a71c4a4f3e16c7f6e081fc53fffb895d0732b7e235a3',
    ],
    'src/core/configured-capabilities.ts': [
        'managed',
        '9b9630fb4aabcb80e05c7a22b73ce2fdbc3c038259ae3c8474dd73250842127c',
    ],
    'src/create-app.ts': [
        'managed',
        '23d8340d127b0c2d2396a12c0b1b600736f3452747c0a81f1708be74782bd7a2',
    ],
    'src/core/mail/mail-submitter.ts': [
        'scaffold',
        '1cdcd373c2528f2c24523dfb35160310357c2341481b325ac2a717e5d7727f56',
    ],
    'src/modules/mail/mail.service.ts': [
        'scaffold',
        '6ff75d3d292acd3eb6e90b979d188d73ceaccdcf198638cab312ede042558e40',
    ],
    'src/modules/mail/mail.module.ts': [
        'managed',
        'abde9253251a8bba3be2cd17db0d3bdb38aa849731ad395327eaf165ce368745',
    ],
    'src/modules/mail/capture-mail.service.ts': [
        'scaffold',
        '64a69626af5bff21863d137381e78bf4bca5b18903d29924a67a733092031f31',
    ],
    'src/core/logging/log-event-schema.ts': [
        'managed',
        '594edd11a321517b133ba3c931e930185c6f178ef10bbff23ce82580803bdd68',
    ],
};
function unsupported() {
    throw new MaintenanceError('UNSUPPORTED_BASELINE', 'This private 0.1.0 baseline does not match the reviewed curated-capture-immediate-v1 runtime contract. Preserve its source and ownership, and review a manual migration; a version label or option normalization does not establish compatibility.');
}
export async function assertSupportedBaseline(projectDir, lock) {
    if (lock.toolVersion !== '0.1.0' &&
        !lock.recipes.some((recipe) => recipe.version === '0.1.0'))
        return [];
    const selected = lock.config.capabilities;
    if (Object.keys(selected).sort().join(',') !== 'foundation,mail' ||
        selected.foundation?.recipe !== 'foundation.nest' ||
        Object.keys(selected.foundation.options).length ||
        selected.mail?.recipe !== 'mail.capture' ||
        selected.mail.options.reliableActions !== false ||
        Object.keys(selected.mail.options).some((key) => key !== 'reliableActions'))
        unsupported();
    const guards = [];
    for (const [file, [ownership, fingerprint]] of Object.entries(contracts)) {
        const metadata = lock.files[file];
        if (!metadata ||
            metadata.ownership !== ownership ||
            (ownership === 'managed' && metadata.hash !== fingerprint))
            unsupported();
        const current = await readRegular(await projectPath(projectDir, file));
        if (!current || hash(current) !== fingerprint)
            unsupported();
        guards.push({ path: file, hash: fingerprint });
    }
    return guards;
}
//# sourceMappingURL=unsupported-baseline.js.map