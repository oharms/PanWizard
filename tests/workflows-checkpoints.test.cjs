// Tests for "## Re-Read Checkpoints" sections added to long workflows in v3.6.0.
// Spec: docs/specs/googlecli_adoption_featureai.md (#2 phase-gated re-read directives).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'pan-wizard-core', 'workflows');
const TARGET_WORKFLOWS = ['exec-phase.md', 'plan-phase.md', 'verify-phase.md', 'execute-plan.md'];

describe('workflow re-read checkpoints', () => {
  for (const file of TARGET_WORKFLOWS) {
    test(`${file} contains "## Re-Read Checkpoints" section`, () => {
      const filePath = path.join(WORKFLOWS_DIR, file);
      assert.ok(fs.existsSync(filePath), `${file} should exist`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.match(
        content,
        /## Re-Read Checkpoints/,
        `${file} should have "## Re-Read Checkpoints" section`
      );
    });
  }
});
