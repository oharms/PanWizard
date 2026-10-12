'use strict';
/**
 * The phase gate (program V1): may this phase be marked complete?
 *
 * Every guarantee at the end of PAN's loop used to be a sentence in a workflow:
 * "do not advance unless the verification passed", "reconcile before advancing".
 * The model skipped one (exec-phase's `--no-transition` path never ran reconcile at
 * all), and `phase complete` marked the phase done regardless. The gate puts those
 * rules in code, in one function every caller uses: `phase complete`, the native
 * exec-waves script, and the MCP merge request.
 *
 * Refusal reasons, one code per class:
 *   no_plans · missing_summary · no_verification · verification_unreadable ·
 *   verification_failed (V9 lowering included) · human_needed_unapproved ·
 *   verification_stale · reconcile_contradiction · test_failed · open_findings ·
 *   stubs_found · integrity_violation
 *
 * What the gate could not check is listed in `not_checked`, never refused on:
 * a skipped test gate, an unknown freshness, no git, no plan commits, the verifier
 * switched off. `workflow.phase_gate` is `warn` (default: report and proceed) or
 * `enforce` (refuse unless `--force --reason`, which records a decision).
 */
const fs = require('fs');
const path = require('path');
const { findPhaseInternal, safeReadFile, loadConfig, output, error } = require('./core.cjs');
const { isVerificationFile } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

const MODES = Object.freeze(['warn', 'enforce']);
const SERIOUS = new Set(['critical', 'high']);

/** `workflow.phase_gate` from config.json: `enforce` or (anything else) `warn`. */
function gateMode(cwd) {
  let cfg = null;
  try { cfg = JSON.parse(fs.readFileSync(planningPath(cwd, 'config.json'), 'utf-8')); } catch { /* defaults */ }
  const v = cfg && cfg.workflow && cfg.workflow.phase_gate;
  return MODES.includes(v) ? v : 'warn';
}

/**
 * @param {string} cwd
 * @param {string|number} phase
 * @param {{mode?: 'warn'|'enforce'}} [opts]
 * @returns {{phase, mode, ok, reasons: Array<{code, detail}>, facts: Object, not_checked: Array<{check, reason}>}|{error, reason}}
 */
function phaseGate(cwd, phase, opts = {}) {
  const info = findPhaseInternal(cwd, phase);
  if (!info || !info.found) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const V = require('./verdict.cjs');
  const F = require('./findings.cjs');
  const { reconcilePhase, verificationFreshness, scanStubs } = require('./verify.cjs');
  const { committedFiles } = require('./verify-scope.cjs');
  const { checkTestIntegrity } = require('./verify-integrity.cjs');

  const mode = MODES.includes(opts.mode) ? opts.mode : gateMode(cwd);
  const reasons = [];
  const notChecked = [];
  const facts = {};
  const refuse = (code, detail, extra = {}) => reasons.push({ code, detail, ...extra });
  const skip = (check, reason) => notChecked.push({ check, reason });
  const phaseNumber = info.phase_number || String(phase);
  const dir = path.join(cwd, info.directory);

  // 1. Every plan has a summary.
  const plans = info.plans || [];
  const incomplete = info.incomplete_plans || [];
  facts.plans = `${plans.length - incomplete.length}/${plans.length}`;
  if (!plans.length) refuse('no_plans', 'the phase has no plans');
  else if (incomplete.length) refuse('missing_summary', `${incomplete.length} plan(s) have no summary: ${incomplete.join(', ')}`, { plans: incomplete });

  // 2. A passing verification (with code facts applied, V9).
  let names = [];
  try { names = fs.readdirSync(dir); } catch { /* unreadable reads as empty */ }
  const verFile = names.filter(isVerificationFile).sort().pop();
  const verifierOn = loadConfig(cwd).verifier !== false;
  if (!verFile) {
    if (verifierOn) refuse('no_verification', 'the phase has no verification; run /pan:verify-phase');
    else skip('verification', 'workflow.verifier is off');
  } else {
    const parsed = V.parseVerdictText(safeReadFile(path.join(dir, verFile)) || '', { agent: 'pan-verifier', phase: phaseNumber });
    if (!parsed.ok) {
      refuse('verification_unreadable', `${verFile}: ${parsed.reason}`);
    } else {
      const v = parsed.verdict;
      const fm = V.verdictFromVerificationFrontmatter(safeReadFile(path.join(dir, verFile)) || '') || {};
      facts.verification = v.verdict;
      facts.test_gate = fm.test_gate || null;
      if (parsed.lowered_by && parsed.lowered_by.length) facts.lowered_by = parsed.lowered_by;
      if (fm.test_gate === 'failed') refuse('test_failed', 'the verification records test_gate: failed');
      else if (fm.test_gate === 'skipped') skip('tests', 'the test gate was skipped');
      else if (!fm.test_gate) skip('tests', 'the verification does not record its test gate');
      if (v.outcome === 'fail') {
        refuse('verification_failed', `the verification is ${v.verdict}${v.agent_verdict ? ` (the verifier wrote ${v.agent_verdict})` : ''}`);
      } else if (v.outcome === 'needs_human') {
        const human = F.listFindings(cwd, { phase: phaseNumber, agent: 'pan-verifier', class: 'human' }).findings;
        const unapproved = human.filter((f) => f.status !== 'decision');
        if (unapproved.length || !human.length) {
          refuse('human_needed_unapproved', `${unapproved.length || 'the'} human verification item(s) have no recorded approval; record it with \`findings dispose <id> --as decision --reason "<what was checked>"\``, { ids: unapproved.map((f) => f.id) });
        }
      }
    }
  }

  // 3. The verification still describes the code.
  if (verFile) {
    const fresh = verificationFreshness(cwd, phaseNumber, info);
    facts.freshness = fresh.state;
    if (fresh.state === 'stale') refuse('verification_stale', `files changed since the verified commit: ${(fresh.changed_since || []).slice(0, 5).join(', ')}`, { changed_since: fresh.changed_since });
    else if (fresh.state === 'unknown') skip('freshness', fresh.reason || 'unknown');
  }

  // 4. The written verdict agrees with the mechanical checks.
  if (verFile) {
    const rec = reconcilePhase(cwd, phaseNumber);
    facts.reconciled = rec.reconciled;
    if (!rec.reconciled) refuse('reconcile_contradiction', rec.contradictions.join('; '), { contradictions: rec.contradictions });
  }

  // 5. No critical or high finding left open without a disposition.
  const open = F.listFindings(cwd, { phase: phaseNumber, status: 'open' }).findings
    .filter((f) => SERIOUS.has(f.severity) && f.class !== 'human');
  facts.open_serious_findings = open.length;
  if (open.length) refuse('open_findings', `${open.length} critical/high finding(s) are open: dispose each (\`findings dispose <id> --as fixed|deferred|dismissed|decision --reason "…"\`) or fix it`, { ids: open.map((f) => f.id) });

  // 6. No stub in the files the phase committed.
  const committed = committedFiles(cwd, phaseNumber);
  if (!committed.git) {
    skip('stubs', 'git is unavailable');
  } else {
    const files = [...committed.files].filter((f) => fs.existsSync(path.join(cwd, f)));
    const stubs = scanStubs(cwd, { files });
    facts.stubs_blocking = stubs.blocking;
    if (stubs.blocking) refuse('stubs_found', `${stubs.blocking} stub marker(s) in committed files: ${stubs.findings.filter((s) => s.severity === 'high').slice(0, 3).map((s) => `${s.file}:${s.line}`).join(', ')}`);
  }

  // 7. The phase did not weaken its own tests.
  const integrity = checkTestIntegrity(cwd, phaseNumber);
  if (integrity.error || !integrity.checked) {
    skip('test_integrity', integrity.reason || integrity.error);
  } else {
    facts.test_integrity = integrity.ok ? 'clean' : 'violated';
    if (!integrity.ok) refuse('integrity_violation', integrity.violations.slice(0, 3).map((x) => `${x.code} ${x.file}`).join('; '), { violations: integrity.violations });
  }

  return { phase: phaseNumber, mode, ok: reasons.length === 0, reasons, facts, not_checked: notChecked };
}

/**
 * `--force --reason`: complete past the gate, on the record. Every open finding the
 * gate counted gets a `decision` disposition with the reason, and the trace logs it.
 */
function recordGateOverride(cwd, gate, reason) {
  const F = require('./findings.cjs');
  const ids = [];
  for (const r of gate.reasons) for (const id of r.ids || []) if (!ids.includes(id)) ids.push(id);
  const disposed = ids.length ? F.disposeFindings(cwd, { ids, as: 'decision', reason: `phase completed past the gate: ${reason}` }) : { disposed: [] };
  try {
    require('./optimize.cjs').logTraceEvent(cwd, {
      type: 'decision', category: 'phase_gate_forced', agent: 'orchestrator', phase: gate.phase,
      description: `phase ${gate.phase} completed past the gate (${gate.reasons.map((r) => r.code).join(', ')}): ${reason}`,
      impact: 'major', context: { reasons: gate.reasons.map((r) => r.code), reason },
    });
  } catch { /* telemetry is best effort */ }
  return { reason, refused_by: gate.reasons.map((r) => r.code), disposed: disposed.disposed || [] };
}

function cmdPhaseGate(cwd, phase, raw, opts = {}) {
  if (!phase) error('Usage: phase gate <N> [--mode warn|enforce]');
  const r = phaseGate(cwd, phase, opts);
  if (r.error) { output(r, raw); return; }
  output(r, raw, r.ok ? 'pass' : 'refuse', r.ok ? 0 : 1);
}

module.exports = { phaseGate, recordGateOverride, gateMode, cmdPhaseGate, MODES };
