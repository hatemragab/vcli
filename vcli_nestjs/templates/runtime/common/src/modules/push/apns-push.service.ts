import { importPKCS8, SignJWT } from 'jose';
import { ApplicationError } from '../../core/errors/application-error.js';
import { readPushCredential } from './push-credential-file.js';
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
    try {
      const key = await importPKCS8(
        await readPushCredential(config.apnsKeyPath, 16384),
        'ES256',
      );
      return new ApnsPushService(config, key, options);
    } catch {
      throw new ApplicationError('INVALID_APNS_PRIVATE_KEY', 500);
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
