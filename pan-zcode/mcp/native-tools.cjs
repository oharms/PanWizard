'use strict';

/**
 * PAN-Z M2 — native MCP tools whose logic lives in-process (not a pan-tools spawn).
 *
 * These are the deterministic grafts the review demanded: the orchestrator's
 * `next-action` state machine and the two-step merge gate. A native tool declares a
 * `handler({ cwd, input, env, gitImpl }) -> { json | text, isError? }` instead of a
 * `verb`; a thrown Error is surfaced as JSON-RPC -32602 (invalid params) by the server.
 */

const mergeGate = require('./merge-gate.cjs');
const orchestrator = require('./orchestrator.cjs');

const NATIVE_TOOLS = [
  {
    name: 'pan_next_action',
    title: 'Next deterministic action',
    description: 'Given the current phase/run snapshot, return the next step the primary agent should take (plan/execute/verify/request_merge/await_approval/stop). Enforces the safety caps and the regression circuit-breaker.',
    readOnly: true, destructive: false,
    inputSchema: {
      type: 'object', additionalProperties: false, required: ['state'],
      properties: { state: { type: 'object' }, caps: { type: 'object' } },
    },
    handler: ({ input }) => {
      if (!input.state || typeof input.state !== 'object') throw new Error('Invalid "state": an object snapshot is required');
      return { json: orchestrator.nextAction(input.state, input.caps) };
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
    description: 'Perform a squash-merge ONLY if CI is green, verify passed, and a human-origin approval token (env PAN_MERGE_APPROVAL equal to the request id) is present. Any agent-supplied approval is ignored; never force-pushes or rewrites history.',
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
