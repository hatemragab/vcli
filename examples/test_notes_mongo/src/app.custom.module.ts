import { Module, type DynamicModule } from '@nestjs/common';
import type { ConfiguredCapabilities } from './core/configured-capabilities.js';
// Developer-owned: pass configured exported modules to your own consumer modules.
@Module({})
export class AppCustomModule {
  static register(_capabilities: ConfiguredCapabilities): DynamicModule {
    return { module: AppCustomModule, imports: [] };
  }
}
