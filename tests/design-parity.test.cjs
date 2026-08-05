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

describe('pan-designer agent (main-flow design producer)', () => {
  const raw = read('agents', 'pan-designer.md');
  const data = extractFrontmatter(raw);

  test('valid frontmatter: name, xhigh effort, can Write the artifact', () => {
    assert.equal(data.name, 'pan-designer');
    assert.equal(data.effort, 'xhigh');
    assert.ok(String(data.tools).includes('Write'), 'produces design.md, so needs Write');
  });

  test('runs the phase tier, cites the shared reference + template', () => {
    assert.match(raw, /design-methodology\.md/);
    assert.match(raw, /templates\/design\.md|design\.md/);
    assert.match(raw, /\bphase\b tier|`phase` tier/i);
  });

  test('respects the altitude boundary (no per-phase product/competitive design)', () => {
    assert.match(raw, /altitude/i);
    assert.match(raw, /competitive|demand/i);
  });
});

describe('/pan:design-phase command (main-flow design step)', () => {
  const raw = read('commands', 'pan', 'design-phase.md');
  const data = extractFrontmatter(raw);

  test('valid frontmatter: Phase Lifecycle group, pan-designer agent', () => {
    assert.equal(data.name, 'pan:design-phase');
    assert.equal(data.group, 'Phase Lifecycle');
    assert.equal(data.agent, 'pan-designer');
  });

  test('orchestrates designer → checker with a capped reflexion loop', () => {
    assert.match(raw, /pan-designer/);
    assert.match(raw, /pan-design-checker/);
    assert.match(raw, /2 revision iterations|Max 2/i);
  });

  test('design is optional: auto-skip trivial, --skip-design, and hands off to plan-phase', () => {
    assert.match(raw, /--skip-design/);
    assert.match(raw, /trivial/i);
    assert.match(raw, /plan-phase/);
    assert.match(raw, /optional upstream input/i);
  });
});

describe('main-flow wiring consumes the design (ADR-0042)', () => {
  test('pan-planner treats {phase}-design.md as an authoritative upstream input', () => {
    const raw = read('agents', 'pan-planner.md');
    assert.match(raw, /design\.md/);
    assert.match(raw, /approved design|approved architecture/i);
  });

  test('pan-plan-checker adds a Design Conformance dimension', () => {
    const raw = read('agents', 'pan-plan-checker.md');
    assert.match(raw, /Design Conformance/);
    assert.match(raw, /design\.md/);
  });

  test('plan-phase documents the optional design.md input', () => {
    const raw = read('commands', 'pan', 'plan-phase.md');
    assert.match(raw, /design\.md/);
  });

  test('milestone-new states the altitude split (product design once, not per phase)', () => {
    const raw = read('commands', 'pan', 'milestone-new.md');
    assert.match(raw, /altitude/i);
    assert.match(raw, /design-phase/);
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
