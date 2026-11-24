import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
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
  refresh(
    @Headers('x-centrifugo-proxy-secret')
    secret: unknown,
    @Body()
    body: unknown,
  ): Promise<unknown> {
    return this.connections.refresh(secret, body);
  }
}
