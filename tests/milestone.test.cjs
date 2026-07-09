/**
 * PAN Tools Tests - Milestone
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('milestone complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('archives roadmap, requirements, creates milestones.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0 MVP\n\n### Phase 1: Foundation\n**Goal:** Setup\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements\n\n- [ ] User auth\n- [ ] Dashboard\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(
      path.join(p1, '01-01-summary.md'),
      `---\none-liner: Set up project infrastructure\n---\n# Summary\n`
    );

    const result = runPanTools('milestone complete v1.0 --name MVP Foundation', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.version, 'v1.0');
    assert.strictEqual(output.phases, 1);
    assert.ok(output.archived.roadmap, 'roadmap should be archived');
    assert.ok(output.archived.requirements, 'requirements should be archived');

    // Verify archive files exist
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'milestones', 'v1.0-roadmap.md')),
      'archived roadmap should exist'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'milestones', 'v1.0-requirements.md')),
      'archived requirements should exist'
    );

    // Verify milestones.md created
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'milestones.md')),
      'milestones.md should be created'
    );
    const milestones = fs.readFileSync(path.join(tmpDir, '.planning', 'milestones.md'), 'utf-8');
    assert.ok(milestones.includes('v1.0 MVP Foundation'), 'milestone entry should contain name');
    assert.ok(milestones.includes('Set up project infrastructure'), 'accomplishments should be listed');
  });

  test('appends to existing milestones.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'milestones.md'),
      `# Milestones\n\n## v0.9 Alpha (Shipped: 2025-01-01)\n\n---\n\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const result = runPanTools('milestone complete v1.0 --name Beta', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const milestones = fs.readFileSync(path.join(tmpDir, '.planning', 'milestones.md'), 'utf-8');
    assert.ok(milestones.includes('v0.9 Alpha'), 'existing entry should be preserved');
    assert.ok(milestones.includes('v1.0 Beta'), 'new entry should be appended');
  });
  test('fails when version argument is missing', () => {
    const result = runPanTools('milestone complete', tmpDir);
    assert.ok(!result.success, 'should fail for missing version');
    assert.ok(result.error.includes('version required'), 'error should mention version required');
  });

  test('completes with empty phases directory', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v2.0\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const result = runPanTools('milestone complete v2.0 --name Empty', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.version, 'v2.0');
    assert.strictEqual(output.phases, 0, 'should have 0 phases');
    assert.strictEqual(output.plans, 0, 'should have 0 plans');
    assert.strictEqual(output.tasks, 0, 'should have 0 tasks');
    assert.ok(output.milestones_updated, 'milestones should be updated');
  });

  test('output includes all expected fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v3.0\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const result = runPanTools('milestone complete v3.0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.version, 'string');
    assert.strictEqual(typeof output.name, 'string');
    assert.strictEqual(typeof output.date, 'string');
    assert.strictEqual(typeof output.phases, 'number');
    assert.strictEqual(typeof output.plans, 'number');
    assert.strictEqual(typeof output.tasks, 'number');
    assert.ok(Array.isArray(output.accomplishments), 'accomplishments should be array');
    assert.strictEqual(typeof output.archived, 'object', 'archived should be object');
    assert.strictEqual(typeof output.milestones_updated, 'boolean');
    assert.ok(!output.error, 'should not have error on success');
  });

  test('uses version as name when --name not provided', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const result = runPanTools('milestone complete v4.0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.name, 'v4.0', 'name should default to version');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requirements mark-complete command
// ─────────────────────────────────────────────────────────────────────────────

describe('requirements mark-complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('marks checkbox and traceability table for a single requirement', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements\n\n- [ ] **REQ-01** User authentication\n- [ ] **REQ-02** Dashboard\n\n| ID | Phase | Status |\n|----|-------|--------|\n| REQ-01 | Phase 1 | Pending |\n| REQ-02 | Phase 2 | Pending |\n`
    );

    const result = runPanTools('requirements mark-complete REQ-01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true);
    assert.deepStrictEqual(output.marked_complete, ['REQ-01']);
    assert.deepStrictEqual(output.not_found, []);

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');
    assert.ok(content.includes('[x] **REQ-01**'), 'checkbox should be checked');
    assert.ok(content.includes('[ ] **REQ-02**'), 'other checkbox should remain unchecked');
    assert.ok(content.includes('Complete'), 'traceability should say Complete');
  });

  test('marks multiple comma-separated requirements', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements\n\n- [ ] **REQ-01** Auth\n- [ ] **REQ-02** Dash\n- [ ] **REQ-03** API\n`
    );

    const result = runPanTools('requirements mark-complete REQ-01,REQ-03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.marked_complete.length, 2);
    assert.ok(output.marked_complete.includes('REQ-01'));
    assert.ok(output.marked_complete.includes('REQ-03'));
    assert.strictEqual(output.total, 2);
  });

  test('reports not_found for unknown requirement IDs', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements\n\n- [ ] **REQ-01** Auth\n`
    );

    const result = runPanTools('requirements mark-complete REQ-99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, false);
    assert.deepStrictEqual(output.not_found, ['REQ-99']);
  });

  test('returns gracefully when requirements.md is missing', () => {
    const result = runPanTools('requirements mark-complete REQ-01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, false);
    assert.strictEqual(output.reason, 'requirements.md not found');
  });

  test('fails when no requirement IDs provided', () => {
    const result = runPanTools('requirements mark-complete', tmpDir);
    assert.ok(!result.success, 'should fail for missing IDs');
    assert.ok(result.error.includes('requirement IDs required'), 'error should mention IDs required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete — archive phases
// ─────────────────────────────────────────────────────────────────────────────

describe('milestone complete with --archive-phases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('archives phase directories when flag is set', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n'
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '# Plan\n');

    const result = runPanTools('milestone complete v5.0 --archive-phases', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.archived.phases, true, 'phases should be archived');

    // Phase dir should be moved to milestones archive
    const archivePhasesDir = path.join(tmpDir, '.planning', 'milestones', 'v5.0-phases');
    assert.ok(fs.existsSync(archivePhasesDir), 'archive phases dir should exist');
    assert.ok(fs.existsSync(path.join(archivePhasesDir, '01-setup')), 'phase 01-setup should be in archive');
  });

  test('handles multiple phases with summaries', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n'
    );

    // Create 3 phases with summaries
    for (let i = 1; i <= 3; i++) {
      const pDir = path.join(tmpDir, '.planning', 'phases', `0${i}-phase`);
      fs.mkdirSync(pDir, { recursive: true });
      fs.writeFileSync(path.join(pDir, `0${i}-01-plan.md`), `# Plan\n## Task 1\n## Task 2\n`);
      fs.writeFileSync(
        path.join(pDir, `0${i}-01-summary.md`),
        `---\none-liner: Completed phase ${i}\n---\n# Summary\n## Task 1\n## Task 2\n`
      );
    }

    const result = runPanTools('milestone complete v6.0 --name Big-Release', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phases, 3, 'should count 3 phases');
    assert.strictEqual(output.plans, 3, 'should count 3 plans');
    assert.strictEqual(output.accomplishments.length, 3, 'should have 3 accomplishments');
    assert.ok(output.accomplishments.includes('Completed phase 1'), 'should include phase 1 accomplishment');
    assert.ok(output.accomplishments.includes('Completed phase 3'), 'should include phase 3 accomplishment');
  });

  test('completes without state.md (best-effort state update)', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n');
    // No state.md

    const result = runPanTools('milestone complete v7.0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.version, 'v7.0');
    assert.strictEqual(output.state_updated, false, 'state should not be updated when state.md missing');
    assert.ok(output.milestones_updated, 'milestones.md should still be created');
  });

  test('completes without roadmap.md (nothing to archive)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Status:** In progress\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n'
    );
    // No roadmap.md, no requirements.md

    const result = runPanTools('milestone complete v8.0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.archived.roadmap, false, 'roadmap archive should be false');
    assert.strictEqual(output.archived.requirements, false, 'requirements archive should be false');
    assert.ok(output.milestones_updated, 'milestones.md should still be created');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// requirements mark-complete — edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('requirements mark-complete edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('accepts bracket-wrapped IDs [REQ-01,REQ-02]', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [ ] **REQ-01** Auth\n- [ ] **REQ-02** Dash\n'
    );

    const result = runPanTools('requirements mark-complete [REQ-01,REQ-02]', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.marked_complete.length, 2, 'should mark 2 requirements');
    assert.ok(output.marked_complete.includes('REQ-01'), 'should include REQ-01');
    assert.ok(output.marked_complete.includes('REQ-02'), 'should include REQ-02');
  });

  test('mixed found and not-found IDs in single call', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [ ] **REQ-01** Auth\n- [ ] **REQ-02** Dash\n'
    );

    const result = runPanTools('requirements mark-complete REQ-01,REQ-99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should be updated (REQ-01 found)');
    assert.deepStrictEqual(output.marked_complete, ['REQ-01']);
    assert.deepStrictEqual(output.not_found, ['REQ-99']);
    assert.strictEqual(output.total, 2, 'total should count both IDs');
  });

  test('already-checked requirement is not double-checked', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [x] **REQ-01** Auth\n- [ ] **REQ-02** Dash\n'
    );

    const result = runPanTools('requirements mark-complete REQ-01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // REQ-01 is already checked — the unchecked pattern won't match
    assert.deepStrictEqual(output.not_found, ['REQ-01'], 'already-checked should be not_found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete auto-commit + tag
// ─────────────────────────────────────────────────────────────────────────────

describe('milestone complete auto-commit', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = createTempProject();
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'pipe' });
    // Create state + roadmap for milestone
    fs.writeFileSync(path.join(gitDir, '.planning', 'state.md'), '---\nstatus: executing\n---\n**Status:** executing\n**Last Activity:** today\n**Last Activity Description:** work');
    fs.writeFileSync(path.join(gitDir, '.planning', 'roadmap.md'), '## Phase 01: Setup\n**Goal:** Go\n');
    const p1 = path.join(gitDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '---\nstatus: complete\n---\n# Done');
    fs.writeFileSync(path.join(gitDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(gitDir);
  });

  test('creates commit and tag on milestone complete', () => {
    const result = runPanTools('milestone complete v1.0 --name MVP', gitDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.ok(data.commit_hash, 'should include commit_hash');
    assert.strictEqual(data.tag, 'milestone-v1.0');
    // Verify tag exists
    const tags = execSync('git tag', { cwd: gitDir, encoding: 'utf-8' }).trim();
    assert.ok(tags.includes('milestone-v1.0'), 'tag should exist in git');
  });

  test('--no-commit skips commit and tag', () => {
    const result = runPanTools('milestone complete v1.0 --name MVP --no-commit', gitDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.commit_hash, undefined);
    assert.strictEqual(data.tag, undefined);
  });

  test('milestone complete in non-git dir works without commit', () => {
    const noGitDir = createTempProject();
    fs.writeFileSync(path.join(noGitDir, '.planning', 'state.md'), '---\nstatus: executing\n---\n**Status:** executing\n**Last Activity:** today\n**Last Activity Description:** work');
    fs.writeFileSync(path.join(noGitDir, '.planning', 'roadmap.md'), '## Phase 01: X\n**Goal:** Y\n');
    const result = runPanTools('milestone complete v2.0', noGitDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.commit_hash, undefined);
    cleanup(noGitDir);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate consistency command
// ─────────────────────────────────────────────────────────────────────────────

