import { createReferenceApp } from '../dist/create-reference-app.js';
import {
  loadConfig,
  loadSelectedEnvFile,
} from '../dist/core/config/load-config.js';
import { createTestMailCapture } from '../dist/modules/mail/mail.module.js';

loadSelectedEnvFile();
const config = loadConfig();
if (
  config.environment === 'production' ||
  config.auth.driver !== 'local' ||
  config.mail.driver !== 'capture'
)
  throw new Error('DEMO_REQUIRES_LOCAL_POSTGRES_AND_CAPTURE');
const capture = createTestMailCapture(20, Date.now);
const runtime = await createReferenceApp(config, { mail: capture.sender });
try {
  await runtime.app.listen(config.port, config.host);
  const base = `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${config.port}`;
  const post = async (path: string, body: unknown) =>
    fetch(base + '/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  // Disposable, non-production fixture only. An existing verified fixture can
  // authenticate on restart; never reset data or expose captured proofs over HTTP.
  const credentials = {
    email: 'review@example.invalid',
    password: 'Review-local-2026!Change',
  };
  const login = () =>
    post('/identity/local/login', { ...credentials, platform: 'web' });
  if (!(await login()).ok) {
    if (!(await post('/identity/local/register', credentials)).ok)
      throw new Error('DEMO_INITIALIZATION_FAILED');
    const message = capture
      .inspect()
      .find(
        (item) =>
          item.message.to === credentials.email &&
          item.message.purpose === 'verification',
      );
    const token = message?.message.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (!token)
      throw new Error('DEMO_FIXTURE_REQUIRES_EXPECTED_DISPOSABLE_CREDENTIAL');
    if (
      !(
        await post('/identity/local/verification/confirm', {
          token,
          password: credentials.password,
        })
      ).ok
    )
      throw new Error('DEMO_INITIALIZATION_FAILED');
    if (!(await login()).ok) throw new Error('DEMO_INITIALIZATION_FAILED');
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
  await runtime.close();
  throw error;
}
