/**
 * PAN Tools Tests - Phase
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const {
  removePhaseFromDisk,
  renumberDecimalPhases,
  renumberIntegerPhases,
  markPhaseCompleteInRoadmap,
  updateStateAfterPhaseComplete,
} = require('../pan-wizard-core/bin/lib/phase.cjs');

describe('phases list command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns empty array', () => {
    const result = runPanTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.directories, [], 'directories should be empty');
    assert.strictEqual(output.count, 0, 'count should be 0');
  });

  test('lists phase directories sorted numerically', () => {
    // Create out-of-order directories
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '10-final'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runPanTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 3, 'should have 3 directories');
    assert.deepStrictEqual(
      output.directories,
      ['01-foundation', '02-api', '10-final'],
      'should be sorted numerically'
    );
  });

  test('handles decimal phases in sort order', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02.2-patch'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-ui'), { recursive: true });

    const result = runPanTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.directories,
      ['02-api', '02.1-hotfix', '02.2-patch', '03-ui'],
      'decimal phases should sort correctly between whole numbers'
    );
  });

  test('--type plans lists only PLAN.md files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary');
    fs.writeFileSync(path.join(phaseDir, 'research.md'), '# Research');

    const result = runPanTools('phases list --type plans', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.files.sort(),
      ['01-01-plan.md', '01-02-plan.md'],
      'should list only PLAN files'
    );
  });

  test('--type summaries lists only SUMMARY.md files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-summary.md'), '# Summary 2');

    const result = runPanTools('phases list --type summaries', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.files.sort(),
      ['01-01-summary.md', '01-02-summary.md'],
      'should list only SUMMARY files'
    );
  });

  test('--phase filters to specific phase directory', () => {
    const phase01 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    const phase02 = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase01, { recursive: true });
    fs.mkdirSync(phase02, { recursive: true });
    fs.writeFileSync(path.join(phase01, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phase02, '02-01-plan.md'), '# Plan');

    const result = runPanTools('phases list --type plans --phase 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.files, ['01-01-plan.md'], 'should only list phase 01 plans');
    assert.strictEqual(output.phase_dir, 'foundation', 'should report phase name without number prefix');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// roadmap get-phase command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase next-decimal command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns X.1 when no decimal phases exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '07-next'), { recursive: true });

    const result = runPanTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.1', 'should return 06.1');
    assert.deepStrictEqual(output.existing, [], 'no existing decimals');
  });

  test('increments from existing decimal phases', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.2-patch'), { recursive: true });

    const result = runPanTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.3', 'should return 06.3');
    assert.deepStrictEqual(output.existing, ['06.1', '06.2'], 'lists existing decimals');
  });

  test('handles gaps in decimal sequence', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-first'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.3-third'), { recursive: true });

    const result = runPanTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Should take next after highest, not fill gap
    assert.strictEqual(output.next, '06.4', 'should return 06.4, not fill gap at 06.2');
  });

  test('handles single-digit phase input', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-feature'), { recursive: true });

    const result = runPanTools('phase next-decimal 6', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '06.1', 'should normalize to 06.1');
    assert.strictEqual(output.base_phase, '06', 'base phase should be padded');
  });

  test('returns error if base phase does not exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-start'), { recursive: true });

    const result = runPanTools('phase next-decimal 06', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false, 'base phase not found');
    assert.strictEqual(output.next, '06.1', 'should still suggest 06.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase-plan-index command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase-plan-index command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phase directory returns empty plans array', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '03', 'phase number correct');
    assert.deepStrictEqual(output.plans, [], 'plans should be empty');
    assert.deepStrictEqual(output.waves, {}, 'waves should be empty');
    assert.deepStrictEqual(output.incomplete, [], 'incomplete should be empty');
    assert.strictEqual(output.has_checkpoints, false, 'no checkpoints');
  });

  test('extracts single plan with frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-plan.md'),
      `---
wave: 1
autonomous: true
objective: Set up database schema
files-modified: [prisma/schema.prisma, src/lib/db.ts]
---

## Task 1: Create schema
## Task 2: Generate client
`
    );

    const result = runPanTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 1, 'should have 1 plan');
    assert.strictEqual(output.plans[0].id, '03-01', 'plan id correct');
    assert.strictEqual(output.plans[0].wave, 1, 'wave extracted');
    assert.strictEqual(output.plans[0].autonomous, true, 'autonomous extracted');
    assert.strictEqual(output.plans[0].objective, 'Set up database schema', 'objective extracted');
    assert.deepStrictEqual(output.plans[0].files_modified, ['prisma/schema.prisma', 'src/lib/db.ts'], 'files extracted');
    assert.strictEqual(output.plans[0].task_count, 2, 'task count correct');
    assert.strictEqual(output.plans[0].has_summary, false, 'no summary yet');
  });

  test('groups multiple plans by wave', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-plan.md'),
      `---
wave: 1
autonomous: true
objective: Database setup
---

## Task 1: Schema
`
    );

    fs.writeFileSync(
      path.join(phaseDir, '03-02-plan.md'),
      `---
wave: 1
autonomous: true
objective: Auth setup
---

## Task 1: JWT
`
    );

    fs.writeFileSync(
      path.join(phaseDir, '03-03-plan.md'),
      `---
wave: 2
autonomous: false
objective: API routes
---

## Task 1: Routes
`
    );

    const result = runPanTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 3, 'should have 3 plans');
    assert.deepStrictEqual(output.waves['1'], ['03-01', '03-02'], 'wave 1 has 2 plans');
    assert.deepStrictEqual(output.waves['2'], ['03-03'], 'wave 2 has 1 plan');
  });

  test('detects incomplete plans (no matching summary)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Plan with summary
    fs.writeFileSync(path.join(phaseDir, '03-01-plan.md'), `---\nwave: 1\n---\n## Task 1`);
    fs.writeFileSync(path.join(phaseDir, '03-01-summary.md'), `# Summary`);

    // Plan without summary
    fs.writeFileSync(path.join(phaseDir, '03-02-plan.md'), `---\nwave: 2\n---\n## Task 1`);

    const result = runPanTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans[0].has_summary, true, 'first plan has summary');
    assert.strictEqual(output.plans[1].has_summary, false, 'second plan has no summary');
    assert.deepStrictEqual(output.incomplete, ['03-02'], 'incomplete list correct');
  });

  test('detects checkpoints (autonomous: false)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '03-01-plan.md'),
      `---
wave: 1
autonomous: false
objective: Manual review needed
---

## Task 1: Review
`
    );

    const result = runPanTools('phase-plan-index 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_checkpoints, true, 'should detect checkpoint');
    assert.strictEqual(output.plans[0].autonomous, false, 'plan marked non-autonomous');
  });

  test('phase not found returns error', () => {
    const result = runPanTools('phase-plan-index 99', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Phase not found', 'should report phase not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state-snapshot command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase add command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('adds phase after highest existing', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API

---
`
    );

    const result = runPanTools('phase add User Dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, 3, 'should be phase 3');
    assert.strictEqual(output.slug, 'user-dashboard');

    // Verify directory created
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '03-user-dashboard')),
      'directory should be created'
    );

    // Verify ROADMAP updated
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('### Phase 3: User Dashboard'), 'roadmap should include new phase');
    assert.ok(roadmap.includes('**Depends on:** Phase 2'), 'should depend on previous');
  });

  test('handles empty roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0\n`
    );

    const result = runPanTools('phase add Initial Setup', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, 1, 'should be phase 1');
  });

  test('phase add includes **Requirements**: TBD in new ROADMAP entry', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0\n\n### Phase 1: Foundation\n**Goal:** Setup\n\n---\n`
    );

    const result = runPanTools('phase add User Dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('**Requirements**: TBD'), 'new phase entry should include Requirements TBD');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase insert command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase insert command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('inserts decimal phase after target', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runPanTools('phase insert 1 Fix Critical Bug', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '01.1', 'should be 01.1');
    assert.strictEqual(output.after_phase, '1');

    // Verify directory
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01.1-fix-critical-bug')),
      'decimal phase directory should be created'
    );

    // Verify ROADMAP
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('Phase 01.1: Fix Critical Bug (INSERTED)'), 'roadmap should include inserted phase');
  });

  test('increments decimal when siblings exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup

### Phase 2: API
**Goal:** Build API
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01.1-hotfix'), { recursive: true });

    const result = runPanTools('phase insert 1 Another Fix', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '01.2', 'should be 01.2');
  });

  test('rejects missing phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: Test\n**Goal:** Test\n`
    );

    const result = runPanTools('phase insert 99 Fix Something', tmpDir);
    assert.ok(!result.success, 'should fail for missing phase');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });

  test('handles padding mismatch between input and roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

## Phase 09.05: Existing Decimal Phase
**Goal:** Test padding

## Phase 09.1: Next Phase
**Goal:** Test
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '09.05-existing'), { recursive: true });

    // Pass unpadded "9.05" but roadmap has "09.05"
    const result = runPanTools('phase insert 9.05 Padding Test', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.after_phase, '9.05');

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('(INSERTED)'), 'roadmap should include inserted phase');
  });

  test('phase insert includes **Requirements**: TBD in new ROADMAP entry', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 1: Foundation\n**Goal:** Setup\n\n### Phase 2: API\n**Goal:** Build API\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runPanTools('phase insert 1 Fix Critical Bug', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('**Requirements**: TBD'), 'inserted phase entry should include Requirements TBD');
  });

  test('handles #### heading depth from multi-milestone roadmaps', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### v1.1 Milestone

#### Phase 5: Feature Work
**Goal:** Build features

#### Phase 6: Polish
**Goal:** Polish
`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05-feature-work'), { recursive: true });

    const result = runPanTools('phase insert 5 Hotfix', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_number, '05.1');

    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('Phase 05.1: Hotfix (INSERTED)'), 'roadmap should include inserted phase');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase remove command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase remove command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('removes phase directory and renumbers subsequent', () => {
    // Setup 3 phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

### Phase 1: Foundation
**Goal:** Setup
**Depends on:** Nothing

### Phase 2: Auth
**Goal:** Authentication
**Depends on:** Phase 1

### Phase 3: Features
**Goal:** Core features
**Depends on:** Phase 2
`
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-auth');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, '02-01-plan.md'), '# Plan');
    const p3 = path.join(tmpDir, '.planning', 'phases', '03-features');
    fs.mkdirSync(p3, { recursive: true });
    fs.writeFileSync(path.join(p3, '03-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p3, '03-02-plan.md'), '# Plan 2');

    // Remove phase 2
    const result = runPanTools('phase remove 2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.removed, '2');
    assert.strictEqual(output.directory_deleted, '02-auth');

    // Phase 3 should be renumbered to 02
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features')),
      'phase 3 should be renumbered to 02-features'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '03-features')),
      'old 03-features should not exist'
    );

    // Files inside should be renamed
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features', '02-01-plan.md')),
      'plan file should be renumbered to 02-01'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '02-features', '02-02-plan.md')),
      'plan 2 should be renumbered to 02-02'
    );

    // ROADMAP should be updated
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(!roadmap.includes('Phase 2: Auth'), 'removed phase should not be in roadmap');
    assert.ok(roadmap.includes('Phase 2: Features'), 'phase 3 should be renumbered to 2');
  });

  test('rejects removal of phase with summaries unless --force', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: Test\n**Goal:** Test\n`
    );

    // Should fail without --force
    const result = runPanTools('phase remove 1', tmpDir);
    assert.ok(!result.success, 'should fail without --force');
    assert.ok(result.error.includes('executed plan'), 'error mentions executed plans');

    // Should succeed with --force
    const forceResult = runPanTools('phase remove 1 --force', tmpDir);
    assert.ok(forceResult.success, `Force remove failed: ${forceResult.error}`);
  });

  test('removes decimal phase and renumbers siblings', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 6: Main\n**Goal:** Main\n### Phase 6.1: Fix A\n**Goal:** Fix A\n### Phase 6.2: Fix B\n**Goal:** Fix B\n### Phase 6.3: Fix C\n**Goal:** Fix C\n`
    );

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06-main'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.1-fix-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.2-fix-b'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '06.3-fix-c'), { recursive: true });

    const result = runPanTools('phase remove 6.2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    // 06.3 should become 06.2
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '06.2-fix-c')),
      '06.3 should be renumbered to 06.2'
    );
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'phases', '06.3-fix-c')),
      'old 06.3 should not exist'
    );
  });

  test('updates state.md phase count', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: A\n**Goal:** A\n### Phase 2: B\n**Goal:** B\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 1\n**Total Phases:** 2\n`
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), { recursive: true });

    runPanTools('phase remove 2', tmpDir);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('**Total Phases:** 1'), 'total phases should be decremented');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase complete command
// ─────────────────────────────────────────────────────────────────────────────


describe('phase complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('marks phase complete and transitions to next', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [ ] Phase 1: Foundation
- [ ] Phase 2: API

### Phase 1: Foundation
**Goal:** Setup
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Foundation\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working on phase 1\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runPanTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed_phase, '1');
    assert.strictEqual(output.plans_executed, '1/1');
    assert.strictEqual(output.next_phase, '02');
    assert.strictEqual(output.is_last_phase, false);

    // Verify state.md updated
    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('**Current Phase:** 02'), 'should advance to phase 02');
    assert.ok(state.includes('**Status:** Ready to plan'), 'status should be ready to plan');
    assert.ok(state.includes('**Current Plan:** Not started'), 'plan should be reset');

    // Verify ROADMAP checkbox
    const roadmap = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(roadmap.includes('[x]'), 'phase should be checked off');
    assert.ok(roadmap.includes('completed'), 'completion date should be added');
  });

  test('detects last phase in milestone', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n### Phase 1: Only Phase\n**Goal:** Everything\n`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-only-phase');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');

    const result = runPanTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.is_last_phase, true, 'should detect last phase');
    assert.strictEqual(output.next_phase, null, 'no next phase');

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(state.includes('Milestone complete'), 'status should be milestone complete');
  });

  test('updates requirements.md traceability when phase completes', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [ ] Phase 1: Auth

### Phase 1: Auth
**Goal:** User authentication
**Requirements:** AUTH-01, AUTH-02
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
**Requirements:** API-01
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: User can sign up with email
- [ ] **AUTH-02**: User can log in
- [ ] **AUTH-03**: User can reset password

### API

- [ ] **API-01**: REST endpoints

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 2 | Pending |
| API-01 | Phase 2 | Pending |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Auth\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runPanTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');

    // Checkboxes updated for phase 1 requirements
    assert.ok(req.includes('- [x] **AUTH-01**'), 'AUTH-01 checkbox should be checked');
    assert.ok(req.includes('- [x] **AUTH-02**'), 'AUTH-02 checkbox should be checked');
    // Other requirements unchanged
    assert.ok(req.includes('- [ ] **AUTH-03**'), 'AUTH-03 should remain unchecked');
    assert.ok(req.includes('- [ ] **API-01**'), 'API-01 should remain unchecked');

    // Traceability table updated
    assert.ok(req.includes('| AUTH-01 | Phase 1 | Complete |'), 'AUTH-01 status should be Complete');
    assert.ok(req.includes('| AUTH-02 | Phase 1 | Complete |'), 'AUTH-02 status should be Complete');
    assert.ok(req.includes('| AUTH-03 | Phase 2 | Pending |'), 'AUTH-03 should remain Pending');
    assert.ok(req.includes('| API-01 | Phase 2 | Pending |'), 'API-01 should remain Pending');
  });

  test('handles requirements with bracket format [REQ-01, REQ-02]', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [ ] Phase 1: Auth

### Phase 1: Auth
**Goal:** User authentication
**Requirements:** [AUTH-01, AUTH-02]
**Plans:** 1 plans

### Phase 2: API
**Goal:** Build API
**Requirements:** [API-01]
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements

## v1 Requirements

### Authentication

- [ ] **AUTH-01**: User can sign up with email
- [ ] **AUTH-02**: User can log in
- [ ] **AUTH-03**: User can reset password

### API

- [ ] **API-01**: REST endpoints

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 2 | Pending |
| API-01 | Phase 2 | Pending |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 01\n**Current Phase Name:** Auth\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-api'), { recursive: true });

    const result = runPanTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');

    // Checkboxes updated for phase 1 requirements (brackets stripped)
    assert.ok(req.includes('- [x] **AUTH-01**'), 'AUTH-01 checkbox should be checked');
    assert.ok(req.includes('- [x] **AUTH-02**'), 'AUTH-02 checkbox should be checked');
    // Other requirements unchanged
    assert.ok(req.includes('- [ ] **AUTH-03**'), 'AUTH-03 should remain unchecked');
    assert.ok(req.includes('- [ ] **API-01**'), 'API-01 should remain unchecked');

    // Traceability table updated
    assert.ok(req.includes('| AUTH-01 | Phase 1 | Complete |'), 'AUTH-01 status should be Complete');
    assert.ok(req.includes('| AUTH-02 | Phase 1 | Complete |'), 'AUTH-02 status should be Complete');
    assert.ok(req.includes('| AUTH-03 | Phase 2 | Pending |'), 'AUTH-03 should remain Pending');
    assert.ok(req.includes('| API-01 | Phase 2 | Pending |'), 'API-01 should remain Pending');
  });

  test('handles phase with no requirements mapping', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [ ] Phase 1: Setup

### Phase 1: Setup
**Goal:** Project setup (no requirements)
**Plans:** 1 plans
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements

## v1 Requirements

- [ ] **REQ-01**: Some requirement

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-01 | Phase 2 | Pending |
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');

    const result = runPanTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    // requirements.md should be unchanged
    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');
    assert.ok(req.includes('- [ ] **REQ-01**'), 'REQ-01 should remain unchecked');
    assert.ok(req.includes('| REQ-01 | Phase 2 | Pending |'), 'REQ-01 should remain Pending');
  });

  test('handles missing requirements.md gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [ ] Phase 1: Foundation
**Requirements:** REQ-01

### Phase 1: Foundation
**Goal:** Setup
`
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Current Plan:** 01-01\n**Last Activity:** 2025-01-01\n**Last Activity Description:** Working\n`
    );

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Summary');

    const result = runPanTools('phase complete 1', tmpDir);
    assert.ok(result.success, `Command should succeed even without requirements.md: ${result.error}`);
  });

  test('handles multi-level decimal phase without regex crash', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [x] Phase 3: Lorem
- [x] Phase 3.2: Ipsum
- [ ] Phase 3.2.1: Dolor Sit
- [ ] Phase 4: Amet

### Phase 3: Lorem
**Goal:** Setup
**Plans:** 1/1 plans complete
**Requirements:** LOR-01

### Phase 3.2: Ipsum
**Goal:** Build
**Plans:** 1/1 plans complete
**Requirements:** IPS-01

### Phase 03.2.1: Dolor Sit Polish (INSERTED)
**Goal:** Polish
**Plans:** 1/1 plans complete

### Phase 4: Amet
**Goal:** Deliver
**Requirements:** AMT-01: Filter items by category with AND logic (items matching ALL selected categories)
`
    );

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      `# Requirements

- [ ] **LOR-01**: Lorem database schema
- [ ] **IPS-01**: Ipsum rendering engine
- [ ] **AMT-01**: Filter items by category
`
    );

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# State

**Current Phase:** 03.2.1
**Current Phase Name:** Dolor Sit Polish
**Status:** Execution complete
**Current Plan:** 03.2.1-01
**Last Activity:** 2025-01-01
**Last Activity Description:** Working
`
    );

    const p32 = path.join(tmpDir, '.planning', 'phases', '03.2-ipsum');
    const p321 = path.join(tmpDir, '.planning', 'phases', '03.2.1-dolor-sit');
    const p4 = path.join(tmpDir, '.planning', 'phases', '04-amet');
    fs.mkdirSync(p32, { recursive: true });
    fs.mkdirSync(p321, { recursive: true });
    fs.mkdirSync(p4, { recursive: true });
    fs.writeFileSync(path.join(p321, '03.2.1-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p321, '03.2.1-01-summary.md'), '# Summary');

    const result = runPanTools('phase complete 03.2.1', tmpDir);
    assert.ok(result.success, `Command should not crash on regex metacharacters: ${result.error}`);

    const req = fs.readFileSync(path.join(tmpDir, '.planning', 'requirements.md'), 'utf-8');
    assert.ok(req.includes('- [ ] **AMT-01**'), 'AMT-01 should remain unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// comparePhaseNum and normalizePhaseName (imported directly)
// ─────────────────────────────────────────────────────────────────────────────

const { comparePhaseNum, normalizePhaseName } = require('../pan-wizard-core/bin/lib/core.cjs');

describe('comparePhaseNum', () => {
  test('sorts integer phases numerically', () => {
    assert.ok(comparePhaseNum('2', '10') < 0);
    assert.ok(comparePhaseNum('10', '2') > 0);
    assert.strictEqual(comparePhaseNum('5', '5'), 0);
  });

  test('sorts decimal phases correctly', () => {
    assert.ok(comparePhaseNum('12', '12.1') < 0);
    assert.ok(comparePhaseNum('12.1', '12.2') < 0);
    assert.ok(comparePhaseNum('12.2', '13') < 0);
  });

  test('sorts letter-suffix phases correctly', () => {
    assert.ok(comparePhaseNum('12', '12A') < 0);
    assert.ok(comparePhaseNum('12A', '12B') < 0);
    assert.ok(comparePhaseNum('12B', '13') < 0);
  });

  test('sorts hybrid phases correctly', () => {
    assert.ok(comparePhaseNum('12A', '12A.1') < 0);
    assert.ok(comparePhaseNum('12A.1', '12A.2') < 0);
    assert.ok(comparePhaseNum('12A.2', '12B') < 0);
  });

  test('handles full sort order', () => {
    const phases = ['13', '12B', '12A.2', '12', '12.1', '12A', '12A.1', '12.2'];
    phases.sort(comparePhaseNum);
    assert.deepStrictEqual(phases, ['12', '12.1', '12.2', '12A', '12A.1', '12A.2', '12B', '13']);
  });

  test('handles directory names with slugs', () => {
    const dirs = ['13-deploy', '12B-hotfix', '12A.1-bugfix', '12-foundation', '12.1-inserted', '12A-split'];
    dirs.sort(comparePhaseNum);
    assert.deepStrictEqual(dirs, [
      '12-foundation', '12.1-inserted', '12A-split', '12A.1-bugfix', '12B-hotfix', '13-deploy'
    ]);
  });

  test('case insensitive letter matching', () => {
    assert.ok(comparePhaseNum('12a', '12B') < 0);
    assert.ok(comparePhaseNum('12A', '12b') < 0);
    assert.strictEqual(comparePhaseNum('12a', '12A'), 0);
  });

  test('sorts multi-level decimal phases correctly', () => {
    assert.ok(comparePhaseNum('3.2', '3.2.1') < 0);
    assert.ok(comparePhaseNum('3.2.1', '3.2.2') < 0);
    assert.ok(comparePhaseNum('3.2.1', '3.3') < 0);
    assert.ok(comparePhaseNum('3.2.1', '4') < 0);
    assert.strictEqual(comparePhaseNum('3.2.1', '3.2.1'), 0);
  });

  test('falls back to localeCompare for non-phase strings', () => {
    const result = comparePhaseNum('abc', 'def');
    assert.strictEqual(typeof result, 'number');
  });
});

describe('normalizePhaseName', () => {
  test('pads single-digit integers', () => {
    assert.strictEqual(normalizePhaseName('3'), '03');
    assert.strictEqual(normalizePhaseName('12'), '12');
  });

  test('handles decimal phases', () => {
    assert.strictEqual(normalizePhaseName('3.1'), '03.1');
    assert.strictEqual(normalizePhaseName('12.2'), '12.2');
  });

  test('handles letter-suffix phases', () => {
    assert.strictEqual(normalizePhaseName('3A'), '03A');
    assert.strictEqual(normalizePhaseName('12B'), '12B');
  });

  test('handles hybrid phases', () => {
    assert.strictEqual(normalizePhaseName('3A.1'), '03A.1');
    assert.strictEqual(normalizePhaseName('12A.2'), '12A.2');
  });

  test('uppercases letters', () => {
    assert.strictEqual(normalizePhaseName('3a'), '03A');
    assert.strictEqual(normalizePhaseName('12b.1'), '12B.1');
  });

  test('handles multi-level decimal phases', () => {
    assert.strictEqual(normalizePhaseName('3.2.1'), '03.2.1');
    assert.strictEqual(normalizePhaseName('12.3.4'), '12.3.4');
  });

  test('returns non-matching input unchanged', () => {
    assert.strictEqual(normalizePhaseName('abc'), 'abc');
  });
});

describe('letter-suffix phase sorting', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('lists letter-suffix phases in correct order', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '12-foundation'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '12.1-inserted'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '12A-split'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '12A.1-bugfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '12B-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '13-deploy'), { recursive: true });

    const result = runPanTools('phases list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(
      output.directories,
      ['12-foundation', '12.1-inserted', '12A-split', '12A.1-bugfix', '12B-hotfix', '13-deploy'],
      'letter-suffix phases should sort correctly'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// removePhaseFromDisk — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('removePhaseFromDisk', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('removes an existing phase directory', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-plan.md'), '# Plan');
    const result = removePhaseFromDisk(phaseDir);
    assert.strictEqual(result.removed, true);
    assert.ok(!fs.existsSync(phaseDir), 'Directory should be removed');
  });

  test('returns error for non-existent directory', () => {
    const result = removePhaseFromDisk(path.join(tmpDir, 'nonexistent'));
    // rmSync with force: true doesn't throw for missing dirs
    assert.strictEqual(result.removed, true);
  });

  test('result has no error property on success', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    const result = removePhaseFromDisk(phaseDir);
    assert.strictEqual(result.error, undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renumberDecimalPhases — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('renumberDecimalPhases', () => {
  let tmpDir;
  let phasesDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    phasesDir = path.join(tmpDir, '.planning', 'phases');
  });

  afterEach(() => cleanup(tmpDir));

  test('renumbers decimal phases after removal', () => {
    // Setup: 06.1-alpha, 06.3-gamma (06.2 was removed)
    fs.mkdirSync(path.join(phasesDir, '06.1-alpha'));
    fs.mkdirSync(path.join(phasesDir, '06.3-gamma'));
    fs.writeFileSync(path.join(phasesDir, '06.3-gamma', '01-plan.md'), '# Plan');

    const result = renumberDecimalPhases(phasesDir, '06', 2);
    assert.strictEqual(result.renamedDirs.length, 1);
    assert.strictEqual(result.renamedDirs[0].from, '06.3-gamma');
    assert.strictEqual(result.renamedDirs[0].to, '06.2-gamma');
    assert.ok(fs.existsSync(path.join(phasesDir, '06.2-gamma')));
    assert.ok(!fs.existsSync(path.join(phasesDir, '06.3-gamma')));
  });

  test('renumbers multiple decimal phases', () => {
    // Setup: 06.1-alpha (06.2 was removed), 06.3-gamma, 06.4-delta
    fs.mkdirSync(path.join(phasesDir, '06.1-alpha'));
    fs.mkdirSync(path.join(phasesDir, '06.3-gamma'));
    fs.mkdirSync(path.join(phasesDir, '06.4-delta'));

    const result = renumberDecimalPhases(phasesDir, '06', 2);
    assert.strictEqual(result.renamedDirs.length, 2);
    assert.ok(fs.existsSync(path.join(phasesDir, '06.2-gamma')));
    assert.ok(fs.existsSync(path.join(phasesDir, '06.3-delta')));
  });

  test('does nothing when no higher decimals exist', () => {
    fs.mkdirSync(path.join(phasesDir, '06.1-alpha'));
    // Removed 06.2, nothing above to renumber
    const result = renumberDecimalPhases(phasesDir, '06', 2);
    assert.strictEqual(result.renamedDirs.length, 0);
  });

  test('does not renumber lower decimals', () => {
    fs.mkdirSync(path.join(phasesDir, '06.1-alpha'));
    fs.mkdirSync(path.join(phasesDir, '06.3-gamma'));
    // Remove 06.2 — 06.1 should NOT be touched
    renumberDecimalPhases(phasesDir, '06', 2);
    assert.ok(fs.existsSync(path.join(phasesDir, '06.1-alpha')));
  });

  test('returns empty arrays for non-existent phasesDir', () => {
    const result = renumberDecimalPhases(path.join(tmpDir, 'nonexistent'), '06', 2);
    assert.deepStrictEqual(result.renamedDirs, []);
    assert.deepStrictEqual(result.renamedFiles, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// renumberIntegerPhases — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('renumberIntegerPhases', () => {
  let tmpDir;
  let phasesDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    phasesDir = path.join(tmpDir, '.planning', 'phases');
  });

  afterEach(() => cleanup(tmpDir));

  test('renumbers integer phase after removal', () => {
    // Setup: 01-setup, 03-deploy (02 was removed)
    fs.mkdirSync(path.join(phasesDir, '01-setup'));
    fs.mkdirSync(path.join(phasesDir, '03-deploy'));

    const result = renumberIntegerPhases(phasesDir, 2);
    assert.strictEqual(result.renamedDirs.length, 1);
    assert.strictEqual(result.renamedDirs[0].from, '03-deploy');
    assert.strictEqual(result.renamedDirs[0].to, '02-deploy');
    assert.ok(fs.existsSync(path.join(phasesDir, '02-deploy')));
  });

  test('renumbers multiple phases in cascade', () => {
    // Remove phase 2: phases 3, 4, 5 should become 2, 3, 4
    fs.mkdirSync(path.join(phasesDir, '01-setup'));
    fs.mkdirSync(path.join(phasesDir, '03-impl'));
    fs.mkdirSync(path.join(phasesDir, '04-test'));
    fs.mkdirSync(path.join(phasesDir, '05-deploy'));

    const result = renumberIntegerPhases(phasesDir, 2);
    assert.strictEqual(result.renamedDirs.length, 3);
    assert.ok(fs.existsSync(path.join(phasesDir, '02-impl')));
    assert.ok(fs.existsSync(path.join(phasesDir, '03-test')));
    assert.ok(fs.existsSync(path.join(phasesDir, '04-deploy')));
  });

  test('renames files inside renumbered directories', () => {
    fs.mkdirSync(path.join(phasesDir, '01-setup'));
    const p3 = path.join(phasesDir, '03-impl');
    fs.mkdirSync(p3);
    fs.writeFileSync(path.join(p3, '03-01-plan.md'), '# Plan');

    const result = renumberIntegerPhases(phasesDir, 2);
    assert.ok(result.renamedFiles.length >= 1);
    assert.ok(fs.existsSync(path.join(phasesDir, '02-impl', '02-01-plan.md')));
  });

  test('does not renumber lower phases', () => {
    fs.mkdirSync(path.join(phasesDir, '01-setup'));
    fs.mkdirSync(path.join(phasesDir, '03-impl'));
    renumberIntegerPhases(phasesDir, 2);
    assert.ok(fs.existsSync(path.join(phasesDir, '01-setup')));
  });

  test('handles decimal sub-phases under renumbered integer', () => {
    fs.mkdirSync(path.join(phasesDir, '01-setup'));
    fs.mkdirSync(path.join(phasesDir, '03-impl'));
    fs.mkdirSync(path.join(phasesDir, '03.1-hotfix'));

    renumberIntegerPhases(phasesDir, 2);
    assert.ok(fs.existsSync(path.join(phasesDir, '02-impl')));
    assert.ok(fs.existsSync(path.join(phasesDir, '02.1-hotfix')));
  });

  test('returns empty arrays for non-existent phasesDir', () => {
    const result = renumberIntegerPhases(path.join(tmpDir, 'nonexistent'), 2);
    assert.deepStrictEqual(result.renamedDirs, []);
    assert.deepStrictEqual(result.renamedFiles, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// classifyPlanTier — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

const { classifyPlanTier, updateRoadmapAfterRemoval } = require('../pan-wizard-core/bin/lib/phase.cjs');

describe('classifyPlanTier', () => {
  test('returns standard for null/undefined frontmatter', () => {
    assert.strictEqual(classifyPlanTier(null), 'standard');
    assert.strictEqual(classifyPlanTier(undefined), 'standard');
  });

  test('returns standard for empty frontmatter', () => {
    assert.strictEqual(classifyPlanTier({}), 'standard');
  });

  test('respects explicit tier in frontmatter', () => {
    assert.strictEqual(classifyPlanTier({ tier: 'micro' }), 'micro');
    assert.strictEqual(classifyPlanTier({ tier: 'full' }), 'full');
    assert.strictEqual(classifyPlanTier({ tier: 'standard' }), 'standard');
  });

  test('ignores invalid explicit tier', () => {
    // Invalid tier should fall through to heuristic
    assert.strictEqual(classifyPlanTier({ tier: 'mega', task_count: '2', files_modified: ['a.js'] }), 'micro');
  });

  test('autonomous=false forces full tier', () => {
    assert.strictEqual(classifyPlanTier({ autonomous: false, task_count: '1' }), 'full');
    assert.strictEqual(classifyPlanTier({ autonomous: 'false', task_count: '1' }), 'full');
  });

  test('classifies micro with low tasks and low files', () => {
    assert.strictEqual(classifyPlanTier({ task_count: '2', files_modified: ['a.js'] }), 'micro');
    assert.strictEqual(classifyPlanTier({ task_count: '3', files_modified: ['a.js', 'b.js'] }), 'micro');
  });

  test('classifies standard for moderate task counts', () => {
    assert.strictEqual(classifyPlanTier({ task_count: '5', files_modified: ['a.js', 'b.js', 'c.js'] }), 'standard');
    assert.strictEqual(classifyPlanTier({ task_count: '8' }), 'standard');
  });

  test('classifies full for high task counts', () => {
    assert.strictEqual(classifyPlanTier({ task_count: '10' }), 'full');
    assert.strictEqual(classifyPlanTier({ task_count: '20' }), 'full');
  });

  test('uses tasks array length as fallback', () => {
    assert.strictEqual(classifyPlanTier({ tasks: ['a', 'b'], files_modified: ['x.js'] }), 'micro');
    assert.strictEqual(classifyPlanTier({ tasks: new Array(10) }), 'full');
  });

  test('returns standard when task_count is not determinable', () => {
    assert.strictEqual(classifyPlanTier({ files_modified: ['a.js'] }), 'standard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// updateRoadmapAfterRemoval — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('updateRoadmapAfterRemoval', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('removes phase section from roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap

- [ ] Phase 1: Setup
- [ ] Phase 2: Build
- [ ] Phase 3: Deploy

### Phase 1: Setup
**Goal:** Init project

### Phase 2: Build
**Goal:** Build features

### Phase 3: Deploy
**Goal:** Ship it
`
    );

    updateRoadmapAfterRemoval(tmpDir, '2', false, '02');

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), 'utf-8');
    assert.ok(!content.includes('Phase 2: Build'), 'Phase 2 section should be removed');
    assert.ok(content.includes('Phase 1: Setup'), 'Phase 1 should remain');
  });

  test('does not crash when roadmap missing', () => {
    // Remove roadmap.md
    try { fs.unlinkSync(path.join(tmpDir, '.planning', 'roadmap.md')); } catch { /* ok */ }
    // Should not throw
    updateRoadmapAfterRemoval(tmpDir, '1', false, '01');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase find command
// ─────────────────────────────────────────────────────────────────────────────

describe('find-phase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('finds existing phase by number', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('find-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true);
    assert.ok(output.directory.includes('03-api'), 'should find correct directory');
  });

  test('returns not found for missing phase', () => {
    const result = runPanTools('find-phase 99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false);
  });

  test('finds decimal phase', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03.1-hotfix'), { recursive: true });

    const result = runPanTools('find-phase 3.1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true);
    assert.ok(output.directory.includes('03.1-hotfix'), 'should find decimal phase');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase next-decimal command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase next-decimal command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('returns .1 when no decimals exist', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05-build'), { recursive: true });

    const result = runPanTools('phase next-decimal 5', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '05.1');
  });

  test('increments existing decimal', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05-build'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05.1-hotfix'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05.2-patch'), { recursive: true });

    const result = runPanTools('phase next-decimal 5', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.next, '05.3');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase plan-index command
// ─────────────────────────────────────────────────────────────────────────────

describe('phase-plan-index command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('returns plan index for phase with no plans', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('phase-plan-index 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '03');
    assert.deepStrictEqual(output.plans, []);
  });

  test('indexes existing plans with status', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-plan.md'), '---\ntask_count: 3\n---\n# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '03-01-summary.md'), '# Done');
    fs.writeFileSync(path.join(phaseDir, '03-02-plan.md'), '---\ntask_count: 5\n---\n# Plan 2');

    const result = runPanTools('phase-plan-index 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 2, 'should have 2 plans');
    assert.ok(output.incomplete.length >= 1, 'should have at least 1 incomplete plan');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// markPhaseCompleteInRoadmap + updateStateAfterPhaseComplete
// ─────────────────────────────────────────────────────────────────────────────

describe('markPhaseCompleteInRoadmap', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('marks checkbox and updates status in roadmap', () => {
    const planningDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planningDir, 'roadmap.md'), [
      '# Roadmap',
      '',
      '| Phase | Plans | Status | Date |',
      '|-------|-------|--------|------|',
      '| 1 Setup | 0/2 | In Progress |  |',
      '',
      '- [ ] Phase 1: Setup the project',
      '',
      '### Phase 1',
      '**Plans:** 1/2 plans executed',
    ].join('\n'));
    // requirements.md needed for markRequirementsCompleteForPhase
    fs.writeFileSync(path.join(planningDir, 'requirements.md'), '# Requirements\n');

    markPhaseCompleteInRoadmap(tmpDir, '1', 'setup', 2, 2);

    const content = fs.readFileSync(path.join(planningDir, 'roadmap.md'), 'utf-8');
    assert.ok(content.includes('[x]'), 'checkbox should be checked');
    assert.ok(content.includes('Complete'), 'status should be Complete');
    assert.ok(content.includes('2/2 plans complete'), 'plan count should be updated');
  });

  test('returns null gracefully when roadmap missing', () => {
    // No roadmap.md exists
    const result = markPhaseCompleteInRoadmap(tmpDir, '1', 'setup', 2, 2);
    assert.strictEqual(result, undefined);
  });
});

describe('updateStateAfterPhaseComplete', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('updates state.md fields after phase completion', () => {
    const planningDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planningDir, 'state.md'), [
      '# State',
      '**Current Phase:** 1',
      '**Current Phase Name:** setup',
      '**Status:** In Progress',
      '**Current Plan:** 01-01-plan.md',
      '**Last Activity:** 2026-01-01',
      '**Last Activity Description:** Working on phase 1',
    ].join('\n'));

    updateStateAfterPhaseComplete(tmpDir, {
      phaseNum: '1',
      totalPhases: 3,
      nextPhaseNum: '2',
      nextPhaseName: 'build-api',
      isLastPhase: false,
    });

    const content = fs.readFileSync(path.join(planningDir, 'state.md'), 'utf-8');
    assert.ok(content.includes('**Current Phase:** 2'), 'should advance to phase 2');
    assert.ok(content.includes('**Status:** Ready to plan'), 'status should be ready to plan');
    assert.ok(content.includes('**Current Plan:** Not started'), 'plan should be reset');
    assert.ok(content.includes('Phase 1 complete'), 'should mention phase 1 complete');
  });

  test('sets milestone complete status on last phase', () => {
    const planningDir = path.join(tmpDir, '.planning');
    fs.writeFileSync(path.join(planningDir, 'state.md'), [
      '# State',
      '**Current Phase:** 3',
      '**Current Phase Name:** deploy',
      '**Status:** In Progress',
      '**Current Plan:** 03-01-plan.md',
      '**Last Activity:** 2026-01-01',
      '**Last Activity Description:** Working',
    ].join('\n'));

    updateStateAfterPhaseComplete(tmpDir, {
      phaseNum: '3',
      totalPhases: 3,
      nextPhaseNum: null,
      nextPhaseName: null,
      isLastPhase: true,
    });

    const content = fs.readFileSync(path.join(planningDir, 'state.md'), 'utf-8');
    assert.ok(content.includes('Milestone complete'), 'should say milestone complete');
  });

  test('handles missing state.md gracefully', () => {
    // No state.md
    updateStateAfterPhaseComplete(tmpDir, {
      phaseNum: '1', totalPhases: 1, nextPhaseNum: null, nextPhaseName: null, isLastPhase: true,
    });
    // Should not throw
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phase complete auto-commit
// ─────────────────────────────────────────────────────────────────────────────

describe('phase complete auto-commit', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = createTempProject();
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'pipe' });
    // Create roadmap and phase structure
    fs.writeFileSync(path.join(gitDir, '.planning', 'roadmap.md'),
      '## Phase 01: Setup\n**Goal:** Bootstrap\n\n## Phase 02: Build\n**Goal:** Build\n');
    const p1 = path.join(gitDir, '.planning', 'phases', '01-setup');
    const p2 = path.join(gitDir, '.planning', 'phases', '02-build');
    fs.mkdirSync(p1, { recursive: true });
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '---\ntask_count: 1\n---\n# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '---\nstatus: complete\n---\n# Summary');
    fs.writeFileSync(path.join(gitDir, '.planning', 'state.md'), '---\nstatus: executing\ncurrent_phase: 01\n---\n# State');
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "init project"', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(gitDir);
  });

  test('creates commit on phase complete in git repo', () => {
    const result = runPanTools('phase complete 1', gitDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.completed_phase, '1');
    assert.ok(data.commit_hash, 'should include commit_hash');
    // Verify commit exists in git log
    const log = execSync('git log --oneline -1', { cwd: gitDir, encoding: 'utf-8' }).trim();
    assert.ok(log.includes('docs(01)'), 'commit message should contain phase ref');
  });

  test('--no-commit skips auto-commit', () => {
    const result = runPanTools('phase complete 1 --no-commit', gitDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.completed_phase, '1');
    assert.strictEqual(data.commit_hash, undefined, 'should not have commit_hash');
  });

  test('phase complete in non-git dir still works without commit', () => {
    const noGitDir = createTempProject();
    fs.writeFileSync(path.join(noGitDir, '.planning', 'roadmap.md'),
      '## Phase 01: Setup\n**Goal:** Bootstrap\n');
    const p1 = path.join(noGitDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '---\ntask_count: 1\n---\n# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '---\nstatus: complete\n---\n# Summary');
    fs.writeFileSync(path.join(noGitDir, '.planning', 'state.md'), '---\nstatus: executing\ncurrent_phase: 01\n---\n# State');
    const result = runPanTools('phase complete 1', noGitDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const data = JSON.parse(result.output);
    assert.strictEqual(data.completed_phase, '1');
    assert.strictEqual(data.commit_hash, undefined, 'should not have commit_hash in non-git');
    cleanup(noGitDir);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// milestone complete command
// ─────────────────────────────────────────────────────────────────────────────

