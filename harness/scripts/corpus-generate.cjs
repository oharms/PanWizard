#!/usr/bin/env node
'use strict';

/**
 * Generate corpus entries from a mutation base (program H4), model-free: every mutation
 * V5's operator table (pan-wizard-core/bin/lib/mutate.cjs) can make in the base's
 * `mutate` files becomes a candidate, and a candidate is kept only when it is a real,
 * escaping defect — the catching test fails on it while the base's own suite still passes.
 * An equivalent mutant (no test can tell it apart) is dropped, never filed as a defect.
 *
 *   node harness/scripts/corpus-generate.cjs [--base _base-range] [--max N] [--seed S] [--write]
 *
 * Without --write it prints what it would keep. With --write it writes
 * harness/corpus/gen-<base>-L<line>-<op>/corpus.json for each kept mutant; run the corpus
 * verification test afterwards (tests/harness-corpus.test.cjs) to put each through V4.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CORPUS_DIR, twinFiles, runSuite } = require('../src/corpus.cjs');
const { mutationsFor, languageOf, sample } = require('../../pan-wizard-core/bin/lib/mutate.cjs');

/** Category a generated mutant files under: a boundary swap is an off-by-one; the rest invert logic. */
function categoryOf(op) {
  return /^(gte|gt|lte|lt)→/.test(op) ? 'off-by-one' : 'logic-inversion';
}

/** Directory-safe id for a mutant. */
function mutantId(baseName, m) {
  const op = m.op.replace('→', '-to-');
  return `gen-${baseName.replace(/^_base-/, '')}-L${m.line}-${op}`;
}

function parseArgs(argv) {
  const a = { base: '_base-range', max: Infinity, seed: 1, write: false, corpus: CORPUS_DIR };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--base') a.base = argv[++i];
    else if (k === '--max') a.max = Number(argv[++i]);
    else if (k === '--seed') a.seed = Number(argv[++i]);
    else if (k === '--corpus') a.corpus = path.resolve(argv[++i]);
    else if (k === '--write') a.write = true;
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

/**
 * The kept mutants of one base, each `{id, entry}` where entry is the corpus.json to write.
 * @param {{base: string, max?: number, seed?: number, corpus?: string}} opts
 */
function generate({ base, max = Infinity, seed = 1, corpus = CORPUS_DIR }) {
  const root = path.join(corpus, base);
  const b = JSON.parse(fs.readFileSync(path.join(root, 'base.json'), 'utf8'));
  const pseudo = { id: base, root, dir: root, catch: b.catch, catchSrc: path.join(root, 'catch', path.basename(b.catch)) };
  const clean = twinFiles(pseudo, 'clean');
  let candidates = [];
  for (const file of b.mutate || []) {
    const lang = languageOf(file);
    if (!lang || !clean.has(file)) continue;
    for (const m of mutationsFor(clean.get(file), { family: lang.family, comments: lang.comments })) candidates.push({ ...m, file });
  }
  if (Number.isFinite(max)) candidates = sample(candidates, max, seed);
  const kept = [];
  for (const m of candidates) {
    const mutation = { base, file: m.file, line: m.line, op: m.op, before: m.before, after: m.after };
    const entry = { ...pseudo, mutation };
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-corpus-gen-'));
    try {
      const write = (files) => { for (const [rel, c] of files) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), c); } };
      write(twinFiles(entry, 'defect'));
      const own = runSuite(dir);
      write(new Map([[b.catch, fs.readFileSync(pseudo.catchSrc, 'utf8')]]));
      const withCatch = runSuite(dir);
      if (own.exit === 0 && withCatch.exit !== 0) {
        const id = mutantId(base, m);
        kept.push({ id, entry: {
          id, category: categoryOf(m.op), task: b.task,
          truth: { file: m.file, summary: `line ${m.line}: \`${m.before.trim()}\` became \`${m.after.trim()}\` (${m.op})` },
          catch: b.catch, mutation,
        } });
      }
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  return { candidates: candidates.length, kept };
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const r = generate(args);
  for (const k of r.kept) {
    if (args.write) {
      const dir = path.join(args.corpus, k.id);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'corpus.json'), JSON.stringify(k.entry, null, 2) + '\n');
    }
    process.stdout.write(`${args.write ? 'wrote' : 'keep '} ${k.id} (${k.entry.category})\n`);
  }
  process.stdout.write(`${r.kept.length} of ${r.candidates} mutants are escaping defects\n`);
}

module.exports = { generate, categoryOf, mutantId };
