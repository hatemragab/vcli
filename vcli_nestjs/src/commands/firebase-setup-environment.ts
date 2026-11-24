import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'dotenv';
import { z } from 'zod';
import { developmentEnvFile } from '../engine/development-environment.js';
import { EngineError } from '../engine/engine-error.js';
import { writePrivate } from '../engine/operation-storage.js';
import {
  checkExpected,
  fileExpectation,
  isErrno,
  readRegular,
  statOrNull,
} from '../engine/paths.js';
import { CliError } from './cli-error.js';

export type FirebaseSetupTarget = 'auth' | 'fcm' | 'both';

const credentialName = 'firebase-admin.json';
const credentialReference = `./${credentialName}`;
const maximumCredentialBytes = 64 * 1024;
const projectIdentifier = /^[a-z0-9][a-z0-9.:-]{0,127}$/;
const serviceAccount = z.object({
  type: z.literal('service_account'),
  project_id: z.string().regex(projectIdentifier),
  client_email: z.email(),
  private_key: z.string().trim().min(1),
});

function readCredentialProject(bytes: Buffer): string {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return serviceAccount.parse(value).project_id;
  } catch {
    throw new CliError(
      'INVALID_FIREBASE_CREDENTIALS',
      'Use the Firebase Admin service-account JSON in firebase-admin.json at the project root.',
    );
  }
}

function assertLink(
  projectId: string,
  linkedProjectId: string | undefined,
  credentialProjectId: string | undefined,
): void {
  if (!projectIdentifier.test(projectId))
    throw new CliError(
      'INVALID_FIREBASE_PROJECT_ID',
      'Supply a Firebase project ID returned by the Firebase CLI.',
    );
  if (linkedProjectId && linkedProjectId !== projectId)
    throw new CliError(
      'FIREBASE_PROJECT_LINK_CONFLICT',
      'The selected capability already has a different project ID in .env.development. Review that link before selecting another project.',
    );
  if (credentialProjectId && credentialProjectId !== projectId)
    throw new CliError(
      'FIREBASE_CREDENTIAL_PROJECT_MISMATCH',
      'Use a firebase-admin.json service account from the selected Firebase project, or use --adc for separately configured credentials.',
    );
}

async function setFcmCredentialMode(
  file: string,
  bytes: Buffer,
): Promise<void> {
  const received = await statOrNull(file);
  if (!received?.isFile())
    throw new EngineError(
      'STALE_PLAN',
      'firebase.setup',
      'firebase-admin.json changed during setup. Review it and retry.',
    );
  if ((Number(received.mode) & 0o077) === 0) return;

  try {
    const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat();
      if (
        !opened.isFile() ||
        opened.nlink !== 1 ||
        opened.dev !== received.dev ||
        opened.ino !== received.ino ||
        opened.size !== bytes.length ||
        !(await handle.readFile()).equals(bytes)
      )
        throw new Error();
      await handle.chmod(0o600);
    } finally {
      await handle.close();
    }
  } catch {
    throw new CliError(
      'FIREBASE_CREDENTIAL_MODE_REQUIRED',
      'FCM requires an owner-only firebase-admin.json. Use a regular file and run chmod 600 firebase-admin.json before retrying.',
    );
  }
}

async function publishDevelopmentEnvironment(
  file: string,
  before: Buffer | null,
  content: string,
): Promise<void> {
  const staged = `${file}.${randomUUID()}.tmp`;
  try {
    await writePrivate(staged, content);
    await checkExpected(file, fileExpectation(before));
    if (before) await rename(staged, file);
    else await link(staged, file);
  } catch (error) {
    if (error instanceof EngineError) throw error;
    if (isErrno(error, 'EEXIST'))
      throw new EngineError(
        'STALE_PLAN',
        'firebase.setup',
        '.env.development appeared during setup. Review it before retrying.',
      );
    throw new CliError(
      'FIREBASE_ENV_WRITE_FAILED',
      'Check project write permissions and rerun setup for the same Firebase project.',
    );
  } finally {
    await unlink(staged).catch(() => undefined);
  }
}

/** Inspect local inputs before contacting Firebase. The caller owns the project lock when applying. */
export async function prepareFirebaseEnvironment(
  projectDir: string,
  target: FirebaseSetupTarget,
  options: {
    projectId?: string;
    adc?: boolean;
    allowMissingCredential?: boolean;
  },
): Promise<{
  credentialProjectId?: string;
  linkedProjectId?: string;
  credentialPending: boolean;
  apply: (projectId: string) => Promise<void>;
}> {
  const root = path.resolve(projectDir);
  const envFile = path.join(root, developmentEnvFile);
  const credentialFile = path.join(root, credentialName);
  const before = await readRegular(envFile);
  const content = before?.toString('utf8') ?? '';
  if (before && !Buffer.from(content).equals(before))
    throw new CliError(
      'INVALID_FIREBASE_DEVELOPMENT_ENV',
      'Save .env.development as a UTF-8 dotenv file before retrying.',
    );
  const env = parse(content);
  const projectKeys = [
    ...(target !== 'fcm' ? ['FIREBASE_PROJECT_ID'] : []),
    ...(target !== 'auth' ? ['FCM_PROJECT_ID'] : []),
  ];
  const credentialKeys = options.adc
    ? []
    : [
        ...(target !== 'fcm' ? ['GOOGLE_APPLICATION_CREDENTIALS'] : []),
        ...(target !== 'auth' ? ['FCM_CREDENTIALS_PATH'] : []),
      ];
  const links = [
    ...new Set(projectKeys.map((key) => env[key]).filter(Boolean)),
  ];
  if (links.length > 1)
    throw new CliError(
      'FIREBASE_PROJECT_LINK_CONFLICT',
      'Authentication and FCM already use different projects. Run setup for each capability separately.',
    );
  const linkedProjectId = links[0];
  for (const key of credentialKeys) {
    const prior = env[key];
    if (prior && path.resolve(root, prior) !== credentialFile)
      throw new CliError(
        'FIREBASE_CREDENTIAL_PATH_CONFLICT',
        `Review the existing ${key} setting in .env.development before pointing it to firebase-admin.json.`,
      );
  }

  const credentialInfo = options.adc ? null : await statOrNull(credentialFile);
  if (credentialInfo && credentialInfo.size > maximumCredentialBytes)
    throw new CliError(
      'INVALID_FIREBASE_CREDENTIALS',
      'Use a Firebase Admin service-account JSON no larger than 64 KiB.',
    );
  const credentialBytes = options.adc
    ? null
    : await readRegular(credentialFile);
  if (credentialBytes && credentialBytes.length > maximumCredentialBytes)
    throw new CliError(
      'INVALID_FIREBASE_CREDENTIALS',
      'Use a Firebase Admin service-account JSON no larger than 64 KiB.',
    );
  const credentialProjectId = credentialBytes
    ? readCredentialProject(credentialBytes)
    : undefined;
  const credentialPending = !options.adc && !credentialBytes;
  if (credentialPending && !options.allowMissingCredential)
    throw new CliError(
      'FIREBASE_CREDENTIALS_REQUIRED',
      'Place the Firebase Admin service-account key at firebase-admin.json in the project root, or select --adc for existing Google credentials.',
    );
  const requestedProjectId = options.projectId ?? linkedProjectId;
  if (requestedProjectId)
    assertLink(requestedProjectId, linkedProjectId, credentialProjectId);

  return {
    credentialProjectId,
    linkedProjectId,
    credentialPending,
    apply: async (projectId) => {
      assertLink(projectId, linkedProjectId, credentialProjectId);
      await checkExpected(envFile, fileExpectation(before));
      if (!options.adc)
        await checkExpected(credentialFile, fileExpectation(credentialBytes));
      const additions = [
        ...projectKeys.map((key) => [key, projectId] as const),
        ...credentialKeys.map((key) => [key, credentialReference] as const),
      ].filter(([key]) => !env[key]);
      const info = await statOrNull(envFile);
      const newline = content.includes('\r\n') ? '\r\n' : '\n';
      const output = additions.length
        ? (content && !content.endsWith('\n') ? content + newline : content) +
          additions.map(([key, value]) => `${key}=${value}${newline}`).join('')
        : content;
      const updated = parse(output);
      if (additions.some(([key, value]) => updated[key] !== value))
        throw new CliError(
          'INVALID_FIREBASE_DEVELOPMENT_ENV',
          'Review the dotenv syntax in .env.development before linking Firebase.',
        );
      if (target !== 'auth' && credentialBytes)
        await setFcmCredentialMode(credentialFile, credentialBytes);
      if (!additions.length && info && (Number(info.mode) & 0o777) === 0o600)
        return;
      await publishDevelopmentEnvironment(envFile, before, output);
    },
  };
}
