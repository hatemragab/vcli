import { Injectable, Inject } from '@nestjs/common';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { ApplicationError } from '../../core/errors/application-error.js';
import type { DiagnosticReader } from './diagnostic-reader.js';
import { DiagnosticReaderService } from './diagnostic-reader.service.js';
import {
  diagnosticQueries,
  executeDiagnosticQuery,
} from './diagnostic-query.js';

/** Same finite read-only tools for local stdio and explicitly configured remote readers. */
@Injectable()
export class DiagnosticsMcpService extends Server {
  constructor(@Inject(DiagnosticReaderService) reader: DiagnosticReader) {
    super(
      { name: 'generated-api-diagnostics', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );
    const tools = diagnosticQueries.map((specification) =>
      ToolSchema.parse({
        name: specification.name,
        description: specification.description,
        inputSchema: z.toJSONSchema(specification.schema),
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: false,
        },
      }),
    );
    this.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    this.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        const value = await executeDiagnosticQuery(
          reader,
          request.params.name,
          request.params.arguments ?? {},
        );
        return { content: [{ type: 'text', text: JSON.stringify(value) }] };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                error:
                  error instanceof ApplicationError
                    ? error.code
                    : 'DIAGNOSTICS_UNAVAILABLE',
              }),
            },
          ],
        };
      }
    });
  }
}
