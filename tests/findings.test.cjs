/**
 * findings.cjs — the findings ledger (evidence loop EL-5; spec §3.4, D4–D7; ADR-0049).
 *
 * The ledger is append-only and folded on read, so every rule here is a rule about
 * the fold: which verdicts close which findings (auto-fix), which re-reports reopen
 * them, which dispositions stick, and what a milestone audit reads back as debt.
 * The CLI cases run the real dispatcher in a temp project.
 */

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const F = require('../pan-wizard-core/bin/lib/findings.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

const FENCE = '`'.repeat(3);

function verification({ status = 'gaps_found', gaps = [], human = [], unrequested = [], stamp = '2026-09-28T10:00:00Z' } = {}) {
  const lines = ['---', 'phase: 03-auth', `verified: ${stamp}`, `status: ${status}`];
  if (gaps.length) {
    lines.push('gaps:');
    for (const g of gaps) {
      lines.push(`  - truth: "${g.truth}"`, `    status: ${g.status || 'failed'}`, `    reason: "${g.reason}"`);
      if (g.path) lines.push('    artifacts:', `      - path: "${g.path}"`);
    }
  }
  if (human.length) { lines.push('human_verification:'); for (const h of human) lines.push(`  - test: "${h}"`); }
  if (unrequested.length) { lines.push('unrequested:'); for (const u of unrequested) lines.push(`  - path: "${u.path}"`, `    what: "${u.what}"`); }
  lines.push('---', '', '# Phase 3 verification', '');
  return lines.join('\n');
}

function review(verdict, outcome, findings) {
  return `## Code Review — Phase 03\n\nprose\n\n${FENCE}pan-verdict\n${JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', phase: '03', verdict, outcome, findings })}\n${FENCE}\n`;
}

const GAP_LOGIN = { truth: 'User can log in', reason: 'no password check', path: 'src/login.ts' };
const GAP_EXPIRY = { truth: 'Sessions expire', reason: 'refresh never expires', status: 'partial' };

let dir;
beforeEach(() => {
  dir = createTempProject();
  fs.mkdirSync(path.join(dir, '.planning', 'phases', '03-auth'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.planning', 'phases', '04-billing'), { recursive: true });
});
afterEach(() => cleanup(dir));

const ledgerRows = () => F.readLedger(dir).rows;
const statusOf = (id) => F.listFindings(dir).findings.find((f) => f.id === id).status;
function traceEvents() {
  const root = path.join(dir, '.planning', 'optimization', 'traces');
  const out = [];
  if (!fs.existsSync(root)) return out;
  for (const s of fs.readdirSync(root)) {
    const f = path.join(root, s, 'trace.jsonl');
    if (fs.existsSync(f)) for (const l of fs.readFileSync(f, 'utf-8').split('\n')) if (l.trim()) out.push(JSON.parse(l));
  }
  return out;
}

describe('findings — recording a verdict', () => {
  test('a verification with gaps records one verdict and its findings, all open', () => {
    const r = F.recordVerdict(dir, { phase: '3', text: verification({ gaps: [GAP_LOGIN, GAP_EXPIRY] }), source: '.planning/phases/03-auth/03-verification.md' });
    assert.equal(r.recorded, true, JSON.stringify(r));
    assert.deepEqual([r.agent, r.verdict, r.outcome, r.attempt, r.findings, r.new, r.phase], ['pan-verifier', 'gaps_found', 'fail', 1, 2, 2, '03']);
    const kinds = ledgerRows().map((x) => x.kind);
    assert.deepEqual(kinds, ['finding', 'finding', 'verdict'], 'finding rows first, one verdict, one append');
    const verdictRow = ledgerRows()[2];
    assert.equal(verdictRow.source, '.planning/phases/03-auth/03-verification.md');
    assert.deepEqual(verdictRow.by_severity, { high: 1, medium: 1 });
    const list = F.listFindings(dir);
    assert.deepEqual(list.findings.map((f) => [f.class, f.status, f.where]), [['missing', 'open', 'src/login.ts'], ['partial', 'open', null]]);
  });

  test('recording the same artifact twice is a no-op that returns the first verdict (record_sig)', () => {
    const text = verification({ gaps: [GAP_LOGIN] });
    const first = F.recordVerdict(dir, { phase: '03', text });
    const again = F.recordVerdict(dir, { phase: '3', text: text.replace(/\n/g, '\r\n') + '\n\n' });
    assert.equal(again.recorded, false);
    assert.equal(again.duplicate, true);
    assert.equal(again.verdict_id, first.verdict_id);
    assert.equal(again.verdict, 'gaps_found', 'the duplicate still answers what the workflow branches on');
    assert.equal(ledgerRows().filter((x) => x.kind === 'verdict').length, 1);
  });

  test('a re-verification is attempt 2 and auto-fixes the gaps it no longer reports', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN, GAP_EXPIRY] }) });
    const r = F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_EXPIRY], stamp: '2026-09-28T12:00:00Z' }) });
    assert.equal(r.attempt, 2);
    assert.equal(r.auto_fixed, 1);
    const byClass = Object.fromEntries(F.listFindings(dir).findings.map((f) => [f.class, f]));
    assert.equal(byClass.missing.status, 'fixed');
    assert.equal(byClass.missing.auto, true);
    assert.equal(byClass.missing.reason, 'not reported by pan-verifier at attempt 2');
    assert.equal(byClass.partial.status, 'open', 'a gap reported again stays open');
    assert.equal(byClass.partial.reports, 2);
  });

  test('a passing re-verification closes every open gap, but not human or unrequested findings', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN], human: ['Log in on a phone'], unrequested: [{ path: 'src/admin.ts', what: 'an admin page nobody asked for' }] }) });
    const r = F.recordVerdict(dir, { phase: '03', text: verification({ status: 'passed', stamp: '2026-09-29T09:00:00Z' }) });
    assert.equal(r.outcome, 'pass');
    assert.equal(r.auto_fixed, 1);
    const status = Object.fromEntries(F.listFindings(dir).findings.map((f) => [f.class, f.status]));
    assert.deepEqual(status, { missing: 'fixed', human: 'open', unrequested: 'open' });
  });

  test('auto-fix stays within the same agent and phase', () => {
    F.recordVerdict(dir, { phase: '03', text: review('NEEDS_FIXES', 'fail', [{ class: 'defect', severity: 'high', where: 'src/a.ts:1', summary: 'a is wrong' }]) });
    F.recordVerdict(dir, { phase: '03', text: verification({ status: 'passed' }) });
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '04-billing'), { recursive: true });
    F.recordVerdict(dir, { phase: '04', text: review('PASS', 'pass', []) });
    assert.deepEqual(F.listFindings(dir).findings.map((f) => f.status), ['open'], 'neither the verifier nor phase 4\'s review closes phase 3\'s review finding');
  });

  test('a fixed finding reported again is open again (a regression), and the record says so', () => {
    const bad = { class: 'defect', severity: 'high', where: 'src/a.ts:1', summary: 'a is wrong' };
    F.recordVerdict(dir, { phase: '03', text: review('NEEDS_FIXES', 'fail', [bad]) });
    F.recordVerdict(dir, { phase: '03', text: review('PASS', 'pass', []) });
    const [f] = F.listFindings(dir).findings;
    assert.equal(f.status, 'fixed');
    const r = F.recordVerdict(dir, { phase: '03', text: review('NEEDS_FIXES', 'fail', [bad]) + '\nsecond regression run\n' });
    assert.equal(r.reopened, 1);
    assert.equal(statusOf(f.id), 'open');
  });

  test('a deliberate deferral is not overridden when the finding is reported again', () => {
    const warn = { class: 'quality', severity: 'medium', where: 'src/b.ts:9', summary: 'b is long' };
    F.recordVerdict(dir, { phase: '03', text: review('PASS_WITH_WARNINGS', 'pass', [warn]) });
    const [f] = F.listFindings(dir).findings;
    F.disposeFindings(dir, { ids: [f.id], as: 'deferred', reason: 'accepted at review: PASS_WITH_WARNINGS' });
    F.recordVerdict(dir, { phase: '03', text: review('PASS_WITH_WARNINGS', 'pass', [warn]) + '\nre-run\n' });
    assert.equal(statusOf(f.id), 'deferred');
  });

  test('the same finding twice in one report is one finding', () => {
    const dup = { class: 'defect', severity: 'low', where: 'x.ts', summary: 'same' };
    const r = F.recordVerdict(dir, { phase: '03', text: review('NEEDS_FIXES', 'fail', [dup, { ...dup }]) });
    assert.equal(r.findings, 1);
    assert.equal(F.listFindings(dir).findings.length, 1);
  });

  test('refusals: no planning tree, no phase, unknown phase, empty input, unparseable report', () => {
    assert.equal(F.recordVerdict(path.join(dir, 'nowhere'), { phase: '3', text: 'x' }).error, 'not_a_pan_project');
    assert.equal(F.recordVerdict(dir, { text: verification() }).error, 'phase_required');
    assert.equal(F.recordVerdict(dir, { phase: '9', text: verification() }).error, 'phase_not_found');
    assert.equal(F.recordVerdict(dir, { phase: '3', text: '  ' }).error, 'empty_input');
    assert.equal(F.recordVerdict(dir, { phase: '3', text: 'prose with no verdict' }).error, 'no_verdict');
    assert.equal(fs.existsSync(path.join(dir, '.planning', F.FINDINGS_FILE)), false, 'a refusal writes nothing');
  });
});

describe('findings — a pass that did not check everything (M23)', () => {
  const skippedGate = verification({ status: 'passed' }).replace('status: passed', 'status: passed\ntest_gate: skipped');

  test('the record, the ledger row and the trace carry what was not checked', () => {
    const r = F.recordVerdict(dir, { phase: '3', text: skippedGate });
    assert.equal(r.recorded, true);
    assert.equal(r.outcome, 'pass');
    assert.deepEqual(r.not_checked, [{ check: 'tests', reason: 'the test gate was skipped' }]);
    const row = ledgerRows().find(x => x.kind === 'verdict');
    assert.deepEqual(row.not_checked, [{ check: 'tests', reason: 'the test gate was skipped' }]);
    const ev = traceEvents().find(e => e.category === 'verdict_passed');
    assert.ok(ev, 'the pass is traced');
    assert.deepEqual(ev.context.not_checked, ['tests']);
  });

  test('a pass that checked everything keeps a lean ledger row', () => {
    const ran = verification({ status: 'passed' }).replace('status: passed', 'status: passed\ntest_gate: passed');
    const r = F.recordVerdict(dir, { phase: '3', text: ran });
    assert.deepEqual(r.not_checked, []);
    assert.equal('not_checked' in ledgerRows().find(x => x.kind === 'verdict'), false);
  });
});

describe('findings — trace events from a record', () => {
  test('a failed verdict logs error/verdict_failed; a retry after a failure logs correction/verdict_retry', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN] }) });
    F.recordVerdict(dir, { phase: '03', text: verification({ status: 'passed', stamp: '2026-09-29T09:00:00Z' }) });
    const events = traceEvents();
    const failed = events.find((e) => e.category === 'verdict_failed');
    assert.ok(failed, 'verdict_failed logged');
    assert.equal(failed.type, 'error');
    assert.equal(failed.agent, 'pan-verifier');
    assert.equal(failed.impact, 'major', 'a failure with a high finding is major');
    assert.deepEqual([failed.context.attempt, failed.context.findings, failed.context.by_severity.high], [1, 1, 1]);
    const passed = events.find((e) => e.category === 'verdict_passed');
    assert.equal(passed.type, 'decision');
    const retry = events.find((e) => e.category === 'verdict_retry');
    assert.equal(retry.type, 'correction');
    assert.deepEqual([retry.context.attempt, retry.context.previous_outcome, retry.context.outcome, retry.context.auto_fixed], [2, 'fail', 'pass', 1]);
  });

  test('a duplicate record logs nothing', () => {
    const text = verification({ gaps: [GAP_LOGIN] });
    F.recordVerdict(dir, { phase: '03', text });
    const before = traceEvents().length;
    F.recordVerdict(dir, { phase: '03', text });
    assert.equal(traceEvents().length, before);
  });
});

describe('findings — dispositions', () => {
  function seed() {
    F.recordVerdict(dir, { phase: '03', text: review('NEEDS_FIXES', 'fail', [
      { class: 'defect', severity: 'high', where: 'a.ts:1', summary: 'one' },
      { class: 'quality', severity: 'medium', where: 'b.ts:2', summary: 'two' },
    ]) });
    return F.listFindings(dir).findings.map((f) => f.id);
  }

  test('each disposition is recorded; deferred, dismissed and decision need a reason, fixed does not', () => {
    const [a, b] = seed();
    for (const as of ['deferred', 'dismissed', 'decision']) {
      const refused = F.disposeFindings(dir, { ids: [a], as });
      assert.equal(refused.error, 'reason_required', as);
    }
    assert.deepEqual(F.disposeFindings(dir, { ids: [a], as: 'decision', reason: 'keep: ADR-12 chose this' }).disposed, [a]);
    assert.equal(statusOf(a), 'decision');
    assert.deepEqual(F.disposeFindings(dir, { ids: [b], as: 'fixed' }).disposed, [b]);
    assert.equal(statusOf(b), 'fixed');
    assert.equal(F.disposeFindings(dir, { ids: [a], as: 'maybe' }).error, 'invalid_disposition');
  });

  test('unknown ids and repeats are skipped, with the reason', () => {
    const [a] = seed();
    F.disposeFindings(dir, { ids: [a], as: 'dismissed', reason: 'false positive: generated file' });
    const r = F.disposeFindings(dir, { ids: [a, 'f_0000000000'], as: 'dismissed', reason: 'again' });
    assert.deepEqual(r.disposed, []);
    assert.deepEqual(r.skipped, [{ id: a, why: 'already dismissed' }, { id: 'f_0000000000', why: 'unknown id' }]);
  });

  test('bulk: --phase --open [--agent] disposes exactly the open findings that match', () => {
    const [a] = seed();
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN] }) });
    F.disposeFindings(dir, { ids: [a], as: 'fixed' });
    const r = F.disposeFindings(dir, { phase: '3', agent: 'pan-reviewer', open: true, as: 'deferred', reason: 'continued past NEEDS_FIXES at the user\'s choice' });
    assert.equal(r.disposed.length, 1, 'the one open reviewer finding; the fixed one and the verifier\'s gap are untouched');
    const status = F.listFindings(dir).findings.map((f) => `${f.agent}:${f.status}`).sort();
    assert.deepEqual(status, ['pan-reviewer:deferred', 'pan-reviewer:fixed', 'pan-verifier:open']);
    assert.equal(F.disposeFindings(dir, { as: 'fixed' }).error, 'no_targets');
  });
});

describe('findings — debt for a milestone audit', () => {
  test('deferred findings (with reasons) and undisposed ones, grouped by phase, for one milestone', () => {
    F.recordVerdict(dir, { phase: '03', text: review('PASS_WITH_WARNINGS', 'pass', [{ class: 'quality', severity: 'medium', where: 'b.ts', summary: 'warn' }]) });
    F.recordVerdict(dir, { phase: '04', text: verification({ gaps: [GAP_LOGIN] }) });
    const [warn] = F.listFindings(dir, { phase: '3' }).findings;
    F.disposeFindings(dir, { ids: [warn.id], as: 'deferred', reason: 'accepted at review: PASS_WITH_WARNINGS' });
    // A finding from an earlier milestone, written as the ledger would have held it.
    fs.appendFileSync(path.join(dir, '.planning', F.FINDINGS_FILE), JSON.stringify({ v: 1, kind: 'finding', ts: '2026-01-01T00:00:00Z', id: 'f_aaaaaaaaaa', phase: '01', milestone: 'v0.9', agent: 'pan-verifier', class: 'missing', severity: 'high', where: null, summary: 'old' }) + '\n');
    const debt = F.findingsDebt(dir);
    assert.equal(debt.milestone, 'v1.0');
    assert.equal(debt.deferred_count, 1);
    assert.equal(debt.open_count, 1);
    assert.deepEqual(debt.phases.map((p) => [p.phase, p.deferred.length, p.open.length]), [['03', 1, 0], ['04', 0, 1]]);
    assert.equal(debt.phases[0].deferred[0].reason, 'accepted at review: PASS_WITH_WARNINGS');
    assert.equal(F.findingsDebt(dir, { milestone: 'v0.9' }).open_count, 1, 'the earlier milestone is reported on its own');
  });
});

describe('findings — CLI', () => {
  const run = (args) => runPanTools(args, dir);

  test('findings record --file prints the record; --raw prints the judge\'s own verdict word', () => {
    const file = path.join(dir, '.planning', 'phases', '03-auth', '03-review.md');
    fs.writeFileSync(file, review('NEEDS_FIXES', 'fail', [{ class: 'risk', severity: 'high', where: 'api.ts:3', summary: 'unvalidated path' }]));
    const r = run(`findings record --phase 03 --file ${JSON.stringify(file)}`);
    assert.equal(r.success, true, r.error);
    const json = JSON.parse(r.output);
    assert.deepEqual([json.contract, json.recorded, json.outcome, json.source_kind], ['1.0', true, 'fail', 'block']);
    const rawOut = run(`findings record --phase 03 --file ${JSON.stringify(file)} --raw`);
    assert.deepEqual([rawOut.success, rawOut.output], [true, 'NEEDS_FIXES'], 'a failed verdict is data: exit 0');
  });

  test('findings record --text and --stdin read the report from the command line and from stdin', () => {
    // argv, not a shell string: a shell would pass the report's newlines as a literal "\n".
    const { execFileSync } = require('child_process');
    const tools = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');
    const viaText = execFileSync(process.execPath, [tools, 'findings', 'record', '--phase', '3', '--agent', 'pan-reviewer', '--text', review('PASS', 'pass', []), '--raw'], { cwd: dir, encoding: 'utf-8' });
    assert.equal(viaText.trim(), 'PASS');
    const out = execFileSync(process.execPath, [tools, 'findings', 'record', '--phase', '04', '--stdin', '--raw'], { cwd: dir, input: verification({ status: 'passed' }), encoding: 'utf-8' });
    assert.equal(out.trim(), 'passed');
  });

  test('findings record refuses bad input with exit 1: no input, two inputs, unreadable file, no verdict', () => {
    for (const args of ['findings record --phase 3', 'findings record --phase 3 --text a --stdin', 'findings record --phase 3 --file nope.md', 'findings record --phase 3 --text "just prose"']) {
      const r = run(args);
      assert.equal(r.success, false, args);
      assert.ok(JSON.parse(r.output).error, `${args} reports an error body`);
    }
  });

  test('findings list filters by --status, --class, --agent, --phase and --milestone, and rejects unknown values', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN, GAP_EXPIRY] }) });
    const parse = (args) => JSON.parse(run(args).output);
    assert.equal(parse('findings list --status open').counts.total, 2);
    assert.equal(parse('findings list --class partial').counts.total, 1);
    assert.equal(parse('findings list --agent pan-reviewer').counts.total, 0);
    assert.equal(parse('findings list --phase 4').counts.total, 0);
    assert.equal(parse('findings list --milestone v1.0').counts.total, 2);
    assert.equal(run('findings list --raw').output, '2');
    assert.equal(run('findings list --status nope').success, false);
    assert.equal(run('findings list --class nope').success, false);
  });

  test('findings dispose by id and in bulk; a missing --reason exits 1', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN, GAP_EXPIRY] }) });
    const [a, b] = F.listFindings(dir).findings.map((f) => f.id);
    const refused = run(`findings dispose ${a} --as deferred`);
    assert.equal(refused.success, false);
    assert.equal(JSON.parse(refused.output).error, 'reason_required');
    const byId = JSON.parse(run(`findings dispose ${a} --as dismissed --reason "duplicate of the auth gap"`).output);
    assert.deepEqual(byId.disposed, [a]);
    const bulk = JSON.parse(run('findings dispose --phase 3 --open --as deferred --reason "force proceed after 3 revisions"').output);
    assert.deepEqual(bulk.disposed, [b]);
  });

  test('findings debt prints the counts with --raw and the grouped debt as JSON', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN] }) });
    assert.equal(run('findings debt --raw').output, '0 deferred, 1 open');
    const json = JSON.parse(run('findings debt --milestone v1.0').output);
    assert.equal(json.contract, '1.0');
    assert.equal(json.phases[0].open[0].class, 'missing');
    // milestone-audit passes its version without the `v` (its report is
    // `v{version}-milestone-audit.md`); the ledger stores `v1.0`. That found nothing.
    assert.equal(JSON.parse(run('findings debt --milestone 1.0').output).open_count, 1);
    assert.equal(JSON.parse(run('findings list --milestone 1.0').output).counts.total, 1);
  });

  test('an unknown findings subcommand names the available ones', () => {
    const r = run('findings nope');
    assert.equal(r.success, false);
    assert.match(r.error, /Available: record, list, dispose, debt/);
  });

  test('malformed ledger lines are counted, not fatal', () => {
    F.recordVerdict(dir, { phase: '03', text: verification({ gaps: [GAP_LOGIN] }) });
    fs.appendFileSync(path.join(dir, '.planning', F.FINDINGS_FILE), '{not json\n42\n');
    const json = JSON.parse(run('findings list').output);
    assert.equal(json.counts.total, 1);
    assert.equal(json.malformed_rows, 2);
  });
});
