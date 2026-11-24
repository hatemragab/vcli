import { loadConfig, loadSelectedEnvFile } from './core/config/load-config.js';
import { DiagnosticReaderService } from './modules/diagnostics/diagnostic-reader.service.js';
function emit(value: Record<string, unknown>) {
  console.log(JSON.stringify(value));
}
function flag(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
const args = process.argv.slice(2);
try {
  loadSelectedEnvFile();
  const config = loadConfig();
  const reader = new DiagnosticReaderService(
    config.diagnostics,
    config.environment,
    { sources: config.diagnostics.sources },
  );
  if (args[0] === 'status') {
    const status = await reader.status();
    emit({
      schemaVersion: 1,
      status: 'completed',
      retainedFiles: status.retainedFiles,
      retainedBytes: status.retainedBytes,
      sources: [...status.sources],
      unavailableSources: [...status.unavailableSources],
      gaps: ['retention-before-snapshot-unknown'],
    });
  } else if (args[0] === 'query') {
    const requestId = flag(args, '--request-id');
    const operationId = flag(args, '--operation-id');
    const page = await reader.search({
      ...(requestId ? { requestId } : {}),
      ...(operationId ? { operationId } : {}),
      limit: 50,
    });
    emit({
      schemaVersion: 1,
      status: 'completed',
      truncated: page.truncated,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      sources: [...page.coverage.sources],
      unavailableSources: [...page.coverage.unavailableSources],
      gaps: [...page.coverage.gaps],
      events: page.events
        .slice(0, 50)
        .map((event) => ({
          timestamp: event.timestamp,
          event: event.event,
          severity: event.severity,
          requestId: event.requestId,
          operationId: event.operationId,
          statusCode: event.statusCode,
          errorCode: event.errorCode,
          route: event.route,
          method: event.method,
          source: event.source,
          stage: event.stage,
        })),
    });
  } else {
    emit({
      schemaVersion: 1,
      status: 'failed',
      code: 'INVALID_LOG_QUERY',
      next: 'vcli logs status',
    });
    process.exitCode = 1;
  }
} catch {
  emit({
    schemaVersion: 1,
    status: 'failed',
    code: 'LOG_QUERY_FAILED',
    next: 'vcli logs status',
  });
  process.exitCode = 1;
}
