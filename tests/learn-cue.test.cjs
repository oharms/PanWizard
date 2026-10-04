// `learn topics-for --cue` (memory optimisation O5): learnings chosen by the task, not
// by file size. The role ranking loads the same topics whatever the phase, filling the
// budget smallest-first, so large topics a task needs dropped out (F6 in
// docs/specs/memory-optimization-2026-10.md). The cue ranking matches the phase
// objective against each topic's name, summaries and rules.

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const { topicsForAgent, topicTermsFromStore, readIndex, cueTerms } = require(path.join(ROOT, 'pan-wizard-core', 'bin', 'lib', 'learn-index.cjs'));
const golden = require('./fixtures/learn-cue-golden.json');

describe('the golden set: cue ranking against the role ranking', () => {
  // An install's view: internal/ topics are stripped from the index at install.
  const full = readIndex(ROOT);
  const index = { ...full, topics: full.topics.filter((t) => t.scope === 'universal') };
  const terms = topicTermsFromStore(ROOT);
  const score = (pick) => {
    let p = 0, r = 0, n = 0;
    for (const c of golden.cases) {
      const sel = new Set(pick(c).selected.map((t) => t.name));
      const hit = c.expected.filter((e) => sel.has(e)).length;
      p += sel.size ? hit / sel.size : 0;
      r += hit / c.expected.length;
      n += sel.size;
    }
    const k = golden.cases.length;
    return { precision: p / k, recall: r / k, topics: n / k };
  };
  const role = score(() => topicsForAgent(index, { agent: golden.role, tokenBudget: golden.token_budget }));
  const cue = score((c) => topicsForAgent(index, { agent: golden.role, tokenBudget: golden.token_budget, cue: c.objective, topicTerms: terms }));

  test('every labelled topic exists in the store', () => {
    const names = new Set(index.topics.map((t) => t.name));
    for (const c of golden.cases) for (const e of c.expected) assert.ok(names.has(e), `${e} (${c.objective})`);
  });

  test('the cue ranking beats the role ranking on precision and on recall, loading fewer topics', () => {
    assert.ok(cue.precision > role.precision, JSON.stringify({ cue, role }));
    assert.ok(cue.recall > role.recall, JSON.stringify({ cue, role }));
    assert.ok(cue.topics < role.topics, JSON.stringify({ cue, role }));
    // Measured 2026-10-04: cue 0.37 / 0.76 over 4.7 topics, role 0.06 / 0.45 over 13.
    assert.ok(cue.precision >= 0.3 && cue.recall >= 0.7, `the cue ranking regressed: ${JSON.stringify(cue)}`);
  });

  test('a large topic the task needs is loaded, where the role ranking dropped it', () => {
    const c = 'Add a database migration that renames the orders.total column and backfills the new amount column for existing rows';
    const byRole = topicsForAgent(index, { agent: 'executor', tokenBudget: 5000 });
    assert.ok(byRole.dropped.some((t) => t.name === 'migration-safety'), 'the role ranking drops it');
    const byCue = topicsForAgent(index, { agent: 'executor', tokenBudget: 5000, cue: c, topicTerms: terms });
    assert.equal(byCue.mode, 'cue');
    assert.equal(byCue.selected[0].name, 'migration-safety');
  });
});

describe('cue matching', () => {
  test('words fold plurals and drop common ones; inflections meet', () => {
    assert.deepEqual([...cueTerms('Add the retries for failures in the parsed classes')].sort(), ['class', 'failure', 'parsed', 'retry']);
    const terms = new Map([['x', { name: new Set(['corrupt']), text: new Set(['parse']) }]]);
    const idx = { topics: [{ name: 'x', scope: 'universal', size_tokens_est: 10, agent_relevance: { executor: 'low' }, patterns: [] }] };
    const r = topicsForAgent(idx, { agent: 'executor', cue: 'stop corrupting files we parsed', topicTerms: terms });
    assert.equal(r.selected[0].cue_score, 3, '"corrupting" meets the name (2), "parsed" the text (1)');
  });

  const T = (name, rel, size) => ({ name, scope: 'universal', size_tokens_est: size, agent_relevance: { executor: rel }, patterns: [] });
  const idx = { topics: [T('alpha', 'high', 100), T('beta', 'low', 50), T('gamma', 'medium', 900), T('delta', 'high', 10)] };
  const terms = new Map([
    ['alpha', { name: new Set(['alpha']), text: new Set(['shared']) }],
    ['beta', { name: new Set(['beta']), text: new Set(['retry', 'queue']) }],
    ['gamma', { name: new Set(['gamma']), text: new Set(['retry', 'queue']) }],
    ['delta', { name: new Set(['delta']), text: new Set(['unrelated']) }],
  ]);

  test('ranked by cue score, then relevance, then size; a low-relevance topic that matches is loaded', () => {
    const r = topicsForAgent(idx, { agent: 'executor', cue: 'retry the queue', topicTerms: terms });
    assert.equal(r.mode, 'cue');
    assert.deepEqual(r.selected.map((t) => t.name), ['gamma', 'beta']);
  });

  test('a topic under half the best score is not loaded', () => {
    const r = topicsForAgent(idx, { agent: 'executor', cue: 'retry the queue shared', topicTerms: terms });
    assert.deepEqual(r.selected.map((t) => [t.name, t.cue_score]), [['gamma', 2], ['beta', 2], ['alpha', 1]], 'top 2: half is 1');
    const r2 = topicsForAgent(idx, { agent: 'executor', cue: 'beta retry queue shared', topicTerms: terms });
    assert.deepEqual(r2.selected.map((t) => t.name), ['beta', 'gamma'], 'top 4 (name 2 + text 2): alpha at 1 is under half');
  });

  test('a cue that matches nothing falls back to the role ranking', () => {
    const none = topicsForAgent(idx, { agent: 'executor', cue: 'zebra', topicTerms: terms });
    const byRole = topicsForAgent(idx, { agent: 'executor' });
    assert.equal(none.mode, 'role');
    assert.deepEqual(none.selected.map((t) => t.name), byRole.selected.map((t) => t.name));
  });
});

describe('the CLI and the workflows', () => {
  test('`learn topics-for --cue` reports the cue mode and its scores', () => {
    const r = runPanTools('learn topics-for --agent executor --cue "Stream the access log line by line and parse each JSON record"', ROOT);
    const j = JSON.parse(r.output);
    assert.equal(j.mode, 'cue');
    assert.equal(j.selected[0].name, 'streaming-io');
    assert.ok(j.selected.every((t) => t.cue_score > 0));
    assert.match(runPanTools('learn topics-for --agent executor --cue "zebra" --raw', ROOT).output, /nothing matched the cue, so by role/);
  });

  test('the four workflows that load learnings pass the task as the cue', () => {
    for (const f of ['exec-phase.md', 'execute-plan.md', 'plan-phase.md', 'verify-phase.md']) {
      const text = fs.readFileSync(path.join(ROOT, 'pan-wizard-core', 'workflows', f), 'utf8');
      assert.match(text, /learn topics-for --agent \w+ --cue "<[^"]+>" --token-budget 5000 --raw/, f);
    }
  });
});
