import { spawn } from 'node:child_process';
export type NativeCommand = Readonly<{
  executable: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  timeoutMs: number;
}>;
export type NativeCommandRunner = (command: NativeCommand) => Promise<void>;
/** Raw tool output is deliberately discarded: native errors may echo credentials or records. */
export const runNativeCommand: NativeCommandRunner = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn(command.executable, [...command.args], {
      shell: false,
      env: {
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        LANG: 'C',
        ...command.env,
      },
      stdio: 'ignore',
    });
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, command.timeoutMs);
    child.once('error', () => {
      clearTimeout(timeout);
      reject(new Error('NATIVE_TOOL_UNAVAILABLE'));
    });
    child.once('close', (code) => {
      clearTimeout(timeout);
      if (code === 0 && !timedOut) resolve();
      else
        reject(
          new Error(
            timedOut
              ? 'NATIVE_TOOL_TIMEOUT_OUTCOME_UNKNOWN'
              : 'NATIVE_TOOL_FAILED_OUTCOME_UNKNOWN',
          ),
        );
    });
  });
