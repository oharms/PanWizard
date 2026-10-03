/**
 * verdict.cjs — the pan-verdict contract (evidence loop, spec §3.3; ADR-0049).
 *
 * The contract is what every judge's report is recorded through, so these cases pin
 * the parse rules (last block wins, fences, indentation), the refusals (the verdict is
 * unusable) and the tolerances (recorded in the closest valid form, with a warning).
 * The verification.md adapter is pinned against the frontmatter shape the verifier
 * template writes — a list of mappings PAN's general frontmatter parser reads as
 * bare strings, which is why the adapter carries its own reader.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const v = require('../pan-wizard-core/bin/lib/verdict.cjs');
const reviewDeep = require('../pan-wizard-core/bin/lib/review-deep.cjs');

const FENCE = '`'.repeat(3);

/** A report whose last element is a pan-verdict block holding `obj`. */
function report(obj, { fence = FENCE, indent = '', pretty = false, prose = 'Review complete.' } = {}) {
  const json = pretty ? JSON.stringify(obj, null, 2) : JSON.stringify(obj);
  const body = json.split('\n').map((l) => indent + l).join('\n');
  return `${prose}\n\n${indent}${fence}pan-verdict\n${body}\n${indent}${fence}\n`;
}

const REVIEW = {
  contract: '1.0',
  agent: 'pan-reviewer',
  phase: '03',
  verdict: 'NEEDS_FIXES',
  outcome: 'fail',
  findings: [{ class: 'defect', severity: 'high', where: 'src/utils/parser.ts:42', summary: 'parse() drops the final token' }],
};

describe('verdict — parsing the pan-verdict block', () => {
  test('a one-line block parses into the normalised verdict', () => {
    const r = v.parseVerdictText(report(REVIEW), { phase: '3' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.source_kind, 'block');
    assert.deepEqual(r.warnings, []);
    assert.deepEqual(r.verdict, {
      contract: '1.0', agent: 'pan-reviewer', outcome: 'fail', verdict: 'NEEDS_FIXES', phase: '03', score: null,
      findings: [{ class: 'defect', severity: 'high', where: 'src/utils/parser.ts:42', summary: 'parse() drops the final token' }],
      not_checked: [],
    });
  });

  test('pretty-printed JSON, a tilde fence and an indented fence all parse', () => {
    for (const shape of [{ pretty: true }, { fence: '~~~' }, { indent: '    ' }, { indent: '\t', pretty: true, fence: '````' }]) {
      const r = v.parseVerdictText(report(REVIEW, shape));
      assert.equal(r.ok, true, `${JSON.stringify(shape)}: ${JSON.stringify(r)}`);
      assert.equal(r.verdict.outcome, 'fail');
      assert.equal(r.verdict.findings.length, 1);
    }
  });

  test('the LAST block wins — an earlier quoted example is not the answer', () => {
    const example = report({ ...REVIEW, outcome: 'pass', verdict: 'PASS', findings: [] }, { prose: 'The contract looks like:' });
    const r = v.parseVerdictText(example + '\n' + report(REVIEW));
    assert.equal(r.ok, true);
    assert.equal(r.verdict.outcome, 'fail');
    assert.equal(v.findVerdictBlocks(example + report(REVIEW)).length, 2);
  });

  test('a closing fence must match the opening character and be at least as long', () => {
    const text = `${FENCE}${FENCE[0]}pan-verdict\n${JSON.stringify(REVIEW)}\n${FENCE}\n~~~~\n${FENCE}${FENCE[0]}\n`;
    const blocks = v.findVerdictBlocks(text);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].closed, true);
    assert.match(blocks[0].body, /~~~~/, 'the shorter fence and the tilde fence are content, not the close');
  });

  test('refusals: no block, invalid JSON, unterminated, unsupported contract, no outcome, no agent', () => {
    assert.equal(v.parseVerdictText('Just prose. No verdict here.').error, 'no_verdict');
    assert.equal(v.parseVerdictText(`${FENCE}pan-verdict\n{"contract": "1.0",}\n${FENCE}\n`).error, 'invalid_json');
    assert.equal(v.parseVerdictText(`${FENCE}pan-verdict\n${JSON.stringify(REVIEW)}\n`).error, 'unterminated_block');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, contract: '2.0' })).error, 'unsupported_contract');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, contract: undefined })).error, 'unsupported_contract');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, outcome: undefined })).error, 'invalid_outcome');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, outcome: 'maybe' })).error, 'invalid_outcome');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, agent: undefined })).error, 'missing_agent');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, agent: 'Not A Name' })).error, 'missing_agent');
    assert.equal(v.validateVerdict([REVIEW]).error, 'invalid_verdict');
  });

  test('contract 1 and "1" normalise to "1.0"; "1.3" is kept (any 1.x is read)', () => {
    assert.equal(v.parseVerdictText(report({ ...REVIEW, contract: 1 })).verdict.contract, '1.0');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, contract: '1' })).verdict.contract, '1.0');
    assert.equal(v.parseVerdictText(report({ ...REVIEW, contract: '1.3', future_field: { x: 1 } })).verdict.contract, '1.3');
  });

  test('the agent the orchestrator names wins over the block and the mismatch is reported', () => {
    const r = v.parseVerdictText(report({ ...REVIEW, agent: 'pan-verifier' }), { agent: 'pan-reviewer' });
    assert.equal(r.verdict.agent, 'pan-reviewer');
    assert.ok(r.warnings.some((w) => w.startsWith('agent_mismatch')), r.warnings.join('; '));
    const r2 = v.parseVerdictText(report({ ...REVIEW, agent: undefined }), { agent: 'pan-reviewer' });
    assert.equal(r2.ok, true, 'the --agent flag supplies a missing agent');
  });

  test('an outcome the agent\'s own verdict word contradicts is recorded as given, with outcome_mismatch', () => {
    const r = v.parseVerdictText(report({ ...REVIEW, verdict: 'PASS', outcome: 'fail' }));
    assert.equal(r.ok, true);
    assert.equal(r.verdict.outcome, 'fail');
    assert.ok(r.warnings.some((w) => /^outcome_mismatch: PASS implies pass/.test(w)), r.warnings.join('; '));
  });

  test('a phase that disagrees with --phase is a warning, zero padding is not', () => {
    assert.deepEqual(v.parseVerdictText(report(REVIEW), { phase: 3 }).warnings, []);
    assert.ok(v.parseVerdictText(report(REVIEW), { phase: '04' }).warnings.some((w) => w.startsWith('phase_mismatch')));
  });
});

describe('verdict — findings are recorded in their closest valid form', () => {
  test('unknown class and severity become quality / info, with warnings', () => {
    const r = v.parseVerdictText(report({ ...REVIEW, findings: [{ class: 'bogus', severity: 'URGENT', summary: 'x' }, { class: 'Risk', severity: 'HIGH', summary: 'y' }] }));
    assert.deepEqual(r.verdict.findings.map((f) => [f.class, f.severity]), [['quality', 'info'], ['risk', 'high']]);
    assert.ok(r.warnings.some((w) => w.startsWith('unknown_class: #0')));
    assert.ok(r.warnings.some((w) => w.startsWith('unknown_severity: #0')));
    assert.equal(r.warnings.filter((w) => /#1/.test(w)).length, 0, 'case differences are normalised silently');
  });

  test('a finding without a summary is dropped and reported; where is optional and its separators are normalised', () => {
    const r = v.parseVerdictText(report({ ...REVIEW, findings: [{ class: 'defect', severity: 'low' }, 'text', { class: 'defect', severity: 'low', where: 'src\\win\\path.ts:3', summary: '  spaced\n  out  ' }] }));
    assert.equal(r.verdict.findings.length, 1);
    assert.deepEqual(r.verdict.findings[0], { class: 'defect', severity: 'low', where: 'src/win/path.ts:3', summary: 'spaced out' });
    assert.equal(r.warnings.filter((w) => w.startsWith('finding_dropped')).length, 2);
  });

  test('more than the limit of findings keeps the first ones; an overlong summary is truncated', () => {
    const many = Array.from({ length: v.LIMITS.findings + 5 }, (_, i) => ({ class: 'quality', severity: 'info', summary: `f${i}` }));
    const r = v.parseVerdictText(report({ ...REVIEW, findings: many }));
    assert.equal(r.verdict.findings.length, v.LIMITS.findings);
    assert.ok(r.warnings.some((w) => w.startsWith('findings_truncated')));
    const long = v.parseVerdictText(report({ ...REVIEW, findings: [{ class: 'defect', severity: 'low', summary: 'y'.repeat(v.LIMITS.summary + 50) }] }));
    assert.equal(long.verdict.findings[0].summary.length, v.LIMITS.summary);
    assert.ok(long.warnings.some((w) => w.startsWith('summary_truncated')));
  });

  test('findings that are not an array are ignored with a warning, not refused', () => {
    const r = v.parseVerdictText(report({ ...REVIEW, findings: { class: 'defect' } }));
    assert.equal(r.ok, true);
    assert.deepEqual(r.verdict.findings, []);
    assert.ok(r.warnings.includes('findings_not_an_array'));
  });
});

// The frontmatter shape pan-verifier's template writes (agents/pan-verifier.md <output>).
const VERIFICATION = [
  '---',
  'phase: 03-auth',
  'verified: 2026-09-28T10:00:00Z',
  'status: gaps_found',
  'score: 2/4 must-haves verified',
  'gaps:',
  '  - truth: "User can log in with a password"',
  '    status: failed',
  '    reason: "handler never checks the password"',
  '    artifacts:',
  '      - path: "src/auth/login.ts"',
  '        issue: "returns 200 unconditionally"',
  '      - path: "src/auth/session.ts"',
  '    missing:',
  '      - "password comparison"',
  '  - truth: "Sessions expire after 30 minutes"',
  '    status: partial',
  '    reason: "refresh never expires"',
  'human_verification:',
  '  - test: "Log in on a phone"',
  '    expected: "the form fits the screen"',
  '    why_human: "visual"',
  'unrequested:',
  '  - path: "src/admin/panel.ts"',
  '    what: "an admin panel no plan asked for"',
  '---',
  '',
  '# Phase 3: Auth Verification Report',
].join('\n');

describe('verdict — verification.md frontmatter adapter', () => {
  test('status, gaps, human items and unrequested work map to the contract', () => {
    const r = v.parseVerdictText(VERIFICATION, { phase: '03' });
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.source_kind, 'frontmatter');
    assert.equal(r.verdict.agent, 'pan-verifier');
    assert.equal(r.verdict.verdict, 'gaps_found');
    assert.equal(r.verdict.outcome, 'fail');
    assert.deepEqual(r.verdict.findings, [
      { class: 'missing', severity: 'high', where: 'src/auth/login.ts', summary: 'User can log in with a password — handler never checks the password' },
      { class: 'partial', severity: 'medium', where: null, summary: 'Sessions expire after 30 minutes — refresh never expires' },
      { class: 'human', severity: 'info', where: null, summary: 'Log in on a phone — expected: the form fits the screen' },
      { class: 'unrequested', severity: 'low', where: 'src/admin/panel.ts', summary: 'an admin panel no plan asked for' },
    ]);
  });

  test('the template\'s YAML comments on list keys and values do not hide the lists', () => {
    // pan-verifier's template writes `gaps: # Only if status: gaps_found`, and a model
    // copying the template copies the comment.
    const commented = [
      '---',
      'status: gaps_found # set by Step 9',
      'gaps: # Only if status: gaps_found',
      '  - truth: "User can log in" # the must-have',
      '    status: failed',
      '    reason: "no password check # not a comment inside quotes"',
      '    artifacts: # files with issues',
      '      - path: "src/login.ts" # first artifact',
      'unrequested: # Only if Step 7c found work no plan asked for',
      '  - path: "src/admin.ts"',
      '    what: "an admin page"',
      '---',
    ].join('\n');
    const r = v.parseVerdictText(commented);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.verdict.verdict, 'gaps_found');
    assert.deepEqual(r.verdict.findings, [
      { class: 'missing', severity: 'high', where: 'src/login.ts', summary: 'User can log in — no password check # not a comment inside quotes' },
      { class: 'unrequested', severity: 'low', where: 'src/admin.ts', summary: 'an admin page' },
    ]);
  });

  test('the shipped verification template\'s frontmatter example reads as a verdict with its unrequested entry', () => {
    const fs = require('fs');
    const tpl = fs.readFileSync(require('path').join(__dirname, '..', 'pan-wizard-core', 'templates', 'verification-report.md'), 'utf-8').replace(/\r\n/g, '\n');
    const example = tpl.slice(tpl.indexOf('```markdown\n') + '```markdown\n'.length).replace('passed | gaps_found | human_needed', 'passed');
    const r = v.parseVerdictText(example);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.deepEqual(r.verdict.findings, [{ class: 'unrequested', severity: 'low', where: 'src/admin/panel.tsx', summary: 'An admin panel no plan or requirement asked for' }]);
  });

  test('a CRLF file with a BOM reads the same', () => {
    const crlf = '﻿' + VERIFICATION.replace(/\n/g, '\r\n');
    assert.deepEqual(v.parseVerdictText(crlf).verdict, v.parseVerdictText(VERIFICATION).verdict);
  });

  test('passed with an empty gaps list, and human_needed, map to their outcomes', () => {
    const passed = v.parseVerdictText('---\nstatus: passed\ngaps: []\n---\nbody\n');
    assert.equal(passed.verdict.outcome, 'pass');
    assert.deepEqual(passed.verdict.findings, []);
    assert.equal(v.parseVerdictText('---\nstatus: "human_needed"\n---\n').verdict.outcome, 'needs_human');
  });

  test('an unknown status is refused rather than guessed', () => {
    const r = v.parseVerdictText('---\nstatus: passed_with_notes\n---\n');
    assert.equal(r.ok, false);
    assert.equal(r.error, 'unknown_status');
  });

  test('a pan-verdict block in the file wins over its frontmatter', () => {
    const r = v.parseVerdictText(VERIFICATION + '\n' + report({ contract: '1.0', agent: 'pan-verifier', outcome: 'pass', verdict: 'passed' }));
    assert.equal(r.source_kind, 'block');
    assert.equal(r.verdict.outcome, 'pass');
  });

  test('frontmatter without a status is not a verdict', () => {
    assert.equal(v.verdictFromVerificationFrontmatter('---\nphase: 03\n---\n'), null);
    assert.equal(v.verdictFromVerificationFrontmatter('no frontmatter'), null);
  });
});

// A gate that did not run is never a plain pass (market-ideas M23). The verifier
// records its test gate; a skipped gate travels with the verdict as `not_checked`.
describe('verdict — what a judge could not check (M23)', () => {
  const fm = (lines) => ['---', 'status: passed', ...lines, '---', ''].join('\n');

  test('test_gate: skipped becomes a tests entry even when not_checked leaves it out', () => {
    const r = v.parseVerdictText(fm(['test_gate: skipped']));
    assert.equal(r.verdict.outcome, 'pass');
    assert.deepEqual(r.verdict.not_checked, [{ check: 'tests', reason: 'the test gate was skipped' }]);
    assert.ok(!r.warnings.some(w => w.startsWith('test_gate')), r.warnings.join('\n'));
  });

  test('an explicit not_checked entry keeps its reason and is not doubled', () => {
    const r = v.parseVerdictText(fm(['test_gate: skipped', 'not_checked:', '  - check: "tests"', '    reason: "no test script in package.json"',
      '  - check: "browser flows"', '    reason: "no browser on the runner"']));
    assert.deepEqual(r.verdict.not_checked, [
      { check: 'tests', reason: 'no test script in package.json' },
      { check: 'browser flows', reason: 'no browser on the runner' },
    ]);
  });

  test('a tests entry under a gate that ran is the template example copied over: dropped, with a warning', () => {
    const r = v.parseVerdictText(fm(['test_gate: passed', 'not_checked:', '  - check: "tests"', '    reason: "no test script in package.json"']));
    assert.deepEqual(r.verdict.not_checked, []);
    assert.ok(r.warnings.some(w => w.startsWith('not_checked_contradicted')), r.warnings.join('\n'));
  });

  test('a verification that does not record its test gate is flagged', () => {
    const r = v.parseVerdictText(fm([]));
    assert.equal(r.ok, true);
    assert.deepEqual(r.verdict.not_checked, []);
    assert.ok(r.warnings.some(w => w.startsWith('test_gate_unrecorded')), r.warnings.join('\n'));
  });

  test('a failed test gate under a passed status is flagged, and an unknown gate value too', () => {
    assert.ok(v.parseVerdictText(fm(['test_gate: failed'])).warnings.some(w => w.startsWith('test_gate_failed_under_pass')));
    assert.ok(v.parseVerdictText(fm(['test_gate: maybe'])).warnings.some(w => w.startsWith('test_gate_unknown')));
  });

  test('a pan-verdict block\'s not_checked is normalised: strings, objects, junk', () => {
    const r = v.parseVerdictText(report({ ...REVIEW, not_checked: ['lint', { check: 'types', reason: 'tsc missing' }, { reason: 'no check named' }, 7] }));
    assert.deepEqual(r.verdict.not_checked, [{ check: 'lint', reason: null }, { check: 'types', reason: 'tsc missing' }]);
    const bad = v.parseVerdictText(report({ ...REVIEW, not_checked: 'lint' }));
    assert.deepEqual(bad.verdict.not_checked, []);
    assert.ok(bad.warnings.includes('not_checked_not_an_array'));
    assert.deepEqual(v.parseVerdictText(report(REVIEW)).verdict.not_checked, [], 'a block without the field has none');
  });

  test('the shipped template\'s example, with the gate skipped, reads as a pass with tests not checked', () => {
    const fs = require('fs');
    const tpl = fs.readFileSync(require('path').join(__dirname, '..', 'pan-wizard-core', 'templates', 'verification-report.md'), 'utf-8').replace(/\r\n/g, '\n');
    const example = tpl.slice(tpl.indexOf('```markdown\n') + '```markdown\n'.length)
      .replace('passed | gaps_found | human_needed', 'passed').replace('passed | failed | skipped', 'skipped');
    const r = v.parseVerdictText(example);
    assert.equal(r.verdict.outcome, 'pass');
    assert.deepEqual(r.verdict.not_checked, [{ check: 'tests', reason: 'no test script in package.json' }]);
  });
});

describe('verdict — identities', () => {
  test('recordSig ignores line endings and trailing whitespace, not content', () => {
    assert.equal(v.recordSig('a\nb\n'), v.recordSig('a\r\nb\r\n\n  '));
    assert.notEqual(v.recordSig('a\nb\n'), v.recordSig('a\nc\n'));
    assert.match(v.recordSig('x'), /^[0-9a-f]{16}$/);
  });

  test('findingId is stable under padding, spacing, case and trailing punctuation, and changes with class', () => {
    const a = v.findingId('03', 'pan-reviewer', { class: 'defect', where: 'src/a.ts:4', summary: 'X drops the token.' });
    const b = v.findingId('3', 'pan-reviewer', { class: 'defect', where: 'src\\a.ts:4', summary: 'x   drops the TOKEN' });
    assert.equal(a, b);
    assert.match(a, /^f_[0-9a-f]{10}$/);
    assert.notEqual(a, v.findingId('3', 'pan-reviewer', { class: 'risk', where: 'src/a.ts:4', summary: 'x drops the token' }));
    assert.notEqual(a, v.findingId('3', 'pan-verifier', { class: 'defect', where: 'src/a.ts:4', summary: 'x drops the token' }));
  });
});

describe('verdict — vocabularies', () => {
  test('one severity ladder in PAN: the same as review-deep', () => {
    assert.deepEqual([...v.SEVERITIES], [...reviewDeep.SEVERITIES]);
  });

  test('every known verdict word maps to a valid outcome, and outcomeForVerdict reads the table', () => {
    for (const [agent, table] of Object.entries(v.KNOWN_VERDICTS)) {
      for (const [word, outcome] of Object.entries(table)) {
        assert.ok(v.OUTCOMES.includes(outcome), `${agent}.${word}`);
        assert.equal(v.outcomeForVerdict(agent, word), outcome);
      }
    }
    assert.equal(v.outcomeForVerdict('pan-reviewer', 'passed'), null, 'verdict words are per agent');
    assert.equal(v.outcomeForVerdict('pan-unknown', 'PASS'), null);
  });

  test('dispositions needing a reason and the auto-fix exemptions are subsets of their vocabularies', () => {
    for (const d of v.REASON_REQUIRED) assert.ok(v.DISPOSITIONS.includes(d));
    for (const c of v.AUTO_FIX_EXEMPT) assert.ok(v.FINDING_CLASSES.includes(c));
  });
});
