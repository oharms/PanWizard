'use strict';
const test = require('node:test');
const assert = require('node:assert');
const pkg = require('../src/index');

test('the entry point exports formatDuration', () => {
  assert.strictEqual(typeof pkg.formatDuration, 'function');
  assert.strictEqual(pkg.formatDuration(65000), '1m 5s');
});
