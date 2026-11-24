import {
  CONFIG_ERROR_CODES,
  LOCAL_DEVELOPMENT_STORAGE_ROOT,
  type ProjectConfig,
  type RenderedFile,
} from '../contracts.js';
import { bundled, file, json } from './bundle.js';
import { basicLocalAuth, selection } from './selection.js';

function generatedAppModule(config: ProjectConfig): RenderedFile {
  const modules = [
    ['LoggingModule', '../core/logging/logging.module.js'],
    ['HealthModule', '../modules/health/health.module.js'],
  ];
  if (selection(config, 'database'))
    modules.push(['DatabaseModule', '../core/database/database.module.js']);
  if (selection(config, 'auth'))
    modules.push(
      basicLocalAuth(config)
        ? ['AuthModule', '../modules/auth/auth.module.js']
        : ['IdentityModule', '../modules/identity/identity.module.js'],
    );
  const optionalModules = [
    ['mail', 'MailModule'],
    ['storage', 'StorageModule'],
    ['media', 'MediaModule'],
    ['notes', 'NotesModule'],
    ['realtime', 'RealtimeModule'],
    ['diagnostics', 'DiagnosticsModule'],
  ] as const;
  for (const [family, module] of optionalModules)
    if (selection(config, family))
      modules.push([module, `../modules/${family}/${family}.module.js`]);
  if (selection(config, 'push-fcm') || selection(config, 'push-apns'))
    modules.push(['PushModule', '../modules/push/push.module.js']);
  return file(
    'src/generated/vcli-app.module.ts',
    `import {Module} from '@nestjs/common';
${modules.map(([module, path]) => `import {${module}} from '${path}';`).join('\n')}
/** VCLI-owned composition; put custom features in AppCustomModule. */
@Module({imports:[${modules.map(([module]) => module).join(',')}]})
export class VcliAppModule {}
`,
  );
}

export async function foundationFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const common = [
    'core/bootstrap/bootstrap-bindings.ts',
    'core/errors/application-error.ts',
    'core/logging/app-logger.service.ts',
    'core/logging/logging.module.ts',
    'core/logging/log-event-schema.ts',
    'core/logging/diagnostic-catalog.ts',
    'core/diagnostics/diagnostic-events.ts',
    'core/http/http-error.filter.ts',
    'core/http/http-diagnostic-facts.ts',
    'core/http/record-request.ts',
  ];
  const files = await Promise.all(common.map((path) => bundled('src/' + path)));
  const eventSchema = files.find((item) =>
    item.path.endsWith('/log-event-schema.ts'),
  )!;
  // The selected allowlist changes with add; protect and regenerate its technical source.
  eventSchema.ownership = 'managed';
  const database = selection(config, 'database');
  eventSchema.content = eventSchema.content.replace(
    "z.enum(['mongodb', 'postgres'])",
    database
      ? `z.literal('${database === 'database.mongodb' ? 'mongodb' : 'postgres'}')`
      : 'z.never()',
  );
  const capabilitiesStart = eventSchema.content.indexOf(
    '      capabilities: z',
  );
  const capabilitiesEnd = eventSchema.content.indexOf(
    '      versions:',
    capabilitiesStart,
  );
  if (capabilitiesStart < 0 || capabilitiesEnd < 0)
    throw new Error('INVALID_LOG_SCHEMA_TEMPLATE');
  eventSchema.content =
    eventSchema.content.slice(0, capabilitiesStart) +
    `      capabilities:z.array(z.enum(${JSON.stringify(
      Object.values(config.capabilities)
        .map((item) => item.recipe)
        .sort(),
    )})).max(16).optional(),\n` +
    eventSchema.content.slice(capabilitiesEnd);
  files.push(
    file('.npmrc', 'install-links=true\n'),
    file(
      'scripts/write-build-metadata.mjs',
      `import {execFileSync} from 'node:child_process';
import {mkdir,rename,writeFile} from 'node:fs/promises';
const args=process.argv.slice(2);
let sourceCommit=null;
if(args.length){if(args.length!==2||args[0]!=='--source-commit'||!/^[a-f0-9]{40}$/.test(args[1])) throw new Error('INVALID_BUILD_METADATA_INPUT');sourceCommit=args[1];}
else try{const git=(...values)=>execFileSync('git',values,{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();if(git('status','--porcelain')===''){const commit=git('rev-parse','HEAD');if(/^[a-f0-9]{40}$/.test(commit)) sourceCommit=commit;}}catch{ /* Unversioned local builds have no deployment identity. */ }
await mkdir('dist',{recursive:true});
const temporary='dist/.build-metadata-'+process.pid+'.json';
await writeFile(temporary,JSON.stringify({schema:1,sourceCommit})+'\\n',{mode:0o444,flag:'wx'});
await rename(temporary,'dist/build-metadata.json');
`,
    ),
    file(
      'src/core/build/build-metadata.ts',
      `import {readFileSync} from 'node:fs';
function readBuildId():string|null {
let value:unknown;
try{value=JSON.parse(readFileSync(new URL('../../build-metadata.json',import.meta.url),'utf8'));}
catch(error:unknown){if(error&&typeof error==='object'&&'code' in error&&error.code==='ENOENT') return null;
// eslint-disable-next-line preserve-caught-error -- Exclude parsing/path details from startup failures.
throw new Error('INVALID_BUILD_METADATA');}
if(!value||typeof value!=='object'||!('schema' in value)||value.schema!==1||!('sourceCommit' in value)||(value.sourceCommit!==null&&(typeof value.sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(value.sourceCommit)))) throw new Error('INVALID_BUILD_METADATA');
return value.sourceCommit;
}
/** Immutable build asset; runtime environment cannot supply a deployment identity. */
export const buildId=readBuildId();
`,
    ),
    file(
      '.gitignore',
      `node_modules/\n/dist/\nvar/\n/${LOCAL_DEVELOPMENT_STORAGE_ROOT}/\n.env\n.env.*\n!.env.*.example\n/firebase-admin.json\n.vcli/\n*.tgz\n`,
      'scaffold',
    ),
    file(
      'tsconfig.json',
      json({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          esModuleInterop: true,
          skipLibCheck: true,
          declaration: true,
          sourceMap: true,
          outDir: 'dist',
          rootDir: 'src',
          forceConsistentCasingInFileNames: true,
          noUncheckedIndexedAccess: true,
          types: ['node'],
        },
        include: ['src/**/*.ts'],
        exclude: ['node_modules', 'dist', 'test'],
      }),
    ),
    file(
      'nest-cli.json',
      json({
        collection: '@nestjs/schematics',
        sourceRoot: 'src',
        compilerOptions: { deleteOutDir: true },
      }),
    ),
    file('.prettierrc.json', json({ singleQuote: true, trailingComma: 'all' })),
    file(
      'eslint.config.mjs',
      `import js from '@eslint/js';
import tseslint from 'typescript-eslint';
export default tseslint.config({ignores:['dist/**','node_modules/**']},js.configs.recommended,...tseslint.configs.recommended,{files:['src/**/*.ts'],languageOptions:{parserOptions:{project:'./tsconfig.json'}},rules:{'@typescript-eslint/no-explicit-any':'error','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}]}});
`,
    ),
    file(
      'src/app.custom.module.ts',
      "import {Module} from '@nestjs/common';\n// Developer-owned: add your feature modules to imports.\n@Module({imports:[]})\nexport class AppCustomModule {}\n",
      'scaffold',
    ),
    file(
      'src/app.module.ts',
      "import {Module} from '@nestjs/common';\nimport {AppCustomModule} from './app.custom.module.js';\nimport {VcliAppModule} from './generated/vcli-app.module.js';\n@Module({imports:[VcliAppModule,AppCustomModule]})\nexport class AppModule {}\n",
    ),
    generatedAppModule(config),
    file(
      'src/modules/health/health-state.service.ts',
      "import {Injectable} from '@nestjs/common';\n@Injectable()\nexport class HealthStateService {private initialized=false; private schemaReleaseId:string|undefined; ready():boolean{return this.initialized;} facts():Readonly<{schemaReleaseId?:string}>{return this.schemaReleaseId?{schemaReleaseId:this.schemaReleaseId}:{};} markReady(schemaReleaseId?:string):void{this.schemaReleaseId=schemaReleaseId;this.initialized=true;} markStopping():void{this.initialized=false;}}\n",
    ),
    file(
      'src/modules/health/health.controller.ts',
      `import {Controller,Get,ServiceUnavailableException} from '@nestjs/common';
import {HealthStateService} from './health-state.service.js';
import {buildId} from '../../core/build/build-metadata.js';
@Controller('health')
export class HealthController {constructor(private readonly state:HealthStateService){} @Get('live') live(){return {status:'alive'};} @Get('ready') ready(){if(!this.state.ready()) throw new ServiceUnavailableException();return {status:'ready',buildId,...this.state.facts(),scope:'initialized-application',externalAcceptance:'not-established'};}}
`,
    ),
    file(
      'src/modules/health/health.module.ts',
      "import {Module} from '@nestjs/common';\nimport {HealthController} from './health.controller.js';\nimport {HealthStateService} from './health-state.service.js';\n@Module({controllers:[HealthController],providers:[HealthStateService],exports:[HealthStateService]})\nexport class HealthModule {}\n",
    ),
    file(
      'src/main.ts',
      `import {createApp,type ApplicationRuntime} from './create-app.js';
import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {ApplicationError} from './core/errors/application-error.js';
import {AppLoggerService} from './core/logging/app-logger.service.js';
const configCodes=new Set(${JSON.stringify(CONFIG_ERROR_CODES)});
function guidance(stage:string,code:string):string{if(stage==='schema'||code==='SCHEMA_RELEASE_REQUIRED')return 'vcli release apply';if(stage==='config'||configCodes.has(code))return 'vcli config check';if(stage==='database')return 'vcli services status';if(code==='STORAGE_UNAVAILABLE')return 'Check LOCAL_STORAGE_ROOT and ops/storage/private-storage-setup.md';return 'vcli dev';}
let runtime:ApplicationRuntime|undefined;
let stage:'config'|'modules'|'listen'='config';
try {loadSelectedEnvFile();const config=loadConfig();stage='modules';runtime=await createApp(config);stage='listen';await runtime.app.listen(runtime.config.port,runtime.config.host);runtime.logger.record({event:'application.started',severity:'info',stage:'listen'});
for(const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>{void runtime!.close().catch(()=>{process.exitCode=1;});});
} catch(error){process.exitCode=1;const thrown=error instanceof ApplicationError?error.code:'';const code=stage==='listen'?'LISTEN_FAILED':stage==='config'?(configCodes.has(thrown)?thrown:'INVALID_CONFIG'):(thrown||'STARTUP_FAILED');const reported=stage==='listen'?'listen':stage==='config'?'config':code==='SCHEMA_RELEASE_REQUIRED'?'schema':code==='DATABASE_UNAVAILABLE'||code==='DATABASE_URL_REQUIRED'?'database':'modules';if(stage==='config'||stage==='listen'){const logger=runtime?.logger??new AppLoggerService(process.env.NODE_ENV==='production'?'production':'development');logger.record({event:'application.start-failed',severity:'error',errorCode:stage==='listen'?'LISTEN_FAILED':thrown==='ENV_FILE_UNAVAILABLE'?'ENV_FILE_UNAVAILABLE':thrown==='UNSAFE_ENV_FILE'?'UNSAFE_ENV_FILE':thrown==='RUNTIME_PROVIDER_SELECTION_UNSUPPORTED'?'RUNTIME_PROVIDER_SELECTION_UNSUPPORTED':'INVALID_CONFIG',stage:reported as 'config'|'listen'});await logger.flush();}if(runtime)await runtime.close().catch(()=>undefined);console.error(JSON.stringify({schemaVersion:1,status:'failed',code,stage:reported,next:guidance(reported,code)}));}
`,
    ),
    file('CLAUDE.md', '@AGENTS.md\n', 'scaffold'),
    file(
      'test/foundation.test.mjs',
      `// Evidence: local compiled dist. This is not hosted-provider acceptance.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loadConfig} from '../dist/core/config/load-config.js';
import {HealthStateService} from '../dist/modules/health/health-state.service.js';
test('health readiness has an explicit initialization and shutdown lifecycle',()=>{const state=new HealthStateService();assert.equal(state.ready(),false);state.markReady();assert.equal(state.ready(),true);state.markStopping();assert.equal(state.ready(),false);});
test('invalid environment values are rejected without including values',()=>{const sentinel='PRIVATE_SENTINEL';assert.throws(()=>loadConfig({PORT:sentinel}),error=>!String(error).includes(sentinel));});
`,
    ),
  );
  // Pin project identity in the selected logger; source remains scaffold-owned thereafter.
  for (const item of files)
    if (item.path.includes('app-logger.service'))
      item.content = item.content.replaceAll(
        "'generated-api'",
        JSON.stringify(config.project.name),
      );
  return files;
}
