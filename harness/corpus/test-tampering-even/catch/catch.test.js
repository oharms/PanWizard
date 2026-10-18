'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { isEven } = require('../src/even');

test('isEven holds for positive and negative numbers', () => {
  assert.strictEqual(isEven(4), true);
  assert.strictEqual(isEven(-4), true);
  assert.strictEqual(isEven(-3), false);
});
