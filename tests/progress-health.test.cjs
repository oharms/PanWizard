/**
 * PAN Tools Tests - Enhanced Progress Health (patterns_count, session_count)
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

function setupBasicProject(tmpDir) {
  const planningDir = path.join(tmpDir, '.planning');
  fs.writeFileSync(path.join(planningDir, 'project.md'), '# Project\n');
  fs.writeFileSync(path.join(planningDir, 'roadmap.md'), '# Roadmap v1.0 MVP\n');
  fs.writeFileSync(path.join(planningDir, 'state.md'), '# State\n');
  fs.writeFileSync(path.join(planningDir, 'config.json'), JSON.stringify({ model_profile: 'balanced' }));
  fs.mkdirSync(path.join(planningDir, 'phases', '01-setup'), { recursive: true });
  // Add a plan file so there's something to measure
  fs.writeFileSync(path.join(planningDir, 'phases', '01-setup', '01-01-plan.md'), '---\nphase: "01"\nplan: "01"\ntype: execute\nwave: 1\ndepends_on: []\nfiles_modified: ["a.cjs"]\nautonomous: true\n---\n# Plan 01');
}

describe('progress health enhanced output', () => {
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('no patterns.md → patterns_count: 0', () => {
    setupBasicProject(tmpDir);
    const result = runPanTools('progress health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.patterns_count, 0);
  });

  test('patterns.md with 3 entries → patterns_count: 3', () => {
    setupBasicProject(tmpDir);
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

    const result = runPanTools('progress health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.patterns_count, 3);
  });

  test('no session-history.md → session_count: 0', () => {
    setupBasicProject(tmpDir);
    const result = runPanTools('progress health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.session_count, 0);
  });

  test('session-history.md with 5 entries → session_count: 5', () => {
    setupBasicProject(tmpDir);
    let content = '# Session History\n\n';
    for (let i = 1; i <= 5; i++) {
      content += `### Session — 2026-01-${String(i).padStart(2, '0')}\n- **Phase:** ${String(i).padStart(2, '0')}\n\n`;
    }
    fs.writeFileSync(path.join(tmpDir, '.planning', 'session-history.md'), content);

    const result = runPanTools('progress health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.session_count, 5);
  });

  test('health output includes all new fields alongside existing fields', () => {
    setupBasicProject(tmpDir);
    const result = runPanTools('progress health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // Existing fields
    assert.ok('grade' in out, 'should have grade');
    assert.ok('composite' in out, 'should have composite');
    assert.ok('progress' in out, 'should have progress');
    assert.ok('context' in out, 'should have context');
    assert.ok('staleness' in out, 'should have staleness');
    // New fields
    assert.ok('patterns_count' in out, 'should have patterns_count');
    assert.ok('session_count' in out, 'should have session_count');
  });

  test('non-health format (table) → no patterns_count or session_count', () => {
    setupBasicProject(tmpDir);
    const result = runPanTools('progress table', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    // Table format returns { rendered: "..." }
    assert.ok('rendered' in out, 'table should have rendered field');
    assert.ok(!('patterns_count' in out), 'table should not have patterns_count');
    assert.ok(!('session_count' in out), 'table should not have session_count');
  });

  test('non-health format (json) → no patterns_count or session_count', () => {
    setupBasicProject(tmpDir);
    const result = runPanTools('progress json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok('phases' in out, 'json should have phases');
    assert.ok(!('patterns_count' in out), 'json should not have patterns_count');
  });
});
