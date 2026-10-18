'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { retry } = require('../src/retry');

test('retry tries again after a failure', async () => {
  let calls = 0;
  const flaky = async () => {
    calls++;
    if (calls < 3) throw new Error('flaky');
    return 'ok';
  };
  assert.strictEqual(await retry(flaky, 3, 0), 'ok');
  assert.strictEqual(calls, 3);
});
