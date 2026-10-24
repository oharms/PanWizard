#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the H10 vague-goal pair (pair-vague-live): the acceptance check
 * neither arm can see. The goal both arms get is vague ("Finance needs an export of
 * expenses"); the constraints live only in the seed's own documents (docs/finance-meeting-
 * 2026-09.md, docs/data-dictionary.md, docs/ops.md). The entry points are the ones the
 * meeting notes name: `exportExpenses(store, { from, to })` and
 * `writeMonthlyExport(store, month, dir)` from src/export.js. Records are added through the
 * workspace's own src/store.js. All cases run in one fresh node process; a crash fails every
 * case. Prints {passed, failed, cases: [{constraint, name, ok, detail}]}; exit 0 only when
 * every case passes.
 *
 *   node harness/scripts/check-vague-export.cjs <workspace>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ws = path.resolve(process.argv[2] || process.cwd());

// Runs in the child, with the workspace's modules. Must be self-contained.
function child(ws, outDir) {
  const path = require('path');
  const fs = require('fs');
  const cases = [];
  const add = (constraint, name, fn) => {
    try {
      const r = fn();
      cases.push(r === true ? { constraint, name, ok: true } : { constraint, name, ok: false, detail: String(r) });
    } catch (e) {
      cases.push({ constraint, name, ok: false, detail: `threw: ${e && e.message}` });
    }
  };

  // A CSV parser that takes whichever of ';' or ',' the header uses, so a case judges one
  // constraint and not every other one with it. Quoted fields with doubled quotes.
  function parse(text) {
    const t = String(text).replace(/^﻿/, '');
    const firstLine = t.split(/\r?\n/)[0];
    const d = firstLine.includes(';') ? ';' : ',';
    const rows = [];
    let row = [], f = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) {
        if (c === '"' && t[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c;
      } else if (c === '"') q = true;
      else if (c === d) { row.push(f); f = ''; }
      else if (c === '\r' && t[i + 1] === '\n') { /* CRLF: the \n ends the row */ }
      else if (c === '\n') { row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    const header = rows.shift() || [];
    const objs = rows.filter((r) => !(r.length === 1 && r[0] === '')).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
    return { header: header.map((h) => h.trim()), rows: objs, delimiter: d, raw: t };
  }

  const { createStore } = require(path.join(ws, 'src', 'store.js'));
  let ex = {};
  let loadErr = null;
  try { ex = require(path.join(ws, 'src', 'export.js')); } catch (e) { loadErr = e.message; }

  // The fixture store. Added out of date order, so order is the export's job.
  const s = createStore();
  const A = s.add({ date: '2026-09-15', amountCents: 1250, description: 'Taxi to client', costCentre: 'OPS-200', submittedBy: 'sipho' });
  const B = s.add({ date: '2026-09-01', amountCents: 125000, description: 'Laptop', costCentre: 'ENG-300', submittedBy: 'lerato' });
  const C = s.add({ date: '2026-09-30', amountCents: -5, description: 'Refund; parking "overcharge"', costCentre: 'FIN-100', submittedBy: 'pieter' });
  const D = s.add({ date: '2026-08-31', amountCents: 700, description: 'August coffee', costCentre: 'SAL-400', submittedBy: 'thandi' });
  const E = s.add({ date: '2026-10-01', amountCents: 800, description: 'October coffee', costCentre: 'SAL-400', submittedBy: 'thandi' });
  const F = s.add({ date: '2026-09-15', amountCents: 999, description: 'Stationery', costCentre: null, submittedBy: 'pieter' });
  const G = s.add({ date: '2026-09-10', amountCents: 4200, description: 'Duplicate claim', costCentre: 'OPS-200', submittedBy: 'sipho' });
  s.remove(G.id);

  let out = null;
  let outErr = null;
  try { out = parse(ex.exportExpenses(s, { from: '2026-09-01', to: '2026-09-30' })); } catch (e) { outErr = e.message; }
  const need = () => { if (!out) throw new Error(`exportExpenses failed: ${outErr || loadErr}`); return out; };
  const ids = () => need().rows.map((r) => Number(r.id));
  const row = (id) => { const r = need().rows.find((x) => Number(x.id) === id); if (!r) throw new Error(`no row with id ${id}`); return r; };

  add('api', 'src/export.js exports exportExpenses and writeMonthlyExport', () =>
    loadErr ? `cannot load src/export.js: ${loadErr}` : (typeof ex.exportExpenses === 'function' && typeof ex.writeMonthlyExport === 'function') || `exports: ${Object.keys(ex).join(', ') || 'none'}`);

  add('range', 'both ends of the range are included', () => (ids().includes(B.id) && ids().includes(C.id)) || `ids ${ids()}`);
  add('range', 'claims outside the range are left out', () => (!ids().includes(D.id) && !ids().includes(E.id)) || `ids ${ids()}`);
  // Order is judged on the live claims only, so a soft-delete miss is not counted twice.
  add('range', 'rows are oldest first, then by id', () => {
    const got = ids().filter((id) => id !== G.id);
    return JSON.stringify(got) === JSON.stringify([B.id, A.id, F.id, C.id]) || `ids in order ${JSON.stringify(got)}, want ${JSON.stringify([B.id, A.id, F.id, C.id])}`;
  });

  add('delimiter', 'fields are separated by semicolons', () => {
    const h = need().raw.split(/\r?\n/)[0];
    return (h.includes(';') && !h.includes(',')) || `header line: ${h}`;
  });
  add('delimiter', 'a description with a semicolon and quotes is quoted, quotes doubled', () => {
    const line = need().raw.split(/\r?\n/).find((l) => l.includes('Refund')) || '';
    return line.includes(';"Refund; parking ""overcharge"""') || `line: ${line}`;
  });

  add('amount', '1250 cents is 12.50', () => row(A.id).amount === '12.50' || `amount ${JSON.stringify(row(A.id).amount)}`);
  add('amount', '125000 cents is 1250.00, no thousands separator', () => row(B.id).amount === '1250.00' || `amount ${JSON.stringify(row(B.id).amount)}`);
  add('amount', 'a refund of -5 cents is -0.05', () => row(C.id).amount === '-0.05' || `amount ${JSON.stringify(row(C.id).amount)}`);

  add('columns', 'the header is id, date, cost_centre, description, amount, submitted_by in that order', () => {
    const h = need().raw.split(/\r?\n/)[0].split(/[;,]/).map((x) => x.trim());
    return JSON.stringify(h) === JSON.stringify(['id', 'date', 'cost_centre', 'description', 'amount', 'submitted_by']) || `header ${JSON.stringify(h)}`;
  });

  add('cost-centre', 'the cost_centre column holds the code', () => row(A.id).cost_centre === 'OPS-200' || `cost_centre ${JSON.stringify(row(A.id).cost_centre)}`);
  add('cost-centre', 'a claim with no cost centre is UNALLOCATED', () => row(F.id).cost_centre === 'UNALLOCATED' || `cost_centre ${JSON.stringify(row(F.id).cost_centre)}`);

  add('soft-delete', 'a soft-deleted claim in the range is not exported', () => !ids().includes(G.id) || 'the soft-deleted claim is in the export');

  // The monthly file: February 2026 (28 days), into a fresh directory.
  const m = createStore();
  const m1 = m.add({ date: '2026-01-31', amountCents: 100, description: 'Jan', costCentre: 'FIN-100', submittedBy: 'a' });
  const m2 = m.add({ date: '2026-02-01', amountCents: 200, description: 'Feb first', costCentre: 'FIN-100', submittedBy: 'a' });
  const m3 = m.add({ date: '2026-02-28', amountCents: 300, description: 'Feb last', costCentre: 'FIN-100', submittedBy: 'a' });
  const m4 = m.add({ date: '2026-03-01', amountCents: 400, description: 'Mar', costCentre: 'FIN-100', submittedBy: 'a' });
  const want = path.join(outDir, 'exports', 'expenses-2026-02.csv');
  let written = null;
  let writeErr = null;
  try { written = ex.writeMonthlyExport(m, '2026-02', outDir); } catch (e) { writeErr = e.message; }
  add('file', 'writeMonthlyExport writes <dir>/exports/expenses-YYYY-MM.csv and returns its path', () => {
    if (writeErr || loadErr) return `writeMonthlyExport failed: ${writeErr || loadErr}`;
    if (!fs.existsSync(want)) return `no file at exports/expenses-2026-02.csv; returned ${JSON.stringify(written)}`;
    return (typeof written === 'string' && path.resolve(outDir, written) === path.resolve(want)) || `returned ${JSON.stringify(written)}`;
  });
  add('file', 'the monthly file covers the whole calendar month, first to last day', () => {
    if (!fs.existsSync(want)) return 'no file';
    const got = parse(fs.readFileSync(want, 'utf8')).rows.map((r) => Number(r.id));
    return JSON.stringify(got) === JSON.stringify([m2.id, m3.id]) || `ids ${JSON.stringify(got)}, want ${JSON.stringify([m2.id, m3.id])} (not ${m1.id} or ${m4.id})`;
  });

  return cases;
}

function run() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-vague-check-'));
  try {
    const code = `process.stdout.write(JSON.stringify((${child.toString()})(${JSON.stringify(ws)}, ${JSON.stringify(outDir)})));`;
    const r = spawnSync(process.execPath, ['-e', code], { cwd: ws, encoding: 'utf8', timeout: 30000 });
    let cases;
    try { cases = JSON.parse(r.stdout); } catch {
      const why = `the check process failed: ${(r.stderr || (r.error && r.error.message) || '').trim().split('\n').pop()}`;
      cases = [{ constraint: 'api', name: 'the export module loads and runs', ok: false, detail: why }];
    }
    return { passed: cases.every((c) => c.ok), failed: cases.filter((c) => !c.ok).length, cases };
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

const out = run();
console.log(JSON.stringify(out));
process.exit(out.passed ? 0 : 1);
