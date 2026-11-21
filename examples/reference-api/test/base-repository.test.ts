import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '../dist/core/config/load-config.js';
import { openDatabase } from '../dist/core/database/database.js';
import { BaseRepository } from '../dist/core/database/base-repository.js';
import type { TransactionContext } from '../dist/core/database/transaction-context.js';
import { AccountService } from '../dist/modules/accounts/account.service.js';
import { InstallationService } from '../dist/modules/installations/installation.service.js';
import { SessionService } from '../dist/modules/sessions/session.service.js';
import type { Account } from '../dist/modules/accounts/account.entity.js';
const code = (expected: string) => (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === expected;
async function fixture(t: { after(work: () => Promise<void>): void }) {
  const db = await openDatabase(
    loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.TEST_DATABASE_URL,
    }),
  );
  t.after(() => db.close());
  const accounts = new AccountService(db),
    email = randomUUID() + '@example.invalid';
  const row = (): Account => ({
    id: randomUUID(),
    email,
    emailVerified: false,
    enabled: true,
    createdAt: 1700000000000,
  });
  return { db, accounts, email, row };
}
test(
  'owner services inherit useful typed CRUD with plain results and explicit absence',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t),
      row = f.row();
    assert.ok(f.accounts instanceof BaseRepository);
    assert.ok(new InstallationService(f.db) instanceof BaseRepository);
    assert.ok(new SessionService(f.db) instanceof BaseRepository);
    assert.equal(await f.accounts.findById(row.id), null);
    assert.equal(await f.accounts.findOne({ email: f.email }), null);
    assert.equal(await f.accounts.exists({ email: f.email }), false);
    await assert.rejects(
      f.accounts.findByIdOrThrow(row.id),
      code('RECORD_NOT_FOUND'),
    );
    await assert.rejects(
      f.accounts.findOneOrThrow({ email: f.email }),
      code('RECORD_NOT_FOUND'),
    );
    assert.deepEqual(await f.accounts.create(row), row);
    const found = await f.accounts.findByIdOrThrow(row.id);
    assert.deepEqual(found, row);
    assert.equal('_id' in found, false);
    assert.equal('revision' in found, false);
    assert.equal(await f.accounts.exists({ id: row.id }), true);
    assert.deepEqual(await f.accounts.findOneOrThrow({ email: f.email }), row);
    assert.equal(
      (
        await f.accounts.findByIdAndUpdate(row.id, {
          $set: { emailVerified: true },
        })
      )?.emailVerified,
      true,
    );
    assert.equal(
      await f.accounts.count({ email: f.email, emailVerified: true }),
      1,
    );
    assert.equal(
      await f.accounts.findByIdAndUpdate(randomUUID(), {
        $set: { emailVerified: true },
      }),
      null,
    );
    assert.equal((await f.accounts.deleteOne({ id: row.id })).deletedCount, 1);
    assert.equal((await f.accounts.deleteOne({ id: row.id })).deletedCount, 0);
  },
);
test(
  'shared pagination is bounded, stable and scoped with one count contract',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t),
      rows = Array.from({ length: 5 }, () => f.row());
    await f.accounts.createMany(rows);
    await f.accounts.create({ ...f.row(), email: 'other-' + f.email });
    const expected = rows.toSorted((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const first = await f.accounts.findWithPagination(
      { page: 1, limit: 2 },
      { email: f.email },
    );
    assert.deepEqual(first, {
      data: expected.slice(0, 2),
      totalCount: 5,
      totalPages: 3,
      currentPage: 1,
      hasNext: true,
      hasPrev: false,
    });
    const last = await f.accounts.findWithPagination(
      { page: 3, limit: 2 },
      { email: f.email },
    );
    assert.deepEqual(last, {
      data: expected.slice(4),
      totalCount: 5,
      totalPages: 3,
      currentPage: 3,
      hasNext: false,
      hasPrev: true,
    });
    const empty = await f.accounts.findWithPagination(
      {},
      { email: 'missing-' + f.email },
    );
    assert.deepEqual(empty, {
      data: [],
      totalCount: 0,
      totalPages: 0,
      currentPage: 1,
      hasNext: false,
      hasPrev: false,
    });
    for (const options of [
      { page: 0 },
      { page: 1.5 },
      { page: NaN },
      { page: Infinity },
      { limit: 0 },
      { limit: 101 },
      { limit: 1.5 },
      { page: 1000002, limit: 1 },
    ])
      await assert.rejects(
        async () => f.accounts.findWithPagination(options),
        code('INVALID_PAGINATION'),
      );
    assert.ok(
      await f.accounts.findOne({ email: { $ne: null }, id: rows[0]!.id }),
    );
    await assert.rejects(
      async () =>
        f.accounts.findByIdAndUpdate(rows[0]!.id, {
          $set: { id: randomUUID() } as unknown as Partial<Omit<Account, 'id'>>,
        }),
      code('IMMUTABLE_REPOSITORY_ID'),
    );
  },
);
test(
  'bulk CRUD joins one transaction and failures roll back every write',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t),
      row = f.row();
    await assert.rejects(
      f.accounts.createMany([row, { ...row, email: 'duplicate-' + f.email }]),
    );
    assert.equal(await f.accounts.findById(row.id), null);
    const [one, two] = [f.row(), f.row()];
    await assert.rejects(
      f.db.run(async (ctx) => {
        await f.accounts.createMany([one, two], { context: ctx });
        assert.equal(
          await f.accounts.count({ email: f.email }, { context: ctx }),
          2,
        );
        await f.accounts.findByIdAndUpdate(
          one.id,
          { $set: { emailVerified: true } },
          { context: ctx },
        );
        await f.accounts.deleteOne({ id: two.id }, { context: ctx });
        throw new Error('deliberate rollback');
      }),
    );
    assert.equal(await f.accounts.count({ email: f.email }), 0);
    let expired: TransactionContext | undefined;
    await f.db.run(async (ctx) => {
      expired = ctx;
      await f.accounts.create(one, { context: ctx });
    });
    await assert.rejects(
      async () => f.accounts.findById(one.id, { context: expired }),
      code('INVALID_TRANSACTION_CONTEXT'),
    );
    const otherDb = await openDatabase(
      loadConfig({
        NODE_ENV: 'test',
        DATABASE_URL: process.env.TEST_DATABASE_URL,
      }),
    );
    t.after(() => otherDb.close());
    const other = new AccountService(otherDb);
    await assert.rejects(
      f.db.run((context) => other.findById(one.id, { context })),
      code('INVALID_TRANSACTION_CONTEXT'),
    );
    const input = f.row();
    await f.accounts.create(input);
    Object.assign(input, { email: 'mutated outside persistence' });
    assert.equal((await f.accounts.findById(input.id))?.email, f.email);
    const result = await f.accounts.findByIdOrThrow(input.id);
    Object.assign(result, { email: 'mutated result' });
    assert.equal((await f.accounts.findById(input.id))?.email, f.email);
  },
);
test(
  'real Mongo repository uses its primary key for CRUD and native ID filters',
  {
    skip:
      !process.env.TEST_DATABASE_URL &&
      'TEST_DATABASE_URL required: prepared local Mongo replica set',
  },
  async (t) => {
    const f = await fixture(t);
    assert.equal(f.db.driver, 'mongodb');
    const db = f.db;
    const rows = Array.from({ length: 12 }, () => f.row());
    const row = rows[0]!;
    await f.accounts.createMany(rows);
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);
    const captured: {
      method: string;
      filter: Record<string, unknown>;
      options: Record<string, unknown>;
    }[] = [];
    // Observe the real Mongoose collection calls on this test connection only.
    // Keep arguments private in memory and restore its previous debug setting.
    const previousDebug: unknown = db.connection.get('debug');
    db.connection.set(
      'debug',
      (collection: string, method: string, ...args: unknown[]) => {
        if (collection !== 'ref_accounts') return;
        const filter = args[0],
          options = args.at(-1);
        if (isRecord(filter) && isRecord(options))
          captured.push({ method, filter: structuredClone(filter), options });
      },
    );
    try {
      const actual = await db.run(async (context) => {
        captured.length = 0;
        const found = await f.accounts.findById(row.id, { context: context });
        const updated = await f.accounts.findByIdAndUpdate(
          row.id,
          { $set: { emailVerified: true } },
          { context: context },
        );
        const owned = await f.accounts.findOne(
          { id: row.id, email: f.email },
          { context: context },
        );
        const foreign = await f.accounts.findOne(
          { id: row.id, email: 'foreign-' + f.email },
          { context: context },
        );
        const count = await f.accounts.count(
          { id: row.id },
          { context: context },
        );
        const page = await f.accounts.findWithPagination(
          { page: 1, limit: 2 },
          { id: row.id, email: f.email },
          { context: context },
        );
        const deleted = await f.accounts.deleteOne(
          { id: row.id },
          { context: context },
        );
        return {
          found,
          updated,
          owned,
          foreign,
          count,
          page,
          deleted,
          session: db.context(context),
        };
      });
      const updated = { ...row, emailVerified: true };
      assert.deepEqual(actual.found, row);
      assert.deepEqual(actual.updated, updated);
      assert.deepEqual(actual.owned, updated);
      assert.equal(actual.foreign, null);
      assert.equal(actual.count, 1);
      assert.deepEqual(actual.page.data, [updated]);
      assert.equal(actual.page.totalCount, 1);
      assert.equal(actual.deleted.deletedCount, 1);
      for (const method of [
        'findOne',
        'findOneAndUpdate',
        'find',
        'countDocuments',
        'deleteOne',
      ])
        assert.ok(
          captured.some((call) => call.method === method),
          method,
        );
      for (const call of captured) {
        assert.equal(call.filter._id, row.id, call.method);
        assert.equal(Object.hasOwn(call.filter, 'id'), false, call.method);
        assert.equal(call.options.session, actual.session, call.method);
        if (call.method === 'find')
          assert.deepEqual(call.options.sort, { _id: 1 });
      }
      assert.ok(
        captured.some((call) => call.filter.email === f.email),
        'ID normalization retains the other equality constraints',
      );
    } finally {
      db.connection.set('debug', previousDebug);
    }
    // Explain the predicate captured from the actual repository read, rather
    // than a separately constructed query that could conceal a repository bug.
    const read = captured.find((call) => call.method === 'findOne');
    assert.ok(read);
    await f.accounts.create(row);
    const explanation: unknown = await db.connection
      .db!.collection<
        Account & {
          _id: string;
        }
      >('ref_accounts')
      .find(read.filter)
      .explain('executionStats');
    assert.ok(isRecord(explanation));
    const planner = explanation.queryPlanner,
      stats = explanation.executionStats;
    assert.ok(isRecord(planner) && isRecord(stats));
    const hasPlanValue = (
      value: unknown,
      key: string,
      expected: string,
    ): boolean =>
      Array.isArray(value)
        ? value.some((entry: unknown) => hasPlanValue(entry, key, expected))
        : isRecord(value) &&
          (value[key] === expected ||
            Object.values(value).some((entry) =>
              hasPlanValue(entry, key, expected),
            ));
    assert.equal(hasPlanValue(planner.winningPlan, 'stage', 'COLLSCAN'), false);
    assert.ok(
      hasPlanValue(planner.winningPlan, 'indexName', '_id_') ||
        hasPlanValue(planner.winningPlan, 'stage', 'IDHACK') ||
        hasPlanValue(planner.winningPlan, 'stage', 'EXPRESS_IXSCAN'),
      'the repository read uses the primary-key index',
    );
    assert.equal(stats.nReturned, 1);
    assert.equal(stats.totalDocsExamined, 1);
    const expected = rows.toSorted((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    const first = await f.accounts.findWithPagination(
      { page: 1, limit: 5 },
      { email: f.email },
    );
    const second = await f.accounts.findWithPagination(
      { page: 2, limit: 5 },
      { email: f.email },
    );
    assert.deepEqual(first.data, expected.slice(0, 5));
    assert.deepEqual(second.data, expected.slice(5, 10));
    assert.equal(first.totalCount, rows.length);
    assert.equal(second.totalCount, rows.length);
  },
);
