/**
 * Model-based property tests over pan-tools phase state, and a fuzz of the next-action
 * state machine (program H7).
 *
 * Random sequences of `phase add`, `phase insert` and `phase remove` run against a real
 * project and against a model (the ordered list of phase numbers). After each sequence,
 * `roadmap analyze`, the phase directories and the roadmap's "## Phases" checklist must
 * all agree with the model, in numeric order. A failure is shrunk to a short replayable
 * sequence (tests/helpers/pbt.cjs). The gate: an off-by-one planted in phase insertion is
 * found and shrunk to four commands or fewer.
 *
 * `nextAction` is pure, so it is fuzzed in process over snapshots in PAN's real status
 * vocabulary plus Title Case, legacy aliases and garbage: it never returns a verb its
 * contract forbids.
 *
 * Removing an integer phase that still has decimal phases is refused unless
 * `--with-decimals` is given, which removes them with it; the model covers both.
 * Out of the model on purpose: `phase complete` (it needs plans and summaries, which the
 * phase gate tests cover).
 */
'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { checkCommands, assertCommands, checkProperty, show } = require('./helpers/pbt.cjs');
const { cleanup, TOOLS_PATH } = require('./helpers.cjs');
const { nextAction, PHASE_NEXT } = require('../pan-wizard-core/mcp/orchestrator.cjs');

const ROOT = path.join(__dirname, '..');

// ─── The model: phase numbers as [int, decimal], kept in numeric order ──────────────

const canon = (n) => String(n).split('.').map((p) => String(Number(p))).join('.');
const parts = (n) => canon(n).split('.').map(Number);
const cmp = (a, b) => { const x = parts(a); const y = parts(b); return (x[0] - y[0]) || ((x[1] || 0) - (y[1] || 0)); };
const sorted = (list) => list.slice().sort(cmp);
const ints = (m) => m.filter((n) => !n.includes('.')).map(Number);
const decimalsOf = (m, k) => m.filter((n) => n.startsWith(`${k}.`)).map((n) => Number(n.split('.')[1]));
// Removing n leaves at least one phase standing (an integer takes its decimals with it).
const removable = (m, n) => m.includes(n) && m.filter((x) => (n.includes('.') ? x !== n : parts(x)[0] !== Number(n))).length > 0;

const FIXTURE = [
  '# Roadmap', '', '## Phases', '',
  '- [ ] **Phase 1: First**', '- [ ] **Phase 2: Second**', '',
  '## Phase Details', '',
  '### Phase 1: First', '', '**Goal:** g', '**Depends on:** Nothing', '',
  '### Phase 2: Second', '', '**Goal:** g', '**Depends on:** Phase 1', '',
].join('\n');

function phaseSpec(tools, opts = {}) {
  const pan = (cwd, args) => {
    const r = spawnSync(process.execPath, [tools, ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`pan-tools ${args.join(' ')} exited ${r.status}: ${String(r.stderr).trim().slice(0, 300)}`);
    return r.stdout;
  };
  let names = 0;
  return {
    seed: opts.seed, runs: opts.runs, maxLength: opts.maxLength,
    init: () => ['1', '2'],
    setup: () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-pbt-'));
      fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-first'), { recursive: true });
      fs.mkdirSync(path.join(dir, '.planning', 'phases', '02-second'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'), FIXTURE);
      return dir;
    },
    teardown: (dir) => cleanup(dir),
    commands: [
      {
        name: 'add',
        gen: () => [`added${++names}`],
        run: (dir, [desc]) => pan(dir, ['phase', 'add', desc]),
        next: (m) => sorted([...m, String(Math.max(0, ...ints(m)) + 1)]),
      },
      {
        name: 'insert',
        applicable: (m) => ints(m).length > 0,
        gen: (m, rnd) => [String(rnd.pick(ints(m))), `urgent${++names}`],
        validArgs: (m, [k]) => ints(m).includes(Number(k)),
        run: (dir, [k, desc]) => pan(dir, ['phase', 'insert', k, desc]),
        next: (m, [k]) => sorted([...m, `${k}.${Math.max(0, ...decimalsOf(m, k)) + 1}`]),
      },
      {
        name: 'remove',
        // Any phase but the last left standing. An integer that still has decimals needs
        // --with-decimals and takes them with it.
        applicable: (m) => m.some((n) => removable(m, n)),
        gen: (m, rnd) => { const n = rnd.pick(m.filter((x) => removable(m, x))); return decimalsOf(m, n).length && !n.includes('.') ? [n, '--with-decimals'] : [n]; },
        validArgs: (m, [n, flag]) => removable(m, n) && (n.includes('.') || !decimalsOf(m, n).length || flag === '--with-decimals'),
        run: (dir, [n, ...flags]) => pan(dir, ['phase', 'remove', n, ...flags, '--force']),
        next: (m, [n]) => {
          const [k, d] = parts(n);
          if (d !== undefined) return sorted(m.filter((x) => x !== n).map((x) => { const [xk, xd] = parts(x); return xk === k && xd > d ? `${k}.${xd - 1}` : x; }));
          return sorted(m.filter((x) => parts(x)[0] !== k).map((x) => { const [xk, xd] = parts(x); return xk > k ? (xd === undefined ? String(xk - 1) : `${xk - 1}.${xd}`) : x; }));
        },
      },
      {
        name: 'remove-refused',
        // Without --with-decimals, an integer that still has decimals is refused and nothing changes.
        applicable: (m) => ints(m).some((k) => decimalsOf(m, k).length),
        gen: (m, rnd) => [String(rnd.pick(ints(m).filter((k) => decimalsOf(m, k).length)))],
        validArgs: (m, [k]) => ints(m).includes(Number(k)) && decimalsOf(m, k).length > 0,
        run: (dir, [k]) => {
          const r = spawnSync(process.execPath, [tools, 'phase', 'remove', k, '--force'], { cwd: dir, encoding: 'utf8' });
          if (r.status === 0) throw new Error(`phase remove ${k} succeeded although phase ${k} still has decimal phases`);
          if (!/--with-decimals/.test(r.stderr + r.stdout)) throw new Error(`the refusal does not name --with-decimals: ${String(r.stderr).trim().slice(0, 200)}`);
        },
        next: (m) => m,
      },
    ],
    invariant: (dir, model) => {
      const want = model.join(',');
      const analyze = JSON.parse(pan(dir, ['roadmap', 'analyze']));
      const listed = analyze.phases.map((p) => canon(p.number)).join(',');
      if (listed !== want) return `roadmap analyze lists ${listed}, the model has ${want}`;
      const dirs = fs.readdirSync(path.join(dir, '.planning', 'phases')).map((d) => d.match(/^(\d+(?:\.\d+)?)-/)).filter(Boolean).map((x) => canon(x[1]));
      if (sorted(dirs).join(',') !== want) return `phase directories are ${sorted(dirs).join(',')}, the model has ${want}`;
      const checklist = fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8').split('\n')
        .map((l) => l.match(/^\s*- \[[ x]\]\s*\*\*Phase\s+(\d+(?:\.\d+)?):/i)).filter(Boolean).map((x) => canon(x[1])).join(',');
      if (checklist !== want) return `the "## Phases" checklist reads ${checklist}, the model has ${want}`;
      return null;
    },
    checkEvery: false,
  };
}

describe('pan-tools phase state against a model (H7)', () => {
  test('add, insert and remove keep analyze, directories and the checklist in step with the model', () => {
    // PAN_PBT_SEED / PAN_PBT_RUNS explore further than the suite's fixed seed; a failure
    // prints the seed and the shrunk sequence that reproduce it.
    const seed = Number(process.env.PAN_PBT_SEED) || 20261013;
    const runs = Number(process.env.PAN_PBT_RUNS) || 12;
    assertCommands(checkCommands(phaseSpec(TOOLS_PATH, { seed, runs, maxLength: 6 })));
  });

  test('gate: an off-by-one planted in phase insertion is found and shrunk to four commands or fewer', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-pbt-mutant-'));
    try {
      const bin = path.join(tmp, 'pan-wizard-core', 'bin');
      fs.cpSync(path.join(ROOT, 'pan-wizard-core', 'bin'), bin, { recursive: true });
      const phaseFile = path.join(bin, 'lib', 'phase.cjs');
      const src = fs.readFileSync(phaseFile, 'utf8');
      const correct = 'Math.max(...existingDecimals) + 1';
      assert.ok(src.includes(correct), 'the line the mutant plants into is where this test expects it');
      fs.writeFileSync(phaseFile, src.replace(correct, 'Math.max(...existingDecimals)'));
      const r = checkCommands(phaseSpec(path.join(bin, 'pan-tools.cjs'), { seed: 7, runs: 30, maxLength: 6 }));
      assert.equal(r.ok, false, 'the planted off-by-one went unnoticed');
      assert.ok(r.shrunk.length <= 4, `shrunk to ${r.shrunk.length}: ${show(r.shrunk)}`);
      assert.ok(r.shrunk.filter((s) => s.name === 'insert').length >= 2, `the counterexample inserts twice under one phase: ${show(r.shrunk)}`);
    } finally { cleanup(tmp); }
  });
});

describe('the PBT helper (H7)', () => {
  const { prng } = require('./helpers/pbt.cjs');

  test('the PRNG is seeded and reproducible', () => {
    const a = prng(42); const b = prng(42); const c = prng(43);
    const draw = (r) => Array.from({ length: 5 }, () => r.int(0, 1000));
    assert.deepEqual(draw(a), draw(b));
    assert.notDeepEqual(draw(prng(42)), draw(c));
  });

  test('shrinking drops every command the failure does not need', () => {
    // A toy counter with a bug: the third "inc" after a "reset" is lost.
    const spec = {
      seed: 3, runs: 50, maxLength: 12,
      init: () => 0,
      setup: () => ({ n: 0, since: 0 }),
      commands: [
        { name: 'inc', run: (r) => { r.since++; if (r.since !== 3) r.n++; }, next: (m) => m + 1 },
        { name: 'reset', run: (r) => { r.n = 0; r.since = 0; }, next: () => 0 },
        { name: 'noop', run: () => {}, next: (m) => m },
      ],
      invariant: (r, m) => (r.n === m ? null : `counter ${r.n}, model ${m}`),
    };
    const r = checkCommands(spec);
    assert.equal(r.ok, false);
    assert.deepEqual(r.shrunk.map((s) => s.name), ['inc', 'inc', 'inc']);
  });
});

describe('nextAction fuzz: never a forbidden verb (H7)', () => {
  const STATUSES = ['complete', 'partial', 'planned', 'researched', 'discussed', 'empty', 'Complete', 'Planned', 'PARTIAL', 'executed', 'verified', 'none', 'bogus', '', undefined, 7];
  const ACTIONS = new Set(['plan', 'execute', 'verify', 'request_merge', 'await_approval', 'stop']);
  const gen = (rnd) => {
    const phases = Array.from({ length: rnd.int(0, 5) }, (_, i) => ({ number: i + 1, status: rnd.pick(STATUSES), ...(rnd.bool() ? { verified: rnd.bool() } : {}), ...(rnd.bool() ? { merged: rnd.bool() } : {}) }));
    const state = { phases: rnd.bool(0.9) ? phases : rnd.pick([undefined, {}, 'phases', [null]]) };
    if (rnd.bool(0.1)) state.aborted = true;
    if (rnd.bool(0.2)) state.awaiting_approval = true;
    if (rnd.bool(0.3)) { state.tests_before = rnd.int(0, 10); state.tests_after = rnd.int(0, 10); }
    if (rnd.bool(0.3)) state.cycles = rnd.int(0, 30);
    if (rnd.bool(0.2)) state.points_used = rnd.int(0, 50);
    const caps = rnd.bool(0.3) ? { maxCycles: rnd.int(1, 30), budget: rnd.int(1, 50), enforceBudget: rnd.bool() } : undefined;
    return { state, caps };
  };
  const status = (p) => (typeof p.status === 'string' ? p.status.trim().toLowerCase() : '');
  // Finished: complete, verified and merged; or the legacy `verified` alias, merged.
  const finished = (p) => p.merged === true && ((status(p) === 'complete' && p.verified === true) || PHASE_NEXT[status(p)] === 'request_merge');
  const open = (p) => p && typeof p === 'object' && !finished(p);

  const propFor = (decide) => ({ state, caps }) => {
    const r = decide(JSON.parse(JSON.stringify(state)), caps);
    if (!ACTIONS.has(r.action)) return `unknown action ${r.action}`;
    if (typeof r.done !== 'boolean') return 'done is not a boolean';
    if (r.done && r.action !== 'stop') return `done:true with ${r.action}`;
    const regressed = typeof state.tests_before === 'number' && state.tests_after < state.tests_before;
    if ((state.aborted || regressed) && r.action !== 'stop') return `${state.aborted ? 'aborted' : 'a regression'} did not stop the loop (${r.action})`;
    if (r.action === 'stop' && r.reason === 'no_phases' && r.done) return 'no_phases reported as done';
    if (r.reason === 'all_complete' && Array.isArray(state.phases) && state.phases.some(open)) return 'all_complete with an open phase';
    if (!['plan', 'execute', 'verify', 'request_merge'].includes(r.action)) return null;
    const p = Array.isArray(state.phases) && state.phases.find(open);
    if (!p || !r.args || r.args.phase !== p.number) return `${r.action} is not on the first open phase`;
    if (state.awaiting_approval) return `${r.action} while a merge awaits approval`;
    const s = status(p);
    // The legacy aliases (`executed` → verify, `verified` → request_merge) are part of the
    // contract for old callers; what is forbidden is merging the unverified or the merged.
    if (r.action === 'request_merge' && !((s === 'complete' && p.verified === true) || PHASE_NEXT[s] === 'request_merge')) return `request_merge on an unverified ${s || 'statusless'} phase`;
    if (r.action === 'request_merge' && p.merged === true) return `request_merge on a phase already merged (status ${s})`;
    if (r.action === 'verify' && !((s === 'complete' && p.verified !== true) || PHASE_NEXT[s] === 'verify')) return `verify on a ${s || 'statusless'} phase${p.verified === true ? ' already verified' : ''}`;
    if (r.action === 'execute' && s === 'complete') return 'execute on a complete phase';
    if (r.action === 'plan' && (s === 'planned' || s === 'partial' || s === 'complete')) return `plan on a ${s} phase (the re-plan live-lock)`;
    return null;
  };
  const shrinkValue = ({ state, caps }) => {
    const out = [];
    if (caps) out.push({ state, caps: undefined });
    for (const k of ['aborted', 'awaiting_approval', 'tests_before', 'cycles', 'points_used']) if (k in state) { const s = { ...state }; delete s[k]; if (k === 'tests_before') delete s.tests_after; out.push({ state: s, caps }); }
    if (Array.isArray(state.phases)) state.phases.forEach((_, i) => out.push({ state: { ...state, phases: state.phases.filter((__, j) => j !== i) }, caps }));
    return out;
  };

  test('over thousands of snapshots, every action is one its contract allows', () => {
    const r = checkProperty({ seed: 20261013, runs: 3000, gen, prop: propFor(nextAction), shrinkValue });
    assert.ok(r.ok, r.ok ? '' : `${r.message}\n  ${JSON.stringify(r.value)}`);
  });

  test('the fuzz catches a machine that re-plans a partial phase, and shrinks it to one phase', () => {
    const broken = (s, c) => { const r = nextAction(s, c); return r.action === 'execute' && r.reason === 'phase_partial' ? { ...r, action: 'plan' } : r; };
    const r = checkProperty({ seed: 5, runs: 3000, gen, prop: propFor(broken), shrinkValue });
    assert.equal(r.ok, false);
    assert.match(r.message, /re-plan live-lock/);
    assert.equal(r.value.state.phases.length, 1);
  });
});

describe('the counterexamples H7 found, pinned as examples', () => {
  const project = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-pbt-pin-'));
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-first'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.planning', 'phases', '02-second'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'), FIXTURE);
    return dir;
  };
  const pan = (dir, ...args) => {
    const r = spawnSync(process.execPath, [TOOLS_PATH, ...args], { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const listed = (dir) => JSON.parse(pan(dir, 'roadmap', 'analyze')).phases.map((p) => canon(p.number)).join(',');
  const checklist = (dir) => fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8').split('\n').filter((l) => /^- \[ \] \*\*Phase/.test(l)).map((l) => canon(l.match(/Phase ([\d.]+):/)[1])).join(',');

  test('a second insert under one phase lands after the first, in the details and the checklist', () => {
    const dir = project();
    try {
      pan(dir, 'phase', 'insert', '1', 'alpha');
      pan(dir, 'phase', 'insert', '1', 'beta');
      assert.equal(listed(dir), '1,1.1,1.2,2');
      assert.equal(checklist(dir), '1,1.1,1.2,2');
    } finally { cleanup(dir); }
  });

  test('removing a padded decimal removes its section and checklist entry and renumbers its siblings', () => {
    const dir = project();
    try {
      pan(dir, 'phase', 'insert', '1', 'alpha');
      pan(dir, 'phase', 'insert', '1', 'beta');
      pan(dir, 'phase', 'remove', '1.1', '--force');
      assert.equal(listed(dir), '1,1.1,2');
      assert.equal(checklist(dir), '1,1.1,2');
      const roadmap = fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8');
      assert.doesNotMatch(roadmap, /alpha/);
      assert.match(roadmap, /### Phase 01\.1: beta/, 'the sibling keeps its padded style');
    } finally { cleanup(dir); }
  });

  test('removing an integer renumbers padded decimal headings with their base', () => {
    const dir = project();
    try {
      pan(dir, 'phase', 'add', 'third');
      pan(dir, 'phase', 'insert', '3', 'urgent');
      pan(dir, 'phase', 'remove', '1', '--force');
      assert.equal(listed(dir), '1,2,2.1');
      assert.match(fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8'), /### Phase 02\.1: urgent/);
    } finally { cleanup(dir); }
  });

  test('removing an integer phase that still has decimals is refused, naming them, and changes nothing', () => {
    const dir = project();
    try {
      pan(dir, 'phase', 'insert', '1', 'alpha');
      pan(dir, 'phase', 'insert', '1', 'beta');
      const before = fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8');
      const r = spawnSync(process.execPath, [TOOLS_PATH, 'phase', 'remove', '1', '--force'], { cwd: dir, encoding: 'utf8' });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Phase 1 has decimal phases 1\.1, 1\.2/);
      assert.match(r.stderr, /--with-decimals/);
      assert.equal(fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8'), before);
      assert.deepEqual(fs.readdirSync(path.join(dir, '.planning', 'phases')).sort(), ['01-first', '01.1-alpha', '01.2-beta', '02-second']);
    } finally { cleanup(dir); }
  });

  test('--with-decimals removes the phase and its decimals, then renumbers', () => {
    const dir = project();
    try {
      pan(dir, 'phase', 'insert', '1', 'alpha');
      pan(dir, 'phase', 'insert', '2', 'gamma');
      const out = JSON.parse(pan(dir, 'phase', 'remove', '1', '--with-decimals'));
      assert.deepEqual(out.removed_decimals, ['1.1']);
      assert.equal(listed(dir), '1,1.1');
      assert.equal(checklist(dir), '1,1.1');
      assert.deepEqual(fs.readdirSync(path.join(dir, '.planning', 'phases')).sort(), ['01-second', '01.1-gamma']);
      assert.doesNotMatch(fs.readFileSync(path.join(dir, '.planning', 'roadmap.md'), 'utf8'), /alpha/);
    } finally { cleanup(dir); }
  });

  test('--with-decimals still refuses a decimal with executed plans unless --force, before removing anything', () => {
    const dir = project();
    try {
      pan(dir, 'phase', 'insert', '1', 'alpha');
      fs.writeFileSync(path.join(dir, '.planning', 'phases', '01.1-alpha', '01.1-01-summary.md'), '# done\n');
      const r = spawnSync(process.execPath, [TOOLS_PATH, 'phase', 'remove', '1', '--with-decimals'], { cwd: dir, encoding: 'utf8' });
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /Phase 1\.1 has 1 executed plan/);
      assert.deepEqual(fs.readdirSync(path.join(dir, '.planning', 'phases')).sort(), ['01-first', '01.1-alpha', '02-second']);
      pan(dir, 'phase', 'remove', '1', '--with-decimals', '--force');
      assert.equal(listed(dir), '1');
    } finally { cleanup(dir); }
  });

  test('a legacy verified phase that is merged is finished, not merged again', () => {
    assert.deepEqual(nextAction({ phases: [{ number: 1, status: 'verified', merged: true }] }), { action: 'stop', reason: 'all_complete', done: true });
    assert.equal(nextAction({ phases: [{ number: 1, status: 'verified', merged: false }] }).action, 'request_merge');
  });
});
