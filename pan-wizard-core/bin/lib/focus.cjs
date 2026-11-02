/**
 * Focus — Strategic project management: scan, plan, sync, exec
 *
 * Provides focus-scan (work item collection + priority classification),
 * focus-plan (capacity-budgeted batch creation), focus-sync (doc staleness check),
 * and focus-exec (batch execution pipeline).
 */

const fs = require('fs');
const path = require('path');
const { output, EXIT_OK, error, safeReadFile, loadConfig, scanPendingTodos, scanSourceTodos, toPosix, isGitRepo, execGit, escapeRegex, normalizePhaseName } = require('./core.cjs');
const {
  PHASES_DIR, ROADMAP_FILE, PATTERNS_FILE, EFFORT_POINTS, PRIORITY_LEVELS, EFFORT_SIZES,
  FOCUS_MODES, FOCUS_TIERS, FOCUS_DIR, QUICK_DIR,
  BUDGET_LIMIT_BUGFIX, BUDGET_LIMIT_FULL, STABILITY_RATIO, FEATURE_RATIO,
  DIMINISHING_RETURNS_THRESHOLD,
  AUTO_RUN_FILE, FOCUS_CATEGORIES, FOCUS_SOURCES, CATEGORY_PRIORITY_RANGE, CATEGORY_DEFAULTS,
  DEFAULT_MAX_CYCLES, DEFAULT_TOTAL_BUDGET, VERIFY_RESERVE_FRACTION, VERIFY_RESERVE_FLOOR,
  BUDGET_MIN, BUDGET_MAX, MAX_CYCLES_MIN, MAX_CYCLES_MAX, TOTAL_BUDGET_MIN, TOTAL_BUDGET_MAX,
  AUTORUN_STATUSES, DOC_SYNC_FILES, COMMAND_RENAME_MAP,
} = require('./constants.cjs');
const { extractFrontmatter, extractPriorityEffort } = require('./frontmatter.cjs');
const { enumerateRoadmapPhases } = require('./roadmap.cjs');
const { readErrorPatterns } = require('./commands.cjs');
const { weeklyLimitStop } = require('./cost.cjs');
const store = require('./store.cjs');
const { holdLock } = require('./lock.cjs');
const { planningPath, listPhaseDirs, classifyPhaseStatus, filterPlanFiles, filterSummaryFiles, planningRel, nextQuickNum } = require('./utils.cjs');

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
  const roadmapPath = planningPath(cwd, ROADMAP_FILE);
  const roadmapContent = safeReadFile(roadmapPath);
  if (roadmapContent) {
    const phases = enumerateRoadmapPhases(roadmapContent);
    const phasesDir = planningPath(cwd, PHASES_DIR);
    let dirs;
    try { dirs = fs.readdirSync(phasesDir); } catch { dirs = []; }

    for (const phase of phases) {
      // Normalize before matching. Roadmap headings are UNPADDED — the shipped
      // templates/roadmap.md writes "### Phase 1:" and `phase add` appends the same —
      // while phase directories are zero-padded (`01-foundation`). Matching the raw
      // heading number meant '1-' never matched '01-foundation', so focus scan found
      // ZERO work items on a roadmap in PAN's own format, and the whole focus family
      // (scan/plan/classify-stages/exec/auto) was a no-op on any default-shaped
      // project. normalizePhaseName pads and is idempotent, so a roadmap that already
      // says "Phase 01" still matches. Same normalization core.cjs searchPhaseInDir
      // applies, which is why `find-phase 1` always worked where this did not.
      const normalized = normalizePhaseName(phase.number);
      const dirName = dirs.find(d => d.startsWith(normalized + '-') || d === normalized);
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
        file: planningRel(PHASES_DIR, dirName),
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
        file: planningRel('todos', 'pending', todo.file),
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
      file: planningRel(PATTERNS_FILE),
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
    // The feature/stability split shares what the P0 pass left: splitting the
    // whole budget again let a batch reach nearly twice the budget.
    const rest = budget - mUsed;
    const featureBudget = Math.floor(rest * FEATURE_RATIO);
    const { picked: fPicked, used: fUsed } = allocatePass(items, featureBudget, { minPriority: 3, maxPriority: 5, track: 'feature', exclude: batchIds });
    addToBatch(fPicked);
    const { picked: sPicked, used: sUsed } = allocatePass(items, rest - featureBudget, { minPriority: 1, maxPriority: 2, track: 'stability', exclude: batchIds });
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
    // EXIT_OK: an empty backlog is a legitimate answer, not a failure — it is the
    // desired end state of a burn-down loop. `focus scan` already reports zero items
    // as a success payload ({ items: [], total: 0 }) and the shipped scenario test
    // asserts `focus plan` succeeds on a project with no TODOs
    // (tests/scenarios/workflow-focus.test.cjs), so exiting non-zero here would make
    // "nothing left to do" indistinguishable from a crash for the same caller.
    output({ error: 'No work items found. Run focus scan first or add phases/todos.' }, raw, undefined, EXIT_OK);
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
  // Each item carries its owner (D1); `focus open` registers only the focus-owned ones.
  const trace = parseTraceability(safeReadFile(planningPath(cwd, 'requirements.md')));
  batch.forEach((item, i) => { item.owner = classifyOwner(item, trace, i).owner; });

  // Write batch file
  const focusDir = planningPath(cwd, FOCUS_DIR);
  try { fs.mkdirSync(focusDir, { recursive: true }); } catch { /* exists */ }

  const date = new Date().toISOString().split('T')[0];
  const batchPath = path.join(focusDir, `batch-${date}.json`);
  const batchData = { date, mode, budget, allocated, batch, remaining: remaining.length };
  try {
    const w = store.updateRecord(batchPath, () => batchData);
    if (w.error) throw new Error(w.reason || w.error);
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

  // Count actuals. M17: a filesystem count only reconciles a documented count
  // when the corresponding SOURCE directory actually exists. In an INSTALLED
  // host project commands/pan, agents/, and pan-wizard-core/bin/lib are all
  // absent — reconciling a documented "N commands" against an actual of 0 there
  // is a false positive, so the per-entity check is SKIPPED when its dir is
  // missing (tracked via *Present flags below). Explicit --tests/--suites and the
  // version cross-reference are layout-independent and always run.
  let commandCount = 0;
  let commandsPresent = false;
  try {
    const cmdDir = path.join(cwd, 'commands', 'pan');
    commandCount = fs.readdirSync(cmdDir).filter(f => f.endsWith('.md')).length;
    commandsPresent = true;
  } catch { /* no commands dir */ }

  let agentCount = 0;
  let agentsPresent = false;
  try {
    const agentDir = path.join(cwd, 'agents');
    agentCount = fs.readdirSync(agentDir).filter(f => f.endsWith('.md')).length;
    agentsPresent = true;
  } catch { /* no agents dir */ }

  let moduleCount = 0;
  let modulesPresent = false;
  try {
    const libDir = path.join(cwd, 'pan-wizard-core', 'bin', 'lib');
    moduleCount = fs.readdirSync(libDir).filter(f => f.endsWith('.cjs')).length;
    modulesPresent = true;
  } catch { /* no lib dir */ }

  const actuals = { commands: commandCount, agents: agentCount, modules: moduleCount };

  // Check all doc files for count staleness
  for (const relFile of DOC_SYNC_FILES) {
    const content = safeReadFile(path.join(cwd, relFile));
    if (!content) continue;
    if (commandsPresent) checkCount(content, relFile, 'commands', commandCount, stale, current);
    if (agentsPresent) checkCount(content, relFile, 'agents', agentCount, stale, current);
    if (modulesPresent) checkCount(content, relFile, 'modules', moduleCount, stale, current);

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
    const pattern = new RegExp(`pan:${escapeRegex(oldName)}\\b`);
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

const BATCH_DATE_RE = /^batch-(\d{4}-\d{2}-\d{2})/;

/**
 * The batch files in .planning/focus/, oldest first; the last one is the batch to run.
 * Order: the date in the name, then the modification time for batches planned the same
 * day, then the name. `focus plan` writes batch-YYYY-MM-DD.json; `/pan:focus-auto` and
 * hand-planned batches add a slug after the date, which a plain name sort would rank
 * below the same day's plain file whatever order they were written in. This is the one
 * ordering every reader uses: `focus exec`, `focus classify-stages` and `preflight
 * batch` each used to choose a batch its own way.
 * @param {string} cwd - Project root
 * @returns {string[]} File names, oldest first
 */
function listBatchFiles(cwd) {
  const focusDir = planningPath(cwd, FOCUS_DIR);
  let names;
  try {
    names = fs.readdirSync(focusDir).filter(f => f.startsWith('batch-') && f.endsWith('.json'));
  } catch {
    return [];
  }
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return names
    .map((name) => {
      const m = BATCH_DATE_RE.exec(name);
      let mtime = 0;
      try { mtime = fs.statSync(path.join(focusDir, name)).mtimeMs; } catch { /* removed meanwhile */ }
      return { name, date: m ? m[1] : '', mtime };
    })
    .sort((a, b) => cmp(a.date, b.date) || a.mtime - b.mtime || cmp(a.name, b.name))
    .map((e) => e.name);
}

/**
 * Read the newest batch in .planning/focus/, with its items as an array.
 *
 * Newest, not oldest. v2.10.0 (E-12) sorted ascending so "older unfinished batches
 * execute before newer ones", but nothing ever marks a batch finished, so it returned
 * the first batch a project planned, every time. `/pan:focus-auto --step exec` executes the newest
 * batch, so its `classify-stages` step was classifying a different batch from the one it
 * ran. A batch is a snapshot of the backlog: a newer plan already carries whatever an
 * older one left undone.
 *
 * Items: `focus plan` writes them under `batch`. `/pan:focus-auto` documents `items`, and
 * batches agents write put the list under `items`, often with `batch` holding the batch's
 * NAME (measured 2026-09-29, structure only: 1 of 102 batch files in four projects had a
 * `batch` array). Either way the list comes back as `.batch`, with the key it came from
 * in `.items_key`, a string `batch` kept as `.batch_name`, and the file name in `.file`.
 *
 * @param {string} cwd - Project root
 * @returns {Object|null} null when there is no batch file. When the newest file cannot be
 *   used: `{ file, error, batch: [], items_key: null }`. An older batch never stands in.
 */
function readLatestBatch(cwd) {
  const files = listBatchFiles(cwd);
  if (files.length === 0) return null;
  const file = files[files.length - 1];
  return readBatchFile(path.join(planningPath(cwd, FOCUS_DIR), file), file);
}

/**
 * Read one batch file, with its items as `.batch` whatever key holds them (see
 * readLatestBatch). A file that cannot be used comes back with `.error`.
 * @param {string} absPath - The batch file
 * @param {string} [file] - The name to report; the base name by default
 * @returns {Object}
 */
function readBatchFile(absPath, file = path.basename(absPath)) {
  const unusable = (why) => ({ file, error: `${file} ${why}`, batch: [], items_key: null });
  let data;
  try {
    data = JSON.parse(safeReadFile(absPath));
  } catch {
    return unusable('is not valid JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return unusable('is not a batch object');
  const itemsKey = Array.isArray(data.batch) ? 'batch' : Array.isArray(data.items) ? 'items' : null;
  if (!itemsKey) return unusable('has no item list (expected a "batch" or "items" array)');
  const out = { ...data, batch: data[itemsKey], items_key: itemsKey, file };
  if (typeof data.batch === 'string') out.batch_name = data.batch;
  return out;
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
  const batchFile = planningRel(FOCUS_DIR, batch.file);
  if (batch.error) {
    output({ error: batch.error, batch_file: batchFile }, raw);
    return;
  }

  if (batch.batch.length === 0) {
    output({ error: 'Batch is empty. Run focus plan with items.', batch_file: batchFile }, raw);
    return;
  }

  // Classify items by tier (agent-written batches can hold non-object entries)
  const tierOf = (i) => (i && typeof i === 'object' ? i.tier : undefined);
  const micro = batch.batch.filter(i => tierOf(i) === FOCUS_TIERS.MICRO);
  const standard = batch.batch.filter(i => tierOf(i) === FOCUS_TIERS.STANDARD);
  const full = batch.batch.filter(i => tierOf(i) === FOCUS_TIERS.FULL);

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
    batch_file: batchFile,
  };

  output(result, raw);
}

// ─── Focus cycles: registered as quick tasks ────────────────────────────────
//
// A focus run that writes code or docs opens a cycle first and closes it after its
// commit. The cycle is a quick-task record, `.planning/quick/<n>-focus-<kind>-<date>/`
// holding `<n>-plan.md` and, once closed, `<n>-summary.md`. That is the record
// /pan:quick keeps, so state.md's Quick Tasks table, resume and the guard's
// "work in flight" check (hooks/pan-guard.js workInFlight: a plan with no summary)
// see focus work with no focus-specific code. auto-run.json and batch files are not
// in-flight markers: a crash leaves the first `in_progress` for good, and nothing
// marks the second finished (spec focus_phase_integration_featureai.md, D2).


// ─── Ownership (spec focus_phase_integration_featureai.md, D1) ──────────────
//
// Every item a focus run could pick has one owner. Roadmap phases, the plans inside
// them, and requirements the traceability table maps to a phase belong to the phase
// system, whose gates (plan check, verification, the EARS-gated requirement tick) a
// focus cycle does not run. Focus hands those off and executes the rest: unmapped
// requirements (left unticked), todos, patterns, scan and debt items. The engine
// decides, so an in-session agent never does (amends ADR-0031: backlog still selects
// phase work, and routes it).

const PHASE_DIR_RE = /(?:^|\/)phases\/(\d+(?:\.\d+)?)-[^/]*/;

/**
 * Requirement → phase from requirements.md's traceability table (`| AUTH-01 | Phase 1 | … |`).
 * A requirement the table does not list, or lists with no phase, is unmapped. Pure.
 * @param {string|null} text - requirements.md
 * @returns {{known: Set<string>, phaseOf: Map<string, string>}}
 */
function parseTraceability(text) {
  const known = new Set();
  const phaseOf = new Map();
  for (const line of toPosix(String(text || '')).replace(/\r\n/g, '\n').split('\n')) {
    const req = /^\s*- (?:\[[ xX]\] )?\*\*([A-Z][A-Z0-9]*-\d+)\*\*/.exec(line);
    if (req) { known.add(req[1]); continue; }
    const row = /^\|\s*([A-Z][A-Z0-9]*-\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (!row) continue;
    known.add(row[1]);
    const ph = /(?:^|\bphase\s*)(\d+(?:\.\d+)?)\b/i.exec(row[2]);
    if (ph) phaseOf.set(row[1], String(parseFloat(ph[1])));
  }
  return { known, phaseOf };
}

/** The phase number an item names: a `phase-N` id, a `phase` key, or a path into phases/. */
function itemPhase(item, id) {
  const m = /^phase-(\d+(?:\.\d+)?)$/.exec(id);
  if (m) return String(parseFloat(m[1]));
  if (item.phase != null && /^\d+(?:\.\d+)?$/.test(String(item.phase).trim())) return String(parseFloat(item.phase));
  for (const f of [].concat(item.file || [], item.files || [])) {
    const p = typeof f === 'string' ? PHASE_DIR_RE.exec(toPosix(f)) : null;
    if (p && toPosix(f).includes(`${planningRel()}/`)) return String(parseFloat(p[1]));
  }
  return null;
}

/**
 * Who owns a batch item. Pure.
 * @param {Object} item - A batch item
 * @param {{known?: Set<string>, phaseOf?: Map<string, string>}} trace - parseTraceability's result
 * @param {number} [i] - The item's position, for an id-less item
 * @returns {{id: string, owner: 'phase'|'focus', phase?: string, requirement?: string, reason: string}}
 */
function classifyOwner(item, trace = {}, i = 0) {
  const it = item && typeof item === 'object' ? item : {};
  const id = focusItemId(it, i);
  const known = trace.known || new Set();
  const phaseOf = trace.phaseOf || new Map();
  if (it.source === 'phase' || it.source === 'plan' || /^phase-/.test(id)) {
    const phase = itemPhase(it, id);
    return { id, owner: 'phase', phase: phase || undefined, reason: 'a roadmap phase or a plan inside one' };
  }
  const phase = itemPhase(it, id);
  if (phase) return { id, owner: 'phase', phase, reason: 'it points into a phase directory' };
  const reqId = [it.requirement, it.req, id].find((x) => typeof x === 'string' && known.has(x.trim()));
  const isReq = it.source === 'requirement' || !!reqId;
  if (isReq) {
    const req = (reqId || String(it.requirement || id)).trim();
    if (phaseOf.has(req)) return { id, owner: 'phase', phase: phaseOf.get(req), requirement: req, reason: `requirement ${req} is mapped to phase ${phaseOf.get(req)}` };
    return { id, owner: 'focus', requirement: req, reason: `requirement ${req} is mapped to no phase; focus executes it and leaves it unticked` };
  }
  if (it.source === 'todo' || /^todo-/.test(id)) return { id, owner: 'focus', reason: 'a pending todo' };
  return { id, owner: 'focus', reason: 'a scan, pattern, docs or debt item' };
}

/** The command that carries a phase forward: execute its plans, or plan it first. */
function phaseCommand(cwd, phase) {
  if (!phase) return '/pan:progress';
  const want = normalizePhaseName(phase);
  let dir;
  try { dir = fs.readdirSync(planningPath(cwd, PHASES_DIR)).find((d) => d === want || d.startsWith(`${want}-`)); } catch { /* no phases yet */ }
  if (dir) {
    let names = [];
    try { names = fs.readdirSync(planningPath(cwd, PHASES_DIR, dir)); } catch { /* unreadable */ }
    if (filterPlanFiles(names).length) return `/pan:exec-phase ${phase}`;
  }
  return `/pan:plan-phase ${phase}`;
}

/**
 * Split items into the ones focus executes and the ones it hands to the phase system.
 * @param {string} cwd
 * @param {Array} items - Batch items
 * @returns {{execute: Object[], handoff: Object[]}} each entry classifyOwner's result, handoffs with `command`
 */
function routeItems(cwd, items) {
  const trace = parseTraceability(safeReadFile(planningPath(cwd, 'requirements.md')));
  const execute = [];
  const handoff = [];
  (Array.isArray(items) ? items : []).forEach((item, i) => {
    const c = classifyOwner(item, trace, i);
    if (c.owner === 'phase') handoff.push({ ...c, title: item && item.title ? String(item.title) : c.id, command: phaseCommand(cwd, c.phase) });
    else execute.push(c);
  });
  return { execute, handoff };
}

/**
 * `focus route`: stamp each batch item's owner and record the hand-offs in the batch
 * (`results[id] = "routed"`, `routes[id] = {phase, command, reason}`), keeping the
 * file's mtime. `focus open` registers only the items focus executes either way.
 * @param {string} cwd
 * @param {{batch?: string}} opts
 * @returns {Object}
 */
function focusRoute(cwd, opts = {}) {
  const found = resolveBatch(cwd, opts.batch);
  if (found.error) return found;
  const { batch, abs } = found;
  if (batch.error) return { error: 'batch_unusable', reason: batch.error };
  const routed = routeItems(cwd, batch.batch);
  try {
    const owners = new Map([...routed.execute, ...routed.handoff].map((c) => [c.id, c]));
    const w = store.updateRecord(abs, (data) => {
      if (!data) throw Object.assign(new Error('batch file vanished'), { code: 'ENOENT' });
      data[batch.items_key].forEach((item, i) => {
        const owner = owners.get(focusItemId(item, i));
        if (item && typeof item === 'object' && owner) item.owner = owner.owner;
      });
      if (routed.handoff.length) {
        data.results = { ...(data.results || {}) };
        data.routes = { ...(data.routes || {}) };
        for (const h of routed.handoff) {
          data.results[h.id] = 'routed';
          data.routes[h.id] = { phase: h.phase || null, command: h.command, reason: h.reason };
        }
      }
      return data;
    }, { keepMtime: true });
    if (w.error) throw Object.assign(new Error(w.reason || w.error), { code: w.error });
  } catch (e) {
    return { error: 'batch_unwritable', reason: `could not record the routes in ${batch.file}: ${e.code || e.message}` };
  }
  return {
    batch_file: toPosix(path.relative(cwd, abs)),
    execute: routed.execute.map((c) => c.id),
    handoff: routed.handoff.map((h) => ({ id: h.id, title: h.title, phase: h.phase || null, command: h.command, reason: h.reason })),
  };
}

/** A batch by `--batch` (a path, or a name under the focus directory), else the newest. */
function resolveBatch(cwd, ref) {
  if (ref) {
    let abs = path.isAbsolute(ref) ? ref : path.resolve(cwd, ref);
    if (!fs.existsSync(abs)) {
      const inFocus = planningPath(cwd, FOCUS_DIR, ref);
      if (fs.existsSync(inFocus)) abs = inFocus;
      else return { error: 'batch_not_found', reason: `batch file not found: ${ref}` };
    }
    return { batch: readBatchFile(abs), abs };
  }
  const batch = readLatestBatch(cwd);
  if (!batch) return { error: 'no_batch', reason: 'No batch file found. Run focus plan first.' };
  return { batch, abs: planningPath(cwd, FOCUS_DIR, batch.file) };
}

function cmdFocusRoute(cwd, raw, ...args) {
  const r = focusRoute(cwd, { batch: flagValues(args, '--batch')[0] });
  if (r.error) return output(r, raw, r.reason, 1);
  return output(r, raw, `${r.execute.length} execute, ${r.handoff.length} handoff`);
}


const FOCUS_CYCLE_KINDS = ['exec', 'docs'];
const FOCUS_CYCLE_STATUSES = ['verified', 'partial', 'failed'];
const FOCUS_CYCLE_RE = /^(\d+)-focus-(exec|docs)-\d{4}-\d{2}-\d{2}$/;

/**
 * A YAML block list of JSON strings. The frontmatter parser splits an inline `[a, b]`
 * on every comma and keeps a quoted item's escapes, so an id holding a comma or a
 * quote came back as two ids, or as a different one. fmList reads it back.
 */
function fmBlockList(key, values) {
  return values.length ? [`${key}:`, ...values.map((v) => `  - ${JSON.stringify(String(v))}`)] : [`${key}: []`];
}

/** Strip one pair of quotes and read "null" as null: frontmatter scalars come back as strings. */
function fmScalar(v) {
  if (v == null) return null;
  let s = String(v).trim();
  if (s === 'null') return null;
  if (/^".*"$/.test(s)) { try { s = JSON.parse(s); } catch { s = s.slice(1, -1); } } // focusCyclePlan writes JSON strings
  else s = s.replace(/^'(.*)'$/, '$1');
  return s === '' ? null : s;
}
function fmNumber(v) {
  const s = fmScalar(v);
  return s != null && /^-?\d+$/.test(s) ? Number(s) : null;
}
function fmList(v) {
  // The parser has stripped fmBlockList's outer quotes; undo the JSON escapes inside.
  const item = (x) => { const s = String(x); try { return JSON.parse(`"${s}"`); } catch { return s; } };
  if (Array.isArray(v)) return v.map(item).filter((x) => x !== '');
  const s = fmScalar(v);
  return s ? [s] : [];
}

/**
 * The focus cycles under .planning/quick/, oldest first.
 * @param {string} cwd - Project root
 * @returns {Array<{name, num, kind, dir, rel, plan, summary, open}>}
 */
function listFocusCycles(cwd) {
  const quickDir = planningPath(cwd, QUICK_DIR);
  let names;
  try { names = fs.readdirSync(quickDir); } catch { return []; }
  const cycles = [];
  for (const name of names) {
    const m = FOCUS_CYCLE_RE.exec(name);
    if (!m) continue;
    const dir = path.join(quickDir, name);
    let files;
    try { files = fs.readdirSync(dir); } catch { continue; }
    const plan = `${m[1]}-plan.md`;
    const summary = `${m[1]}-summary.md`;
    if (!files.includes(plan)) continue;
    // A /pan:quick slug can take this shape too; only `focus open` writes `source: focus`.
    if (fmScalar(extractFrontmatter(safeReadFile(path.join(dir, plan)) || '').source) !== 'focus') continue;
    cycles.push({
      name, num: Number(m[1]), kind: m[2], dir, rel: planningRel(QUICK_DIR, name),
      plan: path.join(dir, plan), summary: path.join(dir, summary), open: !files.includes(summary),
    });
  }
  return cycles.sort((a, b) => a.num - b.num);
}

/** The open focus cycle, or null. There is at most one: `focus open` refuses a second. */
function openFocusCycle(cwd) {
  return listFocusCycles(cwd).find((c) => c.open) || null;
}

/**
 * The source files a batch's items name, for the plan's files_modified. Pointers into
 * the planning tree (a code-planned item's `file` is its phase directory, todo file
 * or patterns.md) are not files the cycle changes, so they are left out.
 * @param {Array} items - Batch items
 * @returns {string[]}
 */
function focusCycleFiles(items) {
  const root = planningRel();
  const out = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== 'object') continue;
    const named = [].concat(item.file || [], item.files || []);
    for (const f of named) {
      if (typeof f !== 'string' || !f.trim()) continue;
      const p = toPosix(f.trim()).replace(/^\.\//, '');
      if (p === root || p.startsWith(`${root}/`)) continue;
      out.add(p);
    }
  }
  return [...out];
}

/** An item's id, or a positional one for an agent-written entry with none. */
function focusItemId(item, i) {
  if (item && typeof item === 'object' && item.id != null && String(item.id).trim()) return String(item.id).trim();
  return `item-${i + 1}`;
}

/**
 * The plan of a focus cycle, in the lean quick plan's shape (sizing.cjs leanQuickPlan)
 * plus the focus keys `focus close` and `focus auto --update` read back. Pure.
 * @param {Object} o
 * @param {number} o.num - Quick-task number
 * @param {string} o.kind - exec | docs
 * @param {Array} o.items - Batch items
 * @param {string|null} [o.batchFile] - Batch file, relative to the project
 * @param {string|null} [o.runId] - The auto run this cycle belongs to
 * @param {string|null} [o.category] - The run's category, if any
 * @param {{passed: number|null, command: string|null, status: string}|null} [o.tests] - Measured at open
 * @param {string} [o.openedAt] - ISO timestamp
 * @returns {string}
 */
function focusCyclePlan(o) {
  const items = Array.isArray(o.items) ? o.items : [];
  const ids = Array.isArray(o.ids) && o.ids.length === items.length ? o.ids : items.map(focusItemId);
  const files = focusCycleFiles(items);
  const tests = o.tests || null;
  const verify = (tests && tests.command) || 'the project\'s tests';
  const esc = (t) => String(t == null ? '' : t).replace(/</g, '&lt;').replace(/\r?\n+/g, ' ');
  const q = (v) => (v == null ? 'null' : JSON.stringify(String(v)));
  const label = o.category ? `${o.kind}, ${o.category}` : o.kind;
  const objective = items.length
    ? `Focus cycle ${o.num} (${label}): work the ${items.length} item(s) of ${o.batchFile || 'the batch'}. Each item ends done with its tests passing, or reverted and reported failed.`
    : `Focus cycle ${o.num} (${label}): the edits of one focus-docs run.`;
  const lines = [
    '---', 'phase: quick', `plan: ${String(o.num).padStart(2, '0')}`, 'type: execute', 'wave: 1', 'depends_on: []',
    ...fmBlockList('files_modified', files), 'autonomous: true', 'tier: micro',
    'source: focus', `focus_kind: ${o.kind}`, `batch_file: ${q(o.batchFile)}`, `run_id: ${q(o.runId)}`,
    `category: ${q(o.category)}`, ...fmBlockList('items', ids),
    `tests_before: ${tests && tests.passed != null ? tests.passed : 'null'}`, `test_command: ${q(tests && tests.command)}`,
    `opened_at: ${o.openedAt || new Date().toISOString()}`,
    'must_haves:', '  truths:', '    - "Every item reported done passes its tests; every other item is reverted and reported failed with a reason"',
    '---', '', '<objective>', esc(objective), '',
    'Registered by `focus open` so state.md, resume and the guard see this cycle as work in flight. `focus close` ends it.', '</objective>', '',
    '<tasks>', '',
  ];
  items.forEach((item, i) => {
    const it = item && typeof item === 'object' ? item : { title: String(item) };
    const itemFiles = focusCycleFiles([it]);
    lines.push(
      '<task type="auto">', `  <name>${esc(ids[i])}: ${esc(it.title || it.description || ids[i]).slice(0, 120)}</name>`,
      `  <files>${itemFiles.join(', ') || 'the files the item names'}</files>`,
      `  <action>${esc(it.fix || it.title || it.description || 'Do what the item says; do not widen it.')}</action>`,
      `  <verify>${esc(verify)}</verify>`, '  <done>The item\'s fix holds and the tests pass; otherwise it is reverted and reported failed.</done>', '</task>', '',
    );
  });
  if (!items.length) {
    lines.push('<task type="auto">', '  <name>Documentation edits</name>', '  <files>the documents the run names</files>',
      '  <action>Edit only the documents the run reported; never source code.</action>', '  <verify>the run\'s own checks</verify>',
      '  <done>The edits are committed.</done>', '</task>', '');
  }
  lines.push('</tasks>', '');
  return lines.join('\n');
}

/**
 * Run the project's test command once (test-gate.cjs). Open keeps the record as the
 * cycle's baseline; close runs against it, so a test already failing at open is
 * pre-existing and only a new failure is a regression. `passed` is null when there is
 * no test command or the output gave no count.
 * @param {string} cwd
 * @param {Object|null} [baseline] - the record `focus open` wrote
 * @returns {Object} the test-gate record
 */
function measureTests(cwd, baseline) {
  return require('./test-gate.cjs').runTests(cwd, { kind: baseline ? 'run' : 'baseline', baseline: baseline || null });
}

const STATUS_RANK = { failed: 0, partial: 1, verified: 2 };

/**
 * The status a cycle's measurements support. Pure. A docs cycle measures nothing, so
 * it derives no status and the agent's claim stands.
 * @param {{kind: string, items: string[], done: string[], tests_before: number|null, tests_after: number|null,
 *   run: Object|null, regressions: number}} o - run is the close's test record; regressions
 *   counts only failures that were passing at the cycle's baseline
 * @returns {{status: string|null, reasons: string[]}}
 */
function deriveCycleStatus(o) {
  if (o.kind !== 'exec') return { status: null, reasons: [] };
  const items = o.items || [];
  const done = o.done || [];
  let status = 'verified';
  const reasons = [];
  const lower = (to, why) => { if (STATUS_RANK[to] < STATUS_RANK[status]) status = to; reasons.push(why); };
  if (items.length && !done.length) lower('failed', 'no item done');
  if (o.regressions > 0) lower('failed', `${o.regressions} regression(s): failing now, passing when the cycle opened`);
  if (o.tests_before != null && o.tests_after != null && o.tests_after < o.tests_before) lower('failed', `fewer tests pass (${o.tests_before} before, ${o.tests_after} after)`);
  if (o.tests_before == null || o.tests_after == null) lower('partial', 'no measured test count');
  else if (o.run && o.run.status !== 'passed' && !(o.regressions > 0)) lower('partial', `the test run ${o.run.status}${o.run.reason ? `: ${o.run.reason}` : ''}`);
  if (done.length && done.length < items.length) lower('partial', 'not every item done');
  return { status, reasons };
}

/** The auto run a new cycle belongs to: the current one, while it is live. */
function liveRunId(cwd) {
  const run = readAutoRun(cwd);
  if (!run || !run.run_id) return null;
  return run.status === AUTORUN_STATUSES.IN_PROGRESS || run.status === AUTORUN_STATUSES.INITIALIZED ? run.run_id : null;
}

/**
 * `focus open`: register a focus cycle as a quick task before its first edit.
 * @param {string} cwd
 * @param {{batch?: string, kind?: string, run?: string, measure?: Function, now?: Date}} opts
 * @returns {Object} `{opened, dir, plan, num, items, files_modified, tests_before, ...}` or `{error, reason}`
 */
function focusOpen(cwd, opts = {}) {
  const kind = opts.kind || 'exec';
  if (!FOCUS_CYCLE_KINDS.includes(kind)) return { error: 'invalid_kind', reason: `--kind must be one of: ${FOCUS_CYCLE_KINDS.join(', ')}` };
  const open = openFocusCycle(cwd);
  if (open) return { error: 'cycle_open', reason: `focus cycle ${open.rel} is still open: close it with \`focus close --dir ${open.rel} --status ...\` first`, dir: open.rel };

  let batch = null;
  let batchAbs = null;
  if (opts.batch || kind === 'exec') {
    const found = resolveBatch(cwd, opts.batch);
    if (found.error) return found;
    batch = found.batch;
    batchAbs = found.abs;
  }
  if (batch && batch.error) return { error: 'batch_unusable', reason: batch.error };
  if (kind === 'exec' && batch.batch.length === 0) return { error: 'batch_empty', reason: `${batch.file} has no items` };

  // The cycle registers only the items focus owns: phase work is handed off (D1),
  // whether or not the prompt ran `focus route` first.
  const routed = batch ? routeItems(cwd, batch.batch) : { execute: [], handoff: [] };
  const handedOff = new Set(routed.handoff.map((h) => h.id));
  const items = batch ? batch.batch.filter((it, i) => !handedOff.has(focusItemId(it, i))) : [];
  const ids = batch ? batch.batch.map(focusItemId).filter((id) => !handedOff.has(id)) : [];
  const handoff = routed.handoff.map((h) => ({ id: h.id, phase: h.phase || null, command: h.command }));
  if (kind === 'exec' && items.length === 0) {
    return { error: 'all_routed', reason: `every item of ${batch.file} belongs to the phase system: ${handoff.map((h) => `${h.id} → ${h.command}`).join(', ')}`, handoff };
  }
  const batchFile = batchAbs ? toPosix(path.relative(cwd, batchAbs)) : null;
  const runId = opts.run || liveRunId(cwd);
  const run = runId ? readAutoRun(cwd) : null;
  const category = run && run.run_id === runId ? (run.category || run.source || null) : (batch && batch.mode ? `mode ${batch.mode}` : null);
  // A docs cycle edits documents only; the suite says nothing about it.
  const tests = kind === 'exec' ? (opts.measure || measureTests)(cwd) : null;

  const now = opts.now || new Date();
  const date = now.toISOString().slice(0, 10);
  // The number is claimed under the quick directory's lock, so two cycles (or a
  // cycle and a quick task) opened at once never share one.
  const reserved = store.reserveDir(planningPath(cwd, QUICK_DIR), (n) => `${n}-focus-${kind}-${date}`, () => nextQuickNum(cwd));
  if (reserved.error) {
    return { error: 'mkdir_failed', reason: `could not create a cycle directory in ${planningRel(QUICK_DIR)}: ${reserved.reason}` };
  }
  const num = reserved.n;
  const name = path.basename(reserved.dir);
  const dir = reserved.dir;
  const planText = focusCyclePlan({ num, kind, items, ids, batchFile, runId, category, tests, openedAt: now.toISOString() });
  const planPath = path.join(dir, `${num}-plan.md`);
  fs.writeFileSync(planPath, planText, 'utf-8');
  if (tests && tests.command) fs.writeFileSync(path.join(dir, `${num}-test-baseline.json`), JSON.stringify(tests, null, 2), 'utf-8');
  // The run records this cycle by name at --update, never by searching for one.
  // Written against the run as it is on disk now, not as it was read before the
  // tests ran: a --stop in between is kept.
  if (run && run.run_id === runId) {
    store.updateRecord(planningPath(cwd, FOCUS_DIR, AUTO_RUN_FILE), (cur) => (cur && cur.run_id === runId ? { ...cur, current_cycle: planningRel(QUICK_DIR, name) } : null));
  }
  return {
    opened: true, num, kind, dir: planningRel(QUICK_DIR, name), plan: toPosix(path.relative(cwd, planPath)),
    batch_file: batchFile, run_id: runId, items: ids, handoff, files_modified: focusCycleFiles(items),
    tests_before: tests ? tests.passed : null, test_status: tests ? tests.status : null, test_command: tests ? tests.command : null,
  };
}

/** Find a cycle by `--dir`: its path, its directory name, or its number. */
function findFocusCycle(cwd, ref) {
  const want = toPosix(String(ref || '').trim()).replace(/\/+$/, '');
  if (!want) return null;
  const base = want.split('/').pop();
  return listFocusCycles(cwd).find((c) => c.rel === want || c.name === base || String(c.num) === base) || null;
}

/** A bare file name: an item id becomes one, and `todo-../x` must not reach outside todos/. */
function isTodoName(f) {
  return typeof f === 'string' && f !== '' && f !== '.' && f !== '..' && !/[\\/]/.test(f);
}

/** `--failed "a=why,b=why"` (repeatable) into {id: reason}; a comma splits only before another `id=`. */
function parseFailed(values) {
  const out = Object.create(null);
  for (const v of [].concat(values || [])) {
    for (const part of String(v).split(/,(?=\s*[^,=\s]+=)/)) {
      const at = part.indexOf('=');
      const id = (at === -1 ? part : part.slice(0, at)).trim();
      if (id) out[id] = at === -1 ? 'no reason given' : (part.slice(at + 1).trim() || 'no reason given');
    }
  }
  return out;
}

/** `--done a,b` or `--done "a, b"` (repeatable) into ids. */
function parseDone(values) {
  return [...new Set([].concat(values || []).flatMap((v) => String(v).split(/[,\s]+/)).filter(Boolean))];
}

/** Read a cycle's plan frontmatter into the keys close and --update use. */
function readCyclePlan(cycle) {
  const fm = extractFrontmatter(safeReadFile(cycle.plan) || '');
  return {
    source: fmScalar(fm.source), kind: fmScalar(fm.focus_kind) || cycle.kind, batch_file: fmScalar(fm.batch_file),
    run_id: fmScalar(fm.run_id), category: fmScalar(fm.category), items: fmList(fm.items),
    tests_before: fmNumber(fm.tests_before), test_command: fmScalar(fm.test_command), opened_at: fmScalar(fm.opened_at),
  };
}

/** Read a closed cycle's summary frontmatter. */
function readCycleSummary(cycle) {
  const fm = extractFrontmatter(safeReadFile(cycle.summary) || '');
  return {
    status: fmScalar(fm.status), commit: fmScalar(fm.commit), items_done: fmList(fm.items_done), items_failed: fmList(fm.items_failed),
    tests_before: fmNumber(fm.tests_before), tests_after: fmNumber(fm.tests_after), run_id: fmScalar(fm.run_id), batch_file: fmScalar(fm.batch_file),
    regressions: fmNumber(fm.regressions) || 0,
  };
}

/** A commit the close may record: a real commit reachable from HEAD, by its short sha. */
function verifyCommit(cwd, sha) {
  if (!/^[0-9a-f]{4,40}$/i.test(String(sha))) return null;
  if (execGit(cwd, ['cat-file', '-e', `${sha}^{commit}`]).exitCode !== 0) return null;
  if (execGit(cwd, ['merge-base', '--is-ancestor', sha, 'HEAD']).exitCode !== 0) return null;
  const r = execGit(cwd, ['rev-parse', '--short', sha]);
  return r.exitCode === 0 ? r.stdout.trim() : null;
}

/**
 * `focus close`: end a focus cycle. Measures the tests against the cycle's baseline and
 * derives the status from them, commits the cycle's source (`--files`) or verifies the
 * commit the agent made (`--commit`), records each item's result in the batch file,
 * completes the todos it finished, adds the cycle to state.md's Quick Tasks table,
 * writes the summary, and commits that record under the planning rules.
 * @param {string} cwd
 * @param {{dir: string, status?: string, commit?: string, files?: string[], done?: string[], failed?: Object,
 *   measure?: Function|false, now?: Date}} opts
 * @returns {Object}
 */
function focusClose(cwd, opts = {}) {
  if (opts.status != null && !FOCUS_CYCLE_STATUSES.includes(opts.status)) return { error: 'invalid_status', reason: `--status must be one of: ${FOCUS_CYCLE_STATUSES.join(', ')}` };
  const cycle = findFocusCycle(cwd, opts.dir);
  if (!cycle) return { error: 'not_a_focus_cycle', reason: `no focus cycle matches --dir ${opts.dir || '(missing)'}: expected ${planningRel(QUICK_DIR)}/<n>-focus-<kind>-<date>` };
  if (!cycle.open) return { error: 'cycle_closed', reason: `${cycle.rel} is already closed` };
  const plan = readCyclePlan(cycle);
  if (plan.source !== 'focus') return { error: 'not_a_focus_cycle', reason: `${cycle.rel} has no \`source: focus\` plan` };
  if (opts.status == null && plan.kind !== 'exec') return { error: 'invalid_status', reason: 'a docs cycle measures nothing: pass --status verified|partial|failed' };

  const done = opts.done || [];
  // Own keys only: `id in failed` matched an item named `constructor` or `toString`.
  const failed = Object.assign(Object.create(null), opts.failed || {});
  const both = done.filter((id) => id in failed);
  if (both.length) return { error: 'conflicting_items', reason: `reported both done and failed: ${both.join(', ')}` };
  if (plan.items.length) {
    const known = new Set(plan.items);
    const unknown = [...done, ...Object.keys(failed)].filter((id) => !known.has(id));
    if (unknown.length) return { error: 'unknown_items', reason: `not items of ${cycle.rel}: ${unknown.join(', ')}` };
  }
  const notReported = plan.items.filter((id) => !done.includes(id) && !(id in failed));

  const files = (opts.files || []).filter(Boolean);
  if (files.length && opts.commit) return { error: 'commit_conflict', reason: 'pass --files (close commits them) or --commit <sha> (a commit you made), not both' };
  if (files.length && plan.items.length && !done.length) return { error: 'nothing_done', reason: 'no item is done, so there is nothing to commit: revert the changes and close without --files' };
  let commit = null;
  if (opts.commit) {
    commit = verifyCommit(cwd, opts.commit);
    if (!commit) return { error: 'commit_unknown', reason: `--commit ${opts.commit} is not a commit reachable from HEAD` };
  }

  // Tests against the baseline `focus open` kept. Without one (a cycle opened before the
  // record existed), a failing test cannot be told from a regression, so it only caps.
  const baselinePath = path.join(cycle.dir, `${cycle.num}-test-baseline.json`);
  let baseline = null;
  try { baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf-8')); } catch { /* none kept */ }
  const tests = plan.kind === 'exec' && opts.measure !== false ? (opts.measure || measureTests)(cwd, baseline) : null;
  const testsAfter = tests && tests.passed != null ? tests.passed : null;
  const compared = !!(baseline && tests && baseline.command === tests.command && baseline.parsed !== false);
  const regressions = compared && Array.isArray(tests.regressions) ? tests.regressions.length : 0;
  const preexisting = compared && Array.isArray(tests.preexisting_failures) ? tests.preexisting_failures.length : 0;

  // The engine derives the status; the agent's claim can only lower it.
  const derived = deriveCycleStatus({ kind: plan.kind, items: plan.items, done, tests_before: plan.tests_before, tests_after: testsAfter, run: tests, regressions });
  let status = derived.status || opts.status;
  if (opts.status && STATUS_RANK[opts.status] < STATUS_RANK[status]) status = opts.status;

  // The cycle's source commit, before anything is written: a refused commit leaves the
  // cycle open with nothing recorded. A regression is never committed.
  let commitSkipped = null;
  if (files.length) {
    if (regressions > 0) commitSkipped = 'regression: revert the cycle\'s changes';
    else {
      const message = plan.kind === 'exec'
        ? `fix(focus-${cycle.num}): ${done.length > 4 ? `${done.slice(0, 4).join(', ')} and ${done.length - 4} more` : done.join(', ')}`
        : `docs(focus-${cycle.num}): documentation edits`;
      const c = require('./git.cjs').commitPaths(cwd, { message, files, unstageOnBlock: true });
      if (c.committed) commit = c.hash;
      else if (c.reason === 'nothing_to_commit') commitSkipped = 'nothing to commit';
      else return { error: c.error === 'commit_blocked' ? 'commit_blocked' : (c.error === 'not_a_git_repo' ? 'not_a_git_repo' : 'commit_failed'), reason: c.reason || c.error, hint: c.hint, safety_checks: c.safety_checks, dir: cycle.rel };
    }
  }

  const now = opts.now || new Date();
  const date = now.toISOString().slice(0, 10);
  const failedIds = Object.keys(failed);
  const q = (v) => (v == null ? 'null' : JSON.stringify(String(v)));
  const cell = (t) => String(t).replace(/\|/g, '\\|').replace(/\r?\n+/g, ' ');
  const summary = [
    '---', 'phase: quick', `plan: ${String(cycle.num).padStart(2, '0')}`, 'source: focus', `focus_kind: ${plan.kind}`,
    `status: ${status}`, `reported_status: ${opts.status || 'null'}`, `commit: ${q(commit)}`, `run_id: ${q(plan.run_id)}`, `batch_file: ${q(plan.batch_file)}`,
    ...fmBlockList('items_done', done), ...fmBlockList('items_failed', failedIds), ...fmBlockList('items_not_reported', notReported),
    `tests_before: ${plan.tests_before == null ? 'null' : plan.tests_before}`, `tests_after: ${testsAfter == null ? 'null' : testsAfter}`,
    `regressions: ${regressions}`, `preexisting_failures: ${preexisting}`,
    `closed_at: ${now.toISOString()}`, '---', '',
    `# Focus cycle ${cycle.num} (${plan.kind}): ${status}`, '',
    ...(derived.reasons.length ? [`Derived from the measurements: ${derived.reasons.join('; ')}.`, ''] : []),
    '| Item | Result | Reason |', '|------|--------|--------|',
    ...done.map((id) => `| ${cell(id)} | done | |`),
    ...failedIds.map((id) => `| ${cell(id)} | failed | ${cell(failed[id])} |`),
    ...notReported.map((id) => `| ${cell(id)} | not reported | |`),
    '',
    plan.kind === 'exec'
      ? `Tests (measured by \`focus open\` and \`focus close\`): ${plan.tests_before == null ? 'none' : plan.tests_before} passing before, ${testsAfter == null ? 'none' : testsAfter} after${plan.test_command ? ` (\`${plan.test_command}\`)` : ''}; ${regressions} regression(s), ${preexisting} failure(s) already failing at open.`
      : 'Tests: not run for a docs cycle.',
    `Commit: ${commit || (commitSkipped ? `none (${commitSkipped})` : 'none')}.`, '',
  ].join('\n');
  if (tests) fs.writeFileSync(path.join(cycle.dir, `${cycle.num}-test-run.json`), JSON.stringify(tests, null, 2), 'utf-8');

  // The summary is written last: it is what marks the cycle closed, so a close that
  // fails on the way leaves the cycle open and can be run again. Every step before it
  // is safe to repeat.

  // The batch keeps its scan-time `status` per item; results go under their own key.
  let batchResults = null;
  if (plan.batch_file) {
    const abs = path.resolve(cwd, plan.batch_file);
    try {
      // Keep the mtime: listBatchFiles orders same-day batches by it, and a rewrite
      // made this finished batch the newest, so the next run picked it again.
      const w = store.updateRecord(abs, (data) => {
        if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
        data.results = { ...(data.results || {}) };
        for (const id of done) data.results[id] = 'done';
        for (const id of failedIds) data.results[id] = 'failed';
        if (failedIds.length) data.result_reasons = { ...(data.result_reasons || {}), ...failed };
        return data;
      }, { keepMtime: true });
      if (w.error) throw Object.assign(new Error(w.error), { code: w.error });
      if (w.written) batchResults = 'written';
    } catch (e) {
      batchResults = `skipped: ${e.code || 'not valid JSON'}`;
    }
  }

  // Todos the cycle finished leave the pending list.
  const todos = [];
  if (done.length && plan.batch_file) {
    const batch = readBatchFile(path.resolve(cwd, plan.batch_file));
    const byId = new Map((batch.batch || []).map((it, i) => [focusItemId(it, i), it]));
    const { completeTodo } = require('./commands.cjs');
    for (const id of done) {
      const it = byId.get(id);
      const isTodo = (it && it.source === 'todo') || /^todo-/.test(id);
      if (!isTodo) continue;
      const file = it && typeof it.file === 'string' && /todos\/pending\//.test(toPosix(it.file)) ? path.basename(it.file) : id.replace(/^todo-/, '');
      if (!isTodoName(file)) { todos.push({ file, error: 'not a todo file name' }); continue; }
      const r = completeTodo(cwd, file);
      // A close run again after a failed one finds the todo already moved.
      const moved = r.error && isTodoName(file) && fs.existsSync(planningPath(cwd, 'todos', 'completed', file));
      todos.push(r.error && !moved ? { file, error: r.error } : { file, completed: true });
    }
  }

  // state.md: one Quick Tasks row per cycle, and Last Activity. A project with no
  // state.md closes anyway; any other failure leaves the cycle open to retry.
  const total = plan.items.length;
  const label = plan.category || plan.kind;
  const description = total ? `focus: ${label} — ${done.length} of ${total} items` : `focus: ${label} — docs edits`;
  const sw = require('./state-write.cjs');
  const row = sw.stateQuickTask(cwd, { description, commit: commit || '', status, date, directory: `[${cycle.name}](./${QUICK_DIR}/${cycle.name}/)` });
  if (row.error && row.error !== 'state_missing') {
    return { error: 'state_failed', reason: `state.md was not updated (${row.reason || row.error}); ${cycle.rel} stays open: run focus close again`, dir: cycle.rel };
  }
  let stateWarnings;
  if (!row.error) {
    const a = sw.stateApply(cwd, { fields: { 'Last Activity': date, 'Last Activity Description': `Closed focus cycle ${cycle.num}: ${description}` } });
    if (a.error) stateWarnings = [a.reason || a.error];
    else if (a.failed && a.failed.length) stateWarnings = a.failed.map((f) => `state.md has no "${f}" field`);
  }

  fs.writeFileSync(cycle.summary, summary, 'utf-8');

  // The cycle's record goes in under the planning rules (skipped under commit_docs:
  // false or a gitignored planning tree). Both sides of each todo move go with it, so
  // no deletion is left in the tree for the next commit to trip on.
  const moved = todos.filter((t) => t.completed).flatMap((t) => [planningRel('todos', 'completed', t.file), planningRel('todos', 'pending', t.file)]);
  const recordFiles = [`${cycle.rel}/`, planningRel('state.md'), ...moved];
  if (plan.batch_file && (plan.batch_file === planningRel() || plan.batch_file.startsWith(`${planningRel()}/`))) recordFiles.push(plan.batch_file);
  const rc = require('./commands.cjs').commitPlanning(cwd, {
    message: `docs(focus-${cycle.num}): close focus cycle ${cycle.num} (${status})`, files: recordFiles, force: moved.length > 0,
  });

  return {
    closed: true, dir: cycle.rel, summary: toPosix(path.relative(cwd, cycle.summary)), status, reported_status: opts.status || null,
    derived_status: derived.status, derived_from: derived.reasons.length ? derived.reasons : undefined,
    commit, commit_skipped: commitSkipped || undefined,
    items_done: done, items_failed: failedIds, items_not_reported: notReported,
    tests_before: plan.tests_before, tests_after: testsAfter, regressions, preexisting_failures: preexisting,
    batch_results: batchResults, todos_completed: todos,
    state: row.error ? row.error : 'recorded', state_row: row.row || null, state_warnings: stateWarnings,
    record_commit: rc.committed ? rc.hash : rc.reason,
  };
}

/**
 * The cycle `focus auto --update` records: the one `focus open` named in the run's
 * `current_cycle`. Never a search: a skipped update must not hand an older cycle's
 * counts to a later one.
 * @param {string} cwd
 * @param {Object} run - auto-run.json
 * @returns {{open: string}|Object|null} `{open}` while it is still open, else the summary's facts plus `rel`
 */
function runCurrentCycle(cwd, run) {
  if (!run || !run.current_cycle) return null;
  const c = findFocusCycle(cwd, run.current_cycle);
  if (!c) return null;
  if (c.open) return { open: c.rel };
  return { ...readCycleSummary(c), rel: c.rel };
}

/** Closed cycles of this run that no update recorded (a crash between close and --update). */
function unrecordedCycles(cwd, run) {
  if (!run || !run.run_id) return [];
  const recorded = new Set((run.cycles || []).map((c) => c.cycle_dir).filter(Boolean));
  return listFocusCycles(cwd)
    .filter((c) => !c.open && !recorded.has(c.rel) && c.rel !== run.current_cycle && readCycleSummary(c).run_id === run.run_id)
    .map((c) => c.rel);
}

/**
 * Every value after each `flag`, up to the next `--` token: `--done a b` is two ids,
 * and `--commit --done a` gives `--commit` no value rather than the value `--done`.
 */
function flagValues(args, flag) {
  const out = [];
  args.forEach((a, i) => {
    if (a !== flag) return;
    for (let j = i + 1; j < args.length && !String(args[j]).startsWith('--'); j++) out.push(args[j]);
  });
  return out;
}

function cmdFocusOpen(cwd, raw, ...args) {
  const getVal = (flag) => flagValues(args, flag)[0];
  const r = focusOpen(cwd, { batch: getVal('--batch'), kind: getVal('--kind'), run: getVal('--run') });
  if (r.error) return output(r, raw, r.reason, 1);
  return output(r, raw, r.dir);
}

function cmdFocusClose(cwd, raw, ...args) {
  const all = (flag) => flagValues(args, flag);
  const getVal = (flag) => all(flag)[0];
  const r = focusClose(cwd, {
    dir: getVal('--dir'), status: getVal('--status'), commit: getVal('--commit'), files: all('--files'),
    // An unquoted reason arrives as several words: each joins the `id=` before it.
    done: parseDone(all('--done')),
    failed: parseFailed(all('--failed').reduce((acc, w) => {
      if (/^[^\s=]+=/.test(w) || !acc.length) acc.push(w); else acc[acc.length - 1] += ` ${w}`;
      return acc;
    }, [])),
  });
  if (r.error) return output(r, raw, r.reason, 1);
  return output(r, raw, r.status);
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
  const filePath = planningPath(cwd, FOCUS_DIR, AUTO_RUN_FILE);
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
  try {
    return Boolean(store.updateRecord(planningPath(cwd, FOCUS_DIR, AUTO_RUN_FILE), () => data).ok);
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
/**
 * Advisory budget indicators for a run: raw remaining, the verify reserve, the
 * remaining budget for NEW work (excludes the reserve), and whether spend has
 * crossed into the reserved headroom. Pure — no behavior change; surfaced so the
 * human/HUD can see the reserve even when it isn't being enforced.
 */
function budgetIndicators(run) {
  const used = run.totals ? run.totals.points_used : 0;
  const reserve = run.verify_reserve || 0;
  return {
    budget_remaining: run.total_budget - used,
    verify_reserve: reserve,
    new_work_budget_remaining: run.total_budget - reserve - used,
    into_verify_reserve: reserve > 0 && used >= run.total_budget - reserve,
  };
}

// ─── Where focus stands, for the rest of PAN (spec D5, D9) ──────────────────

/** Hours without a recorded cycle after which a live run is stale: `focus.stale_hours`, default 12. */
const FOCUS_STALE_HOURS = 12;

function staleHours(cwd) {
  const h = Number((((loadConfig(cwd) || {}).focus) || {}).stale_hours);
  return Number.isFinite(h) && h > 0 ? h : FOCUS_STALE_HOURS;
}

/** The newest thing a run recorded: its last cycle, else its start. */
function runLastAt(run) {
  const cycles = (run && run.cycles) || [];
  return (cycles.length && cycles[cycles.length - 1].timestamp) || (run && run.started_at) || null;
}

/**
 * A run that says it is live but has recorded nothing for `hours`: its session ended
 * without --stop. Pure.
 */
function isRunStale(run, hours, now = Date.now()) {
  if (!run || (run.status !== AUTORUN_STATUSES.IN_PROGRESS && run.status !== AUTORUN_STATUSES.INITIALIZED)) return false;
  const t = Date.parse(runLastAt(run) || '');
  return Number.isFinite(t) && now - t > hours * 3600000;
}

/**
 * Where focus stands: the auto run, the open cycle, and whether either is active work
 * that autodev must not run beside. Read by next-action, the HUD, hygiene and autodev.
 * @param {string} cwd
 * @param {number} [now]
 * @returns {{run: Object|null, open_cycle: Object|null, stale_hours: number, active: boolean}}
 */
function focusActivity(cwd, now = Date.now()) {
  const hours = staleHours(cwd);
  const run = readAutoRun(cwd);
  const live = !!run && (run.status === AUTORUN_STATUSES.IN_PROGRESS || run.status === AUTORUN_STATUSES.INITIALIZED);
  const stale = isRunStale(run, hours, now);
  const cycle = openFocusCycle(cwd);
  let openCycle = null;
  if (cycle) {
    const p = readCyclePlan(cycle);
    openCycle = { dir: cycle.rel, kind: p.kind, run_id: p.run_id, opened_at: p.opened_at };
  }
  return {
    run: run && run.run_id ? {
      id: run.run_id, status: run.status, category: run.category || run.source || null, stale, last_at: runLastAt(run),
      cycles_completed: run.totals ? run.totals.cycles_completed : 0, items_completed: run.totals ? run.totals.items_completed : 0,
      current_cycle: run.current_cycle || null,
    } : null,
    open_cycle: openCycle,
    stale_hours: hours,
    active: !!openCycle || (live && !stale),
  };
}

/**
 * The step focus asks for before any phase work, or null. Pure over focusActivity.
 * An open cycle comes first: the run that owns it is still working (wait), is stale
 * (stop it, which closes the cycle), or is gone (close the cycle). A stale run with no
 * cycle open comes next.
 */
function focusNextStep(fa) {
  if (!fa) return null;
  const run = fa.run;
  const owned = fa.open_cycle && run && fa.open_cycle.run_id === run.id;
  const liveRun = run && (run.status === AUTORUN_STATUSES.IN_PROGRESS || run.status === AUTORUN_STATUSES.INITIALIZED);
  if (fa.open_cycle) {
    if (owned && liveRun && !run.stale) return { action: 'focus', reason: 'focus_cycle_in_progress', command: 'pan-tools focus auto --status', detail: `focus run ${run.id} is working cycle ${fa.open_cycle.dir}` };
    if (owned && liveRun && run.stale) return { action: 'focus', reason: 'focus_run_stale', command: 'pan-tools focus auto --stop', detail: `focus run ${run.id} recorded nothing for ${fa.stale_hours}h with cycle ${fa.open_cycle.dir} open: stop it (which closes the cycle), then /pan:focus-auto --continue` };
    return { action: 'focus', reason: 'focus_cycle_open', command: `pan-tools focus close --dir ${fa.open_cycle.dir} --status failed`, detail: `focus cycle ${fa.open_cycle.dir} was left open: revert or commit its edits, then close it` };
  }
  if (run && run.stale) return { action: 'focus', reason: 'focus_run_stale', command: 'pan-tools focus auto --stop', detail: `focus run ${run.id} recorded nothing for ${fa.stale_hours}h: stop it, then /pan:focus-auto --continue` };
  return null;
}

/** Autodev and a focus run never run side by side: a refusal naming the other run, or null. */
function autodevRefusal(cwd) {
  const a = require('./autodev.cjs').autodevActivity(cwd, staleHours(cwd));
  if (!a || !a.active) return null;
  return { error: 'autodev_active', reason: `autodev run ${a.run} is active (last recorded ${a.last_at || 'unknown'}): let it stop, or check it with \`pan-tools autodev status\`; a run with nothing recorded for ${staleHours(cwd)}h no longer blocks`, run: a.run };
}

function focusAutoStatus(cwd, raw) {
  const run = readAutoRun(cwd);
  if (!run) return error('No auto-run found. Start with: focus auto --category <name>');
  const cyclesRemaining = run.max_cycles - (run.totals ? run.totals.cycles_completed : 0);
  const hours = staleHours(cwd);
  return output({ ...run, ...budgetIndicators(run), cycles_remaining: cyclesRemaining, unrecorded_cycles: unrecordedCycles(cwd, run), stale: isRunStale(run, hours), stale_hours: hours }, raw);
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
  // A cycle left open would keep counting as work in flight; stopping ends it as failed,
  // with no test run (the run is being abandoned, not verified).
  const current = runCurrentCycle(cwd, run);
  const open = current && current.open ? { rel: current.open } : null;
  const closed = open ? focusClose(cwd, { dir: open.rel, status: 'failed', measure: false }) : null;
  return output({
    run_id: run.run_id, status: AUTORUN_STATUSES.STOPPED, stop_reason: 'user_stop',
    cycles_completed: run.totals ? run.totals.cycles_completed : 0,
    total_items_completed: run.totals ? run.totals.items_completed : 0,
    closed_cycle: closed ? (closed.error ? { dir: open.rel, error: closed.reason } : closed.dir) : null,
  }, raw);
}

// Anti-fake (ADR-0036 review): the regression breaker compares tests_after vs
// tests_before, both historically agent-supplied CLI args that focus-auto never
// re-ran — so a fabricated "tests green" passed unchecked. When verification is
// enabled (config.focus.verify_tests), re-run the node:test suite and use the
// REAL pass count; otherwise keep the supplied value but mark the cycle
// tests_verified:false so the loop's trust is visible to the HUD/audit/human.
//
// Invocation is a fixed execFile('node', ['--test']) — NO shell and NO
// configurable command string, so there is no command-injection surface (same
// safe pattern verify.cjs uses). If no node:test suite is present, fall back to
// the supplied value rather than mis-firing the regression breaker.
function verifyTestCount(cwd, config, fallback) {
  const focusCfg = (config && config.focus) || {};
  if (!focusCfg.verify_tests) return { tests_after: fallback, verified: false };
  const { execFileSync } = require('child_process');
  const num = (out, re) => { const m = String(out || '').match(re); return m ? Number(m[1]) : null; };
  const interpret = (out, exitCode) => {
    // node --test summary lines use either the TAP marker ("# tests N") or the
    // spec reporter's info marker ("ℹ tests N"), depending on Node version /
    // reporter — match both so the count is captured regardless.
    const total = num(out, /[#ℹ]\s*tests\s+(\d+)/);
    if (!total) return { tests_after: fallback, verified: false }; // no node:test suite here
    const passed = num(out, /[#ℹ]\s*pass\s+(\d+)/);
    return { tests_after: passed !== null ? passed : (exitCode === 0 ? fallback : 0), verified: true, exit_code: exitCode };
  };
  // Strip any NODE_TEST_* context so the child runs as a standalone runner with
  // predictable spec/TAP output — otherwise, when focus-auto is itself invoked
  // from within a `node --test` process, the child inherits the nested-test
  // context and emits a serialized format we can't parse.
  const env = { ...process.env };
  for (const k of Object.keys(env)) { if (k.startsWith('NODE_TEST')) delete env[k]; }
  try {
    const out = execFileSync('node', ['--test'], { cwd, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8', env });
    return interpret(out, 0);
  } catch (err) {
    return interpret(err && err.stdout, (err && err.status) || 1);
  }
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

  // M18: wire --prompts-remaining so the `prompts_complete` stop reason is
  // reachable (focus-auto.md step 8 instructs recording it). Absent → null, so
  // determineStopReason's `prompts_remaining === 0` check never fires spuriously
  // for non-prompts categories or when the flag isn't supplied.
  const promptsRemainingRaw = getVal('--prompts-remaining', null);
  cycle.prompts_remaining = promptsRemainingRaw != null ? Number(promptsRemainingRaw) : null;

  // The cycle `focus close` recorded is the source of truth: its item results, and
  // the test counts `focus open` and `focus close` measured. The flags stand only for
  // a cycle that was not registered (an older prompt, or nothing to execute).
  const closed = runCurrentCycle(cwd, run);
  if (closed && closed.open) return error(`focus cycle ${closed.open} is still open: close it with \`focus close --dir ${closed.open}\` before --update`);
  let measured = false;
  if (closed) {
    delete run.current_cycle;
    cycle.cycle_dir = closed.rel;
    cycle.status = closed.status;
    cycle.regressions = closed.regressions;
    cycle.items_completed = closed.items_done.length;
    cycle.items_failed = closed.items_failed.length;
    if (!cycle.batch_file && closed.batch_file) cycle.batch_file = closed.batch_file;
    if (closed.tests_before != null && closed.tests_after != null) {
      cycle.tests_before = closed.tests_before;
      cycle.tests_after = closed.tests_after;
      measured = true;
    }
  }
  if (measured) {
    cycle.tests_verified = true;
  } else {
    // Anti-fake: re-run the suite when verification is enabled; else record that
    // this count was self-reported (tests_verified:false) so the trust is visible.
    const tv = verifyTestCount(cwd, loadConfig(cwd), cycle.tests_after);
    cycle.tests_after = tv.tests_after;
    cycle.tests_verified = tv.verified;
  }

  if (!run.cycles) run.cycles = [];

  // Attribution: anchor this cycle to a start, measure its wall-clock duration,
  // name the driving command, and JOIN to the authoritative cost ledger so the
  // cycle carries the agents + dollars behind its item counts (not just a
  // self-reported points estimate). windowStart = the prior cycle's end, or the
  // run start for cycle 1. Server-side join — no fakeable CLI arg.
  const windowStart = run.cycles.length ? run.cycles[run.cycles.length - 1].timestamp : run.started_at;
  cycle.started_at = windowStart || null;
  const durMs = windowStart ? (new Date(cycle.timestamp) - new Date(windowStart)) : NaN;
  cycle.duration_ms = Number.isFinite(durMs) ? durMs : null;
  cycle.command = getVal('--command', run.category || run.source || null);
  cycle.cost_usd = null;
  cycle.tokens = null;
  cycle.agents = [];
  if (windowStart) {
    try {
      const agg = require('./cost.cjs').aggregate(cwd, { since: windowStart, until: cycle.timestamp });
      if (agg && agg.totals) {
        cycle.cost_usd = agg.totals.calls > 0 ? agg.totals.cost_usd : null;
        cycle.tokens = { input: agg.totals.input_tokens, output: agg.totals.output_tokens, cache_read: agg.totals.cache_read_tokens };
        cycle.agents = agg.by_agent ? Object.keys(agg.by_agent) : [];
      }
    } catch { /* cost is observability, never the critical path */ }
  }
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

  // The host's 7-day usage window (Claude Code subscriptions, read from what PAN's
  // status line last saw): past cost.weekly_limit_stop_pct the run stops resumable,
  // so the rest of the window stays the user's. No fresh reading never stops it.
  const weekly = weeklyLimitStop(cwd);
  cycle.weekly_limit_used_pct = weekly.seven_day_used_pct;
  const stopReason = determineStopReason(cycle, run) || (weekly.stop ? 'weekly_limit' : null);
  if (stopReason) {
    run.status = ['regression', 'weekly_limit', 'cycle_failed', 'all_failed'].includes(stopReason) ? AUTORUN_STATUSES.STOPPED : AUTORUN_STATUSES.COMPLETED;
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

/**
 * Whether opt-in HTML phase reports are enabled for this project.
 * Reads the raw config.json (loadConfig doesn't surface the workflow block);
 * absent / malformed config → disabled.
 */
function phaseReportsEnabled(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(planningPath(cwd), 'config.json'), 'utf-8'));
    return !!(raw.workflow && raw.workflow.phase_reports && raw.workflow.phase_reports.enabled);
  } catch {
    return false;
  }
}

/**
 * Regenerate every phase report + index as part of a focus-auto checkpoint,
 * when the feature is enabled. Best-effort and side-effect-light: never opens a
 * browser, and silently no-ops for phase-less / focus-auto-only projects. The
 * fresh HTML lands in .planning/ so the checkpoint's `git add` sweeps it in.
 */
function maybeRenderPhaseReports(cwd) {
  if (!phaseReportsEnabled(cwd)) return;
  try {
    const { renderAllToDisk } = require('./phase-report.cjs');
    renderAllToDisk(cwd, {});
  } catch {
    // Report generation must never block the checkpoint commit.
  }
}

function focusAutoCheckpointCommit(cwd, cycle, run) {
  if (!isGitRepo(cwd)) return null;
  const config = loadConfig(cwd);
  const autoCommit = config.focus && config.focus.auto_commit !== undefined ? config.focus.auto_commit : true;
  if (!autoCommit) return null;
  // commit_docs is the global switch for committing planning artifacts; focus-auto
  // is a planning-doc committer, so honor it. commit_docs=false → hands the .planning
  // commit (and any report regeneration) back to the user.
  if (config.commit_docs === false) return null;
  // Reconcile the always-loaded project memory before staging so the committed
  // .planning/ snapshot carries the trimmed state.md (no-op when already lean).
  try { require('./memory-optimize.cjs').maybeAutoOptimizeMemory(cwd); } catch { /* never block the checkpoint */ }
  // Enabled projects: refresh the HTML reports before staging so the committed
  // .planning/ snapshot reflects this cycle.
  maybeRenderPhaseReports(cwd);
  const status = execGit(cwd, ['status', '--porcelain', planningRel() + '/']);
  if (status.exitCode !== 0 || !status.stdout) return null;
  execGit(cwd, ['add', planningRel() + '/']);
  const msg = `docs: focus-auto cycle ${cycle.cycle} — ${cycle.items_completed} items completed`;
  const commitResult = execGit(cwd, ['commit', '-m', msg]);
  if (commitResult.exitCode !== 0) return null;
  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  return hashResult.exitCode === 0 ? hashResult.stdout : null;
}

function determineStopReason(cycle, run) {
  if (cycle.tests_after < cycle.tests_before || cycle.regressions > 0) return 'regression';
  // Failed work stops the run resumable. `zero_completed` (completed) means nothing was
  // left to attempt; a cycle whose items all failed or were reverted is not that.
  if (cycle.status === 'failed' && (cycle.items_completed > 0 || cycle.items_failed > 0)) return 'cycle_failed';
  if (cycle.items_completed === 0 && cycle.items_failed > 0) return 'all_failed';
  // Budget is advisory by default — it only STOPS the run when explicitly enforced.
  // Otherwise the overage is tracked/surfaced (indication) and the loop continues.
  // Hard cap (full budget) is evaluated FIRST so it remains the absolute boundary;
  // the softer verify-reserve stop only fires in the band below it.
  if (run.budget_enforce && run.totals.points_used >= run.total_budget) return 'budget_cap';
  // Verify-reserve: under enforcement, stop once new-work spend crosses into the
  // reserved headroom so re-verification still has points. Advisory mode never trips.
  const reserve = run.verify_reserve || 0;
  if (run.budget_enforce && reserve > 0 && run.totals.points_used >= run.total_budget - reserve) return 'budget_reserve_reached';
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
  const busy = autodevRefusal(cwd);
  if (busy) return output(busy, raw, busy.reason, 1);
  run.status = run.totals && run.totals.cycles_completed > 0 ? AUTORUN_STATUSES.IN_PROGRESS : AUTORUN_STATUSES.INITIALIZED;
  run.stop_reason = null;
  writeAutoRun(cwd, run);
  const cyclesRemaining = run.max_cycles - (run.totals ? run.totals.cycles_completed : 0);
  return output({ ...run, ...budgetIndicators(run), cycles_remaining: cyclesRemaining }, raw);
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
  const busy = autodevRefusal(cwd);
  if (busy) return output(busy, raw, busy.reason, 1);

  const defaults = category ? CATEGORY_DEFAULTS[category] : { mode: 'balanced', budget: 50 };
  const mode = getVal('--mode', defaults.mode);
  const budget = Number(getVal('--budget', String(defaults.budget)));
  const maxCycles = Number(getVal('--max-cycles', String(DEFAULT_MAX_CYCLES)));
  const totalBudget = Number(getVal('--total-budget', String(DEFAULT_TOTAL_BUDGET)));
  // Budget is advisory by default (tracked + surfaced, never a hard stop). Enforce
  // only when the user opts in via config `budget.enforce` or `--enforce-budget`.
  const budgetConfig = loadConfig(cwd).budget || {};
  const budgetEnforce = hasFlag('--enforce-budget') || budgetConfig.enforce === true;
  // Verify-reserve: hold back a fraction of the spawn budget so re-verification
  // isn't starved of points. Advisory by default (surfaced as an indicator);
  // only a hard early stop under --enforce-budget. Clamp the fraction to 0..0.5.
  const reserveRaw = getVal('--verify-reserve', null);
  let reserveFraction = reserveRaw != null ? Number(reserveRaw)
    : (typeof budgetConfig.verify_reserve === 'number' ? budgetConfig.verify_reserve : VERIFY_RESERVE_FRACTION);
  if (!Number.isFinite(reserveFraction) || reserveFraction < 0) reserveFraction = 0;
  if (reserveFraction > 0.5) reserveFraction = 0.5;
  const verifyReserve = reserveFraction > 0 ? Math.max(VERIFY_RESERVE_FLOOR, Math.ceil(totalBudget * reserveFraction)) : 0;

  if (!FOCUS_MODES.includes(mode)) return error(`Mode must be one of: ${FOCUS_MODES.join(', ')}`);
  if (budget < BUDGET_MIN || budget > BUDGET_MAX) return error(`Budget must be between ${BUDGET_MIN} and ${BUDGET_MAX}`);
  if (maxCycles < MAX_CYCLES_MIN || maxCycles > MAX_CYCLES_MAX) return error(`Max cycles must be between ${MAX_CYCLES_MIN} and ${MAX_CYCLES_MAX}`);
  if (totalBudget < TOTAL_BUDGET_MIN || totalBudget > TOTAL_BUDGET_MAX) return error(`Total budget must be between ${TOTAL_BUDGET_MIN} and ${TOTAL_BUDGET_MAX}`);

  const runData = {
    run_id: generateRunId(cwd),
    status: AUTORUN_STATUSES.INITIALIZED,
    started_at: new Date().toISOString(),
    source: source,
    category: category,
    mode: mode,
    parallel_research: hasFlag('--parallel-research'),
    parallel_verify: hasFlag('--parallel-verify'),
    clean_seal: hasFlag('--clean-seal'),
    budget_per_cycle: budget,
    max_cycles: maxCycles,
    total_budget: totalBudget,
    budget_enforce: budgetEnforce,
    verify_reserve: verifyReserve,
    priority_range: category ? CATEGORY_PRIORITY_RANGE[category] : { min: 0, max: 6 },
    deep_review_enabled: hasFlag('--deep-review'),
    tests_baseline: null,
    cycles: [],
    totals: { cycles_completed: 0, items_completed: 0, items_failed: 0, points_used: 0, tests_current: 0 },
    stop_reason: null,
  };

  if (hasFlag('--dry-run')) {
    return output({ dry_run: true, ...runData, run_file: planningRel(FOCUS_DIR, AUTO_RUN_FILE) }, raw);
  }

  writeAutoRun(cwd, runData);
  output({ ...runData, run_file: planningRel(FOCUS_DIR, AUTO_RUN_FILE) }, raw);
}

function cmdFocusAuto(cwd, raw, ...args) {
  const hasFlag = (flag) => args.includes(flag);
  const getVal = (flag, def) => {
    const idx = args.indexOf(flag);
    return (idx !== -1 && idx + 1 < args.length) ? args[idx + 1] : def;
  };

  if (hasFlag('--status')) return focusAutoStatus(cwd, raw);
  // --stop, --update, --continue and a start read the run, check its status and
  // write it back: they hold its lock throughout, so the check and the write
  // see the same run (released at exit, since output() ends the process).
  const runFile = planningPath(cwd, FOCUS_DIR, AUTO_RUN_FILE);
  if (fs.existsSync(path.dirname(runFile)) && !holdLock(runFile, { strict: true }).acquired) {
    return output({ error: 'lock_timeout', file: planningRel(FOCUS_DIR, AUTO_RUN_FILE), reason: 'another PAN process is changing the focus run; retry when it finishes' }, raw);
  }
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
  listBatchFiles,
  readLatestBatch,
  readBatchFile,
  // Cycles
  focusCyclePlan,
  focusCycleFiles,
  listFocusCycles,
  openFocusCycle,
  focusOpen,
  focusClose,
  cmdFocusOpen,
  cmdFocusClose,
  cmdFocusRoute,
  focusActivity,
  focusNextStep,
  isRunStale,
  focusRoute,
  classifyOwner,
  parseTraceability,
  routeItems,
  parseFailed,
  parseDone,
  deriveCycleStatus,
  runCurrentCycle,
  unrecordedCycles,
  // Auto
  categoryFilter,
  readAutoRun,
  writeAutoRun,
  cmdFocusAuto,
  determineStopReason,
  verifyTestCount,
  // Opus 4.7
  determineContinuation,
  classifyStageDependencies,
};
