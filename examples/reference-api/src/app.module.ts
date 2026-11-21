import { type DynamicModule, Module } from '@nestjs/common';
import { AppCustomModule } from './app.custom.module.js';
import { VcliAppModule } from './generated/vcli-app.module.js';
import type { AppConfig } from './core/config/app-config.js';
import { HealthController } from './modules/health/health.controller.js';
import { ReviewController } from './modules/review/review.controller.js';
import { REFERENCE_CONFIG } from './modules/review/review.tokens.js';
@Module({})
export class AppModule {
  static register(
    config: AppConfig,
    features: readonly DynamicModule[],
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [VcliAppModule.register(features), AppCustomModule],
      controllers: [HealthController, ReviewController],
      providers: [{ provide: REFERENCE_CONFIG, useValue: config }],
    };
  }
}
