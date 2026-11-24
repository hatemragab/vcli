import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { z } from 'zod';
import { readRegular } from '../engine/paths.js';
import { CliError } from './cli-error.js';
import { assertPrivateInput } from './operational-shared.js';

const password = z.string().min(1).max(256);
const account = z.union([
  z.object({ email: z.email(), password }),
  z.object({ username: z.string().min(1).max(64), password }),
]);
const accountsFile = z.object({ accounts: z.array(account).min(2) });
const pathsDocument = z.object({
  paths: z.record(z.string(), z.record(z.string(), z.unknown())),
});
const sessionReceipt = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  installationId: z.uuid(),
});
const noteReference = z.object({ id: z.uuid() });
const createdNote = z.object({ note: noteReference });
const editView = z.object({
  id: z.uuid(),
  title: z.string(),
  body: z.string(),
  imageId: z.uuid().nullable().optional(),
});
const notesPage = z.object({ items: z.array(noteReference) });
const devicesView = z.object({
  devices: z.array(z.object({ installationId: z.uuid() })),
});
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jv1sAAAAASUVORK5CYII=',
  'base64',
);

type Account = z.infer<typeof account>;
type Session = z.infer<typeof sessionReceipt>;

function localOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidOrigin();
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw invalidOrigin();
  return url.origin;
}

function invalidOrigin(): CliError {
  return new CliError(
    'INVALID_SMOKE_ORIGIN',
    'Use the loopback origin of a running development or test app.',
  );
}

async function readAccounts(file: string): Promise<[Account, Account]> {
  const path = resolve(file);
  await assertPrivateInput(path);
  try {
    const bytes = await readRegular(path);
    if (!bytes || bytes.length > 65536) throw new Error();
    const [first, second] = accountsFile.parse(
      JSON.parse(bytes.toString('utf8')),
    ).accounts;
    const key = (identity: Account) =>
      ('email' in identity ? identity.email : identity.username).toLowerCase();
    if (!first || !second || key(first) === key(second)) throw new Error();
    return [first, second];
  } catch {
    throw new CliError(
      'INVALID_SMOKE_ACCOUNTS',
      'Provide an owner-only JSON file with accounts containing two distinct verified local logins.',
    );
  }
}

async function responseValue<T>(
  response: Response,
  schema: z.ZodType<T>,
  step: string,
): Promise<T> {
  try {
    return schema.parse(await response.json());
  } catch {
    throw new CliError(
      'SMOKE_RESPONSE_INVALID',
      `Unexpected response during ${step}. Check the running app version and API contract.`,
    );
  }
}

export async function runNotesSmoke(options: {
  url: string;
  accountsFile: string;
}) {
  const origin = localOrigin(options.url);
  const [ownerAccount, foreignAccount] = await readAccounts(
    options.accountsFile,
  );
  const sessions = new Set<Session>();
  let owner: Session | undefined;
  let noteId: string | undefined;
  let imageId: string | undefined;
  const checks: string[] = [];

  async function request(
    step: string,
    path: string,
    expected: number,
    options: {
      method?: string;
      session?: Session;
      json?: unknown;
      binary?: Uint8Array<ArrayBuffer>;
    } = {},
  ): Promise<Response> {
    const headers = new Headers();
    if (options.session)
      headers.set('Authorization', 'Bearer ' + options.session.accessToken);
    if (options.json !== undefined)
      headers.set('Content-Type', 'application/json');
    if (options.binary) headers.set('Content-Type', 'application/octet-stream');
    const response = await fetch(origin + path, {
      method: options.method ?? 'GET',
      body:
        options.binary ??
        (options.json === undefined ? undefined : JSON.stringify(options.json)),
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    }).catch(() => {
      throw new CliError(
        'SMOKE_REQUEST_FAILED',
        `Could not reach the app during ${step}.`,
      );
    });
    if (response.status !== expected)
      throw new CliError(
        'SMOKE_STATUS_UNEXPECTED',
        `${step} returned HTTP ${response.status}. Expected ${expected}.`,
      );
    return response;
  }

  async function login(credentials: Account, installationCapability: string) {
    const response = await request(
      'local login',
      '/api/identity/local/login',
      200,
      {
        method: 'POST',
        json: { ...credentials, platform: 'web', installationCapability },
      },
    );
    const session = await responseValue(
      response,
      sessionReceipt,
      'local login',
    );
    sessions.add(session);
    return session;
  }

  await request('readiness', '/health/ready', 200);
  const { paths } = await responseValue(
    await request('OpenAPI', '/docs-json', 200),
    pathsDocument,
    'OpenAPI',
  );
  for (const [path, method] of [
    ['/api/identity/local/login', 'post'],
    ['/api/notes', 'post'],
    ['/api/notes/{id}', 'patch'],
    ['/api/notes/{id}', 'delete'],
    ['/api/sessions/devices', 'get'],
    ['/api/sessions/revoke', 'post'],
  ] as const)
    if (!paths[path]?.[method])
      throw new CliError(
        'SMOKE_PROFILE_UNSUPPORTED',
        'Start a generated full local-auth app with the Notes and Devices routes.',
      );
  const media = Boolean(paths['/api/media/uploads']?.post);
  const cleanup = async () => {
    const results = [];
    if (noteId && owner)
      results.push(
        await request('note cleanup', '/api/notes/' + noteId, 204, {
          method: 'DELETE',
          session: owner,
        }).then(
          () => true,
          () => false,
        ),
      );
    if (imageId && owner)
      results.push(
        await request('media cleanup', '/api/media/' + imageId, 200, {
          method: 'DELETE',
          session: owner,
        }).then(
          () => true,
          () => false,
        ),
      );
    for (const session of sessions)
      results.push(
        await request('session cleanup', '/api/sessions/revoke', 200, {
          method: 'POST',
          session,
          json: { scope: 'current' },
        }).then(
          () => true,
          () => false,
        ),
      );
    return results.every(Boolean);
  };

  try {
    await request('anonymous notes', '/api/notes', 401);
    owner = await login(ownerAccount, randomBytes(32).toString('base64url'));
    const secondInstallation = randomBytes(32).toString('base64url');
    const otherDevice = await login(ownerAccount, secondInstallation);
    const otherSession = await login(ownerAccount, secondInstallation);
    const foreign = await login(
      foreignAccount,
      randomBytes(32).toString('base64url'),
    );
    const { devices } = await responseValue(
      await request('device list', '/api/sessions/devices', 200, {
        session: owner,
      }),
      devicesView,
      'device list',
    );
    const ownerInstallationId = owner.installationId;
    if (
      ownerInstallationId === otherDevice.installationId ||
      otherDevice.installationId !== otherSession.installationId ||
      !devices.some(
        (device) => device.installationId === ownerInstallationId,
      ) ||
      !devices.some(
        (device) => device.installationId === otherDevice.installationId,
      ) ||
      devices.some((device) => device.installationId === foreign.installationId)
    )
      throw new CliError(
        'SMOKE_DEVICE_MISMATCH',
        'The API reported an unexpected installation binding.',
      );
    checks.push('account authentication and isolated devices');

    if (media) {
      const reservation = await request(
        'image reservation',
        '/api/media/uploads',
        201,
        {
          method: 'POST',
          session: owner,
          json: {
            filename: 'vcli-smoke.png',
            bytes: png.length,
            sha256: createHash('sha256').update(png).digest('hex'),
          },
        },
      );
      imageId = (
        await responseValue(reservation, noteReference, 'image reservation')
      ).id;
      const path = '/api/media/uploads/' + imageId;
      await request('image upload', path + '/content', 200, {
        method: 'PUT',
        session: owner,
        binary: new Uint8Array(png),
      });
      await request('image finalize', path + '/finalize', 201, {
        method: 'POST',
        session: owner,
        json: {},
      });
      const download = await request(
        'second device image download',
        '/api/media/' + imageId + '/content',
        200,
        { session: otherDevice },
      );
      if (!Buffer.from(await download.arrayBuffer()).equals(png))
        throw new CliError(
          'SMOKE_IMAGE_MISMATCH',
          'The downloaded image differs from the uploaded fixture.',
        );
      await request(
        'foreign image download',
        '/api/media/' + imageId + '/content',
        404,
        { session: foreign },
      );
      checks.push('private image upload, finalize, download and ownership');
    }

    const title = 'VCLI smoke ' + randomUUID().slice(0, 8);
    const created = await responseValue(
      await request('note creation', '/api/notes', 201, {
        method: 'POST',
        session: owner,
        json: { title, body: 'Initial text', ...(imageId ? { imageId } : {}) },
      }),
      createdNote,
      'note creation',
    );
    noteId = created.note.id;
    const notePath = '/api/notes/' + noteId;
    const { items } = await responseValue(
      await request('second device note list', '/api/notes?limit=100', 200, {
        session: otherDevice,
      }),
      notesPage,
      'second device note list',
    );
    if (!items.some((note) => note.id === noteId))
      throw new CliError(
        'SMOKE_NOTE_MISSING',
        'The newly created note is absent from the second device list.',
      );
    await request('foreign note read', notePath, 404, { session: foreign });
    await request('foreign note edit', notePath, 404, {
      method: 'PATCH',
      session: foreign,
      json: { body: 'Denied' },
    });
    await request('foreign note delete', notePath, 404, {
      method: 'DELETE',
      session: foreign,
    });
    await request('second device note edit', notePath, 200, {
      method: 'PATCH',
      session: otherDevice,
      json: { body: 'Edited from the second installation' },
    });
    const note = await responseValue(
      await request('owner note read', notePath, 200, { session: owner }),
      editView,
      'owner note read',
    );
    if (
      note.title !== title ||
      note.body !== 'Edited from the second installation' ||
      (imageId && note.imageId !== imageId)
    )
      throw new CliError(
        'SMOKE_NOTE_MISMATCH',
        'The second-device edit changed unexpected fields or did not persist.',
      );
    checks.push('note creation, listing, editing and cross-account isolation');

    await request('installation revoke', '/api/sessions/revoke', 200, {
      method: 'POST',
      session: owner,
      json: {
        scope: 'installation',
        installationId: otherDevice.installationId,
      },
    });
    for (const session of [otherDevice, otherSession]) {
      await request('revoked device session', notePath, 401, { session });
      sessions.delete(session);
      await request(
        'revoked device refresh',
        '/api/identity/local/refresh',
        401,
        {
          method: 'POST',
          json: { refreshToken: session.refreshToken },
        },
      );
    }
    await request('surviving device note access', notePath, 200, {
      session: owner,
    });
    checks.push(
      'installation revocation, refresh refusal and surviving device',
    );

    await request('owner note delete', notePath, 204, {
      method: 'DELETE',
      session: owner,
    });
    noteId = undefined;
    await request('deleted note read', notePath, 404, { session: owner });
    if (imageId)
      await request(
        'image kept after note delete',
        '/api/media/' + imageId + '/content',
        200,
        { session: owner },
      );
    checks.push('note deletion and independent media lifetime');
  } catch (error: unknown) {
    if (!(await cleanup()))
      throw new CliError(
        'SMOKE_CLEANUP_FAILED',
        'The check failed and could not remove all temporary records.',
      );
    throw error;
  }
  if (!(await cleanup()))
    throw new CliError(
      'SMOKE_CLEANUP_FAILED',
      'The API did not remove all temporary smoke records.',
    );
  return { origin, checks, media: media ? 'verified' : 'not-selected' };
}
