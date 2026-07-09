/**
 * Phase — Phase CRUD, query, and lifecycle operations
 */

const fs = require('fs');
const path = require('path');
const { escapeRegex, normalizePhaseName, comparePhaseNum, findPhaseInternal, getArchivedPhaseDirs, generateSlugInternal, loadConfig, output, error, toPosix, isGitRepo, execGit } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { writeStateMd, readStateSafe } = require('./state.cjs');
const { enumerateRoadmapPhases } = require('./roadmap.cjs');
const { PLANNING_DIR, PHASES_DIR, ROADMAP_FILE, REQUIREMENTS_FILE, STATE_FILE, isPlanFile, isSummaryFile, getPlanId, PHASE_DIR_RE, ARCHIVE_DIR_RE } = require('./constants.cjs');
const { planningPath, phasesPath, filterPlanFiles, filterSummaryFiles, parsePhaseDir, fileAccessible } = require('./utils.cjs');
// Phase removal lives in phase-remove.cjs; re-exported below so consumers of
// phase.cjs are unaffected by the decomposition.
const { removePhaseFromDisk, renumberDecimalPhases, renumberIntegerPhases, updateRoadmapAfterRemoval, cmdPhaseRemove } = require('./phase-remove.cjs');

/**
 * List phase directories or files within phases, with optional type and archive filtering.
 * @param {string} cwd - Working directory path
 * @param {Object} options - Filter options (type, phase, includeArchived)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhasesList(cwd, options, raw) {
  const phasesDir = phasesPath(cwd);
  const { type, phase, includeArchived } = options;

  let entries;
  try {
    entries = fs.readdirSync(phasesDir, { withFileTypes: true });
  } catch {
    if (type) {
      output({ files: [], count: 0 }, raw, '');
    } else {
      output({ directories: [], count: 0 }, raw, '');
    }
    return;
  }

  try {
    // Get all phase directories
    let dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);

    // Include archived phases if requested
    if (includeArchived) {
      const archived = getArchivedPhaseDirs(cwd);
      for (const arch of archived) {
        dirs.push(`${arch.name} [${arch.milestone}]`);
      }
    }

    // Sort numerically (handles integers, decimals, letter-suffix, hybrids)
    dirs.sort((left, right) => comparePhaseNum(left, right));

    // If filtering by phase number
    if (phase) {
      const normalized = normalizePhaseName(phase);
      const match = dirs.find(dir => dir.startsWith(normalized));
      if (!match) {
        output({ files: [], count: 0, phase_dir: null, error: 'Phase not found' }, raw, '');
        return;
      }
      dirs = [match];
    }

    // If listing files of a specific type
    if (type) {
      const files = [];
      for (const dir of dirs) {
        const dirPath = path.join(phasesDir, dir);
        const dirFiles = fs.readdirSync(dirPath);

        let filtered;
        if (type === 'plans') {
          filtered = dirFiles.filter(isPlanFile);
        } else if (type === 'summaries') {
          filtered = dirFiles.filter(isSummaryFile);
        } else {
          error(`Unknown type: ${type}. Expected 'plans' or 'summaries'`);
        }

        files.push(...filtered.sort());
      }

      const result = {
        files,
        count: files.length,
        phase_dir: phase ? dirs[0].replace(/^\d+(?:\.\d+)*-?/, '') : null,
      };
      output(result, raw, files.join('\n'));
      return;
    }

    // Default: list directories
    output({ directories: dirs, count: dirs.length }, raw, dirs.join('\n'));
  } catch (err) {
    error('Failed to list phases: ' + err.message);
  }
}

/**
 * Calculate the next available decimal phase number for inserting after a base phase.
 * @param {string} cwd - Working directory path
 * @param {string} basePhase - Base phase number to derive decimal from (e.g., "06")
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhaseNextDecimal(cwd, basePhase, raw) {
  const phasesDir = phasesPath(cwd);
  const normalized = normalizePhaseName(basePhase);

  let nextDecEntries;
  try {
    nextDecEntries = fs.readdirSync(phasesDir, { withFileTypes: true });
  } catch {
    output(
      {
        found: false,
        base_phase: normalized,
        next: `${normalized}.1`,
        existing: [],
      },
      raw,
      `${normalized}.1`
    );
    return;
  }

  try {
    const dirs = nextDecEntries.filter(entry => entry.isDirectory()).map(entry => entry.name);

    // Check if base phase exists
    const baseExists = dirs.some(dir => dir.startsWith(normalized + '-') || dir === normalized);

    // Find existing decimal phases for this base
    const decimalPattern = new RegExp(`^${normalized}\\.(\\d+)`);
    const existingDecimals = [];

    for (const dir of dirs) {
      const match = dir.match(decimalPattern);
      if (match) {
        existingDecimals.push(`${normalized}.${match[1]}`);
      }
    }

    // Sort numerically
    existingDecimals.sort((left, right) => comparePhaseNum(left, right));

    // Calculate next decimal
    let nextDecimal;
    if (existingDecimals.length === 0) {
      nextDecimal = `${normalized}.1`;
    } else {
      const lastDecimal = existingDecimals[existingDecimals.length - 1];
      const lastNum = parseInt(lastDecimal.split('.')[1], 10);
      nextDecimal = `${normalized}.${lastNum + 1}`;
    }

    output(
      {
        found: baseExists,
        base_phase: normalized,
        next: nextDecimal,
        existing: existingDecimals,
      },
      raw,
      nextDecimal
    );
  } catch (err) {
    error('Failed to calculate next decimal phase: ' + err.message);
  }
}

/**
 * Find a phase directory by number and return its metadata, plans, and summaries.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number or identifier to find
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdFindPhase(cwd, phase, raw) {
  if (!phase) {
    error('phase identifier required');
  }

  const phasesDir = phasesPath(cwd);
  const normalized = normalizePhaseName(phase);

  const notFound = { found: false, directory: null, phase_number: null, phase_name: null, plans: [], summaries: [] };

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((left, right) => comparePhaseNum(left, right));

    const match = dirs.find(dir => dir.startsWith(normalized));
    if (!match) {
      output(notFound, raw, '');
      return;
    }

    // Parse phase number and name from directory name (e.g. "01-setup-auth")
    const dirMatch = match.match(PHASE_DIR_RE);
    const phaseNumber = dirMatch ? dirMatch[1] : normalized;
    const phaseName = dirMatch && dirMatch[2] ? dirMatch[2] : null;

    const phaseDir = path.join(phasesDir, match);
    const phaseFiles = fs.readdirSync(phaseDir);
    const plans = filterPlanFiles(phaseFiles);
    const summaries = filterSummaryFiles(phaseFiles);

    const result = {
      found: true,
      directory: toPosix(path.join(PLANNING_DIR, PHASES_DIR, match)),
      phase_number: phaseNumber,
      phase_name: phaseName,
      plans,
      summaries,
    };

    output(result, raw, result.directory);
  } catch {
    // Phase directory does not exist or is unreadable
    output(notFound, raw, '');
  }
}

/**
 * Build an index of all plans in a phase with wave grouping, frontmatter, and completion status.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number to index
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhasePlanIndex(cwd, phase, raw) {
  if (!phase) {
    error('phase required for phase-plan-index');
  }

  const phasesDir = phasesPath(cwd);
  const normalized = normalizePhaseName(phase);

  // Find phase directory
  let phaseDir = null;
  let phaseDirName = null;
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((left, right) => comparePhaseNum(left, right));
    const match = dirs.find(dir => dir.startsWith(normalized));
    if (match) {
      phaseDir = path.join(phasesDir, match);
      phaseDirName = match;
    }
  } catch {
    // Phases directory does not exist or is unreadable
  }

  if (!phaseDir) {
    output({ phase: normalized, error: 'Phase not found', plans: [], waves: {}, incomplete: [], has_checkpoints: false }, raw);
    return;
  }

  // Get all files in phase directory
  let phaseFiles;
  try {
    phaseFiles = fs.readdirSync(phaseDir);
  } catch (e) {
    output({ phase: normalized, error: 'Cannot read phase directory: ' + e.message, plans: [], waves: {}, incomplete: [], has_checkpoints: false }, raw);
    return;
  }
  const planFiles = filterPlanFiles(phaseFiles);
  const summaryFiles = filterSummaryFiles(phaseFiles);

  const { plans, waves, incomplete, hasCheckpoints } = buildPlanIndex(phaseDir, planFiles, summaryFiles);

  output({ phase: normalized, plans, waves, incomplete, has_checkpoints: hasCheckpoints }, raw);
}

/**
 * Build a plan index from plan and summary file lists within a phase directory.
 * Reads each plan file, extracts frontmatter, and builds plan detail objects.
 * @param {string} phaseDir - Absolute path to the phase directory
 * @param {string[]} planFiles - List of plan filenames
 * @param {string[]} summaryFiles - List of summary filenames
 * @returns {{plans: Array, waves: Object, incomplete: string[], hasCheckpoints: boolean}}
 */
function buildPlanIndex(phaseDir, planFiles, summaryFiles) {
  const completedPlanIds = new Set(
    summaryFiles.map(summaryFile => summaryFile.replace('-summary.md', '').replace('summary.md', ''))
  );

  const plans = [];
  const waves = {};
  const incomplete = [];
  let hasCheckpoints = false;

  for (const planFile of planFiles) {
    const planId = getPlanId(planFile);
    const planFilePath = path.join(phaseDir, planFile);
    let content, frontmatter;
    try {
      content = fs.readFileSync(planFilePath, 'utf-8');
      frontmatter = extractFrontmatter(content);
    } catch { continue; }

    // Count tasks: XML <task> tags (current format) or legacy ## Task N headings
    const xmlTaskMatches = content.match(/<task\b/gi) || [];
    const mdTaskMatches = content.match(/##\s*Task\s*\d+/gi) || [];
    const taskCount = xmlTaskMatches.length || mdTaskMatches.length;
    const wave = parseInt(frontmatter.wave, 10) || 1;

    let autonomous = true;
    if (frontmatter.autonomous !== undefined) {
      autonomous = frontmatter.autonomous === 'true' || frontmatter.autonomous === true;
    }
    if (!autonomous) hasCheckpoints = true;

    // files_modified supports both underscore (YAML standard) and hyphen (legacy) key
    const rawFiles = frontmatter.files_modified || frontmatter['files-modified'];
    let filesModified = [];
    if (rawFiles) {
      filesModified = Array.isArray(rawFiles) ? rawFiles : [rawFiles];
    }

    // Objective: prefer frontmatter field, fall back to <objective> XML body tag
    let objective = frontmatter.objective || null;
    if (!objective) {
      const objMatch = content.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/i);
      if (objMatch) objective = objMatch[1].split('\n')[0].trim();
    }

    const hasSummary = completedPlanIds.has(planId);
    if (!hasSummary) incomplete.push(planId);

    plans.push({
      id: planId, wave, autonomous,
      objective,
      files_modified: filesModified,
      task_count: taskCount,
      has_summary: hasSummary,
    });

    const waveKey = String(wave);
    if (!waves[waveKey]) waves[waveKey] = [];
    waves[waveKey].push(planId);
  }

  return { plans, waves, incomplete, hasCheckpoints };
}

/**
 * Append a new phase to the end of the roadmap and create its directory.
 * @param {string} cwd - Working directory path
 * @param {string} description - Human-readable phase description
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhaseAdd(cwd, description, raw) {
  if (!description) {
    error('description required for phase add');
  }

  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  let content;
  try {
    content = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    error('roadmap.md not found');
  }
  const slug = generateSlugInternal(description);

  // Find highest integer phase number
  const phasePattern = /#{2,4}\s*Phase\s+(\d+)[A-Z]?(?:\.\d+)*:/gi;
  let maxPhase = 0;
  let phaseMatch;
  while ((phaseMatch = phasePattern.exec(content)) !== null) {
    const num = parseInt(phaseMatch[1], 10);
    if (num > maxPhase) maxPhase = num;
  }

  const newPhaseNum = maxPhase + 1;
  const paddedNum = String(newPhaseNum).padStart(2, '0');
  const dirName = `${paddedNum}-${slug}`;
  const dirPath = path.join(phasesPath(cwd), dirName);

  // Create directory with .gitkeep so git tracks empty folders
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, '.gitkeep'), '');
  } catch (e) {
    error(`Failed to create phase directory: ${e.message}`);
  }

  // Build phase entry
  const phaseEntry = `\n### Phase ${newPhaseNum}: ${description}\n\n**Goal:** [To be planned]\n**Requirements**: TBD\n**Depends on:** Phase ${maxPhase}\n**Plans:** 0 plans\n\nPlans:\n- [ ] TBD (run /pan:plan-phase ${newPhaseNum} to break down)\n`;

  // Find insertion point: before last "---" or at end
  let updatedContent;
  const lastSeparator = content.lastIndexOf('\n---');
  if (lastSeparator > 0) {
    updatedContent = content.slice(0, lastSeparator) + phaseEntry + content.slice(lastSeparator);
  } else {
    updatedContent = content + phaseEntry;
  }

  try {
    fs.writeFileSync(roadmapPath, updatedContent, 'utf-8');
  } catch (e) {
    error(`Failed to write roadmap.md: ${e.message}`);
  }

  const result = {
    phase_number: newPhaseNum,
    padded: paddedNum,
    name: description,
    slug,
    directory: `.planning/${PHASES_DIR}/${dirName}`,
  };

  output(result, raw, paddedNum);
}

/**
 * Insert a decimal phase after an existing phase (e.g., 06.1) and update the roadmap.
 * @param {string} cwd - Working directory path
 * @param {string} afterPhase - Phase number to insert after
 * @param {string} description - Human-readable phase description
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhaseInsert(cwd, afterPhase, description, raw) {
  if (!afterPhase || !description) {
    error('after-phase and description required for phase insert');
  }

  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  let content;
  try {
    content = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    error('roadmap.md not found');
  }
  const slug = generateSlugInternal(description);

  // Normalize input then strip leading zeros for flexible matching
  const normalizedAfter = normalizePhaseName(afterPhase);
  const unpadded = normalizedAfter.replace(/^0+/, '');
  const afterPhaseEscaped = unpadded.replace(/\./g, '\\.');
  const targetPattern = new RegExp(`#{2,4}\\s*Phase\\s+0*${afterPhaseEscaped}:`, 'i');
  if (!targetPattern.test(content)) {
    error(`Phase ${afterPhase} not found in roadmap.md`);
  }

  // Calculate next decimal using existing logic
  const phasesDir = phasesPath(cwd);
  const normalizedBase = normalizePhaseName(afterPhase);
  let existingDecimals = [];

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    const decimalPattern = new RegExp(`^${normalizedBase}\\.(\\d+)`);
    for (const dir of dirs) {
      const decMatch = dir.match(decimalPattern);
      if (decMatch) existingDecimals.push(parseInt(decMatch[1], 10));
    }
  } catch {
    // Phases directory does not exist; proceed with empty decimal list
  }

  const nextDecimal = existingDecimals.length === 0 ? 1 : Math.max(...existingDecimals) + 1;
  const decimalPhase = `${normalizedBase}.${nextDecimal}`;
  const dirName = `${decimalPhase}-${slug}`;
  const dirPath = path.join(phasesDir, dirName);

  // Create directory with .gitkeep so git tracks empty folders
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    fs.writeFileSync(path.join(dirPath, '.gitkeep'), '');
  } catch (e) {
    error(`Failed to create phase directory: ${e.message}`);
  }

  // Build phase entry
  const phaseEntry = `\n### Phase ${decimalPhase}: ${description} (INSERTED)\n\n**Goal:** [Urgent work - to be planned]\n**Requirements**: TBD\n**Depends on:** Phase ${afterPhase}\n**Plans:** 0 plans\n\nPlans:\n- [ ] TBD (run /pan:plan-phase ${decimalPhase} to break down)\n`;

  // Insert after the target phase section
  const headerPattern = new RegExp(`(#{2,4}\\s*Phase\\s+0*${afterPhaseEscaped}:[^\\n]*\\n)`, 'i');
  const headerMatch = content.match(headerPattern);
  if (!headerMatch) {
    error(`Could not find Phase ${afterPhase} header`);
  }

  const headerIdx = content.indexOf(headerMatch[0]);
  const afterHeader = content.slice(headerIdx + headerMatch[0].length);
  const nextPhaseMatch = afterHeader.match(/\n#{2,4}\s+Phase\s+\d/i);

  let insertIdx;
  if (nextPhaseMatch) {
    insertIdx = headerIdx + headerMatch[0].length + nextPhaseMatch.index;
  } else {
    insertIdx = content.length;
  }

  const updatedContent = content.slice(0, insertIdx) + phaseEntry + content.slice(insertIdx);
  try {
    fs.writeFileSync(roadmapPath, updatedContent, 'utf-8');
  } catch (e) {
    error(`Failed to write roadmap.md: ${e.message}`);
  }

  const result = {
    phase_number: decimalPhase,
    after_phase: afterPhase,
    name: description,
    slug,
    directory: `.planning/${PHASES_DIR}/${dirName}`,
  };

  output(result, raw, decimalPhase);
}

// ─── Phase removal — extracted to phase-remove.cjs (re-exported below) ──────

// ─── cmdPhaseComplete helpers ───────────────────────────────────────────────

/**
 * Update roadmap.md and requirements.md to mark a phase as complete.
 * Checks the phase checkbox, updates the progress table, sets the plan count,
 * and marks any linked requirements as complete.
 *
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - Phase number being completed
 * @param {string} _phaseName - Human-readable phase name (reserved for future use)
 * @param {number} planCount - Total number of plans in the phase
 * @param {number} summaryCount - Number of completed summaries
 */
function markPhaseCompleteInRoadmap(cwd, phaseNum, _phaseName, planCount, summaryCount) {
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  const today = new Date().toISOString().split('T')[0];

  let roadmapContent;
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    return;
  }

  // Checkbox: - [ ] Phase N: -> - [x] Phase N: (...completed DATE)
  const checkboxPattern = new RegExp(
    `(-\\s*\\[)[ ](\\]\\s*.*Phase\\s+${escapeRegex(phaseNum)}[:\\s][^\\n]*)`,
    'i'
  );
  roadmapContent = roadmapContent.replace(checkboxPattern, `$1x$2 (completed ${today})`);

  // Progress table: update Plans Complete, Status, and Date columns
  const phaseEscaped = escapeRegex(phaseNum);
  const tablePattern = new RegExp(
    `(\\|\\s*${phaseEscaped}\\.?\\s[^|]*\\|)\\s*[^|]*(\\|)\\s*[^|]*(\\|)\\s*[^|]*(\\|)`,
    'i'
  );
  roadmapContent = roadmapContent.replace(
    tablePattern,
    `$1 ${summaryCount}/${planCount} $2 Complete    $3 ${today} $4`
  );

  // Update plan count in phase section
  const planCountPattern = new RegExp(
    `(#{2,4}\\s*Phase\\s+${phaseEscaped}[\\s\\S]*?(?:\\*\\*Plans:\\*\\*|\\*\\*Plans\\*\\*:)\\s*)[^\\n]+`,
    'i'
  );
  roadmapContent = roadmapContent.replace(
    planCountPattern,
    `$1${summaryCount}/${planCount} plans complete`
  );

  try {
    fs.writeFileSync(roadmapPath, roadmapContent, 'utf-8');
  } catch {
    // Roadmap write is best-effort during phase completion
  }

  const reqResult = markRequirementsCompleteForPhase(cwd, phaseNum, roadmapContent);
  return { requirements_warning: reqResult && reqResult.error ? reqResult.error : null };
}

/**
 * Mark requirements as complete in requirements.md for a given phase.
 * Reads the **Requirements:** field from the roadmap section, then updates
 * checkboxes and traceability table rows in requirements.md.
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - Phase number being completed
 * @param {string} roadmapContent - Current roadmap.md content (to extract req IDs)
 */
function markRequirementsCompleteForPhase(cwd, phaseNum, roadmapContent) {
  const reqPath = path.join(planningPath(cwd), REQUIREMENTS_FILE);
  try {
    const reqReadContent = fs.readFileSync(reqPath, 'utf-8');
    const reqMatch = roadmapContent.match(
      new RegExp(`Phase\\s+${escapeRegex(phaseNum)}[\\s\\S]*?(?:\\*\\*Requirements:\\*\\*|\\*\\*Requirements\\*\\*:)\\s*([^\\n]+)`, 'i')
    );
    if (!reqMatch) return;

    const reqIds = reqMatch[1].replace(/[\[\]]/g, '').split(/[,\s]+/).map(id => id.trim()).filter(Boolean);
    let reqContent = reqReadContent;

    for (const reqId of reqIds) {
      const reqEscaped = escapeRegex(reqId);
      reqContent = reqContent.replace(
        new RegExp(`(-\\s*\\[)[ ](\\]\\s*\\*\\*${reqEscaped}\\*\\*)`, 'gi'),
        '$1x$2'
      );
      reqContent = reqContent.replace(
        new RegExp(`(\\|\\s*${reqEscaped}\\s*\\|[^|]+\\|)\\s*Pending\\s*(\\|)`, 'gi'),
        '$1 Complete $2'
      );
    }

    try {
      fs.writeFileSync(reqPath, reqContent, 'utf-8');
    } catch (e) {
      return { updated: false, error: 'Failed to write requirements.md: ' + e.message };
    }
    return { updated: true };
  } catch {
    // requirements.md not found or unreadable — skip
    return { updated: false };
  }
}

/**
 * Update state.md fields after marking a phase as complete.
 * Advances to the next phase, updates status, resets plan counter.
 *
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - Phase number just completed
 * @param {number} _totalPhases - Total number of phases (reserved for future use)
 * @param {string|null} nextPhaseNum - The next phase number, or null if last phase
 * @param {string|null} nextPhaseName - The next phase name, or null
 * @param {boolean} isLastPhase - Whether this was the last phase
 */
function updateStateAfterPhaseComplete(cwd, { phaseNum, totalPhases: _totalPhases, nextPhaseNum, nextPhaseName, isLastPhase }) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const today = new Date().toISOString().split('T')[0];

  let stateContent;
  try {
    stateContent = fs.readFileSync(statePath, 'utf-8');
  } catch {
    return;
  }

  // Update Current Phase
  stateContent = stateContent.replace(
    /(\*\*Current Phase:\*\*\s*).*/,
    `$1${nextPhaseNum || phaseNum}`
  );

  // Update Current Phase Name
  if (nextPhaseName) {
    stateContent = stateContent.replace(
      /(\*\*Current Phase Name:\*\*\s*).*/,
      `$1${nextPhaseName.replace(/-/g, ' ')}`
    );
  }

  // Update Status
  stateContent = stateContent.replace(
    /(\*\*Status:\*\*\s*).*/,
    `$1${isLastPhase ? 'Milestone complete' : 'Ready to plan'}`
  );

  // Update Current Plan
  stateContent = stateContent.replace(
    /(\*\*Current Plan:\*\*\s*).*/,
    '$1Not started'
  );

  // Update Last Activity
  stateContent = stateContent.replace(
    /(\*\*Last Activity:\*\*\s*).*/,
    `$1${today}`
  );

  // Update Last Activity Description
  stateContent = stateContent.replace(
    /(\*\*Last Activity Description:\*\*\s*).*/,
    `$1Phase ${phaseNum} complete${nextPhaseNum ? `, transitioned to Phase ${nextPhaseNum}` : ''}`
  );

  writeStateMd(statePath, stateContent, cwd);
}

/**
 * Mark a phase complete, update ROADMAP checkboxes/tables, advance STATE to next phase.
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - Phase number to mark complete
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhaseComplete(cwd, phaseNum, raw, opts) {
  if (!phaseNum) {
    error('phase number required for phase complete');
  }

  const phasesDir = phasesPath(cwd);
  const normalized = normalizePhaseName(phaseNum);
  const today = new Date().toISOString().split('T')[0];

  // Verify phase info
  const phaseInfo = findPhaseInternal(cwd, phaseNum);
  if (!phaseInfo) {
    error(`Phase ${phaseNum} not found`);
  }

  const planCount = phaseInfo.plans.length;
  const summaryCount = phaseInfo.summaries.length;

  // Update roadmap.md and requirements.md
  const roadmapResult = markPhaseCompleteInRoadmap(cwd, phaseNum, phaseInfo.phase_name, planCount, summaryCount);

  // Find next phase — check disk directories first, fall back to roadmap
  let nextPhaseNum = null;
  let nextPhaseName = null;
  let isLastPhase = true;

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((left, right) => comparePhaseNum(left, right));

    // Find the next phase directory after current by comparing phase numbers
    for (const dir of dirs) {
      const dirMatch = dir.match(PHASE_DIR_RE);
      if (dirMatch) {
        if (comparePhaseNum(dirMatch[1], phaseNum) > 0) {
          nextPhaseNum = dirMatch[1];
          nextPhaseName = dirMatch[2] || null;
          isLastPhase = false;
          break;
        }
      }
    }
  } catch {
    // Phases directory unreadable; fall through to roadmap lookup
  }

  // If no next directory found, look in roadmap for the next planned phase
  if (isLastPhase) {
    try {
      const roadmapContent = fs.readFileSync(path.join(planningPath(cwd), ROADMAP_FILE), 'utf-8');
      const roadmapPhases = enumerateRoadmapPhases(roadmapContent);
      for (const rp of roadmapPhases) {
        if (comparePhaseNum(rp.number, phaseNum) > 0) {
          nextPhaseNum = rp.number;
          nextPhaseName = rp.name || null;
          isLastPhase = false;
          break;
        }
      }
    } catch { /* roadmap unreadable; this truly is the last phase */ }
  }

  // Update state.md
  updateStateAfterPhaseComplete(cwd, { phaseNum, totalPhases: 0, nextPhaseNum, nextPhaseName, isLastPhase });

  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);

  const result = {
    completed_phase: phaseNum,
    phase_name: phaseInfo.phase_name,
    plans_executed: `${summaryCount}/${planCount}`,
    next_phase: nextPhaseNum,
    next_phase_name: nextPhaseName,
    is_last_phase: isLastPhase,
    date: today,
    roadmap_updated: fileAccessible(roadmapPath),
    state_updated: fileAccessible(statePath),
  };
  if (roadmapResult && roadmapResult.requirements_warning) {
    result.requirements_warning = roadmapResult.requirements_warning;
  }

  // Auto-commit .planning/ metadata unless --no-commit or not a git repo
  const noCommit = opts && opts.noCommit;
  if (!noCommit && isGitRepo(cwd)) {
    const commitMsg = `docs(${normalized}): complete phase — ${phaseInfo.phase_name}`;
    execGit(cwd, ['add', PLANNING_DIR + '/']);
    const commitResult = execGit(cwd, ['commit', '-m', commitMsg]);
    if (commitResult.exitCode === 0) {
      const hashResult = execGit(cwd, ['rev-parse', '--short', 'HEAD']);
      result.commit_hash = hashResult.exitCode === 0 ? hashResult.stdout : null;
    }
  }

  output(result, raw);
}

/**
 * Classify a plan as MICRO, STANDARD, or FULL based on complexity.
 * @param {Object} frontmatter - Parsed plan.md frontmatter
 * @param {Object} [config] - Optional config with budget.micro_threshold_tasks/files
 * @returns {string} 'micro' | 'standard' | 'full'
 */
function classifyPlanTier(frontmatter, config) {
  if (!frontmatter || typeof frontmatter !== 'object') {
    return 'standard';
  }

  // Explicit tier in frontmatter always wins
  if (frontmatter.tier && ['micro', 'standard', 'full'].includes(frontmatter.tier)) {
    return frontmatter.tier;
  }

  // autonomous=false forces FULL (handle both boolean and string from YAML)
  if (frontmatter.autonomous === false || frontmatter.autonomous === 'false') {
    return 'full';
  }

  // Get thresholds from config or use defaults
  const thresholdTasks = (config && config.budget && config.budget.micro_threshold_tasks) || 3;
  const thresholdFiles = (config && config.budget && config.budget.micro_threshold_files) || 2;

  // Count tasks — check task_count (number or numeric string) or fall back to tasks array
  let taskCount = null;
  if (frontmatter.task_count !== undefined && frontmatter.task_count !== null) {
    const parsed = Number(frontmatter.task_count);
    if (!isNaN(parsed)) taskCount = parsed;
  }
  if (taskCount === null && Array.isArray(frontmatter.tasks)) {
    taskCount = frontmatter.tasks.length;
  }

  // Count files modified
  const filesCount = Array.isArray(frontmatter.files_modified)
    ? frontmatter.files_modified.length
    : 0;

  // If we can't determine task count, default to STANDARD
  if (taskCount === null) {
    return 'standard';
  }

  // MICRO: small task count AND small file count
  if (taskCount <= thresholdTasks && filesCount <= thresholdFiles) {
    return 'micro';
  }

  // STANDARD: up to 8 tasks
  if (taskCount <= 8) {
    return 'standard';
  }

  // FULL: everything else
  return 'full';
}

module.exports = {
  cmdPhasesList,
  cmdPhaseNextDecimal,
  cmdFindPhase,
  cmdPhasePlanIndex,
  cmdPhaseAdd,
  cmdPhaseInsert,
  cmdPhaseRemove,
  cmdPhaseComplete,
  // Exported for testability (helpers)
  removePhaseFromDisk,
  renumberDecimalPhases,
  renumberIntegerPhases,
  updateRoadmapAfterRemoval,
  markPhaseCompleteInRoadmap,
  updateStateAfterPhaseComplete,
  classifyPlanTier,
};
