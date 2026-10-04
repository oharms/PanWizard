'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('the library loads', () => {
  assert.equal(typeof require('../src/greet.js').greet, 'function');
});
