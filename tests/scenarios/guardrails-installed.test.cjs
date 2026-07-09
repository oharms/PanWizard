/**
 * Scenario tests: references/guardrails.md installs to all 5 runtimes.
 *
 * Spec: docs/specs/googlecli_adoption_featureai.md (#1 — behavioral guardrails preamble)
 * v3.6.0 — guardrails ships under pan-wizard-core/references/ in every runtime install.
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createScenarioRunner, RUNTIME_DIR } = require('../helpers.cjs');

const RUNTIMES = ['claude', 'codex', 'gemini', 'opencode', 'copilot'];

for (const runtime of RUNTIMES) {
  describe(`guardrails.md installs for ${runtime} runtime`, () => {
    let runner;

    before(() => {
      runner = createScenarioRunner(runtime);
    });

    after(() => {
      if (runner) runner.cleanup();
    });

    test('references/guardrails.md exists in installed pan-wizard-core', () => {
      const configDir = RUNTIME_DIR[runtime];
      const guardrailsPath = path.join(
        runner.tmpDir,
        configDir,
        'pan-wizard-core',
        'references',
        'guardrails.md'
      );
      assert.ok(
        fs.existsSync(guardrailsPath),
        `guardrails.md should be installed at ${guardrailsPath}`
      );

      const content = fs.readFileSync(guardrailsPath, 'utf-8');
      assert.ok(content.length > 0, 'installed guardrails.md should be non-empty');
      assert.match(
        content,
        /## Common Shortcuts to Resist/,
        `installed guardrails.md for ${runtime} should contain "Common Shortcuts to Resist"`
      );
    });
  });
}
