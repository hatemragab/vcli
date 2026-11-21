import type { OperatorOptions, TargetProfile } from './types.js';
import { fail, httpsUrl, record } from './validation.js';

/** Fixed-origin native HTTP only; no ambient env, retries, redirects or response/error logging. */
export class NativeHttp {
  private readonly fetcher: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  constructor(
    private readonly profile: TargetProfile,
    options: OperatorOptions = {},
  ) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.timeoutMs = options.timeoutMs ?? 15000;
    if (
      !Number.isInteger(this.timeoutMs) ||
      this.timeoutMs < 10 ||
      this.timeoutMs > 30000
    )
      fail('INVALID_OPERATOR_TIMEOUT');
    httpsUrl(profile.origin, true);
  }
  async request(
    path: string,
    method: 'GET' | 'POST' | 'PATCH' = 'GET',
    body?: unknown,
    plain = false,
  ): Promise<unknown> {
    if (
      !path.startsWith('/api/') ||
      path.startsWith('//') ||
      path.includes('..') ||
      path.includes('#')
    )
      fail('INVALID_NATIVE_PATH');
    const url = new URL(path, this.profile.origin);
    if (url.origin !== this.profile.origin) fail('TARGET_ORIGIN_DRIFT');
    const headers: Record<string, string> = {
      accept: 'application/json',
      'content-type': 'application/json',
    };
    if (this.profile.target === 'dokploy')
      headers['x-api-key'] = this.profile.token;
    else if (this.profile.target === 'coolify')
      headers.authorization = 'Bearer ' + this.profile.token;
    else {
      headers['x-captain-auth'] = this.profile.token;
      headers['x-namespace'] = this.profile.scope.namespace;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetcher(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        credentials: 'omit',
        signal: controller.signal,
      });
      if (
        response.redirected ||
        (response.url && new URL(response.url).origin !== this.profile.origin)
      )
        fail('TARGET_ORIGIN_DRIFT');
      const text = await boundedBody(response, 1024 * 1024);
      if (response.status === 401 || response.status === 403)
        fail('DEPLOYMENT_AUTHORITY_DENIED');
      if (!response.ok) fail('NATIVE_REQUEST_REJECTED');
      if (plain) return text;
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        fail('INVALID_NATIVE_RESPONSE');
      }
      if (this.profile.target === 'caprover') {
        const envelope = record(data);
        if (envelope.status === 1102 || envelope.status === 1106)
          fail('DEPLOYMENT_AUTHORITY_DENIED');
        if (envelope.status !== 100 && envelope.status !== 101)
          fail('NATIVE_REQUEST_REJECTED');
        return envelope.data ?? null;
      }
      return data;
    } catch (error) {
      if (
        error instanceof Error &&
        [
          'TARGET_ORIGIN_DRIFT',
          'DEPLOYMENT_AUTHORITY_DENIED',
          'NATIVE_REQUEST_REJECTED',
          'INVALID_NATIVE_RESPONSE',
          'NATIVE_RESPONSE_LIMIT',
        ].includes(error.message)
      )
        throw error;
      fail('NATIVE_OUTCOME_UNKNOWN');
    } finally {
      clearTimeout(timer);
    }
  }
  get(name: string, input?: Record<string, unknown>): Promise<unknown> {
    return this.request(
      '/api/' +
        name +
        (input
          ? '?' +
            new URLSearchParams(
              Object.entries(input)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)]),
            ).toString()
          : ''),
    );
  }
  post(name: string, body: unknown): Promise<unknown> {
    return this.request('/api/' + name, 'POST', body);
  }
}
export async function boundedBody(
  response: Response,
  limit: number,
): Promise<string> {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    fail('NATIVE_RESPONSE_LIMIT');
  }
  if (!response.body) return '';
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) fail('NATIVE_RESPONSE_LIMIT');
      parts.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return Buffer.concat(parts).toString('utf8');
}
