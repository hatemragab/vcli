import nodemailer from 'nodemailer';
import type { AppConfig } from '../../core/config/app-config.js';
import type {
  MailMessage,
  MailOutcome,
} from '../../core/mail/mail-submitter.js';
import { MailService } from './mail.service.js';
import { renderMessage } from './render-message.js';
export function translateSmtpError(error: unknown): MailOutcome {
  const detail =
    error && typeof error === 'object'
      ? (error as {
          responseCode?: unknown;
          command?: unknown;
          code?: unknown;
        })
      : {};
  if (typeof detail.responseCode === 'number')
    return {
      status: detail.responseCode >= 500 ? 'rejected' : 'unavailable',
      code: 'SMTP_REJECTED',
    };
  if (detail.code === 'EAUTH' || detail.code === 'ETLS')
    return { status: 'rejected', code: 'SMTP_CONFIGURATION' };
  if (
    detail.command === 'CONN' ||
    detail.command === 'EHLO' ||
    detail.command === 'STARTTLS' ||
    detail.command === 'AUTH'
  )
    return { status: 'unavailable', code: 'SMTP_UNAVAILABLE' };
  return { status: 'unknown', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
}
export class SmtpMailService extends MailService {
  private readonly transport: ReturnType<typeof nodemailer.createTransport>;
  private active = 0;
  constructor(
    private readonly config: AppConfig['mail'],
    production: boolean,
  ) {
    super();
    this.transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: production && !config.secure,
      auth: config.user
        ? { user: config.user, pass: config.password }
        : undefined,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 10000,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }
  async submit(message: MailMessage): Promise<MailOutcome> {
    const rendered = renderMessage(message);
    if (this.active >= 4)
      return { status: 'unavailable', code: 'MAIL_CONCURRENCY_LIMIT' };
    this.active += 1;
    try {
      const info: unknown = await this.transport.sendMail({
        from: this.config.from,
        to: rendered.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        messageId: `<${Buffer.from(rendered.operationId).toString('hex')}@reference.invalid>`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      const result = info as {
        accepted?: unknown[];
        rejected?: unknown[];
        messageId?: string;
      };
      if (result.accepted?.length === 1 && !result.rejected?.length)
        return {
          status: 'accepted',
          reference: result.messageId ?? rendered.operationId,
        };
      return { status: 'rejected', code: 'SMTP_RECIPIENT_REJECTED' };
    } catch (error: unknown) {
      return translateSmtpError(error);
    } finally {
      this.active -= 1;
    }
  }
}
