'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { clamp } = require('../src/range');

test('clamp leaves a value inside the range alone', () => {
  assert.strictEqual(clamp(5, 0, 10), 5);
});
