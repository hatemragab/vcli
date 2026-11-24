import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { HealthStateService } from './health-state.service.js';
import { buildId } from '../../core/build/build-metadata.js';
@Controller('health')
export class HealthController {
  constructor(private readonly state: HealthStateService) {}
  @Get('live') live() {
    return { status: 'alive' };
  }
  @Get('ready') ready() {
    if (!this.state.ready()) throw new ServiceUnavailableException();
    return {
      status: 'ready',
      buildId,
      ...this.state.facts(),
      scope: 'initialized-application',
      externalAcceptance: 'not-established',
    };
  }
}
