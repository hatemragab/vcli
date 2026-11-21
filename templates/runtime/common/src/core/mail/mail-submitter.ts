/** One recipient per submission: never retry an entire partially accepted batch. */
export type MailMessage = Readonly<{
  operationId: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  purpose: 'verification' | 'password-reset' | 'notification';
}>;
export type MailOutcome =
  | Readonly<{ status: 'captured' | 'accepted'; reference: string }>
  | Readonly<{
      status: 'rejected' | 'unavailable' | 'unknown';
      code: string;
      /** Only explicit rejection before acceptance is retryable. */
      retryAfterMs?: number;
    }>;
export interface MailSubmitter {
  submit(message: MailMessage): Promise<MailOutcome>;
}
