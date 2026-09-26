// Code that did not do what its docs and callers said (doc audits 2026-09-11 and
// 2026-09-25, found and listed, fixed 2026-09-26). Each test drives the CLI with the
// shape PAN itself writes — the todo fixture that used to stand in here had no
// frontmatter, which is why the frontmatter corruption was never seen.

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createTempProject, cleanup, runPanTools } = require('./helpers.cjs');
const { loadConfig } = require('../pan-wizard-core/bin/lib/core.cjs');
const { VALID_COMMIT_TYPES } = require('../pan-wizard-core/bin/lib/constants.cjs');

let dir;
beforeEach(() => { dir = createTempProject(); });
afterEach(() => cleanup(dir));

describe('todo complete keeps a todo-add file valid', () => {
  // The exact shape pan-wizard-core/workflows/todo-add.md writes.
  const TODO = '---\ncreated: 2026-09-26T10:00\ntitle: Add rate limiting\narea: api\nfiles:\n  - src/login.ts:12\n---\n\n## Problem\n\nNo limit.\n';

  test('the completion date goes inside the frontmatter, which still opens the file', () => {
    const pending = path.join(dir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, '2026-09-26-rate-limit.md'), TODO);
    const r = runPanTools('todo complete 2026-09-26-rate-limit.md', dir);
    assert.ok(r.success, r.error);
    const done = fs.readFileSync(path.join(dir, '.planning', 'todos', 'completed', '2026-09-26-rate-limit.md'), 'utf8');
    assert.ok(done.startsWith('---\ncompleted: '), 'the frontmatter must still open the file');
    const fm = done.split('\n---\n')[0];
    assert.match(fm, /^completed: \d{4}-\d{2}-\d{2}$/m);
    assert.match(fm, /^title: Add rate limiting$/m, 'the original fields survive');
    assert.ok(done.includes('## Problem'), 'the body survives');
  });

  test('CRLF frontmatter keeps its line endings', () => {
    const pending = path.join(dir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pending, { recursive: true });
    fs.writeFileSync(path.join(pending, 'crlf.md'), TODO.replace(/\n/g, '\r\n'));
    assert.ok(runPanTools('todo complete crlf.md', dir).success);
    const done = fs.readFileSync(path.join(dir, '.planning', 'todos', 'completed', 'crlf.md'), 'utf8');
    assert.match(done, /^---\r\ncompleted: \d{4}-\d{2}-\d{2}\r\ncreated:/);
  });

  test('the todo workflows use the directory the CLI counts', () => {
    for (const wf of ['todo-add.md', 'todo-check.md']) {
      const text = fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'workflows', wf), 'utf8');
      assert.ok(!/todos\/done/.test(text), `${wf} still names todos/done`);
    }
    assert.match(fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'workflows', 'todo-check.md'), 'utf8'), /pan-tools\.cjs todo complete/);
  });
});

describe('perf is a valid commit type', () => {
  test('the list carries it and the CLI does not reject it', () => {
    assert.ok(VALID_COMMIT_TYPES.includes('perf'));
    const r = runPanTools('commit "speed up the parser" --type perf', dir);
    assert.ok(!/Invalid commit type/.test(`${r.output} ${r.error || ''}`), 'perf must pass type validation');
  });
});

describe('template select counts PAN plan tasks', () => {
  const plan = (body) => { fs.writeFileSync(path.join(dir, 'plan.md'), body); return JSON.parse(runPanTools('template select plan.md', dir).output); };

  test('<task> blocks are counted', () => {
    const out = plan('<tasks>\n<task type="code">\n<name>A</name>\n</task>\n<task type="code">\n<name>B</name>\n</task>\n<task>\n</task>\n</tasks>\n');
    assert.equal(out.taskCount, 3);
  });

  test('older ### Task headings still count', () => {
    assert.equal(plan('### Task 1\nx\n### Task 2\ny\n').taskCount, 2);
  });
});

describe('workflow.nyquist_validation reaches init', () => {
  test('loadConfig reads it from the workflow section, and init reports it', () => {
    fs.writeFileSync(path.join(dir, '.planning', 'config.json'), JSON.stringify({ workflow: { nyquist_validation: true } }));
    assert.equal(loadConfig(dir).nyquist_validation, true);
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-base'), { recursive: true });
    const init = JSON.parse(runPanTools('init plan-phase 1', dir).output);
    assert.equal(init.nyquist_validation_enabled, true);
  });

  test('absent means off', () => {
    assert.equal(loadConfig(dir).nyquist_validation, false);
  });
});

describe('report all --open', () => {
  test('carries an opened field, and does not open an index it did not rewrite', () => {
    const phase = path.join(dir, '.planning', 'phases', '01-base');
    fs.mkdirSync(phase, { recursive: true });
    fs.writeFileSync(path.join(phase, '01-01-plan.md'), '---\nphase: 01\nplan: 01\n---\n<objective>x</objective>\n');
    assert.ok(runPanTools('report all', dir).success, 'first run writes the reports');
    const again = JSON.parse(runPanTools('report all --open', dir).output);
    assert.equal(again.index.written, false, 'nothing changed, so the index was not rewritten');
    assert.equal(again.opened, false, 'an unchanged index is not opened — the same rule as report phase');
  });
});

describe('campaign schedule sets enforce_budget', () => {
  const schedule = () => JSON.parse(fs.readFileSync(path.join(dir, '.planning', 'orchestration', 'schedule.json'), 'utf8'));

  test('--enforce-budget turns it on, a plain update keeps it, --advisory-budget turns it off', () => {
    assert.ok(runPanTools('campaign schedule --daily-budget 50', dir).success);
    assert.equal(schedule().enforce_budget, false, 'advisory by default');
    assert.ok(runPanTools('campaign schedule --enforce-budget', dir).success);
    assert.equal(schedule().enforce_budget, true);
    assert.ok(runPanTools('campaign schedule --cadence weekly', dir).success);
    assert.equal(schedule().enforce_budget, true, 'an update that does not name it keeps it');
    assert.ok(runPanTools('campaign schedule --advisory-budget', dir).success);
    assert.equal(schedule().enforce_budget, false);
  });
});
