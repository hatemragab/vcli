import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  evidenceByteBounds,
  evidenceFileBounds,
  validEvidenceLimits,
} from '../dist/core/diagnostics/evidence-bounds.js';
import { DiagnosticsMcpService } from '../dist/modules/diagnostics/diagnostics-mcp.service.js';
import { DiagnosticReaderService } from '../dist/modules/diagnostics/diagnostic-reader.service.js';

// Operator configuration only. No dotenv, deployment credential or application SDK initialization.
const environment = process.env.NODE_ENV ?? 'development';
if (!['development', 'test', 'production'].includes(environment))
  throw new Error('INVALID_ENVIRONMENT');
const maxBytes = Number(
  process.env.EVIDENCE_MAX_BYTES ?? evidenceByteBounds.fallback,
);
const maxFiles = Number(
  process.env.EVIDENCE_MAX_FILES ?? evidenceFileBounds.fallback,
);
if (!validEvidenceLimits({ maxBytes, maxFiles }))
  throw new Error('INVALID_EVIDENCE_LIMITS');
const reader = new DiagnosticReaderService(
  {
    directory: process.env.EVIDENCE_DIRECTORY ?? 'var/evidence',
    maxBytes,
    maxFiles,
    ...(process.env.EVIDENCE_MAX_AGE_MS
      ? { maxAgeMs: Number(process.env.EVIDENCE_MAX_AGE_MS) }
      : {}),
  },
  environment,
  { sources: (process.env.EVIDENCE_SOURCES ?? 'application').split(',') },
);
const server = new DiagnosticsMcpService(reader);
await server.connect(new StdioServerTransport());
