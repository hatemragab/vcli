import { execFile, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify, stripVTControlCharacters } from 'node:util';
import { z } from 'zod';
import { CliError } from './cli-error.js';

export type FirebaseProject = { projectId: string; displayName?: string };

type ProjectCommand = 'projects:list' | 'projects:create';

const run = promisify(execFile);
const envelope = z.discriminatedUnion('status', [
  z.object({ status: z.literal('success'), result: z.unknown() }),
  z.object({ status: z.literal('error'), error: z.string() }),
]);
const projects = z.array(
  z.object({
    projectId: z
      .string()
      .max(160)
      .regex(/^(?:[a-z0-9.-]+:)?[a-z0-9][a-z0-9-]*$/),
    displayName: z.string().optional().catch(undefined),
  }),
);

function parseEnvelope(stdout: string) {
  try {
    const json: unknown = JSON.parse(stdout);
    return envelope.safeParse(json).data;
  } catch {
    return undefined;
  }
}

function missingBinary(): CliError {
  return new CliError(
    'FIREBASE_CLI_NOT_FOUND',
    'Install the official Firebase CLI and make the firebase executable available on PATH, then retry.',
  );
}

function isMissingBinary(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function projectFailure(command: ProjectCommand, raw: string): CliError {
  const text = stripVTControlCharacters(raw);
  if (
    /failed to authenticate|requires authentication|credentials are no longer valid|not logged in|not authenticated/i.test(
      text,
    )
  )
    return new CliError(
      'FIREBASE_LOGIN_REQUIRED',
      'Run firebase login (or firebase login --reauth for expired credentials), then retry.',
    );

  if (command === 'projects:create') {
    if (/failed to add firebase to google cloud platform project/i.test(text))
      return new CliError(
        'FIREBASE_PROJECT_ENABLE_FAILED',
        'The Google Cloud project may exist. Check it, enable Firebase with firebase projects:addfirebase <project-id>, then rerun setup with --existing.',
      );
    if (/already a project with ID|already exists|HTTP Error: 409/i.test(text))
      return new CliError(
        'FIREBASE_PROJECT_ALREADY_EXISTS',
        'Link the existing Firebase project if you have access, or choose a different project ID.',
      );
    return new CliError(
      'FIREBASE_PROJECT_CREATE_FAILED',
      'Check your Google Cloud project creation permissions and whether the project now exists before retrying.',
    );
  }
  return new CliError(
    'FIREBASE_PROJECT_LIST_FAILED',
    'Check your Firebase account access and network connection, then retry. Run firebase login --reauth if your session expired.',
  );
}

function invalidResponse(): CliError {
  return new CliError(
    'FIREBASE_CLI_INVALID_RESPONSE',
    'Use an official Firebase CLI version that supports JSON output. After a create attempt, check whether the project exists before retrying.',
  );
}

async function withFirebaseDirectory<T>(
  projectDir: string,
  use: (options: { cwd: string; env: NodeJS.ProcessEnv }) => Promise<T>,
): Promise<T> {
  // Firebase can retain debug logs when a cloud operation fails.
  const cwd = await mkdtemp(path.join(tmpdir(), 'vcli-firebase-'));
  const env = { ...process.env };
  if (env.GOOGLE_APPLICATION_CREDENTIALS)
    env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(
      projectDir,
      env.GOOGLE_APPLICATION_CREDENTIALS,
    );
  try {
    return await use({ cwd, env });
  } finally {
    await rm(cwd, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runProjectCommand(
  projectDir: string,
  command: ProjectCommand,
  args: string[],
): Promise<unknown> {
  return withFirebaseDirectory(projectDir, async (options) => {
    let stdout: string;
    try {
      ({ stdout } = await run(
        'firebase',
        [command, ...args, '--json', '--non-interactive'],
        {
          ...options,
          encoding: 'utf8',
          timeout: 180_000,
          maxBuffer: 4_194_304,
        },
      ));
    } catch (error: unknown) {
      if (isMissingBinary(error)) throw missingBinary();
      let jsonError = '';
      let stderr = '';
      if (error instanceof Error) {
        if ('stdout' in error && typeof error.stdout === 'string') {
          const result = parseEnvelope(error.stdout);
          if (result?.status === 'error') jsonError = result.error;
        }
        if ('stderr' in error && typeof error.stderr === 'string')
          stderr = error.stderr;
      }
      throw projectFailure(command, jsonError || stderr);
    }
    const result = parseEnvelope(stdout);
    if (!result) throw invalidResponse();
    if (result.status === 'error') throw projectFailure(command, result.error);
    return result.result;
  });
}

export async function listFirebaseProjects(
  projectDir: string,
): Promise<FirebaseProject[]> {
  const result = projects.safeParse(
    await runProjectCommand(projectDir, 'projects:list', []),
  );
  if (!result.success) throw invalidResponse();
  return result.data.map(({ projectId, displayName }) => {
    const availableName =
      displayName && stripVTControlCharacters(displayName).trim();
    return availableName && /^[^\p{Cc}]{1,120}$/u.test(availableName)
      ? { projectId, displayName: availableName }
      : { projectId };
  });
}

export async function createFirebaseProject(
  projectDir: string,
  projectId: string,
): Promise<void> {
  await runProjectCommand(projectDir, 'projects:create', [projectId]);
}

export async function loginFirebase(projectDir: string): Promise<void> {
  await withFirebaseDirectory(projectDir, (options) => {
    return new Promise<void>((resolve, reject) => {
      const loginFailed = () =>
        new CliError(
          'FIREBASE_LOGIN_FAILED',
          'Complete firebase login in a terminal, then retry setup.',
        );
      const child = spawn('firebase', ['login', '--reauth'], {
        ...options,
        shell: false,
        stdio: 'inherit',
      });
      child.once('error', (error) =>
        reject(isMissingBinary(error) ? missingBinary() : loginFailed()),
      );
      child.once('close', (code) =>
        code === 0 ? resolve() : reject(loginFailed()),
      );
    });
  });
}
