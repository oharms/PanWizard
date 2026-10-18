'use strict';

/**
 * The seeded-defect corpus (program H4): small projects with one known defect each, the
 * ground truth a judge's catch rate is measured against.
 *
 * harness/corpus/<id>/
 *   corpus.json   {id, category, task, truth: {file, summary}, catch} — or, for an entry
 *                 generated from a mutation operator, {..., mutation: {base, file, line, op,
 *                 before, after}} and no clean/ or defect/ of its own
 *   clean/        the clean twin: the project as it should be, with its own (weak) tests
 *   defect/       files that replace the clean twin's to make the defective twin
 *   catch/        the catching test, held out from judges: it passes on the clean twin and
 *                 fails on the defective one, so the defect is real and escapes the
 *                 project's own tests (the reason a judge is needed at all)
 * harness/corpus/_base-<name>/  a mutation base (base.json, clean/, catch/): never an entry
 *                 itself; harness/scripts/corpus-generate.cjs derives entries from it
 *
 * Every entry is verified by V4's RED/catch proof (verify-red.cjs checkRed): in a scratch
 * repository the defective twin is the base commit and the clean twin plus the catching
 * test is the phase's plan commit, so `caught` means the test fails on the seeded diff and
 * passes without it. Nothing here calls a model.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const CORPUS_DIR = path.join(REPO, 'harness', 'corpus');
const { applyMutation } = require(path.join(REPO, 'pan-wizard-core', 'bin', 'lib', 'mutate.cjs'));

/** PAN's defect funnel (program H4), plus logic-inversion for generated operator swaps. */
const CATEGORIES = Object.freeze([
  'stub', 'hollow-test', 'unwired-export', 'swallowed-error', 'false-completion-claim',
  'off-by-one', 'test-tampering', 'scope-creep', 'security-flaw', 'logic-inversion',
]);
const TWINS = Object.freeze(['clean', 'defect']);

/** Every file under dir, as sorted posix paths relative to it. */
function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(path.relative(dir, p).replace(/\\/g, '/'));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

/**
 * One corpus entry, validated. Throws with the reason on a malformed entry, so a broken
 * corpus fails loudly instead of scoring judges against nothing.
 */
function loadEntry(dir, corpusDir = path.dirname(dir)) {
  const file = path.join(dir, 'corpus.json');
  const j = readJson(file);
  const id = path.basename(dir);
  const bad = (why) => { throw new Error(`corpus ${id}: ${why}`); };
  if (j.id !== id) bad(`id "${j.id}" does not match its directory`);
  if (!CATEGORIES.includes(j.category)) bad(`category "${j.category}" is not one of ${CATEGORIES.join(', ')}`);
  if (typeof j.task !== 'string' || !j.task.trim()) bad('no task');
  if (!j.truth || typeof j.truth.file !== 'string' || typeof j.truth.summary !== 'string') bad('truth needs file and summary');
  if (typeof j.catch !== 'string' || !j.catch) bad('no catch test path');
  let root = dir;
  if (j.mutation) {
    const m = j.mutation;
    if (!/^_base-/.test(m.base || '') || !m.file || !Number.isInteger(m.line) || typeof m.before !== 'string' || typeof m.after !== 'string') bad('mutation needs base (_base-*), file, line, before and after');
    root = path.join(corpusDir, m.base);
    if (!fs.existsSync(path.join(root, 'base.json'))) bad(`mutation base ${m.base} has no base.json`);
  } else if (!fs.existsSync(path.join(dir, 'defect'))) {
    bad('no defect/ overlay and no mutation');
  }
  if (!fs.existsSync(path.join(root, 'clean'))) bad('no clean/ twin');
  const catchSrc = path.join(root, 'catch', path.basename(j.catch));
  if (!fs.existsSync(catchSrc)) bad(`no catching test at ${path.relative(corpusDir, catchSrc)}`);
  return { ...j, dir, root, catchSrc, generated: !!j.mutation };
}

/** Every entry in the corpus, sorted by id. Directories starting with `_` or `.` are not entries. */
function loadCorpus(corpusDir = CORPUS_DIR) {
  return fs.readdirSync(corpusDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !/^[_.]/.test(e.name))
    .map((e) => loadEntry(path.join(corpusDir, e.name), corpusDir))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * The files of one twin, as a Map of posix relative path → content. The catching test is
 * included only with `withCatch`: judges never see it.
 */
function twinFiles(entry, twin, { withCatch = false } = {}) {
  if (!TWINS.includes(twin)) throw new Error(`twin must be clean or defect, not ${twin}`);
  const files = new Map();
  const clean = path.join(entry.root, 'clean');
  for (const rel of listFiles(clean)) files.set(rel, fs.readFileSync(path.join(clean, rel), 'utf8'));
  if (twin === 'defect') {
    if (entry.mutation) {
      const m = entry.mutation;
      if (!files.has(m.file)) throw new Error(`corpus ${entry.id}: mutation file ${m.file} is not in the base`);
      files.set(m.file, applyMutation(files.get(m.file), m));
    } else {
      const overlay = path.join(entry.dir, 'defect');
      for (const rel of listFiles(overlay)) files.set(rel, fs.readFileSync(path.join(overlay, rel), 'utf8'));
    }
  }
  if (withCatch) files.set(entry.catch, fs.readFileSync(entry.catchSrc, 'utf8'));
  return files;
}

/** Write a twin into dest (which must exist). */
function materialize(entry, twin, dest, opts = {}) {
  for (const [rel, content] of twinFiles(entry, twin, opts)) {
    const p = path.join(dest, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
  }
}

function git(cwd, args) {
  return execFileSync('git', ['-c', 'user.name=pan-corpus', '-c', 'user.email=corpus@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
}

/** Run the project's own suite in dir; `{exit, output}`. */
function runSuite(dir, timeoutMs) {
  const TG = require(path.join(REPO, 'pan-wizard-core', 'bin', 'lib', 'test-gate.cjs'));
  return TG.runCommand(dir, 'node --test', timeoutMs);
}

/**
 * Verify one entry:
 *   clean_green  the clean twin's suite, catching test included, passes
 *   escapes      the defective twin's own suite (no catching test) passes: the defect gets
 *                past the project's tests, so finding it is a judge's job
 *   red          V4 checkRed on the scratch repository: every test the "fix" commit
 *                changed (the catching test, plus a restored project test for the
 *                hollow-test and test-tampering kinds) is `caught`
 * @returns {{id, ok, clean_green, escapes, red: Object, reasons: string[]}}
 */
function verifyEntry(entry, { timeoutMs = 60 * 1000 } = {}) {
  const { checkRed } = require(path.join(REPO, 'pan-wizard-core', 'bin', 'lib', 'verify-red.cjs'));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pan-corpus-${entry.id}-`));
  const reasons = [];
  try {
    const cleanDir = path.join(root, 'clean');
    fs.mkdirSync(cleanDir);
    materialize(entry, 'clean', cleanDir, { withCatch: true });
    const clean = runSuite(cleanDir, timeoutMs);
    if (clean.exit !== 0) reasons.push('the clean twin fails its own suite or the catching test');

    const defectDir = path.join(root, 'defect');
    fs.mkdirSync(defectDir);
    materialize(entry, 'defect', defectDir);
    const defect = runSuite(defectDir, timeoutMs);
    if (defect.exit !== 0) reasons.push('the defect does not escape: the project\'s own tests already fail on it');

    const repo = path.join(root, 'repo');
    fs.mkdirSync(path.join(repo, '.planning', 'phases', '01-corpus'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.planning', 'phases', '01-corpus', '.gitkeep'), '');
    git(repo, ['init', '-q']);
    materialize(entry, 'defect', repo);
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'chore: seeded defect']);
    for (const rel of twinFiles(entry, 'defect').keys()) fs.rmSync(path.join(repo, rel), { force: true });
    materialize(entry, 'clean', repo, { withCatch: true });
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', 'fix(01-01): clean twin with its catching test']);
    const red = checkRed(repo, '1', { timeoutMs });
    const catchRow = (red.files || []).find((f) => f.file === entry.catch);
    if (!catchRow || catchRow.verdict !== 'caught') reasons.push(`the catching test is ${catchRow ? catchRow.verdict : 'not checked'} by verify red${red.reason ? ` (${red.reason})` : ''}`);
    else if (!red.ok) reasons.push(`verify red: ${(red.files || []).filter((f) => f.verdict !== 'caught').map((f) => `${f.file} ${f.verdict}`).join(', ')}`);
    return { id: entry.id, ok: reasons.length === 0, clean_green: clean.exit === 0, escapes: defect.exit === 0, red: { ok: red.ok, files: (red.files || []).map((f) => ({ file: f.file, verdict: f.verdict })) }, reasons };
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

module.exports = { CORPUS_DIR, CATEGORIES, TWINS, listFiles, loadEntry, loadCorpus, twinFiles, materialize, verifyEntry, runSuite };
