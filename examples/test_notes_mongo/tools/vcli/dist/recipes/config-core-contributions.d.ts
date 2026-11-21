import type { ProjectConfig } from '../contracts.js';
export interface ConfigField {
    key: string;
    schema: string;
    example: string;
    production?: string;
}
export interface ConfigDraft {
    fields: ConfigField[];
    output: string[];
    guards: string[];
    helpers: string[];
}
export declare function contributeDatabase(draft: ConfigDraft, config: ProjectConfig): void;
export declare function contributeAuth(draft: ConfigDraft, config: ProjectConfig, auth: string | undefined): void;
export declare function contributeMail(draft: ConfigDraft, config: ProjectConfig): void;
export declare function contributeReliableMail(draft: ConfigDraft, config: ProjectConfig, reliableMail: boolean): void;
export declare function contributeApplicationActions(draft: ConfigDraft, config: ProjectConfig, applicationActions: boolean): void;
