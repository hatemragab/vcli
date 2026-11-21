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
import type { AppConfig } from '../../core/config/app-config.js';
import { parseInput } from '../../core/http/parse-input.js';
import { ActionTokens } from './action-tokens.service.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { newId, newSecret, capabilityHash } from './secret-facts.js';
import {
  emailInput,
  verificationInput,
  resetInput,
} from './identity-inputs.js';
import { rateRequest } from './rate-request.js';
import { IDENTITY_CONFIG } from './identity.tokens.js';
import { identityRequestBodies } from './identity-request-bodies.js';
@Controller('identity/local')
@ApiTags('Local identity')
export class ActionTokensController {
  constructor(
    @Inject(ActionTokens) private readonly actions: ActionTokens,
    @Inject(IdentityRateLimits) private readonly limits: IdentityRateLimits,
    @Inject(IDENTITY_CONFIG) private readonly config: AppConfig,
  ) {}
  private async request(
    body: unknown,
    request: Request,
    purpose: 'verification' | 'password-reset',
  ) {
    const input = parseInput(emailInput, body),
      now = Date.now();
    await rateRequest(this.limits, request, purpose, now, input.email);
    const token = newSecret();
    await this.actions.request(
      input.email,
      purpose,
      capabilityHash(token, 'action-token'),
      now,
      {
        operationId: newId(),
        to: input.email,
        subject:
          purpose === 'verification'
            ? 'Verify your email'
            : 'Reset your password',
        text:
          'Continue: ' +
          this.config.publicOrigin +
          '/?action=' +
          purpose +
          '#token=' +
          token,
        purpose,
      },
    );
    return { status: 'accepted' };
  }
  @Post('verification/request')
  @ApiOperation({ summary: 'Request a local email verification action' })
  @ApiBody(identityRequestBodies.verificationRequest)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  verificationRequest(@Body() body: unknown, @Req() request: Request) {
    return this.request(body, request, 'verification');
  }
  @Post('reset/request')
  @ApiOperation({ summary: 'Request a local password reset action' })
  @ApiBody(identityRequestBodies.resetRequest)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  resetRequest(@Body() body: unknown, @Req() request: Request) {
    return this.request(body, request, 'password-reset');
  }
  @Post('verification/confirm')
  @ApiOperation({
    summary: 'Verify email and establish the proof holder’s chosen password',
  })
  @ApiBody(identityRequestBodies.verificationConfirm)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async verificationConfirm(@Body() body: unknown, @Req() request: Request) {
    const input = parseInput(verificationInput, body),
      now = Date.now();
    await rateRequest(this.limits, request, 'confirm', now);
    await this.actions.confirm(
      capabilityHash(input.token, 'action-token'),
      'verification',
      now,
      input.password,
    );
    return { status: 'verified' };
  }
  @Post('reset/confirm')
  @ApiOperation({
    summary: 'Consume a private reset action and revoke all sessions',
  })
  @ApiBody(identityRequestBodies.resetConfirm)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async resetConfirm(@Body() body: unknown, @Req() request: Request) {
    const input = parseInput(resetInput, body),
      now = Date.now();
    await rateRequest(this.limits, request, 'confirm', now);
    await this.actions.confirm(
      capabilityHash(input.token, 'action-token'),
      'password-reset',
      now,
      input.password,
    );
    return { status: 'password-reset', reauthenticate: true };
  }
}
