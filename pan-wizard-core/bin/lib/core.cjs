/**
 * Core — Shared utilities, constants, and internal helpers
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const {
  PLANNING_DIR,
  PHASES_DIR,
  MILESTONES_DIR,
  ROADMAP_FILE,
  MAX_JSON_SIZE,
  PHASE_NUM_RE,
  PHASE_DIR_RE,
  ARCHIVE_DIR_RE,
  isPlanFile,
  isSummaryFile,
  isResearchFile,
  isContextFile,
  isVerificationFile,
  getPlanId,
  getSummaryId,
  MILESTONE_VERSION_RE,
} = require('./constants.cjs');

// ─── Multi-Model Routing ─────────────────────────────────────────────────────

/**
 * Provider-specific model name mapping for each tier alias.
 * Each provider maps reasoning/mid/fast to its native model identifiers.
 * "inherit" means the host runtime uses its own top-tier model selection.
 */
const PROVIDER_MODELS = {
  anthropic: { reasoning: 'inherit', mid: 'sonnet',                 fast: 'haiku' },
  openai:    { reasoning: 'inherit', mid: 'mid',                    fast: 'fast'  },
  google:    { reasoning: 'inherit', mid: 'gemini-2.5-flash',       fast: 'gemini-2.5-flash-lite' },
  default:   { reasoning: 'inherit', mid: 'sonnet',                 fast: 'haiku' },
};

/** Maps legacy Anthropic model names to provider-agnostic tier aliases. */
const LEGACY_ALIASES = { opus: 'reasoning', sonnet: 'mid', haiku: 'fast' };

/** Relative cost multipliers per tier (fast = 1× baseline). */
const COST_MULTIPLIERS = { reasoning: 15, mid: 3, fast: 1 };

// ─── Model Profile Table ─────────────────────────────────────────────────────

const MODEL_PROFILES = {
  // Original planning/execution agents (pre-v3.0)
  'pan-planner':              { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-roadmapper':           { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-executor':             { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-phase-researcher':     { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-project-researcher':   { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-research-synthesizer': { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-debugger':             { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-document_code':        { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
  'pan-verifier':             { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-plan-checker':         { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-integration-checker':  { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-reviewer':             { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
  // Spec B v2 agents (v3.0–v3.4) — added v3.7.5 to close MODEL_PROFILES drift
  'pan-conductor':            { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-counterfactual':       { quality: 'reasoning', balanced: 'mid',      budget: 'mid' },
  'pan-hardener':             { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-meta-reviewer':        { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-knowledge':            { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-previewer':            { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
  // v3.5 agents
  'pan-optimizer':            { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
  'pan-distiller':            { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
  // v3.7.0 self-improvement loop — observation-only watchdog
  'pan-experiment-runner':    { quality: 'reasoning', balanced: 'fast',     budget: 'fast' },
  // ADR-0033 bot-army — Release squad
  'pan-release':              { quality: 'reasoning', balanced: 'mid',      budget: 'fast' },
};

// ─── Effort Profiles (2026-06, adaptive-thinking era) ───────────────────────
//
// Per-agent base reasoning effort (low|medium|high|xhigh). `effort` is the
// primary within-model cost/intelligence dial on current models — it replaced
// fixed thinking budgets. The base values here mirror the `effort:`
// frontmatter shipped in agents/*.md (a drift test keeps them in sync).
//
// Profile modulation: `budget` steps effort down one level (floor: low) as
// its cost lever; `quality` and `balanced` keep the base. Per-agent override
// via config.json → effort_overrides.

const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh'];

const AGENT_BASE_EFFORT = {
  // Heavy planning/orchestration/debugging — deepest reasoning
  'pan-planner':              'xhigh',
  'pan-conductor':            'xhigh',
  'pan-debugger':             'xhigh',
  'pan-plan-checker':         'xhigh',
  // Execution and verification — thorough but bounded
  'pan-executor':             'high',
  'pan-roadmapper':           'high',
  'pan-verifier':             'high',
  'pan-integration-checker':  'high',
  'pan-hardener':             'high',
  'pan-counterfactual':       'high',
  'pan-previewer':            'high',
  'pan-experiment-runner':    'high',
  'pan-optimizer':            'high',
  'pan-release':              'high',
  // Research/synthesis/review — moderate depth
  'pan-phase-researcher':     'medium',
  'pan-project-researcher':   'medium',
  'pan-research-synthesizer': 'medium',
  'pan-knowledge':            'medium',
  'pan-distiller':            'medium',
  'pan-meta-reviewer':        'medium',
  'pan-reviewer':             'medium',
  // Mechanical documentation pass — fast and scoped
  'pan-document_code':        'low',
};

/**
 * Resolve the reasoning effort level for an agent under the active profile.
 * Priority: config.effort_overrides[agent] → base effort modulated by
 * model_profile (budget steps down one level) → 'medium' for unknown agents.
 *
 * @param {string} cwd - Project root directory
 * @param {string} agentType - e.g. "pan-planner"
 * @returns {string} One of 'low' | 'medium' | 'high' | 'xhigh'
 */
function resolveEffortInternal(cwd, agentType) {
  const config = loadConfig(cwd);
  const override = config.effort_overrides?.[agentType];
  if (typeof override === 'string' && EFFORT_ORDER.includes(override.toLowerCase().trim())) {
    return override.toLowerCase().trim();
  }
  const base = AGENT_BASE_EFFORT[agentType] || 'medium';
  const profile = config.model_profile || 'balanced';
  if (profile === 'budget') {
    return EFFORT_ORDER[Math.max(0, EFFORT_ORDER.indexOf(base) - 1)];
  }
  return base;
}

// ─── Output helpers ───────────────────────────────────────────────────────────

/**
 * Write result to stdout and exit. JSON by default, or raw string if --raw flag is set.
 * Large JSON (>50KB) is written to a tmpfile with @file: prefix.
 * @param {Object} result - The result object to serialize as JSON
 * @param {boolean} [raw] - If true and rawValue is provided, output rawValue as plain string
 * @param {string} [rawValue] - Plain string to output when raw mode is active
 */
function output(result, raw, rawValue) {
  if (raw && rawValue !== undefined) {
    process.stdout.write(String(rawValue));
  } else {
    const json = JSON.stringify(result, null, 2);
    // Large payloads exceed Claude Code's Bash tool buffer (~50KB).
    // Write to tmpfile and output the path prefixed with @file: so callers can detect it.
    if (json.length > MAX_JSON_SIZE) {
      // Unpredictable name + exclusive create ('wx') so a pre-planted file or
      // symlink at the path can't be followed/overwritten on a shared tmpdir.
      const rand = require('crypto').randomBytes(9).toString('hex');
      const tmpPath = path.join(os.tmpdir(), `pan-${process.pid}-${rand}.json`);
      try {
        fs.writeFileSync(tmpPath, json, { encoding: 'utf-8', flag: 'wx' });
        process.stdout.write('@file:' + tmpPath);
      } catch {
        // Tmpfile write failed (disk full, permissions) — truncate and write to stdout
        const truncated = json.slice(0, MAX_JSON_SIZE);
        process.stdout.write(truncated);
      }
    } else {
      process.stdout.write(json);
    }
  }
  process.exit(0);
}

/**
 * Write error message to stderr and exit with code 1.
 * @param {string} message - Error message
 */
function error(message) {
  process.stderr.write('Error: ' + message + '\n');
  process.exit(1);
}

/**
 * Write debug message to stderr when --verbose flag is active.
 * @param {...any} args - Values to log (joined with space)
 */
function verbose(...args) {
  if (process.env.PAN_VERBOSE === '1') {
    process.stderr.write('[pan-tools] ' + args.join(' ') + '\n');
  }
}

// ─── Path utilities ─────────────────────────────────────────────────────────

/** Normalize a relative path to always use forward slashes (POSIX) for JSON output. */
function toPosix(p) {
  return p.split(path.sep).join('/');
}

// ─── File & Config utilities ──────────────────────────────────────────────────

/**
 * Read a file, returning null instead of throwing on failure.
 * @param {string} filePath - Absolute path to the file
 * @returns {string|null} File contents as UTF-8 string, or null if unreadable
 */
function safeReadFile(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Load project config from .planning/config.json, merging with defaults.
 * Handles nested config sections (planning.*, workflow.*, git.*) and flat keys.
 * @param {string} cwd - Project root directory
 * @returns {Object} Flattened config with keys: model_profile, commit_docs, search_gitignored,
 *   branching_strategy, phase_branch_template, milestone_branch_template, research,
 *   plan_checker, verifier, parallelization, brave_search
 */
function loadConfig(cwd) {
  const configPath = path.join(cwd, PLANNING_DIR, 'config.json');
  const defaults = {
    model_profile: 'balanced',
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'pan/phase-{phase}-{slug}',
    milestone_branch_template: 'pan/{milestone}-{slug}',
    research: true,
    plan_checker: true,
    verifier: true,
    parallelization: true,
    brave_search: false,
  };

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);

    // get() resolves a config key by checking flat keys first (parsed[key]),
    // then falling back to nested section lookup (parsed[section][field]).
    // This lets users write either { "commit_docs": true } or
    // { "planning": { "commit_docs": true } } in config.json.
    const get = (key, nested) => {
      if (parsed[key] !== undefined) return parsed[key];
      if (nested && parsed[nested.section] && parsed[nested.section][nested.field] !== undefined) {
        return parsed[nested.section][nested.field];
      }
      return undefined;
    };

    const parallelization = (() => {
      const val = get('parallelization');
      if (typeof val === 'boolean') return val;
      if (typeof val === 'object' && val !== null && 'enabled' in val) return val.enabled;
      return defaults.parallelization;
    })();

    return {
      model_profile: get('model_profile') ?? defaults.model_profile,
      commit_docs: get('commit_docs', { section: 'planning', field: 'commit_docs' }) ?? defaults.commit_docs,
      search_gitignored: get('search_gitignored', { section: 'planning', field: 'search_gitignored' }) ?? defaults.search_gitignored,
      branching_strategy: get('branching_strategy', { section: 'git', field: 'branching_strategy' }) ?? defaults.branching_strategy,
      phase_branch_template: get('phase_branch_template', { section: 'git', field: 'phase_branch_template' }) ?? defaults.phase_branch_template,
      milestone_branch_template: get('milestone_branch_template', { section: 'git', field: 'milestone_branch_template' }) ?? defaults.milestone_branch_template,
      research: get('research', { section: 'workflow', field: 'research' }) ?? defaults.research,
      plan_checker: get('plan_checker', { section: 'workflow', field: 'plan_check' }) ?? defaults.plan_checker,
      verifier: get('verifier', { section: 'workflow', field: 'verifier' }) ?? defaults.verifier,
      parallelization,
      brave_search: get('brave_search') ?? defaults.brave_search,
      budget: parsed.budget || { default_points: 50, micro_threshold_tasks: 3, micro_threshold_files: 2 },
      commit: parsed.commit || { safety_checks: true, conventional_types: true, sensitive_patterns: ['\\.env$', '\\.pem$', '\\.key$', 'credentials', 'secret', 'password', 'token'] },
      execution: parsed.execution || { default_mode: 'wave_order', rollback_snapshots: true, error_pattern_learning: true },
      focus: parsed.focus || { auto_commit: true },
      model_overrides: parsed.model_overrides || {},
      effort_overrides: parsed.effort_overrides || {},
      routing: parsed.routing || { strategy: 'static', provider: 'auto' },
      // ADR-0031: project build/verification commands. null = not configured
      // (focus-auto --clean-seal then asks or skips rather than guessing).
      build: parsed.build || null,
      verification: parsed.verification || null,
      concurrency: parsed.concurrency || { serial_build: false },
    };
  } catch { // Config missing or malformed — use defaults
    return {
      ...defaults,
      budget: { default_points: 50, micro_threshold_tasks: 3, micro_threshold_files: 2 },
      commit: { safety_checks: true, conventional_types: true, sensitive_patterns: ['\\.env$', '\\.pem$', '\\.key$', 'credentials', 'secret', 'password', 'token'] },
      execution: { default_mode: 'wave_order', rollback_snapshots: true, error_pattern_learning: true },
      focus: { auto_commit: true },
      model_overrides: {},
      effort_overrides: {},
      routing: { strategy: 'static', provider: 'auto' },
      build: null,
      verification: null,
      concurrency: { serial_build: false },
    };
  }
}

// ─── Git utilities ────────────────────────────────────────────────────────────

/**
 * Check if a path is gitignored using `git check-ignore`.
 * @param {string} cwd - Project root directory
 * @param {string} targetPath - Path to check (relative to cwd)
 * @returns {boolean} True if gitignored
 */
function isGitIgnored(cwd, targetPath) {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', targetPath], {
      cwd,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the given directory is inside a git repository.
 * @param {string} cwd - Directory to check
 * @returns {boolean}
 */
function isGitRepo(cwd) {
  try {
    const stdout = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return stdout.trim() === 'true';
  } catch {
    return false;
  }
}

/**
 * Execute a git command safely with proper argument escaping.
 * @param {string} cwd - Working directory for git
 * @param {string[]} args - Git arguments (e.g., ['add', 'file.md'])
 * @returns {{exitCode: number, stdout: string, stderr: string}}
 */
function execGit(cwd, args) {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout: stdout.trim(), stderr: '' };
  } catch (err) {
    return {
      exitCode: err.status ?? 1,
      stdout: (err.stdout ?? '').toString().trim(),
      stderr: (err.stderr ?? '').toString().trim(),
    };
  }
}

// ─── Phase utilities ──────────────────────────────────────────────────────────

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a phase identifier to zero-padded format.
 * Examples: "1" → "01", "3A" → "03A", "12.1" → "12.1"
 * @param {string|number} phase - Phase identifier
 * @returns {string} Normalized phase string
 */
function normalizePhaseName(phase) {
  const match = String(phase).match(PHASE_NUM_RE);
  if (!match) return phase;
  const padded = match[1].padStart(2, '0');
  const letter = match[2] ? match[2].toUpperCase() : '';
  const decimal = match[3] || '';
  return padded + letter + decimal;
}

/**
 * Compare two phase identifiers for sorting. Handles integer, letter-suffix,
 * and multi-level decimal phases (e.g., 1 < 2 < 2A < 2A.1 < 3).
 * @param {string} a - First phase identifier
 * @param {string} b - Second phase identifier
 * @returns {number} Negative if a < b, positive if a > b, 0 if equal
 */
function comparePhaseNum(a, b) {
  // 3-level comparison for phase identifiers like "12A.1.2":
  //   1. Integer prefix: compare the leading digits (e.g., 3 vs 12)
  //   2. Letter suffix: no letter < A < B (e.g., 12 < 12A < 12B)
  //   3. Decimal segments: segment-by-segment numeric comparison (e.g., 12A.1 < 12A.2)
  const partsA = String(a).match(PHASE_NUM_RE);
  const partsB = String(b).match(PHASE_NUM_RE);
  if (!partsA || !partsB) return String(a).localeCompare(String(b));
  const intDiff = parseInt(partsA[1], 10) - parseInt(partsB[1], 10);
  if (intDiff !== 0) return intDiff;
  // No letter sorts before letter: 12 < 12A < 12B
  const la = (partsA[2] || '').toUpperCase();
  const lb = (partsB[2] || '').toUpperCase();
  if (la !== lb) {
    if (!la) return -1;
    if (!lb) return 1;
    return la < lb ? -1 : 1;
  }
  // Segment-by-segment decimal comparison: 12A < 12A.1 < 12A.1.2 < 12A.2
  const aDecParts = partsA[3] ? partsA[3].slice(1).split('.').map(p => parseInt(p, 10)) : [];
  const bDecParts = partsB[3] ? partsB[3].slice(1).split('.').map(p => parseInt(p, 10)) : [];
  const maxLen = Math.max(aDecParts.length, bDecParts.length);
  if (aDecParts.length === 0 && bDecParts.length > 0) return -1;
  if (bDecParts.length === 0 && aDecParts.length > 0) return 1;
  for (let i = 0; i < maxLen; i++) {
    const av = Number.isFinite(aDecParts[i]) ? aDecParts[i] : 0;
    const bv = Number.isFinite(bDecParts[i]) ? bDecParts[i] : 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}

// Search a directory of phase folders for one matching the normalized phase number.
// Lists all subdirectories, finds the first whose name starts with the normalized
// phase prefix, then inventories its plan/summary/research/context/verification files.
// completedPlanIds tracks which plans have matching summaries so we can derive
// incomplete_plans (plans without a corresponding summary).
function searchPhaseInDir(baseDir, relBase, normalized) {
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => comparePhaseNum(a, b));
    const match = dirs.find(d => d.startsWith(normalized));
    if (!match) return null;

    const dirMatch = match.match(PHASE_DIR_RE);
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;
    const phaseDir = path.join(baseDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);

    const plans = phaseFiles.filter(isPlanFile).sort();
    const summaries = phaseFiles.filter(isSummaryFile).sort();
    const hasResearch = phaseFiles.some(isResearchFile);
    const hasContext = phaseFiles.some(isContextFile);
    const hasVerification = phaseFiles.some(isVerificationFile);

    const completedPlanIds = new Set(
      summaries.map(s => getSummaryId(s))
    );
    const incompletePlans = plans.filter(p => {
      return !completedPlanIds.has(getPlanId(p));
    });

    return {
      found: true,
      directory: toPosix(path.join(relBase, match)),
      phase_number: phaseNumber,
      phase_name: phaseName,
      phase_slug: phaseName ? phaseName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : null,
      plans,
      summaries,
      incomplete_plans: incompletePlans,
      has_research: hasResearch,
      has_context: hasContext,
      has_verification: hasVerification,
    };
  } catch { // Phase directory unreadable
    return null;
  }
}

/**
 * Find a phase directory by number, searching current phases then archived milestones.
 * @param {string} cwd - Project root directory
 * @param {string} phase - Phase identifier (e.g., "1", "03", "2.1")
 * @returns {Object|null} Phase info: { found, directory, phase_number, phase_name, phase_slug,
 *   plans, summaries, incomplete_plans, has_research, has_context, has_verification, archived? }
 */
function findPhaseInternal(cwd, phase) {
  if (!phase) return null;

  const phasesDir = path.join(cwd, PLANNING_DIR, PHASES_DIR);
  const normalized = normalizePhaseName(phase);

  // Two-phase search strategy:
  // 1. Search the active phases directory (.planning/phases/) first.
  // 2. If not found, search archived milestone directories (.planning/milestones/v*-phases/)
  //    in reverse order (newest archive first) so the most recent match wins.
  const current = searchPhaseInDir(phasesDir, path.join(PLANNING_DIR, PHASES_DIR), normalized);
  if (current) return current;

  // Search archived milestone phases (newest first)
  const milestonesDir = path.join(cwd, PLANNING_DIR, MILESTONES_DIR);
  try {
    const milestoneEntries = fs.readdirSync(milestonesDir, { withFileTypes: true });
    const archiveDirs = milestoneEntries
      .filter(e => e.isDirectory() && ARCHIVE_DIR_RE.test(e.name))
      .map(e => e.name)
      .sort()
      .reverse();

    for (const archiveName of archiveDirs) {
      const vm = archiveName.match(/^(v[\d.]+)-phases$/);
      if (!vm) continue;
      const version = vm[1];
      const archivePath = path.join(milestonesDir, archiveName);
      const relBase = path.join(PLANNING_DIR, MILESTONES_DIR, archiveName);
      const result = searchPhaseInDir(archivePath, relBase, normalized);
      if (result) {
        result.archived = version;
        return result;
      }
    }
  } catch (e) { verbose('findPhaseInArchives: milestones directory missing or unreadable:', e.message); }

  return null;
}

function getArchivedPhaseDirs(cwd) {
  const milestonesDir = path.join(cwd, PLANNING_DIR, MILESTONES_DIR);
  const results = [];

  try {
    const milestoneEntries = fs.readdirSync(milestonesDir, { withFileTypes: true });
    // Find v*-phases directories, sort newest first
    const phaseDirs = milestoneEntries
      .filter(e => e.isDirectory() && ARCHIVE_DIR_RE.test(e.name))
      .map(e => e.name)
      .sort()
      .reverse();

    for (const archiveName of phaseDirs) {
      const vm = archiveName.match(/^(v[\d.]+)-phases$/);
      if (!vm) continue;
      const version = vm[1];
      const archivePath = path.join(milestonesDir, archiveName);
      const entries = fs.readdirSync(archivePath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => comparePhaseNum(a, b));

      for (const dir of dirs) {
        results.push({
          name: dir,
          milestone: version,
          basePath: path.join(PLANNING_DIR, MILESTONES_DIR, archiveName),
          fullPath: path.join(archivePath, dir),
        });
      }
    }
  } catch (e) { verbose('getArchivedPhaseDirs: milestones directory missing or unreadable:', e.message); }

  return results;
}

// ─── Roadmap & model utilities ────────────────────────────────────────────────

/**
 * Extract a phase section from roadmap.md by phase number.
 * @param {string} cwd - Project root directory
 * @param {string|number} phaseNum - Phase number to look up
 * @returns {Object|null} { found, phase_number, phase_name, goal, section } or null
 */
function getRoadmapPhaseInternal(cwd, phaseNum) {
  if (!phaseNum) return null;
  const roadmapPath = path.join(cwd, PLANNING_DIR, ROADMAP_FILE);

  try {
    const content = fs.readFileSync(roadmapPath, 'utf-8');
    const escapedPhase = escapeRegex(phaseNum.toString());
    const phasePattern = new RegExp(`#{2,4}\\s*Phase\\s+${escapedPhase}:\\s*([^\\n]+)`, 'i');
    const headerMatch = content.match(phasePattern);
    if (!headerMatch) return null;

    const phaseName = headerMatch[1].trim();
    const headerIndex = headerMatch.index;
    const restOfContent = content.slice(headerIndex);
    const nextHeaderMatch = restOfContent.match(/\n#{2,4}\s+Phase\s+\d/i);
    const sectionEnd = nextHeaderMatch ? headerIndex + nextHeaderMatch.index : content.length;
    const section = content.slice(headerIndex, sectionEnd).trim();

    const goalMatch = section.match(/(?:\*\*Goal:\*\*|\*\*Goal\*\*:)\s*([^\n]+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    return {
      found: true,
      phase_number: phaseNum.toString(),
      phase_name: phaseName,
      goal,
      section,
    };
  } catch {
    return null;
  }
}

/**
 * Extract a model tier override from a roadmap phase section.
 * Looks for `<!-- model_tier: <tier> -->` in the phase section text.
 * @param {string} cwd - Project root directory
 * @param {string|number} phaseNum - Phase number to look up
 * @returns {string|null} Tier alias if found, null otherwise
 */
function getPhaseModelTier(cwd, phaseNum) {
  const phaseData = getRoadmapPhaseInternal(cwd, phaseNum);
  if (!phaseData?.section) return null;
  const match = phaseData.section.match(/<!--\s*model_tier:\s*(\S+)\s*-->/i);
  return match ? match[1] : null;
}

/**
 * Adjust a resolved tier given Opus 4.7-era capability hints.
 *
 * Rules, in priority order:
 *   1. context_estimate > LARGE_CONTEXT_TOKEN_THRESHOLD → force reasoning (only 1M-ctx tier).
 *   2. needs_thinking → upgrade fast → mid; leave mid/reasoning alone.
 *   3. cache_warm + !needs_thinking + context_estimate < SMALL_CONTEXT_TOKEN_THRESHOLD →
 *      allow downgrade mid → fast (cheap, cached, simple tasks don't need mid).
 *
 * @param {string} tier - Baseline tier (reasoning|mid|fast)
 * @param {Object} [opts] - {context_estimate, needs_thinking, cache_warm}
 * @returns {string} Possibly-adjusted tier
 */
function adjustTierForCapabilities(tier, opts) {
  if (!opts) return tier;
  const { context_estimate, needs_thinking, cache_warm } = opts;
  const { LARGE_CONTEXT_TOKEN_THRESHOLD, SMALL_CONTEXT_TOKEN_THRESHOLD } = require('./constants.cjs');

  if (typeof context_estimate === 'number' && context_estimate > LARGE_CONTEXT_TOKEN_THRESHOLD) {
    return 'reasoning';
  }
  if (needs_thinking && tier === 'fast') {
    return 'mid';
  }
  if (
    cache_warm &&
    !needs_thinking &&
    typeof context_estimate === 'number' &&
    context_estimate < SMALL_CONTEXT_TOKEN_THRESHOLD &&
    tier === 'mid'
  ) {
    return 'fast';
  }
  return tier;
}

/**
 * Resolve the model for a given agent type based on profile, provider, and routing strategy.
 * Returns "inherit" for reasoning-tier to let the host runtime use its top-tier model.
 * @param {string} cwd - Project root directory
 * @param {string} agentType - Agent name (e.g., "pan-planner", "pan-executor")
 * @param {Object} [taskMetadata] - Optional metadata. Supports complexity fields and
 *   Opus 4.7 capability hints: {context_estimate, needs_thinking, cache_warm}.
 * @returns {string} Model identifier: "inherit", "sonnet", "haiku", "mid", "fast", etc.
 */
function resolveModelInternal(cwd, agentType, taskMetadata) {
  const config = loadConfig(cwd);
  const provider = detectProvider(cwd, config);

  // Check per-agent override first (highest priority)
  const override = config.model_overrides?.[agentType];
  if (override) {
    return resolveTierToModel(override, provider);
  }

  // Check per-phase override from roadmap (second priority)
  if (taskMetadata?.phaseNum) {
    const phaseTier = getPhaseModelTier(cwd, taskMetadata.phaseNum);
    if (phaseTier) {
      return resolveTierToModel(phaseTier, provider);
    }
  }

  // Fall back to profile lookup
  const profile = config.model_profile || 'balanced';
  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) return resolveTierToModel('mid', provider);

  let tier = agentModels[profile] || agentModels['balanced'] || 'mid';

  // Apply routing strategy
  const strategy = config.routing?.strategy || 'static';
  if (strategy === 'complexity' && taskMetadata) {
    const thresholds = config.routing?.complexity_thresholds;
    tier = resolveComplexityTier(tier, { ...taskMetadata, thresholds });
  }

  // Opus 4.7 capability adjustment (only when hints are present)
  if (taskMetadata && (
    taskMetadata.context_estimate !== undefined ||
    taskMetadata.needs_thinking !== undefined ||
    taskMetadata.cache_warm !== undefined
  )) {
    tier = adjustTierForCapabilities(tier, taskMetadata);
  }

  return resolveTierToModel(tier, provider);
}

/**
 * Detect the LLM provider from config, environment, or runtime directory presence.
 * @param {string} cwd - Project root directory
 * @param {Object} config - Loaded config object
 * @returns {string} Provider name: "anthropic", "openai", "google", or "default"
 */
function detectProvider(cwd, config) {
  // 1. Explicit config
  if (config.routing?.provider && config.routing.provider !== 'auto') {
    const p = config.routing.provider;
    return PROVIDER_MODELS[p] ? p : 'default';
  }
  // 2. Environment variable
  const envProvider = process.env.PAN_PROVIDER;
  if (envProvider) {
    return PROVIDER_MODELS[envProvider] ? envProvider : 'default';
  }
  // 3. Runtime directory detection
  const checks = [
    ['.claude', 'anthropic'], ['.codex', 'openai'],
    ['.gemini', 'google'], ['.opencode', 'openai'], ['.github', 'default'],
  ];
  for (const [dir, provider] of checks) {
    try { if (fs.statSync(path.join(cwd, dir)).isDirectory()) return provider; }
    catch { /* continue */ }
  }
  return 'default';
}

/**
 * Resolve a tier alias (or legacy model name) to a provider-specific model name.
 * @param {string} tier - Tier alias ("reasoning", "mid", "fast") or legacy name ("opus", "sonnet", "haiku")
 * @param {string} provider - Provider key from detectProvider()
 * @returns {string} Provider-specific model name
 */
function resolveTierToModel(tier, provider) {
  const normalizedTier = LEGACY_ALIASES[tier] || tier;
  const providerMap = PROVIDER_MODELS[provider] || PROVIDER_MODELS['default'];
  return providerMap[normalizedTier] || providerMap['mid'];
}

/**
 * Adjust model tier based on task complexity metadata.
 * @param {string} baseTier - Starting tier ("reasoning", "mid", "fast")
 * @param {Object} [taskMetadata] - Complexity indicators
 * @returns {string} Adjusted tier
 */
function resolveComplexityTier(baseTier, taskMetadata) {
  if (!taskMetadata) return baseTier;
  const { fileCount = 0, waveCount = 0, requirementCount = 0, isArchitectural = false } = taskMetadata;

  const score =
    (fileCount > 15 ? 2 : fileCount > 5 ? 1 : 0) +
    (waveCount > 3 ? 2 : waveCount > 1 ? 1 : 0) +
    (requirementCount > 5 ? 2 : requirementCount > 2 ? 1 : 0) +
    (isArchitectural ? 3 : 0);

  const thresholds = taskMetadata.thresholds || { downgrade_max: 2, upgrade_min: 6 };
  const tiers = ['fast', 'mid', 'reasoning'];
  const idx = tiers.indexOf(baseTier);
  if (idx === -1) return baseTier;

  if (score <= thresholds.downgrade_max && idx > 0) return tiers[idx - 1];
  if (score >= thresholds.upgrade_min && idx < 2) return tiers[idx + 1];
  return baseTier;
}

/**
 * Estimate relative cost multiplier for a given profile.
 * @param {string} profile - "quality", "balanced", or "budget"
 * @returns {Object} Cost estimation with total, average, agentCount
 */
function estimateCostMultiplier(profile) {
  let total = 0;
  const agents = Object.keys(MODEL_PROFILES);
  for (const agent of agents) {
    const tier = MODEL_PROFILES[agent][profile] || 'mid';
    total += COST_MULTIPLIERS[tier] || 3;
  }
  return { profile, total, average: +(total / agents.length).toFixed(1), agentCount: agents.length };
}

// ─── Misc utilities ───────────────────────────────────────────────────────────

function pathExistsInternal(cwd, targetPath) {
  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);
  try {
    fs.statSync(fullPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert text to a URL-safe slug (lowercase, hyphens, no special chars).
 * @param {string} text - Input text
 * @returns {string|null} Slug string, or null if text is falsy
 */
function generateSlugInternal(text) {
  if (!text) return null;
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Extract current milestone version and name from roadmap.md.
 * @param {string} cwd - Project root directory
 * @returns {{version: string, name: string}} Milestone info (defaults: v1.0, "milestone")
 */
function getMilestoneInfo(cwd) {
  try {
    const roadmap = fs.readFileSync(path.join(cwd, PLANNING_DIR, ROADMAP_FILE), 'utf-8');
    const versionMatch = roadmap.match(MILESTONE_VERSION_RE);
    const nameMatch = roadmap.match(/## .*v\d+\.\d+[:\s]+([^\n(]+)/);
    return {
      version: versionMatch ? versionMatch[0] : 'v1.0',
      name: nameMatch ? nameMatch[1].trim() : 'milestone',
    };
  } catch {
    return { version: 'v1.0', name: 'milestone' };
  }
}

/**
 * Scan pending todos directory and return matching items.
 * @param {string} cwd - Project root
 * @param {string|null} area - Optional area filter
 * @returns {{ count: number, todos: Array<{file: string, created: string, title: string, area: string, path: string}> }}
 */
function scanPendingTodos(cwd, area) {
  const pendingDir = path.join(cwd, PLANNING_DIR, 'todos', 'pending');
  let count = 0;
  const todos = [];

  try {
    const files = fs.readdirSync(pendingDir).filter(f => f.endsWith('.md'));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
        const createdMatch = content.match(/^created:\s*(.+)$/m);
        const titleMatch = content.match(/^title:\s*(.+)$/m);
        const areaMatch = content.match(/^area:\s*(.+)$/m);
        const todoArea = areaMatch ? areaMatch[1].trim() : 'general';

        if (area && todoArea !== area) continue;

        count++;
        todos.push({
          file,
          created: createdMatch ? createdMatch[1].trim() : 'unknown',
          title: titleMatch ? titleMatch[1].trim() : 'Untitled',
          area: todoArea,
          path: path.join(PLANNING_DIR, 'todos', 'pending', file),
        });
      } catch { /* skip unreadable file */ }
    }
  } catch { /* pending dir does not exist */ }

  return { count, todos };
}

/**
 * Scan source files for TODO/FIXME/XXX/HACK comments.
 * @param {string} cwd - Project root
 * @returns {{ count: number, items: Array<{file: string, line: number, tag: string, text: string}> }}
 */
/**
 * Build an ordered list of cacheable context blocks for agent prompts.
 *
 * Reads files from .planning/ that are stable across agent calls within a phase
 * (project.md, requirements.md, roadmap.md, state.md, standards.md). Each block
 * is tagged `cache: true` so the host runtime (or installer) can translate to
 * the appropriate per-runtime caching syntax (Anthropic cache_control, etc.).
 *
 * Files that don't exist are skipped silently. The order matches the file list
 * in constants.cjs to keep prompt prefixes byte-stable across calls (which is
 * what cache key matching requires).
 *
 * @param {string} cwd - Project root
 * @returns {{blocks: Array<{path: string, content: string, cache: true}>, total_bytes: number, sha: string}}
 */
function buildCachedContext(cwd) {
  const { PLANNING_DIR, CACHEABLE_CONTEXT_FILES } = require('./constants.cjs');
  const crypto = require('crypto');
  const blocks = [];
  let totalBytes = 0;
  const hasher = crypto.createHash('sha256');

  for (const file of CACHEABLE_CONTEXT_FILES) {
    const abs = path.join(cwd, PLANNING_DIR, file);
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      blocks.push({ path: toPosix(path.join(PLANNING_DIR, file)), content, cache: true });
      totalBytes += Buffer.byteLength(content, 'utf-8');
      hasher.update(file + '\0' + content + '\0');
    } catch {
      // Missing files are expected (e.g. standards.md in non-regulated projects).
    }
  }

  return { blocks, total_bytes: totalBytes, sha: hasher.digest('hex').slice(0, 16) };
}

function scanSourceTodos(cwd) {
  const items = [];
  const libDir = path.join(cwd, 'pan-wizard-core', 'bin', 'lib');
  const pattern = /\b(TODO|FIXME|XXX|HACK)\b[:\s]*(.*)/i;

  let files;
  try {
    files = fs.readdirSync(libDir).filter(f => f.endsWith('.cjs'));
  } catch { return { count: 0, items }; }

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(libDir, file), 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(pattern);
        if (match) {
          items.push({
            file: toPosix(path.join('pan-wizard-core', 'bin', 'lib', file)),
            line: i + 1,
            tag: match[1].toUpperCase(),
            text: match[2].trim(),
          });
        }
      }
    } catch { /* skip unreadable file */ }
  }

  return { count: items.length, items };
}

module.exports = {
  MODEL_PROFILES,
  AGENT_BASE_EFFORT,
  EFFORT_ORDER,
  resolveEffortInternal,
  PROVIDER_MODELS,
  LEGACY_ALIASES,
  COST_MULTIPLIERS,
  output,
  error,
  verbose,
  safeReadFile,
  loadConfig,
  isGitIgnored,
  isGitRepo,
  execGit,
  escapeRegex,
  normalizePhaseName,
  comparePhaseNum,
  searchPhaseInDir,
  findPhaseInternal,
  getArchivedPhaseDirs,
  getRoadmapPhaseInternal,
  resolveModelInternal,
  adjustTierForCapabilities,
  detectProvider,
  resolveTierToModel,
  resolveComplexityTier,
  estimateCostMultiplier,
  getPhaseModelTier,
  pathExistsInternal,
  generateSlugInternal,
  getMilestoneInfo,
  toPosix,
  buildCachedContext,
  scanPendingTodos,
  scanSourceTodos,
};
