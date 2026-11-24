import { createHash } from 'node:crypto';
/** Deliberately bounded libpq profile; unsupported connection options fail before native execution. */
export function nativeDatabaseUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_NATIVE_DATABASE_URL');
  }
  const name = decodeURIComponent(url.pathname.slice(1)),
    user = decodeURIComponent(url.username),
    password = decodeURIComponent(url.password),
    host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase(),
    port = url.port || '5432';
  const sslmode = url.searchParams.get('sslmode') ?? 'prefer';
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !host ||
    !/^[a-zA-Z0-9:.-]+$/.test(host) ||
    !/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(name) ||
    !/^[a-zA-Z_][a-zA-Z0-9_-]{0,62}$/.test(user) ||
    /[\r\n\0]/.test(password) ||
    url.hash ||
    [...url.searchParams.keys()].some((key) => key !== 'sslmode') ||
    ![
      'disable',
      'allow',
      'prefer',
      'require',
      'verify-ca',
      'verify-full',
    ].includes(sslmode)
  )
    throw new Error('UNSUPPORTED_NATIVE_DATABASE_URL');
  const identity = createHash('sha256')
    .update(JSON.stringify({ host, port, name }))
    .digest('hex');
  return { name, user, password, host, port, sslmode, identity };
}
