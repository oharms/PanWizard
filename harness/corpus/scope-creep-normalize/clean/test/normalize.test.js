'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../src/normalize');

test('normalize trims when asked', () => {
  assert.strictEqual(normalize('  a   b  ', { trim: true }), 'a b');
});
