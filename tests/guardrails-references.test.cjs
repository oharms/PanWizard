// Tests that key workflows and agents reference references/guardrails.md.
// Spec: docs/specs/googlecli_adoption_featureai.md (cross-reference enforcement).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORKFLOWS = ['exec-phase.md', 'plan-phase.md', 'verify-phase.md', 'execute-plan.md'];
const AGENTS = ['pan-reviewer.md', 'pan-planner.md'];
const GUARDRAILS_REF = /guardrails\.md/;

describe('guardrails cross-references', () => {
  for (const file of WORKFLOWS) {
    test(`workflows/${file} references guardrails.md`, () => {
      const filePath = path.join(ROOT, 'pan-wizard-core', 'workflows', file);
      assert.ok(fs.existsSync(filePath), `${file} should exist`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.match(
        content,
        GUARDRAILS_REF,
        `workflows/${file} should reference guardrails.md`
      );
    });
  }

  for (const file of AGENTS) {
    test(`agents/${file} references guardrails.md`, () => {
      const filePath = path.join(ROOT, 'agents', file);
      assert.ok(fs.existsSync(filePath), `agents/${file} should exist`);
      const content = fs.readFileSync(filePath, 'utf-8');
      assert.match(
        content,
        GUARDRAILS_REF,
        `agents/${file} should reference guardrails.md`
      );
    });
  }
});
