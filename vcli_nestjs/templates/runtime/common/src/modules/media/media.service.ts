import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import type { PrincipalAuthority } from '../../core/auth/principal-authority.js';
import {
  MEDIA_LIMITS,
  type MediaRecord,
  type MediaStatus,
} from './media.entity.js';
import { requireUploadMode } from '../storage/storage-capabilities.js';
import {
  ownerStorageRoot,
  STORAGE_LIMITS,
  type MultipartPart,
  type StorageProfile,
  type UploadMode,
} from '../storage/storage.entity.js';
import type { MediaRepository } from './media.repository.js';
import type { StorageService } from '../storage/storage.service.js';
export type PartManifest = readonly Readonly<{
  partNumber: number;
  sha256: string;
  etag: string;
}>[];
@Injectable()
export class MediaService {
  constructor(
    private readonly ledger: Pick<
      MediaRepository,
      'reserve' | 'list' | 'get' | 'change' | 'forget'
    >,
    private readonly objects: Pick<
      StorageService,
      | 'receive'
      | 'finalize'
      | 'download'
      | 'remove'
      | 'directGrant'
      | 'initiateMultipart'
      | 'uploadPart'
      | 'discardStaging'
    >,
    private readonly authority: PrincipalAuthority,
  ) {}
  private async current(actor: Principal): Promise<void> {
    const current = await this.authority.current(actor.sessionId);
    if (
      current.accountId !== actor.accountId ||
      current.sessionId !== actor.sessionId ||
      current.installationId !== actor.installationId ||
      current.installationGeneration !== actor.installationGeneration ||
      current.expiresAt <= Date.now()
    )
      throw new ApplicationError('UNAUTHORIZED', 401);
  }
  async begin(
    actor: Principal,
    facts: Readonly<{
      id: string;
      filename: string;
      bytes: number;
      sha256: string;
      now: number;
      expiresAt: number;
      profile: StorageProfile;
      stagingRoot: string;
      mode?: UploadMode;
    }>,
  ): Promise<MediaRecord> {
    await this.current(actor);
    const mode = facts.mode ?? 'mediated';
    requireUploadMode(facts.profile, mode);
    if (
      !Number.isSafeInteger(facts.bytes) ||
      facts.bytes < 1 ||
      facts.bytes > STORAGE_LIMITS.maximumBytes ||
      !/^[0-9a-f]{64}$/.test(facts.sha256) ||
      facts.expiresAt <= facts.now ||
      facts.expiresAt - facts.now > STORAGE_LIMITS.grantSeconds * 1000
    )
      throw new ApplicationError('INVALID_UPLOAD_POLICY', 422);
    let { profile, stagingRoot } = facts;
    if ('root' in profile && typeof profile.root === 'string') {
      const scoped = {
        ...profile,
        root: ownerStorageRoot(profile.root, actor.accountId),
      };
      profile = scoped;
      stagingRoot = ownerStorageRoot(stagingRoot, actor.accountId);
    }
    const record = await this.ledger.reserve({
      id: facts.id,
      ownerId: actor.accountId,
      filename: facts.filename,
      bytes: facts.bytes,
      sha256: facts.sha256,
      createdAt: facts.now,
      expiresAt: facts.expiresAt,
      state: 'reserved',
      profile,
      stagingRoot,
      mode,
      attemptId: randomUUID(),
      generation: 1,
      ...(mode === 'multipart'
        ? {
            multipart: {
              initiated: false,
              partBytes: STORAGE_LIMITS.partBytes,
              parts: [],
            },
          }
        : {}),
    });
    if (mode === 'multipart') return this.initiate(actor, record.id, facts.now);
    return record;
  }
  private claim(
    actor: Principal,
    id: string,
    now: number,
    kind: string,
    expected: readonly MediaStatus[],
    next?: MediaStatus,
    fence?: MediaRecord,
  ): Promise<MediaRecord> {
    const token = randomUUID();
    return this.ledger.change(actor.accountId, id, (record) => {
      if (
        fence &&
        (record.attemptId !== fence.attemptId ||
          record.generation !== fence.generation)
      )
        throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
      if (!expected.includes(record.state))
        throw new ApplicationError('MEDIA_STATE_CONFLICT', 409);
      if (record.claim && record.claim.until > now)
        throw new ApplicationError('MEDIA_IN_FLIGHT', 409);
      return {
        ...record,
        state: next ?? record.state,
        claim: { token, kind, until: now + MEDIA_LIMITS.operationMs },
      };
    });
  }
  private finish(
    record: MediaRecord,
    update: (current: MediaRecord) => MediaRecord,
  ): Promise<MediaRecord> {
    return this.ledger.change(record.ownerId, record.id, (current) => {
      if (
        current.attemptId !== record.attemptId ||
        current.generation !== record.generation ||
        current.claim?.token !== record.claim?.token ||
        !record.claim
      )
        throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
      return { ...update(current), claim: undefined };
    });
  }
  private async release(record: MediaRecord): Promise<void> {
    await this.finish(record, (current) => current).catch(() => undefined);
  }
  async directGrant(actor: Principal, id: string, now: number) {
    await this.current(actor);
    const record = await this.claim(actor, id, now, 'grant', ['reserved']);
    try {
      if (record.mode !== 'presigned')
        throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
      if (record.expiresAt <= now)
        throw new ApplicationError('UPLOAD_EXPIRED', 410);
      const grant = await this.objects.directGrant(record);
      await this.current(actor);
      return grant;
    } finally {
      await this.release(record);
    }
  }
  async initiate(
    actor: Principal,
    id: string,
    now: number,
  ): Promise<MediaRecord> {
    await this.current(actor);
    const existing = await this.ledger.get(actor.accountId, id);
    if (existing.state === 'multipart' && existing.multipart?.uploadId)
      return existing;
    const record = await this.claim(
      actor,
      id,
      now,
      'initiate',
      ['reserved', 'initiating'],
      'initiating',
      existing,
    );
    try {
      if (record.mode !== 'multipart' || !record.multipart)
        throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
      if (record.expiresAt <= now)
        throw new ApplicationError('UPLOAD_EXPIRED', 410);
      // Persist intent BEFORE provider creation; unknown creation is listed, never blindly repeated.
      const intended = await this.ledger.change(
        actor.accountId,
        id,
        (current) => {
          if (
            current.claim?.token !== record.claim?.token ||
            !current.multipart
          )
            throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
          return {
            ...current,
            multipart: { ...current.multipart, initiated: true },
          };
        },
      );
      const uploadId = await this.objects.initiateMultipart(
        intended,
        record.multipart.initiated,
      );
      await this.current(actor);
      return await this.finish(record, (current) => ({
        ...current,
        state: 'multipart',
        multipart: { ...current.multipart!, uploadId },
      }));
    } catch (error: unknown) {
      await this.release(record);
      throw error;
    }
  }
  async declarePart(
    actor: Principal,
    id: string,
    input: Readonly<{ partNumber: number; bytes: number; sha256: string }>,
    now: number,
  ) {
    await this.current(actor);
    const record = await this.ledger.change(actor.accountId, id, (record) => {
      if (record.state !== 'multipart' || !record.multipart?.uploadId)
        throw new ApplicationError('MEDIA_STATE_CONFLICT', 409);
      if (record.claim && record.claim.until > now)
        throw new ApplicationError('MEDIA_IN_FLIGHT', 409);
      if (record.expiresAt <= now)
        throw new ApplicationError('UPLOAD_EXPIRED', 410);
      const count = Math.ceil(record.bytes / record.multipart.partBytes);
      const size = Math.min(
        record.multipart.partBytes,
        record.bytes - (input.partNumber - 1) * record.multipart.partBytes,
      );
      if (
        !Number.isInteger(input.partNumber) ||
        input.partNumber < 1 ||
        input.partNumber > count ||
        count > STORAGE_LIMITS.maxParts ||
        input.bytes !== size ||
        !/^[0-9a-f]{64}$/.test(input.sha256)
      )
        throw new ApplicationError('INVALID_UPLOAD_PART', 422);
      const existing = record.multipart.parts.find(
        (part) => part.partNumber === input.partNumber,
      );
      if (
        existing &&
        (existing.sha256 !== input.sha256 || existing.bytes !== input.bytes)
      )
        throw new ApplicationError('UPLOAD_PART_CONFLICT', 409);
      return existing
        ? record
        : {
            ...record,
            multipart: {
              ...record.multipart,
              parts: [
                ...record.multipart.parts,
                { ...input, status: 'declared' },
              ],
            },
          };
    });
    return {
      kind: 'mediated-part',
      method: 'PUT',
      path: `/api/media/uploads/${id}/parts/${input.partNumber}/content`,
      contentType: 'application/octet-stream',
      bytes: input.bytes,
      sha256: input.sha256,
      expiresAt: record.expiresAt,
      authorization: 'current-session',
    };
  }
  async receivePart(
    actor: Principal,
    id: string,
    partNumber: number,
    source: AsyncIterable<Uint8Array>,
    now: number,
    signal: AbortSignal,
  ): Promise<MultipartPart> {
    await this.current(actor);
    const record = await this.claim(actor, id, now, 'part', ['multipart']);
    try {
      if (record.expiresAt <= now)
        throw new ApplicationError('UPLOAD_EXPIRED', 410);
      const part = record.multipart?.parts.find(
        (part) => part.partNumber === partNumber,
      );
      if (!part) throw new ApplicationError('UPLOAD_PART_NOT_DECLARED', 409);
      await this.ledger.change(actor.accountId, id, (current) => {
        if (current.claim?.token !== record.claim?.token || !current.multipart)
          throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
        return {
          ...current,
          multipart: {
            ...current.multipart,
            parts: current.multipart.parts.map((value) =>
              value.partNumber === partNumber && value.status !== 'complete'
                ? { ...value, status: 'pending' }
                : value,
            ),
          },
        };
      });
      const evidence = await this.objects.uploadPart(
        record,
        part,
        source,
        signal,
      );
      await this.current(actor);
      await this.finish(record, (current) => ({
        ...current,
        multipart: {
          ...current.multipart!,
          parts: current.multipart!.parts.map((value) =>
            value.partNumber === partNumber ? evidence : value,
          ),
        },
      }));
      return evidence;
    } catch (error: unknown) {
      await this.release(record);
      throw error;
    }
  }
  async receive(
    actor: Principal,
    id: string,
    source: AsyncIterable<Uint8Array>,
    now: number,
    signal: AbortSignal,
  ): Promise<MediaRecord> {
    await this.current(actor);
    const record = await this.claim(
      actor,
      id,
      now,
      'receive',
      ['reserved'],
      'receiving',
    );
    try {
      if ((record.mode ?? 'mediated') !== 'mediated')
        throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
      if (record.expiresAt <= now)
        throw new ApplicationError('UPLOAD_EXPIRED', 410);
      const evidence = await this.objects.receive(record, source, signal);
      await this.current(actor);
      return await this.finish(record, (current) => ({
        ...current,
        state: 'uploaded',
        evidence,
      }));
    } catch (error: unknown) {
      await this.finish(record, (current) => ({
        ...current,
        state: 'failed',
      })).catch(() => undefined);
      throw error;
    }
  }
  async finalize(
    actor: Principal,
    id: string,
    now: number,
    manifest?: PartManifest,
  ): Promise<MediaRecord> {
    await this.current(actor);
    const existing = await this.ledger.get(actor.accountId, id);
    if (existing.state === 'ready') return this.cleanupReady(existing, now);
    if (existing.mode === 'multipart')
      this.validateManifest(existing, manifest);
    if (existing.state === 'reserved' && existing.mode !== 'presigned')
      throw new ApplicationError('MEDIA_STATE_CONFLICT', 409);
    const record = await this.claim(
      actor,
      id,
      now,
      'finalize',
      ['uploaded', 'reserved', 'multipart', 'finalizing'],
      'finalizing',
      existing,
    );
    try {
      const objectEvidence = await this.objects.finalize(record, true);
      if (
        objectEvidence.bytes !== record.bytes ||
        objectEvidence.sha256 !== record.sha256
      )
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      await this.current(actor);
      const ready = await this.finish(record, (current) => ({
        ...current,
        state: 'ready',
        objectEvidence,
        stagingPending: true,
        stagingCleanupAt:
          current.mode === 'presigned'
            ? current.expiresAt + MEDIA_LIMITS.transferMs
            : now,
      }));
      return await this.cleanupReady(ready, now);
    } catch (error: unknown) {
      await this.finish(record, (current) => ({
        ...current,
        ...(error instanceof ApplicationError &&
        error.code === 'UPLOAD_INTEGRITY_FAILED'
          ? { state: 'failed' as const }
          : {}),
      })).catch(() => undefined);
      const latest = await this.ledger.get(actor.accountId, id);
      if (latest.state === 'ready') return latest;
      throw error;
    }
  }
  private async cleanupReady(
    record: MediaRecord,
    now: number,
  ): Promise<MediaRecord> {
    if (!record.stagingPending || (record.stagingCleanupAt ?? 0) > now)
      return record;
    try {
      await this.objects.discardStaging(record);
      return await this.ledger.change(record.ownerId, record.id, (current) => {
        if (
          current.attemptId !== record.attemptId ||
          current.generation !== record.generation
        )
          throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
        return current.state === 'ready'
          ? { ...current, stagingPending: false }
          : current;
      });
    } catch {
      return record;
    } // Ready is committed; partial cleanup remains explicit and retryable.
  }
  private validateManifest(record: MediaRecord, manifest?: PartManifest): void {
    const parts = record.multipart?.parts ?? [];
    const count = Math.ceil(
      record.bytes / (record.multipart?.partBytes ?? STORAGE_LIMITS.partBytes),
    );
    if (
      !manifest ||
      manifest.length !== count ||
      parts.length !== count ||
      new Set(manifest.map((part) => part.partNumber)).size !== count ||
      manifest.some((part, index) => {
        const stored = parts.find(
          (value) => value.partNumber === part.partNumber,
        );
        return (
          part.partNumber !== index + 1 ||
          !stored ||
          stored.status !== 'complete' ||
          stored.sha256 !== part.sha256 ||
          stored.etag !== part.etag
        );
      })
    )
      throw new ApplicationError('INVALID_MULTIPART_MANIFEST', 422);
  }
  async reconcile(
    actor: Principal,
    id: string,
    now: number,
    fence?: MediaRecord,
  ): Promise<MediaRecord> {
    await this.current(actor);
    const record = await this.ledger.get(actor.accountId, id);
    if (
      fence &&
      (record.attemptId !== fence.attemptId ||
        record.generation !== fence.generation)
    )
      throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
    if (record.state === 'initiating') return this.initiate(actor, id, now);
    if (record.state === 'finalizing')
      return this.finalize(
        actor,
        id,
        now,
        record.multipart?.parts
          .map((part) => ({
            partNumber: part.partNumber,
            sha256: part.sha256,
            etag: part.etag ?? '',
          }))
          .sort((a, b) => a.partNumber - b.partNumber),
      );
    if (record.state === 'deleting') {
      await this.remove(actor, id, now);
      return { ...record, state: 'deleting' };
    }
    return record;
  }
  async ready(actor: Principal, id: string): Promise<MediaRecord> {
    await this.current(actor);
    const record = await this.ledger.get(actor.accountId, id);
    if (record.state !== 'ready')
      throw new ApplicationError('MEDIA_NOT_FOUND', 404);
    return record;
  }
  async list(actor: Principal): Promise<readonly MediaRecord[]> {
    await this.current(actor);
    return this.ledger.list(actor.accountId);
  }
  async download(
    actor: Principal,
    id: string,
    signal: AbortSignal,
  ): Promise<{ record: MediaRecord; source: AsyncIterable<Uint8Array> }> {
    const record = await this.ready(actor, id);
    const cancelled = new AbortController();
    const source = await this.objects.download(
      record,
      AbortSignal.any([signal, cancelled.signal]),
    );
    try {
      await this.current(actor);
      return { record, source };
    } catch (error: unknown) {
      cancelled.abort();
      throw error;
    }
  }
  async remove(
    actor: Principal,
    id: string,
    now: number,
    fence?: MediaRecord,
  ): Promise<void> {
    await this.current(actor);
    let existing: MediaRecord;
    try {
      existing = await this.ledger.get(actor.accountId, id);
    } catch (error: unknown) {
      if (error instanceof ApplicationError && error.code === 'MEDIA_NOT_FOUND')
        return;
      throw error;
    }
    if (
      fence &&
      (existing.attemptId !== fence.attemptId ||
        existing.generation !== fence.generation)
    )
      throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
    const record = await this.claim(
      actor,
      id,
      now,
      'delete',
      [existing.state],
      'deleting',
      existing,
    );
    try {
      const fenced = await this.ledger.change(
        actor.accountId,
        id,
        (current) => {
          if (current.claim?.token !== record.claim?.token)
            throw new ApplicationError('MEDIA_GENERATION_CONFLICT', 409);
          return {
            ...current,
            deleteAfter:
              current.deleteAfter ??
              Math.max(
                now,
                current.mode === 'presigned'
                  ? current.expiresAt + MEDIA_LIMITS.transferMs
                  : now,
              ) + MEDIA_LIMITS.operationMs,
          };
        },
      );
      await this.objects.remove(fenced);
      if (now >= (fenced.deleteAfter ?? Infinity))
        await this.ledger.forget(fenced);
      else await this.finish(record, (current) => current);
    } catch (error: unknown) {
      await this.release(record);
      throw error;
    }
  }
  async cleanup(
    actor: Principal,
    now: number,
  ): Promise<{ removed: number; pending: number; examined: number }> {
    await this.current(actor);
    const entries = await this.ledger.list(actor.accountId);
    const eligible = entries.filter(
      (record) =>
        (record.state === 'ready' &&
          record.stagingPending === true &&
          (record.stagingCleanupAt ?? 0) <= now) ||
        (record.state !== 'ready' &&
          (record.state === 'deleting' ||
            record.expiresAt + MEDIA_LIMITS.transferMs <= now)),
    );
    let removed = 0;
    let pending = Math.max(0, eligible.length - MEDIA_LIMITS.cleanupBatch);
    let examined = 0;
    for (const record of eligible.slice(0, MEDIA_LIMITS.cleanupBatch)) {
      examined += 1;
      try {
        if (record.state === 'ready') {
          if ((await this.cleanupReady(record, now)).stagingPending)
            pending += 1;
        } else if (record.state === 'finalizing')
          await this.reconcile(actor, record.id, now, record);
        else {
          await this.remove(actor, record.id, now, record);
          if (
            (await this.ledger.list(actor.accountId)).some(
              (entry) => entry.id === record.id,
            )
          )
            pending += 1;
          else removed += 1;
        }
      } catch {
        pending += 1;
      }
    }
    return { removed, pending, examined };
  }
}
