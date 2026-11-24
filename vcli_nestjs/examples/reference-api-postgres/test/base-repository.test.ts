import {
  NativeValuesRepository,
  type NativeValues,
} from './helpers/native-values-repository.ts';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, gt, sql } from 'drizzle-orm';
import {
  databaseTest as test,
  postgresFixture,
  type TestCleanup,
} from './helpers/postgres-fixture.ts';
import { AccountQueryFixture } from './helpers/account-query-fixture.ts';
import { BaseRepository } from '../dist/core/database/base-repository.js';
import type { TransactionContext } from '../dist/core/database/transaction-context.js';
import { InstallationService } from '../dist/modules/installations/installation.service.js';
import { SessionService } from '../dist/modules/sessions/session.service.js';
import {
  accountTable,
  type Account,
} from '../dist/modules/accounts/account.entity.js';

const code = (expected: string) => (error: unknown) =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  error.code === expected;
async function fixture(t: TestCleanup) {
  const { database: db } = await postgresFixture(t),
    accounts = new AccountQueryFixture(db),
    email = `${randomUUID()}@example.invalid`;
  const row = (): Account => ({
    id: randomUUID(),
    email,
    emailVerified: false,
    enabled: true,
    createdAt: 1700000000000,
  });
  return { db, accounts, email, row, where: eq(accountTable.email, email) };
}

test('native owner repositories return plain records, honest projections and explicit absence', async (t) => {
  const f = await fixture(t),
    row = f.row();
  assert.ok(f.accounts instanceof BaseRepository);
  assert.ok(new InstallationService(f.db) instanceof BaseRepository);
  assert.ok(new SessionService(f.db) instanceof BaseRepository);
  assert.equal(await f.accounts.findById(row.id), null);
  assert.equal(await f.accounts.findOne(f.where), null);
  assert.equal(await f.accounts.exists(f.where), false);
  await assert.rejects(
    f.accounts.findByIdOrThrow(row.id),
    code('RECORD_NOT_FOUND'),
  );
  await assert.rejects(
    f.accounts.findOneOrThrow(f.where),
    code('RECORD_NOT_FOUND'),
  );
  assert.deepEqual(await f.accounts.create(row), row);
  assert.deepEqual(await f.accounts.findByIdOrThrow(row.id), row);
  assert.equal(await f.accounts.exists(eq(accountTable.id, row.id)), true);
  assert.deepEqual(
    await f.accounts.findOneOrThrow(f.where, { fields: ['id', 'email'] }),
    { id: row.id, email: row.email },
  );
  const projected = await f.accounts.findById(row.id, { fields: ['id'] });
  assert.deepEqual(projected, { id: row.id });
  // @ts-expect-error Selected records do not pretend omitted properties exist.
  assert.equal(projected?.email, undefined);
  assert.equal(
    (await f.accounts.findByIdAndUpdate(row.id, { emailVerified: true }))
      ?.emailVerified,
    true,
  );
  assert.equal(
    await f.accounts.count(and(f.where, eq(accountTable.emailVerified, true))),
    1,
  );
  assert.equal(
    await f.accounts.findByIdAndUpdate(randomUUID(), { enabled: false }),
    null,
  );
  assert.equal((await f.accounts.findByIdAndDelete(row.id))?.id, row.id);
  assert.equal(await f.accounts.findByIdAndDelete(row.id), null);
});

test('pagination, native filters, sorting and bounded reads preserve stable unique ties', async (t) => {
  const f = await fixture(t),
    rows = Array.from({ length: 5 }, () => f.row());
  await f.accounts.createMany(rows);
  await f.accounts.create({ ...f.row(), email: 'other-' + f.email });
  const expected = rows.toSorted((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const first = await f.accounts.findWithPagination(
    { page: 1, limit: 2, orderBy: [desc(accountTable.createdAt)] },
    f.where,
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
    { page: 3, limit: 2, fields: ['id'] },
    f.where,
  );
  assert.deepEqual(
    last.data,
    expected.slice(4).map(({ id }) => ({ id })),
  );
  assert.equal(last.hasNext, false);
  const empty = await f.accounts.findWithPagination(
    {},
    eq(accountTable.email, 'missing-' + f.email),
  );
  assert.equal(empty.totalCount, 0);
  assert.equal(empty.totalPages, 0);
  assert.deepEqual(
    await f.accounts.findMany(
      and(f.where, gt(accountTable.createdAt, 1700000000001)),
    ),
    [],
  );
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
  await assert.rejects(
    async () => f.accounts.findMany(f.where, { limit: 1001 }),
    code('INVALID_REPOSITORY_LIMIT'),
  );
  await assert.rejects(
    async () =>
      f.accounts.findById(rows[0]!.id, {
        fields: ['unowned'] as unknown as (keyof Account)[],
      }),
    code('INVALID_REPOSITORY_PROJECTION'),
  );
  await assert.rejects(
    async () =>
      f.accounts.findByIdAndUpdate(rows[0]!.id, {
        id: randomUUID(),
      } as unknown as Partial<Omit<Account, 'id'>>),
    code('INVALID_REPOSITORY_INPUT'),
  );
});

test('native update/delete summaries differ from returned records and require whole-table opt-in', async (t) => {
  const f = await fixture(t),
    rows = Array.from({ length: 3 }, () => f.row());
  await f.accounts.createMany(rows);
  assert.deepEqual(await f.accounts.updateOne(f.where, { enabled: true }), {
    affectedCount: 1,
  });
  assert.deepEqual(await f.accounts.updateMany(f.where, { enabled: false }), {
    affectedCount: 3,
  });
  assert.deepEqual(
    await f.accounts.findOneAndUpdate(
      f.where,
      { enabled: true },
      { fields: ['enabled'] },
    ),
    { enabled: true },
  );
  assert.deepEqual(await f.accounts.distinct('enabled', f.where), [
    false,
    true,
  ]);
  await assert.rejects(
    async () => f.accounts.updateMany(undefined, { enabled: true }),
    code('UNSCOPED_BULK_WRITE'),
  );
  await assert.rejects(
    async () => f.accounts.deleteMany(),
    code('UNSCOPED_BULK_WRITE'),
  );
  await assert.rejects(
    async () => f.accounts.deleteMany(sql``),
    code('UNSCOPED_BULK_WRITE'),
  );
  assert.deepEqual(await f.accounts.deleteOne(f.where), { affectedCount: 1 });
  assert.ok(await f.accounts.findOneAndDelete(f.where));
  assert.deepEqual(await f.accounts.deleteMany(undefined, { allowAll: true }), {
    affectedCount: 1,
  });
  assert.deepEqual(await f.accounts.deleteOne(f.where), { affectedCount: 0 });
  assert.equal(await f.accounts.findOneAndDelete(f.where), null);
});

test('native explicit conflict upsert inserts, updates and applies a conditional version fence', async (t) => {
  const f = await fixture(t),
    row = f.row();
  assert.deepEqual(
    await f.accounts.upsert(row, {
      conflictTarget: ['id'],
      set: { enabled: false },
    }),
    row,
  );
  assert.equal(
    (
      await f.accounts.upsert(row, {
        conflictTarget: ['id'],
        set: { enabled: false },
      })
    )?.enabled,
    false,
  );
  assert.equal(
    await f.accounts.upsert(row, {
      conflictTarget: ['id'],
      set: { enabled: true },
      updateWhere: eq(accountTable.enabled, true),
    }),
    null,
  );
  await assert.rejects(
    async () =>
      f.accounts.upsert(row, {
        conflictTarget: ['email'],
        set: { enabled: true },
      }),
    code('INVALID_CONFLICT_TARGET'),
  );
  const injection = "quoted'; DROP TABLE ref_accounts; --";
  await f.accounts.findByIdAndUpdate(row.id, { email: injection });
  assert.equal(
    (await f.accounts.findOne(eq(accountTable.email, injection)))?.id,
    row.id,
  );
  assert.equal(await f.accounts.count(), 1);
});

test('batch writes share one transaction, roll back on failure and reject foreign or expired contexts', async (t) => {
  const f = await fixture(t),
    row = f.row();
  await assert.rejects(
    f.accounts.createMany([row, { ...row, email: 'duplicate-' + f.email }]),
  );
  assert.equal(await f.accounts.findById(row.id), null);
  // Cross a SQL batch boundary, then violate the primary key in the next batch.
  const batch = Array.from({ length: 101 }, () => f.row());
  batch[100] = batch[0]!;
  await assert.rejects(f.accounts.createMany(batch));
  assert.equal(await f.accounts.count(), 0);
  const one = f.row(),
    two = f.row();
  await assert.rejects(
    f.db.run(async (context) => {
      await f.accounts.createMany([one, two], { context });
      assert.equal(await f.accounts.count(f.where, { context }), 2);
      await f.accounts.findByIdAndUpdate(
        one.id,
        { emailVerified: true },
        { context },
      );
      await f.accounts.findByIdAndDelete(two.id, { context });
      throw new Error('deliberate rollback');
    }),
  );
  assert.equal(await f.accounts.count(f.where), 0);
  let expired: TransactionContext | undefined;
  await f.db.run(async (context) => {
    expired = context;
    await f.accounts.create(one, { context });
  });
  await assert.rejects(
    f.accounts.findById(one.id, { context: expired }),
    code('INVALID_TRANSACTION_CONTEXT'),
  );
  const other = await postgresFixture(t);
  await assert.rejects(
    other.database.run((context) => f.accounts.findById(one.id, { context })),
    code('INVALID_TRANSACTION_CONTEXT'),
  );
  Object.assign(one, { email: 'mutated input' });
  assert.equal((await f.accounts.findById(one.id))?.email, f.email);
  Object.assign(await f.accounts.findByIdOrThrow(one.id), {
    email: 'mutated result',
  });
  assert.equal((await f.accounts.findById(one.id))?.email, f.email);
});

test('bounded async keyset iteration respects projections, transaction lifetime and early stop', async (t) => {
  const f = await fixture(t),
    rows = Array.from({ length: 7 }, () => f.row());
  await f.accounts.createMany(rows);
  const actual: { id: string }[] = [];
  for await (const row of f.accounts.iterate(f.where, {
    batchSize: 2,
    maxRows: 5,
    fields: ['id'],
  }))
    actual.push(row);
  assert.deepEqual(
    actual.map(({ id }) => id),
    rows
      .map(({ id }) => id)
      .sort()
      .slice(0, 5),
  );
  await f.db.run(async (context) => {
    let count = 0;
    for await (const row of f.accounts.iterate(f.where, {
      context,
      batchSize: 2,
      maxRows: 20,
    })) {
      assert.ok(row.id);
      count++;
      if (count === 3) break;
    }
    assert.equal(count, 3);
  });
  await assert.rejects(async () => {
    for await (const row of f.accounts.iterate(f.where, { maxRows: 0 }))
      void row;
  }, code('INVALID_REPOSITORY_LIMIT'));
});

test('typed SQL aggregation and joins stay native and row locks require an active caller transaction', async (t) => {
  const f = await fixture(t),
    rows = [f.row(), { ...f.row(), enabled: false }];
  await f.accounts.createMany(rows);
  assert.deepEqual(await f.accounts.grouped(f.email), [
    { enabled: false, count: 1 },
    { enabled: true, count: 1 },
  ]);
  assert.equal((await f.accounts.joined(rows[0]!.id)).length, 2);
  await assert.rejects(
    f.accounts.findById(rows[0]!.id, { lock: 'update' }),
    code('LOCK_REQUIRES_TRANSACTION'),
  );
  await f.db.run(async (context) =>
    assert.equal(
      (await f.accounts.findById(rows[0]!.id, { context, lock: 'update' }))?.id,
      rows[0]!.id,
    ),
  );
});

test('actual repository ID read remains eligible for primary-key access and preserves SQL parameters', async (t) => {
  const f = await fixture(t),
    row = f.row();
  await f.accounts.create(row);
  await f.db.run(async (context) => {
    const transaction = f.db.context(context);
    const observation = t.mock.method(transaction, 'execute');
    try {
      assert.deepEqual(await f.accounts.findById(row.id, { context }), row);
    } finally {
      observation.mock.restore();
    }
    const statement = observation.mock.calls[0]?.arguments[0];
    assert.ok(statement && typeof statement !== 'string');
    // Small fixture tables may rationally choose a sequential scan; test the
    // actual captured predicate's index eligibility, not planner cost tuning.
    await transaction.execute(sql`SET LOCAL enable_seqscan = off`);
    const explanation = await transaction.execute<{ 'QUERY PLAN': unknown }>(
      sql`EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`,
    );
    const plan = explanation.rows[0]?.['QUERY PLAN'];
    const contains = (
      value: unknown,
      key: string,
      expected: unknown,
    ): boolean =>
      Array.isArray(value)
        ? value.some((entry: unknown) => contains(entry, key, expected))
        : typeof value === 'object' &&
          value !== null &&
          (Object.entries(value).some(
            ([name, child]) => name === key && child === expected,
          ) ||
            Object.values(value).some((child: unknown) =>
              contains(child, key, expected),
            ));
    assert.equal(contains(plan, 'Index Name', 'ref_accounts_pkey'), true);
    assert.equal(contains(plan, 'Node Type', 'Seq Scan'), false);
    assert.equal(contains(plan, 'Actual Rows', 1), true);
  });
});

test('unknown PostgreSQL commit acknowledgement is surfaced once without replaying committed work', async (t) => {
  const f = await fixture(t),
    row = f.row();
  const original = f.db.db.transaction.bind(f.db.db);
  const acknowledgement = t.mock.method(
    f.db.db,
    'transaction',
    async (...args: Parameters<typeof f.db.db.transaction>) => {
      const [work, options] = args;
      await original(work, options);
      // The server committed; emulate loss of the acknowledgement at the transport.
      throw new Error('test-only lost acknowledgement');
    },
  );
  try {
    await assert.rejects(
      f.db.run((context) => f.accounts.create(row, { context })),
      code('COMMIT_OUTCOME_UNKNOWN'),
    );
    assert.equal(acknowledgement.mock.callCount(), 1);
  } finally {
    acknowledgement.mock.restore();
  }
  assert.deepEqual(await f.accounts.findById(row.id), row);
});

test('native PostgreSQL column codecs round-trip JSONB, timestamps, arrays and bigint across repository methods', async (t) => {
  const { database } = await postgresFixture(t);
  await database.run(async (context) => {
    await database
      .context(context)
      .execute(
        sql`CREATE TABLE repository_native_values (id uuid PRIMARY KEY, metadata jsonb NOT NULL, occurred_at timestamptz NOT NULL, labels text[] NOT NULL, visits bigint NOT NULL)`,
      );
  });
  const repository = new NativeValuesRepository(database);
  const row: NativeValues = {
    id: randomUUID(),
    metadata: { tags: ['quoted"', 'comma,value'], nested: { enabled: true } },
    occurredAt: new Date('2026-11-16T12:34:56.789Z'),
    labels: ['a,b', '{quoted}', ''],
    visits: 9007199254740993n,
  };
  assert.deepEqual(await repository.create(row), row);
  assert.deepEqual(await repository.findById(row.id), row);
  assert.deepEqual(
    await repository.findById(row.id, {
      fields: ['metadata', 'occurredAt', 'visits'],
    }),
    { metadata: row.metadata, occurredAt: row.occurredAt, visits: row.visits },
  );
  const changed = {
    ...row,
    occurredAt: new Date('2026-11-17T00:00:00Z'),
    metadata: { tags: [], nested: { enabled: false } },
    labels: ['replacement'],
    visits: 9007199254740994n,
  };
  assert.deepEqual(
    await repository.findByIdAndUpdate(row.id, changedWithoutId(changed)),
    changed,
  );
  assert.deepEqual(await repository.distinct('occurredAt'), [
    changed.occurredAt,
  ]);
  assert.deepEqual(await repository.distinct('labels'), [changed.labels]);
  assert.deepEqual(
    await repository.upsert(row, {
      conflictTarget: ['id'],
      set: changedWithoutId(row),
    }),
    row,
  );
  const iterated: NativeValues[] = [];
  for await (const value of repository.iterate(undefined, {
    maxRows: 2,
    batchSize: 1,
  }))
    iterated.push(value);
  assert.deepEqual(iterated, [row]);
  assert.deepEqual(await repository.findByIdAndDelete(row.id), row);
});

function changedWithoutId(value: NativeValues): Omit<NativeValues, 'id'> {
  const { metadata, occurredAt, labels, visits } = value;
  return { metadata, occurredAt, labels, visits };
}
