import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApplicationError } from '../../core/errors/application-error.js';
import { CentrifugoConnectionService } from './centrifugo-connection.service.js';
/** Only registered for the Centrifugo profile; private ingress required by runbook. */
@Controller('realtime/centrifugo')
export class CentrifugoProxyController {
  constructor(private readonly connections: CentrifugoConnectionService) {}
  @Post('connect')
  @HttpCode(200)
  connect(
    @Headers('x-centrifugo-proxy-secret')
    secret: unknown,
    @Body()
    body: unknown,
  ): Promise<unknown> {
    return this.connections.connect(secret, body);
  }
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Headers('x-centrifugo-proxy-secret')
    secret: unknown,
    @Body()
    body: unknown,
  ): Promise<unknown> {
    try {
      return await this.connections.refresh(secret, body);
    } catch (error) {
      if (error instanceof ApplicationError && error.status === 503)
        throw new ServiceUnavailableException();
      throw error;
    }
  }
}
