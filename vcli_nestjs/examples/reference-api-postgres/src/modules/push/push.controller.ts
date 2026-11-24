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
  ApiTags,
} from '@nestjs/swagger';
import { createHash, randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { z } from 'zod';
import { parseInput } from '../../core/http/parse-input.js';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { Principal } from '../../core/auth/principal.js';
import { PushService } from './push.service.js';
import { destinationProjection } from './push.entity.js';

export const PUSH_SCOPE = Symbol('PushScope');
const purpose = z.enum(['ordinary', 'background', 'voip']);
const registration = z
  .object({
    purpose,
    platform: z.enum(['android', 'ios', 'web']),
    token: z
      .string()
      .min(16)
      .max(2048)
      .regex(/^[^\s\p{Cc}]+$/u),
  })
  .strict();
const removal = z.object({ generation: z.uuid() }).strict();
const notification = z
  .object({
    purpose,
    title: z.string().min(1).max(100).optional(),
    body: z.string().min(1).max(500).optional(),
    data: z
      .record(
        z
          .string()
          .regex(/^[a-zA-Z][a-zA-Z0-9_]{0,31}$/)
          .refine((key) => !/^(from|gcm|google|aps|operationId)/i.test(key)),
        z.string().max(500),
      )
      .default({}),
    ttlSeconds: z.number().int().min(1).max(300).default(60),
  })
  .strict();

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
    @Inject(PushService) private readonly service: PushService,
    @Inject(PUSH_SCOPE) private readonly scope: string,
  ) {}

  @Post('destinations')
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
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
  ) {
    const input = parseInput(registration, body);
    const destination = await this.service.register(principal, {
      ...input,
      id: randomUUID(),
      generation: randomUUID(),
      scope: this.scope,
      tokenHash: createHash('sha256').update(input.token).digest('hex'),
      now: Date.now(),
    });
    return destinationProjection(destination);
  }

  @Get('destinations')
  async list(@CurrentPrincipal() principal: Principal) {
    return {
      destinations: (await this.service.list(principal)).map(
        destinationProjection,
      ),
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
    @CurrentPrincipal() principal: Principal,
    @Param('id') id: string,
    @Body() body: unknown,
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
    @CurrentPrincipal() principal: Principal,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
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
    if (
      input.purpose === 'voip' &&
      (!input.data.callId || input.title || input.body)
    )
      throw new ApplicationError('VOIP_REQUIRES_CALL_ID', 400);
    if (input.purpose === 'voip')
      throw new ApplicationError('VOIP_REQUIRES_AUTHORIZED_CALL', 403);
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
      results: await this.service.notifyAccount(
        principal.accountId,
        {
          operationId,
          purpose: input.purpose,
          title: input.title,
          body: input.body,
          data: input.data,
          expiresAt: now + input.ttlSeconds * 1000,
        },
        now,
        principal.installationId,
      ),
    };
  }
}
