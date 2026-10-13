'use strict';

/**
 * Model-based property testing with no dependencies (program H7).
 *
 * A seeded PRNG generates command sequences against a model; each command runs on the
 * real system and on the model, then an invariant compares the two. A failing sequence is
 * shrunk: commands are dropped (in chunks, then one at a time) while the sequence still
 * fails and every command is still applicable to the model at its position, so the
 * reported counterexample is a short, replayable list.
 *
 *   const r = checkCommands({ seed, runs, maxLength, commands, init, setup, teardown, invariant });
 *   assertCommands(r)   // throws with the seed and the shrunk sequence
 *
 * `commands` is a list of `{ name, applicable(model) → bool, gen(model, rnd) → args,
 * run(real, args) → result, next(model, args, result) → model }`. `invariant(real, model)`
 * returns null or a failure message; `run` may also throw, which counts as a failure.
 * `validArgs(model, args)` rejects a shrunk candidate whose arguments no longer fit the
 * model; `checkEvery: false` checks the invariant only after the last command.
 */

/** mulberry32: a small, well-mixed 32-bit PRNG. Same seed, same stream, on every platform. */
function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (list) => list[Math.floor(next() * list.length)],
    bool: (p = 0.5) => next() < p,
  };
}

/** Generate one sequence: at each step, a random command applicable to the model so far. */
function genSequence(rnd, spec, length) {
  const seq = [];
  let model = spec.init();
  for (let i = 0; i < length; i++) {
    const ok = spec.commands.filter((c) => !c.applicable || c.applicable(model));
    if (!ok.length) break;
    const cmd = rnd.pick(ok);
    const args = cmd.gen ? cmd.gen(model, rnd) : [];
    seq.push({ name: cmd.name, args });
    model = cmd.next(model, args);
  }
  return seq;
}

/** Is every command applicable to the model at its position? (A shrunk candidate must be.) */
function valid(spec, seq) {
  let model = spec.init();
  for (const step of seq) {
    const cmd = spec.commands.find((c) => c.name === step.name);
    if (!cmd || (cmd.applicable && !cmd.applicable(model))) return false;
    if (cmd.validArgs && !cmd.validArgs(model, step.args)) return false;
    model = cmd.next(model, step.args);
  }
  return true;
}

/** Run a sequence on a fresh real system; return null if it holds, else {at, message}. */
function execute(spec, seq) {
  const real = spec.setup();
  try {
    // checkEvery:false checks once, after the last command: cheaper when the invariant
    // spawns a process; the shrinker still finds the short sequence.
    const every = spec.checkEvery !== false;
    let model = spec.init();
    const bad = every ? spec.invariant(real, model) : null;
    if (bad) return { at: -1, message: bad };
    for (let i = 0; i < seq.length; i++) {
      const cmd = spec.commands.find((c) => c.name === seq[i].name);
      let result;
      try { result = cmd.run(real, seq[i].args); } catch (e) { return { at: i, message: `${seq[i].name} threw: ${e.message}` }; }
      model = cmd.next(model, seq[i].args, result);
      if (!every && i < seq.length - 1) continue;
      const broken = spec.invariant(real, model);
      if (broken) return { at: i, message: broken };
    }
    return null;
  } finally {
    if (spec.teardown) spec.teardown(real);
  }
}

/** Shrink a failing sequence: drop chunks, then single commands, while it still fails. */
function shrink(spec, seq, failure) {
  let best = seq.slice(0, failure.at + 1);
  let bestFailure = failure;
  let steps = 0;
  let improved = true;
  while (improved) {
    improved = false;
    for (let size = Math.max(1, best.length >> 1); size >= 1 && !improved; size = size === 1 ? 0 : size >> 1) {
      for (let start = 0; start + size <= best.length; start++) {
        const cand = best.slice(0, start).concat(best.slice(start + size));
        if (!valid(spec, cand)) continue;
        steps++;
        const f = execute(spec, cand);
        if (f) { best = cand.slice(0, f.at + 1); bestFailure = f; improved = true; break; }
      }
    }
  }
  return { sequence: best, failure: bestFailure, steps };
}

/**
 * Generate `runs` sequences from `seed`; stop at the first failure and shrink it.
 * @returns {{ok: boolean, seed: number, runs: number, tried: number, original?: Array, shrunk?: Array, failure?: object, shrinkSteps?: number}}
 */
function checkCommands(spec) {
  const seed = spec.seed === undefined ? 1 : spec.seed;
  const rnd = prng(seed);
  const runs = spec.runs || 25;
  for (let i = 0; i < runs; i++) {
    const seq = genSequence(rnd, spec, rnd.int(1, spec.maxLength || 6));
    const failure = execute(spec, seq);
    if (failure) {
      const s = shrink(spec, seq, failure);
      return { ok: false, seed, runs, tried: i + 1, original: seq, shrunk: s.sequence, failure: s.failure, shrinkSteps: s.steps };
    }
  }
  return { ok: true, seed, runs, tried: runs };
}

const show = (seq) => seq.map((s) => [s.name, ...s.args].join(' ')).join(' ; ');

/** Throw a readable counterexample: the seed reproduces it, the shrunk list explains it. */
function assertCommands(r) {
  if (r.ok) return;
  throw new Error(`property failed (seed ${r.seed}, run ${r.tried}/${r.runs}): ${r.failure.message}\n  shrunk (${r.shrunk.length}): ${show(r.shrunk)}\n  original (${r.original.length}): ${show(r.original)}`);
}

/** Plain property over generated values (for pure functions). Returns the first failing value, shrunk by `shrinkValue`. */
function checkProperty({ seed = 1, runs = 200, gen, prop, shrinkValue }) {
  const rnd = prng(seed);
  for (let i = 0; i < runs; i++) {
    let value = gen(rnd);
    let message = prop(value);
    if (!message) continue;
    for (let improved = true; improved && shrinkValue;) {
      improved = false;
      for (const cand of shrinkValue(value)) {
        const m = prop(cand);
        if (m) { value = cand; message = m; improved = true; break; }
      }
    }
    return { ok: false, seed, tried: i + 1, value, message };
  }
  return { ok: true, seed, tried: runs };
}

module.exports = { prng, genSequence, checkCommands, assertCommands, checkProperty, shrink, show };
