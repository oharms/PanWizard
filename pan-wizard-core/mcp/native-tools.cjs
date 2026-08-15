'use strict';

/**
 * PAN-Z M2 — native MCP tools whose logic lives in-process (not a pan-tools spawn).
 *
 * These are the deterministic grafts the review demanded: the orchestrator's
 * `next-action` state machine and the two-step merge gate. A native tool declares a
 * `handler({ cwd, input, env, gitImpl }) -> { json | text, isError? }` instead of a
 * `verb`; a thrown Error is surfaced as JSON-RPC -32602 (invalid params) by the server.
 */

const fs = require('fs');
const path = require('path');
const mergeGate = require('./merge-gate.cjs');
const orchestrator = require('./orchestrator.cjs');

/**
 * Fill in the `verified` run fact from disk where the caller did not state it.
 *
 * WHY THIS EXISTS. `nextAction` is pure and takes `verified`/`merged` as run
 * facts, which is what makes the human merge gate reachable at all. But nothing
 * asks the caller to remember them, and a phase that is `complete` without
 * `verified` returns `verify` — so a project whose phases were completed in an
 * earlier session would be told to verify phase 1 forever. That is a live-lock of
 * exactly the kind this whole fix set out to remove, just moved one step along.
 *
 * PAN already records verification on disk: `verification.md` (or
 * `*-verification.md`) inside the phase directory. `classifyPhaseStatus()` ignores
 * it — it counts plans against summaries and nothing else — which is precisely why
 * `verified` could not come from the status vocabulary and had to be a run fact.
 *
 * So: derive it here, in the impure layer that has a cwd, and leave `nextAction`
 * pure. An explicit value from the caller always wins. `merged` is NOT derived —
 * no file records it, and a phase resting at `request_merge` until a human acts is
 * the gate working, not a stall.
 *
 * Fail-open: any fs problem leaves the snapshot exactly as the caller sent it.
 */
function enrichVerifiedFromDisk(cwd, state) {
  if (!state || !Array.isArray(state.phases)) return state;
  let phaseDirs;
  try {
    const root = path.join(cwd, '.planning', 'phases');
    phaseDirs = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => ({ name: e.name, full: path.join(root, e.name) }));
  } catch {
    return state; // no .planning/phases — nothing to derive
  }

  const hasVerification = (dir) => {
    try {
      return fs.readdirSync(dir).some((f) => f === 'verification.md' || f.endsWith('-verification.md'));
    } catch { return false; }
  };

  const phases = state.phases.map((p) => {
    if (!p || typeof p !== 'object' || p.verified !== undefined) return p;
    const num = String(p.number == null ? '' : p.number).trim();
    if (!num) return p;
    // Phase dirs are `NN-slug`; match on the leading number with or without
    // zero padding, so both "3" and "03" find `03-foo`.
    const padded = num.padStart(2, '0');
    const match = phaseDirs.find((d) => d.name === num || d.name.startsWith(`${num}-`) || d.name.startsWith(`${padded}-`));
    if (!match) return p;
    return hasVerification(match.full) ? Object.assign({}, p, { verified: true }) : p;
  });
  return Object.assign({}, state, { phases });
}

const NATIVE_TOOLS = [
  {
    name: 'pan_next_action',
    title: 'Next deterministic action',
    // The description is the ONLY thing an LLM caller reads, so it names the
    // correct source explicitly. An audit found callers following the old prose
    // ("assemble from the pan-mcp resources") straight into an infinite plan
    // loop: `pan://progress` reports Title Case and `pan://phases` returns
    // directory names with no status at all. `pan_roadmap_analyze` is the source
    // whose shape actually matches — say so here rather than in a comment.
    description: 'Given a phase snapshot, return the next step the primary agent should take (plan/execute/verify/request_merge/await_approval/stop), enforcing the safety caps, the regression circuit-breaker and the human merge gate. Build `state.phases` from `pan_roadmap_analyze` (its `phases[].disk_status` matches this contract); `pan://phases` carries no status and is NOT a substitute. Set `verified`/`merged` on a phase once you have performed those steps — they are run facts no file records, and without them the merge gate is never reached.',
    readOnly: true, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['state'],
      properties: {
        state: {
          type: 'object',
          // `phases` is REQUIRED. It previously was not, so `{}` — or any object
          // with a misspelled key — collapsed to an empty list and reported
          // "all_complete / done:true", i.e. a malformed request read as success.
          required: ['phases'],
          properties: {
            phases: {
              type: 'array',
              description: 'Ordered phases. status is the lowercase disk vocabulary (empty|discussed|researched|planned|partial|complete); case is folded, so Title Case from pan://progress is accepted.',
              items: {
                type: 'object',
                required: ['status'],
                properties: {
                  number: { type: ['number', 'string'] },
                  status: { type: 'string' },
                  verified: { type: 'boolean', description: 'Run fact: verification passed for this phase.' },
                  merged: { type: 'boolean', description: 'Run fact: this phase has been merged.' },
                },
              },
            },
            cycles: { type: 'number' },
            points_used: { type: 'number' },
            tests_before: { type: 'number' },
            tests_after: { type: 'number' },
            awaiting_approval: { type: 'boolean' },
            aborted: { type: 'boolean' },
          },
        },
        caps: { type: 'object' },
      },
    },
    handler: ({ cwd, input }) => {
      if (!input.state || typeof input.state !== 'object') throw new Error('Invalid "state": an object snapshot is required');
      // Derive `verified` from disk for any phase the caller left unset, so the
      // verify step terminates on a real project instead of looping. Explicit
      // caller values are never overwritten.
      return { json: orchestrator.nextAction(enrichVerifiedFromDisk(cwd, input.state), input.caps) };
    },
  },
  {
    name: 'pan_request_merge',
    title: 'Request a gated merge',
    description: 'Stage a squash-merge request for a branch and mark it awaiting human approval. Records intent only — does NOT merge.',
    readOnly: false, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['branch'],
      properties: { branch: { type: 'string' }, ci_green: { type: 'boolean' }, verify_pass: { type: 'boolean' } },
    },
    handler: ({ cwd, input }) => ({
      json: mergeGate.requestMerge(cwd, { branch: input.branch, ci_green: input.ci_green, verify_pass: input.verify_pass }),
    }),
  },
  {
    name: 'pan_confirm_merge',
    title: 'Confirm a human-approved merge',
    description: 'Perform a squash-merge ONLY if CI is green, verify passed, and a human-origin approval token (env PAN_MERGE_APPROVAL equal to the request\'s approval_token) is present. Any agent-supplied approval is ignored; never force-pushes or rewrites history.',
    readOnly: false, destructive: true,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['branch'],
      properties: { branch: { type: 'string' } },
    },
    handler: ({ cwd, input, env, gitImpl }) => {
      const res = mergeGate.confirmMerge(cwd, { branch: input.branch }, env, gitImpl);
      // A refused gate (missing approval / CI / verify) is a normal, non-error result the
      // agent should read; only a real git failure is flagged isError.
      const gitFailed = !res.merged && Array.isArray(res.reasons)
        && res.reasons.some((r) => r === 'git_merge_failed' || r === 'git_commit_failed');
      return { json: res, isError: gitFailed };
    },
  },
];

module.exports = { NATIVE_TOOLS };
