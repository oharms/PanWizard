'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { priceOf } = require('../src/prices.js');

test('priceOf returns the unit price of a known SKU', () => {
  assert.equal(priceOf('BREAD'), 18);
});

test('priceOf throws on an unknown SKU', () => {
  assert.throws(() => priceOf('CAKE'), /unknown SKU: CAKE/);
});
