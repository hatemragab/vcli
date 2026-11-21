import { file } from './bundle.js';
import { selection } from './selection.js';
/** Document selected runtime security without importing another feature's models. */
export function httpDocsFile(config) {
    const firebase = selection(config, 'auth') === 'auth.firebase';
    const centrifugo = selection(config, 'realtime') === 'realtime.centrifugo';
    return file('src/core/http/openapi-security.ts', `import type {OpenAPIObject} from '@nestjs/swagger';
export function applyOpenApiSecurity(document:OpenAPIObject):void {
for(const [path,item] of Object.entries(document.paths)) {
if(!item||!path.startsWith('/api/'))continue;
const publicIdentity=(path.startsWith('/api/identity/local/')&&path!=='/api/identity/local/password/change')||path==='/api/identity/firebase/bootstrap'||path==='/api/identity/firebase/actions/reset/request';
for(const method of ['get','post','put','patch','delete','head','options'] as const){
const operation=item[method];if(!operation)continue;
${centrifugo ? "if(path==='/api/realtime/centrifugo/connect'||path==='/api/realtime/centrifugo/refresh')operation.security=[{centrifugoProxy:[]}];else " : ''}
if(publicIdentity)operation.security=[];else operation.security=[{bearer:[]${firebase ? ',appSession:[]' : ''}}];
}}}
`, 'scaffold');
}
//# sourceMappingURL=render-http-docs.js.map