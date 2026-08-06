/**
 * The learnings store must resolve from the module's own location, not cwd — and
 * universal content must never cite an internal pattern id.
 *
 * Regression guard for a High finding from the 2026-08 deployed stability test.
 * The dispatcher resolved the store as `--source-root || cwd`, which is only correct
 * when cwd IS the PAN source repo. In a real install the store lives under the
 * runtime dir and cwd is the user's project, so:
 *
 *   learn topics-for   returned 0 topics from a store holding dozens
 *   learn lint         reported PASS having opened nothing — a green gate over an
 *                      unread store, the exact failure an integrity gate exists to
 *                      prevent
 *   learn build-index  exited non-zero
 *
 * Twenty-five shipped instruction sites across the exec/plan/verify workflows tell
 * agents to run these from the project root, and none passes --source-root, so every
 * one silently got nothing.
 *
 * Fixing resolution then exposed a second defect it had been masking: universal/
 * cited P-1402, which is defined in internal/ — and internal/ is stripped at install
 * time. So `learn lint` FAILED in every install while passing in the repo, where both
 * scopes are present. L-006 checks scope-crossing directly so the source repo can
 * catch it before release.
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PROJECT_ROOT = path.join(__dirname, '..');
const PAN_TOOLS = path.join(PROJECT_ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs');
const learnLint = require(path.join(PROJECT_ROOT, 'pan-wizard-core', 'bin', 'lib', 'learn-lint.cjs'));

let foreignCwd;

/** Run pan-tools from a directory that is NOT the source repo — the install case. */
function run(args, cwd) {
  const r = spawnSync('node', [PAN_TOOLS, ...args], { cwd: cwd || foreignCwd, encoding: 'utf-8', timeout: 60000 });
  return { code: r.status, out: ((r.stdout || '') + (r.stderr || '')).trim() };
}

before(() => {
  foreignCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-learn-cwd-'));
});

after(() => {
  try { fs.rmSync(foreignCwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* best effort */ }
});

describe('the store resolves from the module, not the working directory', () => {
  test('resolveLearningsRoot points at a directory that actually holds the store', () => {
    const root = learnLint.resolveLearningsRoot();
    assert.ok(fs.existsSync(path.join(root, 'pan-wizard-core', 'learnings', 'index.json')),
      `resolveLearningsRoot() must locate the store; got ${root}`);
  });

  test('learn topics-for returns topics when run from a foreign cwd', () => {
    const { code, out } = run(['learn', 'topics-for', '--agent', 'executor', '--token-budget', '5000', '--raw']);

    assert.equal(code, 0, out);
    // REVERT CHECK: with `|| cwd` this selects 0 topics and prints an empty list —
    // which is what every shipped workflow instruction actually received.
    const m = out.match(/Selected:\s*(\d+)\s*topics/);
    assert.ok(m, `expected a "Selected: N topics" line, got: ${out.slice(0, 200)}`);
    assert.ok(Number(m[1]) > 0, 'must select at least one topic for the executor role');
  });

  test('learn lint actually opens the store from a foreign cwd', () => {
    const { out } = run(['learn', 'lint', '--raw']);

    // A gate that reports PASS having scanned nothing is worse than one that fails.
    const m = out.match(/Patterns scanned:\s*(\d+)\s*across\s*(\d+)\s*files/);
    assert.ok(m, `expected a scan summary, got: ${out.slice(0, 200)}`);
    assert.ok(Number(m[1]) > 0, 'must scan a non-zero number of patterns');
    assert.ok(Number(m[2]) > 0, 'must scan a non-zero number of files');
  });

  test('learn build-index succeeds from a foreign cwd', () => {
    const { code } = run(['learn', 'build-index', '--raw']);
    assert.equal(code, 0, 'build-index crashed when it could not find the store');
  });

  test('--source-root still overrides the default', () => {
    const { out } = run(['learn', 'lint', '--source-root', PROJECT_ROOT, '--raw']);
    const m = out.match(/Patterns scanned:\s*(\d+)/);
    assert.ok(m && Number(m[1]) > 0, 'an explicit --source-root must still be honoured');
  });
});

describe('L-006: universal content must not cite internal patterns', () => {
  test('the shipped store passes its own lint', () => {
    const { code } = run(['learn', 'lint', '--raw'], PROJECT_ROOT);
    assert.equal(code, 0, 'the store PAN ships must satisfy its own integrity rules');
  });

  test('a universal pattern citing an internal id is reported', () => {
    // Synthetic, so the rule is pinned independently of the store's current content.
    const violations = learnLint.lintPatterns([
      {
        id: 'P-9001', scope: 'universal', topic: 't', file: 'universal/t.md',
        summary: '', source_experiments: [], superseded_by: null, superseded_id: null,
        body: '## P-9001 — thing\n**Evidence:** corroborated by P-9002 in the internal notes.\n',
      },
      {
        id: 'P-9002', scope: 'internal', topic: 'i', file: 'internal/i.md',
        summary: '', source_experiments: [], superseded_by: null, superseded_id: null,
        body: '## P-9002 — internal thing\n',
      },
    ]).violations;

    const l006 = violations.filter(v => v.code === 'L-006');
    assert.equal(l006.length, 1, `expected one L-006, got ${JSON.stringify(violations)}`);
    assert.equal(l006[0].internal_ref, 'P-9002');
    assert.equal(l006[0].severity, 'error');
  });

  test('a universal pattern citing another universal id is fine', () => {
    const violations = learnLint.lintPatterns([
      {
        id: 'P-9001', scope: 'universal', topic: 't', file: 'universal/t.md',
        summary: '', source_experiments: [], superseded_by: null, superseded_id: null,
        body: '## P-9001 — thing\nsee P-9003 for the sibling case.\n',
      },
      {
        id: 'P-9003', scope: 'universal', topic: 'u', file: 'universal/u.md',
        summary: '', source_experiments: [], superseded_by: null, superseded_id: null,
        body: '## P-9003 — sibling\n',
      },
    ]).violations;

    assert.equal(violations.filter(v => v.code === 'L-006').length, 0,
      'cross-references within universal are legitimate — internal/ is what gets stripped');
  });
});
