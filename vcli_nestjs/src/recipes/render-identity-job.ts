import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { file } from './bundle.js';
import { selection } from './selection.js';

/** A finite operator command; API startup never drains remote cleanup intents. */
export function identityJobFiles(config: ProjectConfig): RenderedFile[] {
  if (selection(config, 'auth') !== 'auth.firebase') return [];
  const application =
    config.capabilities.auth?.options.actionDelivery === 'application';
  return [
    file(
      'src/drain-identity-cleanup.ts',
      `import 'reflect-metadata';
import {loadConfig,loadSelectedEnvFile} from './core/config/load-config.js';
import {openDatabase} from './core/database/database.js';
import {assertSelectedReleaseReady} from './generated/selected-release.js';
import {createIdentityRuntime,type IdentityRuntime} from './modules/identity/identity.module.js';
${application ? "import {createMailRuntime,type MailRuntime} from './modules/mail/mail.module.js';" : ''}
async function drain(args:readonly string[]):Promise<void>{
if(args.length!==0&&(args.length!==2||args[0]!=='--limit'||!/^\\d{1,2}$/.test(args[1]!)))throw new Error('INVALID_IDENTITY_CLEANUP_ARGUMENTS');
const limit=args.length?Number(args[1]):10;
if(limit<1||limit>20)throw new Error('INVALID_IDENTITY_CLEANUP_ARGUMENTS');
loadSelectedEnvFile();const config=loadConfig();
const database=await openDatabase(config,true);
let identity:IdentityRuntime|undefined;${application ? 'let mail:MailRuntime|undefined;' : ''}
let result:Readonly<{processed:number;completed:number}>;let cleanupFailed:boolean;
try{await assertSelectedReleaseReady(database);${application ? 'mail=createMailRuntime(config,database);' : ''}
identity=await createIdentityRuntime(config,database${application ? ',mail.intents' : ''});
result=await identity.cleanup.drain(limit);
}finally{const closed=await Promise.allSettled([identity?.close()??Promise.resolve(),${application ? 'mail?.close()??Promise.resolve(),' : ''}database.close()]);cleanupFailed=closed.some(item=>item.status==='rejected');}
if(cleanupFailed)throw new Error('IDENTITY_CLEANUP_CLOSE_FAILED');
process.stdout.write(JSON.stringify(result)+'\\n');
}
void drain(process.argv.slice(2)).catch(()=>{process.stderr.write('IDENTITY_CLEANUP_FAILED\\n');process.exitCode=1;});
`,
    ),
  ];
}
