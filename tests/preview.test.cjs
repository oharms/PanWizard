/**
 * Tests for preview.cjs — Y-1 foresight data layer (Spec B v2, v3.1).
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  buildPhasePreview,
  buildPhaseDependencyGraph,
  buildMilestoneETA,
  extractFilePaths,
  detectRiskSignals,
  extractPhaseListFromRoadmap,
  computeParallelBatches,
  generateMermaid,
} = require('../pan-wizard-core/bin/lib/preview.cjs');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─── extractFilePaths ───────────────────────────────────────────────────────

describe('preview — extractFilePaths', () => {
  test('extracts backtick-wrapped paths with slashes', () => {
    const paths = extractFilePaths('Modify `src/api.js` and `tests/api.test.cjs`.');
    assert.ok(paths.includes('src/api.js'));
    assert.ok(paths.includes('tests/api.test.cjs'));
  });

  test('extracts bare prose paths under known roots', () => {
    const paths = extractFilePaths('Edit src/foo.js and lib/bar.cjs after checking tests/baz.test.cjs');
    assert.ok(paths.includes('src/foo.js'));
    assert.ok(paths.includes('tests/baz.test.cjs'));
  });

  test('ignores http URLs', () => {
    const paths = extractFilePaths('See `https://example.com/path/file.html` for reference.');
    assert.equal(paths.some(p => p.startsWith('http')), false);
  });

  test('ignores bare words without extensions', () => {
    const paths = extractFilePaths('Fix src/api (without extension).');
    assert.equal(paths.length, 0);
  });

  test('dedupes across formats', () => {
    const paths = extractFilePaths('Both `src/api.js` and bare src/api.js mentions.');
    const apiCount = paths.filter(p => p === 'src/api.js').length;
    assert.equal(apiCount, 1);
  });
});

// ─── detectRiskSignals ──────────────────────────────────────────────────────

describe('preview — detectRiskSignals', () => {
  test('no signals yields low score', () => {
    const r = detectRiskSignals('Simple refactor of getUserById function.');
    assert.equal(r.signals.drop, false);
    assert.equal(r.signals.migrate, false);
    assert.ok(r.risk_score <= 3);
  });

  test('drop keyword hits high score', () => {
    const r = detectRiskSignals('We will DROP TABLE users_old after migration.');
    assert.equal(r.signals.drop, true);
    assert.equal(r.signals.migrate, true);
    assert.ok(r.risk_score >= 5);
  });

  test('all signals maxes score', () => {
    const txt = 'DROP TABLE users; DELETE FROM sessions; migration to rename file; breaking change with auth token.';
    const r = detectRiskSignals(txt);
    assert.ok(r.risk_score >= 9);
  });

  test('score is in [1, 10]', () => {
    const empty = detectRiskSignals('');
    assert.ok(empty.risk_score >= 1 && empty.risk_score <= 10);
    const full = detectRiskSignals('drop delete migrate rename breaking credentials');
    assert.ok(full.risk_score >= 1 && full.risk_score <= 10);
  });
});

// ─── extractPhaseListFromRoadmap + computeParallelBatches ───────────────────

describe('preview — extractPhaseListFromRoadmap', () => {
  test('parses standard roadmap format', () => {
    const roadmap = `# Roadmap

- [x] Phase 1: Setup
- [x] Phase 2: Build API
- [ ] Phase 3: Add tests
- [ ] Phase 4.1: Gap fix
`;
    const phases = extractPhaseListFromRoadmap(roadmap);
    assert.equal(phases.length, 4);
    assert.equal(phases[0].num, '1');
    assert.equal(phases[0].completed, true);
    assert.equal(phases[2].completed, false);
    assert.equal(phases[3].num, '4.1');
  });

  test('handles bold phase names', () => {
    const roadmap = '- [x] **Phase 1: Setup**\n- [ ] **Phase 2: Build**';
    const phases = extractPhaseListFromRoadmap(roadmap);
    assert.equal(phases.length, 2);
    assert.equal(phases[0].name, 'Setup');
  });
});

describe('preview — computeParallelBatches', () => {
  test('phases with no deps all go in batch 1', () => {
    const g = {
      '1': { explicit_deps: [] },
      '2': { explicit_deps: [] },
      '3': { explicit_deps: [] },
    };
    const batches = computeParallelBatches(g);
    assert.equal(batches.length, 1);
    assert.equal(batches[0].length, 3);
  });

  test('linear chain produces one batch per phase', () => {
    const g = {
      '1': { explicit_deps: [] },
      '2': { explicit_deps: ['1'] },
      '3': { explicit_deps: ['2'] },
    };
    const batches = computeParallelBatches(g);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches[0], ['1']);
    assert.deepEqual(batches[1], ['2']);
    assert.deepEqual(batches[2], ['3']);
  });

  test('diamond: 2+3 parallel after 1, 4 depends on both', () => {
    const g = {
      '1': { explicit_deps: [] },
      '2': { explicit_deps: ['1'] },
      '3': { explicit_deps: ['1'] },
      '4': { explicit_deps: ['2', '3'] },
    };
    const batches = computeParallelBatches(g);
    assert.equal(batches.length, 3);
    assert.deepEqual(batches[1].sort(), ['2', '3']);
    assert.deepEqual(batches[2], ['4']);
  });

  test('cycle falls back to single dump batch', () => {
    const g = {
      '1': { explicit_deps: ['2'] },
      '2': { explicit_deps: ['1'] },
    };
    const batches = computeParallelBatches(g);
    // Either handles cycle safely or dumps remaining — either way, no infinite loop.
    assert.ok(batches.length >= 1);
  });
});

describe('preview — generateMermaid', () => {
  test('produces mermaid source with graph TD header', () => {
    const g = {
      '1': { name: 'Setup', status: 'completed', explicit_deps: [], hidden_deps: [] },
      '2': { name: 'Build', status: 'planned', explicit_deps: ['1'], hidden_deps: [] },
    };
    const out = generateMermaid(g);
    assert.ok(out.startsWith('graph TD'));
    assert.match(out, /P1 --> P2/);
    assert.match(out, /classDef done/);
  });

  test('uses dotted arrow for hidden deps', () => {
    const g = {
      '1': { name: 'A', status: 'planned', explicit_deps: [], hidden_deps: [] },
      '2': { name: 'B', status: 'planned', explicit_deps: [], hidden_deps: ['1'] },
    };
    const out = generateMermaid(g);
    assert.match(out, /P1 -\.-> P2/);
  });
});

// ─── buildPhasePreview ──────────────────────────────────────────────────────

describe('preview — buildPhasePreview', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  function scaffoldPhase(num, slug, planContent) {
    const dir = path.join(tmpDir, '.planning', 'phases', `${num}-${slug}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-plan.md'), planContent);
    return dir;
  }

  test('returns error for unknown phase', () => {
    const r = buildPhasePreview(tmpDir, '99');
    assert.ok(r.error);
  });

  test('extracts files, test files, risk signals from plan', () => {
    scaffoldPhase('03', 'api-refactor', `---
phase: 03
goal: Refactor API layer
---

## Tasks

1. Modify \`src/api.js\` and \`src/handlers.js\`.
2. Update tests/api.test.cjs coverage.
3. DROP TABLE old_sessions after migration.
`);
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 3: API Refactor\n');
    const r = buildPhasePreview(tmpDir, '03');
    assert.equal(r.phase, '03');
    assert.ok(r.files_mentioned.includes('src/api.js'));
    assert.ok(r.files_mentioned.includes('src/handlers.js'));
    assert.ok(r.test_files_mentioned.includes('tests/api.test.cjs'));
    assert.equal(r.risk_signals.drop, true);
    assert.equal(r.risk_signals.migrate, true);
    assert.ok(r.risk_score >= 5);
  });

  test('low-risk phase returns low risk_score', () => {
    scaffoldPhase('01', 'docs', '---\nphase: 01\n---\n\nUpdate `docs/README.md` typos.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 1: Docs update\n');
    const r = buildPhasePreview(tmpDir, '01');
    assert.ok(r.risk_score <= 3);
    assert.equal(r.risk_signals.drop, false);
  });

  test('status is planned when no summary file', () => {
    scaffoldPhase('02', 'build', 'plan content');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 2: Build\n');
    const r = buildPhasePreview(tmpDir, '02');
    assert.equal(r.status, 'planned');
  });

  test('plan_count matches number of plan files', () => {
    const dir = scaffoldPhase('04', 'multi', 'first plan');
    fs.writeFileSync(path.join(dir, '02-plan.md'), 'second plan');
    fs.writeFileSync(path.join(dir, '03-plan.md'), 'third plan');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 4: Multi\n');
    const r = buildPhasePreview(tmpDir, '04');
    assert.equal(r.plan_count, 3);
  });
});

// ─── buildPhaseDependencyGraph ──────────────────────────────────────────────

describe('preview — buildPhaseDependencyGraph', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  function scaffold(roadmap, phases) {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), roadmap);
    for (const { num, slug, plan } of phases) {
      const dir = path.join(tmpDir, '.planning', 'phases', `${num}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '01-plan.md'), plan);
    }
  }

  test('returns error when roadmap missing', () => {
    const r = buildPhaseDependencyGraph(tmpDir);
    assert.ok(r.error);
  });

  test('detects explicit depends_on from frontmatter', () => {
    scaffold(
      '- [ ] Phase 1: A\n- [ ] Phase 2: B\n- [ ] Phase 3: C\n',
      [
        { num: '01', slug: 'a', plan: '---\ndepends_on: []\n---\ntext' },
        { num: '02', slug: 'b', plan: '---\ndepends_on: [phase:1]\n---\ntext' },
        { num: '03', slug: 'c', plan: '---\ndepends_on: [phase:1, phase:2]\n---\ntext' },
      ]
    );
    const r = buildPhaseDependencyGraph(tmpDir);
    assert.equal(r.phase_count, 3);
    const p3 = r.phases.find(p => p.num === '3');
    assert.ok(p3.explicit_deps.includes('1'));
    assert.ok(p3.explicit_deps.includes('2'));
  });

  test('detects hidden deps via "phase N" mentions', () => {
    scaffold(
      '- [ ] Phase 1: A\n- [ ] Phase 2: B\n',
      [
        { num: '01', slug: 'a', plan: 'text only' },
        { num: '02', slug: 'b', plan: 'Builds on phase 1 without explicit dep.' },
      ]
    );
    const r = buildPhaseDependencyGraph(tmpDir);
    const p2 = r.phases.find(p => p.num === '2');
    assert.ok(p2.hidden_deps.includes('1'));
  });

  test('mermaid source is generated', () => {
    scaffold(
      '- [ ] Phase 1: A\n- [ ] Phase 2: B\n',
      [
        { num: '01', slug: 'a', plan: 'text' },
        { num: '02', slug: 'b', plan: '---\ndepends_on: [phase:1]\n---\ntext' },
      ]
    );
    const r = buildPhaseDependencyGraph(tmpDir);
    assert.ok(r.mermaid.startsWith('graph TD'));
    assert.match(r.mermaid, /P1 --> P2/);
  });
});

// ─── buildMilestoneETA ──────────────────────────────────────────────────────

describe('preview — buildMilestoneETA', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('returns error when roadmap missing', () => {
    const r = buildMilestoneETA(tmpDir);
    assert.ok(r.error);
  });

  test('uses default duration when no history', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 1: A\n- [ ] Phase 2: B\n');
    const r = buildMilestoneETA(tmpDir);
    assert.equal(r.phases_total, 2);
    assert.equal(r.phases_remaining, 2);
    assert.equal(r.sample_size, 0);
    assert.equal(r.avg_phase_duration_days, 5);
    assert.ok(r.eta_date);
    assert.ok(r.confidence_pct <= 50);
  });

  test('computes avg from phase summary frontmatter', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [x] Phase 1: A\n- [x] Phase 2: B\n- [ ] Phase 3: C\n');
    for (const { num, slug, started, completed } of [
      { num: '01', slug: 'a', started: '2026-04-01T00:00:00Z', completed: '2026-04-04T00:00:00Z' }, // 3 days
      { num: '02', slug: 'b', started: '2026-04-05T00:00:00Z', completed: '2026-04-12T00:00:00Z' }, // 7 days
    ]) {
      const dir = path.join(tmpDir, '.planning', 'phases', `${num}-${slug}`);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, '01-summary.md'),
        `---\nstarted: ${started}\ncompleted: ${completed}\n---\nbody`);
    }
    const r = buildMilestoneETA(tmpDir);
    assert.equal(r.sample_size, 2);
    assert.equal(r.avg_phase_duration_days, 5); // (3+7)/2
  });

  test('bottleneck identifies phase with most plan files', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 1: Small\n- [ ] Phase 2: Big\n');
    const small = path.join(tmpDir, '.planning', 'phases', '01-small');
    const big = path.join(tmpDir, '.planning', 'phases', '02-big');
    fs.mkdirSync(small, { recursive: true });
    fs.mkdirSync(big, { recursive: true });
    fs.writeFileSync(path.join(small, '01-plan.md'), 'x');
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(path.join(big, `0${i}-plan.md`), 'x');
    }
    const r = buildMilestoneETA(tmpDir);
    assert.ok(r.bottleneck);
    assert.equal(r.bottleneck.phase, '2');
    assert.equal(r.bottleneck.plan_count, 4);
  });

  test('reads current_milestone from state.md', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), '- [ ] Phase 1: A\n');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'state.md'),
      '# State\n\n**Current Milestone:** v3.0\n');
    const r = buildMilestoneETA(tmpDir);
    assert.equal(r.current_milestone, 'v3.0');
  });
});

// ─── CLI dispatch ───────────────────────────────────────────────────────────

describe('preview — CLI dispatch', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempProject(); });
  afterEach(() => { cleanup(tmpDir); });

  test('preview phase N via CLI returns JSON', () => {
    const dir = path.join(tmpDir, '.planning', 'phases', '05-test');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '01-plan.md'), 'Modify `src/thing.js`.');
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 5: Test\n');
    const r = runPanTools('preview phase 05', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.phase, '05');
    assert.ok(json.files_mentioned.includes('src/thing.js'));
  });

  test('preview phases via CLI returns graph', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [ ] Phase 1: A\n- [ ] Phase 2: B\n');
    const r = runPanTools('preview phases', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.phase_count, 2);
    assert.ok(json.mermaid);
    assert.ok(Array.isArray(json.parallel_batches));
  });

  test('preview milestone via CLI returns ETA', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '- [x] Phase 1: A\n- [ ] Phase 2: B\n');
    const r = runPanTools('preview milestone', tmpDir);
    assert.ok(r.success, r.error);
    const json = JSON.parse(r.output);
    assert.equal(json.phases_total, 2);
    assert.equal(json.phases_remaining, 1);
    assert.ok(json.eta_date);
  });

  test('unknown subcommand returns error', () => {
    const r = runPanTools('preview unknown-mode', tmpDir);
    assert.equal(r.success, false);
  });
});
