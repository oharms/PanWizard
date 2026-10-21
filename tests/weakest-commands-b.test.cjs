/**
 * Program L6b: the weakest commands, part 2. One test per fix, each proven red first.
 *
 * - settings asks in host-sized batches (at most four questions per AskUserQuestion
 *   call), and drops the choices that change nothing: the `quality` profile is
 *   identical to `balanced`, and the complexity routing strategy reaches no workflow.
 *   The prompt lint now fails any shipped call with more than four questions.
 * - assumptions persist to `{phase}-assumptions.md`, which init exposes and discuss and
 *   plan read.
 * - exec-phase runs the phase-tests workflow, then proves the new tests RED (V4).
 * - retro reads numbered gaps, not only bullets.
 * - preview's milestone ETA derives from git when summaries carry no dates.
 * - audit-deployment is a dev tool: it leaves the shipped commands.
 */
'use strict';

const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const L = require('../scripts/prompt-lint.cjs');
const { cleanup, createTempProject } = require('./helpers.cjs');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const ctx = { ...L.surface(), dev: L.devSkills() };

describe('settings: host-sized batches, no choice that changes nothing (L6b)', () => {
  test('the prompt lint fails a call asking more than four questions', () => {
    const q = (n) => `AskUserQuestion([\n${Array.from({ length: n }, (_, i) => `  { question: "Q${i}?", header: "H${i}", multiSelect: false, options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }`).join(',\n')}\n])`;
    assert.deepEqual(L.lintText('pan-wizard-core/workflows/x.md', q(5), ctx).map((f) => f.rule), ['oversized-ask']);
    assert.deepEqual(L.lintText('pan-wizard-core/workflows/x.md', q(4), ctx).map((f) => f.rule), []);
  });

  test('settings offers neither Quality nor the complexity routing strategy', () => {
    const s = read('pan-wizard-core/workflows/settings.md');
    assert.ok(!/label: "Quality"/.test(s), 'Quality is identical to Balanced: a choice that changes nothing');
    assert.ok(!/label: "Complexity"/.test(s), 'the complexity routing strategy reaches no workflow');
    assert.deepEqual(L.lintText('pan-wizard-core/workflows/settings.md', s, ctx).filter((f) => f.rule === 'oversized-ask'), []);
  });
});

describe('assumptions persist (L6b)', () => {
  test('init exposes {phase}-assumptions.md, and discuss and plan read it', () => {
    const dir = createTempProject();
    try {
      fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'), '# Roadmap\n\n### Phase 1: Core\n**Goal:** g\n');
      fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-core'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-core', '01-assumptions.md'), '# Assumptions\n');
      const out = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'pan-wizard-core', 'bin', 'pan-tools.cjs'), 'init', 'phase-op', '1'], { cwd: dir, encoding: 'utf8' }));
      assert.equal(out.assumptions_path, '.planning/phases/01-core/01-assumptions.md');
    } finally { cleanup(dir); }
    assert.match(read('pan-wizard-core/workflows/assumptions.md'), /\{phase_num\}-assumptions\.md/);
    assert.match(read('pan-wizard-core/workflows/discuss-phase.md'), /assumptions_path/);
    assert.match(read('pan-wizard-core/workflows/plan-phase.md'), /assumptions_path/);
  });
});

describe('exec-phase runs phase-tests and proves the tests RED (L6b)', () => {
  test('the spawn follows the phase-tests workflow, and verify red follows it', () => {
    const e = read('pan-wizard-core/workflows/exec-phase.md');
    assert.match(e, /Follow the phase-tests workflow/);
    assert.match(e, /verify red "?\$\{PHASE_NUMBER\}"?/);
    assert.match(read('pan-wizard-core/workflows/phase-tests.md'), /verify red/);
  });
});

describe('retro reads numbered gaps (L6b)', () => {
  test('a numbered gap list counts like a bulleted one', () => {
    const { collectVerificationStats } = require('../pan-wizard-core/bin/lib/verify-retro.cjs');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-retro-'));
    try {
      fs.mkdirSync(path.join(tmp, '01-a'));
      fs.writeFileSync(path.join(tmp, '01-a', '01-verification.md'), '---\nstatus: gaps_found\n---\n\n## Gaps\n\n1. Login does not refresh the token\n2. Export drops the last row\n');
      const s = collectVerificationStats(tmp);
      assert.deepEqual(s.gap_patterns, ['Login does not refresh the token', 'Export drops the last row']);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

describe('preview ETA from git (L6b)', () => {
  test('a completed phase with no dated summary is timed by its plan commits', () => {
    const { buildMilestoneETA } = require('../pan-wizard-core/bin/lib/preview.cjs');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-eta-'));
    const git = (args, date) => execFileSync('git', ['-c', 'user.email=t@e.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}) } });
    try {
      git(['init', '-q']);
      fs.mkdirSync(path.join(dir, '.planning', 'phases', '01-a'), { recursive: true });
      fs.writeFileSync(path.join(dir, '.planning', 'roadmap.md'), '# Roadmap\n\n- [x] **Phase 1: A**\n- [ ] **Phase 2: B**\n\n### Phase 1: A\n### Phase 2: B\n');
      fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-a', '01-01-plan.md'), '---\nphase: 01-a\nplan: 01\n---\n');
      fs.writeFileSync(path.join(dir, '.planning', 'phases', '01-a', '01-01-summary.md'), '---\nphase: 01-a\n---\n# Summary\n');
      fs.writeFileSync(path.join(dir, 'a.js'), '1');
      git(['add', '-A']); git(['commit', '-q', '-m', 'feat(01-01): start'], '2026-10-01T10:00:00Z');
      fs.writeFileSync(path.join(dir, 'a.js'), '2');
      git(['add', '-A']); git(['commit', '-q', '-m', 'feat(01-01): finish'], '2026-10-03T10:00:00Z');
      const r = buildMilestoneETA(dir);
      assert.equal(r.eta_source, 'git');
      assert.equal(r.avg_phase_duration_days, 2);
    } finally { cleanup(dir); }
  });
});

describe('audit-deployment is a dev tool (L6b)', () => {
  test('it is no longer a shipped command, and lives with the dev skills', () => {
    assert.ok(!fs.existsSync(path.join(ROOT, 'commands', 'pan', 'audit-deployment.md')));
    assert.ok(fs.existsSync(path.join(ROOT, '.claude', 'commands', 'audit-deployment.md')));
  });
});
