/**
 * PAN Tools Tests - Dependency Validation
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('deps validate command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('valid when roadmap matches disk directories', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n## Phase 01: Setup\n**Goal:** Initialize\n\n## Phase 02: Core\n**Goal:** Build core\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-core'), { recursive: true });

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.roadmap_phases, 2);
    assert.strictEqual(output.disk_phases, 2);
    assert.strictEqual(output.missing_phases.length, 0);
    assert.strictEqual(output.orphaned_dirs.length, 0);
  });

  test('detects phantom phases (in roadmap but not on disk)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n## Phase 01: Setup\n**Goal:** Initialize\n\n## Phase 02: Core\n**Goal:** Build\n\n## Phase 03: Deploy\n**Goal:** Ship\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    // Phase 02 and 03 directories missing

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid when phases missing from disk');
    assert.strictEqual(output.missing_phases.length, 2, 'should detect 2 missing phases');
    assert.ok(output.missing_phases.some(p => p.number === '02'), 'should detect phase 02 missing');
    assert.ok(output.missing_phases.some(p => p.number === '03'), 'should detect phase 03 missing');
  });

  test('detects orphaned directories (on disk but not in roadmap)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n## Phase 01: Setup\n**Goal:** Initialize\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-orphan'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-extra'), { recursive: true });

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.orphaned_dirs.length, 2);
    assert.ok(output.orphaned_dirs.some(d => d.number === '02'), 'should detect 02-orphan');
    assert.ok(output.orphaned_dirs.some(d => d.number === '03'), 'should detect 03-extra');
  });

  test('detects orphaned requirements (not completed and not traced)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n## Phase 01: Setup\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [x] **REQ-01** User login\n- [ ] **REQ-02** Dashboard\n- [ ] **REQ-03** API layer\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    // REQ-02 is mentioned in a summary, REQ-03 is not mentioned anywhere
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '01-setup', '01-01-summary.md'),
      '---\none-liner: Built dashboard\n---\n# Summary\nImplemented REQ-02 dashboard feature.\n'
    );

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.requirements_total, 3);
    assert.strictEqual(output.requirements_completed, 1, 'REQ-01 is completed');
    assert.strictEqual(output.orphaned_reqs.length, 1, 'REQ-03 should be orphaned');
    assert.ok(output.orphaned_reqs.includes('REQ-03'), 'should identify REQ-03 as orphaned');
  });

  test('handles missing roadmap gracefully', () => {
    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'should be valid (no errors, just warnings)');
    assert.ok(output.issues.some(i => i.message.includes('roadmap.md not found')), 'should warn about missing roadmap');
    assert.strictEqual(output.roadmap_phases, 0);
  });

  test('handles empty project gracefully', () => {
    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true);
    assert.strictEqual(output.orphaned_reqs.length, 0);
    assert.strictEqual(output.missing_phases.length, 0);
    assert.strictEqual(output.orphaned_dirs.length, 0);
  });

  test('all completed requirements are not orphaned', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [x] **REQ-01** Login\n- [x] **REQ-02** Dashboard\n'
    );

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.requirements_total, 2);
    assert.strictEqual(output.requirements_completed, 2);
    assert.strictEqual(output.orphaned_reqs.length, 0, 'completed reqs should not be orphaned');
  });

  test('output has all expected fields', () => {
    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.valid, 'boolean');
    assert.ok(Array.isArray(output.issues));
    assert.strictEqual(typeof output.roadmap_phases, 'number');
    assert.strictEqual(typeof output.disk_phases, 'number');
    assert.strictEqual(typeof output.requirements_total, 'number');
    assert.strictEqual(typeof output.requirements_completed, 'number');
    assert.ok(Array.isArray(output.orphaned_reqs));
    assert.ok(Array.isArray(output.missing_phases));
    assert.ok(Array.isArray(output.orphaned_dirs));
  });
});
