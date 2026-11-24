import { Module, type DynamicModule } from '@nestjs/common';
import { DiagnosticReaderService } from './diagnostic-reader.service.js';
import { SourceEvidenceService } from './source-evidence.service.js';

import { DatabaseDiagnosticsService } from '../../core/diagnostics/database-diagnostics.service.js';
import { InfrastructureDiagnosticsService } from '../../core/diagnostics/infrastructure-diagnostics.service.js';
@Module({})
export class DiagnosticsModule {
  static register(
    diagnostics: SourceEvidenceService,
    reader: DiagnosticReaderService,
    database: DatabaseDiagnosticsService,
    infrastructure: InfrastructureDiagnosticsService,
  ): DynamicModule {
    return {
      module: DiagnosticsModule,
      providers: [
        { provide: SourceEvidenceService, useValue: diagnostics },
        { provide: DiagnosticReaderService, useValue: reader },
        { provide: DatabaseDiagnosticsService, useValue: database },
        { provide: InfrastructureDiagnosticsService, useValue: infrastructure },
      ],
      exports: [
        SourceEvidenceService,
        DiagnosticReaderService,
        DatabaseDiagnosticsService,
        InfrastructureDiagnosticsService,
      ],
    };
  }
}
