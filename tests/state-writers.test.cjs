/**
 * Program A7b: the writers of state.md go through pan-tools verbs.
 *
 * `state init` writes a fresh state.md (new-project, the roadmapper, milestone-new,
 * resume's reconstruction), `state section` appends to or sets one section (add-phase,
 * insert-phase, todo-check), `state quick-task` adds a quick-task row, and `state apply`
 * makes transition's batched update in one write. No shipped prompt tells an agent to
 * Write or Edit state.md, so the guard's `enforce` can deny a direct write
 * (tests/guard-hook.test.cjs).
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let dir;
const statePath = () => path.join(dir, '.planning', 'state.md');
const state = () => fs.readFileSync(statePath(), 'utf8');
const pan = (args) => {
  const r = spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout); } catch {}
  return { success: r.status === 0, output: r.stdout, error: r.stderr, json };
};

beforeEach(() => { dir = createTempProject(); try { fs.rmSync(statePath()); } catch {} });
afterEach(() => cleanup(dir));

describe('state init (A7b)', () => {
  test('writes every section of the template, filled from the flags', () => {
    const r = pan(['state', 'init', '--core-value', 'Ship fast', '--focus', 'Foundation', '--phase', '1', '--phase-name', 'Foundation', '--total-phases', '4']);
    assert.ok(r.success, r.error);
    const s = state();
    for (const h of ['## Project Reference', '## Current Position', '## Performance Metrics', '## Accumulated Context', '### Decisions', '### Pending Todos', '### Blockers/Concerns', '## Session Continuity']) assert.ok(s.includes(h), h);
    assert.match(s, /\*\*Core value:\*\* Ship fast/);
    assert.match(s, /\*\*Current Phase:\*\* 1/);
    assert.match(s, /\*\*Current Phase Name:\*\* Foundation/);
    assert.match(s, /\*\*Total Phases:\*\* 4/);
    assert.match(s, /\*\*Status:\*\* Ready to plan/);
    assert.match(s, /^---\n/, 'frontmatter synced by the state writer');
  });

  test('refuses to overwrite without --force; --force backs the old file up', () => {
    pan(['state', 'init', '--core-value', 'A']);
    const again = pan(['state', 'init', '--core-value', 'B']);
    assert.equal(again.json && again.json.error, 'state_exists');
    assert.match(state(), /Core value:\*\* A/);
    const forced = pan(['state', 'init', '--core-value', 'B', '--force']);
    assert.ok(forced.json.backup, JSON.stringify(forced.json));
    assert.ok(fs.existsSync(path.join(dir, forced.json.backup)));
    assert.match(state(), /Core value:\*\* B/);
  });

  test('--keep-context carries the Accumulated Context over (a new milestone)', () => {
    pan(['state', 'init', '--core-value', 'A']);
    pan(['state', 'section', 'Decisions', '--append', '- [Phase 1]: chose SQLite']);
    pan(['state', 'init', '--core-value', 'A', '--status', 'Defining requirements', '--force', '--keep-context']);
    assert.match(state(), /chose SQLite/);
    assert.match(state(), /\*\*Status:\*\* Defining requirements/);
  });
});

describe('state section (A7b)', () => {
  beforeEach(() => pan(['state', 'init', '--core-value', 'A']));

  test('--append replaces the "None yet." placeholder, then appends', () => {
    pan(['state', 'section', 'Blockers/Concerns', '--append', '- one']);
    pan(['state', 'section', 'Blockers/Concerns', '--append', '- two']);
    const body = state().split('### Blockers/Concerns')[1].split('\n## ')[0];
    assert.doesNotMatch(body, /None yet\./);
    assert.match(body, /- one\n- two/);
  });

  test('a missing section is created under Accumulated Context', () => {
    pan(['state', 'section', 'Roadmap Evolution', '--append', '- Phase 5 added: export']);
    const s = state();
    const acc = s.indexOf('## Accumulated Context');
    const evo = s.indexOf('### Roadmap Evolution');
    const next = s.indexOf('## Session Continuity');
    assert.ok(acc < evo && evo < next, 'inside Accumulated Context');
    assert.match(s, /### Roadmap Evolution\n\n- Phase 5 added: export/);
  });

  test('--set replaces the body', () => {
    pan(['state', 'section', 'Pending Todos', '--set', '3 pending — /pan:todo-check to review']);
    assert.match(state(), /### Pending Todos\n\n3 pending — \/pan:todo-check to review\n/);
  });
});

describe('state quick-task (A7b)', () => {
  beforeEach(() => pan(['state', 'init', '--core-value', 'A']));
  test('creates the table after Blockers/Concerns and numbers the rows', () => {
    pan(['state', 'quick-task', '--description', 'fix typo', '--commit', 'abc1234', '--directory', '.planning/quick/1-fix-typo', '--date', '2026-10-20']);
    pan(['state', 'quick-task', '--description', 'bump dep', '--commit', 'def5678', '--directory', '.planning/quick/2-bump', '--date', '2026-10-20']);
    const s = state();
    assert.ok(s.indexOf('### Blockers/Concerns') < s.indexOf('### Quick Tasks Completed'));
    assert.match(s, /\| 1 \| fix typo \| 2026-10-20 \| abc1234 \| \.planning\/quick\/1-fix-typo \|/);
    assert.match(s, /\| 2 \| bump dep \|/);
  });
  test('a pipe is escaped once, an already-escaped one is left alone, line breaks fold', () => {
    pan(['state', 'quick-task', '--description', 'a | b \\| c\nd', '--commit', 'a1', '--directory', 'd', '--date', '2026-10-20']);
    assert.match(state(), /\| 1 \| a \\\| b \\\| c d \| 2026-10-20 \|/);
  });

  test('--status adds the Status column', () => {
    pan(['state', 'quick-task', '--description', 'x', '--commit', 'a1', '--directory', 'd', '--status', 'verified', '--date', '2026-10-20']);
    assert.match(state(), /\| # \| Description \| Date \| Commit \| Status \| Directory \|/);
    assert.match(state(), /\| 1 \| x \| 2026-10-20 \| a1 \| verified \| d \|/);
  });
});

describe('state apply: one write for a batched update (A7b, transition)', () => {
  beforeEach(() => pan(['state', 'init', '--core-value', 'A', '--focus', 'One']));
  test('fields and sections land together', () => {
    const batch = { fields: { 'Current focus': 'Two', 'Last session': '2026-10-20 10:00', 'Resume File': 'None' }, sections: { Decisions: { append: ['- [Phase 1]: kept REST'] }, 'Blockers/Concerns': { set: '- ⚠️ [Phase 2] flaky sockets' } } };
    const r = pan(['state', 'apply', '--json', JSON.stringify(batch)]);
    assert.ok(r.success, r.error);
    assert.deepEqual(r.json.failed, []);
    const s = state();
    assert.match(s, /\*\*Current focus:\*\* Two/);
    assert.match(s, /kept REST/);
    assert.match(s, /flaky sockets/);
  });
  test('a field that does not exist is reported, the rest still applies', () => {
    const r = pan(['state', 'apply', '--json', JSON.stringify({ fields: { 'No Such Field': 'x', 'Current focus': 'Three' } })]);
    assert.deepEqual(r.json.failed, ['No Such Field']);
    assert.match(state(), /Current focus:\*\* Three/);
  });
});

describe('no shipped prompt writes state.md by hand (A7b)', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { const r = `${d}/${e.name}`; if (e.isDirectory()) walk(r); else if (e.name.endsWith('.md')) files.push(r); } };
  for (const d of ['commands', 'agents', 'pan-wizard-core/workflows', 'pan-wizard-core/references']) walk(d);

  test('no line tells an agent to Write or Edit state.md', () => {
    const offenders = [];
    for (const f of files) {
      read(f).split('\n').forEach((l, i) => {
        // A line that forbids the direct write ("never with the Write tool") is the rule, not a breach.
        if (/pan-tools|\bnever\b|not with Write/i.test(l)) return;
        if (/\b(Write|Edit)\b[^\n]{0,40}state\.md|state\.md[^\n]{0,30}\b(with the )?(Write|Edit) tool/.test(l)) offenders.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`);
      });
    }
    assert.deepEqual(offenders, []);
  });

  const WRITERS = [
    ['agents/pan-roadmapper.md', /state init/],
    ['pan-wizard-core/workflows/new-project.md', /state init/],
    ['pan-wizard-core/workflows/milestone-new.md', /state init[^\n]*--keep-context/],
    ['pan-wizard-core/workflows/resume-project.md', /state init/],
    ['pan-wizard-core/workflows/add-phase.md', /state section "Roadmap Evolution" --append/],
    ['pan-wizard-core/workflows/insert-phase.md', /state section "Roadmap Evolution" --append/],
    ['pan-wizard-core/workflows/todo-check.md', /state section "Pending Todos" --set/],
    ['pan-wizard-core/workflows/quick.md', /state quick-task/],
    ['pan-wizard-core/workflows/transition.md', /state apply/],
  ];
  for (const [f, re] of WRITERS) test(`${f} writes state.md through its verb`, () => assert.match(read(f), re));
});
