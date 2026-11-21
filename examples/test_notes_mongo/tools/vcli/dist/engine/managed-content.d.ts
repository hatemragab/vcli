import type { PackageFields } from './types.js';
export declare const isManagedDocumentation: (file: string) => boolean;
export declare const REGION_START = "<!-- vcli:managed:start -->";
export declare const REGION_END = "<!-- vcli:managed:end -->";
export declare function managedRegion(content: string): {
    start: number;
    end: number;
    content: string;
} | null;
export declare function replaceRegion(before: string, next: string): string;
export declare function validatePackageFields(content: string, fields: PackageFields): void;
export declare function mergePackage(before: string | null, rendered: string, oldFields: PackageFields): {
    content: string;
    fields: PackageFields;
};
