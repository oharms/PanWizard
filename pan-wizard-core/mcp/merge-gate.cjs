'use strict';

/**
 * PAN-Z M2 — the deterministic, model-proof merge gate.
 *
 * PAN's non-negotiable rule: nothing reaches a protected branch without a human.
 * Enforcing this in agent PROSE is not enough (under ZCode Full Access a raw
 * `git push` sidesteps any advisory check), so the gate lives here, in code, on TWO
 * locks:
 *
 *   Lock 1 (this module): `confirmMerge` refuses unless CI green + verify PASS + a
 *     HUMAN-ORIGIN approval token all hold. The token is a PER-REQUEST NONCE returned
 *     by `requestMerge`; the operator, after reviewing, sets PAN_MERGE_APPROVAL to it
 *     in the MCP server's environment (which the agent's tools cannot write). Because
 *     the token is fresh per request, it can't be replayed against a later re-request;
 *     approval is bound to the EXACT branch that was staged, and merging uses the
 *     recorded branch, not the caller's argument. The token is consumed on success.
 *   Lock 2 (out of process, documented): server-side branch protection — the truly
 *     non-bypassable anchor. See docs/specs/pan_zcode_mcp_bridge_featureai.md.
 *
 * NEVER exposes force-push / reset / rebase / history-rewrite. Recovery is revert-only.
 * Git execution is injected so the decision logic is unit-testable.
 */

const fs = require('fs');
const path = require('path');
const store = require('../bin/lib/store.cjs');
const { withFileLock } = require('../bin/lib/lock.cjs');
const crypto = require('crypto');

const APPROVALS_SUBPATH = ['.planning', 'orchestration', 'approvals'];
const APPROVAL_ENV = 'PAN_MERGE_APPROVAL';
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;

function approvalsDir(cwd) { return path.join(cwd, ...APPROVALS_SUBPATH); }

/** Filesystem-safe slug used only to LOCATE a branch's request file (not as the token). */
function slugify(branch) {
  return String(branch).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) || 'merge';
}

function validateBranch(branch) {
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) {
    throw new Error(`Invalid branch: must match ${BRANCH_RE}`);
  }
  return branch;
}

/** orchestration.approval_ttl_hours: hours a merge request stays approvable (default 72; 0 = never expires). */
function approvalTtlHours(cwd) {
  const o = store.rawConfig(cwd).orchestration || {};
  if (o.approval_ttl_hours === undefined) return 72;
  const v = Number(o.approval_ttl_hours);
  return Number.isFinite(v) && v > 0 ? v : null;
}

function recordPath(cwd, branch) { return path.join(approvalsDir(cwd), `${slugify(branch)}.json`); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, obj, opts = {}) { return store.updateRecord(p, () => obj, { transition: 'merge.request', force: opts.force }); }

/**
 * Stage a merge request. Mints a fresh per-request approval token (nonce), records the
 * exact branch + the (caller-attested) CI/verify flags, marks it awaiting_approval, and
 * returns the record. Does NOT merge. The operator sets PAN_MERGE_APPROVAL to
 * `record.approval_token` after reviewing. ci_green is agent-attested advisory context.
 * verify_pass is too, unless the request names a `phase`: then it is the phase gate's
 * verdict (program V1), computed here, and the caller's flag is ignored. The token is
 * the sole unfakeable anchor either way.
 */
function requestMerge(cwd, opts = {}) {
  const branch = validateBranch(opts.branch);
  let verifyPass = !!opts.verify_pass;
  let gate = null;
  if (opts.phase != null && String(opts.phase).trim() !== '') {
    const g = require('../bin/lib/phase-gate.cjs').phaseGate(cwd, String(opts.phase).trim());
    gate = g.error ? { phase: String(opts.phase), error: g.error } : { phase: g.phase, ok: g.ok, reasons: g.reasons.map((r) => r.code) };
    verifyPass = !g.error && g.ok;
  }
  const record = {
    id: slugify(branch),
    branch,
    approval_token: crypto.randomBytes(9).toString('hex'),
    ci_green: !!opts.ci_green,
    verify_pass: verifyPass,
    verify_source: gate ? 'phase_gate' : 'caller',
    ...(gate ? { gate } : {}),
    status: 'awaiting_approval',
    requested_at: opts.now || new Date().toISOString(),
  };
  // An approval waits orchestration.approval_ttl_hours (default 72), then expires:
  // a token found days later in an environment cannot merge what was reviewed then.
  const ttl = approvalTtlHours(cwd);
  if (ttl) record.expires_at = new Date(Date.parse(record.requested_at) + ttl * 3600000).toISOString();
  // Checked against merge.request: a pending or merged request may be staged again.
  const w = writeJson(recordPath(cwd, branch), record, { force: opts.force });
  if (w.error) return w;
  return record;
}

/**
 * Evaluate whether a merge may proceed — pure decision logic, never merges.
 * The only human signal is env[PAN_MERGE_APPROVAL] === the request's fresh token; any
 * agent-supplied approval in `opts` is deliberately not consulted. Approval is bound to
 * the exact staged branch and refused once the request has been consumed.
 * @returns {{allowed:boolean, reasons:string[], branch:string, id:string}}
 */
function evaluateMerge(cwd, opts = {}, env = process.env) {
  const branch = validateBranch(opts.branch);
  const record = readJson(recordPath(cwd, branch));
  const reasons = [];
  if (!record) reasons.push('no_merge_request');
  if (record && record.branch !== branch) reasons.push('branch_mismatch');
  if (record && record.status !== 'awaiting_approval') reasons.push('already_consumed');
  if (record && record.status === 'awaiting_approval' && record.expires_at && Date.parse(record.expires_at) <= (opts.nowMs || Date.now())) reasons.push('approval_expired');
  if (record && !record.ci_green) reasons.push('ci_not_green');
  if (record && !record.verify_pass) reasons.push('verify_not_passed');
  const token = env[APPROVAL_ENV];
  if (!record || !token || token !== record.approval_token) reasons.push('no_human_approval');
  return { allowed: reasons.length === 0, reasons, branch: record ? record.branch : branch, id: record ? record.id : slugify(branch) };
}

/**
 * Confirm + perform the squash-merge, but only if evaluateMerge allows it. Merges the
 * RECORDED (approved) branch — never the caller's argument. Git is injected:
 * gitImpl(argvArray)->{ok,stdout,stderr}. No force/reset/rebase/push verb is ever issued.
 * On success the request is marked consumed and the human token is cleared from `env`, so
 * it cannot be replayed without a fresh human approval.
 */
function confirmMerge(cwd, opts = {}, env = process.env, gitImpl = null) {
  // Evaluate, merge and consume under the record's lock: a second confirm waits,
  // then reads `merged` and is refused already_consumed instead of merging twice.
  let p;
  try { p = recordPath(cwd, validateBranch(opts.branch)); } catch { return confirmMergeLocked(cwd, opts, env, gitImpl); }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const held = withFileLock(p, () => confirmMergeLocked(cwd, opts, env, gitImpl), { strict: true });
  if (held.timedOut) return { merged: false, reasons: ['lock_timeout'], branch: opts.branch, id: slugify(opts.branch) };
  return held.result;
}

function confirmMergeLocked(cwd, opts, env, gitImpl) {
  const verdict = evaluateMerge(cwd, opts, env);
  if (!verdict.allowed) return { merged: false, reasons: verdict.reasons, branch: verdict.branch, id: verdict.id };
  if (typeof gitImpl !== 'function') return { merged: false, reasons: ['no_git_executor'], branch: verdict.branch, id: verdict.id };

  const approvedBranch = verdict.branch; // from the record, not opts
  const squash = gitImpl(['merge', '--squash', approvedBranch]);
  if (!squash.ok) return { merged: false, reasons: ['git_merge_failed'], detail: squash.stderr, branch: approvedBranch, id: verdict.id };
  const commit = gitImpl(['commit', '--no-verify', '-m', `merge: ${approvedBranch} (human-approved)`]);
  if (!commit.ok) return { merged: false, reasons: ['git_commit_failed'], detail: commit.stderr, branch: approvedBranch, id: verdict.id };

  // Consume: mark the request merged AND clear the one-time token so it can't be reused.
  const p = recordPath(cwd, approvedBranch);
  const rec = readJson(p) || { id: verdict.id, branch: approvedBranch };
  rec.status = 'merged';
  rec.approved_at = new Date().toISOString();
  writeJson(p, rec);
  if (env && Object.prototype.hasOwnProperty.call(env, APPROVAL_ENV)) delete env[APPROVAL_ENV];

  return { merged: true, branch: approvedBranch, id: verdict.id };
}

module.exports = {
  requestMerge, evaluateMerge, confirmMerge, approvalTtlHours,
  slugify, validateBranch, approvalsDir,
  APPROVAL_ENV, BRANCH_RE,
};
