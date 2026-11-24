import {
  databaseTest as test,
  postgresFixture,
  configDatabaseUrl,
} from './helpers/postgres-fixture.ts';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MediaService } from '../dist/modules/media/media.service.js';
import { PostgresMediaStateStore } from '../dist/modules/media/postgres-media-state-store.js';
import { MediaRepository } from '../dist/modules/media/media.repository.js';
import { PrivateFilesystem } from '../dist/modules/storage/private-filesystem.js';
import { StorageService } from '../dist/modules/storage/storage.service.js';
import { LocalStorageService } from '../dist/modules/storage/local-storage.service.js';
import { s3PutInput } from '../dist/modules/storage/s3-storage.service.js';
import { selectedStorageProfile } from '../dist/modules/storage/storage.module.js';
import { decodeMediaState } from '../dist/modules/media/media-storage-mapping.js';
import { loadConfig } from '../dist/core/config/load-config.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'reference-media-'));
  await chmod(root, 0o700);
  const filesystem = new PrivateFilesystem(root);
  await filesystem.initialize();
  const testDatabase = await postgresFixture();
  const store = await PostgresMediaStateStore.connect(testDatabase.url, true);
  const ledger = new MediaRepository(store);
  const objects = new StorageService(new LocalStorageService());
  const service = new MediaService(ledger, objects);
  const begin = (ownerId = 'owner', content = Buffer.from('private bytes')) =>
    service.begin({
      ownerId,
      id: randomUUID(),
      filename: 'private.html',
      bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex'),
      now: 1000,
      expiresAt: 100000,
      profile: { version: 1, driver: 'local', root },
      stagingRoot: root,
    });
  return {
    root,
    filesystem,
    store,
    ledger,
    objects,
    service,
    begin,
    close: async () => {
      objects.close();
      await store.close();
      await testDatabase.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function* chunks(content: Uint8Array) {
  yield content.subarray(0, 2);
  yield content.subarray(2);
}

test('persisted media is validated and mapped before entering owner operations', async () => {
  const f = await fixture();
  try {
    const record = await f.begin();
    assert.equal(
      decodeMediaState({ revision: 1, entries: [record] }, 'owner').entries[0]
        ?.id,
      record.id,
    );
    assert.throws(
      () =>
        decodeMediaState({ revision: 1, entries: [record] }, 'another-owner'),
      { code: 'INVALID_MEDIA_PERSISTENCE' },
    );
    assert.throws(
      () =>
        decodeMediaState(
          { revision: 1, entries: [{ ...record, bytes: 'large' }] },
          'owner',
        ),
      { code: 'INVALID_MEDIA_PERSISTENCE' },
    );
  } finally {
    await f.close();
  }
});

test('local media streams, finalizes immutably, authorizes owner and deletes exact object', async () => {
  const f = await fixture();
  try {
    const content = Buffer.from('private bytes');
    const record = await f.begin();
    await assert.rejects(f.service.ready('other', record.id), {
      code: 'MEDIA_NOT_FOUND',
    });
    await f.service.receive(
      'owner',
      record.id,
      chunks(content),
      2000,
      new AbortController().signal,
    );
    const ready = await f.service.finalize('owner', record.id, 3000);
    assert.equal(ready.state, 'ready');
    assert.equal(
      (await f.service.finalize('owner', record.id, 4000)).id,
      record.id,
    );
    await assert.rejects(
      f.service.receive(
        'owner',
        record.id,
        chunks(Buffer.from('changed bytes')),
        4000,
        new AbortController().signal,
      ),
      { code: 'MEDIA_STATE_CONFLICT' },
    );
    const output: Uint8Array[] = [];
    for await (const chunk of await f.service.download(
      ready,
      new AbortController().signal,
    ))
      output.push(chunk);
    assert.deepEqual(Buffer.concat(output), content);
    assert.equal(
      (await lstat(join(f.root, 'objects', record.id))).mode & 0o222,
      0,
    );
    await f.service.remove('owner', record.id, 5000);
    assert.deepEqual(await f.service.list('owner'), []);
    await assert.rejects(readFile(join(f.root, 'objects', record.id)), {
      code: 'ENOENT',
    });
  } finally {
    await f.close();
  }
});

test('concurrent reservations never exceed four active attempts and quota is owner isolated', async () => {
  const f = await fixture();
  try {
    const attempts = await Promise.allSettled(
      Array.from({ length: 20 }, () => f.begin()),
    );
    assert.equal(
      attempts.filter((entry) => entry.status === 'fulfilled').length,
      4,
    );
    assert.equal((await f.service.list('owner')).length, 4);
    assert.equal((await f.begin('another-owner')).ownerId, 'another-owner');
  } finally {
    await f.close();
  }
});

test('failed checksum and oversized streams never become ready; cleanup releases failed reservation', async () => {
  const f = await fixture();
  try {
    const record = await f.begin();
    await assert.rejects(
      f.service.receive(
        'owner',
        record.id,
        chunks(Buffer.from('wrong content')),
        2000,
        new AbortController().signal,
      ),
      { code: 'UPLOAD_INTEGRITY_FAILED' },
    );
    assert.equal((await f.ledger.get('owner', record.id)).state, 'failed');
    await assert.rejects(f.service.finalize('owner', record.id, 3000), {
      code: 'MEDIA_STATE_CONFLICT',
    });
    const oversized = await f.begin();
    await assert.rejects(
      f.service.receive(
        'owner',
        oversized.id,
        chunks(Buffer.alloc(100)),
        2000,
        new AbortController().signal,
      ),
      { code: 'UPLOAD_TOO_LARGE' },
    );
    assert.deepEqual(await f.service.cleanup('owner', 200000), {
      removed: 2,
      pending: 0,
    });
  } finally {
    await f.close();
  }
});

test('expired and cancelled attempts reject transfer without retained partial bytes', async () => {
  const f = await fixture();
  try {
    const expired = await f.begin();
    await assert.rejects(
      f.service.receive(
        'owner',
        expired.id,
        chunks(Buffer.from('private bytes')),
        100001,
        new AbortController().signal,
      ),
      { code: 'UPLOAD_EXPIRED' },
    );
    const cancelled = await f.begin();
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(
      f.service.receive(
        'owner',
        cancelled.id,
        chunks(Buffer.from('private bytes')),
        2000,
        abort.signal,
      ),
      { code: 'UPLOAD_CANCELLED' },
    );
    await assert.rejects(readFile(join(f.root, 'incoming', cancelled.id)), {
      code: 'ENOENT',
    });
  } finally {
    await f.close();
  }
});

test('path traversal, symlink ancestors and non-private roots are rejected', async () => {
  const f = await fixture();
  const elsewhere = await mkdtemp(join(tmpdir(), 'reference-outside-'));
  try {
    await assert.rejects(f.filesystem.path('incoming', '../outside'), {
      code: 'UNSAFE_STORAGE_PATH',
    });
    await symlink(elsewhere, join(f.root, 'linked'));
    await assert.rejects(
      new PrivateFilesystem(join(f.root, 'linked', 'storage')).initialize(),
      { code: 'UNSAFE_STORAGE_PATH' },
    );
    await chmod(f.root, 0o755);
    await assert.rejects(f.filesystem.initialize(), {
      code: 'STORAGE_ROOT_MUST_BE_PRIVATE',
    });
    await chmod(f.root, 0o700);
  } finally {
    await f.close();
    await rm(elsewhere, { recursive: true, force: true });
  }
});

test('exclusive creation refuses symlink file without modifying its target', async () => {
  const f = await fixture();
  try {
    const outside = join(f.root, 'sentinel');
    await writeFile(outside, 'unchanged');
    const record = await f.begin();
    await symlink(outside, join(f.root, 'incoming', record.id));
    await assert.rejects(
      f.service.receive(
        'owner',
        record.id,
        chunks(Buffer.from('private bytes')),
        2000,
        new AbortController().signal,
      ),
    );
    assert.equal(await readFile(outside, 'utf8'), 'unchanged');
  } finally {
    await f.close();
  }
});

test('provider success followed by database failure is reconciled without another write', async () => {
  const f = await fixture();
  try {
    const record = await f.begin();
    await f.service.receive(
      'owner',
      record.id,
      chunks(Buffer.from('private bytes')),
      2000,
      new AbortController().signal,
    );
    let first = true;
    const ledger = {
      reserve: f.ledger.reserve.bind(f.ledger),
      list: f.ledger.list.bind(f.ledger),
      get: f.ledger.get.bind(f.ledger),
      forget: f.ledger.forget.bind(f.ledger),
      transition: async (...args: Parameters<typeof f.ledger.transition>) => {
        if (args[3] === 'ready' && first) {
          first = false;
          throw new Error('simulated database outage');
        }
        return f.ledger.transition(...args);
      },
    };
    const service = new MediaService(ledger, f.objects);
    await assert.rejects(service.finalize('owner', record.id, 3000));
    assert.equal((await f.ledger.get('owner', record.id)).state, 'finalizing');
    assert.equal(
      (await service.finalize('owner', record.id, 4000)).state,
      'ready',
    );
    assert.equal(
      await readFile(join(f.root, 'objects', record.id), 'utf8'),
      'private bytes',
    );
  } finally {
    await f.close();
  }
});

test('unknown completion holds reservation and only the first finalizer may write', async () => {
  const f = await fixture();
  try {
    const record = await f.begin();
    await f.service.receive(
      'owner',
      record.id,
      chunks(Buffer.from('private bytes')),
      2000,
      new AbortController().signal,
    );
    const permissions: boolean[] = [];
    const service = new MediaService(f.ledger, {
      receive: f.objects.receive.bind(f.objects),
      download: f.objects.download.bind(f.objects),
      remove: f.objects.remove.bind(f.objects),
      finalize: async (_record, mayCreate) => {
        permissions.push(mayCreate);
        throw new Error('unknown');
      },
    });
    await assert.rejects(service.finalize('owner', record.id, 3000));
    await assert.rejects(service.finalize('owner', record.id, 4000));
    assert.deepEqual(permissions, [true, false]);
    assert.deepEqual(await service.cleanup('owner', 200000), {
      removed: 0,
      pending: 1,
    });
    await assert.rejects(service.remove('owner', record.id, 200000), {
      code: 'MEDIA_IN_FLIGHT',
    });
  } finally {
    await f.close();
  }
});

test('S3 translation binds conditional creation, exact size and provider-specific checksum policy', async () => {
  const f = await fixture();
  try {
    const record = await f.begin();
    const evidence = {
      bytes: record.bytes,
      sha256: record.sha256,
      md5: 'known-md5',
    };
    const aws = s3PutInput({
      ...record,
      evidence,
      profile: {
        version: 1,
        driver: 's3',
        profile: 'aws',
        bucket: 'test',
        region: 'us-east-1',
        forcePathStyle: false,
      },
    });
    assert.equal(aws.IfNoneMatch, '*');
    assert.equal(aws.ContentLength, record.bytes);
    assert.equal(
      aws.ChecksumSHA256,
      Buffer.from(record.sha256, 'hex').toString('base64'),
    );
    const r2 = s3PutInput({
      ...record,
      evidence,
      profile: {
        version: 1,
        driver: 's3',
        profile: 'r2',
        bucket: 'test',
        region: 'auto',
        endpoint: 'https://example.r2.cloudflarestorage.com',
        forcePathStyle: true,
      },
    });
    assert.equal(r2.ContentMD5, evidence.md5);
    assert.equal('ChecksumSHA256' in r2, false);
    assert.equal('ACL' in r2, false);
    const config = loadConfig({ DATABASE_URL: configDatabaseUrl });
    assert.throws(
      () =>
        selectedStorageProfile(
          {
            ...config,
            storage: {
              ...config.storage,
              driver: 's3',
              bucket: 'test',
              s3Profile: 'custom',
            },
          },
          f.root,
        ),
      { code: 'UNSUPPORTED_STORAGE_PROFILE' },
    );
  } finally {
    await f.close();
  }
});
