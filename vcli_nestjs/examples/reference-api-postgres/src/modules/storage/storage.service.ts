import { Injectable } from '@nestjs/common';
import type { StorageObject, UploadEvidence } from './storage.entity.js';
import { LocalStorageService } from './local-storage.service.js';
import { PrivateFilesystem } from './private-filesystem.js';
import { S3StorageService } from './s3-storage.service.js';

/** Routes each immutable record to its recorded provider, including after a default change. */
@Injectable()
export class StorageService {
  // SDK clients are cached by immutable profile, not resolved from application services.
  private readonly clients = new Map<string, S3StorageService>();

  constructor(private readonly local: LocalStorageService) {}

  receive(
    record: StorageObject,
    source: AsyncIterable<Uint8Array>,
    signal: AbortSignal,
  ): Promise<UploadEvidence> {
    return this.local.receive(record, source, signal);
  }

  async finalize(record: StorageObject, mayCreate: boolean): Promise<void> {
    await this.provider(record).finalize(record, mayCreate);
    await new PrivateFilesystem(record.stagingRoot).remove(
      'incoming',
      record.id,
    );
  }

  download(
    record: StorageObject,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    return this.provider(record).download(record, signal);
  }

  async remove(record: StorageObject): Promise<void> {
    await this.provider(record).remove(record);
    await new PrivateFilesystem(record.stagingRoot).remove(
      'incoming',
      record.id,
    );
  }

  private provider(
    record: StorageObject,
  ): LocalStorageService | S3StorageService {
    if (record.profile.driver === 'local') return this.local;
    const key = JSON.stringify(record.profile);
    let client = this.clients.get(key);
    if (!client) {
      client = new S3StorageService(record.profile);
      this.clients.set(key, client);
    }
    return client;
  }

  onModuleDestroy(): void {
    this.close();
  }

  close(): void {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }
}
