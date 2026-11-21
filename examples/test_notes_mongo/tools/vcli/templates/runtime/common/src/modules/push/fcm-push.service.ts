import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import { pushRetryAfter } from './push-retry-after.js';
import type { App } from 'firebase-admin/app';
import type { PushSender } from './push.entity.js';
import type {
  PushDestination,
  PushMessage,
  PushOutcome,
} from './push.entity.js';
export function translateFcmError(
  error: unknown,
  now = Date.now(),
): PushOutcome {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
  // SDK errors may omit transport headers; use a conservative one-minute floor then.
  const response =
    error && typeof error === 'object' && 'httpResponse' in error
      ? error.httpResponse
      : undefined;
  const headers =
    response && typeof response === 'object' && 'headers' in response
      ? response.headers
      : undefined;
  const retryAfterMs = pushRetryAfter(
    headers && typeof headers === 'object' && 'retry-after' in headers
      ? headers['retry-after']
      : undefined,
    now,
  );
  if (
    [
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
    ].includes(code)
  )
    return {
      status: 'rejected',
      code: 'FCM_INVALID_DESTINATION',
      invalidDestination: true,
    };
  if (
    ['messaging/server-unavailable', 'messaging/internal-error'].includes(code)
  )
    return {
      status: 'unavailable',
      code: 'FCM_UNAVAILABLE',
      retryAfterMs,
    };
  if (
    [
      'messaging/message-rate-exceeded',
      'messaging/device-message-rate-exceeded',
      'messaging/topics-message-rate-exceeded',
    ].includes(code)
  )
    return {
      status: 'unavailable',
      code: 'FCM_THROTTLED',
      retryAfterMs: Math.max(60000, retryAfterMs),
    };
  if (
    [
      'messaging/invalid-argument',
      'messaging/invalid-payload',
      'messaging/invalid-options',
      'messaging/invalid-recipient',
      'messaging/payload-size-limit-exceeded',
      'messaging/invalid-data-payload-key',
    ].includes(code)
  )
    return {
      status: 'rejected',
      code: 'FCM_INVALID_PAYLOAD',
      invalidDestination: false,
    };
  if (
    [
      'messaging/mismatched-credential',
      'messaging/authentication-error',
      'messaging/third-party-auth-error',
      'messaging/invalid-apns-credentials',
      'messaging/sender-id-mismatch',
      'messaging/invalid-package-name',
      'app/invalid-credential',
    ].includes(code)
  )
    return {
      status: 'rejected',
      code: 'FCM_CONFIGURATION',
      invalidDestination: false,
    };
  return { status: 'unknown', code: 'FCM_ACCEPTANCE_UNKNOWN' };
}
export class FcmPushService implements PushSender {
  private readonly messaging;
  private pending = 0;
  constructor(
    app: App,
    private readonly options: Readonly<{
      messaging?: Pick<Messaging, 'send'>;
      timeoutMs?: number;
      clock?: () => number;
    }> = {},
  ) {
    this.messaging = options.messaging ?? getMessaging(app);
  }
  async submit(
    destination: PushDestination,
    message: PushMessage,
    now: number,
    beforeDisclosure?: () => Promise<boolean>,
  ): Promise<PushOutcome> {
    const current = Math.max(now, (this.options.clock ?? Date.now)());
    if (
      message.purpose !== 'ordinary' ||
      destination.purpose !== message.purpose ||
      destination.provider !== 'fcm'
    )
      return {
        status: 'rejected',
        code: 'FCM_UNSUPPORTED_PURPOSE',
        invalidDestination: false,
      };
    if (Buffer.byteLength(JSON.stringify(message)) > 3500)
      return {
        status: 'rejected',
        code: 'PUSH_PAYLOAD_TOO_LARGE',
        invalidDestination: false,
      };
    if (message.expiresAt <= current)
      return {
        status: 'rejected',
        code: 'PUSH_EXPIRED',
        invalidDestination: false,
      };
    if (this.pending >= 4)
      return { status: 'unavailable', code: 'FCM_BUSY', retryAfterMs: 1000 };
    this.pending += 1;
    let accepting = true;
    const operation = Promise.resolve()
      .then(async () => {
        if (beforeDisclosure && !(await beforeDisclosure())) return undefined;
        if (!accepting) return undefined;
        const dispatchNow = Math.max(
          current,
          (this.options.clock ?? Date.now)(),
        );
        if (message.expiresAt <= dispatchNow) return undefined;
        return this.messaging.send({
          token: destination.token,
          notification:
            message.title || message.body
              ? { title: message.title, body: message.body }
              : undefined,
          data: { ...message.data, operationId: message.operationId },
          android: { ttl: message.expiresAt - dispatchNow },
          apns: {
            headers: {
              'apns-expiration': String(Math.floor(message.expiresAt / 1000)),
              'apns-push-type': 'alert',
              'apns-priority': '10',
            },
          },
          webpush: {
            headers: {
              TTL: String(
                Math.max(
                  1,
                  Math.floor((message.expiresAt - dispatchNow) / 1000),
                ),
              ),
            },
          },
        });
      })
      .then<PushOutcome, PushOutcome>(
        (reference) =>
          reference === undefined
            ? {
                status: 'rejected',
                code: 'PUSH_DESTINATION_INELIGIBLE',
                invalidDestination: false,
              }
            : {
                status: 'accepted',
                reference:
                  reference.length <= 512 &&
                  /^projects\/[A-Za-z0-9:_.-]+\/messages\/[A-Za-z0-9:%_.~/-]+$/.test(
                    reference,
                  )
                    ? reference
                    : message.operationId,
              },
        (error: unknown) =>
          translateFcmError(error, (this.options.clock ?? Date.now)()),
      )
      .finally(() => {
        this.pending -= 1;
      });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<PushOutcome>((resolve) => {
          timer = setTimeout(
            () => {
              accepting = false;
              resolve({ status: 'unknown', code: 'FCM_ACCEPTANCE_UNKNOWN' });
            },
            Math.max(
              1,
              Math.min(
                this.options.timeoutMs ?? 10000,
                message.expiresAt - current,
              ),
            ),
          );
        }),
      ]);
    } finally {
      accepting = false;
      if (timer) clearTimeout(timer);
    }
  }
}
