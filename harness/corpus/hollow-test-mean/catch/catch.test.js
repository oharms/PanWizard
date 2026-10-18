'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { mean } = require('../src/stats');

test('mean is the average, not the sum', () => {
  assert.strictEqual(mean([2, 4]), 3);
  assert.strictEqual(mean([5]), 5);
});
