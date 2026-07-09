/**
 * PAN Tools Tests - State
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('state-snapshot command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing state.md returns error', () => {
    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found', 'should report missing file');
  });

  test('extracts basic fields from state.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 03
**Current Phase Name:** API Layer
**Total Phases:** 6
**Current Plan:** 03-02
**Total Plans in Phase:** 3
**Status:** In progress
**Progress:** 45%
**Last Activity:** 2024-01-15
**Last Activity Description:** Completed 03-01-plan.md
`
    );

    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.current_phase, '03', 'current phase extracted');
    assert.strictEqual(output.current_phase_name, 'API Layer', 'phase name extracted');
    assert.strictEqual(output.total_phases, 6, 'total phases extracted');
    assert.strictEqual(output.current_plan, '03-02', 'current plan extracted');
    assert.strictEqual(output.total_plans_in_phase, 3, 'total plans extracted');
    assert.strictEqual(output.status, 'In progress', 'status extracted');
    assert.strictEqual(output.progress_percent, 45, 'progress extracted');
    assert.strictEqual(output.last_activity, '2024-01-15', 'last activity date extracted');
  });

  test('extracts decisions table', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01

## Decisions Made

| Phase | Decision | Rationale |
|-------|----------|-----------|
| 01 | Use Prisma | Better DX than raw SQL |
| 02 | JWT auth | Stateless authentication |
`
    );

    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions.length, 2, 'should have 2 decisions');
    assert.strictEqual(output.decisions[0].phase, '01', 'first decision phase');
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'first decision summary');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than raw SQL', 'first decision rationale');
  });

  test('extracts blockers list', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 03

## Blockers

- Waiting for API credentials
- Need design review for dashboard
`
    );

    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.blockers, [
      'Waiting for API credentials',
      'Need design review for dashboard',
    ], 'blockers extracted');
  });

  test('extracts session continuity info', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 03

## Session

**Last Date:** 2024-01-15
**Stopped At:** Phase 3, Plan 2, Task 1
**Resume File:** .planning/phases/03-api/03-02-plan.md
`
    );

    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.session.last_date, '2024-01-15', 'session date extracted');
    assert.strictEqual(output.session.stopped_at, 'Phase 3, Plan 2, Task 1', 'stopped at extracted');
    assert.strictEqual(output.session.resume_file, '.planning/phases/03-api/03-02-plan.md', 'resume file extracted');
  });

  test('handles paused_at field', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 03
**Paused At:** Phase 3, Plan 1, Task 2 - mid-implementation
`
    );

    const result = runPanTools('state-snapshot', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.paused_at, 'Phase 3, Plan 1, Task 2 - mid-implementation', 'paused_at extracted');
  });

  test('supports --cwd override when command runs outside project root', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Session State

**Current Phase:** 03
**Status:** Ready to plan
`
    );
    const outsideDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-test-outside-'));

    try {
      const result = runPanTools(`state-snapshot --cwd "${tmpDir}"`, outsideDir);
      assert.ok(result.success, `Command failed: ${result.error}`);

      const output = JSON.parse(result.output);
      assert.strictEqual(output.current_phase, '03', 'should read state.md from overridden cwd');
      assert.strictEqual(output.status, 'Ready to plan', 'should parse status from overridden cwd');
    } finally {
      cleanup(outsideDir);
    }
  });

  test('returns error for invalid --cwd path', () => {
    const invalid = path.join(tmpDir, 'does-not-exist');
    const result = runPanTools(`state-snapshot --cwd "${invalid}"`, tmpDir);
    assert.ok(!result.success, 'should fail for invalid --cwd');
    assert.ok(result.error.includes('Invalid --cwd'), 'error should mention invalid --cwd');
  });
});

describe('state mutation commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('add-decision preserves dollar amounts without corrupting Decisions section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

## Decisions
No decisions yet.

## Blockers
None
`
    );

    // Use file-based input to avoid shell expansion of dollar signs
    const summaryPath = path.join(tmpDir, 'dec-summary.txt');
    const rationalePath = path.join(tmpDir, 'dec-rationale.txt');
    fs.writeFileSync(summaryPath, 'Benchmark prices moved from $0.50 to $2.00 to $5.00\n');
    fs.writeFileSync(rationalePath, 'track cost growth\n');

    const result = runPanTools(
      `state add-decision --phase 11-01 --summary-file "${summaryPath}" --rationale-file "${rationalePath}"`,
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.match(
      state,
      /- \[Phase 11-01\]: Benchmark prices moved from \$0\.50 to \$2\.00 to \$5\.00 — track cost growth/,
      'decision entry should preserve literal dollar values'
    );
    assert.strictEqual((state.match(/^## Decisions$/gm) || []).length, 1, 'Decisions heading should not be duplicated');
    assert.ok(!state.includes('No decisions yet.'), 'placeholder should be removed');
  });

  test('add-blocker preserves dollar strings without corrupting Blockers section', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

## Decisions
None

## Blockers
None
`
    );

    // Use file-based input to avoid shell expansion of dollar signs
    const blockerPath = path.join(tmpDir, 'blocker-dollar.txt');
    fs.writeFileSync(blockerPath, 'Waiting on vendor quote $1.00 before approval\n');

    const result = runPanTools(`state add-blocker --text-file "${blockerPath}"`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const state = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.match(state, /- Waiting on vendor quote \$1\.00 before approval/, 'blocker entry should preserve literal dollar values');
    assert.strictEqual((state.match(/^## Blockers$/gm) || []).length, 1, 'Blockers heading should not be duplicated');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// state json command (machine-readable state.md frontmatter)
// ─────────────────────────────────────────────────────────────────────────────

describe('state json command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing state.md returns error', () => {
    const result = runPanTools('state json', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'state.md not found', 'should report missing file');
  });

  test('builds frontmatter on-the-fly from body when no frontmatter exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 05
**Current Phase Name:** Deployment
**Total Phases:** 8
**Current Plan:** 05-03
**Total Plans in Phase:** 4
**Status:** In progress
**Progress:** 60%
**Last Activity:** 2026-01-20
`
    );

    const result = runPanTools('state json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.pan_state_version, '1.0', 'should have version 1.0');
    assert.strictEqual(output.current_phase, '05', 'current phase extracted');
    assert.strictEqual(output.current_phase_name, 'Deployment', 'phase name extracted');
    assert.strictEqual(output.current_plan, '05-03', 'current plan extracted');
    assert.strictEqual(output.status, 'executing', 'status normalized to executing');
    assert.ok(output.last_updated, 'should have last_updated timestamp');
    assert.strictEqual(output.last_activity, '2026-01-20', 'last activity extracted');
    assert.ok(output.progress, 'should have progress object');
    assert.strictEqual(output.progress.percent, 60, 'progress percent extracted');
  });

  test('reads existing frontmatter when present', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `---
pan_state_version: 1.0
current_phase: 03
status: paused
stopped_at: Plan 2 of Phase 3
---

# Project State

**Current Phase:** 03
**Status:** Paused
`
    );

    const result = runPanTools('state json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.pan_state_version, '1.0', 'version from frontmatter');
    assert.strictEqual(output.current_phase, '03', 'phase from frontmatter');
    assert.strictEqual(output.status, 'paused', 'status from frontmatter');
    assert.strictEqual(output.stopped_at, 'Plan 2 of Phase 3', 'stopped_at from frontmatter');
  });

  test('normalizes various status values', () => {
    const statusTests = [
      { input: 'In progress', expected: 'executing' },
      { input: 'Ready to execute', expected: 'executing' },
      { input: 'Paused at Plan 3', expected: 'paused' },
      { input: 'Ready to plan', expected: 'planning' },
      { input: 'Phase complete — ready for verification', expected: 'verifying' },
      { input: 'Milestone complete', expected: 'completed' },
    ];

    for (const { input, expected } of statusTests) {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'state.md'),
        `# State\n\n**Current Phase:** 01\n**Status:** ${input}\n`
      );

      const result = runPanTools('state json', tmpDir);
      assert.ok(result.success, `Command failed for status "${input}": ${result.error}`);
      const output = JSON.parse(result.output);
      assert.strictEqual(output.status, expected, `"${input}" should normalize to "${expected}"`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state.md frontmatter sync (write operations add frontmatter)
// ─────────────────────────────────────────────────────────────────────────────

describe('state.md frontmatter sync', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('state update adds frontmatter to state.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 02
**Status:** Ready to execute
`
    );

    const result = runPanTools('state update Status "Executing Plan 1"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should start with frontmatter delimiter');
    assert.ok(content.includes('pan_state_version: 1.0'), 'should have version field');
    assert.ok(content.includes('current_phase: 02'), 'frontmatter should have current phase');
    assert.ok(content.includes('**Current Phase:** 02'), 'body field should be preserved');
    assert.ok(content.includes('**Status:** Executing Plan 1'), 'updated field in body');
  });

  test('state patch adds frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 04
**Status:** Planning
**Current Plan:** 04-01
`
    );

    const result = runPanTools('state patch --Status "In progress" --"Current Plan" 04-02', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should have frontmatter after patch');
  });

  test('frontmatter is idempotent on multiple writes', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 01
**Status:** Ready to execute
`
    );

    runPanTools('state update Status "In progress"', tmpDir);
    runPanTools('state update Status "Paused"', tmpDir);

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    const delimiterCount = (content.match(/^---$/gm) || []).length;
    assert.strictEqual(delimiterCount, 2, 'should have exactly one frontmatter block (2 delimiters)');
    assert.ok(content.includes('status: paused'), 'frontmatter should reflect latest status');
  });

  test('round-trip: write then read via state json', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      `# Project State

**Current Phase:** 07
**Current Phase Name:** Production
**Total Phases:** 10
**Status:** In progress
**Current Plan:** 07-05
**Progress:** 70%
`
    );

    runPanTools('state update Status "Executing Plan 5"', tmpDir);

    const result = runPanTools('state json', tmpDir);
    assert.ok(result.success, `state json failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.current_phase, '07', 'round-trip: phase preserved');
    assert.strictEqual(output.current_phase_name, 'Production', 'round-trip: phase name preserved');
    assert.strictEqual(output.status, 'executing', 'round-trip: status normalized');
    assert.ok(output.last_updated, 'round-trip: timestamp present');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state subcommand edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('state subcommand edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('unknown state subcommand returns error', () => {
    const result = runPanTools('state unknown-subcommand', tmpDir);
    assert.ok(!result.success, 'unknown subcommand should fail');
    assert.ok(result.error.includes('Unknown state subcommand'), 'error should mention unknown subcommand');
  });

  test('state with no subcommand calls load successfully', () => {
    const result = runPanTools('state', tmpDir);
    assert.ok(result.success, `state with no subcommand failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_exists, false, 'state_exists should be false');
  });

  test('state load explicitly works', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), [
      '---',
      'status: planning',
      'current_phase: 1',
      '---',
      '# State',
    ].join('\n'));

    const result = runPanTools('state load', tmpDir);
    assert.ok(result.success, `state load failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.state_exists, true, 'state_exists should be true');
    assert.ok(output.config, 'should include config object');
  });

  test('state json returns frontmatter as JSON', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), [
      '---',
      'status: executing',
      'current_phase: 3',
      '---',
      '# State',
    ].join('\n'));

    const result = runPanTools('state json', tmpDir);
    assert.ok(result.success, `state json failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'executing');
    assert.strictEqual(output.current_phase, '3');
  });

  test('commit --amend without message does not pass --amend as message', () => {
    // The commit command requires a message when not amending.
    // With --amend and no message, message should be null (not '--amend').
    // Without a git repo, commit will error about planning dir or git, not about message.
    const result = runPanTools('commit --amend', tmpDir);
    // The error should NOT be "commit message required" because amend=true bypasses that check
    // This may succeed or fail (no git repo), but must never fail with "commit message required"
    const errorText = result.error || '';
    assert.ok(!errorText.includes('commit message required'), 'should not require message when amending');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summary-extract command
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// stateExtractField / stateReplaceField — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

const { stateExtractField, stateReplaceField } = require(
  path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'state.cjs')
);

describe('stateExtractField', () => {
  const sample = [
    '# Project State',
    '**Status:** Ready to execute',
    '**Current Phase:** 03-implementation',
    '**Current Plan:** 2',
    '**Total Plans in Phase:** 5',
    '**Last Activity:** 2026-03-01',
  ].join('\n');

  test('extracts a simple field value', () => {
    assert.strictEqual(stateExtractField(sample, 'Status'), 'Ready to execute');
  });

  test('extracts a numeric field value as string', () => {
    assert.strictEqual(stateExtractField(sample, 'Current Plan'), '2');
  });

  test('extracts multi-word field name', () => {
    assert.strictEqual(stateExtractField(sample, 'Total Plans in Phase'), '5');
  });

  test('extracts field with hyphens in value', () => {
    assert.strictEqual(stateExtractField(sample, 'Current Phase'), '03-implementation');
  });

  test('returns null for missing field', () => {
    assert.strictEqual(stateExtractField(sample, 'Nonexistent'), null);
  });

  test('is case-insensitive', () => {
    assert.strictEqual(stateExtractField(sample, 'status'), 'Ready to execute');
  });

  test('trims whitespace from extracted value', () => {
    const content = '**Padded:**   lots of space   ';
    assert.strictEqual(stateExtractField(content, 'Padded'), 'lots of space');
  });
});

describe('stateReplaceField', () => {
  const sample = [
    '# Project State',
    '**Status:** Ready to execute',
    '**Current Plan:** 2',
    '**Last Activity:** 2026-03-01',
  ].join('\n');

  test('replaces an existing field value', () => {
    const result = stateReplaceField(sample, 'Status', 'Phase complete');
    assert.ok(result.includes('**Status:** Phase complete'));
    assert.ok(!result.includes('Ready to execute'));
  });

  test('replaces a numeric field', () => {
    const result = stateReplaceField(sample, 'Current Plan', '3');
    assert.ok(result.includes('**Current Plan:** 3'));
  });

  test('returns null for missing field', () => {
    assert.strictEqual(stateReplaceField(sample, 'Nonexistent', 'value'), null);
  });

  test('preserves other fields when replacing', () => {
    const result = stateReplaceField(sample, 'Status', 'Done');
    assert.ok(result.includes('**Current Plan:** 2'));
    assert.ok(result.includes('**Last Activity:** 2026-03-01'));
  });

  test('handles field name with special regex chars', () => {
    const content = '**Total (Plans):** 5';
    const result = stateReplaceField(content, 'Total (Plans)', '10');
    assert.ok(result.includes('**Total (Plans):** 10'));
  });

  test('is case-insensitive', () => {
    const result = stateReplaceField(sample, 'status', 'Changed');
    assert.ok(result.includes('Changed'));
  });

  test('handles value containing colons', () => {
    const result = stateReplaceField(sample, 'Status', 'Error: something failed');
    assert.ok(result.includes('**Status:** Error: something failed'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// state command functions (via runPanTools)
// ─────────────────────────────────────────────────────────────────────────────

const STATE_FIXTURE = [
  '# Project State',
  '',
  '**Status:** In progress',
  '**Current Phase:** 2',
  '**Current Phase Name:** Authentication',
  '**Total Phases:** 5',
  '**Current Plan:** 1',
  '**Total Plans in Phase:** 3',
  '**Progress:** [####------] 40%',
  '**Last Activity:** 2026-02-28',
  '**Last Activity Description:** Completed phase 1',
  '',
  '## Decisions',
  'None yet.',
  '',
  '## Blockers',
  'None.',
  '',
  '## Session',
  '**Last Date:** 2026-02-28T12:00:00Z',
  '**Stopped At:** Plan 1 of phase 2',
  '**Resume File:** None',
  '',
  '## Performance Metrics',
  '| Phase | Duration | Tasks | Files |',
  '|-------|----------|-------|-------|',
  'None yet',
  '',
].join('\n');

describe('state add-decision command', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('adds decision entry to Decisions section', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), STATE_FIXTURE);
    const result = runPanTools('state add-decision --phase 2 --summary Use-JWT-auth', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, true);

    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(content.includes('Use-JWT-auth'), 'decision text should appear in state.md');
  });

  test('returns false when Decisions section missing', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), '# State\n**Status:** In progress\n');
    const result = runPanTools('state add-decision --phase 1 --summary test', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, false);
  });
});

describe('state add-blocker and resolve-blocker commands', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('adds blocker and then resolves it', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'), STATE_FIXTURE);
    const addResult = runPanTools('state add-blocker --text API-rate-limit', tmpDir);
    assert.ok(addResult.success, `Add failed: ${addResult.error}`);
    const addOutput = JSON.parse(addResult.output);
    assert.strictEqual(addOutput.added, true);

    let content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(content.includes('API-rate-limit'), 'blocker should be in file');

    const resolveResult = runPanTools('state resolve-blocker --text API-rate-limit', tmpDir);
    assert.ok(resolveResult.success, `Resolve failed: ${resolveResult.error}`);
    const resolveOutput = JSON.parse(resolveResult.output);
    assert.strictEqual(resolveOutput.resolved, true);

    content = fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8');
    assert.ok(!content.includes('API-rate-limit'), 'blocker should be removed');
  });
});
