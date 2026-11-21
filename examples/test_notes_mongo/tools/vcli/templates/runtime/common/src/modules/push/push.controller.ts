import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiParam,
  ApiResponse,
  type ApiResponseSchemaHost,
  ApiTags,
} from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { parseInput } from '../../core/http/parse-input.js';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import { PushService } from './push.service.js';
import { pushRegistration, pushData } from './push-validation.js';
export const PUSH_SCOPE = Symbol('PushScope');
const purpose = z.enum(['ordinary', 'background']);
const registration = pushRegistration;
const removal = z.object({ generation: z.uuid() }).strict();
const notification = z
  .object({
    purpose,
    title: z.string().min(1).max(100).optional(),
    body: z.string().min(1).max(500).optional(),
    data: pushData.default({}),
    ttlSeconds: z.number().int().min(1).max(300).default(60),
  })
  .strict();
const destinationSummary: ApiResponseSchemaHost['schema'] = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'installationId',
    'installationGeneration',
    'generation',
    'environment',
    'provider',
    'purpose',
    'platform',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', format: 'uuid' },
    installationId: { type: 'string' },
    installationGeneration: {
      type: 'integer',
      minimum: 1,
      description: 'Verified installation binding generation.',
    },
    generation: {
      type: 'string',
      format: 'uuid',
      description:
        'Server-generated exact token revision; required for removal.',
    },
    environment: { type: 'string', enum: ['sandbox', 'production'] },
    provider: { type: 'string', enum: ['fcm', 'apns'] },
    purpose: { type: 'string', enum: ['ordinary', 'background', 'voip'] },
    platform: { type: 'string', enum: ['android', 'ios', 'web'] },
    updatedAt: { type: 'integer', minimum: 0 },
  },
};
@Controller('push')
@ApiTags('push')
@ApiBearerAuth()
@ApiHeader({
  name: 'X-Session-Token',
  required: false,
  description:
    'Opaque application-session secret required with Firebase ID tokens; omit for local access JWTs.',
})
@UseGuards(PrincipalGuard)
export class PushController {
  constructor(
    @Inject(PushService)
    private readonly service: PushService,
    @Inject(PUSH_SCOPE)
    private readonly scope: string,
  ) {}
  @Post('destinations')
  @ApiResponse({
    status: 201,
    schema: destinationSummary,
    description:
      'Safe destination summary. Server supplies stable id, current installationGeneration, new generation UUID and selected environment. Re-registration rotates token generation. No raw token, hash, session or account is returned.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['purpose', 'platform', 'token'],
      properties: {
        purpose: {
          type: 'string',
          enum: ['ordinary', 'background', 'voip'],
          description:
            'Selected purpose routing must have a configured provider.',
        },
        platform: {
          type: 'string',
          enum: ['android', 'ios', 'web'],
          description: 'APNs purposes require ios.',
        },
        token: {
          type: 'string',
          minLength: 16,
          maxLength: 2048,
          writeOnly: true,
          description:
            'Secret provider token, not returned. APNs uses lowercase hexadecimal without spaces/brackets.',
        },
      },
    },
  })
  async register(
    @CurrentPrincipal()
    principal: Principal,
    @Body()
    body: unknown,
  ) {
    const input = parseInput(registration, body);
    const destination = await this.service.register(principal, {
      ...input,
      scope: this.scope,
      now: Date.now(),
    });
    return destination;
  }
  @Get('destinations')
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      required: ['destinations'],
      properties: {
        destinations: {
          type: 'array',
          maxItems: 32,
          items: destinationSummary,
        },
      },
    },
    description:
      'Only this authorized installation generation. Safe destination summaries include id, installationId, installationGeneration (positive integer), generation (UUID token revision), environment (sandbox or production), provider, purpose, platform and updatedAt; no account/session/token/hash.',
  })
  async list(
    @CurrentPrincipal()
    principal: Principal,
  ) {
    return {
      destinations: await this.service.list(principal),
    };
  }
  @Delete('destinations/:id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['generation'],
      properties: {
        generation: {
          type: 'string',
          format: 'uuid',
          description:
            'Exact generation from the safe registration/list projection.',
        },
      },
    },
  })
  async remove(
    @CurrentPrincipal()
    principal: Principal,
    @Param('id')
    id: string,
    @Body()
    body: unknown,
  ) {
    const input = parseInput(removal, body);
    return {
      removed: await this.service.remove(
        principal,
        parseInput(z.uuid(), id),
        input.generation,
      ),
    };
  }
  /** Review-only action bound to this installation; there is no arbitrary-recipient send API. */
  @Post('self')
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['purpose'],
      properties: {
        purpose: {
          type: 'string',
          enum: ['ordinary', 'background'],
          description:
            'Ordinary needs title or body; background forbids both. VoIP requires an authorized application call and is refused on this review route.',
        },
        title: { type: 'string', minLength: 1, maxLength: 100 },
        body: { type: 'string', minLength: 1, maxLength: 500 },
        data: {
          type: 'object',
          maxProperties: 12,
          additionalProperties: { type: 'string', maxLength: 500 },
          description:
            'Small opaque references; reserved provider keys are forbidden and total input is limited to 2048 bytes.',
        },
        ttlSeconds: { type: 'integer', minimum: 1, maximum: 300, default: 60 },
      },
    },
  })
  async self(
    @CurrentPrincipal()
    principal: Principal,
    @Body()
    body: unknown,
    @Res({ passthrough: true })
    response: Response,
  ) {
    const input = parseInput(notification, body);
    if (
      Object.keys(input.data).length > 12 ||
      Buffer.byteLength(JSON.stringify(input)) > 2048
    )
      throw new ApplicationError('PUSH_PAYLOAD_TOO_LARGE', 413);
    if (input.purpose === 'background' && (input.title || input.body))
      throw new ApplicationError('BACKGROUND_PUSH_HAS_ALERT', 400);
    if (input.purpose === 'ordinary' && !input.title && !input.body)
      throw new ApplicationError('ORDINARY_PUSH_REQUIRES_ALERT', 400);
    const now = Date.now();
    const suppliedOperation = z
      .uuid()
      .safeParse(response.getHeader('X-Operation-Id'));
    const operationId = suppliedOperation.success
      ? suppliedOperation.data
      : randomUUID();
    response.setHeader('X-Operation-Id', operationId);
    return {
      operationId,
      results: await this.service.notifySelf(
        principal,
        {
          operationId,
          purpose: input.purpose,
          title: input.title,
          body: input.body,
          data: input.data,
          expiresAt: now + input.ttlSeconds * 1000,
        },
        now,
      ),
    };
  }
}
