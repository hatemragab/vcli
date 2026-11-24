import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthStateService } from './health-state.service.js';
@Module({
  controllers: [HealthController],
  providers: [HealthStateService],
  exports: [HealthStateService],
})
export class HealthModule {}
