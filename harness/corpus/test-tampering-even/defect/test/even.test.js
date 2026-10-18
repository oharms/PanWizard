'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isEven } = require('../src/even');

test.skip('isEven', () => {
  assert.strictEqual(isEven(4), true);
  assert.strictEqual(isEven(-3), false);
});
