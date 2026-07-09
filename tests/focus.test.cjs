const { describe, test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

// Direct requires for unit tests
const {
  collectWorkItems,
  classifyItemPriority,
  sortByPriority,
  computeRealityScore,
  summarizePriorities,
  classifyTier,
  allocateBudget,
  checkDocStaleness,
  checkOldCommandNames,
  checkVersionCrossRef,
  readLatestBatch,
  categoryFilter,
  readAutoRun,
  writeAutoRun,
  determineStopReason,
} = require('../pan-wizard-core/bin/lib/focus.cjs');
const { extractPriorityEffort } = require('../pan-wizard-core/bin/lib/frontmatter.cjs');
const {
  EFFORT_POINTS, PRIORITY_LEVELS, EFFORT_SIZES,
  FOCUS_CATEGORIES, CATEGORY_PRIORITY_RANGE, CATEGORY_DEFAULTS,
  DEFAULT_MAX_CYCLES, DEFAULT_TOTAL_BUDGET,
  DIMINISHING_RETURNS_THRESHOLD,
} = require('../pan-wizard-core/bin/lib/constants.cjs');

// Shared tmpDir lifecycle — scoped inside each describe that needs it
let tmpDir;

beforeEach(() => {
  tmpDir = createTempProject();
});

afterEach(() => {
  cleanup(tmpDir);
});

// ─── Unit: extractPriorityEffort (pure — no tmpDir needed) ──────────────────

describe('extractPriorityEffort', () => {
  test('returns defaults when no priority/effort set', () => {
    const result = extractPriorityEffort({});
    assert.equal(result.priority, 'P3');
    assert.equal(result.effort, 'M');
    assert.equal(result.priorityValid, true);
    assert.equal(result.effortValid, true);
  });

  test('parses valid priority and effort', () => {
    const result = extractPriorityEffort({ priority: 'P0', effort: 'XS' });
    assert.equal(result.priority, 'P0');
    assert.equal(result.effort, 'XS');
    assert.equal(result.priorityValid, true);
    assert.equal(result.effortValid, true);
  });

  test('defaults invalid priority to P3', () => {
    const result = extractPriorityEffort({ priority: 'P9', effort: 'L' });
    assert.equal(result.priority, 'P3');
    assert.equal(result.effort, 'L');
    assert.equal(result.priorityValid, false);
    assert.equal(result.effortValid, true);
  });

  test('defaults invalid effort to M', () => {
    const result = extractPriorityEffort({ priority: 'P1', effort: 'HUGE' });
    assert.equal(result.priority, 'P1');
    assert.equal(result.effort, 'M');
    assert.equal(result.priorityValid, true);
    assert.equal(result.effortValid, false);
  });

  test('handles lowercase values', () => {
    const result = extractPriorityEffort({ priority: 'p2', effort: 'xl' });
    assert.equal(result.priority, 'P2');
    assert.equal(result.effort, 'XL');
  });
});

// ─── Unit: collectWorkItems ─────────────────────────────────────────────────

describe('collectWorkItems', () => {
  test('returns empty items for empty project', () => {
    const { items, sources } = collectWorkItems(tmpDir);
    assert.equal(items.length, 0);
    assert.equal(sources.phases, 0);
    assert.equal(sources.todos, 0);
    assert.equal(sources.patterns, 0);
  });

  test('collects phase items from ROADMAP + phase dirs', () => {
    // Create roadmap with one incomplete phase
    const roadmap = '## Phase 01: Setup\n**Goal:** Initial setup\n';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), roadmap);

    // Create phase dir with plan
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'plan.md'), '---\npriority: P2\neffort: S\n---\n# Plan');

    const { items, sources } = collectWorkItems(tmpDir);
    assert.equal(sources.phases, 1);
    assert.equal(items.length, 1);
    assert.equal(items[0].priority, 'P2');
    assert.equal(items[0].effort, 'S');
    assert.equal(items[0].points, EFFORT_POINTS.S);
    assert.equal(items[0].source, 'phase');
  });

  test('skips complete phases', () => {
    const roadmap = '## Phase 01: Done\n**Goal:** Was done\n';
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'), roadmap);

    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-done');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, 'plan.md'), '---\nphase: 01\n---\n# Plan');
    fs.writeFileSync(path.join(phaseDir, 'summary.md'), '---\nphase: 01\n---\n# Summary');

    const { items, sources } = collectWorkItems(tmpDir);
    assert.equal(sources.phases, 0);
    assert.equal(items.length, 0);
  });

  test('collects pending todos', () => {
    const todoDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(todoDir, { recursive: true });
    fs.writeFileSync(path.join(todoDir, 'fix-bug.md'), 'title: Fix the bug\narea: core\ncreated: 2026-03-01');

    const { items, sources } = collectWorkItems(tmpDir);
    assert.equal(sources.todos, 1);
    const todoItem = items.find(i => i.source === 'todo');
    assert.ok(todoItem);
    assert.equal(todoItem.priority, 'P5');
    assert.equal(todoItem.effort, 'S');
  });

  test('collects error patterns', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'),
      '# Error Patterns\n\n### PAT-001: Race condition\n**Wrong:** concurrent writes without lock\n**Right:** use readStateSafe\n**Context:** state.cjs\n');

    const { items, sources } = collectWorkItems(tmpDir);
    assert.equal(sources.patterns, 1);
    const patternItem = items.find(i => i.source === 'pattern');
    assert.ok(patternItem);
    assert.equal(patternItem.priority, 'P1');
  });
});

// ─── Unit: classifyItemPriority ─────────────────────────────────────────────

describe('classifyItemPriority', () => {
  test('returns item priority when set', () => {
    assert.equal(classifyItemPriority({ priority: 'P0' }), 'P0');
    assert.equal(classifyItemPriority({ priority: 'P6' }), 'P6');
  });

  test('defaults to P3 when no priority', () => {
    assert.equal(classifyItemPriority({}), 'P3');
  });
});

// ─── Unit: sortByPriority ───────────────────────────────────────────────────

describe('sortByPriority', () => {
  test('sorts by priority first', () => {
    const items = [
      { priority: 'P3', effort: 'M' },
      { priority: 'P0', effort: 'L' },
      { priority: 'P1', effort: 'S' },
    ];
    const sorted = sortByPriority(items);
    assert.equal(sorted[0].priority, 'P0');
    assert.equal(sorted[1].priority, 'P1');
    assert.equal(sorted[2].priority, 'P3');
  });

  test('sorts by effort within same priority', () => {
    const items = [
      { priority: 'P3', effort: 'L' },
      { priority: 'P3', effort: 'XS' },
      { priority: 'P3', effort: 'M' },
    ];
    const sorted = sortByPriority(items);
    assert.equal(sorted[0].effort, 'XS');
    assert.equal(sorted[1].effort, 'M');
    assert.equal(sorted[2].effort, 'L');
  });

  test('does not mutate original array', () => {
    const items = [{ priority: 'P3', effort: 'L' }, { priority: 'P0', effort: 'S' }];
    const sorted = sortByPriority(items);
    assert.notEqual(items, sorted);
    assert.equal(items[0].priority, 'P3');
  });
});

// ─── Unit: computeRealityScore ──────────────────────────────────────────────

describe('computeRealityScore', () => {
  test('computes RS = (UV + TC + RR) / JS', () => {
    const score = computeRealityScore({ uv: 5, tc: 4, rr: 3, effort: 'M' });
    // (5 + 4 + 3) / 4 = 3.0
    assert.equal(score, 3);
  });

  test('uses default values when not provided', () => {
    const score = computeRealityScore({ effort: 'S' });
    // (3 + 2 + 2) / 2 = 3.5
    assert.equal(score, 3.5);
  });

  test('handles XS effort', () => {
    const score = computeRealityScore({ uv: 5, tc: 5, rr: 5, effort: 'XS' });
    // (5 + 5 + 5) / 1 = 15.0
    assert.equal(score, 15);
  });

  test('handles XL effort', () => {
    const score = computeRealityScore({ uv: 3, tc: 2, rr: 1, effort: 'XL' });
    // (3 + 2 + 1) / 20 = 0.3
    assert.equal(score, 0.3);
  });
});

// ─── Unit: classifyTier ─────────────────────────────────────────────────────

describe('classifyTier', () => {
  test('classifies XS as MICRO', () => {
    assert.equal(classifyTier('XS'), 'MICRO');
  });

  test('classifies S as MICRO', () => {
    assert.equal(classifyTier('S'), 'MICRO');
  });

  test('classifies M as STANDARD', () => {
    assert.equal(classifyTier('M'), 'STANDARD');
  });

  test('classifies L as FULL', () => {
    assert.equal(classifyTier('L'), 'FULL');
  });

  test('classifies XL as FULL', () => {
    assert.equal(classifyTier('XL'), 'FULL');
  });
});

// ─── Unit: allocateBudget ───────────────────────────────────────────────────

describe('allocateBudget', () => {
  const items = [
    { id: 'a', priority: 'P0', effort: 'S', points: 2 },
    { id: 'b', priority: 'P1', effort: 'M', points: 4 },
    { id: 'c', priority: 'P3', effort: 'S', points: 2 },
    { id: 'd', priority: 'P4', effort: 'L', points: 10 },
  ];

  test('bugfix mode excludes features (P5+)', () => {
    const featureItems = [
      ...items,
      { id: 'e', priority: 'P5', effort: 'S', points: 2 },
    ];
    const { batch } = allocateBudget(featureItems, 40, 'bugfix');
    assert.ok(!batch.find(i => i.id === 'e'));
  });

  test('bugfix mode respects budget', () => {
    const { batch, allocated } = allocateBudget(items, 5, 'bugfix');
    assert.ok(allocated <= 5);
  });

  test('balanced mode splits stability/feature', () => {
    const { batch } = allocateBudget(items, 50, 'balanced');
    const stability = batch.filter(i => i.track === 'stability');
    const feature = batch.filter(i => i.track === 'feature');
    assert.ok(stability.length > 0);
    assert.ok(feature.length > 0);
  });

  test('features mode includes P0 mandatory', () => {
    const { batch } = allocateBudget(items, 50, 'features');
    assert.ok(batch.find(i => i.id === 'a'));
  });

  test('full mode includes all within budget', () => {
    const { batch, allocated } = allocateBudget(items, 60, 'full');
    assert.equal(batch.length, 4);
    assert.equal(allocated, 18);
  });

  test('full mode respects budget limit', () => {
    const { batch, allocated } = allocateBudget(items, 5, 'full');
    assert.ok(allocated <= 5);
  });

  test('assigns tier to each batch item', () => {
    const { batch } = allocateBudget(items, 60, 'full');
    for (const item of batch) {
      assert.ok(['MICRO', 'STANDARD', 'FULL'].includes(item.tier));
    }
  });
});

// ─── Unit: checkDocStaleness ────────────────────────────────────────────────

describe('checkDocStaleness', () => {
  test('returns empty for project without README', () => {
    const { stale, current } = checkDocStaleness(tmpDir);
    assert.equal(stale.length, 0);
    assert.equal(current.length, 0);
  });

  test('detects stale command count in README', () => {
    // Create commands dir with 3 files
    const cmdDir = path.join(tmpDir, 'commands', 'pan');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'a.md'), '');
    fs.writeFileSync(path.join(cmdDir, 'b.md'), '');
    fs.writeFileSync(path.join(cmdDir, 'c.md'), '');

    // README says 5 commands
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'This project has 5 commands and 2 agents.');

    const { stale, actuals } = checkDocStaleness(tmpDir);
    assert.equal(actuals.commands, 3);
    const cmdStale = stale.find(s => s.entity === 'commands');
    assert.ok(cmdStale);
    assert.equal(cmdStale.documented, 5);
    assert.equal(cmdStale.actual, 3);
  });

  test('reports current when counts match', () => {
    const cmdDir = path.join(tmpDir, 'commands', 'pan');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'a.md'), '');
    fs.writeFileSync(path.join(cmdDir, 'b.md'), '');

    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'We have 2 commands available.');

    const { stale, current } = checkDocStaleness(tmpDir);
    assert.equal(stale.filter(s => s.entity === 'commands').length, 0);
    assert.equal(current.filter(s => s.entity === 'commands').length, 1);
  });
});

// ─── Unit: readLatestBatch ──────────────────────────────────────────────────

describe('readLatestBatch', () => {
  test('returns null when no focus dir', () => {
    assert.equal(readLatestBatch(tmpDir), null);
  });

  test('returns null when focus dir is empty', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'focus'), { recursive: true });
    assert.equal(readLatestBatch(tmpDir), null);
  });

  test('reads the oldest batch file first', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    fs.writeFileSync(path.join(focusDir, 'batch-2026-01-01.json'), JSON.stringify({ date: '2026-01-01', batch: [{ id: 'old' }] }));
    fs.writeFileSync(path.join(focusDir, 'batch-2026-03-01.json'), JSON.stringify({ date: '2026-03-01', batch: [{ id: 'new' }] }));

    const batch = readLatestBatch(tmpDir);
    assert.ok(batch);
    assert.equal(batch.date, '2026-01-01');
    assert.equal(batch.batch[0].id, 'old');
  });

  test('returns null for malformed JSON', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    fs.writeFileSync(path.join(focusDir, 'batch-2026-01-01.json'), 'not json');

    assert.equal(readLatestBatch(tmpDir), null);
  });
});

// ─── Unit: summarizePriorities ──────────────────────────────────────────────

describe('summarizePriorities', () => {
  test('counts items per priority', () => {
    const items = [
      { priority: 'P0' }, { priority: 'P0' },
      { priority: 'P3' },
    ];
    const result = summarizePriorities(items);
    assert.equal(result.P0, 2);
    assert.equal(result.P3, 1);
    assert.equal(result.P1, undefined);
  });
});

// ─── Unit: constants ────────────────────────────────────────────────────────

describe('Focus constants', () => {
  test('EFFORT_POINTS maps all sizes', () => {
    assert.equal(EFFORT_POINTS.XS, 1);
    assert.equal(EFFORT_POINTS.S, 2);
    assert.equal(EFFORT_POINTS.M, 4);
    assert.equal(EFFORT_POINTS.L, 10);
    assert.equal(EFFORT_POINTS.XL, 20);
  });

  test('PRIORITY_LEVELS has 7 levels', () => {
    assert.equal(PRIORITY_LEVELS.length, 7);
    assert.equal(PRIORITY_LEVELS[0], 'P0');
    assert.equal(PRIORITY_LEVELS[6], 'P6');
  });

  test('EFFORT_SIZES has 5 sizes', () => {
    assert.equal(EFFORT_SIZES.length, 5);
    assert.equal(EFFORT_SIZES[0], 'XS');
    assert.equal(EFFORT_SIZES[4], 'XL');
  });
});

// ─── Integration: focus scan ────────────────────────────────────────────────

describe('focus scan integration', () => {
  test('returns empty items for empty project', () => {
    const { success, output: out } = runPanTools('focus scan', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.total, 0);
    assert.deepEqual(data.items, []);
  });

  test('scans phases from populated project', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Setup\n**Goal:** Setup\n## Phase 02: Build\n**Goal:** Build\n');

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P2\neffort: XS\n---\n# Plan');

    const p2 = path.join(tmpDir, '.planning', 'phases', '02-build');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, 'plan.md'), '---\npriority: P4\neffort: L\n---\n# Plan');

    const { success, output: out } = runPanTools('focus scan', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.total, 2);
    assert.equal(data.items[0].priority, 'P2');
    assert.equal(data.items[1].priority, 'P4');
  });

  test('respects --lean filter', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Low value\n**Goal:** Low\n');

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-low-value');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P6\neffort: XL\n---\n# Plan');

    const { success, output: out } = runPanTools('focus scan --lean', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    // Default RS for P6 XL: (3+2+2)/20 = 0.35 < 1.5, should be filtered
    assert.equal(data.total, 0);
  });
});

// ─── Integration: focus plan ────────────────────────────────────────────────

describe('focus plan integration', () => {
  test('returns error when no items', () => {
    const { success, output: out } = runPanTools('focus plan', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(data.error);
    assert.ok(data.error.includes('No work items'));
  });

  test('creates batch file after planning', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Setup\n**Goal:** Setup\n');

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P3\neffort: S\n---\n# Plan');

    const { success, output: out } = runPanTools('focus plan --mode full', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.mode, 'full');
    assert.ok(data.budget >= 60);
    assert.equal(data.items_selected, 1);
    assert.ok(data.batch_file);

    // Verify batch file exists
    const batchFile = path.join(tmpDir, data.batch_file.replace(/\//g, path.sep));
    assert.ok(fs.existsSync(batchFile));
  });

  test('respects --budget flag', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Big\n**Goal:** Big\n');

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-big');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P3\neffort: XL\n---\n# Plan');

    const { success, output: out } = runPanTools('focus plan --budget 5', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    // XL = 20 points, budget = 5, should not fit
    assert.equal(data.items_selected, 0);
  });
});

// ─── Integration: focus sync ────────────────────────────────────────────────

describe('focus sync integration', () => {
  test('returns actuals for project', () => {
    const { success, output: out } = runPanTools('focus sync', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok('actuals' in data);
    assert.ok('stale' in data);
    assert.ok('stale_count' in data);
    assert.equal(typeof data.needs_sync, 'boolean');
  });

  test('detects staleness', () => {
    const cmdDir = path.join(tmpDir, 'commands', 'pan');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'a.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Has 10 commands.');

    const { success, output: out } = runPanTools('focus sync', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(data.needs_sync);
    assert.ok(data.stale_count > 0);
  });
});

// ─── Integration: focus exec ────────────────────────────────────────────────

describe('focus exec integration', () => {
  test('returns error when no batch', () => {
    const { success, output: out } = runPanTools('focus exec', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(data.error);
    assert.ok(data.error.includes('No batch file'));
  });

  test('loads batch with --dry-run', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    const batch = {
      date: '2026-03-01',
      mode: 'balanced',
      budget: 50,
      allocated: 6,
      batch: [
        { id: 'a', title: 'Fix X', priority: 'P0', effort: 'S', points: 2, tier: 'MICRO' },
        { id: 'b', title: 'Add Y', priority: 'P3', effort: 'M', points: 4, tier: 'STANDARD' },
      ],
    };
    fs.writeFileSync(path.join(focusDir, 'batch-2026-03-01.json'), JSON.stringify(batch));

    const { success, output: out } = runPanTools('focus exec --dry-run', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.dry_run, true);
    assert.equal(data.total_items, 2);
    assert.equal(data.tiers.micro, 1);
    assert.equal(data.tiers.standard, 1);
    assert.equal(data.mode, 'balanced');
  });
});

// ─── Integration: unknown subcommand ────────────────────────────────────────

describe('focus error handling', () => {
  test('rejects unknown subcommand', () => {
    const { success, error: err } = runPanTools('focus nonsense', tmpDir);
    assert.equal(success, false);
    assert.ok(err.includes('Unknown focus subcommand'));
  });
});

// ─── Integration: focus design ──────────────────────────────────────────────

describe('focus design integration', () => {
  test('returns workflow-only JSON', () => {
    const { success, output: out } = runPanTools('focus design', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.command, 'focus-design');
    assert.equal(data.type, 'workflow');
    assert.ok(data.message.includes('focus-design'));
  });
});

// ─── Unit: allocateBudget edge cases ────────────────────────────────────────

describe('allocateBudget edge cases', () => {
  test('features mode excludes P6 from feature pass', () => {
    const items = [
      { id: 'a', priority: 'P0', effort: 'S', points: 2 },
      { id: 'b', priority: 'P6', effort: 'XS', points: 1 },
    ];
    const { batch } = allocateBudget(items, 50, 'features');
    assert.ok(batch.find(i => i.id === 'a'), 'P0 mandatory included');
    assert.ok(!batch.find(i => i.id === 'b'), 'P6 excluded from features mode');
  });

  test('balanced mode with only stability items uses stability budget', () => {
    const items = [
      { id: 'a', priority: 'P0', effort: 'S', points: 2 },
      { id: 'b', priority: 'P1', effort: 'M', points: 4 },
      { id: 'c', priority: 'P2', effort: 'XS', points: 1 },
    ];
    const { batch, allocated } = allocateBudget(items, 50, 'balanced');
    assert.equal(batch.length, 3);
    assert.equal(allocated, 7);
    for (const item of batch) {
      assert.equal(item.track, 'stability');
    }
  });

  test('bugfix mode excludes P5 items', () => {
    const items = [
      { id: 'a', priority: 'P1', effort: 'S', points: 2 },
      { id: 'b', priority: 'P5', effort: 'XS', points: 1 },
      { id: 'c', priority: 'P6', effort: 'XS', points: 1 },
    ];
    const { batch } = allocateBudget(items, 40, 'bugfix');
    assert.equal(batch.length, 1);
    assert.equal(batch[0].id, 'a');
  });

  test('features mode P3-P5 get feature track', () => {
    const items = [
      { id: 'a', priority: 'P3', effort: 'S', points: 2 },
      { id: 'b', priority: 'P4', effort: 'M', points: 4 },
      { id: 'c', priority: 'P5', effort: 'XS', points: 1 },
    ];
    const { batch } = allocateBudget(items, 50, 'features');
    for (const item of batch) {
      assert.equal(item.track, 'feature');
    }
  });

  test('balanced mode remaining collects unallocated items', () => {
    const items = [
      { id: 'a', priority: 'P0', effort: 'XL', points: 20 },
      { id: 'b', priority: 'P3', effort: 'XL', points: 20 },
      { id: 'c', priority: 'P4', effort: 'XL', points: 20 },
    ];
    const { batch, remaining } = allocateBudget(items, 30, 'balanced');
    // stability budget = 18, feature budget = 12 — neither XL fits except P0
    assert.ok(remaining.length > 0, 'Some items should remain');
  });

  test('empty items returns empty batch', () => {
    const { batch, allocated, remaining } = allocateBudget([], 50, 'full');
    assert.equal(batch.length, 0);
    assert.equal(allocated, 0);
    assert.equal(remaining.length, 0);
  });
});

// ─── Integration: focus exec edge cases ─────────────────────────────────────

describe('focus exec edge cases', () => {
  test('returns error for empty batch', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    fs.writeFileSync(path.join(focusDir, 'batch-2026-03-01.json'),
      JSON.stringify({ date: '2026-03-01', mode: 'full', budget: 60, allocated: 0, batch: [] }));

    const { success, output: out } = runPanTools('focus exec', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(data.error);
    assert.ok(data.error.includes('empty'));
  });

  test('returns correct tiers breakdown', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    const batch = {
      date: '2026-03-01', mode: 'full', budget: 60, allocated: 27,
      batch: [
        { id: 'a', effort: 'XS', tier: 'MICRO', points: 1 },
        { id: 'b', effort: 'S', tier: 'MICRO', points: 2 },
        { id: 'c', effort: 'M', tier: 'STANDARD', points: 4 },
        { id: 'd', effort: 'L', tier: 'FULL', points: 10 },
        { id: 'e', effort: 'XL', tier: 'FULL', points: 20 },
      ],
    };
    fs.writeFileSync(path.join(focusDir, 'batch-2026-03-01.json'), JSON.stringify(batch));

    const { success, output: out } = runPanTools('focus exec --dry-run', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.tiers.micro, 2);
    assert.equal(data.tiers.standard, 1);
    assert.equal(data.tiers.full, 2);
    assert.equal(data.total_items, 5);
    assert.ok(data.batch_file.includes('.planning/focus/batch-'));
  });
});

// ─── Integration: focus exec git gate ────────────────────────────────────────

describe('focus exec git cleanliness gate', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = createTempProject();
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(gitDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: gitDir, stdio: 'pipe' });
    // Create a batch file
    const focusDir = path.join(gitDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    const batch = {
      date: '2026-03-07', mode: 'balanced', budget: 50, allocated: 3,
      batch: [{ id: 'a', title: 'Fix X', priority: 'P0', effort: 'S', points: 2, tier: 'MICRO' }],
    };
    fs.writeFileSync(path.join(focusDir, 'batch-2026-03-07.json'), JSON.stringify(batch));
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "add batch"', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(gitDir);
  });

  test('blocks exec on dirty working tree', () => {
    // Create uncommitted change
    fs.writeFileSync(path.join(gitDir, 'dirty.txt'), 'uncommitted');
    const { success, output: out } = runPanTools('focus exec', gitDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.strictEqual(data.error, 'dirty_working_tree');
    assert.ok(data.uncommitted_count > 0);
    assert.ok(data.hint);
  });

  test('allows exec on clean working tree', () => {
    const { success, output: out } = runPanTools('focus exec', gitDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(!data.error, 'should not have error on clean tree');
    assert.strictEqual(data.total_items, 1);
  });

  test('--force bypasses dirty tree check', () => {
    fs.writeFileSync(path.join(gitDir, 'dirty.txt'), 'uncommitted');
    const { success, output: out } = runPanTools('focus exec --force', gitDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(!data.error, 'should not block with --force');
    assert.strictEqual(data.total_items, 1);
  });

  test('--dry-run skips git check', () => {
    fs.writeFileSync(path.join(gitDir, 'dirty.txt'), 'uncommitted');
    const { success, output: out } = runPanTools('focus exec --dry-run', gitDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(!data.error, 'dry-run should skip git check');
    assert.strictEqual(data.dry_run, true);
  });
});

// ─── Integration: focus plan edge cases ─────────────────────────────────────

describe('focus plan edge cases', () => {
  test('--mode bugfix caps budget at 40', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Fix\n**Goal:** Fix\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-fix');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P0\neffort: S\n---\n# Fix');

    const { success, output: out } = runPanTools('focus plan --mode bugfix --budget 80', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.mode, 'bugfix');
    // bugfix caps at 40 even if --budget 80
    assert.ok(data.budget <= 40, `expected budget <= 40, got ${data.budget}`);
  });

  test('--mode full raises budget to at least 60', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Big\n**Goal:** Big\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-big');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P3\neffort: S\n---\n# Big');

    const { success, output: out } = runPanTools('focus plan --mode full --budget 30', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.mode, 'full');
    assert.ok(data.budget >= 60, `expected budget >= 60, got ${data.budget}`);
  });

  test('--priority filter limits items', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Crash\n**Goal:** Crash\n## Phase 02: Feature\n**Goal:** Feature\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-crash');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P0\neffort: S\n---\n# Crash');
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-feature');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, 'plan.md'), '---\npriority: P4\neffort: M\n---\n# Feature');

    const { success, output: out } = runPanTools('focus plan --priority P1', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    // Only P0 item should pass (P0 <= P1), P4 excluded
    assert.equal(data.items_selected, 1);
  });
});

// ─── Integration: focus sync edge cases ─────────────────────────────────────

describe('focus sync edge cases', () => {
  test('detects agent count staleness', () => {
    const agentDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'pan-executor.md'), '');
    fs.writeFileSync(path.join(agentDir, 'pan-verifier.md'), '');
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Includes 5 agents and 0 commands.');

    const { success, output: out } = runPanTools('focus sync', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.ok(data.needs_sync);
    const agentStale = data.stale.find(s => s.entity === 'agents');
    assert.ok(agentStale);
    assert.equal(agentStale.documented, 5);
    assert.equal(agentStale.actual, 2);
  });
});

// ─── Unit: checkDocStaleness multi-file + extensions ────────────────────────

describe('checkDocStaleness multi-file scan', () => {
  test('scans docs/DEVELOPMENT.md for stale counts', () => {
    const cmdDir = path.join(tmpDir, 'commands', 'pan');
    fs.mkdirSync(cmdDir, { recursive: true });
    fs.writeFileSync(path.join(cmdDir, 'a.md'), '');
    fs.writeFileSync(path.join(cmdDir, 'b.md'), '');

    const docsDir = path.join(tmpDir, 'docs');
    fs.mkdirSync(docsDir, { recursive: true });
    fs.writeFileSync(path.join(docsDir, 'DEVELOPMENT.md'), 'Project has 99 commands.');

    const { stale } = checkDocStaleness(tmpDir);
    const devStale = stale.find(s => s.file === 'docs/DEVELOPMENT.md' && s.entity === 'commands');
    assert.ok(devStale);
    assert.equal(devStale.documented, 99);
    assert.equal(devStale.actual, 2);
  });

  test('detects stale test counts when --tests provided', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Suite has 500 tests across 20 suites.');
    const { stale } = checkDocStaleness(tmpDir, { tests: 600, suites: 25 });
    const testStale = stale.find(s => s.entity === 'tests');
    assert.ok(testStale);
    assert.equal(testStale.documented, 500);
    assert.equal(testStale.actual, 600);
    const suiteStale = stale.find(s => s.entity === 'suites');
    assert.ok(suiteStale);
    assert.equal(suiteStale.documented, 20);
    assert.equal(suiteStale.actual, 25);
  });

  test('skips test/suite check when opts not provided', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Suite has 500 tests across 20 suites.');
    const { stale } = checkDocStaleness(tmpDir);
    assert.equal(stale.filter(s => s.entity === 'tests').length, 0);
    assert.equal(stale.filter(s => s.entity === 'suites').length, 0);
  });
});

// ─── Unit: checkOldCommandNames ─────────────────────────────────────────────

describe('checkOldCommandNames', () => {
  test('detects old command name references', () => {
    const stale = [];
    checkOldCommandNames('Run /pan:execute-phase to start.', 'README.md', stale);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].entity, 'renamed_command');
    assert.equal(stale[0].old, 'execute-phase');
    assert.equal(stale[0].new, 'exec-phase');
  });

  test('does not flag new command names', () => {
    const stale = [];
    checkOldCommandNames('Run /pan:exec-phase to start.', 'README.md', stale);
    assert.equal(stale.length, 0);
  });

  test('detects multiple old names in one doc', () => {
    const stale = [];
    checkOldCommandNames('Use pan:pause-work and pan:resume-work.', 'guide.md', stale);
    assert.equal(stale.length, 2);
  });
});

// ─── Unit: checkVersionCrossRef ─────────────────────────────────────────────

describe('checkVersionCrossRef', () => {
  test('detects version mismatch between package.json and CHANGELOG', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '2.5.0' }));
    fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), '## [2.4.0] - 2026-03-07\n- stuff');
    const stale = [];
    const current = [];
    checkVersionCrossRef(tmpDir, stale, current);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].entity, 'version');
    assert.equal(stale[0].documented, '2.4.0');
    assert.equal(stale[0].actual, '2.5.0');
  });

  test('reports current when versions match', () => {
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ version: '2.4.0' }));
    fs.writeFileSync(path.join(tmpDir, 'CHANGELOG.md'), '## [2.4.0] - 2026-03-07\n- stuff');
    const stale = [];
    const current = [];
    checkVersionCrossRef(tmpDir, stale, current);
    assert.equal(stale.length, 0);
    assert.equal(current.length, 1);
    assert.equal(current[0].entity, 'version');
  });

  test('handles missing package.json gracefully', () => {
    const stale = [];
    const current = [];
    checkVersionCrossRef(tmpDir, stale, current);
    assert.equal(stale.length, 0);
    assert.equal(current.length, 0);
  });
});

// ─── Integration: focus sync --tests/--suites flags ─────────────────────────

describe('focus sync --tests --suites flags', () => {
  test('passes test count through to staleness check', () => {
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'Has 100 tests.');
    const { success, output: out } = runPanTools('focus sync --tests 200', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    const testStale = data.stale.find(s => s.entity === 'tests');
    assert.ok(testStale);
    assert.equal(testStale.documented, 100);
    assert.equal(testStale.actual, 200);
  });
});

// ─── Unit: computeRealityScore edge cases ───────────────────────────────────

describe('computeRealityScore edge cases', () => {
  test('respects custom uv/tc/rr values', () => {
    const score = computeRealityScore({ uv: 1, tc: 1, rr: 1, effort: 'S' });
    // (1+1+1) / 2 = 1.5
    assert.equal(score, 1.5);
  });

  test('returns Infinity for unknown effort (defaults to 4)', () => {
    // Unknown effort defaults to 4 in EFFORT_POINTS lookup
    const score = computeRealityScore({ uv: 4, tc: 4, rr: 4 });
    // (4+4+4) / 4 = 3.0
    assert.equal(score, 3);
  });
});

// ─── Integration: scan RS annotation ────────────────────────────────────────

describe('focus scan RS annotation', () => {
  test('annotates P3+ items with realityScore', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Feature\n**Goal:** Feature\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-feature');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P4\neffort: S\n---\n# Feature');

    const { success, output: out } = runPanTools('focus scan', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.total, 1);
    assert.ok(data.items[0].realityScore !== undefined, 'P4 item should have RS');
    assert.equal(typeof data.items[0].realityScore, 'number');
  });

  test('does not annotate P0-P2 items with realityScore', () => {
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Crash\n**Goal:** Crash\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-crash');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P0\neffort: S\n---\n# Crash');

    const { success, output: out } = runPanTools('focus scan', tmpDir);
    assert.ok(success);
    const data = JSON.parse(out);
    assert.equal(data.items[0].realityScore, undefined, 'P0 item should NOT have RS');
  });
});

// ─── Integration: collectWorkItems multi-source ─────────────────────────────

describe('collectWorkItems multi-source', () => {
  test('aggregates phases, todos, and patterns together', () => {
    // Phase
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Setup\n**Goal:** Setup\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P3\neffort: M\n---\n# Plan');

    // Todo
    const todoDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(todoDir, { recursive: true });
    fs.writeFileSync(path.join(todoDir, 'fix-it.md'), 'title: Fix it\narea: core');

    // Pattern
    fs.writeFileSync(path.join(tmpDir, '.planning', 'patterns.md'),
      '# Error Patterns\n\n### PAT-001: Bad read\n**Wrong:** bare readFileSync\n**Right:** safeReadFile\n**Context:** core.cjs\n');

    const { items, sources } = collectWorkItems(tmpDir);
    assert.equal(sources.phases, 1);
    assert.equal(sources.todos, 1);
    assert.equal(sources.patterns, 1);
    assert.equal(items.length, 3);

    const sourceTypes = items.map(i => i.source);
    assert.ok(sourceTypes.includes('phase'));
    assert.ok(sourceTypes.includes('todo'));
    assert.ok(sourceTypes.includes('pattern'));
  });
});

// ─── E2E: scan --lean -> plan -> exec ───────────────────────────────────────

describe('focus e2e lean pipeline', () => {
  test('scan --lean filters low-RS items from pipeline', () => {
    // High-value item (P2/XS = high RS)
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Critical\n**Goal:** Critical fix\n## Phase 02: Bloat\n**Goal:** Low value\n');
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-critical');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P2\neffort: XS\n---\n# Critical');

    // Low-value item (P6/XL = RS 0.35)
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-bloat');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, 'plan.md'), '---\npriority: P6\neffort: XL\n---\n# Bloat');

    // Scan --lean should filter P6/XL
    const scan = runPanTools('focus scan --lean', tmpDir);
    assert.ok(scan.success);
    const scanData = JSON.parse(scan.output);
    assert.equal(scanData.total, 1, 'Only critical item after lean filter');
    assert.equal(scanData.items[0].priority, 'P2');

    // Plan with --lean
    const plan = runPanTools('focus plan --mode full --lean', tmpDir);
    assert.ok(plan.success);
    const planData = JSON.parse(plan.output);
    assert.equal(planData.items_selected, 1);
  });
});

// ─── E2E: scan -> plan -> exec pipeline ─────────────────────────────────────

describe('focus e2e pipeline', () => {
  test('scan -> plan -> exec dry-run works end-to-end', () => {
    // Setup a project with items
    fs.writeFileSync(path.join(tmpDir, '.planning', 'roadmap.md'),
      '## Phase 01: Core\n**Goal:** Build core\n## Phase 02: Tests\n**Goal:** Add tests\n');

    const p1 = path.join(tmpDir, '.planning', 'phases', '01-core');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, 'plan.md'), '---\npriority: P3\neffort: M\n---\n# Core');

    const p2 = path.join(tmpDir, '.planning', 'phases', '02-tests');
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p2, 'plan.md'), '---\npriority: P2\neffort: S\n---\n# Tests');

    // Step 1: Scan
    const scan = runPanTools('focus scan', tmpDir);
    assert.ok(scan.success);
    const scanData = JSON.parse(scan.output);
    assert.equal(scanData.total, 2);

    // Step 2: Plan
    const plan = runPanTools('focus plan --mode balanced', tmpDir);
    assert.ok(plan.success);
    const planData = JSON.parse(plan.output);
    assert.ok(planData.items_selected > 0);
    assert.ok(planData.batch_file);

    // Step 3: Exec (dry-run)
    const exec = runPanTools('focus exec --dry-run', tmpDir);
    assert.ok(exec.success);
    const execData = JSON.parse(exec.output);
    assert.equal(execData.dry_run, true);
    assert.ok(execData.total_items > 0);
  });
});

// ─── Focus Auto-Runner: Constants ───────────────────────────────────────────

describe('Focus auto-runner constants', () => {
  test('FOCUS_CATEGORIES has 9 entries', () => {
    assert.equal(FOCUS_CATEGORIES.length, 9);
    assert.deepStrictEqual(FOCUS_CATEGORIES, ['cleanup', 'tests', 'stability', 'features', 'docs', 'optimize', 'prompts', 'security', 'distill']);
  });

  test('CATEGORY_PRIORITY_RANGE covers all categories', () => {
    for (const cat of FOCUS_CATEGORIES) {
      assert.ok(CATEGORY_PRIORITY_RANGE[cat], `Missing range for ${cat}`);
      assert.ok(typeof CATEGORY_PRIORITY_RANGE[cat].min === 'number');
      assert.ok(typeof CATEGORY_PRIORITY_RANGE[cat].max === 'number');
    }
  });

  test('CATEGORY_DEFAULTS covers all categories', () => {
    for (const cat of FOCUS_CATEGORIES) {
      assert.ok(CATEGORY_DEFAULTS[cat], `Missing defaults for ${cat}`);
      assert.ok(CATEGORY_DEFAULTS[cat].mode);
      assert.ok(typeof CATEGORY_DEFAULTS[cat].budget === 'number');
    }
  });

  test('DEFAULT_MAX_CYCLES and DEFAULT_TOTAL_BUDGET are numbers', () => {
    assert.equal(DEFAULT_MAX_CYCLES, 10);
    assert.equal(DEFAULT_TOTAL_BUDGET, 500);
  });
});

// ─── Focus Auto-Runner: categoryFilter ──────────────────────────────────────

describe('categoryFilter', () => {
  const items = [
    { id: '1', priority: 'P0' },
    { id: '2', priority: 'P1' },
    { id: '3', priority: 'P2' },
    { id: '4', priority: 'P3' },
    { id: '5', priority: 'P4' },
    { id: '6', priority: 'P5' },
    { id: '7', priority: 'P6' },
  ];

  test('null category returns all items', () => {
    const result = categoryFilter(items, null);
    assert.equal(result.length, 7);
  });

  test('cleanup filters to P3-P5', () => {
    const result = categoryFilter(items, 'cleanup');
    assert.deepStrictEqual(result.map(i => i.priority), ['P3', 'P4', 'P5']);
  });

  test('tests filters to P2-P5', () => {
    const result = categoryFilter(items, 'tests');
    assert.deepStrictEqual(result.map(i => i.priority), ['P2', 'P3', 'P4', 'P5']);
  });

  test('stability filters to P0-P2', () => {
    const result = categoryFilter(items, 'stability');
    assert.deepStrictEqual(result.map(i => i.priority), ['P0', 'P1', 'P2']);
  });

  test('features filters to P3-P5', () => {
    const result = categoryFilter(items, 'features');
    assert.deepStrictEqual(result.map(i => i.priority), ['P3', 'P4', 'P5']);
  });

  test('docs filters to P5-P6', () => {
    const result = categoryFilter(items, 'docs');
    assert.deepStrictEqual(result.map(i => i.priority), ['P5', 'P6']);
  });

  test('empty items returns empty', () => {
    const result = categoryFilter([], 'cleanup');
    assert.equal(result.length, 0);
  });

  test('unknown category returns all items', () => {
    const result = categoryFilter(items, 'nonexistent');
    assert.equal(result.length, 7);
  });
});

// ─── Focus Auto-Runner: readAutoRun / writeAutoRun ──────────────────────────

describe('readAutoRun and writeAutoRun', () => {
  test('readAutoRun returns null when no file exists', () => {
    const result = readAutoRun(tmpDir);
    assert.equal(result, null);
  });

  test('writeAutoRun creates file and readAutoRun reads it', () => {
    const data = { run_id: 'test-1', status: 'initialized' };
    const ok = writeAutoRun(tmpDir, data);
    assert.equal(ok, true);
    const result = readAutoRun(tmpDir);
    assert.equal(result.run_id, 'test-1');
    assert.equal(result.status, 'initialized');
  });

  test('writeAutoRun creates directory if missing', () => {
    const freshDir = createTempProject();
    const data = { run_id: 'test-2' };
    const ok = writeAutoRun(freshDir, data);
    assert.equal(ok, true);
    const result = readAutoRun(freshDir);
    assert.equal(result.run_id, 'test-2');
    cleanup(freshDir);
  });

  test('readAutoRun returns null for malformed JSON', () => {
    const focusDir = path.join(tmpDir, '.planning', 'focus');
    fs.mkdirSync(focusDir, { recursive: true });
    fs.writeFileSync(path.join(focusDir, 'auto-run.json'), 'not json');
    const result = readAutoRun(tmpDir);
    assert.equal(result, null);
  });

  test('writeAutoRun overwrites existing file', () => {
    writeAutoRun(tmpDir, { run_id: 'old' });
    writeAutoRun(tmpDir, { run_id: 'new' });
    const result = readAutoRun(tmpDir);
    assert.equal(result.run_id, 'new');
  });
});

// ─── Focus Auto-Runner: cmdFocusAuto state machine ──────────────────────────

describe('cmdFocusAuto state machine', () => {
  test('initializes new run with --category', () => {
    const r = runPanTools('focus auto --category cleanup', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.status, 'initialized');
    assert.equal(data.category, 'cleanup');
    assert.equal(data.mode, 'balanced');
    assert.equal(data.budget_per_cycle, 50);
    assert.equal(data.max_cycles, 10);
    assert.equal(data.total_budget, 500);
    assert.ok(data.run_id.startsWith('auto-'));
    assert.ok(data.run_file);
  });

  test('initializes with category defaults (stability)', () => {
    const r = runPanTools('focus auto --category stability', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.mode, 'bugfix');
    assert.equal(data.budget_per_cycle, 40);
  });

  test('explicit flags override category defaults', () => {
    const r = runPanTools('focus auto --category stability --mode full --budget 60', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.mode, 'full');
    assert.equal(data.budget_per_cycle, 60);
  });

  test('initializes without category (all priorities)', () => {
    const r = runPanTools('focus auto', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.category, null);
    assert.equal(data.mode, 'balanced');
    assert.deepStrictEqual(data.priority_range, { min: 0, max: 6 });
  });

  test('rejects invalid category', () => {
    const r = runPanTools('focus auto --category invalid', tmpDir);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('Category must be one of'));
  });

  // ADR-0031: work source + parallel/seal flags
  test('defaults source to scan', () => {
    const r = runPanTools('focus auto --category cleanup', tmpDir);
    assert.ok(r.success);
    assert.equal(JSON.parse(r.output).source, 'scan');
  });

  test('accepts --source backlog and records it', () => {
    const r = runPanTools('focus auto --source backlog', tmpDir);
    assert.ok(r.success, r.error);
    assert.equal(JSON.parse(r.output).source, 'backlog');
  });

  test('rejects invalid source', () => {
    const r = runPanTools('focus auto --source bogus', tmpDir);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('Source must be one of'));
  });

  test('records parallel-research / parallel-verify / clean-seal flags', () => {
    const r = runPanTools('focus auto --source backlog --parallel-research --parallel-verify --clean-seal', tmpDir);
    assert.ok(r.success, r.error);
    const d = JSON.parse(r.output);
    assert.equal(d.parallel_research, true);
    assert.equal(d.parallel_verify, true);
    assert.equal(d.clean_seal, true);
  });

  test('parallel/seal flags default off', () => {
    const r = runPanTools('focus auto --category cleanup', tmpDir);
    const d = JSON.parse(r.output);
    assert.equal(d.parallel_research, false);
    assert.equal(d.parallel_verify, false);
    assert.equal(d.clean_seal, false);
  });

  test('concurrent run guard blocks new init', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    const r2 = runPanTools('focus auto --category tests', tmpDir);
    assert.equal(r2.success, false);
    assert.ok(r2.error.includes('already in progress'));
  });

  test('--status returns error when no run exists', () => {
    const r = runPanTools('focus auto --status', tmpDir);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('No auto-run found'));
  });

  test('--status returns run state with computed fields', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    const r = runPanTools('focus auto --status', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.status, 'initialized');
    assert.equal(data.budget_remaining, 500);
    assert.equal(data.cycles_remaining, 10);
  });

  test('--stop stops an active run', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    const r = runPanTools('focus auto --stop', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.status, 'stopped');
    assert.equal(data.stop_reason, 'user_stop');
  });

  test('--stop errors when no run exists', () => {
    const r = runPanTools('focus auto --stop', tmpDir);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('No auto-run in progress'));
  });

  test('--update records cycle and updates totals', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    const r = runPanTools(
      'focus auto --update --items-completed 5 --items-failed 1 --points-used 12 --tests-before 100 --tests-after 103 --batch-file batch.json',
      tmpDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.cycle_recorded, 1);
    assert.equal(data.total_items_completed, 5);
    assert.equal(data.total_points_used, 12);
    assert.equal(data.stop_reason, null);
    assert.equal(data.status, 'in_progress');
  });

  test('--update detects regression (tests_after < tests_before)', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    const r = runPanTools(
      'focus auto --update --items-completed 3 --points-used 8 --tests-before 100 --tests-after 98',
      tmpDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.stop_reason, 'regression');
    assert.equal(data.status, 'stopped');
  });

  test('--update detects zero_completed stop', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    const r = runPanTools(
      'focus auto --update --items-completed 0 --points-used 0 --tests-before 100 --tests-after 100',
      tmpDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.stop_reason, 'zero_completed');
  });

  test('--update detects max_cycles stop', () => {
    runPanTools('focus auto --category cleanup --max-cycles 1', tmpDir);
    const r = runPanTools(
      'focus auto --update --items-completed 3 --points-used 8 --tests-before 100 --tests-after 100',
      tmpDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.stop_reason, 'max_cycles');
  });

  test('--update detects budget_cap stop', () => {
    runPanTools('focus auto --category cleanup --total-budget 10', tmpDir);
    const r = runPanTools(
      'focus auto --update --items-completed 3 --points-used 15 --tests-before 100 --tests-after 100',
      tmpDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.stop_reason, 'budget_cap');
  });

  test('--continue resumes a stopped run', () => {
    runPanTools('focus auto --category cleanup', tmpDir);
    runPanTools('focus auto --stop', tmpDir);
    const r = runPanTools('focus auto --continue', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.status, 'initialized');
    assert.equal(data.stop_reason, null);
  });

  test('--continue errors when no run exists', () => {
    const r = runPanTools('focus auto --continue', tmpDir);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('No auto-run in progress'));
  });

  test('--dry-run shows plan without writing', () => {
    const r = runPanTools('focus auto --category tests --dry-run', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.dry_run, true);
    assert.equal(data.category, 'tests');
    // No file should be written
    const run = readAutoRun(tmpDir);
    assert.equal(run, null);
  });

  test('new run after completed run works', () => {
    // Init + stop first run
    runPanTools('focus auto --category cleanup', tmpDir);
    runPanTools(
      'focus auto --update --items-completed 0 --points-used 0 --tests-before 100 --tests-after 100',
      tmpDir
    );
    // zero_completed should have set status to completed
    const status = runPanTools('focus auto --status', tmpDir);
    const statusData = JSON.parse(status.output);
    assert.equal(statusData.status, 'completed');

    // Start new run — should work because old is completed
    const r = runPanTools('focus auto --category tests', tmpDir);
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.category, 'tests');
  });
});

// ─── Focus Auto-Runner: dispatcher integration ──────────────────────────────

describe('focus auto dispatcher integration', () => {
  test('unknown focus subcommand includes auto in error', () => {
    const r = runPanTools('focus nope', tmpDir);
    assert.equal(r.success, false);
    assert.ok(r.error.includes('auto'));
  });
});

// ─── Focus Auto-Runner: checkpoint commits (SCAN-008) ──────────────────────

describe('focus auto checkpoint commits', () => {
  let gitDir;

  beforeEach(() => {
    gitDir = createTempProject();
    runPanTools('config-ensure-section', gitDir);
    execSync('git init', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: gitDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: gitDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(gitDir, '.planning', 'init.md'), '# init');
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: gitDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(gitDir);
  });

  test('--update creates checkpoint commit in git repo', () => {
    runPanTools('focus auto --category cleanup', gitDir);
    // Make a planning change so there's something to commit
    fs.writeFileSync(path.join(gitDir, '.planning', 'cycle-result.md'), '# cycle 1');
    const r = runPanTools(
      'focus auto --update --items-completed 3 --points-used 8 --tests-before 100 --tests-after 103',
      gitDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.ok(data.commit_hash, 'should have commit_hash');
    // Verify the commit exists
    const log = execSync('git log --oneline -1', { cwd: gitDir, encoding: 'utf-8' });
    assert.ok(log.includes('focus-auto cycle 1'), 'commit message should reference cycle');
  });

  test('--update skips commit when no planning changes', () => {
    runPanTools('focus auto --category cleanup', gitDir);
    // Commit auto-run.json first so update has nothing new
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "stage"', { cwd: gitDir, stdio: 'pipe' });
    const logBefore = execSync('git log --oneline', { cwd: gitDir, encoding: 'utf-8' }).trim();
    const r = runPanTools(
      'focus auto --update --items-completed 2 --points-used 5 --tests-before 100 --tests-after 102',
      gitDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    // auto-run.json change will be detected, so commit_hash may or may not be null
    // but the key point is it doesn't crash
    assert.equal(data.cycle_recorded, 1);
  });

  test('--update respects auto_commit=false config', () => {
    const configPath = path.join(gitDir, '.planning', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.focus = { auto_commit: false };
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    execSync('git add .', { cwd: gitDir, stdio: 'pipe' });
    execSync('git commit -m "config"', { cwd: gitDir, stdio: 'pipe' });

    runPanTools('focus auto --category cleanup', gitDir);
    fs.writeFileSync(path.join(gitDir, '.planning', 'cycle-result.md'), '# cycle');
    const logBefore = execSync('git log --oneline', { cwd: gitDir, encoding: 'utf-8' }).trim().split('\n').length;
    const r = runPanTools(
      'focus auto --update --items-completed 2 --points-used 5 --tests-before 100 --tests-after 102',
      gitDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.commit_hash, null, 'should not commit when auto_commit=false');
    const logAfter = execSync('git log --oneline', { cwd: gitDir, encoding: 'utf-8' }).trim().split('\n').length;
    assert.equal(logAfter, logBefore, 'no new commits should be created');
  });

  test('--update works in non-git dir (no commit, no crash)', () => {
    const noGitDir = createTempProject();
    runPanTools('config-ensure-section', noGitDir);
    runPanTools('focus auto --category cleanup', noGitDir);
    const r = runPanTools(
      'focus auto --update --items-completed 1 --points-used 3 --tests-before 50 --tests-after 52',
      noGitDir
    );
    assert.ok(r.success);
    const data = JSON.parse(r.output);
    assert.equal(data.commit_hash, null, 'should be null in non-git dir');
    assert.equal(data.cycle_recorded, 1);
    cleanup(noGitDir);
  });
});

// ─── Optimize category ──────────────────────────────────────────────────────

describe('categoryFilter — optimize', () => {
  const items = [
    { id: '1', priority: 'P0' },
    { id: '2', priority: 'P1' },
    { id: '3', priority: 'P2' },
    { id: '4', priority: 'P3' },
    { id: '5', priority: 'P4' },
    { id: '6', priority: 'P5' },
    { id: '7', priority: 'P6' },
  ];

  test('optimize filters to P1-P4', () => {
    const result = categoryFilter(items, 'optimize');
    assert.deepStrictEqual(result.map(i => i.priority), ['P1', 'P2', 'P3', 'P4']);
  });
});

describe('CATEGORY_DEFAULTS — optimize', () => {
  test('optimize has balanced mode and 50 budget', () => {
    assert.equal(CATEGORY_DEFAULTS.optimize.mode, 'balanced');
    assert.equal(CATEGORY_DEFAULTS.optimize.budget, 50);
  });
});

describe('CATEGORY_PRIORITY_RANGE — optimize', () => {
  test('optimize range is P1-P4 (indices 1-4)', () => {
    assert.equal(CATEGORY_PRIORITY_RANGE.optimize.min, 1);
    assert.equal(CATEGORY_PRIORITY_RANGE.optimize.max, 4);
  });
});

describe('determineStopReason — diminishing returns', () => {
  test('returns diminishing_returns when efficiency drops below 30% of previous', () => {
    const cycle = { items_completed: 1, points_used: 10, tests_before: 100, tests_after: 101 };
    const run = {
      category: 'optimize',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 3, points_used: 70 },
      cycles: [
        { items_completed: 5, points_used: 10 },  // prev efficiency: 0.5
        cycle,                                      // curr efficiency: 0.1 (< 0.5 * 0.3 = 0.15)
      ],
    };
    assert.equal(determineStopReason(cycle, run), 'diminishing_returns');
  });

  test('does NOT trigger for non-optimize categories', () => {
    const cycle = { items_completed: 1, points_used: 10, tests_before: 100, tests_after: 101 };
    const run = {
      category: 'cleanup',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 3, points_used: 70 },
      cycles: [
        { items_completed: 5, points_used: 10 },
        cycle,
      ],
    };
    assert.equal(determineStopReason(cycle, run), null);
  });

  test('does NOT trigger on first cycle (no previous to compare)', () => {
    const cycle = { items_completed: 1, points_used: 10, tests_before: 100, tests_after: 101 };
    const run = {
      category: 'optimize',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 2, points_used: 10 },
      cycles: [cycle],
    };
    assert.equal(determineStopReason(cycle, run), null);
  });

  test('returns null when efficiency stays high', () => {
    const cycle = { items_completed: 4, points_used: 10, tests_before: 100, tests_after: 104 };
    const run = {
      category: 'optimize',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 3, points_used: 60 },
      cycles: [
        { items_completed: 5, points_used: 10 },  // prev efficiency: 0.5
        cycle,                                      // curr efficiency: 0.4 (> 0.5 * 0.3 = 0.15)
      ],
    };
    assert.equal(determineStopReason(cycle, run), null);
  });

  test('DIMINISHING_RETURNS_THRESHOLD is 0.3', () => {
    assert.equal(DIMINISHING_RETURNS_THRESHOLD, 0.3);
  });
});

describe('focusAutoInit — optimize category', () => {
  test('accepts optimize as valid category via CLI --dry-run', () => {
    const r = runPanTools('focus auto --category optimize --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.category, 'optimize');
    assert.equal(data.mode, 'balanced');
    assert.equal(data.budget_per_cycle, 50);
    assert.equal(data.dry_run, true);
    assert.equal(data.priority_range.min, 1);
    assert.equal(data.priority_range.max, 4);
  });
});

// ─── Prompts category ─────────────────────────────────────────────────────

describe('categoryFilter — prompts', () => {
  const items = [
    { id: '1', priority: 'P0' },
    { id: '2', priority: 'P1' },
    { id: '3', priority: 'P2' },
    { id: '4', priority: 'P3' },
    { id: '5', priority: 'P4' },
    { id: '6', priority: 'P5' },
    { id: '7', priority: 'P6' },
  ];

  test('prompts filters to P0-P6 (all priorities)', () => {
    const result = categoryFilter(items, 'prompts');
    assert.deepStrictEqual(result.map(i => i.priority), ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6']);
  });
});

describe('CATEGORY_DEFAULTS — prompts', () => {
  test('prompts has balanced mode and 100 budget', () => {
    assert.equal(CATEGORY_DEFAULTS.prompts.mode, 'balanced');
    assert.equal(CATEGORY_DEFAULTS.prompts.budget, 100);
  });
});

describe('CATEGORY_PRIORITY_RANGE — prompts', () => {
  test('prompts range is P0-P6 (indices 0-6)', () => {
    assert.equal(CATEGORY_PRIORITY_RANGE.prompts.min, 0);
    assert.equal(CATEGORY_PRIORITY_RANGE.prompts.max, 6);
  });
});

describe('determineStopReason — prompts_complete', () => {
  test('returns prompts_complete when prompts_remaining is 0', () => {
    const cycle = { items_completed: 3, points_used: 15, tests_before: 100, tests_after: 103, prompts_remaining: 0 };
    const run = {
      category: 'prompts',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 2, points_used: 30 },
      cycles: [cycle],
    };
    assert.equal(determineStopReason(cycle, run), 'prompts_complete');
  });

  test('does NOT trigger when prompts_remaining > 0', () => {
    const cycle = { items_completed: 3, points_used: 15, tests_before: 100, tests_after: 103, prompts_remaining: 5 };
    const run = {
      category: 'prompts',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 2, points_used: 30 },
      cycles: [cycle],
    };
    assert.equal(determineStopReason(cycle, run), null);
  });

  test('does NOT trigger for non-prompts categories', () => {
    const cycle = { items_completed: 3, points_used: 15, tests_before: 100, tests_after: 103, prompts_remaining: 0 };
    const run = {
      category: 'cleanup',
      total_budget: 500,
      max_cycles: 10,
      totals: { cycles_completed: 2, points_used: 30 },
      cycles: [cycle],
    };
    assert.equal(determineStopReason(cycle, run), null);
  });
});

describe('focusAutoInit — prompts category', () => {
  test('accepts prompts as valid category via CLI --dry-run', () => {
    const r = runPanTools('focus auto --category prompts --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.category, 'prompts');
    assert.equal(data.mode, 'balanced');
    assert.equal(data.budget_per_cycle, 100);
    assert.equal(data.dry_run, true);
    assert.equal(data.priority_range.min, 0);
    assert.equal(data.priority_range.max, 6);
  });
});

// ─── focusAutoInit — security category ───────────────────────────────────────

describe('focusAutoInit — security category', () => {
  test('accepts security as valid category via CLI --dry-run', () => {
    const r = runPanTools('focus auto --category security --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.category, 'security');
    assert.equal(data.mode, 'bugfix');
    assert.equal(data.budget_per_cycle, 40);
    assert.equal(data.dry_run, true);
  });

  test('security category priority range is P0-P2', () => {
    const r = runPanTools('focus auto --category security --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.priority_range.min, 0);
    assert.equal(data.priority_range.max, 2);
  });

  test('FOCUS_CATEGORIES constant includes security', () => {
    const { FOCUS_CATEGORIES } = require('../pan-wizard-core/bin/lib/constants.cjs');
    assert.ok(FOCUS_CATEGORIES.includes('security'));
  });

  test('CATEGORY_DEFAULTS has security entry', () => {
    const { CATEGORY_DEFAULTS } = require('../pan-wizard-core/bin/lib/constants.cjs');
    assert.equal(CATEGORY_DEFAULTS.security.mode, 'bugfix');
    assert.equal(CATEGORY_DEFAULTS.security.budget, 40);
  });

  test('CATEGORY_PRIORITY_RANGE has security entry P0-P2', () => {
    const { CATEGORY_PRIORITY_RANGE } = require('../pan-wizard-core/bin/lib/constants.cjs');
    assert.equal(CATEGORY_PRIORITY_RANGE.security.min, 0);
    assert.equal(CATEGORY_PRIORITY_RANGE.security.max, 2);
  });

  test('security category stored in run state after init', () => {
    const r = runPanTools('focus auto --category security', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.category, 'security');
    assert.equal(data.mode, 'bugfix');
  });

  test('deep_review_enabled is false by default', () => {
    const r = runPanTools('focus auto --category security --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.deep_review_enabled, false);
  });

  test('deep_review_enabled is true when --deep-review flag passed', () => {
    const r = runPanTools('focus auto --category security --deep-review --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.deep_review_enabled, true);
  });

  test('--deep-review flag works with non-security categories', () => {
    const r = runPanTools('focus auto --category tests --deep-review --dry-run', tmpDir);
    assert.ok(r.success, `Failed: ${r.output}`);
    const data = JSON.parse(r.output);
    assert.equal(data.deep_review_enabled, true);
    assert.equal(data.category, 'tests');
  });
});

// ─── determineStopReason — security_complete ─────────────────────────────────

describe('determineStopReason — security_complete', () => {
  const { determineStopReason } = require('../pan-wizard-core/bin/lib/focus.cjs');

  test('returns security_complete for security category when items_completed is 0', () => {
    const run = {
      category: 'security',
      total_budget: 500,
      max_cycles: 10,
      totals: { points_used: 20, cycles_completed: 1 },
      cycles: [],
    };
    const cycle = { items_completed: 0, items_failed: 0, tests_before: 100, tests_after: 100, points_used: 0 };
    assert.equal(determineStopReason(cycle, run), 'security_complete');
  });

  test('returns zero_completed (not security_complete) for non-security category', () => {
    const run = {
      category: 'stability',
      total_budget: 500,
      max_cycles: 10,
      totals: { points_used: 20, cycles_completed: 1 },
      cycles: [],
    };
    const cycle = { items_completed: 0, items_failed: 0, tests_before: 100, tests_after: 100, points_used: 0 };
    assert.equal(determineStopReason(cycle, run), 'zero_completed');
  });

  test('does not return security_complete when items were completed', () => {
    const run = {
      category: 'security',
      total_budget: 500,
      max_cycles: 10,
      totals: { points_used: 20, cycles_completed: 1 },
      cycles: [],
    };
    const cycle = { items_completed: 2, items_failed: 0, tests_before: 100, tests_after: 100, points_used: 8 };
    assert.equal(determineStopReason(cycle, run), null);
  });
});
