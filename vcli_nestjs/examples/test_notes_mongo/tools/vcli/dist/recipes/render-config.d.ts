import type { ProjectConfig, RenderedFile } from '../contracts.js';
export type EnvironmentContribution = Readonly<{
    key: string;
    required: boolean;
    secret: boolean;
    defaultValue?: string;
    minimum?: number;
    maximum?: number;
}>;
/** This single selected-field model drives validation, examples and deployment keys. */
export declare function configuration(config: ProjectConfig): {
    files: RenderedFile[];
    keys: string[];
    fields: EnvironmentContribution[];
};
