import type {
  MailMessage,
  MailOutcome,
} from '../../core/mail/mail-submitter.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { MailService } from './mail.service.js';
import { renderMessage, validMailAddress } from './render-message.js';
import {
  HTTP_MAIL_REQUEST_LIMIT,
  readHttpMailResponse,
  RESEND_SEND_ENDPOINT,
  translateHttpMailResponse,
  type HttpMailFetch,
  type HttpMailOptions,
} from './http-mail-protocol.js';

/** A fixed Resend transport. Only trusted composition/tests may replace its fetch boundary. */
export class HttpMailService extends MailService {
  readonly #apiKey: string;
  readonly #from: string;
  readonly #fetcher: HttpMailFetch;
  private readonly timeout: number;
  private readonly concurrency: number;
  private readonly requests = new Set<AbortController>();
  private closed = false;

  constructor(options: HttpMailOptions, fetcher: HttpMailFetch = fetch) {
    super();
    if (
      !options ||
      !validMailAddress(options.from) ||
      typeof options.apiKey !== 'string' ||
      !/^re_[A-Za-z0-9_-]{8,256}$/.test(options.apiKey)
    )
      throw new ApplicationError('INVALID_HTTP_MAIL_CONFIGURATION', 500);
    this.#apiKey = options.apiKey;
    this.#from = options.from;
    this.#fetcher = fetcher;
    this.timeout = options.timeoutMs ?? 10000;
    this.concurrency = options.maxConcurrency ?? 4;
    if (
      !Number.isInteger(this.timeout) ||
      this.timeout < 50 ||
      this.timeout > 60000 ||
      !Number.isInteger(this.concurrency) ||
      this.concurrency < 1 ||
      this.concurrency > 16
    )
      throw new ApplicationError('INVALID_HTTP_MAIL_CONFIGURATION', 500);
  }

  async submit(message: MailMessage): Promise<MailOutcome> {
    const rendered = renderMessage(message);
    if (this.closed) return { status: 'unavailable', code: 'HTTP_MAIL_CLOSED' };
    if (this.requests.size >= this.concurrency)
      return {
        status: 'unavailable',
        code: 'MAIL_CONCURRENCY_LIMIT',
        retryAfterMs: 1000,
      };
    const body = JSON.stringify({
      from: this.#from,
      to: [rendered.to],
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    if (Buffer.byteLength(body) > HTTP_MAIL_REQUEST_LIMIT)
      return { status: 'rejected', code: 'HTTP_MAIL_MESSAGE_TOO_LARGE' };
    const controller = new AbortController();
    this.requests.add(controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('HTTP_MAIL_DEADLINE'));
        }, this.timeout);
      });
      const request = (async (): Promise<MailOutcome> => {
        const response = await this.#fetcher(RESEND_SEND_ENDPOINT, {
          method: 'POST',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            authorization: `Bearer ${this.#apiKey}`,
            'content-type': 'application/json',
            accept: 'application/json',
            'idempotency-key': `vcli-mail/${rendered.operationId}`,
          },
          body,
        });
        const result = await readHttpMailResponse(response);
        return translateHttpMailResponse(
          response.status,
          result,
          response.headers.get('retry-after'),
          rendered.operationId,
        );
      })();
      return await Promise.race([request, deadline]);
    } catch {
      // A connection/body/deadline failure can follow acceptance. Never retry it here.
      return { status: 'unknown', code: 'HTTP_MAIL_ACCEPTANCE_UNKNOWN' };
    } finally {
      clearTimeout(timer);
      controller.abort();
      this.requests.delete(controller);
    }
  }

  close(): void {
    this.closed = true;
    for (const request of this.requests) request.abort();
  }
}
