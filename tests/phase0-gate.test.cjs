// Tests for Phase 0 clarify gates added to new-project.md and plan-phase.md in v3.6.0.
// Spec: docs/specs/googlecli_adoption_featureai.md (#5 DESIGN_SPEC gate strengthening).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'pan-wizard-core', 'workflows');

describe('Phase 0 clarify gates', () => {
  test('new-project.md has MANDATORY Phase 0 gate', () => {
    const filePath = path.join(WORKFLOWS_DIR, 'new-project.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(
      content,
      /## Phase 0 — Clarify \(MANDATORY/,
      'new-project.md should have "## Phase 0 — Clarify (MANDATORY" heading'
    );
  });

  test('plan-phase.md has Phase 0 Clarify Phase Scope section', () => {
    const filePath = path.join(WORKFLOWS_DIR, 'plan-phase.md');
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(
      content,
      /## Phase 0 — Clarify Phase Scope/,
      'plan-phase.md should have "## Phase 0 — Clarify Phase Scope" heading'
    );
  });
});
