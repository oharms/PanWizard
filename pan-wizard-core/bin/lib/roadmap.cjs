/**
 * Roadmap — Roadmap parsing and update operations
 */

const fs = require('fs');
const path = require('path');
const { PLANNING_DIR, PHASES_DIR, ROADMAP_FILE, REQUIREMENTS_FILE, isPlanFile, isSummaryFile, isContextFile, isResearchFile, PHASE_HEADER_RE, getPlanId, getSummaryId } = require('./constants.cjs');
const { planningPath, phasesPath, filterPlanFiles, filterSummaryFiles, classifyPhaseStatus } = require('./utils.cjs');
const { escapeRegex, normalizePhaseName, output, error, findPhaseInternal } = require('./core.cjs');

/**
 * Extract a single phase section from roadmap.md including goal and success criteria.
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - Phase number to retrieve
 * @param {boolean} raw - If true, output raw section text instead of JSON
 * @returns {void}
 */
function cmdRoadmapGetPhase(cwd, phaseNum, raw) {
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);

  try {
    const content = fs.readFileSync(roadmapPath, 'utf-8');

    // Escape special regex chars in phase number, handle decimal
    const escapedPhase = escapeRegex(phaseNum);

    // Match "## Phase X:", "### Phase X:", or "#### Phase X:" with optional name
    const phasePattern = new RegExp(
      `#{2,4}\\s*Phase\\s+${escapedPhase}:\\s*([^\\n]+)`,
      'i'
    );
    const headerMatch = content.match(phasePattern);

    if (!headerMatch) {
      // Fallback: check if phase exists in summary list but missing detail section
      const checklistPattern = new RegExp(
        `-\\s*\\[[ x]\\]\\s*\\*\\*Phase\\s+${escapedPhase}:\\s*([^*]+)\\*\\*`,
        'i'
      );
      const checklistMatch = content.match(checklistPattern);

      if (checklistMatch) {
        // Phase exists in summary but missing detail section - malformed ROADMAP
        output({
          found: false,
          phase_number: phaseNum,
          phase_name: checklistMatch[1].trim(),
          error: 'malformed_roadmap',
          message: `Phase ${phaseNum} exists in summary list but missing "### Phase ${phaseNum}:" detail section. roadmap.md needs both formats.`
        }, raw, '');
        return;
      }

      output({ found: false, phase_number: phaseNum }, raw, '');
      return;
    }

    const phaseName = headerMatch[1].trim();
    const headerIndex = headerMatch.index;

    // Find the end of this section (next ## or ### phase header, or end of file)
    const restOfContent = content.slice(headerIndex);
    const nextHeaderMatch = restOfContent.match(/\n#{2,4}\s+Phase\s+\d/i);
    const sectionEnd = nextHeaderMatch
      ? headerIndex + nextHeaderMatch.index
      : content.length;

    const section = content.slice(headerIndex, sectionEnd).trim();

    // Extract goal if present
    const goalMatch = section.match(/(?:\*\*Goal:\*\*|\*\*Goal\*\*:)\s*([^\n]+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    // Extract success criteria as structured array
    const criteriaMatch = section.match(/\*\*Success Criteria\*\*[^\n]*:\s*\n((?:\s*\d+\.\s*[^\n]+\n?)+)/i);
    const success_criteria = criteriaMatch
      ? criteriaMatch[1].trim().split('\n').map(line => line.replace(/^\s*\d+\.\s*/, '').trim()).filter(Boolean)
      : [];

    output(
      {
        found: true,
        phase_number: phaseNum,
        phase_name: phaseName,
        goal,
        success_criteria,
        section,
      },
      raw,
      section
    );
  } catch {
    output({ found: false, error: 'roadmap.md not found' }, raw, '');
  }
}

// ─── Helper functions extracted from cmdRoadmapAnalyze ──────────────────────

/**
 * Parse all phase sections from roadmap.md content.
 * Returns an array of phase objects with number, name, goal, depends_on,
 * and the raw section text.
 * @param {string} content - Full roadmap.md content
 * @returns {Array<{number: string, name: string, goal: string|null, depends_on: string|null, sectionStart: number}>}
 */
function enumerateRoadmapPhases(content) {
  const phases = [];

  // Reset lastIndex since PHASE_HEADER_RE is a global regex
  PHASE_HEADER_RE.lastIndex = 0;
  let match;

  while ((match = PHASE_HEADER_RE.exec(content)) !== null) {
    const phaseNum = match[1];
    const phaseName = match[2].replace(/\(INSERTED\)/i, '').trim();

    // Extract the section text between this header and the next phase header
    const sectionStart = match.index;
    const restOfContent = content.slice(sectionStart);
    const nextHeader = restOfContent.match(/\n#{2,4}\s+Phase\s+\d/i);
    const sectionEnd = nextHeader ? sectionStart + nextHeader.index : content.length;
    const section = content.slice(sectionStart, sectionEnd);

    // Extract goal from the section
    const goalMatch = section.match(/(?:\*\*Goal:\*\*|\*\*Goal\*\*:)\s*([^\n]+)/i);
    const goal = goalMatch ? goalMatch[1].trim() : null;

    // Extract dependency info from the section
    const dependsMatch = section.match(/(?:\*\*Depends on:\*\*|\*\*Depends on\*\*:)\s*([^\n]+)/i);
    const dependsOn = dependsMatch ? dependsMatch[1].trim() : null;

    phases.push({
      number: phaseNum,
      name: phaseName,
      goal,
      depends_on: dependsOn,
    });
  }

  return phases;
}

/**
 * Enrich a phase object with disk status by reading the phases directory.
 * Adds plan_count, summary_count, has_context, has_research, and disk_status.
 * @param {string} cwd - Working directory path
 * @param {Object} phase - Phase object with at least a `number` field
 * @returns {Object} Phase object enriched with disk status fields
 */
function enrichPhaseWithDiskStatus(cwd, phase) {
  const phasesDirPath = phasesPath(cwd);
  const normalized = normalizePhaseName(phase.number);
  let diskStatus = 'no_directory';
  let planCount = 0;
  let summaryCount = 0;
  let hasContext = false;
  let hasResearch = false;

  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    const dirMatch = dirs.find(dirName => dirName.startsWith(normalized + '-') || dirName === normalized);

    if (dirMatch) {
      const phaseFiles = fs.readdirSync(path.join(phasesDirPath, dirMatch));
      planCount = filterPlanFiles(phaseFiles).length;
      summaryCount = filterSummaryFiles(phaseFiles).length;
      hasContext = phaseFiles.some(isContextFile);
      hasResearch = phaseFiles.some(isResearchFile);

      diskStatus = classifyPhaseStatus(planCount, summaryCount, { hasResearch, hasContext });
    }
  } catch {
    // Phase directory may not exist yet
  }

  return {
    ...phase,
    plan_count: planCount,
    summary_count: summaryCount,
    has_context: hasContext,
    has_research: hasResearch,
    disk_status: diskStatus,
  };
}

/**
 * Extract milestone headings from roadmap.md content.
 * Looks for ## headers containing version numbers (e.g., "## v1.0 MVP").
 * @param {string} content - Full roadmap.md content
 * @returns {Array<{heading: string, version: string}>}
 */
function extractMilestones(content) {
  const milestones = [];
  const milestonePattern = /##\s*(.*v(\d+\.\d+)[^(\n]*)/gi;
  let milestoneMatch;

  while ((milestoneMatch = milestonePattern.exec(content)) !== null) {
    milestones.push({
      heading: milestoneMatch[1].trim(),
      version: 'v' + milestoneMatch[2],
    });
  }

  return milestones;
}

/**
 * Compute aggregate statistics from an array of enriched phase objects.
 * Identifies current phase (in progress), next phase (not yet started),
 * and computes progress percentage.
 * @param {Array} phases - Array of phase objects with disk_status, plan_count, summary_count
 * @returns {{currentPhase: string|null, nextPhase: string|null, totalPlans: number, totalSummaries: number, completedPhases: number, progressPercent: number}}
 */
function computeRoadmapStats(phases) {
  const totalPlans = phases.reduce((sum, phase) => sum + phase.plan_count, 0);
  const totalSummaries = phases.reduce((sum, phase) => sum + phase.summary_count, 0);
  const completedPhases = phases.filter(phase => phase.disk_status === 'complete').length;

  // Current phase: first phase that is in-progress (planned or partial)
  const currentPhase = phases.find(
    phase => phase.disk_status === 'planned' || phase.disk_status === 'partial'
  ) || null;

  // Next phase: first phase that hasn't been started yet
  const nextPhase = phases.find(
    phase => phase.disk_status === 'empty' ||
             phase.disk_status === 'no_directory' ||
             phase.disk_status === 'discussed' ||
             phase.disk_status === 'researched'
  ) || null;

  const progressPercent = totalPlans > 0
    ? Math.min(100, Math.round((totalSummaries / totalPlans) * 100))
    : 0;

  return {
    currentPhase: currentPhase ? currentPhase.number : null,
    nextPhase: nextPhase ? nextPhase.number : null,
    totalPlans,
    totalSummaries,
    completedPhases,
    progressPercent,
  };
}

/**
 * Analyze entire roadmap.md: extract all phases, disk status, milestones, and progress stats.
 * Orchestrates enumerateRoadmapPhases, enrichPhaseWithDiskStatus,
 * extractMilestones, and computeRoadmapStats.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdRoadmapAnalyze(cwd, raw) {
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);

  let content;
  try {
    content = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    output({ error: 'roadmap.md not found', milestones: [], phases: [], current_phase: null }, raw);
    return;
  }

  // Parse phase sections from ROADMAP content
  const rawPhases = enumerateRoadmapPhases(content);

  // Enrich each phase with disk status (plan/summary counts)
  const phases = rawPhases.map(phase => {
    const enriched = enrichPhaseWithDiskStatus(cwd, phase);

    // Check ROADMAP checkbox status for this phase
    const checkboxPattern = new RegExp(
      `-\\s*\\[(x| )\\]\\s*.*Phase\\s+${escapeRegex(phase.number)}`,
      'i'
    );
    const checkboxMatch = content.match(checkboxPattern);
    const roadmapComplete = checkboxMatch ? checkboxMatch[1] === 'x' : false;

    return { ...enriched, roadmap_complete: roadmapComplete };
  });

  // Extract milestone headings
  const milestones = extractMilestones(content);

  // Compute aggregate stats
  const stats = computeRoadmapStats(phases);

  // Detect phases in summary list without detail sections (malformed ROADMAP)
  const checklistPattern = /-\s*\[[ x]\]\s*\*\*Phase\s+(\d+[A-Z]?(?:\.\d+)*)/gi;
  const checklistPhases = new Set();
  let checklistMatch;
  while ((checklistMatch = checklistPattern.exec(content)) !== null) {
    checklistPhases.add(checklistMatch[1]);
  }
  const detailPhases = new Set(phases.map(phase => phase.number));
  const missingDetails = [...checklistPhases].filter(phaseNum => !detailPhases.has(phaseNum));

  const result = {
    milestones,
    phases,
    phase_count: phases.length,
    completed_phases: stats.completedPhases,
    total_plans: stats.totalPlans,
    total_summaries: stats.totalSummaries,
    progress_percent: stats.progressPercent,
    current_phase: stats.currentPhase,
    next_phase: stats.nextPhase,
    missing_phase_details: missingDetails.length > 0 ? missingDetails : null,
  };

  output(result, raw);
}

/**
 * Update roadmap.md progress table and plan counts for a specific phase from disk state.
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - Phase number to update progress for
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdRoadmapUpdatePlanProgress(cwd, phaseNum, raw) {
  if (!phaseNum) {
    error('phase number required for roadmap update-plan-progress');
  }

  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);

  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo) {
    error(`Phase ${phaseNum} not found`);
  }

  const planCount = phaseInfo.plans.length;
  const summaryCount = phaseInfo.summaries.length;

  if (planCount === 0) {
    output({ updated: false, reason: 'No plans found', plan_count: 0, summary_count: 0 }, raw, 'no plans');
    return;
  }

  const isComplete = summaryCount >= planCount;
  const status = isComplete ? 'Complete' : summaryCount > 0 ? 'In Progress' : 'Planned';
  const today = new Date().toISOString().split('T')[0];

  let roadmapContent;
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    output({ updated: false, reason: 'roadmap.md not found', plan_count: planCount, summary_count: summaryCount }, raw, 'no roadmap');
    return;
  }
  const phaseEscaped = escapeRegex(phaseNum);

  // Progress table row: update Plans column (summaries/plans) and Status column
  const tablePattern = new RegExp(
    `(\\|\\s*${phaseEscaped}\\.?\\s[^|]*\\|)[^|]*(\\|)\\s*[^|]*(\\|)\\s*[^|]*(\\|)`,
    'i'
  );
  const dateField = isComplete ? ` ${today} ` : '  ';
  roadmapContent = roadmapContent.replace(
    tablePattern,
    `$1 ${summaryCount}/${planCount} $2 ${status.padEnd(11)}$3${dateField}$4`
  );

  // Update plan count in phase detail section
  const planCountPattern = new RegExp(
    `(#{2,4}\\s*Phase\\s+${phaseEscaped}[\\s\\S]*?(?:\\*\\*Plans:\\*\\*|\\*\\*Plans\\*\\*:)\\s*)[^\\n]+`,
    'i'
  );
  const planCountText = isComplete
    ? `${summaryCount}/${planCount} plans complete`
    : `${summaryCount}/${planCount} plans executed`;
  roadmapContent = roadmapContent.replace(planCountPattern, `$1${planCountText}`);

  // If complete: check checkbox
  if (isComplete) {
    const checkboxPattern = new RegExp(
      `(-\\s*\\[)[ ](\\]\\s*.*Phase\\s+${phaseEscaped}[:\\s][^\\n]*)`,
      'i'
    );
    roadmapContent = roadmapContent.replace(checkboxPattern, `$1x$2 (completed ${today})`);
  }

  // Check individual plan checkboxes for plans that have matching summaries
  const completedPlanIds = new Set(phaseInfo.summaries.map(s => getSummaryId(s)));
  for (const plan of phaseInfo.plans) {
    const planId = getPlanId(plan);
    if (completedPlanIds.has(planId)) {
      const planEscaped = escapeRegex(plan);
      const planCheckbox = new RegExp(
        `(-\\s*\\[) (\\]\\s*${planEscaped})`,
        'i'
      );
      roadmapContent = roadmapContent.replace(planCheckbox, '$1x$2');
    }
  }

  try {
    fs.writeFileSync(roadmapPath, roadmapContent, 'utf-8');
  } catch (err) {
    output({ updated: false, reason: 'Failed to write roadmap.md: ' + err.message }, raw, 'write error');
    return;
  }

  output({
    updated: true,
    phase: phaseNum,
    plan_count: planCount,
    summary_count: summaryCount,
    status,
    complete: isComplete,
  }, raw, `${summaryCount}/${planCount} ${status}`);
}

/**
 * Check requirement checkboxes in REQUIREMENTS.md for the given requirement IDs.
 * Called after plan/phase completion to keep requirements in sync with STATE.md.
 * @param {string} cwd - Working directory path
 * @param {string[]} requirementIds - Array of requirement IDs to check (e.g., ['CONN-01', 'DISC-02'])
 * @returns {{ updated: boolean, checked: number, total: number }}
 */
function syncRequirementCheckboxes(cwd, requirementIds) {
  if (!requirementIds || requirementIds.length === 0) {
    return { updated: false, checked: 0, total: 0 };
  }

  const reqPath = path.join(planningPath(cwd), REQUIREMENTS_FILE);
  let content;
  try {
    content = fs.readFileSync(reqPath, 'utf-8');
  } catch {
    return { updated: false, checked: 0, total: requirementIds.length, reason: 'REQUIREMENTS.md not found' };
  }

  let checked = 0;
  for (const id of requirementIds) {
    const idEscaped = escapeRegex(id);
    // Match unchecked checkbox followed by the requirement ID (possibly bold)
    const pattern = new RegExp(`(- \\[) (\\]\\s*\\*{0,2}${idEscaped})`, 'g');
    const newContent = content.replace(pattern, '$1x$2');
    if (newContent !== content) {
      checked++;
      content = newContent;
    }
  }

  if (checked > 0) {
    try {
      fs.writeFileSync(reqPath, content, 'utf-8');
    } catch {
      return { updated: false, checked: 0, total: requirementIds.length, reason: 'Failed to write REQUIREMENTS.md' };
    }
  }

  return { updated: checked > 0, checked, total: requirementIds.length };
}

module.exports = {
  cmdRoadmapGetPhase,
  cmdRoadmapAnalyze,
  cmdRoadmapUpdatePlanProgress,
  syncRequirementCheckboxes,
  // Exported for testability
  enumerateRoadmapPhases,
  enrichPhaseWithDiskStatus,
  extractMilestones,
  computeRoadmapStats,
};
