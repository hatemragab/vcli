import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { StorageObject, StorageProfile } from './storage.entity.js';
import { PrivateFilesystem } from './private-filesystem.js';

type S3Profile = Extract<StorageProfile, { driver: 's3' }>;

export function s3PutInput(record: StorageObject) {
  if (record.profile.driver !== 's3' || !record.evidence)
    throw new ApplicationError('MISSING_UPLOAD_EVIDENCE', 409);
  return {
    Bucket: record.profile.bucket,
    Key: `reference-media/${record.id}`,
    IfNoneMatch: '*',
    ContentLength: record.bytes,
    ContentType: 'application/octet-stream',
    ContentDisposition: 'attachment',
    CacheControl: 'private, no-store',
    ContentMD5: record.evidence.md5,
    ...(record.profile.profile === 'aws'
      ? { ChecksumSHA256: Buffer.from(record.sha256, 'hex').toString('base64') }
      : {}),
  };
}

function notFound(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    (('name' in error &&
      ['NoSuchKey', 'NotFound'].includes(String(error.name))) ||
      ('$metadata' in error &&
        (error.$metadata as { httpStatusCode?: number })?.httpStatusCode ===
          404)),
  );
}

export class S3StorageService {
  private readonly client: S3Client;
  constructor(private readonly profile: S3Profile) {
    this.client = new S3Client({
      region: profile.region,
      endpoint: profile.endpoint,
      forcePathStyle: profile.forcePathStyle,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      maxAttempts: 1,
      requestHandler: {
        connectionTimeout: 5000,
        requestTimeout: 20000,
        throwOnRequestTimeout: true,
      },
    });
  }

  async finalize(record: StorageObject, mayCreate: boolean): Promise<void> {
    if (await this.verify(record)) return;
    if (!mayCreate) throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
    const file = await new PrivateFilesystem(record.stagingRoot).read(
      'incoming',
      record.id,
    );
    const body = file.createReadStream();
    try {
      await this.client.send(
        new PutObjectCommand({ ...s3PutInput(record), Body: body }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
    } catch {
      // Conditional rejection, lost ACK and timeouts all require exact byte reconciliation.
      if (!(await this.verify(record)))
        throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
      return;
    } finally {
      body.destroy();
      await file.close();
    }
    if (!(await this.verify(record)))
      throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
  }

  private async verify(record: StorageObject): Promise<boolean> {
    let source: Readable | undefined;
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.profile.bucket,
          Key: `reference-media/${record.id}`,
        }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
      if (!(response.Body instanceof Readable))
        throw new ApplicationError('STORAGE_UNAVAILABLE', 503);
      source = response.Body;
      const sha = createHash('sha256');
      let bytes = 0;
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > record.bytes)
          throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
        sha.update(chunk);
      }
      if (bytes !== record.bytes || sha.digest('hex') !== record.sha256)
        throw new ApplicationError('UPLOAD_INTEGRITY_FAILED', 422);
      return true;
    } catch (error: unknown) {
      if (notFound(error)) return false;
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
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.profile.bucket,
          Key: `reference-media/${record.id}`,
        }),
        { abortSignal: signal },
      );
      if (!(result.Body instanceof Readable))
        throw new ApplicationError('STORAGE_UNAVAILABLE', 503);
      const body = result.Body;
      const abort = () =>
        body.destroy(new ApplicationError('DOWNLOAD_CANCELLED', 408));
      signal.addEventListener('abort', abort, { once: true });
      body.once('close', () => signal.removeEventListener('abort', abort));
      return body;
    } catch {
      throw new ApplicationError('STORAGE_UNAVAILABLE', 503);
    }
  }

  async remove(record: StorageObject): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.profile.bucket,
          Key: `reference-media/${record.id}`,
        }),
        { abortSignal: AbortSignal.timeout(20000) },
      );
    } catch {
      throw new ApplicationError('STORAGE_DELETE_UNKNOWN', 503);
    }
  }

  close(): void {
    this.client.destroy();
  }
}
