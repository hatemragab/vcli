import { type ChildProcess } from 'node:child_process';
import type { ServiceInvocation, CommandResult } from './service-types.js';
export interface OwnedProcessOptions {
    signals?: Pick<NodeJS.Process, 'on' | 'off'>;
    launch?: (invocation: ServiceInvocation) => ChildProcess;
    signalGroup?: (pid: number, signal: NodeJS.Signals) => void;
    capture?: boolean;
    discard?: boolean;
}
/** One delegated process, no restarts or discovery. Signal only its owned POSIX group. */
export declare function runOwnedProcess(invocation: ServiceInvocation, options?: OwnedProcessOptions): Promise<CommandResult>;
