#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the H10 project-definition pair (pair-brief-live): the acceptance
 * check neither arm can see, over the one-paragraph product brief of seed brief-shop
 * (BRIEF.md). Every case tests a behaviour the brief states in words, the interactions
 * among them included (a cancel after a partial shipment releases only the unshipped part;
 * low stock counts available, not stock; the report and the low-stock list are by SKU).
 * Each script runs in a fresh node process with its own shop file, so persistence is
 * tested across real restarts. Prints {passed, failed, cases: [{area, name, ok, detail?}],
 * per_area: {products: {passed, total}, ...}}. Exit 0 only when every case passes.
 *
 *   node harness/scripts/check-shop.cjs <workspace>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ws = path.resolve(process.argv[2] || process.cwd());
const MOD = JSON.stringify(path.join(ws, 'src', 'shop.js'));

const T = (o) => JSON.stringify(o);
const D1 = '2026-05-01', D2 = '2026-05-02';
// [area, name, [script, ...], expected JSON of the last script's output]
const CASES = [
  // Products
  ['products', 'addProduct and getProduct: stock, reserved, available; threshold defaults to 0', [`const s = S(F); s.addProduct({ sku: 'MUG', name: 'Mug', priceCents: 450, stock: 10 }); out([s.getProduct('MUG'), s.lowStock()])`], T([{ sku: 'MUG', name: 'Mug', priceCents: 450, stock: 10, reserved: 0, available: 10 }, []])],
  ['products', 'a duplicate SKU throws and leaves the first product alone', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); out([throws(() => s.addProduct(P('MUG', 999, 1))), pv(s.getProduct('MUG'))])`], T(['threw', ['MUG', 450, 10, 0, 10]])],
  ['products', 'invalid stock, threshold and unknown SKUs throw', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); out([throws(() => s.addProduct(P('A', 100, -1))), throws(() => s.addProduct(P('B', 100, 2.5))), throws(() => s.addProduct(P('C', 100, 1, -1))), throws(() => s.getProduct('NOPE')), throws(() => s.restock('NOPE', 1))])`], T(['threw', 'threw', 'threw', 'threw', 'threw'])],
  ['products', 'restock adds stock; a quantity that is not a positive whole number throws', [`const s = S(F); s.addProduct(P('MUG', 450, 0)); s.restock('MUG', 4); s.restock('MUG', 3); out([throws(() => s.restock('MUG', 0)), throws(() => s.restock('MUG', -2)), throws(() => s.restock('MUG', 1.5)), pv(s.getProduct('MUG'))])`], T(['threw', 'threw', 'threw', ['MUG', 450, 7, 0, 7]])],

  // Money
  ['money', 'a price that is not integer cents throws', [`const s = S(F); out([throws(() => s.addProduct(P('A', 4.5, 1))), throws(() => s.addProduct(P('B', '450', 1))), throws(() => s.addProduct(P('C', -1, 1))), throws(() => s.getProduct('A'))])`], T(['threw', 'threw', 'threw', 'threw'])],
  ['money', 'an order total is the exact sum of quantity times price, in cents', [`const s = S(F); s.addProduct(P('TEA', 199, 20)); s.addProduct(P('GUM', 1, 20)); s.addProduct(P('PEN', 10, 20)); out(s.placeOrder([{ sku: 'TEA', qty: 3 }, { sku: 'GUM', qty: 7 }, { sku: 'PEN', qty: 3 }], D1))`], T({ id: 1, status: 'open', totalCents: 634 })],
  ['money', 'report amounts are currency units with two decimals', [`const s = S(F); s.addProduct(P('GUM', 5, 20)); s.addProduct(P('MUG', 1250, 20)); s.addProduct(P('PEN', 10, 20)); s.placeOrder([{ sku: 'GUM', qty: 1 }, { sku: 'MUG', qty: 2 }, { sku: 'PEN', qty: 3 }], D1); s.fulfil(1, 'GUM', 1, D1); s.fulfil(1, 'MUG', 2, D1); s.fulfil(1, 'PEN', 3, D1); out(s.dailyReport(D1).split('\\n'))`], T([`Report ${D1}`, 'GUM: shipped 1, revenue 0.05, available 19', 'MUG: shipped 2, revenue 25.00, available 18', 'PEN: shipped 3, revenue 0.30, available 17', 'Total revenue 25.35'])],

  // Orders and reservations
  ['orders', 'an order reserves stock: available drops, stock does not', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); const o = s.placeOrder([{ sku: 'MUG', qty: 4 }], D1); out([o, pv(s.getProduct('MUG'))])`], T([{ id: 1, status: 'open', totalCents: 1800 }, ['MUG', 450, 10, 4, 6]])],
  ['orders', 'order ids count from 1', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); out([1, 2, 3].map(() => s.placeOrder([{ sku: 'MUG', qty: 1 }], D1).id))`], T([1, 2, 3])],
  ['orders', 'a later order sees what earlier orders reserved', [`const s = S(F); s.addProduct(P('MUG', 450, 5)); s.placeOrder([{ sku: 'MUG', qty: 3 }], D1); out([throws(() => s.placeOrder([{ sku: 'MUG', qty: 3 }], D1)), s.placeOrder([{ sku: 'MUG', qty: 2 }], D1).id, pv(s.getProduct('MUG'))])`], T(['threw', 2, ['MUG', 450, 5, 5, 0]])],
  ['orders', 'over-ordering one line refuses the whole order and reserves nothing', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.addProduct(P('TEA', 199, 2)); out([throws(() => s.placeOrder([{ sku: 'MUG', qty: 3 }, { sku: 'TEA', qty: 5 }], D1)), pv(s.getProduct('MUG')), pv(s.getProduct('TEA')), s.placeOrder([{ sku: 'TEA', qty: 2 }], D1).id])`], T(['threw', ['MUG', 450, 10, 0, 10], ['TEA', 199, 2, 0, 2], 1])],
  ['orders', 'unknown SKUs and bad quantities in an order throw and reserve nothing', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); out([throws(() => s.placeOrder([{ sku: 'MUG', qty: 1 }, { sku: 'NOPE', qty: 1 }], D1)), throws(() => s.placeOrder([{ sku: 'MUG', qty: 0 }], D1)), throws(() => s.placeOrder([{ sku: 'MUG', qty: 1.5 }], D1)), throws(() => s.getOrder(1)), s.getProduct('MUG').reserved])`], T(['threw', 'threw', 'threw', 'threw', 0])],

  // Fulfilment
  ['fulfilment', 'a partial shipment takes stock and reservation down; status partial', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.placeOrder([{ sku: 'MUG', qty: 5 }], D1); const o = s.fulfil(1, 'MUG', 2, D1); out([s.getOrder(1).status, pv(s.getProduct('MUG'))])`], T(['partial', ['MUG', 450, 8, 3, 5]])],
  ['fulfilment', 'fulfilled only once every line has shipped', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.addProduct(P('TEA', 199, 10)); s.placeOrder([{ sku: 'MUG', qty: 2 }, { sku: 'TEA', qty: 1 }], D1); const a = s.fulfil(1, 'MUG', 2, D1); const st1 = s.getOrder(1).status; s.fulfil(1, 'TEA', 1, D1); out([st1, s.getOrder(1), pv(s.getProduct('MUG')), pv(s.getProduct('TEA'))])`], T(['partial', { id: 1, status: 'fulfilled', totalCents: 1099 }, ['MUG', 450, 8, 0, 8], ['TEA', 199, 9, 0, 9]])],
  ['fulfilment', 'shipping more than a line still needs throws and changes nothing', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.addProduct(P('TEA', 199, 10)); s.placeOrder([{ sku: 'MUG', qty: 3 }], D1); s.fulfil(1, 'MUG', 2, D1); out([throws(() => s.fulfil(1, 'MUG', 2, D1)), throws(() => s.fulfil(1, 'TEA', 1, D1)), throws(() => s.fulfil(9, 'MUG', 1, D1)), s.getOrder(1).status, pv(s.getProduct('MUG'))])`], T(['threw', 'threw', 'threw', 'partial', ['MUG', 450, 8, 1, 7]])],
  ['fulfilment', 'a cancelled or fulfilled order cannot be shipped', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.placeOrder([{ sku: 'MUG', qty: 2 }], D1); s.placeOrder([{ sku: 'MUG', qty: 1 }], D1); s.cancel(1); s.fulfil(2, 'MUG', 1, D1); out([throws(() => s.fulfil(1, 'MUG', 1, D1)), throws(() => s.fulfil(2, 'MUG', 1, D1)), pv(s.getProduct('MUG'))])`], T(['threw', 'threw', ['MUG', 450, 9, 0, 9]])],

  // Cancellation
  ['cancel', 'cancelling an open order releases its whole reservation', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.addProduct(P('TEA', 199, 4)); s.placeOrder([{ sku: 'MUG', qty: 4 }, { sku: 'TEA', qty: 4 }], D1); out([s.cancel(1).status, s.getOrder(1).status, pv(s.getProduct('MUG')), pv(s.getProduct('TEA'))])`], T(['cancelled', 'cancelled', ['MUG', 450, 10, 0, 10], ['TEA', 199, 4, 0, 4]])],
  ['cancel', 'cancelling after a partial shipment releases only the unshipped part', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.placeOrder([{ sku: 'MUG', qty: 5 }], D1); s.placeOrder([{ sku: 'MUG', qty: 2 }], D1); s.fulfil(1, 'MUG', 2, D1); s.cancel(1); out([pv(s.getProduct('MUG')), s.getOrder(2).status])`], T([['MUG', 450, 8, 2, 6], 'open'])],
  ['cancel', 'a fulfilled or already cancelled order cannot be cancelled', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.placeOrder([{ sku: 'MUG', qty: 2 }], D1); s.placeOrder([{ sku: 'MUG', qty: 3 }], D1); s.fulfil(1, 'MUG', 2, D1); s.cancel(2); out([throws(() => s.cancel(1)), throws(() => s.cancel(2)), throws(() => s.cancel(7)), s.getOrder(1).status, pv(s.getProduct('MUG'))])`], T(['threw', 'threw', 'threw', 'fulfilled', ['MUG', 450, 8, 0, 8]])],

  // Low stock
  ['low-stock', 'low stock counts available (stock minus reserved), not stock', [`const s = S(F); s.addProduct(P('MUG', 450, 10, 3)); s.placeOrder([{ sku: 'MUG', qty: 7 }], D1); out(s.lowStock())`], T([{ sku: 'MUG', available: 3 }])],
  ['low-stock', 'at the threshold is low; one above is not; the default threshold is 0', [`const s = S(F); s.addProduct(P('AT', 100, 3, 3)); s.addProduct(P('ABOVE', 100, 4, 3)); s.addProduct(P('ZERO', 100, 0)); s.addProduct(P('ONE', 100, 1)); out(s.lowStock())`], T([{ sku: 'AT', available: 3 }, { sku: 'ZERO', available: 0 }])],
  ['low-stock', 'the low-stock list is by SKU ascending, whatever the order products were added', [`const s = S(F); for (const k of ['TEA', 'CUP', 'MUG', 'BAG']) s.addProduct(P(k, 100, 1, 5)); out(s.lowStock().map((x) => x.sku))`], T(['BAG', 'CUP', 'MUG', 'TEA'])],
  ['low-stock', 'a cancel that releases stock takes a product off the low-stock list', [`const s = S(F); s.addProduct(P('MUG', 450, 10, 3)); s.placeOrder([{ sku: 'MUG', qty: 8 }], D1); const before = s.lowStock().length; s.fulfil(1, 'MUG', 2, D1); s.cancel(1); out([before, s.lowStock(), pv(s.getProduct('MUG'))])`], T([1, [], ['MUG', 450, 8, 0, 8]])],

  // Daily report
  ['report', 'the report format: header, a line per product by SKU, total', [`const s = S(F); s.addProduct(P('TEA', 199, 10)); s.addProduct(P('CUP', 300, 5)); s.placeOrder([{ sku: 'TEA', qty: 3 }, { sku: 'CUP', qty: 1 }], D1); s.fulfil(1, 'TEA', 3, D1); s.fulfil(1, 'CUP', 1, D1); out(s.dailyReport(D1))`], T(`Report ${D1}\nCUP: shipped 1, revenue 3.00, available 4\nTEA: shipped 3, revenue 5.97, available 7\nTotal revenue 8.97`)],
  ['report', 'products are listed by SKU ascending, not in the order they were added', [`const s = S(F); for (const k of ['TEA', 'CUP', 'MUG', 'BAG']) s.addProduct(P(k, 100, 9)); out(s.dailyReport(D1).split('\\n').slice(1, -1).map((l) => l.split(':')[0]))`], T(['BAG', 'CUP', 'MUG', 'TEA'])],
  ['report', 'only shipments made on that date count; reserving and cancelling are not revenue', [`const s = S(F); s.addProduct(P('MUG', 450, 20)); s.placeOrder([{ sku: 'MUG', qty: 6 }], D1); s.fulfil(1, 'MUG', 2, D1); s.fulfil(1, 'MUG', 3, D2); s.placeOrder([{ sku: 'MUG', qty: 4 }], D2); s.cancel(2); out([s.dailyReport(D1).split('\\n'), s.dailyReport(D2).split('\\n'), s.dailyReport('2026-05-03').split('\\n')])`], T([[`Report ${D1}`, 'MUG: shipped 2, revenue 9.00, available 14', 'Total revenue 9.00'], [`Report ${D2}`, 'MUG: shipped 3, revenue 13.50, available 14', 'Total revenue 13.50'], ['Report 2026-05-03', 'MUG: shipped 0, revenue 0.00, available 14', 'Total revenue 0.00']])],
  ['report', 'LOW is appended to a product that is low by available count', [`const s = S(F); s.addProduct(P('MUG', 450, 10, 3)); s.addProduct(P('TEA', 199, 2, 1)); s.placeOrder([{ sku: 'MUG', qty: 7 }], D1); out(s.dailyReport(D1).split('\\n'))`], T([`Report ${D1}`, 'MUG: shipped 0, revenue 0.00, available 3 LOW', 'TEA: shipped 0, revenue 0.00, available 2', 'Total revenue 0.00'])],
  ['report', 'an empty shop reports only the header and a zero total', [`out(S(F).dailyReport(D1))`], T(`Report ${D1}\nTotal revenue 0.00`)],

  // Persistence across restarts
  ['persistence', 'a missing file is an empty shop', [`const s = S(F); out([s.lowStock(), throws(() => s.getProduct('MUG')), throws(() => s.getOrder(1))])`], T([[], 'threw', 'threw'])],
  ['persistence', 'products and reservations survive a restart', [`const s = S(F); s.addProduct(P('MUG', 450, 10, 3)); s.restock('MUG', 2); s.placeOrder([{ sku: 'MUG', qty: 9 }], D1)`, `const s = S(F); out([s.getProduct('MUG'), s.lowStock(), throws(() => s.placeOrder([{ sku: 'MUG', qty: 4 }], D1))])`], T([{ sku: 'MUG', name: 'MUG', priceCents: 450, stock: 12, reserved: 9, available: 3 }, [{ sku: 'MUG', available: 3 }], 'threw'])],
  ['persistence', 'order ids are not reused after a restart; statuses survive', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.placeOrder([{ sku: 'MUG', qty: 1 }], D1); s.placeOrder([{ sku: 'MUG', qty: 2 }], D1); s.fulfil(2, 'MUG', 1, D1); s.cancel(1)`, `const s = S(F); out([s.placeOrder([{ sku: 'MUG', qty: 1 }], D2).id, s.getOrder(1), s.getOrder(2)])`], T([3, { id: 1, status: 'cancelled', totalCents: 450 }, { id: 2, status: 'partial', totalCents: 900 }])],
  ['persistence', 'a partial order reopened and cancelled releases only its unshipped part', [`const s = S(F); s.addProduct(P('MUG', 450, 10)); s.placeOrder([{ sku: 'MUG', qty: 6 }], D1); s.placeOrder([{ sku: 'MUG', qty: 2 }], D1); s.fulfil(1, 'MUG', 4, D1)`, `S(F).cancel(1)`, `const s = S(F); out([pv(s.getProduct('MUG')), s.getOrder(1).status, s.getOrder(2).status])`], T([['MUG', 450, 6, 2, 4], 'cancelled', 'open'])],
  ['persistence', 'the report after a restart counts shipments made before it', [`const s = S(F); s.addProduct(P('TEA', 199, 10)); s.placeOrder([{ sku: 'TEA', qty: 5 }], D1); s.fulfil(1, 'TEA', 2, D1)`, `const s = S(F); s.fulfil(1, 'TEA', 1, D1)`, `out(S(F).dailyReport(D1).split('\\n'))`], T([`Report ${D1}`, 'TEA: shipped 3, revenue 5.97, available 5', 'Total revenue 5.97'])],
];

const PRELUDE = `
const fs = require('fs');
const S = (f) => require(${MOD}).createShop(f);
const out = (v) => process.stdout.write(JSON.stringify(v === undefined ? null : v));
const throws = (fn) => { try { fn(); return 'no throw'; } catch { return 'threw'; } };
const P = (sku, priceCents, stock, lowStockThreshold) => ({ sku, name: sku, priceCents, stock, ...(lowStockThreshold === undefined ? {} : { lowStockThreshold }) });
const pv = (p) => [p.sku, p.priceCents, p.stock, p.reserved, p.available];
const D1 = ${JSON.stringify(D1)}, D2 = ${JSON.stringify(D2)};
`;

/** Run one script of a case in a fresh node process; resolves {status, stdout, stderr}. */
function runScript(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [file], { cwd: ws, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 20000);
    child.on('close', (status) => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ status: 1, stdout, stderr: String(err.message) }); });
  });
}

async function runCase([area, name, scripts, want]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-check-shop-'));
  const F = path.join(dir, 'shop.json');
  let got = null;
  try {
    for (const s of scripts) {
      // A file, not node -e: quotes and line breaks in a case do not survive Windows argv quoting.
      const file = path.join(dir, 'case.js');
      fs.writeFileSync(file, `'use strict';\nconst F = ${JSON.stringify(F)};${PRELUDE}${s}\n`);
      const r = await runScript(file);
      got = r.status === 0 ? r.stdout : `error: ${(r.stderr || '').trim().split('\n').filter((l) => /Error|error/.test(l)).shift() || 'exit ' + r.status}`;
      if (r.status !== 0) break;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const ok = got === want;
  return { area, name, ok, ...(ok ? {} : { detail: `expected ${want}, got ${got}` }) };
}

(async () => {
  // Cases are independent (own directory, own processes): run a few at once, report in order.
  const cases = new Array(CASES.length);
  let next = 0;
  const worker = async () => { while (next < CASES.length) { const i = next++; cases[i] = await runCase(CASES[i]); } };
  await Promise.all(Array.from({ length: Math.min(8, Math.max(2, os.cpus().length)) }, worker));
  const per_area = {};
  for (const c of cases) {
    const a = (per_area[c.area] = per_area[c.area] || { passed: 0, total: 0 });
    a.total++; if (c.ok) a.passed++;
  }
  const out = { passed: cases.every((c) => c.ok), failed: cases.filter((c) => !c.ok).length, cases, per_area };
  console.log(JSON.stringify(out));
  process.exitCode = out.passed ? 0 : 1;
})();
