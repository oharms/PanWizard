/**
 * Design-quality parity across the main and focus flows (ADR-0042).
 *
 * Verifies the SHARED foundation + the focus-flow verification wiring:
 *   - references/design-methodology.md — one method, four depth tiers, 7-point bar
 *   - templates/design.md — tier-gated artifact schema
 *   - agents/pan-design-checker.md — independent adversarial verifier
 *   - focus-design.md cites the reference + spawns the checker with a capped loop
 *
 * These are structural/content assertions over the shipped source (no install),
 * so they run safely from the repo. They guard against the two entry points
 * (focus-design + design-phase) drifting apart or losing the checker wiring.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { extractFrontmatter } = require('../pan-wizard-core/bin/lib/frontmatter.cjs');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf-8');

describe('design-methodology reference (shared source of truth)', () => {
  const md = read('pan-wizard-core', 'references', 'design-methodology.md');

  test('defines all four depth tiers', () => {
    for (const tier of ['spike', 'phase', 'feature', 'full']) {
      assert.match(md, new RegExp(`\\b${tier}\\b`), `tier "${tier}" documented`);
    }
  });

  test('names the phase tier as the main-flow default and full as focus default', () => {
    assert.match(md, /main-flow default/i);
    assert.match(md, /altitude/i, 'altitude split explained (product-once vs per-phase)');
  });

  test('states the machine-checkable success-criteria requirement (>=2)', () => {
    assert.match(md, /machine-checkable/i);
    assert.match(md, /at least 2|>=\s*2|≥\s*2|2 machine-checkable/i);
  });

  test('enumerates the 7-point quality bar the checker enforces', () => {
    for (const dim of [
      /requirement coverage/i,
      /machine-checkable/i,
      /architecture conformance/i,
      /ADR honesty/i,
      /threat coverage/i,
      /testability/i,
      /scope discipline/i,
    ]) {
      assert.match(md, dim, `quality-bar dimension present: ${dim}`);
    }
  });

  test('caps the reflexion loop at 2 iterations (matches plan-phase guardrail)', () => {
    assert.match(md, /2 revision iterations|2 iterations|cap.*2/i);
  });
});

describe('design.md template (tier-gated artifact)', () => {
  const md = read('pan-wizard-core', 'templates', 'design.md');

  test('carries a tier field and the mandatory section blocks', () => {
    assert.match(md, /\*\*Tier:\*\*/);
    for (const tag of ['<problem>', '<success_criteria>', '<architecture>', '<adr>', '<threats>', '<test_plan>', '<deferred>']) {
      assert.ok(md.includes(tag), `template has ${tag} section`);
    }
  });

  test('names its downstream consumers (planner + both checkers)', () => {
    assert.match(md, /pan-planner/);
    assert.match(md, /pan-design-checker/);
    assert.match(md, /pan-plan-checker/);
  });
});

describe('pan-design-checker agent', () => {
  const raw = read('agents', 'pan-design-checker.md');
  const data = extractFrontmatter(raw);

  test('has valid frontmatter: name, tools, xhigh effort', () => {
    assert.equal(data.name, 'pan-design-checker');
    assert.ok(String(data.tools).includes('Read'), 'can Read');
    assert.equal(data.effort, 'xhigh', 'matches pan-plan-checker rigor');
    assert.ok(data.description && data.description.length > 20, 'has a description');
  });

  test('is read-only (no Write/Edit) — it verifies, it does not author', () => {
    assert.ok(!/\bWrite\b/.test(String(data.tools)), 'no Write tool');
    assert.ok(!/\bEdit\b/.test(String(data.tools)), 'no Edit tool');
  });

  test('is goal-backward and adversarial, spawned by both flows', () => {
    assert.match(raw, /goal-backward/i);
    assert.match(raw, /design-phase/);
    assert.match(raw, /focus-design/);
  });

  test('verifies all 7 dimensions and caps the reflexion loop at 2', () => {
    for (const dim of [
      /requirement coverage/i,
      /machine-checkable/i,
      /architecture conformance/i,
      /ADR honesty/i,
      /threat coverage/i,
      /testability/i,
      /scope discipline/i,
    ]) {
      assert.match(raw, dim);
    }
    assert.match(raw, /2 revision iterations|2 iterations/i);
    assert.match(raw, /design-methodology\.md/, 'cites the shared reference');
  });
});

describe('focus-flow wiring (independent verification closes the self-review gap)', () => {
  const md = read('commands', 'pan', 'focus-design.md');

  test('cites the shared methodology reference', () => {
    assert.match(md, /design-methodology\.md/);
  });

  test('spawns pan-design-checker with a capped reflexion loop', () => {
    assert.match(md, /pan-design-checker/);
    assert.match(md, /2 revision iterations|2 iterations|2-iteration/i);
  });

  test('gates final output on the independent pass, not just the 5.2 self-check', () => {
    assert.match(md, /Independent verification gate/i);
  });
});
