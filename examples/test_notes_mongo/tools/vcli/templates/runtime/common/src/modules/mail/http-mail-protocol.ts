import type { MailOutcome } from '../../core/mail/mail-submitter.js';

export const RESEND_SEND_ENDPOINT = 'https://api.resend.com/emails';
export const HTTP_MAIL_REQUEST_LIMIT = 131072;
export const HTTP_MAIL_RESPONSE_LIMIT = 16384;
export type HttpMailFetch = (
  url: string,
  request: RequestInit,
) => Promise<Response>;
export type HttpMailOptions = Readonly<{
  from: string;
  apiKey: string;
  timeoutMs?: number;
  maxConcurrency?: number;
}>;

/** Resend documents Retry-After as seconds; no free-form dates/error text. */
export function httpMailRetryAfter(value: string | null): number | undefined {
  if (!value || !/^\d{1,6}(?:\.\d{1,3})?$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds)
    ? Math.min(86400000, Math.ceil(seconds * 1000))
    : undefined;
}

export async function readHttpMailResponse(
  response: Response,
): Promise<unknown> {
  const declared = response.headers.get('content-length');
  if (
    declared &&
    (!/^\d+$/.test(declared) || Number(declared) > HTTP_MAIL_RESPONSE_LIMIT)
  ) {
    await response.body?.cancel();
    throw new Error('HTTP_MAIL_RESPONSE_LIMIT');
  }
  if (!response.body) throw new Error('HTTP_MAIL_RESPONSE_MISSING');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.byteLength;
      if (size > HTTP_MAIL_RESPONSE_LIMIT)
        throw new Error('HTTP_MAIL_RESPONSE_LIMIT');
      chunks.push(result.value);
    }
    return JSON.parse(Buffer.concat(chunks, size).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Only allowlisted status/name facts survive; never return the provider message/body. */
export function translateHttpMailResponse(
  status: number,
  body: unknown,
  retryAfter: string | null,
  operationId: string,
): MailOutcome {
  const value =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (status >= 200 && status < 300) {
    return typeof value.id === 'string' &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        value.id,
      )
      ? { status: 'accepted', reference: operationId }
      : { status: 'unknown', code: 'HTTP_MAIL_RECEIPT_INVALID' };
  }
  if (status === 429) {
    const delay = httpMailRetryAfter(retryAfter);
    return {
      status: 'unavailable',
      code: 'HTTP_MAIL_RATE_LIMIT',
      ...(delay === undefined ? {} : { retryAfterMs: delay }),
    };
  }
  if (status === 500 || status === 503)
    return { status: 'unavailable', code: 'HTTP_MAIL_UNAVAILABLE' };
  if (status === 409 && value.name !== 'invalid_idempotent_request')
    return { status: 'unknown', code: 'HTTP_MAIL_IDEMPOTENCY_UNKNOWN' };
  if ([400, 401, 403, 404, 405, 409, 413, 422].includes(status))
    return {
      status: 'rejected',
      code:
        status === 409
          ? 'HTTP_MAIL_IDEMPOTENCY_CONFLICT'
          : 'HTTP_MAIL_REJECTED',
    };
  return { status: 'unknown', code: 'HTTP_MAIL_ACCEPTANCE_UNKNOWN' };
}
