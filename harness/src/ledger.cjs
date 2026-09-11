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
    } else {
      byKey.set(sig, {
        signature: sig, scenario: f.scenario, tier: f.tier, step: f.step, expect: f.expect,
        detail: f.failure, why: f.why || null,
        first_seen: now, last_seen: now, runs: [runId], builds: [build], resolved_at: null,
      });
    }
  }
  // A step that passed THIS run resolves an open finding from an EARLIER run on
  // the same step. It never resolves a finding this same run produced: a step
  // that failed on rep 5 and passed on reps 1–4 is a flake to surface, not a
  // finding to close — the first tier-2 run (2026-09-10) hid exactly that.
  const passed = new Set((passedSteps || []).map(p => `${p.scenario}#${p.step}`));
  for (const e of byKey.values()) {
    if (e.resolved_at || !passed.has(`${e.scenario}#${e.step}`)) continue;
    if ((e.runs || []).includes(runId)) continue;
    e.resolved_at = now;
  }
  return [...byKey.values()];
}

/** Promotion rule: model-free findings promote at once; model-tier findings need two runs. */
function isPromotable(entry) {
  if (entry.resolved_at) return false;
  return entry.tier === 0 || (entry.runs || []).length >= 2;
}

module.exports = { signature, normaliseDetail, readLedger, writeLedger, mergeRun, isPromotable };
