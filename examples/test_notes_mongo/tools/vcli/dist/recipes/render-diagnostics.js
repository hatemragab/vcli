import { bundled, file } from './bundle.js';
import { selection } from './selection.js';
export async function diagnosticsFiles(config) {
    const options = config.capabilities.diagnostics.options;
    const sources = (options.sources ?? ['application']);
    const remote = options.reader === 'restricted-remote-read';
    const paths = [
        'diagnostic-reader.service.ts',
        'diagnostic-reader.ts',
        'diagnostic-schema.ts',
        'diagnostics.service.ts',
        'evidence-files.ts',
        'diagnostic-access.ts',
        'test-result-schema.ts',
        'source-evidence.service.ts',
        ...(options.testCapture ? ['test-evidence.service.ts'] : []),
        ...(options.mcp
            ? ['diagnostics-mcp.service.ts', 'diagnostic-query.ts']
            : []),
        ...(remote
            ? [
                'remote-diagnostic-profile.ts',
                'remote-diagnostic-reader.ts',
                'remote-diagnostic-server.ts',
                ...(!options.mcp ? ['diagnostic-query.ts'] : []),
            ]
            : []),
    ];
    const files = await Promise.all(paths.map((path) => bundled('src/modules/diagnostics/' + path)));
    files.push(await bundled('src/core/diagnostics/source-contracts.ts'));
    files.push(await bundled('src/core/diagnostics/evidence-bounds.ts'));
    const producers = [
        ...(sources.includes('workers') ? ['job-diagnostics.service.ts'] : []),
        ...(sources.includes('database')
            ? ['database-diagnostics.service.ts']
            : []),
        ...(sources.includes('infrastructure')
            ? ['infrastructure-diagnostics.service.ts']
            : []),
    ];
    for (const path of producers)
        files.push(await bundled('src/core/diagnostics/' + path));
    if (options.mcp) {
        const launcher = await bundled('scripts/diagnostics-mcp.mjs');
        launcher.content = launcher.content.replace("process.env.EVIDENCE_SOURCES ?? 'application'", `process.env.EVIDENCE_SOURCES ?? '${sources.join(',')}'`);
        files.push(launcher);
    }
    if (remote) {
        for (const path of [
            'scripts/diagnostics-private-profile.mjs',
            'scripts/diagnostics-remote-backend.mjs',
            ...(options.mcp ? ['scripts/diagnostics-remote-mcp.mjs'] : []),
            'ops/diagnostics/remote-client.example.json',
            'ops/diagnostics/remote-backend.example.json',
        ]) {
            const asset = await bundled(path);
            if (path.endsWith('remote-backend.example.json')) {
                const profile = JSON.parse(asset.content);
                profile.sources = sources;
                asset.content = JSON.stringify(profile, null, 2) + '\n';
            }
            files.push(asset);
        }
    }
    if (options.vector) {
        const vector = await bundled('ops/diagnostics/vector.yaml');
        const selectedDatabase = selection(config, 'database');
        const database = selectedDatabase === 'database.mongodb'
            ? 'mongodb'
            : selectedDatabase === 'database.postgres'
                ? 'postgres'
                : undefined;
        const allowedDatabases = database ? `["${database}"]` : '[]';
        vector.content = vector.content
            .replace(/ {4}include:\n[\s\S]*? {4}read_from:/, `    include: [${sources.map((source) => JSON.stringify('/evidence/' + (source === 'application' ? '' : source + '/') + 'events-*.jsonl')).join(', ')}]\n    read_from:`)
            .replace('includes(["application", "workers", "database", "infrastructure", "tests"], selected_source)', `includes(${JSON.stringify(sources)}, selected_source)`)
            .replace('includes(["mongodb", "postgres"], .database)', `includes(${allowedDatabases}, .database)`)
            .replaceAll('"database":"postgres"', `"database":"${database ?? 'postgres'}"`)
            .replace(/ {2}- name: [\s\S]*?(?=\n {2}- name: |$)/g, (block) => {
            const source = block.match(/"source":"(application|workers|database|infrastructure|tests)"/)?.[1];
            const output = block.indexOf('\n    outputs:');
            return source && !sources.includes(source) && output >= 0
                ? block.slice(0, output) + '\n    no_outputs_from: [sanitize]\n'
                : block;
        });
        vector.content = vector.content.replace(/includes\(\["foundation\.nest"[\s\S]*?\], capability\)/, `includes(${JSON.stringify(Object.values(config.capabilities)
            .map((item) => item.recipe)
            .sort())}, capability)`);
        files.push(vector);
    }
    if (options.logdy)
        files.push(await bundled('ops/diagnostics/logdy-live.sh'));
    for (const entry of files)
        entry.content = entry.content.replaceAll('generated-api', config.project.name);
    const producerBindings = [
        ...(sources.includes('workers')
            ? [{ name: 'JobDiagnosticsService', arg: 'jobs', path: 'job' }]
            : []),
        ...(sources.includes('database')
            ? [
                {
                    name: 'DatabaseDiagnosticsService',
                    arg: 'database',
                    path: 'database',
                },
            ]
            : []),
        ...(sources.includes('infrastructure')
            ? [
                {
                    name: 'InfrastructureDiagnosticsService',
                    arg: 'infrastructure',
                    path: 'infrastructure',
                },
            ]
            : []),
    ];
    files.push(file('src/modules/diagnostics/diagnostics.module.ts', `import {Module,type DynamicModule} from '@nestjs/common';
import {DiagnosticReaderService} from './diagnostic-reader.service.js';
import {SourceEvidenceService} from './source-evidence.service.js';
${options.mcp ? "import {DiagnosticsMcpService} from './diagnostics-mcp.service.js';" : ''}
${options.testCapture ? "import {TestEvidenceService} from './test-evidence.service.js';" : ''}
${producerBindings.map((binding) => `import {${binding.name}} from '../../core/diagnostics/${binding.path}-diagnostics.service.js';`).join('\n')}
@Module({})
export class DiagnosticsModule {
static register(diagnostics:SourceEvidenceService,reader:DiagnosticReaderService${producerBindings.map((binding) => `,${binding.arg}:${binding.name}`).join('')}):DynamicModule {
return {module:DiagnosticsModule,providers:[{provide:SourceEvidenceService,useValue:diagnostics},{provide:DiagnosticReaderService,useValue:reader}${producerBindings.map((binding) => `,{provide:${binding.name},useValue:${binding.arg}}`).join('')}${options.testCapture ? ',{provide:TestEvidenceService,useValue:new TestEvidenceService(diagnostics)}' : ''}${options.mcp ? ',DiagnosticsMcpService' : ''}],exports:[SourceEvidenceService,DiagnosticReaderService${producerBindings.map((binding) => ',' + binding.name).join('')}${options.testCapture ? ',TestEvidenceService' : ''}${options.mcp ? ',DiagnosticsMcpService' : ''}]};}}
`));
    if (options.testCapture)
        files.push(diagnosticCheckFile());
    files.push(queryLogsFile());
    return files;
}
function queryLogsFile() {
    return file('src/query-logs.ts', `import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {DiagnosticReaderService} from './modules/diagnostics/diagnostic-reader.service.js';
function emit(value:Record<string,unknown>){console.log(JSON.stringify(value));}
function flag(args:string[],name:string){const index=args.indexOf(name);return index>=0?args[index+1]:undefined;}
const args=process.argv.slice(2);
try{loadSelectedEnvFile();const config=loadConfig();const reader=new DiagnosticReaderService(config.diagnostics,config.environment,{sources:config.diagnostics.sources});
if(args[0]==='status'){const status=await reader.status();emit({schemaVersion:1,status:'completed',retainedFiles:status.retainedFiles,retainedBytes:status.retainedBytes,sources:[...status.sources],unavailableSources:[...status.unavailableSources],gaps:['retention-before-snapshot-unknown']});}
else if(args[0]==='query'){const requestId=flag(args,'--request-id');const operationId=flag(args,'--operation-id');const page=await reader.search({...(requestId?{requestId}:{}),...(operationId?{operationId}:{}),limit:50});emit({schemaVersion:1,status:'completed',truncated:page.truncated,...(page.cursor?{cursor:page.cursor}:{}),sources:[...page.coverage.sources],unavailableSources:[...page.coverage.unavailableSources],gaps:[...page.coverage.gaps],events:page.events.slice(0,50).map((event)=>({timestamp:event.timestamp,event:event.event,severity:event.severity,requestId:event.requestId,operationId:event.operationId,statusCode:event.statusCode,errorCode:event.errorCode,route:event.route,method:event.method,source:event.source,stage:event.stage}))});}
else{emit({schemaVersion:1,status:'failed',code:'INVALID_LOG_QUERY',next:'vcli logs status'});process.exitCode=1;}}
catch{emit({schemaVersion:1,status:'failed',code:'LOG_QUERY_FAILED',next:'vcli logs status'});process.exitCode=1;}
`);
}
function diagnosticCheckFile() {
    return file('src/run-diagnostic-check.ts', `import {randomUUID} from 'node:crypto';
import type {AddressInfo} from 'node:net';
import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {createApp,type ApplicationRuntime} from './create-app.js';
import {SourceEvidenceService} from './modules/diagnostics/source-evidence.service.js';
import {TestEvidenceService} from './modules/diagnostics/test-evidence.service.js';
let evidence:SourceEvidenceService|undefined;
try {loadSelectedEnvFile();const config=loadConfig();evidence=await SourceEvidenceService.open(config.diagnostics,config.environment,['tests']);const capture=new TestEvidenceService(evidence);let runtime:ApplicationRuntime|undefined;
const result=await capture.capture({runId:randomUUID(),operationId:randomUUID()},async()=>{
runtime=await createApp({...config,diagnostics:{...config.diagnostics,sources:config.diagnostics.sources.filter(source=>source!=='tests')}});
await runtime.app.listen(0,'127.0.0.1');const address=runtime.app.getHttpServer().address() as AddressInfo;
const response=await fetch('http://127.0.0.1:'+address.port+'/health/ready',{signal:AbortSignal.timeout(5000)});
const passed=response.status===200;
return {assertions:[{check:'http-status',ordinal:0,outcome:passed?'passed':'failed',code:passed?'MATCH':'MISMATCH'}],artifacts:[]};
},{flush:()=>evidence!.flush(),stopOwned:async()=>{if(runtime)await runtime.close();return true;}});
console.log(JSON.stringify({outcome:result.outcome,logsComplete:result.logsComplete,cleanupComplete:result.cleanupComplete,resultRetained:result.resultRetained}));
if(result.outcome!=='passed'||!result.cleanupComplete||!result.resultRetained)process.exitCode=1;
}catch{console.error('DIAGNOSTIC_CHECK_FAILED');process.exitCode=1;}finally{await evidence?.close();}
`);
}
//# sourceMappingURL=render-diagnostics.js.map