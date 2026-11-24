import { file } from './bundle.js';
import { selection, usernameAuth } from './selection.js';
export function compositionFile(config) {
    const database = selection(config, 'database'), auth = selection(config, 'auth'), mail = selection(config, 'mail'), storage = selection(config, 'storage'), media = selection(config, 'media'), notes = selection(config, 'notes'), push = selection(config, 'push-fcm') || selection(config, 'push-apns'), realtime = selection(config, 'realtime'), diagnostics = selection(config, 'diagnostics');
    const reliable = config.capabilities.mail?.options.reliableActions === true;
    const applicationActions = auth === 'auth.firebase' &&
        config.capabilities.auth?.options.actionDelivery === 'application';
    const sources = (config.capabilities.diagnostics?.options.sources ?? [
        'application',
    ]);
    const workers = Boolean(diagnostics && sources.includes('workers'));
    const dbEvidence = Boolean(diagnostics && sources.includes('database'));
    const infrastructure = Boolean(diagnostics && sources.includes('infrastructure'));
    const dependencies = Boolean(mail || auth === 'auth.firebase' || push);
    const imports = [
        "import 'reflect-metadata';",
        "import {NestFactory} from '@nestjs/core';",
        "import {RequestMethod,type INestApplication,type DynamicModule} from '@nestjs/common';",
        "import {json} from 'express';",
        "import {AppModule} from './app.module.js';",
        "import type {AppConfig} from './core/config/app-config.js';",
        "import {AppLoggerService} from './core/logging/app-logger.service.js';",
        "import {ApplicationError} from './core/errors/application-error.js';",
        "import {LoggingModule} from './core/logging/logging.module.js';",
        "import {HttpErrorFilter} from './core/http/http-error.filter.js';",
        "import {recordRequest} from './core/http/record-request.js';",
        "import {HealthModule} from './modules/health/health.module.js';",
        "import {HealthStateService} from './modules/health/health-state.service.js';",
        ...(database
            ? [
                "import {openDatabase} from './core/database/database.js';",
                "import {DatabaseModule} from './core/database/database.module.js';",
                "import {assertSelectedReleaseReady,selectedReleaseManifest} from './generated/selected-release.js';",
            ]
            : []),
        ...(auth
            ? [
                "import {SwaggerModule,DocumentBuilder} from '@nestjs/swagger';",
                "import {applyOpenApiSecurity} from './core/http/openapi-security.js';",
                `import {createIdentityRuntime${auth === 'auth.firebase' ? ',type IdentityRuntimeDependencies' : ''}} from './modules/identity/identity.module.js';`,
            ]
            : []),
        ...(mail
            ? [
                "import {createMailRuntime} from './modules/mail/mail.module.js';",
                "import type {MailService} from './modules/mail/mail.service.js';",
            ]
            : []),
        ...(storage
            ? [
                "import {PrivateFilesystem} from './modules/storage/private-filesystem.js';",
                "import {LocalStorageService} from './modules/storage/local-storage.service.js';",
                "import {StorageService} from './modules/storage/storage.service.js';",
                `import {StorageModule${media ? ',selectedStorageProfile' : ''}} from './modules/storage/storage.module.js';`,
            ]
            : []),
        ...(media
            ? ["import {createMediaRuntime} from './modules/media/media.module.js';"]
            : []),
        ...(push
            ? ["import {createPushRuntime} from './modules/push/push.module.js';"]
            : []),
        ...(realtime
            ? [
                "import type {Server} from 'node:http';",
                "import {createRealtimeRuntime} from './modules/realtime/realtime.module.js';",
            ]
            : []),
        ...(notes
            ? ["import {createNotesRuntime} from './modules/notes/notes.module.js';"]
            : []),
        ...(diagnostics
            ? [
                "import {SourceEvidenceService} from './modules/diagnostics/source-evidence.service.js';",
                "import {DiagnosticReaderService} from './modules/diagnostics/diagnostic-reader.service.js';",
                "import {DiagnosticsModule} from './modules/diagnostics/diagnostics.module.js';",
            ]
            : []),
        ...(workers
            ? [
                "import {JobDiagnosticsService} from './core/diagnostics/job-diagnostics.service.js';",
            ]
            : []),
        ...(dbEvidence
            ? [
                "import {DatabaseDiagnosticsService} from './core/diagnostics/database-diagnostics.service.js';",
            ]
            : []),
        ...(infrastructure
            ? [
                "import {InfrastructureDiagnosticsService} from './core/diagnostics/infrastructure-diagnostics.service.js';",
            ]
            : []),
    ];
    return file('src/create-app.ts', `${imports.join('\n')}
export type ApplicationRuntime=Readonly<{app:INestApplication;config:AppConfig;logger:AppLoggerService;close():Promise<void>}>;
${dependencies
        ? `/** Trusted in-process composition only; no environment or HTTP override. */
export type ApplicationDependencies=Readonly<{${mail ? 'mailSender?:MailService;' : ''}${auth === 'auth.firebase' ? 'identity?:IdentityRuntimeDependencies;' : ''}${push ? 'push?:Parameters<typeof createPushRuntime>[2];' : ''}}>;`
        : ''}
export async function createApp(config:AppConfig${dependencies ? ',dependencies:ApplicationDependencies={}' : ''}):Promise<ApplicationRuntime>{
${diagnostics ? 'const diagnostics=await SourceEvidenceService.open(config.diagnostics,config.environment,config.diagnostics.sources);' : ''}
const logger=new AppLoggerService(config.environment${diagnostics ? ',diagnostics' : ''});
${workers ? 'const jobs=new JobDiagnosticsService(logger);' : ''}
${dbEvidence ? `const databaseDiagnostics=new DatabaseDiagnosticsService(logger,'${database === 'database.mongodb' ? 'mongodb' : 'postgres'}');` : ''}
logger.record({event:'application.starting',severity:'info'});
const cleanup:Array<()=>Promise<void>>=[];
let app:INestApplication|undefined,closing:Promise<void>|undefined;
${realtime ? 'let stopRealtime:(()=>Promise<void>)|undefined;' : ''}
${database ? "let startupStage:'database'|'schema'|'modules'='modules';" : ''}
const close=():Promise<void>=>closing??=(async()=>{
if(app){try{app.get(HealthStateService).markStopping();}catch{/* Startup may have failed before provider creation. */}}
logger.record({event:'application.stopping',severity:'info'});
let failed=false;for(const step of [${realtime ? '...(stopRealtime?[stopRealtime]:[]),' : ''}...(app?[()=>app!.close()]:[]),...cleanup.slice().reverse()]){try{await step();}catch{failed=true;}}
logger.record({event:failed?'application.shutdown-failed':'application.stopped',severity:failed?'error':'info'});
${diagnostics ? 'try{await diagnostics.close();}catch{failed=true;}' : ''}await logger.flush();if(failed)throw new Error('SHUTDOWN_FAILED');})();
try {
${infrastructure ? 'const infrastructure=new InfrastructureDiagnosticsService(logger);infrastructure.start();cleanup.push(async()=>{infrastructure.stop();});' : ''}
${database ? `startupStage='database';const db=await openDatabase(config,${auth ? 'true' : 'false'}${dbEvidence ? ',databaseDiagnostics' : ''});cleanup.push(()=>db.close());startupStage='schema';await assertSelectedReleaseReady(db);startupStage='modules';` : ''}
${mail ? `const mailRuntime=createMailRuntime(config,${reliable ? 'db' : 'undefined'},{sender:dependencies.mailSender});cleanup.push(()=>mailRuntime.close());` : ''}
${auth ? `const identity=await createIdentityRuntime(config,db${auth === 'auth.local' ? (usernameAuth(config) ? '' : `,mailRuntime.sender${reliable ? ',mailRuntime.intents' : ''}`) : applicationActions ? ',mailRuntime.intents,dependencies.identity' : ',dependencies.identity'});cleanup.push(()=>identity.close());` : ''}
${storage ? 'const filesystem=new PrivateFilesystem(config.storage.localRoot);await filesystem.initialize();const storage=new StorageService(new LocalStorageService());cleanup.push(async()=>{storage.close();});' : ''}
${media ? 'const media=await createMediaRuntime(config,identity.authority,{maximum:config.storage.maxBytes,ttlSeconds:config.storage.uploadTtlSeconds,profile:selectedStorageProfile(config,filesystem.root),stagingRoot:filesystem.root,modes:config.storage.modes},storage);cleanup.push(()=>media.close());' : ''}
${push ? 'const push=await createPushRuntime(config,identity.authority,dependencies.push);cleanup.push(()=>push.close());' : ''}
${realtime ? 'const realtime=await createRealtimeRuntime(config,identity.authority,logger,db);stopRealtime=()=>realtime.close();' : ''}
${notes ? `const notes=await createNotesRuntime(config,db,identity.authority${realtime ? ',realtime.publisher' : ''});` : ''}
const capabilities:Record<string,DynamicModule>={${database ? 'database:DatabaseModule.register(db),' : ''}${mail ? 'mail:mailRuntime.module,' : ''}${auth ? 'auth:identity.module,' : ''}${storage ? 'storage:StorageModule.register(storage),' : ''}${media ? 'media:media.module,' : ''}${notes ? 'notes:notes.module,' : ''}${push ? 'push:push.module,' : ''}${realtime ? 'realtime:realtime.module,' : ''}${diagnostics ? `diagnostics:DiagnosticsModule.register(diagnostics,new DiagnosticReaderService(config.diagnostics,config.environment,{sources:config.diagnostics.sources})${workers ? ',jobs' : ''}${dbEvidence ? ',databaseDiagnostics' : ''}${infrastructure ? ',infrastructure' : ''}),` : ''}};
app=await NestFactory.create(AppModule.register([LoggingModule.register(logger),{module:HealthModule},...Object.values(capabilities)],capabilities),{logger,abortOnError:false,bodyParser:false});
app.use(recordRequest(logger));app.use(json({limit:'64kb'}));app.useGlobalFilters(new HttpErrorFilter(logger));
app.enableCors({origin:[...config.allowedOrigins],allowedHeaders:['Authorization','Content-Type','X-Session-Token','X-Request-Id'],exposedHeaders:['X-Request-Id','X-Operation-Id'],methods:['GET','POST','PUT','PATCH','DELETE','OPTIONS']});
app.setGlobalPrefix('api',{exclude:['health/live','health/ready'].map(path=>({path,method:RequestMethod.GET}))});
${auth
        ? `const documentBuilder=new DocumentBuilder().setTitle(${JSON.stringify(config.project.name + ' API')}).setVersion('1').addBearerAuth({type:'http',scheme:'bearer'},'bearer')${auth === 'auth.firebase' ? ".addApiKey({type:'apiKey',in:'header',name:'X-Session-Token'},'appSession')" : ''}${realtime === 'realtime.centrifugo' ? ".addApiKey({type:'apiKey',in:'header',name:'X-Centrifugo-Proxy-Secret'},'centrifugoProxy')" : ''};
const document=SwaggerModule.createDocument(app,documentBuilder.build());applyOpenApiSecurity(document);SwaggerModule.setup('docs',app,document,{swaggerOptions:{persistAuthorization:false}});`
        : ''}
await app.init();${realtime ? 'await realtime.attach(app.getHttpServer() as Server);' : ''}app.get(HealthStateService).markReady(${database ? 'selectedReleaseManifest.id' : ''});
return {app,config,logger,close};
}catch(error){const thrown=error instanceof ApplicationError?error.code:'';
${database
        ? "const releaseMissing=thrown==='DATABASE_INITIALIZATION_REQUIRED';const code=releaseMissing?'SCHEMA_RELEASE_REQUIRED':thrown||(startupStage==='database'?'DATABASE_UNAVAILABLE':startupStage==='schema'?'SCHEMA_RELEASE_REQUIRED':'STARTUP_FAILED');const safe=['DATABASE_UNAVAILABLE','DATABASE_URL_REQUIRED','SCHEMA_RELEASE_REQUIRED','INVALID_CONFIG','STARTUP_FAILED'].includes(code)?code:startupStage==='schema'?'SCHEMA_RELEASE_REQUIRED':startupStage==='database'?'DATABASE_UNAVAILABLE':'STARTUP_FAILED';const reported=releaseMissing?'schema':startupStage;"
        : "const safe=thrown==='INVALID_CONFIG'?'INVALID_CONFIG':'STARTUP_FAILED';const reported='modules';"}
logger.record({event:'application.start-failed',severity:'error',errorCode:safe as 'DATABASE_UNAVAILABLE'|'DATABASE_URL_REQUIRED'|'SCHEMA_RELEASE_REQUIRED'|'INVALID_CONFIG'|'STARTUP_FAILED',stage:reported});await close().catch(()=>undefined);throw new ApplicationError(safe,500);}}
`);
}
//# sourceMappingURL=render-composition.js.map