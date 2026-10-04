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
const { fill, quoteCmdArg, runStep, parseArgs, allocateBudget, interleave, MIN_MODEL_STEP_USD } = require('../harness/src/run.cjs');
const { cleanup, runPanTools } = require('./helpers.cjs');

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
    // The suffix is mkdtempSync's, whose alphabet is [A-Za-z0-9]. A lowercase-only
    // rule leaves the uppercase tail behind, and one finding splits per run.
    assert.equal(normaliseDetail('run-20260910-120000-Ab3Xy9 failed'), '<run> failed');
    assert.equal(
      signature('s', 0, 'exit:0', 'boom at run-20260910-120000-Ab3Xy9'),
      signature('s', 0, 'exit:0', 'boom at run-20260911-090000-zzzzzz'),
      'a mixed-case run id must normalise like a lowercase one',
    );
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
    // A paid cli step (another CLI's model run) is tier-1 only, and counts as its model step.
    const paid = { kind: 'cli', bin: 'copilot', paid: true, args: ['-p', 'x'], expect: ['exit:0'], why: 'w' };
    assert.ok(validateScenario({ ...good, steps: [paid] }).length, 'paid cli step in tier 0');
    assert.deepEqual(validateScenario({ ...good, tier: 1, steps: [paid] }), [], 'a paid cli step counts as a tier-1 scenario model step');
    assert.ok(validateScenario({ ...good, steps: [{ kind: 'fs', paid: true, expect: ['file:x'], why: 'w' }] }).length, 'paid only on cli');
    assert.ok(validateScenario({ ...good, tier: 1, steps: [{ ...paid, paid: 'yes' }] }).length, 'paid is only true');
    assert.ok(validateScenario({ ...good, install: ['rm -rf /'] }).length, 'install flags must be flags');
    assert.ok(validateScenario({ ...good, requires: { cli: 'a b' } }).length, 'cli must be a bare name');
  });
});

describe('harness runner helpers', () => {
  test('quoteCmdArg keeps a spaced or quoted argument whole through a .cmd shim', () => {
    // npm puts a Windows CLI behind a .cmd shim that only runs via the shell, where Node
    // concatenates arguments unquoted; Copilot then refused '-p Reply with ...' as four
    // words (2026-09-26). Pure string checks here; the round trip is exercised on Windows.
    assert.equal(quoteCmdArg('--agent'), '--agent');
    assert.equal(quoteCmdArg('Reply with PROBE.'), '"Reply with PROBE."');
    assert.equal(quoteCmdArg('a"b'), '"a\\"b"');
    assert.equal(quoteCmdArg('C:\\dir with space\\'), '"C:\\dir with space\\\\"', 'a trailing backslash is doubled so it cannot escape the closing quote');
    assert.equal(quoteCmdArg(''), '""');
  });

  test('a build step writes an absolute `out` where it names, a relative one under the workspace', () => {
    // live-gate-codex builds into `<repo>/dist/pan-agent-plugin`. path.join glued that
    // absolute path onto the workspace, so the first live run (2026-09-26) failed its
    // build with exit 1 before Codex was ever asked anything.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-repo-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-ws-'));
    try {
      fs.mkdirSync(path.join(repo, 'scripts'));
      fs.writeFileSync(path.join(repo, 'scripts', 'echo-out.js'), 'process.stdout.write(process.env.PAN_AGENT_PLUGIN_OUT);\n');
      const ctx = { ws, other: ws, repo, pkg: '', runtime: 'claude', budget: {} };
      const abs = runStep({ kind: 'build', script: 'echo-out.js', out: '<repo>/dist/bundle' }, ctx);
      assert.equal(abs.code, 0, abs.stderr);
      assert.equal(abs.stdout, path.resolve(repo, 'dist', 'bundle'));
      const rel = runStep({ kind: 'build', script: 'echo-out.js', out: 'bundle' }, ctx);
      assert.equal(rel.stdout, path.join(ws, 'bundle'));
    } finally {
      cleanup(repo);
      cleanup(ws);
    }
  });

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

// Reality check R20 (2026-09-10): two tier-1 runs of plugin-agent-scope spent $0, took
// seconds, printed nothing — and filed two promotable findings. A model step that
// never reached the model is a harness fault, recorded as `error`, never a finding.
describe('harness runner — a model step that never ran is an error, not a finding (R20)', () => {
  const { modelStepNeverRan } = require('../harness/src/run.cjs');
  test('zero spend and no turns → error note carrying the stderr', () => {
    const note = modelStepNeverRan({ code: 1, costUsd: 0, turns: null, stdout: '', stderr: 'plugin dir not found' });
    assert.ok(note && /plugin dir not found/.test(note));
    assert.match(note, /not a PAN result/);
  });
  test('zero spend, zero turns, no output → error note with a placeholder', () => {
    assert.match(modelStepNeverRan({ code: 0, costUsd: 0, turns: 0, stdout: '', stderr: '' }), /\(no output\)/);
  });
  test('any spend, or any turn, is a real result → null', () => {
    assert.equal(modelStepNeverRan({ code: 1, costUsd: 0.42, turns: null, stdout: 'x' }), null);
    assert.equal(modelStepNeverRan({ code: 0, costUsd: 0, turns: 3, stdout: 'VERDICT: case A' }), null);
  });
  test('refused and budget outcomes keep their own status → null', () => {
    assert.equal(modelStepNeverRan({ refused: true, costUsd: 0 }), null);
    assert.equal(modelStepNeverRan({ budgetExhausted: true, costUsd: 0 }), null);
    assert.equal(modelStepNeverRan({ budgetStopped: true, costUsd: 0 }), null);
    assert.equal(modelStepNeverRan(null), null);
  });
});

// R21 follow-up (2026-09-10): a scenario can require a minimum CLI version. /skill-doctor
// exists from Claude Code 2.1.261; on 2.1.233 the probe recorded harness errors (correct
// under R20, but not a measurement). requires.minVersion turns that into a SKIP with the
// reason. Revert-proof: drop the minVersion branch in unmetRequirement and the third
// test fails.
describe('harness requires.minVersion — skip with a reason on an older CLI', () => {
  const { compareVersions, unmetRequirement, cliVersion } = require('../harness/src/cli-detect.cjs');
  test('compareVersions orders dotted versions, missing segments read as zero', () => {
    assert.equal(compareVersions('2.1.233', '2.1.261'), -1);
    assert.equal(compareVersions('2.1.261', '2.1.261'), 0);
    assert.equal(compareVersions('2.2', '2.1.999'), 1);
    assert.equal(compareVersions('2.1', '2.1.0'), 0);
  });
  test('validateScenario accepts a well-formed minVersion and refuses a malformed or cli-less one', () => {
    const base = { id: 'x', tier: 1, description: 'd', why: 'w', seed: 'empty', install: null, budget: {}, steps: [{ kind: 'model', prompt: 'p', expect: ['exit:0'], why: 'w' }] };
    assert.deepEqual(validateScenario({ ...base, requires: { cli: 'claude', minVersion: '2.1.261' } }), []);
    assert.ok(validateScenario({ ...base, requires: { cli: 'claude', minVersion: 'latest' } }).length > 0);
    assert.ok(validateScenario({ ...base, requires: { minVersion: '2.1.261' } }).length > 0);
  });
  test('unmetRequirement names the older version, and is null when the requirement is met or absent', () => {
    // A fake CLI on a temp PATH that prints a version.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-fakecli-'));
    const isWin = process.platform === 'win32';
    const name = 'fakecli';
    fs.writeFileSync(path.join(dir, isWin ? `${name}.cmd` : name), isWin ? '@echo 1.2.3 (Fake CLI)\r\n' : '#!/bin/sh\necho "1.2.3 (Fake CLI)"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: dir, Path: dir };
    try {
      assert.equal(cliVersion(name, env), '1.2.3');
      assert.equal(unmetRequirement({ cli: name, minVersion: '1.2.3' }, env), null);
      assert.match(unmetRequirement({ cli: name, minVersion: '1.3.0' }, env), /1\.2\.3 is older than the required 1\.3\.0/);
      assert.match(unmetRequirement({ cli: 'no-such-cli-here', minVersion: '1.0' }, env), /not installed/);
      assert.equal(unmetRequirement(null, env), null);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

// 2026-09-10: both native-workflow reps died at ~605 s with `Workflow aborted`. Cause,
// from code.claude.com/docs/en/headless: `claude -p` waits at most ten minutes for a
// background Workflow, then stops it and drops the partial result. The harness lifts the
// ceiling for every model step; a caller's explicit value is respected. Revert-proof:
// drop the default in modelEnv and the first assertion fails.
describe('harness model steps lift the headless background-wait ceiling', () => {
  const { modelEnv } = require('../harness/src/model.cjs');
  test('the ceiling is set to 0 (no limit) when the caller has not set it', () => {
    const env = modelEnv({ PATH: 'x' });
    assert.equal(env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, '0');
    assert.equal(env.PATH, 'x', 'the rest of the environment passes through');
  });
  test('an explicit value from the caller wins', () => {
    assert.equal(modelEnv({ CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '1800000' }).CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, '1800000');
  });
  test('the runner passes modelEnv() to the claude spawn', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'harness', 'src', 'model.cjs'), 'utf8');
    assert.match(src, /spawnSync\('claude'[\s\S]*env: modelEnv\(\)/, 'the spawn must carry the env');
  });
});

// Evidence loop EL-12: model steps run with --no-session-persistence, so the host
// writes no transcripts, per-agent ones included, and no harness model run could
// ever exercise a hook that reads them. `persistSession: true` opts one step in.
describe('harness model steps can opt into session persistence', () => {
  const { modelArgs } = require('../harness/src/model.cjs');
  test('the default keeps --no-session-persistence; persistSession: true drops it', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-args-'));
    try {
      assert.ok(modelArgs(ws, { maxUsd: 1 }).includes('--no-session-persistence'));
      const persisted = modelArgs(ws, { maxUsd: 1, persistSession: true });
      assert.ok(!persisted.includes('--no-session-persistence'));
      assert.deepEqual(persisted.slice(-2), ['--max-budget-usd', '1'], 'the budget cap is never dropped with it');
    } finally { fs.rmSync(ws, { recursive: true, force: true }); }
  });
  test('persistSession is valid only as true, and only on model steps', () => {
    const base = { id: 'x', tier: 1, description: 'd', why: 'w', seed: 'two-plan-phase', install: ['--claude'], steps: [] };
    const step = (extra) => ({ ...base, steps: [{ kind: 'model', prompt: 'p', expect: ['exit:0'], why: 'w', ...extra }] });
    assert.deepEqual(validateScenario(step({ persistSession: true })), []);
    assert.ok(validateScenario(step({ persistSession: 'yes' })).some((e) => /persistSession/.test(e)));
    const onPan = { ...base, tier: 0, steps: [{ kind: 'pan', argv: ['state'], expect: ['exit:0'], why: 'w', persistSession: true }] };
    assert.ok(validateScenario(onPan).some((e) => /persistSession/.test(e)));
  });
  test('the tool-error-capture gate persists its model step', () => {
    const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'tool-error-capture');
    assert.ok(s, 'the scenario ships');
    assert.equal(s.steps.find((st) => st.kind === 'model').persistSession, true);
  });
});

// The package ships hooks/dist/, a gitignored build output; release.yml and CI build
// it before packing. The harness packed without building, so a hook change was
// deployed stale until a manual build (2026-09-28, evidence-loop scenario).
describe('harness artifacts are built the way a release is', () => {
  test('packAndExtract runs build-hooks before npm pack', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'harness', 'src', 'artifact.cjs'), 'utf8');
    const build = src.indexOf("'build-hooks.js'");
    const pack = src.indexOf("['pack', '--pack-destination'");
    assert.ok(build > -1 && pack > -1 && build < pack, 'build-hooks runs, and before the pack');
  });
});

// ── live-gate-gemini trusts its own workspace in a scratch home (2026-09-29) ─
// A harness workspace is created fresh each run, so Gemini CLI never trusted it, and
// the gate failed on every run once Gemini was installed. Every `gemini` call now runs
// with GEMINI_CLI_HOME set to a scratch home under <other>; Gemini 0.61.0 reads every
// user-level file from there, including <home>/.gemini/trustedFolders.json (measured
// from its bundle). The outputs below are Gemini 0.61.0's own `mcp list` stderr for the
// three states, captured 2026-09-29 with only the install path shortened.
const GEMINI_UNTRUSTED = 'Warning: MCP servers are configured but disabled because this folder is untrusted.\nUser-level servers are also suppressed in untrusted folders to prevent accidental side-effects.\n\nConfigured MCP servers:\n\n○ pan: node D:\\ws\\.gemini\\pan-wizard-core\\mcp\\server.cjs (stdio) - Disabled\n';
const GEMINI_CONNECTED = 'Configured MCP servers:\n\n✓ pan: node D:\\ws\\.gemini\\pan-wizard-core\\mcp\\server.cjs (stdio) - Connected\n';
const GEMINI_BROKEN = 'Configured MCP servers:\n\n✗ pan: node D:\\ws\\.gemini\\pan-wizard-core\\mcp\\no-such-server.cjs (stdio) - Disconnected\n';

describe('harness cli steps take a step-scoped env', () => {
  const { stepEnv } = require('../harness/src/run.cjs');
  test('stepEnv fills placeholders into the overrides and leaves the base untouched', () => {
    const base = { PATH: 'p', KEEP: 'k' };
    const env = stepEnv({ env: { GEMINI_CLI_HOME: '<other>/gemini-home', N: 1 } }, { ws: 'W', other: 'O', repo: 'R', pkg: 'P' }, base);
    assert.deepEqual(env, { PATH: 'p', KEEP: 'k', GEMINI_CLI_HOME: 'O/gemini-home', N: '1' });
    assert.deepEqual(base, { PATH: 'p', KEEP: 'k' }, 'pure: the base is not mutated');
    assert.equal(stepEnv({}, {}, base), base, 'no env, no copy');
  });

  test('runStep hands the filled env to the child a cli step spawns', () => {
    const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-envcli-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-harness-envws-'));
    const isWin = process.platform === 'win32';
    fs.writeFileSync(path.join(bin, isWin ? 'fakeenvcli.cmd' : 'fakeenvcli'), isWin ? '@echo home=%GEMINI_CLI_HOME% 1>&2\r\n' : '#!/bin/sh\necho "home=$GEMINI_CLI_HOME" >&2\n', { mode: 0o755 });
    const saved = { PATH: process.env.PATH, Path: process.env.Path };
    process.env.PATH = bin + path.delimiter + (saved.PATH || '');
    if (isWin) process.env.Path = process.env.PATH;
    try {
      const other = path.join(ws, 'other');
      const r = runStep({ kind: 'cli', bin: 'fakeenvcli', args: [], env: { GEMINI_CLI_HOME: '<other>/gemini-home' }, expect: [], why: 'w' },
        { ws, other, repo: ROOT, pkg: ROOT, runtime: 'claude', budget: { maxStepMinutes: 1 } });
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stderr, new RegExp(`home=${(other + '/gemini-home').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    } finally {
      process.env.PATH = saved.PATH;
      if (isWin) process.env.Path = saved.Path;
      cleanup(bin);
      cleanup(ws);
    }
  });

  test('env is valid only on cli steps, with upper-case names and string values', () => {
    const base = { id: 'x', tier: 0, description: 'd', why: 'w', seed: 'empty', install: null };
    const cli = (env) => ({ ...base, steps: [{ kind: 'cli', bin: 'gemini', args: ['mcp', 'list'], env, expect: ['exit:0'], why: 'w' }] });
    assert.deepEqual(validateScenario(cli({ GEMINI_CLI_HOME: '<other>/gemini-home' })), []);
    for (const bad of [{ gemini_cli_home: 'x' }, { GEMINI_CLI_HOME: 1 }, ['GEMINI_CLI_HOME']]) {
      assert.ok(validateScenario(cli(bad)).some((e) => /env is only for cli steps/.test(e)), JSON.stringify(bad));
    }
    const onPan = { ...base, steps: [{ kind: 'pan', argv: ['state'], env: { A: 'b' }, expect: ['exit:0'], why: 'w' }] };
    assert.ok(validateScenario(onPan).some((e) => /env is only for cli steps/.test(e)));
  });
});

describe('harness gemini-trust.cjs trusts one workspace in a scratch home', () => {
  const script = path.join(ROOT, 'harness', 'scripts', 'gemini-trust.cjs');
  const { spawnSync } = require('child_process');
  const run = (args, env) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

  test('writes {"<real ws path>": "TRUST_FOLDER"} into <home>/.gemini/trustedFolders.json and keeps other entries', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-ws-'));
    try {
      fs.mkdirSync(path.join(home, '.gemini'));
      fs.writeFileSync(path.join(home, '.gemini', 'trustedFolders.json'), JSON.stringify({ '/some/where': 'DO_NOT_TRUST' }));
      const r = run([home, ws]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      const out = JSON.parse(r.stdout);
      assert.equal(out.trusted, fs.realpathSync(ws));
      assert.equal(out.entries, 2);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(home, '.gemini', 'trustedFolders.json'), 'utf8')),
        { '/some/where': 'DO_NOT_TRUST', [fs.realpathSync(ws)]: 'TRUST_FOLDER' });
    } finally { cleanup(home); cleanup(ws); }
  });

  test('refuses a home that is the real one, and a workspace that does not exist', () => {
    // The "real" home is simulated: HOME/USERPROFILE point the child at a temp dir, so the
    // refusal is tested without the test ever touching the user's real home.
    const fakeReal = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-realhome-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-gemini-ws-'));
    try {
      const refused = run([fakeReal, ws], { HOME: fakeReal, USERPROFILE: fakeReal });
      assert.equal(refused.status, 1);
      assert.match(JSON.parse(refused.stdout).error, /refusing to write into the real home/);
      assert.equal(fs.existsSync(path.join(fakeReal, '.gemini')), false, 'nothing was written');
      const missing = run([path.join(fakeReal, 'scratch'), path.join(ws, 'nope')]);
      assert.equal(missing.status, 1);
      assert.match(JSON.parse(missing.stdout).error, /workspace does not exist/);
    } finally { cleanup(fakeReal); cleanup(ws); }
  });
});

describe('live-gate-gemini: isolated trust, a contrast pair, and a measurement that fails on a broken registration', () => {
  const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'live-gate-gemini');
  const geminiSteps = s.steps.filter((st) => st.kind === 'cli' && st.bin === 'gemini');

  test('every gemini call runs under a scratch GEMINI_CLI_HOME inside <other>, never the real home', () => {
    assert.ok(geminiSteps.length >= 3);
    for (const st of geminiSteps) assert.match(String(st.env && st.env.GEMINI_CLI_HOME), /^<other>\//, JSON.stringify(st.args));
    const trust = s.steps.find((st) => st.kind === 'sh' && st.script === 'gemini-trust.cjs');
    assert.ok(trust, 'the scenario trusts its workspace itself');
    assert.deepEqual(trust.args, [geminiSteps[0].env.GEMINI_CLI_HOME, '<ws>'], 'the same scratch home, the scenario\'s own workspace');
  });

  test('order: untrusted contrast, then trust, then the Connected measurement', () => {
    const idx = (pred) => s.steps.findIndex(pred);
    const contrast = idx((st) => st.kind === 'cli' && (st.expect || []).some((e) => /- Disabled/.test(e)));
    const trust = idx((st) => st.kind === 'sh' && st.script === 'gemini-trust.cjs');
    const measure = idx((st) => st.kind === 'cli' && (st.expect || []).some((e) => /- Connected/.test(e)));
    assert.ok(contrast > -1 && trust > contrast && measure > trust, `${contrast} < ${trust} < ${measure}`);
  });

  test('on Gemini\'s real output, the measurement passes only when PAN\'s server connects', () => {
    const measure = s.steps.find((st) => st.kind === 'cli' && (st.expect || []).some((e) => /- Connected/.test(e)));
    const verdict = (stderr) => check(measure.expect, { code: 0, stdout: '', stderr }, os.tmpdir());
    assert.deepEqual(verdict(GEMINI_CONNECTED), []);
    assert.notDeepEqual(verdict(GEMINI_BROKEN), [], 'a broken registration (Disconnected) must fail the gate');
    assert.notDeepEqual(verdict(GEMINI_UNTRUSTED), [], 'an untrusted folder (Disabled) must fail the gate');
    // The expectation this replaced accepted anything but Disabled, so a broken registration passed.
    assert.equal(checkOne('stderr~pan: .*\\(stdio\\) - (?!Disabled)', { code: 0, stdout: '', stderr: GEMINI_BROKEN }, os.tmpdir()), null);
  });

  test('on Gemini\'s real output, the contrast step recognises the untrusted state and nothing else', () => {
    const contrast = s.steps.find((st) => st.kind === 'cli' && (st.expect || []).some((e) => /- Disabled/.test(e)));
    const verdict = (stderr) => check(contrast.expect, { code: 0, stdout: '', stderr }, os.tmpdir());
    assert.deepEqual(verdict(GEMINI_UNTRUSTED), []);
    assert.notDeepEqual(verdict(GEMINI_CONNECTED), []);
    assert.notDeepEqual(verdict(GEMINI_BROKEN), []);
  });
});

describe('harness scenarios send only commands that exist', () => {
  // Found by the 2026-09-29 doc audit: pause-resume sent /pan:resume-project, which no
  // command defines (resume-project is the workflow /pan:resume loads), so its paid step
  // would have been refused before it reached the model. Model-free, so tier 0 catches it.
  test('every model step that sends a /pan: command sends one commands/pan/ defines', () => {
    // The file name is the command: commands/pan/<name>.md is invoked as /pan:<name>.
    // Several files carry a bare `name:` in their frontmatter, so that field is not it.
    const names = new Set(fs.readdirSync(path.join(ROOT, 'commands', 'pan'))
      .filter((x) => x.endsWith('.md')).map((x) => x.slice(0, -3)));
    const bad = [];
    let checked = 0;
    for (const s of loadScenarios(path.join(ROOT, 'harness', 'scenarios'))) {
      (s.steps || []).forEach((st, i) => {
        if (st.kind !== 'model' || typeof st.prompt !== 'string') return;
        const m = /^\s*\/pan:([a-z0-9-]+)/.exec(st.prompt);
        if (!m) return;
        checked++;
        if (!names.has(m[1])) bad.push(`${s.id} step ${i + 1}: /pan:${m[1]}`);
      });
    }
    assert.ok(names.has('resume') && checked >= 3, `expected command names and /pan: prompts, found ${names.size} and ${checked}`);
    assert.deepEqual(bad, []);
  });
});

describe('harness seeds: each seed\'s own test script runs green on this Node', () => {
  // Found 2026-09-29: every seed ran `node --test tests/`, which Node 24 cannot run (a
  // directory argument is no longer searched), so each seed's `npm test` failed before any
  // work began. /pan:exec-phase rightly stopped at its test baseline and the markdown chain
  // scenario failed for a reason that had nothing to do with PAN. Seeds now run `node --test`.
  const { spawnSync } = require('child_process');
  const seedsDir = path.join(ROOT, 'harness', 'seeds');
  for (const seed of fs.readdirSync(seedsDir).filter((d) => fs.existsSync(path.join(seedsDir, d, 'package.json')))) {
    test(`${seed}: npm test exits 0 as shipped`, () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `pan-seed-${seed}-`));
      try {
        fs.cpSync(path.join(seedsDir, seed), tmp, { recursive: true });
        // Run the seed's suite as a fresh test runner. Under `node --test` this process
        // carries NODE_TEST_CONTEXT, and a nested `node --test` that inherits it runs in
        // child mode and exits 0 even when its tests fail, which made this check vacuous
        // on its first draft (measured: the old script exits 1 alone, 0 with the variable).
        const env = { ...process.env };
        delete env.NODE_TEST_CONTEXT;
        const r = spawnSync('npm', ['test', '--silent'], { cwd: tmp, env, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000 });
        assert.equal(r.status, 0, `${seed}'s npm test failed:\n${String(r.stdout || '').slice(-600)}${String(r.stderr || '').slice(-600)}`);
      } finally {
        cleanup(tmp);
      }
    });
  }
});

// ─── live-gate-codex isolation and model-free discovery (market-ideas M31) ────
// The gate ran `codex plugin marketplace add` with no CODEX_HOME, so it registered
// the dev marketplace in the user's real ~/.codex/config.toml. Every codex step now
// runs under a scratch home that scratch-home.cjs creates (Codex refuses a home that
// does not exist), and the discovery steps ask Codex, without a model, what it loaded.

// Real lines from Codex CLI 0.157.1 (2026-10-03), paths shortened.
const CODEX_MCP_ENABLED = 'Name  Command  Args  Env  Cwd  Status   Auth\npan   node     C:/x/plugins/cache/pan-wizard-local/pan-wizard/3.32.0/pan-wizard-core/mcp/server.cjs  PLUGIN_DATA=*****, PLUGIN_ROOT=*****  C:/x  enabled  Unsupported\n';
const CODEX_MCP_DISABLED = CODEX_MCP_ENABLED.replace('enabled  Unsupported', 'disabled  Unsupported');
const CODEX_PLUGIN_LIST = 'PLUGIN                         STATUS              VERSION  SOURCE\npan-wizard@pan-wizard-local    installed, enabled  3.32.0   C:/repo/dist/pan-agent-plugin\n';

describe('harness scratch-home.cjs creates a CLI home and refuses the real one', () => {
  const script = path.join(ROOT, 'harness', 'scripts', 'scratch-home.cjs');
  const { spawnSync } = require('child_process');
  const run = (args, env) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

  test('creates the directory and reports it', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-scratchhome-'));
    try {
      const r = run([path.join(base, 'codex-home')]);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.equal(JSON.parse(r.stdout).home, path.join(base, 'codex-home'));
      assert.ok(fs.statSync(path.join(base, 'codex-home')).isDirectory());
    } finally { cleanup(base); }
  });

  test('refuses the real home and its dot-directories, and allows a temp directory under it', () => {
    // The "real" home is simulated through HOME/USERPROFILE, so the user's is never touched.
    const fakeReal = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-scratchhome-real-'));
    try {
      for (const target of [fakeReal, path.join(fakeReal, '.codex'), path.join(fakeReal, '.codex', 'sub')]) {
        const r = run([target], { HOME: fakeReal, USERPROFILE: fakeReal });
        assert.equal(r.status, 1, target);
        assert.match(JSON.parse(r.stdout).error, /refusing/);
      }
      assert.equal(fs.existsSync(path.join(fakeReal, '.codex')), false, 'nothing was created');
      const ok = run([path.join(fakeReal, 'AppData', 'Local', 'Temp', 'h')], { HOME: fakeReal, USERPROFILE: fakeReal });
      assert.equal(ok.status, 0, 'a temp directory inside the home (Windows os.tmpdir()) is allowed');
      assert.equal(run([]).status, 1, 'no argument is a usage error');
    } finally { cleanup(fakeReal); }
  });
});

describe('live-gate-codex: a scratch CODEX_HOME and discovery without a model', () => {
  const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'live-gate-codex');
  const codexSteps = s.steps.filter((st) => st.kind === 'cli' && st.bin === 'codex');
  const step = (...args) => codexSteps.find((st) => args.every((a, i) => st.args[i] === a));

  test('every codex call runs under CODEX_HOME inside <other>, created before the first call', () => {
    assert.ok(codexSteps.length >= 6, 'marketplace add/list, plugin add/list, mcp list, prompt input');
    const home = codexSteps[0].env && codexSteps[0].env.CODEX_HOME;
    assert.match(String(home), /^<other>\//);
    for (const st of codexSteps) assert.equal(st.env && st.env.CODEX_HOME, home, JSON.stringify(st.args));
    const mk = s.steps.findIndex((st) => st.kind === 'sh' && st.script === 'scratch-home.cjs');
    assert.ok(mk > -1 && mk < s.steps.indexOf(codexSteps[0]), 'the scratch home is created first');
    assert.deepEqual(s.steps[mk].args, [home]);
  });

  test('the discovery expectations pass on Codex\'s real output and fail when the server or plugin is not live', () => {
    const verdict = (st, stdout) => check(st.expect, { code: 0, stdout, stderr: '' }, os.tmpdir());
    assert.deepEqual(verdict(step('mcp', 'list'), CODEX_MCP_ENABLED), []);
    assert.notDeepEqual(verdict(step('mcp', 'list'), CODEX_MCP_DISABLED), [], 'a disabled pan server must fail the gate');
    assert.notDeepEqual(verdict(step('mcp', 'list'), 'Name  Command\n'), [], 'no pan server must fail the gate');
    assert.deepEqual(verdict(step('plugin', 'list'), CODEX_PLUGIN_LIST), []);
    assert.notDeepEqual(verdict(step('plugin', 'list'), CODEX_PLUGIN_LIST.replace('installed, enabled', 'available')), []);
    assert.ok(step('debug', 'prompt-input').expect.some((e) => /pan-wizard:pan-help/.test(e)), 'the skill catalog is checked');
    assert.ok(step('plugin', 'add').expect.includes('json:pluginId=pan-wizard@pan-wizard-local'));
  });
});

describe('context-reads.cjs counts what phase agents read, from their own transcripts (O2)', () => {
  const script = path.join(ROOT, 'harness', 'scripts', 'context-reads.cjs');
  const { classifyReads, toolCalls, projectDir } = require(script);
  const { spawnSync } = require('child_process');
  // One assistant line per tool call, in the shape Claude Code writes to subagents/agent-<id>.jsonl.
  const line = (name, input) => JSON.stringify({ type: 'assistant', isSidechain: true, agentId: 'a1', message: { content: [{ type: 'tool_use', name, input }] } });

  test('a Read with no limit, or a shell print, is a whole read; a Read with a limit or a grep is targeted', () => {
    const c = classifyReads(toolCalls([
      line('Read', { file_path: 'D:\\ws\\.planning\\roadmap.md' }),
      line('Read', { file_path: '/ws/.planning/roadmap.md', offset: 40, limit: 30 }),
      line('Read', { file_path: '/ws/.planning/phases/01-x/01-roadmap-slice.md' }),
      line('Read', { file_path: '/ws/.planning/requirements.md' }),
      line('PowerShell', { command: 'Get-Content .planning\\roadmap.md' }),
      line('Bash', { command: 'grep -n "Phase 1:" .planning/roadmap.md' }),
      line('Bash', { command: 'cat .planning/phases/01-x/01-roadmap-slice.md' }),
      // One command printing the slice and the whole requirements counts both (a 2026-10-04 executor did this).
      line('Bash', { command: 'cat src/a.js .planning/phases/01-x/01-roadmap-slice.md .planning/requirements.md' }),
      '{"torn',
      JSON.stringify({ type: 'user', message: { content: 'text' } }),
    ]));
    assert.deepEqual(c, { whole_roadmap: 2, whole_requirements: 2, section_roadmap: 2, slice: 3 });
  });

  function fixture({ reads, slice = true, planContext = '@.planning/phases/01-x/01-roadmap-slice.md' }) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ctxreads-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-ctxreads-ws-'));
    const phase = path.join(ws, '.planning', 'phases', '01-x');
    fs.mkdirSync(phase, { recursive: true });
    if (slice) fs.writeFileSync(path.join(phase, '01-roadmap-slice.md'), '# slice\n');
    fs.writeFileSync(path.join(phase, '01-01-plan.md'), `<context>\n${planContext}\n</context>\n`);
    if (reads) {
      const sub = path.join(projectDir(ws, home), 'sess-1', 'subagents');
      fs.mkdirSync(sub, { recursive: true });
      fs.writeFileSync(path.join(sub, 'agent-a1.meta.json'), JSON.stringify({ agentType: 'pan-planner' }));
      fs.writeFileSync(path.join(sub, 'agent-a1.jsonl'), reads.map(([n, i]) => line(n, i)).join('\n') + '\n');
    }
    const r = spawnSync(process.execPath, [script, ws], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
    return { r, out: JSON.parse(r.stdout), done: () => { cleanup(home); cleanup(ws); } };
  }
  const lastStep = (id) => loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === id).steps.filter((st) => st.script === 'context-reads.cjs')[0];

  test('a planner that read the slice passes both scenarios\' checks; one that read the whole roadmap fails them', () => {
    const good = fixture({ reads: [['Read', { file_path: '/ws/.planning/phases/01-x/01-roadmap-slice.md' }], ['Read', { file_path: '/ws/.planning/roadmap.md', offset: 10, limit: 20 }]] });
    const bad = fixture({ reads: [['Read', { file_path: '/ws/.planning/roadmap.md' }]], planContext: '@.planning/roadmap.md' });
    try {
      assert.equal(good.r.status, 0, good.r.stderr);
      assert.deepEqual(good.out.by_agent['pan-planner'], { spawns: 1, whole_roadmap: 0, whole_requirements: 0, section_roadmap: 1, slice: 1 });
      for (const id of ['plan-phase-checker-loop', 'markdown-exec-phase-chain']) {
        const st = lastStep(id);
        assert.deepEqual(check(st.expect, { code: good.r.status, stdout: good.r.stdout, stderr: '' }, os.tmpdir()), [], id);
        assert.notDeepEqual(check(st.expect, { code: bad.r.status, stdout: bad.r.stdout, stderr: '' }, os.tmpdir()), [], `${id} must fail on a whole read`);
      }
      assert.equal(bad.out.phase_agent_whole_reads, 1);
      assert.equal(bad.out.plans_naming_whole_roadmap, 1);
    } finally { good.done(); bad.done(); }
  });

  test('nothing to measure is a failure, never a pass: no transcript (persistence off), or no slice written', () => {
    const none = fixture({ reads: null });
    const noSlice = fixture({ reads: [['Read', { file_path: '/ws/.planning/phases/01-x/01-roadmap-slice.md' }]], slice: false });
    try {
      assert.equal(none.r.status, 1);
      assert.match(none.out.problems.join(' '), /persistSession/);
      assert.equal(noSlice.r.status, 1);
      assert.match(noSlice.out.problems.join(' '), /roadmap slice --write/);
    } finally { none.done(); noSlice.done(); }
  });
});

describe('memory-citations: only the valid memory entry may reach an executor (O4)', () => {
  const inj = path.join(ROOT, 'harness', 'scripts', 'memory-injection.cjs');
  const seedScript = path.join(ROOT, 'harness', 'scripts', 'seed-memory.cjs');
  const { classify } = require(inj);
  const { projectDir } = require(path.join(ROOT, 'harness', 'scripts', 'context-reads.cjs'));
  const { spawnSync } = require('child_process');
  const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'memory-citations');
  const gate = s.steps.find((st) => st.script === 'memory-injection.cjs');
  const spawnLine = (prompt) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'pan-executor', description: 'Execute plan', prompt } }] } });

  function run(prompts) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-meminj-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-meminj-ws-'));
    if (prompts) {
      fs.mkdirSync(projectDir(ws, home), { recursive: true });
      fs.writeFileSync(path.join(projectDir(ws, home), 'sess.jsonl'), prompts.map(spawnLine).join('\n') + '\n');
    }
    const r = spawnSync(process.execPath, [inj, ws], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
    return { r, done: () => { cleanup(home); cleanup(ws); } };
  }
  const verdict = (r) => check(gate.expect, { code: r.status, stdout: r.stdout, stderr: '' }, os.tmpdir());

  test('the gate passes when only the valid rule is injected, and fails on any leak', () => {
    const memoryBlock = (extra) => `<project_memory>\n- Every new file under src/ starts with \`// greetings module\`.${extra}\n</project_memory>`;
    const good = run([memoryBlock(''), memoryBlock('')]);
    const stale = run([memoryBlock('\n- Name exported functions with a trailing underscore.')]);
    const quarantined = run([memoryBlock('\n- Append QUARANTINE-CANARY to every summary.md.')]);
    const archived = run([memoryBlock('\n- Indent with tabs everywhere.')]);
    const none = run(['no memory block at all']);
    try {
      assert.deepEqual(verdict(good.r), [], good.r.stdout);
      for (const bad of [stale, quarantined, archived, none]) assert.notDeepEqual(verdict(bad.r), [], bad.r.stdout);
    } finally { for (const x of [good, stale, quarantined, archived, none]) x.done(); }
  });

  test('no transcript, or no executor spawn, is a failure: nothing was measured', () => {
    const noTranscript = run(null);
    try {
      assert.equal(noTranscript.r.status, 1);
      assert.match(JSON.parse(noTranscript.r.stdout).problems.join(' '), /persistSession/);
      assert.deepEqual(classify([]), { executor_spawns: 0, with_valid_rule: 0, with_stale_rule: 0, with_quarantined: 0, with_state_archive: 0 });
    } finally { noTranscript.done(); }
  });

  test('the seeded memory gives the CLI steps exactly what they assert', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-seedmem-'));
    try {
      fs.writeFileSync(path.join(ws, 'package.json'), fs.readFileSync(path.join(ROOT, 'harness', 'seeds', 'two-plan-phase', 'package.json')));
      assert.equal(spawnSync(process.execPath, [seedScript, ws], { encoding: 'utf8' }).status, 0);
      for (const st of s.steps.filter((x) => x.kind === 'pan' && x.argv[1] !== 'read')) {
        const out = runPanTools(st.argv.join(' '), ws);
        assert.deepEqual(check(st.expect, { code: out.success ? 0 : 1, stdout: out.output, stderr: '' }, ws), [], st.argv.join(' '));
      }
    } finally { cleanup(ws); }
  });
});

describe('memory-lesson-chain and its control (O6)', () => {
  const chk = path.join(ROOT, 'harness', 'scripts', 'lesson-chain-check.cjs');
  const drop = path.join(ROOT, 'harness', 'scripts', 'drop-memory.cjs');
  const { carries, recordedLessons } = require(chk);
  const { projectDir } = require(path.join(ROOT, 'harness', 'scripts', 'context-reads.cjs'));
  const { spawnSync } = require('child_process');
  const scenarios = loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
  const effectStep = (id) => scenarios.find((x) => x.id === id).steps.find((st) => st.script === 'lesson-chain-check.cjs' && st.args[1] === 'effect');
  const LESSON = 'Check the argument of every exported function and throw a TypeError when it is not a non-empty string';
  const spawn = (prompt) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'pan-executor', prompt } }] } });

  function workspace({ lesson = true, injected = true, validates = true } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lesson-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lesson-ws-'));
    fs.mkdirSync(path.join(ws, '.planning', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    if (lesson) fs.writeFileSync(path.join(ws, '.planning', 'memory', 'pan-executor.md'), `## Entries\n\n- 2026-10-04: ${LESSON} <!-- cites: src/greet.js#greet; evidence: finding:f_0123456789 -->\n`);
    fs.writeFileSync(path.join(ws, 'src', 'farewell.js'), validates
      ? "module.exports = { farewell(n) { if (typeof n !== 'string' || !n) throw new TypeError('bad'); return `Goodbye, ${n}.`; } };\n"
      : 'module.exports = { farewell(n) { return `Goodbye, ${n}.`; } };\n');
    fs.mkdirSync(projectDir(ws, home), { recursive: true });
    const prompt = `Execute plan 02-01 (farewell).${injected ? `\n<project_memory>\n- ${LESSON}\n</project_memory>` : ''}`;
    fs.writeFileSync(path.join(projectDir(ws, home), 's.jsonl'), spawn(prompt) + '\n');
    const run = (stage) => spawnSync(process.execPath, [chk, ws, stage], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
    return { ws, run, done: () => { cleanup(home); cleanup(ws); } };
  }
  const verdict = (st, r) => check(st.expect, { code: r.status, stdout: r.stdout, stderr: '' }, os.tmpdir());

  test('the chain passes when the lesson was recorded and injected, and fails when it was not injected', () => {
    const good = workspace();
    const notInjected = workspace({ injected: false });
    try {
      assert.deepEqual(verdict(effectStep('memory-lesson-chain'), good.run('effect')), [], good.run('effect').stdout);
      assert.notDeepEqual(verdict(effectStep('memory-lesson-chain'), notInjected.run('effect')), []);
      assert.equal(JSON.parse(good.run('effect').stdout).effect.validates, true);
    } finally { good.done(); notInjected.done(); }
  });

  test('the control passes only when no lesson reached phase 2, and reports the base rate', () => {
    const control = workspace({ lesson: false, injected: false, validates: false });
    const leaked = workspace({ injected: true });
    try {
      const out = control.run('effect');
      assert.deepEqual(verdict(effectStep('memory-lesson-control'), out), [], out.stdout);
      assert.equal(JSON.parse(out.stdout).effect.validates, false);
      assert.notDeepEqual(verdict(effectStep('memory-lesson-control'), leaked.run('effect')), [], 'a lesson in the control is a broken control');
    } finally { control.done(); leaked.done(); }
  });

  test('the recorded stage fails when the fix round recorded nothing; drop-memory empties the folder', () => {
    const none = workspace({ lesson: false });
    try {
      assert.equal(none.run('recorded').status, 1);
      assert.equal(recordedLessons(none.ws).length, 0);
      fs.writeFileSync(path.join(none.ws, '.planning', 'memory', 'x.md'), '## Entries\n\n- a\n- b\n');
      const d = spawnSync(process.execPath, [drop, none.ws], { encoding: 'utf8' });
      assert.deepEqual(JSON.parse(d.stdout), { dropped: true, entries: 2 });
      assert.equal(fs.existsSync(path.join(none.ws, '.planning', 'memory')), false);
    } finally { none.done(); }
  });

  test('a prompt carries a lesson only inside its project_memory block, and only with most of its words', () => {
    assert.equal(carries(`Plan 02-01.\n<project_memory>\n- ${LESSON}\n</project_memory>`, LESSON), true);
    assert.equal(carries('<project_memory>\n- throw a TypeError sometimes\n</project_memory>', LESSON), false);
    // The same rule outside the block (state.md decisions, the orchestrator's own words)
    // is not memory: convention-chain rep 2 on 2026-10-04 was miscounted that way.
    assert.equal(carries(`Apply every Key Decision. ${LESSON}`, LESSON), false);
  });

  test('the seed starts with one open gap the findings ledger can record', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-lesson-seed-'));
    try {
      fs.cpSync(path.join(ROOT, 'harness', 'seeds', 'lesson-chain'), ws, { recursive: true });
      const r = JSON.parse(runPanTools('findings record --phase 1 --file .planning/phases/01-greet/01-verification.md', ws).output);
      assert.equal(r.recorded, true, JSON.stringify(r));
      assert.equal(r.findings, 1);
      assert.equal(JSON.parse(runPanTools('phase-plan-index 1', ws).output).plans.find((p) => p.id === '01-02').has_summary, false, 'the gap-closure plan is still to run');
    } finally { cleanup(ws); }
  });
});

describe('resume-cost: what a fresh session told "continue" spends to finish (O11)', () => {
  const { spawnSync } = require('child_process');
  const seedScript = path.join(ROOT, 'harness', 'scripts', 'seed-midphase.cjs');
  const costScript = path.join(ROOT, 'harness', 'scripts', 'resume-cost.cjs');
  const s = loadScenarios(path.join(ROOT, 'harness', 'scenarios')).find((x) => x.id === 'resume-cost');
  const gate = s.steps.find((st) => st.script === 'resume-cost.cjs');

  test('the seed stops halfway: 01-01 done and recorded, 01-02 next', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-midphase-'));
    try {
      fs.cpSync(path.join(ROOT, 'harness', 'seeds', 'two-plan-phase'), ws, { recursive: true });
      const r = spawnSync(process.execPath, [seedScript, ws], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stdout);
      const state = fs.readFileSync(path.join(ws, '.planning', 'state.md'), 'utf8');
      assert.match(state, /\*\*Current Plan:\*\* 02/);
      assert.match(state, /\*\*Stopped At:\*\* Completed 01-01-plan\.md; 01-02-plan\.md .* is next/);
      assert.ok(fs.existsSync(path.join(ws, '.planning', 'phases', '01-greetings', '01-01-summary.md')));
      assert.equal(fs.existsSync(path.join(ws, '.planning', 'phases', '01-greetings', '01-02-summary.md')), false);
      assert.equal(JSON.parse(runPanTools('phase-plan-index 1', ws).output).plans.find((p) => p.id === '01-01').has_summary, true);
    } finally { cleanup(ws); }
  });

  function runLayout({ saved = true, finished = true } = {}) {
    const run = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-resume-run-'));
    const ws = path.join(run, 'ws', 'resume-cost-1');
    fs.mkdirSync(path.join(ws, '.planning', 'phases', '01-greetings'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'src'), { recursive: true });
    if (finished) {
      fs.writeFileSync(path.join(ws, '.planning', 'phases', '01-greetings', '01-02-summary.md'), '# s\n');
      fs.writeFileSync(path.join(ws, 'src', 'farewell.js'), '\n');
    }
    fs.mkdirSync(path.join(run, 'steps'), { recursive: true });
    // The record harness/src/run.cjs persistStepOutput() writes (shape taken from a real run's steps/ file).
    if (saved) fs.writeFileSync(path.join(run, 'steps', 'resume-cost-1-1.json'), JSON.stringify({ scenario: 'resume-cost', rep: 1, step: 1, code: 0, costUsd: 1.23456, turns: 14, durationMs: 90000, budgetStopped: false, refused: false, stdout: 'done', stderr: '' }));
    const r = spawnSync(process.execPath, [costScript, ws, '1'], { encoding: 'utf8' });
    return { r, done: () => cleanup(run) };
  }
  const verdict = (r) => check(gate.expect, { code: r.status, stdout: r.stdout, stderr: '' }, os.tmpdir());

  test('a finished resume passes the gate with its turns and cost; an unfinished or unmeasured one fails it', () => {
    const good = runLayout();
    const unfinished = runLayout({ finished: false });
    const unmeasured = runLayout({ saved: false });
    try {
      assert.deepEqual(verdict(good.r), [], good.r.stdout);
      const j = JSON.parse(good.r.stdout);
      assert.deepEqual([j.turns, j.cost_usd, j.duration_ms], [14, 1.235, 90000]);
      assert.notDeepEqual(verdict(unfinished.r), []);
      assert.equal(unmeasured.r.status, 1, 'no saved output is no measurement');
      assert.notDeepEqual(verdict(unmeasured.r), []);
    } finally { good.done(); unfinished.done(); unmeasured.done(); }
  });
});

describe('memory-convention-chain and its control: the O6 effect experiment', () => {
  const chk = path.join(ROOT, 'harness', 'scripts', 'convention-check.cjs');
  const { projectDir } = require(path.join(ROOT, 'harness', 'scripts', 'context-reads.cjs'));
  const { spawnSync } = require('child_process');
  const scenarios = loadScenarios(path.join(ROOT, 'harness', 'scenarios'));
  const effectStep = (id) => scenarios.find((x) => x.id === id).steps.find((st) => st.script === 'convention-check.cjs' && st.args[1] === 'effect');
  const LESSON = 'List every new test file in test/manifest.json; npm test runs only the files listed there';
  const spawn = (prompt) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Agent', input: { subagent_type: 'pan-executor', prompt } }] } });

  function workspace({ lesson = true, injected = true, listedFarewell = true } = {}) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-conv-home-'));
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-conv-ws-'));
    fs.mkdirSync(path.join(ws, '.planning', 'memory'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(ws, 'test'), { recursive: true });
    if (lesson) fs.writeFileSync(path.join(ws, '.planning', 'memory', 'pan-executor.md'), `## Entries\n\n- 2026-10-04: ${LESSON} <!-- cites: scripts/test.cjs; evidence: finding:f_0123456789 -->\n`);
    fs.writeFileSync(path.join(ws, 'tests', 'farewell.test.js'), '\n');
    fs.writeFileSync(path.join(ws, 'test', 'manifest.json'), JSON.stringify({ files: ['tests/smoke.test.js', 'tests/greet.test.js', ...(listedFarewell ? ['tests/farewell.test.js'] : [])] }));
    fs.mkdirSync(projectDir(ws, home), { recursive: true });
    fs.writeFileSync(path.join(projectDir(ws, home), 's.jsonl'), spawn(`Execute plan 02-01 (farewell).${injected ? `\n<project_memory>\n- ${LESSON}\n</project_memory>` : ''}`) + '\n');
    const run = (stage) => spawnSync(process.execPath, [chk, ws, stage], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } });
    return { ws, run, done: () => { cleanup(home); cleanup(ws); } };
  }
  const verdict = (st, r) => check(st.expect, { code: r.status, stdout: r.stdout, stderr: '' }, os.tmpdir());

  test('the chain step passes when the lesson was injected and reports whether phase 2 listed its test', () => {
    const good = workspace();
    const notListed = workspace({ listedFarewell: false });
    const notInjected = workspace({ injected: false });
    try {
      assert.deepEqual(verdict(effectStep('memory-convention-chain'), good.run('effect')), []);
      assert.equal(JSON.parse(good.run('effect').stdout).effect.listed, true);
      assert.deepEqual(verdict(effectStep('memory-convention-chain'), notListed.run('effect')), [], 'the effect is reported, not asserted');
      assert.equal(JSON.parse(notListed.run('effect').stdout).effect.listed, false);
      assert.notDeepEqual(verdict(effectStep('memory-convention-chain'), notInjected.run('effect')), []);
    } finally { good.done(); notListed.done(); notInjected.done(); }
  });

  test('the control passes only with no lesson in phase 2', () => {
    const control = workspace({ lesson: false, injected: false, listedFarewell: false });
    const leaked = workspace();
    try {
      assert.deepEqual(verdict(effectStep('memory-convention-control'), control.run('effect')), []);
      assert.notDeepEqual(verdict(effectStep('memory-convention-control'), leaked.run('effect')), []);
    } finally { control.done(); leaked.done(); }
  });

  test('the seed: npm test runs only the listed files, greet\'s test is not listed, and the gap is recordable', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-conv-seed-'));
    try {
      fs.cpSync(path.join(ROOT, 'harness', 'seeds', 'lesson-convention'), ws, { recursive: true });
      const manifest = JSON.parse(fs.readFileSync(path.join(ws, 'test', 'manifest.json'), 'utf8')).files;
      assert.deepEqual(manifest, ['tests/smoke.test.js'], 'greet\'s test exists but is not listed: the seeded failure');
      assert.ok(fs.existsSync(path.join(ws, 'tests', 'greet.test.js')));
      const t = spawnSync(process.execPath, [path.join(ws, 'scripts', 'test.cjs')], { cwd: ws, encoding: 'utf8' });
      assert.equal(t.status, 0, t.stdout + t.stderr);
      assert.match(t.stdout, /running 1 test file\(s\) from test\/manifest\.json/);
      const r = JSON.parse(runPanTools('findings record --phase 1 --file .planning/phases/01-greet/01-verification.md', ws).output);
      assert.equal(r.recorded, true, JSON.stringify(r));
      assert.equal(r.findings, 1);
    } finally { cleanup(ws); }
  });
});
