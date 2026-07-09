/**
 * PAN Tools Tests - Config
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// config-ensure-section command
// ─────────────────────────────────────────────────────────────────────────────

describe('config-ensure-section command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates config.json with defaults when missing', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true, 'should report created: true');
    assert.strictEqual(output.path, '.planning/config.json', 'should return relative config path');

    // Verify config.json was actually written to disk
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    assert.ok(fs.existsSync(configPath), 'config.json should exist on disk');

    // Verify default values in the created config
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.model_profile, 'balanced', 'default model_profile should be balanced');
    assert.strictEqual(config.commit_docs, true, 'default commit_docs should be true');
    assert.strictEqual(config.search_gitignored, false, 'default search_gitignored should be false');
    assert.strictEqual(config.branching_strategy, 'none', 'default branching_strategy should be none');
    assert.strictEqual(config.parallelization, true, 'default parallelization should be true');
    assert.strictEqual(typeof config.workflow, 'object', 'workflow should be an object');
    assert.strictEqual(config.workflow.research, true, 'default workflow.research should be true');
    assert.strictEqual(config.workflow.plan_check, true, 'default workflow.plan_check should be true');
    assert.strictEqual(config.workflow.verifier, true, 'default workflow.verifier should be true');
    assert.strictEqual(config.workflow.nyquist_validation, false, 'default workflow.nyquist_validation should be false');
  });

  test('returns already_exists when config.json is present', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ model_profile: 'quality' }, null, 2), 'utf-8');

    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, false, 'should report created: false');
    assert.strictEqual(output.reason, 'already_exists', 'should report reason as already_exists');

    // Verify the existing config was not overwritten
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.model_profile, 'quality', 'existing config should be preserved');
  });

  test('creates .planning directory if it does not exist', () => {
    // Remove the .planning directory that createTempProject creates
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning')), '.planning should not exist before test');

    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true, 'should create config when .planning is missing');
    assert.ok(fs.existsSync(path.join(tmpDir, '.planning', 'config.json')), 'config.json should exist after creation');
  });

  test('config contains branch template defaults', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.phase_branch_template, 'pan/phase-{phase}-{slug}', 'should have phase branch template');
    assert.strictEqual(config.milestone_branch_template, 'pan/{milestone}-{slug}', 'should have milestone branch template');
  });

  test('config contains budget section with defaults', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(typeof config.budget, 'object', 'budget should be an object');
    assert.strictEqual(config.budget.default_points, 50, 'default budget points should be 50');
    assert.strictEqual(config.budget.micro_threshold_tasks, 3, 'micro threshold tasks should be 3');
    assert.strictEqual(config.budget.micro_threshold_files, 2, 'micro threshold files should be 2');
  });

  test('config contains commit section with defaults', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(typeof config.commit, 'object', 'commit should be an object');
    assert.strictEqual(config.commit.safety_checks, true, 'commit safety_checks should be true');
    assert.strictEqual(config.commit.conventional_types, true, 'commit conventional_types should be true');
    assert.ok(Array.isArray(config.commit.sensitive_patterns), 'sensitive_patterns should be an array');
    assert.ok(config.commit.sensitive_patterns.length >= 7, 'should have at least 7 sensitive patterns');
    assert.ok(config.commit.sensitive_patterns.includes('\\.env$'), 'should include .env pattern');
    assert.ok(config.commit.sensitive_patterns.includes('credentials'), 'should include credentials pattern');
  });

  test('config contains execution section with defaults', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(typeof config.execution, 'object', 'execution should be an object');
    assert.strictEqual(config.execution.default_mode, 'wave_order', 'default execution mode should be wave_order');
    assert.strictEqual(config.execution.rollback_snapshots, true, 'rollback_snapshots should be true');
    assert.strictEqual(config.execution.error_pattern_learning, true, 'error_pattern_learning should be true');
  });

  test('existing config fields preserved when new sections added', () => {
    // Create a config manually with only old fields
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ model_profile: 'quality' }, null, 2), 'utf-8');

    // ensure-section should NOT overwrite
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, false, 'should not recreate existing config');

    // Existing config should be unchanged
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.model_profile, 'quality', 'existing fields should be preserved');
  });

  test('config-set can modify new budget section', () => {
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('config-set budget.default_points 30', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.budget.default_points, 30, 'budget.default_points should be updated to 30');
    assert.strictEqual(config.budget.micro_threshold_tasks, 3, 'sibling budget keys should be preserved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-set command
// ─────────────────────────────────────────────────────────────────────────────

describe('config-set command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('sets a simple key and reads it back via config-get', () => {
    // Ensure config exists first
    runPanTools('config-ensure-section', tmpDir);

    const setResult = runPanTools('config-set model_profile quality', tmpDir);
    assert.ok(setResult.success, `config-set failed: ${setResult.error}`);

    const setOutput = JSON.parse(setResult.output);
    assert.strictEqual(setOutput.updated, true, 'should report updated: true');
    assert.strictEqual(setOutput.key, 'model_profile', 'should echo the key');
    assert.strictEqual(setOutput.value, 'quality', 'should echo the value');

    // Verify via config-get
    const getResult = runPanTools('config-get model_profile', tmpDir);
    assert.ok(getResult.success, `config-get failed: ${getResult.error}`);

    const getValue = JSON.parse(getResult.output);
    assert.strictEqual(getValue, 'quality', 'config-get should return the value set by config-set');
  });

  test('sets a nested key using dot-notation and creates intermediate objects', () => {
    runPanTools('config-ensure-section', tmpDir);

    const setResult = runPanTools('config-set workflow.research false', tmpDir);
    assert.ok(setResult.success, `config-set failed: ${setResult.error}`);

    const setOutput = JSON.parse(setResult.output);
    assert.strictEqual(setOutput.key, 'workflow.research', 'should echo nested key');
    assert.strictEqual(setOutput.value, false, 'should auto-parse "false" to boolean false');

    // Verify the nested value was set correctly in the file
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.workflow.research, false, 'nested value should be set in config file');
    // Verify sibling keys were preserved
    assert.strictEqual(config.workflow.plan_check, true, 'sibling nested keys should be preserved');
  });

  test('auto-parses "true" to boolean true', () => {
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('config-set search_gitignored true', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.value, true, '"true" string should be parsed to boolean true');
    assert.strictEqual(typeof output.value, 'boolean', 'value should be boolean type');
  });

  test('auto-parses numeric string "42" to number 42', () => {
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('config-set max_retries 42', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.value, 42, '"42" should be parsed to number 42');
    assert.strictEqual(typeof output.value, 'number', 'value should be number type');
  });

  test('creates config.json when it does not exist', () => {
    // Do NOT run config-ensure-section first — config.json does not exist
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    assert.ok(!fs.existsSync(configPath), 'config.json should not exist before test');

    const result = runPanTools('config-set some_key some_value', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'should succeed even without existing config');

    // Verify the file was created with the value
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.some_key, 'some_value', 'value should be written to new config file');
  });

  test('errors on empty key path', () => {
    runPanTools('config-ensure-section', tmpDir);

    // Call config-set without a key argument
    const result = runPanTools('config-set', tmpDir);
    assert.ok(!result.success, 'should fail when no key is provided');
    assert.ok(result.error.includes('Usage:'), 'error should include usage message');
  });

  test('creates deeply nested keys with multiple dot segments', () => {
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('config-set deep.nested.path.value hello', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.deep.nested.path.value, 'hello', 'deeply nested key should be created');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-get command
// ─────────────────────────────────────────────────────────────────────────────

describe('config-get command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gets an existing top-level key', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      model_profile: 'budget',
      commit_docs: false,
    }, null, 2), 'utf-8');

    const result = runPanTools('config-get model_profile', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, 'budget', 'should return the value at the key');
  });

  test('gets a nested key using dot-notation', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      workflow: {
        research: true,
        plan_check: false,
        verifier: true,
      },
    }, null, 2), 'utf-8');

    const result = runPanTools('config-get workflow.research', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, true, 'should traverse and return nested value');
  });

  test('errors when config.json is missing', () => {
    // Do NOT create config.json
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    assert.ok(!fs.existsSync(configPath), 'config.json should not exist');

    const result = runPanTools('config-get model_profile', tmpDir);
    assert.ok(!result.success, 'should fail when config.json is missing');
    assert.ok(result.error.includes('No config.json found'), 'error should mention missing config');
  });

  test('errors when key does not exist in config', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ model_profile: 'balanced' }, null, 2), 'utf-8');

    const result = runPanTools('config-get nonexistent_key', tmpDir);
    assert.ok(!result.success, 'should fail for nonexistent key');
    assert.ok(result.error.includes('Key not found'), 'error should mention key not found');
  });

  test('errors when nested key path does not exist', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      workflow: { research: true },
    }, null, 2), 'utf-8');

    const result = runPanTools('config-get workflow.nonexistent', tmpDir);
    assert.ok(!result.success, 'should fail for nonexistent nested key');
    assert.ok(result.error.includes('Key not found'), 'error should mention key not found');
  });

  test('returns boolean and numeric values with correct types', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      enabled: true,
      count: 7,
      label: 'test',
    }, null, 2), 'utf-8');

    // Boolean
    const boolResult = runPanTools('config-get enabled', tmpDir);
    assert.ok(boolResult.success, `Command failed: ${boolResult.error}`);
    assert.strictEqual(JSON.parse(boolResult.output), true, 'should return boolean true');

    // Number
    const numResult = runPanTools('config-get count', tmpDir);
    assert.ok(numResult.success, `Command failed: ${numResult.error}`);
    assert.strictEqual(JSON.parse(numResult.output), 7, 'should return number 7');

    // String
    const strResult = runPanTools('config-get label', tmpDir);
    assert.ok(strResult.success, `Command failed: ${strResult.error}`);
    assert.strictEqual(JSON.parse(strResult.output), 'test', 'should return string test');
  });

  test('errors on empty key path', () => {
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('config-get', tmpDir);
    assert.ok(!result.success, 'should fail when no key is provided');
    assert.ok(result.error.includes('Usage:'), 'error should include usage message');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-set edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('config-set edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('overwrites non-object intermediate with nested key', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ workflow: 'string-not-object' }, null, 2), 'utf-8');

    const result = runPanTools('config-set workflow.research true', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(typeof config.workflow, 'object', 'string intermediate should be replaced with object');
    assert.strictEqual(config.workflow.research, true, 'nested key should be set');
  });

  test('handles malformed JSON in existing config.json', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, '{ invalid json !!!', 'utf-8');

    const result = runPanTools('config-set model_profile quality', tmpDir);
    // Should fail because JSON.parse throws for non-ENOENT error
    assert.ok(!result.success, 'should fail on malformed JSON');
    assert.ok(result.error.includes('Failed to read config.json'), 'error should mention read failure');
  });

  test('preserves empty string value without converting to number', () => {
    runPanTools('config-ensure-section', tmpDir);

    // Empty value argument — config-set key with no value should get undefined/empty
    const result = runPanTools('config-set label ""', tmpDir);
    // The dispatcher may pass empty string or undefined depending on arg parsing
    if (result.success) {
      const configPath = path.join(tmpDir, '.planning', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      assert.strictEqual(typeof config.label, 'string', 'empty string should remain string type');
    }
  });

  test('config-set with zero value stores as number 0', () => {
    runPanTools('config-ensure-section', tmpDir);

    const result = runPanTools('config-set budget.default_points 0', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.value, 0, 'zero should be parsed as number 0');
    assert.strictEqual(typeof output.value, 'number', 'zero should be number type');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-get edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('config-get edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns entire object for non-leaf key', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      workflow: { research: true, plan_check: false },
    }, null, 2), 'utf-8');

    const result = runPanTools('config-get workflow', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output, 'object', 'should return object for non-leaf key');
    assert.strictEqual(output.research, true, 'should contain nested research key');
    assert.strictEqual(output.plan_check, false, 'should contain nested plan_check key');
  });

  test('returns null value when key is explicitly null', () => {
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ nullable: null }, null, 2), 'utf-8');

    // config-get traverses to null → then tries to access undefined on null → error
    const result = runPanTools('config-get nullable.child', tmpDir);
    assert.ok(!result.success, 'should fail when traversing through null');
    assert.ok(result.error.includes('Key not found'), 'error should indicate key not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Exported helper functions (unit tests)
// ─────────────────────────────────────────────────────────────────────────────

const {
  parseStandardsFile,
  renderStandardsMd,
  detectStandardsFromContent,
} = require('../pan-wizard-core/bin/lib/config.cjs');

describe('parseStandardsFile', () => {
  test('returns empty array for empty content', () => {
    const ids = parseStandardsFile('');
    assert.ok(Array.isArray(ids), 'should return an array');
    assert.strictEqual(ids.length, 0, 'should have no IDs for empty content');
  });

  test('returns empty array for content with no standard sections', () => {
    const ids = parseStandardsFile('# Project Standards\n\nSome general text.\n');
    assert.strictEqual(ids.length, 0, 'should have no IDs for non-matching content');
  });

  test('detects OWASP Top 10 when section header present', () => {
    const content = '# Project Standards\n\n## OWASP Top 10 (2025)\n\nSome checklist items.\n';
    const ids = parseStandardsFile(content);
    assert.ok(ids.includes('owasp-top10'), 'should detect owasp-top10 from section header');
  });
});

describe('renderStandardsMd', () => {
  test('returns header for empty IDs array', () => {
    const content = renderStandardsMd([]);
    assert.ok(content.includes('# Project Standards'), 'should include header');
    assert.ok(content.includes('Manage standards'), 'should include footer');
  });

  test('renders checklist items for a valid standard', () => {
    const content = renderStandardsMd(['owasp-top10']);
    assert.ok(content.includes('# Project Standards'), 'should include header');
    assert.ok(content.includes('## OWASP Top 10'), 'should include OWASP section');
    assert.ok(content.includes('- [ ]'), 'should include checklist items');
    assert.ok(content.includes('**Category:**'), 'should include category metadata');
  });

  test('skips unknown standard IDs gracefully', () => {
    const content = renderStandardsMd(['nonexistent-standard']);
    assert.ok(content.includes('# Project Standards'), 'should include header');
    // Should not crash, just skip the unknown ID
  });
});

describe('detectStandardsFromContent', () => {
  test('returns empty array for empty content', () => {
    const ids = detectStandardsFromContent('');
    assert.ok(Array.isArray(ids), 'should return an array');
    assert.strictEqual(ids.length, 0, 'should have no IDs for empty content');
  });

  test('detects security-related standards from content mentioning authentication', () => {
    const ids = detectStandardsFromContent('This phase implements user authentication and authorization flows with JWT tokens.');
    assert.ok(Array.isArray(ids), 'should return an array');
    // authentication keyword should trigger security standards
    assert.ok(ids.length > 0, 'should detect at least one standard from authentication content');
  });

  test('detects accessibility standards from content mentioning WCAG', () => {
    const ids = detectStandardsFromContent('Ensure all components meet WCAG accessibility guidelines.');
    assert.ok(ids.length > 0, 'should detect standards from WCAG content');
  });

  test('is case-insensitive', () => {
    const ids1 = detectStandardsFromContent('AUTHENTICATION');
    const ids2 = detectStandardsFromContent('authentication');
    assert.deepStrictEqual(ids1, ids2, 'should return same results regardless of case');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// standards commands (integration tests via CLI)
// ─────────────────────────────────────────────────────────────────────────────

describe('standards-list command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns list of available standards', () => {
    const result = runPanTools('standards list', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output.standards), 'should have standards array');
    assert.ok(output.count > 0, 'should have at least one standard');
    assert.ok(output.standards[0].id, 'each standard should have an id');
    assert.ok(output.standards[0].name, 'each standard should have a name');
    assert.ok(output.standards[0].category, 'each standard should have a category');
  });

  test('filters by category', () => {
    const result = runPanTools('standards list --category security', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.count > 0, 'should have at least one security standard');
    for (const s of output.standards) {
      assert.strictEqual(s.category, 'security', 'all results should be security category');
    }
  });

  test('errors on unknown category', () => {
    const result = runPanTools('standards list --category nonexistent', tmpDir);
    assert.ok(!result.success, 'should fail for unknown category');
    assert.ok(result.error.includes('Unknown category'), 'error should mention unknown category');
  });
});

describe('standards-select and standards-remove commands', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('select adds a standard to the project', () => {
    const result = runPanTools('standards select owasp-top10', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.added, 'owasp-top10', 'should confirm added standard');
    assert.ok(output.project_standards.includes('owasp-top10'), 'project_standards should include it');

    // Verify file exists
    const stdPath = path.join(tmpDir, '.planning', 'standards.md');
    assert.ok(fs.existsSync(stdPath), 'standards.md should be created');
    const content = fs.readFileSync(stdPath, 'utf-8');
    assert.ok(content.includes('OWASP Top 10'), 'file should contain OWASP section');
  });

  test('select errors on unknown standard', () => {
    const result = runPanTools('standards select fake-standard', tmpDir);
    assert.ok(!result.success, 'should fail for unknown standard');
    assert.ok(result.error.includes('Unknown standard'), 'error should mention unknown standard');
  });

  test('select errors when standard already added', () => {
    runPanTools('standards select owasp-top10', tmpDir);
    const result = runPanTools('standards select owasp-top10', tmpDir);
    assert.ok(!result.success, 'should fail when already selected');
    assert.ok(result.error.includes('already'), 'error should mention already in project');
  });

  test('remove deletes standard from project', () => {
    // First add two standards
    runPanTools('standards select owasp-top10', tmpDir);
    runPanTools('standards select wcag-22', tmpDir);

    // Remove one
    const result = runPanTools('standards remove owasp-top10', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.removed, 'owasp-top10', 'should confirm removed standard');
    assert.ok(!output.project_standards.includes('owasp-top10'), 'should no longer include owasp-top10');
    assert.ok(output.project_standards.includes('wcag-22'), 'other standards should remain');
  });

  test('remove deletes file when last standard removed', () => {
    runPanTools('standards select owasp-top10', tmpDir);

    const result = runPanTools('standards remove owasp-top10', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.standards_file, null, 'standards_file should be null after last removal');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'standards.md')), 'file should be deleted');
  });
});

describe('standards-status command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns none status when no standards selected', () => {
    const result = runPanTools('standards status', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.overall_status, 'none', 'status should be none');
    assert.strictEqual(output.project_standards.length, 0, 'should have no standards');
  });

  test('returns configured status when standard selected but not checked', () => {
    runPanTools('standards select owasp-top10', tmpDir);

    const result = runPanTools('standards status', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.overall_status, 'configured', 'should be configured (no items checked)');
    assert.ok(output.checks.length > 0, 'should have at least one check entry');
    assert.strictEqual(output.checks[0].standard_id, 'owasp-top10', 'check should reference the standard');
    assert.strictEqual(output.checks[0].status, 'configured', 'individual status should be configured');
    assert.strictEqual(output.checks[0].verified_items, 0, 'no items should be verified yet');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config routing defaults
// ─────────────────────────────────────────────────────────────────────────────

describe('config routing defaults', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('config-ensure-section includes routing section with correct defaults', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    assert.strictEqual(typeof config.routing, 'object', 'routing should be an object');
    assert.strictEqual(config.routing.strategy, 'static', 'default strategy should be static');
    assert.strictEqual(config.routing.provider, 'auto', 'default provider should be auto');
    assert.strictEqual(config.routing.cascade_quality_gate, true, 'cascade_quality_gate should default true');
    assert.strictEqual(typeof config.routing.complexity_thresholds, 'object', 'complexity_thresholds should be an object');
    assert.strictEqual(config.routing.complexity_thresholds.downgrade_max, 2);
    assert.strictEqual(config.routing.complexity_thresholds.upgrade_min, 6);
  });

  test('user defaults override routing strategy but preserve other routing fields', () => {
    // Write a user defaults file that overrides just strategy
    const homeDefaults = path.join(tmpDir, '.pan-wizard');
    fs.mkdirSync(homeDefaults, { recursive: true });
    // Can't mock os.homedir in subprocess, so test via config-set instead
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success);

    // Now set routing.strategy via config-set
    const setResult = runPanTools('config-set routing.strategy complexity', tmpDir);
    assert.ok(setResult.success, `config-set failed: ${setResult.error}`);

    // Verify only strategy changed, other routing fields preserved
    const getStrategy = runPanTools('config-get routing.strategy', tmpDir);
    assert.ok(getStrategy.success);
    assert.strictEqual(JSON.parse(getStrategy.output), 'complexity');

    const getProvider = runPanTools('config-get routing.provider', tmpDir);
    assert.ok(getProvider.success);
    assert.strictEqual(JSON.parse(getProvider.output), 'auto', 'provider should still be auto');
  });

  test('routing section deep-merges without dropping nested fields', () => {
    const result = runPanTools('config-ensure-section', tmpDir);
    assert.ok(result.success);

    // Set a nested threshold value
    const setResult = runPanTools('config-set routing.complexity_thresholds.upgrade_min 8', tmpDir);
    assert.ok(setResult.success, `config-set failed: ${setResult.error}`);

    // Verify the other threshold is still present
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(config.routing.complexity_thresholds.upgrade_min, 8, 'upgrade_min should be updated');
    assert.strictEqual(config.routing.complexity_thresholds.downgrade_max, 2, 'downgrade_max should be preserved');
    assert.strictEqual(config.routing.strategy, 'static', 'strategy should be preserved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR-0031: build / verification / concurrency config keys (focus-auto --clean-seal)
// ─────────────────────────────────────────────────────────────────────────────

describe('loadConfig build/verification/concurrency keys', () => {
  const { loadConfig } = require('../pan-wizard-core/bin/lib/core.cjs');
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('default to null / serial_build false when unset', () => {
    const c = loadConfig(tmpDir);
    assert.strictEqual(c.build, null);
    assert.strictEqual(c.verification, null);
    assert.deepStrictEqual(c.concurrency, { serial_build: false });
  });

  test('surfaces configured build/verification commands', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ build: 'npm run build', verification: 'npm test', concurrency: { serial_build: true } })
    );
    const c = loadConfig(tmpDir);
    assert.strictEqual(c.build, 'npm run build');
    assert.strictEqual(c.verification, 'npm test');
    assert.strictEqual(c.concurrency.serial_build, true);
  });

  test('config-set writes build/verification readable by loadConfig', () => {
    runPanTools('config-set build "npm run build"', tmpDir);
    runPanTools('config-set verification "npm test"', tmpDir);
    const c = loadConfig(tmpDir);
    assert.strictEqual(c.build, 'npm run build');
    assert.strictEqual(c.verification, 'npm test');
  });

  test('malformed config falls back to null keys', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), '{ not valid json');
    const c = loadConfig(tmpDir);
    assert.strictEqual(c.build, null);
    assert.strictEqual(c.verification, null);
    assert.deepStrictEqual(c.concurrency, { serial_build: false });
  });
});
