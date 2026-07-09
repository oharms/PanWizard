/**
 * Scenario: learnings/universal/ ships to all 5 runtimes; learnings/internal/ does NOT.
 *
 * Spec: docs/specs/self_improvement_loop_featureai.md §3.6 + §3.7
 * v3.7.0 W4 — verifies the two-tier delivery model.
 *
 * Negative assertion is critical: if `learnings/internal/` ever ships, PAN-internal
 * patterns leak into user installs as universal advice. Tests fail loudly if so.
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner, RUNTIME_DIR } = require('../helpers.cjs');

const RUNTIMES = ['claude', 'codex', 'gemini', 'opencode', 'copilot'];

for (const runtime of RUNTIMES) {
  describe(`learnings two-tier shipping for ${runtime}`, () => {
    let runner;
    let installedCore;

    before(() => {
      runner = createScenarioRunner(runtime);
      const configDir = RUNTIME_DIR[runtime];
      installedCore = path.join(runner.tmpDir, configDir, 'pan-wizard-core');
    });

    after(() => {
      if (runner) runner.cleanup();
    });

    test('learnings/universal/ directory exists in install', () => {
      const universalDir = path.join(installedCore, 'learnings', 'universal');
      assert.ok(fs.existsSync(universalDir),
        `${runtime}: learnings/universal/ should ship to ${universalDir}`);
    });

    test('learnings/internal/ is NOT shipped to installs', () => {
      const internalDir = path.join(installedCore, 'learnings', 'internal');
      assert.ok(!fs.existsSync(internalDir),
        `${runtime}: learnings/internal/ MUST NOT ship — found at ${internalDir}. ` +
        `This tier is source-only; check installer two-tier guard in bin/install.js.`);
    });

    test('learnings/README.md ships (explains the tier split)', () => {
      const readme = path.join(installedCore, 'learnings', 'README.md');
      assert.ok(fs.existsSync(readme),
        `${runtime}: learnings/README.md should ship for installer-side discoverability`);
    });

    // v3.7.9 universal patterns from the whoo* experiment campaign + research scan
    test('v3.7.9 universal learning topics ship intact', () => {
      const universalDir = path.join(installedCore, 'learnings', 'universal');
      const expected = [
        'atomic-state.md',          // P-1201 from whoocache + whooflow
        'streaming-io.md',          // P-1202 from whoolog + whoodb
        'parser-design.md',         // P-1203 from whoolog + whoodb + whooschema
        'concurrency.md',           // P-1204 from whoocache (also has prior content)
        'error-paths.md',           // P-1205 from whooschema
        'dag-scheduler.md',         // P-1206 from whooflow
        'pipe-friendly-cli.md',     // P-1207 from whoolog + whoodb
        'phase-locking.md',         // P-1208 from whooflow + whoocache
      ];
      for (const file of expected) {
        const p = path.join(universalDir, file);
        assert.ok(fs.existsSync(p),
          `${runtime}: ${file} should ship — universal patterns from the v3.7.9 campaign`);
        const content = fs.readFileSync(p, 'utf-8');
        assert.match(content, /^---/, `${runtime}: ${file} must have frontmatter`);
        assert.match(content, /patterns:/, `${runtime}: ${file} must list at least one pattern`);
      }
    });
  });
}
