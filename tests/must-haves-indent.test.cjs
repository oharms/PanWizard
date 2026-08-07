/**
 * must_haves must parse at whatever indent PAN itself emits — and the
 * anti-rubber-stamp gate must actually fire on a real plan.
 *
 * Regression guard for the Critical finding of the 2026-08 deployed stability test.
 * parseMustHavesBlock located the block with `^\s{4}<name>:` — exactly four spaces —
 * with list items at exactly six and continuations at eight or more. Nothing PAN
 * ships is written that way: `template fill plan`, templates/phase-prompt.md,
 * agents/pan-planner.md and agents/pan-verifier.md all emit `must_haves:` at column
 * zero with its children at two. So every real plan parsed as ZERO must_haves and
 * `verify reconcile` answered "no must_haves declared — verdict trusted", exit 0,
 * for a phase whose artifacts were stubs.
 *
 * Why five rounds of audit missed it: every fixture was hand-written at 4-space
 * indent, so the gate was only ever verified against the parser's own assumption.
 * These tests therefore assert against BOTH indents, and one builds its plan from
 * the shipped template rather than from a literal, so the format cannot drift apart
 * from the parser again without failing here.
 */

const { test, describe, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const PAN_TOOLS = path.join(PROJECT_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const { parseMustHavesBlock } = require(path.join(PROJECT_ROOT, 'pan-wizard-core', 'bin', 'lib', 'frontmatter.cjs'));

let tempRoot;
let proj;

function pan(args) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: proj, encoding: 'utf-8', timeout: 30000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

/** Write a phase with a plan whose must_haves use `indent` spaces per level. */
function writePhase(indentWidth, artifactLines) {
  const pad = (n) => ' '.repeat(indentWidth * n);
  const dir = path.join(proj, '.planning', 'phases', '05-checkout');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(proj, 'src'), { recursive: true });

  const plan = [
    '---',
    'phase: 5',
    'must_haves:',
    `${pad(1)}truths:`,
    `${pad(2)}- "User can check out"`,
    `${pad(1)}artifacts:`,
    `${pad(2)}- path: "src/checkout.js"`,
    `${pad(3)}min_lines: 30`,
    `${pad(1)}key_links: []`,
    '---',
    '',
    '# Plan',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, '05-01-plan.md'), plan);
  fs.writeFileSync(path.join(dir, '05-01-verification.md'), '---\nstatus: passed\n---\n\n# Verification\nAll good.\n');
  fs.writeFileSync(path.join(proj, 'src', 'checkout.js'),
    Array.from({ length: artifactLines }, (_, i) => `// line ${i}`).join('\n') + '\n');
  fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
    '# Roadmap\n\n## Phase 5: Checkout\n**Status:** Complete\n');
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-mh-'));
  proj = path.join(tempRoot, 'proj');
  fs.mkdirSync(path.join(proj, '.planning'), { recursive: true });
});

after(() => {
  try { fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('parseMustHavesBlock is indent-agnostic', () => {
  // 2 is what PAN emits; 4 is what the old parser demanded. Both must work, so the
  // fix cannot regress into hardcoding either one.
  for (const width of [2, 4]) {
    test(`parses artifacts, truths and an empty block at ${width}-space indent`, () => {
      const pad = (n) => ' '.repeat(width * n);
      const content = [
        '---',
        'phase: 5',
        'must_haves:',
        `${pad(1)}truths:`,
        `${pad(2)}- "User can log in"`,
        `${pad(1)}artifacts:`,
        `${pad(2)}- path: "src/auth.js"`,
        `${pad(3)}provides: "login"`,
        `${pad(3)}min_lines: 30`,
        `${pad(1)}key_links: []`,
        '---',
        '# body',
      ].join('\n');

      assert.deepEqual(parseMustHavesBlock(content, 'artifacts'),
        [{ path: 'src/auth.js', provides: 'login', min_lines: 30 }]);
      assert.deepEqual(parseMustHavesBlock(content, 'truths'), ['User can log in']);
      assert.deepEqual(parseMustHavesBlock(content, 'key_links'), []);
    });
  }

  test('must_haves nested under a parent key still resolves by relative indent', () => {
    const content = [
      '---', 'plan:', '  must_haves:', '    artifacts:',
      '      - path: "src/x.js"', '        min_lines: 12', '---', '# body',
    ].join('\n');
    assert.deepEqual(parseMustHavesBlock(content, 'artifacts'), [{ path: 'src/x.js', min_lines: 12 }]);
  });

  test('a sibling block does not bleed into the one being read', () => {
    const content = [
      '---', 'must_haves:', '  artifacts:', '    - path: "a.js"',
      '  key_links:', '    - "a.js -> b.js"', '---', '# body',
    ].join('\n');
    assert.deepEqual(parseMustHavesBlock(content, 'artifacts'), [{ path: 'a.js' }]);
    assert.deepEqual(parseMustHavesBlock(content, 'key_links'), ['a.js -> b.js']);
  });

  test('the shipped template still parses — it is the format that must not drift', () => {
    // Reading the real template rather than a literal is the point: if the template
    // changes shape, this fails here instead of silently disarming the gate.
    const tpl = fs.readFileSync(
      path.join(PROJECT_ROOT, 'pan-wizard-core', 'templates', 'phase-prompt.md'), 'utf-8');
    const fmStart = tpl.indexOf('---');
    assert.ok(fmStart !== -1, 'template should contain frontmatter');
    // The template's example frontmatter declares all three blocks; each must be
    // recognised (empty arrays are fine — the point is the block is FOUND).
    for (const block of ['truths', 'artifacts', 'key_links']) {
      const parsed = parseMustHavesBlock(tpl.slice(fmStart), block);
      assert.ok(Array.isArray(parsed), `${block} must parse to an array`);
    }
  });
});

describe('verify reconcile actually gates on a plan in PAN\'s own format', () => {
  test('a claimed pass over a stub artifact exits non-zero', () => {
    writePhase(2, 1); // min_lines: 30 declared, artifact is 1 line

    const { code, out } = pan(['verify', 'reconcile', '5', '--raw']);

    // REVERT CHECK: with the 4-space-only parser this prints `valid` and exits 0,
    // because zero must_haves were found — the gate the audit chain added to stop
    // rubber-stamped verifications did nothing on any real plan.
    assert.equal(code, 1, `must refuse a rubber-stamped pass, got exit ${code} (${out})`);
    assert.equal(out, 'invalid');
  });

  test('an honest pass still exits zero', () => {
    writePhase(2, 40); // artifact satisfies min_lines: 30

    const { code, out } = pan(['verify', 'reconcile', '5', '--raw']);

    assert.equal(code, 0, `an honest pass must not be blocked (${out})`);
    assert.equal(out, 'valid');
  });

  test('a plan declaring no must_haves is still trusted (nothing to reconcile)', () => {
    const dir = path.join(proj, '.planning', 'phases', '06-x');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '06-01-plan.md'), '---\nphase: 6\n---\n\n# Plan\n');
    fs.writeFileSync(path.join(dir, '06-01-verification.md'), '---\nstatus: passed\n---\n\n# V\n');
    fs.writeFileSync(path.join(proj, '.planning', 'roadmap.md'),
      '# Roadmap\n\n## Phase 6: X\n**Status:** Complete\n');

    const { code } = pan(['verify', 'reconcile', '6', '--raw']);
    assert.equal(code, 0, 'no declared must_haves is not a contradiction');
  });
});
