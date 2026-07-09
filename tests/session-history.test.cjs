/**
 * PAN Tools Tests - Session Summary (appendSessionSummary)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers.cjs');
const { appendSessionSummary } = require('../pan-wizard-core/bin/lib/commands.cjs');

describe('appendSessionSummary', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('file does not exist → creates with header + entry', () => {
    const result = appendSessionSummary(tmpDir, { phase: '01', date: '2026-03-01' });
    assert.deepStrictEqual(result, { appended: true });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    assert.ok(content.includes('# Session History'));
    assert.ok(content.includes('### Session — 2026-03-01'));
    assert.ok(content.includes('**Phase:** 01'));
  });

  test('file exists → appends new entry at end', () => {
    const existing = '# Session History\n\n### Session — 2026-02-28\n- **Phase:** 01\n';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'session-history.md'), existing);
    const result = appendSessionSummary(tmpDir, { phase: '02', date: '2026-03-01' });
    assert.deepStrictEqual(result, { appended: true });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    assert.ok(content.includes('### Session — 2026-02-28'));
    assert.ok(content.includes('### Session — 2026-03-01'));
    assert.ok(content.includes('**Phase:** 02'));
  });

  test('entry includes all optional fields', () => {
    const result = appendSessionSummary(tmpDir, {
      phase: '03',
      plans_executed: 5,
      tests_before: 674,
      tests_after: 700,
      key_decisions: 'Added tier classification',
      date: '2026-03-01',
    });
    assert.deepStrictEqual(result, { appended: true });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    assert.ok(content.includes('**Phase:** 03'));
    assert.ok(content.includes('**Plans Executed:** 5'));
    assert.ok(content.includes('**Tests Before:** 674'));
    assert.ok(content.includes('**Tests After:** 700'));
    assert.ok(content.includes('**Key Decisions:** Added tier classification'));
  });

  test('file with 20 entries → appends 21st, trims oldest', () => {
    let content = '# Session History\n\n';
    for (let i = 1; i <= 20; i++) {
      content += `### Session — 2026-01-${String(i).padStart(2, '0')}\n- **Phase:** ${String(i).padStart(2, '0')}\n\n`;
    }
    fs.writeFileSync(path.join(tmpDir, '.planning', 'session-history.md'), content);

    const result = appendSessionSummary(tmpDir, { phase: '21', date: '2026-02-01' });
    assert.deepStrictEqual(result, { appended: true });

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    // Should not contain the first session (01)
    assert.ok(!updated.includes('**Phase:** 01\n'), 'oldest session should be trimmed');
    // Should contain the newest
    assert.ok(updated.includes('**Phase:** 21'));
    // Count session headers
    const headerCount = (updated.match(/### Session — /g) || []).length;
    assert.strictEqual(headerCount, 20, 'should keep exactly 20 entries');
  });

  test('file with 19 entries → appends 20th, no trim', () => {
    let content = '# Session History\n\n';
    for (let i = 1; i <= 19; i++) {
      content += `### Session — 2026-01-${String(i).padStart(2, '0')}\n- **Phase:** ${String(i).padStart(2, '0')}\n\n`;
    }
    fs.writeFileSync(path.join(tmpDir, '.planning', 'session-history.md'), content);

    appendSessionSummary(tmpDir, { phase: '20', date: '2026-02-01' });

    const updated = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    const headerCount = (updated.match(/### Session — /g) || []).length;
    assert.strictEqual(headerCount, 20, 'should have exactly 20 entries');
    // First entry should still be there
    assert.ok(updated.includes('2026-01-01'));
  });

  test('empty summary → error', () => {
    const result = appendSessionSummary(tmpDir, {});
    assert.ok(result.error);
    assert.ok(result.error.includes("'phase'"));
  });

  test('null summary → error', () => {
    const result = appendSessionSummary(tmpDir, null);
    assert.ok(result.error);
    assert.ok(result.error.includes("'phase'"));
  });

  test('missing date → uses today', () => {
    const result = appendSessionSummary(tmpDir, { phase: '01' });
    assert.deepStrictEqual(result, { appended: true });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    // Should contain today's date
    const today = new Date().toISOString().split('T')[0];
    assert.ok(content.includes(`### Session — ${today}`), 'should use today as default date');
  });

  test('after write, file contains well-formatted markdown', () => {
    appendSessionSummary(tmpDir, { phase: '05', plans_executed: 3, date: '2026-03-01' });
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8');
    assert.ok(content.startsWith('# Session History'));
    assert.ok(content.includes('### Session — 2026-03-01'));
    assert.ok(content.includes('- **Phase:** 05'));
    assert.ok(content.includes('- **Plans Executed:** 3'));
  });
});
