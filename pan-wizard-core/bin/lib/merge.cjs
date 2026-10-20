'use strict';
/**
 * The human merge gate on the CLI (program L6a): what `/pan:army`'s release step uses.
 *
 * `merge request <branch> [--phase N] [--ci-green]` stages a merge through the same
 * gate the MCP bridge uses (mcp/merge-gate.cjs). With `--phase`, verify_pass is the
 * phase gate's verdict, not the caller's word. The approval token is never printed: it
 * is for a person, not for the agent that staged the merge.
 *
 * `merge confirm <branch>` performs the squash-merge only in an interactive terminal,
 * after the person types the branch name. An agent runs commands without a TTY, so it
 * can stage a merge but never approve one. There is deliberately no environment
 * variable or flag that skips the terminal check: anything an agent can set, an agent
 * can set to approve itself.
 */
const readline = require('readline');
const { output, error, execGit } = require('./core.cjs');
const gate = require('../../mcp/merge-gate.cjs');

function cmdMergeRequest(cwd, branch, opts, raw) {
  if (!branch) error('Usage: merge request <branch> [--phase N] [--ci-green]');
  let rec;
  try {
    rec = gate.requestMerge(cwd, { branch, phase: opts.phase, ci_green: !!opts.ciGreen, now: new Date().toISOString() });
  } catch (e) { output({ error: 'invalid_branch', reason: e.message }, raw, 'error', 1); return; }
  const { approval_token: _token, ...shown } = rec;
  output({ ...shown, next: `A person runs, in their own terminal: pan-tools merge confirm ${rec.branch}` }, raw, rec.status);
}

function cmdMergeConfirm(cwd, branch, raw) {
  if (!branch) error('Usage: merge confirm <branch>');
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    output({ error: 'human_terminal_required', reason: 'merge confirm runs only in an interactive terminal: an agent can stage a merge, a person approves it', branch }, raw, 'error', 1);
    return;
  }
  let record;
  try { record = JSON.parse(require('fs').readFileSync(require('path').join(gate.approvalsDir(cwd), `${gate.slugify(gate.validateBranch(branch))}.json`), 'utf8')); } catch { record = null; }
  if (!record) { output({ error: 'no_merge_request', branch }, raw, 'error', 1); return; }
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  rl.question(`Squash-merge ${record.branch} into the current branch? CI green: ${record.ci_green}, verified: ${record.verify_pass}. Type the branch name to approve: `, (answer) => {
    rl.close();
    if (answer.trim() !== record.branch) { output({ merged: false, reasons: ['not_confirmed'], branch: record.branch }, raw, 'not_confirmed', 1); return; }
    const env = { ...process.env, PAN_MERGE_APPROVAL: record.approval_token };
    const git = (argv) => { const r = execGit(cwd, argv); return { ok: r.exitCode === 0, stdout: r.stdout, stderr: r.stderr }; };
    const r = gate.confirmMerge(cwd, { branch: record.branch }, env, git);
    output(r, raw, r.merged ? 'merged' : 'refused', r.merged ? 0 : 1);
  });
}

module.exports = { cmdMergeRequest, cmdMergeConfirm };
