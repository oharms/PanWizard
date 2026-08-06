/**
 * Roadmap phase numbers are UNPADDED; phase directories are zero-padded. Anything
 * matching one against the other must normalize first.
 *
 * Regression guard for a High finding from the 2026-08 deployed stability test.
 * templates/roadmap.md writes `### Phase 1: [Name]` and `phase add` appends the same,
 * while `scaffold phase-dir` creates `01-foundation`. Code that matched the raw
 * heading number against directory names compared '1-' to '01-foundation' and never
 * hit, so on a roadmap in PAN's OWN template format:
 *
 *   focus scan     found ZERO work items, which made the entire focus family
 *                  (scan/plan/classify-stages/exec/auto) a no-op on any
 *                  default-shaped project
 *   deps validate  invented errors in BOTH directions — "Phase N in roadmap but no
 *                  directory on disk" for phases whose directory was right there,
 *                  plus an "orphaned directory" warning for that same phase
 *
 * `find-phase 1` always worked, because core.cjs normalizes before matching — which
 * is the fix applied at the other sites.
 *
 * The fixtures below use the template's unpadded form deliberately. A test written
 * with padded headings would pass against the bug, which is how this survived.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PAN_TOOLS = path.join(__dirname, '..', 'pan-wizard-core', 'bin', 'pan-tools.cjs');

let tempRoot;
let proj;

function pan(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: proj, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

function json(args) {
  const { out } = pan(args);
  return JSON.parse(out);
}

/** A project whose roadmap headings use `heading` formatting for phase numbers. */
function makeProject(headingNumbers) {
  proj = path.join(tempRoot, 'proj-' + headingNumbers.join('_'));
  for (const n of ['01-foundation', '02-core', '04-hardening']) {
    fs.mkdirSync(path.join(proj, '.planning', 'phases', n), { recursive: true });
    fs.writeFileSync(path.join(proj, '.planning', 'phases', n, `${n.split('-')[0]}-01-plan.md`),
      '---\npriority: P2\neffort: M\n---\n\n# Plan\n');
  }
  const body = headingNumbers.map((n, i) => {
    const names = ['Foundation', 'Core', 'Hardening'];
    return `### Phase ${n}: ${names[i]}\n**Status:** Not Started\n`;
  }).join('\n');
  fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'), `# Roadmap\n\n${body}`);
  fs.writeFileSync(path.join(proj, '.planning', 'state.md'), '# Project State\n\n**Current Phase:** 2\n');
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-pad-'));
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('focus scan matches unpadded roadmap headings to padded directories', () => {
  test('the template form (Phase 1) finds every phase', () => {
    makeProject(['1', '2', '4']); // exactly what templates/roadmap.md writes

    const result = json(['focus', 'scan']);

    // REVERT CHECK: without normalization this is 0 and the message is
    // "No work items found" — the whole focus family dead on a default project.
    assert.equal(result.sources.phases, 3, 'all three phase directories must be found');
    assert.equal(result.items.filter(i => i.source === 'phase').length, 3);
  });

  test('the padded form (Phase 01) still works — normalization is idempotent', () => {
    makeProject(['01', '02', '04']);

    const result = json(['focus', 'scan']);

    assert.equal(result.sources.phases, 3, 'padding the heading must not break matching');
  });

  test('focus plan is no longer blocked by an empty scan', () => {
    makeProject(['1', '2', '4']);
    const { code } = pan(['focus', 'plan']);
    assert.equal(code, 0, 'focus plan errored with "No work items found" before the fix');
  });
});

describe('deps validate does not invent drift from the padding mismatch', () => {
  test('a consistent project reports no issues', () => {
    makeProject(['1', '2', '4']);

    const result = json(['deps', 'validate']);

    // REVERT CHECK: previously 4 errors ("in roadmap but no directory on disk") plus
    // 3 warnings ("directory exists but Phase NN not found in roadmap") — the same
    // phases counted as both missing AND orphaned.
    assert.equal(result.issues.length, 0, `expected no issues, got ${JSON.stringify(result.issues)}`);
    assert.equal(result.valid, true);
  });

  test('a genuinely missing directory is still reported', () => {
    makeProject(['1', '2', '4']);
    // Phase 3 is in the roadmap but has no directory — a real inconsistency that
    // must survive the fix, or we have traded false positives for false negatives.
    const roadmap = path.join(proj, '.planning', 'roadmap.md');
    fs.appendFileSync(roadmap, '\n### Phase 3: Missing\n**Status:** Not Started\n');

    const result = json(['deps', 'validate']);

    const missing = result.issues.filter(i => /no directory on disk/i.test(i.message));
    assert.equal(missing.length, 1, `expected exactly the one real error, got ${JSON.stringify(result.issues)}`);
    assert.match(missing[0].message, /Phase 03|Phase 3/);
  });

  test('a genuinely orphaned directory is still reported', () => {
    makeProject(['1', '2', '4']);
    // A directory with no roadmap entry — also a real inconsistency.
    fs.mkdirSync(path.join(proj, '.planning', 'phases', '07-stray'), { recursive: true });

    const result = json(['deps', 'validate']);

    const orphans = result.issues.filter(i => /exists on disk but/i.test(i.message));
    assert.equal(orphans.length, 1, `expected exactly one orphan, got ${JSON.stringify(result.issues)}`);
    assert.match(orphans[0].message, /07-stray/);
  });
});
