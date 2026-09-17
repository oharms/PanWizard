/**
 * Runtime Matrix Scenario Tests
 *
 * For each of 5 runtimes: install → run generate-slug → run current-timestamp
 * → run state json from the INSTALLED path (not source). This validates that
 * pan-tools actually works from the installed location for every supported runtime.
 */

const { describe, test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
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
      // Measured 2026-09-17: a freshly installed project has no .planning/, and
      // `state json` reports that as a JSON error body on stdout with exit 1.
      // (`parsed.error || parsed.state` passed on the error branch alone, and
      // `state` is not even a field this verb emits.)
      const missing = runner.run('state json');
      assert.equal(missing.success, false, 'no state.md must exit non-zero');
      assert.deepEqual(JSON.parse(missing.output), { error: 'state.md not found' });

      // Positive pin: the installed engine reads a real state.md from the cwd it
      // is handed and returns its frontmatter (not just the error branch).
      const seeded = fs.mkdtempSync(path.join(os.tmpdir(), `pan-state-${runtime}-`));
      try {
        fs.mkdirSync(path.join(seeded, '.planning'), { recursive: true });
        fs.writeFileSync(path.join(seeded, '.planning', 'state.md'), [
          '---', 'pan_state_version: "1.0"', 'Status: In progress', 'Milestone: v9.9', '---', '',
        ].join('\n'));
        const ok = runner.run('state json', seeded);
        assert.equal(ok.success, true, `state json should exit 0 on a seeded project: ${ok.error}`);
        assert.deepEqual(JSON.parse(ok.output), {
          pan_state_version: '1.0', Status: 'In progress', Milestone: 'v9.9',
        });
      } finally {
        fs.rmSync(seeded, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
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
