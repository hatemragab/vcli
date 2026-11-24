import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import type { S3Client } from '@aws-sdk/client-s3';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  stagingKey,
  STORAGE_LIMITS,
  type DirectGrant,
  type StorageObject,
} from './storage.entity.js';
export function awsPostInput(record: StorageObject) {
  if (
    record.profile.driver !== 's3' ||
    record.profile.profile !== 'aws' ||
    record.mode !== 'presigned'
  )
    throw new ApplicationError('UNSUPPORTED_UPLOAD_MODE', 422);
  const remaining = Math.floor(((record.expiresAt ?? 0) - Date.now()) / 1000);
  if (remaining < 1) throw new ApplicationError('UPLOAD_EXPIRED', 410);
  const Fields = {
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': 'attachment',
    'Cache-Control': 'private, no-store',
    'x-amz-checksum-algorithm': 'SHA256',
    'x-amz-checksum-sha256': Buffer.from(record.sha256, 'hex').toString(
      'base64',
    ),
    success_action_status: '204',
  };
  return {
    Bucket: record.profile.bucket,
    Key: stagingKey(record),
    Fields,
    Expires: Math.min(remaining, STORAGE_LIMITS.grantSeconds),
    Conditions: [
      ['content-length-range', record.bytes, record.bytes] as [
        'content-length-range',
        number,
        number,
      ],
      ...Object.entries(Fields).map(([key, value]) => ({ [key]: value })),
    ],
  };
}
export async function createAwsPostGrant(
  client: S3Client,
  record: StorageObject,
): Promise<DirectGrant> {
  const input = awsPostInput(record);
  const result = await createPresignedPost(client, input);
  const policy = JSON.parse(
    Buffer.from(result.fields.Policy ?? '', 'base64').toString('utf8'),
  ) as { expiration?: string };
  const expiresAt = Date.parse(policy.expiration ?? '');
  if (
    !Number.isFinite(expiresAt) ||
    expiresAt > (record.expiresAt ?? 0) ||
    expiresAt <= Date.now()
  )
    throw new ApplicationError('UPLOAD_EXPIRED', 410);
  return {
    kind: 's3-post',
    method: 'POST',
    ...result,
    bytes: record.bytes,
    expiresAt,
  };
}
