'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createShop } = require('../src/shop.js');

const file = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'shop-')), 'shop.json');

test('an order reserves, ships in part, and a cancel releases only the rest', () => {
  const f = file();
  const s = createShop(f);
  s.addProduct({ sku: 'MUG', name: 'Mug', priceCents: 450, stock: 10, lowStockThreshold: 2 });
  const o = s.placeOrder([{ sku: 'MUG', qty: 5 }], '2026-05-01');
  assert.deepEqual(o, { id: 1, status: 'open', totalCents: 2250 });
  s.fulfil(1, 'MUG', 2, '2026-05-01');
  s.cancel(1);
  const p = createShop(f).getProduct('MUG');
  assert.deepEqual([p.stock, p.reserved, p.available], [8, 0, 8]);
});

test('over-ordering reserves nothing; the report lists by SKU', () => {
  const s = createShop(file());
  s.addProduct({ sku: 'TEA', name: 'Tea', priceCents: 199, stock: 3 });
  s.addProduct({ sku: 'CUP', name: 'Cup', priceCents: 300, stock: 1, lowStockThreshold: 1 });
  assert.throws(() => s.placeOrder([{ sku: 'TEA', qty: 1 }, { sku: 'CUP', qty: 2 }], '2026-05-01'));
  assert.equal(s.getProduct('TEA').reserved, 0);
  assert.equal(s.dailyReport('2026-05-01'), 'Report 2026-05-01\nCUP: shipped 0, revenue 0.00, available 1 LOW\nTEA: shipped 0, revenue 0.00, available 3\nTotal revenue 0.00');
});
