'use strict';
/**
 * Mutation report on a phase's diff (program V5): would a test fail if the code the phase
 * wrote were wrong? Coverage says a line ran; a surviving mutant says no test pins what
 * the line does.
 *
 *   lines     the lines the phase's plan commits changed (git diff from the phase's
 *             base, the same base `verify red` uses), in source files that are not tests
 *   mutants   blunt textual swaps per language (a comparison flipped, && for ||, a
 *             boolean return inverted, + 1 for - 1), on a changed line only, outside a
 *             comment or string; a seeded sample of them (`--max`, `--seed`)
 *   where     a throwaway worktree at HEAD, never the user's tree
 *   flake     the unmutated suite runs twice first; if it fails, or the two runs
 *             disagree, nothing a mutant does could be read, so the report aborts
 *   result    each mutant is killed (the suite fails or times out) or survives;
 *             survivors are listed with file, line and the swap, and written to
 *             `{NN}-mutation.json`
 *
 * `workflow.mutation_gate`: `off` · `report` (the default: a report, never a refusal) ·
 * `gate` (reserved for V5G, which turns survivors into gaps). No coverage is collected:
 * the full suite runs per mutant, so the sample is kept small.
 *
 * The operator table started as scripts/mutation-probe.cjs's, which PAN runs on itself;
 * that probe now imports it from here.
 */
const fs = require('fs');
const path = require('path');
const { execGit, findPhaseInternal, output, error, toPosix } = require('./core.cjs');

const MODES = Object.freeze(['off', 'report', 'gate']);
const DEFAULT_MAX = 8;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const C_FAMILY_COMPARE = [
  { id: 'gte→gt', find: ' >= ', replace: ' > ' },
  { id: 'gt→gte', find: ' > ', replace: ' >= ' },
  { id: 'lte→lt', find: ' <= ', replace: ' < ' },
  { id: 'lt→lte', find: ' < ', replace: ' <= ' },
];

/** The operators, per language family. Each is a plain textual swap, first occurrence on a line. */
const OPERATORS = Object.freeze({
  js: [
    ...C_FAMILY_COMPARE,
    { id: 'eq→neq', find: ' === ', replace: ' !== ' },
    { id: 'neq→eq', find: ' !== ', replace: ' === ' },
    { id: 'and→or', find: ' && ', replace: ' || ' },
    { id: 'or→and', find: ' || ', replace: ' && ' },
    { id: 'true→false', find: 'return true', replace: 'return false' },
    { id: 'false→true', find: 'return false', replace: 'return true' },
    { id: 'plus→minus', find: ' + 1', replace: ' - 1' },
  ],
  c: [
    ...C_FAMILY_COMPARE,
    { id: 'eq→neq', find: ' == ', replace: ' != ' },
    { id: 'neq→eq', find: ' != ', replace: ' == ' },
    { id: 'and→or', find: ' && ', replace: ' || ' },
    { id: 'or→and', find: ' || ', replace: ' && ' },
    { id: 'true→false', find: 'return true', replace: 'return false' },
    { id: 'false→true', find: 'return false', replace: 'return true' },
    { id: 'plus→minus', find: ' + 1', replace: ' - 1' },
  ],
  py: [
    ...C_FAMILY_COMPARE,
    { id: 'eq→neq', find: ' == ', replace: ' != ' },
    { id: 'neq→eq', find: ' != ', replace: ' == ' },
    { id: 'and→or', find: ' and ', replace: ' or ' },
    { id: 'or→and', find: ' or ', replace: ' and ' },
    { id: 'true→false', find: 'return True', replace: 'return False' },
    { id: 'false→true', find: 'return False', replace: 'return True' },
    { id: 'plus→minus', find: ' + 1', replace: ' - 1' },
  ],
});

const LANGUAGES = [
  { family: 'js', re: /\.(c|m)?(j|t)sx?$/i, comments: ['//', '/*', '*'] },
  { family: 'py', re: /\.py$/i, comments: ['#'] },
  { family: 'c', re: /\.(go|rs|java|kt|kts|cs|c|cc|cpp|h|hpp|swift|scala)$/i, comments: ['//', '/*', '*'] },
];

/** The language family of a file, or null when PAN has no operators for it. */
function languageOf(file) {
  return LANGUAGES.find((l) => l.re.test(file)) || null;
}

/**
 * Is this line worth mutating? Skips comments, and a line whose only occurrence of the
 * token is inside a string: a mutated message changes nothing a test should pin. Crude
 * but conservative: on a line with a quote, the token must come before the first quote.
 */
function mutableLine(line, token, comments = ['//', '/*', '*']) {
  const trimmed = line.trim();
  if (!trimmed || comments.some((c) => trimmed.startsWith(c))) return false;
  const at = line.indexOf(token);
  if (at === -1) return false;
  const firstQuote = Math.min(...["'", '"', '`'].map((q) => { const i = line.indexOf(q); return i === -1 ? Infinity : i; }));
  return at < firstQuote;
}

/**
 * Every mutation in a source text: one per (line, operator), first occurrence on the line.
 * @param {string} src
 * @param {{family?: string, comments?: string[], lines?: Set<number>}} [opts] - `lines` limits it to those line numbers
 */
function mutationsFor(src, opts = {}) {
  const ops = OPERATORS[opts.family || 'js'];
  const out = [];
  src.split(/\r?\n/).forEach((line, i) => {
    if (opts.lines && !opts.lines.has(i + 1)) return;
    for (const op of ops) {
      if (!mutableLine(line, op.find, opts.comments)) continue;
      out.push({ line: i + 1, op: op.id, before: line, after: line.replace(op.find, op.replace) });
    }
  });
  return out;
}

/** Apply one mutation to a source string, by line number. Throws if the line moved. */
function applyMutation(src, mutation) {
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const lines = src.split(/\r?\n/);
  if (lines[mutation.line - 1] !== mutation.before) throw new Error(`line ${mutation.line} is not what the mutation was built from`);
  lines[mutation.line - 1] = mutation.after;
  return lines.join(eol);
}

/** Deterministic shuffle-and-take, so a report is reproducible from its seed. */
function sample(items, n, seed) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0x100000000; };
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

/**
 * The line numbers each file gained or changed between two revisions (`git diff -U0`).
 * @returns {Map<string, Set<number>>}
 */
function changedLines(cwd, base, head = 'HEAD') {
  const r = execGit(cwd, ['-c', 'core.quotepath=off', 'diff', '-U0', '--no-color', '--relative', base, head]);
  const out = new Map();
  if (r.exitCode !== 0) return out;
  let file = null;
  for (const line of r.stdout.split('\n')) {
    const f = line.match(/^\+\+\+ (?:b\/)?(.+)$/);
    if (f) { file = f[1] === '/dev/null' ? null : f[1].trim(); continue; }
    const h = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (h && file) {
      const start = Number(h[1]);
      const count = h[2] === undefined ? 1 : Number(h[2]);
      if (!out.has(file)) out.set(file, new Set());
      for (let n = start; n < start + count; n++) out.get(file).add(n);
    }
  }
  return out;
}

/** `workflow.mutation_gate` from config.json; `report` unless set. */
function mutationMode(cwd) {
  const v = (require('./test-gate.cjs').rawConfig(cwd).workflow || {}).mutation_gate;
  return MODES.includes(v) ? v : 'report';
}

/**
 * The mutation report for one phase.
 * @param {string} cwd
 * @param {string} phase
 * @param {{max?: number, seed?: number, timeoutMs?: number}} [opts]
 */
function mutatePhase(cwd, phase, opts = {}) {
  const TG = require('./test-gate.cjs');
  const { phaseBase, withWorktree } = require('./verify-red.cjs');
  const { isTestFile } = require('./verify-integrity.cjs');
  const info = findPhaseInternal(cwd, phase);
  if (!info) return { error: 'phase_not_found', reason: `no phase directory for phase ${phase}` };
  const phaseNumber = info.phase_number || String(phase);
  const mode = mutationMode(cwd);
  const seed = Number.isFinite(opts.seed) ? opts.seed : 1;
  const max = opts.max || DEFAULT_MAX;
  const base = { phase: phaseNumber, mode, seed, checked: false };
  if (mode === 'off' && !opts.force) return { ...base, reason: 'workflow.mutation_gate is off' };
  const b = phaseBase(cwd, phaseNumber);
  if (!b.base) return { ...base, reason: b.reason };
  const suite = TG.detectTestCommand(cwd);
  if (!suite.command) return { ...base, base: b.base, reason: suite.reason };

  // Candidates: changed lines of the phase's own source files, per language.
  const changed = changedLines(cwd, b.base);
  const candidates = [];
  for (const [file, lines] of changed) {
    const lang = languageOf(file);
    if (!lang || isTestFile(file) || !b.files.has(file) || /^\.planning\//.test(file)) continue;
    let src;
    try { src = fs.readFileSync(path.join(cwd, file), 'utf8'); } catch { continue; }
    for (const m of mutationsFor(src, { family: lang.family, comments: lang.comments, lines })) candidates.push({ file, ...m });
  }
  if (!candidates.length) return { ...base, base: b.base, command: suite.command, candidates: 0, reason: 'no mutable line in the source the phase changed' };
  const picked = sample(candidates, max, seed);
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS;
  const killedBy = (r) => r.timed_out || r.exit !== 0;

  const wt = withWorktree(cwd, 'HEAD', (dir) => {
    // Flake pre-check: the unmutated suite must pass, twice, or no mutant can be read.
    const first = TG.runCommand(dir, suite.command, timeoutMs);
    const second = TG.runCommand(dir, suite.command, timeoutMs);
    if (killedBy(first) || killedBy(second)) {
      return { aborted: killedBy(first) !== killedBy(second) ? 'flaky' : 'suite_fails', reason: killedBy(first) !== killedBy(second) ? 'the unmutated suite passed once and failed once: a flaky suite would make every mutant unreadable' : 'the unmutated suite fails at HEAD: fix it before measuring its tests' };
    }
    const results = [];
    for (const m of picked) {
      const file = path.join(dir, m.file);
      const original = fs.readFileSync(file, 'utf8');
      let mutated;
      try { mutated = applyMutation(original, m); } catch { continue; }
      fs.writeFileSync(file, mutated);
      try {
        results.push({ ...m, killed: killedBy(TG.runCommand(dir, suite.command, timeoutMs)) });
      } finally {
        fs.writeFileSync(file, original);
      }
    }
    return { results };
  });
  if (wt.error) return { ...base, base: b.base, reason: wt.error };
  const head = (execGit(cwd, ['rev-parse', 'HEAD']).stdout || '').trim() || null;
  if (wt.value.aborted) return { ...base, base: b.base, head, command: suite.command, candidates: candidates.length, aborted: wt.value.aborted, reason: wt.value.reason };
  const results = wt.value.results;
  const killed = results.filter((r) => r.killed).length;
  const survivors = results.filter((r) => !r.killed).map(({ file, line, op, before, after }) => ({ file: toPosix(file), line, op, before: before.trim(), after: after.trim() }));
  return {
    ...base, checked: results.length > 0, base: b.base, head, command: suite.command,
    candidates: candidates.length, sampled: results.length, killed, survived: survivors.length,
    score: results.length ? Number((killed / results.length).toFixed(2)) : null, survivors,
  };
}

/**
 * `pan-tools verify mutate --phase N [--max n] [--seed n] [--timeout ms]`: writes
 * `{NN}-mutation.json` and exits 0 (report mode; V5G adds the gate).
 */
function cmdVerifyMutate(cwd, opts, raw) {
  if (!opts.phase) error('Usage: verify mutate --phase <N> [--max <n>] [--seed <n>] [--timeout <ms>]');
  const r = mutatePhase(cwd, opts.phase, { max: opts.max ? Number(opts.max) : undefined, seed: opts.seed !== undefined && opts.seed !== null ? Number(opts.seed) : undefined, timeoutMs: opts.timeout ? Number(opts.timeout) : undefined });
  if (r.error) error(r.reason);
  const info = findPhaseInternal(cwd, opts.phase);
  const prefix = String(info.phase_number).split('.').map((p, i) => (i === 0 ? p.padStart(2, '0') : p)).join('.');
  const file = path.join(cwd, info.directory, `${prefix}-mutation.json`);
  fs.writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
  r.record = toPosix(path.relative(cwd, file));
  output(r, raw, r.aborted ? `aborted:${r.aborted}` : (r.checked ? `${r.killed}/${r.sampled} killed` : 'not_checked'));
}

module.exports = { OPERATORS, MODES, languageOf, mutableLine, mutationsFor, applyMutation, sample, changedLines, mutationMode, mutatePhase, cmdVerifyMutate };
