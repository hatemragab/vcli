import type { Auth } from 'firebase-admin/auth';
import type { MailMessage } from '../../core/mail/mail-submitter.js';
import { renderActionTemplate, validMailAddress } from './render-message.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import {
  classifyFirebaseActionError,
  firebaseActionSettings,
  validateFirebaseActionPolicy,
  type EmailActionPurpose,
  type FirebaseActionPolicy,
} from './firebase-action-policy.js';
export type FirebaseActionPreparation =
  | Readonly<{ status: 'prepared'; message: MailMessage }>
  | Readonly<{ status: 'suppressed' | 'unavailable' | 'configuration' }>;
/** Selected ONLY for Firebase application delivery. Never grants HTTP/actor authorization. */
export class FirebaseActionLinksService {
  private readonly policy: FirebaseActionPolicy;
  constructor(
    private readonly auth: Pick<
      Auth,
      'generateEmailVerificationLink' | 'generatePasswordResetLink'
    >,
    policy: FirebaseActionPolicy,
    private readonly applicationName: string,
  ) {
    validateFirebaseActionPolicy(policy);
    this.policy = structuredClone(policy);
    if (
      !applicationName.trim() ||
      applicationName.length > 80 ||
      /[\r\n\0]/.test(applicationName)
    )
      throw new ApplicationError('INVALID_MAIL_TEMPLATE', 500);
  }
  async prepare(
    input: Readonly<{
      operationId: string;
      to: string;
      purpose: EmailActionPurpose;
      continueUrl: string;
    }>,
  ): Promise<FirebaseActionPreparation> {
    const settings = firebaseActionSettings(
      this.policy,
      input.purpose,
      input.continueUrl,
    );
    if (
      !validMailAddress(input.to) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId)
    )
      throw new ApplicationError('INVALID_MAIL_MESSAGE', 400);
    let link: string;
    try {
      link =
        input.purpose === 'verification'
          ? await this.auth.generateEmailVerificationLink(input.to, settings)
          : await this.auth.generatePasswordResetLink(input.to, settings);
    } catch (error: unknown) {
      return { status: classifyFirebaseActionError(error) };
    }
    // Admin returns the action link. Do not reconstruct codes, accept user-supplied links,
    // or treat a custom Hosting mobile wrapper as a local password endpoint.
    let url: URL;
    try {
      url = new URL(link);
    } catch {
      return { status: 'configuration' };
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      link.length > 8192
    )
      return { status: 'configuration' };
    const mode = url.searchParams.get('mode');
    if (
      mode &&
      mode !==
        (input.purpose === 'verification' ? 'verifyEmail' : 'resetPassword')
    )
      return { status: 'configuration' };
    return {
      status: 'prepared',
      message: renderActionTemplate(
        {
          operationId: input.operationId,
          to: input.to,
          template: input.purpose,
          version: 1,
          locale: 'en',
          variables: { actionUrl: link, applicationName: this.applicationName },
        },
        url.origin,
      ),
    };
  }
}
