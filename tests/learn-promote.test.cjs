// Tests for optimize.cjs promotePattern / listPromotedPatterns / unpromotePattern.
// v3.7.0 W4 — closes the self-improvement loop by writing AI-derived patterns
// from harvested experiments into shipped pan-wizard-core/learnings/ topic files.

'use strict';

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const optimize = require('../pan-wizard-core/bin/lib/optimize.cjs');

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTempSourceRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-promote-test-'));
  // Create the learnings tier dirs that the source repo would have
  fs.mkdirSync(path.join(root, 'pan-wizard-core', 'learnings', 'universal'), { recursive: true });
  fs.mkdirSync(path.join(root, 'pan-wizard-core', 'learnings', 'internal'), { recursive: true });
  return root;
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function makePattern(overrides = {}) {
  return {
    id: 'P-001',
    summary: 'Always run npm test:all before phase complete',
    evidence: 'Observed across 3 trace events in experiment my-test-1',
    rule: 'Before marking a phase complete, run the full test suite.',
    applies_in: 'exec-phase, focus-exec',
    source_experiments: ['my-test-1'],
    ...overrides,
  };
}

// ── Module shape ────────────────────────────────────────────────────────────

describe('optimize.cjs — W4 promote exports', () => {
  test('exports promotePattern, listPromotedPatterns, unpromotePattern', () => {
    assert.equal(typeof optimize.promotePattern, 'function');
    assert.equal(typeof optimize.listPromotedPatterns, 'function');
    assert.equal(typeof optimize.unpromotePattern, 'function');
  });
});

// ── promotePattern — happy path ─────────────────────────────────────────────

describe('promotePattern — universal scope', () => {
  let sourceRoot;

  before(() => { sourceRoot = makeTempSourceRoot(); });
  after(() => { rmrf(sourceRoot); });

  test('creates a new topic file with frontmatter when none exists', () => {
    const result = optimize.promotePattern(makePattern(), {
      scope: 'universal', topic: 'exec-patterns', sourceRoot,
    });

    assert.equal(result.error, undefined);
    assert.equal(result.scope, 'universal');
    assert.equal(result.topic, 'exec-patterns');
    assert.equal(result.pattern_id, 'P-001');

    const expected = path.join(
      sourceRoot, 'pan-wizard-core', 'learnings', 'universal', 'exec-patterns.md'
    );
    assert.equal(result.promoted_to, expected);
    assert.ok(fs.existsSync(expected), 'topic file should exist');

    const content = fs.readFileSync(expected, 'utf-8');
    assert.match(content, /---\s*\ntopic:\s*exec-patterns/, 'has frontmatter with topic');
    assert.match(content, /## P-001/, 'has the pattern body heading');
    assert.match(content, /Always run npm test:all/, 'preserves summary');
    assert.match(content, /\*\*Evidence:\*\*/, 'has Evidence label');
    assert.match(content, /\*\*Rule:\*\*/, 'has Rule label');
  });

  test('appends a second pattern to an existing topic file', () => {
    optimize.promotePattern(makePattern({ id: 'P-100' }), {
      scope: 'universal', topic: 'append-test', sourceRoot,
    });
    const second = optimize.promotePattern(
      makePattern({ id: 'P-101', summary: 'Pattern two', source_experiments: ['exp-2'] }),
      { scope: 'universal', topic: 'append-test', sourceRoot }
    );
    assert.equal(second.error, undefined);

    const filePath = path.join(
      sourceRoot, 'pan-wizard-core', 'learnings', 'universal', 'append-test.md'
    );
    const content = fs.readFileSync(filePath, 'utf-8');

    // Both patterns present
    assert.match(content, /## P-100/);
    assert.match(content, /## P-101/);
    // Frontmatter pattern_ids has both
    assert.match(content, /P-100/);
    assert.match(content, /P-101/);
  });

  test('refuses to add a pattern with an id that already exists in the topic', () => {
    optimize.promotePattern(makePattern({ id: 'P-DUP' }), {
      scope: 'universal', topic: 'dup-test', sourceRoot,
    });
    const dup = optimize.promotePattern(makePattern({ id: 'P-DUP' }), {
      scope: 'universal', topic: 'dup-test', sourceRoot,
    });
    assert.match(dup.error || '', /already.*promoted|exists|duplicate/i);
  });
});

// ── promotePattern — internal scope ─────────────────────────────────────────

describe('promotePattern — internal scope', () => {
  let sourceRoot;

  before(() => { sourceRoot = makeTempSourceRoot(); });
  after(() => { rmrf(sourceRoot); });

  test('routes to learnings/internal/ when scope=internal', () => {
    const result = optimize.promotePattern(makePattern({ id: 'P-INT' }), {
      scope: 'internal', topic: 'pan-dev-patterns', sourceRoot,
    });
    assert.equal(result.error, undefined);

    const expected = path.join(
      sourceRoot, 'pan-wizard-core', 'learnings', 'internal', 'pan-dev-patterns.md'
    );
    assert.equal(result.promoted_to, expected);
    assert.ok(fs.existsSync(expected));

    // Negative: must NOT exist in universal
    const universalPath = path.join(
      sourceRoot, 'pan-wizard-core', 'learnings', 'universal', 'pan-dev-patterns.md'
    );
    assert.ok(!fs.existsSync(universalPath),
      'internal pattern must not appear in universal/');
  });
});

// ── promotePattern — guards ─────────────────────────────────────────────────

describe('promotePattern — guards', () => {
  let sourceRoot;

  before(() => { sourceRoot = makeTempSourceRoot(); });
  after(() => { rmrf(sourceRoot); });

  test('rejects unknown scope', () => {
    const result = optimize.promotePattern(makePattern(), {
      scope: 'wrong-scope', topic: 'whatever', sourceRoot,
    });
    assert.match(result.error || '', /scope|universal|internal/i);
  });

  test('rejects missing required pattern fields', () => {
    const result = optimize.promotePattern(
      { id: 'P-X' }, // missing summary, evidence, rule
      { scope: 'universal', topic: 'invalid', sourceRoot }
    );
    assert.match(result.error || '', /required|summary|rule/i);
  });

  test('rejects invalid topic name (path traversal)', () => {
    const result = optimize.promotePattern(makePattern(), {
      scope: 'universal', topic: '../escape', sourceRoot,
    });
    assert.match(result.error || '', /topic|invalid|character/i);
  });
});

// ── listPromotedPatterns ────────────────────────────────────────────────────

describe('listPromotedPatterns', () => {
  let sourceRoot;

  before(() => { sourceRoot = makeTempSourceRoot(); });
  after(() => { rmrf(sourceRoot); });

  test('returns empty inventory when no patterns promoted', () => {
    const result = optimize.listPromotedPatterns({ sourceRoot });
    assert.deepEqual(result.universal, []);
    assert.deepEqual(result.internal, []);
    assert.equal(result.total, 0);
  });

  test('walks both tiers and returns inventory grouped by scope', () => {
    optimize.promotePattern(makePattern({ id: 'P-A1' }), {
      scope: 'universal', topic: 'topic-a', sourceRoot,
    });
    optimize.promotePattern(makePattern({ id: 'P-A2' }), {
      scope: 'universal', topic: 'topic-a', sourceRoot,
    });
    optimize.promotePattern(makePattern({ id: 'P-B1' }), {
      scope: 'internal', topic: 'topic-b', sourceRoot,
    });

    const result = optimize.listPromotedPatterns({ sourceRoot });
    assert.equal(result.total, 3);
    assert.equal(result.universal.length, 2);
    assert.equal(result.internal.length, 1);

    const universalIds = result.universal.map(p => p.id).sort();
    assert.deepEqual(universalIds, ['P-A1', 'P-A2']);
  });
});

// ── unpromotePattern ────────────────────────────────────────────────────────

describe('unpromotePattern', () => {
  let sourceRoot;

  before(() => { sourceRoot = makeTempSourceRoot(); });
  after(() => { rmrf(sourceRoot); });

  test('removes a pattern from a topic file (round-trip)', () => {
    optimize.promotePattern(makePattern({ id: 'P-RT-1' }), {
      scope: 'universal', topic: 'roundtrip', sourceRoot,
    });
    optimize.promotePattern(makePattern({ id: 'P-RT-2', summary: 'second' }), {
      scope: 'universal', topic: 'roundtrip', sourceRoot,
    });

    const result = optimize.unpromotePattern('P-RT-1', {
      scope: 'universal', topic: 'roundtrip', sourceRoot,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.removed, 'P-RT-1');

    const filePath = path.join(
      sourceRoot, 'pan-wizard-core', 'learnings', 'universal', 'roundtrip.md'
    );
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.doesNotMatch(content, /## P-RT-1\b/, 'P-RT-1 body removed');
    assert.match(content, /## P-RT-2\b/, 'P-RT-2 body retained');
  });

  test('removes the topic file entirely when last pattern is removed', () => {
    optimize.promotePattern(makePattern({ id: 'P-LAST' }), {
      scope: 'internal', topic: 'last-one', sourceRoot,
    });

    const filePath = path.join(
      sourceRoot, 'pan-wizard-core', 'learnings', 'internal', 'last-one.md'
    );
    assert.ok(fs.existsSync(filePath));

    optimize.unpromotePattern('P-LAST', {
      scope: 'internal', topic: 'last-one', sourceRoot,
    });
    assert.ok(!fs.existsSync(filePath),
      'topic file should be deleted when its last pattern is removed');
  });

  test('returns error when pattern not found', () => {
    const result = optimize.unpromotePattern('P-DOES-NOT-EXIST', {
      scope: 'universal', topic: 'nonexistent', sourceRoot,
    });
    assert.match(result.error || '', /not.*found|not.*exist/i);
  });
});

// ─── classifyPatternKind (P-RES-007, v3.7.10) ────────────────────────────────

describe('classifyPatternKind — structural vs prompt-fragment', () => {
  test('classifies a long structural rule as structural', () => {
    const r = optimize.classifyPatternKind({
      id: 'P-X-1',
      summary: 'Atomic state-file pattern',
      rule: 'When persisting state across crashes or concurrent processes, write to <name>.tmp, fsync, then rename to <name>. The closure pattern wraps the file lifecycle so callers cannot bypass it. Pair with O_EXCL lockfile when multi-process safety is needed. The interface contract guarantees no half-written files.',
    });
    assert.equal(r.kind, 'structural');
  });

  test('classifies a "always say X" rule as prompt-fragment', () => {
    const r = optimize.classifyPatternKind({
      id: 'P-X-2',
      summary: 'Always include the words "Generated by"',
      rule: 'Always say "Generated by Claude" at the end of every PR description. Never say "Made by AI"; use the exact phrasing.',
    });
    assert.equal(r.kind, 'prompt-fragment');
  });

  test('classifies a very short rule as prompt-fragment', () => {
    const r = optimize.classifyPatternKind({
      id: 'P-X-3',
      summary: 'Short rule',
      rule: 'Use camelCase.',
    });
    assert.equal(r.kind, 'prompt-fragment');
  });

  test('classifies a moderate-length rule with no clear markers as unclear', () => {
    const r = optimize.classifyPatternKind({
      id: 'P-X-4',
      summary: 'Some thing',
      rule: 'When something happens, do another thing. The reason is that it makes sense to do so. Try this approach in any project.',
    });
    assert.equal(r.kind, 'unclear');
  });
});

// ─── promotePattern --scope universal warning ────────────────────────────────

describe('promotePattern — P-RES-007 prompt-fragment warning on universal scope', () => {
  let tmpRoot;

  function freshRoot() {
    tmpRoot = makeTempSourceRoot();
    return tmpRoot;
  }
  function cleanup() { rmrf(tmpRoot); tmpRoot = null; }

  test('attaches warning when promoting prompt-fragment pattern to universal', () => {
    const root = freshRoot();
    try {
      const result = optimize.promotePattern(
        {
          id: 'P-WARN-1',
          summary: 'Always say "the answer is"',
          rule: 'Always say "the answer is" before any computed value. Use the exact phrasing.',
        },
        { scope: 'universal', topic: 'output-conventions', sourceRoot: root }
      );
      assert.equal(result.scope, 'universal', 'still promotes — warning is advisory');
      assert.ok(result.warning, 'warning should be present');
      assert.equal(result.warning.code, 'P-RES-007');
      assert.equal(result.warning.kind, 'prompt-fragment');
    } finally { cleanup(); }
  });

  test('no warning when promoting structural pattern to universal', () => {
    const root = freshRoot();
    try {
      const result = optimize.promotePattern(
        {
          id: 'P-WARN-2',
          summary: 'Atomic state pattern',
          rule: 'When persisting state across crashes, write to <name>.tmp, fsync, rename. Wrap the lifecycle in a closure. Pair with O_EXCL lockfile for multi-process safety. The interface contract guarantees no half-written files in any module that uses the pattern.',
        },
        { scope: 'universal', topic: 'atomic-state-test', sourceRoot: root }
      );
      assert.equal(result.scope, 'universal');
      assert.equal(result.warning, undefined,
        `structural pattern should not trigger warning; got ${JSON.stringify(result.warning)}`);
    } finally { cleanup(); }
  });

  test('no warning when promoting prompt-fragment to internal scope', () => {
    const root = freshRoot();
    try {
      const result = optimize.promotePattern(
        {
          id: 'P-WARN-3',
          summary: 'Always say "the answer is"',
          rule: 'Always say "the answer is" before any computed value.',
        },
        { scope: 'internal', topic: 'output-conventions', sourceRoot: root }
      );
      assert.equal(result.scope, 'internal');
      assert.equal(result.warning, undefined,
        'internal scope is appropriate for prompt fragments — no warning expected');
    } finally { cleanup(); }
  });
});
