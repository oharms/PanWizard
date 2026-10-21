/**
 * Program R5: proven findings. A review finding is `confirmed` only with a catching
 * test: one that passes at the phase's base and fails at HEAD, so it shows the defect
 * the phase introduced. Without such a proof the finding stays a `candidate`.
 *
 * In a real git repository: phase 2 introduces an off-by-one. A test that checks the
 * right answer passes at the base and fails at HEAD (confirmed). A test that fails at
 * the base too is not specific to the change, and one that passes at HEAD does not
 * catch anything; both leave the finding a candidate.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const R = require('../pan-wizard-core/bin/lib/verify-red.cjs');
const F = require('../pan-wizard-core/bin/lib/findings.cjs');
const { cleanup, TOOLS_PATH } = require('./helpers.cjs');

let dir;
const write = (rel, text) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
const git = (...args) => execFileSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
const commit = (msg) => { git('add', '-A'); git('commit', '-q', '-m', msg); };
const TEST = (body) => `const test = require('node:test');\nconst assert = require('node:assert');\n${body}\n`;
const FENCE = '```';
const review = (findings) => `## Code Review\n\n${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '02', verdict: 'NEEDS_FIXES', outcome: 'fail', findings })}\n${FENCE}\n`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-prove-'));
  git('init', '-q');
  write('.planning/roadmap.md', '# Roadmap\n\n### Phase 2: Range\n');
  write('.planning/phases/02-range/02-01-plan.md', '---\nphase: 02-range\nplan: 01\n---\n');
  write('package.json', JSON.stringify({ name: 'x', scripts: { test: 'node --test' } }));
  write('src/range.js', 'exports.count = (a, b) => b - a + 1;\n');
  commit('chore: before phase 2');
  write('src/range.js', 'exports.count = (a, b) => b - a;\n'); // the phase's off-by-one
  commit('feat(02-01): rework count');
  write('test/catching.test.js', TEST("const { count } = require('../src/range.js');\ntest('inclusive', () => assert.strictEqual(count(1, 3), 3));"));
  write('test/always-red.test.js', TEST("test('broken anywhere', () => assert.strictEqual(1, 2));"));
  write('test/never-red.test.js', TEST("test('tautology', () => assert.strictEqual(1, 1));"));
});
afterEach(() => cleanup(dir));

describe('proveFinding (R5)', () => {
  test('a test that passes at the base and fails at HEAD confirms the finding', () => {
    const p = R.proveFinding(dir, '2', 'test/catching.test.js');
    assert.equal(p.status, 'confirmed', JSON.stringify(p));
    assert.equal(p.base_exit, 0);
    assert.notEqual(p.head_exit, 0);
  });

  test('a test failing at the base too, or passing at HEAD, leaves it a candidate', () => {
    assert.equal(R.proveFinding(dir, '2', 'test/always-red.test.js').status, 'fails_at_base');
    assert.equal(R.proveFinding(dir, '2', 'test/never-red.test.js').status, 'passes_at_head');
  });
});

describe('findings prove: the ledger records the proof (R5)', () => {
  test('a proven finding reads as confirmed; one with no proof stays a candidate', () => {
    F.recordVerdict(dir, { phase: '2', text: review([
      { class: 'defect', severity: 'high', where: 'src/range.js:1', summary: 'count() is off by one: the range is inclusive' },
      { class: 'quality', severity: 'medium', where: 'src/range.js:1', summary: 'name does not say the range is inclusive' },
    ]) });
    const [defect, naming] = F.listFindings(dir, { phase: '2' }).findings.sort((a, b) => a.severity.localeCompare(b.severity));
    assert.equal(defect.confidence, 'candidate');
    const r = spawnSync(process.execPath, [TOOLS_PATH, 'findings', 'prove', defect.id, '--test', 'test/catching.test.js'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).status, 'confirmed');
    const after = F.listFindings(dir, { phase: '2' }).findings;
    assert.equal(after.find((f) => f.id === defect.id).confidence, 'confirmed');
    assert.deepEqual(after.find((f) => f.id === defect.id).proof, { status: 'confirmed', test: 'test/catching.test.js' });
    assert.equal(after.find((f) => f.id === naming.id).confidence, 'candidate');
  });

  test('a failed proof is recorded, exits 1, and leaves the finding a candidate', () => {
    F.recordVerdict(dir, { phase: '2', text: review([{ class: 'defect', severity: 'high', where: 'src/range.js:1', summary: 'count() is off by one' }]) });
    const [f] = F.listFindings(dir, { phase: '2' }).findings;
    const r = spawnSync(process.execPath, [TOOLS_PATH, 'findings', 'prove', f.id, '--test', 'test/never-red.test.js', '--raw'], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.equal(r.stdout.trim(), 'passes_at_head');
    assert.equal(F.listFindings(dir, { phase: '2' }).findings[0].confidence, 'candidate');
  });
});
