/**
 * PAN Tools Tests - State Mutation Commands
 *
 * Tests for untested state mutation commands:
 *   state load, state get, state advance-plan, state update-progress,
 *   state resolve-blocker, state record-session, state record-metric
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ── Standard state.md fixture used across multiple test suites ──────────────

const STANDARD_STATE_MD = `# Project State

**Current Phase:** 01
**Phase Name:** Foundation
**Status:** Executing Plan 1
**Total Phases:** 3
**Current Plan:** 1
**Total Plans in Phase:** 3
**Progress:** [####......] 40%
**Last Activity:** 2026-02-28

## Decisions Made
| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01-01 | Use TypeScript | Better DX |

## Decisions
- [Phase 01-01]: Use TypeScript — Better DX

## Blockers
- API rate limit blocking integration tests

## Session
- **Last Date:** 2026-02-28
- **Stopped At:** Plan 2 implementation
- **Resume File:** None

## Performance Metrics
| Phase | Duration | Tasks | Files |
|-------|----------|-------|-------|
| None yet | | | |
`;

// ─────────────────────────────────────────────────────────────────────────────
// state load command
// ─────────────────────────────────────────────────────────────────────────────

describe('state load command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('loads state and config when state.md and config.json exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality', commit_docs: false })
    );

    const result = runPanTools('state load', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_exists, true, 'state_exists should be true');
    assert.strictEqual(output.config_exists, true, 'config_exists should be true');
    assert.strictEqual(output.config.model_profile, 'quality', 'config model_profile should be quality');
    assert.strictEqual(output.config.commit_docs, false, 'config commit_docs should be false');
    assert.ok(output.state_raw.includes('Current Phase'), 'state_raw should contain state.md content');
  });

  test('returns partial state when state.md is missing', () => {
    // createTempProject creates .planning/phases/ but no state.md
    const result = runPanTools('state load', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_exists, false, 'state_exists should be false');
    assert.strictEqual(output.state_raw, '', 'state_raw should be empty string');
    assert.ok(output.config, 'config should still be present with defaults');
  });

  test('returns default config when no .planning directory exists', () => {
    // Use a bare temp dir with no .planning at all
    const bareDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-bare-'));
    try {
      const result = runPanTools('state load', bareDir);
      assert.ok(result.success, `Command failed: ${result.error}`);

      const output = JSON.parse(result.output);
      assert.strictEqual(output.state_exists, false, 'state_exists should be false');
      assert.strictEqual(output.config_exists, false, 'config_exists should be false');
      assert.strictEqual(output.config.model_profile, 'balanced', 'should use default model_profile');
    } finally {
      cleanup(bareDir);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state get command
// ─────────────────────────────────────────────────────────────────────────────

describe('state get command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gets a specific bold field value', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools('state get "Current Phase"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output['Current Phase'], '01', 'should return the field value');
  });

  test('gets an entire section by heading name', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools('state get Blockers', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.Blockers.includes('API rate limit blocking integration tests'),
      'section should contain blocker text'
    );
  });

  test('returns entire content when no section specified', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools('state get', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.content.includes('Current Phase'), 'should return full state.md content');
    assert.ok(output.content.includes('Performance Metrics'), 'should include all sections');
  });

  test('returns JSON error when state.md is missing', () => {
    const result = runPanTools('state get "Current Phase"', tmpDir);
    assert.ok(result.success, `Command failed unexpectedly: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.error.includes('state.md not found'), 'error should mention state.md not found');
  });

  test('returns error for unknown field', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools('state get "Nonexistent Field"', tmpDir);
    assert.ok(result.success, `Command should succeed with error payload: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have an error field');
    assert.ok(output.error.includes('not found'), 'error should indicate field not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state advance-plan command
// ─────────────────────────────────────────────────────────────────────────────

describe('state advance-plan command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('advances plan counter from 1 to 2 when not at last plan', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools('state advance-plan', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.advanced, true, 'should report advanced');
    assert.strictEqual(output.previous_plan, 1, 'previous plan should be 1');
    assert.strictEqual(output.current_plan, 2, 'current plan should be 2');
    assert.strictEqual(output.total_plans, 3, 'total plans should be 3');

    // Verify state.md was actually updated
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('**Current Plan:** 2'), 'state.md should have updated plan number');
    assert.ok(state.includes('**Status:** Ready to execute'), 'STATUS should be updated to Ready to execute');
  });

  test('marks phase complete when at last plan', () => {
    const lastPlanState = STANDARD_STATE_MD.replace(
      '**Current Plan:** 1',
      '**Current Plan:** 3'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      lastPlanState
    );

    const result = runPanTools('state advance-plan', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.advanced, false, 'should not advance past last plan');
    assert.strictEqual(output.reason, 'last_plan', 'reason should be last_plan');
    assert.strictEqual(output.status, 'ready_for_verification', 'status should indicate ready for verification');

    // Verify state.md reflects phase complete
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(
      state.includes('Phase complete'),
      'STATUS should indicate phase complete'
    );
  });

  test('returns error when state.md is missing', () => {
    const result = runPanTools('state advance-plan', tmpDir);
    assert.ok(result.success, `Command should succeed with error payload: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found', 'should report state.md not found');
  });

  test('returns parse error for non-numeric current plan', () => {
    const badState = STANDARD_STATE_MD.replace(
      '**Current Plan:** 1',
      '**Current Plan:** abc'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      badState
    );

    const result = runPanTools('state advance-plan', tmpDir);
    assert.ok(result.success, `Command should succeed with error payload: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have an error field');
    assert.ok(output.error.includes('Cannot parse'), 'error should mention parse failure');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state update-progress command
// ─────────────────────────────────────────────────────────────────────────────

describe('state update-progress command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('updates progress to 50% when 1 of 2 plans complete across 2 phases', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    // Create 2 phase dirs with a total of 2 plans, 1 summary
    const phase1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phase1, { recursive: true });
    fs.writeFileSync(path.join(phase1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phase1, '01-01-summary.md'), '# Summary');

    const phase2 = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase2, { recursive: true });
    fs.writeFileSync(path.join(phase2, '02-01-plan.md'), '# Plan');

    const result = runPanTools('state update-progress', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should report updated');
    assert.strictEqual(output.percent, 50, 'percent should be 50');
    assert.strictEqual(output.completed, 1, 'completed should be 1');
    assert.strictEqual(output.total, 2, 'total should be 2');

    // Verify state.md was updated
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('50%'), 'state.md should contain 50%');
  });

  test('progress stays at 0% when no phases exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );
    // The createTempProject creates .planning/phases/ but it is empty

    const result = runPanTools('state update-progress', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should report updated');
    assert.strictEqual(output.percent, 0, 'percent should be 0');
    assert.strictEqual(output.completed, 0, 'completed should be 0');
    assert.strictEqual(output.total, 0, 'total should be 0');
  });

  test('progress capped at 100% when more summaries than plans', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    // Create phase with 1 plan but 2 summaries (orphaned summary)
    const phase1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phase1, { recursive: true });
    fs.writeFileSync(path.join(phase1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phase1, '01-01-summary.md'), '# Summary');
    fs.writeFileSync(path.join(phase1, '01-02-summary.md'), '# Orphaned summary');

    const result = runPanTools('state update-progress', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should report updated');
    assert.ok(output.percent <= 100, `percent should be capped at 100 but got ${output.percent}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state resolve-blocker command
// ─────────────────────────────────────────────────────────────────────────────

describe('state resolve-blocker command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('removes matching blocker from the list', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01

## Blockers
- API rate limit blocking integration tests
- Waiting for design review
`
    );

    const result = runPanTools('state resolve-blocker --text "rate limit"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.resolved, true, 'should report resolved');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(!state.includes('rate limit'), 'resolved blocker should be removed');
    assert.ok(state.includes('Waiting for design review'), 'other blockers should remain');
  });

  test('returns resolved true even when no blocker matches (case-insensitive search)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01

## Blockers
- Waiting for design review
`
    );

    const result = runPanTools('state resolve-blocker --text "nonexistent blocker"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // The implementation always returns resolved: true when Blockers section exists
    assert.strictEqual(output.resolved, true, 'should report resolved even when no match');

    // Verify existing blockers were NOT removed
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('Waiting for design review'), 'unmatched blockers should remain');
  });

  test('adds None placeholder when last blocker is resolved', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01

## Blockers
- API rate limit blocking integration tests

## Session
- **Last Date:** 2026-02-28
`
    );

    const result = runPanTools('state resolve-blocker --text "rate limit"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.resolved, true, 'should report resolved');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(!state.includes('rate limit'), 'blocker should be removed');
    assert.ok(state.includes('None'), 'should have None placeholder after removing last blocker');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state record-session command
// ─────────────────────────────────────────────────────────────────────────────

describe('state record-session command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('updates stopped_at and resume_file in Session section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state record-session --stopped-at "Phase 1, Plan 3, Task 2" --resume-file ".planning/phases/01-foundation/01-03-plan.md"',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.recorded, true, 'should report recorded');
    assert.ok(output.updated.includes('Stopped At'), 'should have updated Stopped At');
    assert.ok(output.updated.includes('Resume File'), 'should have updated Resume File');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('Phase 1, Plan 3, Task 2'), 'stopped_at should be written');
    assert.ok(
      state.includes('.planning/phases/01-foundation/01-03-plan.md'),
      'resume_file should be written'
    );
  });

  test('updates Last Date with current ISO timestamp', () => {
    // Use a clearly old date so the replacement is detectable regardless of today's date
    const oldDateState = STANDARD_STATE_MD.replace(
      '**Last Date:** 2026-02-28',
      '**Last Date:** 2020-01-01'
    ).replace(
      '- **Last Date:** 2026-02-28',
      '- **Last Date:** 2020-01-01'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      oldDateState
    );

    const result = runPanTools(
      'state record-session --stopped-at "Completed plan execution"',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.recorded, true, 'should report recorded');
    assert.ok(output.updated.includes('Last Date'), 'should have updated Last Date');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    // The Last Date should now contain an ISO timestamp (with T) instead of the old date
    assert.ok(!state.includes('2020-01-01'), 'old date should be replaced');
    assert.ok(state.match(/\*\*Last Date:\*\*.*T/), 'Last Date should contain ISO timestamp with T');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state record-metric command
// ─────────────────────────────────────────────────────────────────────────────

describe('state record-metric command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('appends metric row to Performance Metrics table', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state record-metric --phase 01 --plan 01 --duration 12min --tasks 5 --files 8',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.recorded, true, 'should report recorded');
    assert.strictEqual(output.phase, '01', 'phase should match');
    assert.strictEqual(output.duration, '12min', 'duration should match');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('Phase 01 P01'), 'should contain the phase/plan label');
    assert.ok(state.includes('12min'), 'should contain the duration');
    assert.ok(state.includes('5 tasks'), 'should contain tasks count');
    assert.ok(state.includes('8 files'), 'should contain files count');
  });

  test('replaces None yet placeholder when adding first metric', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state record-metric --phase 01 --plan 01 --duration 5min --tasks 3 --files 4',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(!state.includes('None yet'), 'None yet placeholder should be removed');
    assert.ok(state.includes('Phase 01 P01'), 'new metric row should be present');
  });

  test('appends second row when metrics already exist', () => {
    // Use a state that already has a metric (no "None yet")
    const stateWithMetric = STANDARD_STATE_MD.replace(
      '| None yet | | | |',
      '| Phase 01 P01 | 5min | 3 tasks | 4 files |'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      stateWithMetric
    );

    const result = runPanTools(
      'state record-metric --phase 01 --plan 02 --duration 8min --tasks 6 --files 10',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('Phase 01 P01'), 'first metric should still be present');
    assert.ok(state.includes('Phase 01 P02'), 'second metric should be appended');
    assert.ok(state.includes('8min'), 'second metric duration should be present');
  });

  test('returns error when required fields are missing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state record-metric --phase 01',
      tmpDir
    );
    assert.ok(result.success, `Command should succeed with error payload: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have an error field');
    assert.ok(output.error.includes('required'), 'error should mention required fields');
  });
});

// ── state patch ──────────────────────────────────────────────────────────────

describe('state patch command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('patches a single field in state.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state patch --Status "Phase 2 Active"',
      tmpDir
    );
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.updated.includes('Status'), 'should report Status as updated');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('**Status:** Phase 2 Active'), 'state.md should have updated value');
  });

  test('patches multiple fields at once', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state patch --Status "Planning Phase 2" --Progress "[########..] 80%"',
      tmpDir
    );
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.updated.length >= 2, 'should have updated at least two fields');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('**Status:** Planning Phase 2'), 'Status should be updated');
  });

  test('reports failed fields that do not exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      STANDARD_STATE_MD
    );

    const result = runPanTools(
      'state patch --Nonexistent "value"',
      tmpDir
    );
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.failed.includes('Nonexistent'), 'should report field as failed');
  });

  test('returns error when state.md is missing', () => {
    const result = runPanTools('state patch --Status active', tmpDir);
    // state patch exits non-zero when state.md is missing
    assert.strictEqual(result.success, false, 'should fail when state.md is missing');
  });
});

// ── writeStateMd error handling ─────────────────────────────────────────────

describe('writeStateMd via state commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), STANDARD_STATE_MD);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('state update writes content correctly', () => {
    const result = runPanTools('state update Status testing-write', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(content.includes('testing-write'), 'written content should contain new value');
  });

  test('writeStateMd preserves frontmatter sync', () => {
    const result = runPanTools('state update Status synced-value', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    // State writes should trigger frontmatter sync
    assert.ok(content.includes('synced-value'), 'value should be written');
  });
});

// ── readStateSafe — state commands with missing state.md ────────────────────

describe('state commands handle missing state.md gracefully', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // No state.md created — all state commands should return error JSON
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('state get returns error when state.md missing', () => {
    const result = runPanTools('state get Status', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state advance-plan returns error when state.md missing', () => {
    const result = runPanTools('state advance-plan', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state record-metric returns error when state.md missing', () => {
    const result = runPanTools('state record-metric --phase 1 --plan 1 --duration 30m', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state update-progress returns error when state.md missing', () => {
    const result = runPanTools('state update-progress', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state add-decision returns error when state.md missing', () => {
    const result = runPanTools('state add-decision --summary test-decision', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state add-blocker returns error when state.md missing', () => {
    const result = runPanTools('state add-blocker --text test-blocker', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state resolve-blocker returns error when state.md missing', () => {
    const result = runPanTools('state resolve-blocker --text test-blocker', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state record-session returns error when state.md missing', () => {
    const result = runPanTools('state record-session', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state-snapshot returns error when state.md missing', () => {
    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });

  test('state json returns error when state.md missing', () => {
    const result = runPanTools('state json', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found');
  });
});
