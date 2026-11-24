import { spawn } from 'node:child_process';
import { parseCheckDiagnostics } from '../script-result.js';
/** Keep raw child text private. Only parsed diagnostics leave this runner. */
export function packageRunner(offline) {
    return ({ command, args, cwd }) => new Promise((resolve) => {
        const finalArgs = [...args];
        if (offline && ['install', 'ci'].includes(finalArgs[0] ?? ''))
            finalArgs.push('--offline');
        process.stderr.write(`Running ${command} ${finalArgs[0] === 'run' ? `run ${finalArgs[1] ?? ''}` : (finalArgs[0] ?? '')} in the selected project.\n`);
        const child = spawn(command, finalArgs, {
            cwd,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let captured = '';
        const take = (chunk) => {
            if (captured.length >= 16384)
                return;
            captured += chunk.toString('utf8').slice(0, 16384 - captured.length);
        };
        child.stdout?.on('data', take);
        child.stderr?.on('data', take);
        const interrupt = () => child.kill('SIGINT');
        const terminate = () => child.kill('SIGTERM');
        process.once('SIGINT', interrupt);
        process.once('SIGTERM', terminate);
        const finish = (exitCode, signal) => {
            process.removeListener('SIGINT', interrupt);
            process.removeListener('SIGTERM', terminate);
            const diagnostics = parseCheckDiagnostics(captured, cwd);
            resolve({
                exitCode,
                ...(signal ? { signal } : {}),
                ...(diagnostics.length ? { diagnostics } : {}),
            });
        };
        child.once('error', () => finish(1));
        child.once('exit', (code, signal) => finish(code, signal));
    });
}
//# sourceMappingURL=package-runner.js.map