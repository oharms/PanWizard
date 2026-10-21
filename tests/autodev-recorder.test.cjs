/**
 * Program A5: the autodev flight recorder, proof dossier and replay.
 *
 * Every stop decision is recorded with its inputs in `.planning/autodev/<run>/blackbox.jsonl`.
 * `autodev replay` re-runs the stop logic over the recorded inputs and must reach the
 * same decisions. `autodev report` builds the dossier (the PR body and an HTML page):
 * per phase, requirement → plans → units and commits → oracle evidence → verdict →
 * dispositions → cost. Snapshot test on a fixture ledger.
 */
'use strict';

const { describe, test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const A = require('../pan-wizard-core/bin/lib/autodev.cjs');
const R = require('../pan-wizard-core/bin/lib/autodev-report.cjs');

const dirs = [];
afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true }); });

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-rec-'));
  dirs.push(dir);
  const p = path.join(dir, '.planning');
  fs.mkdirSync(path.join(p, 'phases', '01-login'), { recursive: true });
  fs.writeFileSync(path.join(p, 'project.md'), '# P\n');
  fs.writeFileSync(path.join(p, 'requirements.md'), '# R\n');
  fs.writeFileSync(path.join(p, 'config.json'), JSON.stringify({ workflow: { phase_gate: 'warn' } }));
  fs.writeFileSync(path.join(p, 'roadmap.md'), '# Roadmap\n\n- [ ] **Phase 1: Login**\n\n### Phase 1: Login\n**Goal:** users sign in\n**Requirements**: AUTH-01, AUTH-02\n');
  return dir;
}

// A simulated host: writes what each unit would, costs $0.10.
function simulate(cwd, unit) {
  const dir = path.join(cwd, '.planning', 'phases', '01-login');
  if (unit.action === 'complete_phase') return A.executeUnit(cwd, unit, 'claude', {});
  if (unit.action === 'plan') fs.writeFileSync(path.join(dir, '01-01-plan.md'), '---\nphase: 01\n---\n');
  if (unit.action === 'execute') fs.writeFileSync(path.join(dir, '01-01-summary.md'), '# s\n');
  if (unit.action === 'verify') fs.writeFileSync(path.join(dir, '01-verification.md'), '---\nstatus: passed\ntest_gate: passed\n---\n');
  return { exit: 0, cost_usd: 0.1, argv: ['-p', 'sim'], duration_ms: 1 };
}

describe('A5: the flight recorder and replay', () => {
  test('every decision is recorded with its inputs, and replay reaches the same ones', () => {
    const dir = project();
    const r = A.runAutodev(dir, { host: 'claude', execute: simulate, maxUsd: 10 });
    assert.equal(r.stop.reason, 'done', JSON.stringify(r));
    const box = fs.readFileSync(path.join(dir, '.planning', 'autodev', r.run, 'blackbox.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(box.length, 5, 'one decision before each of 4 units, and the stop');
    assert.ok(box.every((b) => b.inputs && 'unit' in b.inputs && 'rows' in b.inputs && 'limits' in b.inputs && 'snapshot' in b.inputs));
    assert.equal(box[box.length - 1].decision.reason, 'done');
    const rep = R.replayRun(dir, r.run);
    assert.equal(rep.identical, true, JSON.stringify(rep));
    assert.equal(rep.entries, 5);
  });

  test('replay catches a decision that the stop logic would not make', () => {
    const dir = project();
    const r = A.runAutodev(dir, { host: 'claude', execute: simulate, maxUsd: 10 });
    const file = path.join(dir, '.planning', 'autodev', r.run, 'blackbox.jsonl');
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    lines[1].decision = { reason: 'turns', detail: 'forged' };
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const rep = R.replayRun(dir, r.run);
    assert.equal(rep.identical, false);
    assert.deepEqual(rep.mismatches.map((m) => m.index), [1]);
  });
});

describe('A5: the proof dossier', () => {
  function fixtureRun(dir) {
    const run = path.join(dir, '.planning', 'autodev', 'run-fixture');
    fs.mkdirSync(run, { recursive: true });
    fs.writeFileSync(path.join(run, 'run.json'), JSON.stringify({ id: 'run-fixture', started: '2026-10-20T10:00:00.000Z', host: 'claude', limits: { maxUsd: 10 } }));
    const u = (action) => ({ action, phase: '1', command: `/pan:${action}-phase 1` });
    const rows = [
      { seq: 1, attempt: 1, status: 'started', unit: u('plan') }, { seq: 1, attempt: 1, status: 'finished', unit: u('plan'), exit: 0, cost_usd: 0.4 },
      { seq: 2, attempt: 1, status: 'started', unit: u('execute') }, { seq: 2, attempt: 1, status: 'finished', unit: u('execute'), exit: 1, cost_usd: 0.5, failure_class: 'compile', policy: 'retry_with_tail' },
      { seq: 2, attempt: 2, status: 'started', unit: u('execute') }, { seq: 2, attempt: 2, status: 'finished', unit: u('execute'), exit: 0, cost_usd: 0.6, recovered_from: 'compile' },
      { seq: 3, attempt: 1, status: 'started', unit: u('verify') }, { seq: 3, attempt: 1, status: 'finished', unit: u('verify'), exit: 0, cost_usd: 0.3 },
      { seq: 4, attempt: 1, status: 'started', unit: { action: 'complete_phase', phase: '1', command: 'pan-tools phase complete 1' } }, { seq: 4, attempt: 1, status: 'finished', unit: { action: 'complete_phase', phase: '1', command: 'pan-tools phase complete 1' }, exit: 0, cost_usd: 0 },
      { status: 'stopped', reason: 'done', detail: 'every phase is finished; next: /pan:milestone-audit' },
    ];
    fs.writeFileSync(path.join(run, 'ledger.jsonl'), rows.map((x) => JSON.stringify(x)).join('\n') + '\n');
    const ph = path.join(dir, '.planning', 'phases', '01-login');
    fs.writeFileSync(path.join(ph, '01-01-plan.md'), '---\nphase: 01\n---\n');
    fs.writeFileSync(path.join(ph, '01-01-summary.md'), '# s\n');
    fs.writeFileSync(path.join(ph, '01-verification.md'), '---\nstatus: passed\ntest_gate: passed\n---\n');
    fs.writeFileSync(path.join(dir, '.planning', 'findings.jsonl'), [
      { kind: 'finding', id: 'F1', agent: 'pan-reviewer', phase: '01', ts: '2026-10-20T10:30:00Z', class: 'quality', severity: 'low', where: 'src/a.js:1', summary: 'name' },
    ].map((x) => JSON.stringify(x)).join('\n') + '\n');
    return 'run-fixture';
  }

  const SNAPSHOT = `# Autodev dossier: run-fixture

- **Host:** claude
- **Stopped:** done — every phase is finished; next: /pan:milestone-audit
- **Units:** 4 (5 attempts)
- **Spent:** $1.80 of $10.00

## Phase 1: Login

| | |
|---|---|
| Requirements | AUTH-01, AUTH-02 |
| Plans | 01-01-plan.md |
| Units | plan $0.40 · execute $1.10 (2 attempts: compile → retry_with_tail, recovered) · verify $0.30 · complete_phase |
| Commits | none recorded |
| Oracle | test gate passed |
| Verdict | verification passed |
| Findings | 1 (open 1) |
| Cost | $1.80 |
`;

  test('the dossier of a fixture ledger', () => {
    const dir = project();
    const id = fixtureRun(dir);
    const r = R.buildDossier(dir, id);
    assert.equal(r.markdown, SNAPSHOT);
  });

  test('autodev report writes the PR body and an HTML page beside the ledger', () => {
    const dir = project();
    const id = fixtureRun(dir);
    const r = R.writeDossier(dir, id);
    assert.equal(fs.readFileSync(path.join(dir, r.markdown), 'utf8'), SNAPSHOT);
    const html = fs.readFileSync(path.join(dir, r.html), 'utf8');
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<h2>Phase 1: Login<\/h2>/);
    assert.match(html, /AUTH-01, AUTH-02/);
    assert.doesNotMatch(html, /<script/i);
  });
});
