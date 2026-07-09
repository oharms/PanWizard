// Tests for pan-wizard-core/bin/lib/doc-lint.cjs (v3.7.1).
// Vendored from whooo experiment (see ADR-0026, P-201/P-202/P-301).

'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const docLintRoot = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'doc-lint');

describe('doc-lint vendored modules', () => {
  test('all 5 modules ship in pan-wizard-core/bin/lib/doc-lint/', () => {
    for (const f of ['frontmatter.js', 'schema.js', 'validate.js', 'walk.js', 'reporter.js']) {
      assert.ok(fs.existsSync(path.join(docLintRoot, f)),
        `${f} must ship — vendored from whooo experiment`);
    }
  });

  test('canonical PAN command schema ships under references/schemas/', () => {
    const schemaPath = path.join(__dirname, '..', 'pan-wizard-core', 'references', 'schemas', 'pan-command.schema.yml');
    assert.ok(fs.existsSync(schemaPath), 'pan-command.schema.yml must ship');
    const text = fs.readFileSync(schemaPath, 'utf-8');
    assert.match(text, /^fields:/m);
    assert.match(text, /\bname:/);
    assert.match(text, /\bargument-hint:/);
    assert.match(text, /\bagent:/);
  });

  test('frontmatter parser handles block-style YAML lists (P-201 fix)', () => {
    const { parseFrontmatter } = require(path.join(docLintRoot, 'frontmatter.js'));
    const r = parseFrontmatter('---\nname: foo\nallowed-tools:\n  - Read\n  - Write\n---\nbody\n');
    assert.equal(r.errors.length, 0);
    assert.deepEqual(r.data['allowed-tools'], ['Read', 'Write']);
  });
});

describe('doc-lint smoke against PAN commands/pan/', () => {
  test('PAN commands/pan/*.md is fully clean per the canonical schema', () => {
    // After v3.7.1 P-301 fixes, this directory must lint with zero errors.
    const { spawnSync } = require('child_process');
    const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const cmdsDir = path.join(__dirname, '..', 'commands', 'pan');
    const r = spawnSync('node', [tools, 'doc-lint', cmdsDir, '--raw'], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });
    assert.equal(r.status, 0,
      `expected exit 0 from doc-lint commands/pan/, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout || '', /0 error\(s\), 0 warning\(s\)/);
  });
});

// ─── doc-lint counts (IMPROVEMENT-TODO P1, v3.7.10) ─────────────────────────

describe('doc-lint counts — drift-prone count detector', () => {
  const docLint = require('../pan-wizard-core/bin/lib/doc-lint.cjs');

  test('isCountAllowed exempts CLAUDE.md, CHANGELOG.md, MEMORY.md, and auto-generated SKILLS docs', () => {
    assert.equal(docLint.isCountAllowed('CLAUDE.md'), true);
    assert.equal(docLint.isCountAllowed('CHANGELOG.md'), true);
    assert.equal(docLint.isCountAllowed('MEMORY.md'), true);
    assert.equal(docLint.isCountAllowed('docs/SKILLS-FULL-TEXT.md'), true);
    assert.equal(docLint.isCountAllowed('docs/SKILLS-REFERENCE.md'), true);
    assert.equal(docLint.isCountAllowed('docs/EXAMPLES.md'), true);
  });

  test('isCountAllowed exempts docs/decisions, docs/specs, experiments, learnings, archive', () => {
    assert.equal(docLint.isCountAllowed('docs/decisions/ADR-0001.md'), true);
    assert.equal(docLint.isCountAllowed('docs/specs/foo.md'), true);
    assert.equal(docLint.isCountAllowed('experiments/whoolog/idea.md'), true);
    assert.equal(docLint.isCountAllowed('pan-wizard-core/learnings/universal/atomic-state.md'), true);
    assert.equal(docLint.isCountAllowed('docs/archive/old-spec.md'), true);
    // And the same paths when scanned with docs/ as scan-root:
    assert.equal(docLint.isCountAllowed('decisions/ADR-0001.md'), true);
    assert.equal(docLint.isCountAllowed('specs/foo.md'), true);
  });

  test('isCountAllowed flags non-allowed docs', () => {
    assert.equal(docLint.isCountAllowed('docs/USER-GUIDE.md'), false);
    assert.equal(docLint.isCountAllowed('docs/ARCHITECTURE.md'), false);
    assert.equal(docLint.isCountAllowed('README.md'), false);
  });

  test('docs/ scans clean — no count violations in shipped user-facing docs', () => {
    const { spawnSync } = require('child_process');
    const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const docsDir = path.join(__dirname, '..', 'docs');
    const r = spawnSync('node', [tools, 'doc-lint', 'counts', docsDir, '--raw'], {
      encoding: 'utf-8',
      shell: process.platform === 'win32',
    });
    assert.equal(r.status, 0,
      `expected exit 0 from doc-lint counts docs/, got ${r.status}\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    assert.match(r.stdout || '', /OK/);
  });

  test('detects "52 commands" in a synthetic violating file', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-doclint-counts-'));
    try {
      fs.writeFileSync(path.join(tmp, 'README.md'), 'PAN ships 52 commands and 21 agents.\n');
      const { spawnSync } = require('child_process');
      const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
      const r = spawnSync('node', [tools, 'doc-lint', 'counts', tmp, '--raw'], {
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      });
      assert.equal(r.status, 1, `expected exit 1 (violations), got ${r.status}\n${r.stdout}\n${r.stderr}`);
      assert.match(r.stdout || '', /52 commands/);
      assert.match(r.stdout || '', /21 agents/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('does NOT flag version numbers like "v3.5 module"', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-doclint-version-'));
    try {
      fs.writeFileSync(path.join(tmp, 'NOTES.md'), 'See the v3.5 module behavior. Also v4.7 Commands work fine.\n');
      const { spawnSync } = require('child_process');
      const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
      const r = spawnSync('node', [tools, 'doc-lint', 'counts', tmp, '--raw'], {
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      });
      assert.equal(r.status, 0,
        `version refs must not trigger violations\nstdout: ${r.stdout}\nstderr: ${r.stderr}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('does NOT flag content inside ```fenced``` code blocks', () => {
    const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pan-doclint-fence-'));
    try {
      const md = [
        '# Example',
        '',
        '```json',
        '{ "patterns": ["12 test files found"] }',
        '```',
        '',
        'End of doc.',
        '',
      ].join('\n');
      fs.writeFileSync(path.join(tmp, 'EXAMPLE.md'), md);
      const { spawnSync } = require('child_process');
      const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
      const r = spawnSync('node', [tools, 'doc-lint', 'counts', tmp, '--raw'], {
        encoding: 'utf-8',
        shell: process.platform === 'win32',
      });
      assert.equal(r.status, 0,
        `fenced code must not trigger violations\nstdout: ${r.stdout}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
