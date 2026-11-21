import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CONFIG_ERROR_CODES,
  type ProjectConfig,
  type RenderedFile,
} from '../contracts.js';
import { file } from './bundle.js';
import { selection } from './selection.js';

/** Only explicit bundled technical migrations are hashed, never private env or keys. */
function contributionDigest(paths: readonly string[]): string {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash.update(path + '\0');
    try {
      hash.update(
        readFileSync(
          new URL('../../templates/runtime/' + path, import.meta.url),
        ),
      );
    } catch (error) {
      // Match runtime()'s curated variant/common fallback; location-only dedup preserves the digest.
      if (
        !error ||
        typeof error !== 'object' ||
        !('code' in error) ||
        error.code !== 'ENOENT' ||
        !/^(mongodb|postgres)\/src\//.test(path)
      )
        throw error;
      hash.update(
        readFileSync(
          new URL(
            '../../templates/runtime/' +
              path.replace(/^(mongodb|postgres)\//, 'common/'),
            import.meta.url,
          ),
        ),
      );
    }
    hash.update('\0');
  }
  return hash.digest('hex');
}

/** Finite selected-owner composition; customized migrations need deliberate developer registration. */
export function schemaFiles(config: ProjectConfig): RenderedFile[] {
  const database = selection(config, 'database');
  if (!database) return [];
  const variant = database === 'database.mongodb' ? 'mongodb' : 'postgres';
  const native = variant === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase';
  const nativeFile =
    variant === 'mongodb' ? 'mongo-database' : 'postgres-database';
  const auth = Boolean(selection(config, 'auth'));
  const mail = config.capabilities.mail?.options.reliableActions === true;
  const notes = selection(config, 'notes') === 'example.notes';
  const media = Boolean(selection(config, 'media'));
  const push = Boolean(
    selection(config, 'push-fcm') || selection(config, 'push-apns'),
  );
  const realtime = selection(config, 'realtime');
  const scale = String(
    config.capabilities.realtime?.options.scale ?? 'single-instance',
  );
  if (
    realtime &&
    (![
      'realtime.socket-io',
      'realtime.native-ws',
      'realtime.centrifugo',
    ].includes(realtime) ||
      !['single-instance', 'cluster'].includes(scale) ||
      (realtime === 'realtime.native-ws' && scale === 'cluster'))
  )
    throw new Error('UNSUPPORTED_REALTIME_RELEASE_PROFILE');
  const realtimeComponent = realtime ? realtime + '.' + scale : undefined;
  const socketCluster =
    realtime === 'realtime.socket-io' && scale === 'cluster';
  const components: { component: string; version: number; digest: string }[] =
    [];
  const add = (component: string, version: number, paths: readonly string[]) =>
    components.push({ component, version, digest: contributionDigest(paths) });
  if (auth)
    add('identity', 2, [
      `${variant}/src/initialize-identity-database.ts`,
      ...(variant === 'postgres'
        ? [
            'postgres/migrations/001-identity.sql',
            'postgres/migrations/002-identity-lifecycle.sql',
          ]
        : [
            'accounts/account.entity.ts',
            'identity/identity.entity.ts',
            'identity/provider-cleanup.entity.ts',
            'installations/installation.entity.ts',
            'sessions/session.entity.ts',
            'identity/identity-lifecycle-migration.ts',
            'installations/installation-lifecycle-migration.ts',
            'sessions/session-lifecycle-migration.ts',
          ].map((path) => 'mongodb/src/modules/' + path)),
    ]);
  if (mail)
    add('mail', 1, [
      `${variant}/src/modules/mail/initialize-mail.ts`,
      `${variant}/src/modules/mail/mail-intent.entity.ts`,
    ]);
  if (media)
    add('media', 1, [
      variant === 'mongodb'
        ? 'common/src/modules/media/mongo-media-state-store.ts'
        : 'postgres/src/modules/media/postgres-media-state-store.ts',
      `${variant}/src/modules/media/media.entity.ts`,
      `${variant}/src/modules/media/media-storage-mapping.ts`,
    ]);
  if (push)
    add('push', 1, [
      `${variant}/src/modules/push/${variant === 'mongodb' ? 'mongo' : 'postgres'}-push-state-store.ts`,
      'common/src/modules/push/push.entity.ts',
      'common/src/modules/push/push-storage-mapping.ts',
    ]);
  if (notes)
    add('notes', 1, [
      `${variant}/src/modules/notes/initialize-notes.ts`,
      `${variant}/src/modules/notes/notes.entity.ts`,
    ]);
  if (realtime)
    add(realtimeComponent!, 1, [
      `${variant}/src/modules/realtime/initialize-realtime.ts`,
      'common/src/modules/realtime/realtime-records.ts',
      ...(socketCluster
        ? [`${variant}/src/modules/realtime/initialize-socket-io-cluster.ts`]
        : []),
    ]);
  const id =
    'selected-v1-' +
    createHash('sha256')
      .update(JSON.stringify({ variant, components }))
      .digest('hex')
      .slice(0, 24);
  const imports = [
    "import type {AppConfig} from '../core/config/app-config.js';",
    "import {NativeReleaseStore} from '../release/native-release-store.js';",
    "import {ReleaseCoordinator} from '../release/release-coordinator.js';",
    "import {customMigrations} from '../release/custom-migrations.js';",
    "import {openDatabase} from '../core/database/database.js';",
    "import {selectedReleaseManifest} from './selected-release.js';",
    ...(auth
      ? [
          "import {initializeIdentityDatabase} from '../initialize-identity-database.js';",
        ]
      : []),
    ...(mail
      ? ["import {initializeMail} from '../modules/mail/initialize-mail.js';"]
      : []),
    ...(media
      ? [
          "import {initializeMediaSchema} from '../modules/media/media.module.js';",
        ]
      : []),
    ...(push
      ? ["import {initializePushSchema} from '../modules/push/push.module.js';"]
      : []),
    ...(notes
      ? [
          "import {initializeNotes} from '../modules/notes/initialize-notes.js';",
        ]
      : []),
    ...(realtime
      ? [
          "import {initializeRealtime} from '../modules/realtime/initialize-realtime.js';",
        ]
      : []),
  ];
  return [
    file(
      'src/release/custom-migrations.ts',
      `import type {${native}} from '../core/database/${nativeFile}.js';
import type {ReleaseComponent} from './release-types.js';

export type CustomMigration = ReleaseComponent & Readonly<{
  component: \`app.\${string}\`;
  apply(database: ${native}): Promise<void>;
}>;

/**
 * Register one entry per schema owner in dependency order. Use a stable app.* name,
 * a positive version and a SHA-256 digest of the reviewed migration steps.
 * Each new version must migrate both fresh and previously supported schemas.
 * The runner owns the database connection. See ops/release/README.md.
 */
export const customMigrations: readonly CustomMigration[] = [];
`,
      'scaffold',
    ),
    file(
      'src/generated/selected-release.ts',
      `import type {${native}} from '../core/database/${nativeFile}.js';
import type {ReleaseManifest} from '../release/release-types.js';
import {readNativeReleaseLedger} from '../release/native-release-store.js';
import {assertLedgerReady,releaseDigest} from '../release/release-validation.js';
import {customMigrations} from '../release/custom-migrations.js';
const builtInRelease:ReleaseManifest=${JSON.stringify({ schema: 1, id, components })};
const combinedRelease:ReleaseManifest={...builtInRelease,components:[...builtInRelease.components,...customMigrations.map(({component,version,digest})=>({component,version,digest}))]};
export const selectedReleaseManifest:ReleaseManifest=customMigrations.length
  ? {...combinedRelease,id:'selected-v1-'+releaseDigest(combinedRelease).slice(0,24)}
  : builtInRelease;
/** Boot validates only, before starting providers; it never applies a release. */
export async function assertSelectedReleaseReady(database:${native},manifest:ReleaseManifest=selectedReleaseManifest):Promise<void>{assertLedgerReady(await readNativeReleaseLedger(database),manifest);}
`,
    ),
    file(
      'src/generated/initialize-selected-schemas.ts',
      `${imports.join('\n')}
export async function initializeSelectedSchemas(config:AppConfig):Promise<readonly string[]> {
const store=await NativeReleaseStore.connect(config.database.url);
try{return await new ReleaseCoordinator(store).apply(selectedReleaseManifest,[
${auth ? "{component:'identity',apply:()=>initializeIdentityDatabase(config)}," : ''}
${mail ? "{component:'mail',apply:async()=>{const database=await openDatabase(config,false);try{await initializeMail(database);}finally{await database.close();}}}," : ''}
${media ? "{component:'media',apply:()=>initializeMediaSchema(config)}," : ''}
${push ? "{component:'push',apply:()=>initializePushSchema(config)}," : ''}
${notes ? "{component:'notes',apply:async()=>{const database=await openDatabase(config,false);try{await initializeNotes(database);}finally{await database.close();}}}," : ''}
${realtime ? `{component:'${realtimeComponent}',apply:async()=>{const database=await openDatabase(config,false);try{await initializeRealtime(database);}finally{await database.close();}}},` : ''}
...customMigrations.map(({component,apply})=>({component,apply:async()=>{
  const database=await openDatabase(config,false);
  try{await apply(database);}finally{await database.close();}
}})),
]);}finally{await store.close();}}
`,
    ),
    file(
      'src/initialize-database.ts',
      `import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {ApplicationError} from './core/errors/application-error.js';
import {initializeSelectedSchemas} from './generated/initialize-selected-schemas.js';
import {selectedReleaseManifest} from './generated/selected-release.js';
const configCodes=new Set(${JSON.stringify(CONFIG_ERROR_CODES)});
function report(code:string,next:string,extra:Record<string,unknown>={}){console.log(JSON.stringify({schemaVersion:1,status:'failed',code,next,...extra}));}
try{if(process.argv.length!==2){report('INVALID_ARGUMENTS','vcli release apply');process.exitCode=1;}else{loadSelectedEnvFile();let config:Awaited<ReturnType<typeof loadConfig>>|undefined;try{config=loadConfig();}catch(error){const code=error instanceof ApplicationError&&configCodes.has(error.code)?error.code:'INVALID_CONFIG';const prefix='Invalid configuration keys: ';const keys=error instanceof ApplicationError&&error.message.startsWith(prefix)?error.message.slice(prefix.length).split(', ').filter((key)=>/^[A-Z][A-Z0-9_]{0,64}$/.test(key)).slice(0,20):[];report(code,'vcli config check',keys.length?{keys}:{});process.exitCode=1;config=undefined;}if(config){try{const owners=await initializeSelectedSchemas(config);console.log(JSON.stringify({schemaVersion:1,status:'completed',code:'RELEASE_APPLIED',releaseId:selectedReleaseManifest.id,owners}));}catch{report('RELEASE_AMBIGUOUS','vcli release reconcile');process.exitCode=1;}}}}catch{report('RELEASE_FAILED','vcli release reconcile');process.exitCode=1;}
`,
    ),
  ];
}
