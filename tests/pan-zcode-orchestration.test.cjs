/**
 * PAN-Z M2 — the determinism grafts: the next-action orchestrator and the two-step,
 * model-proof merge gate, plus their dispatch as native MCP tools through the server.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { nextAction } = require('../pan-wizard-core/mcp/orchestrator.cjs');
const gate = require('../pan-wizard-core/mcp/merge-gate.cjs');
const { createServer } = require('../pan-wizard-core/mcp/server.cjs');
const { createTempProject, cleanup } = require('./helpers.cjs');

// ─── orchestrator ───────────────────────────────────────────────────────────
describe('orchestrator.nextAction', () => {
  const phases = (statuses) => statuses.map((s, i) => ({ number: String(i + 1).padStart(2, '0'), status: s }));

  test('advances a phase through plan → execute → verify → request_merge (LEGACY vocabulary)', () => {
    // ⚠️ `none`/`executed`/`verified` are LEGACY ALIASES that NO PRODUCER IN PAN
    // EMITS. This test is retained only to prove the aliases still resolve for a
    // caller written against the pre-2026-08 contract. It is NOT evidence the
    // machine works: for years it was the ONLY ladder test, and because its
    // fixture spoke a vocabulary reality does not, it hid the fact that `verify`
    // and `request_merge` were unreachable from real data and the human merge
    // gate was skipped in the normal flow. The real-vocabulary ladder below is
    // the one that matters. Never add a fixture here without checking that
    // something in PAN actually emits the status you are writing.
    assert.equal(nextAction({ phases: phases(['none']) }).action, 'plan');
    assert.equal(nextAction({ phases: phases(['planned']) }).action, 'execute');
    assert.equal(nextAction({ phases: phases(['executed']) }).action, 'verify');
    assert.equal(nextAction({ phases: phases(['verified']) }).action, 'request_merge');
  });

  test('THE REAL LADDER: every status classifyPhaseStatus emits reaches the right action', () => {
    // Vocabulary asserted against the producer itself, not against a literal —
    // if classifyPhaseStatus gains a status, this test must be updated with it.
    const produced = ['empty', 'discussed', 'researched', 'planned', 'partial', 'complete'];
    const src = fs.readFileSync(
      path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'utils.cjs'), 'utf8');
    const fn = src.slice(src.indexOf('function classifyPhaseStatus'));
    const emitted = [...new Set((fn.slice(0, fn.indexOf('\n}')).match(/return '([a-z]+)'/g) || [])
      .map((m) => m.replace(/return '|'/g, '')))].sort();
    assert.deepEqual(emitted, [...produced].sort(),
      'classifyPhaseStatus vocabulary drifted — update PHASE_NEXT and this list together');

    assert.equal(nextAction({ phases: phases(['empty']) }).action, 'plan');
    assert.equal(nextAction({ phases: phases(['discussed']) }).action, 'plan');
    assert.equal(nextAction({ phases: phases(['researched']) }).action, 'plan');
    assert.equal(nextAction({ phases: phases(['planned']) }).action, 'execute');
    // `partial` must RESUME, not re-plan. It previously had no entry and fell
    // through to `plan`, re-planning a half-executed phase on every cycle.
    assert.equal(nextAction({ phases: phases(['partial']) }).action, 'execute');
  });

  test('the human merge gate IS reachable from real disk vocabulary', () => {
    // The defect this guards: `complete` was filtered out as finished, so a phase
    // went planned → execute → complete and the machine advanced to the next one.
    // verify and request_merge were never reached and the merge gate was bypassed.
    const done = (extra) => ({ phases: [{ number: '01', status: 'complete', ...extra }] });
    assert.equal(nextAction(done()).action, 'verify', 'complete but unverified must verify');
    assert.equal(nextAction(done({ verified: true })).action, 'request_merge', 'verified must reach the gate');
    assert.equal(nextAction(done({ verified: true, merged: true })).reason, 'all_complete');
    assert.equal(nextAction(done({ verified: true, merged: true })).done, true);
  });

  test('Title Case from pan://progress is accepted (the documented assembly path)', () => {
    // orchestrator.cjs tells callers to assemble the snapshot from the MCP
    // resources; pan://progress emits "Planned", which used to miss the table and
    // return `plan` forever — telling a planned phase to plan again, every cycle.
    for (const s of ['Planned', 'PLANNED', ' planned ']) {
      const r = nextAction({ phases: [{ number: '01', status: s }] });
      assert.equal(r.action, 'execute', `case/whitespace variant "${s}" must fold`);
      assert.equal(r.reason, 'phase_planned');
    }
  });

  test('a misshapen snapshot NEVER reports success', () => {
    // The dangerous direction. `[].find(...)` is indistinguishable from "all
    // complete", so `{}` and every misnamed key reported done:true — silently
    // stopping the loop and calling it a success.
    for (const bad of [{}, { phase: 1, status: 'executing' }, { total_phases: 2, completed_phases: 0 },
      { phases: null }, { phases: 'nope' }, { phases: [] }, { phases: [null, 42] }]) {
      const r = nextAction(bad);
      assert.equal(r.reason, 'no_phases', `${JSON.stringify(bad)} must report no_phases`);
      assert.equal(r.done, false, `${JSON.stringify(bad)} must NOT claim done`);
      assert.notEqual(r.reason, 'all_complete');
    }
    // ...while a genuinely finished list still reports success.
    assert.equal(nextAction({ phases: [{ number: '01', status: 'complete', verified: true, merged: true }] }).reason,
      'all_complete');
  });

  test('DISK ENRICHMENT: verification.md terminates the verify step (no new live-lock)', () => {
    // Making the merge gate reachable created a second-order risk: `complete`
    // without `verified` returns `verify`, so a project completed in an earlier
    // session would be told to verify phase 1 forever — the same live-lock class
    // this fix set out to remove. PAN records verification on disk
    // (`verification.md`), which classifyPhaseStatus ignores, so the tool handler
    // derives it. This asserts through the real native tool, not the pure fn.
    const { NATIVE_TOOLS } = require('../pan-wizard-core/mcp/native-tools.cjs');
    const tool = NATIVE_TOOLS.find((t) => t.name === 'pan_next_action');
    const proj = createTempProject();
    try {
      const dir = path.join(proj, '.planning', 'phases', '01-alpha');
      fs.mkdirSync(dir, { recursive: true });
      const state = { phases: [{ number: '01', status: 'complete' }] };

      // No verification artifact yet → verify.
      assert.equal(tool.handler({ cwd: proj, input: { state } }).json.action, 'verify');

      // Once verification.md exists, the phase is verified and the gate is next.
      fs.writeFileSync(path.join(dir, 'verification.md'), '# verified\n');
      assert.equal(tool.handler({ cwd: proj, input: { state } }).json.action, 'request_merge',
        'verification.md on disk must satisfy the verified run fact');

      // An explicit caller value always wins over the disk reading.
      const override = { phases: [{ number: '01', status: 'complete', verified: false }] };
      assert.equal(tool.handler({ cwd: proj, input: { state: override } }).json.action, 'verify');
    } finally {
      cleanup(proj);
    }
  });

  test('DISK ENRICHMENT is fail-open — no .planning/ leaves the snapshot untouched', () => {
    const { NATIVE_TOOLS } = require('../pan-wizard-core/mcp/native-tools.cjs');
    const tool = NATIVE_TOOLS.find((t) => t.name === 'pan_next_action');
    const r = tool.handler({
      cwd: path.join(require('os').tmpdir(), 'pan-does-not-exist-' + process.pid),
      input: { state: { phases: [{ number: '01', status: 'planned' }] } },
    });
    assert.equal(r.json.action, 'execute', 'a missing planning dir must not break the decision');
  });

  test('an unknown status is reported as unknown, not silently re-planned', () => {
    const r = nextAction({ phases: [{ number: '01', status: 'weird-new-status' }] });
    assert.match(r.reason, /unknown_status/, 'the reason must name the mismatch');
    assert.equal(r.done, false);
  });

  // ⚠️ SEMANTICS CHANGED 2026-08-15, deliberately. `complete` no longer means
  // "finished" — it means "the artifacts are all there". Whether a phase is DONE
  // additionally depends on the run facts `verified` and `merged`. Both tests
  // below previously passed by treating `complete` as terminal, which is exactly
  // how the human merge gate came to be unreachable: a phase went
  // planned → execute → complete and the machine skipped straight past the gate
  // to the next phase. If you find yourself "fixing" these back, read finding §1
  // in docs/audits/ first.

  test('picks the FIRST phase that is not finished — complete-but-unverified counts', () => {
    const r = nextAction({ phases: phases(['complete', 'complete', 'planned']) });
    assert.equal(r.action, 'verify', 'an unverified complete phase is still open');
    assert.equal(r.args.phase, '01');

    // Once the earlier phases are genuinely finished, it advances as before.
    const finished = [
      { number: '01', status: 'complete', verified: true, merged: true },
      { number: '02', status: 'complete', verified: true, merged: true },
      { number: '03', status: 'planned' },
    ];
    const r2 = nextAction({ phases: finished });
    assert.equal(r2.action, 'execute');
    assert.equal(r2.args.phase, '03');
  });

  test('stops only when every phase is complete AND verified AND merged', () => {
    // Not finished: complete but never verified.
    const unverified = nextAction({ phases: phases(['complete', 'complete']) });
    assert.equal(unverified.action, 'verify');
    assert.equal(unverified.done, false);

    // Not finished: verified but not through the gate.
    const unmerged = nextAction({
      phases: [{ number: '01', status: 'complete', verified: true }],
    });
    assert.equal(unmerged.action, 'request_merge');
    assert.equal(unmerged.done, false);

    // Finished.
    const r = nextAction({
      phases: [
        { number: '01', status: 'complete', verified: true, merged: true },
        { number: '02', status: 'complete', verified: true, merged: true },
      ],
    });
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

  test('max_cycles is a hard stop; budget is advisory unless enforced', () => {
    assert.equal(nextAction({ cycles: 25, phases: phases(['planned']) }, { maxCycles: 25 }).reason, 'max_cycles');
    // Budget over-run does NOT stop by default (advisory) …
    assert.notEqual(nextAction({ points_used: 200, phases: phases(['planned']) }, { budget: 200 }).reason, 'budget_cap');
    // … it stops only when the caller opts in.
    assert.equal(nextAction({ points_used: 200, phases: phases(['planned']) }, { budget: 200, enforceBudget: true }).reason, 'budget_cap');
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

  test('the per-request token, with CI+verify, allows the merge of the staged branch', () => {
    const cwd = createTempProject();
    try {
      const rec = gate.requestMerge(cwd, { branch: 'army/ok', ci_green: true, verify_pass: true });
      const v = gate.evaluateMerge(cwd, { branch: 'army/ok' }, { PAN_MERGE_APPROVAL: rec.approval_token });
      assert.equal(v.allowed, true);
      assert.deepEqual(v.reasons, []);
    } finally { cleanup(cwd); }
  });

  test('a WRONG/stale token does not approve; an agent-supplied approval is ignored', () => {
    const cwd = createTempProject();
    try {
      gate.requestMerge(cwd, { branch: 'army/ok', ci_green: true, verify_pass: true });
      const stale = gate.evaluateMerge(cwd, { branch: 'army/ok' }, { PAN_MERGE_APPROVAL: 'some-other-token' });
      assert.equal(stale.allowed, false);
      // Even if the agent passes its own "approval", it is never consulted:
      const forged = gate.evaluateMerge(cwd, { branch: 'army/ok', approved: true, approval_token: 'yes' }, {});
      assert.equal(forged.allowed, false);
    } finally { cleanup(cwd); }
  });

  test('approval is bound to the EXACT branch — a look-alike that slugifies the same is refused', () => {
    const cwd = createTempProject();
    try {
      // 'cleanup/docs' and 'cleanup-docs' collapse to the same file slug but are different branches.
      const rec = gate.requestMerge(cwd, { branch: 'cleanup/docs', ci_green: true, verify_pass: true });
      const v = gate.evaluateMerge(cwd, { branch: 'cleanup-docs' }, { PAN_MERGE_APPROVAL: rec.approval_token });
      assert.equal(v.allowed, false);
      assert.ok(v.reasons.includes('branch_mismatch'), 'a look-alike branch cannot ride a token approved for another');
    } finally { cleanup(cwd); }
  });

  test('the human token is single-use — a re-requested merge needs fresh approval (no replay)', () => {
    const cwd = createTempProject();
    try {
      const rec1 = gate.requestMerge(cwd, { branch: 'army/re', ci_green: true, verify_pass: true });
      const env = { PAN_MERGE_APPROVAL: rec1.approval_token };
      const git = () => ({ ok: true, stdout: '', stderr: '' });
      assert.equal(gate.confirmMerge(cwd, { branch: 'army/re' }, env, git).merged, true);
      assert.ok(!('PAN_MERGE_APPROVAL' in env), 'token consumed on a successful merge');
      // Agent re-stages the same branch with new (unreviewed) commits → a fresh token.
      const rec2 = gate.requestMerge(cwd, { branch: 'army/re', ci_green: true, verify_pass: true });
      assert.notEqual(rec2.approval_token, rec1.approval_token);
      // Replaying the OLD token cannot approve the new request…
      const replay = gate.evaluateMerge(cwd, { branch: 'army/re' }, { PAN_MERGE_APPROVAL: rec1.approval_token });
      assert.equal(replay.allowed, false);
      // …only fresh human approval of the NEW token works.
      assert.equal(gate.evaluateMerge(cwd, { branch: 'army/re' }, { PAN_MERGE_APPROVAL: rec2.approval_token }).allowed, true);
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
      const ok = gate.confirmMerge(cwd, { branch: 'army/ok' }, { PAN_MERGE_APPROVAL: rec.approval_token }, gitImpl);
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
