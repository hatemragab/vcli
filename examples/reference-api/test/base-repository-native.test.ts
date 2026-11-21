import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import type { RepositoryViewOptions } from '../dist/core/database/repository-types.js';
import { openTestDatabase } from './helpers/mongo-fixture.ts';
import { ProbeRepository, type Probe } from './helpers/probe-repository.ts';

const local = {
  skip:
    !process.env.TEST_DATABASE_URL &&
    'TEST_DATABASE_URL required: prepared local Mongo replica set',
};
const errorCode = (code: string) => (error: unknown) =>
  !!error &&
  typeof error === 'object' &&
  'code' in error &&
  error.code === code;
async function fixture(t: TestContext) {
  const database = await openTestDatabase(t);
  const repository = new ProbeRepository(
    database,
    'probe_' + randomUUID().replaceAll('-', ''),
  );
  await repository.initialize();
  const row = (title = 'Probe', visits = 0): Probe => ({
    id: randomUUID(),
    title,
    visits,
    parentId: null,
  });
  return { database, repository, row };
}

test(
  'native operators, honest projections, population, aggregates and distinct values',
  local,
  async (t) => {
    const { repository: r, row } = await fixture(t);
    const parent = row('Parent', 2),
      child = { ...row('Child', 3), parentId: parent.id };
    await r.createMany([parent, child]);
    assert.equal(r.hooks.saves, 2);
    assert.equal(
      await r.exists({
        $and: [{ id: { $in: [child.id] } }, { visits: { $gte: 3 } }],
      }),
      true,
    );
    assert.equal(await r.count({ visits: { $gte: 2 } }), 2);
    assert.deepEqual((await r.distinct('title')).sort(), ['Child', 'Parent']);
    assert.deepEqual(
      (await r.distinct('id')).sort(),
      [parent.id, child.id].sort(),
    );
    assert.deepEqual(
      (await r.findMany({}, { sort: { id: -1 } })).map((record) => record.id),
      [parent.id, child.id].sort().reverse(),
    );
    const projection: RepositoryViewOptions<Probe> = {
      projection: { title: 1, _id: 0 },
    };
    assert.deepEqual(await r.findById(child.id, projection), {
      title: 'Child',
    });
    assert.deepEqual(await r.findOneOrThrow({ id: child.id }, projection), {
      title: 'Child',
    });
    const populated = await r.findByIdOrThrow<
      Omit<Probe, 'parentId'> & { parentId: Probe & { _id: string } }
    >(child.id, { populate: { path: 'parentId' } });
    assert.equal(populated.parentId.id, parent.id);
    assert.equal(populated.parentId.title, 'Parent');
    assert.equal('save' in populated.parentId, false);
    assert.deepEqual(
      await r.aggregate<{ total: number }>([
        { $group: { _id: null, total: { $sum: '$visits' } } },
        { $project: { _id: 0, total: 1 } },
      ]),
      [{ total: 5 }],
    );
    const page = await r.findWithPagination(
      { limit: 1 },
      {},
      { ...projection, sort: { visits: -1 } },
    );
    assert.deepEqual(page.data, [{ title: 'Child' }]);
    assert.equal(page.totalCount, 2);
    // Compile-time regressions: a view cannot claim fields excluded by its projection.
    const view = await r.findByIdOrThrow(child.id, projection);
    // @ts-expect-error Projected records do not guarantee a complete title.
    const fullTitle: string = view.title;
    void fullTitle;
  },
);

test(
  'native update summaries, returned records, explicit keyed upsert and deletion variants',
  local,
  async (t) => {
    const { repository: r, row } = await fixture(t);
    const one = row('One'),
      two = row('Two');
    await r.createMany([one, two]);
    assert.equal(
      (await r.updateOne({ id: one.id, visits: 0 }, { $inc: { visits: 1 } }))
        .modifiedCount,
      1,
    );
    assert.equal(
      (await r.updateOne({ id: one.id, visits: 0 }, { $inc: { visits: 1 } }))
        .matchedCount,
      0,
    );
    assert.equal(
      (
        await r.updateMany(
          { id: { $in: [one.id, two.id] } },
          { $inc: { visits: 1 } },
        )
      ).modifiedCount,
      2,
    );
    assert.deepEqual(
      await r.findByIdAndUpdate(
        one.id,
        { $set: { title: 'Updated' } },
        { projection: { title: 1, _id: 0 } },
      ),
      { title: 'Updated' },
    );
    assert.equal(
      (await r.findOneAndUpdate({ id: two.id }, { $inc: { visits: 2 } }))
        ?.visits,
      3,
    );
    const inserted = row('Inserted', 1);
    assert.equal(
      (await r.upsert(inserted.id, inserted, { $set: { title: 'Upserted' } }))
        .title,
      'Upserted',
    );
    assert.equal(
      (await r.upsert(inserted.id, inserted, { $inc: { visits: 1 } })).visits,
      2,
    );
    assert.equal(await r.count({ id: inserted.id }), 1);
    await assert.rejects(
      async () => r.updateMany({}, { $set: { visits: 0 } }),
      errorCode('WHOLE_COLLECTION_OPT_IN_REQUIRED'),
    );
    await assert.rejects(
      async () => r.deleteMany({}),
      errorCode('WHOLE_COLLECTION_OPT_IN_REQUIRED'),
    );
    await assert.rejects(
      async () => r.updateOne({ id: one.id }, { $set: { id: randomUUID() } }),
      errorCode('IMMUTABLE_REPOSITORY_ID'),
    );
    assert.equal(
      (await r.updateMany({}, { $set: { visits: 0 } }, { allowAll: true }))
        .matchedCount,
      3,
    );
    assert.deepEqual(
      await r.findOneAndDelete(
        { id: two.id },
        { projection: { title: 1, _id: 0 } },
      ),
      { title: 'Two' },
    );
    assert.equal((await r.findByIdAndDelete(one.id))?.id, one.id);
    assert.equal(await r.findByIdAndDelete(one.id), null);
    assert.equal((await r.deleteOne({ id: inserted.id })).deletedCount, 1);
    await r.createMany([row(), row()]);
    assert.equal((await r.deleteMany({}, { allowAll: true })).deletedCount, 2);
  },
);

test(
  'bounded iteration retains stable cursor advancement with omitted IDs and closes early',
  local,
  async (t) => {
    const { repository: r, row } = await fixture(t);
    const rows = Array.from({ length: 7 }, (_, index) =>
      row('Row ' + index, index),
    );
    await r.createMany(rows);
    const seen = [];
    for await (const record of r.iterate(
      {},
      {
        projection: { title: 1, _id: 0 },
        sort: { visits: 1 },
        maximum: 3,
        batchSize: 1,
      },
    ))
      seen.push(record);
    assert.deepEqual(
      seen,
      rows.slice(0, 3).map(({ title }) => ({ title })),
    );
    let consumed = 0;
    for await (const record of r.iterate({}, { maximum: 5, batchSize: 1 })) {
      assert.ok(record.id);
      consumed += 1;
      break;
    }
    assert.equal(consumed, 1);
    await assert.rejects(async () => {
      for await (const record of r.iterate({}, { maximum: 0 })) void record;
    }, errorCode('INVALID_LIMIT'));
  },
);

test(
  'one shared session propagates across every method and failures roll back records',
  local,
  async (t) => {
    const { database, repository: r, row } = await fixture(t);
    const one = row('Session one'),
      two = row('Session two');
    await assert.rejects(
      database.run(async (context) => {
        const options = { context, session: database.context(context) };
        await r.createMany([one, two], options);
        assert.equal((await r.findByIdOrThrow(one.id, options)).id, one.id);
        assert.equal(
          (await r.findOneOrThrow({ id: two.id }, options)).id,
          two.id,
        );
        await r.updateOne(
          { id: two.id },
          { $set: { parentId: one.id } },
          options,
        );
        const populated = await r.findByIdOrThrow<{ parentId: Probe }>(two.id, {
          ...options,
          populate: [{ path: 'parentId' }],
        });
        assert.equal(populated.parentId.id, one.id);
        assert.equal('save' in populated.parentId, false);
        assert.equal((await r.findMany({}, options)).length, 2);
        assert.equal(await r.exists({ id: one.id }, options), true);
        assert.equal(await r.count({}, options), 2);
        assert.equal((await r.distinct('title', {}, options)).length, 2);
        assert.equal(
          (await r.findWithPagination({}, {}, options)).totalCount,
          2,
        );
        await r.updateOne({ id: one.id }, { $inc: { visits: 1 } }, options);
        await r.updateMany(
          {},
          { $inc: { visits: 1 } },
          { ...options, allowAll: true },
        );
        await r.findByIdAndUpdate(one.id, { $inc: { visits: 1 } }, options);
        await r.findOneAndUpdate(
          { id: two.id },
          { $inc: { visits: 1 } },
          options,
        );
        assert.equal(
          (
            await r.aggregate<{ total: number }>([{ $count: 'total' }], options)
          )[0]?.total,
          2,
        );
        await r.bulkWrite(
          [
            {
              updateOne: {
                filter: { id: one.id },
                update: { $inc: { visits: 1 } },
              },
            },
          ],
          options,
        );
        let count = 0;
        for await (const record of r.iterate({}, { ...options, maximum: 2 })) {
          assert.ok(record.id);
          count += 1;
        }
        assert.equal(count, 2);
        const three = row('Three');
        await r.upsert(three.id, three, { $set: { title: 'Upsert' } }, options);
        await r.findByIdAndDelete(one.id, options);
        await r.findOneAndDelete({ id: two.id }, options);
        await r.deleteOne({ id: three.id }, options);
        await r.create(row('Rollback'), options);
        throw new Error('rollback all');
      }),
    );
    assert.equal(await r.count(), 0);
    const unrelated = await database.connection.startSession();
    try {
      await assert.rejects(
        database.run((context) => r.count({}, { context, session: unrelated })),
        errorCode('AMBIGUOUS_TRANSACTION_CONTEXT'),
      );
      await assert.rejects(
        r.createMany([one], { session: unrelated }),
        errorCode('ACTIVE_TRANSACTION_REQUIRED'),
      );
    } finally {
      await unrelated.endSession();
    }
  },
);

test(
  'createMany validates and saves sequentially with rollback, bulkWrite documents partial failure',
  local,
  async (t) => {
    const { repository: r, row } = await fixture(t);
    const first = row('First');
    await assert.rejects(r.createMany([first, row('')]));
    assert.equal(await r.count(), 0);
    await assert.rejects(r.createMany([first, first]));
    assert.equal(await r.count(), 0);
    await assert.rejects(
      r.bulkWrite([{ insertOne: { document: row(''), skipValidation: true } }]),
    );
    assert.equal(await r.count(), 0);
    await r.create(first);
    await assert.rejects(
      r.bulkWrite([
        {
          replaceOne: {
            filter: { id: first.id },
            replacement: { ...first, title: '' },
            skipValidation: true,
          },
        },
      ]),
    );
    assert.equal((await r.findByIdOrThrow(first.id)).title, first.title);
    const second = row('Second'),
      after = row('After');
    const saves = r.hooks.saves;
    await assert.rejects(
      r.bulkWrite([
        { insertOne: { document: second } },
        { insertOne: { document: first } },
        { insertOne: { document: after } },
      ]),
    );
    assert.equal(await r.exists({ id: second.id }), true);
    assert.equal(await r.exists({ id: after.id }), false);
    assert.equal(r.hooks.saves, saves);
    assert.ok(r.hooks.bulkWrites > 0);
    const valid = row('Valid');
    await assert.rejects(
      r.bulkWrite(
        [
          { insertOne: { document: row('') } },
          { insertOne: { document: valid } },
        ],
        { ordered: false },
      ),
    );
    assert.equal(await r.exists({ id: valid.id }), true);
    assert.equal(
      (
        await r.bulkWrite([
          {
            updateOne: {
              filter: { id: valid.id },
              update: { $inc: { visits: 1 } },
            },
          },
        ])
      ).modifiedCount,
      1,
    );
    const replacement = { ...valid, title: 'Replacement', visits: 4 };
    assert.equal(
      (
        await r.bulkWrite([
          { replaceOne: { filter: { id: valid.id }, replacement } },
        ])
      ).modifiedCount,
      1,
    );
    assert.equal((await r.findByIdOrThrow(valid.id)).title, 'Replacement');
    assert.equal(
      (await r.bulkWrite([{ deleteOne: { filter: { id: valid.id } } }]))
        .deletedCount,
      1,
    );
    await assert.rejects(
      r.bulkWrite([{ deleteMany: { filter: {} } }]),
      errorCode('WHOLE_COLLECTION_OPT_IN_REQUIRED'),
    );
    await assert.rejects(
      r.bulkWrite([
        {
          updateOne: {
            filter: { id: first.id },
            update: { $set: { title: 'unsafe' } },
            upsert: true,
          },
        },
      ]),
      errorCode('USE_EXPLICIT_UPSERT'),
    );
  },
);

test(
  'upsert excludes both rename paths from insertion defaults on existing records',
  local,
  async (t) => {
    const { repository: r, row } = await fixture(t);
    const existing = {
      ...row('Required fields remain valid'),
      nickname: 'Rename source',
      alias: 'Previous destination',
    };
    await r.create(existing);
    const updated = await r.upsert(
      existing.id,
      { ...existing, alias: 'Insertion default' },
      { $rename: { nickname: 'alias' } },
    );
    assert.equal(updated.title, existing.title);
    assert.equal(updated.alias, 'Rename source');
    assert.equal(Object.hasOwn(updated, 'nickname'), false);
  },
);
