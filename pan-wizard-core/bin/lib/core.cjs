/**
 * Core — Shared utilities, constants, and internal helpers
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const {
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
} = require('./constants.cjs');
const { planningPath, planningRel } = require('./utils.cjs');

// ─── Multi-Model Routing ─────────────────────────────────────────────────────

/**
 * Provider-specific model name mapping for each tier alias.
 * Each provider maps reasoning/mid/fast to its native model identifiers.
 * "inherit" means the host runtime uses its own top-tier model selection.
 */
//
// Every non-inherit value must be a model id the host accepts: a Claude Code alias
// (sonnet, haiku) for Anthropic, otherwise a concrete API id that DEFAULT_RATES in
// cost.cjs prices exactly (tests/documented-default-models.test.cjs pins both).
// Until 2026-09-22 the OpenAI row held the literal strings 'mid' and 'fast', so a
// budget-profile project on Codex or OpenCode was told to spawn a model called
// "mid" (reality check R28).
//   - openai: Codex's subagent docs (learn.chatgpt.com/docs/agent-configuration/
//     subagents, read 2026-09-23): "start with gpt-6-sol. Use gpt-6-luna when you
//     want a faster, lower-cost option". gpt-6-astra is the flagship above both.
//   - google: the newest stable Flash and Flash-Lite on ai.google.dev's models page
//     (read 2026-09-23). The 2.5 family these rows used is "not deprecated" but
//     limited to users who have used it before, so a new project may not reach it.
const PROVIDER_MODELS = {
  anthropic: { reasoning: 'inherit', mid: 'sonnet',                 fast: 'haiku' },
  openai:    { reasoning: 'inherit', mid: 'gpt-6-sol',              fast: 'gpt-6-luna' },
  google:    { reasoning: 'inherit', mid: 'gemini-3.8-flash',       fast: 'gemini-3.5-flash-lite' },
  default:   { reasoning: 'inherit', mid: 'sonnet',                 fast: 'haiku' },
};

// OpenCode names every model `provider/model` — in agent frontmatter, in config and
// wherever a model is passed — and neither a bare API id nor a Claude Code alias
// (`sonnet`) is one. OpenCode's models doc: "the full ID is `provider_id/model_id`",
// with its built-in providers and ids taken from models.dev (anomalyco/opencode
// packages/web/src/content/docs/models.mdx and models.dev/api.json, both read
// 2026-09-26; every id below exists there under that provider). Same tiers as
// PROVIDER_MODELS, provider-qualified; `default` is Anthropic as it is there.
// Reality check R41.
const OPENCODE_MODELS = {
  anthropic: { reasoning: 'inherit', mid: 'anthropic/claude-sonnet-5', fast: 'anthropic/claude-haiku-4-5' },
  openai:    { reasoning: 'inherit', mid: 'openai/gpt-6-sol',          fast: 'openai/gpt-6-luna' },
  google:    { reasoning: 'inherit', mid: 'google/gemini-3.8-flash',   fast: 'google/gemini-3.5-flash-lite' },
  default:   { reasoning: 'inherit', mid: 'anthropic/claude-sonnet-5', fast: 'anthropic/claude-haiku-4-5' },
};

/**
 * The runtime whose copy of PAN is running, read from where this module is
 * installed: each runtime gets its own `pan-wizard-core`, so the copy under
 * `.opencode/` (project) or `~/.config/opencode/` (global) is only ever invoked by
 * OpenCode's commands. Only OpenCode is distinguished — it is the one runtime
 * whose model ids differ in form. A relocated `--config-dir` install is not
 * recognised and keeps the plain ids.
 * @param {string} [dir] - this module's directory (injectable for tests)
 * @returns {'opencode'|null}
 */
function hostRuntime(dir = __dirname) {
  const p = String(dir || '').replace(/\\/g, '/');
  return /(^|\/)\.?opencode\/pan-wizard-core\/bin\/lib\/?$/.test(p) ? 'opencode' : null;
}

/**
 * The provider prefix of OpenCode's own configured `model` (`"anthropic/…"`), from
 * the project's `opencode.json` or `.opencode/opencode.json`, when it is one PAN
 * routes for. Plain JSON only — a file that does not parse is skipped.
 * @param {string} cwd
 * @returns {'anthropic'|'openai'|'google'|null}
 */
function opencodeConfiguredProvider(cwd) {
  for (const rel of ['opencode.json', path.join('.opencode', 'opencode.json')]) {
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(path.join(cwd, rel), 'utf8')); } catch { continue; }
    const model = parsed && typeof parsed.model === 'string' ? parsed.model : '';
    const prefix = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
    if (prefix === 'anthropic' || prefix === 'openai' || prefix === 'google') return prefix;
  }
  return null;
}

/** Maps legacy Anthropic model names to provider-agnostic tier aliases. */
const LEGACY_ALIASES = { opus: 'reasoning', sonnet: 'mid', haiku: 'fast' };

/** Relative cost multipliers per tier (fast = 1× baseline). */
const COST_MULTIPLIERS = { reasoning: 15, mid: 3, fast: 1 };

// ─── Model Profile Table ─────────────────────────────────────────────────────

// COST RESET (2026-07): quality + balanced (the default) both resolve to the
// `reasoning` tier for EVERY agent — i.e. the DEFAULT model you launched with
// (`inherit`). PAN no longer silently demotes agents to cheaper models; context
// isolation (each subagent runs in its own window), not a cheaper model, is what
// keeps the main conversation clean. Cheapness is now OPT-IN: choose the `budget`
// profile (the only column that still down-tiers) or pin a specific agent via
// config `model_overrides`. The reviewer-class agents additionally pin `model: opus`
// in their own frontmatter (a native, deliberate exception). resolve-model /
// MODEL_PROFILES is advisory + cost-estimation; native Claude Code delegation
// reads each agent file's static `model:` (unset → inherit).
const MODEL_PROFILES = {
  // Original planning/execution agents (pre-v3.0)
  'pan-planner':              { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-designer':             { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-roadmapper':           { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-executor':             { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-phase-researcher':     { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-project-researcher':   { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-research-synthesizer': { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-debugger':             { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-document_code':        { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-verifier':             { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-plan-checker':         { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-design-checker':       { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-integration-checker':  { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-reviewer':             { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  // Spec B v2 agents (v3.0–v3.4) — added v3.7.5 to close MODEL_PROFILES drift
  'pan-conductor':            { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-counterfactual':       { quality: 'reasoning', balanced: 'reasoning', budget: 'mid' },
  'pan-hardener':             { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-meta-reviewer':        { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-knowledge':            { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-previewer':            { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  // v3.5 agents
  'pan-optimizer':            { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  'pan-distiller':            { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  // v3.7.0 self-improvement loop — observation-only watchdog
  'pan-experiment-runner':    { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
  // ADR-0033 bot-army — Release squad
  'pan-release':              { quality: 'reasoning', balanced: 'reasoning', budget: 'fast' },
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
  'pan-designer':             'xhigh',
  'pan-conductor':            'xhigh',
  'pan-debugger':             'xhigh',
  'pan-plan-checker':         'xhigh',
  'pan-design-checker':       'xhigh',
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
 * Explicit opt-in to exit 0 for a payload that carries an `error` key but is NOT
 * a failure — a legitimate empty/negative answer the caller must not treat as one.
 * Pass it as output()'s 4th argument so the intent is visible and greppable:
 *   `grep -rn "EXIT_OK" pan-wizard-core/bin` enumerates every documented exception.
 */
const EXIT_OK = 0;

/**
 * Names of the ERROR FAMILY: `error` itself, and any key ending in `_error`
 * (`worktree_error`, `drain_error`, `commit_error`). A renamed error key is still
 * an error key — that rename is exactly how this class escaped the first fix,
 * which matched the literal name `error` and therefore missed
 * `whatif prepare`'s `worktree_error` sitting three lines below a guard that
 * handled plain `ctx.error` correctly.
 *
 * Deliberately NOT in the family:
 *  - plural collections — `errors`, `schema_errors`, `error_patterns`. Those are
 *    the *detail* of a verdict payload (`{ passed, errors, warnings }`), and an
 *    empty array is truthy in JS, so matching them would make every clean
 *    `verify` run exit 1. Commands that gate on a verdict pass their code
 *    explicitly (see `links validate`, `doc-lint`).
 *  - counters — `error_count`, `total_errors_traced`.
 */
const ERROR_FAMILY_KEY = /(^|_)error$/;

/**
 * True when `result` reports a FAILURE: an object carrying a truthy own key in
 * the error family. `error: null` / `''` / `false` are "no error", so a payload
 * may carry the key unset without being reported as a failure.
 *
 * This is the ONLY shape that means "failure" to output(). See the exit-code
 * contract below for why no other shape is inferred.
 */
function reportsFailure(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return false;
  // Object.keys → own enumerable keys only: an inherited `error` is not ours,
  // and a nested `{ summary: { error } }` is data, not a top-level signal.
  for (const key of Object.keys(result)) {
    if (ERROR_FAMILY_KEY.test(key) && result[key]) return true;
  }
  return false;
}

/**
 * Write result to stdout and exit. JSON by default, or raw string if --raw flag is set.
 * Large JSON (>50KB) is written to a tmpfile with @file: prefix.
 *
 * ── EXIT-CODE CONTRACT (read before adding an output() call) ──
 * A payload carrying a truthy ERROR-FAMILY key (`error` or `*_error`) exits **1**
 * by default. That default is deliberate and must not be relaxed: PAN's own
 * orchestrators, hooks, CI steps and autonomous loops gate on the exit code, and an
 * error body delivered with exit 0 is a dead gate — invisible. (Historically every
 * `output({ error: … })` site exited 0, so `pan-tools state json` in a project with
 * no state.md printed `{"error":"state.md not found"}` and reported success. An
 * over-eager exit code is loud and gets fixed; a missed failure is silent, so
 * failure is the safe default.) The error body still goes to **stdout** — callers
 * parse it as before; only the exit code changed. `error()` remains the
 * stderr+exit-1 path for bare messages.
 *
 * Three ways to choose an exit code, in precedence order:
 *  1. Pass `exitCode` explicitly — for gates and verdicts whose payload has no
 *     error-family key (e.g. `campaign due` answering "not due",
 *     `verify stubs --gate`, `links validate`, `doc-lint`).
 *  2. Pass `EXIT_OK` — an error-keyed payload that is a legitimate empty/negative
 *     RESULT, not a failure. Every such site must carry a comment saying why.
 *  3. Pass nothing — derived: truthy error-family key ⇒ 1, otherwise 0.
 *
 * ── WHY THE DERIVATION STOPS AT THE ERROR FAMILY ──
 * PAN's other failure shape is `<verb>: false` plus a `reason`/`detail`. That shape
 * cannot be classified structurally, because the identical shape carries both
 * meanings — sometimes inside one function:
 *     { committed: false, reason: 'commit_failed' }            ← failure
 *     { committed: false, reason: 'skipped_commit_docs_false' } ← the user's own config
 *     { advanced: false, reason: 'last_plan' }                  ← normal end of phase
 *     { updated: false, reason: 'No plans found' }              ← nothing to sync
 *     { available: false, reason: 'BRAVE_API_KEY not set' }     ← capability absent
 *     { found: false, phase_number: 12 }                        ← the answer is "no"
 *     { clean: false, … } / { exists: false, … }                ← a state description
 * A rule like "false flag + a reason ⇒ failure" would turn all but the first into
 * failures, and a false failure is a NEW bug, as loud as the one it fixes. So the
 * classification is made per site, by the author, and recorded in the payload: a
 * site that reports a FAILURE gives its payload an error-family key, which routes
 * it through this one derivation — including payloads built by pure functions in
 * other modules and passed straight through by the dispatcher.
 *
 * Corollary for such sites: harden the value against emptiness
 * (`error: r.stderr || 'unknown git error'`). A subprocess that fails silently
 * yields `''`, and an empty string would launder the failure back into exit 0.
 *
 * @param {Object} result - The result object to serialize as JSON
 * @param {boolean} [raw] - If true and rawValue is provided, output rawValue as plain string
 * @param {string} [rawValue] - Plain string to output when raw mode is active
 * @param {number} [exitCode] - Explicit exit code; omit to derive it from the payload
 */
function output(result, raw, rawValue, exitCode) {
  if (raw && rawValue !== undefined) {
    process.stdout.write(String(rawValue));
  } else {
    const json = JSON.stringify(result, null, 2);
    // Large payloads exceed Claude Code's Bash tool buffer (~50KB).
    // Write to tmpfile and output the path prefixed with @file: so callers can detect it.
    if (json.length > MAX_JSON_SIZE) {
      // Create a fresh private directory (mkdtemp → unique, unguessable, owned
      // by us) and write inside it, so a pre-planted file or symlink on a
      // shared tmpdir can't be followed or overwritten.
      try {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pan-'));
        const tmpPath = path.join(tmpDir, 'out.json');
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
  process.exit(exitCode === undefined ? (reportsFailure(result) ? 1 : 0) : exitCode);
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
  const configPath = planningPath(cwd, 'config.json');
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
    nyquist_validation: false,
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
      // Written as workflow.nyquist_validation by config-ensure-section; loadConfig
      // never read it, so `init plan-phase` reported it off whatever the config said.
      nyquist_validation: get('nyquist_validation', { section: 'workflow', field: 'nyquist_validation' }) ?? defaults.nyquist_validation,
      parallelization,
      brave_search: get('brave_search') ?? defaults.brave_search,
      budget: parsed.budget || { default_points: 50, micro_threshold_tasks: 3, micro_threshold_files: 2, enforce: false },
      commit: parsed.commit || { safety_checks: true, conventional_types: true, sensitive_patterns: ['\\.env$', '\\.pem$', '\\.key$', 'credentials', 'secret', 'password', 'token'] },
      execution: parsed.execution || { default_mode: 'wave_order', rollback_snapshots: true, error_pattern_learning: true },
      focus: parsed.focus || { auto_commit: true },
      model_overrides: parsed.model_overrides || {},
      effort_overrides: parsed.effort_overrides || {},
      routing: parsed.routing || { strategy: 'static', provider: 'auto' },
      // Cost dashboard config: `cost.rates` per-model overrides (surfaced so the
      // documented override actually reaches cost.cjs — it was dropped before).
      cost: parsed.cost || {},
      // Prompt-cache config: `cache.extra_files` lets a project add its own
      // stable documents to the cached context block. Needed because the
      // built-in list is the phase-model spine, so a focus-model project had
      // an empty block and therefore no prompt caching at all.
      cache: parsed.cache || {},
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
      cost: {},
      cache: {},
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

  const phasesDir = planningPath(cwd, PHASES_DIR);
  const normalized = normalizePhaseName(phase);

  // Two-phase search strategy:
  // 1. Search the active phases directory (.planning/phases/) first.
  // 2. If not found, search archived milestone directories (.planning/milestones/v*-phases/)
  //    in reverse order (newest archive first) so the most recent match wins.
  const current = searchPhaseInDir(phasesDir, planningRel(PHASES_DIR), normalized);
  if (current) return current;

  // Search archived milestone phases (newest first)
  const milestonesDir = planningPath(cwd, MILESTONES_DIR);
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
      const relBase = planningRel(MILESTONES_DIR, archiveName);
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
  const milestonesDir = planningPath(cwd, MILESTONES_DIR);
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
          basePath: planningRel(MILESTONES_DIR, archiveName),
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
  const roadmapPath = planningPath(cwd, ROADMAP_FILE);

  try {
    const content = fs.readFileSync(roadmapPath, 'utf-8');
    // Normalize the phase number so a padded id ('01') still matches an
    // unpadded 'Phase 1:' heading (and vice-versa) — matching findPhaseInternal,
    // which accepts both forms. Strip leading zeros, then allow any zero-padding
    // in the heading via the `0*` prefix.
    const unpadded = phaseNum.toString().trim().replace(/^0+(?=\d)/, '');
    const escapedPhase = escapeRegex(unpadded);
    const phasePattern = new RegExp(`#{2,4}\\s*Phase\\s+0*${escapedPhase}:\\s*([^\\n]+)`, 'i');
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
 * Adjust a resolved tier given optional task capability hints.
 *
 * Rules, in priority order:
 *   1. context_estimate > LARGE_CONTEXT_TOKEN_THRESHOLD → force reasoning.
 *   2. needs_thinking → upgrade fast → mid; leave mid/reasoning alone.
 *   3. cache_warm + !needs_thinking + context_estimate < SMALL_CONTEXT_TOKEN_THRESHOLD →
 *      allow downgrade mid → fast (cheap, cached, simple tasks don't need mid).
 *
 * These are TIER hints, not capability facts. `reasoning` resolves to `inherit`
 * on Anthropic (see PROVIDER_MODELS above), so rule 1 asks the host runtime for
 * its own top-tier model — it neither selects a large-context model nor checks
 * that the session model has one. PAN never probes the running model's real
 * context window or feature set; nothing here is a gate.
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

// ─── Failure-tier escalation (market-ideas queue M8, MI-029) ────────────────
//
// A retry of work that already failed once on a cheaper tier should not run on
// that tier again. Three peers converged on the same rule (gsd-core's
// dynamic_routing.escalate_on_failure, Superpowers' "more capable model" after
// repeated failures, HydraFusion's cascade); PAN only chose a tier BEFORE a run.
// Each failed attempt now raises the tier one step up this ladder, capped by
// `routing.max_escalations` and never above the agent's own `quality` tier —
// so under `quality` and `balanced`, where every agent already runs on the
// reasoning tier, escalation is a no-op; it is the `budget` profile's retry path.
const TIER_LADDER = Object.freeze(['fast', 'mid', 'reasoning']);
const DEFAULT_MAX_ESCALATIONS = 1;

/**
 * Pure: the tier for the given attempt.
 * @param {string} tier - the tier the profile/routing chose (legacy names accepted)
 * @param {number} attempt - 1 for the first try; each later attempt follows a failure
 * @param {{maxEscalations?: number, ceiling?: string}} [opts]
 * @returns {{tier: string, escalated_from: string|null}}
 */
function escalateTier(tier, attempt, opts = {}) {
  const from = LEGACY_ALIASES[tier] || tier;
  const max = Number.isInteger(opts.maxEscalations) && opts.maxEscalations >= 0 ? opts.maxEscalations : DEFAULT_MAX_ESCALATIONS;
  const ceiling = TIER_LADDER.indexOf(LEGACY_ALIASES[opts.ceiling] || opts.ceiling || 'reasoning');
  const at = TIER_LADDER.indexOf(from);
  const steps = Math.min(Number.isInteger(attempt) && attempt > 1 ? attempt - 1 : 0, max);
  if (at === -1 || ceiling === -1 || steps === 0 || at >= ceiling) return { tier: from, escalated_from: null };
  const to = Math.min(at + steps, ceiling);
  return { tier: TIER_LADDER[to], escalated_from: to > at ? from : null };
}

/**
 * Resolve the model for a given agent type based on profile, provider, and routing strategy.
 * Returns "inherit" for reasoning-tier to let the host runtime use its top-tier model.
 * @param {string} cwd - Project root directory
 * @param {string} agentType - Agent name (e.g., "pan-planner", "pan-executor")
 * @param {Object} [taskMetadata] - Optional metadata. Supports complexity fields and
 *   capability hints: {context_estimate, needs_thinking, cache_warm}.
 * @returns {string} Model identifier: "inherit", a Claude Code alias ("sonnet", "haiku"), or a provider model id from PROVIDER_MODELS
 */
function resolveModelInternal(cwd, agentType, taskMetadata) {
  return resolveModelDetailed(cwd, agentType, taskMetadata).model;
}

/**
 * resolveModelInternal with its reasoning: the tier, and — when `taskMetadata.attempt`
 * raised it (M8) — the tier it was escalated from. Explicit pins (a model_overrides
 * entry, a roadmap per-phase tier) are the user's choice and are never escalated.
 * @returns {{model: string, tier: string|null, escalated_from: string|null}}
 */
function resolveModelDetailed(cwd, agentType, taskMetadata) {
  const config = loadConfig(cwd);
  const provider = detectProvider(cwd, config);
  const pinned = (tier) => ({ model: resolveTierToModel(tier, provider), tier: LEGACY_ALIASES[tier] || tier, escalated_from: null });

  // Check per-agent override first (highest priority)
  const override = config.model_overrides?.[agentType];
  if (override) {
    return pinned(override);
  }

  // Check per-phase override from roadmap (second priority)
  if (taskMetadata?.phaseNum) {
    const phaseTier = getPhaseModelTier(cwd, taskMetadata.phaseNum);
    if (phaseTier) {
      return pinned(phaseTier);
    }
  }

  // Fall back to profile lookup
  const profile = config.model_profile || 'balanced';
  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) return pinned('mid');

  let tier = agentModels[profile] || agentModels['balanced'] || 'mid';

  // Apply routing strategy
  const strategy = config.routing?.strategy || 'static';
  if (strategy === 'complexity' && taskMetadata) {
    const thresholds = config.routing?.complexity_thresholds;
    tier = resolveComplexityTier(tier, { ...taskMetadata, thresholds });
  }

  // Capability-hint adjustment (only when hints are present)
  if (taskMetadata && (
    taskMetadata.context_estimate !== undefined ||
    taskMetadata.needs_thinking !== undefined ||
    taskMetadata.cache_warm !== undefined
  )) {
    tier = adjustTierForCapabilities(tier, taskMetadata);
  }

  // Failure-tier escalation: a retry climbs toward the agent's quality tier (M8).
  let escalatedFrom = null;
  if (taskMetadata && Number.isInteger(taskMetadata.attempt) && taskMetadata.attempt > 1) {
    const maxEscalations = config.routing?.max_escalations;
    const esc = escalateTier(tier, taskMetadata.attempt, {
      maxEscalations: Number.isInteger(maxEscalations) ? maxEscalations : DEFAULT_MAX_ESCALATIONS,
      ceiling: agentModels.quality || 'reasoning',
    });
    tier = esc.tier;
    escalatedFrom = esc.escalated_from;
  }

  return { model: resolveTierToModel(tier, provider), tier: LEGACY_ALIASES[tier] || tier, escalated_from: escalatedFrom };
}

/**
 * Detect the LLM provider from config, environment, or runtime directory presence.
 * @param {string} cwd - Project root directory
 * @param {Object} config - Loaded config object
 * @returns {string} Provider name: "anthropic", "openai", "google", or "default"
 */
function detectProvider(cwd, config, host = hostRuntime()) {
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
  // 3. Under OpenCode, the provider of OpenCode's own configured model — OpenCode
  //    runs any provider, so a `.opencode` directory says nothing about which.
  if (host === 'opencode') {
    const p = opencodeConfiguredProvider(cwd);
    if (p) return p;
  }
  // 4. Runtime directory detection
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
 * @param {string|null} [host] - hostRuntime(); OpenCode gets `provider/model` ids
 * @returns {string} Provider-specific model name
 */
function resolveTierToModel(tier, provider, host = hostRuntime()) {
  const normalizedTier = LEGACY_ALIASES[tier] || tier;
  const table = host === 'opencode' ? OPENCODE_MODELS : PROVIDER_MODELS;
  const providerMap = table[provider] || table['default'];
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
 * Match a milestone HEADING — a markdown heading line that carries a version.
 *
 * Anchored to line start and allowing `#{1,6}`, because the previous pattern
 * (`/## .*v\d+\.\d+.../`, unanchored) matched inside `### ` headings AND inside
 * body prose, which is how a version could be read out of a sentence.
 */
const MILESTONE_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.*\bv\d+(?:\.\d+)+\b.*?)[ \t]*$/;

/** Collapsed shipped milestones live in `<summary>` lines, not headings. */
const MILESTONE_SUMMARY_RE = /^[ \t]*<summary>(.*\bv\d+(?:\.\d+)+\b.*?)<\/summary>[ \t]*$/;

/** Status markers PAN's own roadmap template emits, plus their prose forms. */
const MILESTONE_STATUS_MARKERS = [
  { status: 'shipped', re: /✅|\bshipped\b|\bcomplete[d]?\b|\bdone\b|\bclosed\s+\d{4}-\d{2}-\d{2}/i },
  // `current` is matched as a word anywhere in the heading, not as the whole
  // parenthetical: real roadmaps write "(current, phases 1–10)", and requiring
  // an exact "(current)" silently missed the marker and fell through to
  // positional guessing — the failure mode this resolver exists to remove.
  { status: 'current', re: /🚧|\bcurrent\b|\bin[-\s]progress\b|\bactive\b/i },
  { status: 'planned', re: /📋|\bplanned\b|\bupcoming\b|\bfuture\b/i },
];

/**
 * Parse every milestone heading in a roadmap into {version, name, status}.
 *
 * Version and name are taken from THE SAME heading — the whole point. Reading
 * them with two independent whole-document regexes let a version from one
 * milestone pair with a name from another and produce a milestone that does not
 * exist, with nothing in the output to suggest anything had gone wrong.
 *
 * @param {string} roadmap - full roadmap.md text
 * @returns {Array<{version: string, name: string, status: string, line: number, heading: string}>}
 */
function parseMilestoneHeadings(roadmap) {
  const out = [];
  const byLabel = new Map();
  const lines = String(roadmap || '').split(/\r?\n/);

  lines.forEach((line, i) => {
    const m = line.match(MILESTONE_HEADING_RE) || line.match(MILESTONE_SUMMARY_RE);
    const plain = m ? null : line.match(ANY_HEADING_RE);
    const heading = m ? m[1] : plain ? plain[1] : null;
    if (!heading) return;

    // A version (`v4.1`) anywhere in the heading, or a letter-series label (`R-2`)
    // as its first word. The resolver used to know only the first, so a project
    // naming its milestones R-1, R-2 … had none, and every reader fell back to a
    // made-up `v1.0`.
    const versionMatch = m ? heading.match(/\bv(\d+(?:\.\d+)+)\b/) : null;
    const label = versionMatch ? `v${versionMatch[1]}` : seriesLabel(heading);
    if (!label) return;

    let status = 'unknown';
    for (const marker of MILESTONE_STATUS_MARKERS) {
      if (marker.re.test(heading)) { status = marker.status; break; }
    }
    // A <summary> heading is a collapsed, already-shipped milestone even when
    // it carries no explicit marker.
    if (status === 'unknown' && MILESTONE_SUMMARY_RE.test(line)) status = 'shipped';

    // One milestone per label. A roadmap that repeats a heading (a traceability
    // or archive section) used to count each repeat as another milestone — and an
    // unmarked repeat of a shipped one as UNSHIPPED work. The first heading keeps
    // its place and name; a later one only fills in a status the first lacked.
    const seen = byLabel.get(label);
    if (seen) {
      if (seen.status === 'unknown' && status !== 'unknown') seen.status = status;
      return;
    }
    const entry = {
      version: label,
      name: extractMilestoneName(heading, versionMatch ? versionMatch[0] : label),
      status,
      line: i + 1,
      heading: heading.trim(),
    };
    byLabel.set(label, entry);
    out.push(entry);
  });

  return out;
}

/** Any markdown heading line — letter-series milestones carry no `vN.N`. */
const ANY_HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+(.*?)[ \t]*$/;

/** A letter-series milestone label: one to three capitals, a hyphen, one to three capitals or digits. */
const SERIES_LABEL_RE = /^[A-Z]{1,3}-[A-Z0-9]{1,3}$/;

/**
 * The letter-series label a heading opens with — after status glyphs, emphasis
 * and an optional "Milestone" — or null. Only the FIRST word counts, so a label
 * mentioned inside a heading's text does not make the heading a milestone.
 */
function seriesLabel(heading) {
  const text = String(heading)
    .replace(/\p{Extended_Pictographic}️?/gu, ' ')
    .replace(/[*_`]+/g, '')
    .trim()
    .replace(/^milestone\s+/i, '');
  const first = (text.match(/^([^\s:·—–(]+)/) || [])[1] || '';
  return SERIES_LABEL_RE.test(first) ? first : null;
}

/**
 * Order two milestone labels: numerically for `vN.N`, by series then position for
 * letter-series labels. 0 when they cannot be compared (mixed kinds).
 */
function compareMilestoneLabels(a, b) {
  const num = (v) => { const m = /^v(\d+(?:\.\d+)*)$/.exec(v); return m ? m[1].split('.').map(Number) : null; };
  const na = num(a), nb = num(b);
  if (na && nb) {
    for (let i = 0; i < Math.max(na.length, nb.length); i++) {
      const d = (na[i] || 0) - (nb[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  const ser = (v) => /^([A-Z]{1,3})-([A-Z0-9]{1,3})$/.exec(v);
  const sa = ser(a), sb = ser(b);
  if (sa && sb && sa[1] === sb[1]) return sa[2].localeCompare(sb[2], 'en', { numeric: true });
  return 0;
}

/**
 * Reduce a milestone heading to its bare name.
 * "### 🚧 Milestone v4.1 — Full Platform (phases 1–12)" → "Full Platform"
 *
 * @param {string} heading - heading text with the leading #'s already stripped
 * @param {string} versionToken - the matched version, e.g. "v4.1"
 * @returns {string} the name, or '' when the heading carries none
 */
function extractMilestoneName(heading, versionToken) {
  let name = heading;
  name = name.split(versionToken).slice(1).join(versionToken); // everything after the version
  name = name.replace(/\([^)]*\)/g, ' ');                      // "(current)", "(phases 1–12)"
  name = name.replace(/<\/?[^>]+>/g, ' ');                     // stray inline tags
  name = name.replace(/[*_`]+/g, '');                          // markdown emphasis
  name = name.replace(/\p{Extended_Pictographic}️?/gu, ' ');  // ✅ 🚧 📋 status glyphs
  name = name.replace(/^[\s:·—–\-–]+/, '').replace(/[\s:·—–\-–]+$/, '');
  // "Shipped: 2025-11-25" / "CLOSED 2026-08-21" style trailers add nothing to the name,
  // and neither does a "— Phases 19-22" range.
  name = name.replace(/\b(shipped|completed?|done|closed)\b[:\s]*\d{4}-\d{2}-\d{2}\s*$/i, '').trim();
  name = name.replace(/[\s·—–-]*\bphases?\s+\d+(?:\.\d+)?\s*[-–—]\s*\d+(?:\.\d+)?\s*$/i, '').trim();
  name = name.replace(/[\s:·—–-]+$/, '');
  return name.trim();
}

/**
 * Pick the CURRENT milestone from parsed headings.
 *
 * Order of preference:
 *   1. a heading explicitly marked in-progress (🚧 / "(current)" / "in progress")
 *   2. the first heading that is not shipped — work not yet done
 *   3. the last shipped heading — everything is done, so the newest is current
 *
 * @param {Array} headings - from parseMilestoneHeadings()
 * @returns {{milestone: Object|null, ambiguous: boolean, basis: string}}
 */
function selectCurrentMilestone(headings) {
  if (!headings.length) return { milestone: null, ambiguous: false, basis: 'none' };

  const current = headings.filter(h => h.status === 'current');
  if (current.length) {
    // More than one milestone marked current is a planning-state error, not
    // something to resolve silently — report it alongside the pick.
    return { milestone: current[0], ambiguous: current.length > 1, basis: 'marked-current' };
  }

  const unshipped = headings.find(h => h.status !== 'shipped');
  if (unshipped) return { milestone: unshipped, ambiguous: false, basis: 'first-unshipped' };

  // Everything shipped: the newest is the HIGHEST label, not the last in document
  // order — a roadmap listing milestones newest-first put the oldest last.
  let newest = headings[headings.length - 1];
  for (const h of headings) if (compareMilestoneLabels(h.version, newest.version) > 0) newest = h;
  return { milestone: newest, ambiguous: false, basis: 'last-shipped' };
}

/**
 * Extract the current milestone's version and name from roadmap.md.
 *
 * Both values come from a single heading — see parseMilestoneHeadings() for why
 * that constraint is the whole fix.
 *
 * @param {string} cwd - Project root directory
 * @returns {{version: string, name: string, status: string, basis: string, ambiguous: boolean, candidates: number}}
 *   Milestone info (defaults: v1.0, "milestone")
 */
/**
 * `milestone:` / `milestone_name:` from state.md's front matter, or null. Read
 * inline (frontmatter.cjs requires this module, so it cannot be required here).
 */
function recordedStateMilestone(cwd) {
  let text;
  try { text = fs.readFileSync(planningPath(cwd, 'state.md'), 'utf-8'); } catch { return null; }
  const block = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  if (!block) return null;
  const field = (key) => {
    const m = block[1].match(new RegExp(`^${key}:[ \\t]*(.+)$`, 'm'));
    return m ? m[1].trim().replace(/^(['"])(.*)\1$/, '$2') : null;
  };
  const version = field('milestone');
  return version ? { version, name: field('milestone_name') } : null;
}

function getMilestoneInfo(cwd) {
  const fallback = { version: 'v1.0', name: 'milestone', status: 'unknown', basis: 'default', ambiguous: false, candidates: 0 };
  let roadmap;
  try {
    roadmap = fs.readFileSync(planningPath(cwd, ROADMAP_FILE), 'utf-8');
  } catch {
    return fallback;
  }

  const headings = parseMilestoneHeadings(roadmap);
  const { milestone, ambiguous, basis } = selectCurrentMilestone(headings);
  if (!milestone) {
    // No milestone heading: what state.md records beats a constant. The resolver
    // used to return `v1.0` / `milestone` here, so correcting state.md's
    // `milestone:` changed nothing — the fallback never read it.
    const recorded = recordedStateMilestone(cwd);
    if (recorded) return { version: recorded.version, name: recorded.name || 'milestone', status: 'unknown', basis: 'state', ambiguous: false, candidates: 0 };
    return { ...fallback, basis: 'no-milestone-heading' };
  }

  return {
    version: milestone.version,
    name: milestone.name || 'milestone',
    status: milestone.status,
    basis,
    ambiguous,
    candidates: headings.length,
  };
}

/**
 * Scan pending todos directory and return matching items.
 * @param {string} cwd - Project root
 * @param {string|null} area - Optional area filter
 * @returns {{ count: number, todos: Array<{file: string, created: string, title: string, area: string, path: string}> }}
 */
function scanPendingTodos(cwd, area) {
  const pendingDir = planningPath(cwd, 'todos', 'pending');
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
          path: planningRel('todos', 'pending', file),
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
  const { CACHEABLE_CONTEXT_FILES } = require('./constants.cjs');
  const crypto = require('crypto');
  const blocks = [];
  let totalBytes = 0;
  const hasher = crypto.createHash('sha256');

  // The built-in list is the PHASE-model spine. A focus-model project has none
  // of those files, so its cached block came out empty and it silently received
  // no prompt caching at all. `cache.extra_files` lets such a project name its
  // own stable documents rather than PAN inventing a convention it doesn't
  // otherwise define.
  //
  // Entries are planning-root-relative, must stay inside it, and are appended
  // after the built-ins so the prefix stays byte-stable for projects that set
  // nothing — changing the prefix would invalidate every existing cache key.
  const extra = [];
  try {
    const configured = loadConfig(cwd)?.cache?.extra_files;
    if (Array.isArray(configured)) {
      for (const entry of configured) {
        if (typeof entry !== 'string' || !entry.trim()) continue;
        const rel = entry.trim().replace(/\\/g, '/');
        // Inline literal guard: a cache entry must not escape the planning root
        // or reach an absolute path. Checked here rather than via a helper
        // because static analysis does not follow guards across functions.
        if (rel.startsWith('/') || rel.startsWith('\\') || /^[A-Za-z]:/.test(rel)) continue;
        if (rel.split('/').includes('..')) continue;
        if (CACHEABLE_CONTEXT_FILES.includes(rel) || extra.includes(rel)) continue;
        extra.push(rel);
      }
    }
  } catch { /* unreadable config — built-ins only */ }

  for (const file of [...CACHEABLE_CONTEXT_FILES, ...extra]) {
    const abs = planningPath(cwd, file);
    try {
      const content = fs.readFileSync(abs, 'utf-8');
      blocks.push({ path: planningRel(file), content, cache: true });
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
  OPENCODE_MODELS,
  hostRuntime,
  LEGACY_ALIASES,
  COST_MULTIPLIERS,
  output,
  EXIT_OK,
  reportsFailure,
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
  resolveModelDetailed,
  escalateTier,
  TIER_LADDER,
  adjustTierForCapabilities,
  detectProvider,
  resolveTierToModel,
  resolveComplexityTier,
  estimateCostMultiplier,
  getPhaseModelTier,
  pathExistsInternal,
  generateSlugInternal,
  getMilestoneInfo,
  parseMilestoneHeadings,
  selectCurrentMilestone,
  extractMilestoneName,
  MILESTONE_HEADING_RE,
  toPosix,
  buildCachedContext,
  scanPendingTodos,
  scanSourceTodos,
};
