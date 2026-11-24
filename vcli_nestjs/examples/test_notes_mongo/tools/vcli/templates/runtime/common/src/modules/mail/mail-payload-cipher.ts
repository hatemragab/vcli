import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PreparedMailIntent } from '../../core/mail/action-delivery.js';
import type { MailMessage } from '../../core/mail/mail-submitter.js';
import { renderMessage } from './render-message.js';
const aad = (
  intent: Pick<
    PreparedMailIntent,
    'operationId' | 'purpose' | 'expiresAt' | 'keyId'
  >,
) =>
  Buffer.from(
    JSON.stringify([
      'mail-intent-v1',
      intent.operationId,
      intent.purpose,
      intent.expiresAt,
      intent.keyId,
    ]),
  );
export class MailPayloadCipher {
  private readonly keys = new Map<string, Buffer>();
  constructor(
    private readonly activeKeyId: string,
    keys: Readonly<Record<string, string>>,
  ) {
    if (Object.keys(keys).length < 1 || Object.keys(keys).length > 8)
      throw new ApplicationError('INVALID_MAIL_KEYS', 500);
    for (const [id, value] of Object.entries(keys)) {
      const key = Buffer.from(value, 'base64');
      if (
        !/^[A-Za-z0-9_-]{1,40}$/.test(id) ||
        key.length !== 32 ||
        key.toString('base64') !== value
      )
        throw new ApplicationError('INVALID_MAIL_KEYS', 500);
      this.keys.set(id, key);
    }
    if (!this.keys.has(activeKeyId))
      throw new ApplicationError('INVALID_MAIL_KEYS', 500);
  }
  encrypt(message: MailMessage, expiresAt: number): PreparedMailIntent {
    if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0)
      throw new ApplicationError('INVALID_MAIL_EXPIRY', 400);
    const rendered = renderMessage(message);
    const head = {
      operationId: rendered.operationId,
      purpose: rendered.purpose,
      expiresAt,
      keyId: this.activeKeyId,
    };
    const iv = randomBytes(12),
      cipher = createCipheriv(
        'aes-256-gcm',
        this.keys.get(this.activeKeyId)!,
        iv,
      );
    cipher.setAAD(aad(head));
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(rendered), 'utf8'),
      cipher.final(),
    ]);
    return Object.freeze({
      ...head,
      payload: Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
        'base64',
      ),
    });
  }
  decrypt(intent: PreparedMailIntent): MailMessage {
    try {
      const key = this.keys.get(intent.keyId),
        bytes = Buffer.from(intent.payload, 'base64');
      if (
        !key ||
        bytes.length < 29 ||
        bytes.length > 262144 ||
        bytes.toString('base64') !== intent.payload
      )
        throw new Error();
      const decipher = createDecipheriv(
        'aes-256-gcm',
        key,
        bytes.subarray(0, 12),
      );
      decipher.setAAD(aad(intent));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const input: unknown = JSON.parse(
        Buffer.concat([
          decipher.update(bytes.subarray(28)),
          decipher.final(),
        ]).toString('utf8'),
      );
      if (!input || typeof input !== 'object') throw new Error();
      // Authenticated JSON still passes the public message validator after key rotation/restores.
      const message = renderMessage(input as MailMessage);
      if (
        message.operationId !== intent.operationId ||
        message.purpose !== intent.purpose
      )
        throw new Error();
      return message;
    } catch {
      throw new ApplicationError('MAIL_PAYLOAD_UNAVAILABLE', 503);
    }
  }
}
