/**
 * State -- state.md operations and progression engine
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, getMilestoneInfo, escapeRegex, safeReadFile, output, error } = require('./core.cjs');
const { extractFrontmatter, reconstructFrontmatter } = require('./frontmatter.cjs');
const { withFileLock, writeFileAtomic } = require('./lock.cjs');
const {
  PLANNING_DIR,
  STATE_FILE,
  ROADMAP_FILE,
  CONFIG_FILE,
  PHASES_DIR,
  isPlanFile,
  isSummaryFile,
  getPlanId,
  getSummaryId,
  FIELD_VALUE_RE,
  PROGRESS_BAR_WIDTH,
  FILLED_BLOCK,
  EMPTY_BLOCK,
} = require('./constants.cjs');
const {
  planningPath,
  phasesPath,
  filterPlanFiles,
  filterSummaryFiles,
  fileAccessible,
} = require('./utils.cjs');

/**
 * Load project state including config, state.md content, and file existence flags.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output condensed key=value format
 * @returns {void}
 */
function cmdStateLoad(cwd, raw) {
  const config = loadConfig(cwd);
  const planningDir = planningPath(cwd);

  let stateRaw = '';
  try {
    stateRaw = fs.readFileSync(path.join(planningDir, STATE_FILE), 'utf-8');
  } catch {
    // state.md may not exist yet in a fresh project -- fall through with empty string
  }

  const configExists = fileAccessible(path.join(planningDir, CONFIG_FILE));
  const roadmapExists = fileAccessible(path.join(planningDir, ROADMAP_FILE));
  const stateExists = stateRaw.length > 0;

  const result = {
    config,
    state_raw: stateRaw,
    state_exists: stateExists,
    roadmap_exists: roadmapExists,
    config_exists: configExists,
  };

  // For --raw, output a condensed key=value format
  if (raw) {
    const lines = [
      `model_profile=${config.model_profile}`,
      `commit_docs=${config.commit_docs}`,
      `branching_strategy=${config.branching_strategy}`,
      `phase_branch_template=${config.phase_branch_template}`,
      `milestone_branch_template=${config.milestone_branch_template}`,
      `parallelization=${config.parallelization}`,
      `research=${config.research}`,
      `plan_checker=${config.plan_checker}`,
      `verifier=${config.verifier}`,
      `config_exists=${configExists}`,
      `roadmap_exists=${roadmapExists}`,
      `state_exists=${stateExists}`,
    ];
    process.stdout.write(lines.join('\n'));
    process.exit(0);
  }

  output(result);
}

/**
 * Get a specific field or section from state.md.
 * @param {string} cwd - Working directory path
 * @param {string} section - Field name or section heading to retrieve
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateGet(cwd, section, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  try {
    const content = fs.readFileSync(statePath, 'utf-8');

    if (!section) {
      output({ content }, raw, content);
      return;
    }

    // Try to find markdown section or field
    const fieldEscaped = escapeRegex(section);

    // Check for **field:** value
    const fieldPattern = new RegExp(`\\*\\*${fieldEscaped}:\\*\\*\\s*(.*)`, 'i');
    const fieldMatch = content.match(fieldPattern);
    if (fieldMatch) {
      output({ [section]: fieldMatch[1].trim() }, raw, fieldMatch[1].trim());
      return;
    }

    // Check for ## Section
    const sectionPattern = new RegExp(`##\\s*${fieldEscaped}\\s*\n([\\s\\S]*?)(?=\\n##|$)`, 'i');
    const sectionMatch = content.match(sectionPattern);
    if (sectionMatch) {
      output({ [section]: sectionMatch[1].trim() }, raw, sectionMatch[1].trim());
      return;
    }

    output({ error: `Section or field "${section}" not found` }, raw, '');
  } catch {
    // state.md does not exist or is unreadable -- report as JSON (consistent with other state commands)
    output({ error: 'state.md not found' }, raw);
  }
}

function readTextArgOrFile(cwd, value, filePath, label) {
  if (!filePath) return value;

  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  try {
    return fs.readFileSync(resolvedPath, 'utf-8').trimEnd();
  } catch {
    // File specified by caller does not exist -- throw descriptive error
    throw new Error(`${label} file not found: ${filePath}`);
  }
}

/**
 * Batch-update multiple bold-field values in state.md.
 * @param {string} cwd - Working directory path
 * @param {Object.<string, string>} patches - Map of field names to new values
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStatePatch(cwd, patches, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  try {
    let content = fs.readFileSync(statePath, 'utf-8');
    const results = { updated: [], failed: [] };

    for (const [field, value] of Object.entries(patches)) {
      const fieldEscaped = escapeRegex(field);
      const pattern = new RegExp(`(\\*\\*${fieldEscaped}:\\*\\*\\s*)(.*)`, 'i');

      if (pattern.test(content)) {
        content = content.replace(pattern, (_match, prefix) => `${prefix}${value}`);
        results.updated.push(field);
      } else {
        results.failed.push(field);
      }
    }

    if (results.updated.length > 0) {
      writeStateMd(statePath, content, cwd);
    }

    output(results, raw, results.updated.length > 0 ? 'true' : 'false');
  } catch {
    // state.md does not exist or is unreadable -- report as missing
    error('state.md not found');
  }
}

/**
 * Update a single bold-field value in state.md.
 * @param {string} cwd - Working directory path
 * @param {string} field - Field name to update
 * @param {string} value - New value to set
 * @returns {void}
 */
function cmdStateUpdate(cwd, field, value) {
  if (!field || value === undefined) {
    error('field and value required for state update');
  }

  const statePath = path.join(planningPath(cwd), STATE_FILE);
  try {
    let content = fs.readFileSync(statePath, 'utf-8');
    const fieldEscaped = escapeRegex(field);
    const pattern = new RegExp(`(\\*\\*${fieldEscaped}:\\*\\*\\s*)(.*)`, 'i');
    if (pattern.test(content)) {
      content = content.replace(pattern, (_match, prefix) => `${prefix}${value}`);
      writeStateMd(statePath, content, cwd);
      output({ updated: true });
    } else {
      output({ updated: false, reason: `Field "${field}" not found in state.md` });
    }
  } catch {
    // state.md does not exist or is unreadable -- report gracefully
    output({ updated: false, reason: 'state.md not found' });
  }
}

// --- State Progression Engine ------------------------------------------------

/**
 * Extract a bold-field value from state.md markdown content.
 * @param {string} content - state.md file content
 * @param {string} fieldName - Name of the **Field:** to extract
 * @returns {string|null} Trimmed field value or null if not found
 */
function stateExtractField(content, fieldName) {
  const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
  const match = content.match(pattern);
  return match ? match[1].trim() : null;
}

/**
 * Replace a bold-field value in state.md markdown content.
 * @param {string} content - state.md file content
 * @param {string} fieldName - Name of the **Field:** to replace
 * @param {string} newValue - New value to set
 * @returns {string|null} Updated content or null if field not found
 */
function stateReplaceField(content, fieldName, newValue) {
  const escaped = escapeRegex(fieldName);
  const pattern = new RegExp(`(\\*\\*${escaped}:\\*\\*\\s*)(.*)`, 'i');
  if (pattern.test(content)) {
    return content.replace(pattern, (_match, prefix) => `${prefix}${newValue}`);
  }
  return null;
}

/**
 * Advance Current Plan counter in state.md or mark phase complete if at last plan.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateAdvancePlan(cwd, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }
  const currentPlan = parseInt(stateExtractField(content, 'Current Plan'), 10);
  const totalPlans = parseInt(stateExtractField(content, 'Total Plans in Phase'), 10);
  const today = new Date().toISOString().split('T')[0];

  if (isNaN(currentPlan) || isNaN(totalPlans)) {
    output({ error: 'Cannot parse Current Plan or Total Plans in Phase from state.md' }, raw);
    return;
  }

  if (currentPlan >= totalPlans) {
    content = stateReplaceField(content, 'Status', 'Phase complete — ready for verification') || content;
    content = stateReplaceField(content, 'Last Activity', today) || content;
    writeStateMd(statePath, content, cwd);
    output({ advanced: false, reason: 'last_plan', current_plan: currentPlan, total_plans: totalPlans, status: 'ready_for_verification' }, raw, 'false');
  } else {
    const newPlan = currentPlan + 1;
    content = stateReplaceField(content, 'Current Plan', String(newPlan)) || content;
    content = stateReplaceField(content, 'Status', 'Ready to execute') || content;
    content = stateReplaceField(content, 'Last Activity', today) || content;
    writeStateMd(statePath, content, cwd);
    output({ advanced: true, previous_plan: currentPlan, current_plan: newPlan, total_plans: totalPlans }, raw, 'true');
  }
}

/**
 * Append a performance metric row to the Performance Metrics table in state.md.
 * @param {string} cwd - Working directory path
 * @param {Object} options - Metric data (phase, plan, duration, tasks, files)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateRecordMetric(cwd, options, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }
  const { phase, plan, duration, tasks, files } = options;

  if (!phase || !plan || !duration) {
    output({ error: 'phase, plan, and duration required' }, raw);
    return;
  }

  // Find Performance Metrics section and its table
  const metricsPattern = /(##\s*Performance Metrics[\s\S]*?\n\|[^\n]+\n\|[-|\s]+\n)([\s\S]*?)(?=\n##|\n$|$)/i;
  const metricsMatch = content.match(metricsPattern);

  if (metricsMatch) {
    let tableBody = metricsMatch[2].trimEnd();
    const newRow = `| Phase ${phase} P${plan} | ${duration} | ${tasks || '-'} tasks | ${files || '-'} files |`;

    if (tableBody.trim() === '' || tableBody.includes('None yet')) {
      tableBody = newRow;
    } else {
      tableBody = tableBody + '\n' + newRow;
    }

    content = content.replace(metricsPattern, (_match, header) => `${header}${tableBody}\n`);
    writeStateMd(statePath, content, cwd);
    output({ recorded: true, phase, plan, duration }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'Performance Metrics section not found in state.md' }, raw, 'false');
  }
}

/**
 * Recalculate and update the progress bar in state.md from SUMMARY counts on disk.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateUpdateProgress(cwd, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }

  // Count summaries across all phases by scanning disk
  const phasesDir = phasesPath(cwd);
  let totalPlans = 0;
  let totalSummaries = 0;

  try {
    const phaseDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name);
    for (const dir of phaseDirs) {
      const files = fs.readdirSync(path.join(phasesDir, dir));
      totalPlans += files.filter(isPlanFile).length;
      totalSummaries += files.filter(isSummaryFile).length;
    }
  } catch {
    // Phases directory does not exist yet — totals remain 0
  }

  // Render progress bar from completed/total counts
  const progressStr = calculateProgressBar(totalSummaries, totalPlans);
  const percent = totalPlans > 0 ? Math.min(100, Math.round(totalSummaries / totalPlans * 100)) : 0;

  const progressPattern = /(\*\*Progress:\*\*\s*).*/i;
  if (progressPattern.test(content)) {
    content = content.replace(progressPattern, (_match, prefix) => `${prefix}${progressStr}`);
    writeStateMd(statePath, content, cwd);
    output({ updated: true, percent, completed: totalSummaries, total: totalPlans, bar: progressStr }, raw, progressStr);
  } else {
    output({ updated: false, reason: 'Progress field not found in state.md' }, raw, 'false');
  }
}

/**
 * Add a decision entry to the Decisions section in state.md.
 * @param {string} cwd - Working directory path
 * @param {Object} options - Decision data (phase, summary, summary_file, rationale, rationale_file)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateAddDecision(cwd, options, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }

  const { phase, summary, summary_file, rationale, rationale_file } = options;
  let summaryText = null;
  let rationaleText = '';

  try {
    summaryText = readTextArgOrFile(cwd, summary, summary_file, 'summary');
    rationaleText = readTextArgOrFile(cwd, rationale || '', rationale_file, 'rationale');
  } catch (err) {
    output({ added: false, reason: err.message }, raw, 'false');
    return;
  }

  if (!summaryText) { output({ error: 'summary required' }, raw); return; }
  const entry = `- [Phase ${phase || '?'}]: ${summaryText}${rationaleText ? ` — ${rationaleText}` : ''}`;

  // Find Decisions section (various heading patterns)
  const sectionPattern = /(###?\s*(?:Decisions|Decisions Made|Accumulated.*Decisions)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    // Remove placeholders
    sectionBody = sectionBody.replace(/None yet\.?\s*\n?/gi, '').replace(/No decisions yet\.?\s*\n?/gi, '');
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, (_match, header) => `${header}${sectionBody}`);
    writeStateMd(statePath, content, cwd);
    output({ added: true, decision: entry }, raw, 'true');
  } else {
    output({ added: false, reason: 'Decisions section not found in state.md' }, raw, 'false');
  }
}

/**
 * Add a blocker entry to the Blockers section in state.md.
 * @param {string} cwd - Working directory path
 * @param {string|Object} text - Blocker text or object with text/text_file properties
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateAddBlocker(cwd, text, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }
  const blockerOptions = typeof text === 'object' && text !== null ? text : { text };
  let blockerText = null;

  try {
    blockerText = readTextArgOrFile(cwd, blockerOptions.text, blockerOptions.text_file, 'blocker');
  } catch (err) {
    output({ added: false, reason: err.message }, raw, 'false');
    return;
  }

  if (!blockerText) { output({ error: 'text required' }, raw); return; }
  const entry = `- ${blockerText}`;

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    sectionBody = sectionBody.replace(/None\.?\s*\n?/gi, '').replace(/None yet\.?\s*\n?/gi, '');
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, (_match, header) => `${header}${sectionBody}`);
    writeStateMd(statePath, content, cwd);
    output({ added: true, blocker: blockerText }, raw, 'true');
  } else {
    output({ added: false, reason: 'Blockers section not found in state.md' }, raw, 'false');
  }
}

/**
 * Remove a matching blocker entry from the Blockers section in state.md.
 * @param {string} cwd - Working directory path
 * @param {string} text - Text to match against existing blockers (case-insensitive)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateResolveBlocker(cwd, text, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  if (!text) { output({ error: 'text required' }, raw); return; }
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    const sectionBody = match[2];
    const lines = sectionBody.split('\n');
    const filtered = lines.filter(line => {
      if (!line.startsWith('- ')) return true;
      return !line.toLowerCase().includes(text.toLowerCase());
    });

    let newBody = filtered.join('\n');
    // If section is now empty, add placeholder
    if (!newBody.trim() || !newBody.includes('- ')) {
      newBody = 'None\n';
    }

    content = content.replace(sectionPattern, (_match, header) => `${header}${newBody}`);
    writeStateMd(statePath, content, cwd);
    output({ resolved: true, blocker: text }, raw, 'true');
  } else {
    output({ resolved: false, reason: 'Blockers section not found in state.md' }, raw, 'false');
  }
}

/**
 * Update session tracking fields (last date, stopped at, resume file) in state.md.
 * @param {string} cwd - Working directory path
 * @param {Object} options - Session data (stopped_at, resume_file)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateRecordSession(cwd, options, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }
  const now = new Date().toISOString();
  const updated = [];

  // Update Last session / Last Date
  let result = stateReplaceField(content, 'Last session', now);
  if (result) { content = result; updated.push('Last session'); }
  result = stateReplaceField(content, 'Last Date', now);
  if (result) { content = result; updated.push('Last Date'); }

  // Update Stopped at
  if (options.stopped_at) {
    result = stateReplaceField(content, 'Stopped At', options.stopped_at);
    if (!result) result = stateReplaceField(content, 'Stopped at', options.stopped_at);
    if (result) { content = result; updated.push('Stopped At'); }
  }

  // Update Resume file
  const resumeFile = options.resume_file || 'None';
  result = stateReplaceField(content, 'Resume File', resumeFile);
  if (!result) result = stateReplaceField(content, 'Resume file', resumeFile);
  if (result) { content = result; updated.push('Resume File'); }

  if (updated.length > 0) {
    writeStateMd(statePath, content, cwd);
    output({ recorded: true, updated }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'No session fields found in state.md' }, raw, 'false');
  }
}

// --- Snapshot Parsers --------------------------------------------------------

/**
 * Parse the Decisions Made table from state.md content.
 * Extracts rows from a markdown table under the "## Decisions Made" heading,
 * splitting each row into phase, summary, and rationale cells.
 * @param {string} content - Full state.md content
 * @returns {Array<{phase: string, summary: string, rationale: string}>}
 */
function parseDecisionsFromState(content) {
  const decisions = [];
  // Match the decisions table body after header row and separator row
  const decisionsMatch = content.match(/##\s*Decisions Made[\s\S]*?\n\|[^\n]+\n\|[-|\s]+\n([\s\S]*?)(?=\n##|\n$|$)/i);
  if (decisionsMatch) {
    const tableBody = decisionsMatch[1];
    const rows = tableBody.trim().split('\n').filter(row => row.includes('|'));
    for (const row of rows) {
      const cells = row.split('|').map(cell => cell.trim()).filter(Boolean);
      if (cells.length >= 3) {
        decisions.push({
          phase: cells[0],
          summary: cells[1],
          rationale: cells[2],
        });
      }
    }
  }
  return decisions;
}

/**
 * Parse the Blockers section from state.md content.
 * Extracts bullet-point items (lines starting with "- ") from under
 * the "## Blockers" heading.
 * @param {string} content - Full state.md content
 * @returns {string[]} Array of blocker text strings
 */
function parseBlockersFromState(content) {
  const blockers = [];
  const blockersMatch = content.match(/##\s*Blockers\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (blockersMatch) {
    const blockersSection = blockersMatch[1];
    const items = blockersSection.match(/^-\s+(.+)$/gm) || [];
    for (const item of items) {
      blockers.push(item.replace(/^-\s+/, '').trim());
    }
  }
  return blockers;
}

/**
 * Parse the Session section from state.md content.
 * Extracts **Last Date:**, **Stopped At:**, and **Resume File:** bold-field
 * values from under the "## Session" heading.
 * @param {string} content - Full state.md content
 * @returns {{last_date: string|null, stopped_at: string|null, resume_file: string|null}}
 */
function parseSessionFromState(content) {
  const session = {
    last_date: null,
    stopped_at: null,
    resume_file: null,
  };

  const sessionMatch = content.match(/##\s*Session[^\n]*\n([\s\S]*?)(?=\n##|$)/i);
  if (sessionMatch) {
    const sessionSection = sessionMatch[1];
    const lastDateMatch = sessionSection.match(/\*\*(?:Last Date|Last session):\*\*\s*(.+)/i);
    const stoppedAtMatch = sessionSection.match(/\*\*Stopped At:\*\*\s*(.+)/i);
    const resumeFileMatch = sessionSection.match(/\*\*Resume File:\*\*\s*(.+)/i);

    if (lastDateMatch) session.last_date = lastDateMatch[1].trim();
    if (stoppedAtMatch) session.stopped_at = stoppedAtMatch[1].trim();
    if (resumeFileMatch) session.resume_file = resumeFileMatch[1].trim();
  }

  return session;
}

/**
 * Extract a structured snapshot of all state.md fields, decisions, blockers, and session info.
 * Orchestrates the individual parsers to build a complete state snapshot object.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateSnapshot(cwd, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }

  // Reuse shared field extraction
  const fields = extractFieldsFromState(content);

  // Parse numeric fields
  const totalPhases = fields.totalPhasesRaw ? parseInt(fields.totalPhasesRaw, 10) : null;
  const totalPlansInPhase = fields.totalPlansRaw ? parseInt(fields.totalPlansRaw, 10) : null;
  let progressPercent = null;
  if (fields.progressRaw) {
    const pctMatch = fields.progressRaw.match(/(\d+)%/);
    if (pctMatch) progressPercent = parseInt(pctMatch[1], 10);
  }

  // Delegate to specialized parsers for complex sections
  const decisions = parseDecisionsFromState(content);
  const blockers = parseBlockersFromState(content);
  const session = parseSessionFromState(content);

  const result = {
    current_phase: fields.currentPhase,
    current_phase_name: fields.currentPhaseName,
    total_phases: totalPhases,
    current_plan: fields.currentPlan,
    total_plans_in_phase: totalPlansInPhase,
    status: fields.status,
    progress_percent: progressPercent,
    last_activity: fields.lastActivity,
    last_activity_desc: fields.lastActivityDesc,
    decisions,
    blockers,
    paused_at: fields.pausedAt,
    session,
  };

  output(result, raw);
}

// --- State Frontmatter Sync --------------------------------------------------

/**
 * Extract key **Field:** value pairs from state.md markdown body content.
 * Parses fields needed for frontmatter: phase, plan, status, progress, etc.
 * @param {string} bodyContent - state.md body (without frontmatter)
 * @returns {Object} Extracted field values keyed by semantic name
 */
function extractFieldsFromState(bodyContent) {
  const extractField = (fieldName) => {
    const pattern = new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`, 'i');
    const match = bodyContent.match(pattern);
    return match ? match[1].trim() : null;
  };

  return {
    currentPhase: extractField('Current Phase'),
    currentPhaseName: extractField('Current Phase Name'),
    currentPlan: extractField('Current Plan'),
    totalPhasesRaw: extractField('Total Phases'),
    totalPlansRaw: extractField('Total Plans in Phase'),
    status: extractField('Status'),
    progressRaw: extractField('Progress'),
    lastActivity: extractField('Last Activity'),
    lastActivityDesc: extractField('Last Activity Description'),
    stoppedAt: extractField('Stopped At') || extractField('Stopped at'),
    pausedAt: extractField('Paused At'),
  };
}

/**
 * Scan phase directories on disk to count plans and summaries.
 * Reads each subdirectory under .planning/phases/ and tallies plan/summary files
 * to determine per-phase and overall completion counts.
 * @param {string} cwd - Working directory path
 * @returns {{totalPhases: number|null, completedPhases: number|null, totalPlans: number|null, completedPlans: number|null}}
 */
function scanPhaseProgress(cwd) {
  let totalPhases = null;
  let completedPhases = null;
  let totalPlans = null;
  let completedPlans = null;

  try {
    const phasesDir = phasesPath(cwd);
    const phaseDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => entry.name);
    let diskTotalPlans = 0;
    let diskTotalSummaries = 0;
    let diskCompletedPhases = 0;

    // Walk each phase directory and count plan vs summary files
    for (const dir of phaseDirs) {
      const files = fs.readdirSync(path.join(phasesDir, dir));
      const plans = files.filter(isPlanFile).length;
      const summaries = files.filter(isSummaryFile).length;
      diskTotalPlans += plans;
      diskTotalSummaries += summaries;
      // A phase is complete when every plan has a corresponding summary
      if (plans > 0 && summaries >= plans) diskCompletedPhases++;
    }
    totalPhases = phaseDirs.length;
    completedPhases = diskCompletedPhases;
    totalPlans = diskTotalPlans;
    completedPlans = diskTotalSummaries;
  } catch {
    // Phases directory may not exist or be unreadable -- return nulls
  }

  return { totalPhases, completedPhases, totalPlans, completedPlans };
}

/**
 * Normalize a human-readable status string to a canonical machine-readable value.
 * Maps free-form status text (e.g. "In progress", "Phase complete") to one of:
 * planning, discussing, executing, verifying, paused, completed, unknown.
 *
 * Priority order:
 *   1. paused/stopped (highest -- overrides all)
 *   2. executing/in-progress
 *   3. planning/ready-to-plan
 *   4. discussing
 *   5. verifying
 *   6. completed/done
 *   7. ready-to-execute (falls into executing)
 *   8. unknown (fallback)
 *
 * @param {string|null} status - Raw status string from state.md
 * @param {string|null} pausedAt - Value of **Paused At:** field (presence forces paused)
 * @returns {string} Normalized status string
 */
function normalizePhaseStatus(status, pausedAt) {
  let normalizedStatus = status || 'unknown';
  const statusLower = (status || '').toLowerCase();

  // Paused/stopped takes highest priority -- if pausedAt field exists, always paused
  if (statusLower.includes('paused') || statusLower.includes('stopped') || pausedAt) {
    normalizedStatus = 'paused';
  } else if (statusLower.includes('executing') || statusLower.includes('in progress')) {
    normalizedStatus = 'executing';
  } else if (statusLower.includes('planning') || statusLower.includes('ready to plan')) {
    normalizedStatus = 'planning';
  } else if (statusLower.includes('discussing')) {
    normalizedStatus = 'discussing';
  } else if (statusLower.includes('verif')) {
    normalizedStatus = 'verifying';
  } else if (statusLower.includes('complete') || statusLower.includes('done')) {
    normalizedStatus = 'completed';
  } else if (statusLower.includes('ready to execute')) {
    // "Ready to execute" is treated as executing since execution is imminent
    normalizedStatus = 'executing';
  }

  return normalizedStatus;
}

/**
 * Render a text-based progress bar string from completed and total counts.
 * Uses filled/empty block characters: [##########] 100%
 * @param {number} completed - Number of completed items (summaries)
 * @param {number} total - Total number of items (plans)
 * @returns {string} Formatted progress bar string, e.g. "[#####-----] 50%"
 */
function calculateProgressBar(completed, total) {
  // Calculate percentage, clamped to 0-100
  const percent = total > 0 ? Math.min(100, Math.round(completed / total * 100)) : 0;
  // Scale percentage to bar width (number of filled blocks)
  const filled = Math.round(percent / 100 * PROGRESS_BAR_WIDTH);
  const bar = FILLED_BLOCK.repeat(filled) + EMPTY_BLOCK.repeat(PROGRESS_BAR_WIDTH - filled);
  return `[${bar}] ${percent}%`;
}

/**
 * Extract machine-readable fields from state.md markdown body and build
 * a YAML frontmatter object. Allows hooks and scripts to read state
 * reliably via `state json` instead of fragile regex parsing.
 *
 * Orchestrates extractFieldsFromState, scanPhaseProgress,
 * normalizePhaseStatus, and calculateProgressBar.
 */
function buildStateFrontmatter(bodyContent, cwd) {
  const fields = extractFieldsFromState(bodyContent);

  let milestone = null;
  let milestoneName = null;
  if (cwd) {
    try {
      const info = getMilestoneInfo(cwd);
      milestone = info.version;
      milestoneName = info.name;
    } catch {
      // No milestone configured or milestone file unreadable -- skip milestone fields
    }
  }

  let totalPhases = fields.totalPhasesRaw ? parseInt(fields.totalPhasesRaw, 10) : null;
  let completedPhases = null;
  let totalPlans = fields.totalPlansRaw ? parseInt(fields.totalPlansRaw, 10) : null;
  let completedPlans = null;

  // Scan disk for actual plan/summary counts if cwd is available
  if (cwd) {
    const diskProgress = scanPhaseProgress(cwd);
    if (diskProgress.totalPhases !== null) {
      if (totalPhases === null) totalPhases = diskProgress.totalPhases;
      completedPhases = diskProgress.completedPhases;
      totalPlans = diskProgress.totalPlans;
      completedPlans = diskProgress.completedPlans;
    }
  }

  // Parse percentage from progress bar text (e.g. "[######----] 60%")
  let progressPercent = null;
  if (fields.progressRaw) {
    const pctMatch = fields.progressRaw.match(/(\d+)%/);
    if (pctMatch) progressPercent = parseInt(pctMatch[1], 10);
  }

  const normalizedStatus = normalizePhaseStatus(fields.status, fields.pausedAt);

  const frontmatter = { pan_state_version: '1.0' };

  if (milestone) frontmatter.milestone = milestone;
  if (milestoneName) frontmatter.milestone_name = milestoneName;
  if (fields.currentPhase) frontmatter.current_phase = fields.currentPhase;
  if (fields.currentPhaseName) frontmatter.current_phase_name = fields.currentPhaseName;
  if (fields.currentPlan) frontmatter.current_plan = fields.currentPlan;
  frontmatter.status = normalizedStatus;
  if (fields.stoppedAt) frontmatter.stopped_at = fields.stoppedAt;
  if (fields.pausedAt) frontmatter.paused_at = fields.pausedAt;
  frontmatter.last_updated = new Date().toISOString();
  if (fields.lastActivity) frontmatter.last_activity = fields.lastActivity;

  const progress = {};
  if (totalPhases !== null) progress.total_phases = totalPhases;
  if (completedPhases !== null) progress.completed_phases = completedPhases;
  if (totalPlans !== null) progress.total_plans = totalPlans;
  if (completedPlans !== null) progress.completed_plans = completedPlans;
  if (progressPercent !== null) progress.percent = progressPercent;
  if (Object.keys(progress).length > 0) frontmatter.progress = progress;

  return frontmatter;
}

function stripFrontmatter(content) {
  return content.replace(/^---\n[\s\S]*?\n---\n*/, '');
}

function syncStateFrontmatter(content, cwd) {
  const body = stripFrontmatter(content);
  const frontmatter = buildStateFrontmatter(body, cwd);
  const yamlStr = reconstructFrontmatter(frontmatter);
  return `---\n${yamlStr}\n---\n\n${body}`;
}

/**
 * Write state.md with synchronized YAML frontmatter.
 * All state.md writes should use this instead of raw writeFileSync.
 *
 * Concurrency (ADR-0030): the write is serialized behind an advisory
 * state.md.lock and lands atomically (temp + rename), so concurrent agents
 * cannot tear the file or interleave read-modify-write cycles. Lock
 * acquisition is best-effort — on timeout the write proceeds unlocked,
 * preserving single-agent behavior exactly.
 */
function writeStateMd(statePath, content, cwd) {
  const synced = syncStateFrontmatter(content, cwd);
  try {
    withFileLock(statePath, () => {
      writeFileAtomic(statePath, synced);
    });
  } catch (err) {
    throw new Error('Failed to write state.md: ' + err.message);
  }
}

/**
 * Output state.md frontmatter as JSON, building it from body content if missing.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdStateJson(cwd, raw) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const content = safeReadFile(statePath);
  if (content === null) {
    output({ error: 'state.md not found' }, raw, 'state.md not found');
    return;
  }
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    const body = stripFrontmatter(content);
    const built = buildStateFrontmatter(body, cwd);
    output(built, raw, JSON.stringify(built, null, 2));
    return;
  }

  output(frontmatter, raw, JSON.stringify(frontmatter, null, 2));
}

/**
 * Aggregated project dashboard — single-command project overview.
 * Combines config, state, phase progress, blockers, and last activity.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdDashboard(cwd, raw) {
  const planDir = planningPath(cwd);

  // Load config for project name and version
  const config = loadConfig(cwd);
  let projectName = null;
  let version = null;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
    projectName = pkg.name || null;
    version = pkg.version || null;
  } catch { /* no package.json */ }

  // Load state.md
  const statePath = path.join(planDir, STATE_FILE);
  const stateContent = safeReadFile(statePath);

  let currentPhase = null;
  let currentPhaseName = null;
  let status = null;
  let lastActivity = null;
  let lastActivityDesc = null;
  let blockerCount = 0;
  const activeBlockers = [];

  if (stateContent) {
    currentPhase = stateExtractField(stateContent, 'Current Phase');
    currentPhaseName = stateExtractField(stateContent, 'Current Phase Name');
    status = stateExtractField(stateContent, 'Status');
    lastActivity = stateExtractField(stateContent, 'Last Activity');
    lastActivityDesc = stateExtractField(stateContent, 'Last Activity Description');

    // Parse blockers
    const blockersMatch = stateContent.match(/##\s*Blockers\s*\n([\s\S]*?)(?=\n##|$)/i);
    if (blockersMatch) {
      const items = blockersMatch[1].match(/^-\s+(.+)$/gm) || [];
      for (const item of items) {
        const text = item.replace(/^-\s+/, '').trim();
        if (text && !/^none$/i.test(text)) {
          activeBlockers.push(text);
        }
      }
    }
    blockerCount = activeBlockers.length;
  }

  // Scan phase progress from disk
  const progress = scanPhaseProgress(cwd);

  // Determine milestone info
  let milestone = null;
  try {
    milestone = getMilestoneInfo(cwd);
  } catch { /* no milestone */ }

  // Find next phase (phase after current)
  let nextPhase = null;
  if (currentPhase) {
    const phaseNum = parseInt(currentPhase, 10);
    if (!isNaN(phaseNum)) {
      const nextNum = String(phaseNum + 1).padStart(2, '0');
      try {
        const entries = fs.readdirSync(phasesPath(cwd));
        const nextDir = entries.find(e => e.startsWith(nextNum + '-'));
        if (nextDir) {
          nextPhase = { number: nextNum, name: nextDir.replace(/^\d+-/, '') };
        }
      } catch { /* no phases dir */ }
    }
  }

  const result = {
    project: projectName,
    version,
    milestone: milestone ? { version: milestone.version, name: milestone.name } : null,
    current_phase: currentPhase ? {
      number: currentPhase,
      name: currentPhaseName || null,
      status: status || null,
    } : null,
    progress: {
      phases_completed: progress.completedPhases,
      phases_total: progress.totalPhases,
      plans_total: progress.totalPlans,
      plans_completed: progress.completedPlans,
    },
    blockers: blockerCount,
    blocker_list: activeBlockers.length > 0 ? activeBlockers : undefined,
    last_activity: lastActivity || null,
    last_activity_description: lastActivityDesc || null,
    next_phase: nextPhase,
  };

  // Raw mode: human-readable summary
  if (raw) {
    const lines = [];
    if (projectName) lines.push(`Project: ${projectName}${version ? ' v' + version : ''}`);
    if (milestone) lines.push(`Milestone: ${milestone.version} ${milestone.name || ''}`);
    if (currentPhase) lines.push(`Current Phase: ${currentPhase}${currentPhaseName ? ' — ' + currentPhaseName : ''} (${status || 'unknown'})`);
    if (progress.totalPhases !== null) lines.push(`Progress: ${progress.completedPhases}/${progress.totalPhases} phases, ${progress.completedPlans}/${progress.totalPlans} plans`);
    lines.push(`Blockers: ${blockerCount}`);
    if (lastActivity) lines.push(`Last Activity: ${lastActivity}${lastActivityDesc ? ' — ' + lastActivityDesc : ''}`);
    if (nextPhase) lines.push(`Next Phase: ${nextPhase.number} — ${nextPhase.name}`);
    output(result, false, lines.join('\n'));
    return;
  }

  output(result, raw);
}

module.exports = {
  readStateSafe: safeReadFile,
  stateExtractField,
  stateReplaceField,
  writeStateMd,
  cmdStateLoad,
  cmdStateGet,
  cmdStatePatch,
  cmdStateUpdate,
  cmdStateAdvancePlan,
  cmdStateRecordMetric,
  cmdStateUpdateProgress,
  cmdStateAddDecision,
  cmdStateAddBlocker,
  cmdStateResolveBlocker,
  cmdStateRecordSession,
  cmdStateSnapshot,
  cmdStateJson,
  cmdDashboard,
};
