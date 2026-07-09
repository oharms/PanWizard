/**
 * PAN Tools Tests - Core Helper Functions
 *
 * Tests for: safeReadFile, loadConfig, isGitIgnored, isGitRepo, execGit,
 * searchPhaseInDir, pathExistsInternal, getMilestoneInfo
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createTempProject, cleanup } = require('./helpers.cjs');
const {
  safeReadFile,
  loadConfig,
  isGitIgnored,
  isGitRepo,
  execGit,
  searchPhaseInDir,
  pathExistsInternal,
  getMilestoneInfo,
} = require('../pan-wizard-core/bin/lib/core.cjs');

let tmpDir;
beforeEach(() => { tmpDir = createTempProject(); });
afterEach(() => { cleanup(tmpDir); });

// ─── safeReadFile ───────────────────────────────────────────────────────────

describe('safeReadFile', () => {
  it('reads existing file', () => {
    const fp = path.join(tmpDir, 'test.txt');
    fs.writeFileSync(fp, 'hello world');
    const result = safeReadFile(fp);
    assert.equal(result, 'hello world');
    assert.equal(typeof result, 'string');
  });

  it('returns null for missing file', () => {
    const result = safeReadFile(path.join(tmpDir, 'nope.txt'));
    assert.equal(result, null);
  });

  it('reads empty file', () => {
    const fp = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(fp, '');
    const result = safeReadFile(fp);
    assert.equal(typeof result, 'string');
    assert.equal(result, '');
  });

  it('reads file with unicode content', () => {
    const fp = path.join(tmpDir, 'unicode.txt');
    fs.writeFileSync(fp, 'Phase \u2588\u2591 complete');
    assert.equal(safeReadFile(fp), 'Phase \u2588\u2591 complete');
  });

  it('returns null for directory path', () => {
    assert.equal(safeReadFile(tmpDir), null);
  });
});

// ─── loadConfig ─────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('returns defaults when no config.json exists', () => {
    const config = loadConfig(tmpDir);
    assert.equal(typeof config, 'object');
    assert.equal(config.model_profile, 'balanced');
    assert.equal(config.commit_docs, true);
    assert.equal(config.branching_strategy, 'none');
    assert.equal(config.research, true);
    assert.equal(config.plan_checker, true);
    assert.equal(config.verifier, true);
    assert.equal(config.parallelization, true);
  });

  it('reads flat config keys', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ model_profile: 'quality', commit_docs: false }));
    const config = loadConfig(tmpDir);
    assert.equal(config.model_profile, 'quality');
    assert.equal(config.commit_docs, false);
  });

  it('reads nested config sections', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      workflow: { research: false, plan_check: false },
      git: { branching_strategy: 'phase' },
    }));
    const config = loadConfig(tmpDir);
    assert.equal(config.research, false);
    assert.equal(config.plan_checker, false);
    assert.equal(config.branching_strategy, 'phase');
  });

  it('handles parallelization as object with enabled field', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ parallelization: { enabled: false } }));
    const config = loadConfig(tmpDir);
    assert.equal(config.parallelization, false);
  });

  it('handles parallelization as boolean', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ parallelization: false }));
    const config = loadConfig(tmpDir);
    assert.equal(config.parallelization, false);
  });

  it('returns defaults for malformed JSON', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, 'not json {{{');
    const config = loadConfig(tmpDir);
    assert.equal(config.model_profile, 'balanced');
  });

  it('flat key overrides nested key', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      commit_docs: false,
      planning: { commit_docs: true },
    }));
    const config = loadConfig(tmpDir);
    assert.equal(config.commit_docs, false);
  });
});

// ─── isGitIgnored ───────────────────────────────────────────────────────────

describe('isGitIgnored', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-git-'));
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('returns true for gitignored file', () => {
    fs.writeFileSync(path.join(gitDir, '.gitignore'), 'secret.txt\n');
    assert.equal(isGitIgnored(gitDir, 'secret.txt'), true);
  });

  it('returns false for tracked file', () => {
    fs.writeFileSync(path.join(gitDir, 'readme.md'), 'hi');
    assert.equal(isGitIgnored(gitDir, 'readme.md'), false);
  });

  it('returns false in non-git directory', () => {
    assert.equal(isGitIgnored(tmpDir, 'file.txt'), false);
  });
});

// ─── isGitRepo ──────────────────────────────────────────────────────────────

describe('isGitRepo', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-git-'));
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('returns true for git repository', () => {
    assert.equal(isGitRepo(gitDir), true);
  });

  it('returns false for non-git directory', () => {
    assert.equal(isGitRepo(tmpDir), false);
  });

  it('returns false for nonexistent directory', () => {
    assert.equal(isGitRepo(path.join(tmpDir, 'does-not-exist')), false);
  });
});

// ─── execGit ────────────────────────────────────────────────────────────────

describe('execGit', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-git-'));
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    fs.rmSync(gitDir, { recursive: true, force: true });
  });

  it('runs successful git command', () => {
    const result = execGit(gitDir, ['status']);
    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.length > 0);
  });

  it('returns error for invalid git command', () => {
    const result = execGit(gitDir, ['nonexistent-command']);
    assert.notEqual(result.exitCode, 0);
  });

  it('handles git log on empty repo', () => {
    const result = execGit(gitDir, ['log', '--oneline']);
    assert.notEqual(result.exitCode, 0);
  });

  it('returns exitCode 0 for git rev-parse in repo', () => {
    const result = execGit(gitDir, ['rev-parse', '--is-inside-work-tree']);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, 'true');
  });
});

// ─── searchPhaseInDir ───────────────────────────────────────────────────────

describe('searchPhaseInDir', () => {
  it('finds phase directory by number', () => {
    const pp = path.join(tmpDir, '.planning', 'phases');
    fs.mkdirSync(path.join(pp, '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(pp, '01-setup', '01-plan.md'), '# Plan');
    const result = searchPhaseInDir(pp, '.planning/phases', '01');
    assert.ok(result);
    assert.equal(result.found, true);
    assert.equal(result.phase_number, '01');
    assert.equal(result.phase_name, 'setup');
    assert.equal(result.plans.length, 1);
    assert.ok(Array.isArray(result.plans));
    assert.ok(Array.isArray(result.summaries));
    assert.equal(result.summaries.length, 0);
  });

  it('returns null when phase not found', () => {
    const pp = path.join(tmpDir, '.planning', 'phases');
    const result = searchPhaseInDir(pp, '.planning/phases', '99');
    assert.equal(result, null);
  });

  it('identifies incomplete plans (plans without matching summaries)', () => {
    const pp = path.join(tmpDir, '.planning', 'phases');
    const phaseDir = path.join(pp, '01-feature');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-plan.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '02-plan.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-summary.md'), '# Summary 1');
    const result = searchPhaseInDir(pp, '.planning/phases', '01');
    assert.ok(result);
    assert.deepEqual(result.incomplete_plans, ['02-plan.md']);
  });

  it('detects research and context files', () => {
    const pp = path.join(tmpDir, '.planning', 'phases');
    const phaseDir = path.join(pp, '02-auth');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '02-research.md'), '# Research');
    fs.writeFileSync(path.join(phaseDir, '02-context.md'), '# Context');
    const result = searchPhaseInDir(pp, '.planning/phases', '02');
    assert.ok(result);
    assert.equal(result.has_research, true);
    assert.equal(result.has_context, true);
    assert.equal(result.has_verification, false);
  });

  it('returns null for non-existent directory', () => {
    const result = searchPhaseInDir('/nonexistent', 'base', '01');
    assert.equal(result, null);
  });
});

// ─── pathExistsInternal ─────────────────────────────────────────────────────

describe('pathExistsInternal', () => {
  it('returns true for existing file', () => {
    const fp = path.join(tmpDir, 'exists.txt');
    fs.writeFileSync(fp, 'yes');
    const result = pathExistsInternal(tmpDir, 'exists.txt');
    assert.equal(result, true);
    assert.equal(typeof result, 'boolean');
  });

  it('returns false for missing file', () => {
    const result = pathExistsInternal(tmpDir, 'nope.txt');
    assert.equal(result, false);
    assert.equal(typeof result, 'boolean');
  });

  it('returns true for existing directory', () => {
    assert.equal(pathExistsInternal(tmpDir, '.planning'), true);
  });

  it('handles absolute path', () => {
    const fp = path.join(tmpDir, 'abs.txt');
    fs.writeFileSync(fp, 'test');
    assert.equal(pathExistsInternal(tmpDir, fp), true);
  });
});

// ─── getMilestoneInfo ───────────────────────────────────────────────────────

describe('getMilestoneInfo', () => {
  it('returns defaults when no roadmap.md exists', () => {
    const info = getMilestoneInfo(tmpDir);
    assert.equal(typeof info, 'object');
    assert.equal(info.version, 'v1.0');
    assert.equal(info.name, 'milestone');
  });

  it('extracts version from roadmap.md', () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'roadmap.md');
    fs.writeFileSync(roadmapPath, '# Roadmap\n\n## Milestone v2.5: Great Feature\n\n## Phase 01: Setup\n');
    const info = getMilestoneInfo(tmpDir);
    assert.equal(typeof info, 'object');
    assert.equal(info.version, 'v2.5');
    assert.equal(info.name, 'Great Feature');
    assert.equal(typeof info.version, 'string');
  });

  it('handles roadmap with only version, no name', () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'roadmap.md');
    fs.writeFileSync(roadmapPath, '# v1.0 Roadmap\n\n## Phase 01: Setup\n');
    const info = getMilestoneInfo(tmpDir);
    assert.equal(info.version, 'v1.0');
    assert.equal(typeof info.name, 'string');
  });

  it('handles roadmap with multiple milestone headings', () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'roadmap.md');
    fs.writeFileSync(roadmapPath, '# Roadmap\n\n## Milestone v1.0: First\n\n## Milestone v2.0: Second\n');
    const info = getMilestoneInfo(tmpDir);
    assert.equal(typeof info, 'object');
    assert.ok(info.version.startsWith('v'));
  });

  it('handles empty roadmap', () => {
    const roadmapPath = path.join(tmpDir, '.planning', 'roadmap.md');
    fs.writeFileSync(roadmapPath, '');
    const info = getMilestoneInfo(tmpDir);
    assert.equal(typeof info, 'object');
    assert.equal(info.version, 'v1.0');
    assert.equal(info.name, 'milestone');
  });
});
