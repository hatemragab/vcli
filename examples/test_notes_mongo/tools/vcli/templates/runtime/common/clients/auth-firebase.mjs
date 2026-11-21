/**
 * Executable Firebase modular-SDK example. Inject the configured SDK/auth plus private
 * store.read()/write(enrollment|null), with one store per intended app session.
 * Keep installationCapability in separate device-private storage. ID tokens and capabilities
 * must never appear in query strings, analytics, logs or generic browser error reports.
 * Configure email/password, phone/reCAPTCHA, Google and Apple in the same Firebase project;
 * supply native SHA/APNs/Apple association and redirect setup for each intended client.
 * Real sign-in/client/device acceptance remains external; this asset does not simulate providers.
 */
export class FirebaseAuthClient {
  #bootstrapping;
  constructor({ origin, sdk, auth, store, fetch: request = globalThis.fetch }) {
    this.origin = new URL(origin).origin;
    this.sdk = sdk;
    this.auth = auth;
    this.store = store;
    this.request = request;
  }
  async emailPassword(email, password) {
    return this.sdk.signInWithEmailAndPassword(this.auth, email, password);
  }
  async phone(number, recaptchaVerifier) {
    // UI obtains the SMS code and calls confirmation.confirm(code), then bootstrap().
    return this.sdk.signInWithPhoneNumber(this.auth, number, recaptchaVerifier);
  }
  async google() {
    return this.sdk.signInWithPopup(
      this.auth,
      new this.sdk.GoogleAuthProvider(),
    );
  }
  async apple() {
    return this.sdk.signInWithPopup(
      this.auth,
      new this.sdk.OAuthProvider('apple.com'),
    );
  }
  async #post(path, body, authenticated = false) {
    const headers = {
      'Content-Type': 'application/json',
      ...(authenticated ? await this.headers() : {}),
    };
    const response = await this.request(this.origin + '/api' + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok)
      throw new Error(
        response.status === 503
          ? 'FIREBASE_UNAVAILABLE'
          : 'FIREBASE_AUTH_REQUEST_FAILED',
      );
    return response.json();
  }
  async bootstrap(installationCapability, options = {}) {
    if (this.#bootstrapping) return this.#bootstrapping;
    this.#bootstrapping = this.bootstrapOnce(installationCapability, options);
    try {
      return await this.#bootstrapping;
    } finally {
      this.#bootstrapping = undefined;
    }
  }
  async beginNewSession(reauthenticate) {
    if (!this.auth.currentUser) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(this.auth.currentUser);
    await this.store.write(null);
  }
  async bootstrapOnce(
    installationCapability,
    { platform = 'web', allowRebind = false } = {},
  ) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    let enrollment = await this.store.read();
    if (enrollment && enrollment.uid !== user.uid)
      throw new Error('EXPLICIT_SESSION_SWITCH_REQUIRED');
    if (!enrollment) {
      enrollment = {
        uid: user.uid,
        sessionCapability: createPrivateCapability(),
        installationCapability,
      };
      // Persist BEFORE the first request. Retries, including a lost response, reuse these exact values.
      await this.store.write(enrollment);
    }
    if (enrollment.installationCapability !== installationCapability)
      throw new Error('INSTALLATION_PROOF_CHANGED');
    const facts = await this.#post('/identity/firebase/bootstrap', {
      idToken: await this.sdk.getIdToken(user),
      sessionCapability: enrollment.sessionCapability,
      installationCapability,
      platform,
      allowRebind,
    });
    await this.store.write({ ...enrollment, facts });
    return facts;
  }
  async headers() {
    const enrollment = await this.store.read(),
      user = this.auth.currentUser;
    if (!enrollment || !user || enrollment.uid !== user.uid)
      throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    return {
      Authorization: 'Bearer ' + (await this.sdk.getIdToken(user)),
      'X-Session-Token': enrollment.sessionCapability,
    };
  }
  async linkCredential(credential, reauthenticate) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(user); // UI-selected Firebase reauthenticateWithCredential/Popup/PhoneNumber.
    await this.sdk.linkWithCredential(user, credential);
    const idToken = await this.sdk.getIdToken(user, true);
    return this.#post(
      '/identity/firebase/providers/link',
      { confirm: 'link', idToken, targetIdToken: idToken },
      true,
    );
  }
  async linkPopup(provider, reauthenticate) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(user);
    await this.sdk.linkWithPopup(user, provider);
    const idToken = await this.sdk.getIdToken(user, true);
    return this.#post(
      '/identity/firebase/providers/link',
      { confirm: 'link', idToken, targetIdToken: idToken },
      true,
    );
  }
  async unlink(method, reauthenticate) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(user);
    const idToken = await this.sdk.getIdToken(user, true);
    // Backend enforces remaining recovery and stages durable cleanup BEFORE any remote unlink.
    return this.#post(
      '/identity/firebase/providers/unlink',
      { confirm: 'unlink', idToken, targetIdToken: idToken, method },
      true,
    );
  }
  async selfAction(action, reauthenticate) {
    if (!['disable', 'delete'].includes(action))
      throw new Error('INVALID_SELF_ACTION');
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(user);
    const result = await this.#post(
      '/accounts/me/' + action,
      { confirm: action, idToken: await this.sdk.getIdToken(user, true) },
      true,
    );
    await this.store.write(null);
    await this.sdk.signOut(this.auth);
    return result;
  }
  async rotateInstallation(
    installationCapability,
    newInstallationCapability,
    reauthenticate,
  ) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(user);
    const result = await this.#post(
      '/identity/installations/rotate',
      {
        confirm: 'rotate-installation',
        idToken: await this.sdk.getIdToken(user, true),
        installationCapability,
        newInstallationCapability,
      },
      true,
    );
    await this.store.write(null);
    return result; // Fresh bootstrap must use a NEW session capability and the new installation capability.
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
    const result = await this.#post(
      '/sessions/revoke',
      { scope, ...(scope === 'selected' ? { sessionId } : {}) },
      true,
    );
    if (scope === 'current' || scope === 'all') await this.store.write(null);
    return result;
  }
  async logout() {
    await this.#post('/sessions/revoke', { scope: 'current' }, true);
    await this.store.write(null);
    await this.sdk.signOut(this.auth); // Client sign-out only; siblings do not receive account-wide revoke.
  }
  async requestApplicationVerification(reauthenticate) {
    const user = this.auth.currentUser;
    if (!user) throw new Error('FIREBASE_SIGN_IN_REQUIRED');
    await reauthenticate(user);
    return this.#post(
      '/identity/firebase/actions/verification/request',
      { idToken: await this.sdk.getIdToken(user, true) },
      true,
    );
  }
  async requestApplicationReset(email) {
    return this.#post('/identity/firebase/actions/reset/request', { email });
  }
  // Provider-managed actions and handlers are in the selected mail-firebase-actions.mjs asset.
}
export function createPrivateCapability() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}
