import type { OpenAPIObject } from '@nestjs/swagger';
export function applyOpenApiSecurity(document: OpenAPIObject): void {
  for (const [path, item] of Object.entries(document.paths)) {
    if (!item || !path.startsWith('/api/')) continue;
    const publicIdentity =
      (path.startsWith('/api/identity/local/') &&
        path !== '/api/identity/local/password/change') ||
      path === '/api/identity/firebase/bootstrap' ||
      path === '/api/identity/firebase/actions/reset/request';
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

      if (publicIdentity) operation.security = [];
      else operation.security = [{ bearer: [] }];
    }
  }
}
