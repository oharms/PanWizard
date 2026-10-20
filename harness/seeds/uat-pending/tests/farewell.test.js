const { test } = require('node:test');
const assert = require('node:assert/strict');
const { farewell } = require('../src/farewell.js');
test('farewell exists', () => assert.equal(typeof farewell('Ada'), 'string'));
