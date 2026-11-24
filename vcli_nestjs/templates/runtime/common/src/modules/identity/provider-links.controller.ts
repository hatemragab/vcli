import { Req } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityRateLimits } from './identity-rate-limits.service.js';
import { rateRequest } from './rate-request.js';
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
import { ProviderLinks } from './provider-links.service.js';
const idToken = z.string().min(1).max(16384);
const linkInput = z.strictObject({
  confirm: z.literal('link'),
  idToken,
  targetIdToken: idToken,
});
const unlinkInput = z.strictObject({
  confirm: z.literal('unlink'),
  idToken,
  targetIdToken: idToken,
  method: z.enum(['password', 'phone', 'google.com', 'apple.com']),
});
function body(schema: typeof linkInput | typeof unlinkInput) {
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
@Controller('identity/firebase/providers')
@UseGuards(PrincipalGuard)
export class ProviderLinksController {
  constructor(
    @Inject(ProviderLinks) private readonly links: ProviderLinks,
    @Inject(IdentityRateLimits) private readonly limits: IdentityRateLimits,
  ) {}
  @Post('link')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Record a verified provider binding; never merge by email',
  })
  @ApiBody(body(linkInput))
  async link(
    @CurrentPrincipal() actor: Principal,
    @Body() value: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(linkInput, value),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'provider-link',
      now,
      actor.accountId,
    );
    return this.links.link(
      actor,
      { idToken: input.idToken },
      input.targetIdToken,
      now,
    );
  }
  @Post('unlink')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Unlink an ownership-proven provider method while preserving recovery',
  })
  @ApiBody(body(unlinkInput))
  async unlink(
    @CurrentPrincipal() actor: Principal,
    @Body() value: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(unlinkInput, value),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'provider-unlink',
      now,
      actor.accountId,
    );
    return this.links.unlink(
      actor,
      { idToken: input.idToken },
      input.targetIdToken,
      input.method,
      now,
    );
  }
}
