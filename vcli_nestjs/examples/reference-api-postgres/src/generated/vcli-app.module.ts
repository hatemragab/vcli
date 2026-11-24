import { type DynamicModule, Module } from '@nestjs/common';

// Hand-built reference of a future tool-owned composition file.
@Module({})
export class VcliAppModule {
  static register(features: readonly DynamicModule[]): DynamicModule {
    return { module: VcliAppModule, imports: [...features] };
  }
}
