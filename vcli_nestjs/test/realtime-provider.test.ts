import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyCentrifugoProvider } from '../scripts/verify-centrifugo-provider.ts';
test(
  'real pinned Centrifugo/Redis private topology and SDK acceptance',
  {
    skip:
      process.env.VCLI_REALTIME_PROVIDER !== '1'
        ? 'Opt in with VCLI_REALTIME_PROVIDER=1; requires reviewed cached image digests and local sudo Docker'
        : false,
    timeout: 150000,
  },
  async () => {
    const report = await verifyCentrifugoProvider();
    assert.equal(report.passed, true);
    assert.equal(report.cleanup, true);
    assert.ok(report.cases.length >= 12);
    assert.ok(report.cases.every((item) => item.passed));
  },
);
