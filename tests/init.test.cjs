/**
 * PAN Tools Tests - Init
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('init commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('init execute-phase returns file paths', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-plan.md'), '# Plan');

    const result = runPanTools('init execute-phase 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_path, '.planning/state.md');
    assert.strictEqual(output.roadmap_path, '.planning/roadmap.md');
    assert.strictEqual(output.config_path, '.planning/config.json');
  });

  test('init plan-phase returns file paths', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-context.md'), '# Phase Context');
    fs.writeFileSync(path.join(phaseDir, '03-research.md'), '# Research Findings');
    fs.writeFileSync(path.join(phaseDir, '03-verification.md'), '# Verification');
    fs.writeFileSync(path.join(phaseDir, '03-uat.md'), '# UAT');

    const result = runPanTools('init plan-phase 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_path, '.planning/state.md');
    assert.strictEqual(output.roadmap_path, '.planning/roadmap.md');
    assert.strictEqual(output.requirements_path, '.planning/requirements.md');
    assert.strictEqual(output.context_path, '.planning/phases/03-api/03-context.md');
    assert.strictEqual(output.research_path, '.planning/phases/03-api/03-research.md');
    assert.strictEqual(output.verification_path, '.planning/phases/03-api/03-verification.md');
    assert.strictEqual(output.uat_path, '.planning/phases/03-api/03-uat.md');
  });

  test('init progress returns file paths', () => {
    const result = runPanTools('init progress', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_path, '.planning/state.md');
    assert.strictEqual(output.roadmap_path, '.planning/roadmap.md');
    assert.strictEqual(output.project_path, '.planning/project.md');
    assert.strictEqual(output.config_path, '.planning/config.json');
  });

  test('init phase-op returns core and optional phase file paths', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-context.md'), '# Phase Context');
    fs.writeFileSync(path.join(phaseDir, '03-research.md'), '# Research');
    fs.writeFileSync(path.join(phaseDir, '03-verification.md'), '# Verification');
    fs.writeFileSync(path.join(phaseDir, '03-uat.md'), '# UAT');

    const result = runPanTools('init phase-op 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_path, '.planning/state.md');
    assert.strictEqual(output.roadmap_path, '.planning/roadmap.md');
    assert.strictEqual(output.requirements_path, '.planning/requirements.md');
    assert.strictEqual(output.context_path, '.planning/phases/03-api/03-context.md');
    assert.strictEqual(output.research_path, '.planning/phases/03-api/03-research.md');
    assert.strictEqual(output.verification_path, '.planning/phases/03-api/03-verification.md');
    assert.strictEqual(output.uat_path, '.planning/phases/03-api/03-uat.md');
  });

  test('init plan-phase omits optional paths if files missing', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('init plan-phase 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.context_path, undefined);
    assert.strictEqual(output.research_path, undefined);
  });

  // ── phase_req_ids extraction (fix for #684) ──────────────────────────────

  test('init plan-phase extracts phase_req_ids from ROADMAP', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 3: API\n**Goal:** Build API\n**Requirements**: CP-01, CP-02, CP-03\n**Plans:** 0 plans\n`
    );

    const result = runPanTools('init plan-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, 'CP-01, CP-02, CP-03');
  });

  test('init plan-phase strips brackets from phase_req_ids', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 3: API\n**Goal:** Build API\n**Requirements**: [CP-01, CP-02]\n**Plans:** 0 plans\n`
    );

    const result = runPanTools('init plan-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, 'CP-01, CP-02');
  });

  test('init plan-phase returns null phase_req_ids when Requirements line is absent', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 3: API\n**Goal:** Build API\n**Plans:** 0 plans\n`
    );

    const result = runPanTools('init plan-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, null);
  });

  test('init plan-phase returns null phase_req_ids when ROADMAP is absent', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('init plan-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, null);
  });

  test('init execute-phase extracts phase_req_ids from ROADMAP', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-plan.md'), '# Plan');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 3: API\n**Goal:** Build API\n**Requirements**: EX-01, EX-02\n**Plans:** 1 plans\n`
    );

    const result = runPanTools('init execute-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, 'EX-01, EX-02');
  });

  test('init plan-phase returns null phase_req_ids when value is TBD', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 3: API\n**Goal:** Build API\n**Requirements**: TBD\n**Plans:** 0 plans\n`
    );

    const result = runPanTools('init plan-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, null, 'TBD placeholder should return null');
  });

  test('init execute-phase returns null phase_req_ids when Requirements line is absent', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-01-plan.md'), '# Plan');
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap\n\n### Phase 3: API\n**Goal:** Build API\n**Plans:** 1 plans\n`
    );

    const result = runPanTools('init execute-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_req_ids, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init new-project command
// ─────────────────────────────────────────────────────────────────────────────

describe('init new-project command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns greenfield detection for empty project', () => {
    const result = runPanTools('init new-project', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.planning_exists, true, 'planning dir exists from createTempProject');
    assert.strictEqual(output.project_exists, false, 'no project.md yet');
    assert.strictEqual(output.is_brownfield, false, 'no source files');
    assert.strictEqual(typeof output.researcher_model, 'string');
    assert.strictEqual(typeof output.commit_docs, 'boolean');
  });

  test('detects brownfield when package.json exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    const result = runPanTools('init new-project', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_package_file, true);
    assert.strictEqual(output.is_brownfield, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init resume command
// ─────────────────────────────────────────────────────────────────────────────

describe('init resume command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns file existence checks', () => {
    const result = runPanTools('init resume', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_exists, false);
    assert.strictEqual(output.roadmap_exists, false);
    assert.strictEqual(output.planning_exists, true);
    assert.strictEqual(output.has_interrupted_agent, false);
    assert.strictEqual(output.interrupted_agent_id, null);
  });

  test('detects interrupted agent', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'current-agent-id.txt'), 'agent-123');

    const result = runPanTools('init resume', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_interrupted_agent, true);
    assert.strictEqual(output.interrupted_agent_id, 'agent-123');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init quick command
// ─────────────────────────────────────────────────────────────────────────────

describe('init quick command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns next_num 1 for first quick task', () => {
    const result = runPanTools('init quick fix-typo', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next_num, 1);
    assert.strictEqual(output.slug, 'fix-typo');
    assert.strictEqual(output.description, 'fix-typo');
    assert.ok(output.task_dir.includes('1-fix-typo'));
  });

  test('auto-increments next_num', () => {
    const quickDir = path.join(tmpDir, '.planning', 'quick');
    fs.mkdirSync(path.join(quickDir, '1-first-task'), { recursive: true });
    fs.mkdirSync(path.join(quickDir, '2-second-task'), { recursive: true });

    const result = runPanTools('init quick third-task', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.next_num, 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init todos command
// ─────────────────────────────────────────────────────────────────────────────

describe('init todos command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns empty list when no todos exist', () => {
    const result = runPanTools('init todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.todo_count, 0);
    assert.deepStrictEqual(output.todos, []);
  });

  test('lists pending todos', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'todo-1.md'), 'title: Fix bug\narea: backend\ncreated: 2026-02-28');

    const result = runPanTools('init todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.todo_count, 1);
    assert.strictEqual(output.todos[0].title, 'Fix bug');
    assert.strictEqual(output.todos[0].area, 'backend');
  });

  test('filters by area', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'todo-1.md'), 'title: Fix bug\narea: backend\ncreated: 2026-02-28');
    fs.writeFileSync(path.join(pendingDir, 'todo-2.md'), 'title: Style fix\narea: frontend\ncreated: 2026-02-28');

    const result = runPanTools('init todos backend', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.todo_count, 1);
    assert.strictEqual(output.todos[0].title, 'Fix bug');
    assert.strictEqual(output.area_filter, 'backend');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init new-milestone command
// ─────────────────────────────────────────────────────────────────────────────

describe('init new-milestone command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns milestone context with models and paths', () => {
    const result = runPanTools('init new-milestone', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.researcher_model, 'should include researcher_model');
    assert.ok(output.roadmapper_model, 'should include roadmapper_model');
    assert.strictEqual(output.project_path, '.planning/project.md');
    assert.strictEqual(output.roadmap_path, '.planning/roadmap.md');
    assert.strictEqual(output.state_path, '.planning/state.md');
  });

  test('reports file existence correctly', () => {
    const result = runPanTools('init new-milestone', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.project_exists, false);
    assert.strictEqual(output.roadmap_exists, false);
    assert.strictEqual(output.state_exists, false);
  });

  test('returns config fields', () => {
    const result = runPanTools('init new-milestone', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.commit_docs, 'boolean');
    assert.strictEqual(typeof output.research_enabled, 'boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init milestone-op command
// ─────────────────────────────────────────────────────────────────────────────

describe('init milestone-op command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns milestone-op context with zero phases', () => {
    const result = runPanTools('init milestone-op', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_count, 0);
    assert.strictEqual(output.completed_phases, 0);
    assert.strictEqual(output.all_phases_complete, false);
    assert.strictEqual(output.archive_count, 0);
  });

  test('counts phases correctly', () => {
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    fs.mkdirSync(path.join(phasesDir, '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(phasesDir, '02-build'), { recursive: true });
    fs.writeFileSync(path.join(phasesDir, '01-setup', '01-01-summary.md'), '# Summary');

    const result = runPanTools('init milestone-op', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_count, 2);
    assert.strictEqual(output.completed_phases, 1);
    assert.strictEqual(output.all_phases_complete, false);
  });

  test('reports all complete when all phases have summaries', () => {
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    fs.mkdirSync(path.join(phasesDir, '01-setup'), { recursive: true });
    fs.writeFileSync(path.join(phasesDir, '01-setup', '01-01-summary.md'), '# Summary');

    const result = runPanTools('init milestone-op', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_phases_complete, true);
  });

  test('includes config and file existence', () => {
    const result = runPanTools('init milestone-op', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.commit_docs, 'boolean');
    assert.strictEqual(output.project_exists, false);
    assert.strictEqual(output.roadmap_exists, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init map-codebase command
// ─────────────────────────────────────────────────────────────────────────────

describe('init map-codebase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns map-codebase context with no existing maps', () => {
    const result = runPanTools('init map-codebase', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.mapper_model, 'should include mapper_model');
    assert.strictEqual(output.has_maps, false);
    assert.deepStrictEqual(output.existing_maps, []);
    assert.strictEqual(output.codebase_dir, '.planning/codebase');
  });

  test('detects existing maps', () => {
    const codebaseDir = path.join(tmpDir, '.planning', 'codebase');
    fs.mkdirSync(codebaseDir, { recursive: true });
    fs.writeFileSync(path.join(codebaseDir, 'stack.md'), '# Stack');
    fs.writeFileSync(path.join(codebaseDir, 'arch.md'), '# Architecture');

    const result = runPanTools('init map-codebase', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_maps, true);
    assert.strictEqual(output.existing_maps.length, 2);
  });

  test('includes config fields', () => {
    const result = runPanTools('init map-codebase', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.commit_docs, 'boolean');
    assert.strictEqual(typeof output.planning_exists, 'boolean');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init verify-work command
// ─────────────────────────────────────────────────────────────────────────────

describe('init verify-work command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns verify-work context for existing phase', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('init verify-work 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_found, true);
    assert.strictEqual(output.phase_number, '03');
    assert.ok(output.planner_model, 'should include planner_model');
    assert.ok(output.checker_model, 'should include checker_model');
  });

  test('reports phase not found for missing phase', () => {
    const result = runPanTools('init verify-work 99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase_found, false);
    assert.strictEqual(output.phase_dir, null);
  });

  test('errors when phase arg missing', () => {
    const result = runPanTools('init verify-work', tmpDir);
    assert.ok(!result.success, 'should fail without phase arg');
  });

  test('detects existing verification file', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-verification.md'), '# Verification');

    const result = runPanTools('init verify-work 03', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_verification, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init new-project git initialization (SCAN-010)
// ─────────────────────────────────────────────────────────────────────────────

describe('init new-project git initialization', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('initializes git repo when none exists', () => {
    // tmpDir has no .git — init new-project should create one
    const result = runPanTools('init new-project', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_git, true, 'should have initialized git');
    // Verify .git actually exists
    assert.ok(fs.existsSync(path.join(tmpDir, '.git')), '.git dir should exist');
  });

  test('leaves existing git repo untouched', () => {
    // Pre-initialize git
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });

    const logBefore = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf-8' }).trim();

    const result = runPanTools('init new-project', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.has_git, true, 'should report existing git');

    // Verify existing repo wasn't reset
    const logAfter = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.strictEqual(logAfter, logBefore, 'git history should be unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// roadmap analyze command
// ─────────────────────────────────────────────────────────────────────────────

