import assert from 'node:assert/strict';
import { test } from 'node:test';
import { databaseError } from '../dist/core/database/database-errors.js';
import { ApplicationError } from '../dist/core/errors/application-error.js';

const rejectsCode = (expected: string) => (error: unknown) =>
  error instanceof ApplicationError && error.code === expected;

test('database error mapping fails closed for null, primitive and malformed driver errors', () => {
  const errors: readonly unknown[] = [
    null,
    undefined,
    'database failure',
    42,
    {},
    { code: null },
    { code: {} },
    { cause: null },
    { hasErrorLabel: true },
    { hasErrorLabel: 'UnknownTransactionCommitResult' },
  ];
  for (const error of errors)
    assert.throws(
      () => databaseError(error),
      rejectsCode('DATABASE_UNAVAILABLE'),
    );
});

test('database mapping preserves application failures and known duplicate conflicts', () => {
  const error = new ApplicationError('INVALID_TRANSACTION_CONTEXT', 500);
  assert.throws(
    () => databaseError(error),
    (caught: unknown) => caught === error,
  );
  for (const code of ['23505'])
    assert.throws(
      () => databaseError({ code }),
      rejectsCode('IDENTITY_EXISTS'),
    );
});

test('PostgreSQL transaction label-like objects are malformed database errors', () => {
  assert.throws(
    () => databaseError({ hasErrorLabel: () => true }),
    rejectsCode('DATABASE_UNAVAILABLE'),
  );
});
