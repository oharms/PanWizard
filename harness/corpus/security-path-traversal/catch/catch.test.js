'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { safeJoin } = require('../src/files');

test('safeJoin refuses paths that escape root', () => {
  assert.throws(() => safeJoin('root', '../outside'));
  assert.throws(() => safeJoin('root', 'a/../../outside'));
});
