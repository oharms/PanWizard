/**
 * PAN Tools Tests - Template
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// template select command
// ─────────────────────────────────────────────────────────────────────────────

describe('template select command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('selects minimal template for simple plan with few tasks and files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
wave: 1
autonomous: true
---

## Objective
Set up the project.

## Tasks

### Task 1: Initialize project
**Files:** \`src/index.js\`

### Task 2: Add config
**Files:** \`src/config.js\`
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('template select .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.type, 'minimal', 'plan with 2 tasks and no slash-paths should be minimal');
    assert.strictEqual(output.taskCount, 2, 'should count 2 tasks');
    assert.strictEqual(output.hasDecisions, false, 'should have no decisions');
    assert.ok(output.template.includes('minimal'), 'template path should contain minimal');
  });

  test('selects complex template for plan with many tasks', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
---

## Tasks

### Task 1: Step one
**Files:** \`src/a.js\`, \`src/b.js\`

### Task 2: Step two
**Files:** \`src/c.js\`

### Task 3: Step three
**Files:** \`src/d.js\`

### Task 4: Step four
**Files:** \`src/e.js\`

### Task 5: Step five
**Files:** \`src/f.js\`

### Task 6: Step six
**Files:** \`src/g.js\`
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('template select .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.type, 'complex', 'plan with 6 tasks should be complex');
    assert.strictEqual(output.taskCount, 6, 'should count 6 tasks');
    assert.ok(output.template.includes('complex'), 'template path should contain complex');
  });

  test('selects complex template for plan with decision keyword', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
---

## Tasks

### Task 1: Make a decision about auth approach
**Files:** \`src/auth.js\`

### Task 2: Implement chosen decision
**Files:** \`src/impl.js\`

This plan requires a decision on the authentication strategy.
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('template select .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.type, 'complex', 'plan mentioning "decision" should be complex');
    assert.strictEqual(output.hasDecisions, true, 'hasDecisions should be true');
  });

  test('selects standard template for plan with moderate complexity', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
---

## Tasks

### Task 1: Create models
**Files:** \`src/models/user.js\`, \`src/models/project.js\`

### Task 2: Create routes
**Files:** \`src/routes/auth.js\`, \`src/routes/api.js\`

### Task 3: Add middleware
**Files:** \`src/middleware/auth.js\`
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('template select .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.type, 'standard', 'plan with 3 tasks and 5 files should be standard');
    assert.strictEqual(output.taskCount, 3, 'should count 3 tasks');
    assert.strictEqual(output.fileCount, 5, 'should count 5 unique file mentions');
  });

  test('selects complex template for plan with many file references', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = `---
phase: "01"
plan: "01"
---

## Tasks

### Task 1: Build everything
**Files:** \`src/a.js\`, \`src/b.js\`, \`src/c.js\`, \`src/d.js\`, \`src/e.js\`, \`src/f.js\`, \`src/g.js\`
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('template select .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.type, 'complex', 'plan with 7 file refs should be complex');
    assert.ok(output.fileCount > 6, 'fileCount should exceed complex threshold');
  });

  test('falls back to standard template when plan file not found', () => {
    const result = runPanTools('template select .planning/phases/99-missing/99-01-plan.md', tmpDir);
    assert.ok(result.success, `Command should succeed with fallback: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.type, 'standard', 'missing file should fall back to standard');
    assert.ok(output.error, 'should include an error field describing the read failure');
    assert.ok(output.template.includes('standard'), 'template path should contain standard');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// template fill summary command
// ─────────────────────────────────────────────────────────────────────────────

describe('template fill summary command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates SUMMARY.md with frontmatter for an existing phase', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill summary --phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true, 'should report created');
    assert.strictEqual(output.template, 'summary', 'template type should be summary');

    // Verify the file was actually written with frontmatter
    const filePath = path.join(tmpDir, output.path);
    assert.ok(fs.existsSync(filePath), `File should exist at ${output.path}`);

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should begin with frontmatter delimiter');
    assert.ok(content.includes('phase:'), 'frontmatter should include phase field');
    assert.ok(content.includes('plan:'), 'frontmatter should include plan field');
    assert.ok(content.includes('Summary'), 'body should contain Summary heading');
  });

  test('returns error when --phase is missing', () => {
    const result = runPanTools('template fill summary', tmpDir);
    assert.ok(!result.success, 'should fail without --phase');
    assert.ok(result.error.includes('--phase required'), 'error should mention --phase required');
  });

  test('returns error when phase directory does not exist', () => {
    const result = runPanTools('template fill summary --phase 99', tmpDir);
    assert.ok(result.success, `Command should return JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Phase not found', 'should report phase not found');
    assert.strictEqual(output.phase, '99', 'should echo the requested phase');
  });

  test('does not overwrite existing SUMMARY.md file', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Existing summary');

    const result = runPanTools('template fill summary --phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File already exists', 'should report file already exists');

    // Verify original content was preserved
    const content = fs.readFileSync(path.join(phaseDir, '01-01-summary.md'), 'utf-8');
    assert.strictEqual(content, '# Existing summary', 'original file content should be unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// template fill plan command
// ─────────────────────────────────────────────────────────────────────────────

describe('template fill plan command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates PLAN.md with XML task structure for an existing phase', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill plan --phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true, 'should report created');
    assert.strictEqual(output.template, 'plan', 'template type should be plan');

    // Verify the file has XML task structure
    const filePath = path.join(tmpDir, output.path);
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should begin with frontmatter delimiter');
    assert.ok(content.includes('<task type="code">'), 'should contain XML task element');
    assert.ok(content.includes('<name>'), 'should contain task name element');
    assert.ok(content.includes('<verify>'), 'should contain verify element');
    assert.ok(content.includes('<done>'), 'should contain done element');
    assert.ok(content.includes('## Objective'), 'should contain Objective section');
    assert.ok(content.includes('## Success Criteria'), 'should contain Success Criteria section');
  });

  test('custom --type tdd and --wave 2 are reflected in frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill plan --phase 1 --type tdd --wave 2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true, 'should report created');

    // Read and verify frontmatter contains type and wave
    const filePath = path.join(tmpDir, output.path);
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('type: tdd'), 'frontmatter should contain type: tdd');
    assert.ok(content.includes('wave: 2'), 'frontmatter should contain wave: 2');
  });

  test('does not overwrite existing PLAN.md file', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Existing plan');

    const result = runPanTools('template fill plan --phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File already exists', 'should report file already exists');

    // Verify original content preserved
    const content = fs.readFileSync(path.join(phaseDir, '01-01-plan.md'), 'utf-8');
    assert.strictEqual(content, '# Existing plan', 'original file content should be unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// template fill verification command
// ─────────────────────────────────────────────────────────────────────────────

describe('template fill verification command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates VERIFICATION.md with tables for an existing phase', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill verification --phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true, 'should report created');
    assert.strictEqual(output.template, 'verification', 'template type should be verification');

    // Verify the file has verification tables
    const filePath = path.join(tmpDir, output.path);
    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.startsWith('---\n'), 'should begin with frontmatter delimiter');
    assert.ok(content.includes('Observable Truths'), 'should contain Observable Truths table');
    assert.ok(content.includes('Required Artifacts'), 'should contain Required Artifacts table');
    assert.ok(content.includes('Key Link Verification'), 'should contain Key Link Verification table');
    assert.ok(content.includes('Requirements Coverage'), 'should contain Requirements Coverage table');
    assert.ok(content.includes('status:'), 'frontmatter should include status field');
  });

  test('returns error when phase does not exist', () => {
    const result = runPanTools('template fill verification --phase 77', tmpDir);
    assert.ok(result.success, `Command should return JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Phase not found', 'should report phase not found');
  });

  test('does not overwrite existing VERIFICATION.md file', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-verification.md'), '# Existing verification');

    const result = runPanTools('template fill verification --phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File already exists', 'should report file already exists');

    // Verify original content preserved
    const content = fs.readFileSync(path.join(phaseDir, '01-verification.md'), 'utf-8');
    assert.strictEqual(content, '# Existing verification', 'original file content should be unchanged');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generator unit tests (exported for testability)
// ─────────────────────────────────────────────────────────────────────────────

const {
  generatePlanTemplate,
  generateSummaryTemplate,
  generateVerificationTemplate,
} = require('../pan-wizard-core/bin/lib/template.cjs');

describe('generatePlanTemplate', () => {
  test('returns frontmatter, body, and fileName', () => {
    const result = generatePlanTemplate('01-setup', '01', 'Setup', 'setup', '1', { type: 'execute', wave: 2 });
    assert.strictEqual(typeof result.frontmatter, 'object');
    assert.strictEqual(result.frontmatter.phase, '01-setup');
    assert.strictEqual(result.frontmatter.plan, '01');
    assert.strictEqual(result.frontmatter.wave, 2);
    assert.strictEqual(result.frontmatter.type, 'execute');
    assert.strictEqual(result.fileName, '01-01-plan.md');
    assert.ok(result.body.includes('## Objective'));
    assert.ok(result.body.includes('<task type="code">'));
  });

  test('defaults to wave 1 and type execute', () => {
    const result = generatePlanTemplate('03-deploy', '02', 'Deploy', 'deploy', '3', {});
    assert.strictEqual(result.frontmatter.wave, 1);
    assert.strictEqual(result.frontmatter.type, 'execute');
    assert.strictEqual(result.fileName, '03-02-plan.md');
  });

  test('includes tier field (null by default)', () => {
    const result = generatePlanTemplate('01-setup', '01', 'Setup', 'setup', '1', {});
    assert.ok('tier' in result.frontmatter, 'frontmatter should include tier field');
    assert.strictEqual(result.frontmatter.tier, null, 'tier should default to null');
  });

  test('includes priority field (null by default)', () => {
    const result = generatePlanTemplate('01-setup', '01', 'Setup', 'setup', '1', {});
    assert.ok('priority' in result.frontmatter, 'frontmatter should include priority field');
    assert.strictEqual(result.frontmatter.priority, null, 'priority should default to null');
  });

  test('includes effort field (null by default)', () => {
    const result = generatePlanTemplate('01-setup', '01', 'Setup', 'setup', '1', {});
    assert.ok('effort' in result.frontmatter, 'frontmatter should include effort field');
    assert.strictEqual(result.frontmatter.effort, null, 'effort should default to null');
  });

  test('tier/priority/effort can be set via fields option', () => {
    const result = generatePlanTemplate('01-setup', '01', 'Setup', 'setup', '1', {
      fields: { tier: 'micro', priority: 'P1', effort: 'S' },
    });
    assert.strictEqual(result.frontmatter.tier, 'micro');
    assert.strictEqual(result.frontmatter.priority, 'P1');
    assert.strictEqual(result.frontmatter.effort, 'S');
  });

  test('existing frontmatter fields still present with new fields', () => {
    const result = generatePlanTemplate('01-setup', '01', 'Setup', 'setup', '1', {});
    assert.ok('phase' in result.frontmatter);
    assert.ok('plan' in result.frontmatter);
    assert.ok('autonomous' in result.frontmatter);
    assert.ok('files_modified' in result.frontmatter);
    assert.ok('tier' in result.frontmatter);
    assert.ok('priority' in result.frontmatter);
    assert.ok('effort' in result.frontmatter);
  });
});

describe('generateSummaryTemplate', () => {
  test('returns frontmatter, body, and fileName', () => {
    const result = generateSummaryTemplate('02-auth', '01', 'Auth', '2', {});
    assert.strictEqual(result.frontmatter.phase, '02-auth');
    assert.strictEqual(result.frontmatter.plan, '01');
    assert.ok(result.frontmatter.completed, 'should have completed date');
    assert.strictEqual(result.fileName, '02-01-summary.md');
    assert.ok(result.body.includes('## Accomplishments'));
    assert.ok(result.body.includes('## Task Commits'));
  });
});

describe('generateVerificationTemplate', () => {
  test('returns frontmatter, body, and fileName', () => {
    const result = generateVerificationTemplate('01-setup', 'Setup', '1', {});
    assert.strictEqual(result.frontmatter.phase, '01-setup');
    assert.strictEqual(result.frontmatter.status, 'pending');
    assert.strictEqual(result.fileName, '01-verification.md');
    assert.ok(result.body.includes('Observable Truths'));
    assert.ok(result.body.includes('Required Artifacts'));
    assert.ok(result.body.includes('Requirements Coverage'));
  });

  test('merges additional fields into frontmatter', () => {
    const result = generateVerificationTemplate('02-auth', 'Auth', '2', { custom: 'value' });
    assert.strictEqual(result.frontmatter.custom, 'value');
    assert.strictEqual(result.frontmatter.phase, '02-auth');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// threshold constants
// ─────────────────────────────────────────────────────────────────────────────

const {
  SIMPLE_TASK_THRESHOLD,
  SIMPLE_FILE_THRESHOLD,
  COMPLEX_TASK_THRESHOLD,
  COMPLEX_FILE_THRESHOLD,
} = require('../pan-wizard-core/bin/lib/constants.cjs');

describe('template threshold constants', () => {
  test('SIMPLE_TASK_THRESHOLD is a positive number', () => {
    assert.strictEqual(typeof SIMPLE_TASK_THRESHOLD, 'number');
    assert.ok(SIMPLE_TASK_THRESHOLD > 0, 'should be positive');
  });

  test('SIMPLE_FILE_THRESHOLD is a positive number', () => {
    assert.strictEqual(typeof SIMPLE_FILE_THRESHOLD, 'number');
    assert.ok(SIMPLE_FILE_THRESHOLD > 0, 'should be positive');
  });

  test('COMPLEX_TASK_THRESHOLD is greater than SIMPLE_TASK_THRESHOLD', () => {
    assert.ok(COMPLEX_TASK_THRESHOLD > SIMPLE_TASK_THRESHOLD, 'complex threshold should exceed simple');
  });

  test('COMPLEX_FILE_THRESHOLD is greater than SIMPLE_FILE_THRESHOLD', () => {
    assert.ok(COMPLEX_FILE_THRESHOLD > SIMPLE_FILE_THRESHOLD, 'complex file threshold should exceed simple');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// template fill — other template types
// ─────────────────────────────────────────────────────────────────────────────

describe('template fill error cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('errors on unknown template type', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill nonexistent --phase 1', tmpDir);
    assert.ok(!result.success, 'should fail for unknown template type');
    assert.ok(result.error.includes('Unknown template type'), 'error should mention unknown type');
  });

  test('errors on debug template type (not supported)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill debug --phase 1', tmpDir);
    assert.ok(!result.success, 'debug should not be a valid template type');
    assert.ok(result.error.includes('Unknown template type'), 'error should mention unknown type');
  });

  test('errors on uat template type (not supported)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('template fill uat --phase 1', tmpDir);
    assert.ok(!result.success, 'uat should not be a valid template type');
    assert.ok(result.error.includes('Unknown template type'), 'error should mention unknown type');
  });

  test('errors when no template type provided', () => {
    const result = runPanTools('template fill', tmpDir);
    assert.ok(!result.success, 'should fail when no template type given');
    assert.ok(result.error.includes('template type required'), 'error should mention template type required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// template subcommand error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('template command error handling', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('errors on unknown subcommand', () => {
    const result = runPanTools('template bogus', tmpDir);
    assert.ok(!result.success, 'should fail for unknown subcommand');
    assert.ok(result.error.includes('Unknown template subcommand'), 'error should mention unknown subcommand');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test tier enforcement in templates
// ─────────────────────────────────────────────────────────────────────────────

describe('test tier enforcement in templates', () => {
  test('phase-prompt.md includes Test Tier Strategy section', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'phase-prompt.md'), 'utf-8'
    );
    assert.ok(content.includes('### Test Tier Strategy'), 'Missing Test Tier Strategy section');
    assert.ok(content.includes('T1: Unit'), 'Missing T1 tier definition');
    assert.ok(content.includes('T2: Integration'), 'Missing T2 tier definition');
    assert.ok(content.includes('T3: E2E'), 'Missing T3 tier definition');
    assert.ok(content.includes('T4: Visual'), 'Missing T4 tier definition');
  });

  test('summary.md template includes test-tiers frontmatter field', () => {
    const content = fs.readFileSync(
      path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'summary.md'), 'utf-8'
    );
    assert.ok(content.includes('test-tiers'), 'Missing test-tiers frontmatter field');
  });
});
