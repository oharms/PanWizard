/**
 * PAN Tools Tests - Milestone Extended + State add-decision / add-blocker
 *
 * Edge cases for `milestone complete` not covered by milestone.test.cjs,
 * plus direct functional tests for `state add-decision` and `state add-blocker`.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('milestone complete edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();

    // Standard roadmap.md fixture
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n## v1.0 MVP\n### Phase 01: Setup\n**Goal:** Set up the project\n`
    );

    // Standard requirements.md fixture
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements\n- [x] **REQ-01** User login\n`
    );

    // Standard state.md fixture
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State\n\n**Current Phase:** 03\n**Status:** Executing\n**Last Activity:** 2026-01-15\n**Last Activity Description:** Completed phase 3\n`
    );

    // Create phase directories with PLAN.md and SUMMARY.md files
    const phase1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phase1, { recursive: true });
    fs.writeFileSync(
      path.join(phase1, '01-01-plan.md'),
      `---\nphase: "01"\nplan: "01"\n---\n# Plan\n`
    );
    fs.writeFileSync(
      path.join(phase1, '01-01-summary.md'),
      `---\none-liner: Built login\n---\n# Summary\n`
    );

    const phase2 = path.join(tmpDir, '.planning', 'phases', '02-core');
    fs.mkdirSync(phase2, { recursive: true });
    fs.writeFileSync(
      path.join(phase2, '02-01-plan.md'),
      `---\nphase: "02"\nplan: "01"\n---\n# Plan\n`
    );
    fs.writeFileSync(
      path.join(phase2, '02-01-summary.md'),
      `---\none-liner: Implemented API layer\n---\n# Summary\n`
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('archives phases when --archive-phases flag set', () => {
    const result = runPanTools('milestone complete v1.0 --name MVP Release --archive-phases', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.version, 'v1.0');
    assert.strictEqual(output.archived.phases, true, 'phases should be archived');

    // Phase directories should have been moved to milestones/v1.0-phases/
    const archiveDir = path.join(tmpDir, '.planning', 'milestones', 'v1.0-phases');
    assert.ok(
      fs.existsSync(archiveDir),
      'v1.0-phases archive directory should exist'
    );
    assert.ok(
      fs.existsSync(path.join(archiveDir, '01-setup')),
      '01-setup should be archived'
    );
    assert.ok(
      fs.existsSync(path.join(archiveDir, '02-core')),
      '02-core should be archived'
    );

    // Original phase directories should no longer exist
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01-setup')),
      '01-setup should no longer exist in phases/'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-core')),
      '02-core should no longer exist in phases/'
    );
  });

  test('collects accomplishments from summary frontmatter', () => {
    const result = runPanTools('milestone complete v1.0 --name MVP Release', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output.accomplishments), 'accomplishments should be an array');
    assert.ok(
      output.accomplishments.includes('Built login'),
      'accomplishments should contain "Built login" from 01-01-summary.md'
    );
    assert.ok(
      output.accomplishments.includes('Implemented API layer'),
      'accomplishments should contain "Implemented API layer" from 02-01-summary.md'
    );

    // Verify milestones.md contains the accomplishments
    const milestones = fs.readFileSync(
      path.join(tmpDir, '.planning', 'milestones.md'),
      'utf-8'
    );
    assert.ok(
      milestones.includes('Built login'),
      'milestones.md should list "Built login"'
    );
    assert.ok(
      milestones.includes('Implemented API layer'),
      'milestones.md should list "Implemented API layer"'
    );
  });

  test('handles milestone with no phases directory', () => {
    // Remove all phase directories
    fs.rmSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });

    const result = runPanTools('milestone complete v1.0 --name MVP Release', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phases, 0, 'phases count should be 0');
    assert.strictEqual(output.plans, 0, 'plans count should be 0');
    assert.strictEqual(output.tasks, 0, 'tasks count should be 0');
    assert.deepStrictEqual(output.accomplishments, [], 'accomplishments should be empty array');
  });

  test('updates state.md with milestone status', () => {
    const result = runPanTools('milestone complete v1.0 --name MVP Release', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_updated, true, 'state_updated should be true');

    const state = fs.readFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      'utf-8'
    );
    assert.ok(
      state.includes('v1.0 milestone complete'),
      'state.md Status should show "v1.0 milestone complete"'
    );
    assert.ok(
      state.includes('v1.0 milestone completed and archived'),
      'state.md Last Activity Description should reflect milestone archival'
    );
  });

  test('requires version argument', () => {
    const result = runPanTools('milestone complete', tmpDir);
    assert.ok(!result.success, 'should fail without version argument');
    assert.ok(
      result.error.includes('version required'),
      'error should mention version is required'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state add-decision (direct functional tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('state add-decision direct tests', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('adds decision to decisions section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01
**Status:** Planning
**Last Activity:** 2026-01-15
**Last Activity Description:** Started planning

## Decisions
| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01 | Initial setup | Foundation |

## Blockers
- None
`
    );

    const result = runPanTools(
      'state add-decision --phase 01 --summary "Use React" --rationale "Best ecosystem"',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, true, 'added should be true');
    assert.ok(
      output.decision.includes('Use React'),
      'decision entry should contain the summary'
    );
    assert.ok(
      output.decision.includes('Best ecosystem'),
      'decision entry should contain the rationale'
    );

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(
      state.includes('[Phase 01]: Use React'),
      'state.md should contain the decision with phase attribution'
    );
    assert.ok(
      state.includes('Best ecosystem'),
      'state.md should contain the rationale'
    );
  });

  test('creates decision entry when Decisions section has placeholder', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 02
**Status:** Planning
**Last Activity:** 2026-01-15
**Last Activity Description:** Started planning

## Decisions
No decisions yet.

## Blockers
- None
`
    );

    const result = runPanTools(
      'state add-decision --phase 02 --summary "Use PostgreSQL" --rationale "Relational data"',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, true, 'added should be true');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(
      state.includes('[Phase 02]: Use PostgreSQL'),
      'decision entry should be present'
    );
    assert.ok(
      !state.includes('No decisions yet'),
      'placeholder text should be removed'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state add-blocker (direct functional tests)
// ─────────────────────────────────────────────────────────────────────────────

describe('state add-blocker direct tests', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('adds blocker to blockers list', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01
**Status:** Planning
**Last Activity:** 2026-01-15
**Last Activity Description:** Started planning

## Decisions
- [Phase 01]: Initial setup -- Foundation

## Blockers
- Existing blocker from before
`
    );

    const result = runPanTools(
      'state add-blocker --text "API key expired"',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, true, 'added should be true');
    assert.strictEqual(output.blocker, 'API key expired', 'blocker text should match');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(
      state.includes('- API key expired'),
      'state.md should contain the new blocker as a bullet point'
    );
    assert.ok(
      state.includes('- Existing blocker from before'),
      'existing blockers should be preserved'
    );
  });

  test('replaces None placeholder when adding first blocker', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01
**Status:** Planning
**Last Activity:** 2026-01-15
**Last Activity Description:** Started planning

## Decisions
| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01 | Initial setup | Foundation |

## Blockers
- None
`
    );

    const result = runPanTools(
      'state add-blocker --text "API key expired"',
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, true, 'added should be true');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(
      state.includes('- API key expired'),
      'state.md should contain the new blocker'
    );
    assert.ok(
      !state.match(/^- None$/m),
      'None placeholder should be removed after adding blocker'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete --archive-phases
// ─────────────────────────────────────────────────────────────────────────────

describe('milestone complete --archive-phases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n\n## Phase 1: Setup');
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '---\none-liner: Built the foundation\n---\n# Summary');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('archives phase directories when --archive-phases is set', () => {
    const result = runPanTools('milestone complete v1.0 --archive-phases', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.archived.phases, true);

    const archivePhaseDir = path.join(tmpDir, '.planning', 'milestones', 'v1.0-phases');
    assert.ok(fs.existsSync(archivePhaseDir), 'archive phase dir should exist');
    assert.ok(fs.existsSync(path.join(archivePhaseDir, '01-setup')), 'phase should be in archive');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01-setup')), 'original should be moved');
  });

  test('does not archive phases without --archive-phases flag', () => {
    const result = runPanTools('milestone complete v1.0 --name release', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.archived.phases, false);
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01-setup')), 'original should remain');
  });

  test('creates milestones.md with accomplishments', () => {
    const result = runPanTools('milestone complete v1.0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.version, 'v1.0');
    assert.strictEqual(output.phases, 1);
    assert.deepStrictEqual(output.accomplishments, ['Built the foundation']);

    const milestones = fs.readFileSync(path.join(tmpDir, '.planning', 'milestones.md'), 'utf-8');
    assert.ok(milestones.includes('v1.0'), 'should contain version');
    assert.ok(milestones.includes('Built the foundation'), 'should contain accomplishment');
  });

  test('archives roadmap and requirements', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'requirements.md'), '# Requirements\n\n## REQ-01');

    const result = runPanTools('milestone complete v1.0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.archived.roadmap, true);
    assert.strictEqual(output.archived.requirements, true);
  });
});
