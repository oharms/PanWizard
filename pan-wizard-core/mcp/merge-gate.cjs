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

function recordPath(cwd, branch) { return path.join(approvalsDir(cwd), `${slugify(branch)}.json`); }
function readJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8'); }

/**
 * Stage a merge request. Mints a fresh per-request approval token (nonce), records the
 * exact branch + the (caller-attested) CI/verify flags, marks it awaiting_approval, and
 * returns the record. Does NOT merge. The operator sets PAN_MERGE_APPROVAL to
 * `record.approval_token` after reviewing. (ci_green/verify_pass are agent-attested
 * advisory context for the human's decision; the token is the sole unfakeable anchor.)
 */
function requestMerge(cwd, opts = {}) {
  const branch = validateBranch(opts.branch);
  const record = {
    id: slugify(branch),
    branch,
    approval_token: crypto.randomBytes(9).toString('hex'),
    ci_green: !!opts.ci_green,
    verify_pass: !!opts.verify_pass,
    status: 'awaiting_approval',
    requested_at: opts.now || null,
  };
  writeJson(recordPath(cwd, branch), record);
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
  writeJson(p, rec);
  if (env && Object.prototype.hasOwnProperty.call(env, APPROVAL_ENV)) delete env[APPROVAL_ENV];

  return { merged: true, branch: approvedBranch, id: verdict.id };
}

module.exports = {
  requestMerge, evaluateMerge, confirmMerge,
  slugify, validateBranch, approvalsDir,
  APPROVAL_ENV, BRANCH_RE,
};
