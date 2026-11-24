import { DiagnosticReaderService } from '../dist/modules/diagnostics/diagnostic-reader.service.js';
import { RemoteDiagnosticServer } from '../dist/modules/diagnostics/remote-diagnostic-server.js';
import { remoteDiagnosticServerProfileSchema } from '../dist/modules/diagnostics/remote-diagnostic-profile.js';
import { readPrivateDiagnosticProfile } from './diagnostics-private-profile.mjs';

// Standalone read-only backend; process ownership/binding are separate from application lifecycle.
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--profile')
    throw new Error();
  const selected = remoteDiagnosticServerProfileSchema.parse(
    await readPrivateDiagnosticProfile(process.argv[3]),
  );
  const reader = new DiagnosticReaderService(
    selected.evidence,
    selected.grant.environment,
    { sources: selected.sources, grant: selected.grant },
  );
  const server = new RemoteDiagnosticServer(
    reader,
    selected.readToken,
    selected.grant,
  ).createHttpServer();
  server.on('error', () => {
    console.error('REMOTE_DIAGNOSTICS_UNAVAILABLE');
    process.exitCode = 1;
  });
  server.listen(selected.listenPort, '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.once(signal, () => {
      server.close();
      server.closeAllConnections();
    });
} catch {
  console.error('REMOTE_DIAGNOSTICS_SETUP_FAILED');
  process.exitCode = 1;
}
