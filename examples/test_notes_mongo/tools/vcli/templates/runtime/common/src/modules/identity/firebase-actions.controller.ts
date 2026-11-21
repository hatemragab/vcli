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
import { ApiBody, ApiOperation } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import type { Principal } from '../../core/auth/principal.js';
import { parseInput } from '../../core/http/parse-input.js';
import { FirebaseActions } from './firebase-actions.service.js';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { rateRequest } from './rate-request.js';
const verifyInput = z.strictObject({ idToken: z.string().min(1).max(16384) });
const resetInput = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
});
function body(schema: typeof verifyInput | typeof resetInput) {
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
@Controller('identity/firebase/actions')
export class FirebaseActionsController {
  constructor(
    @Inject(FirebaseActions) private readonly actions: FirebaseActions,
    @Inject(IdentityRateLimits) private readonly limits: IdentityRateLimits,
  ) {}
  @Post('verification/request')
  @UseGuards(PrincipalGuard)
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Queue a Firebase verification link for the recently verified current subject',
  })
  @ApiBody(body(verifyInput))
  async verification(
    @CurrentPrincipal() actor: Principal,
    @Body() value: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(verifyInput, value),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'firebase-verification',
      now,
      actor.accountId,
    );
    return this.actions.verification(actor, input.idToken, now);
  }
  @Post('reset/request')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Request an application-delivered Firebase reset link; public result is enumeration-safe',
  })
  @ApiBody(body(resetInput))
  async reset(@Body() value: unknown, @Req() request: Request) {
    const input = parseInput(resetInput, value),
      now = Date.now();
    await rateRequest(this.limits, request, 'firebase-reset', now, input.email);
    return this.actions.reset(input.email, now);
  }
}
