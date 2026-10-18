'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/slugify');

test('slugify is exported and handles the empty string', () => {
  assert.strictEqual(typeof slugify, 'function');
  assert.strictEqual(slugify(''), '');
});
