import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bootstrapBinding,
  withBootstrapBindings,
} from '../templates/runtime/common/src/core/bootstrap/bootstrap-bindings.ts';

function checkpoint() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test('static providers receive the instances from their own concurrent bootstrap', async () => {
  const binding = bootstrapBinding<{ application: string }>('APPLICATION');
  const first = { application: 'first' };
  const second = { application: 'second' };
  const secondStarted = checkpoint();
  const firstRead = checkpoint();

  const results = await Promise.all([
    withBootstrapBindings([binding.bind(first)], async () => {
      await secondStarted.promise;
      const value = await binding.provider.useFactory();
      firstRead.resolve();
      return value;
    }),
    withBootstrapBindings([binding.bind(second)], async () => {
      secondStarted.resolve();
      await firstRead.promise;
      return binding.provider.useFactory();
    }),
  ]);

  assert.equal(results[0], first);
  assert.equal(results[1], second);
  assert.throws(
    () => binding.provider.useFactory(),
    /MISSING_BOOTSTRAP_BINDING/,
  );
});

test('static provider bindings reject duplicates and are cleared after startup fails', async () => {
  const binding = bootstrapBinding<number>('PORT');
  await assert.rejects(
    withBootstrapBindings([binding.bind(1), binding.bind(2)], async () => {}),
    /DUPLICATE_BOOTSTRAP_BINDING/,
  );

  const startupFinished = checkpoint();
  let laterLookup: Promise<number> | undefined;
  await assert.rejects(
    withBootstrapBindings([binding.bind(3)], async () => {
      laterLookup = startupFinished.promise.then(() =>
        binding.provider.useFactory(),
      );
      throw new Error('startup failed');
    }),
    /startup failed/,
  );
  startupFinished.resolve();
  assert.ok(laterLookup);
  await assert.rejects(laterLookup, /MISSING_BOOTSTRAP_BINDING/);
});
