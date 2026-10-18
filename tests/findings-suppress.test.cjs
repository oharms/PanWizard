/**
 * findings.cjs — learned suppressions (program R3).
 *
 * A dismissed finding (reason recorded) teaches the ledger that its signature is
 * noise, but only for the file as it was when it was dismissed:
 *   - candidate (one dismissal): the same judge raising it again in the same phase
 *     is filtered;
 *   - promoted (two or more dismissals in different phases): filtered in any phase;
 *   - retired when the file changes: the finding comes back open;
 *   - never for security or logic findings, which always come back open.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../pan-wizard-core/bin/lib/findings.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const FENCE = '`'.repeat(3);

function report(agent, findings, verdict = 'NEEDS_FIXES', outcome = 'fail') {
  return `## Review\n\n${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent, phase: '03', verdict, outcome, findings })}\n${FENCE}\n`;
}

const NOISE = { class: 'quality', severity: 'low', where: 'src/util.js:12', summary: 'Variable name tmp is not descriptive enough' };
const NOISE_REWORDED = { class: 'quality', severity: 'low', where: 'src/util.js:14', summary: 'The variable name tmp is not descriptive' };

let dir;
beforeEach(() => {
  dir = createTempProject();
  for (const p of ['03-a', '04-b', '05-c']) fs.mkdirSync(path.join(dir, '.planning', 'phases', p), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'util.js'), 'const tmp = 1;\n');
});
afterEach(() => cleanup(dir));

const statusOf = (id) => F.listFindings(dir).findings.find((f) => f.id === id).status;

function recordAndDismiss(phase, finding, agent = 'pan-reviewer') {
  const r = F.recordVerdict(dir, { phase, text: report(agent, [finding]) });
  assert.equal(r.recorded, true, JSON.stringify(r));
  const id = F.listFindings(dir, { phase }).findings.find((f) => f.summary === finding.summary).id;
  const d = F.disposeFindings(dir, { ids: [id], as: 'dismissed', reason: 'naming nit, project convention' });
  assert.deepEqual(d.disposed, [id]);
  return id;
}

describe('findings — learned suppressions (R3)', () => {
  test('a dismissed signature raised again in its phase, file unchanged, is filtered and counted', () => {
    const id = recordAndDismiss('03', NOISE);
    const r = F.recordVerdict(dir, { phase: '03', text: report('pan-reviewer', [NOISE_REWORDED]) + '\nagain' });
    assert.equal(r.recorded, true, JSON.stringify(r));
    assert.equal(r.findings, 0, 'a filtered finding is not one of the verdict\'s findings');
    assert.deepEqual(r.suppressed, [{ id, scope: 'candidate', summary: NOISE_REWORDED.summary }]);
    assert.equal(statusOf(id), 'dismissed');
  });

  test('after its file changes, the dismissed finding comes back open', () => {
    const id = recordAndDismiss('03', NOISE);
    fs.writeFileSync(path.join(dir, 'src', 'util.js'), 'const tmp = 2;\n');
    const r = F.recordVerdict(dir, { phase: '03', text: report('pan-reviewer', [NOISE_REWORDED]) + '\nagain' });
    assert.deepEqual(r.suppressed, []);
    assert.equal(r.returned, 1);
    assert.equal(statusOf(id), 'open');
  });

  test('a candidate stays in its phase; a signature dismissed in two phases is promoted to every phase', () => {
    recordAndDismiss('03', NOISE);
    const other = F.recordVerdict(dir, { phase: '04', text: report('pan-reviewer', [NOISE]) });
    assert.equal(other.findings, 1, 'one dismissal does not reach another phase');
    const id4 = F.listFindings(dir, { phase: '04' }).findings[0].id;
    F.disposeFindings(dir, { ids: [id4], as: 'dismissed', reason: 'same nit' });
    const r = F.recordVerdict(dir, { phase: '05', text: report('pan-reviewer', [NOISE]) });
    assert.equal(r.findings, 0, JSON.stringify(r));
    assert.equal(r.suppressed[0].scope, 'promoted');
  });

  test('another judge\'s dismissal does not silence this one', () => {
    recordAndDismiss('03', NOISE, 'pan-design-checker');
    const r = F.recordVerdict(dir, { phase: '03', text: report('pan-reviewer', [NOISE]) });
    assert.equal(r.findings, 1);
  });

  test('logic findings are never suppressed: a dismissed defect raised again is open', () => {
    const bug = { class: 'defect', severity: 'medium', where: 'src/util.js:1', summary: 'Off by one in the loop bound' };
    const id = recordAndDismiss('03', bug);
    const r = F.recordVerdict(dir, { phase: '03', text: report('pan-reviewer', [bug]) + '\nagain' });
    assert.deepEqual(r.suppressed, []);
    assert.equal(statusOf(id), 'open');
  });

  test('security findings are never suppressed, whatever their class or judge', () => {
    const sec = { class: 'risk', severity: 'low', where: 'src/util.js:1', summary: 'SQL injection through the unescaped name parameter' };
    const id = recordAndDismiss('03', sec);
    F.recordVerdict(dir, { phase: '03', text: report('pan-reviewer', [sec]) + '\nagain' });
    assert.equal(statusOf(id), 'open');
    const hard = { class: 'quality', severity: 'low', where: 'src/util.js:3', summary: 'Header set in a loop' };
    const hid = recordAndDismiss('03', hard, 'pan-hardener');
    F.recordVerdict(dir, { phase: '03', text: report('pan-hardener', [hard]) + '\nagain' });
    assert.equal(statusOf(hid), 'open', 'the hardener is the security judge');
  });

  test('a finding with no file to scope it to is never suppressed', () => {
    const loose = { class: 'quality', severity: 'low', summary: 'Inconsistent log wording' };
    const id = recordAndDismiss('03', loose);
    F.recordVerdict(dir, { phase: '03', text: report('pan-reviewer', [loose]) + '\nagain' });
    assert.equal(statusOf(id), 'open');
  });

  test('suppressions are listed with their scope and file', () => {
    recordAndDismiss('03', NOISE);
    const s = F.listSuppressions(dir);
    assert.equal(s.suppressions.length, 1);
    assert.deepEqual([s.suppressions[0].scope, s.suppressions[0].file, s.suppressions[0].active], ['candidate', 'src/util.js', true]);
    fs.writeFileSync(path.join(dir, 'src', 'util.js'), 'changed\n');
    assert.equal(F.listSuppressions(dir).suppressions[0].active, false, 'retired once the file changes');
  });

  test('CLI: findings suppressions lists them; --raw prints the active count', () => {
    recordAndDismiss('03', NOISE);
    const r = runPanTools('findings suppressions --phase 3 --agent pan-reviewer', dir);
    assert.equal(r.success, true, r.error);
    const out = JSON.parse(r.output);
    assert.deepEqual(out.suppressions.map((s) => [s.agent, s.file, s.scope]), [['pan-reviewer', 'src/util.js', 'candidate']]);
    assert.equal(runPanTools('findings suppressions --raw', dir).output, '1');
    assert.equal(JSON.parse(runPanTools('findings suppressions --agent pan-verifier', dir).output).suppressions.length, 0);
  });
});
