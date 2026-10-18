'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { safeJoin } = require('../src/files');

test('safeJoin joins a relative path', () => {
  assert.ok(safeJoin('root', 'a/b').endsWith(path.join('root', 'a', 'b')));
});
