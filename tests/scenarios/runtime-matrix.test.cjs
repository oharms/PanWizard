/**
 * Runtime Matrix Scenario Tests
 *
 * For each of 5 runtimes: install → run generate-slug → run current-timestamp
 * → run state json from the INSTALLED path (not source). This validates that
 * pan-tools actually works from the installed location for every supported runtime.
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const { createScenarioRunner, RUNTIME_DIR } = require('../helpers.cjs');

const RUNTIMES = ['claude', 'opencode', 'gemini', 'codex', 'copilot'];

for (const runtime of RUNTIMES) {
  describe(`Runtime: ${runtime}`, () => {
    let runner;

    test('installs successfully', () => {
      runner = createScenarioRunner(runtime);
      assert.ok(runner.tmpDir, 'tmpDir should exist');
      assert.ok(runner.installedToolsPath, 'installedToolsPath should exist');
      assert.equal(runner.configDir, RUNTIME_DIR[runtime]);
    });

    test('runs generate-slug from installed path', () => {
      assert.ok(runner, 'runner must be initialized');
      const result = runner.run('generate-slug test-phase');
      assert.ok(result.success, `generate-slug failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.ok(parsed.slug, 'slug field should exist');
      assert.equal(parsed.slug, 'test-phase');
    });

    test('runs current-timestamp from installed path', () => {
      assert.ok(runner, 'runner must be initialized');
      const result = runner.run('current-timestamp');
      assert.ok(result.success, `current-timestamp failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.ok(parsed.timestamp, 'timestamp field should exist');
      assert.match(parsed.timestamp, /^\d{4}-\d{2}-\d{2}T/, 'timestamp should be ISO format');
    });

    test('runs state json from installed path', () => {
      assert.ok(runner, 'runner must be initialized');
      const result = runner.run('state json');
      // state json returns error when no state.md exists, but it should
      // still produce valid JSON output (not crash)
      const parsed = JSON.parse(result.output);
      assert.ok(parsed.error || parsed.state, 'should return error or state');
    });

    test('runs config-ensure-section from installed path', () => {
      assert.ok(runner, 'runner must be initialized');
      const result = runner.run('config-ensure-section');
      assert.ok(result.success, `config-ensure-section failed: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.ok('created' in parsed || 'exists' in parsed || 'ensured' in parsed,
        'should return config section status');
    });

    after(() => {
      if (runner) runner.cleanup();
    });
  });
}
