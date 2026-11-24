import { Injectable } from '@nestjs/common';
import { ApplicationError } from '../../core/errors/application-error.js';
import { MEDIA_LIMITS, type MediaRecord } from './media.entity.js';
import type { StorageProfile } from '../storage/storage.entity.js';
import type { MediaRepository } from './media.repository.js';
import type { StorageService } from '../storage/storage.service.js';
@Injectable()
export class MediaService {
  constructor(
    private readonly ledger: Pick<
      MediaRepository,
      'reserve' | 'list' | 'get' | 'transition' | 'forget'
    >,
    private readonly objects: Pick<
      StorageService,
      'receive' | 'finalize' | 'download' | 'remove'
    >,
  ) {}
  async begin(
    facts: Readonly<{
      ownerId: string;
      id: string;
      filename: string;
      bytes: number;
      sha256: string;
      now: number;
      expiresAt: number;
      profile: StorageProfile;
      stagingRoot: string;
    }>,
  ): Promise<MediaRecord> {
    return this.ledger.reserve({
      id: facts.id,
      ownerId: facts.ownerId,
      filename: facts.filename,
      bytes: facts.bytes,
      sha256: facts.sha256,
      createdAt: facts.now,
      expiresAt: facts.expiresAt,
      state: 'reserved',
      profile: facts.profile,
      stagingRoot: facts.stagingRoot,
    });
  }
  async receive(
    ownerId: string,
    id: string,
    source: AsyncIterable<Uint8Array>,
    now: number,
    signal: AbortSignal,
  ): Promise<MediaRecord> {
    const record = await this.ledger.transition(
      ownerId,
      id,
      ['reserved'],
      'receiving',
      now,
    );
    try {
      const evidence = await this.objects.receive(record, source, signal);
      return await this.ledger.transition(
        ownerId,
        id,
        ['receiving'],
        'uploaded',
        now,
        evidence,
      );
    } catch (error: unknown) {
      await this.ledger
        .transition(ownerId, id, ['receiving'], 'failed', now)
        .catch(() => undefined);
      throw error;
    }
  }
  async finalize(
    ownerId: string,
    id: string,
    now: number,
  ): Promise<MediaRecord> {
    let record = await this.ledger.get(ownerId, id);
    if (record.state === 'ready') return record;
    const mayCreate = record.state === 'uploaded';
    if (mayCreate)
      record = await this.ledger.transition(
        ownerId,
        id,
        ['uploaded'],
        'finalizing',
        now,
      );
    if (record.state !== 'finalizing')
      throw new ApplicationError('MEDIA_STATE_CONFLICT', 409);
    // Repeated finalization reconciles the exact immutable object; provider I/O is outside database callbacks.
    await this.objects.finalize(record, mayCreate);
    try {
      return await this.ledger.transition(
        ownerId,
        id,
        ['finalizing'],
        'ready',
        now,
      );
    } catch (error: unknown) {
      const latest = await this.ledger.get(ownerId, id);
      if (latest.state === 'ready') return latest;
      throw error;
    }
  }
  async ready(ownerId: string, id: string): Promise<MediaRecord> {
    const record = await this.ledger.get(ownerId, id);
    if (record.state !== 'ready')
      throw new ApplicationError('MEDIA_NOT_FOUND', 404);
    return record;
  }
  list(ownerId: string): Promise<readonly MediaRecord[]> {
    return this.ledger.list(ownerId);
  }
  download(
    record: MediaRecord,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    return this.objects.download(record, signal);
  }
  async remove(ownerId: string, id: string, now: number): Promise<void> {
    let record = await this.ledger.get(ownerId, id);
    if (
      record.state === 'finalizing' ||
      (record.state === 'receiving' &&
        record.expiresAt + MEDIA_LIMITS.transferMs > now)
    )
      throw new ApplicationError('MEDIA_IN_FLIGHT', 409);
    if (record.state !== 'deleting')
      record = await this.ledger.transition(
        ownerId,
        id,
        [record.state],
        'deleting',
        now,
      );
    await this.objects.remove(record);
    try {
      await this.ledger.forget(ownerId, id);
    } catch (error: unknown) {
      if (!(
        error instanceof ApplicationError && error.code === 'MEDIA_NOT_FOUND'
      ))
        throw error;
    }
  }
  async cleanup(
    ownerId: string,
    now: number,
  ): Promise<{
    removed: number;
    pending: number;
  }> {
    const records = await this.ledger.list(ownerId);
    let removed = 0;
    let pending = 0;
    for (const record of records) {
      if (
        record.state === 'ready' ||
        record.expiresAt + MEDIA_LIMITS.transferMs > now
      )
        continue;
      if (record.state === 'finalizing') {
        pending += 1;
        continue;
      }
      try {
        await this.remove(ownerId, record.id, now);
        removed += 1;
      } catch {
        pending += 1;
      }
    }
    return { removed, pending };
  }
}
