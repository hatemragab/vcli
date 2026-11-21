import { Module, type DynamicModule } from '@nestjs/common';
import { DiagnosticReaderService } from './diagnostic-reader.service.js';
import { DiagnosticsMcpService } from './diagnostics-mcp.service.js';
import { DiagnosticsService } from './diagnostics.service.js';
@Module({})
export class DiagnosticsModule {
  static register(
    diagnostics: DiagnosticsService,
    reader: DiagnosticReaderService,
  ): DynamicModule {
    return {
      module: DiagnosticsModule,
      providers: [
        { provide: DiagnosticsService, useValue: diagnostics },
        { provide: DiagnosticReaderService, useValue: reader },
        DiagnosticsMcpService,
      ],
      exports: [
        DiagnosticsService,
        DiagnosticReaderService,
        DiagnosticsMcpService,
      ],
    };
  }
}
