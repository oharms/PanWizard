'use strict';
const test = require('node:test');
const assert = require('node:assert');
const a = require('../src/a.js');

test('a returns 1', () => { assert.strictEqual(a(), 1); });
