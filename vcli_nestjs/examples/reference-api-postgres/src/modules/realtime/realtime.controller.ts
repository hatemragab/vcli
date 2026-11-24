import {
  Controller,
  Get,
  Header,
  Inject,
  Post,
  UseGuards,
} from '@nestjs/common';
import type { AppConfig } from '../../core/config/app-config.js';
import { CurrentPrincipal } from '../../core/http/current-principal.decorator.js';
import { PrincipalGuard } from '../../core/http/principal.guard.js';
import type { Principal } from '../../core/auth/principal.js';
import { ApplicationError } from '../../core/errors/application-error.js';
import { RealtimeTicketService } from './realtime-ticket.service.js';

export const REALTIME_CONFIG = Symbol('RealtimeConfig');

@Controller('realtime')
@UseGuards(PrincipalGuard)
export class RealtimeController {
  constructor(
    @Inject(REALTIME_CONFIG) private readonly config: AppConfig,
    private readonly tickets: RealtimeTicketService,
  ) {}

  @Get('profile')
  profile(): unknown {
    return {
      driver: this.config.realtime.driver,
      path: this.config.realtime.path,
      scale: 'single-instance',
      recovery: 'GET /api/notes after admission/reconnect or any missed hint',
      maxPayloadBytes: this.config.realtime.maxPayloadBytes,
    };
  }

  @Post('tickets')
  @Header('Cache-Control', 'no-store')
  ticket(@CurrentPrincipal() principal: Principal): Promise<unknown> {
    if (this.config.realtime.driver !== 'ws')
      throw new ApplicationError('UNSUPPORTED_REALTIME_PROFILE', 409);
    return this.tickets.issue(principal, 'ws');
  }

  @Post('centrifugo-grants')
  @Header('Cache-Control', 'no-store')
  grant(@CurrentPrincipal() principal: Principal): Promise<unknown> {
    if (this.config.realtime.driver !== 'centrifugo')
      throw new ApplicationError('UNSUPPORTED_REALTIME_PROFILE', 409);
    return this.tickets.issue(principal, 'centrifugo');
  }
}
