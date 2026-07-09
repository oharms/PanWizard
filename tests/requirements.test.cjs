/**
 * PAN Tools Tests - Requirements mark-complete command
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const REQUIREMENTS_FIXTURE = `# Requirements

## Functional Requirements
- [ ] **REQ-01** User login
- [ ] **REQ-02** User logout
- [x] **REQ-03** Dashboard view

## Traceability
| ID | Phase | Status |
|----|-------|--------|
| REQ-01 | Phase 1 | Pending |
| REQ-02 | Phase 2 | Pending |
| REQ-03 | Phase 1 | Complete |
`;

describe('requirements mark-complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('marks single requirement complete in checkbox', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    const result = runPanTools('requirements mark-complete REQ-01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    assert.ok(
      content.includes('- [x] **REQ-01** User login'),
      'REQ-01 checkbox should be checked'
    );
    // REQ-02 should remain unchecked
    assert.ok(
      content.includes('- [ ] **REQ-02** User logout'),
      'REQ-02 checkbox should remain unchecked'
    );
    // REQ-03 was already checked, should stay checked
    assert.ok(
      content.includes('- [x] **REQ-03** Dashboard view'),
      'REQ-03 checkbox should remain checked'
    );
  });

  test('marks single requirement complete in traceability table', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    const result = runPanTools('requirements mark-complete REQ-01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.marked_complete, ['REQ-01']);
    assert.deepStrictEqual(output.not_found, []);
    assert.strictEqual(output.updated, true);
    assert.strictEqual(output.total, 1);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    // REQ-01 table row should now say Complete
    assert.ok(
      content.includes('| REQ-01 | Phase 1 | Complete |'),
      'REQ-01 traceability status should be Complete'
    );
    // REQ-02 should remain Pending
    assert.ok(
      content.includes('| REQ-02 | Phase 2 | Pending |'),
      'REQ-02 traceability status should remain Pending'
    );
  });

  test('marks multiple requirements comma-separated', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    const result = runPanTools('requirements mark-complete REQ-01,REQ-02', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.marked_complete, ['REQ-01', 'REQ-02']);
    assert.strictEqual(output.total, 2);
    assert.strictEqual(output.updated, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    assert.ok(
      content.includes('- [x] **REQ-01** User login'),
      'REQ-01 checkbox should be checked'
    );
    assert.ok(
      content.includes('- [x] **REQ-02** User logout'),
      'REQ-02 checkbox should be checked'
    );
    assert.ok(
      content.includes('| REQ-01 | Phase 1 | Complete |'),
      'REQ-01 table status should be Complete'
    );
    assert.ok(
      content.includes('| REQ-02 | Phase 2 | Complete |'),
      'REQ-02 table status should be Complete'
    );
  });

  test('marks multiple requirements space-separated', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    const result = runPanTools('requirements mark-complete REQ-01 REQ-02', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.marked_complete, ['REQ-01', 'REQ-02']);
    assert.strictEqual(output.total, 2);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    assert.ok(
      content.includes('- [x] **REQ-01** User login'),
      'REQ-01 checkbox should be checked'
    );
    assert.ok(
      content.includes('- [x] **REQ-02** User logout'),
      'REQ-02 checkbox should be checked'
    );
  });

  test('handles bracket-wrapped IDs', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    // Brackets are passed as a single argument string
    const result = runPanTools('requirements mark-complete [REQ-01,REQ-02]', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.marked_complete, ['REQ-01', 'REQ-02']);
    assert.strictEqual(output.total, 2);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    assert.ok(
      content.includes('- [x] **REQ-01** User login'),
      'REQ-01 should be marked complete after bracket parsing'
    );
    assert.ok(
      content.includes('- [x] **REQ-02** User logout'),
      'REQ-02 should be marked complete after bracket parsing'
    );
  });

  test('reports not-found for missing IDs', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    const result = runPanTools('requirements mark-complete REQ-99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.marked_complete, []);
    assert.deepStrictEqual(output.not_found, ['REQ-99']);
    assert.strictEqual(output.updated, false);
    assert.strictEqual(output.total, 1);

    // File should not be modified
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    assert.strictEqual(content, REQUIREMENTS_FIXTURE, 'file should not be modified when no IDs found');
  });

  test('mixed found and not-found IDs', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    const result = runPanTools('requirements mark-complete REQ-01,REQ-99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.marked_complete, ['REQ-01']);
    assert.deepStrictEqual(output.not_found, ['REQ-99']);
    assert.strictEqual(output.updated, true);
    assert.strictEqual(output.total, 2);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      'utf-8'
    );
    assert.ok(
      content.includes('- [x] **REQ-01** User login'),
      'REQ-01 should be marked complete'
    );
  });

  test('returns error when requirements.md missing', () => {
    // Do not create requirements.md — only .planning/ exists from createTempProject
    const result = runPanTools('requirements mark-complete REQ-01', tmpDir);
    assert.ok(result.success, `Command should succeed with missing file: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, false);
    assert.strictEqual(output.reason, 'requirements.md not found');
  });

  test('returns error when no IDs provided', () => {
    const result = runPanTools('requirements mark-complete', tmpDir);
    assert.ok(!result.success, 'command should fail with no IDs');
    assert.ok(
      result.error.includes('requirement IDs required'),
      `error should mention missing IDs, got: ${result.error}`
    );
  });

  test('does not re-check already checked requirement', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      REQUIREMENTS_FIXTURE
    );

    // REQ-03 is already checked in the fixture
    const result = runPanTools('requirements mark-complete REQ-03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // REQ-03 checkbox is already [x], so the checkbox regex won't match [ ]
    // REQ-03 table status is already Complete, so the table regex won't match Pending
    // Therefore it should appear in not_found
    assert.deepStrictEqual(output.not_found, ['REQ-03']);
    assert.strictEqual(output.updated, false);
  });
});
