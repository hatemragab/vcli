import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiTags,
  type ApiBodyOptions,
} from '@nestjs/swagger';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { parseInput } from '../../core/http/parse-input.js';
import type { Principal } from '../../core/auth/principal.js';
import { SessionManagement } from './session-management.service.js';
type RequestSchema = Extract<
  ApiBodyOptions,
  {
    schema: unknown;
  }
>['schema'];
const revokeInput = z.discriminatedUnion('scope', [
  z.strictObject({ scope: z.literal('selected'), sessionId: z.uuid() }),
  z.strictObject({
    scope: z.literal('installation'),
    installationId: z.uuid(),
  }),
  z.strictObject({ scope: z.enum(['current', 'others', 'all']) }),
]);
@Controller('sessions')
@UseGuards(PrincipalGuard)
@ApiTags('Sessions')
@ApiBearerAuth()
export class SessionsController {
  constructor(
    @Inject(SessionManagement)
    private readonly sessions: SessionManagement,
  ) {}
  @Get()
  @Header('Cache-Control', 'no-store')
  async list(
    @CurrentPrincipal()
    actor: Principal,
  ) {
    return {
      sessions: await this.sessions.list(actor, Date.now()),
      limit: 100,
    };
  }
  @Get('devices')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List owned installations with active sessions' })
  async devices(@CurrentPrincipal() actor: Principal) {
    return {
      devices: await this.sessions.listDevices(actor, Date.now()),
      limit: 100,
    };
  }
  @Post('revoke')
  @ApiOperation({
    summary: 'Revoke owned sessions, optionally for one installation',
    description:
      'Ownership comes from the verified principal. Non-current scopes require recent authentication. Foreign and missing targets receive the same response.',
  })
  @ApiHeader({
    name: 'X-Session-Token',
    required: false,
    description:
      'Required together with a Firebase ID bearer token in the Firebase profile; leave this header unset for local bearer JWT authentication.',
    schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' },
  })
  @ApiBody({
    required: true,
    description:
      'Use sessionId with selected, or installationId with installation to sign out all active sessions on one owned device.',
    // Zod emits the selected OpenAPI 3.0 target; its declaration also permits other JSON Schema drafts.
    schema: z.toJSONSchema(revokeInput, {
      target: 'openapi-3.0',
      io: 'input',
    }) as RequestSchema,
    examples: {
      current: { summary: 'Revoke this session', value: { scope: 'current' } },
      selected: {
        summary: 'Revoke one owned session',
        value: {
          scope: 'selected',
          sessionId: '00000000-0000-4000-8000-000000000000',
        },
      },
      installation: {
        summary: 'Revoke active sessions on one owned device',
        value: {
          scope: 'installation',
          installationId: '00000000-0000-4000-8000-000000000000',
        },
      },
      others: {
        summary: 'Revoke sibling sessions and preserve the caller',
        value: { scope: 'others' },
      },
      all: {
        summary: 'Revoke every active session, including the caller',
        value: { scope: 'all' },
      },
    },
  })
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async revoke(
    @Body()
    body: unknown,
    @CurrentPrincipal()
    actor: Principal,
  ) {
    const input = parseInput(revokeInput, body);
    await this.sessions.revoke(
      actor,
      input.scope,
      input.scope === 'selected'
        ? input.sessionId
        : input.scope === 'installation'
          ? input.installationId
          : undefined,
      Date.now(),
    );
    return { status: 'revoked' };
  }
}
