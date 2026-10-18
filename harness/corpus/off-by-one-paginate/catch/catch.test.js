'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { paginate } = require('../src/paginate');

test('page 1 is the first page', () => {
  assert.deepStrictEqual(paginate([1, 2, 3, 4, 5], 1, 2), [1, 2]);
  assert.deepStrictEqual(paginate([1, 2, 3, 4, 5], 3, 2), [5]);
});
