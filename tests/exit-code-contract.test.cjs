// Exit-code contract for output() (pan-wizard-core/bin/lib/core.cjs).
//
// The defect this file pins: every `output({ error: … })` site used to exit 0, so
// `pan-tools state json` in a project with no state.md printed
// {"error":"state.md not found"} and reported SUCCESS. Any orchestrator, hook, CI
// step or autonomous loop gating on the exit code could not see the failure — the
// same dead-gate class as `campaign due`, `verify stubs --gate`, `learn lint` and
// `verify reconcile`.
//
// The rule now lives in ONE place — output() derives the code from the payload:
//   truthy ERROR-FAMILY key → exit 1    (`error` or `*_error`: a real failure or a
//                                        deliberate refusal)
//   EXIT_OK passed          → exit 0    (a legitimate empty/negative RESULT)
//   explicit exitCode       → that code (gates/verdicts with no error-family key)
//
// The FIRST version of this fix matched the literal key name `error`, which scoped the
// class by grep pattern instead of by meaning. Three shapes escaped, and each has its
// own block below:
//   • `<verb>: false` + a `reason`/`detail`  — git.cjs commit_failed, state.cjs writes
//   • a RENAMED error key (`worktree_error`) — whatif prepare, three lines under a
//                                             guard that handled `ctx.error` correctly
//   • a verdict thrown away by output()      — doc-lint's process.exit() dead code
// The `<verb>: false` shape is NOT inferred structurally: the identical shape carries
// legitimate negative answers (`nothing_to_commit`, `last_plan`, `found: false`), so a
// structural rule would invent false failures. Each site is classified by its author
// and the classification is recorded in the payload. Both halves are pinned here —
// the failures AND the answers.
//
// These tests run the REAL CLI in a child process and read the REAL exit code.
// Testing the pure functions was the previous audit chain's blind spot: the
// functions were right while the exit path stayed broken.
//
// If output()'s derivation is reverted to the old `exitCode = 0` default, the first
// failing assertion is "an error payload exits 1" in the `output() derives the exit
// code from the payload` block below — it spawns core.cjs directly, so it fails even
// if every command in the CLI is refactored away.

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
// execSync is used only with fixed literal git commands (no interpolation into the
// command string — tmpDir is passed via `cwd`), matching the setup in focus.test.cjs.
const { spawnSync, execSync } = require('child_process');
const { createTempProject, cleanup, TOOLS_PATH } = require('./helpers.cjs');

const CORE_PATH = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib', 'core.cjs');
const LIB_DIR = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'lib');
const DISPATCHER = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

/** Run pan-tools in a child process and report the real exit code. */
function run(args, cwd) {
  const r = spawnSync(process.execPath, [TOOLS_PATH, ...args], {
    cwd, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

/** Call output() directly in a child process, bypassing every command. */
function callOutput(argsLiteral) {
  const script = `const { output, EXIT_OK } = require(${JSON.stringify(CORE_PATH)}); output(${argsLiteral});`;
  const r = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { status: r.status, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
}

// ─────────────────────────────────────────────────────────────────────────────
// The contract itself, at its single point of definition
// ─────────────────────────────────────────────────────────────────────────────

describe('output() derives the exit code from the payload', () => {
  test('an error payload exits 1', () => {
    const r = callOutput('{ error: "boom" }');
    assert.equal(r.status, 1, 'a truthy `error` key must exit non-zero — this is the whole contract');
    assert.deepEqual(JSON.parse(r.stdout), { error: 'boom' }, 'the body still goes to stdout');
    assert.equal(r.stderr, '', 'output() writes the body to stdout, not stderr');
  });

  test('an error payload exits 1 in --raw mode too', () => {
    const r = callOutput('{ error: "boom" }, true, "boom"');
    assert.equal(r.status, 1, 'raw mode must not launder a failure into success');
    assert.equal(r.stdout, 'boom');
  });

  test('a success payload exits 0', () => {
    const r = callOutput('{ ok: true, count: 0 }');
    assert.equal(r.status, 0);
  });

  test('EXIT_OK opts a legitimate empty/negative result out of the failure default', () => {
    const r = callOutput('{ error: "nothing to do" }, undefined, undefined, EXIT_OK');
    assert.equal(r.status, 0, 'EXIT_OK is the documented escape hatch for kind-(b) payloads');
    assert.ok(JSON.parse(r.stdout).error, 'the diagnostic is still delivered');
  });

  test('an explicit exit code still wins (gates with no error key)', () => {
    const notDue = callOutput('{ due: false, reason: "not_yet" }, undefined, undefined, 1');
    assert.equal(notDue.status, 1, '`campaign due` answering "not due" must keep its exit-coded gate');
  });

  test('a falsy error property is not a failure', () => {
    for (const literal of ['{ error: null }', '{ error: "" }', '{ error: false }']) {
      assert.equal(callOutput(literal).status, 0, `${literal} must not be reported as a failure`);
    }
  });

  test('an inherited or nested error key is not a failure', () => {
    assert.equal(callOutput('Object.create({ error: "inherited" })').status, 0,
      'only an OWN error property counts');
    assert.equal(callOutput('{ summary: { error: "nested" } }').status, 0,
      'a nested error field is data, not a top-level failure signal');
  });

  test('an array payload exits 0', () => {
    assert.equal(callOutput('[1, 2, 3]').status, 0);
  });

  // ── The error FAMILY, not the literal key name ──
  // Reverting ERROR_FAMILY_KEY to a plain `hasOwnProperty('error')` check fails
  // exactly these two assertions and the `whatif prepare` test further down.
  test('a renamed error key is still an error key', () => {
    assert.equal(callOutput('{ worktree_error: "git worktree add failed" }').status, 1,
      'whatif prepare reports a failed worktree as worktree_error — a rename, not a result');
    assert.equal(callOutput('{ read: true, drain_error: "EACCES" }').status, 1,
      'bus drain reports a failed drain as drain_error alongside a successful read');
  });

  test('plural collections and counters are NOT the error family', () => {
    // An empty array is truthy in JS, so matching `*_errors` would fail every clean
    // verify/lint run — a false failure, which is a new bug of equal loudness.
    for (const literal of [
      '{ passed: true, errors: [], warnings: [] }',
      '{ schema_errors: [] }',
      '{ error_count: 0, violations: [] }',
      '{ total_errors_traced: 7 }',
      '{ error_patterns: [{ n: 1 }] }',
    ]) {
      assert.equal(callOutput(literal).status, 0, `${literal} is verdict detail, not a failure signal`);
    }
    // …and a verdict that IS a failure states its code explicitly rather than
    // relying on the collection being non-empty.
    assert.equal(callOutput('{ schema_errors: [{ line: 2 }] }, undefined, undefined, 2').status, 2);
  });

  // ── The @file: overflow branch ──
  // output() has two write paths. A >50KB payload goes to a tmpfile and stdout gets
  // `@file:<path>`; the exit code is decided AFTER that branch, but a reviewer flagged
  // it as untested — if the derivation were ever moved inside the small-payload
  // `else`, every large failure would silently exit 0.
  test('an error payload larger than MAX_JSON_SIZE still exits non-zero', () => {
    const { MAX_JSON_SIZE } = require('../pan-wizard-core/bin/lib/constants.cjs');
    const r = callOutput(`{ error: "boom", trace: "x".repeat(${MAX_JSON_SIZE + 1000}) }`);
    assert.equal(r.status, 1, 'the overflow path must not launder a failure into success');
    assert.match(r.stdout, /^@file:/, 'and it really did take the tmpfile branch');
    const spilled = JSON.parse(fs.readFileSync(r.stdout.slice('@file:'.length), 'utf-8'));
    assert.equal(spilled.error, 'boom', 'the error body survives in the spill file');
  });

  test('a large SUCCESS payload still exits 0 on the same branch', () => {
    const { MAX_JSON_SIZE } = require('../pan-wizard-core/bin/lib/constants.cjs');
    const r = callOutput(`{ ok: true, blob: "x".repeat(${MAX_JSON_SIZE + 1000}) }`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^@file:/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The reported finding: `state json` with no state.md
// ─────────────────────────────────────────────────────────────────────────────

describe('state json signals a missing state.md through the exit code', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });   // creates .planning/ but no state.md
  afterEach(() => { cleanup(tmpDir); });

  test('exits non-zero with the error body intact on stdout', () => {
    const r = run(['state', 'json'], tmpDir);
    assert.equal(r.status, 1, 'the reported defect: this used to exit 0');
    assert.deepEqual(JSON.parse(r.stdout), { error: 'state.md not found' },
      'the JSON body must survive — callers parse it');
    assert.equal(r.stderr, '', 'the body belongs on stdout, as documented');
  });

  test('--raw exits non-zero and keeps the raw message', () => {
    const r = run(['state', 'json', '--raw'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(r.stdout, 'state.md not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// One representative per classification kind, through the real CLI
// ─────────────────────────────────────────────────────────────────────────────

describe('kind (a) — a real failure exits non-zero', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('git status outside a repository', () => {
    const r = run(['git', 'status'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'not_a_git_repo');
  });

  test('summary-extract on a file that does not exist', () => {
    const r = run(['summary-extract', '.planning/phases/01-x/01-01-summary.md'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'File not found');
  });

  test('roadmap analyze with no roadmap.md', () => {
    const r = run(['roadmap', 'analyze'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'roadmap.md not found');
  });

  test('error() keeps its own contract: stderr, exit 1, nothing on stdout', () => {
    const r = run(['verify', 'artifacts'], tmpDir);   // missing required argument
    assert.equal(r.status, 1);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /plan file path required/);
  });
});

describe('kind (b) — a legitimate empty/negative result stays at exit 0', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('focus plan with an empty backlog', () => {
    const r = run(['focus', 'plan'], tmpDir);
    assert.equal(r.status, 0,
      'an empty backlog is the desired end state of a burn-down loop, not a failure');
    assert.match(JSON.parse(r.stdout).error, /No work items found/);
  });

  test('template select falls back to the standard template', () => {
    const r = run(['template', 'select', '.planning/phases/99-missing/99-01-plan.md'], tmpDir);
    assert.equal(r.status, 0, 'the command produced a usable answer; `error` is only the reason');
    const body = JSON.parse(r.stdout);
    assert.equal(body.type, 'standard');
    assert.ok(body.error, 'the fallback reason is still reported');
  });

  test('verify artifacts on a plan whose must_haves block is empty', () => {
    // The frontmatter below is the shape PAN itself ships and its planner agent
    // emits: `must_haves:` at column 0, its blocks at 2-space indent
    // (pan-wizard-core/templates/phase-prompt.md, agents/pan-planner.md). Note that
    // parseMustHavesBlock looks for the block header at 4-space indent, so this
    // branch is reached for every plan written in PAN's own format — which is a
    // second, independent reason this site must not gate on the exit code.
    // If that indentation mismatch is ever fixed, this test will fail and the
    // classification must be revisited deliberately rather than by accident.
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '05-chat');
    fs.mkdirSync(phaseDir, { recursive: true });
    const plan = path.join(phaseDir, '05-01-chat-PLAN.md');
    fs.writeFileSync(plan, [
      '---',
      'phase: 5',
      'plan: "05-01"',
      'must_haves:',
      '  truths: []',
      '  artifacts: []',
      '  key_links: []',
      '---',
      '',
      '# Phase 5 Plan 05-01',
      '',
    ].join('\n'));

    const rel = '.planning/phases/05-chat/05-01-chat-PLAN.md';
    const artifacts = run(['verify', 'artifacts', rel], tmpDir);
    assert.equal(artifacts.status, 0, 'nothing declared to check is a result, not a failure');
    assert.match(JSON.parse(artifacts.stdout).error, /No must_haves\.artifacts found/);

    const links = run(['verify', 'key-links', rel], tmpDir);
    assert.equal(links.status, 0);
    assert.match(JSON.parse(links.stdout).error, /No must_haves\.key_links found/);
  });

  test('a plain success payload is unaffected', () => {
    const r = run(['current-timestamp', 'date', '--raw'], tmpDir);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('kind (c) — a deliberate refusal exits non-zero', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('template fill refuses to overwrite an existing file', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-summary.md'), '# Existing summary');

    const r = run(['template', 'fill', 'summary', '--phase', '1'], tmpDir);
    assert.equal(r.status, 1, 'the file was not written — the caller must be able to tell');
    assert.equal(JSON.parse(r.stdout).error, 'File already exists');
    assert.equal(fs.readFileSync(path.join(phaseDir, '01-01-summary.md'), 'utf-8'),
      '# Existing summary', 'and the refusal really did preserve the file');
  });

  test('git rollback refuses on a dirty working tree', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    // Create the snapshot tag through PAN's own command, so the fixture is the
    // shape `git rollback` actually looks for rather than one invented here.
    const snap = run(['rollback-snapshot', '1'], tmpDir);
    assert.equal(snap.status, 0, `rollback-snapshot should succeed: ${snap.stdout}${snap.stderr}`);
    fs.writeFileSync(path.join(tmpDir, 'uncommitted.txt'), 'dirty');

    const r = run(['git', 'rollback'], tmpDir);
    assert.equal(r.status, 1, 'the reset did not happen — a caller chaining on && must stop');
    assert.equal(JSON.parse(r.stdout).error, 'dirty_working_tree');
    assert.ok(fs.existsSync(path.join(tmpDir, 'uncommitted.txt')),
      'and the refusal really did leave the working tree alone');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape 1 — `<verb>: false` plus a reason. The shape the first fix missed.
//
// Every test here fails with `status === 0` if the error-family key is removed from
// its site, because nothing else in these payloads means "failure" to output().
// ─────────────────────────────────────────────────────────────────────────────

describe('a failed ACTION reported as `<verb>: false` exits non-zero', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
  });
  afterEach(() => { cleanup(tmpDir); });

  test('git commit — the shipped `git` path, missed by the first fix', () => {
    // `--amend` with no HEAD: git fails and does NOT say "nothing to commit", so this
    // is the commit_failed branch. git.cjs:67 was the last of the three commit paths
    // still reporting a refused commit with exit 0.
    const r = run(['git', 'commit', '--amend'], tmpDir);
    assert.equal(r.status, 1, 'a refused commit must stop an autonomous loop');
    const body = JSON.parse(r.stdout);
    assert.equal(body.committed, false);
    assert.equal(body.reason, 'commit_failed');
    assert.ok(body.error, 'the error key is what output() derives the code from');
    assert.equal(execSync('git rev-list --count --all', { cwd: tmpDir, encoding: 'utf-8' }).trim(), '0',
      'and the commit really did not happen');
  });

  test('git commit — the error value can never be empty', () => {
    // git does not always write to stderr. `error: r.stderr` alone would be '' —
    // falsy — and would launder the failure back into exit 0 through the truthiness
    // rule. The `|| "unknown git error"` fallback is what prevents that.
    const r = run(['git', 'commit', '--amend'], tmpDir);
    const body = JSON.parse(r.stdout);
    assert.equal(typeof body.error, 'string');
    assert.notEqual(body.error, '', 'an empty error string would silently mean success');
  });

  test('git commit blocked by a safety check', () => {
    run(['config-ensure-section'], tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.env'), 'SECRET=abc123');
    execSync('git add .env', { cwd: tmpDir, stdio: 'pipe' });

    const r = run(['git', 'commit', '--message', 'with-secret'], tmpDir);
    assert.equal(r.status, 1, 'a refusal that protected something is still "no commit landed"');
    const body = JSON.parse(r.stdout);
    assert.equal(body.committed, false);
    assert.ok(body.safety_checks, 'the diagnostic body is unchanged for callers that parse it');
  });

  test('git branch switch / tag delete on a target that does not exist', () => {
    const sw = run(['git', 'branch', 'switch', '--name', 'no-such-branch'], tmpDir);
    assert.equal(sw.status, 1);
    assert.equal(JSON.parse(sw.stdout).switched, false);

    const tag = run(['git', 'tag', 'delete', '--name', 'no-such-tag'], tmpDir);
    assert.equal(tag.status, 1);
    assert.equal(JSON.parse(tag.stdout).deleted, false);
  });

  test('git push with no remote configured', () => {
    const r = run(['git', 'push'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'no_remote');
  });
});

describe('a failed state WRITE reported as `<verb>: false` exits non-zero', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempProject();
    // A state.md with no Decisions/Blockers sections and no Progress field: every
    // write below has a file to open and nowhere to put the data.
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Plan:** 1\n**Total Plans in Phase:** 3\n');
  });
  afterEach(() => { cleanup(tmpDir); });

  test('state update — the field does not exist', () => {
    const r = run(['state', 'update', 'No Such Field', 'x'], tmpDir);
    assert.equal(r.status, 1, 'state.md does not say what the caller now believes it says');
    assert.equal(JSON.parse(r.stdout).updated, false);
  });

  test('state update — state.md is missing (the reported defect, wearing a different key)', () => {
    fs.rmSync(path.join(tmpDir, '.planning', 'state.md'));
    const r = run(['state', 'update', 'Current Plan', '2'], tmpDir);
    assert.equal(r.status, 1,
      '`state json` reported this exact condition as {error} at exit 1 — one file, one ' +
      'missing file, and this path was still exiting 0');
    assert.equal(JSON.parse(r.stdout).updated, false);
  });

  test('state add-decision — no Decisions section to append to', () => {
    const r = run(['state', 'add-decision', '--phase', '1', '--summary', 'chose X'], tmpDir);
    assert.equal(r.status, 1, 'the decision was lost, silently, at exit 0 before this');
    assert.equal(JSON.parse(r.stdout).added, false);
    assert.ok(!fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8').includes('chose X'),
      'and the decision really is not in state.md');
  });

  test('state add-blocker — no Blockers section to append to', () => {
    const r = run(['state', 'add-blocker', '--text', 'API keys missing'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).added, false);
  });

  test('state resolve-blocker — nothing matched, so the blocker is still open', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n### Blockers\n- waiting on vendor SLA\n');
    const r = run(['state', 'resolve-blocker', '--text', 'something else entirely'], tmpDir);
    assert.equal(r.status, 1,
      'M27 stopped it claiming a false resolution; the exit code finishes the job');
    assert.equal(JSON.parse(r.stdout).resolved, false);
    assert.match(fs.readFileSync(path.join(tmpDir, '.planning', 'state.md'), 'utf-8'),
      /waiting on vendor SLA/, 'the real blocker is untouched and still open');
  });

  test('state record-metric — no Performance Metrics section', () => {
    const r = run(['state', 'record-metric', '--phase', '1', '--plan', '01-01', '--duration', '20m'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).recorded, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape 2 — a RENAMED error key
// ─────────────────────────────────────────────────────────────────────────────

describe('a renamed error key exits non-zero through the real CLI', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('whatif prepare reports a failed worktree as worktree_error', () => {
    // A resolvable phase in a directory that is NOT a git repo: the context builds
    // (so the `ctx.error` guard does not fire) and createWorktree then fails. Those
    // two adjacent failures of one command used to report different exit codes —
    // 1 for `error`, 0 for `worktree_error` — purely because of the key name.
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '02-01-api-PLAN.md'), '---\nphase: 2\n---\n\n# Plan\n');

    const r = run(['whatif', 'prepare', '2', 'use REST instead of GraphQL'], tmpDir);
    assert.equal(r.status, 1, 'stage 2 spawns an agent INTO worktree_path — there is no worktree');
    const body = JSON.parse(r.stdout);
    assert.ok(body.worktree_error, 'the renamed key is present…');
    assert.equal(body.error, undefined, '…and there is no plain `error` key to catch it');
  });

  test('the guard one line above it behaves identically', () => {
    const r = run(['whatif', 'prepare', '99', 'a phase that does not exist'], tmpDir);
    assert.equal(r.status, 1, 'ctx.error and worktree_error must not disagree');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Shape 3 — a verdict computed and then discarded (doc-lint)
//
// output() exits the process, so a `process.exit(<verdict>)` line written after an
// output() call is unreachable. doc-lint had four of them. The docs pass then wrote
// the JSON path's exit 0 down as intended behaviour instead of fixing it.
// ─────────────────────────────────────────────────────────────────────────────

describe('doc-lint reports its verdict through the exit code in BOTH formats', () => {
  let tmpDir;
  const GOOD_SCHEMA = path.join(__dirname, '..', 'pan-wizard-core', 'references', 'schemas', 'pan-command.schema.yml');

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, 'target'), { recursive: true });
  });
  afterEach(() => { cleanup(tmpDir); });

  const writeTarget = (frontmatter) =>
    fs.writeFileSync(path.join(tmpDir, 'target', 'cmd.md'), `---\n${frontmatter}\n---\n\nbody\n`);

  test('a malformed schema exits 2 on the JSON path, not 0', () => {
    fs.writeFileSync(path.join(tmpDir, 'broken.yml'), 'fields:\n  - : :\n   nonsense [\n');
    writeTarget('name: ok-name');

    const json = run(['doc-lint', 'target', '--schema', 'broken.yml'], tmpDir);
    assert.equal(json.status, 2,
      'nothing was linted; exit 0 told the caller everything was fine');
    assert.ok(JSON.parse(json.stdout).schema_errors.length > 0, 'the body still lists the schema errors');

    const raw = run(['doc-lint', 'target', '--schema', 'broken.yml', '--raw'], tmpDir);
    assert.equal(raw.status, 2, 'the two formats must agree — they did not');
  });

  test('error-severity violations exit 1 on the JSON path', () => {
    writeTarget('name: Bad_Name_With_Caps');
    const json = run(['doc-lint', 'target', '--schema', GOOD_SCHEMA, '--format', 'json'], tmpDir);
    assert.equal(json.status, 1, '`doc-lint --format json` was a linter that never failed');
    assert.equal(JSON.parse(json.stdout).error_count, 1);

    const raw = run(['doc-lint', 'target', '--schema', GOOD_SCHEMA, '--raw'], tmpDir);
    assert.equal(raw.status, 1);
  });

  test('a clean directory exits 0 in both formats', () => {
    writeTarget('name: good-name');
    assert.equal(run(['doc-lint', 'target', '--schema', GOOD_SCHEMA, '--format', 'json'], tmpDir).status, 0);
    assert.equal(run(['doc-lint', 'target', '--schema', GOOD_SCHEMA, '--raw'], tmpDir).status, 0);
  });

  test('schema-check exits 1 on a bad schema — it never failed in EITHER format', () => {
    // output() was called on both branches here, so its process.exit() was
    // unconditionally dead code.
    fs.writeFileSync(path.join(tmpDir, 'broken.yml'), 'fields:\n  - : :\n   nonsense [\n');
    const json = run(['doc-lint', 'schema-check', 'broken.yml'], tmpDir);
    assert.equal(json.status, 1);
    assert.equal(JSON.parse(json.stdout).ok, false);
    assert.equal(run(['doc-lint', 'schema-check', 'broken.yml', '--raw'], tmpDir).status, 1);
    assert.equal(run(['doc-lint', 'schema-check', GOOD_SCHEMA], tmpDir).status, 0);
  });

  test('counts exits 1 on the JSON path and still exits 1 on --raw (release-check gate 4)', () => {
    fs.writeFileSync(path.join(tmpDir, 'target', 'README.md'), 'PAN ships 52 commands and 21 agents.\n');
    assert.equal(run(['doc-lint', 'counts', 'target'], tmpDir).status, 1, 'JSON path');
    assert.equal(run(['doc-lint', 'counts', 'target', '--raw'], tmpDir).status, 1,
      'release-check gate 4 runs exactly this — it must keep working');

    fs.rmSync(path.join(tmpDir, 'target', 'README.md'));
    fs.writeFileSync(path.join(tmpDir, 'target', 'clean.md'), 'Qualitative phrasing only.\n');
    assert.equal(run(['doc-lint', 'counts', 'target', '--raw'], tmpDir).status, 0, 'clean stays 0');
    assert.equal(run(['doc-lint', 'counts', 'target'], tmpDir).status, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The other half of the fix: negative ANSWERS must NOT become failures.
// A false failure is a new bug, as loud as the one being fixed.
// ─────────────────────────────────────────────────────────────────────────────

describe('a negative ANSWER keeps exit 0', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('roadmap get-phase for a phase that is simply not in the roadmap', () => {
    // The canonical valid-negative case. `found: false` is the ANSWER to the question
    // asked, not a malfunction — callers use it to decide whether to create the phase.
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n### Phase 1: Setup\n\n**Goal:** bootstrap\n');
    const r = run(['roadmap', 'get-phase', '12'], tmpDir);
    assert.equal(r.status, 0, 'a phase that does not exist yet is not an error');
    const body = JSON.parse(r.stdout);
    assert.equal(body.found, false);
    assert.equal(body.error, undefined, 'and it carries no error key to trip the derivation');
  });

  test('roadmap get-phase DOES fail when the roadmap itself is malformed', () => {
    // Same command, same `found: false`, opposite classification — which is exactly
    // why the shape cannot decide this.
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '# Roadmap\n\n- [ ] **Phase 4: Ghost**\n');
    const r = run(['roadmap', 'get-phase', '4'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).error, 'malformed_roadmap');
  });

  test('roadmap get-phase with no roadmap at all is a failure', () => {
    const r = run(['roadmap', 'get-phase', '1'], tmpDir);
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).found, false);
  });

  test('git commit with nothing staged', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'seed.txt'), 'seed');
    execSync('git add .', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "seed"', { cwd: tmpDir, stdio: 'pipe' });

    const r = run(['git', 'commit', '--message', 'nothing changed'], tmpDir);
    assert.equal(r.status, 0, 'no change was NEEDED — not a change that failed');
    assert.equal(JSON.parse(r.stdout).reason, 'nothing_to_commit');
  });

  test('commit-docs when the user set commit_docs=false', () => {
    // A real repo, so this exercises the commit_docs gate rather than the earlier
    // not_a_git_repo skip (which the next test covers).
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, '.planning', 'config.json'), JSON.stringify({ commit_docs: false }));
    const r = run(['commit', 'phase 1 notes'], tmpDir);
    assert.equal(r.status, 0, 'honouring configuration is a success, not a failure');
    assert.equal(JSON.parse(r.stdout).reason, 'skipped_commit_docs_false');
  });

  test('commit-docs in a project with no git at all', () => {
    const r = run(['commit', 'phase 1 notes'], tmpDir);
    assert.equal(r.status, 0,
      'PAN supports non-git projects; the skip is the expected outcome of that choice. ' +
      '`git commit` — an explicit git command — correctly does the opposite.');
    assert.equal(JSON.parse(r.stdout).reason, 'not_a_git_repo');
    assert.equal(run(['git', 'status'], tmpDir).status, 1, 'the deliberate asymmetry');
  });

  test('state advance-plan at the last plan of a phase', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Plan:** 3\n**Total Plans in Phase:** 3\n**Status:** x\n**Last Activity:** x\n');
    const r = run(['state', 'advance-plan'], tmpDir);
    assert.equal(r.status, 0, 'this is the NORMAL end-of-phase signal for every completed phase');
    const body = JSON.parse(r.stdout);
    assert.equal(body.advanced, false);
    assert.equal(body.status, 'ready_for_verification');
  });

  test('batch-commit with an empty item list', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    const r = run(['batch-commit', '[]'], tmpDir);
    assert.equal(r.status, 0, 'an empty batch is a legitimate no-op');
    assert.equal(JSON.parse(r.stdout).reason, 'no_items');
  });

  test('scaffold when the file already exists (idempotent)', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    const first = run(['scaffold', 'context', '--phase', '1'], tmpDir);
    assert.equal(first.status, 0, `first scaffold should succeed: ${first.stdout}${first.stderr}`);
    const second = run(['scaffold', 'context', '--phase', '1'], tmpDir);
    assert.equal(second.status, 0, 'the caller wanted the file to exist, and it does');
    assert.equal(JSON.parse(second.stdout).reason, 'already_exists');
  });

  test('roadmap update-plan-progress for a phase with no plans', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '# Roadmap\n\n### Phase 1: Setup\n');
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-setup'), { recursive: true });
    const r = run(['roadmap', 'update-plan-progress', '1'], tmpDir);
    assert.equal(r.status, 0, 'nothing to sync — the roadmap already says what it should');
    assert.equal(JSON.parse(r.stdout).updated, false);
  });

  test('memory read for an agent with no memory yet', () => {
    const r = run(['memory', 'read', 'pan-planner'], tmpDir);
    assert.equal(r.status, 0, '`exists: false` is a state description, not a failure');
    assert.equal(JSON.parse(r.stdout).exists, false);
  });

  test('git status on a dirty tree — `clean: false` is a description', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'x');
    const r = run(['git', 'status'], tmpDir);
    assert.equal(r.status, 0, 'a dirty tree is an observation the caller asked for');
    assert.equal(JSON.parse(r.stdout).clean, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Source guard — keep the contract from being re-broken site by site
// ─────────────────────────────────────────────────────────────────────────────

describe('no output() site smuggles an error payload out with exit 0', () => {
  const sources = [
    ...fs.readdirSync(LIB_DIR).filter(f => f.endsWith('.cjs')).map(f => path.join(LIB_DIR, f)),
    DISPATCHER,
  ];

  test('a literal 0 is never passed alongside an inline error key', () => {
    const offenders = [];
    for (const file of sources) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        // `output({ … error: … }, raw, rawValue, 0)` — an explicit literal 0 silences
        // the failure and reads like a no-op. Use EXIT_OK, which is greppable and
        // documented, so every exception stays visible.
        if (/output\(\s*\{[^)]*\berror\s*:/.test(line) && /,\s*0\s*\)\s*;?\s*$/.test(line)) {
          offenders.push(`${path.basename(file)}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(offenders, [],
      'pass EXIT_OK (with a comment saying why) instead of a bare 0 — see output() in core.cjs');
  });

  test('a derived error value can never be empty', () => {
    // The exit code is derived from TRUTHINESS, so `error: r.stderr` with nothing else
    // is a latent dead gate: a subprocess that fails without writing to stderr yields
    // '', which is falsy, and the failure exits 0 again. (`{ error: '' } => exit 0` is
    // pinned behaviourally further up; what this guards is that no SITE can produce
    // it.) A bare dynamic value must carry a `||` fallback or be concatenated into a
    // message. Reverting `|| 'unknown git error'` at any of PAN's three commit paths
    // fails here — no fixture can, because git happens to write to stderr in every
    // reproducible failure available to a test.
    const offenders = [];
    for (const file of sources) {
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/\berror:\s*([^,}]+)/g)) {
          const expr = m[1].trim();
          if (!/\.(stderr|message)\b/.test(expr)) continue;          // not a dynamic capture
          if (expr.includes('||')) continue;                         // fallback present
          if (/[`'"+]/.test(expr)) continue;                         // carries literal text, so never ''
          if (line.includes('EXIT_OK')) continue;                    // exit code is explicit, not derived
          offenders.push(`${path.basename(file)}:${i + 1} -> error: ${expr}`);
        }
      });
    }
    assert.deepEqual(offenders, [],
      'add a || fallback: an empty stderr/message would launder the failure into exit 0');
  });

  test('EXIT_OK is only used by modules that import it from core.cjs', () => {
    const offenders = [];
    for (const file of sources) {
      const src = fs.readFileSync(file, 'utf8');
      if (path.basename(file) === 'core.cjs') continue;
      if (!/\bEXIT_OK\b/.test(src)) continue;
      if (!/require\('\.\/core\.cjs'\)/.test(src) || !/EXIT_OK[,\s}]/.test(src.split('\n').filter(l => l.includes("require('./core.cjs')")).join('\n'))) {
        offenders.push(path.basename(file));
      }
    }
    assert.deepEqual(offenders, [], 'EXIT_OK must be destructured from core.cjs, not redefined');
  });
});
