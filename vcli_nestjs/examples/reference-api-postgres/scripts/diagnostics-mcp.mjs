import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { DiagnosticsMcpService } from '../dist/modules/diagnostics/diagnostics-mcp.service.js';
import { DiagnosticReaderService } from '../dist/modules/diagnostics/diagnostic-reader.service.js';

// Operator configuration only. No dotenv, deployment credential or application SDK initialization.
const environment = process.env.NODE_ENV ?? 'development';
if (!['development', 'test', 'production'].includes(environment))
  throw new Error('INVALID_ENVIRONMENT');
const maxBytes = Number(process.env.EVIDENCE_MAX_BYTES ?? 1048576);
const maxFiles = Number(process.env.EVIDENCE_MAX_FILES ?? 3);
if (
  !Number.isSafeInteger(maxBytes) ||
  maxBytes < 512 ||
  maxBytes > 10485760 ||
  !Number.isSafeInteger(maxFiles) ||
  maxFiles < 1 ||
  maxFiles > 10
)
  throw new Error('INVALID_EVIDENCE_LIMITS');
const reader = new DiagnosticReaderService(
  {
    directory: process.env.EVIDENCE_DIRECTORY ?? 'var/evidence',
    maxBytes,
    maxFiles,
  },
  environment,
);
const server = new DiagnosticsMcpService(reader);
await server.connect(new StdioServerTransport());
