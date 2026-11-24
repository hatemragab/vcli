import nodemailer from 'nodemailer';
import type {
  MailMessage,
  MailOutcome,
} from '../../core/mail/mail-submitter.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { MailService } from './mail.service.js';
import { renderMessage, validMailAddress } from './render-message.js';
export type SmtpMailOptions = Readonly<{
  from: string;
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  password?: string;
  timeoutMs?: number;
  maxConcurrency?: number;
}>;
export function translateSmtpError(error: unknown): MailOutcome {
  const detail =
    error && typeof error === 'object'
      ? (error as {
          responseCode?: unknown;
          command?: unknown;
          code?: unknown;
          originalCode?: unknown;
          timeoutType?: unknown;
        })
      : {};
  // SMTP has no standardized Retry-After header. Never parse free-form response text.
  if (
    typeof detail.responseCode === 'number' &&
    detail.responseCode >= 400 &&
    detail.responseCode < 600
  )
    return {
      status: detail.responseCode >= 500 ? 'rejected' : 'unavailable',
      code: 'SMTP_REJECTED',
    };
  if (['EAUTH', 'ETLS', 'EENVELOPE', 'EMESSAGE'].includes(String(detail.code)))
    return { status: 'rejected', code: 'SMTP_CONFIGURATION' };
  if (
    detail.code === 'EDNS' ||
    ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(
      String(detail.originalCode),
    ) ||
    ['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT'].includes(
      String(detail.timeoutType),
    ) ||
    ['EHLO', 'HELO', 'STARTTLS', 'AUTH', 'MAIL FROM', 'RCPT TO'].includes(
      String(detail.command),
    )
  )
    return { status: 'unavailable', code: 'SMTP_UNAVAILABLE' };
  // DATA/socket interruption can occur after the peer accepted the message.
  return { status: 'unknown', code: 'SMTP_ACCEPTANCE_UNKNOWN' };
}
export class SmtpMailService extends MailService {
  private readonly transports = new Set<
    ReturnType<typeof nodemailer.createTransport>
  >();
  private readonly timeout: number;
  private closed = false;
  private readonly concurrency: number;
  private active = 0;
  constructor(
    private readonly config: SmtpMailOptions,
    private readonly production: boolean,
  ) {
    super();
    const timeout = config.timeoutMs ?? 10000;
    this.timeout = timeout;
    this.concurrency = config.maxConcurrency ?? 4;
    if (
      !validMailAddress(config.from) ||
      typeof config.host !== 'string' ||
      !config.host ||
      /[\s\0/]/.test(config.host) ||
      !Number.isInteger(config.port) ||
      config.port! < 1 ||
      config.port! > 65535 ||
      typeof config.secure !== 'boolean' ||
      !Number.isInteger(timeout) ||
      timeout < 50 ||
      timeout > 60000 ||
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 16 ||
      !!config.user !== !!config.password
    )
      throw new ApplicationError('INVALID_SMTP_CONFIGURATION', 500);
  }
  private createTransport() {
    const config = this.config,
      timeout = this.timeout;
    // A one-message pool provides the public force-close API. Disable Nodemailer's
    // default requeue on disconnect: acceptance can already have happened.
    return nodemailer.createTransport({
      pool: true,
      maxConnections: 1,
      maxMessages: 1,
      maxRequeues: 0,
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: this.production && !config.secure,
      auth: config.user
        ? { user: config.user, pass: config.password }
        : undefined,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
    });
  }
  async submit(message: MailMessage): Promise<MailOutcome> {
    const rendered = renderMessage(message);
    if (this.closed) return { status: 'unavailable', code: 'SMTP_CLOSED' };
    if (this.active >= this.concurrency)
      return {
        status: 'unavailable',
        code: 'MAIL_CONCURRENCY_LIMIT',
        retryAfterMs: 1000,
      };
    this.active++;
    const transport = this.createTransport();
    this.transports.add(transport);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          transport.close({ force: true });
          reject(new Error('SMTP_DEADLINE_UNKNOWN'));
        }, this.timeout);
      });
      const result = await Promise.race([
        transport.sendMail({
          from: this.config.from,
          to: rendered.to,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          messageId: `<${Buffer.from(rendered.operationId).toString('hex')}@application.invalid>`,
          disableFileAccess: true,
          disableUrlAccess: true,
        }),
        deadline,
      ]);
      if (result.accepted?.length === 1 && !result.rejected?.length)
        return { status: 'accepted', reference: rendered.operationId };
      return { status: 'unknown', code: 'SMTP_RECIPIENT_OUTCOME_UNKNOWN' };
    } catch (error: unknown) {
      return translateSmtpError(error);
    } finally {
      clearTimeout(timer);
      transport.close({ force: true });
      this.transports.delete(transport);
      this.active--;
    }
  }
  close(): void {
    this.closed = true;
    for (const transport of this.transports) transport.close({ force: true });
  }
}
