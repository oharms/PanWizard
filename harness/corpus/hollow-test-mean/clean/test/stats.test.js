'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mean } = require('../src/stats');

test('mean averages a list', () => {
  assert.strictEqual(mean([2, 4]), 3);
  assert.throws(() => mean([]));
});
