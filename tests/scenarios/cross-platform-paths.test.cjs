/**
 * Cross-Platform Path Scenario Tests
 *
 * Verify JSON output paths use forward slashes and no absolute paths leak.
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner } = require('../helpers.cjs');

describe('Cross-platform paths in JSON output', () => {
  let runner;

  before(() => {
    runner = createScenarioRunner('claude');
    const planDir = path.join(runner.tmpDir, '.planning');
    fs.mkdirSync(path.join(planDir, 'phases'), { recursive: true });

    fs.writeFileSync(path.join(planDir, 'roadmap.md'), [
      '# Roadmap',
      '',
      '## Phases',
      '',
      '| # | Phase | Status | Progress |',
      '|---|-------|--------|----------|',
      '',
    ].join('\n'));

    fs.writeFileSync(path.join(planDir, 'state.md'), [
      '# Project State',
      '',
      '**Status:** Active',
      '**Last Activity:** 2026-01-01',
      '**Last Activity Description:** setup',
      '',
      '## Decisions',
      '',
      '## Blockers',
      '',
    ].join('\n'));
  });

  after(() => {
    if (runner) runner.cleanup();
  });

  test('phase add output paths use forward slashes', () => {
    const result = runner.run('phase add path-test');
    assert.ok(result.success, `phase add failed: ${result.error}`);
    const output = result.output;
    // No backslash paths in JSON output
    assert.ok(!output.includes('\\\\'), 'output should not contain backslash paths');
  });

  test('phases list output paths use forward slashes', () => {
    const result = runner.run('phases list');
    assert.ok(result.success, `phases list failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    if (parsed.directories) {
      for (const dir of parsed.directories) {
        const dirStr = typeof dir === 'string' ? dir : (dir.path || dir.directory || '');
        if (dirStr) {
          assert.ok(!dirStr.includes('\\'),
            `directory path should use forward slashes: ${dirStr}`);
        }
      }
    }
  });

  test('validate health output has no absolute paths', () => {
    const result = runner.run('validate health');
    assert.ok(result.success, `validate health failed: ${result.error}`);
    const output = result.output;
    // Should not contain user temp directory in output
    assert.ok(!output.includes(runner.tmpDir.replace(/\\/g, '\\\\')),
      'output should not leak absolute paths');
  });

  test('config-ensure-section output has no absolute paths', () => {
    const result = runner.run('config-ensure-section');
    assert.ok(result.success, `config-ensure-section failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    const outputStr = JSON.stringify(parsed);
    // Check no home directory or temp path leaked
    const homeDir = require('os').homedir();
    assert.ok(!outputStr.includes(homeDir),
      'output should not contain home directory path');
  });

  test('generate-slug output is clean (no path content)', () => {
    const result = runner.run('generate-slug test-cross-platform');
    assert.ok(result.success, `generate-slug failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.equal(parsed.slug, 'test-cross-platform');
    assert.ok(!parsed.slug.includes('\\'), 'slug should not contain backslashes');
    assert.ok(!parsed.slug.includes('/'), 'slug should not contain forward slashes');
  });
});
