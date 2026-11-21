import { IDENTITY_CONFIG, ACCESS_TOKENS } from './identity.tokens.js';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { parseInput } from '../../core/http/parse-input.js';
import type { AppConfig } from '../../core/config/app-config.js';
import { LocalCredentials } from './local-credentials.service.js';
import { ActionTokens } from './action-tokens.service.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { RefreshSessions } from '../sessions/refresh-sessions.service.js';
import type { AccessTokens } from './credential-ports.js';
import {
  newId,
  newSecret,
  capabilityHash,
  sessionFacts,
} from './secret-facts.js';
import { credentials, loginInput, refreshInput } from './identity-inputs.js';
import { rateRequest } from './rate-request.js';
import { identityRequestBodies } from './identity-request-bodies.js';
import type { SessionRecord as Session } from '../../core/auth/session-record.js';
@Controller('identity/local')
@ApiTags('Local identity')
export class LocalIdentityController {
  constructor(
    @Inject(LocalCredentials)
    private readonly local: LocalCredentials,
    @Inject(ActionTokens)
    private readonly actions: ActionTokens,
    @Inject(RefreshSessions)
    private readonly refreshSessions: RefreshSessions,
    @Inject(IdentityRateLimits)
    private readonly limits: IdentityRateLimits,
    @Inject(ACCESS_TOKENS)
    private readonly tokens: AccessTokens,
    @Inject(IDENTITY_CONFIG)
    private readonly config: AppConfig,
  ) {}
  @Post('register')
  @ApiOperation({
    summary: 'Register a local account and request email verification',
  })
  @ApiBody(identityRequestBodies.register)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  async register(
    @Body()
    body: unknown,
    @Req()
    request: Request,
  ) {
    const input = parseInput(credentials, body),
      now = Date.now();
    await rateRequest(this.limits, request, 'register', now, input.email);
    await this.local.register(input.email, input.password, newId(), now);
    const token = newSecret();
    await this.actions.request(
      input.email,
      'verification',
      capabilityHash(token, 'action-token'),
      now,
      {
        operationId: newId(),
        to: input.email,
        subject: 'Verify your email',
        text:
          'Verify your email: ' +
          this.config.publicOrigin +
          '/?action=verification#token=' +
          token,
        purpose: 'verification',
      },
    );
    return { status: 'accepted' };
  }
  @Post('login')
  @ApiOperation({ summary: 'Log in with a verified local account' })
  @ApiBody(identityRequestBodies.login)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async login(
    @Body()
    body: unknown,
    @Req()
    request: Request,
  ) {
    const input = parseInput(loginInput, body),
      now = Date.now();
    await rateRequest(this.limits, request, 'login', now, input.email);
    const refreshToken = newSecret();
    const session = await this.local.login(
      input.email,
      input.password,
      sessionFacts(
        now,
        this.config.auth.sessionTtlSeconds,
        input.platform,
        refreshToken,
        input.installationCapability,
        'local',
        input.allowRebind,
      ),
    );
    return this.response(session, refreshToken, now);
  }
  @Post('refresh')
  @ApiOperation({ summary: 'Consume the latest single-use refresh capability' })
  @ApiBody(identityRequestBodies.refresh)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async refresh(
    @Body()
    body: unknown,
    @Req()
    request: Request,
  ) {
    const input = parseInput(refreshInput, body),
      now = Date.now();
    await rateRequest(this.limits, request, 'refresh', now);
    const refreshToken = newSecret();
    const session = await this.refreshSessions.rotate(
      capabilityHash(input.refreshToken, 'refresh-token'),
      capabilityHash(refreshToken, 'refresh-token'),
      now,
    );
    return this.response(session, refreshToken, now);
  }
  private async response(session: Session, refreshToken: string, now: number) {
    const expiresAt = Math.min(
      session.expiresAt,
      now + this.config.auth.accessTtlSeconds * 1000,
    );
    const accessToken = await this.tokens.issue({
      accountId: session.accountId,
      sessionId: session.id,
      installationId: session.installationId,
      expiresAt,
      now,
    });
    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresAt: Math.floor(expiresAt / 1000) * 1000,
      sessionExpiresAt: session.expiresAt,
      sessionId: session.id,
      installationId: session.installationId,
      installationGeneration: session.installationGeneration,
    };
  }
}
