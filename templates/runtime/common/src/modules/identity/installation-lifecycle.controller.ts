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
import { InstallationLifecycle } from './installation-lifecycle.service.js';
const capability = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/u);
const inputSchema = z.strictObject({
  confirm: z.literal('rotate-installation'),
  installationCapability: capability,
  newInstallationCapability: capability,
  password: z.string().min(12).max(128).optional(),
  idToken: z.string().min(1).max(16384).optional(),
});
@Controller('identity/installations')
@UseGuards(PrincipalGuard)
export class InstallationLifecycleController {
  constructor(
    @Inject(InstallationLifecycle)
    private readonly lifecycle: InstallationLifecycle,
    @Inject(IdentityRateLimits) private readonly limits: IdentityRateLimits,
  ) {}
  @Post('rotate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary:
      'Rotate proved installation possession after fresh user authentication; revoke prior-generation sessions',
  })
  @ApiBody({
    required: true,
    schema: z.toJSONSchema(inputSchema, {
      target: 'openapi-3.0',
      io: 'input',
    }) as Extract<
      import('@nestjs/swagger').ApiBodyOptions,
      { schema: unknown }
    >['schema'],
  })
  async rotate(
    @CurrentPrincipal() actor: Principal,
    @Body() value: unknown,
    @Req() request: Request,
  ) {
    const input = parseInput(inputSchema, value),
      now = Date.now();
    await rateRequest(
      this.limits,
      request,
      'installation-rotation',
      now,
      actor.accountId,
    );
    return this.lifecycle.rotate(
      actor,
      input,
      input.installationCapability,
      input.newInstallationCapability,
      now,
    );
  }
}
