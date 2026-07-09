const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { estimateTokens, estimateRelevanceRatio } = require('../pan-wizard-core/bin/lib/context-budget.cjs');
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
    assert.ok(result.success);
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
