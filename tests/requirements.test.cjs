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
    // Exit 1: REQ-01 was not marked complete anywhere. The test name already called
    // this an error; the exit code now agrees with it.
    assert.equal(result.success, false, 'no requirement was marked complete');

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

// PAN-03 (3.42.0): the Status column is found by its header. The old pattern
// assumed `| ID | Phase | Status |` and reported updated:true from the checkbox
// while a 5-column table stayed Pending.
describe('requirements mark-complete: traceability table by header (PAN-03)', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  const reqFile = () => path.join(tmpDir, '.planning', 'requirements.md');
  const mark = (ids) => {
    const r = runPanTools(`requirements mark-complete ${ids}`, tmpDir);
    assert.ok(r.success, r.error);
    return JSON.parse(r.output);
  };

  test('3-column table: table_updated is reported', () => {
    fs.writeFileSync(reqFile(), REQUIREMENTS_FIXTURE);
    const out = mark('REQ-01');
    assert.strictEqual(out.table_updated, true);
    assert.deepStrictEqual(out.table_marked, ['REQ-01']);
    assert.ok(fs.readFileSync(reqFile(), 'utf-8').includes('| REQ-01 | Phase 1 | Complete |'));
  });

  test('5-column table with Status in column 4: that cell changes, padding kept', () => {
    fs.writeFileSync(reqFile(), [
      '- [ ] **AUTH-01** login',
      '',
      '| Requirement | Description | Phase | Status      | Notes |',
      '|-------------|-------------|-------|-------------|-------|',
      '| AUTH-01     | Login       | 2     | Pending     | n/a   |',
      '| AUTH-02     | Logout      | 2     | Pending     | n/a   |',
      '',
    ].join('\n'));
    const out = mark('AUTH-01');
    assert.strictEqual(out.table_updated, true);
    const text = fs.readFileSync(reqFile(), 'utf-8');
    assert.ok(text.includes('| AUTH-01     | Login       | 2     | Complete    | n/a   |'), text);
    assert.ok(text.includes('| AUTH-02     | Logout      | 2     | Pending     | n/a   |'));
  });

  test('Status as the last column, an upper-case STATUS header and an In Progress value', () => {
    fs.writeFileSync(reqFile(), [
      '| ID | Phase | Owner | STATUS |',
      '|---|---|---|---|',
      '| R-1 | 1 | ana | In Progress |',
      '',
    ].join('\n'));
    const out = mark('R-1');
    assert.strictEqual(out.updated, true);
    assert.strictEqual(out.table_updated, true);
    // The cell keeps its width: "In Progress" was wider than "Complete".
    assert.ok(fs.readFileSync(reqFile(), 'utf-8').includes('| R-1 | 1 | ana | Complete    |'));
  });

  test('an ID listed in two tables is marked in both', () => {
    fs.writeFileSync(reqFile(), [
      '| ID | Phase | Status |',
      '|---|---|---|',
      '| R-1 | 1 | Pending |',
      '',
      '## v2',
      '',
      '| Phase | Req | Status | Note |',
      '|---|---|---|---|',
      '| 1 | R-1 | Pending | x |',
      '',
    ].join('\n'));
    mark('R-1');
    const text = fs.readFileSync(reqFile(), 'utf-8');
    assert.ok(text.includes('| R-1 | 1 | Complete |'));
    assert.ok(text.includes('| 1 | R-1 | Complete | x |'));
  });

  test('a table with no Status column is left unchanged and warned about', () => {
    const body = [
      '- [ ] **R-1** thing',
      '',
      '| ID | Phase | Notes |',
      '|---|---|---|',
      '| R-1 | 1 | Pending review |',
      '',
    ].join('\n');
    fs.writeFileSync(reqFile(), body);
    const out = mark('R-1');
    assert.strictEqual(out.updated, true, 'the checkbox was checked');
    assert.strictEqual(out.table_updated, false);
    assert.ok(out.warnings.some((w) => /no Status column/.test(w)), JSON.stringify(out));
    assert.strictEqual(fs.readFileSync(reqFile(), 'utf-8'), body.replace('- [ ] **R-1**', '- [x] **R-1**'));
  });

  test('a checked requirement with no table row is warned about', () => {
    fs.writeFileSync(reqFile(), REQUIREMENTS_FIXTURE.replace('- [ ] **REQ-02** User logout', '- [ ] **REQ-02** User logout\n- [ ] **REQ-04** Export'));
    const out = mark('REQ-04');
    assert.strictEqual(out.updated, true);
    assert.strictEqual(out.table_updated, false);
    assert.ok(out.warnings.some((w) => /REQ-04.*no traceability table row/.test(w)));
  });

  test('CRLF requirements keep their line endings', () => {
    fs.writeFileSync(reqFile(), REQUIREMENTS_FIXTURE.replace(/\n/g, '\r\n'));
    mark('REQ-01');
    const text = fs.readFileSync(reqFile(), 'utf-8');
    assert.ok(text.includes('| REQ-01 | Phase 1 | Complete |\r\n'));
    assert.ok(!/[^\r]\n/.test(text), 'no bare LF introduced');
  });
});
