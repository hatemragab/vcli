import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  STORAGE_LIMITS,
  storageId,
  type ObjectEvidence,
  type StorageObject,
  type UploadEvidence,
} from './storage.entity.js';
import { boundedStream } from './bounded-stream.js';
import { isMissing, PrivateFilesystem } from './private-filesystem.js';
type LocalStorageObject = Omit<StorageObject, 'profile'> &
  Readonly<{ profile: { version: 1; driver: 'local'; root: string } }>;
@Injectable()
export class LocalStorageService {
  private active = 0;
  async receive(
    record: StorageObject,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<UploadEvidence> {
    if (this.active >= STORAGE_LIMITS.processTransfers)
      throw new ApplicationError('UPLOAD_BUSY', 503);
    this.active += 1;
    const filesystem = new PrivateFilesystem(record.stagingRoot);
    const sha = createHash('sha256');
    const md5 = createHash('md5');
    let bytes = 0;
    let created = false;
    try {
      signal.throwIfAborted();
      if ('root' in record.profile) await filesystem.initialize();
      const handle = await filesystem.create(storageId(record));
      created = true;
      try {
        for await (const chunk of boundedStream(
          source,
          record.bytes,
          AbortSignal.any([
            signal,
            AbortSignal.timeout(STORAGE_LIMITS.transferMs),
          ]),
        )) {
          signal.throwIfAborted();
          bytes += chunk.byteLength;
          if (bytes > record.bytes)
            throw new ApplicationError('UPLOAD_TOO_LARGE', 413);
          sha.update(chunk);
          md5.update(chunk);
          let offset = 0;
          while (offset < chunk.byteLength) {
            const result = await handle.write(
              chunk,
              offset,
              chunk.byteLength - offset,
            );
            if (result.bytesWritten === 0)
              throw new ApplicationError('STORAGE_UNAVAILABLE', 503);
            offset += result.bytesWritten;
          }
        }
        signal.throwIfAborted();
        const evidence = {
          bytes,
          sha256: sha.digest('hex'),
          md5: md5.digest('base64'),
        };
        if (bytes !== record.bytes || evidence.sha256 !== record.sha256)
          throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
        await handle.sync();
        await handle.chmod(0o400);
        return evidence;
      } finally {
        await handle.close();
      }
    } catch (error: unknown) {
      if (created)
        await filesystem
          .remove('incoming', storageId(record))
          .catch(() => undefined);
      if (signal.aborted) throw new ApplicationError('UPLOAD_CANCELLED', 408);
      throw error;
    } finally {
      this.active -= 1;
    }
  }
  async finalize(
    record: LocalStorageObject,
    mayCreate: boolean,
  ): Promise<ObjectEvidence> {
    if (record.profile.driver !== 'local')
      throw new ApplicationError('INVALID_STORAGE_PROFILE', 500);
    const filesystem = new PrivateFilesystem(record.profile.root);
    let evidence: UploadEvidence | undefined;
    try {
      evidence = await filesystem.evidence(
        'objects',
        storageId(record),
        record.bytes,
      );
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
    }
    if (!evidence) {
      if (!mayCreate)
        throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
      const staged = await filesystem.evidence(
        'incoming',
        storageId(record),
        record.bytes,
      );
      if (staged.bytes !== record.bytes || staged.sha256 !== record.sha256)
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      try {
        await filesystem.promote(storageId(record));
      } catch (error: unknown) {
        if (!(
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EEXIST'
        ))
          throw error;
      }
      evidence = await filesystem.evidence(
        'objects',
        storageId(record),
        record.bytes,
      );
    }
    if (evidence.bytes !== record.bytes || evidence.sha256 !== record.sha256)
      throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
    return { bytes: evidence.bytes, sha256: evidence.sha256 };
  }
  async download(
    record: LocalStorageObject,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    if (record.profile.driver !== 'local')
      throw new ApplicationError('INVALID_STORAGE_PROFILE', 500);
    const handle = await new PrivateFilesystem(record.profile.root).read(
      'objects',
      storageId(record),
    );
    const source = handle.createReadStream({ signal });
    source.on('error', () => undefined); // Cancellation may precede consumer attachment.
    return source;
  }
  async remove(record: LocalStorageObject): Promise<void> {
    if (record.profile.driver !== 'local')
      throw new ApplicationError('INVALID_STORAGE_PROFILE', 500);
    await new PrivateFilesystem(record.profile.root).remove(
      'objects',
      storageId(record),
    );
  }
}
