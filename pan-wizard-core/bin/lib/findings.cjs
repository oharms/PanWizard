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
 * Rules applied when a verdict is recorded:
 *   - EVIDENCE CLOSES, SILENCE DOES NOT (V6): an earlier open finding closes only when
 *     the judge answers it `resolved` with evidence (a `resolutions` entry, or the
 *     verifier's `re_verification.gaps_closed`), or, for a `code-fact:<fact>` finding,
 *     when that fact passes. One the new verdict neither reports nor answers stays
 *     open and is listed as `unaddressed`. `still_present` counts as a re-report.
 *   - IDENTITY: a reworded report of an earlier finding (same class family, same
 *     file, same truth or a similar summary) keeps that finding's id.
 *   - IDEMPOTENCY: recording the same artifact twice is a no-op that returns the
 *     first verdict (record_sig). That is why exec-phase and verify-phase may both
 *     record one verification.md.
 *   - LEARNED SUPPRESSIONS (R3): a dismissed finding is noise for its file as it was
 *     when dismissed. The same judge raising it again (same signature, sameFinding)
 *     is filtered, in the dismissal's phase (candidate) or, once dismissed in two
 *     phases, in any phase (promoted). When the file changes the suppression retires
 *     and the finding comes back open. Security and logic findings, and findings
 *     with no file, are never suppressed: a re-report reopens them.
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
// Logic findings are never suppressed (R3): what the code does wrong, or not at all.
const LOGIC_CLASSES = Object.freeze(['defect', 'contradicts', 'missing', 'partial']);
// Security findings are never suppressed either, whatever class a judge gave them.
const SECURITY_RE = /secur|inject|xss|csrf|ssrf|secret|credential|password|authenticat|authoriz|\bauth\b|token|crypt|traversal|privilege|sanitiz|escap|cve-|owasp|\brce\b|deserializ/i;
const SECURITY_AGENTS = Object.freeze(['pan-hardener']);

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
        disposition: null, reason: null, disposed_at: null, auto: false, file_sha: null, _disposedSeq: -1, _returnedSeq: -1,
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
      // A dismissed finding raised again once its suppression no longer holds (R3).
      for (const id of Array.isArray(r.returned_ids) ? r.returned_ids : []) {
        const f = findings.get(id);
        if (f) f._returnedSeq = seq;
      }
    } else if (r.kind === 'disposition' && typeof r.id === 'string') {
      const f = findings.get(r.id);
      if (!f || !V.DISPOSITIONS.includes(r.disposition)) return;
      f.disposition = r.disposition;
      f.reason = r.reason || null;
      f.disposed_at = r.ts;
      f.auto = r.auto === true;
      f.file_sha = r.file_sha || null;
      f._disposedSeq = seq;
    }
  });
  for (const f of findings.values()) {
    if (!f.disposition) f.status = 'open';
    else if (f.disposition === 'fixed' && f._reportedSeq > f._disposedSeq) f.status = 'open';
    else if (f._returnedSeq > f._disposedSeq) f.status = 'open';
    else f.status = f.disposition;
  }
  return { verdicts, findings };
}

/** A finding as the CLI shows it (internal sequence fields removed). */
function publicFinding(f) {
  const { _reportedSeq, _disposedSeq, _returnedSeq, ...rest } = f;
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

// ─── Finding identity across reports (V6) ───────────────────────────────────

/** The file a `where` names, without a line or column suffix. */
function fileOf(where) {
  return where ? String(where).replace(/\\/g, '/').replace(/(:\d+){1,2}$/, '').replace(/#L?\d+.*$/, '') : '';
}

function tokens(s) {
  return new Set(String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ').filter((w) => w.length > 2));
}

/** Token overlap (Jaccard) of two summaries at or above one half. */
function similar(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return false;
  let both = 0;
  for (const t of A) if (B.has(t)) both++;
  return both / (A.size + B.size - both) >= 0.5;
}

/** The part of a summary before " — " (a verifier gap's truth), lower-cased. */
const headOf = (s) => String(s || '').split(' — ')[0].trim().toLowerCase();
/** A verifier gap moves between missing and partial as it is worked on: one family. */
const familyOf = (c) => (c === 'partial' ? 'missing' : c);

/** Same class family, same file, and the same truth or a similar summary. */
function sameFinding(e, f) {
  return familyOf(e.class) === familyOf(f.class) && fileOf(e.where) === fileOf(f.where)
    && (headOf(e.summary) === headOf(f.summary) || similar(e.summary, f.summary));
}

/** The earlier finding a judge's resolution answers: by id, else by its truth or summary. */
function resolutionTarget(mine, r) {
  if (r.id) return mine.find((f) => f.id === r.id) || null;
  const head = headOf(r.summary);
  return mine.find((f) => headOf(f.summary) === head) || mine.find((f) => similar(f.summary, r.summary)) || null;
}

function truncateReason(s) {
  return String(s).replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
}

// ─── Learned suppressions (R3) ──────────────────────────────────────────────

/** Security and logic findings are always reported, dismissed or not. */
function neverSuppressed(f, agent) {
  return LOGIC_CLASSES.includes(f.class) || SECURITY_AGENTS.includes(agent) || SECURITY_RE.test(String(f.summary || ''));
}

/** The content hash of the project file a `where` names, or null (no file, outside the project, unreadable). */
function fileSha(cwd, where) {
  const file = fileOf(where);
  if (!file || file.startsWith('code-fact:')) return null;
  const abs = path.resolve(cwd, file);
  const rel = path.relative(path.resolve(cwd), abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  try { return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'); } catch { return null; }
}

/**
 * Every learned suppression: a dismissed finding scoped to a file, of a kind that may
 * be suppressed. `active` while the file is as it was when dismissed; `promoted` once
 * the same judge dismissed the same signature in two phases (active ones only).
 */
function learnedSuppressions(cwd, fold) {
  const shas = new Map();
  const current = (where) => {
    const k = fileOf(where);
    if (!shas.has(k)) shas.set(k, fileSha(cwd, where));
    return shas.get(k);
  };
  const all = [...fold.findings.values()]
    .filter((f) => f.status === 'dismissed' && f.file_sha && !neverSuppressed(f, f.agent))
    .map((f) => ({ f, active: current(f.where) === f.file_sha }));
  return all.map((s) => {
    const phases = new Set(all.filter((o) => o.active && o.f.agent === s.f.agent && sameFinding(o.f, s.f)).map((o) => V.comparablePhase(o.f.phase)));
    return { ...s, scope: phases.size >= 2 ? 'promoted' : 'candidate' };
  });
}

/** The suppression that filters this judge's finding in this phase, or null. */
function suppressionFor(supps, agent, phase, f) {
  if (neverSuppressed(f, agent)) return null;
  const hits = supps.filter((s) => s.active && s.f.agent === agent && sameFinding(s.f, f)
    && (s.scope === 'promoted' || samePhase(s.f.phase, phase)));
  return hits.find((s) => samePhase(s.f.phase, phase)) || hits[0] || null;
}

/**
 * How stable a judge's findings are across its reports on one phase (V6): between
 * consecutive verdicts, how many ids appeared and how many disappeared. A judge whose
 * findings churn while the code does not change is not measuring the code.
 */
function findingsChurn(rows, phase, agent) {
  const seq = foldFindings(rows).verdicts.filter((v) => v.agent === agent && samePhase(v.phase, phase));
  let added = 0;
  let dropped = 0;
  let union = 0;
  for (let i = 1; i < seq.length; i++) {
    const a = new Set(seq[i - 1].finding_ids || []);
    const b = new Set(seq[i].finding_ids || []);
    for (const id of b) if (!a.has(id)) added++;
    for (const id of a) if (!b.has(id)) dropped++;
    union += new Set([...a, ...b]).size;
  }
  return { reports: seq.length, transitions: Math.max(0, seq.length - 1), added, dropped, rate: union ? Math.round(((added + dropped) / union) * 1000) / 1000 : 0 };
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

  let parsed = V.parseVerdictText(text, { agent: input.agent, phase });
  if (!parsed.ok) return { error: parsed.error, reason: parsed.reason };
  // A verification is read against the engine's test run (V2): a failed run is a code
  // fact that lowers the verifier's pass, as a failed test_gate already does (V9).
  if (parsed.verdict.agent === 'pan-verifier') {
    const facts = require('./test-gate.cjs').testRunFacts(cwd, phase);
    if (facts.length) parsed = V.parseVerdictText(text, { agent: input.agent, phase, facts });
  }
  const verdict = parsed.verdict;
  const agent = verdict.agent;
  const recordSig = V.recordSig(text);

  const { rows } = readLedger(cwd);
  const fold = foldFindings(rows);
  // `not_checked` (M23): what the judge could not run. A pass with entries here is a
  // pass over less than the whole phase, and the record says so.
  const notChecked = verdict.not_checked || [];
  // Two-key verdict (V9): when a code fact lowered the judge's word, the record keeps
  // both, and `verdict` is the lowered word the workflow branches on.
  const lowered = Array.isArray(parsed.lowered_by) && parsed.lowered_by.length
    ? { agent_verdict: verdict.agent_verdict, lowered_by: parsed.lowered_by } : {};
  const base = { contract: V.VERDICT_CONTRACT, agent, verdict: verdict.verdict, outcome: verdict.outcome, ...lowered, not_checked: notChecked, source_kind: parsed.source_kind, warnings: parsed.warnings };

  const dup = fold.verdicts.find((r) => r.record_sig === recordSig && r.agent === agent && samePhase(r.phase, phase));
  if (dup) {
    return { ...base, recorded: false, duplicate: true, verdict_id: dup.verdict_id, attempt: dup.attempt, phase, findings: (dup.finding_ids || []).length, new: 0, rematched: 0, resolved: 0, unaddressed: [], reopened: 0, suppressed: dup.suppressed || [], returned: (dup.returned_ids || []).length };
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
  const mine = [...fold.findings.values()].filter((e) => e.agent === agent && samePhase(e.phase, phase));
  const supps = learnedSuppressions(cwd, fold);
  const suppressed = [];
  const returned = [];
  let rematched = 0;
  for (const f of verdict.findings) {
    let id = V.findingId(phase, agent, f);
    if (!fold.findings.has(id)) {
      // A reworded report of an earlier finding keeps that finding's id (V6), so a
      // rewording is a re-report, not a fix plus a new finding.
      const earlier = mine.filter((e) => !ids.includes(e.id) && sameFinding(e, f)).sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1))[0];
      if (earlier) { id = earlier.id; rematched++; }
    }
    if (ids.includes(id)) continue; // the same finding twice in one report is one finding
    // A learned suppression (R3) filters it; a dismissed finding no suppression
    // covers any more comes back open.
    const existing = fold.findings.get(id);
    if (!existing || existing.status === 'dismissed') {
      const s = suppressionFor(supps, agent, phase, f);
      if (s) {
        suppressed.push({ id: s.f.id, scope: s.scope, summary: f.summary });
        continue;
      }
      if (existing) returned.push(id);
    }
    ids.push(id);
    if (!fold.findings.has(id)) {
      findingRows.push({ v: LEDGER_V, kind: 'finding', ts, id, verdict_id: verdictId, phase, milestone, agent, class: f.class, severity: f.severity, where: f.where, summary: f.summary });
    }
  }

  // Findings close only on evidence (V6). Silence is not evidence: an earlier open
  // finding the new verdict neither reports nor answers stays open, and the record
  // lists it as unaddressed. What closes one: the judge's `resolved` answer with its
  // evidence, or, for a code-fact finding, the fact passing.
  const resolveRows = [];
  const closing = new Set();
  const close = (f, reason) => {
    if (closing.has(f.id) || ids.includes(f.id) || f.status !== 'open') return;
    closing.add(f.id);
    resolveRows.push({ v: LEDGER_V, kind: 'disposition', ts, id: f.id, disposition: 'fixed', reason: truncateReason(reason), auto: true, verdict_id: verdictId });
  };
  let contradicted = 0;
  for (const r of verdict.resolutions || []) {
    const target = resolutionTarget(mine, r);
    if (!target) { parsed.warnings.push(`resolution_unmatched: ${r.id || r.summary}`); continue; }
    if (r.status === 'resolved') {
      if (ids.includes(target.id)) { contradicted++; continue; }
      close(target, `resolved by ${agent} at attempt ${attempt}: ${r.evidence}`);
    } else if (r.status === 'still_present' && !ids.includes(target.id)) {
      ids.push(target.id); // a re-report: reopens a fixed finding, keeps an open one open
    }
  }
  if (contradicted) parsed.warnings.push(`resolution_contradicted: ${contradicted} finding(s) answered resolved but reported again; they stay open`);
  for (const fact of parsed.facts_ok || []) {
    for (const f of mine) if (f.where === `code-fact:${fact}`) close(f, `${fact} passed at attempt ${attempt}`);
  }
  const reopened = ids.filter((id) => fold.findings.has(id) && fold.findings.get(id).status === 'fixed').length;
  const unaddressed = mine.filter((f) => f.status === 'open' && !ids.includes(f.id) && !closing.has(f.id)).map((f) => f.id);
  if (unaddressed.length) parsed.warnings.push(`open_findings_unaddressed: ${unaddressed.length} earlier finding(s) neither reported nor resolved; they stay open`);

  const bySeverity = countBy(verdict.findings, 'severity');
  const byClass = countBy(verdict.findings, 'class');
  let source = '(text)';
  if (input.source) {
    const rel = path.relative(path.resolve(cwd), path.resolve(cwd, input.source));
    source = rel && !rel.startsWith('..') && !path.isAbsolute(rel) ? toPosix(rel) : '(external file)';
  }
  newRows.push({
    v: LEDGER_V, kind: 'verdict', ts, verdict_id: verdictId, record_sig: recordSig, phase, milestone, agent,
    verdict: verdict.verdict, outcome: verdict.outcome, ...lowered, attempt, source, finding_ids: ids,
    ...(returned.length ? { returned_ids: returned } : {}),
    ...(suppressed.length ? { suppressed } : {}),
    by_severity: bySeverity, by_class: byClass, warnings: parsed.warnings,
    ...(notChecked.length ? { not_checked: notChecked } : {}),
    // A plan check is bound to the plans it checked (V7): exec-phase compares this
    // hash with the plans it is about to run.
    ...(agent === 'pan-plan-checker' ? { plans_sha: require('./verify-plan-set.cjs').plansShaFor(cwd, phase) } : {}),
  });
  appendRows(cwd, [...findingRows, ...newRows, ...resolveRows]);

  const category = { pass: 'verdict_passed', fail: 'verdict_failed', needs_human: 'verdict_needs_human' }[verdict.outcome];
  const serious = (bySeverity.critical || 0) + (bySeverity.high || 0) > 0;
  traceEvent(cwd, {
    type: verdict.outcome === 'fail' ? 'error' : 'decision',
    category,
    agent,
    phase,
    description: `${agent} ${verdict.verdict || verdict.outcome} on phase ${phase} (attempt ${attempt}, ${ids.length} finding${ids.length === 1 ? '' : 's'})`,
    impact: verdict.outcome === 'fail' ? (serious ? 'major' : 'minor') : 'minor',
    context: { agent, phase, verdict: verdict.verdict, attempt, findings: ids.length, by_severity: bySeverity, by_class: byClass, verdict_id: verdictId, not_checked: notChecked.map((n) => n.check) },
  });
  if (previous && previous.outcome === 'fail') {
    traceEvent(cwd, {
      type: 'correction',
      category: 'verdict_retry',
      agent,
      phase,
      description: `${agent} judged phase ${phase} again (attempt ${attempt}): ${previous.outcome} → ${verdict.outcome}, ${resolveRows.length} earlier finding(s) resolved, ${unaddressed.length} unaddressed`,
      impact: 'minor',
      context: { agent, phase, attempt, previous_outcome: previous.outcome, outcome: verdict.outcome, resolved: resolveRows.length, unaddressed: unaddressed.length, reopened, verdict_id: verdictId },
    });
  }

  return { ...base, recorded: true, duplicate: false, verdict_id: verdictId, attempt, phase, findings: ids.length, new: findingRows.length, rematched, resolved: resolveRows.length, unaddressed, reopened, suppressed, returned: returned.length, ledger: planningRel(FINDINGS_FILE) };
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
    // A dismissal remembers its file as it was (R3): it suppresses the finding only
    // until that file changes.
    const fsha = as === 'dismissed' ? fileSha(cwd, f.where) : null;
    out.push({ v: LEDGER_V, kind: 'disposition', ts, id, disposition: as, reason: reason || null, auto: false, ...(fsha ? { file_sha: fsha } : {}) });
    disposed.push(id);
  }
  appendRows(cwd, out);
  return { contract: V.VERDICT_CONTRACT, disposition: as, disposed, skipped };
}

/**
 * Milestone versions compare with or without the leading `v`: the ledger stores
 * `getMilestoneInfo`'s `v1.0`, while milestone-audit names its version `1.0` (its
 * report is `v{version}-milestone-audit.md`), so `--milestone 1.0` found no debt.
 */
const sameMilestone = (a, b) => String(a || '').trim().replace(/^v/i, '') === String(b || '').trim().replace(/^v/i, '');

/** Findings with their folded status, filtered. */
function listFindings(cwd, filters = {}) {
  const { rows, malformed } = readLedger(cwd);
  const fold = foldFindings(rows);
  let list = [...fold.findings.values()];
  if (filters.phase) list = list.filter((f) => samePhase(f.phase, filters.phase));
  if (filters.agent) list = list.filter((f) => f.agent === filters.agent);
  if (filters.status) list = list.filter((f) => f.status === filters.status);
  if (filters.class) list = list.filter((f) => f.class === filters.class);
  if (filters.milestone) list = list.filter((f) => sameMilestone(f.milestone, filters.milestone));
  const findings = list.map(publicFinding);
  return {
    contract: V.VERDICT_CONTRACT,
    findings,
    counts: { total: findings.length, by_status: countBy(findings, 'status'), by_class: countBy(findings, 'class'), by_severity: countBy(findings, 'severity') },
    verdicts: fold.verdicts.length,
    ...(filters.phase && filters.agent ? { churn: findingsChurn(rows, filters.phase, filters.agent) } : {}),
    malformed_rows: malformed,
  };
}

/** Learned suppressions (R3), each with its scope and whether its file is unchanged. */
function listSuppressions(cwd, filters = {}) {
  const fold = foldFindings(readLedger(cwd).rows);
  let list = learnedSuppressions(cwd, fold);
  if (filters.agent) list = list.filter((s) => s.f.agent === filters.agent);
  if (filters.phase) list = list.filter((s) => s.scope === 'promoted' || samePhase(s.f.phase, filters.phase));
  const suppressions = list.map((s) => ({
    id: s.f.id, agent: s.f.agent, phase: s.f.phase, class: s.f.class, file: fileOf(s.f.where), summary: s.f.summary,
    reason: s.f.reason, scope: s.scope, active: s.active,
  }));
  return { contract: V.VERDICT_CONTRACT, suppressions, active: suppressions.filter((s) => s.active).length };
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
    if (milestone && !sameMilestone(f.milestone, milestone)) continue;
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

function cmdFindingsSuppressions(cwd, opts, raw) {
  const r = listSuppressions(cwd, opts);
  output(r, raw, String(r.active));
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
  listSuppressions,
  findingsDebt,
  findingsChurn,
  sameFinding,
  findingIdsIn,
  cmdFindingsRecord,
  cmdFindingsDispose,
  cmdFindingsList,
  cmdFindingsDebt,
  cmdFindingsSuppressions,
};
