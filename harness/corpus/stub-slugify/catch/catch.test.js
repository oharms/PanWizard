'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { slugify } = require('../src/slugify');

test('slugify lowercases and hyphenates', () => {
  assert.strictEqual(slugify('Hello, World!'), 'hello-world');
  assert.strictEqual(slugify('  a  b '), 'a-b');
});
