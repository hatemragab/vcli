import { getMessaging } from 'firebase-admin/messaging';
import type { App } from 'firebase-admin/app';
import type { PushSender } from './push.entity.js';
import type {
  PushDestination,
  PushMessage,
  PushOutcome,
} from './push.entity.js';
export function translateFcmError(error: unknown): PushOutcome {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String(error.code)
      : '';
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
      retryAfterMs: 1000,
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
      retryAfterMs: 60000,
    };
  if (
    [
      'messaging/invalid-argument',
      'messaging/invalid-payload',
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
  constructor(app: App) {
    this.messaging = getMessaging(app);
  }
  async submit(
    destination: PushDestination,
    message: PushMessage,
    now: number,
  ): Promise<PushOutcome> {
    const current = Math.max(now, Date.now());
    if (message.purpose !== 'ordinary' || destination.provider !== 'fcm')
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
    const operation = Promise.resolve()
      .then(() =>
        this.messaging.send({
          token: destination.token,
          notification:
            message.title || message.body
              ? { title: message.title, body: message.body }
              : undefined,
          data: { ...message.data, operationId: message.operationId },
          android: { ttl: message.expiresAt - current },
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
                Math.max(1, Math.floor((message.expiresAt - current) / 1000)),
              ),
            },
          },
        }),
      )
      .then<PushOutcome, PushOutcome>(
        (reference) => ({ status: 'accepted', reference }),
        (error: unknown) => translateFcmError(error),
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
            () =>
              resolve({ status: 'unknown', code: 'FCM_ACCEPTANCE_UNKNOWN' }),
            10000,
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
