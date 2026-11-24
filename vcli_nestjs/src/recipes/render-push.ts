import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file, runtime } from './bundle.js';
import { selection } from './selection.js';
import { replaceExact } from './template-markers.js';

export async function pushFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const mongo = selection(config, 'database') === 'database.mongodb',
    variant = mongo ? 'mongodb' : 'postgres',
    store = mongo ? 'MongoPushStateStore' : 'PostgresPushStateStore';
  const fcm = !!selection(config, 'push-fcm'),
    apns = !!selection(config, 'push-apns');
  const paths = [
    'push-state-store.ts',
    'push-validation.ts',
    'push-credential-file.ts',
    'push-retry-after.ts',
    'trusted-call-invitation-policy.ts',
    'push-storage-mapping.ts',
    'push-transitions.ts',
    'push.controller.ts',
    'push.entity.ts',
    'push.repository.ts',
    'push.service.ts',
    `${mongo ? 'mongo' : 'postgres'}-push-state-store.ts`,
    ...(fcm ? ['fcm-push.service.ts', 'fcm-credentials.ts'] : []),
    ...(apns
      ? ['apns-push.service.ts', 'apns-payload.ts', 'apns-transport.ts']
      : []),
  ];
  const files = await Promise.all(
    paths.map((path) => runtime('src/modules/push/' + path, variant)),
  );
  files.push(
    file(
      'src/modules/push/push.module.ts',
      `import {Module} from '@nestjs/common';
import {setTimeout as delay} from 'node:timers/promises';
import {bootstrapBinding,type BootstrapBinding} from '../../core/bootstrap/bootstrap-bindings.js';
import type {AppConfig} from '../../core/config/app-config.js';
import {PRINCIPAL_AUTHORITY,type PrincipalAuthority} from '../../core/auth/principal-authority.js';
import {HttpSecurityModule} from '../../core/http/http-security.module.js';
import type {PushSender,PurposeRoutes} from './push.entity.js';
import {PushService,type PushRuntimeOptions} from './push.service.js';
import {PushRepository} from './push.repository.js';
import {PushController,PUSH_SCOPE} from './push.controller.js';
import type {PushStateStore} from './push-state-store.js';
import {${store}} from './${mongo ? 'mongo' : 'postgres'}-push-state-store.js';
${fcm ? "import {deleteApp,initializeApp} from 'firebase-admin/app';\nimport {randomUUID} from 'node:crypto';\nimport {FcmPushService} from './fcm-push.service.js';\nimport {fcmCredential} from './fcm-credentials.js';" : ''}
${apns ? "import {ApnsPushService} from './apns-push.service.js';" : ''}
const PUSH_STORE=Symbol('PushStore');
const PUSH_OPTIONS=Symbol('PushOptions');
type PushOptions=Readonly<{senders:Partial<Record<'fcm'|'apns',PushSender>>;routes:PurposeRoutes;runtime:PushRuntimeOptions}>;
const storeBinding=bootstrapBinding<PushStateStore>(PUSH_STORE);
const optionsBinding=bootstrapBinding<PushOptions>(PUSH_OPTIONS);
const scopeBinding=bootstrapBinding<string>(PUSH_SCOPE);
@Module({
  imports:[HttpSecurityModule],
  controllers:[PushController],
  providers:[storeBinding.provider,optionsBinding.provider,scopeBinding.provider,
    {provide:PushRepository,inject:[PUSH_STORE],useFactory:(store:PushStateStore)=>new PushRepository(store)},
    {provide:PushService,inject:[PushRepository,PRINCIPAL_AUTHORITY,PUSH_SCOPE,PUSH_OPTIONS],useFactory:(destinations:PushRepository,authority:PrincipalAuthority,scope:string,options:PushOptions)=>new PushService(destinations,options.senders,authority,async(milliseconds)=>{if(milliseconds>0)await delay(milliseconds);return Date.now();},options.routes,scope,options.runtime)}],
  exports:[PushService],
})
export class PushModule {}
export async function initializePushSchema(config:AppConfig):Promise<void>{const store=await ${store}.connect(config.database.url,true);await store.close();}
export async function createPushRuntime(config:AppConfig,dependencies:Pick<PushRuntimeOptions,'voipPolicy'>={}):Promise<{bindings:readonly BootstrapBinding[];close():Promise<void>}>{
const store=await ${store}.connect(config.database.url,false);
${fcm ? 'let firebase:ReturnType<typeof initializeApp>|undefined;' : ''}
try {const senders:Partial<Record<'fcm'|'apns',PushSender>>={};
${fcm ? "firebase=initializeApp({projectId:config.push.fcmProjectId,credential:await fcmCredential(config.push.fcmProjectId,config.push.fcmCredentialsPath)},'app-push-'+randomUUID());senders.fcm=new FcmPushService(firebase);" : ''}
${apns ? 'senders.apns=await ApnsPushService.create(config.push);' : ''}
const routes:PurposeRoutes={ordinary:'${fcm ? 'fcm' : 'apns'}',background:${apns ? "'apns'" : 'undefined'},voip:${apns ? "'apns'" : 'undefined'}};
const scope=[config.publicOrigin,${fcm ? 'config.push.fcmProjectId' : "''"},${apns ? "config.push.apnsTopic,config.push.apnsProduction?'production':'sandbox'" : "''"}].join(':');
const bindings=[storeBinding.bind(store),optionsBinding.bind({senders,routes,runtime:{environment:config.push.environment,voipPolicy:dependencies.voipPolicy}}),scopeBinding.bind(scope)];
let closed=false;
return {bindings,async close(){if(closed)return;closed=true;${fcm ? "const results=await Promise.allSettled([store.close(),firebase?deleteApp(firebase):Promise.resolve()]);if(results.some((result)=>result.status==='rejected'))throw new Error('PUSH_SHUTDOWN_FAILED');" : 'await store.close();'}}};
}catch(error){${fcm ? 'await Promise.allSettled([store.close(),firebase?deleteApp(firebase):Promise.resolve()]);' : 'await store.close();'}throw error;}}
`,
    ),
  );
  const readme = await bundled('ops/push/README.md');
  readme.content = replaceExact(
    readme.content,
    '{{ordinaryProvider}}',
    fcm ? 'FCM' : 'APNs',
    readme.path,
  )
    .split('\n\n')
    .filter((paragraph) => {
      if (paragraph.startsWith('**FCM.**')) return fcm;
      if (paragraph.startsWith('**APNs.**')) return apns;
      return true;
    })
    .join('\n\n');
  files.push(await bundled('clients/push-client.mjs'), readme);
  if (apns)
    files.push(
      await bundled('ops/push/callkit-example.swift'),
      await bundled('ops/push/apns-device-checklist.md'),
    );
  if (fcm) files.push(await bundled('ops/push/fcm-device-checklist.md'));
  return files;
}
