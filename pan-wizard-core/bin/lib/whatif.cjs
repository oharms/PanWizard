/**
 * Whatif — counterfactual phase exploration (Spec B v2 Y-4, v3.3).
 *
 * Creates an isolated git worktree, lets an agent replay a phase with a
 * different premise, emits a comparison report, and cleans up.
 *
 * The module has two concerns:
 *   1. **Data layer** (pure, testable without git): context gathering,
 *      report generation, scenario normalization.
 *   2. **Worktree lifecycle** (shell-out): createWorktree, cleanupWorktree.
 *      Exercised only on real git repos; testable via scenario tests that
 *      git-init a temp project.
 *
 * Default worktree location: `<cwd>/../pan-whatif-<phase>-<scenario-slug>-<ts>`
 * (sibling of the main repo, not inside, to avoid `.gitignore` games).
 * Override via opts.worktree_root.
 */

const fs = require('fs');
const path = require('path');
const { output, error, safeReadFile, isGitRepo, execGit, toPosix, findPhaseInternal } = require('./core.cjs');
const { PLANNING_DIR } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

const COUNTERFACTUALS_DIR = 'counterfactuals';
const BRANCH_PREFIX = 'pan-whatif/';
const SCENARIO_SLUG_MAX = 50;

// ─── Data layer ─────────────────────────────────────────────────────────────

/**
 * Turn a free-text scenario into a filesystem/branch-safe slug.
 * Lowercase, alphanumerics + hyphens only, bounded length.
 *
 * @param {string} scenario
 * @returns {string}
 */
function scenarioSlug(scenario) {
  if (typeof scenario !== 'string') return 'scenario';
  const slug = scenario
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SCENARIO_SLUG_MAX);
  return slug || 'scenario';
}

/**
 * Gather context the counterfactual agent needs: phase plan, goal, the
 * stated alternative scenario, and (optional) the completed summary so
 * the agent can compare "what actually happened" vs "what would have happened".
 *
 * @param {string} cwd - Project root
 * @param {string|number} phaseNum - Phase identifier
 * @param {string} scenario - Free-text alternative premise
 * @returns {Object} Context payload
 */
function buildCounterfactualContext(cwd, phaseNum, scenario) {
  if (!scenario || !scenario.trim()) {
    return { error: 'scenario required (free-text alternative premise)' };
  }
  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo || !phaseInfo.found) {
    return { error: `Phase ${phaseNum} not found in .planning/phases/` };
  }

  const phaseDir = path.join(cwd, phaseInfo.directory);
  const plans = (phaseInfo.plans || []).sort();
  const summaries = (phaseInfo.summaries || []).sort();

  const planTexts = plans.map(f => ({
    file: f,
    bytes: Buffer.byteLength(safeReadFile(path.join(phaseDir, f)) || '', 'utf-8'),
  }));
  const summaryTexts = summaries.map(f => ({
    file: f,
    bytes: Buffer.byteLength(safeReadFile(path.join(phaseDir, f)) || '', 'utf-8'),
  }));

  return {
    phase: String(phaseNum),
    phase_name: phaseInfo.name || null,
    directory: toPosix(phaseInfo.directory),
    scenario,
    slug: scenarioSlug(scenario),
    plans: planTexts,
    summaries: summaryTexts,
    has_executed: summaries.length > 0,
  };
}

/**
 * Serialize a counterfactual comparison to a markdown report.
 *
 * @param {string} cwd - Project root
 * @param {string} phaseNum - Phase number
 * @param {string} scenario - Original scenario text
 * @param {Object} comparison - {summary, differences, recommendations, risks}
 * @param {Object} [opts] - {timestamp}
 * @returns {{written: true, file: string}|{error: string}}
 */
function writeCounterfactualReport(cwd, phaseNum, scenario, comparison, opts) {
  if (!phaseNum) return { error: 'phaseNum required' };
  if (!scenario || !scenario.trim()) return { error: 'scenario required' };

  const dir = path.join(planningPath(cwd), COUNTERFACTUALS_DIR);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { error: `Failed to create ${dir}: ${e.message}` };
  }

  const slug = scenarioSlug(scenario);
  const filename = `${phaseNum}-${slug}.md`;
  const file = path.join(dir, filename);

  const lines = [];
  lines.push('---');
  lines.push('type: counterfactual');
  lines.push(`phase: ${phaseNum}`);
  lines.push(`scenario_slug: ${slug}`);
  lines.push(`generated: ${opts?.timestamp || new Date().toISOString()}`);
  lines.push('---');
  lines.push('');
  lines.push(`# What-if: Phase ${phaseNum} — ${scenario}`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(comparison?.summary || '_(agent did not produce a summary)_');
  lines.push('');

  if (Array.isArray(comparison?.differences) && comparison.differences.length > 0) {
    lines.push('## Differences from actual plan');
    lines.push('');
    for (const d of comparison.differences) {
      lines.push(`- ${d}`);
    }
    lines.push('');
  }

  if (Array.isArray(comparison?.recommendations) && comparison.recommendations.length > 0) {
    lines.push('## Recommendations');
    lines.push('');
    for (const r of comparison.recommendations) {
      lines.push(`- ${r}`);
    }
    lines.push('');
  }

  if (Array.isArray(comparison?.risks) && comparison.risks.length > 0) {
    lines.push('## Risks');
    lines.push('');
    for (const risk of comparison.risks) {
      lines.push(`- ${risk}`);
    }
    lines.push('');
  }

  if (comparison?.verdict) {
    lines.push('## Bottom line');
    lines.push('');
    lines.push(`**${comparison.verdict}**`);
    lines.push('');
  }

  try {
    fs.writeFileSync(file, lines.join('\n'), 'utf-8');
  } catch (e) {
    return { error: `Failed to write ${file}: ${e.message}` };
  }

  return { written: true, file: toPosix(path.relative(cwd, file)) };
}

// ─── Worktree lifecycle (git shell-out) ────────────────────────────────────

/**
 * Create an isolated git worktree for counterfactual replay.
 *
 * @param {string} cwd - Main project root
 * @param {string} phaseNum - Phase number (used in branch name)
 * @param {string} scenario - Free-text scenario (slugified for paths)
 * @param {Object} [opts] - {worktree_root, base}
 * @returns {{worktree_path: string, branch: string, base: string}|{error: string}}
 */
function createWorktree(cwd, phaseNum, scenario, opts) {
  if (!isGitRepo(cwd)) {
    return { error: 'Not a git repo — what-if requires git worktree support' };
  }
  const slug = scenarioSlug(scenario);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const branch = `${BRANCH_PREFIX}${phaseNum}-${slug}-${ts.slice(0, 15)}`;
  const worktreeRoot = opts?.worktree_root
    || path.join(path.dirname(cwd), `pan-whatif-${phaseNum}-${slug}-${ts.slice(0, 15)}`);

  // Base ref: current HEAD by default. Callers can override (e.g. to branch
  // off main for a clean comparison).
  const base = opts?.base || 'HEAD';

  const result = execGit(cwd, ['worktree', 'add', '-b', branch, worktreeRoot, base]);
  if (result.exitCode !== 0) {
    return { error: `git worktree add failed: ${result.stderr}` };
  }

  return {
    worktree_path: toPosix(worktreeRoot),
    branch,
    base,
  };
}

/**
 * Remove a worktree + its branch. Best-effort: errors are surfaced but
 * don't block subsequent cleanups.
 *
 * @param {string} cwd - Main project root (for the cleanup git call)
 * @param {string} worktreePath - Path returned by createWorktree
 * @param {string} branch - Branch name returned by createWorktree
 * @param {Object} [opts] - {force: boolean}
 * @returns {{removed: true, warnings: string[]}|{error: string}}
 */
function cleanupWorktree(cwd, worktreePath, branch, opts) {
  if (!isGitRepo(cwd)) {
    return { error: 'Not a git repo' };
  }
  const warnings = [];
  const force = opts?.force === true;

  const rmArgs = ['worktree', 'remove'];
  if (force) rmArgs.push('--force');
  rmArgs.push(worktreePath);
  const removeResult = execGit(cwd, rmArgs);
  if (removeResult.exitCode !== 0) {
    warnings.push(`worktree remove: ${removeResult.stderr}`);
  }

  // Branch cleanup — only if branch still exists.
  if (branch) {
    const branchCheck = execGit(cwd, ['branch', '--list', branch]);
    if (branchCheck.exitCode === 0 && branchCheck.stdout.trim()) {
      const deleteResult = execGit(cwd, ['branch', '-D', branch]);
      if (deleteResult.exitCode !== 0) {
        warnings.push(`branch delete: ${deleteResult.stderr}`);
      }
    }
  }

  return { removed: true, warnings };
}

// ─── CLI wrappers ───────────────────────────────────────────────────────────

function cmdWhatifPrepare(cwd, phaseNum, scenario, raw) {
  // Returns context + creates worktree. Called before spawning agent.
  if (!scenario) error('Usage: whatif prepare <phase> <scenario>');
  const ctx = buildCounterfactualContext(cwd, phaseNum, scenario);
  if (ctx.error) { output(ctx, raw); return; }
  const wt = createWorktree(cwd, phaseNum, scenario);
  if (wt.error) { output({ ...ctx, worktree_error: wt.error }, raw); return; }
  output({ ...ctx, worktree: wt }, raw);
}

function cmdWhatifReport(cwd, phaseNum, scenario, comparisonJson, raw) {
  if (!scenario) error('Usage: whatif report <phase> <scenario> --comparison <json>');
  let comparison = {};
  if (comparisonJson) {
    try { comparison = JSON.parse(comparisonJson); }
    catch (e) { error(`Invalid --comparison JSON: ${e.message}`); }
  }
  output(writeCounterfactualReport(cwd, phaseNum, scenario, comparison), raw);
}

function cmdWhatifCleanup(cwd, worktreePath, branch, force, raw) {
  if (!worktreePath) error('Usage: whatif cleanup --worktree <path> --branch <name> [--force]');
  output(cleanupWorktree(cwd, worktreePath, branch, { force: Boolean(force) }), raw);
}

module.exports = {
  scenarioSlug,
  buildCounterfactualContext,
  writeCounterfactualReport,
  createWorktree,
  cleanupWorktree,
  cmdWhatifPrepare,
  cmdWhatifReport,
  cmdWhatifCleanup,
  COUNTERFACTUALS_DIR,
  BRANCH_PREFIX,
};
