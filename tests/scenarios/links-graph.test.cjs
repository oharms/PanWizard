/**
 * Scenario test — doc-code link graph end-to-end via the dispatcher (ADR-0027).
 *
 * Verifies that `pan-tools links validate` runs as a subprocess against a
 * fixture project, returns the documented JSON shape, and exits non-zero on
 * unresolved errors.
 */

'use strict';

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const TOOLS_PATH = path.join(__dirname, '..', '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

function runLinks(args, cwd) {
  try {
    const stdout = execFileSync(process.execPath, [TOOLS_PATH, 'links', ...args], {
      cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout || '').toString().trim(),
      stderr: (err.stderr || '').toString().trim(),
    };
  }
}

function writeFile(root, relPath, content) {
  const full = path.join(root, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

describe('links graph — end-to-end (ADR-0027)', () => {
  let tmp;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-links-scenario-'));
    // Real ADR
    writeFile(tmp, 'docs/decisions/ADR-0001-thing.md', '# ADR-0001\n## Decision\n');
    // Doc with require-code-mention but no anchor → B-001
    writeFile(tmp, 'docs/decisions/ADR-0002-uncovered.md', [
      '---', 'require-code-mention: true', '---', '# ADR-0002', '',
    ].join('\n'));
    // Doc with require-code-mention AND anchor → green
    writeFile(tmp, 'docs/decisions/ADR-0003-covered.md', [
      '---', 'require-code-mention: true', '---', '# ADR-0003', '',
    ].join('\n'));
    // Doc citing a real and a broken inline link
    writeFile(tmp, 'docs/USER.md', [
      'See [[ADR-0001]] for context.',
      'See [[ADR-9999]] for a missing one.',
      '',
    ].join('\n'));
    // One @pan: anchor that covers ADR-0003
    writeFile(tmp, 'src/covered.cjs', '// @pan: ADR-0003\nmodule.exports = {};\n');
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('runs and emits documented JSON shape', () => {
    const result = runLinks(['validate', '--doc-root', 'docs', '--source-root', 'src'], tmp);
    // F-001 (broken inline link) and B-001 (uncovered ADR-0002) → exitCode 1
    assert.equal(result.exitCode, 1, 'expected non-zero exit when errors present');
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.summary.status, 'fail');
    assert.ok(Array.isArray(parsed.findings));
    assert.ok('total_findings' in parsed.summary);
    assert.ok('errors' in parsed.summary);
    assert.ok('warnings' in parsed.summary);
    assert.ok('doc_files_scanned' in parsed.summary);
    assert.ok('source_files_scanned' in parsed.summary);
    assert.ok('anchors_found' in parsed.summary);
    assert.ok('forward_links_found' in parsed.summary);
    assert.ok('backlink_contracts_checked' in parsed.summary);
  });

  test('finding codes match spec §5 (F-001, B-001)', () => {
    const result = runLinks(['validate', '--doc-root', 'docs', '--source-root', 'src'], tmp);
    const parsed = JSON.parse(result.stdout);
    const codes = new Set(parsed.findings.map(f => f.code));
    assert.ok(codes.has('F-001'), 'F-001 expected for [[ADR-9999]]');
    assert.ok(codes.has('B-001'), 'B-001 expected for ADR-0002 (require-code-mention without anchor)');
  });

  test('--strict turns real warnings into a fail (A-002 stale section)', () => {
    // Use A-002 (anchor with stale section) — B-002 is exempt per spec §5.2.
    const subTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-links-strict-'));
    try {
      writeFile(subTmp, 'docs/decisions/ADR-0001-x.md', '# x\n## Decision\n');
      writeFile(subTmp, 'src/anchored.cjs', '// @pan: ADR-0001#NoSuchSection\n');
      const lax = runLinks(['validate', '--doc-root', 'docs', '--source-root', 'src'], subTmp);
      const strict = runLinks(['validate', '--strict', '--doc-root', 'docs', '--source-root', 'src'], subTmp);
      assert.equal(lax.exitCode, 0, 'lax mode passes when only warnings present');
      assert.equal(strict.exitCode, 1, 'strict mode fails when real warnings present');
    } finally {
      fs.rmSync(subTmp, { recursive: true, force: true });
    }
  });

  test('clean fixture exits 0', () => {
    const subTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-links-clean-'));
    try {
      writeFile(subTmp, 'docs/decisions/ADR-0001-x.md', '# x\n## Decision\n');
      writeFile(subTmp, 'docs/USER.md', 'See [[ADR-0001]].\n');
      const result = runLinks(['validate', '--doc-root', 'docs', '--source-root', 'src'], subTmp);
      assert.equal(result.exitCode, 0);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.summary.status, 'pass');
    } finally {
      fs.rmSync(subTmp, { recursive: true, force: true });
    }
  });
});
