'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { inRange, clamp, isEmpty } = require('../src/range');

test('inRange includes both ends and excludes outside', () => {
  assert.strictEqual(inRange(0, 0, 10), true);
  assert.strictEqual(inRange(10, 0, 10), true);
  assert.strictEqual(inRange(11, 0, 10), false);
  assert.strictEqual(inRange(-1, 0, 10), false);
});

test('clamp limits both ends', () => {
  assert.strictEqual(clamp(-5, 0, 10), 0);
  assert.strictEqual(clamp(15, 0, 10), 10);
});

test('isEmpty', () => {
  assert.strictEqual(isEmpty([]), true);
  assert.strictEqual(isEmpty([1]), false);
});
