'use strict';
// The reference implementation's own tests (the seed's `npm test` runs them).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openLedger } = require('../src/ledger');
const { importCSV } = require('../src/import');
const { monthly } = require('../src/report');
const { budgetStatus } = require('../src/budget');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')), 'l.json');

test('entries persist and ids are not reused', () => {
  const f = tmp();
  const l = openLedger(f);
  l.add({ date: '2026-01-01', amount: -1, payee: 'a' });
  l.add({ date: '2026-01-02', amount: -2, payee: 'b' });
  l.remove(2);
  assert.equal(openLedger(f).add({ date: '2026-01-03', amount: 0.29, payee: 'c' }).id, 3);
});

test('import, categories and the monthly report agree in cents', () => {
  const l = openLedger(tmp());
  l.addRule({ payeeContains: 'shop', category: 'groceries' });
  const r = importCSV(l, 'date,payee,amount\n2026-02-01,Corner Shop,-0.1\n2026-02-02,Corner Shop,-0.2\n');
  assert.deepEqual(r, { added: 2, skipped: 0, errors: [] });
  assert.equal(monthly(l.list(), '2026-02').byCategory.groceries, -0.3);
  l.setBudget('groceries', 0.3);
  assert.equal(budgetStatus(l, '2026-02')[0].status, 'warning');
});

test('a phase 1-4 file is migrated to version 2', () => {
  const f = tmp();
  fs.copyFileSync(path.join(__dirname, '..', 'data', 'sample-ledger.json'), f);
  assert.equal(openLedger(f).list()[1].amount, -19.99);
  assert.equal(JSON.parse(fs.readFileSync(f, 'utf8')).version, 2);
  assert.ok(fs.existsSync(f + '.v1.bak'));
});
