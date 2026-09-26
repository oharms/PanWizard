/**
 * Roadmap — Roadmap parsing and update operations
 */

const fs = require('fs');
const path = require('path');
const { PHASES_DIR, ROADMAP_FILE, REQUIREMENTS_FILE, isPlanFile, isSummaryFile, isContextFile, isResearchFile, PHASE_HEADER_RE, getPlanId, getSummaryId } = require('./constants.cjs');
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
// ─── Progress table and Plans line, located by name ─────────────────────────
//
// `roadmap update-plan-progress` used to rewrite the phase's table row by column
// POSITION — cells 2 to 4, whatever the header said. On PAN's own milestone
// variant (`| Phase | Milestone | Plans Complete | Status | Completed |`) that put
// the plan count in the Milestone column; on a roadmap with other columns it
// destroyed the phase's goal and requirement ids. And the `**Plans:**` update was a
// lazy match from the phase heading onward, so a phase without its own Plans line
// had the NEXT phase's rewritten. Both are now located by name, and a table without
// Plans and Status columns is left alone and reported.

const splitRow = (line) => {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return inner.split(/(?<!\\)\|/).map((c) => c.trim());
};
const isTableLine = (line) => /^\s*\|.*\|\s*$/.test(line);
const isSeparator = (line) => /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

/**
 * Set the Plans / Status / Completed cells of the phase's row in any table whose
 * header names Plans and Status columns. Pure.
 * @returns {{content: string, updated: boolean, reason: string|null}}
 */
function updateProgressTableRow(content, phaseNum, values) {
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/);
  const phaseRe = new RegExp(`^(?:phase\\s+)?${escapeRegex(String(phaseNum))}\\.?(?=\\s|:|$)`, 'i');
  let reason = null;
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!isTableLine(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const header = splitRow(lines[i]);
    const col = (re) => header.findIndex((h) => re.test(h));
    const plansIdx = col(/\bplans?\b/i);
    const statusIdx = col(/^status$/i);
    const doneIdx = col(/^completed?(?:\s+on|\s+date)?$/i);
    for (let r = i + 2; r < lines.length && isTableLine(lines[r]); r++) {
      const cells = splitRow(lines[r]);
      if (!phaseRe.test(cells[0] || '')) continue;
      if (plansIdx < 0 || statusIdx < 0) {
        reason = `the table holding phase ${phaseNum} has no Plans and Status columns (${header.join(' | ')}) — left unchanged`;
        continue;
      }
      while (cells.length < header.length) cells.push('');
      cells[plansIdx] = values.plans;
      cells[statusIdx] = values.status;
      if (doneIdx >= 0) cells[doneIdx] = values.completed || '';
      const indent = lines[r].match(/^\s*/)[0];
      lines[r] = `${indent}| ${cells.join(' | ')} |`;
      return { content: lines.join(eol), updated: true, reason: null };
    }
  }
  return { content, updated: false, reason: reason || `no progress-table row for phase ${phaseNum}` };
}

/** Rewrite `**Plans:**` inside the phase's own section only. Pure. */
function updatePhasePlansLine(content, phaseNum, text) {
  const lines = content.split(/(?<=\n)/);
  const headRe = new RegExp(`^(#{2,4})\\s*Phase\\s+${escapeRegex(String(phaseNum))}(?=[\\s:.]|$)`, 'i');
  const start = lines.findIndex((l) => headRe.test(l));
  if (start < 0) return { content, updated: false };
  const level = lines[start].match(headRe)[1].length;
  const nextHead = new RegExp(`^#{1,${level}}\\s`);
  for (let i = start + 1; i < lines.length && !nextHead.test(lines[i]); i++) {
    const m = lines[i].match(/^(.*?(?:\*\*Plans:\*\*|\*\*Plans\*\*:)\s*)[^\r\n]*(\r?\n?)$/);
    if (m) {
      lines[i] = `${m[1]}${text}${m[2]}`;
      return { content: lines.join(''), updated: true };
    }
  }
  return { content, updated: false };
}

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
    // No error key, exit 0: a phase with no plans has nothing to sync. The roadmap
    // already says what it should say.
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
    // error key => exit 1: there are plans to record and nowhere to record them.
    output({ updated: false, reason: 'roadmap.md not found', error: 'roadmap_not_found', plan_count: planCount, summary_count: summaryCount }, raw, 'no roadmap');
    return;
  }
  const phaseEscaped = escapeRegex(phaseNum);

  // Progress table row: the Plans, Status and Completed cells, found by header.
  const table = updateProgressTableRow(roadmapContent, phaseNum, {
    plans: `${summaryCount}/${planCount}`,
    status,
    completed: isComplete ? today : '',
  });
  roadmapContent = table.content;

  // Update plan count in the phase's own detail section
  const planCountText = isComplete
    ? `${summaryCount}/${planCount} plans complete`
    : `${summaryCount}/${planCount} plans executed`;
  roadmapContent = updatePhasePlansLine(roadmapContent, phaseNum, planCountText).content;

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
    // Read back: report success only for the file this command produced.
    if (fs.readFileSync(roadmapPath, 'utf-8') !== roadmapContent) throw new Error('roadmap.md did not read back as written');
  } catch (err) {
    // error key => exit 1: the write failed, so progress was computed and then lost.
    output({ updated: false, reason: 'Failed to write roadmap.md: ' + err.message, error: err.message || 'roadmap_write_failed' }, raw, 'write error');
    return;
  }

  output({
    updated: true,
    phase: phaseNum,
    plan_count: planCount,
    summary_count: summaryCount,
    status,
    complete: isComplete,
    table_updated: table.updated,
    ...(table.updated ? {} : { table_reason: table.reason }),
  }, raw, `${summaryCount}/${planCount} ${status}${table.updated ? '' : ' (progress table not updated)'}`);
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
