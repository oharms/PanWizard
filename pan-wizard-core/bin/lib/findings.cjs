'use strict';
/**
 * Findings ledger — what PAN's judges found, and what was done about it
 * (evidence loop, docs/specs/evidence_loop_featureai.md §3.4; ADR-0049).
 *
 * `.planning/findings.jsonl` is append-only, like the cost and trace ledgers, so
 * parallel writers and interrupted runs never lose an update. Three row kinds:
 *
 *   verdict      one recorded judge report (agent, phase, outcome, attempt, the ids it listed)
 *   finding      one finding, written the first time its id is seen
 *   disposition  fixed | deferred | dismissed | decision, with a reason
 *
 * Status is FOLDED on read, never stored (D6):
 *   - the latest disposition wins;
 *   - except `fixed`, which gives way to `open` when a newer verdict reports the id
 *     again (a regression);
 *   - with no disposition, a finding is `open`.
 *
 * Two rules are applied when a verdict is recorded:
 *   - AUTO-FIX: the same agent's earlier open findings on the phase that the new
 *     verdict does not report become `fixed`. That is how a gap-closure round
 *     closes its gaps. `human` and `unrequested` are exempt, because a re-run does
 *     not re-check them.
 *   - IDEMPOTENCY: recording the same artifact twice is a no-op that returns the
 *     first verdict (record_sig). That is why exec-phase and verify-phase may both
 *     record one verification.md.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { output, toPosix, normalizePhaseName, findPhaseInternal, getMilestoneInfo } = require('./core.cjs');
const { planningPath, planningRel } = require('./utils.cjs');
const V = require('./verdict.cjs');

const FINDINGS_FILE = 'findings.jsonl';
const LEDGER_V = 1;
const REASON_MAX = 300;
const FINDING_ID_RE = /^f_[0-9a-f]{10}$/;
const STATUSES = Object.freeze(['open', ...V.DISPOSITIONS]);

function ledgerPath(cwd) {
  return planningPath(cwd, FINDINGS_FILE);
}

function sha(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** Ledger rows in file order; malformed lines are counted, never fatal. */
function readLedger(cwd) {
  let raw = '';
  try { raw = fs.readFileSync(ledgerPath(cwd), 'utf-8'); } catch { return { rows: [], malformed: 0 }; }
  const rows = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && typeof r === 'object' && typeof r.kind === 'string') rows.push(r);
      else malformed++;
    } catch { malformed++; }
  }
  return { rows, malformed };
}

/**
 * Fold the ledger into verdicts and findings with their derived status.
 * Row order (sequence), not timestamps, decides "newer": clocks can disagree,
 * an append-only file cannot.
 */
function foldFindings(rows) {
  const verdicts = [];
  const findings = new Map();
  rows.forEach((r, seq) => {
    if (r.kind === 'finding' && typeof r.id === 'string' && !findings.has(r.id)) {
      findings.set(r.id, {
        id: r.id, phase: r.phase, milestone: r.milestone || null, agent: r.agent, class: r.class,
        severity: r.severity, where: r.where || null, summary: r.summary, first_seen: r.ts,
        first_verdict_id: r.verdict_id || null, reports: 0, last_reported: null, _reportedSeq: -1,
        disposition: null, reason: null, disposed_at: null, auto: false, _disposedSeq: -1,
      });
    } else if (r.kind === 'verdict') {
      verdicts.push({ ...r, _seq: seq });
      for (const id of Array.isArray(r.finding_ids) ? r.finding_ids : []) {
        const f = findings.get(id);
        if (!f) continue;
        f.reports++;
        f.last_reported = r.ts;
        f._reportedSeq = seq;
      }
    } else if (r.kind === 'disposition' && typeof r.id === 'string') {
      const f = findings.get(r.id);
      if (!f || !V.DISPOSITIONS.includes(r.disposition)) return;
      f.disposition = r.disposition;
      f.reason = r.reason || null;
      f.disposed_at = r.ts;
      f.auto = r.auto === true;
      f._disposedSeq = seq;
    }
  });
  for (const f of findings.values()) {
    if (!f.disposition) f.status = 'open';
    else if (f.disposition === 'fixed' && f._reportedSeq > f._disposedSeq) f.status = 'open';
    else f.status = f.disposition;
  }
  return { verdicts, findings };
}

/** A finding as the CLI shows it (internal sequence fields removed). */
function publicFinding(f) {
  const { _reportedSeq, _disposedSeq, ...rest } = f;
  return rest;
}

function countBy(list, key) {
  const out = {};
  for (const x of list) out[x[key]] = (out[x[key]] || 0) + 1;
  return out;
}

function samePhase(a, b) {
  return V.comparablePhase(a) === V.comparablePhase(b);
}

/** `.planning/` must exist: the ledger fills a planning tree, it never creates one. */
function requirePlanningTree(cwd) {
  try { return fs.statSync(planningPath(cwd)).isDirectory(); } catch { return false; }
}

function appendRows(cwd, rows) {
  if (!rows.length) return;
  fs.appendFileSync(ledgerPath(cwd), rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
}

/** Log a trace event through optimize.cjs; best effort, never fails a record. */
function traceEvent(cwd, event) {
  try { require('./optimize.cjs').logTraceEvent(cwd, event); } catch { /* telemetry is best effort */ }
}

/**
 * Record a judge's verdict from an artifact's text.
 * @param {string} cwd
 * @param {{phase: string, text: string, source?: string, agent?: string}} input
 * @returns {Object} the record result, or `{error, reason}`
 */
function recordVerdict(cwd, input) {
  if (!requirePlanningTree(cwd)) return { error: 'not_a_pan_project', reason: 'no .planning/ directory here' };
  if (!input.phase) return { error: 'phase_required', reason: 'findings record needs --phase <N>' };
  const phaseInfo = findPhaseInternal(cwd, input.phase);
  if (!phaseInfo) return { error: 'phase_not_found', reason: `no phase directory for phase ${input.phase}` };
  const phase = normalizePhaseName(phaseInfo.phase_number || input.phase);
  const text = typeof input.text === 'string' ? input.text : '';
  if (!text.trim()) return { error: 'empty_input', reason: 'nothing to record' };

  const parsed = V.parseVerdictText(text, { agent: input.agent, phase });
  if (!parsed.ok) return { error: parsed.error, reason: parsed.reason };
  const verdict = parsed.verdict;
  const agent = verdict.agent;
  const recordSig = V.recordSig(text);

  const { rows } = readLedger(cwd);
  const fold = foldFindings(rows);
  const base = { contract: V.VERDICT_CONTRACT, agent, verdict: verdict.verdict, outcome: verdict.outcome, source_kind: parsed.source_kind, warnings: parsed.warnings };

  const dup = fold.verdicts.find((r) => r.record_sig === recordSig && r.agent === agent && samePhase(r.phase, phase));
  if (dup) {
    return { ...base, recorded: false, duplicate: true, verdict_id: dup.verdict_id, attempt: dup.attempt, phase, findings: (dup.finding_ids || []).length, new: 0, auto_fixed: 0, reopened: 0 };
  }

  const prior = fold.verdicts.filter((r) => r.agent === agent && samePhase(r.phase, phase));
  const attempt = prior.length + 1;
  const previous = prior.length ? prior[prior.length - 1] : null;
  const ts = new Date().toISOString();
  const milestone = getMilestoneInfo(cwd).version || null;
  const verdictId = 'v_' + sha([recordSig, phase, agent, rows.length].join('\u0000')).slice(0, 10);

  const ids = [];
  const newRows = [];
  const findingRows = [];
  for (const f of verdict.findings) {
    const id = V.findingId(phase, agent, f);
    if (ids.includes(id)) continue; // the same finding twice in one report is one finding
    ids.push(id);
    if (!fold.findings.has(id)) {
      findingRows.push({ v: LEDGER_V, kind: 'finding', ts, id, verdict_id: verdictId, phase, milestone, agent, class: f.class, severity: f.severity, where: f.where, summary: f.summary });
    }
  }
  const reopened = ids.filter((id) => fold.findings.has(id) && fold.findings.get(id).status === 'fixed').length;
  const autoFixRows = [];
  for (const f of fold.findings.values()) {
    if (f.agent !== agent || !samePhase(f.phase, phase) || f.status !== 'open') continue;
    if (ids.includes(f.id) || V.AUTO_FIX_EXEMPT.includes(f.class)) continue;
    autoFixRows.push({ v: LEDGER_V, kind: 'disposition', ts, id: f.id, disposition: 'fixed', reason: `not reported by ${agent} at attempt ${attempt}`, auto: true, verdict_id: verdictId });
  }

  const bySeverity = countBy(verdict.findings, 'severity');
  const byClass = countBy(verdict.findings, 'class');
  let source = '(text)';
  if (input.source) {
    const rel = path.relative(path.resolve(cwd), path.resolve(cwd, input.source));
    source = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : '(external file)';
  }
  newRows.push({
    v: LEDGER_V, kind: 'verdict', ts, verdict_id: verdictId, record_sig: recordSig, phase, milestone, agent,
    verdict: verdict.verdict, outcome: verdict.outcome, attempt, source, finding_ids: ids,
    by_severity: bySeverity, by_class: byClass, warnings: parsed.warnings,
  });
  appendRows(cwd, [...findingRows, ...newRows, ...autoFixRows]);

  const category = { pass: 'verdict_passed', fail: 'verdict_failed', needs_human: 'verdict_needs_human' }[verdict.outcome];
  const serious = (bySeverity.critical || 0) + (bySeverity.high || 0) > 0;
  traceEvent(cwd, {
    type: verdict.outcome === 'fail' ? 'error' : 'decision',
    category,
    agent,
    phase,
    description: `${agent} ${verdict.verdict || verdict.outcome} on phase ${phase} (attempt ${attempt}, ${ids.length} finding${ids.length === 1 ? '' : 's'})`,
    impact: verdict.outcome === 'fail' ? (serious ? 'major' : 'minor') : 'minor',
    context: { agent, phase, verdict: verdict.verdict, attempt, findings: ids.length, by_severity: bySeverity, by_class: byClass, verdict_id: verdictId },
  });
  if (previous && previous.outcome === 'fail') {
    traceEvent(cwd, {
      type: 'correction',
      category: 'verdict_retry',
      agent,
      phase,
      description: `${agent} judged phase ${phase} again (attempt ${attempt}): ${previous.outcome} → ${verdict.outcome}, ${autoFixRows.length} earlier finding(s) no longer reported`,
      impact: 'minor',
      context: { agent, phase, attempt, previous_outcome: previous.outcome, outcome: verdict.outcome, auto_fixed: autoFixRows.length, reopened, verdict_id: verdictId },
    });
  }

  return { ...base, recorded: true, duplicate: false, verdict_id: verdictId, attempt, phase, findings: ids.length, new: findingRows.length, auto_fixed: autoFixRows.length, reopened, ledger: planningRel(FINDINGS_FILE) };
}

/**
 * Record a disposition for findings, by id or in bulk (`--phase N [--agent A] --open`).
 * @param {{ids?: string[], phase?: string, agent?: string, open?: boolean, as: string, reason?: string}} input
 */
function disposeFindings(cwd, input) {
  if (!requirePlanningTree(cwd)) return { error: 'not_a_pan_project', reason: 'no .planning/ directory here' };
  const as = String(input.as || '').trim().toLowerCase();
  if (!V.DISPOSITIONS.includes(as)) return { error: 'invalid_disposition', reason: `--as must be one of ${V.DISPOSITIONS.join(', ')}` };
  const reason = input.reason == null ? '' : String(input.reason).replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
  if (V.REASON_REQUIRED.includes(as) && !reason) {
    return { error: 'reason_required', reason: `a ${as} disposition needs --reason "<why>" (MI-031: never dispose silently)` };
  }
  const { rows } = readLedger(cwd);
  const fold = foldFindings(rows);
  let targets;
  if (Array.isArray(input.ids) && input.ids.length) {
    targets = input.ids;
  } else if (input.open && input.phase) {
    targets = [...fold.findings.values()]
      .filter((f) => f.status === 'open' && samePhase(f.phase, input.phase) && (!input.agent || f.agent === input.agent))
      .map((f) => f.id);
  } else {
    return { error: 'no_targets', reason: 'name finding ids, or --phase <N> --open [--agent <name>]' };
  }
  const ts = new Date().toISOString();
  const disposed = [];
  const skipped = [];
  const out = [];
  for (const id of targets) {
    const f = fold.findings.get(id);
    if (!f) { skipped.push({ id, why: 'unknown id' }); continue; }
    if (f.status === as) { skipped.push({ id, why: `already ${as}` }); continue; }
    out.push({ v: LEDGER_V, kind: 'disposition', ts, id, disposition: as, reason: reason || null, auto: false });
    disposed.push(id);
  }
  appendRows(cwd, out);
  return { contract: V.VERDICT_CONTRACT, disposition: as, disposed, skipped };
}

/** Findings with their folded status, filtered. */
function listFindings(cwd, filters = {}) {
  const { rows, malformed } = readLedger(cwd);
  const fold = foldFindings(rows);
  let list = [...fold.findings.values()];
  if (filters.phase) list = list.filter((f) => samePhase(f.phase, filters.phase));
  if (filters.agent) list = list.filter((f) => f.agent === filters.agent);
  if (filters.status) list = list.filter((f) => f.status === filters.status);
  if (filters.class) list = list.filter((f) => f.class === filters.class);
  if (filters.milestone) list = list.filter((f) => f.milestone === filters.milestone);
  const findings = list.map(publicFinding);
  return {
    contract: V.VERDICT_CONTRACT,
    findings,
    counts: { total: findings.length, by_status: countBy(findings, 'status'), by_class: countBy(findings, 'class'), by_severity: countBy(findings, 'severity') },
    verdicts: fold.verdicts.length,
    malformed_rows: malformed,
  };
}

/**
 * Tech debt for a milestone audit: deferred findings (with the reason recorded at
 * the time) and findings nobody disposed, grouped by phase.
 */
function findingsDebt(cwd, opts = {}) {
  const milestone = opts.milestone || getMilestoneInfo(cwd).version || null;
  const { rows } = readLedger(cwd);
  const fold = foldFindings(rows);
  const byPhase = new Map();
  for (const f of fold.findings.values()) {
    if (milestone && f.milestone !== milestone) continue;
    if (f.status !== 'deferred' && f.status !== 'open') continue;
    const key = V.comparablePhase(f.phase);
    if (!byPhase.has(key)) byPhase.set(key, { phase: f.phase, deferred: [], open: [] });
    byPhase.get(key)[f.status === 'deferred' ? 'deferred' : 'open'].push(publicFinding(f));
  }
  const phases = [...byPhase.values()].sort((a, b) => String(a.phase).localeCompare(String(b.phase), undefined, { numeric: true }));
  return {
    contract: V.VERDICT_CONTRACT,
    milestone,
    phases,
    deferred_count: phases.reduce((n, p) => n + p.deferred.length, 0),
    open_count: phases.reduce((n, p) => n + p.open.length, 0),
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function cmdFindingsRecord(cwd, opts, raw) {
  let text = null;
  let source = null;
  const inputs = [opts.file != null, opts.text != null, !!opts.stdin].filter(Boolean).length;
  if (inputs !== 1) { output({ error: 'one_input', reason: 'give exactly one of --file <path>, --text <string>, --stdin' }, raw); return; }
  if (opts.file != null) {
    try { text = fs.readFileSync(path.resolve(cwd, opts.file), 'utf-8'); } catch (e) {
      output({ error: 'unreadable_file', reason: `cannot read ${opts.file}: ${e.code || e.message}` }, raw);
      return;
    }
    source = opts.file;
  } else if (opts.text != null) {
    text = String(opts.text);
  } else {
    try { text = fs.readFileSync(0, 'utf-8'); } catch { text = ''; }
    source = null;
  }
  const r = recordVerdict(cwd, { phase: opts.phase, text, source, agent: opts.agent });
  // --raw prints the judge's own verdict word (the word the workflow branches on),
  // or the outcome when the report gave none. A failed verdict is data: exit 0.
  output(r, raw, r.error ? undefined : (r.verdict || r.outcome));
}

function cmdFindingsDispose(cwd, opts, raw) {
  output(disposeFindings(cwd, opts), raw);
}

function cmdFindingsList(cwd, opts, raw) {
  if (opts.status && !STATUSES.includes(opts.status)) { output({ error: 'invalid_status', reason: `--status must be one of ${STATUSES.join(', ')}` }, raw); return; }
  if (opts.class && !V.FINDING_CLASSES.includes(opts.class)) { output({ error: 'invalid_class', reason: `--class must be one of ${V.FINDING_CLASSES.join(', ')}` }, raw); return; }
  const r = listFindings(cwd, opts);
  output(r, raw, String(r.counts.total));
}

function cmdFindingsDebt(cwd, opts, raw) {
  const r = findingsDebt(cwd, opts);
  output(r, raw, `${r.deferred_count} deferred, ${r.open_count} open`);
}

/** Positional finding ids in an argv slice. */
function findingIdsIn(args) {
  return args.filter((a) => FINDING_ID_RE.test(a));
}

module.exports = {
  FINDINGS_FILE,
  STATUSES,
  readLedger,
  foldFindings,
  recordVerdict,
  disposeFindings,
  listFindings,
  findingsDebt,
  findingIdsIn,
  cmdFindingsRecord,
  cmdFindingsDispose,
  cmdFindingsList,
  cmdFindingsDebt,
};
