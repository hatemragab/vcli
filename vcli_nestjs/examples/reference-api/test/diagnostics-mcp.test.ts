import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { DiagnosticsMcpService } from '../dist/modules/diagnostics/diagnostics-mcp.service.js';
import { DiagnosticReaderService } from '../dist/modules/diagnostics/diagnostic-reader.service.js';
import { DiagnosticsService } from '../dist/modules/diagnostics/diagnostics.service.js';
test('real MCP SDK exposes only fixed-scope read tools and rejects arbitrary paths/mutations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'reference-mcp-'));
  const config = { directory, maxBytes: 4096, maxFiles: 2 };
  const writer = await DiagnosticsService.open(config, 'test');
  const server = new DiagnosticsMcpService(
    new DiagnosticReaderService(config, 'test'),
  );
  const client = new Client({ name: 'reference-test', version: '0.0.0' });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    writer.record({ event: 'operation.completed', severity: 'info' });
    await writer.flush();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((tool) => tool.name).sort(), [
      'capabilities.list',
      'diagnostics.status',
      'logs.search',
      'operations.timeline',
      'project.describe',
    ]);
    assert.ok(
      list.tools.every((tool) => tool.annotations?.readOnlyHint === true),
    );
    const result = await client.callTool({
      name: 'logs.search',
      arguments: { limit: 10 },
    });
    assert.notEqual(result.isError, true);
    const text = result.content as {
      type: string;
      text?: string;
    }[];
    assert.equal(JSON.parse(text[0]!.text!).events.length, 1);
    const denied = await client.callTool({
      name: 'logs.search',
      arguments: { path: '/etc/passwd', project: 'foreign' },
    });
    assert.equal(denied.isError, true);
    const unknown = await client.callTool({ name: 'deploy', arguments: {} });
    assert.equal(unknown.isError, true);
    const sentinel = 'PRIVATE_CREDENTIAL_DO_NOT_ECHO';
    const sensitiveInput = await client.callTool({
      name: 'logs.search',
      arguments: { [sentinel]: sentinel, severity: sentinel },
    });
    assert.equal(sensitiveInput.isError, true);
    assert.equal(JSON.stringify(sensitiveInput).includes(sentinel), false);
  } finally {
    await client.close();
    await server.close();
    await writer.close();
    await rm(directory, { recursive: true, force: true });
  }
});
