/**
 * PAN Harness — the model-free parts, both directions (ADR-0047).
 *
 * The harness's own findings are only worth believing if every check can be
 * shown to FAIL on a mutated input. PanLoop withdrew four of its own claims for
 * lacking exactly this. So each assertion kind here is exercised passing AND
 * failing, the ledger's merge/promotion rules are pinned, and every shipped
 * scenario must validate — a malformed `expect` would otherwise pass vacuously.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { check, checkOne, globToRegExp, getPath } = require('../harness/src/assert.cjs');
const { signature, normaliseDetail, mergeRun, isPromotable } = require('../harness/src/ledger.cjs');
const { validateScenario, loadScenarios } = require('../harness/src/scenario.cjs');
const { findCli } = require('../harness/src/cli-detect.cjs');
const { fill, parseArgs, allocateBudget, interleave, MIN_MODEL_STEP_USD } = require('../harness/src/run.cjs');
const { cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');

function tmpWorkspace() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-ws-'));
  fs.mkdirSync(path.join(ws, 'a', 'b'), { recursive: true });
  fs.writeFileSync(path.join(ws, 'a', 'b', 'x.js'), '');
  fs.writeFileSync(path.join(ws, 'a', 'y.md'), '');
  return ws;
}

describe('harness assertions — every kind passes AND fails', () => {
  const ws = tmpWorkspace();
  test.after?.(() => cleanup(ws));

  const cases = [
    ['exit:0', { code: 0 }, { code: 1 }],
    ['file:a/y.md', {}, null, 'file:a/nope.md'],
    ['absent:a/nope.md', {}, null, 'absent:a/y.md'],
    ['glob:a/**/*.js', {}, null, 'glob:a/**/*.ts'],
    ['count:a/**/*.js=1', {}, null, 'count:a/**/*.js=2'],
    ['json:k.v', { stdout: '{"k":{"v":1}}' }, { stdout: '{"k":{}}' }],
    ['json:k.v=1', { stdout: '{"k":{"v":1}}' }, { stdout: '{"k":{"v":2}}' }],
    ['json!:k.v', { stdout: '{"k":{}}' }, { stdout: '{"k":{"v":null}}' }],
    ['json:k', { stdout: 'not json' }, null, null, true],
    ['stdout~hel+o', { stdout: 'hello' }, { stdout: 'bye' }],
    ['stderr~E\\d+', { stderr: 'E42' }, { stderr: 'fine' }],
    ['rpc:1.result.ok=true', { responses: [{ id: 1, result: { ok: true } }] }, { responses: [{ id: 1, result: { ok: false } }] }],
    ['rpc:1.result.ok', { responses: [{ id: 1, result: { ok: true } }] }, { responses: [{ id: 2, result: {} }] }],
  ];
  for (const [expect, passing, failing, failingExpect, alwaysFails] of cases) {
    test(`${expect}`, () => {
      if (alwaysFails) { assert.ok(checkOne(expect, passing, ws), 'must fail on non-JSON stdout'); return; }
      assert.equal(checkOne(expect, passing, ws), null, `should pass: ${expect}`);
      const fe = failingExpect || expect;
      const fo = failing || passing;
      assert.ok(checkOne(fe, fo, ws), `should fail: ${fe} on ${JSON.stringify(fo)}`);
    });
  }

  test('unknown kinds are reported, never silently passed', () => {
    assert.match(checkOne('bogus:x', {}, ws), /unknown assertion kind/);
    assert.equal(check(['exit:0', 'bogus:x'], { code: 0 }, ws).length, 1);
  });

  test('globToRegExp: ** spans directories, * stays within one', () => {
    assert.ok(globToRegExp('a/**/*.js').test('a/b/c/x.js'));
    assert.ok(!globToRegExp('a/*.js').test('a/b/x.js'));
    assert.ok(globToRegExp('.claude/workflows/pan-*.js').test('.claude/workflows/pan-exec-waves.js'));
    assert.ok(!globToRegExp('.claude/workflows/pan-*.js').test('.claude/workflows/other.js'));
  });

  test('getPath walks arrays by index and reports absence distinctly from null values', () => {
    assert.deepEqual(getPath({ a: [{ b: null }] }, 'a.0.b'), { found: true, value: null });
    assert.deepEqual(getPath({ a: [] }, 'a.0.b'), { found: false });
  });
});

describe('harness ledger — signatures, merge, promotion', () => {
  test('signature ignores paths, run ids and numbers but not the contract that failed', () => {
    const a = signature('s', 0, 'exit:0', 'exit code 1, expected 0 at D:\\pantesting\\harness-runs\\run-20260910-120000-abcd\\ws');
    const b = signature('s', 0, 'exit:0', 'exit code 2, expected 0 at /tmp/run-20260911-090000-zzzz/ws');
    assert.equal(a, b, 'volatile detail must not split one finding into many');
    assert.notEqual(a, signature('s', 1, 'exit:0', 'exit code 1, expected 0'), 'a different step is a different finding');
    assert.notEqual(a, signature('s', 0, 'file:x', 'missing: x'), 'a different assertion is a different finding');
    assert.equal(normaliseDetail('run-20260910-120000-abcd 12 /x/y'), '<run> <n> <path>');
  });

  test('mergeRun accumulates runs on one finding and resolves it when the step later passes', () => {
    const f = { scenario: 's', tier: 0, step: 2, expect: 'exit:0', failure: 'exit code 1, expected 0', why: 'w' };
    let entries = mergeRun([], { runId: 'r1', build: 'b1', now: 't1', failures: [f], passedSteps: [] });
    assert.equal(entries.length, 1);
    assert.equal(isPromotable(entries[0]), true, 'a tier-0 finding promotes at once');
    entries = mergeRun(entries, { runId: 'r2', build: 'b2', now: 't2', failures: [f], passedSteps: [] });
    assert.equal(entries.length, 1, 'same finding, not a duplicate');
    assert.deepEqual(entries[0].runs, ['r1', 'r2']);
    assert.deepEqual(entries[0].builds, ['b1', 'b2']);
    entries = mergeRun(entries, { runId: 'r3', build: 'b3', now: 't3', failures: [], passedSteps: [{ scenario: 's', step: 2 }] });
    assert.equal(entries[0].resolved_at, 't3');
    assert.equal(isPromotable(entries[0]), false, 'resolved findings do not promote');
  });

  test('a pass in the SAME run never resolves a failure from that run — a 4/5 flake stays visible', () => {
    // The first tier-2 run (2026-09-10): reps 1–4 passed, rep 5 failed on budget;
    // same-run resolution closed the rep-5 findings the instant they were written.
    const f = { scenario: 'chain', tier: 2, step: 0, expect: 'exit:0', failure: 'exit code 1, expected 0', why: 'w' };
    const entries = mergeRun([], { runId: 'r1', build: 'b', now: 't1', failures: [f], passedSteps: [{ scenario: 'chain', step: 0 }] });
    assert.equal(entries[0].resolved_at, null, 'same-run pass must not resolve');
    const later = mergeRun(entries, { runId: 'r2', build: 'b', now: 't2', failures: [], passedSteps: [{ scenario: 'chain', step: 0 }] });
    assert.equal(later[0].resolved_at, 't2', 'a LATER run passing does resolve');
  });

  test('model-tier findings need two runs before they promote', () => {
    const f = { scenario: 'm', tier: 2, step: 0, expect: 'exit:0', failure: 'x', why: 'w' };
    let entries = mergeRun([], { runId: 'r1', build: 'b', now: 't1', failures: [f], passedSteps: [] });
    assert.equal(isPromotable(entries[0]), false, 'one flaky model run is not a finding');
    entries = mergeRun(entries, { runId: 'r2', build: 'b', now: 't2', failures: [f], passedSteps: [] });
    assert.equal(isPromotable(entries[0]), true);
  });
});

describe('harness scenarios — every shipped scenario validates, and bad ones are refused', () => {
  test('all shipped scenarios load', () => {
    const scenarios = loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
    assert.ok(scenarios.length >= 6, 'non-vacuity');
    const ids = scenarios.map(s => s.id);
    assert.equal(new Set(ids).size, ids.length, 'ids unique');
    for (const s of scenarios) for (const st of s.steps) assert.ok(st.why.length > 20, `${s.id}: every step carries a real why`);
  });

  test('the coverage the plan left open is encoded', () => {
    const ids = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).map(s => s.id);
    for (const need of ['install-matrix', 'mcp-bridge-cwd', 'native-workflows-deployed', 'agent-plugin-bundle', 'live-gate-copilot', 'live-gate-codex', 'live-gate-antigravity', 'native-exec-waves-chain', 'plugin-agent-scope']) {
      assert.ok(ids.includes(need), `missing scenario ${need}`);
    }
  });

  test('validation rejects the mistakes that would pass vacuously', () => {
    const good = { id: 'ok', tier: 0, description: 'd', why: 'w', steps: [{ kind: 'fs', expect: ['file:x'], why: 'because' }] };
    assert.deepEqual(validateScenario(good), []);
    assert.ok(validateScenario({ ...good, steps: [] }).length, 'no steps');
    assert.ok(validateScenario({ ...good, steps: [{ kind: 'fs', expect: ['bogus'], why: 'w' }] }).length, 'unknown assertion');
    assert.ok(validateScenario({ ...good, steps: [{ kind: 'fs', expect: ['file:x'] }] }).length, 'missing why');
    assert.ok(validateScenario({ ...good, steps: [{ kind: 'model', prompt: 'p', expect: ['exit:0'], why: 'w' }] }).length, 'model step in tier 0');
    assert.ok(validateScenario({ ...good, tier: 1 }).length, 'tier 1 without a model step');
    assert.ok(validateScenario({ ...good, install: ['rm -rf /'] }).length, 'install flags must be flags');
    assert.ok(validateScenario({ ...good, requires: { cli: 'a b' } }).length, 'cli must be a bare name');
  });
});

describe('harness runner helpers', () => {
  test('fill substitutes only the known placeholders', () => {
    assert.deepEqual(fill(['<ws>/x', '<other>', '<repo>/scripts', 'plain', '<unknown>'], { ws: 'W', other: 'O', repo: 'R', pkg: 'P' }), ['W/x', 'O', 'R/scripts', 'plain', '<unknown>']);
  });

  test('parseArgs: tier defaults to 0, model spend is off unless --max-usd is given', () => {
    const a = parseArgs([]);
    assert.equal(a.tier, 0); assert.equal(a.maxUsd, null); assert.equal(a.repeat, 1);
    const b = parseArgs(['--tier', '2', '--max-usd', '3', '--repeat', '5', '--scenario', 'x', '--scenario', 'y']);
    assert.equal(b.tier, 2); assert.equal(b.maxUsd, 3); assert.equal(b.repeat, 5); assert.deepEqual(b.scenarios, ['x', 'y']);
    assert.throws(() => parseArgs(['--bogus']), /unknown argument/);
  });

  test('allocateBudget splits --max-usd equally across model-tier scenarios only', () => {
    // The 2026-09-10 run: the alphabetically earlier oracle spent the whole cap and
    // the scenario it was meant to be compared with never ran a model step.
    const s = [{ id: 'a-oracle', tier: 2 }, { id: 'b-native', tier: 2 }, { id: 'c-free', tier: 0 }];
    const shares = allocateBudget(20, s);
    assert.equal(shares.get('a-oracle'), 10);
    assert.equal(shares.get('b-native'), 10);
    assert.equal(shares.get('c-free'), 0);
    assert.equal(allocateBudget(null, s).get('a-oracle'), 0, 'no cap → no model share');
    assert.equal(allocateBudget(20, [{ id: 'x', tier: 0 }]).get('x'), 0);
  });

  test('interleave gives every scenario its rep 1 before any gets its rep 2; tier 0 runs once', () => {
    const s = [{ id: 'a', tier: 2 }, { id: 'b', tier: 2 }, { id: 'c', tier: 0 }];
    const order = interleave(s, 3).map(q => `${q.scenario.id}${q.rep}`);
    assert.deepEqual(order, ['a1', 'b1', 'c1', 'a2', 'b2', 'a3', 'b3']);
    assert.equal(interleave(s, 1).length, 3);
  });

  test('a model step is not started below the budget floor', () => {
    assert.ok(MIN_MODEL_STEP_USD >= 0.5, 'a floor under fifty cents cannot buy a chain step');
  });

  test('findCli finds a binary on a fake PATH and not otherwise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-path-'));
    try {
      fs.writeFileSync(path.join(dir, 'copilot.cmd'), '@echo off');
      assert.ok(findCli('copilot', { PATH: dir }, 'win32'));
      assert.equal(findCli('codex', { PATH: dir }, 'win32'), null);
      assert.equal(findCli('copilot', { PATH: dir }, 'linux'), null, 'no .cmd lookup on linux');
    } finally { cleanup(dir); }
  });
});
