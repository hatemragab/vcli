import type { PushMessage, PushOutcome } from './push.entity.js';
export function apnsEnvelope(message: PushMessage, topic: string) {
  const background = message.purpose === 'background';
  const voip = message.purpose === 'voip';
  const aps =
    background || voip
      ? { 'content-available': 1 }
      : {
          alert: { title: message.title, body: message.body },
          sound: 'default',
        };
  return {
    headers: {
      'apns-topic': voip ? `${topic}.voip` : topic,
      'apns-push-type': voip ? 'voip' : background ? 'background' : 'alert',
      'apns-priority': background ? '5' : '10',
      'apns-expiration': voip
        ? '0'
        : String(Math.floor(message.expiresAt / 1000)),
      'apns-id': message.operationId,
    },
    body: JSON.stringify({
      aps,
      data: message.data,
      operationId: message.operationId,
    }),
  };
}
export function translateApnsResponse(
  status: number,
  reason: string,
  reference: string,
  retryAfterMs = 1000,
  invalidatedAt?: number,
  registeredAt?: number,
): PushOutcome {
  if (status === 200) return { status: 'accepted', reference };
  if (status === 410 && reason === 'Unregistered')
    return {
      status: 'rejected',
      code: 'APNS_INVALID_DESTINATION',
      invalidDestination:
        invalidatedAt !== undefined &&
        Number.isFinite(invalidatedAt) &&
        registeredAt !== undefined &&
        Number.isFinite(registeredAt) &&
        invalidatedAt >= registeredAt,
    };
  if (status === 429 || status >= 500)
    return {
      status: 'unavailable',
      code: status === 429 ? 'APNS_THROTTLED' : 'APNS_UNAVAILABLE',
      retryAfterMs,
    };
  return {
    status: 'rejected',
    code:
      status === 401 ||
      status === 403 ||
      [
        'BadDeviceToken',
        'DeviceTokenNotForTopic',
        'BadTopic',
        'MissingTopic',
        'TopicDisallowed',
        'BadCertificateEnvironment',
      ].includes(reason)
        ? 'APNS_CONFIGURATION'
        : status === 400 || status === 413
          ? 'APNS_INVALID_PAYLOAD'
          : 'APNS_REQUEST_REJECTED',
    invalidDestination: false,
  };
}
