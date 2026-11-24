import { spawn } from 'node:child_process';
import { constants } from 'node:os';
/** One delegated process, no restarts or discovery. Signal only its owned POSIX group. */
export function runOwnedProcess(invocation, options = {}) {
    if (options.capture && options.discard)
        throw new Error('INVALID_PROCESS_OUTPUT_MODE');
    if (process.platform === 'win32' && !options.launch)
        throw new Error('UNSUPPORTED_PROCESS_HOST');
    const signals = options.signals ?? process;
    const launch = options.launch ??
        ((command) => spawn(command.command, [...command.args], {
            cwd: command.cwd,
            env: command.environment,
            shell: false,
            detached: true,
            stdio: options.capture
                ? ['ignore', 'pipe', 'pipe']
                : options.discard
                    ? 'ignore'
                    : 'inherit',
        }));
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = launch(invocation);
        }
        catch {
            reject(new Error('SERVICE_PROCESS_START_FAILED'));
            return;
        }
        let stdout = '';
        let oversized = false;
        const send = (signal) => {
            if (child.exitCode !== null ||
                child.signalCode !== null ||
                child.pid === undefined)
                return;
            try {
                (options.signalGroup ??
                    ((pid, selected) => process.kill(-pid, selected)))(child.pid, signal);
            }
            catch (error) {
                if (!(error &&
                    typeof error === 'object' &&
                    'code' in error &&
                    error.code === 'ESRCH'))
                    child.kill(signal);
            }
        };
        const interrupt = () => send('SIGINT');
        const terminate = () => send('SIGTERM');
        signals.on('SIGINT', interrupt);
        signals.on('SIGTERM', terminate);
        const cleanup = () => {
            signals.off('SIGINT', interrupt);
            signals.off('SIGTERM', terminate);
        };
        if (options.capture) {
            child.stdout?.on('data', (data) => {
                if (Buffer.byteLength(stdout) + data.length > 262144) {
                    oversized = true;
                    send('SIGTERM');
                }
                else
                    stdout += data.toString('utf8');
            });
            // Private CLI/provider errors are intentionally not returned or logged.
            child.stderr?.resume();
        }
        child.once('error', () => {
            cleanup();
            reject(new Error('SERVICE_PROCESS_START_FAILED'));
        });
        child.once('close', (code, signal) => {
            cleanup();
            if (oversized)
                reject(new Error('SERVICE_PROCESS_OUTPUT_LIMIT'));
            else
                resolve({
                    code: code ?? (signal ? 128 + (constants.signals[signal] ?? 15) : 1),
                    stdout,
                    ...(signal ? { signal } : {}),
                });
        });
    });
}
//# sourceMappingURL=owned-process.js.map