/**
 * Program P1: clarify with a taxonomy and a question budget.
 *
 * Code gate: the static prompt test below (the taxonomy and the budget are present,
 * and the workflows that question the user follow them). The scripted-user plumbing
 * that writes answers back is already exercised at tier 0 by
 * harness/scenarios/discuss-phase-scripted-user.json (H9). The evidence gate (at most
 * five questions on three live seeds) spends, and waits for an approved run.
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

describe('clarification taxonomy and question budget (P1)', () => {
  const q = read('pan-wizard-core/references/questioning.md');

  test('the reference names every category of the taxonomy', () => {
    assert.match(q, /<clarification_taxonomy>/);
    for (const c of ['Scope', 'Users', 'Behaviour', 'Data', 'Interfaces', 'Errors and edge cases', 'Non-functional', 'Constraints', 'Done']) {
      assert.ok(q.includes(`**${c}`), `taxonomy category missing: ${c}`);
    }
  });

  test('the budget caps the questions and turns the rest into recorded assumptions', () => {
    assert.match(q, /<question_budget>/);
    assert.match(q, /at most five/i);
    assert.match(q, /impact.{0,20}uncertainty/i);
    assert.match(q, /Assumed:/);
  });

  test('discuss-phase and new-project follow the taxonomy and the budget', () => {
    for (const wf of ['pan-wizard-core/workflows/discuss-phase.md', 'pan-wizard-core/workflows/new-project.md']) {
      const t = read(wf);
      assert.match(t, /clarification_taxonomy/, `${wf} must scan the taxonomy`);
      assert.match(t, /question_budget/, `${wf} must keep to the budget`);
    }
  });
});
