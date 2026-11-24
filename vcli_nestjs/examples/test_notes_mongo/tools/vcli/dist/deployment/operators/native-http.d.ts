import type { OperatorOptions, TargetProfile } from './types.js';
/** Fixed-origin native HTTP only; no ambient env, retries, redirects or response/error logging. */
export declare class NativeHttp {
    private readonly profile;
    private readonly fetcher;
    private readonly timeoutMs;
    constructor(profile: TargetProfile, options?: OperatorOptions);
    request(path: string, method?: 'GET' | 'POST' | 'PATCH', body?: unknown, plain?: boolean): Promise<unknown>;
    get(name: string, input?: Record<string, unknown>): Promise<unknown>;
    post(name: string, body: unknown): Promise<unknown>;
}
export declare function boundedBody(response: Response, limit: number): Promise<string>;
