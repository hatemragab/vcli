import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DiagnosticsMcpService } from '../dist/modules/diagnostics/diagnostics-mcp.service.js';
import { RemoteDiagnosticReader } from '../dist/modules/diagnostics/remote-diagnostic-reader.js';
import { readPrivateDiagnosticProfile } from './diagnostics-private-profile.mjs';

// No environment/credential fallback, dotenv, proxy, application or deployment initialization.
try {
  if (process.argv.length !== 4 || process.argv[2] !== '--profile')
    throw new Error();
  const reader = new RemoteDiagnosticReader(
    await readPrivateDiagnosticProfile(process.argv[3]),
  );
  await new DiagnosticsMcpService(reader).connect(new StdioServerTransport());
} catch {
  console.error('REMOTE_DIAGNOSTICS_SETUP_FAILED');
  process.exitCode = 1;
}
