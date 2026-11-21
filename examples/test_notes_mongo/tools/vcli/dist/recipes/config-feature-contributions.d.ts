import type { ProjectConfig } from '../contracts.js';
import type { ConfigDraft } from './config-core-contributions.js';
export declare function contributeStorage(draft: ConfigDraft, config: ProjectConfig, storage: string | undefined): void;
export declare function contributeRealtime(draft: ConfigDraft, config: ProjectConfig, realtime: string | undefined): void;
export declare function contributePush(draft: ConfigDraft, config: ProjectConfig): void;
export declare function contributeDiagnostics(draft: ConfigDraft, config: ProjectConfig): void;
