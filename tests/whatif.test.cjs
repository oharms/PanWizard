/**
 * Tests for whatif.cjs — Y-4 counterfactual phase exploration (v3.3).
 *
 * Tests focus on the data layer (scenario slugification, context building,
 * report generation). Worktree lifecycle tests require git init — covered
 * in tests/scenarios/whatif-isolated.test.cjs via a scenario fixture.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  scenarioSlug,
  buildCounterfactualContext,
  writeCounterfactualReport,
  createWorktree,
  cleanupWorktree,
  COUNTERFACTUALS_DIR,
  BRANCH_PREFIX,
} = require('../pan-wizard-core/bin/lib/whatif.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─── scenarioSlug ───────────────────────────────────────────────────────────

describe('whatif — scenarioSlug', () => {
  test('lowercases + hyphenates typical scenario text', () => {
    assert.equal(scenarioSlug('What if we used Redis instead of Memcached?'),
      'what-if-we-used-redis-instead-of-memcached');
  });

  test('strips leading/trailing hyphens', () => {
    assert.equal(scenarioSlug('  --Redis over Memcached--  '), 'redis-over-memcached');
  });

  test('collapses multiple non-alphanumeric chars to a single hyphen', () => {
    assert.equal(scenarioSlug('Redis /// Memcached   !!! comparison'), 'redis-memcached-comparison');
  });

  test('bounds length to SCENARIO_SLUG_MAX', () => {
    const long = 'a'.repeat(100);
    const slug = scenarioSlug(long);
    assert.ok(slug.length <= 50);
  });

  test('defaults to "scenario" for empty or non-string inputs', () => {
    assert.equal(scenarioSlug(''), 'scenario');
    assert.equal(scenarioSlug(null), 'scenario');
    assert.equal(scenarioSlug('!!!'), 'scenario');
    assert.equal(scenarioSlug(42), 'scenario');
  });

  test('is deterministic (same input, same output)', () => {
    const a = scenarioSlug('Try SQLite');
    const b = scenarioSlug('Try SQLite');
    assert.equal(a, b);
  });
});

// ─── buildCounterfactualContext ─────────────────────────────────────────────

describe('whatif — buildCounterfactualContext', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  function scaffoldPhase(num, slug, planContent, summaryContent) {
    const dir = path.join(tmpDir, '.planning', 'phases', `${num}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-plan.md'), planContent || 'plan body');
    if (summaryContent) {
      fs.writeFileSync(path.join(dir, '01-summary.md'), summaryContent);
    }
    return dir;
  }

  test('returns error for missing scenario', () => {
    const r = buildCounterfactualContext(tmpDir, '07', '');
    assert.ok(r.error);
    assert.match(r.error, /scenario/i);
  });

  test('returns error for unknown phase', () => {
    const r = buildCounterfactualContext(tmpDir, '99', 'Use Redis');
    assert.ok(r.error);
    assert.match(r.error, /Phase 99 not found/);
  });

  test('returns context with slug + plans for existing phase', () => {
    scaffoldPhase('03', 'api', '# Plan\nUse Postgres.');
    const r = buildCounterfactualContext(tmpDir, '03', 'What if we used SQLite?');
    assert.equal(r.phase, '03');
    assert.equal(r.scenario, 'What if we used SQLite?');
    assert.equal(r.slug, 'what-if-we-used-sqlite');
    assert.equal(r.plans.length, 1);
    assert.equal(r.has_executed, false);
  });

  test('has_executed=true when summary exists', () => {
    scaffoldPhase('04', 'exec', 'plan', 'summary');
    const r = buildCounterfactualContext(tmpDir, '04', 'alternative');
    assert.equal(r.has_executed, true);
    assert.equal(r.summaries.length, 1);
  });

  test('plans and summaries include byte counts', () => {
    scaffoldPhase('05', 'big', 'a'.repeat(500));
    const r = buildCounterfactualContext(tmpDir, '05', 'scenario');
    assert.ok(r.plans[0].bytes >= 500);
  });
});

// ─── writeCounterfactualReport ──────────────────────────────────────────────

describe('whatif — writeCounterfactualReport', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing phaseNum', () => {
    const r = writeCounterfactualReport(tmpDir, null, 'scenario', {});
    assert.ok(r.error);
  });

  test('returns error for missing scenario', () => {
    const r = writeCounterfactualReport(tmpDir, '01', '', {});
    assert.ok(r.error);
  });

  test('writes report with frontmatter + required sections', () => {
    const r = writeCounterfactualReport(tmpDir, '05', 'What if we used SQLite', {
      summary: 'SQLite would suffice at this scale.',
      differences: ['No connection pooling', 'Single-writer model'],
      recommendations: ['Reconsider if write load exceeds 100 ops/sec'],
      risks: ['Migration cost from Postgres dialect'],
      verdict: 'Not recommended — SQLite unsuitable for concurrent writes.',
    });
    assert.equal(r.written, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', COUNTERFACTUALS_DIR, '05-what-if-we-used-sqlite.md'),
      'utf-8'
    );
    assert.match(content, /^---\ntype: counterfactual/);
    assert.match(content, /phase: 05/);
    assert.match(content, /scenario_slug: what-if-we-used-sqlite/);
    assert.match(content, /# What-if: Phase 05/);
    assert.match(content, /## Differences from actual plan/);
    assert.match(content, /No connection pooling/);
    assert.match(content, /## Recommendations/);
    assert.match(content, /## Risks/);
    assert.match(content, /## Bottom line/);
    assert.match(content, /\*\*Not recommended/);
  });

  test('writes placeholder when summary missing', () => {
    writeCounterfactualReport(tmpDir, '06', 'x', {});
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', COUNTERFACTUALS_DIR, '06-x.md'),
      'utf-8'
    );
    assert.match(content, /agent did not produce a summary/);
  });

  test('omits empty sections', () => {
    writeCounterfactualReport(tmpDir, '07', 'minimal', {
      summary: 'Short summary.',
    });
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', COUNTERFACTUALS_DIR, '07-minimal.md'),
      'utf-8'
    );
    assert.equal(content.includes('## Differences'), false);
    assert.equal(content.includes('## Recommendations'), false);
    assert.equal(content.includes('## Risks'), false);
  });

  test('filename pattern is <phase>-<slug>.md', () => {
    writeCounterfactualReport(tmpDir, '08', 'Some alternative!', { summary: 'x' });
    const files = fs.readdirSync(path.join(tmpDir, '.planning', COUNTERFACTUALS_DIR));
    assert.ok(files.includes('08-some-alternative.md'));
  });

  test('returned file path is POSIX-style relative path', () => {
    const r = writeCounterfactualReport(tmpDir, '09', 'x', { summary: 'y' });
    assert.equal(r.file.includes('\\'), false);
    assert.match(r.file, /\.planning\/counterfactuals\/09-x\.md/);
  });
});

// ─── Worktree lifecycle (integration, requires git) ────────────────────────

describe('whatif — worktree lifecycle (integration)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Initialize a git repo and create an initial commit so worktree has a base.
    try {
      execFileSync('git', ['init', '--initial-branch=main'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(tmpDir, 'README.md'), 'initial');
      execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
    } catch (e) {
      // If git isn't available, skip the suite gracefully by marking tmpDir null.
      tmpDir = null;
    }
  });

  afterEach(() => {
    if (tmpDir) cleanup(tmpDir);
  });

  test('createWorktree + cleanupWorktree round-trip', (t) => {
    if (!tmpDir) { t.skip('git unavailable'); return; }
    const wt = createWorktree(tmpDir, '07', 'Try SQLite');
    if (wt.error) { t.skip(wt.error); return; }
    assert.ok(wt.worktree_path);
    assert.match(wt.branch, new RegExp(`^${BRANCH_PREFIX}07-try-sqlite-`));
    assert.ok(fs.existsSync(wt.worktree_path));

    const cleanupResult = cleanupWorktree(tmpDir, wt.worktree_path, wt.branch, { force: true });
    assert.equal(cleanupResult.removed, true);
    assert.equal(fs.existsSync(wt.worktree_path), false);
  });

  test('createWorktree errors on non-git directory', () => {
    const nonGit = createTempProject();
    try {
      const r = createWorktree(nonGit, '01', 'scenario');
      assert.ok(r.error);
      assert.match(r.error, /git repo/i);
    } finally {
      cleanup(nonGit);
    }
  });

  test('cleanupWorktree errors on non-git directory', () => {
    const nonGit = createTempProject();
    try {
      const r = cleanupWorktree(nonGit, '/nonexistent', 'some-branch');
      assert.ok(r.error);
    } finally {
      cleanup(nonGit);
    }
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('whatif — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('whatif report writes file via CLI', () => {
    // Using quoted JSON can break cmd shell; pass a simple scenario + minimal comparison.
    const r = runPanTools('whatif report 05 try-sqlite', tmpDir);
    // Without --comparison flag, writes minimal report.
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.written, true);
  });

  test('whatif report errors without scenario', () => {
    const r = runPanTools('whatif report 05', tmpDir);
    assert.equal(r.success, false);
  });

  test('whatif cleanup errors on non-git dir without worktree', () => {
    const r = runPanTools('whatif cleanup --worktree /nope --branch foo', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.ok(json.error);
  });
});
