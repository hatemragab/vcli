import { randomUUID } from 'node:crypto';
import {
  loadConfig,
  loadSelectedEnvFile,
} from '../dist/core/config/load-config.js';
import { initializeIdentityDatabase } from '../dist/initialize-identity-database.js';
import { initializeCapabilitySchemas } from '../dist/modules/media/media.module.js';
import { createNotesRuntime } from '../dist/modules/notes/notes.module.js';
import type { PrincipalAuthority } from '../dist/core/auth/principal-authority.js';
import type { EventPublisher } from '../dist/core/realtime/event-publisher.js';

loadSelectedEnvFile();
const config = loadConfig();
const authority: PrincipalAuthority = {
  async verify() {
    throw new Error('SCHEMA_SETUP_HAS_NO_AUTHORITY');
  },
  async current() {
    throw new Error('SCHEMA_SETUP_HAS_NO_AUTHORITY');
  },
};
const publisher: EventPublisher = {
  async publish() {
    throw new Error('SCHEMA_SETUP_CANNOT_PUBLISH');
  },
};
try {
  await initializeIdentityDatabase(config);
  await initializeCapabilitySchemas(config);
  const notes = await createNotesRuntime(config, authority, publisher, {
    schemaSetup: true,
  });
  try {
    await notes.migrate();
  } finally {
    await notes.close();
  }
  console.info(
    JSON.stringify({
      operationId: randomUUID(),
      stage: 'schema-setup',
      database: config.database.driver,
      result: 'passed',
    }),
  );
} catch {
  console.error(JSON.stringify({ stage: 'schema-setup', result: 'failed' }));
  process.exitCode = 1;
}
