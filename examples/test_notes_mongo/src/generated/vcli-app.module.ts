import { Module, type DynamicModule } from '@nestjs/common';
/** VCLI-owned composition; put custom features in AppCustomModule. */
@Module({})
export class VcliAppModule {
  static register(features: readonly DynamicModule[]): DynamicModule {
    return { module: VcliAppModule, imports: [...features] };
  }
}
