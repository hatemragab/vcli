import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get('live')
  @ApiOperation({ summary: 'Process liveness only' })
  live() {
    return { status: 'alive' };
  }
  @Get('ready')
  @ApiOperation({
    summary:
      'Local application initialization; external delivery is separately verified',
  })
  ready() {
    return {
      status: 'ready',
      scope: 'initialized-application',
      externalProviderAcceptance: 'pending',
    };
  }
}
