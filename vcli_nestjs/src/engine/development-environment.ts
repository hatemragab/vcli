import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { link, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { hash } from './data.js';
import { EngineError } from './engine-error.js';
import { writeJournal } from './operation-storage.js';
import { assertNoSymlinks, isErrno, readRegular, statOrNull } from './paths.js';
import type { GenerationPlan, OperationJournal } from './types.js';

export const developmentEnvFile = '.env.development';

function content(plan: GenerationPlan): string {
  const fields = { ...plan.developmentDefaults };
  if (plan.config.capabilities.auth?.recipe === 'auth.local') {
    const id = 'local';
    const key = randomBytes(32).toString('base64url');
    fields.JWT_ACTIVE_KID = id;
    fields.JWT_KEYS_JSON = JSON.stringify([{ id, key }]);
  }
  if (plan.config.capabilities.mail?.options.reliableActions === true) {
    const id = 'local';
    const key = randomBytes(32).toString('base64');
    fields.MAIL_DELIVERY_KEY_ID = id;
    fields.MAIL_DELIVERY_KEYS_JSON = JSON.stringify({ [id]: key });
  }
  if (plan.config.capabilities.realtime?.recipe === 'realtime.centrifugo') {
    fields.CENTRIFUGO_API_KEY = randomBytes(32).toString('base64url');
    fields.CENTRIFUGO_PROXY_SECRET = randomBytes(32).toString('base64url');
  }
  return (
    '# Private development settings. Environment variables take precedence.\n' +
    Object.entries(fields)
      .map(
        ([key, value]) =>
          `${key}=${value.includes('"') ? `'${value}'` : value}`,
      )
      .join('\n') +
    '\n'
  );
}

/** Publish only a complete, owner-only private file without replacing anything. */
export async function initializeDevelopmentEnvironment(
  plan: GenerationPlan,
  journal: OperationJournal,
  staging: string,
): Promise<void> {
  const target = path.join(plan.projectDir, developmentEnvFile);
  const staged = path.join(staging, 'development-environment');
  await assertNoSymlinks(target);
  const bytes = content(plan);
  const handle = await open(
    staged,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.chmod(0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    const { dev, ino } = await handle.stat();
    journal.developmentEnvironment = {
      afterHash: hash(bytes),
      device: dev,
      inode: ino,
    };
  } finally {
    await handle.close();
  }
  try {
    await writeJournal(journal);
    await assertNoSymlinks(staged);
    await link(staged, target);
  } catch (error) {
    if (isErrno(error, 'EEXIST'))
      throw new EngineError(
        'STALE_PLAN',
        'apply',
        'A private development config file appeared during init. Preserve it and recover before retrying.',
      );
    throw error;
  } finally {
    await unlink(staged);
  }
}

export async function recoverDevelopmentEnvironment(
  journal: OperationJournal,
): Promise<'absent' | 'removed' | 'conflict'> {
  const created = journal.developmentEnvironment;
  if (!created) return 'absent';
  const target = path.join(journal.projectDir, developmentEnvFile);
  const stat = await statOrNull(target);
  if (!stat) return 'absent';
  if (
    !stat.isFile() ||
    (Number(stat.mode) & 0o777) !== 0o600 ||
    stat.dev !== created.device ||
    stat.ino !== created.inode ||
    hash((await readRegular(target)) ?? '') !== created.afterHash
  )
    return 'conflict';
  await unlink(target);
  return 'removed';
}
