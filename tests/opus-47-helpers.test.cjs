/**
 * Tests for Opus 4.7 enhancement helpers (Spec A items E-1, E-3, E-5, E-6, E-10).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { buildCachedContext } = require('../pan-wizard-core/bin/lib/core.cjs');
const { determineContinuation, classifyStageDependencies } = require('../pan-wizard-core/bin/lib/focus.cjs');
const { buildClaudeSkillShim, translateThinkingDirective, detectModelCapabilities } = require('../bin/install-lib.cjs');
const { CACHEABLE_CONTEXT_FILES, FOCUS_TIERS } = require('../pan-wizard-core/bin/lib/constants.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

// ─── E-1: buildCachedContext ────────────────────────────────────────────────

describe('buildCachedContext (E-1)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns empty blocks + zero bytes when no cacheable files exist', () => {
    const result = buildCachedContext(tmpDir);
    assert.deepEqual(result.blocks, []);
    assert.equal(result.total_bytes, 0);
    assert.ok(typeof result.sha === 'string');
    assert.equal(result.sha.length, 16);
  });

  test('includes only files that exist, in order', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# Project\n\nHello.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'requirements.md'), '# Reqs\n\n- REQ-01');
    // roadmap.md absent — should be skipped.
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), 'status: active');

    const result = buildCachedContext(tmpDir);
    const paths = result.blocks.map(b => b.path);
    assert.equal(result.blocks.length, 3);
    assert.ok(paths[0].endsWith('project.md'));
    assert.ok(paths[1].endsWith('requirements.md'));
    assert.ok(paths[2].endsWith('state.md'));
  });

  test('every block has cache: true flag', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'x');
    const result = buildCachedContext(tmpDir);
    for (const b of result.blocks) assert.equal(b.cache, true);
  });

  test('sha is stable for identical inputs', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'stable');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'stable-req');
    const r1 = buildCachedContext(tmpDir);
    const r2 = buildCachedContext(tmpDir);
    assert.equal(r1.sha, r2.sha);
  });

  test('sha changes when content changes', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'v1');
    const r1 = buildCachedContext(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'v2');
    const r2 = buildCachedContext(tmpDir);
    assert.notEqual(r1.sha, r2.sha);
  });

  test('total_bytes matches actual file sizes', () => {
    const body = 'exact content';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), body);
    const result = buildCachedContext(tmpDir);
    assert.equal(result.total_bytes, Buffer.byteLength(body, 'utf-8'));
  });

  test('uses POSIX path separators in block paths', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), 'x');
    const result = buildCachedContext(tmpDir);
    assert.equal(result.blocks[0].path.includes('\\'), false);
    assert.ok(result.blocks[0].path.includes('/'));
  });

  test('CACHEABLE_CONTEXT_FILES export is a non-empty array', () => {
    assert.ok(Array.isArray(CACHEABLE_CONTEXT_FILES));
    assert.ok(CACHEABLE_CONTEXT_FILES.length >= 3);
  });
});

// ─── E-5: buildClaudeSkillShim ──────────────────────────────────────────────

describe('buildClaudeSkillShim (E-5)', () => {
  test('emits frontmatter with pan- prefix', () => {
    const out = buildClaudeSkillShim({ commandName: 'focus-scan', description: 'Strategic work scan' });
    assert.match(out, /^---\nname: pan-focus-scan\n/);
  });

  test('quotes description via yamlQuote', () => {
    const out = buildClaudeSkillShim({
      commandName: 'audit',
      description: 'Deep audit with "nested quotes"',
    });
    assert.match(out, /description: /);
    // Should not break YAML — re-parsing the frontmatter naively should not throw.
    const fm = out.match(/^---([\s\S]*?)---/)[1];
    assert.ok(fm.includes('pan-audit'));
  });

  test('omits trigger field when not provided', () => {
    const out = buildClaudeSkillShim({ commandName: 'cmd', description: 'x' });
    assert.equal(/\ntrigger:/.test(out), false);
  });

  test('includes trigger field when provided', () => {
    const out = buildClaudeSkillShim({
      commandName: 'focus-scan',
      description: 'x',
      trigger: 'when user asks about work items',
    });
    assert.match(out, /trigger:/);
  });

  test('body references the command file path', () => {
    const out = buildClaudeSkillShim({ commandName: 'plan-phase', description: 'x' });
    assert.ok(out.includes('.claude/commands/pan/plan-phase.md'));
    assert.ok(out.includes('/pan:plan-phase'));
  });

  test('throws on missing commandName', () => {
    assert.throws(() => buildClaudeSkillShim({}));
    assert.throws(() => buildClaudeSkillShim({ commandName: '' }));
    assert.throws(() => buildClaudeSkillShim(null));
  });

  test('collapses multi-line description to one line', () => {
    const out = buildClaudeSkillShim({ commandName: 'x', description: 'line1\n  line2\nline3' });
    const descLine = out.match(/description: [^\n]+/)[0];
    assert.equal(descLine.includes('\n'), false);
  });

  test('ends frontmatter with single --- on its own line', () => {
    const out = buildClaudeSkillShim({ commandName: 'x', description: 'x' });
    assert.ok(out.includes('\n---\n'));
  });
});

// ─── E-3: translateThinkingDirective ────────────────────────────────────────

describe('translateThinkingDirective (E-3)', () => {
  test('returns empty when directive disabled', () => {
    const r = translateThinkingDirective('claude', { enabled: false });
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.preamble, '');
  });

  test('returns empty when directive missing', () => {
    const r = translateThinkingDirective('claude', null);
    assert.deepEqual(r.frontmatter, {});
  });

  test('claude runtime emits native effort frontmatter', () => {
    const r = translateThinkingDirective('claude', { effort: 'high' });
    assert.deepEqual(r.frontmatter, { effort: 'high' });
    assert.equal(r.preamble, '');
  });

  test('legacy {enabled, budget} maps budgets to effort levels', () => {
    assert.equal(translateThinkingDirective('claude', { enabled: true, budget: 4000 }).frontmatter.effort, 'medium');
    assert.equal(translateThinkingDirective('claude', { enabled: true, budget: 5000 }).frontmatter.effort, 'high');
    assert.equal(translateThinkingDirective('claude', { enabled: true, budget: 8000 }).frontmatter.effort, 'xhigh');
  });

  test('codex/gemini/opencode/copilot get prose preamble', () => {
    for (const rt of ['codex', 'gemini', 'opencode', 'copilot']) {
      const r = translateThinkingDirective(rt, { effort: 'high' });
      assert.deepEqual(r.frontmatter, {});
      assert.ok(r.preamble.includes('step-by-step'));
    }
  });

  test('legacy invalid budget falls back to medium effort (default 2000)', () => {
    const r = translateThinkingDirective('claude', { enabled: true, budget: -5 });
    assert.equal(r.frontmatter.effort, 'medium');
  });

  test('legacy string budget is coerced to number', () => {
    const r = translateThinkingDirective('claude', { enabled: true, budget: '7000' });
    assert.equal(r.frontmatter.effort, 'xhigh');
  });

  test('invalid effort string yields empty directive', () => {
    const r = translateThinkingDirective('claude', { effort: 'turbo' });
    assert.deepEqual(r.frontmatter, {});
    assert.equal(r.preamble, '');
  });

  test('preamble depth scales with effort on non-native runtimes', () => {
    const low = translateThinkingDirective('codex', { effort: 'low' }).preamble;
    const deep = translateThinkingDirective('codex', { effort: 'xhigh' }).preamble;
    assert.ok(low.includes('brief'), `low preamble should be brief-flavored: ${low}`);
    assert.ok(deep.includes('thorough'), `xhigh preamble should be thorough-flavored: ${deep}`);
  });
});

// ─── E-10: determineContinuation ────────────────────────────────────────────

describe('determineContinuation (E-10)', () => {
  const sampleBatch = [
    { id: 'A-1', description: 'Fix flaky test' },
    { id: 'A-2', description: 'Add retry to client' },
    { id: 'A-3', description: 'Update docs' },
  ];

  test('skips reflection when tier is fast (not in enable_on_tiers)', () => {
    const r = determineContinuation(
      { max_cycles: 5, totals: { cycles_completed: 1 } },
      { items_completed: 3, points_used: 6 },
      sampleBatch,
      { tier: 'fast' }
    );
    assert.equal(r.reflect, false);
    assert.equal(r.reason, 'reflection_disabled');
  });

  test('emits reflection when tier is reasoning', () => {
    const r = determineContinuation(
      { max_cycles: 5, totals: { cycles_completed: 1 }, category: 'features' },
      { items_completed: 3, points_used: 6 },
      sampleBatch,
      { tier: 'reasoning' }
    );
    assert.equal(r.reflect, true);
    assert.ok(r.prompt);
    assert.ok(r.prompt.includes('cycle 2 of 5'));
    assert.ok(r.prompt.includes('features'));
    assert.ok(r.prompt.includes('items_completed: 3'));
  });

  test('respects explicit reflection_enabled: false override', () => {
    const r = determineContinuation(
      { max_cycles: 5, reflection_enabled: false },
      { items_completed: 1, points_used: 2 },
      sampleBatch,
      { tier: 'reasoning' }
    );
    assert.equal(r.reflect, false);
  });

  test('respects explicit reflection_enabled: true override on fast tier', () => {
    const r = determineContinuation(
      { max_cycles: 5, reflection_enabled: true, totals: { cycles_completed: 0 } },
      { items_completed: 1, points_used: 2 },
      sampleBatch,
      { tier: 'fast' }
    );
    assert.equal(r.reflect, true);
  });

  test('no reflection when next batch is empty', () => {
    const r = determineContinuation(
      { max_cycles: 5, reflection_enabled: true },
      { items_completed: 0, points_used: 0 },
      [],
      { tier: 'reasoning' }
    );
    assert.equal(r.reflect, false);
    assert.equal(r.reason, 'no_next_batch');
  });

  test('handles missing cycle telemetry gracefully', () => {
    const r = determineContinuation(
      { max_cycles: 5, totals: { cycles_completed: 0 } },
      {},
      sampleBatch,
      { tier: 'reasoning' }
    );
    assert.equal(r.reflect, true);
    assert.ok(r.prompt.includes('items_completed: 0'));
    assert.ok(r.prompt.includes('efficiency: n/a'));
  });

  test('caps prompt batch preview at 3 items', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ id: `X-${i}`, description: `item ${i}` }));
    const r = determineContinuation(
      { max_cycles: 5, totals: { cycles_completed: 0 } },
      { items_completed: 0, points_used: 1 },
      big,
      { tier: 'reasoning' }
    );
    assert.ok(r.prompt.includes('top 3 of 20'));
  });
});

// ─── E-6: classifyStageDependencies ─────────────────────────────────────────

describe('classifyStageDependencies (E-6)', () => {
  test('returns empty waves for empty items', () => {
    const r = classifyStageDependencies([]);
    assert.deepEqual(r.waves, []);
    assert.equal(r.parallelism_hint, 'sequential');
  });

  test('returns empty waves for non-array input', () => {
    assert.deepEqual(classifyStageDependencies(null).waves, []);
    assert.deepEqual(classifyStageDependencies(undefined).waves, []);
  });

  test('micro items form single parallel wave', () => {
    const items = [
      { id: '1', tier: FOCUS_TIERS.MICRO },
      { id: '2', tier: FOCUS_TIERS.MICRO },
      { id: '3', tier: FOCUS_TIERS.MICRO },
    ];
    const r = classifyStageDependencies(items);
    assert.equal(r.waves.length, 1);
    assert.equal(r.waves[0].length, 3);
    assert.equal(r.parallelism_hint, 'emit-micro-in-parallel');
  });

  test('standard items form separate wave after micro', () => {
    const items = [
      { id: '1', tier: FOCUS_TIERS.MICRO },
      { id: '2', tier: FOCUS_TIERS.STANDARD },
      { id: '3', tier: FOCUS_TIERS.STANDARD },
    ];
    const r = classifyStageDependencies(items);
    assert.equal(r.waves.length, 2);
    assert.equal(r.waves[0][0].id, '1');
    assert.equal(r.waves[1].length, 2);
  });

  test('each full item becomes its own serialized wave', () => {
    const items = [
      { id: '1', tier: FOCUS_TIERS.FULL },
      { id: '2', tier: FOCUS_TIERS.FULL },
    ];
    const r = classifyStageDependencies(items);
    assert.equal(r.waves.length, 2);
    assert.equal(r.waves[0].length, 1);
    assert.equal(r.waves[1].length, 1);
  });

  test('mixed batch produces micro wave + standard wave + one wave per full', () => {
    const items = [
      { id: 'm1', tier: FOCUS_TIERS.MICRO },
      { id: 'm2', tier: FOCUS_TIERS.MICRO },
      { id: 's1', tier: FOCUS_TIERS.STANDARD },
      { id: 'f1', tier: FOCUS_TIERS.FULL },
      { id: 'f2', tier: FOCUS_TIERS.FULL },
    ];
    const r = classifyStageDependencies(items);
    // micro (m1,m2) | standard (s1) | full(f1) | full(f2) = 4 waves
    assert.equal(r.waves.length, 4);
  });

  test('single micro item has sequential hint', () => {
    const r = classifyStageDependencies([{ id: '1', tier: FOCUS_TIERS.MICRO }]);
    assert.equal(r.parallelism_hint, 'sequential');
  });

  test('handles items missing tier field', () => {
    const r = classifyStageDependencies([{ id: '1' }, null, { id: '2', tier: 'unknown' }]);
    assert.equal(r.waves.length, 0);
  });
});

// ─── Cross-check: detectModelCapabilities integrates with everything ────────

describe('detectModelCapabilities (E-9) integration sanity', () => {
  test('opus-4-7 enables all three Opus 4.7 features', () => {
    const caps = detectModelCapabilities('claude-opus-4-7');
    assert.equal(caps.has_1m_ctx, true);
    assert.equal(caps.has_thinking, true);
    assert.equal(caps.has_cache, true);
  });

  test('reasoning tier in detectModelCapabilities aligns with constants.REFLECTION_THRESHOLD', () => {
    const { REFLECTION_THRESHOLD } = require('../pan-wizard-core/bin/lib/constants.cjs');
    const caps = detectModelCapabilities('claude-opus-4-7');
    assert.ok(REFLECTION_THRESHOLD.enable_on_tiers.includes(caps.tier));
  });
});

// ─── CLI dispatch for cache/focus helpers ───────────────────────────────────

describe('cache prime + focus classify-stages CLI', () => {
  const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('cache prime returns empty blocks when no cacheable files', () => {
    const r = runPanTools('cache prime', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.deepEqual(json.blocks, []);
    assert.equal(json.total_bytes, 0);
    assert.ok(typeof json.sha === 'string');
  });

  test('cache prime picks up project.md + requirements.md', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# Proj\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'requirements.md'), '# Reqs\n');
    const r = runPanTools('cache prime', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.blocks.length, 2);
    assert.ok(json.total_bytes > 0);
  });

  test('cache prime --summary omits block content', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'), '# Proj\nLots of text here.\n');
    const r = runPanTools('cache prime --summary', tmpDir);
    const json = JSON.parse(r.output);
    assert.equal(json.blocks.length, 1);
    assert.equal('content' in json.blocks[0], false);
    assert.ok('bytes' in json.blocks[0]);
  });

  test('focus classify-stages returns error when no batch exists', () => {
    const r = runPanTools('focus classify-stages', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.ok(json.error);
  });

  test('focus classify-stages reads latest batch file', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    fs.writeFileSync(path.join(focusDir, 'batch-2026-01-01.json'), JSON.stringify({
      date: '2026-01-01',
      batch: [
        { id: 'A', tier: 'MICRO' },
        { id: 'B', tier: 'MICRO' },
        { id: 'C', tier: 'STANDARD' },
      ],
    }));
    const r = runPanTools('focus classify-stages', tmpDir);
    const json = JSON.parse(r.output);
    assert.ok(Array.isArray(json.waves));
    assert.equal(json.waves.length, 2);
    assert.equal(json.parallelism_hint, 'emit-micro-in-parallel');
  });
});
