'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cartTotal } = require('../src/cart.js');

test('cartTotal sums unit price × quantity', () => {
  assert.equal(cartTotal([{ sku: 'BREAD', qty: 2 }]), 36);
});

test('cartTotal applies SAVE10', () => {
  assert.equal(cartTotal([{ sku: 'BREAD', qty: 1 }], 'SAVE10'), 16.2);
});

test('cartTotal refuses a quantity that is not a positive integer', () => {
  assert.throws(() => cartTotal([{ sku: 'MILK', qty: 0 }]), /bad quantity/);
});
