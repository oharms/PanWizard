'use strict';
/**
 * Review lenses and k-pass voting (program R2).
 *
 * With `workflow.review_mode: lenses`, exec-phase runs the reviewer once per lens
 * (LENSES) instead of once, and `review vote` merges the passes in code. A finding
 * survives only when a quorum of passes reported it (the validator: a finding one
 * pass alone raised is a likely false alarm), at the highest severity any pass gave
 * it. The verdict is recomputed from what survived, never taken from one pass. The
 * merged report carries a normal `pan-verdict` block, so `findings record` reads it
 * like any single review.
 *
 * Opt-in until its evidence gate decides: a paired corpus run must show lenses
 * catching more without raising false alarms (docs/specs/product-excellence-superplan.md).
 */
const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');
const V = require('./verdict.cjs');
const { sameFinding } = require('./findings.cjs');

const LENSES = Object.freeze(['correctness', 'security', 'maintainability']);
const SEVERITY_RANK = Object.fromEntries(V.SEVERITIES.map((s, i) => [s, V.SEVERITIES.length - i]));
const FENCE = '```';

/**
 * Merge reviewer passes.
 * @param {string[]} texts - each pass's full report (with its pan-verdict block)
 * @param {{phase?: string, quorum?: number}} [opts]
 * @returns {{ok:true, passes, quorum, verdict, dropped, text}|{ok:false, error, reason}}
 */
function voteVerdicts(texts, opts = {}) {
  const parsed = [];
  for (let i = 0; i < texts.length; i++) {
    const p = V.parseVerdictText(String(texts[i] || ''), { agent: 'pan-reviewer', phase: opts.phase });
    if (!p.ok) return { ok: false, error: 'unreadable_pass', reason: `pass ${i + 1} has no readable pan-verdict block (${p.error})` };
    parsed.push(p.verdict);
  }
  if (parsed.length === 0) return { ok: false, error: 'no_passes', reason: 'review vote needs at least one pass' };
  const quorum = Number.isInteger(opts.quorum) && opts.quorum > 0 ? opts.quorum : Math.ceil(parsed.length / 2);

  // Cluster findings across passes; a pass counts once per cluster.
  const clusters = [];
  parsed.forEach((v, pass) => {
    for (const f of v.findings) {
      const c = clusters.find((x) => sameFinding(x.finding, f));
      if (c) {
        c.passes.add(pass);
        if ((SEVERITY_RANK[f.severity] || 0) > (SEVERITY_RANK[c.finding.severity] || 0)) c.finding = { ...c.finding, severity: f.severity };
      } else {
        clusters.push({ finding: { ...f }, passes: new Set([pass]) });
      }
    }
  });
  const kept = clusters.filter((c) => c.passes.size >= quorum).map((c) => ({ ...c.finding, votes: c.passes.size }));
  const dropped = clusters.filter((c) => c.passes.size < quorum).map((c) => ({ ...c.finding, votes: c.passes.size }));

  const counted = kept.filter((f) => !f.pre_existing);
  const errors = counted.some((f) => f.severity === 'critical' || f.severity === 'high');
  const warnings = counted.some((f) => f.severity === 'medium' || f.severity === 'low');
  const verdictWord = errors ? 'NEEDS_FIXES' : (warnings ? 'PASS_WITH_WARNINGS' : 'PASS');

  const declined = [];
  for (const v of parsed) for (const d of v.declined || []) if (!declined.some((x) => x.behaviour === d.behaviour)) declined.push(d);
  const notChecked = [];
  for (const v of parsed) for (const n of v.not_checked || []) if (!notChecked.some((x) => x.check === n.check)) notChecked.push(n);

  const verdict = {
    contract: V.VERDICT_CONTRACT, agent: 'pan-reviewer', phase: opts.phase || parsed[0].phase || null,
    verdict: verdictWord, outcome: errors ? 'fail' : 'pass',
    findings: kept.map(({ votes, ...f }) => ({ ...f, votes })),
    ...(declined.length ? { declined } : {}),
    ...(notChecked.length ? { not_checked: notChecked } : {}),
  };
  const lines = [
    `## Code Review — Phase ${verdict.phase || '?'} (${parsed.length} passes, quorum ${quorum})`,
    '',
    `### Verdict`,
    verdictWord,
    '',
    `Kept ${kept.length} finding(s) at least ${quorum} pass(es) reported; dropped ${dropped.length} only fewer passes raised.`,
    ...kept.map((f) => `- ${f.severity.toUpperCase()} ${f.where || '(no location)'}: ${f.summary} (${f.votes}/${parsed.length})`),
    ...(dropped.length ? ['', 'Dropped (below quorum):', ...dropped.map((f) => `- ${f.severity} ${f.where || '(no location)'}: ${f.summary} (${f.votes}/${parsed.length})`)] : []),
    '',
    `${FENCE}pan-verdict`,
    JSON.stringify(verdict),
    FENCE,
    '',
  ];
  return { ok: true, passes: parsed.length, quorum, verdict, dropped, text: lines.join('\n') };
}

function cmdReviewVote(cwd, opts, raw) {
  const files = opts.files || [];
  if (!files.length) error('Usage: review vote [--phase N] [--quorum K] [--out <file>] <pass-file>...');
  const texts = files.map((f) => {
    try { return fs.readFileSync(path.isAbsolute(f) ? f : path.join(cwd, f), 'utf8'); } catch { return ''; }
  });
  const r = voteVerdicts(texts, { phase: opts.phase, quorum: opts.quorum ? Number(opts.quorum) : undefined });
  if (!r.ok) { output(r, raw, 'error', 1); return; }
  if (opts.out) fs.writeFileSync(path.isAbsolute(opts.out) ? opts.out : path.join(cwd, opts.out), r.text);
  output({ ok: true, passes: r.passes, quorum: r.quorum, kept: r.verdict.findings.length, dropped: r.dropped.length, verdict: r.verdict.verdict, out: opts.out || null }, raw, r.verdict.verdict);
}

module.exports = { LENSES, voteVerdicts, cmdReviewVote };
