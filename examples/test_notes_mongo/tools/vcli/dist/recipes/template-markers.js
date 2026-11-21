import { distributionFailure } from '../contracts.js';
/** Guarded template marker helpers. Missing markers fail loudly instead of slicing from -1. */
export function requireIndex(source, marker, template, fromIndex = 0) {
    const index = source.indexOf(marker, fromIndex);
    if (index < 0)
        throw distributionFailure('INVALID_CATALOG', 'A bundled template is missing a required marker.', { path: template });
    return index;
}
export function replaceExact(source, target, replacement, template) {
    const index = requireIndex(source, target, template);
    return (source.slice(0, index) + replacement + source.slice(index + target.length));
}
export function removeBetween(source, startMarker, endMarker, template) {
    const start = requireIndex(source, startMarker, template);
    const end = requireIndex(source, endMarker, template, start);
    return source.slice(0, start) + source.slice(end);
}
export function sliceFrom(source, marker, template) {
    return source.slice(requireIndex(source, marker, template));
}
//# sourceMappingURL=template-markers.js.map