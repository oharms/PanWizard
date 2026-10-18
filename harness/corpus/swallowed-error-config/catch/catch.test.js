'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { readConfig } = require('../src/config');

test('readConfig rejects invalid input', () => {
  assert.throws(() => readConfig('{bad'));
  assert.throws(() => readConfig('{"port": "80"}'));
});
