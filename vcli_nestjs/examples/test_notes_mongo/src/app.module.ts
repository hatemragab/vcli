import { Module, type DynamicModule } from '@nestjs/common';
import { AppCustomModule } from './app.custom.module.js';
import { VcliAppModule } from './generated/vcli-app.module.js';
import type { ConfiguredCapabilities } from './core/configured-capabilities.js';
@Module({})
export class AppModule {
  static register(
    features: readonly DynamicModule[],
    capabilities: ConfiguredCapabilities,
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        VcliAppModule.register(features),
        AppCustomModule.register(capabilities),
      ],
    };
  }
}
