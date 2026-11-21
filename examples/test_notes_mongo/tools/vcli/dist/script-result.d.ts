import { type ScriptDiagnostic } from './contracts.js';
/** Pull path, line, and code from compiler output. Messages and raw text are dropped. */
export declare function parseCheckDiagnostics(text: string, cwd?: string): ScriptDiagnostic[];
export interface ScriptResult {
    schemaVersion: 1;
    status: 'completed' | 'failed' | 'reconciled';
    code: string;
    releaseId?: string;
    owners?: string[];
    step?: string;
    next?: string;
    keys?: string[];
}
/** One allowlisted JSON object. Anything else, including extra text, is ignored. */
export declare function parseScriptResult(text: string): ScriptResult | undefined;
