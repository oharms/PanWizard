/**
 * Milestone — Milestone and requirements lifecycle operations
 */

const fs = require('fs');
const path = require('path');
const { PHASES_DIR, MILESTONES_DIR, ROADMAP_FILE, REQUIREMENTS_FILE, STATE_FILE, isPlanFile } = require('./constants.cjs');
const { planningPath, phasesPath, filterPlanFiles, filterSummaryFiles, fileAccessible, planningRel, readMarkdownTables, tableCellText, replaceTableCell } = require('./utils.cjs');
const { output, error, isGitRepo, isGitIgnored, execGit, escapeRegex, loadConfig } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { writeStateMd } = require('./state.cjs');

/**
 * Mark requirement IDs as complete in requirements.md checkboxes and traceability table.
 * @param {string} cwd - Working directory path
 * @param {string[]} reqIdsRaw - Array of requirement ID strings (e.g., ["REQ-01", "REQ-02"])
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdRequirementsMarkComplete(cwd, reqIdsRaw, raw) {
  if (!reqIdsRaw || reqIdsRaw.length === 0) {
    error('requirement IDs required. Usage: requirements mark-complete REQ-01,REQ-02 or REQ-01 REQ-02');
  }

  // Accept comma-separated, space-separated, or bracket-wrapped: [REQ-01, REQ-02]
  const reqIds = reqIdsRaw
    .join(' ')
    .replace(/[\[\]]/g, '')
    .split(/[,\s]+/)
    .map(id => id.trim())
    .filter(Boolean);

  if (reqIds.length === 0) {
    error('no valid requirement IDs found');
  }

  const reqPath = path.join(planningPath(cwd), REQUIREMENTS_FILE);
  let reqContent;
  try {
    reqContent = fs.readFileSync(reqPath, 'utf-8');
  } catch {
    // error key => exit 1: the caller asked to mark requirements complete and no
    // requirement was marked - the milestone record does not reflect the work.
    output({ updated: false, reason: 'requirements.md not found', error: 'requirements_not_found', ids: reqIds }, raw, 'no requirements file');
    return;
  }
  const updated = [];
  const notFound = [];
  const tableUpdated = [];
  const warnings = [];

  for (const reqId of reqIds) {
    let found = false;
    // Escape the requirement ID before interpolating into RegExp — an ID with
    // regex metacharacters otherwise crashes or mis-matches (M22, ADR audit
    // 2026-08). Matches the escapeRegex convention in phase-remove.cjs/knowledge.cjs.
    const reqEsc = escapeRegex(reqId);

    // Update checkbox: - [ ] **REQ-ID** -> - [x] **REQ-ID**
    const checkboxPattern = new RegExp(`(-\\s*\\[)[ ](\\]\\s*\\*\\*${reqEsc}\\*\\*)`, 'gi');
    if (checkboxPattern.test(reqContent)) {
      reqContent = reqContent.replace(checkboxPattern, '$1x$2');
      found = true;
    }

    // Update the traceability table: the Status column is found by its header, not
    // assumed to be the third (PAN-03), and a table PAN did not change is not
    // reported as updated.
    const row = markTraceabilityRows(reqContent, reqId);
    reqContent = row.content;
    if (row.changed) { found = true; tableUpdated.push(reqId); }
    if (row.noStatusColumn) warnings.push(`${reqId}: its traceability table has no Status column; the table was left unchanged`);
    else if (!row.rowFound && checkboxFound(reqContent, reqEsc)) warnings.push(`${reqId}: checked in the list but has no traceability table row`);

    if (found) {
      updated.push(reqId);
    } else {
      notFound.push(reqId);
    }
  }

  if (updated.length > 0) {
    try {
      fs.writeFileSync(reqPath, reqContent, 'utf-8');
    } catch (err) {
      output({ error: 'Failed to write requirements.md: ' + err.message }, raw);
      return;
    }
  }

  output({
    updated: updated.length > 0,
    marked_complete: updated,
    not_found: notFound,
    total: reqIds.length,
    table_updated: tableUpdated.length > 0,
    table_marked: tableUpdated,
    ...(warnings.length ? { warnings } : {}),
  }, raw, `${updated.length}/${reqIds.length} requirements marked complete`);
}

/** A traceability Status value that already says done. */
const DONE_STATUS_RE = /^(?:complete[d]?|done|satisfied|shipped|verified|✅|✓)\b/i;

function checkboxFound(content, reqEsc) {
  return new RegExp(`-\\s*\\[[xX ]\\]\\s*\\*\\*${reqEsc}\\*\\*`, 'i').test(content);
}

/**
 * Set a requirement's Status cell to Complete in every traceability table that
 * lists it. The ID column is the one headed Req/Requirement/ID (else the first),
 * the Status column the one headed Status; a table without one is left alone.
 * @param {string} content - requirements.md
 * @param {string} reqId
 * @returns {{content: string, rowFound: boolean, changed: boolean, noStatusColumn: boolean}}
 */
function markTraceabilityRows(content, reqId) {
  const lines = content.split('\n');
  let rowFound = false, changed = false, noStatusColumn = false;
  for (const table of readMarkdownTables(content)) {
    let idCol = table.headers.findIndex((h) => /^(?:req(?:uirement)?s?(?:[\s-]*id)?|id)$/i.test(h));
    if (idCol < 0) idCol = 0;
    const statusCol = table.headers.findIndex((h) => /^status$/i.test(h));
    for (const row of table.rows) {
      if (tableCellText(row.cells[idCol]).toLowerCase() !== reqId.toLowerCase()) continue;
      rowFound = true;
      if (statusCol < 0) { noStatusColumn = true; continue; }
      if (DONE_STATUS_RE.test(tableCellText(row.cells[statusCol]))) continue;
      const next = replaceTableCell(lines[row.line], statusCol, 'Complete');
      if (next !== lines[row.line]) { lines[row.line] = next; changed = true; }
    }
  }
  return { content: changed ? lines.join('\n') : content, rowFound, changed, noStatusColumn };
}

/**
 * Gather phase/plan/task stats and accomplishments from all phase directories.
 * @param {string} cwd - Working directory path
 * @returns {{phaseCount: number, totalPlans: number, totalTasks: number, accomplishments: string[]}}
 */
function gatherMilestoneStats(cwd) {
  const phasesDirPath = phasesPath(cwd);
  let phaseCount = 0, totalPlans = 0, totalTasks = 0;
  const accomplishments = [];

  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dirName of dirs) {
      phaseCount++;
      let phaseFiles;
      try {
        phaseFiles = fs.readdirSync(path.join(phasesDirPath, dirName));
      } catch {
        continue;
      }
      totalPlans += filterPlanFiles(phaseFiles).length;

      for (const sf of filterSummaryFiles(phaseFiles)) {
        try {
          const content = fs.readFileSync(path.join(phasesDirPath, dirName, sf), 'utf-8');
          const fm = extractFrontmatter(content);
          if (fm['one-liner']) accomplishments.push(fm['one-liner']);
          totalTasks += (content.match(/##\s*Task\s*\d+/gi) || []).length;
        } catch { /* skip unreadable */ }
      }
    }
  } catch { /* phases dir missing */ }

  return { phaseCount, totalPlans, totalTasks, accomplishments };
}

/**
 * Archive milestone files (ROADMAP, REQUIREMENTS, audit) into the milestones directory.
 * @param {string} planningDir - Absolute path to .planning/
 * @param {string} version - Milestone version (e.g., "v1.0")
 * @param {string} archiveDir - Absolute path to milestones archive directory
 * @param {string} today - Date string (YYYY-MM-DD)
 * @param {string} milestoneName - Human-readable milestone name
 */
function archiveMilestoneFiles(planningDir, version, archiveDir, today, milestoneName) {
  const warnings = [];

  try {
    const roadmap = fs.readFileSync(path.join(planningDir, ROADMAP_FILE), 'utf-8');
    fs.writeFileSync(path.join(archiveDir, `${version}-roadmap.md`), roadmap, 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push('roadmap: ' + e.message);
  }

  try {
    const req = fs.readFileSync(path.join(planningDir, REQUIREMENTS_FILE), 'utf-8');
    const header = `# Requirements Archive: ${version} ${milestoneName}\n\n**Archived:** ${today}\n**Status:** SHIPPED\n\nFor current requirements, see \`.planning/${REQUIREMENTS_FILE}\`.\n\n---\n\n`;
    fs.writeFileSync(path.join(archiveDir, `${version}-${REQUIREMENTS_FILE}`), header + req, 'utf-8');
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push('requirements: ' + e.message);
  }

  try {
    fs.renameSync(path.join(planningDir, `${version}-milestone-audit.md`), path.join(archiveDir, `${version}-milestone-audit.md`));
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push('audit: ' + e.message);
  }

  return { warnings };
}

/**
 * Build a milestone entry string for milestones.md.
 * @param {string} version - Milestone version
 * @param {string} name - Milestone name
 * @param {string} today - Date string
 * @param {{phaseCount: number, totalPlans: number, totalTasks: number, accomplishments: string[]}} stats
 * @returns {string}
 */
function createMilestoneEntry(version, name, today, stats) {
  const list = stats.accomplishments.map(item => `- ${item}`).join('\n');
  return `## ${version} ${name} (Shipped: ${today})\n\n**Phases completed:** ${stats.phaseCount} phases, ${stats.totalPlans} plans, ${stats.totalTasks} tasks\n\n**Key accomplishments:**\n${list || '- (none recorded)'}\n\n---\n\n`;
}

function cmdMilestoneComplete(cwd, version, options, raw) {
  if (!version) {
    error('version required for milestone complete (e.g., v1.0)');
  }

  const planningDir = planningPath(cwd);
  const statePath = path.join(planningDir, STATE_FILE);
  const milestonesPath = path.join(planningDir, 'milestones.md');
  const archiveDir = path.join(planningDir, MILESTONES_DIR);
  const today = new Date().toISOString().split('T')[0];
  const milestoneName = options.name || version;

  try {
    fs.mkdirSync(archiveDir, { recursive: true });
  } catch (e) {
    error(`Failed to create archive directory: ${e.message}`);
  }

  const stats = gatherMilestoneStats(cwd);
  const archiveResult = archiveMilestoneFiles(planningDir, version, archiveDir, today, milestoneName);

  // Create or append the milestone entry in milestones.md
  const milestoneEntry = createMilestoneEntry(version, milestoneName, today, stats);
  try {
    let existing;
    try { existing = fs.readFileSync(milestonesPath, 'utf-8'); } catch { existing = null; }
    if (existing !== null) {
      fs.writeFileSync(milestonesPath, existing + '\n' + milestoneEntry, 'utf-8');
    } else {
      fs.writeFileSync(milestonesPath, `# Milestones\n\n${milestoneEntry}`, 'utf-8');
    }
  } catch (e) {
    error(`Failed to update milestones.md: ${e.message}`);
  }

  // Update state.md with milestone completion info
  try {
    let stateContent = fs.readFileSync(statePath, 'utf-8');
    stateContent = stateContent.replace(/(\*\*Status:\*\*\s*).*/, `$1${version} milestone complete`);
    stateContent = stateContent.replace(/(\*\*Last Activity:\*\*\s*).*/, `$1${today}`);
    stateContent = stateContent.replace(/(\*\*Last Activity Description:\*\*\s*).*/, `$1${version} milestone completed and archived`);
    writeStateMd(statePath, stateContent, cwd);
  } catch { /* best-effort */ }

  // Archive phase directories if explicitly requested
  let phasesArchived = false;
  if (options.archivePhases) {
    try {
      const phaseArchiveDir = path.join(archiveDir, `${version}-${PHASES_DIR}`);
      fs.mkdirSync(phaseArchiveDir, { recursive: true });
      const phaseEntries = fs.readdirSync(phasesPath(cwd), { withFileTypes: true });
      const dirs = phaseEntries.filter(e => e.isDirectory()).map(e => e.name);
      for (const dirName of dirs) {
        fs.renameSync(path.join(phasesPath(cwd), dirName), path.join(phaseArchiveDir, dirName));
      }
      phasesArchived = dirs.length > 0;
    } catch { /* locked or missing */ }
  }

  const result = {
    version, name: milestoneName, date: today,
    phases: stats.phaseCount, plans: stats.totalPlans, tasks: stats.totalTasks,
    accomplishments: stats.accomplishments,
    archived: {
      roadmap: fileAccessible(path.join(archiveDir, `${version}-roadmap.md`)),
      requirements: fileAccessible(path.join(archiveDir, `${version}-${REQUIREMENTS_FILE}`)),
      audit: fileAccessible(path.join(archiveDir, `${version}-milestone-audit.md`)),
      phases: phasesArchived,
    },
    milestones_updated: true,
    state_updated: fileAccessible(statePath),
  };
  if (archiveResult.warnings.length > 0) {
    result.archive_warnings = archiveResult.warnings;
  }

  // Auto-commit + tag unless --no-commit, not a git repo, or the project keeps planning
  // files out of git (`commit_docs: false` or a gitignored planning tree), the rules
  // `phase complete` and `pan-tools commit` follow (this commit used to ignore both).
  const noCommit = options.noCommit
    || loadConfig(cwd).commit_docs === false
    || isGitIgnored(cwd, planningRel());
  if (!noCommit && isGitRepo(cwd)) {
    execGit(cwd, ['add', planningRel() + '/']);
    const commitMsg = `docs: milestone ${version} complete`;
    const commitResult = execGit(cwd, ['commit', '-m', commitMsg]);
    if (commitResult.exitCode === 0) {
      const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
      result.commit_hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
      // Create tag. Signing is explicitly disabled: tag.gpgsign=true in user
      // config turns plain `git tag` into sign-or-fail in non-interactive runs.
      const tagName = `milestone-${version}`;
      const tagResult = execGit(cwd, ['-c', 'tag.gpgsign=false', 'tag', tagName]);
      result.tag = tagResult.exitCode === 0 ? tagName : null;
    }
  }

  output(result, raw);
}

module.exports = {
  cmdRequirementsMarkComplete,
  cmdMilestoneComplete,
};
