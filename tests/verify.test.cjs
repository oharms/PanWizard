/**
 * PAN Tools Tests - Verify
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('validate consistency command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passes for consistent project', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 2: B\n### Phase 3: C\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true, 'should pass');
    assert.strictEqual(output.warning_count, 0, 'no warnings');
    assert.ok(Array.isArray(output.warnings), 'warnings should be array');
    assert.strictEqual(output.warnings.length, 0, 'warnings array should be empty');
    assert.ok(Array.isArray(output.errors), 'errors should be array');
  });

  test('warns about phase on disk but not in roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-orphan'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warning_count > 0, 'should have warnings');
    assert.ok(Array.isArray(output.warnings), 'warnings should be array');
    assert.ok(
      output.warnings.some(w => w.includes('disk but not in roadmap')),
      'should warn about orphan directory'
    );
  });

  test('warns about gaps in phase numbering', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 3: C\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.includes('Gap in phase numbering')),
      'should warn about gap'
    );
  });
});

describe('verify references command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing file', () => {
    const result = runPanTools('verify references nonexistent.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.ok(output.error.includes('not found'), 'should say not found');
  });

  test('reports found and missing references', () => {
    const docPath = path.join(tmpDir, '.planning', 'test-refs.md');
    fs.writeFileSync(docPath, 'See `nonexistent/file.txt` for details');
    const result = runPanTools('verify references .planning/test-refs.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.found, 'number', 'should have found count');
    assert.ok(Array.isArray(output.missing), 'should have missing array');
    assert.ok(output.missing.length > 0, 'should have at least one missing ref');
    assert.ok(!output.error, 'should not have error field on success');
    assert.ok(output.missing.some(m => m.includes('nonexistent')), 'missing should include the nonexistent ref');
  });
});

describe('verify artifacts command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing plan file', () => {
    const result = runPanTools('verify artifacts nonexistent.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.ok(output.error.includes('not found') || output.error.includes('No such'), 'error should mention file missing');
  });

  test('returns error when no artifacts block in frontmatter', () => {
    const planPath = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(planPath, { recursive: true });
    const planFile = path.join(planPath, 'PLAN-01.md');
    fs.writeFileSync(planFile, '---\nphase_id: 01-setup\n---\n# Plan\n');
    const result = runPanTools('verify artifacts .planning/phases/01-setup/PLAN-01.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error && output.error.includes('artifacts'), 'should mention artifacts');
    assert.strictEqual(typeof output.error, 'string', 'error should be a string');
  });
});

describe('verify key-links command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing plan file', () => {
    const result = runPanTools('verify key-links nonexistent.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
    assert.ok(output.error.includes('not found') || output.error.includes('No such'), 'error should mention file missing');
  });

  test('returns error when no key_links block in frontmatter', () => {
    const planPath = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(planPath, { recursive: true });
    const planFile = path.join(planPath, 'PLAN-01.md');
    fs.writeFileSync(planFile, '---\nphase_id: 01-setup\n---\n# Plan\n');
    const result = runPanTools('verify key-links .planning/phases/01-setup/PLAN-01.md', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(output.error && output.error.includes('key_links'), 'should mention key_links');
    assert.strictEqual(typeof output.error, 'string', 'error should be a string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-summary command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-summary command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns not found for missing summary', () => {
    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.strictEqual(output.checks.summary_exists, false);
    assert.ok(output.errors.length > 0);
  });

  test('passes for summary with no file references', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary\n\nWork completed successfully.\n');

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true);
    assert.strictEqual(output.checks.summary_exists, true);
  });

  test('detects missing referenced files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      '# Summary\n\nCreated: `src/missing-file.js`\n'
    );

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.ok(output.checks.files_created.missing.length > 0);
  });

  test('detects self-check section with pass indicator', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      '# Summary\n\nDone.\n\n## Self-Check\nAll pass\n'
    );

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'passed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify plan-structure command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify plan-structure command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error for missing file', () => {
    const result = runPanTools('verify plan-structure nonexistent.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.error);
  });

  test('reports missing frontmatter fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-plan.md'),
      '---\nphase: 01\nplan: 01\n---\n# Plan\n'
    );

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false);
    assert.ok(output.errors.some(e => e.includes('Missing required frontmatter')));
    assert.strictEqual(typeof output.task_count, 'number');
  });

  test('validates well-formed plan with tasks', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    const planContent = [
      '---',
      'phase: 01',
      'plan: 01',
      'type: implementation',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/main.js]',
      'autonomous: true',
      'must_haves:',
      '  artifacts: []',
      '---',
      '# Plan',
      '<task>',
      '<name>Setup project</name>',
      '<action>Initialize the project</action>',
      '<verify>Check files exist</verify>',
      '<done>Project initialized</done>',
      '<files>src/main.js</files>',
      '</task>',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify plan-structure .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.task_count, 1);
    assert.strictEqual(output.errors.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify phase-completeness command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify phase-completeness command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('reports complete when all plans have summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary');

    const result = runPanTools('verify phase-completeness 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, true);
    assert.strictEqual(output.plan_count, 1);
    assert.strictEqual(output.summary_count, 1);
    assert.strictEqual(output.incomplete_plans.length, 0);
  });

  test('reports incomplete when plans lack summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary');

    const result = runPanTools('verify phase-completeness 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, false);
    assert.strictEqual(output.plan_count, 2);
    assert.strictEqual(output.summary_count, 1);
    assert.ok(output.incomplete_plans.includes('01-02'));
  });

  test('returns error for non-existent phase', () => {
    const result = runPanTools('verify phase-completeness 99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify commits command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify commits command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Initialize git repo for commit verification
    const { execSync } = require('child_process');
    execSync('git init', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'ignore' });
    fs.writeFileSync(path.join(tmpDir, 'test.txt'), 'hello');
    execSync('git add test.txt', { cwd: tmpDir, stdio: 'ignore' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'ignore' });
  });

  afterEach(() => { cleanup(tmpDir); });

  test('validates real commit hash', () => {
    const { execSync } = require('child_process');
    const hash = execSync('git rev-parse HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    const result = runPanTools(`verify commits ${hash.slice(0, 7)}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, true);
    assert.strictEqual(output.valid.length, 1);
    assert.strictEqual(output.invalid.length, 0);
  });

  test('reports invalid for fake hash', () => {
    const result = runPanTools('verify commits 0000000', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, false);
    assert.ok(output.invalid.length > 0);
  });

  test('handles mix of valid and invalid hashes', () => {
    const { execSync } = require('child_process');
    const hash = execSync('git rev-parse --short HEAD', { cwd: tmpDir, encoding: 'utf-8' }).trim();
    const result = runPanTools(`verify commits ${hash} badhash`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_valid, false);
    assert.strictEqual(output.valid.length, 1);
    assert.strictEqual(output.invalid.length, 1);
    assert.strictEqual(output.total, 2);
  });

  test('requires at least one hash', () => {
    const result = runPanTools('verify commits', tmpDir);
    assert.strictEqual(result.success, false, 'should fail without hashes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health command', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns healthy for well-structured project', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'project.md'),
      '# Project\n\n## What This Is\nA test project\n\n## Core Value\nTesting\n\n## Requirements\n- REQ-01\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '# State\n**Status:** In progress\n**Last Activity:** 2026-01-01\n**Last Activity Description:** Working\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{"model_profile":"balanced"}');

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy');
    assert.strictEqual(output.errors.length, 0);
  });

  test('reports broken when planning dir missing', () => {
    // Remove the .planning directory
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken');
    assert.ok(output.errors.length > 0);
  });

  test('reports degraded when optional files missing', () => {
    // Only .planning/ exists (from createTempProject) but no project.md etc.
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.status === 'degraded' || output.status === 'broken', 'should not be healthy');
    assert.strictEqual(typeof output.repairable_count, 'number');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --full
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --full', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('default (no --full) omits test_status and build_status', () => {
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.test_status, undefined);
    assert.strictEqual(output.build_status, undefined);
  });

  test('--full includes test_status and build_status fields', () => {
    // Create a minimal package.json so it's a valid project
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test', scripts: {} }));
    const result = runPanTools('validate health --full', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok('test_status' in output, 'should have test_status');
    assert.ok('build_status' in output, 'should have build_status');
    assert.strictEqual(typeof output.test_status.pass, 'boolean');
    // build_status should be skipped (no build:hooks script)
    assert.strictEqual(output.build_status.skipped, true);
  });

  test('--full reports test failure for non-test project', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));
    const result = runPanTools('validate health --full', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // node --test in a dir with no test files will either pass with 0 tests or fail
    assert.ok(output.test_status !== undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --drift
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --drift', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Init git for drift-check
    const { execFileSync } = require('child_process');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('default (no --drift) omits drift_status', () => {
    const result = runPanTools('validate health', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.drift_status, undefined);
  });

  test('--drift includes drift_status with score and verdict', () => {
    const result = runPanTools('validate health --drift', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok(data.drift_status, 'should include drift_status');
    assert.ok('drift_score' in data.drift_status);
    assert.ok('verdict' in data.drift_status);
    assert.ok('violation_count' in data.drift_status);
    assert.ok('files_checked' in data.drift_status);
  });

  test('--drift with violations adds warning to health', () => {
    // Create a .cjs file with console.log
    fs.writeFileSync(path.join(tmpDir, 'bad.cjs'), 'console.log("drift");\n');
    const { execFileSync } = require('child_process');
    execFileSync('git', ['add', 'bad.cjs'], { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('validate health --drift', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok(data.drift_status);
    assert.ok(data.drift_status.violation_count > 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retro command
// ─────────────────────────────────────────────────────────────────────────────

describe('retro command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error when no roadmap exists', () => {
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.error, 'roadmap.md not found');
  });

  test('returns zeroes for empty project with roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [ ] Phase 1: Setup\n- [ ] Phase 2: Build\n'
    );
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.phases_planned, 2);
    assert.equal(json.phases_completed, 0);
    assert.equal(json.phases_decimal, 0);
    assert.equal(json.estimation_accuracy_pct, 100);
    assert.equal(json.verifications_total, 0);
    assert.equal(json.first_try_rate_pct, null);
    assert.ok(Array.isArray(json.common_gap_patterns));
  });

  test('counts completed phases correctly', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 2: Build\n- [ ] Phase 3: Polish\n'
    );
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.phases_planned, 3);
    assert.equal(json.phases_completed, 2);
  });

  test('detects decimal (gap closure) phases', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 1.1: Gap Fix\n- [x] Phase 2: Build\n'
    );
    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.phases_planned, 3);
    assert.equal(json.phases_decimal, 1);
    assert.ok(json.estimation_accuracy_pct < 100);
  });

  test('reads verification files and computes stats', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 2: Build\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'), '---\nstatus: passed\n---\nAll good.');

    const phaseDir2 = path.join(tmpDir, '.planning', 'phases', '02-build');
    fs.mkdirSync(phaseDir2, { recursive: true });
    fs.writeFileSync(path.join(phaseDir2, '02-verification.md'), '---\nstatus: gaps_found\n---\n## Gaps\n- Missing wiring between API and UI\n- Stub detected in handler\n');

    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.verifications_total, 2);
    assert.equal(json.verifications_passed_first_try, 1);
    assert.equal(json.verifications_gaps_found, 1);
    assert.equal(json.first_try_rate_pct, 50);
    assert.ok(json.common_gap_patterns.length > 0);
  });

  test('raw output includes summary text', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n'
    );
    const { success, output } = runPanTools('retro --raw', tmpDir);
    assert.ok(success);
    assert.ok(output.includes('Phases:'));
    assert.ok(output.includes('Estimation accuracy:'));
  });

  test('--write-memory appends gap-pattern lessons to pan-planner memory', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n- [x] Phase 2: Build\n'
    );
    const phaseDir2 = path.join(tmpDir, '.planning', 'phases', '02-build');
    fs.mkdirSync(phaseDir2, { recursive: true });
    fs.writeFileSync(path.join(phaseDir2, '02-verification.md'),
      '---\nstatus: gaps_found\n---\n## Gaps\n- Missing wiring between API and UI\n- Stub detected in handler\n');

    const { success, output } = runPanTools('retro --write-memory', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.ok(json.memory, 'memory field present');
    assert.ok(json.memory.wrote['pan-planner'] >= 1, 'wrote at least one planner lesson');

    // Verify the memory file was actually created.
    const mem = fs.readFileSync(path.join(tmpDir, '.planning', 'memory', 'pan-planner.md'), 'utf-8');
    assert.ok(mem.includes('Recurring plan gap'));
  });

  test('--write-memory respects --max N to cap lessons', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Many distinct patterns → many gap groups.
    const gaps = Array.from({ length: 6 }, (_, i) => `- Unique pattern ${i} causing verification failure\n`).join('');
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'),
      `---\nstatus: gaps_found\n---\n## Gaps\n${gaps}`);

    const { success, output } = runPanTools('retro --write-memory --max 2', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.memory.max, 2);
    assert.ok(json.memory.wrote['pan-planner'] <= 2);
  });

  test('without --write-memory, no memory writes happen', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [x] Phase 1: Setup\n'
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'),
      '---\nstatus: gaps_found\n---\n## Gaps\n- Some gap\n');

    const { success, output } = runPanTools('retro', tmpDir);
    assert.ok(success);
    const json = JSON.parse(output);
    assert.equal(json.memory, undefined, 'no memory field when flag not set');
    assert.equal(fs.existsSync(path.join(tmpDir, '.planning', 'memory')), false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// retro helper functions (unit tests)
// ─────────────────────────────────────────────────────────────────────────────

const { collectVerificationStats, countRoadmapPhases, groupGapPatterns } = require('../pan-wizard-core/bin/lib/verify.cjs');

describe('countRoadmapPhases', () => {
  test('counts empty roadmap', () => {
    const r = countRoadmapPhases('# Roadmap\nNo phases yet.');
    assert.equal(r.planned, 0);
    assert.equal(r.completed, 0);
    assert.equal(r.decimal_phases, 0);
  });

  test('counts mixed checkboxes', () => {
    const r = countRoadmapPhases('- [x] Phase 1: A\n- [ ] Phase 2: B\n- [x] Phase 3: C\n');
    assert.equal(r.planned, 3);
    assert.equal(r.completed, 2);
  });

  test('counts bold phase names', () => {
    const r = countRoadmapPhases('- [x] **Phase 1: Setup**\n- [ ] **Phase 2: Build**\n');
    assert.equal(r.planned, 2);
    assert.equal(r.completed, 1);
  });

  test('counts decimal phases', () => {
    const r = countRoadmapPhases('- [x] Phase 1: A\n- [x] Phase 1.1: Gap\n- [x] Phase 2: B\n');
    assert.equal(r.decimal_phases, 1);
    assert.equal(r.planned, 3);
  });
});

describe('groupGapPatterns', () => {
  test('returns empty for no patterns', () => {
    const r = groupGapPatterns([]);
    assert.equal(r.length, 0);
  });

  test('groups similar patterns', () => {
    const r = groupGapPatterns([
      'Missing wiring between API and UI',
      'Missing wiring between DB and API',
      'Stub detected in handler',
    ]);
    assert.ok(r.length > 0);
    assert.ok(r[0].count >= 1);
    assert.ok(typeof r[0].pattern === 'string');
  });

  test('limits to 10 groups max', () => {
    const patterns = [];
    for (let i = 0; i < 20; i++) patterns.push(`Unique pattern ${i} is different`);
    const r = groupGapPatterns(patterns);
    assert.ok(r.length <= 10);
  });
});

describe('collectVerificationStats', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns zeroes for empty phases dir', () => {
    const r = collectVerificationStats(path.join(tmpDir, '.planning', 'phases'));
    assert.equal(r.total, 0);
    assert.equal(r.passed, 0);
  });

  test('returns zeroes for nonexistent dir', () => {
    const r = collectVerificationStats(path.join(tmpDir, 'nonexistent'));
    assert.equal(r.total, 0);
  });

  test('collects stats from verification files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'), '---\nstatus: passed\n---\nDone.');
    const r = collectVerificationStats(path.join(tmpDir, '.planning', 'phases'));
    assert.equal(r.total, 1);
    assert.equal(r.passed, 1);
    assert.equal(r.gaps_found, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate deployment
// ─────────────────────────────────────────────────────────────────────────────

describe('validate deployment command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns error when no PAN installation found', () => {
    const result = runPanTools('validate deployment', tmpDir);
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.ok(data.error);
    assert.ok(data.error.includes('No PAN installations'));
  });

  test('detects a clean Claude installation', () => {
    // Create minimal Claude PAN installation with manifest
    const claudeDir = path.join(tmpDir, '.claude');
    const coreDir = path.join(claudeDir, 'pan-wizard-core', 'bin', 'lib');
    fs.mkdirSync(coreDir, { recursive: true });
    const testFile = 'pan-wizard-core/bin/lib/test.cjs';
    const content = 'module.exports = {};';
    fs.writeFileSync(path.join(claudeDir, testFile), content);
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '2.8.1',
      files: { [testFile]: hash }
    }));

    const result = runPanTools('validate deployment', tmpDir);
    assert.ok(result.success);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.status, 'clean');
    assert.strictEqual(data.runtimes_found, 1);
    assert.strictEqual(data.runtimes.claude.status, 'clean');
    assert.strictEqual(data.runtimes.claude.total_files, 1);
    assert.strictEqual(data.runtimes.claude.missing.length, 0);
  });

  test('detects missing files as broken', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '2.8.1',
      files: { 'missing-file.cjs': 'abc123' }
    }));

    const result = runPanTools('validate deployment', tmpDir);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.status, 'broken');
    assert.strictEqual(data.runtimes.claude.status, 'broken');
    assert.strictEqual(data.runtimes.claude.missing.length, 1);
    assert.ok(data.runtimes.claude.missing[0].includes('missing-file'));
  });

  test('detects modified files', () => {
    const claudeDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    const file = 'test.cjs';
    fs.writeFileSync(path.join(claudeDir, file), 'original content');
    // Manifest has hash of different content
    fs.writeFileSync(path.join(claudeDir, 'pan-file-manifest.json'), JSON.stringify({
      version: '2.8.1',
      files: { [file]: 'aaaa' }
    }));

    const result = runPanTools('validate deployment', tmpDir);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.runtimes.claude.status, 'modified');
    assert.strictEqual(data.runtimes.claude.modified.length, 1);
  });

  test('detects multiple runtimes', () => {
    // Create two minimal installations
    for (const dir of ['.claude', '.codex']) {
      const d = path.join(tmpDir, dir);
      fs.mkdirSync(d, { recursive: true });
      fs.writeFileSync(path.join(d, 'pan-file-manifest.json'), JSON.stringify({
        version: '2.8.1', files: {}
      }));
    }

    const result = runPanTools('validate deployment', tmpDir);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.runtimes_found, 2);
    assert.ok('claude' in data.runtimes);
    assert.ok('codex' in data.runtimes);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// progress command
// ─────────────────────────────────────────────────────────────────────────────

