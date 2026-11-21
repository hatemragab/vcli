import { storageProfileName } from './storage-capabilities.js';
import {
  AbortMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  GetBucketVersioningCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ApplicationError } from '../../core/errors/application-error.js';
import { LocalStorageService } from './local-storage.service.js';
import { boundedStream } from './bounded-stream.js';
import { isMissing, PrivateFilesystem } from './private-filesystem.js';
import {
  multipartComplete,
  multipartCreate,
  multipartList,
  multipartPart,
} from './s3-multipart.js';
import {
  readyKey,
  stagingKey,
  storageId,
  STORAGE_LIMITS,
  type DirectGrant,
  type MultipartPart,
  type ObjectEvidence,
  type StorageObject,
  type StorageProfile,
} from './storage.entity.js';
type S3Profile = Extract<StorageProfile, { driver: 's3' }>;
export type S3StorageOptions = Readonly<{
  directPost?: (
    client: S3Client,
    record: StorageObject,
  ) => Promise<DirectGrant>;
  /** Test seam: controlled SDK translation is not provider acceptance. */
  client?: S3Client;
}>;
export function s3PutInput(record: StorageObject) {
  if (record.profile.driver !== 's3' || !record.evidence)
    throw new ApplicationError('MISSING_UPLOAD_EVIDENCE', 409);
  return {
    Bucket: record.profile.bucket,
    Key: readyKey(record),
    IfNoneMatch: '*',
    ContentLength: record.bytes,
    ContentType: 'application/octet-stream',
    ContentDisposition: 'attachment',
    CacheControl: 'private, no-store',
    ContentMD5: record.evidence.md5,
    ...(storageProfileName(record.profile) === 'aws'
      ? { ChecksumSHA256: Buffer.from(record.sha256, 'hex').toString('base64') }
      : {}),
  };
}
function notFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (('name' in error &&
      ['NoSuchKey', 'NotFound', 'NoSuchUpload'].includes(String(error.name))) ||
      ('$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode ===
          404)),
  );
}
export class S3StorageService {
  private readonly client: S3Client;
  constructor(
    private readonly profile: S3Profile,
    private readonly options: S3StorageOptions = {},
  ) {
    if (
      storageProfileName(profile) === 'r2' &&
      (!profile.endpoint ||
        !/^https:\/\/[a-zA-Z0-9.-]+\.r2\.cloudflarestorage\.com\/?$/.test(
          profile.endpoint,
        ) ||
        profile.region !== 'auto')
    )
      throw new ApplicationError('INVALID_STORAGE_PROFILE', 500);
    if (storageProfileName(profile) === 'aws' && profile.endpoint)
      throw new ApplicationError('INVALID_STORAGE_PROFILE', 500);
    this.client =
      options.client ??
      new S3Client({
        region: profile.region,
        endpoint: profile.endpoint,
        forcePathStyle: profile.forcePathStyle,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        maxAttempts: 1,
        requestHandler: {
          connectionTimeout: 5000,
          requestTimeout: STORAGE_LIMITS.providerMs,
          throwOnRequestTimeout: true,
        },
      });
  }
  private assertProfile(record: StorageObject): void {
    if (JSON.stringify(record.profile) !== JSON.stringify(this.profile))
      throw new ApplicationError('STORAGE_PROFILE_UNAVAILABLE', 503);
  }
  async directGrant(record: StorageObject): Promise<DirectGrant> {
    this.assertProfile(record);
    if (storageProfileName(this.profile) !== 'aws' || !this.options.directPost)
      throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
    try {
      const versioning = await this.client.send(
        new GetBucketVersioningCommand({ Bucket: this.profile.bucket }),
        { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
      );
      if (versioning.Status)
        throw new ApplicationError(
          'DIRECT_UPLOAD_REQUIRES_UNVERSIONED_BUCKET',
          422,
        );
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError('STORAGE_PROFILE_UNAVAILABLE', 503);
    }
    return this.options.directPost(this.client, record);
  }
  async initiateMultipart(
    record: StorageObject,
    reconcile = false,
  ): Promise<string> {
    this.assertProfile(record);
    try {
      if (reconcile) {
        const result = await this.client.send(multipartList(record), {
          abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs),
        });
        const exact =
          result.Uploads?.filter(
            (upload) => upload.Key === stagingKey(record),
          ) ?? [];
        if (result.IsTruncated || exact.length !== 1 || !exact[0]?.UploadId)
          throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
        return exact[0].UploadId;
      }
      const result = await this.client.send(multipartCreate(record), {
        abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs),
      });
      if (!result.UploadId)
        throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
      return result.UploadId;
    } catch {
      throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    }
  }
  async uploadPart(
    record: StorageObject,
    part: MultipartPart,
    bytes: Buffer,
    signal: AbortSignal,
  ): Promise<MultipartPart> {
    this.assertProfile(record);
    try {
      const result = await this.client.send(
        multipartPart(record, part, bytes),
        {
          abortSignal: AbortSignal.any([
            signal,
            AbortSignal.timeout(STORAGE_LIMITS.providerMs),
          ]),
        },
      );
      const checksum = Buffer.from(part.sha256, 'hex').toString('base64');
      if (
        !result.ETag ||
        (storageProfileName(this.profile) === 'aws' &&
          result.ChecksumSHA256 !== checksum)
      )
        throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
      return {
        ...part,
        status: 'complete',
        etag: result.ETag,
        ...(storageProfileName(this.profile) === 'aws' ? { checksum } : {}),
      };
    } catch {
      throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    }
  }
  private async stage(record: StorageObject): Promise<StorageObject> {
    const filesystem = new PrivateFilesystem(record.stagingRoot);
    try {
      const evidence = await filesystem.evidence(
        'incoming',
        storageId(record),
        record.bytes,
      );
      if (evidence.bytes !== record.bytes || evidence.sha256 !== record.sha256)
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      return { ...record, evidence };
    } catch (error: unknown) {
      if (!isMissing(error)) throw error;
    }
    if (record.mode === 'mediated' || !record.mode)
      throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    if (record.mode === 'multipart') {
      // Complete against one frozen manifest. A lost ACK is reconciled by exact readback below.
      try {
        await this.client.send(multipartComplete(record), {
          abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs),
        });
      } catch {
        /* The object, not this acknowledgement, is authoritative. */
      }
    }
    let body: Readable | undefined;
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.profile.bucket,
          Key: stagingKey(record),
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
      );
      if (!(result.Body instanceof Readable))
        throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
      body = result.Body;
      if (result.ContentLength !== record.bytes)
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      // A private immutable spool decouples ready bytes from replayable mutable grants.
      const evidence = await new LocalStorageService().receive(
        record,
        body,
        AbortSignal.timeout(STORAGE_LIMITS.providerMs),
      );
      return { ...record, evidence };
    } catch (error: unknown) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    } finally {
      body?.destroy();
    }
  }
  async finalize(
    record: StorageObject,
    mayCreate: boolean,
  ): Promise<ObjectEvidence> {
    this.assertProfile(record);
    const existing = await this.verify(record);
    if (existing) return existing;
    if (!mayCreate) throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    const staged = await this.stage(record);
    const file = await new PrivateFilesystem(record.stagingRoot).read(
      'incoming',
      storageId(record),
    );
    const body = file.createReadStream();
    try {
      await this.client.send(
        new PutObjectCommand({ ...s3PutInput(staged), Body: body }),
        { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
      );
    } catch {
      /* Conditional conflict, timeout and lost ACK all require readback. */
    } finally {
      body.destroy();
      await file.close();
    }
    const evidence = await this.verify(record);
    if (!evidence) throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    return evidence;
  }
  private async verify(
    record: StorageObject,
  ): Promise<ObjectEvidence | undefined> {
    let source: Readable | undefined;
    const signal = AbortSignal.timeout(STORAGE_LIMITS.providerMs);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.profile.bucket,
          Key: readyKey(record),
          ...(record.objectEvidence?.versionId
            ? { VersionId: record.objectEvidence.versionId }
            : {}),
        }),
        { abortSignal: signal },
      );
      if (!(response.Body instanceof Readable))
        throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
      source = response.Body;
      const sha = createHash('sha256');
      let bytes = 0;
      for await (const chunk of boundedStream(source, record.bytes, signal)) {
        bytes += chunk.byteLength;
        sha.update(chunk);
      }
      if (
        bytes !== record.bytes ||
        sha.digest('hex') !== record.sha256 ||
        !response.ETag
      )
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      return {
        bytes,
        sha256: record.sha256,
        etag: response.ETag,
        ...(response.VersionId ? { versionId: response.VersionId } : {}),
      };
    } catch (error: unknown) {
      if (notFound(error)) return undefined;
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    } finally {
      source?.destroy();
    }
  }
  async download(
    record: StorageObject,
    signal: AbortSignal,
  ): Promise<AsyncIterable<Uint8Array>> {
    this.assertProfile(record);
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.profile.bucket,
          Key: readyKey(record),
          ...(record.objectEvidence?.versionId
            ? { VersionId: record.objectEvidence.versionId }
            : {}),
          ...(record.objectEvidence?.etag
            ? { IfMatch: record.objectEvidence.etag }
            : {}),
        }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable))
        throw new ApplicationError('STORAGE_UNAVAILABLE', 503);
      const body = result.Body;
      body.on('error', () => undefined); // Authority/cancellation may reject before consumption.
      const abort = () =>
        body.destroy(new ApplicationError('DOWNLOAD_CANCELLED', 408));
      signal.addEventListener('abort', abort, { once: true });
      body.once('close', () => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
      return body;
    } catch {
      throw new ApplicationError('STORAGE_UNAVAILABLE', 503);
    }
  }
  async abortMultipart(record: StorageObject): Promise<void> {
    this.assertProfile(record);
    if (!record.multipart?.initiated) return;
    try {
      const ids = record.multipart.uploadId
        ? [record.multipart.uploadId]
        : ((
            await this.client.send(multipartList(record), {
              abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs),
            })
          ).Uploads?.filter((upload) => upload.Key === stagingKey(record))
            .map((upload) => upload.UploadId)
            .filter((id): id is string => Boolean(id)) ?? []);
      for (const uploadId of ids) {
        try {
          await this.client.send(
            new AbortMultipartUploadCommand({
              Bucket: this.profile.bucket,
              Key: stagingKey(record),
              UploadId: uploadId,
            }),
            { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
          );
        } catch (error: unknown) {
          if (!notFound(error)) throw error;
        }
      }
      // An aborted/lost-initiation upload must not be assumed absent on a partial list.
      const remaining = await this.client.send(multipartList(record), {
        abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs),
      });
      if (
        remaining.IsTruncated ||
        remaining.Uploads?.some((upload) => upload.Key === stagingKey(record))
      )
        throw new ApplicationError('STORAGE_DELETE_UNKNOWN', 503);
    } catch {
      throw new ApplicationError('STORAGE_DELETE_UNKNOWN', 503);
    }
  }
  async remove(record: StorageObject): Promise<void> {
    this.assertProfile(record);
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.profile.bucket,
          Key: readyKey(record),
          ...(record.objectEvidence?.versionId
            ? { VersionId: record.objectEvidence.versionId }
            : {}),
        }),
        { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
      );
      if (record.mode && record.mode !== 'mediated')
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.profile.bucket,
            Key: stagingKey(record),
          }),
          { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
        );
    } catch {
      throw new ApplicationError('STORAGE_DELETE_UNKNOWN', 503);
    }
  }
  async discardStaging(record: StorageObject): Promise<void> {
    this.assertProfile(record);
    if (record.multipart) await this.abortMultipart(record);
    if (record.mode && record.mode !== 'mediated') {
      try {
        await this.client.send(
          new DeleteObjectCommand({
            Bucket: this.profile.bucket,
            Key: stagingKey(record),
          }),
          { abortSignal: AbortSignal.timeout(STORAGE_LIMITS.providerMs) },
        );
      } catch {
        throw new ApplicationError('STORAGE_DELETE_UNKNOWN', 503);
      }
    }
  }
  close(): void {
    this.client.destroy();
  }
}
