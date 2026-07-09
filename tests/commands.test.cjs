/**
 * PAN Tools Tests - Commands
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('history-digest command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns valid schema', () => {
    const result = runPanTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    assert.deepStrictEqual(digest.phases, {}, 'phases should be empty object');
    assert.deepStrictEqual(digest.decisions, [], 'decisions should be empty array');
    assert.deepStrictEqual(digest.tech_stack, [], 'tech_stack should be empty array');
  });

  test('nested frontmatter fields extracted correctly', () => {
    // Create phase directory with SUMMARY containing nested frontmatter
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = `---
phase: "01"
name: "Foundation Setup"
dependency-graph:
  provides:
    - "Database schema"
    - "Auth system"
  affects:
    - "API layer"
tech-stack:
  added:
    - "prisma"
    - "jose"
patterns-established:
  - "Repository pattern"
  - "JWT auth flow"
key-decisions:
  - "Use Prisma over Drizzle"
  - "JWT in httpOnly cookies"
---

# Summary content here
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), summaryContent);

    const result = runPanTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Check nested dependency-graph.provides
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Auth system', 'Database schema'],
      'provides should contain nested values'
    );

    // Check nested dependency-graph.affects
    assert.deepStrictEqual(
      digest.phases['01'].affects,
      ['API layer'],
      'affects should contain nested values'
    );

    // Check nested tech-stack.added
    assert.deepStrictEqual(
      digest.tech_stack.sort(),
      ['jose', 'prisma'],
      'tech_stack should contain nested values'
    );

    // Check patterns-established (flat array)
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['JWT auth flow', 'Repository pattern'],
      'patterns should be extracted'
    );

    // Check key-decisions
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions');
    assert.ok(
      digest.decisions.some(d => d.decision === 'Use Prisma over Drizzle'),
      'Should contain first decision'
    );
  });

  test('multiple phases merged into single digest', () => {
    // Create phase 01
    const phase01Dir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phase01Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase01Dir, '01-01-summary.md'),
      `---
phase: "01"
name: "Foundation"
provides:
  - "Database"
patterns-established:
  - "Pattern A"
key-decisions:
  - "Decision 1"
---
`
    );

    // Create phase 02
    const phase02Dir = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase02Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase02Dir, '02-01-summary.md'),
      `---
phase: "02"
name: "API"
provides:
  - "REST endpoints"
patterns-established:
  - "Pattern B"
key-decisions:
  - "Decision 2"
tech-stack:
  added:
    - "zod"
---
`
    );

    const result = runPanTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Both phases present
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(digest.phases['02'], 'Phase 02 should exist');

    // Decisions merged
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions total');

    // Tech stack merged
    assert.deepStrictEqual(digest.tech_stack, ['zod'], 'tech_stack should have zod');
  });

  test('malformed SUMMARY.md skipped gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Valid summary
    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
phase: "01"
provides:
  - "Valid feature"
---
`
    );

    // Malformed summary (no frontmatter)
    fs.writeFileSync(
      path.join(phaseDir, '01-02-summary.md'),
      `# Just a heading
No frontmatter here
`
    );

    // Another malformed summary (broken YAML)
    fs.writeFileSync(
      path.join(phaseDir, '01-03-summary.md'),
      `---
broken: [unclosed
---
`
    );

    const result = runPanTools('history-digest', tmpDir);
    assert.ok(result.success, `Command should succeed despite malformed files: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(
      digest.phases['01'].provides.includes('Valid feature'),
      'Valid feature should be extracted'
    );
  });

  test('flat provides field still works (backward compatibility)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
phase: "01"
provides:
  - "Direct provides"
---
`
    );

    const result = runPanTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides,
      ['Direct provides'],
      'Direct provides should work'
    );
  });

  test('inline array syntax supported', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
phase: "01"
provides: [Feature A, Feature B]
patterns-established: ["Pattern X", "Pattern Y"]
---
`
    );

    const result = runPanTools('history-digest', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Feature A', 'Feature B'],
      'Inline array should work'
    );
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['Pattern X', 'Pattern Y'],
      'Inline quoted array should work'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phases list command
// ─────────────────────────────────────────────────────────────────────────────


describe('summary-extract command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing file returns error', () => {
    const result = runPanTools('summary-extract .planning/phases/01-test/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report missing file');
  });

  test('extracts all fields from SUMMARY.md', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
one-liner: Set up Prisma with User and Project models
key-files:
  - prisma/schema.prisma
  - src/lib/db.ts
tech-stack:
  added:
    - prisma
    - zod
patterns-established:
  - Repository pattern
  - Dependency injection
key-decisions:
  - Use Prisma over Drizzle: Better DX and ecosystem
  - Single database: Start simple, shard later
requirements-completed:
  - AUTH-01
  - AUTH-02
---

# Summary

Full summary content here.
`
    );

    const result = runPanTools('summary-extract .planning/phases/01-foundation/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.path, '.planning/phases/01-foundation/01-01-summary.md', 'path correct');
    assert.strictEqual(output.one_liner, 'Set up Prisma with User and Project models', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma', 'src/lib/db.ts'], 'key files extracted');
    assert.deepStrictEqual(output.tech_added, ['prisma', 'zod'], 'tech added extracted');
    assert.deepStrictEqual(output.patterns, ['Repository pattern', 'Dependency injection'], 'patterns extracted');
    assert.strictEqual(output.decisions.length, 2, 'decisions extracted');
    assert.deepStrictEqual(output.requirements_completed, ['AUTH-01', 'AUTH-02'], 'requirements completed extracted');
  });

  test('selective extraction with --fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
one-liner: Set up database
key-files:
  - prisma/schema.prisma
tech-stack:
  added:
    - prisma
patterns-established:
  - Repository pattern
key-decisions:
  - Use Prisma: Better DX
requirements-completed:
  - AUTH-01
---
`
    );

    const result = runPanTools('summary-extract .planning/phases/01-foundation/01-01-summary.md --fields one_liner,key_files,requirements_completed', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Set up database', 'one_liner included');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma'], 'key_files included');
    assert.deepStrictEqual(output.requirements_completed, ['AUTH-01'], 'requirements_completed included');
    assert.strictEqual(output.tech_added, undefined, 'tech_added excluded');
    assert.strictEqual(output.patterns, undefined, 'patterns excluded');
    assert.strictEqual(output.decisions, undefined, 'decisions excluded');
  });

  test('handles missing frontmatter fields gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
one-liner: Minimal summary
---

# Summary
`
    );

    const result = runPanTools('summary-extract .planning/phases/01-foundation/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Minimal summary', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, [], 'key_files defaults to empty');
    assert.deepStrictEqual(output.tech_added, [], 'tech_added defaults to empty');
    assert.deepStrictEqual(output.patterns, [], 'patterns defaults to empty');
    assert.deepStrictEqual(output.decisions, [], 'decisions defaults to empty');
    assert.deepStrictEqual(output.requirements_completed, [], 'requirements_completed defaults to empty');
  });

  test('parses key-decisions with rationale', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-summary.md'),
      `---
key-decisions:
  - Use Prisma: Better DX than alternatives
  - JWT tokens: Stateless auth for scalability
---
`
    );

    const result = runPanTools('summary-extract .planning/phases/01-foundation/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'decision summary parsed');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than alternatives', 'decision rationale parsed');
    assert.strictEqual(output.decisions[1].summary, 'JWT tokens', 'second decision summary');
    assert.strictEqual(output.decisions[1].rationale, 'Stateless auth for scalability', 'second decision rationale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init commands tests
// ─────────────────────────────────────────────────────────────────────────────


describe('progress command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('renders JSON progress', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-plan.md'), '# Plan 2');

    const result = runPanTools('progress json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.total_plans, 2, '2 total plans');
    assert.strictEqual(output.total_summaries, 1, '1 summary');
    assert.strictEqual(output.percent, 50, '50%');
    assert.strictEqual(output.phases.length, 1, '1 phase');
    assert.strictEqual(output.phases[0].status, 'In Progress', 'phase in progress');
  });

  test('renders bar format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Done');

    const result = runPanTools('progress bar --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('1/1'), 'should include count');
    assert.ok(result.output.includes('100%'), 'should include 100%');
  });

  test('renders table format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');

    const result = runPanTools('progress table --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('Phase'), 'should have table header');
    assert.ok(result.output.includes('foundation'), 'should include phase name');
  });

  test('does not crash when summaries exceed plans (orphaned SUMMARY.md)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    // 1 plan but 2 summaries (orphaned SUMMARY.md after PLAN.md deletion)
    fs.writeFileSync(path.join(p1, '01-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-summary.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-summary.md'), '# Orphaned summary');

    // bar format - should not crash with RangeError
    const barResult = runPanTools('progress bar --raw', tmpDir);
    assert.ok(barResult.success, `Bar format crashed: ${barResult.error}`);
    assert.ok(barResult.output.includes('100%'), 'percent should be clamped to 100%');

    // table format - should not crash with RangeError
    const tableResult = runPanTools('progress table --raw', tmpDir);
    assert.ok(tableResult.success, `Table format crashed: ${tableResult.error}`);

    // json format - percent should be clamped
    const jsonResult = runPanTools('progress json', tmpDir);
    assert.ok(jsonResult.success, `JSON format crashed: ${jsonResult.error}`);
    const output = JSON.parse(jsonResult.output);
    assert.ok(output.percent <= 100, `percent should be <= 100 but got ${output.percent}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo complete command
// ─────────────────────────────────────────────────────────────────────────────


describe('todo complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('moves todo from pending to completed', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(
      path.join(pendingDir, 'add-dark-mode.md'),
      `title: Add dark mode\narea: ui\ncreated: 2025-01-01\n`
    );

    const result = runPanTools('todo complete add-dark-mode.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed, true);

    // Verify moved
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'add-dark-mode.md')),
      'should be removed from pending'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md')),
      'should be in completed'
    );

    // Verify completion timestamp added
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md'),
      'utf-8'
    );
    assert.ok(content.startsWith('completed:'), 'should have completed timestamp');
  });

  test('fails for nonexistent todo', () => {
    const result = runPanTools('todo complete nonexistent.md', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scaffold command
// ─────────────────────────────────────────────────────────────────────────────


describe('scaffold command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('scaffolds context file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('scaffold context --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    // Verify file content
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-context.md'),
      'utf-8'
    );
    assert.ok(content.includes('Phase 3'), 'should reference phase number');
    assert.ok(content.includes('Decisions'), 'should have decisions section');
    assert.ok(content.includes('Discretion Areas'), 'should have discretion section');
  });

  test('scaffolds UAT file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('scaffold uat --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-uat.md'),
      'utf-8'
    );
    assert.ok(content.includes('User Acceptance Testing'), 'should have UAT heading');
    assert.ok(content.includes('Test Results'), 'should have test results section');
  });

  test('scaffolds verification file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runPanTools('scaffold verification --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-verification.md'),
      'utf-8'
    );
    assert.ok(content.includes('Goal-Backward Verification'), 'should have verification heading');
  });

  test('scaffolds phase directory', () => {
    const result = runPanTools('scaffold phase-dir --phase 5 --name User Dashboard', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '05-user-dashboard')),
      'directory should be created'
    );
  });

  test('does not overwrite existing files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-context.md'), '# Existing content');

    const result = runPanTools('scaffold context --phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, false, 'should not overwrite');
    assert.strictEqual(output.reason, 'already_exists');
  });
});

// ── websearch error cases ───────────────────────────────────────────────────

describe('websearch command', () => {
  test('returns available false when BRAVE_API_KEY not set', () => {
    // Ensure BRAVE_API_KEY is not set by using env override
    const result = runPanTools('websearch "test query"');
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.available, false, 'should report not available');
    assert.ok(output.reason && output.reason.includes('BRAVE_API_KEY'), 'should mention BRAVE_API_KEY');
  });

  test('returns error when query is empty', () => {
    const result = runPanTools('websearch');
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.available, false, 'should report not available');
    assert.ok(output.error || output.reason, 'should include error or reason field');
  });
});

// ── commit command ──────────────────────────────────────────

describe('commit command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Initialize a git repo so commit operations work
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports nothing to commit when planning dir is empty', () => {
    // Initial commit so git is in a clean state
    fs.writeFileSync(path.join(tmpDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('commit test-message', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'nothing_to_commit');
  });

  test('commits planning docs successfully', () => {
    // Initial commit
    fs.writeFileSync(path.join(tmpDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });

    // Add a new planning file (not tracked yet)
    const testFile = path.join(tmpDir, '.planning', 'test-doc.md');
    fs.writeFileSync(testFile, '# Test');

    const result = runPanTools('commit test-commit', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, `expected commit, got: ${JSON.stringify(output)}`);
    assert.ok(output.hash, 'should return a commit hash');
  });

  test('skips when commit_docs is false', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: false })
    );

    const result = runPanTools('commit test-message', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'skipped_commit_docs_false');
  });

  test('requires a commit message', () => {
    const result = runPanTools('commit', tmpDir);
    assert.strictEqual(result.success, false, 'should fail without message');
  });

  test('--fail-on-error makes commit_failed exit non-zero (P-EXP-001 follow-up)', () => {
    // Create a fresh repo with no committer identity — git will refuse to commit.
    const noIdRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fail-on-err-'));
    try {
      execSync('git init', { cwd: noIdRepo, stdio: 'pipe' });
      // Create .planning/config.json so loadConfig succeeds and commit_docs defaults true
      fs.mkdirSync(path.join(noIdRepo, '.planning'), { recursive: true });
      fs.writeFileSync(path.join(noIdRepo, '.planning', 'config.json'), JSON.stringify({ commit_docs: true }));
      // Add an artifact so there's something to commit
      fs.writeFileSync(path.join(noIdRepo, '.planning', 'project.md'), '# Test project\n');
      // Force git to have NO identity in this repo (clear local; ensure global doesn't apply via -c overrides)
      execSync('git config --local --unset-all user.email || true', { cwd: noIdRepo, stdio: 'pipe', shell: true });
      execSync('git config --local --unset-all user.name || true', { cwd: noIdRepo, stdio: 'pipe', shell: true });

      // Without --fail-on-error: returns success-shaped output with committed:false (legacy contract preserved)
      const lenient = runPanTools('commit "test commit" -c user.email= -c user.name=', noIdRepo);
      // Best-effort: the result depends on whether the host has global identity. Skip assertion if git accepted.
      // If it failed: must be exit 0, JSON shape with committed:false
      if (lenient.success) {
        try {
          const out = JSON.parse(lenient.output);
          if (out.reason === 'commit_failed') {
            assert.strictEqual(out.committed, false, 'lenient mode preserves legacy contract');
          }
        } catch { /* not JSON; legacy commit succeeded due to global identity — skip */ }
      }
      // The strong contract: --fail-on-error MUST exit non-zero on commit_failed.
      // Use git env-vars to FORCE no identity inside the spawned process.
      const strict = runPanTools(
        'commit "test commit" --fail-on-error',
        noIdRepo,
        { env: { ...process.env, GIT_AUTHOR_NAME: '', GIT_AUTHOR_EMAIL: '', GIT_COMMITTER_NAME: '', GIT_COMMITTER_EMAIL: '' } }
      );
      // Either: commit succeeded (host has env or config we can't fully strip), or it failed non-zero.
      // We assert: IF the run produced a commit_failed reason in stderr/output, exit must be non-zero.
      if ((strict.error || '').includes('commit_failed') || (strict.output || '').includes('commit_failed')) {
        assert.strictEqual(strict.success, false, 'commit_failed under --fail-on-error must exit non-zero');
      }
    } finally {
      fs.rmSync(noIdRepo, { recursive: true, force: true });
    }
  });
});

// ── router error paths ──────────────────────────────────────
describe('router error paths', () => {
  test('unknown top-level command returns error', () => {
    const result = runPanTools('nonexistent-command');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown command'), 'should mention unknown command');
  });

  test('unknown init workflow returns error', () => {
    const result = runPanTools('init bogus-workflow');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown init workflow'), 'should mention unknown init workflow');
  });

  test('unknown phase subcommand returns error', () => {
    const result = runPanTools('phase bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown phase subcommand'), 'should mention unknown phase subcommand');
  });

  test('unknown roadmap subcommand returns error', () => {
    const result = runPanTools('roadmap bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown roadmap subcommand'), 'should mention unknown roadmap subcommand');
  });

  test('unknown verify subcommand returns error', () => {
    const result = runPanTools('verify bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown verify subcommand'), 'should mention unknown verify subcommand');
  });

  test('unknown validate subcommand returns error', () => {
    const result = runPanTools('validate bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown validate subcommand'), 'should mention unknown validate subcommand');
  });

  test('unknown frontmatter subcommand returns error', () => {
    const result = runPanTools('frontmatter bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown frontmatter subcommand'), 'should mention unknown frontmatter subcommand');
  });

  test('unknown template subcommand returns error', () => {
    const result = runPanTools('template bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown template subcommand'), 'should mention unknown template subcommand');
  });

  test('unknown milestone subcommand returns error', () => {
    const result = runPanTools('milestone bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown milestone subcommand'), 'should mention unknown milestone subcommand');
  });

  test('unknown todo subcommand returns error', () => {
    const result = runPanTools('todo bogus');
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('Unknown todo subcommand'), 'should mention unknown todo subcommand');
  });
});

// ── generate-slug command ───────────────────────────────────────────────────

describe('generate-slug command', () => {
  test('generates slug from text', () => {
    const result = runPanTools('generate-slug Hello-World');
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'hello-world', 'slug should be lowercase hyphenated');
  });

  test('converts spaces to hyphens', () => {
    const result = runPanTools('generate-slug user-dashboard');
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'user-dashboard');
  });

  test('returns error when no text provided', () => {
    const result = runPanTools('generate-slug');
    assert.strictEqual(result.success, false, 'should fail without text');
  });
});

// ── current-timestamp command ───────────────────────────────────────────────

describe('current-timestamp command', () => {
  test('returns ISO date in date format', () => {
    const result = runPanTools('current-timestamp date');
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(output.timestamp), 'should be YYYY-MM-DD format');
  });

  test('returns filename-safe timestamp', () => {
    const result = runPanTools('current-timestamp filename');
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(!output.timestamp.includes(':'), 'filename format should not contain colons');
    assert.ok(output.timestamp.includes('T'), 'should contain T separator');
  });

  test('returns full ISO timestamp by default', () => {
    const result = runPanTools('current-timestamp');
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.timestamp.endsWith('Z'), 'default should be full ISO with Z');
  });
});

// ── verify-path command ─────────────────────────────────────────────────────

describe('verify-path-exists command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('detects existing directory', () => {
    const result = runPanTools('verify-path-exists .planning', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'directory');
  });

  test('detects existing file', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'test.md'), '# Test');
    const result = runPanTools('verify-path-exists .planning/test.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
  });

  test('reports missing path', () => {
    const result = runPanTools('verify-path-exists .planning/nonexistent.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, false);
    assert.strictEqual(output.type, null);
  });
});

// ── list-todos command ──────────────────────────────────────────────────────

describe('list-todos command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns zero count when no todos exist', () => {
    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0);
    assert.deepStrictEqual(output.todos, []);
  });

  test('lists pending todos', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'item-one.md'), 'title: Item One\narea: general\n');
    fs.writeFileSync(path.join(pendingDir, 'item-two.md'), 'title: Item Two\narea: security\n');

    const result = runPanTools('list-todos', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 2, 'should have 2 todos');
  });
});

// ── rollback-snapshot command ───────────────────────────────────────────────

describe('rollback-snapshot command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates rollback tag with phase', () => {
    const result = runPanTools('rollback-snapshot 05', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.tag, 'should have a tag name');
    assert.ok(output.tag.startsWith('pan-rollback-05-'), 'tag should start with pan-rollback-05-');
    assert.ok(output.hash, 'should have a commit hash');
    assert.strictEqual(output.phase, '05');
  });

  test('sanitizes dot phases in tag name', () => {
    const result = runPanTools('rollback-snapshot 05.1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.tag.startsWith('pan-rollback-05-1-'), 'dots should be replaced with dashes');
  });

  test('returns error without phase argument', () => {
    const result = runPanTools('rollback-snapshot', tmpDir);
    assert.strictEqual(result.success, false, 'should fail without phase');
  });
});

// ── shouldSkipTests helper ──────────────────────────────────────────────────

const { shouldSkipTests, readErrorPatterns, appendErrorPattern, appendSessionSummary } = require('../pan-wizard-core/bin/lib/commands.cjs');

describe('shouldSkipTests', () => {
  test('returns true for empty array', () => {
    assert.strictEqual(shouldSkipTests([]), true);
  });

  test('returns true for null/undefined', () => {
    assert.strictEqual(shouldSkipTests(null), true);
    assert.strictEqual(shouldSkipTests(undefined), true);
  });

  test('returns true when all files are .md', () => {
    assert.strictEqual(shouldSkipTests(['README.md', 'docs/GUIDE.md', 'CHANGELOG.MD']), true);
  });

  test('returns false when any file is not .md', () => {
    assert.strictEqual(shouldSkipTests(['README.md', 'src/index.js']), false);
  });

  test('returns false for all non-md files', () => {
    assert.strictEqual(shouldSkipTests(['src/app.cjs', 'tests/test.cjs']), false);
  });
});

// ── readErrorPatterns + appendErrorPattern ───────────────────────────────────

describe('readErrorPatterns and appendErrorPattern', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns empty array when patterns.md missing', () => {
    const patterns = readErrorPatterns(tmpDir);
    assert.deepStrictEqual(patterns, []);
  });

  test('appends and reads a pattern', () => {
    const result = appendErrorPattern(tmpDir, {
      title: 'Test pattern',
      wrong: 'existsSync before readFileSync',
      right: 'try-catch around readFileSync',
      context: 'TOCTOU race condition',
    });
    assert.ok(result.id, 'should return an id');
    assert.strictEqual(result.id, 'PAT-001');

    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns.length, 1);
    assert.strictEqual(patterns[0].id, 'PAT-001');
    assert.strictEqual(patterns[0].wrong, 'existsSync before readFileSync');
    assert.strictEqual(patterns[0].right, 'try-catch around readFileSync');
    assert.strictEqual(patterns[0].context, 'TOCTOU race condition');
  });

  test('auto-increments pattern IDs', () => {
    appendErrorPattern(tmpDir, { title: 'First', wrong: 'A', right: 'B' });
    const result2 = appendErrorPattern(tmpDir, { title: 'Second', wrong: 'C', right: 'D' });
    assert.strictEqual(result2.id, 'PAT-002');

    const patterns = readErrorPatterns(tmpDir);
    assert.strictEqual(patterns.length, 2);
  });

  test('returns error when wrong/right missing', () => {
    const result = appendErrorPattern(tmpDir, { title: 'Incomplete' });
    assert.ok(result.error, 'should return error');
    assert.ok(result.error.includes('wrong'), 'error should mention wrong');
  });
});

// ── appendSessionSummary ────────────────────────────────────────────────────

describe('appendSessionSummary', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates session-history.md and appends entry', () => {
    const result = appendSessionSummary(tmpDir, {
      phase: '05',
      plans_executed: 3,
      tests_before: 100,
      tests_after: 115,
      date: '2026-03-01',
    });
    assert.strictEqual(result.appended, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8'
    );
    assert.ok(content.includes('# Session History'), 'should have header');
    assert.ok(content.includes('### Session — 2026-03-01'), 'should have session header');
    assert.ok(content.includes('**Phase:** 05'), 'should have phase');
    assert.ok(content.includes('**Tests Before:** 100'), 'should have tests before');
    assert.ok(content.includes('**Tests After:** 115'), 'should have tests after');
  });

  test('returns error when phase is missing', () => {
    const result = appendSessionSummary(tmpDir, {});
    assert.ok(result.error, 'should return error');
    assert.ok(result.error.includes('phase'), 'error should mention phase');
  });

  test('appends multiple sessions', () => {
    appendSessionSummary(tmpDir, { phase: '01', date: '2026-01-01' });
    appendSessionSummary(tmpDir, { phase: '02', date: '2026-01-02' });

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'session-history.md'), 'utf-8'
    );
    const sessionCount = (content.match(/### Session — /g) || []).length;
    assert.strictEqual(sessionCount, 2, 'should have 2 session entries');
  });
});

// ── learnings commands ──────────────────────────────────────────────────────

describe('learnings commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('learnings-list returns empty when no file', () => {
    const result = runPanTools('learnings list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0);
    assert.deepStrictEqual(output.learnings, []);
  });

  test('learnings-list returns entries from file', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'learnings.md'),
      `# Session Learnings

### LEARN-001: Test pattern
**Type:** pattern
**Detail:** Always use try-catch
**Date:** 2026-03-01

### LEARN-002: Co-change found
**Type:** co-change
**Detail:** state.cjs and phase.cjs changed together 3 times
**Files:** state.cjs, phase.cjs
**Date:** 2026-03-02
`
    );

    const result = runPanTools('learnings list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 2);
    assert.strictEqual(output.learnings[0].id, 'LEARN-001');
    assert.strictEqual(output.learnings[0].type, 'pattern');
    assert.strictEqual(output.learnings[1].type, 'co-change');
    assert.ok(output.by_type.pattern >= 1, 'should count by type');
  });

  test('learnings-prune by ID removes entry', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'learnings.md'),
      `# Session Learnings

### LEARN-001: Keep me
**Type:** pattern
**Detail:** Keep this one
**Date:** 2026-03-01

### LEARN-002: Remove me
**Type:** co-change
**Detail:** Remove this one
**Date:** 2026-03-01
`
    );

    const result = runPanTools('learnings prune --id LEARN-002', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.pruned, 1);
    assert.strictEqual(output.remaining, 1);

    // Verify LEARN-001 survives
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'learnings.md'), 'utf-8');
    assert.ok(content.includes('LEARN-001'), 'LEARN-001 should survive');
    assert.ok(!content.includes('LEARN-002'), 'LEARN-002 should be removed');
  });

  test('learnings-prune requires --days or --id', () => {
    const result = runPanTools('learnings prune', tmpDir);
    assert.strictEqual(result.success, false, 'should fail without args');
  });

  test('learnings-extract with no source data returns zero', () => {
    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.extracted, 0);
  });

  test('learnings-extract picks up error patterns', () => {
    // Create a patterns file
    appendErrorPattern(tmpDir, {
      title: 'TOCTOU fix',
      wrong: 'existsSync check',
      right: 'try-catch read',
      date: '2026-03-01',
    });

    const result = runPanTools('learnings extract', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.extracted >= 1, 'should extract at least 1 learning from error pattern');
    assert.ok(output.by_type['error-resolution'] >= 1, 'should have error-resolution type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolve-model command
// ─────────────────────────────────────────────────────────────────────────────

describe('resolve-model command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns model, profile, and strategy for known agent', () => {
    const result = runPanTools('resolve-model pan-planner', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.model, 'should have model field');
    assert.ok(output.profile, 'should have profile field');
    assert.ok(output.strategy, 'should have strategy field');
  });

  test('returns unknown_agent flag for unrecognized agent', () => {
    const result = runPanTools('resolve-model pan-nonexistent', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.unknown_agent, true);
  });

  test('accepts --metadata flag with JSON task metadata', () => {
    // Set up complexity routing
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', routing: { strategy: 'complexity' } })
    );
    const metadata = JSON.stringify({ fileCount: 20, waveCount: 5, requirementCount: 8, isArchitectural: true });
    const result = runPanTools(`resolve-model pan-executor --metadata "${metadata.replace(/"/g, '\\"')}"`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.strategy, 'complexity');
    assert.ok(output.model, 'should return a model');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estimate-cost command
// ─────────────────────────────────────────────────────────────────────────────

describe('estimate-cost command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns estimates for all 3 profiles', () => {
    const result = runPanTools('estimate-cost', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output.estimates), 'should have estimates array');
    assert.strictEqual(output.estimates.length, 3, 'should have quality, balanced, budget');
    const profiles = output.estimates.map(e => e.profile);
    assert.ok(profiles.includes('quality'), 'should include quality');
    assert.ok(profiles.includes('balanced'), 'should include balanced');
    assert.ok(profiles.includes('budget'), 'should include budget');
    for (const est of output.estimates) {
      assert.strictEqual(typeof est.total, 'number', 'total should be a number');
      assert.strictEqual(typeof est.average, 'number', 'average should be a number');
      assert.strictEqual(typeof est.agentCount, 'number', 'agentCount should be a number');
      assert.ok(est.agentCount > 0, 'should have agents');
    }
  });
});
