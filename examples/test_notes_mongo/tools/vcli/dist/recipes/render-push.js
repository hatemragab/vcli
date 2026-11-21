import { bundled, file, runtime } from './bundle.js';
import { selection } from './selection.js';
export async function pushFiles(config) {
    const mongo = selection(config, 'database') === 'database.mongodb', variant = mongo ? 'mongodb' : 'postgres', store = mongo ? 'MongoPushStateStore' : 'PostgresPushStateStore';
    const fcm = !!selection(config, 'push-fcm'), apns = !!selection(config, 'push-apns');
    const paths = [
        'push-state-store.ts',
        'push-validation.ts',
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
    const files = await Promise.all(paths.map((path) => runtime('src/modules/push/' + path, variant)));
    files.push(file('src/modules/push/push.module.ts', `import {Module,type DynamicModule} from '@nestjs/common';
import {setTimeout as delay} from 'node:timers/promises';
import type {AppConfig} from '../../core/config/app-config.js';
import type {PrincipalAuthority} from '../../core/auth/principal-authority.js';
import {HttpSecurityModule} from '../../core/http/http-security.module.js';
import type {PushSender,PurposeRoutes} from './push.entity.js';
import {PushService,type PushRuntimeOptions} from './push.service.js';
import {PushRepository} from './push.repository.js';
import {PushController,PUSH_SCOPE} from './push.controller.js';
import {${store}} from './${mongo ? 'mongo' : 'postgres'}-push-state-store.js';
${fcm ? "import {deleteApp,initializeApp} from 'firebase-admin/app';\nimport {randomUUID} from 'node:crypto';\nimport {FcmPushService} from './fcm-push.service.js';\nimport {fcmCredential} from './fcm-credentials.js';" : ''}
${apns ? "import {ApnsPushService} from './apns-push.service.js';" : ''}
@Module({})
export class PushModule {}
export async function initializePushSchema(config:AppConfig):Promise<void>{const store=await ${store}.connect(config.database.url,true);await store.close();}
export async function createPushRuntime(config:AppConfig,authority:PrincipalAuthority,dependencies:Pick<PushRuntimeOptions,'voipPolicy'>={}):Promise<{module:DynamicModule;close():Promise<void>}>{
const store=await ${store}.connect(config.database.url,false);
${fcm ? 'let firebase:ReturnType<typeof initializeApp>|undefined;' : ''}
try {const senders:Partial<Record<'fcm'|'apns',PushSender>>={};
${fcm ? "firebase=initializeApp({projectId:config.push.fcmProjectId,credential:await fcmCredential(config.push.fcmProjectId,config.push.fcmCredentialsPath)},'app-push-'+randomUUID());senders.fcm=new FcmPushService(firebase);" : ''}
${apns ? 'senders.apns=await ApnsPushService.create(config.push);' : ''}
const routes:PurposeRoutes={ordinary:'${fcm ? 'fcm' : 'apns'}',background:${apns ? "'apns'" : 'undefined'},voip:${apns ? "'apns'" : 'undefined'}};
const scope=[config.publicOrigin,${fcm ? 'config.push.fcmProjectId' : "''"},${apns ? "config.push.apnsTopic,config.push.apnsProduction?'production':'sandbox'" : "''"}].join(':');
let closed=false;
return {module:{module:PushModule,imports:[HttpSecurityModule.register(authority)],controllers:[PushController],providers:[{provide:PushRepository,useFactory:()=>new PushRepository(store)},{provide:PushService,inject:[PushRepository],useFactory:(destinations:PushRepository)=>new PushService(destinations,senders,authority,async(milliseconds)=>{if(milliseconds>0)await delay(milliseconds);return Date.now();},routes,scope,{environment:config.push.environment,voipPolicy:dependencies.voipPolicy})},{provide:PUSH_SCOPE,useValue:scope}],exports:[PushService]},async close(){if(closed)return;closed=true;${fcm ? "const results=await Promise.allSettled([store.close(),firebase?deleteApp(firebase):Promise.resolve()]);if(results.some((result)=>result.status==='rejected'))throw new Error('PUSH_SHUTDOWN_FAILED');" : 'await store.close();'}}};
}catch(error){${fcm ? 'await Promise.allSettled([store.close(),firebase?deleteApp(firebase):Promise.resolve()]);' : 'await store.close();'}throw error;}}
`));
    files.push(await bundled('clients/push-client.mjs'), await bundled('ops/push/README.md'));
    if (apns)
        files.push(await bundled('ops/push/callkit-example.swift'), await bundled('ops/push/apns-device-checklist.md'));
    if (fcm)
        files.push(await bundled('ops/push/fcm-device-checklist.md'));
    return files;
}
//# sourceMappingURL=render-push.js.map