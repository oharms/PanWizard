/**
 * SSoT self-audit (anti-fake hardening, ADR-0036 review finding).
 *
 * CLAUDE.md's counts table is the declared single source of truth for counts,
 * but it was hand-maintained with NO check that it matches the filesystem — so
 * it could drift silently (add a command without bumping the table and nothing
 * complained). This test recomputes every FILE-BASED count from disk and asserts
 * the CLAUDE.md table matches, so the source of truth can no longer drift unseen.
 *
 * Runtime-derived counts (Total tests / Total test suites) are intentionally NOT
 * asserted here — they require running the suite, not counting files, and are
 * explicitly documented in CLAUDE.md as a drifting snapshot.
 */
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const P = (...s) => path.join(ROOT, ...s);

const lsCount = (dir, re) => {
  try { return fs.readdirSync(P(dir)).filter(f => re.test(f)).length; }
  catch { return -1; }
};
const walkMd = (dir) => {
  let entries;
  try { entries = fs.readdirSync(P(dir), { withFileTypes: true }); } catch { return -1; }
  let n = 0;
  for (const e of entries) {
    if (e.isDirectory()) { const sub = walkMd(path.join(dir, e.name)); if (sub > 0) n += sub; }
    else if (e.name.endsWith('.md')) n++;
  }
  return n;
};

// CLAUDE.md count-table label → filesystem computation (mirrors the refresh
// snippet documented in CLAUDE.md). Keys must match the table labels exactly.
const COUNTS = {
  'Commands (`commands/pan/*.md`)': () => lsCount('commands/pan', /\.md$/),
  'Agents (`agents/*.md`)': () => lsCount('agents', /\.md$/),
  'Core modules (`pan-wizard-core/bin/lib/*.cjs`)': () => lsCount('pan-wizard-core/bin/lib', /\.cjs$/),
  'Workflows (`pan-wizard-core/workflows/*.md`)': () => lsCount('pan-wizard-core/workflows', /\.md$/),
  'Templates (`pan-wizard-core/templates/*.md`)': () => walkMd('pan-wizard-core/templates'),
  'References (`pan-wizard-core/references/*.md`)': () => lsCount('pan-wizard-core/references', /\.md$/),
  'Unit test files (`tests/*.test.cjs`)': () => lsCount('tests', /\.test\.cjs$/),
  'Scenario test files (`tests/scenarios/*.test.cjs`)': () => lsCount('tests/scenarios', /\.test\.cjs$/),
  'Hooks (`hooks/*.js`)': () => lsCount('hooks/dist', /\.js$/),
  'Specs (`docs/specs/*.md`)': () => lsCount('docs/specs', /\.md$/),
  'ADRs (`docs/decisions/ADR-*.md`)': () => lsCount('docs/decisions', /^ADR-.*\.md$/),
};

function parseClaudeMdCounts() {
  const md = fs.readFileSync(P('CLAUDE.md'), 'utf-8');
  const map = {};
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\|\s*(.+?)\s*\|\s*(\d+)\s*\|\s*$/);
    if (m) map[m[1].trim()] = Number(m[2]);
  }
  return map;
}

describe('CLAUDE.md counts table — SSoT self-audit (must match the filesystem)', () => {
  const table = parseClaudeMdCounts();
  for (const [label, compute] of Object.entries(COUNTS)) {
    test(`${label} matches disk`, () => {
      const claimed = table[label];
      assert.notEqual(claimed, undefined,
        `CLAUDE.md counts table has no row "${label}" — did the label change? Update this test and the table together.`);
      const actual = compute();
      assert.ok(actual >= 0, `filesystem path for "${label}" not found`);
      assert.equal(claimed, actual,
        `CLAUDE.md says ${claimed} for "${label}" but the filesystem has ${actual}. Refresh the CLAUDE.md counts table (see the snippet in CLAUDE.md) in the same change.`);
    });
  }
});
