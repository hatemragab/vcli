import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { rateRequest } from './rate-request.js';
import { validPasswordInput } from '../../core/auth/password-input.js';
import {
  Body,
  Controller,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import { z } from 'zod';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import type { Principal } from '../../core/auth/principal.js';
import { parseInput } from '../../core/http/parse-input.js';
import { AccountLifecycle } from './account-lifecycle.service.js';
const password = z.string().min(12).max(128).refine(validPasswordInput);
const proof = {
  password: password.optional(),
  idToken: z.string().min(1).max(16384).optional(),
};
const disableInput = z.strictObject({
  confirm: z.literal('disable'),
  ...proof,
});
const deleteInput = z.strictObject({ confirm: z.literal('delete'), ...proof });
function body(schema: typeof disableInput | typeof deleteInput) {
  return {
    required: true,
    schema: z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
    }) as Extract<
      import('@nestjs/swagger').ApiBodyOptions,
      { schema: unknown }
    >['schema'],
  };
}
@Controller('accounts/me')
@UseGuards(PrincipalGuard)
export class SelfAccountController {
  constructor(
    @Inject(AccountLifecycle) private readonly lifecycle: AccountLifecycle,
    @Inject(IdentityRateLimits) private readonly limits: IdentityRateLimits,
  ) {}
  @Post('disable')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Disable identity access after explicit fresh self proof; retain application data',
  })
  @ApiBody(body(disableInput))
  async disable(
    @CurrentPrincipal() actor: Principal,
    @Body() value: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(disableInput, value),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'self-disable',
      now,
      actor.accountId,
    );
    return this.lifecycle.act(actor, 'disable', input, now);
  }
  @Post('delete')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Delete identity access and metadata; retained tombstones and business cleanup remain explicit',
  })
  @ApiBody(body(deleteInput))
  async delete(
    @CurrentPrincipal() actor: Principal,
    @Body() value: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(deleteInput, value),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'self-delete',
      now,
      actor.accountId,
    );
    return this.lifecycle.act(actor, 'delete', input, now);
  }
}
