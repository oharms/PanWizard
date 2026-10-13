'use strict';

/**
 * Findings ledger (ADR-0047 D5). Append-only JSON Lines at harness/ledger.jsonl,
 * tracked in git: it is the finding HISTORY the promotion rule depends on.
 *
 * A finding is keyed by a signature over what failed, not when: the same broken
 * contract seen in three runs is one finding with three run ids. The pure parts
 * (signature, merge, promotion) are exported for the both-direction tests.
 */

const crypto = require('crypto');
const fs = require('fs');
const { wilson } = require('./stats.cjs');

/** Strip the volatile parts (paths under the run dir, run ids, numbers that are counters) before hashing. */
function normaliseDetail(detail) {
  return String(detail || '')
    .replace(/[A-Za-z]:[\\/][^\s'"]+/g, '<path>')
    .replace(/\/[^\s'"]+/g, '<path>')
    // Mixed case: the suffix comes from mkdtempSync, whose alphabet is [A-Za-z0-9].
    .replace(/run-\d{8}-\d{6}-[A-Za-z0-9]+/g, '<run>')
    .replace(/\d+/g, '<n>')
    .trim();
}

function signature(scenarioId, stepIndex, expect, detail) {
  return crypto.createHash('sha1')
    .update([scenarioId, String(stepIndex), expect, normaliseDetail(detail)].join('\0'))
    .digest('hex')
    .slice(0, 16);
}

function readLedger(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function writeLedger(file, entries) {
  fs.writeFileSync(file, entries.map(e => JSON.stringify(e)).join('\n') + (entries.length ? '\n' : ''));
}

/**
 * Merge one run's failures into the ledger entries (pure). `failures` are
 * { scenario, tier, step, expect, failure, why }; `passedSteps` are { scenario, step }
 * that passed this run, used to resolve earlier findings on the same step.
 */
function mergeRun(entries, { runId, build, now, failures, passedSteps }) {
  const byKey = new Map(entries.map(e => [e.signature, e]));
  for (const f of failures) {
    const sig = signature(f.scenario, f.step, f.expect, f.failure);
    const existing = byKey.get(sig);
    if (existing) {
      existing.last_seen = now;
      existing.runs = [...new Set([...(existing.runs || []), runId])];
      existing.builds = [...new Set([...(existing.builds || []), build])];
      existing.resolved_at = null;
      existing.detail = f.failure;
      existing.fail_count = (existing.fail_count || (existing.runs || []).length - 1) + 1;
    } else {
      byKey.set(sig, {
        signature: sig, scenario: f.scenario, tier: f.tier, step: f.step, expect: f.expect,
        detail: f.failure, why: f.why || null,
        first_seen: now, last_seen: now, runs: [runId], builds: [build], resolved_at: null,
        fail_count: 1, pass_count: 0,
      });
    }
  }
  // A step that passed THIS run resolves an open finding from an EARLIER run on
  // the same step. It never resolves a finding this same run produced: a step
  // that failed on rep 5 and passed on reps 1–4 is a flake to surface, not a
  // finding to close — the first tier-2 run (2026-09-10) hid exactly that.
  const passed = new Set((passedSteps || []).map(p => `${p.scenario}#${p.step}`));
  // Every pass of an open finding's step counts toward its rate (H3), this run included:
  // a step that fails one rep in five is a 20% finding, not a 100% one.
  const passCounts = new Map();
  for (const p of passedSteps || []) passCounts.set(`${p.scenario}#${p.step}`, (passCounts.get(`${p.scenario}#${p.step}`) || 0) + 1);
  for (const e of byKey.values()) {
    if (e.resolved_at) continue;
    const n = passCounts.get(`${e.scenario}#${e.step}`) || 0;
    if (n) e.pass_count = (e.pass_count || 0) + n;
  }
  for (const e of byKey.values()) {
    if (e.resolved_at || !passed.has(`${e.scenario}#${e.step}`)) continue;
    if ((e.runs || []).includes(runId)) continue;
    e.resolved_at = now;
  }
  return [...byKey.values()];
}

// A model-tier finding promotes when its failure rate is at least this, at the 95%
// lower bound of its Wilson interval (H3). Below it, with passes and failures on
// record, the finding is flaky: real, but not yet shown to be more than noise.
const PROMOTE_RATE = 0.2;

/**
 * What a ledger entry is (H3): 'resolved', 'promotable', 'flaky' or 'watch'.
 * Model-free (tier 0) findings promote at once: tier 0 is deterministic. A model-tier
 * finding promotes on its interval; an entry written before the counts existed falls
 * back to the old two-run rule.
 */
function classify(entry) {
  if (entry.resolved_at) return 'resolved';
  if (entry.tier === 0) return 'promotable';
  if (entry.fail_count === undefined) return (entry.runs || []).length >= 2 ? 'promotable' : 'watch';
  const fails = entry.fail_count;
  const n = fails + (entry.pass_count || 0);
  const w = wilson(fails, n);
  // At least two failures as well: one failure alone has a lower bound of 0.21 on n = 1.
  if (fails >= 2 && w.lower >= PROMOTE_RATE) return 'promotable';
  return entry.pass_count > 0 ? 'flaky' : 'watch';
}

/** Promotion rule: classify() says promotable. */
function isPromotable(entry) {
  return classify(entry) === 'promotable';
}

module.exports = { signature, normaliseDetail, readLedger, writeLedger, mergeRun, isPromotable, classify, PROMOTE_RATE };
