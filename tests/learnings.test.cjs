/**
 * PAN Tools Tests - Session Learnings (extract, list, prune)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('learnings extract command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('extracts error resolutions from patterns.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'patterns.md'),
      '# Error Patterns\n\n### PAT-001: Import error\n**Wrong:** require("old")\n**Right:** require("new")\n**Date:** 2026-03-01\n\n### PAT-002: Path bug\n**Wrong:** path.join(a, b)\n**Right:** path.resolve(a, b)\n**Date:** 2026-03-02\n'
    );

    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.extracted, 2, 'should extract 2 error resolutions');
    assert.strictEqual(output.by_type['error-resolution'], 2);
    assert.strictEqual(output.total, 2);

    // Verify file was written
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'learnings.md'), 'utf-8');
    assert.ok(content.includes('LEARN-001'), 'should write LEARN-001');
    assert.ok(content.includes('LEARN-002'), 'should write LEARN-002');
    assert.ok(content.includes('error-resolution'), 'should tag as error-resolution');
  });

  test('extracts file co-change patterns from summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Create two summaries with overlapping key-files (co-change >= 2)
    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      '---\nphase: "01"\nname: "Setup"\none-liner: "First task"\nkey-files:\n  - src/core.js\n  - src/utils.js\n---\n# Summary\nDone.\n'
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-02-summary.md'),
      '---\nphase: "01"\nname: "Setup"\none-liner: "Second task"\nkey-files:\n  - src/core.js\n  - src/utils.js\n  - src/main.js\n---\n# Summary\nDone.\n'
    );

    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.by_type['co-change'] >= 1, 'should extract at least 1 co-change pattern');
    assert.ok(output.total >= 1, 'should have total learnings');
  });

  test('deduplicates existing learnings on re-extract', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'patterns.md'),
      '# Error Patterns\n\n### PAT-001: Bug fix\n**Wrong:** old\n**Right:** new\n**Date:** 2026-03-01\n'
    );

    // First extract
    runPanTools('learnings extract', tmpDir);

    // Second extract should not duplicate
    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.extracted, 0, 'should not extract duplicates');
    assert.strictEqual(output.total, 1, 'should still have 1 total');
  });

  test('handles empty project gracefully', () => {
    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.extracted, 0);
    assert.strictEqual(output.total, 0);
  });

  test('output has all expected fields', () => {
    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.extracted, 'number');
    assert.strictEqual(typeof output.total, 'number');
    assert.strictEqual(typeof output.by_type, 'object');
    assert.strictEqual(typeof output.by_type['error-resolution'], 'number');
    assert.strictEqual(typeof output.by_type['co-change'], 'number');
    assert.strictEqual(typeof output.by_type['pattern'], 'number');
  });
});

describe('learnings list command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('lists learnings from file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'learnings.md'),
      '# Session Learnings\n\n### LEARN-001: Import fix\n**Type:** error-resolution\n**Detail:** old -> new\n**Date:** 2026-03-01\n\n### LEARN-002: Co-change pattern\n**Type:** co-change\n**Detail:** a.js and b.js changed together 3 times\n**Files:** a.js, b.js\n**Date:** 2026-03-02\n'
    );

    const result = runPanTools('learnings list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 2, 'should list 2 learnings');
    assert.strictEqual(output.learnings.length, 2);
    assert.strictEqual(output.learnings[0].id, 'LEARN-001');
    assert.strictEqual(output.learnings[0].type, 'error-resolution');
    assert.strictEqual(output.learnings[1].id, 'LEARN-002');
    assert.strictEqual(output.learnings[1].type, 'co-change');
    assert.deepStrictEqual(output.learnings[1].files, ['a.js', 'b.js']);
  });

  test('returns empty list when no file exists', () => {
    const result = runPanTools('learnings list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0);
    assert.deepStrictEqual(output.learnings, []);
  });

  test('includes by_type breakdown', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'learnings.md'),
      '# Session Learnings\n\n### LEARN-001: Fix\n**Type:** error-resolution\n**Detail:** a -> b\n**Date:** 2026-03-01\n\n### LEARN-002: Fix2\n**Type:** error-resolution\n**Detail:** c -> d\n**Date:** 2026-03-01\n\n### LEARN-003: Pattern\n**Type:** pattern\n**Detail:** Use try-catch\n**Date:** 2026-03-02\n'
    );

    const result = runPanTools('learnings list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.by_type['error-resolution'], 2);
    assert.strictEqual(output.by_type['pattern'], 1);
  });
});

describe('learnings prune command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('prunes by ID', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'learnings.md'),
      '# Session Learnings\n\n### LEARN-001: Keep\n**Type:** pattern\n**Detail:** keep this\n**Date:** 2026-03-01\n\n### LEARN-002: Remove\n**Type:** pattern\n**Detail:** remove this\n**Date:** 2026-03-01\n'
    );

    const result = runPanTools('learnings prune --id LEARN-002', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.pruned, 1, 'should prune 1 entry');
    assert.strictEqual(output.remaining, 1);

    // Verify file was rewritten
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'learnings.md'), 'utf-8');
    assert.ok(content.includes('LEARN-001'), 'should keep LEARN-001');
    assert.ok(!content.includes('LEARN-002'), 'should remove LEARN-002');
  });

  test('prunes by age', () => {
    // Use a relative recent date so the test doesn't drift over time
    const recentDate = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'learnings.md'),
      `# Session Learnings\n\n### LEARN-001: Old\n**Type:** pattern\n**Detail:** old entry\n**Date:** 2020-01-01\n\n### LEARN-002: Recent\n**Type:** pattern\n**Detail:** recent entry\n**Date:** ${recentDate}\n`
    );

    const result = runPanTools('learnings prune --days 30', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.pruned, 1, 'should prune 1 old entry');
    assert.strictEqual(output.remaining, 1);
  });

  test('handles missing file gracefully', () => {
    const result = runPanTools('learnings prune --days 30', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.pruned, 0);
    assert.strictEqual(output.remaining, 0);
  });

  test('reports error when no prune criteria given', () => {
    const result = runPanTools('learnings prune', tmpDir);
    assert.ok(!result.success || result.error, 'should fail without criteria');
  });
});
