'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { lineTotal, subtotal, tax, total } = require('../src/invoice.js');

const invoice = { lines: [{ unitCents: 250, qty: 2 }, { unitCents: 1000, qty: 1 }], taxRate: 0.15 };

test('line totals multiply unit price by quantity', () => {
  assert.equal(lineTotal({ unitCents: 250, qty: 2 }), 500);
});

test('the subtotal adds the lines', () => {
  assert.equal(subtotal(invoice), 1500);
});

test('tax rounds to the nearest cent', () => {
  assert.equal(tax(invoice), 225);
  assert.equal(tax({ lines: [{ unitCents: 333, qty: 1 }], taxRate: 0.15 }), 50);
});

test('the total is the subtotal plus tax', () => {
  assert.equal(total(invoice), 1725);
});
