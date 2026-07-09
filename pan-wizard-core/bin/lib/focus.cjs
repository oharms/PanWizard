/**
 * Focus — Strategic project management: scan, plan, sync, exec
 *
 * Provides focus-scan (work item collection + priority classification),
 * focus-plan (capacity-budgeted batch creation), focus-sync (doc staleness check),
 * and focus-exec (batch execution pipeline).
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, loadConfig, scanPendingTodos, scanSourceTodos, toPosix, isGitRepo, execGit } = require('./core.cjs');
const {
  PLANNING_DIR, PHASES_DIR, ROADMAP_FILE, PATTERNS_FILE, EFFORT_POINTS, PRIORITY_LEVELS, EFFORT_SIZES,
  FOCUS_MODES, FOCUS_TIERS, FOCUS_DIR,
  BUDGET_LIMIT_BUGFIX, BUDGET_LIMIT_FULL, STABILITY_RATIO, FEATURE_RATIO,
  DIMINISHING_RETURNS_THRESHOLD,
  AUTO_RUN_FILE, FOCUS_CATEGORIES, FOCUS_SOURCES, CATEGORY_PRIORITY_RANGE, CATEGORY_DEFAULTS,
  DEFAULT_MAX_CYCLES, DEFAULT_TOTAL_BUDGET,
  BUDGET_MIN, BUDGET_MAX, MAX_CYCLES_MIN, MAX_CYCLES_MAX, TOTAL_BUDGET_MIN, TOTAL_BUDGET_MAX,
  AUTORUN_STATUSES, DOC_SYNC_FILES, COMMAND_RENAME_MAP,
} = require('./constants.cjs');
const { extractFrontmatter, extractPriorityEffort } = require('./frontmatter.cjs');
const { enumerateRoadmapPhases } = require('./roadmap.cjs');
const { readErrorPatterns } = require('./commands.cjs');
const { planningPath, listPhaseDirs, classifyPhaseStatus, filterPlanFiles, filterSummaryFiles } = require('./utils.cjs');

// ─── Scan helpers ───────────────────────────────────────────────────────────

/**
 * Collect work items from all project sources.
 * Sources: phase plans (priority/effort from frontmatter), pending todos, error patterns.
 * @param {string} cwd - Project root
 * @returns {{ items: Array, sources: Object }}
 */
function collectWorkItems(cwd) {
  const items = [];
  const sources = { phases: 0, todos: 0, patterns: 0 };

  // 1. Phase-based items from ROADMAP + plan.md frontmatter
  const roadmapPath = path.join(cwd, PLANNING_DIR, ROADMAP_FILE);
  const roadmapContent = safeReadFile(roadmapPath);
  if (roadmapContent) {
    const phases = enumerateRoadmapPhases(roadmapContent);
    const phasesDir = path.join(cwd, PLANNING_DIR, PHASES_DIR);
    let dirs;
    try { dirs = fs.readdirSync(phasesDir); } catch { dirs = []; }

    for (const phase of phases) {
      const dirName = dirs.find(d => d.startsWith(phase.number + '-') || d === phase.number);
      if (!dirName) continue;

      const phaseDir = path.join(phasesDir, dirName);
      let files;
      try { files = fs.readdirSync(phaseDir); } catch { continue; }

      const planFiles = filterPlanFiles(files);
      const summaryFiles = filterSummaryFiles(files);
      const status = classifyPhaseStatus(planFiles.length, summaryFiles.length, {});

      if (status === 'complete') continue;

      // Read first plan file for frontmatter
      let priority = 'P3';
      let effort = 'M';
      if (planFiles.length > 0) {
        const planContent = safeReadFile(path.join(phaseDir, planFiles[0]));
        if (planContent) {
          const pe = extractPriorityEffort(extractFrontmatter(planContent));
          priority = pe.priority;
          effort = pe.effort;
        }
      }

      items.push({
        id: `phase-${phase.number}`,
        title: `Phase ${phase.number}: ${phase.name}`,
        source: 'phase',
        priority,
        effort,
        points: EFFORT_POINTS[effort] || 4,
        status,
        file: toPosix(path.join(PLANNING_DIR, PHASES_DIR, dirName)),
      });
      sources.phases++;
    }
  }

  // 2. Pending todos
  const todoResult = scanPendingTodos(cwd);
  if (todoResult && todoResult.todos) {
    for (const todo of todoResult.todos) {
      items.push({
        id: `todo-${todo.file}`,
        title: todo.title || todo.file,
        source: 'todo',
        priority: 'P5',
        effort: 'S',
        points: EFFORT_POINTS.S,
        status: 'pending',
        file: toPosix(path.join(PLANNING_DIR, 'todos', 'pending', todo.file)),
      });
      sources.todos++;
    }
  }

  // 3. Error patterns
  const patterns = readErrorPatterns(cwd);
  for (const pattern of patterns) {
    items.push({
      id: `pattern-${pattern.id || 'unknown'}`,
      title: pattern.title || `Error pattern: ${pattern.id}`,
      source: 'pattern',
      priority: 'P1',
      effort: 'S',
      points: EFFORT_POINTS.S,
      status: 'active',
      file: toPosix(path.join(PLANNING_DIR, PATTERNS_FILE)),
    });
    sources.patterns++;
  }

  return { items, sources };
}

/**
 * Assign priority P0-P6 based on source type and content.
 * Phase items use frontmatter priority; todos default to P5; patterns default to P1.
 * Exported for test coverage — no internal callers.
 * @param {Object} item - Work item
 * @returns {string} Priority level
 */
function classifyItemPriority(item) {
  return item.priority || 'P3';
}

/**
 * Sort items by priority (P0 first), then by effort (smallest first within tier).
 * @param {Array} items - Work items
 * @returns {Array} Sorted items
 */
function sortByPriority(items) {
  return [...items].sort((a, b) => {
    const pa = PRIORITY_LEVELS.indexOf(a.priority);
    const pb = PRIORITY_LEVELS.indexOf(b.priority);
    if (pa !== pb) return pa - pb;
    const ea = EFFORT_SIZES.indexOf(a.effort);
    const eb = EFFORT_SIZES.indexOf(b.effort);
    return ea - eb;
  });
}

/**
 * Compute Reality Score for a work item.
 * RS = (UV + TC + RR) / JS where JS = effort points.
 * @param {Object} item - Work item with uv, tc, rr fields (or defaults)
 * @returns {number} Reality Score
 */
function computeRealityScore(item) {
  const uv = item.uv || 3;
  const tc = item.tc || 2;
  const rr = item.rr || 2;
  const js = EFFORT_POINTS[item.effort] || 4;
  return Number(((uv + tc + rr) / js).toFixed(1));
}

/**
 * focus scan — Collect, classify, sort, and output all work items.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output mode
 * @param {...string} args - Flags: --lean (filter by RS >= 1.5)
 */
function cmdFocusScan(cwd, raw, ...args) {
  const lean = args.includes('--lean');

  const { items, sources } = collectWorkItems(cwd);

  if (items.length === 0) {
    output({ items: [], sources, total: 0, message: 'No work items found' }, raw);
    return;
  }

  // Compute RS for P3-P6 items
  for (const item of items) {
    const pi = PRIORITY_LEVELS.indexOf(item.priority);
    if (pi >= 3) {
      item.realityScore = computeRealityScore(item);
    }
  }

  let sorted = sortByPriority(items);

  // --lean: filter items with RS < 1.5
  if (lean) {
    sorted = sorted.filter(item => {
      if (item.realityScore === undefined) return true;
      return item.realityScore >= 1.5;
    });
  }

  const sourceTodos = scanSourceTodos(cwd);

  output({
    items: sorted,
    sources,
    total: sorted.length,
    priorities: summarizePriorities(sorted),
    source_todos: sourceTodos,
  }, raw);
}

/**
 * Summarize items by priority level.
 * @param {Array} items - Sorted work items
 * @returns {Object} Count per priority level
 */
function summarizePriorities(items) {
  const counts = {};
  for (const level of PRIORITY_LEVELS) {
    const matching = items.filter(i => i.priority === level);
    if (matching.length > 0) {
      counts[level] = matching.length;
    }
  }
  return counts;
}

// ─── Plan helpers ───────────────────────────────────────────────────────────

/**
 * Classify execution tier from effort size.
 * @param {string} effort - XS, S, M, L, XL
 * @returns {string} MICRO, STANDARD, or FULL
 */
function classifyTier(effort) {
  if (effort === 'XS' || effort === 'S') return FOCUS_TIERS.MICRO;
  if (effort === 'M') return FOCUS_TIERS.STANDARD;
  return FOCUS_TIERS.FULL;
}

/**
 * Allocate items into a budget using mode-specific algorithm.
 * @param {Array} items - Sorted work items
 * @param {number} budget - Total capacity points
 * @param {string} mode - bugfix, balanced, features, full
 * @returns {{ batch: Array, allocated: number, remaining: Array }}
 */
/**
 * Allocate items in a single pass up to a budget with optional priority filter.
 * @param {Array} items - Work items
 * @param {number} budget - Points budget
 * @param {Object} [opts] - Options
 * @param {number} [opts.maxPriority] - Max priority index to include
 * @param {number} [opts.minPriority] - Min priority index to include
 * @param {string} [opts.track] - Track label to apply
 * @param {Set} [opts.exclude] - Item IDs to skip
 * @returns {{ picked: Array, used: number }}
 */
function allocatePass(items, budget, opts = {}) {
  const picked = [];
  let used = 0;
  const exclude = opts.exclude || new Set();
  for (const item of items) {
    if (exclude.has(item.id)) continue;
    const pi = PRIORITY_LEVELS.indexOf(item.priority);
    if (opts.maxPriority !== undefined && pi > opts.maxPriority) continue;
    if (opts.minPriority !== undefined && pi < opts.minPriority) continue;
    if (used + item.points <= budget) {
      picked.push({ ...item, tier: classifyTier(item.effort), ...(opts.track ? { track: opts.track } : {}) });
      used += item.points;
    }
  }
  return { picked, used };
}

function allocateBudget(items, budget, mode) {
  const batch = [];
  let allocated = 0;
  const batchIds = new Set();
  const addToBatch = (picked) => { for (const p of picked) { batch.push(p); batchIds.add(p.id); } };

  if (mode === 'bugfix') {
    const { picked, used } = allocatePass(items, budget, { maxPriority: 4 });
    addToBatch(picked);
    allocated = used;
  } else if (mode === 'balanced') {
    const stabilityBudget = Math.floor(budget * STABILITY_RATIO);
    const { picked: sPicked, used: sUsed } = allocatePass(items, stabilityBudget, { maxPriority: 2, track: 'stability' });
    addToBatch(sPicked);
    const { picked: fPicked, used: fUsed } = allocatePass(items, budget - stabilityBudget, { minPriority: 3, track: 'feature', exclude: batchIds });
    addToBatch(fPicked);
    allocated = sUsed + fUsed;
  } else if (mode === 'features') {
    const { picked: mPicked, used: mUsed } = allocatePass(items, budget, { maxPriority: 0, minPriority: 0, track: 'mandatory' });
    addToBatch(mPicked);
    const featureBudget = Math.floor(budget * FEATURE_RATIO);
    const { picked: fPicked, used: fUsed } = allocatePass(items, featureBudget, { minPriority: 3, maxPriority: 5, track: 'feature', exclude: batchIds });
    addToBatch(fPicked);
    const { picked: sPicked, used: sUsed } = allocatePass(items, budget - featureBudget, { minPriority: 1, maxPriority: 2, track: 'stability', exclude: batchIds });
    addToBatch(sPicked);
    allocated = mUsed + fUsed + sUsed;
  } else {
    const { picked, used } = allocatePass(items, budget);
    addToBatch(picked);
    allocated = used;
  }

  const remaining = items.filter(item => !batchIds.has(item.id));
  return { batch, allocated, remaining };
}

/**
 * focus plan — Create a capacity-budgeted execution batch.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output mode
 * @param {...string} args - Flags: --budget N, --mode MODE, --priority P0-P6, --lean
 */
function cmdFocusPlan(cwd, raw, ...args) {
  // Parse flags
  let budget = 50;
  let mode = 'balanced';
  let priorityFilter = null;
  const lean = args.includes('--lean');

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--budget' && args[i + 1]) {
      const n = parseInt(args[i + 1], 10);
      if (!isNaN(n) && n >= BUDGET_MIN && n <= BUDGET_MAX) budget = n;
      i++;
    } else if (args[i] === '--mode' && args[i + 1]) {
      if (FOCUS_MODES.includes(args[i + 1])) mode = args[i + 1];
      i++;
    } else if (args[i] === '--priority' && args[i + 1]) {
      if (PRIORITY_LEVELS.includes(args[i + 1].toUpperCase())) {
        priorityFilter = args[i + 1].toUpperCase();
      }
      i++;
    }
  }

  // Mode-specific budget overrides
  if (mode === 'bugfix') budget = Math.min(budget, BUDGET_LIMIT_BUGFIX);
  if (mode === 'full') budget = Math.max(budget, BUDGET_LIMIT_FULL);

  // Collect items
  const { items, sources } = collectWorkItems(cwd);
  if (items.length === 0) {
    output({ error: 'No work items found. Run focus scan first or add phases/todos.' }, raw);
    return;
  }

  // Apply priority filter
  let filtered = items;
  if (priorityFilter) {
    const maxPriority = PRIORITY_LEVELS.indexOf(priorityFilter);
    filtered = items.filter(i => PRIORITY_LEVELS.indexOf(i.priority) <= maxPriority);
  }

  // Compute RS and filter if lean
  for (const item of filtered) {
    const pi = PRIORITY_LEVELS.indexOf(item.priority);
    if (pi >= 3) item.realityScore = computeRealityScore(item);
  }
  if (lean) {
    filtered = filtered.filter(i => i.realityScore === undefined || i.realityScore >= 1.5);
  }

  const sorted = sortByPriority(filtered);
  const { batch, allocated, remaining } = allocateBudget(sorted, budget, mode);

  // Write batch file
  const focusDir = path.join(cwd, PLANNING_DIR, FOCUS_DIR);
  try { fs.mkdirSync(focusDir, { recursive: true }); } catch { /* exists */ }

  const date = new Date().toISOString().split('T')[0];
  const batchPath = path.join(focusDir, `batch-${date}.json`);
  const batchData = { date, mode, budget, allocated, batch, remaining: remaining.length };
  try {
    fs.writeFileSync(batchPath, JSON.stringify(batchData, null, 2), 'utf-8');
  } catch (err) {
    output({ error: `Failed to write batch file: ${err.message}` }, raw);
    return;
  }

  output({
    mode,
    budget,
    allocated,
    items_selected: batch.length,
    items_remaining: remaining.length,
    batch,
    batch_file: toPosix(path.relative(cwd, batchPath)),
  }, raw);
}

// ─── Sync helpers ───────────────────────────────────────────────────────────

/**
 * Check documentation staleness by comparing actual counts against documented counts.
 * @param {string} cwd - Project root
 * @returns {{ stale: Array, current: Array }}
 */
function checkDocStaleness(cwd, opts) {
  const stale = [];
  const current = [];
  const options = opts || {};

  // Count actuals
  let commandCount = 0;
  try {
    const cmdDir = path.join(cwd, 'commands', 'pan');
    commandCount = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md')).length;
  } catch { /* no commands dir */ }

  let agentCount = 0;
  try {
    const agentDir = path.join(cwd, 'agents');
    agentCount = fs.readdirSync(agentDir).filter(f => f.endsWith('.md')).length;
  } catch { /* no agents dir */ }

  let moduleCount = 0;
  try {
    const libDir = path.join(cwd, 'pan-wizard-core', 'bin', 'lib');
    moduleCount = fs.readdirSync(libDir).filter(f => f.endsWith('.cjs')).length;
  } catch { /* no lib dir */ }

  const actuals = { commands: commandCount, agents: agentCount, modules: moduleCount };

  // Check all doc files for count staleness
  for (const relFile of DOC_SYNC_FILES) {
    const content = safeReadFile(path.join(cwd, relFile));
    if (!content) continue;
    checkCount(content, relFile, 'commands', commandCount, stale, current);
    checkCount(content, relFile, 'agents', agentCount, stale, current);
    checkCount(content, relFile, 'modules', moduleCount, stale, current);

    // Check test/suite counts if provided
    if (options.tests != null) {
      checkCount(content, relFile, 'tests', options.tests, stale, current);
    }
    if (options.suites != null) {
      checkCount(content, relFile, 'suites', options.suites, stale, current);
    }

    // Check for old command names
    checkOldCommandNames(content, relFile, stale);
  }

  // Version cross-reference: package.json vs CHANGELOG.md
  checkVersionCrossRef(cwd, stale, current);

  return { stale, current, actuals };
}

/**
 * Check if a document references old (renamed) command names.
 */
function checkOldCommandNames(content, file, stale) {
  for (const [oldName, newName] of Object.entries(COMMAND_RENAME_MAP)) {
    // Match /pan:old-name or pan:old-name (command references)
    const pattern = new RegExp(`pan:${oldName.replace(/-/g, '\\-')}\\b`);
    if (pattern.test(content)) {
      stale.push({ file, entity: 'renamed_command', old: oldName, new: newName });
    }
  }
}

/**
 * Check package.json version matches latest CHANGELOG entry.
 */
function checkVersionCrossRef(cwd, stale, current) {
  let pkgVersion;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    pkgVersion = pkg.version;
  } catch { return; }

  const changelog = safeReadFile(path.join(cwd, 'CHANGELOG.md'));
  if (!changelog || !pkgVersion) return;

  const versionMatch = changelog.match(/^##\s+\[?v?([\d.]+)\]?/m);
  if (versionMatch) {
    const changelogVersion = versionMatch[1];
    if (changelogVersion === pkgVersion) {
      current.push({ file: 'CHANGELOG.md', entity: 'version', count: pkgVersion });
    } else {
      stale.push({ file: 'CHANGELOG.md', entity: 'version', documented: changelogVersion, actual: pkgVersion });
    }
  }
}

/**
 * Check if a document contains a stale count for a given entity type.
 */
function checkCount(content, file, entity, actual, stale, current) {
  // Match patterns like "32 commands", "11 agents", "14 modules"
  const pattern = new RegExp(`(\\d+)\\s+${entity}`, 'i');
  const match = content.match(pattern);
  if (match) {
    const documented = parseInt(match[1], 10);
    if (documented !== actual) {
      stale.push({ file, entity, documented, actual });
    } else {
      current.push({ file, entity, count: actual });
    }
  }
}

/**
 * focus sync — Check doc staleness and optionally report.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output mode
 * @param {...string} args - Flags: --check-only, --readme, --commands, --agents, --all
 */
function cmdFocusSync(cwd, raw, ...args) {
  const checkOnly = args.includes('--check-only') || args.length === 0;

  const opts = {};
  const testsIdx = args.indexOf('--tests');
  if (testsIdx !== -1 && args[testsIdx + 1]) {
    opts.tests = parseInt(args[testsIdx + 1], 10);
  }
  const suitesIdx = args.indexOf('--suites');
  if (suitesIdx !== -1 && args[suitesIdx + 1]) {
    opts.suites = parseInt(args[suitesIdx + 1], 10);
  }

  const { stale, current, actuals } = checkDocStaleness(cwd, opts);

  output({
    actuals,
    stale,
    current,
    stale_count: stale.length,
    needs_sync: stale.length > 0,
    check_only: checkOnly,
  }, raw);
}

// ─── Exec helpers ───────────────────────────────────────────────────────────

/**
 * Read the oldest open batch file from .planning/focus/.
 * Batches are named batch-YYYY-MM-DD.json; lexical sort == chronological.
 * Oldest-first ensures older unfinished batches get executed before newer ones.
 * @param {string} cwd - Project root
 * @returns {Object|null} Parsed batch data or null
 */
function readLatestBatch(cwd) {
  const focusDir = path.join(cwd, PLANNING_DIR, FOCUS_DIR);
  let files;
  try {
    files = fs.readdirSync(focusDir).filter(f => f.startsWith('batch-') && f.endsWith('.json'));
  } catch {
    return null;
  }
  if (files.length === 0) return null;
  files.sort();
  const content = safeReadFile(path.join(focusDir, files[0]));
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * focus exec — Execute items from the latest batch.
 * This is the core module function that provides the data layer.
 * The full 6-stage pipeline is orchestrated by the command .md workflow.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output mode
 * @param {...string} args - Flags: --dry-run, --budget N, --mode MODE, --continue
 */
function cmdFocusExec(cwd, raw, ...args) {
  const dryRun = args.includes('--dry-run');
  const force = args.includes('--force');

  // Git cleanliness gate (skip for dry-run or --force)
  if (!dryRun && !force && isGitRepo(cwd)) {
    const status = execGit(cwd, ['status', '--porcelain']);
    if (status.exitCode === 0 && status.stdout) {
      const uncommitted = status.stdout.split('\n').filter(Boolean).length;
      output({ error: 'dirty_working_tree', uncommitted_count: uncommitted, hint: 'Commit or stash changes before running focus-exec, or use --force to override' }, raw);
      return;
    }
  }

  const batch = readLatestBatch(cwd);
  if (!batch) {
    output({ error: 'No batch file found. Run focus plan first.' }, raw);
    return;
  }

  if (batch.batch.length === 0) {
    output({ error: 'Batch is empty. Run focus plan with items.' }, raw);
    return;
  }

  // Classify items by tier
  const micro = batch.batch.filter(i => i.tier === FOCUS_TIERS.MICRO);
  const standard = batch.batch.filter(i => i.tier === FOCUS_TIERS.STANDARD);
  const full = batch.batch.filter(i => i.tier === FOCUS_TIERS.FULL);

  const result = {
    dry_run: dryRun,
    mode: batch.mode,
    budget: batch.budget,
    allocated: batch.allocated,
    total_items: batch.batch.length,
    tiers: {
      micro: micro.length,
      standard: standard.length,
      full: full.length,
    },
    items: batch.batch,
    batch_file: toPosix(path.join(PLANNING_DIR, FOCUS_DIR, `batch-${batch.date}.json`)),
  };

  output(result, raw);
}

// ─── Focus Auto-Runner ──────────────────────────────────────────────────────

/**
 * Filter work items by category's priority range.
 * @param {Array} items - Work items with .priority field
 * @param {string|null} category - One of FOCUS_CATEGORIES, or null for all
 * @returns {Array} Filtered items
 */
function categoryFilter(items, category) {
  if (!category) return items;
  const range = CATEGORY_PRIORITY_RANGE[category];
  if (!range) return items;
  return items.filter(item => {
    const idx = PRIORITY_LEVELS.indexOf(item.priority);
    return idx >= range.min && idx <= range.max;
  });
}

/**
 * Read auto-run.json state file.
 * @param {string} cwd - Project root
 * @returns {object|null} Parsed auto-run state or null
 */
function readAutoRun(cwd) {
  const filePath = path.join(cwd, PLANNING_DIR, FOCUS_DIR, AUTO_RUN_FILE);
  const content = safeReadFile(filePath);
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Write auto-run.json state file.
 * @param {string} cwd - Project root
 * @param {object} data - State object to persist
 * @returns {boolean} true on success
 */
function writeAutoRun(cwd, data) {
  const dirPath = path.join(cwd, PLANNING_DIR, FOCUS_DIR);
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, AUTO_RUN_FILE), JSON.stringify(data, null, 2));
    return true;
  } catch {
    return false;
  }
}

/**
 * Generate a unique run ID for the day.
 * @param {string} cwd - Project root
 * @returns {string} Run ID like "auto-2026-03-03-1"
 */
function generateRunId(cwd) {
  const date = new Date().toISOString().slice(0, 10);
  const existing = readAutoRun(cwd);
  if (existing && existing.run_id && existing.run_id.startsWith(`auto-${date}`)) {
    const match = existing.run_id.match(/-(\d+)$/);
    const num = match ? Number(match[1]) + 1 : 1;
    return `auto-${date}-${num}`;
  }
  return `auto-${date}-1`;
}

/**
 * Focus auto-runner: init, status, update, stop.
 * @param {string} cwd - Project root
 * @param {boolean} raw - Raw output mode
 * @param {...string} args - CLI arguments
 */
function focusAutoStatus(cwd, raw) {
  const run = readAutoRun(cwd);
  if (!run) return error('No auto-run found. Start with: focus auto --category <name>');
  const budgetRemaining = run.total_budget - (run.totals ? run.totals.points_used : 0);
  const cyclesRemaining = run.max_cycles - (run.totals ? run.totals.cycles_completed : 0);
  return output({ ...run, budget_remaining: budgetRemaining, cycles_remaining: cyclesRemaining }, raw);
}

function focusAutoStop(cwd, raw) {
  const run = readAutoRun(cwd);
  if (!run) return error('No auto-run in progress. Nothing to stop.');
  if (run.status !== AUTORUN_STATUSES.IN_PROGRESS && run.status !== AUTORUN_STATUSES.INITIALIZED) {
    return error(`Auto-run is already ${run.status}. Nothing to stop.`);
  }
  run.status = AUTORUN_STATUSES.STOPPED;
  run.stop_reason = 'user_stop';
  writeAutoRun(cwd, run);
  return output({
    run_id: run.run_id, status: AUTORUN_STATUSES.STOPPED, stop_reason: 'user_stop',
    cycles_completed: run.totals ? run.totals.cycles_completed : 0,
    total_items_completed: run.totals ? run.totals.items_completed : 0,
  }, raw);
}

function focusAutoUpdate(cwd, raw, getVal) {
  const run = readAutoRun(cwd);
  if (!run) return error('No auto-run in progress. Cannot update.');
  if (run.status !== AUTORUN_STATUSES.IN_PROGRESS && run.status !== AUTORUN_STATUSES.INITIALIZED) {
    return error(`Auto-run is ${run.status}. Cannot update.`);
  }

  const cycle = {
    cycle: (run.totals ? run.totals.cycles_completed : 0) + 1,
    items_completed: Number(getVal('--items-completed', '0')),
    items_failed: Number(getVal('--items-failed', '0')),
    points_used: Number(getVal('--points-used', '0')),
    tests_before: Number(getVal('--tests-before', '0')),
    tests_after: Number(getVal('--tests-after', '0')),
    batch_file: getVal('--batch-file', ''),
    timestamp: new Date().toISOString(),
  };

  if (!run.cycles) run.cycles = [];
  run.cycles.push(cycle);

  if (!run.totals) {
    run.totals = { cycles_completed: 0, items_completed: 0, items_failed: 0, points_used: 0, tests_current: 0 };
  }
  run.totals.cycles_completed += 1;
  run.totals.items_completed += cycle.items_completed;
  run.totals.items_failed += cycle.items_failed;
  run.totals.points_used += cycle.points_used;
  run.totals.tests_current = cycle.tests_after;
  run.status = AUTORUN_STATUSES.IN_PROGRESS;

  const stopReason = determineStopReason(cycle, run);
  if (stopReason) {
    run.status = stopReason === 'regression' ? AUTORUN_STATUSES.STOPPED : AUTORUN_STATUSES.COMPLETED;
    run.stop_reason = stopReason;
  }

  writeAutoRun(cwd, run);
  const commitHash = focusAutoCheckpointCommit(cwd, cycle, run);
  return output({
    run_id: run.run_id, status: run.status, cycle_recorded: cycle.cycle,
    total_items_completed: run.totals.items_completed,
    total_points_used: run.totals.points_used, stop_reason: stopReason,
    commit_hash: commitHash,
  }, raw);
}

function focusAutoCheckpointCommit(cwd, cycle, run) {
  if (!isGitRepo(cwd)) return null;
  const config = loadConfig(cwd);
  const autoCommit = config.focus && config.focus.auto_commit !== undefined ? config.focus.auto_commit : true;
  if (!autoCommit) return null;
  const status = execGit(cwd, ['status', '--porcelain', PLANNING_DIR + '/']);
  if (status.exitCode !== 0 || !status.stdout) return null;
  execGit(cwd, ['add', PLANNING_DIR + '/']);
  const msg = `docs: focus-auto cycle ${cycle.cycle} — ${cycle.items_completed} items completed`;
  const commitResult = execGit(cwd, ['commit', '-m', msg]);
  if (commitResult.exitCode !== 0) return null;
  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return hashResult.exitCode === 0 ? hashResult.stdout : null;
}

function determineStopReason(cycle, run) {
  if (cycle.tests_after < cycle.tests_before) return 'regression';
  if (run.totals.points_used >= run.total_budget) return 'budget_cap';
  if (run.totals.cycles_completed >= run.max_cycles) return 'max_cycles';
  if (cycle.items_completed === 0) {
    // Security category gets a descriptive stop reason rather than generic zero_completed
    if (run.category === 'security') return 'security_complete';
    // Distill category gets a descriptive stop reason — codebase fully distilled
    if (run.category === 'distill') return 'distill_complete';
    return 'zero_completed';
  }

  // Prompts category: stop when all prompts are completed
  if (run.category === 'prompts' && cycle.prompts_remaining === 0) {
    return 'prompts_complete';
  }

  // Optimize category: stop when efficiency drops below threshold of previous cycle
  if (run.category === 'optimize' && run.cycles.length >= 2) {
    const prev = run.cycles[run.cycles.length - 2];
    const prevEff = prev.items_completed / (prev.points_used || 1);
    const currEff = cycle.items_completed / (cycle.points_used || 1);
    if (currEff > 0 && currEff < prevEff * DIMINISHING_RETURNS_THRESHOLD) {
      return 'diminishing_returns';
    }
  }

  return null;
}

function focusAutoContinue(cwd, raw) {
  const run = readAutoRun(cwd);
  if (!run) return error('No auto-run in progress. Start with: focus auto --category <name>');
  if (run.status !== AUTORUN_STATUSES.STOPPED && run.status !== AUTORUN_STATUSES.INITIALIZED) {
    return error(`Cannot continue: auto-run is ${run.status}.`);
  }
  run.status = run.totals && run.totals.cycles_completed > 0 ? AUTORUN_STATUSES.IN_PROGRESS : AUTORUN_STATUSES.INITIALIZED;
  run.stop_reason = null;
  writeAutoRun(cwd, run);
  const budgetRemaining = run.total_budget - (run.totals ? run.totals.points_used : 0);
  const cyclesRemaining = run.max_cycles - (run.totals ? run.totals.cycles_completed : 0);
  return output({ ...run, budget_remaining: budgetRemaining, cycles_remaining: cyclesRemaining }, raw);
}

function focusAutoInit(cwd, raw, getVal, hasFlag) {
  const category = getVal('--category', null);
  if (category && !FOCUS_CATEGORIES.includes(category)) {
    return error(`Category must be one of: ${FOCUS_CATEGORIES.join(', ')}`);
  }

  // ADR-0031: work source — 'scan' (category code-scan, default) or 'backlog'
  // (rank actionable roadmap.md / requirements.md items). Category applies to
  // scan mode; backlog mode ranks the whole actionable backlog.
  const source = getVal('--source', 'scan');
  if (!FOCUS_SOURCES.includes(source)) {
    return error(`Source must be one of: ${FOCUS_SOURCES.join(', ')}`);
  }

  const existing = readAutoRun(cwd);
  if (existing && (existing.status === AUTORUN_STATUSES.IN_PROGRESS || existing.status === AUTORUN_STATUSES.INITIALIZED)) {
    return error('Auto-run already in progress. Use --stop to end it, or --continue to resume.');
  }

  const defaults = category ? CATEGORY_DEFAULTS[category] : { mode: 'balanced', budget: 50 };
  const mode = getVal('--mode', defaults.mode);
  const budget = Number(getVal('--budget', String(defaults.budget)));
  const maxCycles = Number(getVal('--max-cycles', String(DEFAULT_MAX_CYCLES)));
  const totalBudget = Number(getVal('--total-budget', String(DEFAULT_TOTAL_BUDGET)));

  if (!FOCUS_MODES.includes(mode)) return error(`Mode must be one of: ${FOCUS_MODES.join(', ')}`);
  if (budget < BUDGET_MIN || budget > BUDGET_MAX) return error(`Budget must be between ${BUDGET_MIN} and ${BUDGET_MAX}`);
  if (maxCycles < MAX_CYCLES_MIN || maxCycles > MAX_CYCLES_MAX) return error(`Max cycles must be between ${MAX_CYCLES_MIN} and ${MAX_CYCLES_MAX}`);
  if (totalBudget < TOTAL_BUDGET_MIN || totalBudget > TOTAL_BUDGET_MAX) return error(`Total budget must be between ${TOTAL_BUDGET_MIN} and ${TOTAL_BUDGET_MAX}`);

  const runData = {
    run_id: generateRunId(cwd),
    status: AUTORUN_STATUSES.INITIALIZED,
    source: source,
    category: category,
    mode: mode,
    parallel_research: hasFlag('--parallel-research'),
    parallel_verify: hasFlag('--parallel-verify'),
    clean_seal: hasFlag('--clean-seal'),
    budget_per_cycle: budget,
    max_cycles: maxCycles,
    total_budget: totalBudget,
    priority_range: category ? CATEGORY_PRIORITY_RANGE[category] : { min: 0, max: 6 },
    deep_review_enabled: hasFlag('--deep-review'),
    tests_baseline: null,
    cycles: [],
    totals: { cycles_completed: 0, items_completed: 0, items_failed: 0, points_used: 0, tests_current: 0 },
    stop_reason: null,
  };

  if (hasFlag('--dry-run')) {
    return output({ dry_run: true, ...runData, run_file: toPosix(path.join(PLANNING_DIR, FOCUS_DIR, AUTO_RUN_FILE)) }, raw);
  }

  writeAutoRun(cwd, runData);
  output({ ...runData, run_file: toPosix(path.join(PLANNING_DIR, FOCUS_DIR, AUTO_RUN_FILE)) }, raw);
}

function cmdFocusAuto(cwd, raw, ...args) {
  const hasFlag = (flag) => args.includes(flag);
  const getVal = (flag, def) => {
    const idx = args.indexOf(flag);
    return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : def;
  };

  if (hasFlag('--status')) return focusAutoStatus(cwd, raw);
  if (hasFlag('--stop')) return focusAutoStop(cwd, raw);
  if (hasFlag('--update')) return focusAutoUpdate(cwd, raw, getVal);
  if (hasFlag('--continue')) return focusAutoContinue(cwd, raw);
  return focusAutoInit(cwd, raw, getVal, hasFlag);
}

// ─── Opus 4.7: Reflection gate for focus-auto ───────────────────────────────

/**
 * Emit a reflection prompt the orchestrator shows to a thinking-capable model
 * before committing to the next auto cycle. Returns null when reflection is
 * disabled (non-reasoning tier, or explicitly turned off).
 *
 * @param {Object} run - Auto-run state (reads totals, config, category)
 * @param {Object} cycle - The just-completed cycle's telemetry
 * @param {Array} proposedNextBatch - Items focus-scan would select for cycle N+1
 * @param {Object} [opts]
 * @param {string} [opts.tier] - Resolved model tier ('reasoning'|'mid'|'fast')
 * @returns {{reflect: boolean, prompt: string|null, reason: string}}
 */
function determineContinuation(run, cycle, proposedNextBatch, opts) {
  const { REFLECTION_THRESHOLD } = require('./constants.cjs');
  const tier = opts?.tier || 'mid';
  const configFlag = run?.reflection_enabled;

  const enabled = configFlag !== undefined
    ? Boolean(configFlag)
    : REFLECTION_THRESHOLD.enabled_default ||
      REFLECTION_THRESHOLD.enable_on_tiers.includes(tier);

  if (!enabled) {
    return { reflect: false, prompt: null, reason: 'reflection_disabled' };
  }
  if (!Array.isArray(proposedNextBatch) || proposedNextBatch.length === 0) {
    return { reflect: false, prompt: null, reason: 'no_next_batch' };
  }

  const completed = cycle?.items_completed ?? 0;
  const pointsUsed = cycle?.points_used ?? 0;
  const efficiency = pointsUsed > 0 ? (completed / pointsUsed).toFixed(3) : 'n/a';
  const category = run?.category || 'mixed';
  const cyclesDone = run?.totals?.cycles_completed ?? 0;
  const maxCycles = run?.max_cycles ?? 10;

  const firstThree = proposedNextBatch.slice(0, 3)
    .map(i => `- ${i.id || '(no id)'}: ${i.description || i.title || '(no description)'}`)
    .join('\n');

  const prompt = [
    `Reflect before committing to cycle ${cyclesDone + 1} of ${maxCycles} in category "${category}".`,
    '',
    'Just-completed cycle telemetry:',
    `  items_completed: ${completed}`,
    `  points_used: ${pointsUsed}`,
    `  efficiency: ${efficiency} items/point`,
    '',
    `Next batch candidates (top ${Math.min(3, proposedNextBatch.length)} of ${proposedNextBatch.length}):`,
    firstThree,
    '',
    'Think step-by-step: Is running another cycle worthwhile given the telemetry? Would the remaining items cluster better under a different category? Is there a stop signal this data is showing that the automatic rules missed? Answer in JSON: {"continue": true|false, "rationale": "..."}',
  ].join('\n');

  return { reflect: true, prompt, reason: 'ok' };
}

// ─── Opus 4.7: Parallel-tool stage dependency DAG for focus-exec ────────────

/**
 * Classify focus-exec items into a simple dependency DAG suitable for
 * emitting parallel-tool-use instructions.
 *
 * Today every item is independent (batches come from focus-plan which
 * already resolves dependencies). But items of tier MICRO can run fully
 * parallel, STANDARD can run within-stage parallel, FULL must serialize.
 * This helper expresses that as independent waves the command template
 * can reference when instructing Opus to emit parallel tool calls.
 *
 * @param {Array<{id?: string, tier?: string}>} items - From readLatestBatch(...).batch
 * @returns {{waves: Array<Array<Object>>, parallelism_hint: string}}
 */
function classifyStageDependencies(items) {
  const { FOCUS_TIERS } = require('./constants.cjs');
  const safe = Array.isArray(items) ? items : [];
  const micro = safe.filter(i => i && i.tier === FOCUS_TIERS.MICRO);
  const standard = safe.filter(i => i && i.tier === FOCUS_TIERS.STANDARD);
  const full = safe.filter(i => i && i.tier === FOCUS_TIERS.FULL);

  const waves = [];
  if (micro.length) waves.push(micro);
  if (standard.length) waves.push(standard);
  for (const f of full) waves.push([f]);

  let hint = 'sequential';
  if (micro.length >= 2) hint = 'emit-micro-in-parallel';
  else if (standard.length >= 2) hint = 'emit-standard-in-parallel';

  return { waves, parallelism_hint: hint };
}

// ─── Module exports ─────────────────────────────────────────────────────────

module.exports = {
  // Scan
  cmdFocusScan,
  collectWorkItems,
  classifyItemPriority,
  sortByPriority,
  computeRealityScore,
  summarizePriorities,
  // Plan
  cmdFocusPlan,
  classifyTier,
  allocateBudget,
  // Sync
  cmdFocusSync,
  checkDocStaleness,
  checkOldCommandNames,
  checkVersionCrossRef,
  // Exec
  cmdFocusExec,
  readLatestBatch,
  // Auto
  categoryFilter,
  readAutoRun,
  writeAutoRun,
  cmdFocusAuto,
  determineStopReason,
  // Opus 4.7
  determineContinuation,
  classifyStageDependencies,
};
