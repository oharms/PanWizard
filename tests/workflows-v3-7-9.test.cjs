// Tests for workflow-text additions landed in v3.7.9.
// These are TEXT contracts — the workflows ship as markdown that AI agents read,
// so the only meaningful verification is "the section is present and contains
// the load-bearing instructions."

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.join(__dirname, '..', 'pan-wizard-core', 'workflows');
const REFERENCES_DIR = path.join(__dirname, '..', 'pan-wizard-core', 'references');
const AGENTS_DIR = path.join(__dirname, '..', 'agents');

describe('new-project safety-net commit (P-EXP-001 fix, v3.7.9)', () => {
  const filePath = path.join(WORKFLOWS_DIR, 'new-project.md');

  test('new-project.md contains "## 8.9. Safety-Net Commit" section', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /## 8\.9\. Safety-Net Commit/);
  });

  test('safety-net section invokes pan-tools commit on remaining .planning/ artifacts', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    // The bash conditional must reference both git-status check and pan-tools commit
    assert.match(content, /git status --porcelain \.planning\//);
    assert.match(content, /pan-tools\.cjs commit/);
  });

  test('safety-net section cites P-EXP-001 and the whoocache experiment', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /P-EXP-001/);
    assert.match(content, /whoocache/);
  });

  test('safety-net section is positioned BEFORE the "## 9. Done" stage', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    const safetyIdx = content.indexOf('## 8.9. Safety-Net Commit');
    const doneIdx = content.indexOf('## 9. Done');
    assert.ok(safetyIdx > 0 && doneIdx > 0, 'both sections must exist');
    assert.ok(safetyIdx < doneIdx, 'safety-net must come before Done');
  });
});

describe('plan-checker Dimension 11 — Spec Sufficiency for Handoff (P-RES-004, v3.7.9)', () => {
  const filePath = path.join(AGENTS_DIR, 'pan-plan-checker.md');

  test('pan-plan-checker.md contains "## Dimension 11: Spec Sufficiency for Handoff"', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /## Dimension 11: Spec Sufficiency for Handoff/);
  });

  test('Dimension 11 cites the empirical motivation (Specification Gap paper)', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /Specification Gap/);
    assert.match(content, /arXiv:2603\.24284/);
  });

  test('Dimension 11 lists at least 3 distinct checks (implicit decisions, files-list, cross-plan handoff)', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /Implicit-decision audit/i);
    assert.match(content, /Files-list completeness/i);
    assert.match(content, /Cross-plan handoff/i);
  });

  test('Dimension 11 distinguishes warning vs blocker severities', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Find the dimension block, then check it contains both severities
    const dim11Start = content.indexOf('## Dimension 11');
    assert.ok(dim11Start > 0, 'Dimension 11 must exist');
    const tail = content.slice(dim11Start, dim11Start + 3000);
    assert.match(tail, /warning/i);
    assert.match(tail, /blocker/i);
  });
});

describe('reasoning-trace handoff (P-RES-003, v3.7.10)', () => {
  test('handoff-decisions.md reference exists and defines the schema', () => {
    const refPath = path.join(REFERENCES_DIR, 'handoff-decisions.md');
    assert.ok(fs.existsSync(refPath), 'handoff-decisions.md must exist');
    const content = fs.readFileSync(refPath, 'utf-8');
    assert.match(content, /## Schema — `## Plan Decisions`/);
    assert.match(content, /## Schema — `## Implementation Decisions`/);
    assert.match(content, /### Locked/);
    assert.match(content, /### Open/);
    assert.match(content, /### Considered and rejected/);
    assert.match(content, /### Taken/);
    assert.match(content, /### Deviations/);
    assert.match(content, /### Open questions for verifier/);
  });

  test('handoff-decisions.md cites Cognition + Anthropic sources', () => {
    const refPath = path.join(REFERENCES_DIR, 'handoff-decisions.md');
    const content = fs.readFileSync(refPath, 'utf-8');
    assert.match(content, /cognition\.ai/i);
    assert.match(content, /anthropic\.com.*multi-agent/i);
    assert.match(content, /P-RES-003/);
  });

  test('pan-planner emits "## Plan Decisions" section in its plan template', () => {
    const planner = fs.readFileSync(path.join(AGENTS_DIR, 'pan-planner.md'), 'utf-8');
    assert.match(planner, /## Plan Decisions/);
    assert.match(planner, /### Locked/);
    assert.match(planner, /### Open/);
    assert.match(planner, /### Considered and rejected/);
    assert.match(planner, /handoff-decisions\.md/);
  });

  test('pan-executor instructed to read Plan Decisions and write Implementation Decisions', () => {
    const executor = fs.readFileSync(path.join(AGENTS_DIR, 'pan-executor.md'), 'utf-8');
    assert.match(executor, /Plan Decisions/);
    assert.match(executor, /Implementation Decisions/);
    assert.match(executor, /handoff-decisions\.md/);
    assert.match(executor, /P-RES-003/);
  });

  test('pan-verifier instructed to consume the reasoning trace', () => {
    const verifier = fs.readFileSync(path.join(AGENTS_DIR, 'pan-verifier.md'), 'utf-8');
    assert.match(verifier, /Read the Reasoning Trace/i);
    assert.match(verifier, /handoff-decisions\.md/);
    assert.match(verifier, /P-RES-003/);
  });

  test('pan-plan-checker has Dimension 12: Decision Trace Completeness', () => {
    const planChecker = fs.readFileSync(path.join(AGENTS_DIR, 'pan-plan-checker.md'), 'utf-8');
    assert.match(planChecker, /## Dimension 12: Decision Trace Completeness/);
    assert.match(planChecker, /P-RES-003/);
    // Must distinguish blocker vs info severities
    const dim12 = planChecker.slice(planChecker.indexOf('## Dimension 12'));
    assert.match(dim12, /blocker/i);
    assert.match(dim12, /handoff-decisions\.md/);
  });

  test('summary templates carry Implementation Decisions section', () => {
    for (const variant of ['summary-minimal.md', 'summary-standard.md', 'summary-complex.md']) {
      const tplPath = path.join(__dirname, '..', 'pan-wizard-core', 'templates', variant);
      const content = fs.readFileSync(tplPath, 'utf-8');
      assert.match(content, /## Implementation Decisions/, `${variant} must have the section`);
      assert.match(content, /handoff-decisions\.md/, `${variant} must cite the schema reference`);
    }
  });
});

describe('verification-patterns reference — verifiable signals beat prose (P-RES-006, v3.7.9)', () => {
  const filePath = path.join(REFERENCES_DIR, 'verification-patterns.md');

  test('verification-patterns.md contains "Verifiable Signals Beat Prose Judgment" section', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /Verifiable Signals Beat Prose Judgment/);
  });

  test('section cites P-RES-006 and the S2R / RLVR sources', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.match(content, /P-RES-006/);
    assert.match(content, /S2R|RLVR/);
  });

  test('section lists prose-vs-mechanical alternatives for at least 4 verification needs', () => {
    const content = fs.readFileSync(filePath, 'utf-8');
    // Markers from the comparison table
    assert.match(content, /Does the code work\?/);
    assert.match(content, /Does it follow conventions\?/);
    assert.match(content, /Are there security issues\?/);
    assert.match(content, /Are types coherent\?/);
  });
});
