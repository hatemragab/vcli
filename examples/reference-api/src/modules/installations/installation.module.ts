import { Module, type DynamicModule } from '@nestjs/common';
import { InstallationService } from './installation.service.js';
@Module({})
export class InstallationModule {
  static register(service: InstallationService): DynamicModule {
    return {
      module: InstallationModule,
      providers: [{ provide: InstallationService, useValue: service }],
      exports: [InstallationService],
    };
  }
}
