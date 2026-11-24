import type { OpenAPIObject } from '@nestjs/swagger';
/** Document the security already enforced by selected transport adapters. */
export function applyOpenApiSecurity(
  document: OpenAPIObject,
  authentication: 'firebase' | 'local',
): void {
  for (const [path, item] of Object.entries(document.paths)) {
    if (!item || !path.startsWith('/api/')) continue;
    const publicIdentity =
      (path.startsWith('/api/identity/local/') &&
        path !== '/api/identity/local/password/change') ||
      path === '/api/identity/firebase/bootstrap';
    for (const method of [
      'get',
      'post',
      'put',
      'patch',
      'delete',
      'head',
      'options',
    ] as const) {
      const operation = item[method];
      if (!operation) continue;
      if (path.startsWith('/api/realtime/centrifugo/'))
        operation.security = [{ centrifugoProxy: [] }];
      else if (publicIdentity) operation.security = [];
      else
        operation.security =
          authentication === 'firebase'
            ? [{ bearer: [], appSession: [] }]
            : [{ bearer: [] }];
    }
  }
}
