#!/usr/bin/env node
'use strict';
/**
 * Harness `sh` step for the H10 multi-phase pair (pair-roadmap-live): the acceptance check
 * neither arm can see. One case per requirement edge, each in a fresh node process with its
 * own store file, so persistence is tested across real restarts. Prints
 * {passed, failed, cases: [{req, name, ok, detail}]}.
 *
 *   node harness/scripts/check-tasks.cjs <workspace>
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ws = path.resolve(process.argv[2] || process.cwd());
const store = path.join(ws, 'src', 'store.js');
const report = path.join(ws, 'src', 'report.js');

// Each script runs in its own process; F is a fresh store file shared by its steps.
// A case is [req, name, [script, script, ...], expected JSON of the last script's output].
const T = (o) => JSON.stringify(o);
const CASES = [
  ['STORE-01', 'add returns the task with defaults', [`const s = S(F); out(s.add('a'))`], T({ id: 1, title: 'a', priority: 'medium', due: null, done: false })],
  ['STORE-01', 'an unknown priority throws', [`const s = S(F); out(throws(() => s.add('a', { priority: 'urgent' })))`], T('threw')],
  ['STORE-02', 'a reopened store sees the tasks', [`S(F).add('a', { priority: 'high', due: '2026-03-01' })`, `out(S(F).list().map((t) => [t.id, t.title, t.priority, t.due]))`], T([[1, 'a', 'high', '2026-03-01']])],
  ['STORE-03', 'ids are not reused after a remove', [`const s = S(F); s.add('a'); s.add('b'); s.remove(2); out(s.add('c').id)`], T(3)],
  ['STORE-03', 'ids are not reused after a reopen', [`const s = S(F); s.add('a'); s.add('b'); s.remove(2)`, `out(S(F).add('c').id)`], T(3)],
  ['STORE-04', 'complete marks done and persists', [`const s = S(F); s.add('a'); s.complete(1)`, `out(S(F).list({ status: 'done' }).map((t) => t.id))`], T([1])],
  ['STORE-04', 'list filters by status, ordered by id', [`const s = S(F); s.add('a'); s.add('b'); s.add('c'); s.complete(2); out([s.list({ status: 'open' }).map((t) => t.id), s.list().map((t) => t.id)])`], T([[1, 3], [1, 2, 3]])],
  ['STORE-04', 'an unknown id throws', [`const s = S(F); s.add('a'); out([throws(() => s.complete(9)), throws(() => s.remove(9))])`], T(['threw', 'threw'])],
  ['REPORT-01', 'due today is not overdue; done tasks are not overdue', [`out(R.overdue([t(1, 'medium', '2026-06-15'), t(2, 'medium', '2026-06-14'), t(3, 'medium', '2026-06-01', true)], '2026-06-15').map((x) => x.id))`], T([2])],
  ['REPORT-01', 'overdue sorted by due date, then id', [`out(R.overdue([t(3, 'low', '2026-06-10'), t(1, 'high', '2026-06-12'), t(2, 'low', '2026-06-10')], '2026-06-15').map((x) => x.id))`], T([2, 3, 1])],
  ['REPORT-02', 'by priority, no due date last, then id', [`out(R.byPriority([t(1, 'low', null), t(2, 'high', null), t(3, 'high', '2026-07-01'), t(4, 'medium', '2026-01-01'), t(5, 'high', '2026-07-01'), t(6, 'low', '2026-02-02', true)]).map((x) => x.id))`], T([3, 5, 2, 4, 1])],
  ['REPORT-03', 'CSV header and plain rows', [`out(R.toCSV([t(1, 'low', null, false, 'plain')]))`], T('id,title,priority,due,done\n1,plain,low,,false')],
  ['REPORT-03', 'CSV quotes commas, quotes and line breaks', [`out(R.toCSV([t(2, 'high', '2026-01-02', true, 'a, b "c"\\nd')]))`], T('id,title,priority,due,done\n2,"a, b ""c""\nd",high,2026-01-02,true')],
];

const PRELUDE = `
const S = (f) => require(${JSON.stringify(store)}).createStore(f);
const R = new Proxy({}, { get: (_, k) => require(${JSON.stringify(report)})[k] });
const out = (v) => process.stdout.write(JSON.stringify(v === undefined ? null : v));
const throws = (fn) => { try { fn(); return 'no throw'; } catch { return 'threw'; } };
const t = (id, priority, due, done = false, title = 't' + id) => ({ id, title, priority, due, done });
`;

const cases = [];
for (const [req, name, scripts, want] of CASES) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-check-tasks-'));
  const F = path.join(dir, 'tasks.json');
  let got = null;
  try {
    for (const s of scripts) {
      // A file, not node -e: quotes and line breaks in a case do not survive Windows argv quoting.
      const file = path.join(dir, 'case.js');
      fs.writeFileSync(file, `const F = ${JSON.stringify(F)};${PRELUDE}${s}`);
      const r = spawnSync(process.execPath, [file], { cwd: ws, encoding: 'utf8', timeout: 20000 });
      got = r.status === 0 ? r.stdout : `error: ${(r.stderr || '').trim().split('\n').filter(Boolean).pop() || 'exit ' + r.status}`;
      if (r.status !== 0) break;
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  cases.push({ req, name, ok: got === want, detail: got === want ? undefined : `expected ${want}, got ${got}` });
}
const out = { passed: cases.every((c) => c.ok), failed: cases.filter((c) => !c.ok).length, cases };
console.log(JSON.stringify(out));
process.exit(out.passed ? 0 : 1);
