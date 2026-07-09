/**
 * Tests for skill-align.cjs — Skill-Aligned Decomposition pass (ADR-0038).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  resolveSkillRoot,
  buildSkillIndex,
  parseDraftTasks,
  alignTasks,
  SAD_STOPWORDS,
} = require('../pan-wizard-core/bin/lib/skill-align.cjs');
const { SKILL_ALIGN_MAX_TASKS } = require('../pan-wizard-core/bin/lib/constants.cjs');
const { runPanTools, cleanup } = require('./helpers.cjs');

/**
 * Build a minimal skill root: commands/pan + templates + references +
 * learnings (with a hand-written index.json so readIndex doesn't need
 * pattern frontmatter).
 */
function createSkillRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-skill-'));
  fs.mkdirSync(path.join(root, 'commands', 'pan'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pan-wizard-core', 'templates', 'sub'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pan-wizard-core', 'references'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pan-wizard-core', 'learnings', 'universal'), { recursive: true });

  fs.writeFileSync(path.join(root, 'commands', 'pan', 'retro.md'),
    '---\nname: pan:retro\ndescription: Run a milestone retrospective\n---\nRetrospective workflow for milestones.\n');
  fs.writeFileSync(path.join(root, 'pan-wizard-core', 'templates', 'uat.md'),
    '# UAT Template\n\nUser acceptance testing checklist scaffold.\n');
  fs.writeFileSync(path.join(root, 'pan-wizard-core', 'templates', 'sub', 'nested.md'),
    '# Nested Template\n\nNested scaffold about webhooks.\n');
  fs.writeFileSync(path.join(root, 'pan-wizard-core', 'references', 'tdd.md'),
    '# TDD Reference\n\nRed green refactor cycles for business logic.\n');
  fs.writeFileSync(path.join(root, 'pan-wizard-core', 'learnings', 'universal', 'atomic-state.md'),
    '# Atomic State Writes\n\nAlways rename a temp file over the target for atomic state updates.\n');
  fs.writeFileSync(path.join(root, 'pan-wizard-core', 'learnings', 'index.json'), JSON.stringify({
    schema_version: 1,
    topics: [{
      name: 'atomic-state',
      scope: 'universal',
      file: 'pan-wizard-core/learnings/universal/atomic-state.md',
      patterns: ['P-1201'],
      size_bytes: 90,
      size_tokens_est: 23,
      agent_relevance: { planner: 'medium', executor: 'high', verifier: 'high', reviewer: 'medium' },
    }],
    totals: { topics: 1, patterns: 1, size_bytes: 90, size_tokens_est: 23 },
  }));
  return root;
}

// ─── resolveSkillRoot ───────────────────────────────────────────────────────

describe('skill-align — resolveSkillRoot', () => {
  test('resolves to the directory containing pan-wizard-core (repo root here)', () => {
    const root = resolveSkillRoot();
    assert.ok(fs.existsSync(path.join(root, 'pan-wizard-core', 'bin', 'lib')));
    assert.ok(fs.existsSync(path.join(root, 'commands', 'pan')));
  });
});

// ─── parseDraftTasks ────────────────────────────────────────────────────────

describe('skill-align — parseDraftTasks', () => {
  test('strips bullets, numbering, and checkboxes', () => {
    const tasks = parseDraftTasks('- alpha task\n* beta task\n+ gamma task\n1. delta task\n2) epsilon task\n[ ] zeta task\n[x] eta task\n');
    assert.deepEqual(tasks, ['alpha task', 'beta task', 'gamma task', 'delta task', 'epsilon task', 'zeta task', 'eta task']);
  });

  test('drops headings, delimiters, blanks, and short lines', () => {
    const tasks = parseDraftTasks('# Draft\n\n---\n## Tasks\n- ok task\n- ab\n');
    assert.deepEqual(tasks, ['ok task']);
  });

  test('non-string input yields empty list', () => {
    assert.deepEqual(parseDraftTasks(null), []);
    assert.deepEqual(parseDraftTasks(undefined), []);
  });
});

// ─── buildSkillIndex ────────────────────────────────────────────────────────

describe('skill-align — buildSkillIndex', () => {
  let root;
  beforeEach(() => { root = createSkillRoot(); });
  afterEach(() => { cleanup(root); });

  test('indexes all four kinds with expected counts', () => {
    const { entries, stats } = buildSkillIndex(root);
    assert.equal(stats.by_kind.command, 1);
    assert.equal(stats.by_kind.template, 2); // recursive: uat.md + sub/nested.md
    assert.equal(stats.by_kind.reference, 1);
    assert.equal(stats.by_kind.learning, 1);
    assert.equal(stats.entries, entries.length);
    assert.deepEqual(stats.skipped_roots, []);
  });

  test('command entries use frontmatter name/description', () => {
    const { entries } = buildSkillIndex(root);
    const cmd = entries.find(e => e.kind === 'command');
    assert.equal(cmd.name, 'pan:retro');
    assert.equal(cmd.description, 'Run a milestone retrospective');
    assert.equal(cmd.file, 'commands/pan/retro.md');
  });

  test('template entries without frontmatter fall back to relative name + first heading', () => {
    const { entries } = buildSkillIndex(root);
    const nested = entries.find(e => e.name === 'sub/nested');
    assert.ok(nested, 'recursive template walk finds sub/nested.md');
    assert.equal(nested.description, 'Nested Template');
  });

  test('learning entries carry scope/topic name and heading-based description', () => {
    const { entries } = buildSkillIndex(root);
    const learning = entries.find(e => e.kind === 'learning');
    assert.equal(learning.name, 'universal/atomic-state');
    assert.match(learning.description, /Atomic State Writes/);
    assert.match(learning.description, /P-1201/);
  });

  test('missing roots are skipped and reported, never thrown', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-skill-empty-'));
    try {
      const { entries, stats } = buildSkillIndex(empty);
      assert.equal(entries.length, 0);
      assert.ok(stats.skipped_roots.length >= 3);
    } finally {
      cleanup(empty);
    }
  });
});

// ─── alignTasks ─────────────────────────────────────────────────────────────

describe('skill-align — alignTasks', () => {
  let root;
  beforeEach(() => { root = createSkillRoot(); });
  afterEach(() => { cleanup(root); });

  test('matches a task to the right skill with scores', () => {
    const r = alignTasks(root, ['Atomic state write via rename for state.md']);
    assert.equal(r.tasks.length, 1);
    assert.ok(r.tasks[0].matched);
    assert.equal(r.tasks[0].matches[0].name, 'universal/atomic-state');
    assert.ok(r.tasks[0].matches[0].score >= 1);
    assert.equal(r.coverage.matched, 1);
    assert.equal(r.coverage.ratio, 1);
  });

  test('unmatched tasks are reported with empty matches', () => {
    const r = alignTasks(root, ['fluffelump the wozzle']);
    assert.equal(r.tasks[0].matched, false);
    assert.deepEqual(r.tasks[0].matches, []);
    assert.equal(r.coverage.matched, 0);
    assert.equal(r.coverage.ratio, 0);
  });

  test('glue-word-only tasks match nothing (stop-list)', () => {
    assert.ok(SAD_STOPWORDS.has('create'));
    // "milestone" would match the retro command; every other word is stopped/short.
    const r = alignTasks(root, ['create add update the new']);
    assert.equal(r.tasks[0].matched, false);
  });

  test('top-k caps per-task matches', () => {
    const r = alignTasks(root, ['retrospective milestone template checklist rename atomic state tdd'], { topK: 2 });
    assert.ok(r.tasks[0].matches.length <= 2);
    assert.equal(r.top_k, 2);
  });

  test('vocabulary dedupes matches across tasks', () => {
    const r = alignTasks(root, [
      'Atomic state write for roadmap updates',
      'Atomic rename when writing state snapshots',
    ]);
    const names = r.vocabulary.map(v => v.name);
    assert.equal(names.filter(n => n === 'universal/atomic-state').length, 1);
    assert.ok(r.vocabulary_tokens > 0);
  });

  test('token budget bounds vocabulary and reports dropped', () => {
    // Budget floor is 100; description tokens per entry are small, so force
    // overflow with many distinct matched skills via a broad multi-task draft.
    const r = alignTasks(root, [
      'milestone retrospective run',
      'user acceptance testing checklist',
      'red green refactor business logic',
      'atomic state rename temp target',
      'nested scaffold webhooks',
    ], { tokenBudget: 100 });
    assert.ok(r.vocabulary_tokens <= 100);
    assert.equal(r.token_budget, 100);
    // Everything matched must land in vocabulary or dropped — nothing vanishes.
    const uniqueMatched = new Set(r.tasks.flatMap(t => t.matches.map(m => `${m.kind}/${m.name}`)));
    assert.equal(r.vocabulary.length + r.dropped.length, uniqueMatched.size);
  });

  test('rejects empty and oversized drafts', () => {
    assert.ok(alignTasks(root, []).error);
    assert.ok(alignTasks(root, null).error);
    const many = Array.from({ length: SKILL_ALIGN_MAX_TASKS + 1 }, (_, i) => `task number ${i}`);
    assert.match(alignTasks(root, many).error, /max/);
  });

  test('empty skill root aligns without throwing — all tasks unmatched', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-skill-empty-'));
    try {
      const r = alignTasks(empty, ['atomic state rename']);
      assert.equal(r.coverage.matched, 0);
      assert.equal(r.index_stats.entries, 0);
    } finally {
      cleanup(empty);
    }
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('skill-align — CLI (skills index|align)', () => {
  let root;
  beforeEach(() => { root = createSkillRoot(); });
  afterEach(() => { cleanup(root); });

  test('skills index returns entries + counts as JSON', () => {
    const r = runPanTools(`skills index --source-root "${root}"`);
    assert.ok(r.success, r.error);
    const j = JSON.parse(r.output);
    assert.equal(j.total, 5);
    assert.ok(Array.isArray(j.entries));
    assert.ok(j.entries.every(e => !('_head' in e)), 'scoring head is not serialized');
  });

  test('skills align --draft returns the alignment result', () => {
    const r = runPanTools(`skills align --source-root "${root}" --draft "- atomic state rename for state.md"`);
    assert.ok(r.success, r.error);
    const j = JSON.parse(r.output);
    assert.equal(j.coverage.total, 1);
    assert.equal(j.tasks[0].matches[0].name, 'universal/atomic-state');
  });

  test('skills align --draft-file reads the draft from disk; --raw is human-readable', () => {
    const draft = path.join(root, 'draft.md');
    fs.writeFileSync(draft, '# Draft\n- atomic state rename\n- fluffelump the wozzle\n');
    const r = runPanTools(`skills align --source-root "${root}" --draft-file "${draft}" --raw`);
    assert.ok(r.success, r.error);
    assert.match(r.output, /SAD alignment: 1\/2 tasks matched/);
    assert.match(r.output, /universal\/atomic-state/);
  });

  test('skills align with a missing draft file returns {error}', () => {
    const r = runPanTools(`skills align --source-root "${root}" --draft-file "${path.join(root, 'nope.md')}"`);
    assert.ok(r.success, r.error); // error is reported as JSON, not an exit code
    const j = JSON.parse(r.output);
    assert.match(j.error, /not found/);
  });

  test('skills align without a draft errors with usage', () => {
    const r = runPanTools(`skills align --source-root "${root}"`);
    assert.equal(r.success, false);
    assert.match(r.error, /Usage: skills align/);
  });

  test('unknown skills subcommand errors', () => {
    const r = runPanTools('skills bogus');
    assert.equal(r.success, false);
    assert.match(r.error, /Unknown skills subcommand/);
  });
});
