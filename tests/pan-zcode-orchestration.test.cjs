/**
 * PAN-Z M2 — the determinism grafts: the next-action orchestrator and the two-step,
 * model-proof merge gate, plus their dispatch as native MCP tools through the server.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { nextAction } = require('../pan-zcode/mcp/orchestrator.cjs');
const gate = require('../pan-zcode/mcp/merge-gate.cjs');
const { createServer } = require('../pan-zcode/mcp/server.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

// ─── orchestrator ───────────────────────────────────────────────────────────
describe('orchestrator.nextAction', () => {
  const phases = (statuses) => statuses.map((s, i) => ({ number: String(i + 1).padStart(2, '0'), status: s }));

  test('advances a phase through plan → execute → verify → request_merge', () => {
    assert.equal(nextAction({ phases: phases(['none']) }).action, 'plan');
    assert.equal(nextAction({ phases: phases(['planned']) }).action, 'execute');
    assert.equal(nextAction({ phases: phases(['executed']) }).action, 'verify');
    assert.equal(nextAction({ phases: phases(['verified']) }).action, 'request_merge');
  });

  test('picks the FIRST incomplete phase', () => {
    const r = nextAction({ phases: phases(['complete', 'complete', 'planned']) });
    assert.equal(r.action, 'execute');
    assert.equal(r.args.phase, '03');
  });

  test('stops when all phases complete', () => {
    const r = nextAction({ phases: phases(['complete', 'complete']) });
    assert.equal(r.action, 'stop');
    assert.equal(r.reason, 'all_complete');
    assert.equal(r.done, true);
  });

  test('the human gate is a barrier — awaiting_approval halts all other work', () => {
    const r = nextAction({ awaiting_approval: true, phases: phases(['planned']) });
    assert.equal(r.action, 'await_approval');
    assert.equal(r.done, false);
  });

  test('regression circuit-breaker stops the loop (tests dropped)', () => {
    const r = nextAction({ tests_before: 100, tests_after: 98, phases: phases(['planned']) });
    assert.equal(r.action, 'stop');
    assert.equal(r.reason, 'regression');
  });

  test('safety caps: max_cycles and budget both stop the loop', () => {
    assert.equal(nextAction({ cycles: 25, phases: phases(['planned']) }, { maxCycles: 25 }).reason, 'max_cycles');
    assert.equal(nextAction({ points_used: 200, phases: phases(['planned']) }, { budget: 200 }).reason, 'budget_cap');
  });

  test('an explicit abort outranks everything', () => {
    const r = nextAction({ aborted: true, phases: phases(['none']) });
    assert.equal(r.reason, 'aborted');
    assert.equal(r.done, true);
  });
});

// ─── merge gate (decision logic) ─────────────────────────────────────────────
describe('merge-gate decision logic', () => {
  test('requestMerge records an awaiting_approval request, does not merge', () => {
    const cwd = createTempProject();
    try {
      const rec = gate.requestMerge(cwd, { branch: 'army/task-x', ci_green: true, verify_pass: true });
      assert.equal(rec.status, 'awaiting_approval');
      assert.ok(fs.existsSync(path.join(gate.approvalsDir(cwd), `${rec.id}.json`)));
    } finally { cleanup(cwd); }
  });

  test('evaluateMerge refuses without CI, without verify, and without the human token', () => {
    const cwd = createTempProject();
    try {
      gate.requestMerge(cwd, { branch: 'army/t', ci_green: false, verify_pass: false });
      const noEnv = gate.evaluateMerge(cwd, { branch: 'army/t' }, {});
      assert.equal(noEnv.allowed, false);
      assert.ok(noEnv.reasons.includes('ci_not_green'));
      assert.ok(noEnv.reasons.includes('verify_not_passed'));
      assert.ok(noEnv.reasons.includes('no_human_approval'));
    } finally { cleanup(cwd); }
  });

  test('a human token that matches the request id, with CI+verify, allows the merge', () => {
    const cwd = createTempProject();
    try {
      const rec = gate.requestMerge(cwd, { branch: 'army/ok', ci_green: true, verify_pass: true });
      const v = gate.evaluateMerge(cwd, { branch: 'army/ok' }, { PAN_MERGE_APPROVAL: rec.id });
      assert.equal(v.allowed, true);
      assert.deepEqual(v.reasons, []);
    } finally { cleanup(cwd); }
  });

  test('a WRONG/stale token does not approve; an agent-supplied approval is ignored', () => {
    const cwd = createTempProject();
    try {
      gate.requestMerge(cwd, { branch: 'army/ok', ci_green: true, verify_pass: true });
      const stale = gate.evaluateMerge(cwd, { branch: 'army/ok' }, { PAN_MERGE_APPROVAL: 'some-other-id' });
      assert.equal(stale.allowed, false);
      // Even if the agent passes its own "approval", it is never consulted:
      const forged = gate.evaluateMerge(cwd, { branch: 'army/ok', approved: true, approval_token: 'yes' }, {});
      assert.equal(forged.allowed, false);
    } finally { cleanup(cwd); }
  });

  test('confirmMerge performs a squash-merge ONLY when allowed, and never force/reset/push', () => {
    const cwd = createTempProject();
    try {
      const rec = gate.requestMerge(cwd, { branch: 'army/ok', ci_green: true, verify_pass: true });
      const gitCalls = [];
      const gitImpl = (args) => { gitCalls.push(args); return { ok: true, stdout: '', stderr: '' }; };
      // Denied: no token → no git at all.
      const denied = gate.confirmMerge(cwd, { branch: 'army/ok' }, {}, gitImpl);
      assert.equal(denied.merged, false);
      assert.equal(gitCalls.length, 0);
      // Allowed: token present → merge + commit, nothing else.
      const ok = gate.confirmMerge(cwd, { branch: 'army/ok' }, { PAN_MERGE_APPROVAL: rec.id }, gitImpl);
      assert.equal(ok.merged, true);
      const verbs = gitCalls.map((a) => a[0]);
      assert.deepEqual(verbs, ['merge', 'commit']);
      for (const a of gitCalls) {
        assert.ok(!a.includes('--force') && !a.includes('-f'), 'never force');
        assert.ok(a[0] !== 'push' && a[0] !== 'reset' && a[0] !== 'rebase', 'never push/reset/rebase');
      }
    } finally { cleanup(cwd); }
  });

  test('validateBranch rejects a hostile branch name', () => {
    assert.throws(() => gate.validateBranch('a; rm -rf /'));
    assert.throws(() => gate.validateBranch('$(x)'));
    assert.equal(gate.validateBranch('army/task-1'), 'army/task-1');
  });
});

// ─── native tools through the MCP server ─────────────────────────────────────
describe('native MCP tools (dispatch)', () => {
  test('pan_next_action is advertised and returns a decision', () => {
    const s = createServer({ spawnImpl: () => ({ ok: true, stdout: '', stderr: '' }) });
    const list = s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.ok(list.result.tools.some((t) => t.name === 'pan_next_action'));
    const r = s.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'pan_next_action', arguments: { state: { phases: [{ number: '01', status: 'planned' }] } } } });
    const decision = JSON.parse(r.result.content[0].text);
    assert.equal(decision.action, 'execute');
  });

  test('pan_next_action with a non-object state → -32602', () => {
    const s = createServer({ spawnImpl: () => ({ ok: true, stdout: '', stderr: '' }) });
    const r = s.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'pan_next_action', arguments: { state: 'nope' } } });
    assert.equal(r.error.code, -32602);
  });

  test('pan_confirm_merge routes through the gate with the server env + injected git', () => {
    const cwd = createTempProject();
    try {
      const gitCalls = [];
      const s = createServer({
        cwd,
        spawnImpl: () => ({ ok: true, stdout: '', stderr: '' }),
        gitImpl: (a) => { gitCalls.push(a); return { ok: true, stdout: '', stderr: '' }; },
        env: {}, // no approval token → gate must refuse
      });
      const req = s.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'pan_request_merge', arguments: { branch: 'army/z', ci_green: true, verify_pass: true } } });
      assert.equal(JSON.parse(req.result.content[0].text).status, 'awaiting_approval');
      const conf = s.handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'pan_confirm_merge', arguments: { branch: 'army/z' } } });
      const res = JSON.parse(conf.result.content[0].text);
      assert.equal(res.merged, false);
      assert.ok(res.reasons.includes('no_human_approval'));
      assert.equal(gitCalls.length, 0, 'no git ran without human approval');
    } finally { cleanup(cwd); }
  });
});
