import { createReferenceApp } from '../dist/create-reference-app.js';
import {
  loadConfig,
  loadSelectedEnvFile,
} from '../dist/core/config/load-config.js';
import { createTestMailCapture } from '../dist/modules/mail/mail.module.js';

loadSelectedEnvFile();
const config = loadConfig();
const isLocalMongo = (url: string): boolean => {
  try {
    const database = new URL(url);
    return (
      database.protocol === 'mongodb:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(database.hostname)
    );
  } catch {
    return false;
  }
};
if (
  config.environment === 'production' ||
  !isLocalMongo(config.database.url) ||
  config.auth.driver !== 'local' ||
  config.mail.driver !== 'capture'
)
  throw new Error('DEMO_REQUIRES_PREPARED_LOCAL_MONGODB_PROFILE');
const capture = createTestMailCapture(20, Date.now);
const runtime = await createReferenceApp(config, {
  mail: capture.sender,
}).catch(() => {
  capture.clear();
  throw new Error('DEMO_INITIALIZATION_FAILED');
});
try {
  await runtime.app.listen(config.port, config.host);
  const base = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + '/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const credentials = {
    email: 'review@example.invalid',
    password: 'Review-local-2026!Change',
  };
  // On restart the persistent disposable fixture may already be verified. A real login
  // proves it still has the expected credential; no database reset or proof bypass occurs.
  const login = await post('/identity/local/login', credentials);
  if (login.status !== 200) {
    if (![401, 403].includes(login.status))
      throw new Error('DEMO_INITIALIZATION_FAILED');
    const registration = await post('/identity/local/register', credentials);
    if (registration.status !== 202)
      throw new Error('DEMO_INITIALIZATION_FAILED');
    // Explicitly simulate email receipt through private capture for initial seeding.
    const message = capture
      .inspect()
      .find((item) => item.message.purpose === 'verification');
    const token = message?.message.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error('DEMO_ACTION_NOT_CAPTURED');
    const confirmation = await post('/identity/local/verification/confirm', {
      token,
      password: credentials.password,
    });
    if (!confirmation.ok) throw new Error('DEMO_INITIALIZATION_FAILED');
  }
  capture.clear();
  console.info(
    `Reference demo ready: ${base}/reference (disposable fixture account; external verification pending)`,
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void runtime.close().catch(() => {
        process.exitCode = 1;
      });
    });
} catch (error: unknown) {
  capture.clear();
  await runtime.close();
  throw error;
}
