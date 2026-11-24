import { constants, connect, type ClientHttp2Session } from 'node:http2';
import { pushRetryAfter } from './push-retry-after.js';
import { translateApnsResponse, type apnsEnvelope } from './apns-payload.js';
import type { PushDestination, PushOutcome } from './push.entity.js';
export type ApnsConnectionFactory = (origin: string) => ClientHttp2Session;
/** Explicit constructor-only seam for controlled loopback peers; config cannot change Apple's origins. */
export function requestApns(
  production: boolean,
  destination: PushDestination,
  token: string,
  envelope: ReturnType<typeof apnsEnvelope>,
  operationId: string,
  timeoutMs: number,
  connection: ApnsConnectionFactory = (origin) =>
    connect(origin, { minVersion: 'TLSv1.2', rejectUnauthorized: true }),
  beforeDisclosure?: () => Promise<boolean>,
): Promise<PushOutcome> {
  return new Promise((resolve) => {
    let client: ClientHttp2Session;
    try {
      client = connection(
        production
          ? 'https://api.push.apple.com'
          : 'https://api.sandbox.push.apple.com',
      );
    } catch {
      resolve({
        status: 'unavailable',
        code: 'APNS_CONNECT_FAILED',
        retryAfterMs: 1000,
      });
      return;
    }
    let settled = false;
    let disclosed = false;
    const failure = (): PushOutcome =>
      disclosed
        ? { status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' }
        : {
            status: 'unavailable',
            code: 'APNS_CONNECT_FAILED',
            retryAfterMs: 1000,
          };
    const finish = (outcome: PushOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.destroy();
      resolve(outcome);
    };
    const timer = setTimeout(() => finish(failure()), Math.max(1, timeoutMs));
    client.on('error', () => finish(failure()));
    client.on('close', () => {
      if (!settled) finish(failure());
    });
    client.once('connect', async () => {
      if (settled) return;
      try {
        if (beforeDisclosure && !(await beforeDisclosure())) {
          finish({
            status: 'rejected',
            code: 'PUSH_DESTINATION_INELIGIBLE',
            invalidDestination: false,
          });
          return;
        }
        if (settled) return;
        disclosed = true;
        const request = client.request(
          {
            ':method': 'POST',
            ':path': `/3/device/${destination.token}`,
            authorization: `bearer ${token}`,
            ...envelope.headers,
          },
          { endStream: false },
        );
        let status = 0;
        let reference = operationId;
        let retryAfterMs = 60000;
        let body = '';
        request.setEncoding('utf8');
        request.on('response', (headers) => {
          status = Number(headers[':status']);
          // Provider reference is not a channel for arbitrary secret-bearing diagnostics.
          reference =
            typeof headers['apns-id'] === 'string' &&
            /^[0-9a-f-]{36}$/i.test(headers['apns-id'])
              ? headers['apns-id']
              : operationId;
          retryAfterMs = pushRetryAfter(headers['retry-after'], Date.now());
        });
        request.on('data', (chunk: string) => {
          body += chunk;
          if (Buffer.byteLength(body) > 8192) {
            request.close(constants.NGHTTP2_CANCEL);
            finish({ status: 'unknown', code: 'APNS_RESPONSE_TOO_LARGE' });
          }
        });
        request.on('error', () => finish(failure()));
        request.on('close', () => {
          if (!settled) finish(failure());
        });
        request.on('end', () => {
          let reason = '';
          let invalidatedAt: number | undefined;
          try {
            const parsed: unknown = body ? JSON.parse(body) : {};
            if (parsed && typeof parsed === 'object') {
              if ('reason' in parsed && typeof parsed.reason === 'string')
                reason = parsed.reason;
              if ('timestamp' in parsed && typeof parsed.timestamp === 'number')
                invalidatedAt = parsed.timestamp;
            }
          } catch {
            /* Malformed response cannot authorize token pruning. */
          }
          finish(
            status
              ? translateApnsResponse(
                  status,
                  reason,
                  reference,
                  retryAfterMs,
                  invalidatedAt,
                  destination.updatedAt,
                )
              : failure(),
          );
        });
        request.end(envelope.body);
      } catch {
        finish(failure());
      }
    });
  });
}
