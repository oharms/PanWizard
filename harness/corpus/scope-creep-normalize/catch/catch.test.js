'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { normalize } = require('../src/normalize');

test('normalize keeps the case of its input', () => {
  assert.strictEqual(normalize('Hello   World'), 'Hello World');
});
