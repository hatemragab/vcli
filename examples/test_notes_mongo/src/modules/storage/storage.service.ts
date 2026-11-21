import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import { PrivateFilesystem } from './private-filesystem.js';
import { boundedStream } from './bounded-stream.js';
import { requireUploadMode } from './storage-capabilities.js';
import {
  STORAGE_LIMITS,
  storageId,
  type DirectGrant,
  type MultipartPart,
  type ObjectEvidence,
  type StorageObject,
  type UploadEvidence,
} from './storage.entity.js';
import type { StorageProvider } from './storage-provider.js';
interface UploadReceiver {
  receive(
    record: StorageObject,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<UploadEvidence>;
}
@Injectable()
export class StorageService {
  private active = 0;
  private configured = false;
  /** Called at the composition edge before serving requests; repeated registration is stable. */
  configureProviders(
    providers:
      | StorageProvider
      | ((profile: StorageObject['profile']) => StorageProvider),
  ): void {
    if (this.providers === providers) return;
    if (this.configured || this.active || this.clients.size)
      throw new ApplicationError('STORAGE_ALREADY_CONFIGURED', 500);
    this.providers = providers;
    this.configured = true;
  }
  private readonly clients = new Map<string, StorageProvider>();
  private provider(record: StorageObject): StorageProvider {
    if (typeof this.providers !== 'function') return this.providers;
    const key = JSON.stringify(record.profile);
    let client = this.clients.get(key);
    if (!client) {
      if (this.clients.size >= 32)
        throw new ApplicationError('STORAGE_PROFILE_LIMIT', 503);
      client = this.providers(record.profile);
      this.clients.set(key, client);
    }
    return client;
  }
  constructor(
    private readonly receiver: UploadReceiver,
    private providers:
      | StorageProvider
      | ((
          profile: StorageObject['profile'],
        ) => StorageProvider) = receiver as UploadReceiver & StorageProvider,
  ) {
    this.configured = !Object.is(providers, receiver);
  }
  private async bounded<T>(operation: () => Promise<T>): Promise<T> {
    if (this.active >= STORAGE_LIMITS.processTransfers)
      throw new ApplicationError('STORAGE_BUSY', 503);
    this.active += 1;
    try {
      return await operation();
    } finally {
      this.active -= 1;
    }
  }
  receive(
    record: StorageObject,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<UploadEvidence> {
    return this.bounded(() => this.receiver.receive(record, source, signal));
  }
  directGrant(record: StorageObject): Promise<DirectGrant> {
    requireUploadMode(record.profile, 'presigned');
    if (!this.provider(record).directGrant)
      throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
    return this.bounded(() => this.provider(record).directGrant!(record));
  }
  initiateMultipart(record: StorageObject, reconcile = false): Promise<string> {
    requireUploadMode(record.profile, 'multipart');
    if (!this.provider(record).initiateMultipart)
      throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
    return this.bounded(() =>
      this.provider(record).initiateMultipart!(record, reconcile),
    );
  }
  uploadPart(
    record: StorageObject,
    part: MultipartPart,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<MultipartPart> {
    if (!this.provider(record).uploadPart)
      throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
    return this.bounded(async () => {
      const boundedSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(STORAGE_LIMITS.transferMs),
      ]);
      if (part.bytes < 1 || part.bytes > STORAGE_LIMITS.partBytes)
        throw new ApplicationError('INVALID_UPLOAD_PART', 422);
      const buffer = Buffer.alloc(part.bytes);
      const sha = createHash('sha256');
      let offset = 0;
      for await (const chunk of boundedStream(
        source,
        part.bytes,
        boundedSignal,
      )) {
        buffer.set(chunk, offset);
        offset += chunk.byteLength;
        sha.update(chunk);
      }
      if (offset !== part.bytes || sha.digest('hex') !== part.sha256)
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      if (part.status === 'complete') return part;
      return this.provider(record).uploadPart!(
        record,
        part,
        buffer,
        boundedSignal,
      );
    });
  }
  finalize(record: StorageObject, mayCreate: boolean): Promise<ObjectEvidence> {
    return this.bounded(() =>
      this.provider(record).finalize(record, mayCreate),
    );
  }
  async download(
    record: StorageObject,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    if (this.active >= STORAGE_LIMITS.processTransfers)
      throw new ApplicationError('STORAGE_BUSY', 503);
    this.active += 1;
    const boundedSignal = AbortSignal.any([
      signal,
      AbortSignal.timeout(STORAGE_LIMITS.transferMs),
    ]);
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.active -= 1;
        boundedSignal.removeEventListener('abort', release);
      }
    };
    boundedSignal.addEventListener('abort', release, { once: true });
    try {
      boundedSignal.throwIfAborted();
      const source = await this.provider(record).download(
        record,
        boundedSignal,
      );
      return (async function* () {
        let bytes = 0;
        try {
          for await (const chunk of boundedStream(
            source,
            record.bytes,
            boundedSignal,
          )) {
            bytes += chunk.byteLength;
            yield chunk;
          }
          if (bytes !== record.bytes)
            throw new ApplicationError('STORAGE_INTEGRITY_FAILED', 503);
        } finally {
          release();
        }
      })();
    } catch (error: unknown) {
      release();
      throw error;
    }
  }
  remove(record: StorageObject): Promise<void> {
    return this.bounded(async () => {
      const provider = this.provider(record);
      if (record.multipart && provider.abortMultipart)
        await provider.abortMultipart(record);
      await provider.remove(record);
      await new PrivateFilesystem(record.stagingRoot).remove(
        'incoming',
        storageId(record),
      );
    });
  }
  async discardStaging(record: StorageObject): Promise<void> {
    await this.bounded(async () => {
      const provider = this.provider(record);
      if (provider.discardStaging) await provider.discardStaging(record);
      await new PrivateFilesystem(record.stagingRoot).remove(
        'incoming',
        storageId(record),
      );
    });
  }
  onModuleDestroy(): void {
    this.close();
  }
  close(): void {
    if (typeof this.providers !== 'function') this.providers.close?.();
    for (const client of this.clients.values()) client.close?.();
    this.clients.clear();
  }
}
