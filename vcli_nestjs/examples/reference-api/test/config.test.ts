import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../dist/core/config/load-config.js';
test('default profile is a local demo and rejects unsafe production configuration', () => {
  const config = loadConfig({});
  assert.equal(config.database.driver, 'mongodb');
  assert.equal(config.auth.driver, 'local');
  assert.equal(config.storage.driver, 'local');
  assert.deepEqual(config.auth.firebaseMethods, [
    'password',
    'phone',
    'google.com',
    'apple.com',
  ]);
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production' }),
    /DATABASE_URL_REQUIRED/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_DRIVER: 'postgres' }),
    /LEGACY_DATABASE_SELECTION_UNSUPPORTED/,
  );
  assert.throws(
    () => loadConfig({ AUTH_DRIVER: 'firebase' }),
    /FIREBASE_PROJECT_ID/,
  );
  assert.throws(() => loadConfig({ STORAGE_DRIVER: 's3' }), /S3_BUCKET/);
  assert.throws(
    () => loadConfig({ FIREBASE_METHODS: 'arbitrary-provider' }),
    /FIREBASE_METHODS/,
  );
});
test('selected production profile requires only its declared providers', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'mongodb://example.invalid/reference',
    AUTH_DRIVER: 'firebase',
    FIREBASE_PROJECT_ID: 'reference-project',
    JWT_SECRET: '',
    STORAGE_DRIVER: 'local',
    MAIL_DRIVER: 'smtp',
    SMTP_HOST: 'smtp.example.invalid',
  });
  assert.equal(config.auth.driver, 'firebase');
  assert.equal(config.auth.jwtSecret, undefined);
  assert.equal(config.storage.driver, 'local');
  assert.equal(config.push.apnsEnabled, false);
  assert.throws(
    () =>
      loadConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'mongodb://example.invalid/reference',
        AUTH_DRIVER: 'local',
        JWT_SECRET: '',
        MAIL_DRIVER: 'smtp',
        SMTP_HOST: 'smtp.example.invalid',
      }),
    /JWT_SECRET/,
  );
});
test('invalid configuration errors name keys without revealing secret values', () => {
  const sentinel = 'sensitive-test-sentinel';
  assert.throws(
    () => loadConfig({ JWT_SECRET: sentinel }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /JWT_SECRET/);
      assert.ok(!error.message.includes(sentinel));
      return true;
    },
  );
});
