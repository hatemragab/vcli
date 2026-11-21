import { createHash } from 'node:crypto';
/** Native tools profile currently supports an explicit single seed or SRV URI. */
export function nativeDatabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_NATIVE_DATABASE_URL');
  }
  const name = decodeURIComponent(url.pathname.slice(1)),
    host = url.hostname.toLowerCase(),
    port = url.port || (url.protocol === 'mongodb+srv:' ? 'srv' : '27017');
  if (
    !['mongodb:', 'mongodb+srv:'].includes(url.protocol) ||
    !host ||
    host.includes(',') ||
    !/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(name) ||
    ['admin', 'config', 'local'].includes(name) ||
    url.hash ||
    /[\r\n\0]/.test(value) ||
    [...url.searchParams.keys()].some(
      (key) =>
        ![
          'replicaSet',
          'directConnection',
          'tls',
          'authSource',
          'readPreference',
          'retryWrites',
        ].includes(key),
    ) ||
    (url.searchParams.has('readPreference') &&
      url.searchParams.get('readPreference') !== 'primary')
  )
    throw new Error('UNSUPPORTED_NATIVE_DATABASE_URL');
  const identity = createHash('sha256')
    .update(JSON.stringify({ host, port, name }))
    .digest('hex');
  const restoreUrl = new URL(url);
  restoreUrl.pathname = '/';
  // Removing the URI database must not silently change its authentication database.
  if (url.username && !restoreUrl.searchParams.has('authSource'))
    restoreUrl.searchParams.set('authSource', name);
  return { name, identity, restoreUrl: restoreUrl.href };
}
