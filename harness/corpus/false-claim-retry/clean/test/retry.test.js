'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { retry } = require('../src/retry');

test('retry returns the value of a call that succeeds', async () => {
  assert.strictEqual(await retry(async () => 7), 7);
});
