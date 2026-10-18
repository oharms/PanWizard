'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { readConfig } = require('../src/config');

test('readConfig parses a valid config', () => {
  assert.deepStrictEqual(readConfig('{"port": 8080}'), { port: 8080 });
});
