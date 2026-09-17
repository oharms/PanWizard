/**
 * The mutation probe's own tests (scripts/mutation-probe.cjs, spec
 * docs/specs/testing-system-redesign-2026-09.md phase 6).
 *
 * The probe answers the question coverage cannot: not "did this line run" but "would the
 * suite notice if it were wrong". Its verdict is only worth reading if the mutation
 * machinery itself is right, so the pure parts are pinned here: which lines are worth
 * mutating, that a mutation changes exactly one line, that the sample is reproducible from
 * its seed, and that a stale line number is refused rather than guessed at.
 *
 * The probe's own run path is not exercised here on purpose: one pass spawns whole test
 * files per mutant and takes minutes. It is a report-only tool, run by hand.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  mutationsFor, applyMutation, mutableLine, sample, OPERATORS, TARGETS,
} = require('../scripts/mutation-probe.cjs');

const ROOT = path.join(__dirname, '..');

describe('mutation probe — which lines are worth breaking', () => {
  test('mutates real code, not comments or message strings', () => {
    assert.equal(mutableLine('  if (a === b) return 1;', ' === '), true);
    assert.equal(mutableLine('  // if (a === b) matters', ' === '), false, 'a line comment is not code');
    assert.equal(mutableLine('   * a === b in a block comment', ' === '), false, 'a block-comment body is not code');
    assert.equal(mutableLine("  const msg = 'a === b';", ' === '), false,
      'mutating a message changes nothing a test should pin, so it would only add noise');
    assert.equal(mutableLine('', ' === '), false);
    assert.equal(mutableLine('  if (x > 1) {', ' === '), false, 'the token has to be present');
  });

  test('a token before the first quote is still mutated', () => {
    // `if (a === b) throw new Error('...')` is real logic followed by a string.
    assert.equal(mutableLine("  if (a === b) throw new Error('nope === nope');", ' === '), true);
  });

  test('the operator set is small, and every operator really changes the code', () => {
    assert.ok(OPERATORS.length >= 8, `expected a useful operator set, got ${OPERATORS.length}`);
    for (const op of OPERATORS) {
      assert.notEqual(op.find, op.replace, `operator ${op.id} is a no-op`);
      assert.ok(op.id && op.find && op.replace, `operator ${JSON.stringify(op)} is incomplete`);
    }
  });
});

describe('mutation probe — applying one mutation', () => {
  const SRC = [
    'function f(a, b) {',
    '  if (a >= b) return true;',
    '  return false;',
    '}',
  ].join('\n');

  test('changes exactly one line and leaves the rest byte-identical', () => {
    const muts = mutationsFor(SRC);
    assert.ok(muts.length >= 3, `expected several mutations, got ${muts.length}`);

    const gte = muts.find((m) => m.op === 'gte→gt');
    assert.ok(gte, 'the >= on line 2 should be mutable');
    assert.equal(gte.line, 2);

    const out = applyMutation(SRC, gte);
    const before = SRC.split('\n');
    const after = out.split('\n');
    assert.equal(after.length, before.length, 'the line count must not change');
    const changed = after.filter((l, i) => l !== before[i]);
    assert.deepEqual(changed, ['  if (a > b) return true;'], 'exactly one line, mutated as described');
  });

  test('preserves the file\'s line endings, which this repo checks out as CRLF', () => {
    const crlf = SRC.replace(/\n/g, '\r\n');
    const m = mutationsFor(crlf).find((x) => x.op === 'gte→gt');
    const out = applyMutation(crlf, m);
    assert.ok(out.includes('\r\n'), 'CRLF must survive the mutation');
    assert.equal(out.includes('\n\n'), false, 'no bare LF was introduced');
  });

  test('refuses a mutation whose line has moved instead of corrupting a different line', () => {
    const m = mutationsFor(SRC).find((x) => x.op === 'gte→gt');
    const shifted = '// a new first line\n' + SRC;
    assert.throws(() => applyMutation(shifted, m), /line 2 is not what the mutation was built from/);
  });

  test('every mutation it offers for a real shipped file applies cleanly', () => {
    // The probe builds its candidates from the file it is about to mutate, so each one
    // must apply; a mismatch here would mean the extractor and the applier disagree.
    const rel = 'pan-wizard-core/bin/lib/cost.cjs';
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    const muts = mutationsFor(src);
    assert.ok(muts.length > 20, `expected many candidates in ${rel}, got ${muts.length}`);
    for (const m of muts) {
      const out = applyMutation(src, m);
      assert.notEqual(out, src, `${rel}:${m.line} ${m.op} changed nothing`);
    }
  });
});

describe('mutation probe — sampling and targets', () => {
  test('the same seed picks the same mutants, a different seed does not', () => {
    const items = Array.from({ length: 50 }, (_, i) => i);
    assert.deepEqual(sample(items, 10, 42), sample(items, 10, 42), 'a run must be reproducible from its seed');
    assert.notDeepEqual(sample(items, 10, 42), sample(items, 10, 43));
  });

  test('a sample never exceeds what is available and never repeats a mutant', () => {
    const items = [1, 2, 3];
    assert.equal(sample(items, 10, 1).length, 3, 'asking for more than exists yields what exists');
    const picked = sample(Array.from({ length: 30 }, (_, i) => i), 12, 5);
    assert.equal(new Set(picked).size, picked.length, 'the same mutant must not be run twice');
  });

  test('every declared target exists and names test files that exist', () => {
    // A target pointing at a moved file would report a perfect score by running nothing.
    assert.ok(TARGETS.length >= 3, 'the probe should cover the hooks and the dispatcher');
    for (const t of TARGETS) {
      assert.equal(fs.existsSync(path.join(ROOT, t.file)), true, `target ${t.file} does not exist`);
      assert.ok(t.tests.length > 0, `target ${t.file} names no tests`);
      for (const f of t.tests) {
        assert.equal(fs.existsSync(path.join(ROOT, f)), true, `${t.file} names a test file that does not exist: ${f}`);
      }
    }
  });

  test('the hooks and the dispatcher are both covered, as the spec requires', () => {
    const files = TARGETS.map((t) => t.file);
    assert.ok(files.some((f) => f.startsWith('hooks/')), 'no hook target');
    assert.ok(files.some((f) => f.endsWith('pan-tools.cjs')), 'the dispatcher is not a target');
  });

  test('it is not wired into any gate', () => {
    // Report-only is a property of the repo, not just an intention in a comment: a
    // survivor is a question, and some survivors are correct.
    const release = fs.readFileSync(path.join(ROOT, 'scripts', 'release-check.js'), 'utf-8');
    assert.equal(release.includes('mutation-probe'), false, 'release-check must not run the probe');
    const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8');
    assert.equal(ci.includes('mutation-probe'), false, 'CI must not run the probe');
  });
});
