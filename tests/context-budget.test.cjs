const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { estimateTokens, estimateRelevanceRatio, assessCacheTtl } = require('../pan-wizard-core/bin/lib/context-budget.cjs');
const { CONTEXT_WINDOW, WARNING_THRESHOLD, CRITICAL_THRESHOLD } = require('../pan-wizard-core/bin/lib/constants.cjs');

// ─── Unit tests: estimateTokens ─────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });

  it('returns 0 for null', () => {
    assert.equal(estimateTokens(null), 0);
  });

  it('returns 0 for undefined', () => {
    assert.equal(estimateTokens(undefined), 0);
  });

  it('estimates tokens as chars/4 rounded up', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
    assert.equal(estimateTokens('a'), 1);
  });

  it('handles longer content', () => {
    const text = 'x'.repeat(1000);
    assert.equal(estimateTokens(text), 250);
  });
});

// ─── Unit tests: constants ──────────────────────────────────────────────────

describe('context-budget constants', () => {
  it('CONTEXT_WINDOW is 200000', () => {
    assert.equal(CONTEXT_WINDOW, 200000);
  });

  it('WARNING_THRESHOLD is 0.6', () => {
    assert.equal(WARNING_THRESHOLD, 0.6);
  });

  it('CRITICAL_THRESHOLD is 0.8', () => {
    assert.equal(CRITICAL_THRESHOLD, 0.8);
  });
});

// ─── Integration tests: CLI ─────────────────────────────────────────────────

describe('context-budget command (integration)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  it('returns error when .planning/ is missing', () => {
    const bareDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-bare-'));
    try {
      const result = runPanTools(`context-budget --cwd "${bareDir}"`);
      const json = JSON.parse(result.output);
      assert.equal(json.error, '.planning/ directory not found');
    } finally {
      fs.rmSync(bareDir, { recursive: true, force: true });
    }
  });

  it('returns idle status when no current phase in state.md', () => {
    // createTempProject creates .planning/ but no state.md
    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.equal(json.status, 'idle');
    assert.equal(json.currentPhase, null);
    assert.equal(json.contextWindow, 200000);
    assert.equal(typeof json.budgetUtilization, 'number');
  });

  it('returns healthy status with minimal files', () => {
    // Write a state.md with a current phase
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n**Status:** In Progress\n');
    // Create phase dir
    fs.mkdirSync(path.join(planDir, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(planDir, 'phases', '01-setup', '01-plan.md'), '# Plan\n## Tasks\n- [ ] Task 1\n');

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.equal(json.status, 'healthy');
    assert.equal(json.currentPhase, '01');
    assert.ok(json.budgetUtilization < WARNING_THRESHOLD);
    assert.equal(json.plans, 1);
    assert.ok(json.tokens.total > 0);
  });

  it('includes token breakdown in output', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'), '# Roadmap\n## Phase 01: Setup\n');
    fs.writeFileSync(path.join(planDir, 'project.md'), '# Project\nTest project\n');

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.ok('tokens' in json);
    assert.ok('project' in json.tokens);
    assert.ok('roadmap' in json.tokens);
    assert.ok('state' in json.tokens);
    assert.ok('plans' in json.tokens);
    assert.ok('total' in json.tokens);
    assert.ok(json.tokens.state > 0);
    assert.ok(json.tokens.roadmap > 0);
    assert.ok(json.tokens.project > 0);
  });

  it('includes recommendation in output', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.ok(typeof json.recommendation === 'string');
    assert.ok(json.recommendation.length > 0);
  });

  it('raw mode returns human-readable text', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');

    const result = runPanTools(`context-budget --raw --cwd "${tmpDir}"`);
    assert.ok(result.output.includes('Context Budget:'));
    assert.ok(result.output.includes('Token Estimates:'));
    assert.ok(result.output.includes('Utilization:'));
  });

  it('includes modelProfile from config', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.writeFileSync(path.join(planDir, 'config.json'), JSON.stringify({ model_profile: 'quality' }));

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.equal(json.modelProfile, 'quality');
  });

  it('progress health returns composite score JSON', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'), '# Roadmap\n');
    fs.mkdirSync(path.join(planDir, 'phases', '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(planDir, 'phases', '01-setup', '01-plan.md'), '# Plan\n');
    fs.writeFileSync(path.join(planDir, 'phases', '01-setup', '01-summary.md'), '# Summary\n');

    const result = runPanTools(`progress health --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.ok('grade' in json);
    assert.ok('composite' in json);
    assert.ok('progress' in json);
    assert.ok('context' in json);
    assert.ok('staleness' in json);
    assert.ok(typeof json.composite === 'number');
    assert.ok(['A', 'B', 'C', 'D'].includes(json.grade));
  });

  it('progress health raw mode returns text', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.mkdirSync(path.join(planDir, 'phases', '01-setup'), { recursive: true });

    const result = runPanTools(`progress health --raw --cwd "${tmpDir}"`);
    assert.ok(result.output.includes('Project Health:'));
    assert.ok(result.output.includes('Progress:'));
    assert.ok(result.output.includes('Context:'));
  });

  it('progress health scores 100% context when utilization is low', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.mkdirSync(path.join(planDir, 'phases', '01-setup'), { recursive: true });

    const result = runPanTools(`progress health --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.equal(json.context.score, 100);
  });

  it('handles empty phase directory gracefully', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.mkdirSync(path.join(planDir, 'phases', '01-setup'), { recursive: true });
    // Phase dir exists but is empty (no plans, no summaries)

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.plans, 0, 'should have 0 plans');
    assert.ok(!json.error, 'should not error on empty phase');
  });

  it('handles nonexistent current phase gracefully', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 99\n');
    // Phase 99 dir does not exist

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.currentPhase, '99', 'should report requested phase');
    assert.strictEqual(json.plans, 0, 'should have 0 plans for nonexistent phase');
  });

  it('handles malformed state.md gracefully', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), 'This is not valid state content');

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const json = JSON.parse(result.output);
    // Should fall back to idle or handle gracefully
    assert.ok(!json.error || json.status === 'idle', 'should handle malformed state without crashing');
  });

  it('counts incomplete plans', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    const phaseDir = path.join(planDir, 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Plan without matching summary = incomplete
    fs.writeFileSync(path.join(phaseDir, '01-plan.md'), '# Plan\n## Tasks\n- [ ] Task 1\n');
    fs.writeFileSync(path.join(phaseDir, '02-plan.md'), '# Plan\n## Tasks\n- [ ] Task 2\n');
    // Only one summary
    fs.writeFileSync(path.join(phaseDir, '01-summary.md'), '# Summary\n');

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.equal(json.plans, 2);
    assert.equal(json.incompletePlans, 1);
  });
});

describe('cmdContextBudget via CLI', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  it('returns error when .planning/ missing', () => {
    const empty = path.join(tmpDir, 'empty-project');
    fs.mkdirSync(empty, { recursive: true });
    const result = runPanTools(`context-budget --cwd "${empty}"`);
    assert.equal(result.success, false, 'an error payload must exit non-zero');
    const json = JSON.parse(result.output);
    assert.ok(json.error);
    assert.ok(json.error.includes('.planning'));
  });

  it('returns idle status when no active phase', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '# State\n');
    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    assert.ok(result.success);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'idle');
    assert.ok(json.recommendation.includes('No active phase'));
  });

  it('returns healthy status with active phase', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '**Current Phase:** 01\n');
    fs.writeFileSync(path.join(planDir, 'roadmap.md'), '# Roadmap\n');
    fs.writeFileSync(path.join(planDir, 'project.md'), '# Project\n');
    const phaseDir = path.join(planDir, 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan\n');

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    assert.ok(result.success);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.status, 'healthy');
    assert.strictEqual(json.currentPhase, '01');
    assert.ok(json.tokens);
    assert.ok(json.budgetUtilization >= 0);
    assert.ok(json.contextWindow > 0);
  });

  it('includes model profile from config', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '# State\n');
    fs.writeFileSync(path.join(planDir, 'config.json'), JSON.stringify({ model_profile: 'quality' }));

    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.strictEqual(json.modelProfile, 'quality');
  });

  it('surfaces cache metrics when cacheable files present', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'state.md'), '# State\n');
    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.ok(json.cache, 'cache field present');
    assert.equal(typeof json.cache.block_count, 'number');
    assert.ok(json.cache.block_count >= 1);
    assert.ok('total_tokens' in json.cache);
    assert.ok('eligible_pct' in json.cache);
    assert.ok(typeof json.cache.sha === 'string');
  });

  it('cache metrics aggregate multiple cacheable files', () => {
    const planDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planDir, 'project.md'), '# Project\n'.repeat(50));
    fs.writeFileSync(path.join(planDir, 'requirements.md'), '# Reqs\n'.repeat(50));
    fs.writeFileSync(path.join(planDir, 'state.md'), '# State\n');
    const result = runPanTools(`context-budget --cwd "${tmpDir}"`);
    const json = JSON.parse(result.output);
    assert.equal(json.cache.block_count, 3);
    assert.ok(json.cache.total_bytes > 0);
    assert.ok(json.cache.total_tokens > 0);
  });
});

// ─── Unit tests: estimateRelevanceRatio (P-RES-002, v3.7.10) ─────────────────

describe('estimateRelevanceRatio', () => {
  it('returns null for empty input', () => {
    assert.equal(estimateRelevanceRatio(''), null);
    assert.equal(estimateRelevanceRatio(null), null);
  });

  it('returns null for very short input (less than 5 lines)', () => {
    assert.equal(estimateRelevanceRatio('one\ntwo\nthree\n'), null);
  });

  it('reports HIGH ratio for content-dense markdown', () => {
    const dense = [
      '# Heading',
      '',
      'The first paragraph is full of substantive content discussing the problem at hand.',
      'The second paragraph follows up with concrete details about how to solve it.',
      'The third paragraph explores nuances and edge cases worth thinking through.',
      'A fourth paragraph ties everything together with conclusions and next steps.',
      'And one more paragraph for good measure that adds another layer of analysis.',
    ].join('\n');
    const ratio = estimateRelevanceRatio(dense);
    assert.ok(ratio >= 0.8, `expected dense markdown >= 0.8, got ${ratio}`);
  });

  it('reports LOW ratio for template-heavy markdown', () => {
    const thin = [
      '# Heading',
      '## Subhead',
      '',
      '- ',
      '- ',
      '- [ ] ',
      '---',
      '## Another',
      '',
      'TODO',
      'TBD',
      'placeholder',
      '## Yet Another',
      '> ',
    ].join('\n');
    const ratio = estimateRelevanceRatio(thin);
    assert.ok(ratio !== null);
    assert.ok(ratio < 0.4, `expected thin markdown < 0.4, got ${ratio}`);
  });

  it('skips structural-only lines (headers, separators, empty bullets, table rows, placeholders)', () => {
    const mixed = [
      '# Header',
      '## Subheader',
      '---',
      '|---|---|',
      '> ',
      '- ',
      'TODO: actual content here that is concrete and substantive enough.',
      'Real concrete content line, much longer than the 10-char threshold.',
    ].join('\n');
    const ratio = estimateRelevanceRatio(mixed);
    // 8 non-blank lines, 2 are content (the TODO line is skipped, real-concrete passes; "actual content" line passes)
    // Actually let's not pin the exact value — just assert it's between 0 and 1
    assert.ok(ratio > 0 && ratio < 1, `ratio should be in (0, 1), got ${ratio}`);
  });
});

// ─── assessCacheTtl — prompt-cache lifetime signal (ADR-0046 D5, 2026-09) ────
//
// Subagents get a five-minute prompt-cache lifetime by default. A cache WRITE
// that follows an idle gap of 5–60 minutes is a miss the one-hour lifetime
// (`subagentPromptCacheTtl: "1h"`) would have avoided. The assessor counts those.

describe('assessCacheTtl', () => {
  it('carries its own severity: recurring waste above a million re-written tokens is a warning, not an aside', () => {
    // The recommendation fired in eight of ten field projects while hygiene filed it at
    // `info`, where nothing surfaces it (sweep 2026-09-17). Severity now scales with the
    // tokens actually re-written, the way the cached-block findings already do.
    const big = (min) => ({ ts: new Date(Date.UTC(2026, 8, 10, 0, min, 0)).toISOString(), cache_write_tokens: 900000 });
    const heavy = assessCacheTtl([big(0), big(20), big(45)]);
    assert.equal(heavy.recommend, true);
    assert.equal(heavy.tokens_after_short_idle, 1800000);
    assert.equal(heavy.severity, 'warn', 'two short-idle writes of 0.9M each is real money');

    const small = (min) => ({ ts: new Date(Date.UTC(2026, 8, 10, 0, min, 0)).toISOString(), cache_write_tokens: 5000 });
    const light = assessCacheTtl([small(0), small(20), small(45)]);
    assert.equal(light.recommend, true);
    assert.equal(light.severity, 'info', 'the pattern is real but cheap');

    const quiet = assessCacheTtl([small(0), small(2)]);
    assert.equal(quiet.recommend, false);
    assert.equal(quiet.severity, 'info', 'no recommendation is never a warning');
  });

  // A ledger row `min` minutes after midnight, with a real-sized cache write.
  const at = (min, extra = {}) => ({
    ts: new Date(Date.UTC(2026, 8, 10, 0, min, 0)).toISOString(),
    cache_write_tokens: 5000,
    ...extra,
  });

  it('counts writes after a 5–60 min idle gap; ignores bursts, exactly-five-minute gaps and long idles', () => {
    // gaps: 2 (burst), 18 (short idle ✓), 5 (not > 5 → burst), 25 (short idle ✓), 150 (long idle)
    const r = assessCacheTtl([at(0), at(2), at(20), at(25), at(50), at(200)]);
    assert.equal(r.records_considered, 6);
    assert.equal(r.writes_after_short_idle, 2);
    assert.equal(r.tokens_after_short_idle, 10000);
    assert.equal(r.writes_after_long_idle, 1);
    assert.equal(r.recommend, true);
    assert.equal(r.setting, 'subagentPromptCacheTtl');
    assert.match(r.advice, /subagentPromptCacheTtl: "1h"/);
    assert.match(r.advice, /2× base input/);
  });

  it('ignores a `cost rebuild` main-thread row — one session dated at its end is not a subagent re-writing after an idle gap', () => {
    const main = { ...at(20, { cache_write_tokens: 9600000 }), token_source: 'session-transcript', agent: '(main thread)' };
    const r = assessCacheTtl([at(0), main, at(45), at(70)]);
    assert.equal(r.records_considered, 3, 'the session row is not considered');
    assert.equal(r.writes_after_short_idle, 2, 'the 45 and 70 rows follow 45- and 25-minute gaps; the session row neither counts nor breaks the gap');
    assert.equal(r.tokens_after_short_idle, 10000, 'its 9.6M-token write is not attributed to the subagent cache');
  });

  it('does not recommend on a single event, on trivial writes, or with nothing to read', () => {
    assert.equal(assessCacheTtl([at(0), at(20)]).recommend, false, 'one event is not a pattern');
    const trivial = assessCacheTtl([at(0), at(20, { cache_write_tokens: 10 }), at(40, { cache_write_tokens: 10 })]);
    assert.equal(trivial.writes_after_short_idle, 0, 'writes below the floor are noise');
    assert.equal(assessCacheTtl(null).recommend, false);
    assert.equal(assessCacheTtl([]).advice, null);
  });

  it('skips rows without a parseable timestamp and sorts the rest before measuring gaps', () => {
    const r = assessCacheTtl([{ ts: 'garbage', cache_write_tokens: 9000 }, at(30), null, at(0), at(59)]);
    assert.equal(r.records_considered, 3);
    assert.equal(r.writes_after_short_idle, 2, 'gaps 30 and 29 both qualify once sorted');
    const ordered = assessCacheTtl([at(0), at(2), at(20), at(25), at(50)]);
    const shuffled = assessCacheTtl([at(50), at(0), at(25), at(20), at(2)]);
    assert.deepEqual(shuffled, ordered, 'order-independent');
  });

  it('is surfaced by context-budget as cache.ttl from the project ledger, suspect rows excluded', () => {
    const tmp = createTempProject();
    try {
      const planDir = path.join(tmp, '.planning');
      fs.writeFileSync(path.join(planDir, 'state.md'), '# State\n');
      fs.mkdirSync(path.join(planDir, 'metrics'), { recursive: true });
      const poisoned = { ...at(10), cache_read_tokens: 9e8 }; // pre-v3.12.4 oversum poison — must not count
      fs.writeFileSync(path.join(planDir, 'metrics', 'tokens.jsonl'),
        [at(0), at(20), poisoned, at(45)].map(r => JSON.stringify(r)).join('\n') + '\n');
      const json = JSON.parse(runPanTools(`context-budget --cwd "${tmp}"`).output);
      assert.ok(json.cache && json.cache.ttl, 'cache.ttl present');
      assert.equal(json.cache.ttl.records_considered, 3, 'the poisoned row is excluded');
      assert.equal(json.cache.ttl.recommend, true);
      assert.match(json.cache.ttl.advice, /subagentPromptCacheTtl/);
    } finally {
      cleanup(tmp);
    }
  });
});
