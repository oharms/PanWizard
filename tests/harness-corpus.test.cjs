/**
 * Seeded-defect corpus and detection scoreboard (program H4).
 *
 * The corpus is ground truth for every judge's catch rate, so it must itself be proven:
 * each entry's catching test passes on the clean twin, fails on the defective one (V4's
 * RED/catch proof, verify-red.cjs checkRed), and the defect escapes the project's own
 * tests. The scoreboard is pinned on the committed synthetic replay at $0, in both
 * directions: a judge that misses scores lower, and a weakened judge loses the paired SPRT.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const corpus = require('../harness/src/corpus.cjs');
const { generate, categoryOf, mutantId } = require('../harness/scripts/corpus-generate.cjs');
const { readRows, scoreRow, scoreboard, compare, renderMarkdown, keyOf } = require('../harness/scripts/catch-rate.cjs');
const { parseArgs, detectionScoreboard } = require('../harness/src/run.cjs');
const { cleanup } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const REPLAY = path.join(ROOT, 'harness', 'corpus-replays', 'synthetic-reviewer.jsonl');
const BASELINE = 'pan-reviewer × double × balanced';
const WEAKENED = 'pan-reviewer × double × weakened';

const entries = corpus.loadCorpus();

function verdictReport(outcome, findings = []) {
  const verdict = outcome === 'pass' ? 'PASS' : 'NEEDS_FIXES';
  return '```pan-verdict\n' + JSON.stringify({ contract: '1.0', agent: 'pan-reviewer', verdict, outcome, findings }) + '\n```\n';
}

describe('corpus layout', () => {
  test('every defect-funnel category has at least one entry', () => {
    const have = new Set(entries.map((e) => e.category));
    for (const c of corpus.CATEGORIES) assert.ok(have.has(c), `no corpus entry for category ${c}`);
  });

  test('ids are unique and match their directories', () => {
    const ids = entries.map((e) => e.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const e of entries) assert.equal(path.basename(e.dir), e.id);
  });

  test('a judge never sees the catching test; the defect twin differs from the clean twin', () => {
    for (const e of entries) {
      const clean = corpus.twinFiles(e, 'clean');
      const defect = corpus.twinFiles(e, 'defect');
      assert.equal(clean.has(e.catch), false, `${e.id}: the catching test leaked into the clean twin`);
      assert.equal(defect.has(e.catch), false, `${e.id}: the catching test leaked into the defect twin`);
      assert.equal(corpus.twinFiles(e, 'clean', { withCatch: true }).has(e.catch), true);
      const changed = [...defect.keys()].filter((k) => clean.get(k) !== defect.get(k));
      assert.ok(changed.length > 0, `${e.id}: the defect twin is identical to the clean twin`);
      assert.ok(defect.has(e.truth.file), `${e.id}: truth file ${e.truth.file} is not in the project`);
    }
  });

  test('a malformed entry is refused with its reason', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-corpus-bad-'));
    try {
      const e = path.join(dir, 'bad-one');
      fs.mkdirSync(path.join(e, 'clean'), { recursive: true });
      fs.writeFileSync(path.join(e, 'corpus.json'), JSON.stringify({ id: 'bad-one', category: 'nonsense', task: 't', truth: { file: 'a', summary: 's' }, catch: 'test/c.js' }));
      assert.throws(() => corpus.loadCorpus(dir), /category "nonsense"/);
      fs.writeFileSync(path.join(e, 'corpus.json'), JSON.stringify({ id: 'bad-one', category: 'stub', task: 't', truth: { file: 'a', summary: 's' }, catch: 'test/c.js' }));
      assert.throws(() => corpus.loadCorpus(dir), /no defect\/ overlay and no mutation/);
      fs.writeFileSync(path.join(e, 'corpus.json'), JSON.stringify({ id: 'other', category: 'stub', task: 't', truth: { file: 'a', summary: 's' }, catch: 'test/c.js' }));
      assert.throws(() => corpus.loadCorpus(dir), /does not match its directory/);
    } finally {
      cleanup(dir);
    }
  });
});

describe('every corpus entry passes V4 (the defect is real and escapes)', () => {
  for (const e of entries) {
    test(e.id, () => {
      const r = corpus.verifyEntry(e);
      assert.deepEqual(r.reasons, []);
      assert.equal(r.clean_green, true);
      assert.equal(r.escapes, true);
      assert.ok(r.red.files.some((f) => f.file === e.catch && f.verdict === 'caught'));
    });
  }

  test('a non-defect is refused: a "defect" twin identical in behaviour is not caught', () => {
    const base = entries.find((e) => e.id === 'off-by-one-paginate');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-corpus-fake-'));
    try {
      const copy = path.join(dir, base.id);
      fs.cpSync(base.dir, copy, { recursive: true });
      fs.copyFileSync(path.join(copy, 'clean', 'src', 'paginate.js'), path.join(copy, 'defect', 'src', 'paginate.js'));
      fs.appendFileSync(path.join(copy, 'defect', 'src', 'paginate.js'), '\n');
      const r = corpus.verifyEntry(corpus.loadEntry(copy, dir));
      assert.equal(r.ok, false);
      assert.match(r.reasons.join('\n'), /catching test is not_red/);
    } finally {
      cleanup(dir);
    }
  });
});

describe('corpus-generate: entries from the mutation operators', () => {
  test('the committed generated entries are exactly what the generator keeps', () => {
    const { kept, candidates } = generate({ base: '_base-range' });
    assert.ok(candidates > kept.length, 'some mutants must be dropped as equivalent');
    const committed = entries.filter((e) => e.generated && e.mutation.base === '_base-range').map((e) => e.id).sort();
    assert.deepEqual(kept.map((k) => k.id).sort(), committed);
    for (const k of kept) {
      const onDisk = JSON.parse(fs.readFileSync(path.join(corpus.CORPUS_DIR, k.id, 'corpus.json'), 'utf8'));
      assert.deepEqual(onDisk, k.entry);
    }
  });

  test('categories and ids', () => {
    assert.equal(categoryOf('gte→gt'), 'off-by-one');
    assert.equal(categoryOf('and→or'), 'logic-inversion');
    assert.equal(mutantId('_base-range', { line: 5, op: 'and→or' }), 'gen-range-L5-and-to-or');
  });
});

describe('catch-rate: scoring a judge report', () => {
  const stub = entries.find((e) => e.id === 'stub-slugify');
  const row = (report, twin = 'defect') => ({ corpus: stub.id, twin, judge: 'pan-reviewer', host: 'double', profile: 'balanced', report });

  test('a fail verdict naming the truth file is flagged and located', () => {
    const s = scoreRow(row(verdictReport('fail', [{ class: 'defect', severity: 'high', where: 'src/slugify.js:4', summary: 'stub' }])), stub);
    assert.equal(s.status, 'flagged');
    assert.equal(s.located, true);
  });

  test('a fail verdict pointing elsewhere is flagged but not located', () => {
    const s = scoreRow(row(verdictReport('fail', [{ class: 'quality', severity: 'low', where: 'README.md', summary: 'docs' }])), stub);
    assert.equal(s.status, 'flagged');
    assert.equal(s.located, false);
  });

  test('a pass verdict is a miss, and a report with no verdict is unreadable, never a miss', () => {
    assert.equal(scoreRow(row(verdictReport('pass')), stub).status, 'passed');
    const u = scoreRow(row('Looks fine to me.'), stub);
    assert.equal(u.status, 'unreadable');
    assert.match(u.reason, /no pan-verdict block/);
    assert.equal(scoreRow({ ...row(verdictReport('pass')), corpus: 'no-such-entry' }, undefined).status, 'unreadable');
  });
});

describe('catch-rate: the scoreboard on the committed synthetic replay ($0)', () => {
  const rows = readRows([REPLAY]);
  const board = scoreboard(rows, entries);
  const byKey = Object.fromEntries(board.map((b) => [b.key, b]));

  test('the replay covers every entry and both twins for each key', () => {
    for (const key of [BASELINE, WEAKENED]) {
      const mine = rows.filter((r) => keyOf(r) === key);
      assert.equal(mine.length, entries.length * 2, key);
    }
  });

  test('catch and false-alarm rates with Wilson intervals', () => {
    const b = byKey[BASELINE];
    assert.equal(b.catch.n, entries.length);
    assert.equal(b.catch.caught, entries.length - 2);
    assert.ok(b.catch.interval.lower < b.catch.interval.p && b.catch.interval.p < b.catch.interval.upper);
    // Generated entries share their base's clean project: it counts once.
    const cleanProjects = new Set(entries.map((e) => (e.mutation ? e.mutation.base : e.id))).size;
    assert.equal(b.falseAlarm.n, cleanProjects);
    assert.equal(b.falseAlarm.flagged, 1);
    assert.equal(b.categories['scope-creep'].caught, 0);
    assert.equal(byKey[WEAKENED].catch.caught, 3);
  });

  test('a weakened judge scores lower and loses the paired SPRT', () => {
    assert.ok(byKey[WEAKENED].catch.caught < byKey[BASELINE].catch.caught);
    const c = compare(rows, entries, BASELINE, WEAKENED);
    assert.equal(c.sprt.decision, 'h0');
    assert.ok(c.sprt.aOnly > c.sprt.bOnly);
    // Swapped, the stronger judge wins.
    assert.equal(compare(rows, entries, WEAKENED, BASELINE).sprt.decision, 'h1');
  });

  test('the markdown carries every key and the per-category line', () => {
    const md = renderMarkdown(board).join('\n');
    assert.match(md, /## Detection scoreboard/);
    for (const key of [BASELINE, WEAKENED]) assert.ok(md.includes(`| ${key} |`), key);
    assert.match(md, /by category: .*scope-creep 0\/1/);
  });
});

describe('run.cjs --scoreboard', () => {
  test('the flag is repeatable and resolves paths', () => {
    const a = parseArgs(['--scoreboard', 'a.jsonl', '--scoreboard', 'b.jsonl']);
    assert.deepEqual(a.scoreboards, [path.resolve('a.jsonl'), path.resolve('b.jsonl')]);
    assert.deepEqual(parseArgs([]).scoreboards, []);
  });

  test('detectionScoreboard scores the result files against the corpus', () => {
    const board = detectionScoreboard([REPLAY]);
    assert.deepEqual(board.map((b) => b.key).sort(), [BASELINE, WEAKENED].sort());
  });
});
