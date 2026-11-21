import { applicationDefault, cert, type Credential } from 'firebase-admin/app';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
const account = z.object({
  type: z.literal('service_account'),
  project_id: z.string().min(1),
  client_email: z.email(),
  private_key: z.string().min(1),
});
/** Separate messaging purpose. Never reads Firebase identity config or its credential file. */
export async function fcmCredential(
  projectId: string,
  credentialsPath?: string,
): Promise<Credential> {
  if (!credentialsPath) return applicationDefault();
  const file = await open(
    credentialsPath,
    constants.O_RDONLY | constants.O_NOFOLLOW,
  ).catch(() => {
    throw new ApplicationError('INVALID_FCM_CREDENTIALS', 500);
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 65536 || (stat.mode & 0o077) !== 0)
      throw new Error('PRIVATE_CREDENTIAL_REQUIRED');
    const bytes = Buffer.alloc(65537);
    const read = await file.read(bytes, 0, bytes.length, 0);
    if (read.bytesRead > 65536) throw new Error('CREDENTIAL_TOO_LARGE');
    const value = account.parse(
      JSON.parse(bytes.subarray(0, read.bytesRead).toString('utf8')) as unknown,
    );
    if (value.project_id !== projectId) throw new Error('PROJECT_MISMATCH');
    return cert({
      projectId: value.project_id,
      clientEmail: value.client_email,
      privateKey: value.private_key,
    });
  } catch {
    throw new ApplicationError('INVALID_FCM_CREDENTIALS', 500);
  } finally {
    await file.close();
  }
}
