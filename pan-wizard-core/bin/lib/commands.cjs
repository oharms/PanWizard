/**
 * Commands -- Standalone utility commands
 */
const fs = require('fs');
const path = require('path');
const { safeReadFile, loadConfig, isGitIgnored, isGitRepo, execGit, normalizePhaseName, comparePhaseNum, getArchivedPhaseDirs, generateSlugInternal, getMilestoneInfo, resolveModelInternal, resolveEffortInternal, detectProvider, resolveTierToModel, estimateCostMultiplier, MODEL_PROFILES, output, error, findPhaseInternal, scanPendingTodos, toPosix } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { PLANNING_DIR, PHASES_DIR, MILESTONES_DIR, QUICK_DIR, STATE_FILE, ROADMAP_FILE, PROJECT_FILE, PATTERNS_FILE, SESSION_HISTORY_FILE, LEARNINGS_FILE, CONTEXT_SUFFIX, UAT_SUFFIX, VERIFICATION_SUFFIX, isPlanFile, isSummaryFile, ARCHIVE_DIR_RE, PHASE_DIR_RE, CONTEXT_WINDOW, WARNING_THRESHOLD, CRITICAL_THRESHOLD, VALID_COMMIT_TYPES, DEFAULT_SENSITIVE_PATTERNS } = require('./constants.cjs');
const { planningPath, phasesPath, filterPlanFiles, filterSummaryFiles } = require('./utils.cjs');
const { estimateTokens } = require('./context-budget.cjs');
const { collectPhaseSummaries, readErrorPatterns, appendErrorPattern, appendSessionSummary, parseLearnings, formatLearningEntry, cmdLearningsExtract, cmdLearningsList, cmdLearningsPrune } = require('./commands-learnings.cjs');

/**
 * Generate a URL-safe slug from text by lowercasing and replacing non-alphanumeric chars.
 * @param {string} text - Text to convert to a slug
 * @param {boolean} raw - If true, output raw slug string instead of JSON
 * @returns {void}
 */
function cmdGenerateSlug(text, raw) {
  if (!text) {
    error('text required for slug generation');
  }

  // Delegate to core's shared slug generator to avoid duplicate logic
  const slug = generateSlugInternal(text);

  const result = { slug };
  output(result, raw, slug);
}

/**
 * Output the current timestamp in the specified format (date, filename, or full ISO).
 * @param {string} format - Output format: "date", "filename", or "full" (default)
 * @param {boolean} raw - If true, output raw timestamp string instead of JSON
 * @returns {void}
 */
function cmdCurrentTimestamp(format, raw) {
  const now = new Date();
  let result;

  switch (format) {
    case 'date':
      result = now.toISOString().split('T')[0];
      break;
    case 'filename':
      result = now.toISOString().replace(/:/g, '-').replace(/\..+/, '');
      break;
    case 'full':
    default:
      result = now.toISOString();
      break;
  }

  output({ timestamp: result }, raw, result);
}

/**
 * List pending todo items with optional area filtering.
 * @param {string} cwd - Working directory path
 * @param {string} area - Optional area filter (e.g., "general", "security")
 * @param {boolean} raw - If true, output raw count string instead of JSON
 * @returns {void}
 */
function cmdListTodos(cwd, area, raw) {
  const result = scanPendingTodos(cwd, area);
  output(result, raw, result.count.toString());
}

/**
 * Check if a file or directory exists and report its type.
 * @param {string} cwd - Working directory path
 * @param {string} targetPath - Path to verify (absolute or relative to cwd)
 * @param {boolean} raw - If true, output "true" or "false" instead of JSON
 * @returns {void}
 */
function cmdVerifyPathExists(cwd, targetPath, raw) {
  if (!targetPath) {
    error('path required for verification');
  }

  const fullPath = path.isAbsolute(targetPath) ? targetPath : path.join(cwd, targetPath);

  try {
    const stats = fs.statSync(fullPath);
    const type = stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other';
    const result = { exists: true, type };
    output(result, raw, 'true');
  } catch {
    // Path does not exist or is inaccessible
    const result = { exists: false, type: null };
    output(result, raw, 'false');
  }
}

// ---- History digest helper functions ----------------------------------------

// collectPhaseSummaries — extracted to commands-learnings.cjs (imported above)

/**
 * Aggregate tech stack entries from all summary frontmatters into a unified Set.
 *
 * Tech stack merging logic:
 * - Each summary may have a `tech-stack.added` array in its frontmatter
 * - Array entries can be plain strings ("prisma") or objects with a `name` field ({name: "prisma"})
 * - All entries are collected into a Set to deduplicate across phases
 *
 * @param {Array<{phaseNum: string, dirName: string, frontmatter: Object}>} summaries
 * @returns {Set<string>} Deduplicated set of technology names
 */
function mergeTechStack(summaries) {
  const techStack = new Set();

  for (const { frontmatter } of summaries) {
    if (frontmatter['tech-stack'] && frontmatter['tech-stack'].added) {
      frontmatter['tech-stack'].added.forEach(techEntry =>
        techStack.add(typeof techEntry === 'string' ? techEntry : techEntry.name)
      );
    }
  }

  return techStack;
}

/**
 * Assemble the final digest result from collected summaries.
 * Merges provides, affects, patterns, and decisions per phase, then converts Sets to Arrays.
 *
 * @param {Array<{phaseNum: string, dirName: string, frontmatter: Object}>} summaries
 * @param {Set<string>} techStack - Unified tech stack
 * @returns {{ phases: Object, decisions: Array, tech_stack: string[] }}
 */
function buildDigest(summaries, techStack) {
  const phases = {};
  const decisions = [];

  for (const { phaseNum, dirName, frontmatter } of summaries) {
    if (!phases[phaseNum]) {
      phases[phaseNum] = {
        name: frontmatter.name || dirName.split('-').slice(1).join(' ') || 'Unknown',
        provides: new Set(),
        affects: new Set(),
        patterns: new Set(),
      };
    }

    // Merge provides from either nested dependency-graph or flat provides field
    if (frontmatter['dependency-graph'] && Array.isArray(frontmatter['dependency-graph'].provides)) {
      frontmatter['dependency-graph'].provides.forEach(item => phases[phaseNum].provides.add(item));
    } else if (Array.isArray(frontmatter.provides)) {
      frontmatter.provides.forEach(item => phases[phaseNum].provides.add(item));
    }

    // Merge affects from nested dependency-graph
    if (frontmatter['dependency-graph'] && Array.isArray(frontmatter['dependency-graph'].affects)) {
      frontmatter['dependency-graph'].affects.forEach(item => phases[phaseNum].affects.add(item));
    }

    // Merge established patterns
    if (Array.isArray(frontmatter['patterns-established'])) {
      frontmatter['patterns-established'].forEach(item => phases[phaseNum].patterns.add(item));
    }

    // Merge key decisions with phase attribution
    if (Array.isArray(frontmatter['key-decisions'])) {
      frontmatter['key-decisions'].forEach(decision => {
        decisions.push({ phase: phaseNum, decision });
      });
    }
  }

  // Convert Sets to Arrays for JSON serialization
  Object.keys(phases).forEach(phaseKey => {
    phases[phaseKey].provides = [...phases[phaseKey].provides];
    phases[phaseKey].affects = [...phases[phaseKey].affects];
    phases[phaseKey].patterns = [...phases[phaseKey].patterns];
  });

  return { phases, decisions, tech_stack: [...techStack] };
}

/**
 * Build a digest of project history from all summary.md files: decisions, tech stack, patterns.
 *
 * History digest algorithm overview:
 * 1. collectPhaseSummaries() scans archived + current phase dirs for summary.md frontmatter
 * 2. mergeTechStack() aggregates tech-stack.added arrays into a deduplicated Set
 * 3. buildDigest() merges provides/affects/patterns/decisions per phase, converts Sets to Arrays
 *
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdHistoryDigest(cwd, raw) {
  const digest = { phases: {}, decisions: [], tech_stack: new Set() };

  const { allPhaseDirs, summaries } = collectPhaseSummaries(cwd);

  if (allPhaseDirs.length === 0) {
    digest.tech_stack = [];
    output(digest, raw);
    return;
  }

  try {
    const techStack = mergeTechStack(summaries);
    const result = buildDigest(summaries, techStack);

    output(result, raw);
  } catch (err) {
    error('Failed to generate history digest: ' + err.message);
  }
}

/**
 * Resolve the model name for an agent type based on the configured model profile.
 * @param {string} cwd - Working directory path
 * @param {string} agentType - Agent type identifier (e.g., "pan-executor", "pan-planner")
 * @param {boolean} raw - If true, output raw model name instead of JSON
 * @param {string} [metadataJson] - Optional JSON string with task metadata for complexity routing
 * @returns {void}
 */
function cmdResolveModel(cwd, agentType, raw, metadataJson) {
  if (!agentType) {
    error('agent-type required');
  }

  let taskMetadata = null;
  if (metadataJson) {
    try { taskMetadata = JSON.parse(metadataJson); }
    catch { /* ignore invalid metadata, use static routing */ }
  }

  const config = loadConfig(cwd);
  const profile = config.model_profile || 'balanced';
  const strategy = config.routing?.strategy || 'static';

  const agentModels = MODEL_PROFILES[agentType];
  if (!agentModels) {
    const model = resolveTierToModel('mid', detectProvider(cwd, config));
    const result = { model, profile, strategy, effort: resolveEffortInternal(cwd, agentType), unknown_agent: true };
    output(result, raw, model);
    return;
  }

  const model = resolveModelInternal(cwd, agentType, taskMetadata);
  const effort = resolveEffortInternal(cwd, agentType);
  const result = { model, profile, strategy, effort };
  output(result, raw, model);
}

/**
 * Estimate cost multipliers for all profiles.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output formatted text instead of JSON
 * @returns {void}
 */
function cmdEstimateCost(cwd, raw) {
  const estimates = ['quality', 'balanced', 'budget'].map(estimateCostMultiplier);
  output({ estimates }, raw, estimates.map(e =>
    `${e.profile}: ~${e.average}x baseline (${e.agentCount} agents)`
  ).join('\n'));
}


/**
 * Stage and commit planning files to git, respecting commit_docs config and gitignore.
 * @param {string} cwd - Working directory path
 * @param {string} message - Commit message
 * @param {string[]} files - Files to stage (defaults to .planning/)
 * @param {boolean} raw - If true, output raw commit hash instead of JSON
 * @param {boolean} amend - If true, amend the previous commit instead of creating new
 * @param {Object} [opts] - Additional options
 * @param {string} [opts.type] - Conventional commit type (feat, fix, docs, test, refactor, chore)
 * @param {boolean} [opts.force] - Skip deleted-file safety check
 * @returns {void}
 */
/**
 * Run commit safety checks (deleted files, sensitive patterns).
 * @param {string} cwd - Working directory
 * @param {Object} config - Loaded config
 * @param {boolean} force - If true, allow deleted files
 * @returns {{blocked: boolean, reason?: string, safetyChecks: Object, hint?: string}}
 */
function runCommitSafetyChecks(cwd, config, force) {
  const safetyChecks = { deleted_files: [], sensitive_files_blocked: [] };
  const safetyEnabled = config.commit && config.commit.safety_checks !== false;
  if (!safetyEnabled) return { blocked: false, safetyChecks };

  // Check for deleted files
  const statusResult = execGit(cwd, ['status', '--porcelain']);
  if (statusResult.exitCode === 0 && statusResult.stdout) {
    for (const line of statusResult.stdout.split('\n').filter(Boolean)) {
      if (line.startsWith(' D') || line.startsWith('D ') || line.startsWith('D')) {
        const fileName = line.slice(3).trim();
        if (fileName) safetyChecks.deleted_files.push(fileName);
      }
    }
  }
  if (safetyChecks.deleted_files.length > 0 && !force) {
    return { blocked: true, reason: 'deleted_files_detected', safetyChecks, hint: 'Use --force to confirm deletion, or unstage the files' };
  }

  // Check for sensitive files in staging
  const stagedResult = execGit(cwd, ['diff', '--cached', '--name-only']);
  if (stagedResult.exitCode === 0 && stagedResult.stdout) {
    const patterns = (config.commit && Array.isArray(config.commit.sensitive_patterns))
      ? config.commit.sensitive_patterns
      : DEFAULT_SENSITIVE_PATTERNS;
    if (patterns.length > 0) {
      const stagedFiles = stagedResult.stdout.split('\n').filter(Boolean);
      const regexes = patterns.map(p => { try { return new RegExp(p, 'i'); } catch { return null; } }).filter(Boolean);
      for (const f of stagedFiles) {
        if (regexes.some(re => re.test(f))) safetyChecks.sensitive_files_blocked.push(f);
      }
    }
  }
  if (safetyChecks.sensitive_files_blocked.length > 0) {
    return { blocked: true, reason: 'sensitive_file_detected', safetyChecks, hint: 'Remove sensitive files from staging before committing' };
  }

  return { blocked: false, safetyChecks };
}

function cmdCommit(cwd, message, files, raw, amend, opts) {
  const commitType = opts && opts.type;
  const force = opts && opts.force;
  // P-EXP-001 follow-up (v3.7.10): when failOnError is true, commit_failed
  // exits non-zero so callers (especially autonomous loops) detect the silent-
  // failure case where git refused (e.g. missing identity) and the loop would
  // otherwise keep going thinking the artifact landed.
  const failOnError = opts && opts.failOnError;

  if (!isGitRepo(cwd)) {
    output({ committed: false, hash: null, reason: 'not_a_git_repo', hint: 'Run git init to initialize a repository' }, raw, 'not a git repo');
    return;
  }

  if (commitType && !VALID_COMMIT_TYPES.includes(commitType)) {
    error('Invalid commit type: ' + commitType + '. Valid: ' + VALID_COMMIT_TYPES.join(', '));
  }
  if (!message && !amend) {
    error('commit message required');
  }

  const config = loadConfig(cwd);

  if (!config.commit_docs) {
    output({ committed: false, hash: null, reason: 'skipped_commit_docs_false' }, raw, 'skipped');
    return;
  }
  if (isGitIgnored(cwd, PLANNING_DIR)) {
    output({ committed: false, hash: null, reason: 'skipped_gitignored' }, raw, 'skipped');
    return;
  }

  // Stage files
  const filesToStage = files && files.length > 0 ? files : [PLANNING_DIR + '/'];
  for (const file of filesToStage) execGit(cwd, ['add', file]);

  // Safety checks
  const safety = runCommitSafetyChecks(cwd, config, force);
  if (safety.blocked) {
    output({ committed: false, hash: null, reason: safety.reason, safety_checks: safety.safetyChecks, hint: safety.hint }, raw, 'blocked');
    return;
  }

  // Build final message with optional conventional commit type prefix
  const finalMessage = (commitType && message) ? commitType + ': ' + message : message;

  // Commit
  const commitArgs = amend ? ['commit', '--amend', '--no-edit'] : ['commit', '-m', finalMessage];
  const commitResult = execGit(cwd, commitArgs);
  if (commitResult.exitCode !== 0) {
    if (commitResult.stdout.includes('nothing to commit') || commitResult.stderr.includes('nothing to commit')) {
      output({ committed: false, hash: null, reason: 'nothing_to_commit' }, raw, 'nothing');
      return;
    }
    if (failOnError) {
      error('commit_failed: ' + (commitResult.stderr || 'unknown git error').trim());
    }
    output({ committed: false, hash: null, reason: 'commit_failed', error: commitResult.stderr }, raw, 'failed');
    return;
  }

  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
  output({ committed: true, hash, reason: 'committed', type: commitType || null, safety_checks: safety.safetyChecks }, raw, hash || 'committed');
}

/**
 * Extract structured data from a summary.md frontmatter with optional field filtering.
 * @param {string} cwd - Working directory path
 * @param {string} summaryPath - Relative path to the summary.md file
 * @param {string[]} fields - Optional list of fields to extract (returns all if empty)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdSummaryExtract(cwd, summaryPath, fields, raw) {
  if (!summaryPath) {
    error('summary-path required for summary-extract');
  }

  const fullPath = path.join(cwd, summaryPath);

  let content;
  try {
    content = fs.readFileSync(fullPath, 'utf-8');
  } catch {
    output({ error: 'File not found', path: summaryPath }, raw);
    return;
  }
  const frontmatter = extractFrontmatter(content);

  // Parse key-decisions into structured format
  const parseDecisions = (decisionsList) => {
    if (!decisionsList || !Array.isArray(decisionsList)) return [];
    return decisionsList.map(entry => {
      const colonIdx = entry.indexOf(':');
      if (colonIdx > 0) {
        return {
          summary: entry.substring(0, colonIdx).trim(),
          rationale: entry.substring(colonIdx + 1).trim(),
        };
      }
      return { summary: entry, rationale: null };
    });
  };

  // Build full result
  const fullResult = {
    path: summaryPath,
    one_liner: frontmatter['one-liner'] || null,
    key_files: frontmatter['key-files'] || [],
    tech_added: (frontmatter['tech-stack'] && frontmatter['tech-stack'].added) || [],
    patterns: frontmatter['patterns-established'] || [],
    decisions: parseDecisions(frontmatter['key-decisions']),
    requirements_completed: frontmatter['requirements-completed'] || [],
  };

  // If fields specified, filter to only those fields
  if (fields && fields.length > 0) {
    const filtered = { path: summaryPath };
    for (const field of fields) {
      if (fullResult[field] !== undefined) {
        filtered[field] = fullResult[field];
      }
    }
    output(filtered, raw);
    return;
  }

  output(fullResult, raw);
}

/**
 * Search the web using Brave Search API and return structured results.
 *
 * Web search API call structure:
 * - Endpoint: https://api.search.brave.com/res/v1/web/search
 * - Auth: X-Subscription-Token header with BRAVE_API_KEY
 * - Params: q (query), count (limit), country, search_lang, text_decorations, freshness (optional)
 * - Response: data.web.results[] with title, url, description, age fields
 *
 * @param {string} query - Search query string
 * @param {Object} options - Search options (limit, freshness)
 * @param {boolean} raw - If true, output raw formatted results instead of JSON
 * @returns {Promise<void>}
 */
async function cmdWebsearch(query, options, raw) {
  const apiKey = process.env.BRAVE_API_KEY;

  if (!apiKey) {
    // No key = silent skip, agent falls back to built-in WebSearch
    output({ available: false, reason: 'BRAVE_API_KEY not set' }, raw, '');
    return;
  }

  if (!query) {
    output({ available: false, error: 'Query required' }, raw, '');
    return;
  }

  const params = new URLSearchParams({
    q: query,
    count: String(options.limit || 10),
    country: 'us',
    search_lang: 'en',
    text_decorations: 'false'
  });

  if (options.freshness) {
    params.set('freshness', options.freshness);
  }

  try {
    const response = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': apiKey
        }
      }
    );

    if (!response.ok) {
      output({ available: false, error: `API error: ${response.status}` }, raw, '');
      return;
    }

    const data = await response.json();

    const results = (data.web?.results || []).map(item => ({
      title: item.title,
      url: item.url,
      description: item.description,
      age: item.age || null
    }));

    output({
      available: true,
      query,
      count: results.length,
      results
    }, raw, results.map(item => `${item.title}\n${item.url}\n${item.description}`).join('\n\n'));
  } catch (err) {
    // Network error, DNS failure, or JSON parse error from Brave API
    output({ available: false, error: err.message }, raw, '');
  }
}

/**
 * Render a text progress bar of the given width.
 * @param {number} percent - Completion percentage (0-100)
 * @param {number} width - Bar width in characters
 * @returns {string} Progress bar string like "████░░░░░░"
 */
function renderProgressBar(percent, width) {
  const filled = Math.round((percent / 100) * width);
  return '\u2588'.repeat(filled) + '\u2591'.repeat(width - filled);
}

/**
 * Render milestone progress as a table, progress bar, or JSON from disk phase data.
 * @param {string} cwd - Working directory path
 * @param {string} format - Output format: "table", "bar", or default JSON
 * @param {boolean} raw - If true, output raw rendered text instead of JSON
 * @returns {void}
 */
function cmdProgressRender(cwd, format, raw) {
  const phasesDir = phasesPath(cwd);
  const roadmapPath = path.join(cwd, PLANNING_DIR, ROADMAP_FILE);
  const milestone = getMilestoneInfo(cwd);

  const phases = [];
  let totalPlans = 0;
  let totalSummaries = 0;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((a, b) => comparePhaseNum(a, b));

    for (const dirName of dirs) {
      const dirMatch = dirName.match(/^(\d+(?:\.\d+)*)-?(.*)/);
      const phaseNum = dirMatch ? dirMatch[1] : dirName;
      const phaseName = dirMatch && dirMatch[2] ? dirMatch[2].replace(/-/g, ' ') : '';
      let phaseFiles;
      try {
        phaseFiles = fs.readdirSync(path.join(phasesDir, dirName));
      } catch {
        phases.push({ number: phaseNum, name: phaseName, plans: 0, summaries: 0, status: 'Error' });
        continue;
      }
      const planCount = phaseFiles.filter(filename => isPlanFile(filename)).length;
      const summaryCount = phaseFiles.filter(filename => isSummaryFile(filename)).length;

      totalPlans += planCount;
      totalSummaries += summaryCount;

      let status;
      if (planCount === 0) status = 'Pending';
      else if (summaryCount >= planCount) status = 'Complete';
      else if (summaryCount > 0) status = 'In Progress';
      else status = 'Planned';

      phases.push({ number: phaseNum, name: phaseName, plans: planCount, summaries: summaryCount, status });
    }
  } catch {
    // Phases directory does not exist or is unreadable; return empty progress
  }

  const percent = totalPlans > 0 ? Math.min(100, Math.round((totalSummaries / totalPlans) * 100)) : 0;

  if (format === 'health') {
    renderHealthReport(cwd, { phasesDir, phases, totalPlans, totalSummaries, percent }, raw);
    return;
  }

  if (format === 'table') {
    // Render markdown table
    const progressBar = renderProgressBar(percent, 10);
    let rendered = `# ${milestone.version} ${milestone.name}\n\n`;
    rendered += `**Progress:** [${progressBar}] ${totalSummaries}/${totalPlans} plans (${percent}%)\n\n`;
    rendered += '| Phase | Name | Plans | Status |\n';
    rendered += '|-------|------|-------|--------|\n';
    for (const phase of phases) {
      rendered += `| ${phase.number} | ${phase.name} | ${phase.summaries}/${phase.plans} | ${phase.status} |\n`;
    }
    output({ rendered }, raw, rendered);
  } else if (format === 'bar') {
    const progressBar = renderProgressBar(percent, 20);
    const text = `[${progressBar}] ${totalSummaries}/${totalPlans} plans (${percent}%)`;
    output({ bar: text, percent, completed: totalSummaries, total: totalPlans }, raw, text);
  } else {
    // JSON format
    output({
      milestone_version: milestone.version,
      milestone_name: milestone.name,
      phases,
      total_plans: totalPlans,
      total_summaries: totalSummaries,
      percent,
    }, raw);
  }
}

/**
 * Compute and output a composite health score from progress, context budget, and staleness.
 */
function renderHealthReport(cwd, { phasesDir, phases, totalPlans, totalSummaries, percent }, raw) {
  const stateContent = safeReadFile(path.join(cwd, PLANNING_DIR, STATE_FILE));
  const roadmapContent = safeReadFile(path.join(cwd, PLANNING_DIR, ROADMAP_FILE));
  const projectContent = safeReadFile(path.join(cwd, PLANNING_DIR, PROJECT_FILE));

  const stateTokens = estimateTokens(stateContent);
  const roadmapTokens = estimateTokens(roadmapContent);
  const projectTokens = estimateTokens(projectContent);
  let planTokens = 0;

  let phaseDirEntries;
  try { phaseDirEntries = fs.readdirSync(phasesDir); } catch { phaseDirEntries = []; }

  for (const phase of phases) {
    const match = phaseDirEntries.find(d => d.startsWith(phase.number + '-') || d === phase.number);
    if (!match) continue;
    const phaseDir = path.join(phasesDir, match);
    try {
      const files = fs.readdirSync(phaseDir);
      for (const f of files) {
        if (isPlanFile(f)) planTokens += estimateTokens(safeReadFile(path.join(phaseDir, f)));
      }
    } catch { /* skip */ }
  }

  const totalTokens = stateTokens + roadmapTokens + projectTokens + planTokens;
  const utilization = totalTokens / CONTEXT_WINDOW;

  const progressScore = percent;
  const contextScore = utilization >= CRITICAL_THRESHOLD ? 20 : utilization >= WARNING_THRESHOLD ? 60 : 100;
  const stalePhasesCount = phases.filter(p => p.status === 'Planned' && p.plans > 0 && p.summaries === 0).length;
  const stalenessScore = phases.length > 0 ? Math.max(0, 100 - (stalePhasesCount / phases.length) * 100) : 100;

  const composite = Math.round((progressScore + contextScore + stalenessScore) / 3);
  let grade;
  if (composite >= 80) grade = 'A';
  else if (composite >= 60) grade = 'B';
  else if (composite >= 40) grade = 'C';
  else grade = 'D';

  // Read error patterns count
  const patternsCount = readErrorPatterns(cwd).length;

  // Read session history count
  let sessionCount = 0;
  try {
    const sessionContent = fs.readFileSync(path.join(cwd, PLANNING_DIR, SESSION_HISTORY_FILE), 'utf-8');
    sessionCount = (sessionContent.match(/^### Session — /gm) || []).length;
  } catch { /* file doesn't exist */ }

  const healthResult = {
    grade,
    composite,
    progress: { score: progressScore, completed: totalSummaries, total: totalPlans },
    context: { score: contextScore, utilization: Math.round(utilization * 1000) / 1000, tokens: totalTokens },
    staleness: { score: Math.round(stalenessScore), stalePlans: stalePhasesCount, totalPhases: phases.length },
    patterns_count: patternsCount,
    session_count: sessionCount,
  };

  if (raw) {
    const lines = [
      `Project Health: ${grade} (${composite}/100)`,
      ``,
      `Progress:  ${progressScore}%  (${totalSummaries}/${totalPlans} plans complete)`,
      `Context:   ${contextScore}/100  (${(utilization * 100).toFixed(1)}% utilization)`,
      `Staleness: ${Math.round(stalenessScore)}/100  (${stalePhasesCount} stale phases)`,
    ];
    output(healthResult, true, lines.join('\n'));
  } else {
    output(healthResult, false);
  }
}

/**
 * Move a todo from pending to completed, adding a completion timestamp.
 * @param {string} cwd - Working directory path
 * @param {string} filename - Filename of the todo in the pending directory
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdTodoComplete(cwd, filename, raw) {
  if (!filename) {
    error('filename required for todo complete');
  }

  const pendingDir = path.join(cwd, PLANNING_DIR, 'todos', 'pending');
  const completedDir = path.join(cwd, PLANNING_DIR, 'todos', 'completed');
  const sourcePath = path.join(pendingDir, filename);

  let content;
  try {
    content = fs.readFileSync(sourcePath, 'utf-8');
  } catch {
    error(`Todo not found: ${filename}`);
  }

  // Ensure completed directory exists
  try {
    fs.mkdirSync(completedDir, { recursive: true });
  } catch (e) {
    error(`Failed to create completed directory: ${e.message}`);
  }

  const today = new Date().toISOString().split('T')[0];
  content = `completed: ${today}\n` + content;

  try {
    fs.writeFileSync(path.join(completedDir, filename), content, 'utf-8');
  } catch (e) {
    error(`Failed to write completed todo: ${e.message}`);
  }
  try {
    fs.unlinkSync(sourcePath);
  } catch (e) {
    error(`Failed to remove pending todo: ${e.message}`);
  }

  output({ completed: true, file: filename, date: today }, raw, 'completed');
}

/**
 * Scaffold a planning artifact file (context, uat, verification, or phase-dir).
 * @param {string} cwd - Working directory path
 * @param {string} type - Scaffold type: "context", "uat", "verification", or "phase-dir"
 * @param {Object} options - Options (phase, name)
 * @param {boolean} raw - If true, output raw path instead of JSON
 * @returns {void}
 */
function cmdScaffold(cwd, type, options, raw) {
  const { phase, name } = options;
  const padded = phase ? normalizePhaseName(phase) : '00';
  const today = new Date().toISOString().split('T')[0];

  // Find phase directory
  const phaseInfo = phase ? findPhaseInternal(cwd, phase) : null;
  const phaseDir = phaseInfo ? path.join(cwd, phaseInfo.directory) : null;

  if (phase && !phaseDir && type !== 'phase-dir') {
    error(`Phase ${phase} directory not found`);
  }

  let filePath, content;

  switch (type) {
    case 'context': {
      filePath = path.join(phaseDir, `${padded}${CONTEXT_SUFFIX}`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} -- Context\n\n## Decisions\n\n_Decisions will be captured during /pan:discuss-phase ${phase}_\n\n## Discretion Areas\n\n_Areas where the executor can use judgment_\n\n## Deferred Ideas\n\n_Ideas to consider later_\n`;
      break;
    }
    case 'uat': {
      filePath = path.join(phaseDir, `${padded}${UAT_SUFFIX}`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} -- User Acceptance Testing\n\n## Test Results\n\n| # | Test | Status | Notes |\n|---|------|--------|-------|\n\n## Summary\n\n_Pending UAT_\n`;
      break;
    }
    case 'verification': {
      filePath = path.join(phaseDir, `${padded}${VERIFICATION_SUFFIX}`);
      content = `---\nphase: "${padded}"\nname: "${name || phaseInfo?.phase_name || 'Unnamed'}"\ncreated: ${today}\nstatus: pending\n---\n\n# Phase ${phase}: ${name || phaseInfo?.phase_name || 'Unnamed'} -- Verification\n\n## Goal-Backward Verification\n\n**Phase Goal:** [From roadmap.md]\n\n## Checks\n\n| # | Requirement | Status | Evidence |\n|---|------------|--------|----------|\n\n## Result\n\n_Pending verification_\n`;
      break;
    }
    case 'phase-dir': {
      if (!phase || !name) {
        error('phase and name required for phase-dir scaffold');
      }
      const slug = generateSlugInternal(name);
      const dirName = `${padded}-${slug}`;
      const phasesParent = path.join(cwd, PLANNING_DIR, PHASES_DIR);
      try {
        fs.mkdirSync(phasesParent, { recursive: true });
        fs.mkdirSync(path.join(phasesParent, dirName), { recursive: true });
      } catch (e) {
        error(`Failed to create phase directory: ${e.message}`);
      }
      output({ created: true, directory: `${PLANNING_DIR}/${PHASES_DIR}/${dirName}` }, raw, `${PLANNING_DIR}/${PHASES_DIR}/${dirName}`);
      return;
    }
    default:
      error(`Unknown scaffold type: ${type}. Available: context, uat, verification, phase-dir`);
  }

  const relPath = toPosix(path.relative(cwd, filePath));
  try {
    fs.writeFileSync(filePath, content, { encoding: 'utf-8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') {
      output({ created: false, reason: 'already_exists', path: relPath }, raw, 'exists');
      return;
    }
    error(`Failed to write scaffold: ${e.message}`);
  }
  output({ created: true, path: relPath }, raw, relPath);
}

/**
 * Create a git rollback snapshot tag before execution.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase identifier (e.g., "05" or "05.1")
 * @param {boolean} raw - If true, output raw tag name instead of JSON
 * @returns {void}
 */
function cmdRollbackSnapshot(cwd, phase, raw) {
  if (!phase) {
    error('phase required for rollback-snapshot');
  }

  // Sanitize phase for tag name (replace dots with dashes)
  const sanitizedPhase = String(phase).replace(/\./g, '-');
  const now = new Date();
  const timestamp = now.toISOString().replace(/[-:]/g, '').replace(/\..+/, '');
  let tagName = `pan-rollback-${sanitizedPhase}-${timestamp}`;

  // Get current HEAD hash
  const headResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  if (headResult.exitCode !== 0) {
    const result = { tag: null, hash: null, phase, warning: 'Not a git repository or no commits' };
    output(result, raw, '');
    return;
  }
  const hash = headResult.stdout;

  // Create tag. tag.gpgsign=true in user config turns plain `git tag` into a
  // sign-or-fail operation ("fatal: no tag message?") in non-interactive runs —
  // PAN snapshot tags are automation markers, so signing is explicitly disabled.
  let tagResult = execGit(cwd, ['-c', 'tag.gpgsign=false', 'tag', tagName]);
  if (tagResult.exitCode !== 0) {
    // Tag might already exist — try with suffix
    tagName = tagName + '-1';
    tagResult = execGit(cwd, ['-c', 'tag.gpgsign=false', 'tag', tagName]);
    if (tagResult.exitCode !== 0) {
      const result = { tag: null, hash, phase, warning: 'Failed to create tag: ' + tagResult.stderr };
      output(result, raw, '');
      return;
    }
  }

  const result = { tag: tagName, hash, phase };
  output(result, raw, tagName);
}

/**
 * Create a single commit summarizing batch results (for orchestrators like focus-exec).
 * Only commits .planning/ metadata.
 * @param {string} cwd - Working directory
 * @param {Array<{title: string}>} items - Completed batch items
 * @param {boolean} raw - Raw output mode
 * @returns {void}
 */
function cmdBatchCommit(cwd, items, raw) {
  if (!isGitRepo(cwd)) {
    output({ committed: false, reason: 'not_a_git_repo' }, raw, 'not a git repo');
    return;
  }
  if (!Array.isArray(items) || items.length === 0) {
    output({ committed: false, reason: 'no_items' }, raw, 'no items');
    return;
  }

  const config = loadConfig(cwd);
  if (!config.commit_docs) {
    output({ committed: false, reason: 'skipped_commit_docs_false' }, raw, 'skipped');
    return;
  }

  // Stage .planning/ only
  execGit(cwd, ['add', PLANNING_DIR + '/']);

  // Check if there's anything to commit
  const statusResult = execGit(cwd, ['diff', '--cached', '--name-only']);
  if (statusResult.exitCode !== 0 || !statusResult.stdout) {
    output({ committed: false, reason: 'nothing_to_commit' }, raw, 'nothing');
    return;
  }

  const titles = items.map(i => '- ' + (i.title || 'untitled')).join('\n');
  const message = 'docs: focus-exec batch — ' + items.length + ' items completed\n\n' + titles;
  const commitResult = execGit(cwd, ['commit', '-m', message]);
  if (commitResult.exitCode !== 0) {
    output({ committed: false, reason: 'commit_failed', error: commitResult.stderr }, raw, 'failed');
    return;
  }

  const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
  const hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
  output({ committed: true, hash, reason: 'committed', items_count: items.length }, raw, hash || 'committed');
}

/**
 * Check if all modified files are markdown (.md) — used to skip test verification.
 * @param {string[]} files - List of file paths
 * @returns {boolean} true if ALL files are .md (or list is empty)
 */
function shouldSkipTests(files) {
  if (!Array.isArray(files) || files.length === 0) {
    return true;
  }
  return files.every(f => /\.md$/i.test(f));
}

// ---- Error patterns, session history, learnings — extracted to commands-learnings.cjs (re-exported below)

module.exports = {
  cmdGenerateSlug,
  cmdCurrentTimestamp,
  cmdListTodos,
  cmdVerifyPathExists,
  cmdHistoryDigest,
  cmdResolveModel,
  cmdEstimateCost,
  cmdCommit,
  cmdSummaryExtract,
  cmdWebsearch,
  cmdProgressRender,
  cmdTodoComplete,
  cmdScaffold,
  cmdRollbackSnapshot,
  cmdBatchCommit,
  shouldSkipTests,
  readErrorPatterns,
  appendErrorPattern,
  appendSessionSummary,
  cmdLearningsExtract,
  cmdLearningsList,
  cmdLearningsPrune,
  runCommitSafetyChecks,
  VALID_COMMIT_TYPES,
};
