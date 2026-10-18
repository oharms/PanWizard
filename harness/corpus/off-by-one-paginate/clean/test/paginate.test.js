'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { paginate } = require('../src/paginate');

test('paginate of an empty list is empty', () => {
  assert.deepStrictEqual(paginate([], 1, 10), []);
});
