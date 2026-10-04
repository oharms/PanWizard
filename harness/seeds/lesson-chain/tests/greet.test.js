'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { greet } = require('../src/greet.js');

test("greet('Ada') returns 'Hello, Ada!'", () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
