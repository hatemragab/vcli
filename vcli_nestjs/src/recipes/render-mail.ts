import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file } from './bundle.js';
import { selection, usernameAuth } from './selection.js';

function nativeMailDatabase(config: ProjectConfig): 'mongodb' | 'postgres' {
  const selected = selection(config, 'database');
  if (!selected) throw new Error('RELIABLE_MAIL_REQUIRES_DATABASE');
  if (selected !== 'database.mongodb' && selected !== 'database.postgres')
    throw new Error('UNSUPPORTED_MAIL_DATABASE');
  return selected === 'database.mongodb' ? 'mongodb' : 'postgres';
}

/** Transport source and configured exports; no database source for immediate mail. */
export async function mailFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const selected = selection(config, 'mail');
  if (!selected) return [];
  if (!['mail.capture', 'mail.smtp', 'mail.http'].includes(selected))
    throw new Error('UNSUPPORTED_MAIL_PROVIDER');
  const option = config.capabilities.mail!.options.reliableActions;
  if (option !== undefined && typeof option !== 'boolean')
    throw new Error('INVALID_MAIL_OPTIONS');
  const capture = selected === 'mail.capture',
    http = selected === 'mail.http',
    reliable = option === true;
  if (http && config.capabilities.mail!.options.provider !== 'resend')
    throw new Error('UNSUPPORTED_HTTP_MAIL_PROVIDER');
  const local =
    selection(config, 'auth') === 'auth.local' && !usernameAuth(config);
  const database = reliable || local ? nativeMailDatabase(config) : undefined;
  const databaseClass =
    database === 'mongodb' ? 'MongoDatabase' : 'PostgresDatabase';
  const paths = [
    'core/mail/mail-submitter.ts',
    'modules/mail/mail.service.ts',
    'modules/mail/render-message.ts',
    `modules/mail/${capture ? 'capture' : http ? 'http' : 'smtp'}-mail.service.ts`,
    ...(http ? ['modules/mail/http-mail-protocol.ts'] : []),
    ...(local || reliable ? ['core/mail/action-delivery.ts'] : []),
    ...(reliable
      ? [
          'modules/mail/mail-intent-types.ts',
          'modules/mail/mail-payload-cipher.ts',
          'modules/mail/mail-intent.service.ts',
        ]
      : []),
  ];
  const files = await Promise.all(paths.map((path) => bundled('src/' + path)));
  if (reliable)
    for (const name of [
      'mail-intent.entity.ts',
      'mail-intent-store.ts',
      'initialize-mail.ts',
    ])
      files.push(await bundled('src/modules/mail/' + name, database));
  files.push(
    file(
      'src/modules/mail/mail.module.ts',
      `import {Module,type DynamicModule} from '@nestjs/common';
import type {AppConfig} from '../../core/config/app-config.js';
import type {MailSubmitter} from '../../core/mail/mail-submitter.js';
${capture || reliable ? "import {ApplicationError} from '../../core/errors/application-error.js';" : ''}
import {MailService} from './mail.service.js';
${
  capture
    ? "import {CaptureMailService,pruneCapture,type MailCaptureBuffer} from './capture-mail.service.js';"
    : http
      ? "import {HttpMailService} from './http-mail.service.js';"
      : "import {SmtpMailService} from './smtp-mail.service.js';"
}
${
  reliable
    ? `import type {${databaseClass}} from '../../core/database/${database === 'mongodb' ? 'mongo' : 'postgres'}-database.js';
import {MailIntentStore} from './mail-intent-store.js';
import {MailPayloadCipher} from './mail-payload-cipher.js';
import {MailIntentService} from './mail-intent.service.js';`
    : ''
}
export function createMailSender(config:AppConfig):${capture ? 'CaptureMailService' : http ? 'HttpMailService' : 'SmtpMailService'} {
${
  capture
    ? "if(config.environment==='production')throw new ApplicationError('UNSAFE_PRODUCTION_CAPTURE',500);return new CaptureMailService(config.mail.maxCaptured,Date.now,undefined,900000,config.environment);"
    : http
      ? 'return new HttpMailService(config.mail);'
      : "return new SmtpMailService(config.mail,config.environment==='production');"
}
}
${
  capture
    ? `export function createTestMailCapture(maximum=100,now:()=>number=Date.now){
if(!Number.isInteger(maximum)||maximum<1||maximum>1000)throw new ApplicationError('INVALID_CAPTURE_LIMIT',400);
const capture:MailCaptureBuffer={entries:[],bytes:0};const sender:MailService=new CaptureMailService(maximum,now,capture);
return {sender,inspect:()=>{pruneCapture(capture,now());return structuredClone(capture.entries);},clear:()=>{capture.entries.length=0;capture.bytes=0;}};}`
    : ''
}
export type MailRuntimeDependencies=Readonly<{sender?:MailService}>;
export type MailRuntime=Readonly<{sender:MailService;intents:${reliable ? 'MailIntentService' : 'undefined'};module:DynamicModule;close():Promise<void>}>;
/** No database or provider I/O during construction. The caller owns the database lifecycle. */
export function createMailRuntime(config:AppConfig,${reliable ? `database?:${databaseClass}` : '_database?:unknown'},dependencies:MailRuntimeDependencies={}):MailRuntime {
${reliable ? "if(!database)throw new ApplicationError('MAIL_DATABASE_REQUIRED',500);" : ''}
${capture ? "if(config.environment==='production')throw new ApplicationError('UNSAFE_PRODUCTION_CAPTURE',500);" : ''}
const ownedSender=dependencies.sender?undefined:createMailSender(config);
const sender:MailService=dependencies.sender??ownedSender!;
${
  reliable
    ? `${capture ? '' : 'try {'}
const policy=config.mailDelivery;
const intents=new MailIntentService(new MailIntentStore(database),new MailPayloadCipher(policy.activeKeyId,policy.keys),sender,{maxAttempts:policy.maxAttempts,leaseMs:policy.leaseMs,maxLifetimeMs:policy.maxLifetimeMs});
let closed=false;
return {sender,intents,module:MailModule.register(sender,intents),async close(){if(closed)return;closed=true;${capture ? '' : 'ownedSender?.close();'}}};
${capture ? '' : '}catch(error){ownedSender?.close();throw error;}'}`
    : `let closed=false;
return {sender,intents:undefined,module:MailModule.register(sender),async close(){if(closed)return;closed=true;${capture ? '' : 'ownedSender?.close();'}}};`
}
}
@Module({})
export class MailModule {static register(sender:MailSubmitter${reliable ? ',intents?:MailIntentService' : ''}):DynamicModule{return {module:MailModule,providers:[{provide:MailService,useValue:sender}${reliable ? ',...(intents?[{provide:MailIntentService,useValue:intents}]:[])' : ''}],exports:[MailService${reliable ? ',...(intents?[MailIntentService]:[])' : ''}]};}}
`,
    ),
  );
  if (capture)
    files.push(
      file(
        'test/mail-capture.test.mjs',
        `import assert from 'node:assert/strict';import {test} from 'node:test';
import {createTestMailCapture,createMailSender} from '../dist/modules/mail/mail.module.js';
test('capture is private, bounded and prohibited in production',async()=>{const capture=createTestMailCapture(1);const message={operationId:'12345678-1234-4123-8123-123456789abc',purpose:'notification',to:'reader@example.invalid',subject:'Example',text:'Private body',html:'<p>Private body</p>'};await capture.sender.submit(message);assert.equal(capture.inspect().length,1);capture.clear();assert.equal(capture.inspect().length,0);assert.throws(()=>createMailSender({environment:'production',mail:{maxCaptured:1}}));});
`,
      ),
    );
  if (reliable)
    files.push(
      file(
        'src/drain-mail.ts',
        `import 'reflect-metadata';
import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {openDatabase} from './core/database/database.js';
import {createMailRuntime,type MailRuntime} from './modules/mail/mail.module.js';
async function drain(args:readonly string[]):Promise<void>{
if(args.length!==0&&(args.length!==2||args[0]!=='--limit'||!/^\\d{1,3}$/.test(args[1]!)))throw new Error('INVALID_MAIL_DRAIN_ARGUMENTS');
const limit=args.length?Number(args[1]):20;
if(limit<1||limit>100)throw new Error('INVALID_MAIL_DRAIN_ARGUMENTS');
loadSelectedEnvFile();const config=loadConfig();
const database=await openDatabase(config,false);let mail:MailRuntime|undefined;let processed:number;let cleanupFailed:boolean;
try {mail=createMailRuntime(config,database);processed=(await mail.intents.drain(limit)).processed;}
finally {const closed=await Promise.allSettled([mail?.close()??Promise.resolve(),database.close()]);cleanupFailed=closed.some((result)=>result.status==='rejected');}
if(cleanupFailed)throw new Error('MAIL_DRAIN_CLEANUP_FAILED');
process.stdout.write(JSON.stringify({processed})+'\\n');
}
void drain(process.argv.slice(2)).catch(()=>{process.stderr.write('MAIL_DRAIN_FAILED\\n');process.exitCode=1;});
`,
      ),
    );
  return files;
}

/** Independent from transport selection: Firebase provider mode does not require mail. */
export async function firebaseMailFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  if (selection(config, 'auth') !== 'auth.firebase') return [];
  const delivery =
    config.capabilities.auth!.options.actionDelivery ?? 'provider';
  if (delivery !== 'provider' && delivery !== 'application')
    throw new Error('INVALID_FIREBASE_ACTION_DELIVERY');
  if (delivery === 'application') {
    if (
      !selection(config, 'mail') ||
      config.capabilities.mail?.options.reliableActions !== true
    )
      throw new Error('FIREBASE_APPLICATION_ACTIONS_REQUIRE_RELIABLE_MAIL');
    nativeMailDatabase(config);
  }
  const paths = [
    'src/modules/mail/firebase-action-policy.ts',
    'clients/mail-firebase-actions.mjs',
    ...(!selection(config, 'mail')
      ? [
          'src/core/mail/mail-submitter.ts',
          'src/modules/mail/render-message.ts',
        ]
      : []),
    ...(delivery === 'application'
      ? ['src/modules/mail/firebase-action-links.service.ts']
      : []),
  ];
  return Promise.all(paths.map((path) => bundled(path)));
}
