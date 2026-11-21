import { constants, connect } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import { constants as fileConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import type { AppConfig } from '../../core/config/app-config.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PushSender } from './push.entity.js';
import type {
  PushDestination,
  PushMessage,
  PushOutcome,
} from './push.entity.js';
import { apnsEnvelope, translateApnsResponse } from './apns-payload.js';
export class ApnsPushService implements PushSender {
  private cachedToken?: Readonly<{
    value: string;
    issuedAt: number;
  }>;
  private active = 0;
  private constructor(
    private readonly config: AppConfig['push'],
    private readonly key: CryptoKey,
  ) {}
  static async create(config: AppConfig['push']): Promise<ApnsPushService> {
    if (
      !config.apnsTeamId ||
      !/^[A-Z0-9]{10}$/.test(config.apnsTeamId) ||
      !config.apnsKeyId ||
      !/^[A-Z0-9]{10}$/.test(config.apnsKeyId) ||
      !config.apnsKeyPath ||
      !config.apnsTopic ||
      !/^[A-Za-z0-9][A-Za-z0-9.-]{1,253}$/.test(config.apnsTopic) ||
      config.apnsTopic.endsWith('.voip')
    )
      throw new ApplicationError('INVALID_APNS_CONFIG', 500);
    const file = await open(
      config.apnsKeyPath,
      fileConstants.O_RDONLY | fileConstants.O_NOFOLLOW,
    );
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0)
        throw new ApplicationError('APNS_KEY_MUST_BE_PRIVATE', 500);
      const key = await importPKCS8(await file.readFile('utf8'), 'ES256');
      return new ApnsPushService(config, key);
    } finally {
      await file.close();
    }
  }
  async submit(
    destination: PushDestination,
    message: PushMessage,
    now: number,
  ): Promise<PushOutcome> {
    const current = Math.max(now, Date.now());
    if (message.expiresAt <= current)
      return {
        status: 'rejected',
        code: 'PUSH_EXPIRED',
        invalidDestination: false,
      };
    if (this.active >= 4)
      return { status: 'unavailable', code: 'APNS_BUSY', retryAfterMs: 1000 };
    const envelope = apnsEnvelope(message, this.config.apnsTopic ?? '');
    if (
      Buffer.byteLength(envelope.body) >
      (message.purpose === 'voip' ? 5120 : 4096)
    )
      return {
        status: 'rejected',
        code: 'PUSH_PAYLOAD_TOO_LARGE',
        invalidDestination: false,
      };
    this.active += 1;
    try {
      const token = await this.providerToken(current);
      return await this.request(
        destination,
        token,
        envelope,
        message.operationId,
      );
    } catch {
      return { status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' };
    } finally {
      this.active -= 1;
    }
  }
  private async providerToken(now: number): Promise<string> {
    const issuedAt = Math.floor(now / 1000);
    if (!this.cachedToken || issuedAt - this.cachedToken.issuedAt >= 3000) {
      const value = await new SignJWT({})
        .setProtectedHeader({ alg: 'ES256', kid: this.config.apnsKeyId })
        .setIssuer(this.config.apnsTeamId ?? '')
        .setIssuedAt(issuedAt)
        .sign(this.key);
      this.cachedToken = { value, issuedAt };
    }
    return this.cachedToken.value;
  }
  private request(
    destination: PushDestination,
    token: string,
    envelope: ReturnType<typeof apnsEnvelope>,
    operationId: string,
  ): Promise<PushOutcome> {
    return new Promise((resolve) => {
      const client = connect(
        this.config.apnsProduction
          ? 'https://api.push.apple.com'
          : 'https://api.sandbox.push.apple.com',
        { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      );
      let settled = false;
      const finish = (outcome: PushOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client.destroy();
        resolve(outcome);
      };
      const timer = setTimeout(
        () => finish({ status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' }),
        10000,
      );
      client.on('error', () =>
        finish({ status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' }),
      );
      client.once('connect', () => {
        if (settled) return;
        try {
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
          let retryAfterMs = 1000;
          let body = '';
          request.setEncoding('utf8');
          request.on('response', (headers) => {
            status = Number(headers[':status']);
            reference =
              typeof headers['apns-id'] === 'string'
                ? headers['apns-id']
                : operationId;
            const retry = headers['retry-after'];
            if (typeof retry === 'string')
              retryAfterMs = /^\d+$/.test(retry)
                ? Number(retry) * 1000
                : Math.max(1000, Date.parse(retry) - Date.now());
          });
          request.on('data', (chunk: string) => {
            body += chunk;
            if (body.length > 8192) {
              request.close(constants.NGHTTP2_CANCEL);
              finish({ status: 'unknown', code: 'APNS_RESPONSE_TOO_LARGE' });
            }
          });
          request.on('error', () =>
            finish({ status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' }),
          );
          request.on('end', () => {
            let reason = '';
            let invalidatedAt: number | undefined;
            try {
              const parsed: unknown = body ? JSON.parse(body) : {};
              if (parsed && typeof parsed === 'object') {
                if ('reason' in parsed) reason = String(parsed.reason);
                if (
                  'timestamp' in parsed &&
                  typeof parsed.timestamp === 'number'
                )
                  invalidatedAt = parsed.timestamp;
              }
            } catch {
              /* Invalid provider JSON cannot be interpreted as an invalid token. */
            }
            finish(
              status
                ? translateApnsResponse(
                    status,
                    reason,
                    reference,
                    Number.isFinite(retryAfterMs) ? retryAfterMs : 60000,
                    invalidatedAt,
                    destination.updatedAt,
                  )
                : { status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' },
            );
          });
          request.end(envelope.body);
        } catch {
          finish({ status: 'unknown', code: 'APNS_ACCEPTANCE_UNKNOWN' });
        }
      });
    });
  }
}
