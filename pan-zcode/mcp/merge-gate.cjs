'use strict';

/**
 * PAN-Z M2 — the deterministic, model-proof merge gate.
 *
 * PAN's non-negotiable rule: nothing reaches a protected branch without a human.
 * The 38-agent review found that enforcing this in agent PROSE is not enough — under
 * ZCode Full Access a raw `git push` sidesteps any advisory check. So the gate lives
 * here, in deterministic code, and rests on TWO locks:
 *
 *   Lock 1 (this module): `confirmMerge` refuses unless (CI green + verify PASS + a
 *     HUMAN-ORIGIN approval token) all hold. The token comes ONLY from the process
 *     environment (PAN_MERGE_APPROVAL), which the agent's MCP tools never set, and it
 *     must equal the specific request id — a stale token can't approve a new merge.
 *     Any approval value the *agent* supplies in the call is IGNORED by design.
 *   Lock 2 (out of process, documented, not code): server-side branch protection —
 *     the truly non-bypassable anchor. See docs/specs/pan_zcode_mcp_bridge_featureai.md.
 *
 * This module NEVER exposes force-push / reset / rebase / history-rewrite. Recovery is
 * revert-only. Git execution is injected so the decision logic is unit-testable.
 */

const fs = require('fs');
const path = require('path');

const APPROVALS_SUBPATH = ['.planning', 'orchestration', 'approvals'];
const APPROVAL_ENV = 'PAN_MERGE_APPROVAL';
const BRANCH_RE = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,120}$/;

function approvalsDir(cwd) { return path.join(cwd, ...APPROVALS_SUBPATH); }

/** Deterministic, filesystem-safe id derived from a branch name. */
function deriveId(branch) {
  return String(branch).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 80) || 'merge';
}

function validateBranch(branch) {
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch)) {
    throw new Error(`Invalid branch: must match ${BRANCH_RE}`);
  }
  return branch;
}

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * Stage a merge request. Records the branch and the (caller-attested) CI / verify
 * state and marks it awaiting_approval. Does NOT merge. Returns the pending record.
 */
function requestMerge(cwd, opts = {}) {
  const branch = validateBranch(opts.branch);
  const id = deriveId(branch);
  const record = {
    id,
    branch,
    ci_green: !!opts.ci_green,
    verify_pass: !!opts.verify_pass,
    status: 'awaiting_approval',
    requested_at: opts.now || null,
  };
  writeJson(path.join(approvalsDir(cwd), `${id}.json`), record);
  return record;
}

/**
 * Evaluate whether a merge may proceed — pure decision logic, never merges.
 * Human approval is ONLY the env token matching the request id; any agent-supplied
 * approval in `opts` is deliberately not consulted.
 * @returns {{allowed:boolean, reasons:string[], branch:string, id:string}}
 */
function evaluateMerge(cwd, opts = {}, env = process.env) {
  const branch = validateBranch(opts.branch);
  const id = deriveId(branch);
  const record = readJson(path.join(approvalsDir(cwd), `${id}.json`));
  const reasons = [];
  if (!record) reasons.push('no_merge_request');
  if (record && !record.ci_green) reasons.push('ci_not_green');
  if (record && !record.verify_pass) reasons.push('verify_not_passed');
  // Human-origin token: env var, set by the operator, equal to this request's id.
  const token = env[APPROVAL_ENV];
  if (!record || !token || token !== record.id) reasons.push('no_human_approval');
  return { allowed: reasons.length === 0, reasons, branch, id };
}

/**
 * Confirm + perform the squash-merge, but only if evaluateMerge allows it. Git is
 * injected: gitImpl(argvArray)->{ok,stdout,stderr}. No force/reset/rebase/push verb is
 * ever issued. On a disallowed gate, returns { merged:false, reasons } and touches nothing.
 */
function confirmMerge(cwd, opts = {}, env = process.env, gitImpl = null) {
  const verdict = evaluateMerge(cwd, opts, env);
  if (!verdict.allowed) return { merged: false, reasons: verdict.reasons, branch: verdict.branch, id: verdict.id };
  if (typeof gitImpl !== 'function') {
    return { merged: false, reasons: ['no_git_executor'], branch: verdict.branch, id: verdict.id };
  }
  // Squash-merge only. Never push, force, reset, or rewrite history here.
  const squash = gitImpl(['merge', '--squash', verdict.branch]);
  if (!squash.ok) return { merged: false, reasons: ['git_merge_failed'], detail: squash.stderr, branch: verdict.branch, id: verdict.id };
  const commit = gitImpl(['commit', '--no-verify', '-m', `merge: ${verdict.branch} (human-approved)`]);
  if (!commit.ok) return { merged: false, reasons: ['git_commit_failed'], detail: commit.stderr, branch: verdict.branch, id: verdict.id };
  // Mark the request consumed.
  const p = path.join(approvalsDir(cwd), `${verdict.id}.json`);
  const rec = readJson(p) || { id: verdict.id, branch: verdict.branch };
  rec.status = 'merged';
  writeJson(p, rec);
  return { merged: true, branch: verdict.branch, id: verdict.id };
}

module.exports = {
  requestMerge, evaluateMerge, confirmMerge,
  deriveId, validateBranch, approvalsDir,
  APPROVAL_ENV, BRANCH_RE,
};
