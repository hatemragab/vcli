import { applicationDefault, cert, type Credential } from 'firebase-admin/app';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import { readPushCredential } from './push-credential-file.js';
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
  try {
    const value = account.parse(
      JSON.parse(await readPushCredential(credentialsPath, 65536)) as unknown,
    );
    if (value.project_id !== projectId) throw new Error('PROJECT_MISMATCH');
    return cert({
      projectId: value.project_id,
      clientEmail: value.client_email,
      privateKey: value.private_key,
    });
  } catch {
    throw new ApplicationError('INVALID_FCM_CREDENTIALS', 500);
  }
}
