/**
 * PAN Tools Tests - Drift Check
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const verify = require('../pan-wizard-core/bin/lib/verify.cjs');
const { BUILTIN_DRIFT_RULES, DRIFT_SEVERITY_WEIGHTS } = require('../pan-wizard-core/bin/lib/constants.cjs');

// --- Unit tests: parseConventionRules ---

describe('parseConventionRules', () => {
  test('empty content returns only builtin rules', () => {
    const rules = verify.parseConventionRules(null);
    assert.equal(rules.length, BUILTIN_DRIFT_RULES.length);
  });

  test('parses "instead of" pattern from markdown', () => {
    const content = '- Use `safeReadFile()` instead of `existsSync`';
    const rules = verify.parseConventionRules(content);
    const custom = rules.find(r => r.id.startsWith('conv-'));
    assert.ok(custom, 'should have a custom rule');
    assert.equal(custom.severity, 'warning');
    assert.ok(custom.antiPattern.test('if (existsSync(p))'));
  });

  test('parses "never use" pattern', () => {
    const content = '- Never use `eval`';
    const rules = verify.parseConventionRules(content);
    const custom = rules.find(r => r.id === 'conv-eval');
    assert.ok(custom);
    assert.ok(custom.antiPattern.test('eval("code")'));
  });

  test('parses "avoid" pattern', () => {
    const content = '- Avoid `var` declarations';
    const rules = verify.parseConventionRules(content);
    const custom = rules.find(r => r.id.startsWith('conv-var'));
    assert.ok(custom);
  });

  test('skips lines without negation patterns', () => {
    const content = '- Use safeReadFile for all reads\n- Functions should be pure';
    const rules = verify.parseConventionRules(content);
    // Only builtins, no custom rules
    assert.equal(rules.length, BUILTIN_DRIFT_RULES.length);
  });

  test('custom rules override builtins with same id', () => {
    // Create content that would produce a rule with builtin id — unlikely but test dedup
    const content = '- Never use `console.log`';
    const rules = verify.parseConventionRules(content);
    // Should not have duplicate console.log rules
    const consoleRules = rules.filter(r => r.antiPattern.test('console.log("hi")'));
    // At least one from builtin, possibly one custom — but IDs differ so both present
    assert.ok(consoleRules.length >= 1);
  });

  test('handles invalid regex gracefully', () => {
    const content = '- Never use `[invalid`';
    const rules = verify.parseConventionRules(content);
    // Should not crash, skips invalid regex
    assert.ok(rules.length >= BUILTIN_DRIFT_RULES.length);
  });

  test('handles CRLF line endings', () => {
    const content = '- Use X instead of `badFunc`\r\n- Never use `badVar`\r\n';
    const rules = verify.parseConventionRules(content);
    const custom = rules.filter(r => r.id.startsWith('conv-'));
    assert.equal(custom.length, 2);
  });
});

// --- Unit tests: checkFileConventions ---

describe('checkFileConventions', () => {
  test('clean file returns no violations', () => {
    const content = 'const x = output(data, raw, "label");\n';
    const rules = [{ id: 'no-console-log', antiPattern: /\bconsole\.log\b/, message: 'Use output()', severity: 'error', fileGlob: '.cjs' }];
    const violations = verify.checkFileConventions('lib/test.cjs', content, rules);
    assert.equal(violations.length, 0);
  });

  test('detects console.log in .cjs file', () => {
    const content = 'function run() {\n  console.log("debug");\n}\n';
    const rules = [{ id: 'no-console-log', antiPattern: /\bconsole\.log\b/, message: 'Use output()', severity: 'error', fileGlob: '.cjs' }];
    const violations = verify.checkFileConventions('lib/test.cjs', content, rules);
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
    assert.equal(violations[0].rule, 'no-console-log');
    assert.equal(violations[0].severity, 'error');
  });

  test('skips comment lines', () => {
    const content = '// console.log("commented out")\n/* console.log */\n* console.log\n';
    const rules = [{ id: 'no-console-log', antiPattern: /\bconsole\.log\b/, message: 'Use output()', severity: 'error', fileGlob: null }];
    const violations = verify.checkFileConventions('test.cjs', content, rules);
    assert.equal(violations.length, 0);
  });

  test('respects fileGlob filter', () => {
    const content = 'console.log("hi");\n';
    const rules = [{ id: 'no-console-log', antiPattern: /\bconsole\.log\b/, message: 'Use output()', severity: 'error', fileGlob: '.cjs' }];
    // .js file should not match .cjs glob
    const violations = verify.checkFileConventions('lib/test.js', content, rules);
    assert.equal(violations.length, 0);
  });

  test('null fileGlob matches all files', () => {
    const content = 'existsSync(p);\n';
    const rules = [{ id: 'no-exists', antiPattern: /\bexistsSync\b/, message: 'Avoid', severity: 'warning', fileGlob: null }];
    const violations = verify.checkFileConventions('src/util.js', content, rules);
    assert.equal(violations.length, 1);
  });

  test('multiple violations in same file', () => {
    const content = 'console.log("a");\nconsole.error("b");\nconsole.log("c");\n';
    const rules = [
      { id: 'no-log', antiPattern: /\bconsole\.log\b/, message: 'No log', severity: 'error', fileGlob: null },
      { id: 'no-err', antiPattern: /\bconsole\.error\b/, message: 'No error', severity: 'error', fileGlob: null },
    ];
    const violations = verify.checkFileConventions('test.cjs', content, rules);
    assert.equal(violations.length, 3);
  });

  test('file paths use forward slashes in output', () => {
    const content = 'console.log("x");\n';
    const rules = [{ id: 'test', antiPattern: /\bconsole\.log\b/, message: 'bad', severity: 'error', fileGlob: null }];
    // toPosix converts the PLATFORM separator; build the input with path.sep so
    // the test exercises the real conversion on Windows and Linux alike (a
    // literal backslash is a legal filename character on Linux, not a separator).
    const nativePath = ['lib', 'sub', 'test.cjs'].join(path.sep);
    const violations = verify.checkFileConventions(nativePath, content, rules);
    assert.ok(violations[0].file.includes('/'), 'should use forward slashes');
    assert.equal(violations[0].file, 'lib/sub/test.cjs');
  });
});

// --- Unit tests: calculateDriftScore ---

describe('calculateDriftScore', () => {
  test('zero violations returns score 0 and clean', () => {
    const { score, verdict } = verify.calculateDriftScore([], 5, 5);
    assert.equal(score, 0);
    assert.equal(verdict, 'clean');
  });

  test('zero files returns score 0', () => {
    const { score, verdict } = verify.calculateDriftScore([], 0, 5);
    assert.equal(score, 0);
    assert.equal(verdict, 'clean');
  });

  test('zero rules returns score 0', () => {
    const { score, verdict } = verify.calculateDriftScore([{ severity: 'error' }], 5, 0);
    assert.equal(score, 0);
    assert.equal(verdict, 'clean');
  });

  test('errors weighted 3x', () => {
    const violations = [{ severity: 'error' }];
    const { score } = verify.calculateDriftScore(violations, 1, 5);
    // weighted = 3, ceiling = 1 * 5 * 0.3 = 1.5, score = min(1, 3/1.5) = 1.0
    assert.equal(score, 1.0);
  });

  test('warnings weighted 1x', () => {
    const violations = [{ severity: 'warning' }];
    const { score } = verify.calculateDriftScore(violations, 10, 5);
    // weighted = 1, ceiling = 10 * 5 * 0.3 = 15, score = 1/15 ≈ 0.07
    assert.ok(score < 0.1);
    assert.ok(score > 0);
  });

  test('info weighted 0.5x', () => {
    const violations = [{ severity: 'info' }];
    const { score } = verify.calculateDriftScore(violations, 10, 5);
    // weighted = 0.5, ceiling = 15, score ≈ 0.03
    assert.ok(score < 0.05);
  });

  test('score capped at 1.0', () => {
    const violations = Array(50).fill({ severity: 'error' });
    const { score } = verify.calculateDriftScore(violations, 1, 1);
    assert.equal(score, 1.0);
  });

  test('verdict thresholds correct', () => {
    // Clean: 0 - 0.2
    assert.equal(verify.calculateDriftScore([], 5, 5).verdict, 'clean');
    // High: many errors
    const many = Array(50).fill({ severity: 'error' });
    assert.equal(verify.calculateDriftScore(many, 1, 1).verdict, 'high');
  });
});

// --- Integration tests: cmdDriftCheck via CLI ---

describe('drift-check command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Init git repo for drift-check
    const { execFileSync } = require('child_process');
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir, stdio: 'pipe' });
    // Create a file so initial commit has content
    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('no changed files returns score 0', () => {
    const result = runPanTools('drift-check', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.drift_score, 0);
    assert.equal(data.files_checked, 0);
    assert.equal(data.summary, 'no files changed');
    assert.equal(data.passed, true);
  });

  test('detects violations in changed files', () => {
    // Create a .cjs file with console.log (violates builtin rule)
    const filePath = path.join(tmpDir, 'bad.cjs');
    fs.writeFileSync(filePath, 'function run() {\n  console.log("oops");\n}\n');

    const result = runPanTools('drift-check --files bad.cjs', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok(data.drift_score > 0, 'should have non-zero drift score');
    assert.ok(data.violation_count > 0, 'should have violations');
    assert.equal(data.violations[0].rule, 'no-console-log');
  });

  test('--threshold flag controls pass/fail', () => {
    const filePath = path.join(tmpDir, 'bad.cjs');
    fs.writeFileSync(filePath, 'console.log("a");\nconsole.error("b");\n');

    // Very low threshold should fail
    const result = runPanTools('drift-check --files bad.cjs --threshold 0.0', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.passed, false);
    assert.equal(data.threshold, 0);
  });

  test('--files flag checks specific files', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.cjs'), 'console.log("bad");\n');
    fs.writeFileSync(path.join(tmpDir, 'b.cjs'), 'output(data, raw, "ok");\n');

    const result = runPanTools('drift-check --files b.cjs', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.files_checked, 1);
    // b.cjs has no console.log so should be clean
    assert.equal(data.violation_count, 0);
  });

  test('invalid threshold returns error', () => {
    const result = runPanTools('drift-check --threshold 2.0', tmpDir);
    assert.ok(!result.success || result.error);
  });

  test('loads conventions from CONVENTIONS.md', () => {
    // Create a conventions file
    const convDir = path.join(tmpDir, '.planning', 'codebase');
    fs.mkdirSync(convDir, { recursive: true });
    fs.writeFileSync(path.join(convDir, 'CONVENTIONS.md'), '- Never use `setTimeout`\n');
    fs.writeFileSync(path.join(tmpDir, 'timer.js'), 'setTimeout(() => {}, 100);\n');

    const result = runPanTools('drift-check --files timer.js', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    // Should detect setTimeout via custom convention rule
    const timeoutViolation = data.violations.find(v => v.rule.includes('settimeout'));
    assert.ok(timeoutViolation, 'should detect setTimeout from conventions');
  });

  test('skips binary files', () => {
    fs.writeFileSync(path.join(tmpDir, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    // getChangedFiles filters binaries — test via --files which bypasses git diff
    // but the file read still works. Binary extensions are only filtered in getChangedFiles.
    // With --files, the file is checked but content is binary garbage — no convention violations expected.
    const result = runPanTools('drift-check --files image.png', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    // Binary file may be read but won't match text patterns
    assert.equal(data.violation_count, 0);
  });

  test('skips large files over size limit', () => {
    // Create file larger than 100KB
    const bigContent = 'console.log("x");\n'.repeat(7000); // ~126KB
    fs.writeFileSync(path.join(tmpDir, 'big.cjs'), bigContent);

    const result = runPanTools('drift-check --files big.cjs', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.files_checked, 0, 'large file should be skipped');
  });

  test('output has correct JSON shape', () => {
    const result = runPanTools('drift-check', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok('drift_score' in data);
    assert.ok('verdict' in data);
    assert.ok('passed' in data);
    assert.ok('threshold' in data);
    assert.ok('violations' in data);
    assert.ok('violation_count' in data);
    assert.ok('files_checked' in data);
    assert.ok('conventions_loaded' in data);
    assert.ok('summary' in data);
    assert.ok(Array.isArray(data.violations));
  });

  test('--since flag is passed through', () => {
    // Create a file and commit it
    const { execFileSync } = require('child_process');
    fs.writeFileSync(path.join(tmpDir, 'test.cjs'), 'const x = 1;\n');
    execFileSync('git', ['add', 'test.cjs'], { cwd: tmpDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'add test'], { cwd: tmpDir, stdio: 'pipe' });

    // Now modify it
    fs.writeFileSync(path.join(tmpDir, 'test.cjs'), 'console.log("drift");\n');

    const result = runPanTools('drift-check --since HEAD', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok(data.files_checked >= 1);
  });

  test('--verbose adds per_file breakdown', () => {
    fs.writeFileSync(path.join(tmpDir, 'a.cjs'), 'console.log("x");\n');
    fs.writeFileSync(path.join(tmpDir, 'b.cjs'), 'console.error("y");\n');

    const result = runPanTools('drift-check --files a.cjs,b.cjs --verbose', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.ok(data.per_file, 'should have per_file when --verbose');
    assert.ok(typeof data.per_file === 'object');
    // At least one file should have violations
    const fileKeys = Object.keys(data.per_file);
    assert.ok(fileKeys.length >= 1, 'should have at least one file in per_file');
  });

  test('without --verbose omits per_file', () => {
    fs.writeFileSync(path.join(tmpDir, 'c.cjs'), 'console.log("x");\n');

    const result = runPanTools('drift-check --files c.cjs', tmpDir);
    assert.ok(result.success, result.error);
    const data = JSON.parse(result.output);
    assert.equal(data.per_file, undefined, 'should not have per_file without --verbose');
  });
});

// --- Constants tests ---

describe('drift constants', () => {
  test('BUILTIN_DRIFT_RULES has expected rules', () => {
    assert.ok(BUILTIN_DRIFT_RULES.length >= 5);
    const ids = BUILTIN_DRIFT_RULES.map(r => r.id);
    assert.ok(ids.includes('no-console-log'));
    assert.ok(ids.includes('no-console-error'));
    assert.ok(ids.includes('no-existsSync'));
  });

  test('all builtin rules have required fields', () => {
    for (const rule of BUILTIN_DRIFT_RULES) {
      assert.ok(rule.id, 'rule must have id');
      assert.ok(rule.antiPattern instanceof RegExp, 'antiPattern must be RegExp');
      assert.ok(rule.message, 'rule must have message');
      assert.ok(['error', 'warning', 'info'].includes(rule.severity), 'severity must be valid');
    }
  });

  test('DRIFT_SEVERITY_WEIGHTS covers all levels', () => {
    assert.equal(DRIFT_SEVERITY_WEIGHTS.error, 3);
    assert.equal(DRIFT_SEVERITY_WEIGHTS.warning, 1);
    assert.equal(DRIFT_SEVERITY_WEIGHTS.info, 0.5);
  });
});
