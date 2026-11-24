import type { ProjectConfig, RenderedFile } from '../contracts.js';
import { bundled, file } from './bundle.js';
import { basicLocalAuth, selection } from './selection.js';

/** Document selected runtime security without importing another feature's models. */
export async function httpDocsFiles(
  config: ProjectConfig,
): Promise<RenderedFile[]> {
  const firebase = selection(config, 'auth') === 'auth.firebase';
  const centrifugo = selection(config, 'realtime') === 'realtime.centrifugo';
  const selectedSecurity = file(
    'src/core/http/openapi-security.ts',
    `import type {OpenAPIObject} from '@nestjs/swagger';
export function applyOpenApiSecurity(document:OpenAPIObject):void {
for(const [path,item] of Object.entries(document.paths)) {
if(!item||!path.startsWith('/api/'))continue;
const publicIdentity=${basicLocalAuth(config) ? "path==='/api/identity/local/register'||path==='/api/identity/local/login'" : "(path.startsWith('/api/identity/local/')&&path!=='/api/identity/local/password/change')||path==='/api/identity/firebase/bootstrap'||path==='/api/identity/firebase/actions/reset/request'"};
for(const method of ['get','post','put','patch','delete','head','options'] as const){
const operation=item[method];if(!operation)continue;
${centrifugo ? "if(path==='/api/realtime/centrifugo/connect'||path==='/api/realtime/centrifugo/refresh')operation.security=[{centrifugoProxy:[]}];else " : ''}
if(publicIdentity)operation.security=[];else operation.security=[{bearer:[]${firebase ? ',appSession:[]' : ''}}];
}}}
`,
    'scaffold',
  );
  return [
    selectedSecurity,
    await bundled('src/core/http/openapi-contract.ts'),
    ...(selection(config, 'notes') ||
    selection(config, 'push-fcm') ||
    selection(config, 'push-apns')
      ? [await bundled('clients/api-error.mjs')]
      : []),
  ];
}
