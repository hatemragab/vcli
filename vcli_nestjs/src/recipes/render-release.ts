import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { file, runtime } from './bundle.js';
import { selection } from './selection.js';

export async function renderReleaseFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const database = selection(config, 'database');
  if (!database) return [];
  const variant = database === 'database.mongodb' ? 'mongodb' : 'postgres';
  const files = await Promise.all(
    [
      'release-types.ts',
      'release-validation.ts',
      'release-coordinator.ts',
      'native-release-store.ts',
      'private-files.ts',
      'sealed-file.ts',
      'native-command.ts',
      'backup-types.ts',
      'backup-validation.ts',
      'backup.service.ts',
      'native-database-url.ts',
      'native-backup.ts',
    ].map((path) => runtime('src/release/' + path, variant)),
  );
  const storage = selection(config, 'storage'),
    reliable = config.capabilities.mail?.options.reliableActions === true;
  const secrets = [
    'database.credentials',
    ...(selection(config, 'auth') === 'auth.local'
      ? ['identity.signing-key-ring']
      : []),
    ...(selection(config, 'auth') === 'auth.firebase'
      ? ['identity.firebase-credential-source']
      : []),
    ...(reliable ? ['mail.delivery-key-ring'] : []),
  ];
  files.push(
    file(
      'src/release/backup-command.ts',
      `import {loadConfig,loadSelectedEnvFile} from '../core/config/load-config.js';
import {selectedReleaseManifest} from '../generated/selected-release.js';
import {BackupService} from './backup.service.js';
import {NativeBackup} from './native-backup.js';
import {readPrivateJson} from './private-files.js';
import {parseBackupProfile} from './backup-validation.js';
try{if(process.argv.length!==2||!process.env.VCLI_BACKUP_PROFILE)throw new Error('INVALID_ARGUMENTS');loadSelectedEnvFile();const config=loadConfig(),profile=parseBackupProfile(await readPrivateJson(process.env.VCLI_BACKUP_PROFILE));${reliable ? "if(Object.keys(config.mailDelivery.keys).some(id=>!profile.policy.historicalMailKeyIds.includes(id)))throw new Error('HISTORICAL_MAIL_KEY_CONTRACT_REQUIRED');" : ''}
const result=await new BackupService(new NativeBackup()).create(config.database.url,selectedReleaseManifest,profile,{localRoots:${storage ? "[{id:'media',path:config.storage.localRoot}]" : '[]'},externalResources:${storage && storage !== 'storage.local' ? `[${JSON.stringify(storage === 'storage.r2' ? 'r2:' : 'aws:')}+config.storage.bucket]` : '[]'},secretSourceRefs:${JSON.stringify(secrets)}});console.log(JSON.stringify(result));}catch{console.error('BACKUP_FAILED_PRIVATE_OPERATOR_REVIEW_REQUIRED');process.exitCode=1;}
`,
    ),
  );
  files.push(
    file(
      'src/release/restore-command.ts',
      `import {BackupService} from './backup.service.js';
import {NativeBackup} from './native-backup.js';
import {readPrivateJson} from './private-files.js';
import {parseRestoreProfile} from './backup-validation.js';
try{if(process.argv.length!==2||!process.env.VCLI_RESTORE_PROFILE)throw new Error('INVALID_ARGUMENTS');const result=await new BackupService(new NativeBackup()).restore(parseRestoreProfile(await readPrivateJson(process.env.VCLI_RESTORE_PROFILE)));console.log(JSON.stringify(result));}catch{console.error('ISOLATED_RESTORE_FAILED_TARGET_MAY_BE_INCOMPLETE');process.exitCode=1;}
`,
    ),
  );
  files.push(
    file(
      'src/release/reconcile-command.ts',
      `import {loadConfig,loadSelectedEnvFile} from '../core/config/load-config.js';
import {ApplicationError} from '../core/errors/application-error.js';
import {selectedReleaseManifest} from '../generated/selected-release.js';
import {ReleaseCoordinator} from './release-coordinator.js';
import {NativeReleaseStore} from './native-release-store.js';
import {readPrivateJson} from './private-files.js';
import {assertQuiescedDecision} from './release-validation.js';
import type {QuiescedReleaseDecision} from './release-types.js';
const configCodes=new Set(['INVALID_CONFIG','ENV_FILE_UNAVAILABLE','UNSAFE_ENV_FILE','RUNTIME_PROVIDER_SELECTION_UNSUPPORTED']);
function report(code:string,next:string){console.log(JSON.stringify({schemaVersion:1,status:'failed',code,next}));}
let store:NativeReleaseStore|undefined;try{if(process.argv.length!==2||!process.env.VCLI_RELEASE_DECISION){report('INVALID_ARGUMENTS','vcli release reconcile');process.exitCode=1;}else{loadSelectedEnvFile();let config:Awaited<ReturnType<typeof loadConfig>>|undefined;try{config=loadConfig();}catch(error){const code=error instanceof ApplicationError&&configCodes.has(error.code)?error.code:'INVALID_CONFIG';report(code,'vcli config check');process.exitCode=1;}if(config){let started=false;try{const decision=await readPrivateJson(process.env.VCLI_RELEASE_DECISION) as QuiescedReleaseDecision;assertQuiescedDecision(decision);store=await NativeReleaseStore.connect(config.database.url);started=true;await new ReleaseCoordinator(store).reconcile(selectedReleaseManifest,decision);console.log(JSON.stringify({schemaVersion:1,status:'completed',code:'RELEASE_RECONCILED',releaseId:selectedReleaseManifest.id}));}catch{report(started?'RELEASE_AMBIGUOUS':'RELEASE_FAILED','vcli release reconcile');process.exitCode=1;}}}}finally{if(store)await store.close();}
`,
    ),
  );
  const guide = await runtime('ops/release/README.md', 'common');
  const migrationExample =
    variant === 'postgres'
      ? `const ddl = 'CREATE TABLE IF NOT EXISTS orders (id uuid PRIMARY KEY)';

export const customMigrations: readonly CustomMigration[] = [{
  component: 'app.orders',
  version: 1,
  digest: createHash('sha256').update(ddl).digest('hex'),
  async apply(database) { await database.pool.query(ddl); },
}];`
      : `const orders = { collection: 'orders', key: { id: 1 }, options: { unique: true } } as const;

export const customMigrations: readonly CustomMigration[] = [{
  component: 'app.orders',
  version: 1,
  digest: createHash('sha256').update(JSON.stringify(orders)).digest('hex'),
  async apply(database) {
    await database.connection.collection(orders.collection).createIndex(orders.key, orders.options);
  },
}];`;
  guide.content += `
## Register a feature migration

Edit the developer-owned \`src/release/custom-migrations.ts\`. For an orders feature,
add \`import { createHash } from 'node:crypto'\` and replace the empty list with:

\`\`\`ts
${migrationExample}
\`\`\`

Use one stable component name per schema owner. Advance its version and digest when
changing the migration. A new version must bring both an empty database and every
supported earlier version to the intended schema while preserving existing data.
For larger migrations, import a named registration from the feature. Keep the
digest tied to all reviewed migration steps, and keep registration modules free of
startup side effects. The existing ledger admits up to 32 selected components.

Build the project and run \`npm exec -- vcli release apply\` before starting the
new app. Startup, reconciliation and backup read the same combined manifest.
`;
  files.push(guide);
  return files;
}
