import type { DiagnosticEventInput } from '../../core/diagnostics/diagnostic-events.js';
export type DiagnosticRecord = DiagnosticEventInput &
  Readonly<{
    version: 1;
    project: 'test_notes_mongo';
    service: 'test_notes_mongo';
    environment: 'development' | 'test' | 'production';
    timestamp: string;
    writerId: string;
    sequence: number;
  }>;
export type DiagnosticPage = Readonly<{
  events: readonly DiagnosticRecord[];
  cursor?: string;
  truncated: boolean;
  coverage: Readonly<{
    sources: readonly string[];
    unavailableSources: readonly string[];
    gaps: readonly string[];
    scannedBytes: number;
    ingestionDelayMs: number | null;
    latestEventAgeMs: number | null;
    retention: string;
    sourceCoverage?: readonly Readonly<{
      source: string;
      parsed: number;
      rejected: number;
      firstTimestamp: string | null;
      lastTimestamp: string | null;
    }>[];
  }>;
}>;
export type DiagnosticStatus = Readonly<{
  scope: Readonly<{
    project: string;
    environment: string;
  }>;
  retainedFiles: number;
  retainedBytes: number;
  sources: readonly string[];
  unavailableSources: readonly string[];
  trust: string;
}>;
export interface DiagnosticReader {
  search(input: unknown): Promise<DiagnosticPage>;
  status(): Promise<DiagnosticStatus>;
  getTestResult(input: unknown): Promise<DiagnosticPage>;
}
