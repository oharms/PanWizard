/**
 * PAN Tools Tests - Extended Verify Commands
 *
 * Tests for: verify references, verify artifacts, verify key-links, verify-summary
 * (verify commits is excluded because it requires a git repository)
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// =============================================================================
// verify references
// =============================================================================

describe('verify references command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('all references valid when files exist', () => {
    // Create the referenced files on disk
    const planDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(planDir, { recursive: true });
    fs.writeFileSync(path.join(planDir, '01-01-plan.md'), '# Plan\n');

    const binDir = path.join(tmpDir, 'pan-wizard-core', 'bin', 'lib');
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, 'core.cjs'), 'module.exports = {};\n');

    // Create a doc that references both files
    const docContent = [
      '# Test Document',
      '',
      'See @.planning/phases/01-setup/01-01-plan.md for details.',
      '',
      'The core module is at `pan-wizard-core/bin/lib/core.cjs` and does stuff.',
    ].join('\n');
    const docPath = path.join(tmpDir, '.planning', 'test-doc.md');
    fs.writeFileSync(docPath, docContent);

    const result = runPanTools('verify references .planning/test-doc.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'should be valid when all refs exist');
    assert.deepStrictEqual(output.missing, [], 'no missing references');
    assert.strictEqual(output.found, 2, 'should find 2 references');
    assert.strictEqual(output.total, 2, 'total should be 2');
  });

  test('missing reference detected', () => {
    // Create a doc referencing a nonexistent path
    const docContent = [
      '# Test Document',
      '',
      'See `.planning/phases/99-fake/fake.md` for more info.',
    ].join('\n');
    const docPath = path.join(tmpDir, '.planning', 'test-doc.md');
    fs.writeFileSync(docPath, docContent);

    const result = runPanTools('verify references .planning/test-doc.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid when ref is missing');
    assert.ok(
      output.missing.some(m => m.includes('.planning/phases/99-fake/fake.md')),
      'missing should include the fake path'
    );
  });

  test('file not found returns error', () => {
    const result = runPanTools('verify references .planning/nonexistent-file.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report file not found');
  });

  test('no references returns valid with zero found', () => {
    // Create a doc with no file references at all
    const docContent = [
      '# Empty Document',
      '',
      'This document has no file references whatsoever.',
      'Just plain text with no paths or at-signs.',
    ].join('\n');
    const docPath = path.join(tmpDir, '.planning', 'empty-doc.md');
    fs.writeFileSync(docPath, docContent);

    const result = runPanTools('verify references .planning/empty-doc.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true, 'should be valid with no refs');
    assert.strictEqual(output.found, 0, 'found should be 0');
    assert.strictEqual(output.total, 0, 'total should be 0');
    assert.deepStrictEqual(output.missing, [], 'no missing references');
  });
});

// =============================================================================
// verify artifacts
// =============================================================================

describe('verify artifacts command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  /**
   * Helper to create a PLAN.md with the given must_haves.artifacts block.
   * The artifacts array items must use exactly 6-space indent for list items
   * and 8-space indent for continuation key-value pairs, matching the
   * parseMustHavesBlock parser expectations.
   */
  function writePlanWithArtifacts(dir, artifactsYaml) {
    const phaseDir = path.join(dir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = [
      '---',
      'phase: "01"',
      'plan: "01"',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      'must_haves:',
      '    artifacts:',
      artifactsYaml,
      '---',
      '',
      '# Phase 01, Plan 01: Test',
    ].join('\n');

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);
    return '.planning/phases/01-setup/01-01-plan.md';
  }

  test('artifact exists and passes all checks', () => {
    const planPath = writePlanWithArtifacts(tmpDir, [
      '      - path: src/core.cjs',
      '        min_lines: 5',
      '        contains: function',
      '        exports:',
      '          - cmdFoo',
    ].join('\n'));

    // Create the artifact file with enough lines and the required content
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    const fileLines = [
      '// Core module',
      'function cmdFoo() {',
      '  return "hello";',
      '}',
      'function helper() {}',
      'module.exports = { cmdFoo };',
    ];
    fs.writeFileSync(path.join(srcDir, 'core.cjs'), fileLines.join('\n'));

    const result = runPanTools(`verify artifacts ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, true, 'all artifacts should pass');
    assert.strictEqual(output.passed, 1, 'one artifact passed');
    assert.strictEqual(output.total, 1, 'one artifact total');
    assert.strictEqual(output.artifacts[0].passed, true, 'artifact should pass');
    assert.deepStrictEqual(output.artifacts[0].issues, [], 'no issues');
  });

  test('artifact missing from disk', () => {
    const planPath = writePlanWithArtifacts(tmpDir, [
      '      - path: src/missing-file.cjs',
      '        min_lines: 10',
    ].join('\n'));

    // Do not create the file

    const result = runPanTools(`verify artifacts ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'should not pass');
    assert.strictEqual(output.artifacts[0].exists, false, 'file should not exist');
    assert.ok(
      output.artifacts[0].issues.some(i => i.includes('File not found')),
      'issues should mention File not found'
    );
  });

  test('artifact has too few lines', () => {
    const planPath = writePlanWithArtifacts(tmpDir, [
      '      - path: src/small.cjs',
      '        min_lines: 20',
    ].join('\n'));

    // Create file with only 5 lines
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'small.cjs'), 'line1\nline2\nline3\nline4\nline5\n');

    const result = runPanTools(`verify artifacts ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'should not pass');
    assert.strictEqual(output.artifacts[0].passed, false, 'artifact should fail');
    assert.ok(
      output.artifacts[0].issues.some(i => i.includes('lines') && i.includes('20')),
      'issues should mention line count requirement'
    );
  });

  test('artifact missing export', () => {
    const planPath = writePlanWithArtifacts(tmpDir, [
      '      - path: src/noexport.cjs',
      '        exports:',
      '          - cmdFoo',
    ].join('\n'));

    // Create file that does NOT contain "cmdFoo"
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'noexport.cjs'), 'function cmdBar() {}\nmodule.exports = { cmdBar };\n');

    const result = runPanTools(`verify artifacts ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'should not pass');
    assert.ok(
      output.artifacts[0].issues.some(i => i.includes('Missing export') && i.includes('cmdFoo')),
      'issues should mention missing export cmdFoo'
    );
  });

  test('no artifacts in frontmatter returns error', () => {
    // Create PLAN.md without any must_haves.artifacts items
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = [
      '---',
      'phase: "01"',
      'plan: "01"',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      'must_haves:',
      '  key_links: []',
      '---',
      '',
      '# Phase 01, Plan 01: Test',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify artifacts .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should return an error');
    assert.ok(
      output.error.includes('No must_haves.artifacts'),
      'error should mention no artifacts found'
    );
  });

  test('plan file not found returns error', () => {
    const result = runPanTools('verify artifacts .planning/phases/99-missing/99-01-plan.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report file not found');
  });
});

// =============================================================================
// verify key-links
// =============================================================================

describe('verify key-links command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  /**
   * Helper to create a PLAN.md with the given must_haves.key_links block.
   */
  function writePlanWithKeyLinks(dir, keyLinksYaml) {
    const phaseDir = path.join(dir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = [
      '---',
      'phase: "01"',
      'plan: "01"',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      'must_haves:',
      '    key_links:',
      keyLinksYaml,
      '---',
      '',
      '# Phase 01, Plan 01: Test',
    ].join('\n');

    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);
    return '.planning/phases/01-setup/01-01-plan.md';
  }

  test('source references target', () => {
    const planPath = writePlanWithKeyLinks(tmpDir, [
      '      - from: src/router.cjs',
      '        to: src/handler.cjs',
    ].join('\n'));

    // Create source file that references the target
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'router.cjs'),
      "const handler = require('./handler.cjs');\n// uses src/handler.cjs\nmodule.exports = {};\n"
    );
    fs.writeFileSync(path.join(srcDir, 'handler.cjs'), 'module.exports = {};\n');

    const result = runPanTools(`verify key-links ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, true, 'all links should be verified');
    assert.strictEqual(output.verified, 1, 'one link verified');
    assert.strictEqual(output.total, 1, 'one link total');
    assert.strictEqual(output.links[0].verified, true, 'link should be verified');
    assert.ok(
      output.links[0].detail.includes('Target referenced in source'),
      'detail should confirm target referenced'
    );
  });

  test('pattern found in source', () => {
    const planPath = writePlanWithKeyLinks(tmpDir, [
      '      - from: src/router.cjs',
      '        to: src/handler.cjs',
      '        pattern: require.*handler',
    ].join('\n'));

    // Create source file with content matching the regex pattern
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'router.cjs'),
      "const h = require('./handler');\nmodule.exports = {};\n"
    );
    fs.writeFileSync(path.join(srcDir, 'handler.cjs'), 'module.exports = {};\n');

    const result = runPanTools(`verify key-links ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, true, 'all links should be verified');
    assert.strictEqual(output.links[0].verified, true, 'link should be verified by pattern');
    assert.ok(
      output.links[0].detail.includes('Pattern found in source'),
      'detail should confirm pattern found in source'
    );
  });

  test('source file missing', () => {
    const planPath = writePlanWithKeyLinks(tmpDir, [
      '      - from: src/nonexistent.cjs',
      '        to: src/handler.cjs',
    ].join('\n'));

    // Do not create the source file, only target
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'handler.cjs'), 'module.exports = {};\n');

    const result = runPanTools(`verify key-links ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false, 'should not be all verified');
    assert.strictEqual(output.links[0].verified, false, 'link should not be verified');
    assert.ok(
      output.links[0].detail.includes('Source file not found'),
      'detail should say source file not found'
    );
  });

  test('target not referenced in source', () => {
    const planPath = writePlanWithKeyLinks(tmpDir, [
      '      - from: src/router.cjs',
      '        to: src/handler.cjs',
    ].join('\n'));

    // Create source file that does NOT mention the target
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(
      path.join(srcDir, 'router.cjs'),
      "const utils = require('./utils');\nmodule.exports = {};\n"
    );
    fs.writeFileSync(path.join(srcDir, 'handler.cjs'), 'module.exports = {};\n');

    const result = runPanTools(`verify key-links ${planPath}`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false, 'should not be all verified');
    assert.strictEqual(output.links[0].verified, false, 'link should not be verified');
    assert.ok(
      output.links[0].detail.includes('Target not referenced in source'),
      'detail should say target not referenced'
    );
  });

  test('no key_links in frontmatter returns error', () => {
    // Create PLAN.md without any must_haves.key_links items
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const planContent = [
      '---',
      'phase: "01"',
      'plan: "01"',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      'must_haves:',
      '  artifacts: []',
      '---',
      '',
      '# Phase 01, Plan 01: Test',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-plan.md'), planContent);

    const result = runPanTools('verify key-links .planning/phases/01-setup/01-01-plan.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, 'should return an error');
    assert.ok(
      output.error.includes('No must_haves.key_links'),
      'error should mention no key_links found'
    );
  });

  test('plan file not found returns error', () => {
    const result = runPanTools('verify key-links .planning/phases/99-missing/99-01-plan.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report file not found');
  });
});

// =============================================================================
// verify-summary
// =============================================================================

describe('verify-summary command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('summary with existing files passes', () => {
    // Create a file that the summary will reference
    const srcDir = path.join(tmpDir, 'src');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'core.cjs'), 'module.exports = {};\n');

    // Create SUMMARY.md that references the existing file
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = [
      '# Phase 01, Plan 01: Setup Summary',
      '',
      '## Files Created',
      '',
      'Created: `src/core.cjs`',
      '',
      '## Self-Check',
      '',
      'All checks pass.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), summaryContent);

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true, 'should pass');
    assert.strictEqual(output.checks.summary_exists, true, 'summary should exist');
    assert.deepStrictEqual(output.checks.files_created.missing, [], 'no missing files');
  });

  test('summary not found returns passed false', () => {
    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command should succeed with error JSON: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false, 'should not pass');
    assert.strictEqual(output.checks.summary_exists, false, 'summary should not exist');
    assert.ok(
      output.errors.some(e => e.includes('summary.md not found')),
      'errors should mention summary.md not found'
    );
  });

  test('summary with self-check passed section', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = [
      '# Phase 01 Summary',
      '',
      'Everything went well.',
      '',
      '## Self-Check',
      '',
      'All checks pass. Everything verified.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), summaryContent);

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'passed', 'self_check should be passed');
  });

  test('summary with self-check failed section', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = [
      '# Phase 01 Summary',
      '',
      'There were problems.',
      '',
      '## Self-Check',
      '',
      'Some checks failed. Missing files detected.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), summaryContent);

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'failed', 'self_check should be failed');
  });

  test('summary with no self-check section', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = [
      '# Phase 01 Summary',
      '',
      'Just a plain summary with no self-check heading at all.',
      '',
      '## Commits',
      '',
      'Some commits were made.',
    ].join('\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), summaryContent);

    const result = runPanTools('verify-summary .planning/phases/01-setup/01-01-summary.md', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.checks.self_check, 'not_found', 'self_check should be not_found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// preflight command
// ─────────────────────────────────────────────────────────────────────────────

describe('preflight command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.gitkeep'), '');
    execSync('git add . && git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => cleanup(tmpDir));

  test('passes for well-structured project', () => {
    // Add state.md and config.json
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Phase:** 01\n**Status:** Ready to plan\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: true })
    );
    // Commit the new files to make git clean
    execSync('git add . && git commit -m "add state"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, true, 'should be ready');
    assert.strictEqual(output.blockers.length, 0, 'no blockers');
    assert.ok(output.passed > 0, 'should have passed checks');
    assert.ok(output.total > 0, 'should have total checks');
  });

  test('reports blockers when state.md missing', () => {
    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false, 'should not be ready');
    assert.ok(output.blockers.length > 0, 'should have blockers');
    assert.ok(
      output.checks.some(c => c.name === 'state_readable' && !c.passed),
      'state_readable check should fail'
    );
  });

  test('reports blocker when planning dir missing', () => {
    // Remove .planning entirely
    fs.rmSync(path.join(tmpDir, '.planning'), { recursive: true, force: true });

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.ready, false);
    assert.ok(
      output.checks.some(c => c.name === 'planning_dir' && !c.passed),
      'planning_dir check should fail'
    );
  });

  test('detects uncommitted changes', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Phase:** 01\n**Status:** Ready\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: true })
    );
    // Don't commit — leave dirty

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(
      output.checks.some(c => c.name === 'git_clean' && !c.passed),
      'git_clean should fail with uncommitted changes'
    );
  });

  test('checks batch target', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Phase:** 01\n**Status:** Ready\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: true })
    );
    execSync('git add . && git commit -m "add state"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('preflight batch', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    // batch_exists should fail — no batch file
    assert.ok(
      output.checks.some(c => c.name === 'batch_exists' && !c.passed),
      'batch_exists check should fail when no batch file'
    );
  });

  test('checks phase target', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Phase:** 01\n**Status:** Ready\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: true })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });
    execSync('git add . && git commit -m "add state"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('preflight 3', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(
      output.checks.some(c => c.name === 'target_phase' && c.passed),
      'target_phase check should pass for existing phase'
    );
  });

  test('detects active blockers in state.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Phase:** 01\n**Status:** Blocked\n\n## Blockers\n\n- Waiting for API key\n- Dependency not available\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: true })
    );
    execSync('git add . && git commit -m "add state"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runPanTools('preflight', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(
      output.checks.some(c => c.name === 'no_blockers' && !c.passed),
      'no_blockers should fail when active blockers exist'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// deps validate command
// ─────────────────────────────────────────────────────────────────────────────

describe('deps validate command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('returns valid output schema', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 01: Setup\n**Goal:** Init\n\n### Phase 02: Build\n**Goal:** Code\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-build'), { recursive: true });

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(typeof output.valid, 'boolean', 'should have valid field');
    assert.ok(Array.isArray(output.issues), 'should have issues array');
    assert.strictEqual(typeof output.roadmap_phases, 'number', 'should have roadmap_phases');
    assert.strictEqual(typeof output.disk_phases, 'number', 'should have disk_phases');
  });

  test('detects phase in roadmap but not on disk', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 01: Setup\n**Goal:** Init\n\n### Phase 02: Build\n**Goal:** Code\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    // Phase 02 missing on disk

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid');
    assert.ok(output.missing_phases.length >= 1, 'should have missing phases');
  });

  test('detects orphaned directory on disk', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 01: Setup\n**Goal:** Init\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '99-orphan'), { recursive: true });

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.orphaned_dirs.length >= 1, 'should have orphaned dirs');
    assert.strictEqual(output.orphaned_dirs[0].number, '99');
  });

  test('handles missing roadmap gracefully', () => {
    // No roadmap.md
    try { fs.unlinkSync(path.join(tmpDir, '.planning', 'roadmap.md')); } catch { /* ok */ }

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.roadmap_phases, 0);
    assert.ok(output.issues.some(i => i.message.includes('roadmap.md not found')), 'should warn about missing roadmap');
  });

  test('detects orphaned requirements', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: Setup\n**Goal:** Init\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'requirements.md'),
      '# Requirements\n\n- [ ] **REQ-01**: Feature A\n- [ ] **REQ-02**: Feature B\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });

    const result = runPanTools('deps validate', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.requirements_total, 2);
    assert.ok(output.orphaned_reqs.length >= 1, 'should have orphaned requirements');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate consistency edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('validate consistency edge cases', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => cleanup(tmpDir));

  test('handles empty phases directory', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n'
    );

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true, 'empty project should pass');
  });

  test('detects multiple gaps in numbering', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: A\n**Goal:** a\n\n### Phase 3: C\n**Goal:** c\n\n### Phase 5: E\n**Goal:** e\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05-e'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    // Should detect gaps at 2 and 4
    assert.ok(output.warnings.length >= 2, 'should have warnings about gaps');
  });

  test('decimal sub-phases are accepted as part of parent', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: Setup\n**Goal:** Init\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01.1-hotfix'), { recursive: true });

    const result = runPanTools('validate consistency', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    // Decimal sub-phases are accepted as part of parent phase — no warning
    assert.strictEqual(output.passed, true, 'decimal sub-phase should not trigger warning');
  });
});
