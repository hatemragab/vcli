import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import {
  readdir,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  chmod,
  lstat,
  symlink,
  writeFile,
  rm,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { Principal } from '../templates/runtime/common/src/core/auth/principal.js';
import type {
  MultipartPart,
  StorageObject,
  StorageProfile,
  ObjectEvidence,
  UploadEvidence,
} from '../templates/runtime/common/src/modules/storage/storage.entity.js';

type MediaRecord = StorageObject &
  Readonly<{
    ownerId: string;
    filename: string;
    createdAt: number;
    expiresAt: number;
    state:
      | 'reserved'
      | 'initiating'
      | 'multipart'
      | 'receiving'
      | 'uploaded'
      | 'finalizing'
      | 'ready'
      | 'deleting'
      | 'failed';
    claim?: Readonly<{ token: string; kind: string; until: number }>;
    deleteAfter?: number;
    stagingPending?: boolean;
    stagingCleanupAt?: number;
  }>;
type MediaOwnerState = Readonly<{
  revision: number;
  entries: readonly MediaRecord[];
}>;

// Isolated compiler/runtime fixtures only. SDK transport below is a controlled fake,
// never an AWS/R2 or browser/CORS conformance test.
const fixture = resolve('var/cli-storage-lifecycle');
type Store = {
  read(owner: string): Promise<MediaOwnerState>;
  change(
    owner: string,
    update: (state: MediaOwnerState) => MediaOwnerState,
  ): Promise<MediaOwnerState>;
  close(): Promise<void>;
};
type Objects = {
  receive(
    r: StorageObject,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<UploadEvidence>;
  finalize(r: StorageObject, create: boolean): Promise<ObjectEvidence>;
  download(
    r: StorageObject,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>>;
  remove(r: StorageObject): Promise<void>;
  discardStaging(r: StorageObject): Promise<void>;
  directGrant(r: StorageObject): Promise<unknown>;
  initiateMultipart(r: StorageObject, reconcile?: boolean): Promise<string>;
  uploadPart(
    r: StorageObject,
    part: MultipartPart,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<MultipartPart>;
};
type Ledger = {
  get(owner: string, id: string): Promise<MediaRecord>;
  reserve(r: MediaRecord): Promise<MediaRecord>;
  change(
    owner: string,
    id: string,
    update: (r: MediaRecord) => MediaRecord,
  ): Promise<MediaRecord>;
};
type Media = {
  begin(
    actor: Principal,
    facts: {
      id: string;
      filename: string;
      bytes: number;
      sha256: string;
      now: number;
      expiresAt: number;
      profile: StorageProfile;
      stagingRoot: string;
      mode?: 'mediated' | 'presigned' | 'multipart';
    },
  ): Promise<MediaRecord>;
  receive(
    actor: Principal,
    id: string,
    source: AsyncIterable<Uint8Array>,
    now: number,
    signal: AbortSignal,
  ): Promise<MediaRecord>;
  finalize(
    actor: Principal,
    id: string,
    now: number,
    manifest?: readonly { partNumber: number; sha256: string; etag: string }[],
  ): Promise<MediaRecord>;
  declarePart(
    actor: Principal,
    id: string,
    part: { partNumber: number; bytes: number; sha256: string },
    now: number,
  ): Promise<unknown>;
  receivePart(
    actor: Principal,
    id: string,
    part: number,
    source: AsyncIterable<Uint8Array>,
    now: number,
    signal: AbortSignal,
  ): Promise<MultipartPart>;
  initiate(actor: Principal, id: string, now: number): Promise<MediaRecord>;
  reconcile(actor: Principal, id: string, now: number): Promise<MediaRecord>;
  remove(
    actor: Principal,
    id: string,
    now: number,
    fence?: MediaRecord,
  ): Promise<void>;
  list(actor: Principal): Promise<readonly MediaRecord[]>;
  cleanup(
    actor: Principal,
    now: number,
  ): Promise<{ removed: number; pending: number; examined: number }>;
};
type Local = Pick<Objects, 'receive' | 'finalize' | 'download' | 'remove'>;
type S3 = Local & {
  initiateMultipart(r: StorageObject, reconcile?: boolean): Promise<string>;
  uploadPart(
    r: StorageObject,
    p: MultipartPart,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<MultipartPart>;
  abortMultipart(r: StorageObject): Promise<void>;
  close(): void;
};
async function runtime<T>(path: string, driver = 'postgres'): Promise<T> {
  return (await import(
    pathToFileURL(`${fixture}/${driver}/dist/${path}.js`).href
  )) as T;
}
before(async () => {
  for (const driver of ['postgres', 'mongodb']) {
    const directory = `${fixture}/${driver}`;
    await mkdir(`${directory}/src/modules`, { recursive: true });
    await mkdir(`${directory}/src/core/auth`, { recursive: true });
    await mkdir(`${directory}/src/core/errors`, { recursive: true });
    await mkdir(`${directory}/src/core/http`, { recursive: true });
    await cp(
      'templates/runtime/common/src/modules/storage',
      `${directory}/src/modules/storage`,
      { recursive: true },
    );
    await cp(
      `templates/runtime/${driver}/src/modules/media`,
      `${directory}/src/modules/media`,
      { recursive: true },
    );
    for (const name of [
      'media-transitions.ts',
      'media.controller.ts',
      'media.entity.ts',
      'media.repository.ts',
      'media.service.ts',
    ])
      await cp(
        `templates/runtime/common/src/modules/media/${name}`,
        `${directory}/src/modules/media/${name}`,
      );
    if (driver === 'mongodb')
      await cp(
        'templates/runtime/common/src/modules/media/mongo-media-state-store.ts',
        `${directory}/src/modules/media/mongo-media-state-store.ts`,
      );
    for (const file of ['principal.ts', 'principal-authority.ts'])
      await cp(
        `templates/runtime/common/src/core/auth/${file}`,
        `${directory}/src/core/auth/${file}`,
      );
    await cp(
      'templates/runtime/common/src/core/errors/application-error.ts',
      `${directory}/src/core/errors/application-error.ts`,
    );
    for (const file of [
      'parse-input.ts',
      'principal.guard.ts',
      'current-principal.decorator.ts',
    ])
      await cp(
        `templates/runtime/common/src/core/http/${file}`,
        `${directory}/src/core/http/${file}`,
      );
    await writeFile(`${directory}/package.json`, '{"type":"module"}\n');
    const dependencyDirectory = `${directory}/node_modules`;
    if (
      await lstat(dependencyDirectory)
        .then((stat) => stat.isSymbolicLink())
        .catch(() => false)
    )
      await rm(dependencyDirectory);
    await mkdir(dependencyDirectory, { recursive: true });
    const referenceModules = resolve(
      driver === 'postgres'
        ? 'examples/reference-api-postgres/node_modules'
        : 'examples/reference-api/node_modules',
    );
    for (const installed of [resolve('node_modules'), referenceModules]) {
      for (const entry of await readdir(installed)) {
        if (entry.startsWith('.')) continue;
        const packages = entry.startsWith('@')
          ? (await readdir(`${installed}/${entry}`)).map(
              (child) => `${entry}/${child}`,
            )
          : [entry];
        for (const name of packages) {
          await mkdir(resolve(dependencyDirectory, name, '..'), {
            recursive: true,
          });
          try {
            await symlink(
              `${installed}/${name}`,
              `${dependencyDirectory}/${name}`,
              'dir',
            );
          } catch (error: unknown) {
            if (!(
              error &&
              typeof error === 'object' &&
              'code' in error &&
              error.code === 'EEXIST'
            ))
              throw error;
          }
        }
      }
    }
    await writeFile(
      `${directory}/tsconfig.json`,
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noUncheckedIndexedAccess: true,
          skipLibCheck: true,
          esModuleInterop: true,
          experimentalDecorators: true,
          rootDir: 'src',
          outDir: 'dist',
          types: ['node'],
        },
        include: ['src/**/*.ts'],
        exclude: [],
      }),
    );
    const compile = spawnSync(
      process.execPath,
      [
        resolve('node_modules/typescript/bin/tsc'),
        '-p',
        `${directory}/tsconfig.json`,
        '--pretty',
        'false',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.equal(
      compile.status,
      0,
      `${driver} isolated compiler: ${compile.stdout}${compile.stderr}`,
    );
  }
});
const sha = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('private untrusted <svg>payload</svg>');
const signal = (): AbortSignal => AbortSignal.timeout(5000);
const stream = (value = bytes): AsyncIterable<Uint8Array> =>
  Readable.from([value]);
const actor: Principal = {
  accountId: 'owner',
  sessionId: 'session',
  installationId: 'installation',
  installationGeneration: 1,
  expiresAt: Date.now() + 3600000,
};
const aws: StorageProfile = {
  version: 1,
  driver: 's3',
  profile: 'aws',
  bucket: 'private-fixture',
  region: 'us-east-1',
  forcePathStyle: false,
};
const r2: StorageProfile = {
  ...aws,
  profile: 'r2',
  region: 'auto',
  endpoint: 'https://fixture.r2.cloudflarestorage.com',
};
async function privateRoot(): Promise<string> {
  await mkdir(fixture, { recursive: true });
  return mkdtemp(`${fixture}/files-`);
}
async function local(): Promise<Local> {
  const { LocalStorageService } = await runtime<{
    LocalStorageService: new () => Local;
  }>('modules/storage/local-storage.service');
  return new LocalStorageService();
}
async function filesystem(root: string) {
  const { PrivateFilesystem } = await runtime<{
    PrivateFilesystem: new (path: string) => {
      initialize(): Promise<void>;
      create(id: string): Promise<unknown>;
      path(area: string, id: string): Promise<string>;
    };
  }>('modules/storage/private-filesystem');
  const fs = new PrivateFilesystem(root);
  await fs.initialize();
  return fs;
}
function facts(
  root: string,
  profile: StorageProfile = { version: 1, driver: 'local', root },
  body = bytes,
): StorageObject {
  return {
    id: randomUUID(),
    attemptId: randomUUID(),
    generation: 1,
    mode: 'mediated',
    profile,
    stagingRoot: root,
    bytes: body.length,
    sha256: sha(body),
    expiresAt: Date.now() + 60000,
  };
}
async function collect(source: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts = [];
  for await (const part of source) parts.push(Buffer.from(part));
  return Buffer.concat(parts);
}
function memory(): Store & { failReady: number } {
  const records = new Map<string, MediaOwnerState>();
  return {
    failReady: 0,
    async read(owner) {
      return records.get(owner) ?? { revision: 0, entries: [] };
    },
    async change(owner, update) {
      // Synchronous update and publication imitate a serialized native owner transaction, not real DB evidence.
      const next = update(records.get(owner) ?? { revision: 0, entries: [] });
      if (
        this.failReady > 0 &&
        next.entries.some((entry) => entry.state === 'ready')
      ) {
        this.failReady -= 1;
        throw new Error('controlled DB commit failure');
      }
      records.set(owner, next);
      return next;
    },
    async close() {},
  };
}
async function setup(
  store: Store = memory(),
  objects?: Objects,
  driver = 'postgres',
  authority = {
    async current(_session: string) {
      return actor;
    },
    async verify(_proof: unknown) {
      return actor;
    },
  },
) {
  const root = await privateRoot();
  await filesystem(root);
  const { MediaRepository } = await runtime<{
    MediaRepository: new (store: Store) => Ledger;
  }>('modules/media/media.repository', driver);
  const { StorageService } = await runtime<{
    StorageService: new (receiver: Local, provider?: unknown) => Objects;
  }>('modules/storage/storage.service', driver);
  const { MediaService } = await runtime<{
    MediaService: new (
      ledger: Ledger,
      objects: Objects,
      authority: unknown,
    ) => Media;
  }>('modules/media/media.service', driver);
  const ledger = new MediaRepository(store);
  const storage = objects ?? new StorageService(await local());
  const service = new MediaService(ledger, storage, authority);
  const begin = (
    body = bytes,
    mode: 'mediated' | 'presigned' | 'multipart' = 'mediated',
    profile?: StorageProfile,
  ) =>
    service.begin(actor, {
      id: randomUUID(),
      filename: 'download.svg',
      bytes: body.length,
      sha256: sha(body),
      now: Date.now(),
      expiresAt: Date.now() + 60000,
      stagingRoot: root,
      profile: profile ?? { version: 1, driver: 'local', root },
      mode,
    });
  return { root, ledger, service, begin, storage };
}
function fakeSdk(profile: StorageProfile) {
  const objects = new Map<string, Buffer>();
  const commands: { name: string; input: Record<string, unknown> }[] = [];
  const uploads = new Map<
    string,
    { key: string; parts: Map<number, Buffer> }
  >();
  let losePut = false;
  let loseComplete = false;
  let losePart = false;
  let loseCreate = false;
  let failGet = false;
  let bucketVersioned = false;
  const client = {
    async send(command: {
      constructor: { name: string };
      input: Record<string, unknown>;
    }) {
      const name = command.constructor.name,
        input = command.input;
      commands.push({ name, input });
      const key = String(input.Key);
      const missing = () =>
        Object.assign(new Error('absent fixture object'), {
          name: 'NoSuchKey',
        });
      if (name === 'GetBucketVersioningCommand')
        return bucketVersioned ? { Status: 'Enabled' } : {};
      if (name === 'GetObjectCommand') {
        if (failGet) throw new Error('controlled outage');
        const body = objects.get(key);
        if (!body) throw missing();
        return {
          Body: Readable.from([body]),
          ETag: `"${sha(body)}"`,
          ContentLength: body.length,
          ...(profile.driver === 's3' && profile.profile === 'aws'
            ? { VersionId: 'exact-version' }
            : {}),
        };
      }
      if (name === 'PutObjectCommand') {
        if (input.IfNoneMatch !== '*')
          throw new Error('missing create-only condition');
        if (objects.has(key))
          throw Object.assign(new Error('exists'), {
            name: 'PreconditionFailed',
          });
        const received = await collect(input.Body as AsyncIterable<Uint8Array>);
        assert.equal(input.ContentLength, received.length);
        assert.equal(
          input.ContentMD5,
          createHash('md5').update(received).digest('base64'),
        );
        objects.set(key, received);
        if (losePut) {
          losePut = false;
          throw new Error('controlled lost PUT ACK');
        }
        return { ETag: 'opaque' };
      }
      if (name === 'DeleteObjectCommand') {
        objects.delete(key);
        return {};
      }
      if (name === 'CreateMultipartUploadCommand') {
        const id = randomUUID();
        uploads.set(id, { key, parts: new Map() });
        if (loseCreate) {
          loseCreate = false;
          throw new Error('controlled lost initiation ACK');
        }
        return { UploadId: id };
      }
      if (name === 'ListMultipartUploadsCommand')
        return {
          Uploads: [...uploads.entries()]
            .filter(([, value]) => value.key.startsWith(String(input.Prefix)))
            .map(([id, value]) => ({ Key: value.key, UploadId: id })),
          IsTruncated: false,
        };
      if (name === 'UploadPartCommand') {
        const upload = uploads.get(String(input.UploadId));
        if (!upload) throw missing();
        const body = Buffer.from(input.Body as Buffer);
        assert.equal(input.ContentLength, body.length);
        assert.equal(
          input.ContentMD5,
          createHash('md5').update(body).digest('base64'),
        );
        if (profile.driver === 's3' && profile.profile === 'aws')
          assert.equal(
            input.ChecksumSHA256,
            Buffer.from(sha(body), 'hex').toString('base64'),
          );
        upload.parts.set(Number(input.PartNumber), body);
        if (losePart) {
          losePart = false;
          throw new Error('controlled lost part ACK');
        }
        return {
          ETag: `"${sha(body)}"`,
          ...(profile.driver === 's3' && profile.profile === 'aws'
            ? {
                ChecksumSHA256: Buffer.from(sha(body), 'hex').toString(
                  'base64',
                ),
              }
            : {}),
        };
      }
      if (name === 'CompleteMultipartUploadCommand') {
        const upload = uploads.get(String(input.UploadId));
        if (!upload)
          throw Object.assign(new Error('already completed'), {
            name: 'NoSuchUpload',
          });
        assert.equal(input.IfNoneMatch, '*');
        const manifest = (
          input.MultipartUpload as {
            Parts: { PartNumber: number; ETag: string }[];
          }
        ).Parts;
        const body = Buffer.concat(
          manifest.map((part) => {
            const body = upload.parts.get(part.PartNumber);
            assert.ok(body);
            assert.equal(part.ETag, `"${sha(body)}"`);
            return body;
          }),
        );
        objects.set(key, body);
        uploads.delete(String(input.UploadId));
        if (loseComplete) {
          loseComplete = false;
          throw new Error('controlled lost complete ACK');
        }
        return { ETag: 'opaque-multipart-etag' };
      }
      if (name === 'AbortMultipartUploadCommand') {
        uploads.delete(String(input.UploadId));
        return {};
      }
      throw new Error(`unexpected fixture command ${name}`);
    },
    destroy() {},
  };
  return {
    client,
    objects,
    commands,
    uploads,
    loseNextPut() {
      losePut = true;
    },
    loseNextComplete() {
      loseComplete = true;
    },
    loseNextPart() {
      losePart = true;
    },
    loseNextCreate() {
      loseCreate = true;
    },
    bucketVersioned(value: boolean) {
      bucketVersioned = value;
    },
    failGet(value: boolean) {
      failGet = value;
    },
  };
}
async function s3Storage(profile: StorageProfile) {
  const fake = fakeSdk(profile);
  const { S3StorageService } = await runtime<{
    S3StorageService: new (
      profile: StorageProfile,
      options: { client: unknown },
    ) => S3;
  }>('modules/storage/s3-storage.service');
  return {
    ...fake,
    service: new S3StorageService(profile, { client: fake.client }),
  };
}

test('local actual private streaming, attachment bytes, exclusive finalization and replay immutability', async () => {
  const root = await privateRoot();
  await filesystem(root);
  const storage = await local();
  const record = facts(root);
  assert.equal((await lstat(root)).mode & 0o777, 0o700);
  const evidence = await storage.receive(record, stream(), signal());
  assert.equal(evidence.sha256, record.sha256);
  await storage.finalize({ ...record, evidence }, true);
  assert.deepEqual(
    await collect(await storage.download(record, signal())),
    bytes,
  );
  await assert.rejects(
    storage.receive(record, stream(Buffer.from('different')), signal()),
  );
  assert.deepEqual(
    await collect(await storage.download(record, signal())),
    bytes,
  );
  await storage.finalize({ ...record, evidence }, false);
  await storage.remove(record);
  await storage.remove(record);
});
test('local oversize, wrong digest, stall abort and exclusive-stage failure clean only owned files', async () => {
  const root = await privateRoot();
  await filesystem(root);
  const storage = await local();
  for (const body of [
    Buffer.concat([bytes, bytes]),
    Buffer.alloc(bytes.length),
  ]) {
    const record = facts(root);
    await assert.rejects(storage.receive(record, stream(body), signal()));
    await assert.rejects(lstat(join(root, 'incoming', record.attemptId!)), {
      code: 'ENOENT',
    });
  }
  const record = facts(root);
  await storage.receive(record, stream(), signal());
  await assert.rejects(storage.receive(record, stream(), signal()), {
    code: 'EEXIST',
  });
  assert.deepEqual(
    await readFile(join(root, 'incoming', record.attemptId!)),
    bytes,
  );
  const stalled = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(() => undefined),
      };
    },
  };
  const aborted = facts(root);
  await assert.rejects(
    storage.receive(aborted, stalled, AbortSignal.timeout(20)),
    { code: 'UPLOAD_CANCELLED' },
  );
  await assert.rejects(lstat(join(root, 'incoming', aborted.attemptId!)), {
    code: 'ENOENT',
  });
});
test('local traversal, symlink targets/ancestors and loosened root permissions are denied', async () => {
  const root = await privateRoot();
  const fs = await filesystem(root);
  const storage = await local();
  for (const id of [
    '../outside',
    '%2e%2e%2foutside',
    '/etc/passwd',
    `${randomUUID()}/../other`,
  ])
    await assert.rejects(fs.path('incoming', id));
  const record = facts(root);
  const outside = join(root, 'outside');
  await writeFile(outside, 'sentinel');
  await symlink(outside, join(root, 'incoming', record.attemptId!));
  await assert.rejects(storage.receive(record, stream(), signal()));
  assert.equal(await readFile(outside, 'utf8'), 'sentinel');
  await chmod(root, 0o755);
  await assert.rejects(fs.path('objects', record.id));
  await chmod(root, 0o700);
  await rm(join(root, 'objects'), { recursive: true });
  await symlink(root, join(root, 'objects'));
  await assert.rejects(storage.finalize(record, true));
});
test('both selected state machines: quota races, competing finalizers, replay and current generation authority', async () => {
  for (const driver of ['mongodb', 'postgres']) {
    const store = memory();
    const app = await setup(store, undefined, driver);
    const begun = await Promise.allSettled(
      Array.from({ length: 8 }, () => app.begin()),
    );
    assert.equal(
      begun.filter((result) => result.status === 'fulfilled').length,
      4,
    );
    const record = (
      begun.find(
        (result) => result.status === 'fulfilled',
      ) as PromiseFulfilledResult<MediaRecord>
    ).value;
    await app.service.receive(actor, record.id, stream(), Date.now(), signal());
    const finalizers = await Promise.allSettled([
      app.service.finalize(actor, record.id, Date.now()),
      app.service.finalize(actor, record.id, Date.now()),
    ]);
    assert.ok(finalizers.some((result) => result.status === 'fulfilled'));
    assert.equal(
      (await app.service.finalize(actor, record.id, Date.now())).state,
      'ready',
    );
    await assert.rejects(
      app.service.receive(actor, record.id, stream(), Date.now(), signal()),
      { code: 'MEDIA_STATE_CONFLICT' },
    );
    await assert.rejects(
      app.service.list({ ...actor, installationGeneration: 2 }),
      { code: 'UNAUTHORIZED' },
    );
    const foreign = await setup(memory(), undefined, driver, {
      async current() {
        return { ...actor, accountId: 'foreign' };
      },
      async verify() {
        return actor;
      },
    });
    await assert.rejects(foreign.service.list(actor), { code: 'UNAUTHORIZED' });
  }
});
test('local provider success plus controlled DB failure reconciles exact immutable bytes', async () => {
  const store = memory(),
    app = await setup(store),
    record = await app.begin();
  await app.service.receive(actor, record.id, stream(), Date.now(), signal());
  store.failReady = 1;
  await assert.rejects(
    app.service.finalize(actor, record.id, Date.now()),
    /controlled DB commit failure/,
  );
  assert.equal(
    (await app.ledger.get(actor.accountId, record.id)).state,
    'finalizing',
  );
  assert.equal(
    (await app.service.reconcile(actor, record.id, Date.now())).state,
    'ready',
  );
});
test('controlled AWS/R2 SDK conditional promotion, checksum differences, lost ACK and unknown outcome', async () => {
  for (const profile of [aws, r2]) {
    const root = await privateRoot();
    await filesystem(root);
    const record = facts(root, profile);
    const receiver = await local();
    const evidence = await receiver.receive(record, stream(), signal());
    const storage = await s3Storage(profile);
    storage.loseNextPut();
    const result = await storage.service.finalize(
      { ...record, evidence },
      true,
    );
    assert.equal(result.sha256, record.sha256);
    const put = storage.commands.find(
      (command) => command.name === 'PutObjectCommand',
    )!;
    assert.equal(put.input.IfNoneMatch, '*');
    assert.equal(put.input.ContentLength, bytes.length);
    assert.equal(
      'ChecksumSHA256' in put.input,
      profile.driver === 's3' && profile.profile === 'aws',
    );
    await storage.service.finalize({ ...record, evidence }, true);
    assert.equal(
      storage.commands.filter((command) => command.name === 'PutObjectCommand')
        .length,
      1,
    );
    assert.deepEqual(
      await collect(
        await storage.service.download(
          { ...record, objectEvidence: result },
          signal(),
        ),
      ),
      bytes,
    );
    storage.failGet(true);
    await assert.rejects(storage.service.finalize(record, false), {
      code: 'MEDIA_COMPLETION_UNKNOWN',
    });
    storage.service.close();
  }
});
test('controlled multipart bounded grants, replacement denial, lost part/complete ACK and exact manifest', async () => {
  for (const profile of [aws, r2]) {
    const sdk = await s3Storage(profile);
    const { StorageService } = await runtime<{
      StorageService: new (receiver: Local, provider: S3) => Objects;
    }>('modules/storage/storage.service');
    const storage = new StorageService(await local(), sdk.service);
    const store = memory(),
      app = await setup(store, storage);
    const record = await app.begin(bytes, 'multipart', profile);
    await app.service.declarePart(
      actor,
      record.id,
      { partNumber: 1, bytes: bytes.length, sha256: sha(bytes) },
      Date.now(),
    );
    await assert.rejects(
      app.service.declarePart(
        actor,
        record.id,
        { partNumber: 1, bytes: bytes.length, sha256: 'a'.repeat(64) },
        Date.now(),
      ),
      { code: 'UPLOAD_PART_CONFLICT' },
    );
    await assert.rejects(
      app.service.receivePart(
        actor,
        record.id,
        1,
        stream(Buffer.concat([bytes, bytes])),
        Date.now(),
        signal(),
      ),
      { code: 'UPLOAD_TOO_LARGE' },
    );
    assert.equal(
      sdk.commands.filter((command) => command.name === 'UploadPartCommand')
        .length,
      0,
    );
    sdk.loseNextPart();
    await assert.rejects(
      app.service.receivePart(
        actor,
        record.id,
        1,
        stream(),
        Date.now(),
        signal(),
      ),
      { code: 'MEDIA_COMPLETION_UNKNOWN' },
    );
    const part = await app.service.receivePart(
      actor,
      record.id,
      1,
      stream(),
      Date.now(),
      signal(),
    );
    assert.equal(part.status, 'complete');
    await app.service.receivePart(
      actor,
      record.id,
      1,
      stream(),
      Date.now(),
      signal(),
    );
    assert.equal(
      sdk.commands.filter((command) => command.name === 'UploadPartCommand')
        .length,
      2,
    );
    await assert.rejects(
      app.service.finalize(actor, record.id, Date.now(), [
        { partNumber: 1, sha256: sha(bytes), etag: 'wrong' },
      ]),
      { code: 'INVALID_MULTIPART_MANIFEST' },
    );
    sdk.loseNextComplete();
    store.failReady = 1;
    await assert.rejects(
      app.service.finalize(actor, record.id, Date.now(), [
        { partNumber: 1, sha256: sha(bytes), etag: part.etag! },
      ]),
      /controlled DB commit failure/,
    );
    assert.equal(
      (await app.service.reconcile(actor, record.id, Date.now())).state,
      'ready',
    );
    const readyPut = sdk.commands.find(
      (command) => command.name === 'PutObjectCommand',
    )!;
    assert.ok(String(readyPut.input.Key).startsWith('media/'));
    const complete = sdk.commands.find(
      (command) => command.name === 'CompleteMultipartUploadCommand',
    )!;
    assert.ok(String(complete.input.Key).startsWith('staging/'));
    await assert.rejects(
      app.service.receivePart(
        actor,
        record.id,
        1,
        stream(),
        Date.now(),
        signal(),
      ),
      { code: 'MEDIA_STATE_CONFLICT' },
    );
    sdk.service.close();
  }
});
test('controlled multipart unknown initiation is listed once and exact-generation cleanup aborts it', async () => {
  const sdk = await s3Storage(aws);
  sdk.loseNextCreate();
  const { StorageService } = await runtime<{
    StorageService: new (receiver: Local, provider: S3) => Objects;
  }>('modules/storage/storage.service');
  const app = await setup(
    memory(),
    new StorageService(await local(), sdk.service),
  );
  await assert.rejects(app.begin(bytes, 'multipart', aws), {
    code: 'MEDIA_COMPLETION_UNKNOWN',
  });
  const record = (await app.service.list(actor))[0]!;
  const recovered = await app.service.reconcile(actor, record.id, Date.now());
  assert.ok(recovered.multipart?.uploadId);
  assert.equal(
    sdk.commands.filter(
      (command) => command.name === 'CreateMultipartUploadCommand',
    ).length,
    1,
  );
  await app.service.remove(actor, record.id, Date.now());
  assert.equal(sdk.uploads.size, 0);
  await app.service.remove(actor, record.id, Date.now() + 180001);
  await app.service.remove(actor, record.id, Date.now() + 180002); // Idempotent missing deletion.
  assert.equal((await app.service.list(actor)).length, 0);
  sdk.service.close();
});
test('expiry/deletion retain reservations, cleanup is bounded, stale generation cannot delete replacement', async () => {
  const app = await setup();
  const record = await app.begin();
  await app.service.receive(actor, record.id, stream(), Date.now(), signal());
  await app.service.finalize(actor, record.id, Date.now());
  await app.service.remove(actor, record.id, Date.now());
  assert.equal((await app.service.list(actor))[0]?.state, 'deleting');
  await app.service.remove(actor, record.id, Date.now() + 180001);
  const replacement = await app.service.begin(actor, {
    id: record.id,
    filename: 'replacement',
    bytes: bytes.length,
    sha256: sha(bytes),
    now: Date.now(),
    expiresAt: Date.now() + 60000,
    stagingRoot: app.root,
    profile: { version: 1, driver: 'local', root: app.root },
  });
  assert.notEqual(replacement.attemptId, record.attemptId);
  await assert.rejects(
    app.service.remove(actor, record.id, Date.now() + 999999, record),
    { code: 'MEDIA_GENERATION_CONFLICT' },
  );
  assert.equal(
    (await app.ledger.get(actor.accountId, replacement.id)).state,
    'reserved',
  );
  const result = await app.service.cleanup(actor, Date.now() + 600000);
  assert.ok(result.examined <= 8);
  assert.equal(result.pending, 1);
});
test('AWS direct grant uses the real offline POST helper and exact byte/checksum/key policy', async () => {
  const { awsPostInput, createAwsPostGrant } = await runtime<{
    awsPostInput(record: StorageObject): {
      Bucket: string;
      Key: string;
      Expires: number;
      Conditions: unknown[];
    };
    createAwsPostGrant(
      client: unknown,
      record: StorageObject,
    ): Promise<{
      fields: Record<string, string>;
      url: string;
      expiresAt: number;
    }>;
  }>('modules/storage/aws-post-policy');
  const { S3Client } = await import('@aws-sdk/client-s3');
  const root = await privateRoot();
  const record = { ...facts(root, aws), mode: 'presigned' as const };
  const client = new S3Client({
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'OFFLINEFIXTURE',
      secretAccessKey: 'offline-fixture-not-a-secret',
    },
    requestHandler: {
      async handle() {
        throw new Error('network forbidden in offline signer test');
      },
    },
  });
  try {
    const input = awsPostInput(record);
    assert.ok(input.Key.startsWith('staging/'));
    assert.ok(input.Expires <= 60);
    const grant = await createAwsPostGrant(client, record);
    const policy = JSON.parse(
      Buffer.from(grant.fields.Policy!, 'base64').toString('utf8'),
    ) as { conditions: unknown[]; expiration: string };
    assert.ok(
      policy.conditions.some(
        (condition) =>
          JSON.stringify(condition) ===
          JSON.stringify(['content-length-range', bytes.length, bytes.length]),
      ),
    );
    assert.ok(
      policy.conditions.some(
        (condition) =>
          JSON.stringify(condition) === JSON.stringify({ key: input.Key }),
      ),
    );
    assert.equal(
      grant.fields['x-amz-checksum-sha256'],
      Buffer.from(record.sha256, 'hex').toString('base64'),
    );
    assert.ok(Date.parse(policy.expiration) <= record.expiresAt!);
    assert.ok(grant.url.startsWith('https://'));
    assert.throws(
      () => awsPostInput({ ...record, expiresAt: Date.now() - 1 }),
      { code: 'UPLOAD_EXPIRED' },
    );
    assert.throws(() => awsPostInput({ ...record, profile: r2 }), {
      code: 'UNSUPPORTED_UPLOAD_MODE',
    });
  } finally {
    client.destroy();
  }
});
test('controlled AWS direct staging replay and wrong bytes cannot replace a ready object', async () => {
  const root = await privateRoot();
  await filesystem(root);
  const sdk = await s3Storage(aws);
  const record = { ...facts(root, aws), mode: 'presigned' as const };
  const staging = `staging/${record.id}/${record.attemptId}`,
    ready = `media/${record.id}/${record.attemptId}`;
  sdk.objects.set(staging, bytes);
  const evidence = await sdk.service.finalize(record, true);
  assert.equal(evidence.sha256, record.sha256);
  sdk.objects.set(staging, Buffer.alloc(bytes.length));
  await sdk.service.finalize({ ...record, objectEvidence: evidence }, true);
  assert.deepEqual(sdk.objects.get(ready), bytes);
  assert.equal(
    sdk.commands.filter((command) => command.name === 'PutObjectCommand')
      .length,
    1,
  );
  const bad = { ...facts(root, aws), mode: 'presigned' as const };
  sdk.objects.set(
    `staging/${bad.id}/${bad.attemptId}`,
    Buffer.alloc(bytes.length),
  );
  await assert.rejects(sdk.service.finalize(bad, true), {
    code: 'UPLOAD_INTEGRITY_FAILED',
  });
  assert.ok(!sdk.objects.has(`media/${bad.id}/${bad.attemptId}`));
  sdk.service.close();
});
test('local held file descriptor survives an incoming-directory rename race without following a symlink', async () => {
  const root = await privateRoot();
  await filesystem(root);
  const storage = await local();
  const record = facts(root);
  const outside = await privateRoot();
  const { rename } = await import('node:fs/promises');
  const racing = async function* () {
    yield bytes.subarray(0, 4);
    await rename(join(root, 'incoming'), join(root, 'old-incoming'));
    await symlink(outside, join(root, 'incoming'));
    yield bytes.subarray(4);
  };
  await storage.receive(record, racing(), signal());
  assert.deepEqual(
    await readFile(join(root, 'old-incoming', record.attemptId!)),
    bytes,
  );
  assert.deepEqual(await readdir(outside), []);
  await assert.rejects(storage.finalize(record, true));
});
test('controlled claim races fence active finalizers, abort unknown outcomes and keep cleanup bounded', async () => {
  const store = memory();
  const app = await setup(store);
  const record = await app.begin();
  await app.service.receive(actor, record.id, stream(), Date.now(), signal());
  let finishProvider: (() => void) | undefined;
  const gated = {
    ...app.storage,
    finalize: async (value: StorageObject) => {
      await new Promise<void>((resolve) => {
        finishProvider = resolve;
      });
      return { bytes: value.bytes, sha256: value.sha256 };
    },
  } as Objects;
  // Class prototype methods are intentionally bound explicitly; only finalize is controlled.
  for (const method of [
    'receive',
    'download',
    'remove',
    'discardStaging',
    'directGrant',
    'initiateMultipart',
    'uploadPart',
  ] as const)
    gated[method] = app.storage[method].bind(app.storage) as never;
  const other = await setup(store, gated);
  const finalization = other.service.finalize(actor, record.id, Date.now());
  for (let turn = 0; turn < 20 && !finishProvider; turn += 1)
    await new Promise<void>((resolve) => setImmediate(resolve));
  assert.ok(finishProvider);
  await assert.rejects(app.service.finalize(actor, record.id, Date.now()), {
    code: 'MEDIA_IN_FLIGHT',
  });
  await assert.rejects(app.service.remove(actor, record.id, Date.now()), {
    code: 'MEDIA_IN_FLIGHT',
  });
  finishProvider();
  await finalization;
  const unknown = await app.begin();
  await store.change(actor.accountId, (current) => ({
    revision: current.revision + 1,
    entries: current.entries.map((entry) =>
      entry.id === unknown.id ? { ...entry, state: 'finalizing' } : entry,
    ),
  }));
  await app.service.remove(actor, unknown.id, Date.now());
  assert.equal(
    (await app.ledger.get(actor.accountId, unknown.id)).state,
    'deleting',
  );
  const expired = Date.now() - 60000;
  await store.change(actor.accountId, () => ({
    revision: 99,
    entries: Array.from({ length: 12 }, () => ({
      ...unknown,
      id: randomUUID(),
      attemptId: randomUUID(),
      state: 'failed',
      expiresAt: expired,
    })),
  }));
  const cleanup = await app.service.cleanup(actor, Date.now());
  assert.equal(cleanup.examined, 8);
  assert.equal(cleanup.pending, 12);
});
test(
  'native selected owner store races (external isolated schema supplied; no startup/migration)',
  {
    skip:
      !process.env.TEST_DATABASE_URL || !process.env.VCLI_MEDIA_TEST_DATABASE,
  },
  async () => {
    const driver = process.env.VCLI_MEDIA_TEST_DATABASE;
    assert.ok(
      driver === 'mongodb' || driver === 'postgres',
      'VCLI_MEDIA_TEST_DATABASE must select one DB',
    );
    const module = await runtime<
      Record<
        string,
        { connect(url: string, initialize: boolean): Promise<Store> }
      >
    >(
      `modules/media/${driver === 'mongodb' ? 'mongo' : 'postgres'}-media-state-store`,
      driver,
    );
    const StoreClass =
      module[
        driver === 'mongodb'
          ? 'MongoMediaStateStore'
          : 'PostgresMediaStateStore'
      ]!;
    const native = await StoreClass.connect(
      process.env.TEST_DATABASE_URL!,
      false,
    );
    try {
      const owner = randomUUID();
      const nativeActor = { ...actor, accountId: owner };
      const authority = {
        async current() {
          return nativeActor;
        },
        async verify() {
          return nativeActor;
        },
      };
      const app = await setup(native, undefined, driver, authority);
      const begin = () =>
        app.service.begin(nativeActor, {
          id: randomUUID(),
          filename: 'native.txt',
          bytes: bytes.length,
          sha256: sha(bytes),
          now: Date.now(),
          expiresAt: Date.now() + 60000,
          stagingRoot: app.root,
          profile: { version: 1, driver: 'local', root: app.root },
        });
      const results = await Promise.allSettled(
        Array.from({ length: 12 }, begin),
      );
      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        4,
      );
      const record = (
        results.find(
          (result) => result.status === 'fulfilled',
        ) as PromiseFulfilledResult<MediaRecord>
      ).value;
      await app.service.receive(
        nativeActor,
        record.id,
        stream(),
        Date.now(),
        signal(),
      );
      await Promise.allSettled([
        app.service.finalize(nativeActor, record.id, Date.now()),
        app.service.finalize(nativeActor, record.id, Date.now()),
      ]);
      assert.equal(
        (await app.service.finalize(nativeActor, record.id, Date.now())).state,
        'ready',
      );
      // Real selected owner persistence with controlled provider and controlled commit failure.
      const multipartActor = { ...actor, accountId: randomUUID() };
      const multipartAuthority = {
        async current() {
          return multipartActor;
        },
        async verify() {
          return multipartActor;
        },
      };
      let failReady = 0;
      const failingStore: Store = {
        read: native.read.bind(native),
        close: async () => undefined,
        change: (ownerId, update) =>
          native.change(ownerId, (current) => {
            const next = update(current);
            if (
              failReady &&
              next.entries.some((entry) => entry.state === 'ready')
            ) {
              failReady -= 1;
              throw new Error('controlled native commit failure');
            }
            return next;
          }),
      };
      const sdk = await s3Storage(aws);
      const { StorageService } = await runtime<{
        StorageService: new (receiver: Local, provider: S3) => Objects;
      }>('modules/storage/storage.service', driver);
      try {
        const multipartApp = await setup(
          failingStore,
          new StorageService(await local(), sdk.service),
          driver,
          multipartAuthority,
        );
        const upload = await multipartApp.service.begin(multipartActor, {
          id: randomUUID(),
          filename: 'native-multipart.bin',
          bytes: bytes.length,
          sha256: sha(bytes),
          now: Date.now(),
          expiresAt: Date.now() + 60000,
          stagingRoot: multipartApp.root,
          profile: aws,
          mode: 'multipart',
        });
        await Promise.all([
          multipartApp.service.declarePart(
            multipartActor,
            upload.id,
            { partNumber: 1, bytes: bytes.length, sha256: sha(bytes) },
            Date.now(),
          ),
          multipartApp.service.declarePart(
            multipartActor,
            upload.id,
            { partNumber: 1, bytes: bytes.length, sha256: sha(bytes) },
            Date.now(),
          ),
        ]);
        await assert.rejects(
          multipartApp.service.declarePart(
            multipartActor,
            upload.id,
            { partNumber: 1, bytes: bytes.length, sha256: 'e'.repeat(64) },
            Date.now(),
          ),
          { code: 'UPLOAD_PART_CONFLICT' },
        );
        sdk.loseNextPart();
        await assert.rejects(
          multipartApp.service.receivePart(
            multipartActor,
            upload.id,
            1,
            stream(),
            Date.now(),
            signal(),
          ),
          { code: 'MEDIA_COMPLETION_UNKNOWN' },
        );
        const part = await multipartApp.service.receivePart(
          multipartActor,
          upload.id,
          1,
          stream(),
          Date.now(),
          signal(),
        );
        const manifest = [
          { partNumber: 1, sha256: sha(bytes), etag: part.etag! },
        ];
        sdk.loseNextComplete();
        failReady = 1;
        await assert.rejects(
          multipartApp.service.finalize(
            multipartActor,
            upload.id,
            Date.now(),
            manifest,
          ),
          /controlled native commit failure/,
        );
        const recovered = await multipartApp.service.reconcile(
          multipartActor,
          upload.id,
          Date.now(),
        );
        assert.equal(recovered.state, 'ready');
        assert.equal(
          (
            await multipartApp.service.finalize(
              multipartActor,
              upload.id,
              Date.now(),
            )
          ).attemptId,
          recovered.attemptId,
        );
        await assert.rejects(
          multipartApp.service.receivePart(
            multipartActor,
            upload.id,
            1,
            stream(),
            Date.now(),
            signal(),
          ),
          { code: 'MEDIA_STATE_CONFLICT' },
        );
        await multipartApp.service.remove(
          multipartActor,
          upload.id,
          Date.now(),
        );
        await multipartApp.service.remove(
          multipartActor,
          upload.id,
          Date.now() + 180001,
        );
        const replacement = await multipartApp.service.begin(multipartActor, {
          id: upload.id,
          filename: 'replacement',
          bytes: bytes.length,
          sha256: sha(bytes),
          now: Date.now(),
          expiresAt: Date.now() + 60000,
          stagingRoot: multipartApp.root,
          profile: aws,
        });
        await assert.rejects(
          multipartApp.service.remove(
            multipartActor,
            upload.id,
            Date.now(),
            recovered,
          ),
          { code: 'MEDIA_GENERATION_CONFLICT' },
        );
        assert.notEqual(replacement.attemptId, recovered.attemptId);
      } finally {
        sdk.service.close();
      }
      await native.close();
      const reopened = await StoreClass.connect(
        process.env.TEST_DATABASE_URL!,
        false,
      );
      try {
        assert.equal(
          (await reopened.read(owner)).entries.find(
            (entry) => entry.id === record.id,
          )?.state,
          'ready',
        );
      } finally {
        await reopened.close();
      }
    } finally {
      await native.close();
    }
  },
);

test('selected storage/media renderer emits compileable modes, trusted DI, native owner and provider closure', async () => {
  const tooling = `${fixture}/tooling`;
  await mkdir(tooling, { recursive: true });
  await writeFile(`${tooling}/package.json`, '{"type":"module"}\n');
  for (const [name, target] of [
    ['node_modules', resolve('node_modules')],
    ['templates', resolve('templates')],
  ]) {
    try {
      await symlink(target!, `${tooling}/${name}`, 'dir');
    } catch (error: unknown) {
      if (!(
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ))
        throw error;
    }
  }
  const compiler = spawnSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--ignoreConfig',
      '--types',
      'node',
      '--target',
      'ES2023',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--strict',
      '--skipLibCheck',
      '--esModuleInterop',
      '--rootDir',
      'src',
      '--outDir',
      `${tooling}/dist`,
      'src/recipes/render-capabilities.ts',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.equal(compiler.status, 0, compiler.stdout + compiler.stderr);
  const renderer = (await import(
    pathToFileURL(`${tooling}/dist/recipes/render-capabilities.js`).href
  )) as {
    storageFiles(config: unknown): Promise<{ path: string; content: string }[]>;
    mediaFiles(config: unknown): Promise<{ path: string; content: string }[]>;
  };
  const { dirname } = await import('node:path');
  const { checkArchitecture } = (await import(
    pathToFileURL(
      resolve('templates/runtime/common/scripts/architecture-rules.ts'),
    ).href
  )) as { checkArchitecture(path: string): Promise<{ failures: string[] }> };
  for (const driver of ['mongodb', 'postgres'])
    for (const [profile, modes] of [
      ['local', ['mediated']],
      ['aws-s3', ['mediated']],
      ['aws-s3', ['mediated', 'presigned', 'multipart']],
      ['r2', ['mediated', 'multipart']],
    ] as const) {
      const config = {
        schemaVersion: 1,
        project: { name: 'storage-fixture', packageManager: 'npm' },
        capabilities: {
          database: { recipe: `database.${driver}`, options: {} },
          storage: { recipe: `storage.${profile}`, options: {} },
          media: { recipe: 'media.private', options: { modes } },
        },
      };
      const files = [
        ...(await renderer.storageFiles(config)),
        ...(await renderer.mediaFiles(config)),
      ];
      const directory = `${fixture}/selected-${driver}-${profile}-${modes.length}`;
      await mkdir(directory, { recursive: true });
      const modules = `${fixture}/${driver}/node_modules`;
      try {
        await symlink(modules, `${directory}/node_modules`, 'dir');
      } catch (error: unknown) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EEXIST'
        ))
          throw error;
      }
      for (const file of files) {
        await mkdir(dirname(`${directory}/${file.path}`), { recursive: true });
        await writeFile(`${directory}/${file.path}`, file.content);
      }
      await cp(`${fixture}/${driver}/src/core`, `${directory}/src/core`, {
        recursive: true,
      });
      await cp(
        'templates/runtime/common/src/core/http/http-security.module.ts',
        `${directory}/src/core/http/http-security.module.ts`,
      );
      await mkdir(`${directory}/src/core/config`, { recursive: true });
      await writeFile(
        `${directory}/src/core/config/app-config.ts`,
        `export type AppConfig={database:{url:string};storage:{modes:readonly ('mediated'|'presigned'|'multipart')[];bucket:string;region:string;endpoint?:string;forcePathStyle:boolean}};`,
      );
      await cp(
        'templates/runtime/common/clients/media-client.ts',
        `${directory}/src/media-client.ts`,
      );
      await writeFile(`${directory}/package.json`, '{"type":"module"}\n');
      await cp(
        `${fixture}/${driver}/tsconfig.json`,
        `${directory}/tsconfig.json`,
      );
      assert.deepEqual(
        (await checkArchitecture(`${directory}/src`)).failures,
        [],
      );
      const compile = spawnSync(
        process.execPath,
        [
          resolve('node_modules/typescript/bin/tsc'),
          '-p',
          `${directory}/tsconfig.json`,
          '--noEmit',
          '--pretty',
          'false',
        ],
        { encoding: 'utf8', timeout: 30000 },
      );
      assert.equal(
        compile.status,
        0,
        `${driver}/${profile}/${modes.length}: ${compile.stdout}${compile.stderr}`,
      );
      const names = files.map((file) => file.path);
      assert.equal(
        names.includes('src/modules/storage/aws-post-policy.ts'),
        (modes as readonly string[]).includes('presigned'),
      );
      assert.equal(
        names.includes('src/modules/storage/s3-storage.service.ts'),
        profile !== 'local',
      );
      assert.ok(
        !names.some((name) =>
          name.includes(
            driver === 'mongodb' ? 'postgres-media' : 'mongo-media',
          ),
        ),
      );
      const caps = files.find((file) =>
        file.path.endsWith('storage-capabilities.ts'),
      )!.content;
      assert.equal((caps.match(/\/\/ BEGIN /g) ?? []).length, 1);
      const factory = files.find((file) =>
        file.path.endsWith('media.module.ts'),
      )!.content;
      assert.ok(
        factory.includes('new MediaService(repository,storage,authority)'),
      );
      assert.ok(factory.includes('modes:config.storage.modes'));
      const module = files.find((file) =>
        file.path.endsWith('storage.module.ts'),
      )!.content;
      assert.equal(
        module.includes("from './aws-post-policy.js'"),
        (modes as readonly string[]).includes('presigned'),
      );
    }
});

test('controlled AWS direct grant denies versioned buckets before signing', async () => {
  const fake = fakeSdk(aws);
  const { S3StorageService } = await runtime<{
    S3StorageService: new (
      profile: StorageProfile,
      options: unknown,
    ) => S3 & { directGrant(r: StorageObject): Promise<unknown> };
  }>('modules/storage/s3-storage.service');
  let signed = 0;
  const storage = new S3StorageService(aws, {
    client: fake.client,
    directPost: async () => {
      signed += 1;
      return {
        kind: 's3-post',
        method: 'POST',
        url: 'https://fixture.invalid',
        fields: {},
        bytes: bytes.length,
        expiresAt: Date.now() + 1000,
      };
    },
  });
  const root = await privateRoot(),
    record = { ...facts(root, aws), mode: 'presigned' as const };
  try {
    fake.bucketVersioned(true);
    await assert.rejects(storage.directGrant(record), {
      code: 'DIRECT_UPLOAD_REQUIRES_UNVERSIONED_BUCKET',
    });
    assert.equal(signed, 0);
    fake.bucketVersioned(false);
    await storage.directGrant(record);
    assert.equal(signed, 1);
  } finally {
    storage.close();
  }
});

test('actual download stream slots are bounded and abort before consumption releases file handles safely', async () => {
  const app = await setup();
  const record = await app.begin();
  await app.service.receive(actor, record.id, stream(), Date.now(), signal());
  const ready = await app.service.finalize(actor, record.id, Date.now());
  const controllers = Array.from({ length: 4 }, () => new AbortController());
  try {
    await Promise.all(
      controllers.map((controller) =>
        app.storage.download(ready, controller.signal),
      ),
    );
    await assert.rejects(app.storage.download(ready, signal()), {
      code: 'STORAGE_BUSY',
    });
  } finally {
    controllers.forEach((controller) => controller.abort());
  }
  assert.deepEqual(
    await collect(await app.storage.download(ready, signal())),
    bytes,
  );
});

test('ready media exposes partial transient cleanup and bounded retry preserves committed bytes', async () => {
  const base = await setup();
  let failCleanup = true;
  const wrapped = {} as Objects;
  for (const method of [
    'receive',
    'finalize',
    'download',
    'remove',
    'directGrant',
    'initiateMultipart',
    'uploadPart',
  ] as const)
    wrapped[method] = base.storage[method].bind(base.storage) as never;
  wrapped.discardStaging = async (record) => {
    if (failCleanup) throw new Error('controlled transient cleanup failure');
    await base.storage.discardStaging(record);
  };
  const app = await setup(memory(), wrapped),
    record = await app.begin();
  await app.service.receive(actor, record.id, stream(), Date.now(), signal());
  const ready = await app.service.finalize(actor, record.id, Date.now());
  assert.equal(ready.state, 'ready');
  assert.equal(ready.stagingPending, true);
  assert.equal((await app.service.cleanup(actor, Date.now())).pending, 1);
  failCleanup = false;
  assert.equal((await app.service.cleanup(actor, Date.now())).pending, 0);
  assert.equal(
    (await app.ledger.get(actor.accountId, record.id)).stagingPending,
    false,
  );
  assert.deepEqual(
    await collect(await base.storage.download(ready, signal())),
    bytes,
  );
});

test('controlled AWS/R2 two-part uploads enforce partition bounds and ordered unique manifests', async () => {
  const first = Buffer.alloc(8388608, 0x61),
    last = Buffer.from('last-private-part');
  const completeBody = Buffer.concat([first, last]);
  for (const profile of [aws, r2]) {
    const sdk = await s3Storage(profile);
    const { StorageService } = await runtime<{
      StorageService: new (receiver: Local, provider: S3) => Objects;
    }>('modules/storage/storage.service');
    const app = await setup(
      memory(),
      new StorageService(await local(), sdk.service),
    );
    try {
      const record = await app.begin(completeBody, 'multipart', profile);
      await assert.rejects(
        app.service.declarePart(
          actor,
          record.id,
          { partNumber: 0, bytes: first.length, sha256: sha(first) },
          Date.now(),
        ),
        { code: 'INVALID_UPLOAD_PART' },
      );
      await assert.rejects(
        app.service.declarePart(
          actor,
          record.id,
          { partNumber: 3, bytes: last.length, sha256: sha(last) },
          Date.now(),
        ),
        { code: 'INVALID_UPLOAD_PART' },
      );
      await assert.rejects(
        app.service.declarePart(
          actor,
          record.id,
          { partNumber: 1, bytes: first.length - 1, sha256: sha(first) },
          Date.now(),
        ),
        { code: 'INVALID_UPLOAD_PART' },
      );
      const receipts = [];
      for (const [index, body] of [first, last].entries()) {
        await app.service.declarePart(
          actor,
          record.id,
          { partNumber: index + 1, bytes: body.length, sha256: sha(body) },
          Date.now(),
        );
        receipts.push(
          await app.service.receivePart(
            actor,
            record.id,
            index + 1,
            stream(body),
            Date.now(),
            signal(),
          ),
        );
      }
      const manifest = receipts.map((part) => ({
        partNumber: part.partNumber,
        sha256: part.sha256,
        etag: part.etag!,
      }));
      await assert.rejects(
        app.service.finalize(actor, record.id, Date.now(), [
          manifest[0]!,
          manifest[0]!,
        ]),
        { code: 'INVALID_MULTIPART_MANIFEST' },
      );
      await assert.rejects(
        app.service.finalize(
          actor,
          record.id,
          Date.now(),
          [...manifest].reverse(),
        ),
        { code: 'INVALID_MULTIPART_MANIFEST' },
      );
      const ready = await app.service.finalize(
        actor,
        record.id,
        Date.now(),
        manifest,
      );
      assert.equal(ready.state, 'ready');
      assert.equal(ready.sha256, sha(completeBody));
      assert.deepEqual(
        await collect(await app.storage.download(ready, signal())),
        completeBody,
      );
      const completion = sdk.commands.find(
        (command) => command.name === 'CompleteMultipartUploadCommand',
      )!;
      assert.equal(
        (completion.input.MultipartUpload as { Parts: unknown[] }).Parts.length,
        2,
      );
    } finally {
      sdk.service.close();
    }
  }
});
