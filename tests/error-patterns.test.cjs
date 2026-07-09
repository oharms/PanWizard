/**
 * PAN Tools Tests - Error Pattern Read/Write (readErrorPatterns, appendErrorPattern)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readErrorPatterns, appendErrorPattern } = require('../pan-wizard-core/bin/lib/commands.cjs');

function createTempDir() {
  const tmpDir = path.join(require('os').tmpdir(), 'pan-pat-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));
  fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  return tmpDir;
}

function cleanup(tmpDir) {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
}

describe('readErrorPatterns', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanup(tmpDir); });

  test('file does not exist → empty array', () => {
    const result = readErrorPatterns(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('file exists but empty → empty array', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), '');
    const result = readErrorPatterns(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('file with only header, no patterns → empty array', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), '# Error Patterns\n\nNo patterns yet.');
    const result = readErrorPatterns(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('single PAT entry → parsed with all fields', () => {
    const content = `# Error Patterns

### PAT-001: Path double-join
**Wrong:** Used PLANNING_DIR + PHASES_DIR + phaseInfo.directory
**Right:** Used phaseInfo.directory directly (already contains full path)
**Context:** init.cjs cmdInitExecutePhase
**Date:** 2026-03-01
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), content);
    const result = readErrorPatterns(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].id, 'PAT-001');
    assert.strictEqual(result[0].title, 'Path double-join');
    assert.strictEqual(result[0].wrong, 'Used PLANNING_DIR + PHASES_DIR + phaseInfo.directory');
    assert.strictEqual(result[0].right, 'Used phaseInfo.directory directly (already contains full path)');
    assert.strictEqual(result[0].context, 'init.cjs cmdInitExecutePhase');
    assert.strictEqual(result[0].date, '2026-03-01');
  });

  test('multiple PAT entries → all parsed', () => {
    const content = `# Error Patterns

### PAT-001: First
**Wrong:** Bad thing 1
**Right:** Good thing 1
**Date:** 2026-01-01

### PAT-002: Second
**Wrong:** Bad thing 2
**Right:** Good thing 2
**Context:** Some context
**Date:** 2026-02-01
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), content);
    const result = readErrorPatterns(tmpDir);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'PAT-001');
    assert.strictEqual(result[1].id, 'PAT-002');
    assert.strictEqual(result[1].context, 'Some context');
  });

  test('malformed entry missing "Right:" → skipped', () => {
    const content = `# Error Patterns

### PAT-001: Good entry
**Wrong:** Bad
**Right:** Good
**Date:** 2026-01-01

### PAT-002: Malformed
**Wrong:** Something bad
No right field here

### PAT-003: Another good entry
**Wrong:** Also bad
**Right:** Also good
**Date:** 2026-02-01
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), content);
    const result = readErrorPatterns(tmpDir);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'PAT-001');
    assert.strictEqual(result[1].id, 'PAT-003');
  });

  test('entry without date → date defaults to null', () => {
    const content = `# Error Patterns

### PAT-001: No date
**Wrong:** Bad
**Right:** Good
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), content);
    const result = readErrorPatterns(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].date, null);
  });

  test('entry without context → context is null', () => {
    const content = `# Error Patterns

### PAT-001: No context
**Wrong:** Bad
**Right:** Good
**Date:** 2026-01-01
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), content);
    const result = readErrorPatterns(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].context, null);
  });
});

describe('appendErrorPattern', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanup(tmpDir); });

  test('file does not exist → creates with PAT-001', () => {
    const result = appendErrorPattern(tmpDir, { wrong: 'Bad', right: 'Good', title: 'First' });
    assert.strictEqual(result.id, 'PAT-001');
    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns.length, 1);
    assert.strictEqual(patterns[0].id, 'PAT-001');
    assert.strictEqual(patterns[0].wrong, 'Bad');
    assert.strictEqual(patterns[0].right, 'Good');
  });

  test('file exists with PAT-003 → appends PAT-004', () => {
    const content = `# Error Patterns

### PAT-001: First
**Wrong:** A
**Right:** B
**Date:** 2026-01-01

### PAT-002: Second
**Wrong:** C
**Right:** D
**Date:** 2026-01-02

### PAT-003: Third
**Wrong:** E
**Right:** F
**Date:** 2026-01-03
`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'), content);
    const result = appendErrorPattern(tmpDir, { wrong: 'G', right: 'H', title: 'Fourth' });
    assert.strictEqual(result.id, 'PAT-004');
    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns.length, 4);
    assert.strictEqual(patterns[3].id, 'PAT-004');
  });

  test('pattern includes context → written', () => {
    const result = appendErrorPattern(tmpDir, { wrong: 'Bad', right: 'Good', context: 'In some file', title: 'Ctx' });
    assert.strictEqual(result.id, 'PAT-001');
    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns[0].context, 'In some file');
  });

  test('pattern includes date → written; missing date → uses today', () => {
    const result1 = appendErrorPattern(tmpDir, { wrong: 'A', right: 'B', title: 'Custom date', date: '2025-12-25' });
    assert.strictEqual(result1.id, 'PAT-001');
    const patterns1 = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns1[0].date, '2025-12-25');

    const result2 = appendErrorPattern(tmpDir, { wrong: 'C', right: 'D', title: 'Auto date' });
    assert.strictEqual(result2.id, 'PAT-002');
    const patterns2 = readErrorPatterns(tmpDir);
    assert.ok(patterns2[1].date, 'should have a date');
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(patterns2[1].date), 'should be ISO date format');
  });

  test('empty pattern object → error', () => {
    const result = appendErrorPattern(tmpDir, {});
    assert.ok(result.error);
    assert.ok(result.error.includes("'wrong' and 'right'"));
  });

  test('null pattern → error', () => {
    const result = appendErrorPattern(tmpDir, null);
    assert.ok(result.error);
    assert.ok(result.error.includes("'wrong' and 'right'"));
  });

  test('pattern missing wrong → error', () => {
    const result = appendErrorPattern(tmpDir, { right: 'Good' });
    assert.ok(result.error);
  });

  test('pattern missing right → error', () => {
    const result = appendErrorPattern(tmpDir, { wrong: 'Bad' });
    assert.ok(result.error);
  });

  test('read existing + append → does not corrupt existing entries', () => {
    appendErrorPattern(tmpDir, { wrong: 'A', right: 'B', title: 'One', date: '2026-01-01' });
    appendErrorPattern(tmpDir, { wrong: 'C', right: 'D', title: 'Two', date: '2026-01-02' });
    appendErrorPattern(tmpDir, { wrong: 'E', right: 'F', title: 'Three', date: '2026-01-03' });
    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns.length, 3);
    assert.strictEqual(patterns[0].wrong, 'A');
    assert.strictEqual(patterns[1].wrong, 'C');
    assert.strictEqual(patterns[2].wrong, 'E');
    assert.strictEqual(patterns[0].id, 'PAT-001');
    assert.strictEqual(patterns[1].id, 'PAT-002');
    assert.strictEqual(patterns[2].id, 'PAT-003');
  });

  test('title defaults to Untitled if not provided', () => {
    appendErrorPattern(tmpDir, { wrong: 'X', right: 'Y' });
    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns[0].title, 'Untitled');
  });
});
