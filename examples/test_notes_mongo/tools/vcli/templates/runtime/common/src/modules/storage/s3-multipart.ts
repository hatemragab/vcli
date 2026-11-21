import { storageProfileName } from './storage-capabilities.js';
import {
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  ListMultipartUploadsCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  stagingKey,
  type MultipartPart,
  type StorageObject,
} from './storage.entity.js';
export function multipartCreate(record: StorageObject) {
  if (record.profile.driver !== 's3')
    throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
  return new CreateMultipartUploadCommand({
    Bucket: record.profile.bucket,
    Key: stagingKey(record),
    ContentType: 'application/octet-stream',
    ContentDisposition: 'attachment',
    CacheControl: 'private, no-store',
    ...(storageProfileName(record.profile) === 'aws'
      ? { ChecksumAlgorithm: 'SHA256' as const }
      : {}),
  });
}
export function multipartList(record: StorageObject) {
  if (record.profile.driver !== 's3')
    throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
  return new ListMultipartUploadsCommand({
    Bucket: record.profile.bucket,
    Prefix: stagingKey(record),
    MaxUploads: 4,
  });
}
export function multipartPart(
  record: StorageObject,
  part: MultipartPart,
  body: Buffer,
) {
  if (record.profile.driver !== 's3' || !record.multipart?.uploadId)
    throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
  return new UploadPartCommand({
    Bucket: record.profile.bucket,
    Key: stagingKey(record),
    UploadId: record.multipart.uploadId,
    PartNumber: part.partNumber,
    ContentLength: part.bytes,
    Body: body,
    ContentMD5: createHash('md5').update(body).digest('base64'),
    ...(storageProfileName(record.profile) === 'aws'
      ? { ChecksumSHA256: Buffer.from(part.sha256, 'hex').toString('base64') }
      : {}),
  });
}
export function multipartComplete(record: StorageObject) {
  if (record.profile.driver !== 's3' || !record.multipart?.uploadId)
    throw new ApplicationError('MEDIA_COMPLETION_UNKNOWN', 503);
  const parts = [...record.multipart.parts].sort(
    (a, b) => a.partNumber - b.partNumber,
  );
  if (
    !parts.length ||
    parts.some(
      (part, index) =>
        part.partNumber !== index + 1 ||
        part.status !== 'complete' ||
        !part.etag,
    ) ||
    parts.reduce((sum, part) => sum + part.bytes, 0) !== record.bytes
  )
    throw new ApplicationError('INVALID_MULTIPART_MANIFEST', 422);
  return new CompleteMultipartUploadCommand({
    Bucket: record.profile.bucket,
    Key: stagingKey(record),
    UploadId: record.multipart.uploadId,
    IfNoneMatch: '*',
    MultipartUpload: {
      Parts: parts.map((part) => ({
        PartNumber: part.partNumber,
        ETag: part.etag,
        ...(record.profile.driver === 's3' &&
        storageProfileName(record.profile) === 'aws'
          ? { ChecksumSHA256: part.checksum }
          : {}),
      })),
    },
  });
}
