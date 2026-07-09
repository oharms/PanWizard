/**
 * PAN Tools Tests - Core Module Functions & Utility Commands
 *
 * Tests for: generate-slug, current-timestamp, verify-path-exists,
 * find-phase, resolve-model commands and pure utility functions
 * (toPosix, escapeRegex, generateSlugInternal, normalizePhaseName).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');
const { generateSlugInternal, toPosix, escapeRegex, normalizePhaseName, verbose, findPhaseInternal, scanPendingTodos, scanSourceTodos, getArchivedPhaseDirs, getRoadmapPhaseInternal, resolveModelInternal, searchPhaseInDir, PROVIDER_MODELS, LEGACY_ALIASES, COST_MULTIPLIERS, MODEL_PROFILES, detectProvider, resolveTierToModel, resolveComplexityTier, estimateCostMultiplier, getPhaseModelTier, adjustTierForCapabilities } = require('../pan-wizard-core/bin/lib/core.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// generate-slug command
// ─────────────────────────────────────────────────────────────────────────────

describe('generate-slug command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('converts simple text to lowercase hyphenated slug', () => {
    const result = runPanTools('generate-slug "Hello World"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'hello-world');
    assert.ok(!output.error, 'should not have error on success');
    assert.ok(/^[a-z0-9-]+$/.test(output.slug), 'slug should only contain lowercase, digits, hyphens');
  });

  test('strips special characters and collapses separators', () => {
    const result = runPanTools('generate-slug "Setup & Config!"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'setup-config');
    assert.ok(!output.slug.includes('&'), 'should strip ampersand');
    assert.ok(!output.slug.includes('!'), 'should strip exclamation');
  });

  test('handles text with multiple consecutive special characters', () => {
    const result = runPanTools('generate-slug "one---two___three"', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'one-two-three');
    assert.ok(!output.slug.includes('--'), 'should not have consecutive hyphens');
  });

  test('returns error when text is empty', () => {
    const result = runPanTools('generate-slug', tmpDir);
    assert.ok(!result.success, 'should fail for missing argument');
    assert.ok(result.error.includes('text required'), 'error mentions text required');
  });

  test('outputs raw slug with --raw flag', () => {
    const result = runPanTools('generate-slug "My Feature" --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'my-feature');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// current-timestamp command
// ─────────────────────────────────────────────────────────────────────────────

describe('current-timestamp command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('full format returns ISO 8601 string', () => {
    const result = runPanTools('current-timestamp full', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(!output.error, 'should not have error on success');
    assert.strictEqual(typeof output.timestamp, 'string', 'timestamp should be string');
    assert.ok(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(output.timestamp),
      `Expected ISO 8601 format, got: ${output.timestamp}`
    );
  });

  test('date format returns YYYY-MM-DD', () => {
    const result = runPanTools('current-timestamp date', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.timestamp, 'string', 'timestamp should be string');
    assert.strictEqual(output.timestamp.length, 10, 'date format should be 10 chars');
    assert.ok(
      /^\d{4}-\d{2}-\d{2}$/.test(output.timestamp),
      `Expected YYYY-MM-DD format, got: ${output.timestamp}`
    );
  });

  test('filename format returns colons replaced with hyphens and no milliseconds', () => {
    const result = runPanTools('current-timestamp filename', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.timestamp.includes(':'),
      `Filename format should not contain colons, got: ${output.timestamp}`
    );
    assert.ok(
      !output.timestamp.includes('.'),
      `Filename format should not contain dots (milliseconds), got: ${output.timestamp}`
    );
    assert.ok(
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/.test(output.timestamp),
      `Expected filename format, got: ${output.timestamp}`
    );
  });

  test('default (no format) returns full ISO 8601', () => {
    const result = runPanTools('current-timestamp', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/.test(output.timestamp),
      `Expected full ISO format by default, got: ${output.timestamp}`
    );
  });

  test('raw flag outputs plain timestamp string', () => {
    const result = runPanTools('current-timestamp date --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(
      /^\d{4}-\d{2}-\d{2}$/.test(result.output),
      `Expected raw date string, got: ${result.output}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-path-exists command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-path-exists command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('existing file returns exists true with type file', () => {
    const filePath = path.join(tmpDir, 'test-file.txt');
    fs.writeFileSync(filePath, 'hello');

    const result = runPanTools(`verify-path-exists test-file.txt`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
    assert.ok(!output.error, 'should not have error field');
  });

  test('existing directory returns exists true with type directory', () => {
    const result = runPanTools('verify-path-exists .planning', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'directory');
    assert.ok(!output.error, 'should not have error field');
  });

  test('non-existent path returns exists false', () => {
    const result = runPanTools('verify-path-exists nonexistent/file.txt', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, false);
    assert.strictEqual(output.type, null);
    assert.ok(!output.error, 'should not have error field');
  });

  test('missing argument returns error', () => {
    const result = runPanTools('verify-path-exists', tmpDir);
    assert.ok(!result.success, 'should fail for missing argument');
    assert.ok(result.error.includes('path required'), 'error mentions path required');
  });

  test('absolute path works correctly', () => {
    const filePath = path.join(tmpDir, 'abs-test.txt');
    fs.writeFileSync(filePath, 'content');

    const result = runPanTools(`verify-path-exists "${filePath}"`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// find-phase command
// ─────────────────────────────────────────────────────────────────────────────

describe('find-phase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('finds existing phase and returns phase info', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '02-api-layer');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '02-01-plan.md'), '# Plan');
    fs.writeFileSync(path.join(phaseDir, '02-01-summary.md'), '# Summary');

    const result = runPanTools('find-phase 2', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true);
    assert.strictEqual(output.phase_number, '02');
    assert.strictEqual(output.phase_name, 'api-layer');
    assert.ok(Array.isArray(output.plans), 'plans should be an array');
    assert.strictEqual(output.plans.length, 1);
    assert.ok(Array.isArray(output.summaries), 'summaries should be an array');
    assert.strictEqual(output.summaries.length, 1);
  });

  test('returns error for non-existent phase', () => {
    const result = runPanTools('find-phase 99', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, false);
    assert.ok(!output.phase_name, 'should not have phase_name when not found');
  });

  test('unpadded input matches padded directory (3 matches 03-name)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-auth-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('find-phase 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true);
    assert.strictEqual(output.phase_number, '03');
    assert.strictEqual(output.phase_name, 'auth-setup');
  });

  test('returns plans and summaries counts for partially completed phase', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Summary 1');
    fs.writeFileSync(path.join(phaseDir, '01-02-plan.md'), '# Plan 2');

    const result = runPanTools('find-phase 1', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.plans.length, 2, 'should have 2 plans');
    assert.strictEqual(output.summaries.length, 1, 'should have 1 summary');
    assert.ok(output.plans.includes('01-02-plan.md'), 'should list incomplete plan');
  });

  test('directory field uses forward slashes (toPosix)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '04-deploy');
    fs.mkdirSync(phaseDir, { recursive: true });

    const result = runPanTools('find-phase 4', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.found, true);
    assert.ok(!output.directory.includes('\\'), 'directory should use forward slashes, not backslashes');
    assert.ok(output.directory.includes('.planning/phases/04-deploy'), 'directory should contain POSIX path');
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

  test('known agent type returns model for default balanced profile', () => {
    const result = runPanTools('resolve-model pan-executor', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.model, 'sonnet', 'pan-executor balanced profile should be sonnet');
    assert.strictEqual(output.profile, 'balanced');
    assert.ok(!output.error, 'should not have error field');
    assert.ok(!output.unknown_agent, 'known agent should not have unknown_agent flag');
  });

  test('unknown agent type returns sonnet fallback', () => {
    const result = runPanTools('resolve-model unknown-agent-xyz', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.model, 'sonnet', 'unknown agent should get sonnet fallback');
    assert.strictEqual(output.unknown_agent, true);
    assert.strictEqual(typeof output.profile, 'string', 'should still report profile');
  });

  test('opus-tier model returns inherit', () => {
    // pan-planner in balanced profile is 'opus' -> should be 'inherit'
    // Create config with quality profile to get opus
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality' })
    );

    const result = runPanTools('resolve-model pan-planner', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.model, 'inherit', 'opus should be returned as inherit');
    assert.strictEqual(output.profile, 'quality');
  });

  test('missing agent type returns error', () => {
    const result = runPanTools('resolve-model', tmpDir);
    assert.ok(!result.success, 'should fail for missing agent type');
    assert.ok(result.error.includes('agent-type required'), 'error mentions agent-type required');
  });

  test('raw flag outputs plain model name', () => {
    const result = runPanTools('resolve-model pan-executor --raw', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'sonnet');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// toPosix pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('toPosix', () => {
  test('converts backslashes to forward slashes', () => {
    // On Windows path.sep is '\\'; toPosix splits on path.sep and joins with '/'
    // We test with actual path.sep to be platform-correct
    const input = ['src', 'lib', 'core.cjs'].join(path.sep);
    const result = toPosix(input);
    assert.strictEqual(result, 'src/lib/core.cjs');
  });

  test('preserves already-posix paths', () => {
    const result = toPosix('src/lib/core.cjs');
    assert.strictEqual(result, 'src/lib/core.cjs');
  });

  test('handles single segment without separators', () => {
    const result = toPosix('filename.txt');
    assert.strictEqual(result, 'filename.txt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// escapeRegex pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('escapeRegex', () => {
  test('escapes dots', () => {
    assert.strictEqual(escapeRegex('file.txt'), 'file\\.txt');
  });

  test('escapes brackets and parentheses', () => {
    assert.strictEqual(escapeRegex('[a](b)'), '\\[a\\]\\(b\\)');
  });

  test('escapes asterisks and plus signs', () => {
    assert.strictEqual(escapeRegex('a*b+c'), 'a\\*b\\+c');
  });

  test('escapes question marks and carets', () => {
    assert.strictEqual(escapeRegex('a?b^c$d'), 'a\\?b\\^c\\$d');
  });

  test('escapes curly braces and pipes', () => {
    assert.strictEqual(escapeRegex('{a|b}'), '\\{a\\|b\\}');
  });

  test('escapes backslashes', () => {
    assert.strictEqual(escapeRegex('a\\b'), 'a\\\\b');
  });

  test('passes through plain alphanumeric text unchanged', () => {
    assert.strictEqual(escapeRegex('hello123'), 'hello123');
  });

  test('converts non-string input to string', () => {
    assert.strictEqual(escapeRegex(42), '42');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateSlugInternal pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('generateSlugInternal', () => {
  test('converts simple text to slug', () => {
    assert.strictEqual(generateSlugInternal('Hello World'), 'hello-world');
  });

  test('strips special characters', () => {
    assert.strictEqual(generateSlugInternal('Setup & Config!'), 'setup-config');
  });

  test('trims leading and trailing hyphens', () => {
    assert.strictEqual(generateSlugInternal('--leading-trailing--'), 'leading-trailing');
  });

  test('returns null for empty string', () => {
    assert.strictEqual(generateSlugInternal(''), null);
  });

  test('returns null for null input', () => {
    assert.strictEqual(generateSlugInternal(null), null);
  });

  test('returns null for undefined input', () => {
    assert.strictEqual(generateSlugInternal(undefined), null);
  });

  test('collapses multiple non-alphanumeric characters into single hyphen', () => {
    assert.strictEqual(generateSlugInternal('a   b___c---d'), 'a-b-c-d');
  });

  test('handles unicode by stripping non-ascii characters', () => {
    const result = generateSlugInternal('cafe resume');
    assert.strictEqual(result, 'cafe-resume');
  });

  test('preserves numbers in slug', () => {
    assert.strictEqual(generateSlugInternal('Phase 3 API v2'), 'phase-3-api-v2');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// normalizePhaseName pure function
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizePhaseName', () => {
  test('pads single digit to two digits', () => {
    assert.strictEqual(normalizePhaseName('1'), '01');
  });

  test('preserves already-padded number', () => {
    assert.strictEqual(normalizePhaseName('03'), '03');
  });

  test('handles letter suffix and uppercases it', () => {
    assert.strictEqual(normalizePhaseName('3a'), '03A');
  });

  test('handles decimal phases', () => {
    assert.strictEqual(normalizePhaseName('12.1'), '12.1');
  });

  test('handles complex phase identifier with letter and decimals', () => {
    assert.strictEqual(normalizePhaseName('2A.1'), '02A.1');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --verbose flag
// ─────────────────────────────────────────────────────────────────────────────

describe('--verbose flag', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('--verbose flag produces stderr output', () => {
    // Use a command that works without state (generate-slug)
    const { execSync } = require('child_process');
    const TOOLS_PATH = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const result = execSync(`node "${TOOLS_PATH}" generate-slug hello --verbose`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    // Command should still succeed with JSON output
    const output = JSON.parse(result.trim());
    assert.strictEqual(output.slug, 'hello');
  });

  test('--verbose flag is stripped from args before routing', () => {
    // If --verbose were not stripped, generate-slug would get "hello --verbose"
    // instead of "hello", and the slug would be wrong
    const { execSync } = require('child_process');
    const TOOLS_PATH = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const result = execSync(`node "${TOOLS_PATH}" generate-slug test-input --verbose`, {
      cwd: tmpDir,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = JSON.parse(result.trim());
    assert.strictEqual(output.slug, 'test-input');
  });

  test('commands work normally without --verbose', () => {
    const result = runPanTools('generate-slug normal-test', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'normal-test');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verbose() helper function
// ─────────────────────────────────────────────────────────────────────────────

describe('verbose() helper', () => {
  const originalEnv = process.env.PAN_VERBOSE;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PAN_VERBOSE;
    } else {
      process.env.PAN_VERBOSE = originalEnv;
    }
  });

  test('verbose() is a function', () => {
    assert.strictEqual(typeof verbose, 'function');
  });

  test('verbose() does not throw when PAN_VERBOSE is unset', () => {
    delete process.env.PAN_VERBOSE;
    assert.doesNotThrow(() => verbose('test message'));
  });

  test('verbose() does not throw when PAN_VERBOSE is set', () => {
    process.env.PAN_VERBOSE = '1';
    assert.doesNotThrow(() => verbose('test message'));
  });

  test('verbose() accepts multiple arguments', () => {
    delete process.env.PAN_VERBOSE;
    assert.doesNotThrow(() => verbose('arg1', 'arg2', 'arg3'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Mermaid diagrams + TOGAF in codebase templates
// ─────────────────────────────────────────────────────────────────────────────

describe('codebase templates — Mermaid diagrams', () => {
  const templatesDir = path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'codebase');

  test('architecture.md contains Mermaid flowchart', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'architecture.md'), 'utf8');
    assert.ok(content.includes('```mermaid'), 'Should contain Mermaid code fence');
    assert.ok(content.includes('graph LR') || content.includes('graph TD'), 'Should contain flowchart directive');
  });

  test('architecture.md contains Mermaid sequence diagram', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'architecture.md'), 'utf8');
    assert.ok(content.includes('sequenceDiagram'), 'Should contain sequence diagram');
  });

  test('architecture.md has TOGAF Business Architecture section', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'architecture.md'), 'utf8');
    assert.ok(content.includes('Business Architecture'), 'Should have Business Architecture section');
  });

  test('architecture.md has TOGAF Application Architecture section', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'architecture.md'), 'utf8');
    assert.ok(content.includes('Application Architecture'), 'Should have Application Architecture section');
  });

  test('structure.md contains Mermaid hierarchy diagram', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'structure.md'), 'utf8');
    assert.ok(content.includes('```mermaid'), 'Should contain Mermaid code fence');
    assert.ok(content.includes('graph TD'), 'Should contain top-down hierarchy diagram');
  });

  test('stack.md contains Mermaid deployment diagram', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'stack.md'), 'utf8');
    assert.ok(content.includes('```mermaid'), 'Should contain Mermaid code fence');
    assert.ok(content.includes('Technology Architecture'), 'Should have Technology Architecture header');
  });

  test('integrations.md contains Mermaid service map', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'integrations.md'), 'utf8');
    assert.ok(content.includes('```mermaid'), 'Should contain Mermaid code fence');
    assert.ok(content.includes('graph LR') || content.includes('graph TD'), 'Should contain service map diagram');
  });

  test('integrations.md contains Mermaid ER diagram', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'integrations.md'), 'utf8');
    assert.ok(content.includes('erDiagram'), 'Should contain ER diagram');
    assert.ok(content.includes('Data Architecture'), 'Should have Data Architecture section');
  });

  test('concerns.md contains Mermaid quadrant chart', () => {
    const content = fs.readFileSync(path.join(templatesDir, 'concerns.md'), 'utf8');
    assert.ok(content.includes('```mermaid'), 'Should contain Mermaid code fence');
    assert.ok(content.includes('quadrantChart'), 'Should contain quadrant chart');
  });

  test('no template contains Mermaid click directive (security)', () => {
    const files = fs.readdirSync(templatesDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(templatesDir, file), 'utf8');
      // Check within mermaid blocks only for 'click ' directive
      const mermaidBlocks = content.match(/```mermaid[\s\S]*?```/g) || [];
      for (const block of mermaidBlocks) {
        assert.ok(!block.includes('click '), `${file} should not contain Mermaid click directive`);
      }
    }
  });

  test('conventions.md and testing.md have no Mermaid blocks (by design)', () => {
    const conventions = fs.readFileSync(path.join(templatesDir, 'conventions.md'), 'utf8');
    const testing = fs.readFileSync(path.join(templatesDir, 'testing.md'), 'utf8');
    // These templates should not have mermaid blocks in their File Template section
    // (they may mention mermaid in guidelines but the template itself should not)
    assert.ok(!conventions.includes('```mermaid'), 'conventions.md template should not have Mermaid blocks');
    assert.ok(!testing.includes('```mermaid'), 'testing.md template should not have Mermaid blocks');
  });
});

describe('mapper agent — diagram guidelines', () => {
  test('agents/pan-document_code.md has diagram_guidelines section', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'agents', 'pan-document_code.md'), 'utf8');
    assert.ok(content.includes('<diagram_guidelines>'), 'Should have diagram_guidelines section');
    assert.ok(content.includes('Mermaid'), 'Should mention Mermaid');
  });

  test('mapper agent mentions TOGAF', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'agents', 'pan-document_code.md'), 'utf8');
    assert.ok(content.includes('TOGAF'), 'Should mention TOGAF alignment');
  });

  test('mapper agent has security rule for diagram labels', () => {
    const content = fs.readFileSync(path.join(__dirname, '..', 'agents', 'pan-document_code.md'), 'utf8');
    assert.ok(content.includes('credentials') || content.includes('API keys'), 'Should warn against credentials in diagrams');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// findPhaseInternal — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('findPhaseInternal', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create a phase directory structure
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    fs.mkdirSync(phasesDir, { recursive: true });
    // Phase 01-setup
    const p1 = path.join(phasesDir, '01-setup');
    fs.mkdirSync(p1);
    fs.writeFileSync(path.join(p1, '01-plan.md'), '# Plan 1');
    // Phase 02-implementation (uses -plan.md/-summary.md suffix convention)
    const p2 = path.join(phasesDir, '02-implementation');
    fs.mkdirSync(p2);
    fs.writeFileSync(path.join(p2, '01-plan.md'), '# Plan 1');
    fs.writeFileSync(path.join(p2, '01-summary.md'), '# Summary 1');
    fs.writeFileSync(path.join(p2, '02-plan.md'), '# Plan 2');
    // Phase 03.1-hotfix (decimal — note: zero-padded base)
    const p3 = path.join(phasesDir, '03.1-hotfix');
    fs.mkdirSync(p3);
    fs.writeFileSync(path.join(p3, '01-plan.md'), '# Plan 1');
  });

  afterEach(() => cleanup(tmpDir));

  test('finds phase by number prefix', () => {
    const result = findPhaseInternal(tmpDir, '1');
    assert.ok(result, 'Should find phase 1');
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.phase_number, '01');
    assert.strictEqual(result.phase_name, 'setup');
  });

  test('finds phase by full number', () => {
    const result = findPhaseInternal(tmpDir, '02');
    assert.ok(result, 'Should find phase 02');
    assert.strictEqual(result.phase_number, '02');
    assert.strictEqual(result.phase_name, 'implementation');
  });

  test('returns directory with posix separators', () => {
    const result = findPhaseInternal(tmpDir, '1');
    assert.ok(!result.directory.includes('\\'), 'Should use forward slashes');
    assert.ok(result.directory.includes('.planning/phases/01-setup'));
  });

  test('lists plans and summaries', () => {
    const result = findPhaseInternal(tmpDir, '2');
    assert.deepStrictEqual(result.plans, ['01-plan.md', '02-plan.md']);
    assert.deepStrictEqual(result.summaries, ['01-summary.md']);
  });

  test('computes incomplete plans correctly', () => {
    const result = findPhaseInternal(tmpDir, '2');
    // 01-PLAN has 01-SUMMARY, so only 02-PLAN is incomplete
    assert.deepStrictEqual(result.incomplete_plans, ['02-plan.md']);
  });

  test('finds decimal phase', () => {
    const result = findPhaseInternal(tmpDir, '3.1');
    assert.ok(result, 'Should find phase 3.1');
    assert.strictEqual(result.phase_number, '03.1');
    assert.strictEqual(result.phase_name, 'hotfix');
  });

  test('returns null for missing phase', () => {
    assert.strictEqual(findPhaseInternal(tmpDir, '99'), null);
  });

  test('returns null for null input', () => {
    assert.strictEqual(findPhaseInternal(tmpDir, null), null);
  });

  test('returns null for empty string', () => {
    assert.strictEqual(findPhaseInternal(tmpDir, ''), null);
  });

  test('includes phase_slug', () => {
    const result = findPhaseInternal(tmpDir, '2');
    assert.strictEqual(result.phase_slug, 'implementation');
  });

  test('searches archived milestones when phase not in active', () => {
    // Create an archived milestone with a phase
    const archiveDir = path.join(tmpDir, '.planning', 'milestones', 'v0.1.0-phases');
    const archivedPhase = path.join(archiveDir, '05-archived-feature');
    fs.mkdirSync(archivedPhase, { recursive: true });
    fs.writeFileSync(path.join(archivedPhase, '01-plan.md'), '# Plan');
    const result = findPhaseInternal(tmpDir, '5');
    assert.ok(result, 'Should find archived phase');
    assert.strictEqual(result.archived, 'v0.1.0');
    assert.strictEqual(result.phase_number, '05');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanPendingTodos — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('scanPendingTodos', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('returns empty when no pending dir exists', () => {
    const result = scanPendingTodos(tmpDir);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.todos, []);
  });

  test('finds pending todo files', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'fix-bug.md'), [
      'title: Fix login bug',
      'created: 2026-03-01',
      'area: auth',
    ].join('\n'));
    const result = scanPendingTodos(tmpDir);
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.todos[0].title, 'Fix login bug');
    assert.strictEqual(result.todos[0].area, 'auth');
    assert.strictEqual(result.todos[0].created, '2026-03-01');
    assert.strictEqual(result.todos[0].file, 'fix-bug.md');
  });

  test('filters by area', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'todo1.md'), 'title: Auth task\narea: auth');
    fs.writeFileSync(path.join(pendingDir, 'todo2.md'), 'title: API task\narea: api');
    const authResult = scanPendingTodos(tmpDir, 'auth');
    assert.strictEqual(authResult.count, 1);
    assert.strictEqual(authResult.todos[0].title, 'Auth task');
  });

  test('defaults area to general when missing', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'todo.md'), 'title: No area todo');
    const result = scanPendingTodos(tmpDir);
    assert.strictEqual(result.todos[0].area, 'general');
  });

  test('defaults title to Untitled when missing', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'empty.md'), 'created: 2026-03-01');
    const result = scanPendingTodos(tmpDir);
    assert.strictEqual(result.todos[0].title, 'Untitled');
  });

  test('skips non-.md files', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(path.join(pendingDir, 'todo.md'), 'title: Real todo');
    fs.writeFileSync(path.join(pendingDir, 'notes.txt'), 'not a todo');
    const result = scanPendingTodos(tmpDir);
    assert.strictEqual(result.count, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanSourceTodos — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('scanSourceTodos', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns empty when no lib dir exists', () => {
    const result = scanSourceTodos(tmpDir);
    assert.strictEqual(result.count, 0);
    assert.deepStrictEqual(result.items, []);
  });

  test('finds TODO comment in source file', () => {
    const libDir = path.join(tmpDir, 'pan-wizard-core', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'example.cjs'), '// TODO: fix this later\nconst x = 1;');
    const result = scanSourceTodos(tmpDir);
    assert.strictEqual(result.count, 1);
    assert.strictEqual(result.items[0].tag, 'TODO');
    assert.strictEqual(result.items[0].text, 'fix this later');
    assert.strictEqual(result.items[0].line, 1);
    assert.ok(result.items[0].file.includes('example.cjs'));
  });

  test('finds FIXME and HACK comments', () => {
    const libDir = path.join(tmpDir, 'pan-wizard-core', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'multi.cjs'), 'line1\n// FIXME: broken\nline3\n// HACK: workaround\n');
    const result = scanSourceTodos(tmpDir);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.items[0].tag, 'FIXME');
    assert.strictEqual(result.items[1].tag, 'HACK');
  });

  test('returns empty when source files are clean', () => {
    const libDir = path.join(tmpDir, 'pan-wizard-core', 'bin', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, 'clean.cjs'), 'const x = 1;\nmodule.exports = { x };');
    const result = scanSourceTodos(tmpDir);
    assert.strictEqual(result.count, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getArchivedPhaseDirs
// ─────────────────────────────────────────────────────────────────────────────

describe('getArchivedPhaseDirs', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns empty array when no milestones directory', () => {
    const result = getArchivedPhaseDirs(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('returns empty array when milestones dir has no phase archives', () => {
    const milestonesDir = path.join(tmpDir, '.planning', 'milestones');
    fs.mkdirSync(milestonesDir, { recursive: true });
    fs.writeFileSync(path.join(milestonesDir, 'v1.0-roadmap.md'), '# Roadmap');
    const result = getArchivedPhaseDirs(tmpDir);
    assert.deepStrictEqual(result, []);
  });

  test('finds archived phase directories from milestone archives', () => {
    const archiveDir = path.join(tmpDir, '.planning', 'milestones', 'v1.0-phases');
    const phaseDir = path.join(archiveDir, '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-plan.md'), '# Plan');

    const result = getArchivedPhaseDirs(tmpDir);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].name, '01-setup');
    assert.strictEqual(result[0].milestone, 'v1.0');
  });

  test('returns multiple archives sorted newest first', () => {
    const v1Dir = path.join(tmpDir, '.planning', 'milestones', 'v1.0-phases', '01-setup');
    const v2Dir = path.join(tmpDir, '.planning', 'milestones', 'v2.0-phases', '01-foundation');
    fs.mkdirSync(v1Dir, { recursive: true });
    fs.mkdirSync(v2Dir, { recursive: true });

    const result = getArchivedPhaseDirs(tmpDir);
    assert.strictEqual(result.length, 2);
    // v2.0 should come first (reverse sort)
    assert.strictEqual(result[0].milestone, 'v2.0');
    assert.strictEqual(result[1].milestone, 'v1.0');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getRoadmapPhaseInternal
// ─────────────────────────────────────────────────────────────────────────────

describe('getRoadmapPhaseInternal', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns null when no roadmap.md exists', () => {
    const result = getRoadmapPhaseInternal(tmpDir, '1');
    assert.strictEqual(result, null);
  });

  test('returns null for null phaseNum', () => {
    const result = getRoadmapPhaseInternal(tmpDir, null);
    assert.strictEqual(result, null);
  });

  test('finds phase section with goal', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: Foundation\n**Goal:** Build the base\n\nSome description.\n\n### Phase 2: API\n**Goal:** Build REST API\n'
    );

    const result = getRoadmapPhaseInternal(tmpDir, '1');
    assert.ok(result);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.phase_name, 'Foundation');
    assert.strictEqual(result.goal, 'Build the base');
    assert.ok(result.section.includes('Some description'));
  });

  test('returns null for non-existent phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: Foundation\n**Goal:** Build the base\n'
    );

    const result = getRoadmapPhaseInternal(tmpDir, '99');
    assert.strictEqual(result, null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveModelInternal
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveEffortInternal + AGENT_BASE_EFFORT (effort-aware profiles, 2026-06)', () => {
  const { resolveEffortInternal, AGENT_BASE_EFFORT, EFFORT_ORDER } = require('../pan-wizard-core/bin/lib/core.cjs');
  let tmpDir;

  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('every MODEL_PROFILES agent has a base effort and vice versa', () => {
    assert.deepEqual(Object.keys(AGENT_BASE_EFFORT).sort(), Object.keys(MODEL_PROFILES).sort());
    for (const effort of Object.values(AGENT_BASE_EFFORT)) {
      assert.ok(EFFORT_ORDER.includes(effort), `invalid effort level: ${effort}`);
    }
  });

  test('agent frontmatter effort matches AGENT_BASE_EFFORT (drift guard)', () => {
    const agentsDir = path.join(__dirname, '..', 'agents');
    for (const [agent, base] of Object.entries(AGENT_BASE_EFFORT)) {
      const content = fs.readFileSync(path.join(agentsDir, `${agent}.md`), 'utf-8');
      const m = content.match(/^effort:\s*(\S+)/m);
      assert.ok(m, `${agent}.md should declare effort frontmatter`);
      assert.equal(m[1], base, `${agent}.md effort drifted from AGENT_BASE_EFFORT`);
    }
  });

  test('balanced/quality profiles keep base effort', () => {
    assert.equal(resolveEffortInternal(tmpDir, 'pan-planner'), 'xhigh');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality' }));
    assert.equal(resolveEffortInternal(tmpDir, 'pan-planner'), 'xhigh');
  });

  test('budget profile steps effort down one level (floor low)', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'budget' }));
    assert.equal(resolveEffortInternal(tmpDir, 'pan-planner'), 'high');     // xhigh → high
    assert.equal(resolveEffortInternal(tmpDir, 'pan-reviewer'), 'low');     // medium → low
    assert.equal(resolveEffortInternal(tmpDir, 'pan-document_code'), 'low'); // low stays low
  });

  test('effort_overrides wins over profile', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'budget', effort_overrides: { 'pan-planner': 'max' } }));
    // 'max' is not a routing level PAN emits — invalid values fall through to profile logic
    assert.equal(resolveEffortInternal(tmpDir, 'pan-planner'), 'high');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'budget', effort_overrides: { 'pan-planner': 'xhigh' } }));
    assert.equal(resolveEffortInternal(tmpDir, 'pan-planner'), 'xhigh');
  });

  test('unknown agent defaults to medium', () => {
    assert.equal(resolveEffortInternal(tmpDir, 'no-such-agent'), 'medium');
  });
});

describe('resolveModelInternal', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns sonnet for unknown agent type', () => {
    const result = resolveModelInternal(tmpDir, 'unknown-agent');
    assert.strictEqual(result, 'sonnet');
  });

  test('returns model based on balanced profile for known agent', () => {
    // Create config with balanced profile
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    const result = resolveModelInternal(tmpDir, 'pan-planner');
    assert.ok(['inherit', 'sonnet', 'haiku'].includes(result), 'should return a valid model tier');
  });

  test('respects quality profile for known agent', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality' })
    );
    const result = resolveModelInternal(tmpDir, 'pan-planner');
    // Quality profile maps pan-planner to opus -> 'inherit'
    assert.strictEqual(result, 'inherit');
  });

  test('defaults to balanced profile when config missing', () => {
    // No config.json — loadConfig returns defaults with model_profile: balanced
    const result = resolveModelInternal(tmpDir, 'pan-planner');
    assert.ok(['inherit', 'sonnet', 'haiku'].includes(result), 'should return valid model tier from balanced profile');
  });

  test('pan-reviewer resolves to haiku in balanced profile', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    const result = resolveModelInternal(tmpDir, 'pan-reviewer');
    assert.strictEqual(result, 'haiku');
  });

  test('pan-reviewer resolves to inherit (opus) in quality profile', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality' })
    );
    const result = resolveModelInternal(tmpDir, 'pan-reviewer');
    assert.strictEqual(result, 'inherit');
  });

  test('forces reasoning tier when context_estimate exceeds 1M threshold', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    // pan-reviewer is haiku in balanced — big context should override to inherit (reasoning).
    const result = resolveModelInternal(tmpDir, 'pan-reviewer', { context_estimate: 900000 });
    assert.strictEqual(result, 'inherit');
  });

  test('upgrades fast tier to mid when thinking required', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    const result = resolveModelInternal(tmpDir, 'pan-reviewer', { needs_thinking: true });
    assert.strictEqual(result, 'sonnet');
  });

  test('downgrades mid to fast when cache warm + small context + no thinking', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    // pan-executor is 'mid' in balanced. With cache warm + small ctx → fast.
    const result = resolveModelInternal(tmpDir, 'pan-executor', {
      cache_warm: true,
      context_estimate: 10000,
      needs_thinking: false,
    });
    assert.strictEqual(result, 'haiku');
  });

  test('leaves tier unchanged when no capability hints passed', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced' })
    );
    const withHints = resolveModelInternal(tmpDir, 'pan-executor', {});
    const noHints = resolveModelInternal(tmpDir, 'pan-executor');
    assert.strictEqual(withHints, noHints);
  });
});

describe('adjustTierForCapabilities', () => {
  test('returns tier unchanged when opts missing', () => {
    assert.strictEqual(adjustTierForCapabilities('mid'), 'mid');
    assert.strictEqual(adjustTierForCapabilities('fast', null), 'fast');
  });

  test('forces reasoning on large context', () => {
    assert.strictEqual(adjustTierForCapabilities('fast', { context_estimate: 800000 }), 'reasoning');
    assert.strictEqual(adjustTierForCapabilities('mid', { context_estimate: 700001 }), 'reasoning');
  });

  test('does not force reasoning on borderline context', () => {
    assert.strictEqual(adjustTierForCapabilities('mid', { context_estimate: 700000 }), 'mid');
  });

  test('upgrades fast to mid when thinking required', () => {
    assert.strictEqual(adjustTierForCapabilities('fast', { needs_thinking: true }), 'mid');
  });

  test('leaves mid/reasoning alone when thinking required', () => {
    assert.strictEqual(adjustTierForCapabilities('mid', { needs_thinking: true }), 'mid');
    assert.strictEqual(adjustTierForCapabilities('reasoning', { needs_thinking: true }), 'reasoning');
  });

  test('downgrades mid to fast on warm cache + small ctx + no thinking', () => {
    assert.strictEqual(
      adjustTierForCapabilities('mid', { cache_warm: true, context_estimate: 40000, needs_thinking: false }),
      'fast'
    );
  });

  test('does not downgrade when ctx is at threshold', () => {
    assert.strictEqual(
      adjustTierForCapabilities('mid', { cache_warm: true, context_estimate: 50000 }),
      'mid'
    );
  });

  test('does not downgrade fast or reasoning', () => {
    assert.strictEqual(
      adjustTierForCapabilities('fast', { cache_warm: true, context_estimate: 10000 }),
      'fast'
    );
    assert.strictEqual(
      adjustTierForCapabilities('reasoning', { cache_warm: true, context_estimate: 10000 }),
      'reasoning'
    );
  });

  test('large-ctx rule overrides thinking upgrade', () => {
    assert.strictEqual(
      adjustTierForCapabilities('fast', { context_estimate: 900000, needs_thinking: true }),
      'reasoning'
    );
  });
});

describe('searchPhaseInDir', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('finds a phase directory by number prefix', () => {
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    const phaseDir = path.join(phasesDir, '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), '# Plan\n');

    const result = searchPhaseInDir(phasesDir, '.planning/phases', '01');
    assert.ok(result);
    assert.strictEqual(result.found, true);
    assert.strictEqual(result.phase_number, '01');
    assert.ok(result.directory.includes('01-setup'));
    assert.strictEqual(result.plans.length, 1);
  });

  test('returns null when phase not found', () => {
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    fs.mkdirSync(phasesDir, { recursive: true });

    const result = searchPhaseInDir(phasesDir, '.planning/phases', '99');
    assert.strictEqual(result, null);
  });

  test('returns null for unreadable directory', () => {
    const result = searchPhaseInDir(path.join(tmpDir, 'no-such-dir'), '.planning/phases', '01');
    assert.strictEqual(result, null);
  });

  test('detects summaries and incomplete plans', () => {
    const phasesDir = path.join(tmpDir, '.planning', 'phases');
    const phaseDir = path.join(phasesDir, '02-build');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '02-01-plan.md'), '# Plan 1\n');
    fs.writeFileSync(path.join(phaseDir, '02-02-plan.md'), '# Plan 2\n');
    fs.writeFileSync(path.join(phaseDir, '02-01-summary.md'), '# Summary 1\n');

    const result = searchPhaseInDir(phasesDir, '.planning/phases', '02');
    assert.ok(result);
    assert.strictEqual(result.plans.length, 2);
    assert.strictEqual(result.summaries.length, 1);
    assert.strictEqual(result.incomplete_plans.length, 1);
    assert.ok(result.incomplete_plans[0].includes('02-plan'));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Multi-Model Routing — PROVIDER_MODELS & tier aliases
// ─────────────────────────────────────────────────────────────────────────────

describe('PROVIDER_MODELS structure', () => {
  test('has entries for anthropic, openai, google, and default', () => {
    for (const provider of ['anthropic', 'openai', 'google', 'default']) {
      assert.ok(PROVIDER_MODELS[provider], `missing provider: ${provider}`);
      assert.ok(PROVIDER_MODELS[provider].reasoning, `${provider} missing reasoning tier`);
      assert.ok(PROVIDER_MODELS[provider].mid, `${provider} missing mid tier`);
      assert.ok(PROVIDER_MODELS[provider].fast, `${provider} missing fast tier`);
    }
  });

  test('anthropic reasoning tier maps to inherit', () => {
    assert.strictEqual(PROVIDER_MODELS.anthropic.reasoning, 'inherit');
  });

  test('anthropic mid tier maps to sonnet', () => {
    assert.strictEqual(PROVIDER_MODELS.anthropic.mid, 'sonnet');
  });

  test('anthropic fast tier maps to haiku', () => {
    assert.strictEqual(PROVIDER_MODELS.anthropic.fast, 'haiku');
  });

  test('google mid tier maps to gemini-2.5-flash', () => {
    assert.strictEqual(PROVIDER_MODELS.google.mid, 'gemini-2.5-flash');
  });

  test('google fast tier maps to gemini-2.5-flash-lite', () => {
    assert.strictEqual(PROVIDER_MODELS.google.fast, 'gemini-2.5-flash-lite');
  });

  test('google reasoning tier inherits (host picks top Gemini Pro)', () => {
    assert.strictEqual(PROVIDER_MODELS.google.reasoning, 'inherit');
  });
});

describe('MODEL_PROFILES tier aliases', () => {
  test('all agents use tier aliases (reasoning/mid/fast) not model names', () => {
    const validTiers = ['reasoning', 'mid', 'fast'];
    for (const [agent, profiles] of Object.entries(MODEL_PROFILES)) {
      for (const [profile, tier] of Object.entries(profiles)) {
        assert.ok(validTiers.includes(tier), `${agent}.${profile} has invalid tier '${tier}' — expected one of ${validTiers.join(', ')}`);
      }
    }
  });

  test('quality profile maps all agents to reasoning tier', () => {
    for (const [agent, profiles] of Object.entries(MODEL_PROFILES)) {
      assert.strictEqual(profiles.quality, 'reasoning', `${agent} quality should be reasoning`);
    }
  });

  // P-1606 (v3.7.5): regression — when a new agent is added to agents/*.md,
  // it MUST also be registered in MODEL_PROFILES. Without this gate the agent
  // silently falls through to the default 'mid' tier in resolveModelInternal
  // regardless of profile, so quality mode under-uses reasoning models for it.
  test('every agents/*.md file is registered in MODEL_PROFILES', () => {
    const fs = require('fs');
    const path = require('path');
    const agentsDir = path.join(__dirname, '..', 'agents');
    const agentFiles = fs.readdirSync(agentsDir)
      .filter(f => f.endsWith('.md'))
      .map(f => f.replace(/\.md$/, ''));
    const registered = new Set(Object.keys(MODEL_PROFILES));
    const missing = agentFiles.filter(a => !registered.has(a));
    assert.deepStrictEqual(missing, [],
      `Agents on disk but missing from MODEL_PROFILES: [${missing.join(', ')}]. ` +
      `Add an entry to MODEL_PROFILES in pan-wizard-core/bin/lib/core.cjs ` +
      `with appropriate tiers (quality must be 'reasoning' per existing invariant).`);
  });
});

describe('resolveTierToModel', () => {
  test('resolves reasoning to inherit for anthropic', () => {
    assert.strictEqual(resolveTierToModel('reasoning', 'anthropic'), 'inherit');
  });

  test('resolves mid to sonnet for anthropic', () => {
    assert.strictEqual(resolveTierToModel('mid', 'anthropic'), 'sonnet');
  });

  test('resolves fast to haiku for anthropic', () => {
    assert.strictEqual(resolveTierToModel('fast', 'anthropic'), 'haiku');
  });

  test('resolves mid for openai provider', () => {
    assert.strictEqual(resolveTierToModel('mid', 'openai'), 'mid');
  });

  test('unknown provider falls back to default', () => {
    const result = resolveTierToModel('mid', 'unknown-provider');
    assert.strictEqual(result, 'sonnet');
  });
});

describe('LEGACY_ALIASES backward compatibility', () => {
  test('opus maps to reasoning via legacy alias', () => {
    assert.strictEqual(LEGACY_ALIASES.opus, 'reasoning');
    assert.strictEqual(resolveTierToModel('opus', 'anthropic'), 'inherit');
  });

  test('sonnet maps to mid via legacy alias', () => {
    assert.strictEqual(LEGACY_ALIASES.sonnet, 'mid');
    assert.strictEqual(resolveTierToModel('sonnet', 'anthropic'), 'sonnet');
  });

  test('haiku maps to fast via legacy alias', () => {
    assert.strictEqual(LEGACY_ALIASES.haiku, 'fast');
    assert.strictEqual(resolveTierToModel('haiku', 'anthropic'), 'haiku');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detectProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('detectProvider', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('returns configured provider from config routing section', () => {
    const result = detectProvider(tmpDir, { routing: { provider: 'openai' } });
    assert.strictEqual(result, 'openai');
  });

  test('returns default when config provider is auto', () => {
    // No runtime dirs — should fall back to default
    const result = detectProvider(tmpDir, { routing: { provider: 'auto' } });
    assert.strictEqual(result, 'default');
  });

  test('detects anthropic from .claude directory', () => {
    fs.mkdirSync(path.join(tmpDir, '.claude'), { recursive: true });
    const result = detectProvider(tmpDir, {});
    assert.strictEqual(result, 'anthropic');
  });

  test('returns default when no runtime directories exist', () => {
    const result = detectProvider(tmpDir, {});
    assert.strictEqual(result, 'default');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveModelInternal with routing strategies
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveModelInternal routing', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => cleanup(tmpDir));

  test('static strategy returns same as before (backward compat)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', routing: { strategy: 'static' } })
    );
    const result = resolveModelInternal(tmpDir, 'pan-executor');
    assert.strictEqual(result, 'sonnet');
  });

  test('per-agent override takes precedence over routing strategy', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        model_profile: 'budget',
        model_overrides: { 'pan-executor': 'opus' },
        routing: { strategy: 'complexity' },
      })
    );
    const result = resolveModelInternal(tmpDir, 'pan-executor');
    assert.strictEqual(result, 'inherit', 'opus override should resolve to inherit via legacy alias');
  });

  test('per-agent override with legacy sonnet still works', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({
        model_profile: 'quality',
        model_overrides: { 'pan-planner': 'sonnet' },
      })
    );
    const result = resolveModelInternal(tmpDir, 'pan-planner');
    assert.strictEqual(result, 'sonnet');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveComplexityTier
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveComplexityTier', () => {
  test('downgrades mid to fast on low complexity', () => {
    const result = resolveComplexityTier('mid', { fileCount: 2, waveCount: 1, requirementCount: 1 });
    assert.strictEqual(result, 'fast');
  });

  test('maintains tier on medium complexity', () => {
    const result = resolveComplexityTier('mid', { fileCount: 8, waveCount: 2, requirementCount: 3 });
    assert.strictEqual(result, 'mid');
  });

  test('upgrades mid to reasoning on high complexity', () => {
    const result = resolveComplexityTier('mid', { fileCount: 20, waveCount: 5, requirementCount: 8, isArchitectural: true });
    assert.strictEqual(result, 'reasoning');
  });

  test('never downgrades fast (already lowest)', () => {
    const result = resolveComplexityTier('fast', { fileCount: 1, waveCount: 0, requirementCount: 0 });
    assert.strictEqual(result, 'fast');
  });

  test('never upgrades reasoning (already highest)', () => {
    const result = resolveComplexityTier('reasoning', { fileCount: 20, waveCount: 5, requirementCount: 10, isArchitectural: true });
    assert.strictEqual(result, 'reasoning');
  });

  test('returns base tier when metadata is null', () => {
    const result = resolveComplexityTier('mid', null);
    assert.strictEqual(result, 'mid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// estimateCostMultiplier
// ─────────────────────────────────────────────────────────────────────────────

describe('estimateCostMultiplier', () => {
  test('returns valid structure for all profiles', () => {
    for (const profile of ['quality', 'balanced', 'budget']) {
      const result = estimateCostMultiplier(profile);
      assert.strictEqual(result.profile, profile);
      assert.strictEqual(typeof result.total, 'number');
      assert.strictEqual(typeof result.average, 'number');
      assert.strictEqual(result.agentCount, Object.keys(MODEL_PROFILES).length);
      assert.ok(result.total > 0, `${profile} total should be positive`);
    }
  });

  test('quality is more expensive than balanced, balanced more than budget', () => {
    const q = estimateCostMultiplier('quality');
    const b = estimateCostMultiplier('balanced');
    const bg = estimateCostMultiplier('budget');
    assert.ok(q.average > b.average, 'quality should cost more than balanced');
    assert.ok(b.average > bg.average, 'balanced should cost more than budget');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// getPhaseModelTier + per-phase override in resolveModelInternal
// ─────────────────────────────────────────────────────────────────────────────

describe('getPhaseModelTier', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-test-phase-tier-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('extracts model_tier from roadmap phase section', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), `# Roadmap

## Phase 1: Setup
**Goal:** Initialize project
<!-- model_tier: fast -->

- Task A
- Task B

## Phase 2: Build
**Goal:** Build features
<!-- model_tier: reasoning -->

- Task C
`);
    assert.strictEqual(getPhaseModelTier(tmpDir, 1), 'fast');
    assert.strictEqual(getPhaseModelTier(tmpDir, 2), 'reasoning');
  });

  test('returns null when no model_tier comment in phase', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), `# Roadmap

## Phase 1: Setup
**Goal:** Initialize project

- Task A
`);
    assert.strictEqual(getPhaseModelTier(tmpDir, 1), null);
  });

  test('returns null when phase does not exist', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), `# Roadmap

## Phase 1: Setup
**Goal:** Initialize project
`);
    assert.strictEqual(getPhaseModelTier(tmpDir, 99), null);
  });

  test('returns null when roadmap is missing', () => {
    assert.strictEqual(getPhaseModelTier(tmpDir, 1), null);
  });
});

describe('resolveModelInternal per-phase override', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-test-phase-resolve-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({
      model_profile: 'balanced',
    }));
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), `# Roadmap

## Phase 1: Quick setup
**Goal:** Initialize
<!-- model_tier: fast -->

## Phase 2: Heavy lifting
**Goal:** Build
<!-- model_tier: reasoning -->

## Phase 3: Normal work
**Goal:** Maintain
`);
  });

  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  test('per-phase override returns tier-resolved model', () => {
    const result = resolveModelInternal(tmpDir, 'pan-executor', { phaseNum: 1 });
    assert.strictEqual(result, 'haiku', 'phase 1 fast tier should resolve to haiku');
  });

  test('per-phase reasoning tier returns inherit', () => {
    const result = resolveModelInternal(tmpDir, 'pan-executor', { phaseNum: 2 });
    assert.strictEqual(result, 'inherit', 'phase 2 reasoning tier should resolve to inherit');
  });

  test('falls back to profile when phase has no model_tier', () => {
    const result = resolveModelInternal(tmpDir, 'pan-executor', { phaseNum: 3 });
    // pan-executor balanced = mid → sonnet
    assert.strictEqual(result, 'sonnet', 'should fall back to profile-based resolution');
  });

  test('per-agent override still takes precedence over per-phase', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({
      model_profile: 'balanced',
      model_overrides: { 'pan-executor': 'opus' },
    }));
    const result = resolveModelInternal(tmpDir, 'pan-executor', { phaseNum: 1 });
    assert.strictEqual(result, 'inherit', 'per-agent opus override should win over phase fast');
  });
});
