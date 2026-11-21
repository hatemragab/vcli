import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { parseInput } from '../../core/http/parse-input.js';
import type { Principal } from '../../core/auth/principal.js';
import { ChangePassword } from './change-password.service.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { changeInput } from './identity-inputs.js';
import { rateRequest } from './rate-request.js';
import { identityRequestBodies } from './identity-request-bodies.js';
@Controller('identity/local')
@UseGuards(PrincipalGuard)
@ApiTags('Local identity')
@ApiBearerAuth()
export class ChangePasswordController {
  constructor(
    @Inject(ChangePassword) private readonly passwords: ChangePassword,
    @Inject(IdentityRateLimits) private readonly limits: IdentityRateLimits,
  ) {}
  @Post('password/change')
  @ApiOperation({
    summary: 'Change the local password and revoke all sessions',
  })
  @ApiBody(identityRequestBodies.passwordChange)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async change(
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() request: Request,
  ) {
    const input = parseInput(changeInput, body),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'change-password',
      now,
      actor.accountId,
    );
    await this.passwords.change(
      actor,
      input.currentPassword,
      input.newPassword,
      now,
    );
    return { status: 'password-changed', reauthenticate: true };
  }
}
