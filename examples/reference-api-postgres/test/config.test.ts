import assert from 'node:assert/strict';
import test from 'node:test';
import { configDatabaseUrl } from './helpers/postgres-fixture.ts';
import { loadConfig } from '../dist/core/config/load-config.js';

test('PostgreSQL profile requires its URL and rejects unsafe production configuration', () => {
  const config = loadConfig({ DATABASE_URL: configDatabaseUrl });
  assert.equal(config.database.driver, 'postgres');
  assert.equal(config.auth.driver, 'local');
  assert.equal(config.storage.driver, 'local');
  assert.deepEqual(config.auth.firebaseMethods, [
    'password',
    'phone',
    'google.com',
    'apple.com',
  ]);
  assert.throws(
    () =>
      loadConfig({ NODE_ENV: 'production', DATABASE_URL: configDatabaseUrl }),
    /UNSAFE_PRODUCTION_PROFILE/,
  );
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
  assert.throws(
    () =>
      loadConfig({ DATABASE_URL: configDatabaseUrl, AUTH_DRIVER: 'firebase' }),
    /FIREBASE_PROJECT_ID/,
  );
  assert.throws(
    () => loadConfig({ DATABASE_URL: configDatabaseUrl, STORAGE_DRIVER: 's3' }),
    /S3_BUCKET/,
  );
  assert.throws(
    () =>
      loadConfig({
        DATABASE_URL: configDatabaseUrl,
        FIREBASE_METHODS: 'arbitrary-provider',
      }),
    /FIREBASE_METHODS/,
  );
});

test('selected production profile requires only its declared providers', () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://example.invalid/reference',
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
        DATABASE_URL: 'postgresql://example.invalid/reference',
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
    () => loadConfig({ DATABASE_URL: configDatabaseUrl, JWT_SECRET: sentinel }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /JWT_SECRET/);
      assert.ok(!error.message.includes(sentinel));
      return true;
    },
  );
});

test('database driver cannot select another implementation and URLs must be PostgreSQL', () => {
  for (const DATABASE_DRIVER of ['postgres', 'memory', 'mongodb'])
    assert.throws(
      () => loadConfig({ DATABASE_URL: configDatabaseUrl, DATABASE_DRIVER }),
      /DATABASE_DRIVER/,
    );
  assert.throws(
    () => loadConfig({ DATABASE_URL: 'https://unused.invalid' }),
    /DATABASE_URL/,
  );
  assert.throws(() => loadConfig({}), /DATABASE_URL/);
});
