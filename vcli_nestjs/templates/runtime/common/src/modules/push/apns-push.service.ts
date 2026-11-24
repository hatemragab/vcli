import { importPKCS8, SignJWT } from 'jose';
import { constants as fileConstants } from 'node:fs';
import { open } from 'node:fs/promises';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { PushSender } from './push.entity.js';
import type {
  PushDestination,
  PushMessage,
  PushOutcome,
} from './push.entity.js';
import { apnsEnvelope } from './apns-payload.js';
import { requestApns, type ApnsConnectionFactory } from './apns-transport.js';
export type ApnsConfiguration = Readonly<{
  apnsTeamId?: string;
  apnsKeyId?: string;
  apnsKeyPath?: string;
  apnsTopic?: string;
  apnsProduction?: boolean;
}>;
export type ApnsOptions = Readonly<{
  connection?: ApnsConnectionFactory;
  clock?: () => number;
  timeoutMs?: number;
}>;
export class ApnsPushService implements PushSender {
  private cachedToken?: Readonly<{
    value: string;
    issuedAt: number;
  }>;
  private active = 0;
  private constructor(
    private readonly config: ApnsConfiguration,
    private readonly key: CryptoKey,
    private readonly options: ApnsOptions,
  ) {}
  static async create(
    config: ApnsConfiguration,
    options: ApnsOptions = {},
  ): Promise<ApnsPushService> {
    if (
      typeof config.apnsProduction !== 'boolean' ||
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
    ).catch(() => {
      throw new ApplicationError('INVALID_APNS_PRIVATE_KEY', 500);
    });
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) !== 0)
        throw new ApplicationError('APNS_KEY_MUST_BE_PRIVATE', 500);
      const bytes = Buffer.alloc(16385);
      const read = await file.read(bytes, 0, bytes.length, 0);
      if (read.bytesRead > 16384) throw new Error('PRIVATE_KEY_TOO_LARGE');
      const key = await importPKCS8(
        bytes.subarray(0, read.bytesRead).toString('utf8'),
        'ES256',
      );
      return new ApnsPushService(config, key, options);
    } catch {
      throw new ApplicationError('INVALID_APNS_PRIVATE_KEY', 500);
    } finally {
      await file.close();
    }
  }
  async submit(
    destination: PushDestination,
    message: PushMessage,
    now: number,
    beforeDisclosure?: () => Promise<boolean>,
  ): Promise<PushOutcome> {
    const current = Math.max(now, (this.options.clock ?? Date.now)());
    if (
      destination.provider !== 'apns' ||
      destination.platform !== 'ios' ||
      destination.purpose !== message.purpose ||
      destination.environment !==
        (this.config.apnsProduction ? 'production' : 'sandbox') ||
      !/^(?:[0-9a-f]{2}){32,256}$/.test(destination.token)
    )
      return {
        status: 'rejected',
        code: 'APNS_CONFIGURATION',
        invalidDestination: false,
      };
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
      return await requestApns(
        this.config.apnsProduction === true,
        destination,
        token,
        envelope,
        message.operationId,
        Math.min(this.options.timeoutMs ?? 10000, message.expiresAt - current),
        this.options.connection,
        async () => {
          const clock = this.options.clock ?? Date.now;
          if (clock() >= message.expiresAt) return false;
          const allowed = beforeDisclosure ? await beforeDisclosure() : true;
          return allowed && clock() < message.expiresAt;
        },
      );
    } catch {
      return {
        status: 'rejected',
        code: 'APNS_CONFIGURATION',
        invalidDestination: false,
      };
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
}
