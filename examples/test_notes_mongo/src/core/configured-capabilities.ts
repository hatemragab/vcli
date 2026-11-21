import type { DynamicModule } from '@nestjs/common';
export type ConfiguredCapabilities = Readonly<
  Partial<
    Record<
      | 'database'
      | 'auth'
      | 'mail'
      | 'storage'
      | 'media'
      | 'notes'
      | 'push'
      | 'realtime'
      | 'diagnostics',
      DynamicModule
    >
  >
>;
