#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the H10 hard pair (pair-discounts-live): the acceptance check
 * neither arm can see. It writes its own src/codes.json into the workspace (the rules say
 * applyDiscount reads that file when called), then runs one case per rule in a fresh node
 * process each. Prints {passed, cases: [{rule, name, ok, detail}]}.
 *
 *   node harness/scripts/check-discounts.cjs <workspace> [<module path>]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ws = process.argv[2] || process.cwd();
const mod = path.resolve(ws, process.argv[3] || 'src/invoice.js');
const codesPath = path.join(path.dirname(mod), 'codes.json');

const CODES = {
  SAVE10: { type: 'percent', value: 10, expires: '2026-12-31' },
  SAVE15: { type: 'percent', value: 15, expires: '2026-12-31' },
  FIVEOFF: { type: 'fixed', value: 500, expires: '2026-12-31' },
  OLD20: { type: 'percent', value: 20, expires: '2026-01-31' },
};
const inv = (subtotalCents, taxRate = 0) => ({ lines: [{ unitCents: subtotalCents, qty: 1 }], taxRate });
const TODAY = '2026-06-15';

// [rule, name, expression run in the module's context, expected]
const CASES = [
  [1, 'a percent code', `applyDiscount(${JSON.stringify(inv(1000))}, 'SAVE10', '${TODAY}')`, 900],
  [2, 'case and surrounding spaces ignored', `applyDiscount(${JSON.stringify(inv(1000))}, '  save10 ', '${TODAY}')`, 900],
  [3, 'tax on the discounted subtotal', `applyDiscount(${JSON.stringify(inv(1000, 0.2))}, 'FIVEOFF', '${TODAY}')`, 600],
  [4, 'a half cent rounds away from zero', `applyDiscount(${JSON.stringify(inv(1005))}, 'SAVE10', '${TODAY}')`, 904],
  [4, 'a percent discount rounds to the nearest cent', `applyDiscount(${JSON.stringify(inv(333))}, 'SAVE15', '${TODAY}')`, 283],
  [5, 'a fixed discount never goes below zero', `applyDiscount(${JSON.stringify(inv(300, 0.2))}, 'FIVEOFF', '${TODAY}')`, 0],
  [6, 'valid on its expiry day', `applyDiscount(${JSON.stringify(inv(1000))}, 'OLD20', '2026-01-31')`, 800],
  [6, 'an expired code throws, naming the code', `(() => { try { applyDiscount(${JSON.stringify(inv(1000))}, 'old20', '2026-02-01'); return 'no throw'; } catch (e) { return /old20/.test(e.message) ? 'threw' : 'message: ' + e.message; } })()`, 'threw'],
  [6, 'an unknown code throws, naming the code', `(() => { try { applyDiscount(${JSON.stringify(inv(1000))}, 'NOPE7', '${TODAY}'); return 'no throw'; } catch (e) { return /NOPE7/.test(e.message) ? 'threw' : 'message: ' + e.message; } })()`, 'threw'],
  [0, 'total() keeps its behaviour', `total({ lines: [{ unitCents: 250, qty: 2 }, { unitCents: 1000, qty: 1 }], taxRate: 0.15 })`, 1725],
];

function run() {
  let saved = null;
  try { saved = fs.readFileSync(codesPath, 'utf8'); } catch {}
  fs.mkdirSync(path.dirname(codesPath), { recursive: true });
  fs.writeFileSync(codesPath, JSON.stringify(CODES, null, 2));
  const cases = [];
  try {
    for (const [rule, name, expr, want] of CASES) {
      const code = `const { applyDiscount, total } = require(${JSON.stringify(mod)}); const v = ${expr}; process.stdout.write(JSON.stringify(v === undefined ? null : v));`;
      const r = spawnSync(process.execPath, ['-e', code], { cwd: ws, encoding: 'utf8', timeout: 20000 });
      let got;
      try { got = JSON.parse(r.stdout); } catch { got = `error: ${(r.stderr || '').trim().split('\n').pop()}`; }
      cases.push({ rule, name, ok: got === want, detail: got === want ? undefined : `expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}` });
    }
  } finally {
    if (saved !== null) fs.writeFileSync(codesPath, saved);
  }
  return { passed: cases.every((c) => c.ok), failed: cases.filter((c) => !c.ok).length, cases };
}

const out = run();
console.log(JSON.stringify(out));
process.exit(out.passed ? 0 : 1);
