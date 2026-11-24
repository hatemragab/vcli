/**
 * Mail-free username auth example: inject a private, shared-tab session store and Web Locks.
 * store.read(): session|null; store.write(session|null):Promise<void>.
 * Keep installationCapability separately in device-private storage. Never log these values.
 * No email verification or forgotten-password recovery is provided.
 * Every tab sharing a refresh session MUST use the same store and lock name.
 * A non-browser client can provide an equivalent process/device-wide mutex.
 */
export class LocalAuthClient {
  #refreshing;
  constructor({
    origin,
    store,
    locks = globalThis.navigator?.locks,
    fetch: request = globalThis.fetch,
    lockName = 'vcli-local-auth',
  }) {
    this.origin = new URL(origin).origin;
    this.store = store;
    this.locks = locks;
    this.request = request;
    this.lockName = lockName;
    if (!locks?.request) throw new Error('SHARED_SESSION_MUTEX_REQUIRED');
  }
  async #post(path, body) {
    const response = await this.request(this.origin + '/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        response.status === 429 ? 'RETRY_LATER' : 'AUTH_REQUEST_FAILED',
      );
    return response.json();
  }
  async login(
    username,
    password,
    installationCapability,
    { platform = 'web', allowRebind = false } = {},
  ) {
    return this.locks.request(this.lockName, async () => {
      const session = await this.#post('/identity/local/login', {
        username,
        password,
        installationCapability,
        platform,
        allowRebind,
      });
      await this.store.write(session);
      return {
        sessionId: session.sessionId,
        installationId: session.installationId,
        installationGeneration: session.installationGeneration,
      };
    });
  }
  async refresh() {
    if (this.#refreshing) return this.#refreshing;
    const started = await this.store.read();
    if (!started) throw new Error('REAUTHENTICATION_REQUIRED');
    this.#refreshing = this.locks.request(this.lockName, async () => {
      const current = await this.store.read();
      if (!current) throw new Error('REAUTHENTICATION_REQUIRED');
      // A different tab finished this refresh or an independent login while this tab waited.
      if (current.refreshToken !== started.refreshToken) return current;
      try {
        const successor = await this.#post('/identity/local/refresh', {
          refreshToken: current.refreshToken,
        });
        await this.store.write(successor);
        return successor;
      } catch {
        // A lost response may have consumed the token. Never retry it: strict reuse revokes this family.
        await this.store.write(null);
        throw new Error('REAUTHENTICATION_REQUIRED');
      }
    });
    try {
      return await this.#refreshing;
    } finally {
      this.#refreshing = undefined;
    }
  }
  async headers(now = Date.now()) {
    let session = await this.store.read();
    if (!session) throw new Error('REAUTHENTICATION_REQUIRED');
    if (session.expiresAt <= now + 10000) session = await this.refresh();
    return { Authorization: 'Bearer ' + session.accessToken };
  }
  async register(username, password) {
    return this.#post('/identity/local/register', { username, password });
  }
  async sessions() {
    const response = await this.request(this.origin + '/api/sessions', {
      headers: await this.headers(),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('SESSION_REQUEST_FAILED');
    return response.json();
  }
  async revoke(scope, sessionId) {
    if (!['current', 'selected', 'others', 'all'].includes(scope))
      throw new Error('INVALID_REVOKE_SCOPE');
    const response = await this.request(this.origin + '/api/sessions/revoke', {
      method: 'POST',
      headers: {
        ...(await this.headers()),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        scope,
        ...(scope === 'selected' ? { sessionId } : {}),
      }),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new Error('SESSION_REQUEST_FAILED');
    if (scope === 'current' || scope === 'all')
      await this.locks.request(this.lockName, () => this.store.write(null));
    return response.json();
  }
  async selfAction(action, password) {
    if (!['disable', 'delete'].includes(action))
      throw new Error('INVALID_SELF_ACTION');
    const response = await this.request(
      this.origin + '/api/accounts/me/' + action,
      {
        method: 'POST',
        headers: {
          ...(await this.headers()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm: action, password }),
        cache: 'no-store',
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('SELF_ACTION_FAILED');
    await this.locks.request(this.lockName, () => this.store.write(null));
    return response.json();
  }
  async rotateInstallation(
    installationCapability,
    newInstallationCapability,
    password,
  ) {
    const response = await this.request(
      this.origin + '/api/identity/installations/rotate',
      {
        method: 'POST',
        headers: {
          ...(await this.headers()),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirm: 'rotate-installation',
          installationCapability,
          newInstallationCapability,
          password,
        }),
        cache: 'no-store',
        redirect: 'error',
      },
    );
    if (!response.ok) throw new Error('INSTALLATION_ROTATION_FAILED');
    await this.locks.request(this.lockName, () => this.store.write(null));
    // Persist the new capability before the request so a lost response can recover by fresh login.
    return response.json();
  }
}
export function createPrivateCapability() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
