/**
 * Program R2: review lenses, k-pass voting and a validator, and the reviewer's
 * declined-to-judge list (MI-118).
 *
 * Code gate (docs/specs/product-excellence-superplan.md): the lens / vote / validator
 * plumbing works without a model, the `declined` field round-trips through the
 * verdict contract and the findings ledger, and the default config keeps the single
 * pass. The evidence gate (a paired corpus run deciding whether lenses beat one pass)
 * spends, and stays blocked until a run is approved.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../pan-wizard-core/bin/lib/verdict.cjs');
const F = require('../pan-wizard-core/bin/lib/findings.cjs');
const RV = require('../pan-wizard-core/bin/lib/review-vote.cjs');
const C = require('../pan-wizard-core/bin/lib/config.cjs');
const { createTempProject, cleanup, runPanTools } = require('./helpers.cjs');

const FENCE = '```';
const report = (verdict, findings, extra = {}) =>
  `## Code Review — Phase 03\n\nprose\n\n${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '03', verdict, outcome: verdict === 'NEEDS_FIXES' ? 'fail' : 'pass', findings, ...extra })}\n${FENCE}\n`;

const NULL_DEREF = { class: 'defect', severity: 'high', where: 'src/a.ts:12', summary: 'parse() dereferences a null token at end of input' };
const NULL_DEREF_REWORDED = { class: 'defect', severity: 'medium', where: 'src/a.ts:12', summary: 'parse() dereferences null token at the end of the input' };
const LONE = { class: 'quality', severity: 'high', where: 'src/b.ts:3', summary: 'variable name shadows an import' };

let dir;
beforeEach(() => {
  dir = createTempProject();
  fs.mkdirSync(path.join(dir, '.planning', 'phases', '03-auth'), { recursive: true });
});
afterEach(() => cleanup(dir));

describe('declined-to-judge (MI-118)', () => {
  test('the parser keeps each declined behaviour with its reason, and drops empty entries', () => {
    const p = V.parseVerdictText(report('PASS', [], { declined: [{ behaviour: 'retry timing under load', reason: 'no load test exists' }, 'a bare string', {}] }), { agent: 'pan-reviewer', phase: '03' });
    assert.equal(p.ok, true);
    assert.deepEqual(p.verdict.declined, [{ behaviour: 'retry timing under load', reason: 'no load test exists' }, { behaviour: 'a bare string', reason: null }]);
  });

  test('findings record keeps the list on the verdict row and returns it', () => {
    const r = F.recordVerdict(dir, { phase: '03', text: report('PASS', [], { declined: [{ behaviour: 'the migration path', reason: 'out of the diff' }] }) });
    assert.equal(r.recorded, true);
    assert.deepEqual(r.declined, [{ behaviour: 'the migration path', reason: 'out of the diff' }]);
    const row = F.readLedger(dir).rows.find((x) => x.kind === 'verdict');
    assert.deepEqual(row.declined, [{ behaviour: 'the migration path', reason: 'out of the diff' }]);
  });
});

describe('review vote: k passes, a quorum, a recomputed verdict (R2)', () => {
  test('a finding two of three passes report survives at its highest severity; a lone one is dropped', () => {
    const passes = [
      report('NEEDS_FIXES', [NULL_DEREF, LONE], { declined: [{ behaviour: 'perf', reason: 'no benchmark' }] }),
      report('PASS_WITH_WARNINGS', [NULL_DEREF_REWORDED]),
      report('PASS', [], { declined: [{ behaviour: 'perf', reason: 'no benchmark' }] }),
    ];
    const v = RV.voteVerdicts(passes, { phase: '03' });
    assert.equal(v.ok, true);
    assert.equal(v.passes, 3);
    assert.equal(v.quorum, 2);
    assert.deepEqual(v.verdict.findings.map((f) => [f.where, f.severity, f.votes]), [['src/a.ts:12', 'high', 2]]);
    assert.deepEqual(v.dropped.map((f) => f.where), ['src/b.ts:3']);
    assert.equal(v.verdict.verdict, 'NEEDS_FIXES', 'a kept high finding is an error');
    assert.equal(v.verdict.outcome, 'fail');
    assert.deepEqual(v.verdict.declined, [{ behaviour: 'perf', reason: 'no benchmark' }], 'declined lists are merged without duplicates');
  });

  test('the verdict follows the kept findings: medium only is a warning, none is a pass', () => {
    const warn = RV.voteVerdicts([report('PASS_WITH_WARNINGS', [{ ...LONE, severity: 'medium' }]), report('PASS_WITH_WARNINGS', [{ ...LONE, severity: 'medium' }])], { phase: '03' });
    assert.equal(warn.verdict.verdict, 'PASS_WITH_WARNINGS');
    const clean = RV.voteVerdicts([report('NEEDS_FIXES', [LONE]), report('PASS', []), report('PASS', [])], { phase: '03' });
    assert.equal(clean.verdict.verdict, 'PASS');
    assert.equal(clean.verdict.findings.length, 0);
  });

  test('a pass with no readable verdict block fails the vote instead of counting as clean', () => {
    const v = RV.voteVerdicts([report('PASS', []), 'no block here'], { phase: '03' });
    assert.equal(v.ok, false);
    assert.equal(v.error, 'unreadable_pass');
  });

  test('the merged report records cleanly through findings record', () => {
    const v = RV.voteVerdicts([report('NEEDS_FIXES', [NULL_DEREF]), report('NEEDS_FIXES', [NULL_DEREF_REWORDED])], { phase: '03' });
    const r = F.recordVerdict(dir, { phase: '03', text: v.text });
    assert.equal(r.recorded, true);
    assert.equal(r.findings, 1);
    assert.equal(r.verdict, 'NEEDS_FIXES');
  });

  test('CLI: review vote writes the merged report for findings record to read', () => {
    const files = [report('NEEDS_FIXES', [NULL_DEREF]), report('NEEDS_FIXES', [NULL_DEREF_REWORDED]), report('PASS', [])].map((t, i) => {
      const p = path.join(dir, `pass-${i}.md`);
      fs.writeFileSync(p, t);
      return p;
    });
    const out = path.join(dir, '03-review.md');
    const r = runPanTools(`review vote --phase 03 --out "${out}" ${files.map((p) => `"${p}"`).join(' ')}`, dir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.kept, 1);
    assert.equal(json.verdict, 'NEEDS_FIXES');
    assert.ok(V.parseVerdictText(fs.readFileSync(out, 'utf8'), { agent: 'pan-reviewer', phase: '03' }).ok);
  });
});

describe('review mode config (R2)', () => {
  test('the default keeps the single pass; lenses is the opt-in', () => {
    assert.equal(C.buildConfigDefaults(true, {}).workflow.review_mode, 'single');
    const template = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pan-wizard-core', 'templates', 'config.json'), 'utf8'));
    assert.equal(template.workflow.review_mode, 'single');
    assert.equal(C.isKnownConfigPath('workflow.review_mode'), true);
    assert.deepEqual(RV.LENSES, ['correctness', 'security', 'maintainability']);
  });
});
