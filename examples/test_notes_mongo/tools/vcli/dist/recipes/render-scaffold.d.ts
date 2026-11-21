import type { ProjectConfig, RenderedProject } from '../contracts.js';
export type ScaffoldKind = 'feature' | 'service' | 'controller' | 'dto' | 'repository' | 'command' | 'query' | 'realtime';
export interface ScaffoldRequest {
    kind: ScaffoldKind;
    name: string;
    uses?: readonly string[];
}
export declare const injectableCapabilities: {
    readonly notes: {
        readonly service: "NotesService";
        readonly file: "../notes/notes.service.js";
    };
    readonly mail: {
        readonly service: "MailService";
        readonly file: "../mail/mail.service.js";
    };
    readonly storage: {
        readonly service: "StorageService";
        readonly file: "../storage/storage.service.js";
    };
    readonly realtime: {
        readonly service: "RealtimeService";
        readonly file: "../realtime/realtime.service.js";
    };
    readonly push: {
        readonly service: "PushService";
        readonly file: "../push/push.service.js";
    };
};
export declare const scaffoldKinds: readonly string[];
export declare function renderScaffold(config: ProjectConfig, request: ScaffoldRequest): Promise<RenderedProject>;
