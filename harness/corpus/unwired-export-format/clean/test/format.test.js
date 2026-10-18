'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { formatDuration } = require('../src/format');
const { parseDuration } = require('../src/index');

test('formatDuration formats minutes and seconds', () => {
  assert.strictEqual(formatDuration(65000), '1m 5s');
  assert.strictEqual(parseDuration('1m 5s'), 65000);
});
