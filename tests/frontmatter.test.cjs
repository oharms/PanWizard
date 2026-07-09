/**
 * PAN Tools Tests - Frontmatter
 *
 * Tests for frontmatter CRUD CLI commands (get, set, merge, validate)
 * and pure function unit tests (extractFrontmatter, reconstructFrontmatter, spliceFrontmatter).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');
const {
  extractFrontmatter,
  reconstructFrontmatter,
  spliceFrontmatter,
  parseMustHavesBlock,
  extractPriorityEffort,
  FRONTMATTER_SCHEMAS,
} = require('../pan-wizard-core/bin/lib/frontmatter.cjs');

/**
 * Run pan-tools with an explicit argv array, bypassing shell quoting.
 * Use this for arguments containing JSON (curly braces, brackets, quotes).
 */
function runPanToolsDirect(argsArray, cwd = process.cwd()) {
  try {
    const result = execFileSync(process.execPath, [TOOLS_PATH, ...argsArray], {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// frontmatter get command
// ─────────────────────────────────────────────────────────────────────────────

describe('frontmatter get command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns all frontmatter fields from a file with --- delimited block', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 03
plan: 03-02
type: feature
wave: 1
autonomous: true
---

# Content here
`
    );

    const result = runPanTools('frontmatter get test.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '03', 'phase extracted');
    assert.strictEqual(output.plan, '03-02', 'plan extracted');
    assert.strictEqual(output.type, 'feature', 'type extracted');
    assert.strictEqual(output.wave, '1', 'wave extracted');
    assert.strictEqual(output.autonomous, 'true', 'autonomous extracted');
  });

  test('returns specific field when --field is provided', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 05
plan: 05-01
status: complete
---

# Done
`
    );

    const result = runPanTools('frontmatter get test.md --field phase', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.phase, '05', 'specific field returned');
    assert.strictEqual(output.plan, undefined, 'other fields not included');
  });

  test('returns error when file is not found', () => {
    const result = runPanTools('frontmatter get nonexistent.md', tmpDir);
    assert.ok(result.success, `Command should output JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'error message present');
  });

  test('returns error when requested field does not exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 01
---

# Content
`
    );

    const result = runPanTools('frontmatter get test.md --field missing_key', tmpDir);
    assert.ok(result.success, `Command should output JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'Field not found', 'field not found error');
    assert.strictEqual(output.field, 'missing_key', 'missing field name reported');
  });

  test('returns empty object for file with no frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'no-fm.md'),
      `# Just a heading

Some content without frontmatter.
`
    );

    const result = runPanTools('frontmatter get no-fm.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output, {}, 'empty object for no frontmatter');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// frontmatter set command
// ─────────────────────────────────────────────────────────────────────────────

describe('frontmatter set command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('sets a new field in existing frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 01
---

# Content
`
    );

    const result = runPanTools('frontmatter set test.md --field status --value complete', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true, 'update confirmed');
    assert.strictEqual(output.field, 'status', 'field name echoed');

    // Verify the file was actually updated
    const content = fs.readFileSync(path.join(tmpDir, 'test.md'), 'utf-8');
    assert.ok(content.includes('status: complete'), 'new field written to file');
    assert.ok(content.includes('phase: 01'), 'existing field preserved');
  });

  test('overwrites existing field with new value', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 01
status: draft
---

# Content
`
    );

    const result = runPanTools('frontmatter set test.md --field status --value complete', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const content = fs.readFileSync(path.join(tmpDir, 'test.md'), 'utf-8');
    assert.ok(content.includes('status: complete'), 'field value updated');
    assert.ok(!content.includes('status: draft'), 'old value gone');
  });

  test('parses JSON array value correctly', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 02
---

# Content
`
    );

    // Use runPanToolsDirect to bypass shell quoting issues with JSON brackets
    const result = runPanToolsDirect(
      ['frontmatter', 'set', 'test.md', '--field', 'tags', '--value', '["api","auth","v2"]'],
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.deepStrictEqual(output.value, ['api', 'auth', 'v2'], 'array value parsed');

    // Verify via get
    const getResult = runPanTools('frontmatter get test.md --field tags', tmpDir);
    const getOutput = JSON.parse(getResult.output);
    assert.deepStrictEqual(getOutput.tags, ['api', 'auth', 'v2'], 'array round-trips through file');
  });

  test('creates frontmatter when file has none', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'bare.md'),
      `# No Frontmatter

Just some content.
`
    );

    const result = runPanTools('frontmatter set bare.md --field phase --value 01', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const content = fs.readFileSync(path.join(tmpDir, 'bare.md'), 'utf-8');
    assert.ok(content.startsWith('---\n'), 'frontmatter delimiter prepended');
    assert.ok(content.includes('phase: 01'), 'new field present');
    assert.ok(content.includes('# No Frontmatter'), 'original content preserved');
  });

  test('returns error when file is not found', () => {
    const result = runPanTools('frontmatter set nonexistent.md --field phase --value 01', tmpDir);
    assert.ok(result.success, `Command should output JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'file not found error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// frontmatter merge command
// ─────────────────────────────────────────────────────────────────────────────

describe('frontmatter merge command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('merges new fields into existing frontmatter', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 03
---

# Content
`
    );

    // Use runPanToolsDirect to bypass shell quoting issues with JSON braces
    const result = runPanToolsDirect(
      ['frontmatter', 'merge', 'test.md', '--data', '{"status":"done","wave":"2"}'],
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.merged, true, 'merge confirmed');
    assert.deepStrictEqual(output.fields.sort(), ['status', 'wave'], 'merged field names reported');

    // Verify file content
    const content = fs.readFileSync(path.join(tmpDir, 'test.md'), 'utf-8');
    assert.ok(content.includes('phase: 03'), 'existing field preserved');
    assert.ok(content.includes('status: done'), 'new field merged');
    assert.ok(content.includes('wave: 2'), 'second new field merged');
  });

  test('returns error for invalid JSON data', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 01
---

# Content
`
    );

    const result = runPanTools('frontmatter merge test.md --data not-valid-json', tmpDir);
    assert.ok(!result.success, 'should fail with invalid JSON');
    assert.ok(result.error.includes('Invalid JSON'), 'error mentions invalid JSON');
  });

  test('preserves existing fields that are not in the merge data', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 02
plan: 02-01
type: feature
---

# Feature Plan
`
    );

    // Use runPanToolsDirect to bypass shell quoting issues with JSON braces
    const result = runPanToolsDirect(
      ['frontmatter', 'merge', 'test.md', '--data', '{"status":"complete"}'],
      tmpDir
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    // Verify all original fields plus the new one
    const getResult = runPanTools('frontmatter get test.md', tmpDir);
    const fm = JSON.parse(getResult.output);
    assert.strictEqual(fm.phase, '02', 'phase preserved');
    assert.strictEqual(fm.plan, '02-01', 'plan preserved');
    assert.strictEqual(fm.type, 'feature', 'type preserved');
    assert.strictEqual(fm.status, 'complete', 'new field added');
  });

  test('returns error when file is not found', () => {
    const result = runPanToolsDirect(
      ['frontmatter', 'merge', 'nonexistent.md', '--data', '{"a":"b"}'],
      tmpDir
    );
    assert.ok(result.success, `Command should output JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'file not found error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// frontmatter validate command
// ─────────────────────────────────────────────────────────────────────────────

describe('frontmatter validate command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passes validation when all required plan fields are present', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'plan.md'),
      `---
phase: 01
plan: 01-01
type: feature
wave: 1
depends_on: []
files_modified: [src/index.ts]
autonomous: true
must_haves:
  artifacts:
    - path: src/index.ts
---

# Plan
`
    );

    const result = runPanTools('frontmatter validate plan.md --schema plan', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'validation passed');
    assert.deepStrictEqual(output.missing, [], 'no missing fields');
    assert.strictEqual(output.schema, 'plan', 'schema name echoed');
  });

  test('fails validation and lists missing required fields', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'incomplete.md'),
      `---
phase: 01
plan: 01-01
---

# Incomplete Plan
`
    );

    const result = runPanTools('frontmatter validate incomplete.md --schema plan', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'validation failed');
    assert.ok(output.missing.includes('type'), 'type is missing');
    assert.ok(output.missing.includes('wave'), 'wave is missing');
    assert.ok(output.missing.includes('depends_on'), 'depends_on is missing');
    assert.ok(output.missing.includes('autonomous'), 'autonomous is missing');
    assert.ok(output.missing.includes('must_haves'), 'must_haves is missing');
    assert.ok(output.present.includes('phase'), 'phase is present');
    assert.ok(output.present.includes('plan'), 'plan is present');
  });

  test('validates summary schema correctly', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'summary.md'),
      `---
phase: 02
plan: 02-01
subsystem: api
tags: [auth, jwt]
duration: 45m
completed: 2025-01-15
---

# Summary
`
    );

    const result = runPanTools('frontmatter validate summary.md --schema summary', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'summary schema passes');
  });

  test('returns error for unknown schema name', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'test.md'),
      `---
phase: 01
---

# Content
`
    );

    const result = runPanTools('frontmatter validate test.md --schema nonexistent', tmpDir);
    assert.ok(!result.success, 'should fail for unknown schema');
    assert.ok(result.error.includes('Unknown schema'), 'error mentions unknown schema');
  });

  test('returns error when file is not found', () => {
    const result = runPanTools('frontmatter validate missing.md --schema plan', tmpDir);
    assert.ok(result.success, `Command should output JSON error: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'file not found error');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractFrontmatter (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe('extractFrontmatter', () => {
  test('returns empty object when content has no frontmatter', () => {
    const result = extractFrontmatter('# Just a heading\n\nSome text.');
    assert.deepStrictEqual(result, {}, 'empty object for no frontmatter');
  });

  test('parses simple key-value pairs', () => {
    const content = `---
phase: 01
plan: 01-02
status: active
---

# Content`;

    const result = extractFrontmatter(content);
    assert.strictEqual(result.phase, '01');
    assert.strictEqual(result.plan, '01-02');
    assert.strictEqual(result.status, 'active');
  });

  test('preserves hyphenated keys like require-code-mention (ADR-0027)', () => {
    const content = `---
require-code-mention: true
---

# ADR-XXXX`;
    const result = extractFrontmatter(content);
    assert.strictEqual(result['require-code-mention'], 'true',
      'require-code-mention field is preserved as a string after YAML parse');
  });

  test('parses inline arrays [a, b, c]', () => {
    const content = `---
tags: [api, auth, v2]
---`;

    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result.tags, ['api', 'auth', 'v2'], 'inline array parsed');
  });

  test('parses multi-line arrays with dash items', () => {
    const content = `---
provides:
  - Database schema
  - Auth system
  - API endpoints
---`;

    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result.provides, ['Database schema', 'Auth system', 'API endpoints'], 'multi-line array parsed');
  });

  test('parses nested objects two levels deep', () => {
    const content = `---
dependency-graph:
  provides:
    - Feature A
    - Feature B
  affects:
    - Module X
tech-stack:
  added:
    - prisma
    - zod
---`;

    const result = extractFrontmatter(content);
    assert.deepStrictEqual(result['dependency-graph'].provides, ['Feature A', 'Feature B'], 'nested array under object');
    assert.deepStrictEqual(result['dependency-graph'].affects, ['Module X'], 'second nested array');
    assert.deepStrictEqual(result['tech-stack'].added, ['prisma', 'zod'], 'second nested object');
  });

  test('strips surrounding quotes from values', () => {
    const content = `---
name: "Quoted Value"
other: 'Single Quoted'
---`;

    const result = extractFrontmatter(content);
    assert.strictEqual(result.name, 'Quoted Value', 'double quotes stripped');
    assert.strictEqual(result.other, 'Single Quoted', 'single quotes stripped');
  });

  test('round-trips through extract then reconstruct then extract losslessly', () => {
    const content = `---
phase: 03
plan: 03-01
tags: [api, auth]
status: active
---`;

    const extracted = extractFrontmatter(content);
    const reconstructed = reconstructFrontmatter(extracted);
    const reExtracted = extractFrontmatter(`---\n${reconstructed}\n---`);

    assert.deepStrictEqual(reExtracted, extracted, 'round-trip is lossless');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reconstructFrontmatter (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe('reconstructFrontmatter', () => {
  test('serializes simple key-value pairs', () => {
    const result = reconstructFrontmatter({ phase: '01', status: 'active' });
    assert.ok(result.includes('phase: 01'), 'phase serialized');
    assert.ok(result.includes('status: active'), 'status serialized');
  });

  test('serializes short arrays inline', () => {
    const result = reconstructFrontmatter({ tags: ['api', 'auth'] });
    assert.ok(result.includes('tags: [api, auth]'), 'short array rendered inline');
  });

  test('serializes long arrays as multi-line', () => {
    const longItems = ['item-one', 'item-two', 'item-three', 'item-four'];
    const result = reconstructFrontmatter({ items: longItems });
    assert.ok(result.includes('items:'), 'array key present');
    assert.ok(result.includes('  - item-one'), 'multi-line array item');
    assert.ok(result.includes('  - item-four'), 'last multi-line item');
  });

  test('serializes empty arrays as []', () => {
    const result = reconstructFrontmatter({ depends_on: [] });
    assert.ok(result.includes('depends_on: []'), 'empty array rendered as []');
  });

  test('quotes strings containing colons', () => {
    const result = reconstructFrontmatter({ title: 'Use Prisma: Better DX' });
    assert.ok(result.includes('"Use Prisma: Better DX"'), 'value with colon is quoted');
  });

  test('quotes strings containing hash symbols', () => {
    const result = reconstructFrontmatter({ note: 'Issue #42 resolved' });
    assert.ok(result.includes('"Issue #42 resolved"'), 'value with hash is quoted');
  });

  test('quotes strings starting with [ or {', () => {
    const result = reconstructFrontmatter({ raw: '[not an array]' });
    assert.ok(result.includes('"[not an array]"'), 'value starting with [ is quoted');
  });

  test('serializes nested objects', () => {
    const result = reconstructFrontmatter({
      'dependency-graph': {
        provides: ['Feature A', 'Feature B'],
        affects: ['Module X'],
      },
    });
    assert.ok(result.includes('dependency-graph:'), 'nested object key');
    assert.ok(result.includes('  provides: [Feature A, Feature B]'), 'nested inline array');
    assert.ok(result.includes('  affects: [Module X]'), 'nested single-item inline array');
  });

  test('skips null and undefined values', () => {
    const result = reconstructFrontmatter({ phase: '01', empty: null, missing: undefined });
    assert.ok(result.includes('phase: 01'), 'non-null value present');
    assert.ok(!result.includes('empty'), 'null value skipped');
    assert.ok(!result.includes('missing'), 'undefined value skipped');
  });

  test('quotes nested sub-values containing colons', () => {
    const result = reconstructFrontmatter({
      meta: {
        description: 'Time: 3pm',
      },
    });
    assert.ok(result.includes('"Time: 3pm"'), 'nested value with colon is quoted');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// spliceFrontmatter (pure function)
// ─────────────────────────────────────────────────────────────────────────────

describe('spliceFrontmatter', () => {
  test('replaces existing frontmatter block', () => {
    const original = `---
phase: 01
status: draft
---

# Content below

Some paragraph text.`;

    const result = spliceFrontmatter(original, { phase: '01', status: 'complete', wave: '2' });

    assert.ok(result.startsWith('---\n'), 'starts with delimiter');
    assert.ok(result.includes('status: complete'), 'new value present');
    assert.ok(result.includes('wave: 2'), 'new field present');
    assert.ok(!result.includes('status: draft'), 'old value replaced');
    assert.ok(result.includes('# Content below'), 'body content preserved');
    assert.ok(result.includes('Some paragraph text.'), 'paragraph text preserved');
  });

  test('prepends frontmatter when file has no existing block', () => {
    const original = `# No Frontmatter

Just content here.`;

    const result = spliceFrontmatter(original, { phase: '03', plan: '03-01' });

    assert.ok(result.startsWith('---\n'), 'starts with delimiter');
    assert.ok(result.includes('phase: 03'), 'new field present');
    assert.ok(result.includes('plan: 03-01'), 'second new field present');
    assert.ok(result.includes('# No Frontmatter'), 'original heading preserved');
    assert.ok(result.includes('Just content here.'), 'original content preserved');
  });

  test('produces content with exactly one frontmatter block after splice', () => {
    const original = `---
old: value
---

# Body`;

    const result = spliceFrontmatter(original, { new_key: 'new_value' });

    const delimiterCount = (result.match(/^---$/gm) || []).length;
    assert.strictEqual(delimiterCount, 2, 'exactly two --- delimiters (one block)');
  });

  test('handles empty object by producing empty frontmatter block', () => {
    const original = `# Just content`;

    const result = spliceFrontmatter(original, {});

    assert.ok(result.startsWith('---\n'), 'starts with opening delimiter');
    assert.ok(result.includes('---\n\n# Just content'), 'closing delimiter followed by content');
  });

  test('preserves body content when replacing frontmatter with arrays', () => {
    const original = `---
phase: 01
---

# Title

- bullet 1
- bullet 2`;

    const result = spliceFrontmatter(original, {
      phase: '01',
      tags: ['a', 'b'],
    });

    assert.ok(result.includes('tags: [a, b]'), 'array field serialized');
    assert.ok(result.includes('- bullet 1'), 'body bullets preserved');
    assert.ok(result.includes('- bullet 2'), 'second body bullet preserved');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// frontmatter error handling
// ─────────────────────────────────────────────────────────────────────────────

describe('frontmatter commands handle missing files', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('frontmatter set returns error for nonexistent file', () => {
    const result = runPanTools('frontmatter set nonexistent.md --field title --value test', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
  });

  test('frontmatter merge returns error for nonexistent file', () => {
    const result = runPanTools('frontmatter merge nonexistent.md --data {"title":"test"}', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should have error field');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseMustHavesBlock — direct unit tests
// ─────────────────────────────────────────────────────────────────────────────

describe('parseMustHavesBlock', () => {
  test('parses simple string items', () => {
    const content = [
      '---',
      'must_haves:',
      '    features:',
      '      - "User can log in"',
      '      - "User can log out"',
      '---',
    ].join('\n');
    const result = parseMustHavesBlock(content, 'features');
    assert.deepStrictEqual(result, ['User can log in', 'User can log out']);
  });

  test('parses key-value items', () => {
    const content = [
      '---',
      'must_haves:',
      '    endpoints:',
      '      - path: /api/users',
      '        method: GET',
      '      - path: /api/posts',
      '        method: POST',
      '---',
    ].join('\n');
    const result = parseMustHavesBlock(content, 'endpoints');
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].path, '/api/users');
    assert.strictEqual(result[0].method, 'GET');
    assert.strictEqual(result[1].path, '/api/posts');
  });

  test('returns empty array for missing block', () => {
    const content = [
      '---',
      'must_haves:',
      '    features:',
      '      - "Feature A"',
      '---',
    ].join('\n');
    assert.deepStrictEqual(parseMustHavesBlock(content, 'nonexistent'), []);
  });

  test('returns empty array for content without frontmatter', () => {
    assert.deepStrictEqual(parseMustHavesBlock('# No frontmatter', 'features'), []);
  });

  test('returns empty array for empty content', () => {
    assert.deepStrictEqual(parseMustHavesBlock('', 'features'), []);
  });

  test('coerces pure integer values to numbers', () => {
    const content = [
      '---',
      'must_haves:',
      '    limits:',
      '      - name: max_users',
      '        count: 100',
      '---',
    ].join('\n');
    const result = parseMustHavesBlock(content, 'limits');
    assert.strictEqual(result[0].count, 100);
    assert.strictEqual(typeof result[0].count, 'number');
  });

  test('stops at sibling block boundary', () => {
    const content = [
      '---',
      'must_haves:',
      '    features:',
      '      - "Feature A"',
      '    tests:',
      '      - "Test A"',
      '---',
    ].join('\n');
    const features = parseMustHavesBlock(content, 'features');
    assert.deepStrictEqual(features, ['Feature A']);
    const tests = parseMustHavesBlock(content, 'tests');
    assert.deepStrictEqual(tests, ['Test A']);
  });
});

describe('extractPriorityEffort', () => {
  test('extracts valid priority and effort', () => {
    const result = extractPriorityEffort({ priority: 'P0', effort: 'S' });
    assert.strictEqual(result.priority, 'P0');
    assert.strictEqual(result.effort, 'S');
    assert.strictEqual(result.priorityValid, true);
    assert.strictEqual(result.effortValid, true);
  });

  test('defaults to P3/M when missing', () => {
    const result = extractPriorityEffort({});
    assert.strictEqual(result.priority, 'P3');
    assert.strictEqual(result.effort, 'M');
    assert.strictEqual(result.priorityValid, true);
    assert.strictEqual(result.effortValid, true);
  });

  test('normalizes lowercase to uppercase', () => {
    const result = extractPriorityEffort({ priority: 'p2', effort: 'xs' });
    assert.strictEqual(result.priority, 'P2');
    assert.strictEqual(result.effort, 'XS');
  });

  test('defaults invalid priority to P3 and marks invalid', () => {
    const result = extractPriorityEffort({ priority: 'P9', effort: 'M' });
    assert.strictEqual(result.priority, 'P3');
    assert.strictEqual(result.priorityValid, false);
  });

  test('defaults invalid effort to M and marks invalid', () => {
    const result = extractPriorityEffort({ priority: 'P1', effort: 'HUGE' });
    assert.strictEqual(result.effort, 'M');
    assert.strictEqual(result.effortValid, false);
  });

  test('coerces numeric values to strings', () => {
    const result = extractPriorityEffort({ priority: 2, effort: 3 });
    assert.strictEqual(result.priority, 'P3');
    assert.strictEqual(result.effort, 'M');
  });
});

describe('FRONTMATTER_SCHEMAS', () => {
  test('has plan, summary, and verification schemas', () => {
    assert.ok(FRONTMATTER_SCHEMAS.plan);
    assert.ok(FRONTMATTER_SCHEMAS.summary);
    assert.ok(FRONTMATTER_SCHEMAS.verification);
  });

  test('plan schema requires expected fields', () => {
    const required = FRONTMATTER_SCHEMAS.plan.required;
    assert.ok(required.includes('phase'));
    assert.ok(required.includes('plan'));
    assert.ok(required.includes('type'));
    assert.ok(required.includes('wave'));
    assert.ok(required.includes('must_haves'));
  });

  test('summary schema requires expected fields', () => {
    const required = FRONTMATTER_SCHEMAS.summary.required;
    assert.ok(required.includes('phase'));
    assert.ok(required.includes('completed'));
  });

  test('verification schema requires expected fields', () => {
    const required = FRONTMATTER_SCHEMAS.verification.required;
    assert.ok(required.includes('phase'));
    assert.ok(required.includes('verified'));
    assert.ok(required.includes('status'));
  });
});
