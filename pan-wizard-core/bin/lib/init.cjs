/**
 * Init — Compound init commands for workflow bootstrapping
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, resolveModelInternal, findPhaseInternal, getRoadmapPhaseInternal, pathExistsInternal, generateSlugInternal, getMilestoneInfo, normalizePhaseName, toPosix, output, error, scanPendingTodos, isGitRepo, execGit } = require('./core.cjs');
const { PLANNING_DIR, PHASES_DIR, CODEBASE_DIR, QUICK_DIR, MILESTONES_DIR, STATE_FILE, ROADMAP_FILE, CONFIG_FILE, PROJECT_FILE, REQUIREMENTS_FILE, isPlanFile, isSummaryFile, isResearchFile, isContextFile, isVerificationFile, PLAN_SUFFIX, SUMMARY_SUFFIX, CONTEXT_SUFFIX, RESEARCH_SUFFIX, VERIFICATION_SUFFIX, UAT_SUFFIX, MAX_SLUG_LENGTH } = require('./constants.cjs');
const { planningPath, phasesPath, filterPlanFiles, filterSummaryFiles, classifyPhaseStatus, hasBraveSearchKey } = require('./utils.cjs');
const { classifyPlanTier } = require('./phase.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { detectLanguages } = require('./codebase.cjs');

// ---- Git helpers ----

function ensureGitRepo(cwd) {
  if (isGitRepo(cwd)) return true;
  const result = execGit(cwd, ['init']);
  return result.exitCode === 0;
}

// ---- Shared path builders for JSON output values (forward-slash, not filesystem) ----

/** Build a forward-slash relative path under .planning for JSON output */
function planningRelPath(...segments) {
  return [PLANNING_DIR, ...segments].join('/');
}

/**
 * Extract requirement IDs from a ROADMAP phase section.
 * Looks for a **Requirements**: line, strips brackets, splits by comma,
 * and returns null when absent or set to 'TBD'.
 */
function extractReqIds(roadmapPhase) {
  const reqMatch = roadmapPhase?.section?.match(/^\*\*Requirements\*\*:[^\S\n]*([^\n]*)$/m);
  const reqExtracted = reqMatch
    ? reqMatch[1].replace(/[\[\]]/g, '').split(',').map(segment => segment.trim()).filter(Boolean).join(', ')
    : null;
  return (reqExtracted && reqExtracted !== 'TBD') ? reqExtracted : null;
}

/**
 * Discover optional artifact files (CONTEXT, RESEARCH, VERIFICATION, UAT)
 * within a phase directory and attach their paths to a result object.
 *
 * Each suffix is checked because phases may contain any combination of these
 * optional artifacts. Files may be named either with a prefix (e.g. "01-context.md")
 * or as bare names (e.g. "context.md").
 */
function attachPhaseArtifactPaths(result, cwd, phaseDirectory) {
  const phaseDirFull = path.join(cwd, phaseDirectory);
  try {
    const files = fs.readdirSync(phaseDirFull);
    const contextFile = files.find(isContextFile);
    if (contextFile) {
      result.context_path = toPosix(path.join(phaseDirectory, contextFile));
    }
    const researchFile = files.find(isResearchFile);
    if (researchFile) {
      result.research_path = toPosix(path.join(phaseDirectory, researchFile));
    }
    const verificationFile = files.find(isVerificationFile);
    if (verificationFile) {
      result.verification_path = toPosix(path.join(phaseDirectory, verificationFile));
    }
    const uatFile = files.find(filename => filename.endsWith(UAT_SUFFIX) || filename === 'uat.md');
    if (uatFile) {
      result.uat_path = toPosix(path.join(phaseDirectory, uatFile));
    }
  } catch {
    // Phase directory may not exist yet or may be unreadable
  }
}

/**
 * Bootstrap context for phase execution: models, config, phase info, and plan inventory.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number to initialize execution for
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
/**
 * Map effort string to budget points.
 * @param {string|null} effort
 * @returns {number}
 */
function effortToPoints(effort) {
  const map = { XS: 1, S: 2, M: 4, L: 10, XL: 20 };
  return map[String(effort).toUpperCase()] || 4; // default to M (4)
}

function cmdInitExecutePhase(cwd, phase, raw, opts) {
  if (!phase) {
    error('phase required for init execute-phase');
  }

  const dryRun = opts && opts.dry_run === true;
  const budgetArg = opts && opts.budget;
  const config = loadConfig(cwd);

  // Validate and resolve budget
  let totalBudget = (config.budget && config.budget.default_points) || 50;
  if (budgetArg !== undefined && budgetArg !== null) {
    const parsed = parseInt(budgetArg, 10);
    if (isNaN(parsed)) {
      error('Budget must be a number');
    }
    if (parsed < 1) {
      error('Budget must be >= 1');
    }
    totalBudget = Math.min(parsed, 200);
  }

  const phaseInfo = findPhaseInternal(cwd, phase);
  const milestone = getMilestoneInfo(cwd);

  // Extract requirement IDs from the ROADMAP **Requirements** field for this phase
  const roadmapPhase = getRoadmapPhaseInternal(cwd, phase);
  const phaseReqIds = extractReqIds(roadmapPhase);

  // Classify tiers for each plan and calculate budget
  const plans = phaseInfo?.plans || [];
  const plansTierInfo = { micro: 0, standard: 0, full: 0 };
  let estimatedPoints = 0;

  for (const planFile of plans) {
    // Read plan frontmatter to classify tier
    const planPath = path.join(cwd, phaseInfo?.directory || '', planFile);
    let fm = {};
    try {
      const content = fs.readFileSync(planPath, 'utf-8');
      fm = extractFrontmatter(content) || {};
    } catch { /* plan file unreadable — use defaults */ }

    const tier = classifyPlanTier(fm, config);
    plansTierInfo[tier] = (plansTierInfo[tier] || 0) + 1;
    estimatedPoints += effortToPoints(fm.effort);
  }

  const result = {
    // Models
    executor_model: resolveModelInternal(cwd, 'pan-executor'),
    verifier_model: resolveModelInternal(cwd, 'pan-verifier'),
    reviewer_model: resolveModelInternal(cwd, 'pan-reviewer'),

    // Config flags
    commit_docs: config.commit_docs,
    parallelization: config.parallelization,
    branching_strategy: config.branching_strategy,
    phase_branch_template: config.phase_branch_template,
    milestone_branch_template: config.milestone_branch_template,
    verifier_enabled: config.verifier,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,
    phase_req_ids: phaseReqIds,

    // Plan inventory
    plans,
    summaries: phaseInfo?.summaries || [],
    incomplete_plans: phaseInfo?.incomplete_plans || [],
    plan_count: plans.length,
    incomplete_count: phaseInfo?.incomplete_plans?.length || 0,

    // Branch name (pre-computed from template).
    branch_name: config.branching_strategy === 'phase' && phaseInfo
      ? config.phase_branch_template
          .replace('{phase}', phaseInfo.phase_number)
          .replace('{slug}', phaseInfo.phase_slug || 'phase')
      : config.branching_strategy === 'milestone'
        ? config.milestone_branch_template
            .replace('{milestone}', milestone.version)
            .replace('{slug}', generateSlugInternal(milestone.name) || 'milestone')
        : null,

    // Milestone info
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    milestone_slug: generateSlugInternal(milestone.name),

    // File existence
    state_exists: pathExistsInternal(cwd, planningRelPath(STATE_FILE)),
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    config_exists: pathExistsInternal(cwd, planningRelPath(CONFIG_FILE)),
    // File paths
    state_path: planningRelPath(STATE_FILE),
    roadmap_path: planningRelPath(ROADMAP_FILE),
    config_path: planningRelPath(CONFIG_FILE),

    // Execution enhancements
    plans_by_tier: plansTierInfo,
    total_budget_points: totalBudget,
    estimated_points: estimatedPoints,
    budget_exceeded: estimatedPoints > totalBudget,
    execution_mode: (config.execution && config.execution.default_mode) || 'wave_order',
    dry_run: dryRun,
    rollback_tag: null,
  };

  output(result, raw);
}

/**
 * Bootstrap context for phase planning: models, workflow flags, and existing artifacts.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number to initialize planning for
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitPlanPhase(cwd, phase, raw) {
  if (!phase) {
    error('phase required for init plan-phase');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  // Extract requirement IDs from the ROADMAP **Requirements** field for this phase
  const roadmapPhase = getRoadmapPhaseInternal(cwd, phase);
  const phaseReqIds = extractReqIds(roadmapPhase);

  const result = {
    // Models
    researcher_model: resolveModelInternal(cwd, 'pan-phase-researcher'),
    planner_model: resolveModelInternal(cwd, 'pan-planner'),
    checker_model: resolveModelInternal(cwd, 'pan-plan-checker'),

    // Workflow flags
    research_enabled: config.research,
    plan_checker_enabled: config.plan_checker,
    nyquist_validation_enabled: config.nyquist_validation,
    commit_docs: config.commit_docs,

    // Phase info — fall back to roadmap data when directory doesn't exist yet
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || roadmapPhase?.phase_number || null,
    phase_name: phaseInfo?.phase_name || roadmapPhase?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || (roadmapPhase?.phase_name ? generateSlugInternal(roadmapPhase.phase_name) : null),
    padded_phase: (phaseInfo?.phase_number || roadmapPhase?.phase_number)?.toString().padStart(2, '0') || null,
    phase_req_ids: phaseReqIds,

    // Existing artifacts
    has_research: phaseInfo?.has_research || false,
    has_context: phaseInfo?.has_context || false,
    has_plans: (phaseInfo?.plans?.length || 0) > 0,
    plan_count: phaseInfo?.plans?.length || 0,

    // Environment
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),

    // File paths
    state_path: planningRelPath(STATE_FILE),
    roadmap_path: planningRelPath(ROADMAP_FILE),
    requirements_path: planningRelPath(REQUIREMENTS_FILE),
  };

  if (phaseInfo?.directory) {
    // Discover optional artifact files (CONTEXT, RESEARCH, VERIFICATION, UAT)
    attachPhaseArtifactPaths(result, cwd, phaseInfo.directory);
  }

  output(result, raw);
}

/**
 * Bootstrap context for new project initialization: models, brownfield detection, git state.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitNewProject(cwd, raw) {
  const config = loadConfig(cwd);

  // Detect Brave Search API key availability
  const hasBraveSearch = hasBraveSearchKey();

  // Detect existing code (cross-platform, no shell dependency)
  let hasCode = false;
  let hasPackageFile = false;
  const CODE_EXTS = new Set(['.ts', '.js', '.py', '.go', '.rs', '.swift', '.java']);
  const SKIP_DIRS = new Set(['node_modules', '.git', '.planning', '.claude', '.opencode', '.gemini', '.codex', '.copilot']);
  try {
    const scanDir = (dir, depth) => {
      if (depth > 3 || hasCode) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        if (hasCode) return;
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) scanDir(path.join(dir, entry.name), depth + 1);
        } else if (CODE_EXTS.has(path.extname(entry.name))) {
          hasCode = true;
        }
      }
    };
    scanDir(cwd, 0);
  } catch {
    // Filesystem error — treat as greenfield
  }

  hasPackageFile = pathExistsInternal(cwd, 'package.json') ||
                   pathExistsInternal(cwd, 'requirements.txt') ||
                   pathExistsInternal(cwd, 'Cargo.toml') ||
                   pathExistsInternal(cwd, 'go.mod') ||
                   pathExistsInternal(cwd, 'Package.swift');

  const result = {
    // Models
    researcher_model: resolveModelInternal(cwd, 'pan-project-researcher'),
    synthesizer_model: resolveModelInternal(cwd, 'pan-research-synthesizer'),
    roadmapper_model: resolveModelInternal(cwd, 'pan-roadmapper'),

    // Config
    commit_docs: config.commit_docs,

    // Existing state
    project_exists: pathExistsInternal(cwd, planningRelPath(PROJECT_FILE)),
    has_codebase_map: pathExistsInternal(cwd, planningRelPath(CODEBASE_DIR)),
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),

    // Brownfield detection
    has_existing_code: hasCode,
    has_package_file: hasPackageFile,
    is_brownfield: hasCode || hasPackageFile,
    needs_codebase_map: (hasCode || hasPackageFile) && !pathExistsInternal(cwd, planningRelPath(CODEBASE_DIR)),

    // Git state — auto-init if missing
    has_git: ensureGitRepo(cwd),

    // Enhanced search
    brave_search_available: hasBraveSearch,

    // File paths
    project_path: planningRelPath(PROJECT_FILE),
  };

  output(result, raw);
}

/**
 * Bootstrap context for new milestone creation: models, current milestone info, file existence.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitNewMilestone(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  const result = {
    // Models
    researcher_model: resolveModelInternal(cwd, 'pan-project-researcher'),
    synthesizer_model: resolveModelInternal(cwd, 'pan-research-synthesizer'),
    roadmapper_model: resolveModelInternal(cwd, 'pan-roadmapper'),

    // Config
    commit_docs: config.commit_docs,
    research_enabled: config.research,

    // Current milestone
    current_milestone: milestone.version,
    current_milestone_name: milestone.name,

    // File existence
    project_exists: pathExistsInternal(cwd, planningRelPath(PROJECT_FILE)),
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    state_exists: pathExistsInternal(cwd, planningRelPath(STATE_FILE)),

    // File paths
    project_path: planningRelPath(PROJECT_FILE),
    roadmap_path: planningRelPath(ROADMAP_FILE),
    state_path: planningRelPath(STATE_FILE),
  };

  output(result, raw);
}

/**
 * Bootstrap context for a quick task: models, task numbering, and directory paths.
 * @param {string} cwd - Working directory path
 * @param {string} description - Optional task description for slug generation
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitQuick(cwd, description, raw) {
  const config = loadConfig(cwd);
  const now = new Date();
  const slug = description ? generateSlugInternal(description)?.substring(0, MAX_SLUG_LENGTH) : null;

  // Find next quick task number by scanning existing numbered directories
  const quickDirPath = path.join(planningPath(cwd), QUICK_DIR);
  let nextNum = 1;
  try {
    const existingNums = fs.readdirSync(quickDirPath)
      .filter(entry => /^\d+-/.test(entry))
      .map(entry => parseInt(entry.split('-')[0], 10))
      .filter(num => !isNaN(num));
    if (existingNums.length > 0) {
      nextNum = Math.max(...existingNums) + 1;
    }
  } catch {
    // Quick directory does not exist yet -- start at 1
  }

  const quickRelDir = planningRelPath(QUICK_DIR);

  const result = {
    // Models
    planner_model: resolveModelInternal(cwd, 'pan-planner'),
    executor_model: resolveModelInternal(cwd, 'pan-executor'),
    checker_model: resolveModelInternal(cwd, 'pan-plan-checker'),
    verifier_model: resolveModelInternal(cwd, 'pan-verifier'),

    // Config
    commit_docs: config.commit_docs,

    // Quick task info
    next_num: nextNum,
    slug: slug,
    description: description || null,

    // Timestamps
    date: now.toISOString().split('T')[0],
    timestamp: now.toISOString(),

    // Paths
    quick_dir: quickRelDir,
    task_dir: slug ? `${quickRelDir}/${nextNum}-${slug}` : null,

    // File existence
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),

  };

  output(result, raw);
}

/**
 * Bootstrap context for resuming work: file existence, interrupted agent detection.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitResume(cwd, raw) {
  const config = loadConfig(cwd);

  // Check for interrupted agent
  let interruptedAgentId = null;
  try {
    interruptedAgentId = fs.readFileSync(path.join(planningPath(cwd), 'current-agent-id.txt'), 'utf-8').trim();
  } catch {
    // No interrupted agent file found -- normal state
  }

  const result = {
    // File existence
    state_exists: pathExistsInternal(cwd, planningRelPath(STATE_FILE)),
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    project_exists: pathExistsInternal(cwd, planningRelPath(PROJECT_FILE)),
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),

    // File paths
    state_path: planningRelPath(STATE_FILE),
    roadmap_path: planningRelPath(ROADMAP_FILE),
    project_path: planningRelPath(PROJECT_FILE),

    // Agent state
    has_interrupted_agent: !!interruptedAgentId,
    interrupted_agent_id: interruptedAgentId,

    // Config
    commit_docs: config.commit_docs,
  };

  output(result, raw);
}

/**
 * Bootstrap context for work verification: models, phase info, existing verification artifacts.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number to verify
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitVerifyWork(cwd, phase, raw) {
  if (!phase) {
    error('phase required for init verify-work');
  }

  const config = loadConfig(cwd);
  const phaseInfo = findPhaseInternal(cwd, phase);

  const result = {
    // Models
    planner_model: resolveModelInternal(cwd, 'pan-planner'),
    checker_model: resolveModelInternal(cwd, 'pan-plan-checker'),

    // Config
    commit_docs: config.commit_docs,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,

    // Existing artifacts
    has_verification: phaseInfo?.has_verification || false,
  };

  output(result, raw);
}

/**
 * Bootstrap context for phase operations: config, artifacts, and context/research file paths.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number to operate on
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitPhaseOp(cwd, phase, raw) {
  const config = loadConfig(cwd);
  let phaseInfo = findPhaseInternal(cwd, phase);

  // Fallback to roadmap.md if no directory exists (e.g., Plans: TBD)
  if (!phaseInfo) {
    const roadmapPhase = getRoadmapPhaseInternal(cwd, phase);
    if (roadmapPhase?.found) {
      const phaseName = roadmapPhase.phase_name;
      phaseInfo = {
        found: true,
        directory: null,
        phase_number: roadmapPhase.phase_number,
        phase_name: phaseName,
        phase_slug: phaseName ? generateSlugInternal(phaseName) : null,
        plans: [],
        summaries: [],
        incomplete_plans: [],
        has_research: false,
        has_context: false,
        has_verification: false,
      };
    }
  }

  const result = {
    // Config
    commit_docs: config.commit_docs,
    brave_search: config.brave_search,

    // Phase info
    phase_found: !!phaseInfo,
    phase_dir: phaseInfo?.directory || null,
    phase_number: phaseInfo?.phase_number || null,
    phase_name: phaseInfo?.phase_name || null,
    phase_slug: phaseInfo?.phase_slug || null,
    padded_phase: phaseInfo?.phase_number?.padStart(2, '0') || null,

    // Existing artifacts
    has_research: phaseInfo?.has_research || false,
    has_context: phaseInfo?.has_context || false,
    has_plans: (phaseInfo?.plans?.length || 0) > 0,
    has_verification: phaseInfo?.has_verification || false,
    plan_count: phaseInfo?.plans?.length || 0,

    // File existence
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),

    // File paths
    state_path: planningRelPath(STATE_FILE),
    roadmap_path: planningRelPath(ROADMAP_FILE),
    requirements_path: planningRelPath(REQUIREMENTS_FILE),
  };

  if (phaseInfo?.directory) {
    // Discover optional artifact files (CONTEXT, RESEARCH, VERIFICATION, UAT)
    attachPhaseArtifactPaths(result, cwd, phaseInfo.directory);
  }

  output(result, raw);
}

/**
 * Bootstrap context for todo management: config, pending todo inventory, and paths.
 * @param {string} cwd - Working directory path
 * @param {string} area - Optional area filter for todos
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitTodos(cwd, area, raw) {
  const config = loadConfig(cwd);
  const now = new Date();

  const { count, todos } = scanPendingTodos(cwd, area);

  const result = {
    commit_docs: config.commit_docs,
    date: now.toISOString().split('T')[0],
    timestamp: now.toISOString(),
    todo_count: count,
    todos,
    area_filter: area || null,
    pending_dir: planningRelPath('todos/pending'),
    completed_dir: planningRelPath('todos/completed'),
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),
    todos_dir_exists: pathExistsInternal(cwd, planningRelPath('todos')),
    pending_dir_exists: pathExistsInternal(cwd, planningRelPath('todos/pending')),
  };

  output(result, raw);
}

/**
 * Bootstrap context for milestone operations: phase counts, archive info, file existence.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitMilestoneOp(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  // Count phases
  let phaseCount = 0;
  let completedPhases = 0;
  const phasesDirPath = phasesPath(cwd);
  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    const dirNames = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    phaseCount = dirNames.length;

    // Count phases with summaries (completed)
    for (const dirName of dirNames) {
      try {
        const phaseFiles = fs.readdirSync(path.join(phasesDirPath, dirName));
        const hasSummary = phaseFiles.some(isSummaryFile);
        if (hasSummary) completedPhases++;
      } catch {
        // Phase directory unreadable -- skip
      }
    }
  } catch {
    // Phases directory does not exist yet
  }

  // Check archive
  const archiveDirPath = path.join(planningPath(cwd), MILESTONES_DIR);
  let archivedMilestones = [];
  try {
    archivedMilestones = fs.readdirSync(archiveDirPath, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    // Archive directory does not exist yet
  }

  const result = {
    // Config
    commit_docs: config.commit_docs,

    // Current milestone
    milestone_version: milestone.version,
    milestone_name: milestone.name,
    milestone_slug: generateSlugInternal(milestone.name),

    // Phase counts
    phase_count: phaseCount,
    completed_phases: completedPhases,
    all_phases_complete: phaseCount > 0 && phaseCount === completedPhases,

    // Archive
    archived_milestones: archivedMilestones,
    archive_count: archivedMilestones.length,

    // File existence
    project_exists: pathExistsInternal(cwd, planningRelPath(PROJECT_FILE)),
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    state_exists: pathExistsInternal(cwd, planningRelPath(STATE_FILE)),
    archive_exists: pathExistsInternal(cwd, planningRelPath(MILESTONES_DIR)),
    phases_dir_exists: pathExistsInternal(cwd, planningRelPath(PHASES_DIR)),
  };

  output(result, raw);
}

/**
 * Bootstrap context for codebase mapping: mapper model, existing maps, config flags.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdInitMapCodebase(cwd, raw) {
  const config = loadConfig(cwd);

  // Check for existing codebase maps
  const codebaseDirPath = path.join(planningPath(cwd), CODEBASE_DIR);
  let existingMaps = [];
  try {
    existingMaps = fs.readdirSync(codebaseDirPath).filter(filename => filename.endsWith('.md'));
  } catch {
    // Codebase directory does not exist yet
  }

  const result = {
    // Models
    mapper_model: resolveModelInternal(cwd, 'pan-document_code'),

    // Config
    commit_docs: config.commit_docs,
    search_gitignored: config.search_gitignored,
    parallelization: config.parallelization,

    // Paths
    codebase_dir: planningRelPath(CODEBASE_DIR),

    // Existing maps
    existing_maps: existingMaps,
    has_maps: existingMaps.length > 0,

    // File existence
    planning_exists: pathExistsInternal(cwd, PLANNING_DIR),
    codebase_dir_exists: pathExistsInternal(cwd, planningRelPath(CODEBASE_DIR)),

    // Language detection
    ...(() => {
      const langInfo = detectLanguages(cwd);
      return {
        supported_languages: [langInfo.primary, ...langInfo.secondary].filter(Boolean),
        file_count: langInfo.file_count,
      };
    })(),

    // Focus areas
    focus_areas: ['tech', 'arch', 'quality', 'concerns', 'relationships', 'practices'],
  };

  output(result, raw);
}

/**
 * Bootstrap context for progress display: phase analysis, current/next phase, paused state.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
/**
 * Scan all phase directories and return phase info, current phase, and next phase.
 * @param {string} cwd - Working directory path
 * @returns {{ phases: Object[], currentPhase: Object|null, nextPhase: Object|null }}
 */
function scanAllPhases(cwd) {
  const phasesDirPath = phasesPath(cwd);
  const phases = [];
  let currentPhase = null;
  let nextPhase = null;

  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    const dirNames = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort();

    for (const dirName of dirNames) {
      const dirMatch = dirName.match(/^(\d+(?:\.\d+)*)-?(.*)/);
      const phaseNumber = dirMatch ? dirMatch[1] : dirName;
      const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;

      const phaseFullPath = path.join(phasesDirPath, dirName);
      let phaseFiles;
      try { phaseFiles = fs.readdirSync(phaseFullPath); } catch { continue; }

      const plans = phaseFiles.filter(isPlanFile);
      const summaries = phaseFiles.filter(isSummaryFile);
      const hasResearch = phaseFiles.some(isResearchFile);

      const rawStatus = classifyPhaseStatus(plans.length, summaries.length, { hasResearch });
      const status = rawStatus === 'partial' || rawStatus === 'planned' ? 'in_progress' :
                     rawStatus === 'discussed' || rawStatus === 'empty' ? 'pending' :
                     rawStatus;

      const phaseInfo = {
        number: phaseNumber,
        name: phaseName,
        directory: toPosix(path.join(PLANNING_DIR, PHASES_DIR, dirName)),
        status,
        plan_count: plans.length,
        summary_count: summaries.length,
        has_research: hasResearch,
      };

      phases.push(phaseInfo);

      if (!currentPhase && (status === 'in_progress' || status === 'researched')) {
        currentPhase = phaseInfo;
      }
      if (!nextPhase && status === 'pending') {
        nextPhase = phaseInfo;
      }
    }
  } catch {
    // Phases directory does not exist yet
  }

  return { phases, currentPhase, nextPhase };
}

function cmdInitProgress(cwd, raw) {
  const config = loadConfig(cwd);
  const milestone = getMilestoneInfo(cwd);

  const { phases, currentPhase, nextPhase } = scanAllPhases(cwd);

  // Check for paused work
  let pausedAt = null;
  try {
    const stateContent = fs.readFileSync(path.join(planningPath(cwd), STATE_FILE), 'utf-8');
    const pauseMatch = stateContent.match(/\*\*Paused At:\*\*\s*(.+)/);
    if (pauseMatch) pausedAt = pauseMatch[1].trim();
  } catch {
    // state.md does not exist yet -- no paused state
  }

  const result = {
    // Models
    executor_model: resolveModelInternal(cwd, 'pan-executor'),
    planner_model: resolveModelInternal(cwd, 'pan-planner'),

    // Config
    commit_docs: config.commit_docs,

    // Milestone
    milestone_version: milestone.version,
    milestone_name: milestone.name,

    // Phase overview
    phases,
    phase_count: phases.length,
    completed_count: phases.filter(phaseEntry => phaseEntry.status === 'complete').length,
    in_progress_count: phases.filter(phaseEntry => phaseEntry.status === 'in_progress').length,

    // Current state
    current_phase: currentPhase,
    next_phase: nextPhase,
    paused_at: pausedAt,
    has_work_in_progress: !!currentPhase,

    // File existence
    project_exists: pathExistsInternal(cwd, planningRelPath(PROJECT_FILE)),
    roadmap_exists: pathExistsInternal(cwd, planningRelPath(ROADMAP_FILE)),
    state_exists: pathExistsInternal(cwd, planningRelPath(STATE_FILE)),
    // File paths
    state_path: planningRelPath(STATE_FILE),
    roadmap_path: planningRelPath(ROADMAP_FILE),
    project_path: planningRelPath(PROJECT_FILE),
    config_path: planningRelPath(CONFIG_FILE),
  };

  output(result, raw);
}

module.exports = {
  cmdInitExecutePhase,
  cmdInitPlanPhase,
  cmdInitNewProject,
  cmdInitNewMilestone,
  cmdInitQuick,
  cmdInitResume,
  cmdInitVerifyWork,
  cmdInitPhaseOp,
  cmdInitTodos,
  cmdInitMilestoneOp,
  cmdInitMapCodebase,
  cmdInitProgress,
};
