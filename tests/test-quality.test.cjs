/**
 * Test-quality lint — the assertion shapes that passed while the feature was broken
 * (audit 2026-09-17) are forbidden in the suite, or allowlisted per file and rule with
 * a reason and a count (tests/fixtures/test-quality-allowlist.json). Rules live in
 * scripts/test-quality-lint.cjs so tests/test-system.test.cjs can pin them.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { lintTestSource, applyAllowlist, RULES } = require('../scripts/test-quality-lint.cjs');
const { ROOT, listTestFiles } = require('../scripts/test-surface.cjs');

const ALLOWLIST_REL = path.join('tests', 'fixtures', 'test-quality-allowlist.json');
// These two carry the banned shapes as literal fixtures.
const SELF = new Set(['tests/test-quality.test.cjs', 'tests/test-system.test.cjs']);

describe('test quality — assertions that can fail', () => {
  test('every rule has an id, a title and a fix', () => {
    for (const r of RULES) {
      assert.match(r.id, /^Q\d$/);
      assert.ok(r.title && r.fix && typeof r.detect === 'function');
    }
    assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  });

  test('the suite carries none of the banned shapes beyond its reasoned allowlist', () => {
    let allowlist = [];
    try { allowlist = JSON.parse(fs.readFileSync(path.join(ROOT, ALLOWLIST_REL), 'utf8')); } catch { /* none */ }
    const findings = [];
    for (const file of listTestFiles(ROOT)) {
      if (SELF.has(file)) continue;
      findings.push(...lintTestSource(fs.readFileSync(path.join(ROOT, file), 'utf8'), file));
    }
    const { remaining, stale } = applyAllowlist(findings, allowlist);
    const lines = [
      ...remaining.map((f) => `${f.rule} ${f.file}:${f.line} — ${f.title}: ${f.text}\n      fix: ${f.fix}`),
      ...stale.map((s) => `stale allowlist entry ${s.file} ${s.rule}: ${s.why}`),
    ];
    assert.deepEqual(lines, [], `\n${lines.join('\n')}\n`);
  });
});
