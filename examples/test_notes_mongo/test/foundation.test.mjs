// Evidence: local compiled dist. This is not hosted-provider acceptance.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../dist/core/config/load-config.js';
import { HealthStateService } from '../dist/modules/health/health-state.service.js';
test('health readiness has an explicit initialization and shutdown lifecycle', () => {
  const state = new HealthStateService();
  assert.equal(state.ready(), false);
  state.markReady();
  assert.equal(state.ready(), true);
  state.markStopping();
  assert.equal(state.ready(), false);
});
test('invalid environment values are rejected without including values', () => {
  const sentinel = 'PRIVATE_SENTINEL';
  assert.throws(
    () => loadConfig({ PORT: sentinel }),
    (error) => !String(error).includes(sentinel),
  );
});
