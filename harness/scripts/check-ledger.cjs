#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the H10 large-project pair (pair-ledger-live): the acceptance check
 * neither arm can see, over the six-phase ledger roadmap of seed ledger-roadmap. Cases cover
 * every phase's requirements and the cross-phase regressions (phase 5's storage change under
 * import, categories and reports; phase 6 on a migrated ledger). Each script runs in a fresh
 * node process with its own ledger file, so persistence is tested across real restarts.
 * Prints {passed, failed, cases: [{phase, req, name, ok, regression?, detail?}],
 * per_phase: {1: {passed, total}, ...}, regressions} where `regressions` counts the failed
 * cross-phase cases. Exit 0 only when every case passes.
 *
 *   node harness/scripts/check-ledger.cjs <workspace>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ws = path.resolve(process.argv[2] || process.cwd());
const mod = (n) => JSON.stringify(path.join(ws, 'src', n + '.js'));

// A ledger file as the app writes it after phase 4: decimals, no version (a copy of the
// seed's data/sample-ledger.json, kept here so a workspace cannot change what is checked).
const SAMPLE = '{"nextId":10,"entries":[{"id":1,"date":"2026-03-01","amount":2500,"payee":"ACME Payroll","memo":"March salary","category":"income"},{"id":2,"date":"2026-03-02","amount":-19.99,"payee":"Corner Shop","memo":"","category":"groceries"},{"id":3,"date":"2026-03-03","amount":-0.29,"payee":"City Parking","memo":"meter","category":null},{"id":4,"date":"2026-03-05","amount":-1.15,"payee":"Corner Shop","memo":"milk","category":"groceries"},{"id":6,"date":"2026-03-09","amount":-4.35,"payee":"Bean There Cafe","memo":"","category":"eating out"},{"id":7,"date":"2026-03-15","amount":-1234.56,"payee":"Landlord","memo":"rent","category":"housing"},{"id":8,"date":"2026-04-01","amount":-100.1,"payee":"FreshMart","memo":"","category":"groceries"}],"rules":[{"payeeContains":"shop","category":"groceries"},{"payeeContains":"freshmart","category":"groceries"},{"payeeContains":"cafe","category":"eating out"}]}';

const T = (o) => JSON.stringify(o);
const st = (category, budget, spent, remaining, status) => ({ category, budget, spent, remaining, status });
// [phase, req, name, [script, ...], expected JSON of the last script's output, regression?]
const CASES = [
  // Phase 1: ledger
  [1, 'LEDGER-01', 'add returns the entry with defaults', [`out(pick(L(F).add({ date: '2026-01-05', amount: -12.5, payee: 'Corner Shop' })))`], T({ id: 1, date: '2026-01-05', amount: -12.5, payee: 'Corner Shop', memo: '', category: null })],
  [1, 'LEDGER-01', 'invalid dates, amounts and payees throw', [`const l = L(F); const a = (o) => throws(() => l.add({ date: '2026-01-05', amount: 1, payee: 'p', ...o })); out([a({ date: '2026-1-5' }), a({ date: '2026-02-30' }), a({ amount: 1.005 }), a({ amount: NaN }), a({ amount: '5' }), a({ payee: '' }), l.list().length])`], T(['threw', 'threw', 'threw', 'threw', 'threw', 'threw', 0])],
  [1, 'LEDGER-01', 'two-decimal amounts are accepted as given', [`const l = L(F); out([0.29, 19.99, -4.35, -1.15, 1234.56].map((amount, i) => l.add({ date: '2026-01-0' + (i + 1), amount, payee: 'p' }).amount))`], T([0.29, 19.99, -4.35, -1.15, 1234.56])],
  [1, 'LEDGER-02', 'a reopened ledger sees the entries', [`const l = L(F); l.add({ date: '2026-01-05', amount: -12.5, payee: 'Shop', memo: 'm' }); l.add({ date: '2026-01-06', amount: 3, payee: 'Bank' })`, `out(L(F).list().map(row))`], T([[1, '2026-01-05', -12.5, 'Shop', 'm', null], [2, '2026-01-06', 3, 'Bank', '', null]])],
  [1, 'LEDGER-02', 'a missing file is an empty ledger', [`out(L(F).list())`], T([])],
  [1, 'LEDGER-03', 'ids are not reused after a remove', [`const l = L(F); l.add(E('a')); l.add(E('b')); l.remove(2); out(l.add(E('c')).id)`], T(3)],
  [1, 'LEDGER-03', 'ids are not reused after removing the last entry and reopening', [`const l = L(F); l.add(E('a')); l.add(E('b')); l.remove(2)`, `out(L(F).add(E('c')).id)`], T(3)],
  [1, 'LEDGER-04', 'list filters an inclusive date range, ordered by date then id', [`const l = L(F); for (const d of ['2026-03-10', '2026-03-01', '2026-03-10', '2026-03-31', '2026-04-01']) l.add({ date: d, amount: -1, payee: 'p' }); const ids = (o) => l.list(o).map((e) => e.id); out([ids({ from: '2026-03-01', to: '2026-03-10' }), ids({ from: '2026-03-10' }), ids({ to: '2026-03-01' }), ids()])`], T([[2, 1, 3], [1, 3, 4, 5], [2], [2, 1, 3, 4, 5]])],
  [1, 'LEDGER-04', 'removing an unknown id throws', [`const l = L(F); l.add(E('a')); out([throws(() => l.remove(9)), l.list().length])`], T(['threw', 1])],

  // Phase 2: CSV import
  [2, 'IMPORT-01', 'header in any order and letter case; memo optional', [`const r = I.importCSV(L(F), 'Amount,DATE,Payee\\n-3.5,2026-02-01,Shop A\\n10,2026-02-02,Employer\\n'); out([r, L(F).list().map(row)])`], T([{ added: 2, skipped: 0, errors: [] }, [[1, '2026-02-01', -3.5, 'Shop A', '', null], [2, '2026-02-02', 10, 'Employer', '', null]]])],
  [2, 'IMPORT-01', 'quoted fields keep commas and doubled quotes; thousands separators', [`I.importCSV(L(F), 'date,payee,amount,memo\\n2026-02-03,"Smith, Jones ""Ltd""","-1,234.56","a, b"\\n')`, `out(L(F).list().map(row))`], T([[1, '2026-02-03', -1234.56, 'Smith, Jones "Ltd"', 'a, b', null]])],
  [2, 'IMPORT-01', 'CRLF lines import and the entries survive a reopen', [`out(I.importCSV(L(F), 'date,payee,amount\\r\\n2026-02-01,A,-1.5\\r\\n\\r\\n2026-02-02,B,2\\r\\n').added)`, `out(L(F).list().map((e) => [e.payee, e.amount]))`], T([['A', -1.5], ['B', 2]])],
  [2, 'IMPORT-02', 'invalid rows are reported by line and the rest still added', [`const r = I.importCSV(L(F), ['date,payee,amount', '2026-02-01,A,-1', '', '2026-02-31,B,-1', '2026-02-02,C,-1.234', '2026-02-03,,-1', '2026-02-04,D,abc', '2026-02-05,E,2'].join('\\n')); out([r.added, r.skipped, r.errors.map((e) => e.line), L(F).list().map((e) => e.payee)])`], T([2, 0, [4, 5, 6, 7], ['A', 'E']])],
  [2, 'IMPORT-03', 'a re-import skips rows already there; equal rows in one file are both added', [`const csv = 'date,payee,amount\\n2026-02-01,Cafe,-3\\n2026-02-01,Cafe,-3\\n2026-02-02,Cafe,-3.25\\n'; const l = L(F); l.add({ date: '2026-02-02', amount: -3.25, payee: 'Cafe' }); const r1 = I.importCSV(l, csv); const r2 = I.importCSV(L(F), csv); out([r1.added, r1.skipped, r2.added, r2.skipped, L(F).list().length])`], T([2, 1, 0, 3, 3])],

  // Phase 3: categories
  [3, 'CAT-01', 'categoryFor: the first matching rule, ignoring letter case', [`const rules = [{ payeeContains: 'SHOP', category: 'groceries' }, { payeeContains: 'corner', category: 'other' }]; out([C.categoryFor(rules, 'Corner Shop'), C.categoryFor(rules, 'corner cafe'), C.categoryFor(rules, 'Bank'), C.categoryFor([], 'x')])`], T(['groceries', 'other', null, null])],
  [3, 'CAT-02', 'rules persist in order; an empty rule throws', [`const l = L(F); l.addRule({ payeeContains: 'shop', category: 'groceries' }); l.addRule({ payeeContains: 'cafe', category: 'eating out' })`, `const l = L(F); out([l.rules().map((r) => [r.payeeContains, r.category]), throws(() => l.addRule({ payeeContains: '', category: 'x' })), throws(() => l.addRule({ payeeContains: 'x', category: '' }))])`], T([[['shop', 'groceries'], ['cafe', 'eating out']], 'threw', 'threw'])],
  [3, 'CAT-03', 'add takes its category from the rules; an explicit category wins', [`const l = L(F); l.addRule({ payeeContains: 'shop', category: 'groceries' }); l.add(E('Corner Shop')); l.add(E('Corner Shop', { category: 'gifts' })); l.add(E('Bank'))`, `out(L(F).list().map((e) => e.category))`], T(['groceries', 'gifts', null])],
  [3, 'CAT-03', 'imported entries are categorised by the rules', [`const l = L(F); l.addRule({ payeeContains: 'cafe', category: 'eating out' }); I.importCSV(l, 'date,payee,amount\\n2026-02-01,Bean There CAFE,-4.35\\n2026-02-01,Bank,-1\\n')`, `out(L(F).list().map((e) => e.category))`], T(['eating out', null])],
  [3, 'CAT-04', 'setCategory persists; null clears; an unknown id throws', [`const l = L(F); l.add(E('a')); l.add(E('b')); l.setCategory(1, 'x'); l.setCategory(2, 'y'); l.setCategory(2, null)`, `const l = L(F); out([l.list().map((e) => e.category), throws(() => l.setCategory(9, 'z'))])`], T([['x', null], 'threw'])],
  [3, 'CAT-04', 'applyRules fills only uncategorised entries', [`const l = L(F); l.add(E('Corner Shop')); l.add(E('Corner Shop', { category: 'gifts' })); l.add(E('Bank')); l.addRule({ payeeContains: 'shop', category: 'groceries' }); const n = l.applyRules(); out([n, L(F).list().map((e) => e.category)])`], T([1, ['groceries', 'gifts', null]])],

  // Phase 4: monthly reports
  [4, 'REPORT-01', 'monthly income, expenses and net over the month only', [`const m = R.monthly([e(1, '2026-03-01', 2500, 'income'), e(2, '2026-03-02', -19.99, 'groceries'), e(3, '2026-03-31', -0.29), e(4, '2026-04-01', -100, 'groceries'), e(5, '2026-02-28', 50)], '2026-03'); out([m.month, m.income, m.expenses, m.net])`], T(['2026-03', 2500, 20.28, 2479.72])],
  [4, 'REPORT-01', 'totals are exact to the cent', [`const xs = [e(1, '2026-05-01', 0.1), e(2, '2026-05-02', 0.2)]; for (let i = 0; i < 10; i++) xs.push(e(3 + i, '2026-05-03', -0.1)); const m = R.monthly(xs, '2026-05'); out([m.income, m.expenses, m.net])`], T([0.3, 1, -0.7])],
  [4, 'REPORT-02', 'byCategory nets each category; no category is uncategorized', [`out(sortKeys(R.monthly([e(1, '2026-03-02', -19.99, 'groceries'), e(2, '2026-03-05', -1.15, 'groceries'), e(3, '2026-03-06', 0.14, 'groceries'), e(4, '2026-03-03', -0.29), e(5, '2026-03-01', 2500, 'income'), e(6, '2026-04-01', -7, 'fun')], '2026-03').byCategory))`], T({ groceries: -21, income: 2500, uncategorized: -0.29 })],
  [4, 'REPORT-03', 'trend covers empty months and the year boundary', [`out(R.trend([e(1, '2025-11-30', 10), e(2, '2026-01-01', -0.1), e(3, '2026-01-31', -0.2), e(4, '2026-03-01', 5)], '2025-11', '2026-02'))`], T([{ month: '2025-11', net: 10 }, { month: '2025-12', net: 0 }, { month: '2026-01', net: -0.3 }, { month: '2026-02', net: 0 }])],

  // Phase 5: integer cents and the migration
  [5, 'CENTS-01', 'the file is version 2 in integer cents, without amount', [`const l = L(F); l.add({ date: '2026-01-05', amount: -19.99, payee: 'Shop' }); l.add({ date: '2026-01-06', amount: 0.29, payee: 'Bank' }); const j = raw(); out([j.version, j.nextId, j.entries.map((x) => [x.cents, 'amount' in x])])`], T([2, 3, [[-1999, false], [29, false]]])],
  [5, 'CENTS-01', 'a version 2 file reopens with exact amounts', [`const l = L(F); for (const amount of [-19.99, -1.15, 0.29, -1234.56]) l.add({ date: '2026-01-05', amount, payee: 'p' })`, `out(L(F).list().map((x) => x.amount))`], T([-19.99, -1.15, 0.29, -1234.56])],
  [5, 'CENTS-02', 'a phase 1-4 file opens with every amount exact', [`put(SAMPLE); out(L(F).list().map(row))`], T([[1, '2026-03-01', 2500, 'ACME Payroll', 'March salary', 'income'], [2, '2026-03-02', -19.99, 'Corner Shop', '', 'groceries'], [3, '2026-03-03', -0.29, 'City Parking', 'meter', null], [4, '2026-03-05', -1.15, 'Corner Shop', 'milk', 'groceries'], [6, '2026-03-09', -4.35, 'Bean There Cafe', '', 'eating out'], [7, '2026-03-15', -1234.56, 'Landlord', 'rent', 'housing'], [8, '2026-04-01', -100.1, 'FreshMart', '', 'groceries']])],
  [5, 'CENTS-02', 'the migration writes version 2 cents and a byte-for-byte backup', [`put(SAMPLE); L(F); const j = raw(); out([j.version, j.entries.map((x) => x.cents), fs.existsSync(F + '.v1.bak') && fs.readFileSync(F + '.v1.bak', 'utf8') === SAMPLE])`], T([2, [250000, -1999, -29, -115, -435, -123456, -10010], true])],
  [5, 'CENTS-02', 'the migration keeps nextId, rules and categories', [`put(SAMPLE); const l = L(F); const x = l.add({ date: '2026-04-02', amount: -2, payee: 'Corner Shop' }); out([x.id, x.category, l.rules().length])`], T([10, 'groceries', 3])],
  [5, 'CENTS-02', 'a legacy file without nextId or rules continues from the largest id', [`put({ entries: [{ id: 4, date: '2026-01-02', amount: -1.15, payee: 'a', memo: '', category: null }, { id: 2, date: '2026-01-01', amount: 0.29, payee: 'b', memo: '', category: null }] }); const l = L(F); out([l.add(E('c')).id, l.rules(), L(F).list().map((x) => x.amount)])`], T([5, [], [0.29, -1.15, -1]])],
  [5, 'CENTS-03', 'a newer file version is refused and left untouched', [`const s = '{"version":3,"nextId":1,"entries":[]}'; put(s); const m = msg(() => L(F)); out([/unsupported/i.test(String(m)), fs.readFileSync(F, 'utf8') === s])`], T([true, true])],
  [5, 'CENTS-04', 'regression: the monthly report of the migrated sample is unchanged', [`put(SAMPLE); L(F)`, `const m = R.monthly(L(F).list(), '2026-03'); out([m.income, m.expenses, m.net, sortKeys(m.byCategory)])`], T([2500, 1260.34, 1239.66, { 'eating out': -4.35, groceries: -21.14, housing: -1234.56, income: 2500, uncategorized: -0.29 }]), true],
  [5, 'CENTS-04', 'regression: import into a migrated ledger skips what it has and persists the rest', [`put(SAMPLE); const r = I.importCSV(L(F), 'date,payee,amount\\n2026-03-02,Corner Shop,-19.99\\n2026-04-03,Corner Shop,"-1,000.10"\\n'); out([r.added, r.skipped])`, `out([L(F).list({ from: '2026-04-01' }).map((x) => [x.id, x.amount, x.category]), raw().entries.every((x) => Number.isInteger(x.cents))])`], T([[[8, -100.1, 'groceries'], [10, -1000.1, 'groceries']], true]), true],
  [5, 'CENTS-04', 'regression: rules and applyRules work on a migrated ledger', [`put(SAMPLE); const l = L(F); l.addRule({ payeeContains: 'parking', category: 'transport' }); out(l.applyRules())`, `out(L(F).list().filter((x) => x.id === 3).map((x) => x.category))`], T(['transport']), true],
  [5, 'CENTS-04', 'regression: the trend over the migrated sample', [`put(SAMPLE); out(R.trend(L(F).list(), '2026-02', '2026-04'))`], T([{ month: '2026-02', net: 0 }, { month: '2026-03', net: 1239.66 }, { month: '2026-04', net: -100.1 }]), true],
  [5, 'CENTS-04', 'regression: ids stay unique after migrating, removing and reopening', [`put(SAMPLE); L(F).remove(8)`, `out(L(F).add(E('x')).id)`], T(10), true],

  // Phase 6: budgets
  [6, 'BUDGET-01', 'budgets persist in cents; 0 removes; invalid amounts throw', [`const l = L(F); l.setBudget('groceries', 400); l.setBudget('fun', 50.5); l.setBudget('x', 10); l.setBudget('x', 0)`, `const l = L(F); out([sortKeys(l.budgets()), sortKeys(raw().budgets), throws(() => l.setBudget('a', -5)), throws(() => l.setBudget('a', 1.001))])`], T([{ fun: 50.5, groceries: 400 }, { fun: 5050, groceries: 40000 }, 'threw', 'threw'])],
  [6, 'BUDGET-01', 'a version 2 file without budgets has none', [`put({ version: 2, nextId: 2, entries: [{ id: 1, date: '2026-01-01', cents: -150, payee: 'p', memo: '', category: 'fun' }], rules: [] }); const l = L(F); out([l.budgets(), l.list().map((x) => x.amount)])`], T([{}, [-1.5]])],
  [6, 'BUDGET-02', 'status: under 80% ok, 80% and 100% warning, above 100% over', [`const l = L(F); for (const [c, amount] of [['d', -100.01], ['a', -79.99], ['c', -100], ['b', -80]]) { l.setBudget(c, 100); l.add({ date: '2026-03-10', amount, payee: 'p', category: c }); } out(B.budgetStatus(l, '2026-03'))`], T([st('a', 100, 79.99, 20.01, 'ok'), st('b', 100, 80, 20, 'warning'), st('c', 100, 100, 0, 'warning'), st('d', 100, 100.01, -0.01, 'over')])],
  [6, 'BUDGET-02', 'spent is the monthly report net of the stored category; refunds count', [`const l = L(F); l.addRule({ payeeContains: 'shop', category: 'groceries' }); l.add({ date: '2026-03-01', amount: -50, payee: 'Corner Shop' }); const g = l.add({ date: '2026-03-02', amount: -30, payee: 'Corner Shop' }); l.setCategory(g.id, 'gifts'); l.add({ date: '2026-03-03', amount: -20, payee: 'Market', category: 'groceries' }); l.add({ date: '2026-03-04', amount: 5, payee: 'Corner Shop' }); l.add({ date: '2026-04-01', amount: -999, payee: 'Corner Shop' }); l.setBudget('groceries', 100)`, `const l = L(F); out([B.budgetStatus(l, '2026-03'), -R.monthly(l.list(), '2026-03').byCategory.groceries])`], T([[st('groceries', 100, 65, 35, 'ok')], 65])],
  [6, 'BUDGET-03', 'alerts: over first, then by name, percent rounded down', [`const l = L(F); for (const [c, b, amount] of [['rent', 1000, -999.99], ['groceries', 400, -412.5], ['travel', 10, -1], ['fun', 50, -40]]) { l.setBudget(c, b); l.add({ date: '2026-03-10', amount, payee: 'p', category: c }); } out(B.alerts(l, '2026-03'))`], T(['groceries: 412.50 of 400.00 (103%)', 'fun: 40.00 of 50.00 (80%)', 'rent: 999.99 of 1000.00 (99%)'])],
  [6, 'BUDGET-02', 'regression: budgets on the migrated sample ledger', [`put(SAMPLE); const l = L(F); l.setBudget('groceries', 21.14); l.setBudget('eating out', 5)`, `const l = L(F); out([B.budgetStatus(l, '2026-03'), raw().version, sortKeys(raw().budgets)])`], T([[st('eating out', 5, 4.35, 0.65, 'warning'), st('groceries', 21.14, 21.14, 0, 'warning')], 2, { 'eating out': 500, groceries: 2114 }]), true],
];

const PRELUDE = `
const fs = require('fs');
const SAMPLE = ${JSON.stringify(SAMPLE)};
const lazy = (n) => new Proxy({}, { get: (_, k) => require(n)[k] });
const L = (f) => require(${mod('ledger')}).openLedger(f);
const I = lazy(${mod('import')}), C = lazy(${mod('categories')}), R = lazy(${mod('report')}), B = lazy(${mod('budget')});
const out = (v) => process.stdout.write(JSON.stringify(v === undefined ? null : v));
const throws = (fn) => { try { fn(); return 'no throw'; } catch { return 'threw'; } };
const msg = (fn) => { try { fn(); return null; } catch (err) { return String(err && err.message); } };
const raw = () => JSON.parse(fs.readFileSync(F, 'utf8'));
const put = (v) => fs.writeFileSync(F, typeof v === 'string' ? v : JSON.stringify(v));
const row = (x) => [x.id, x.date, x.amount, x.payee, x.memo, x.category];
const pick = (x) => ({ id: x.id, date: x.date, amount: x.amount, payee: x.payee, memo: x.memo, category: x.category });
const sortKeys = (o) => Object.fromEntries(Object.entries(o || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
const E = (payee, o = {}) => ({ date: '2026-01-05', amount: -1, payee, ...o });
const e = (id, date, amount, category = null) => ({ id, date, amount, payee: 'p' + id, memo: '', category });
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

async function runCase([phase, req, name, scripts, want, regression]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-check-ledger-'));
  const F = path.join(dir, 'ledger.json');
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
  return { phase, req, name, ok, ...(regression ? { regression: true } : {}), ...(ok ? {} : { detail: `expected ${want}, got ${got}` }) };
}

(async () => {
  // Cases are independent (own directory, own processes): run a few at once, report in order.
  const cases = new Array(CASES.length);
  let next = 0;
  const worker = async () => { while (next < CASES.length) { const i = next++; cases[i] = await runCase(CASES[i]); } };
  await Promise.all(Array.from({ length: Math.min(8, Math.max(2, os.cpus().length)) }, worker));
  const per_phase = {};
  for (const c of cases) {
    const p = (per_phase[c.phase] = per_phase[c.phase] || { passed: 0, total: 0 });
    p.total++; if (c.ok) p.passed++;
  }
  const out = { passed: cases.every((c) => c.ok), failed: cases.filter((c) => !c.ok).length, cases, per_phase, regressions: cases.filter((c) => c.regression && !c.ok).length };
  console.log(JSON.stringify(out));
  process.exitCode = out.passed ? 0 : 1;
})();
