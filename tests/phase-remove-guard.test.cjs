/**
 * `phase remove` must refuse an argument it cannot act on, before mutating anything.
 *
 * Regression guard for two High findings from the 2026-08 deployed stability test,
 * both of which reported success and exited 0:
 *
 *   `phase remove 0`  — renumbered EVERY roadmap heading down to "Phase 0" and
 *     renamed every phase directory one lower. The roadmap renumber loop walks
 *     99..removedInt+1 and re-hits its own output, so with removedInt=0 the
 *     numbers collapse: 3->2, then that 2 (plus the real 2) ->1, then all ->0.
 *     The roadmap drives every /pan workflow, so this destroys the project.
 *
 *   `phase remove -1234567890` — spun the same loop ~1.2 billion times, each pass
 *     running several regex replaces over the roadmap. Hours of CPU, no output,
 *     no way to tell it was stuck. One mistyped argument from an agent or a hook
 *     wedges the session.
 *
 * These drive the real CLI through spawnSync and assert on files, because the
 * defect was in what got written — a unit test on the helpers would have passed.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAN_TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tempRoot;
let projectDir;

const ROADMAP = [
  '# Roadmap',
  '',
  '## Phase 1: Alpha',
  '**Status:** Complete',
  '',
  '## Phase 2: Beta',
  '**Status:** In Progress',
  '',
  '## Phase 3: Gamma',
  '**Status:** Not Started',
  '',
].join('\n');

// The timeout is load-bearing, not boilerplate. One of the defects under test is
// an unbounded loop: with the guard reverted, `phase remove -1234567890` never
// returns, so a bare spawnSync hangs the whole run instead of failing this file.
// Verified by reverting the fix — the suite blocked until killed. Killing the
// child yields status null, which the assertions below treat as a failure.
const RUN_TIMEOUT_MS = 20000;

function run(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], {
    cwd: projectDir,
    encoding: 'utf-8',
    timeout: RUN_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || ''), timedOut: r.status === null };
}

function headings() {
  return fs.readFileSync(path.join(projectDir, '.planning', 'roadmap.md'), 'utf-8')
    .split('\n').filter(l => l.startsWith('## Phase '));
}

function phaseDirs() {
  return fs.readdirSync(path.join(projectDir, '.planning', 'phases')).sort();
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-phrm-'));
  projectDir = path.join(tempRoot, 'proj');
  for (const p of ['01-alpha', '02-beta', '03-gamma']) {
    fs.mkdirSync(path.join(projectDir, '.planning', 'phases', p), { recursive: true });
    fs.writeFileSync(path.join(projectDir, '.planning', 'phases', p, `${p.split('-')[0]}-01-plan.md`), `# ${p}\n`);
  }
  fs.writeFileSync(path.join(projectDir, '.planning', 'roadmap.md'), ROADMAP);
  fs.writeFileSync(path.join(projectDir, '.planning', 'state.md'), '# Project State\n\n**Current Phase:** 2\n');
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('phase remove rejects arguments it cannot act on', () => {
  // Each of these reached the renumber logic before the guard existed.
  for (const arg of ['0', '-1', '-1234567890', 'abc', '1e9', '2..3']) {
    test(`refuses "${arg}" without touching the roadmap or any directory`, () => {
      const before = { h: headings(), d: phaseDirs() };

      const { code, out } = run(['phase', 'remove', arg]);

      assert.equal(code, 1, `must exit non-zero, got ${code}`);
      assert.match(out, /invalid phase number|not found/i, 'must say why it refused');
      // REVERT CHECK: without the guard, '0' and the negatives rewrite every
      // heading to "Phase 0" and rename every directory — these two assertions
      // are what catch it.
      assert.deepEqual(headings(), before.h, 'roadmap headings must be untouched');
      assert.deepEqual(phaseDirs(), before.d, 'phase directories must be untouched');
    });
  }

  test('a large negative returns promptly instead of spinning the renumber loop', () => {
    const started = Date.now();
    const { code, timedOut } = run(['phase', 'remove', '-1234567890']);
    const elapsed = Date.now() - started;

    // REVERT CHECK: with the guard removed this never returns — confirmed by
    // reverting the fix, where the run had to be killed. `timedOut` is the
    // assertion that catches it; the elapsed check catches a merely-slow loop.
    assert.equal(timedOut, false, `must not hang — was killed after ${RUN_TIMEOUT_MS}ms`);
    assert.equal(code, 1);
    // Before the guard, cost scaled with the magnitude of the argument:
    // -99999 took ~6.6s and -999999 ~86s, extrapolating to hours for this value.
    assert.ok(elapsed < 15000, `should return promptly, took ${elapsed}ms`);
  });

  test('a phase that exists nowhere is refused, not reported as removed', () => {
    const before = headings();
    const { code, out } = run(['phase', 'remove', '7']);

    assert.equal(code, 1, 'reporting {removed: 7} with exit 0 told orchestrators it was gone');
    assert.match(out, /not found/i);
    assert.deepEqual(headings(), before);
  });
});

describe('phase remove still works for real targets', () => {
  test('removing a middle phase renumbers exactly the phases after it', () => {
    const { code } = run(['phase', 'remove', '2', '--force']);

    assert.equal(code, 0);
    // Gamma moves 3 -> 2. Alpha keeps 1. Nothing collapses to 0.
    assert.deepEqual(headings(), ['## Phase 1: Alpha', '## Phase 2: Gamma']);
    assert.deepEqual(phaseDirs(), ['01-alpha', '02-gamma']);
  });

  test('a phase planned in the roadmap but never scaffolded can still be removed', () => {
    fs.rmSync(path.join(projectDir, '.planning', 'phases', '03-gamma'), { recursive: true, force: true });

    const { code } = run(['phase', 'remove', '3', '--force']);

    assert.equal(code, 0, 'the not-found guard must not block a roadmap-only phase');
    assert.deepEqual(headings(), ['## Phase 1: Alpha', '## Phase 2: Beta']);
  });

  test('the last phase can be removed', () => {
    const { code } = run(['phase', 'remove', '3', '--force']);
    assert.equal(code, 0);
    assert.deepEqual(headings(), ['## Phase 1: Alpha', '## Phase 2: Beta']);
  });
});
