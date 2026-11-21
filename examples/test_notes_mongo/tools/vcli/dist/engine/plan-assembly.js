import { describeThrown, } from '../contracts.js';
import { EngineError, toEngineError } from './engine-error.js';
/** Turn a recipe failure into a public engine error. Raw exception text stays out. */
export function renderError(error) {
    if (error instanceof EngineError)
        return error;
    const described = describeThrown(error);
    if (described)
        return toEngineError(described);
    return new EngineError('INVALID_OPTIONS', 'render', 'Use a supported bundled recipe combination.');
}
const rendererName = /^[a-z0-9.-]{1,64}$/;
const templatePath = /^[a-z0-9./_-]{1,160}$/;
/** Attach provenance only when the lock entry is being rewritten. */
export function recordedFile(file, entry) {
    const provenance = safeProvenance(file.provenance);
    return provenance ? { ...entry, provenance } : entry;
}
function safeProvenance(provenance) {
    if (!provenance || !rendererName.test(provenance.renderer))
        return undefined;
    if (!provenance.template)
        return { renderer: provenance.renderer };
    if (!templatePath.test(provenance.template))
        return { renderer: provenance.renderer };
    return { renderer: provenance.renderer, template: provenance.template };
}
//# sourceMappingURL=plan-assembly.js.map