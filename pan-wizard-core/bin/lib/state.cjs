/**
 * State -- state.md operations and progression engine
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, getMilestoneInfo, escapeRegex, escapeTableCell, safeReadFile, output, error } = require('./core.cjs');
const { extractFrontmatter, reconstructFrontmatter, patchFrontmatter } = require('./frontmatter.cjs');
const {
  STATE_FILE,
  ROADMAP_FILE,
  CONFIG_FILE,
  PHASES_DIR,
  PHASE_DIR_RE,
  ARCHIVE_DIR_RE,
  FIELD_VALUE_RE,
  PROGRESS_BAR_WIDTH,
  FILLED_BLOCK,
  EMPTY_BLOCK,
  STATE_CONTRACT,
} = require('./constants.cjs');
const {
  planningPath,
  phasesPath,
  milestonesPath,
  fileAccessible,
  localDay,
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
    contract: STATE_CONTRACT,
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
      // error key ⇒ exit 1: the caller asked for a field update that did not
      // happen, so state.md does not say what the caller now believes it says.
      output({ updated: false, reason: `Field "${field}" not found in state.md`, error: 'field_not_found' });
    }
  } catch {
    // state.md does not exist or is unreadable -- report gracefully
    // Same condition `state json` reports as {error:'state.md not found'} at exit 1.
    // Reporting it as a bare `updated: false` was the identical defect wearing a
    // different key — one file, one missing file, two exit codes.
    output({ updated: false, reason: 'state.md not found', error: 'state_not_found' });
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
  const today = localDay();

  if (isNaN(currentPlan) || isNaN(totalPlans)) {
    output({ error: 'Cannot parse Current Plan or Total Plans in Phase from state.md' }, raw);
    return;
  }

  if (currentPlan >= totalPlans) {
    content = stateReplaceField(content, 'Status', 'Phase complete — ready for verification') || content;
    content = stateReplaceField(content, 'Last Activity', today) || content;
    writeStateMd(statePath, content, cwd);
    // No error key, exit 0: `last_plan` is the NORMAL end-of-phase signal — the
    // phase advanced to "ready for verification" and state.md was written. Gating on
    // it would make every completed phase look like a failure.
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

  // The Performance Metrics section's first table: its rows only, then an optional
  // "None yet" line. Taking the rest of the section as the table body put every row
  // below the template's "Recent Trend" and footer lines, outside the table. The
  // separator is matched on one line: `[-|\s]+` ran on into a `| - | - |` row.
  const metricsPattern = /(##\s*Performance Metrics[\s\S]*?\n\|[^\n]+\n\|[-|: \t]+\r?\n)((?:\|[^\n]*(?:\n|$))*)((?:[^\S\n]*None yet\.?[^\S\n]*(?:\n|$))?)/i;
  const metricsMatch = content.match(metricsPattern);

  if (metricsMatch) {
    const cell = escapeTableCell;
    const newRow = `| Phase ${cell(phase)} P${cell(plan)} | ${cell(duration)} | ${cell(tasks || '-')} tasks | ${cell(files || '-')} files |`;
    // A template placeholder row (`| - | - | - | - |`, `| None yet | | | |`) gives way.
    const isPlaceholder = (row) => /None yet/i.test(row) || row.split('|').slice(1, -1).every((c) => /^\s*-?\s*$/.test(c));
    const rows = metricsMatch[2].split('\n').map((r) => r.replace(/\r$/, '')).filter((r) => r.trim() && !isPlaceholder(r));
    rows.push(newRow);

    content = content.replace(metricsPattern, (_match, header) => `${header}${rows.join('\n')}\n`);
    writeStateMd(statePath, content, cwd, { owns: FM_KEYS.touch });
    output({ recorded: true, phase, plan, duration }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'Performance Metrics section not found in state.md', error: 'metrics_section_missing' }, raw, 'false');
  }
}

/**
 * Recalculate and update the progress bar in state.md from the plans on disk
 * (countPlanProgress: a plan counts as done when its own summary exists).
 * The frontmatter's `progress.*` keys that exist are updated too; absent ones are
 * added only with `--write-counts` (opts.writeCounts).
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @param {{writeCounts?: boolean}} [opts]
 * @returns {void}
 */
function cmdStateUpdateProgress(cwd, raw, opts = {}) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  let content = safeReadFile(statePath);
  if (content === null) { output({ error: 'state.md not found' }, raw); return; }

  // One count (DD-2). This used to tally every directory under phases/ and every
  // file ending in -summary.md, so an orphan research summary made completed
  // exceed total, and the percent was clamped to hide it.
  const counts = countPlanProgress(cwd);
  const progressStr = calculateProgressBar(counts.completed_plans, counts.total_plans);

  const progressPattern = /(\*\*Progress:\*\*\s*).*/i;
  if (progressPattern.test(content)) {
    content = content.replace(progressPattern, (_match, prefix) => `${prefix}${progressStr}`);
    writeStateMd(statePath, content, cwd, { owns: FM_KEYS.position, counts: true, writeCounts: !!opts.writeCounts });
    output({
      updated: true,
      percent: counts.percent,
      completed: counts.completed_plans,
      total: counts.total_plans,
      completed_phases: counts.completed_phases,
      total_phases: counts.total_phases,
      bar: progressStr,
      counts_written: !!opts.writeCounts,
    }, raw, progressStr);
  } else {
    output({ updated: false, reason: 'Progress field not found in state.md', error: 'progress_field_missing' }, raw, 'false');
  }
}

/**
 * A section body without its placeholder lines: a line that, trimmed, matches re.
 * @param {string} body - The section body
 * @param {RegExp} re - Anchored test for a placeholder line
 * @returns {string}
 */
function dropPlaceholderLines(body, re) {
  return body.split('\n').filter((line) => !re.test(line.trim())).join('\n');
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
    output({ added: false, reason: err.message, error: err.message || 'decision_read_failed' }, raw, 'false');
    return;
  }

  if (!summaryText) { output({ error: 'summary required' }, raw); return; }
  const entry = `- [Phase ${phase || '?'}]: ${summaryText}${rationaleText ? ` — ${rationaleText}` : ''}`;

  // Find Decisions section (various heading patterns)
  const sectionPattern = /(###?\s*(?:Decisions|Decisions Made|Accumulated.*Decisions)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    // Drop the template's placeholder line, and only a whole one: the unanchored
    // replace also cut "none yet" out of the middle of a recorded decision.
    sectionBody = dropPlaceholderLines(sectionBody, /^(?:-\s+)?(?:None yet|No decisions yet)\.?$/i);
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, (_match, header) => `${header}${sectionBody}`);
    writeStateMd(statePath, content, cwd, { owns: FM_KEYS.touch });
    output({ added: true, decision: entry }, raw, 'true');
  } else {
    output({ added: false, reason: 'Decisions section not found in state.md', error: 'decisions_section_missing' }, raw, 'false');
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
    output({ added: false, reason: err.message, error: err.message || 'blocker_read_failed' }, raw, 'false');
    return;
  }

  if (!blockerText) { output({ error: 'text required' }, raw); return; }
  const entry = `- ${blockerText}`;

  const sectionPattern = /(###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n)([\s\S]*?)(?=\n###?|\n##[^#]|$)/i;
  const match = content.match(sectionPattern);

  if (match) {
    let sectionBody = match[2];
    // Drop a placeholder line ("None", "None yet.") and only a whole one: the
    // unanchored replace cut "none" out of earlier blockers, so "nonetheless"
    // became "theless" (PAN-01).
    sectionBody = dropPlaceholderLines(sectionBody, /^(?:-\s+)?None(?: yet)?\.?$/i);
    sectionBody = sectionBody.trimEnd() + '\n' + entry + '\n';
    content = content.replace(sectionPattern, (_match, header) => `${header}${sectionBody}`);
    writeStateMd(statePath, content, cwd, { owns: FM_KEYS.touch });
    output({ added: true, blocker: blockerText }, raw, 'true');
  } else {
    output({ added: false, reason: 'Blockers section not found in state.md', error: 'blockers_section_missing' }, raw, 'false');
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

    // M27: if nothing was removed, no blocker matched the given text. Report
    // resolved:false rather than falsely claiming a resolution (and skip the
    // write entirely — the file is unchanged).
    if (filtered.length === lines.length) {
      // error key ⇒ exit 1. M27 stopped this from falsely claiming a resolution;
      // the exit code finishes the job. The blocker is STILL OPEN and the caller
      // that asked to clear it would otherwise carry on believing it is gone.
      output({ resolved: false, reason: 'no matching blocker', blocker: text, error: 'blocker_not_matched' }, raw, 'false');
      return;
    }

    let newBody = filtered.join('\n');
    // If section is now empty, add placeholder
    if (!newBody.trim() || !newBody.includes('- ')) {
      newBody = 'None\n';
    }

    content = content.replace(sectionPattern, (_match, header) => `${header}${newBody}`);
    writeStateMd(statePath, content, cwd, { owns: FM_KEYS.touch });
    output({ resolved: true, blocker: text }, raw, 'true');
  } else {
    output({ resolved: false, reason: 'Blockers section not found in state.md', error: 'blockers_section_missing' }, raw, 'false');
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
    writeStateMd(statePath, content, cwd, { owns: FM_KEYS.touch });
    // Normal-flow checkpoint: reconcile the always-loaded project memory once
    // the session is recorded (no-op when already lean; never throws).
    try { require('./memory-optimize.cjs').maybeAutoOptimizeMemory(cwd); } catch { /* best-effort */ }
    output({ recorded: true, updated }, raw, 'true');
  } else {
    output({ recorded: false, reason: 'No session fields found in state.md', error: 'session_fields_missing' }, raw, 'false');
  }
}

// --- Snapshot Parsers --------------------------------------------------------

/**
 * Parse the decisions from state.md content: the `- [Phase N]: summary — rationale`
 * bullets `state add-decision` appends under `### Decisions` (the template's
 * heading), or else an older "## Decisions Made" table. Reading only the table
 * left `decisions` empty on every state.md PAN itself writes.
 * @param {string} content - Full state.md content
 * @returns {Array<{phase: string, summary: string, rationale: string}>}
 */
function parseDecisionsFromState(content) {
  const decisions = [];
  const section = content.match(/###?\s*(?:Decisions|Decisions Made|Accumulated.*Decisions)\s*\n([\s\S]*?)(?=\n###?|\n##[^#]|$)/i);
  for (const line of section ? section[1].split('\n') : []) {
    const m = line.match(/^-\s+\[Phase\s+([^\]]*)\]:\s*(.+?)\s*$/i);
    if (!m) continue;
    const [summary, ...rest] = m[2].split(' — ');
    decisions.push({ phase: m[1].trim(), summary: summary.trim(), rationale: rest.join(' — ').trim() });
  }
  if (decisions.length > 0) return decisions;
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
 * Extracts bullet-point items (lines starting with "- ") from under the heading
 * `state add-blocker` writes to: `### Blockers/Concerns` in the template, or
 * `Blockers` / `Concerns`. Matching only "## Blockers" left the list empty.
 * @param {string} content - Full state.md content
 * @returns {string[]} Array of blocker text strings
 */
function parseBlockersFromState(content) {
  const blockers = [];
  const blockersMatch = content.match(/###?\s*(?:Blockers|Blockers\/Concerns|Concerns)\s*\n([\s\S]*?)(?=\n###?|\n##[^#]|$)/i);
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
 * The blockers that are still open: the section's bullets minus a "None" placeholder.
 * `preflight` and `dashboard` read a `## Blockers` heading of their own, which the
 * state template never writes (it writes `### Blockers/Concerns`, where
 * `state add-blocker` puts its bullets), so both reported no blockers with one open.
 * @param {string} content - Full state.md content
 * @returns {string[]}
 */
function activeBlockersFromState(content) {
  return parseBlockersFromState(content).filter((b) => b && !/^none(\s+yet)?\.?$/i.test(b));
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

/** A plan's id from its file name, case-insensitive ("29.4-01-PLAN.md" → "29.4-01", "plan.md" → ""), or null. */
function planIdOf(name) {
  const lower = String(name).toLowerCase();
  if (lower === 'plan.md') return '';
  return lower.endsWith('-plan.md') ? lower.slice(0, -'-plan.md'.length) : null;
}

/** A summary's id from its file name, case-insensitive, or null. */
function summaryIdOf(name) {
  const lower = String(name).toLowerCase();
  if (lower === 'summary.md') return '';
  return lower.endsWith('-summary.md') ? lower.slice(0, -'-summary.md'.length) : null;
}

/**
 * One phase directory's plans, paired with their summaries by plan id.
 * @param {string} dirPath - Absolute path of the phase directory
 * @returns {{plans: number, completed: number}}
 */
function countPhaseDirPlans(dirPath) {
  let files = [];
  try { files = fs.readdirSync(dirPath); } catch { return { plans: 0, completed: 0 }; }
  const planIds = new Set();
  const summaryIds = new Set();
  for (const f of files) {
    const p = planIdOf(f);
    if (p !== null) { planIds.add(p); continue; }
    const s = summaryIdOf(f);
    if (s !== null) summaryIds.add(s);
  }
  let completed = 0;
  for (const id of planIds) if (summaryIds.has(id)) completed++;
  return { plans: planIds.size, completed };
}

/**
 * The plan count every writer uses (DD-2): each plan paired with its own summary
 * by plan id, so a summary without a plan (`29.4-research-summary.md`) counts
 * for nothing and completed can never exceed total. Suffixes match in any case
 * (`-PLAN.md`), only directories named like a phase count, and a phase is
 * complete only when every plan in it has a summary.
 *
 * Scope 'current' (default) counts `phases/`; 'all' adds the milestone archives
 * (`milestones/v*-phases/`).
 *
 * @param {string} cwd - Project root
 * @param {{scope?: 'current'|'all'}} [opts]
 * @returns {{scope: string, found: boolean, phases: Array<{dir: string, number: string, archived: string|null, plans: number, completed: number, complete: boolean}>,
 *   total_phases: number, completed_phases: number, total_plans: number, completed_plans: number, percent: number}}
 */
function countPlanProgress(cwd, opts = {}) {
  const scope = opts.scope === 'all' ? 'all' : 'current';
  const roots = [{ dir: phasesPath(cwd), archived: null }];
  if (scope === 'all') {
    try {
      for (const e of fs.readdirSync(milestonesPath(cwd), { withFileTypes: true })) {
        if (e.isDirectory() && ARCHIVE_DIR_RE.test(e.name)) roots.push({ dir: path.join(milestonesPath(cwd), e.name), archived: e.name.replace(/-phases$/, '') });
      }
    } catch { /* no milestones directory */ }
  }
  let found = false;
  const phases = [];
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root.dir, { withFileTypes: true }); } catch { continue; }
    if (root.archived === null) found = true;
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const m = e.name.match(PHASE_DIR_RE);
      if (!m) continue;
      const { plans, completed } = countPhaseDirPlans(path.join(root.dir, e.name));
      phases.push({ dir: e.name, number: m[1], archived: root.archived, plans, completed, complete: plans > 0 && completed === plans });
    }
  }
  const total_plans = phases.reduce((n, p) => n + p.plans, 0);
  const completed_plans = phases.reduce((n, p) => n + p.completed, 0);
  return {
    scope,
    found,
    phases,
    total_phases: phases.length,
    completed_phases: phases.filter((p) => p.complete).length,
    total_plans,
    completed_plans,
    percent: total_plans > 0 ? Math.round(completed_plans / total_plans * 100) : 0,
  };
}

/**
 * Plan and phase totals for `phases/`, in the shape the dashboard reads (nulls
 * when there is no phases directory). A view of countPlanProgress.
 * @param {string} cwd - Working directory path
 * @returns {{totalPhases: number|null, completedPhases: number|null, totalPlans: number|null, completedPlans: number|null}}
 */
function scanPhaseProgress(cwd) {
  const c = countPlanProgress(cwd);
  if (!c.found) return { totalPhases: null, completedPhases: null, totalPlans: null, completedPlans: null };
  return { totalPhases: c.total_phases, completedPhases: c.completed_phases, totalPlans: c.total_plans, completedPlans: c.completed_plans };
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
function buildStateFrontmatter(bodyContent, cwd, existing = {}) {
  const fields = extractFieldsFromState(bodyContent);
  const prior = existing && typeof existing === 'object' ? existing : {};

  // The milestone comes from the roadmap resolver — unless the resolver only
  // guessed (no milestone heading at all) and state.md already records one. A
  // guess overwriting a recorded value is how a letter-series milestone ("R-2")
  // was rewritten to the resolver's `v1.0` / `milestone` on every state write.
  let milestone = null;
  let milestoneName = null;
  if (cwd) {
    try {
      const info = getMilestoneInfo(cwd);
      // Only a roadmap that marks a milestone current outranks the recorded one
      // (DD-3): "first unshipped" and "last shipped" are guesses too, and one of
      // them rewrote a recorded v3.0 to the v2.0 a phase heading mentioned.
      if (!(prior.milestone && info.basis !== 'marked-current')) {
        milestone = info.version;
        milestoneName = info.name;
      }
    } catch {
      // No milestone configured or milestone file unreadable -- skip milestone fields
    }
  }
  if (milestone == null && prior.milestone) {
    milestone = prior.milestone;
    milestoneName = prior.milestone_name != null ? prior.milestone_name : null;
  }

  let totalPhases = fields.totalPhasesRaw ? parseInt(fields.totalPhasesRaw, 10) : null;
  let completedPhases = null;
  let totalPlans = fields.totalPlansRaw ? parseInt(fields.totalPlansRaw, 10) : null;
  let completedPlans = null;

  // The disk count (countPlanProgress) when there are phase directories; the
  // body's `Total Phases` only stands in before any exists.
  if (cwd) {
    const counts = countPlanProgress(cwd);
    if (counts.found) {
      if (totalPhases === null || counts.total_phases > 0) totalPhases = counts.total_phases;
      completedPhases = counts.completed_phases;
      totalPlans = counts.total_plans;
      completedPlans = counts.completed_plans;
    }
  }

  // Parse percentage from progress bar text (e.g. "[######----] 60%")
  let progressPercent = null;
  if (fields.progressRaw) {
    const pctMatch = fields.progressRaw.match(/(\d+)%/);
    if (pctMatch) progressPercent = parseInt(pctMatch[1], 10);
  }

  const frontmatter = { pan_state_version: '1.0' };

  if (milestone) frontmatter.milestone = milestone;
  if (milestoneName) frontmatter.milestone_name = milestoneName;
  // A field the body restates wins; one it does not keeps its recorded value.
  // Rebuilding from the body alone dropped current_phase_name, current_plan and
  // the rest whenever a project's state.md did not repeat them in prose.
  const keep = (key, fromBody) => {
    if (fromBody != null && fromBody !== '') frontmatter[key] = fromBody;
    else if (prior[key] != null) frontmatter[key] = prior[key];
  };
  keep('current_phase', fields.currentPhase);
  keep('current_phase_name', fields.currentPhaseName);
  keep('current_plan', fields.currentPlan);
  frontmatter.status = (fields.status || fields.pausedAt)
    ? normalizePhaseStatus(fields.status, fields.pausedAt)
    : (prior.status != null ? prior.status : normalizePhaseStatus(null, null));
  keep('stopped_at', fields.stoppedAt);
  keep('paused_at', fields.pausedAt);
  frontmatter.last_updated = new Date().toISOString();
  // A stale body date never takes the recorded last_activity backwards.
  keep('last_activity', activityMovesBack(prior.last_activity, fields.lastActivity) ? null : fields.lastActivity);

  const progress = {};
  if (totalPhases !== null) progress.total_phases = totalPhases;
  if (completedPhases !== null) progress.completed_phases = completedPhases;
  if (totalPlans !== null) progress.total_plans = totalPlans;
  if (completedPlans !== null) progress.completed_plans = completedPlans;
  if (progressPercent !== null) progress.percent = progressPercent;
  if (Object.keys(progress).length > 0) frontmatter.progress = progress;
  else if (prior.progress != null) frontmatter.progress = prior.progress;

  // Keys PAN does not manage (a project's own notes) survive every write, in the
  // order the file already had them; PAN's keys fill in around them.
  const merged = {};
  for (const key of Object.keys(prior)) merged[key] = key in frontmatter ? frontmatter[key] : prior[key];
  for (const key of Object.keys(frontmatter)) if (!(key in merged)) merged[key] = frontmatter[key];
  return merged;
}

// One front-matter block at the top of state.md: BOM-tolerant, LF or CRLF. The
// previous `^---\n…\n---\n` matched LF only, so on a CRLF checkout (git
// core.autocrlf=true) the old block was never stripped and every state write
// stacked a new, re-derived block on top of it.
const STATE_FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

function stripFrontmatter(content) {
  return String(content).replace(STATE_FRONTMATTER_RE, '').replace(/^\uFEFF/, '').replace(/^(?:\r?\n)+/, '');
}

/**
 * The front-matter keys each writer owns (DD-1). A writer patches its own keys
 * and no others; everything else in the block stays byte for byte.
 *   position   update, patch, advance-plan, apply, init, and the writers that
 *              rewrite the body (phase remove, compaction, health)
 *   touch      add-decision, add-blocker, resolve-blocker, record-metric,
 *              record-session, section, quick-task
 *   milestone  milestone complete (with the position keys)
 * update-progress and phase complete own the position keys plus the
 * `progress.*` keys that already exist ({counts: true}).
 */
const FM_KEYS = Object.freeze({
  position: Object.freeze(['current_phase', 'current_phase_name', 'current_plan', 'status', 'last_activity', 'last_updated']),
  touch: Object.freeze(['last_updated']),
  milestone: Object.freeze(['milestone', 'milestone_name']),
});
const PROGRESS_KEYS = ['total_phases', 'completed_phases', 'total_plans', 'completed_plans', 'percent'];

/** The YYYY-MM-DD a Last Activity value starts with, or null. */
const activityDay = (v) => {
  const m = String(v == null ? '' : v).match(/^\s*(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

/** True when writing `next` over the recorded `prior` would take last_activity backwards (or replace a date with none). */
function activityMovesBack(prior, next) {
  const was = activityDay(prior);
  if (!was) return false;
  const now = activityDay(next);
  return !now || now < was;
}

/**
 * The front-matter patch one write makes: the owned keys, derived from the body
 * (and the plan count with opts.counts), that differ from what the file records.
 * @param {string} body - state.md body, LF
 * @param {string|null} cwd - Project root (milestone and counts need it)
 * @param {Object} prior - The front matter as parsed now
 * @param {{owns?: string[], counts?: boolean, writeCounts?: boolean, set?: Object}} [opts]
 * @returns {{set: Object}}
 */
function stateFrontmatterPatch(body, cwd, prior, opts = {}) {
  const owns = new Set(opts.owns || FM_KEYS.position);
  const fields = extractFieldsFromState(body);
  const set = {};
  const fromBody = { current_phase: fields.currentPhase, current_phase_name: fields.currentPhaseName, current_plan: fields.currentPlan };
  for (const [key, value] of Object.entries(fromBody)) if (owns.has(key) && value) set[key] = value;
  if (owns.has('status') && (fields.status || fields.pausedAt)) set.status = normalizePhaseStatus(fields.status, fields.pausedAt);
  if (owns.has('last_activity') && fields.lastActivity && !activityMovesBack(prior.last_activity, fields.lastActivity)) {
    set.last_activity = fields.lastActivity;
  }
  if (owns.has('last_updated')) set.last_updated = new Date().toISOString();
  if (owns.has('milestone') && cwd && !(opts.set && opts.set.milestone)) {
    try {
      const info = getMilestoneInfo(cwd);
      if (!prior.milestone || info.basis === 'marked-current') {
        set.milestone = info.version;
        set.milestone_name = info.name;
      }
    } catch { /* no roadmap: the recorded milestone stands */ }
  }
  if (opts.counts && cwd) {
    const counts = countPlanProgress(cwd);
    const recorded = prior.progress && typeof prior.progress === 'object' && !Array.isArray(prior.progress) ? prior.progress : {};
    if (counts.found) {
      for (const key of PROGRESS_KEYS) {
        if (opts.writeCounts || key in recorded) set[`progress.${key}`] = counts[key];
      }
    }
  }
  Object.assign(set, opts.set || {});
  return { set };
}

function stackedFrontmatterError() {
  const err = new Error('state.md starts with more than one front-matter block (an earlier PAN release stacked them on CRLF files). Keep the block with the right values, delete the other, and run the command again — PAN will not pick one for you.');
  err.code = 'STATE_STACKED_FRONTMATTER';
  return err;
}

/**
 * The file a write produces. `content` is what the caller wants written: with
 * its front matter (read from the file, under the lock), or the body alone, in
 * which case the front matter on disk (`disk`) is kept. The block is patched in
 * place (patchFrontmatter); only a file with no front matter at all gets a new
 * one built. Throws STATE_STACKED_FRONTMATTER on a stacked block.
 */
function composeStateFile(content, disk, cwd, opts) {
  const text = String(content);
  if (STATE_FRONTMATTER_RE.test(stripFrontmatter(text))) throw stackedFrontmatterError();
  let base = null;
  if (STATE_FRONTMATTER_RE.test(text)) {
    base = text;
  } else {
    const dm = disk != null ? String(disk).match(STATE_FRONTMATTER_RE) : null;
    if (dm) {
      const gap = (String(disk).slice(dm[0].length).match(/^(?:\r?\n)*/) || [''])[0];
      base = dm[0] + gap + text.replace(/^﻿/, '').replace(/^(?:\r?\n)+/, '');
    }
  }
  if (base === null) {
    const body = stripFrontmatter(text).replace(/\r\n/g, '\n');
    return `---\n${reconstructFrontmatter(buildStateFrontmatter(body, cwd, {}))}\n---\n\n${body}`;
  }
  const prior = extractFrontmatter(base);
  const body = stripFrontmatter(base).replace(/\r\n/g, '\n');
  return patchFrontmatter(base, stateFrontmatterPatch(body, cwd, prior, opts));
}

/** text in one line ending. */
const toEol = (text, eol) => (eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n'));

/**
 * state.md as a write would leave it: the owned front-matter keys patched from
 * the body (see writeStateMd), in `eol` (default: whatever the content uses).
 * Throws (code STATE_STACKED_FRONTMATTER) when the content starts with more than
 * one front-matter block — earlier releases stacked them on CRLF files, and
 * choosing between them silently is exactly the guess this function must not make.
 */
function syncStateFrontmatter(content, cwd, eol, opts = {}) {
  const text = String(content);
  return toEol(composeStateFile(text, null, cwd, opts), eol || (/\r\n/.test(text) ? '\r\n' : '\n'));
}

/**
 * Write state.md, patching only the front-matter keys this writer owns.
 * All state.md writes should use this instead of raw writeFileSync.
 *
 * The front matter is never re-serialised (DD-1): comments, quoting, order and
 * keys PAN does not know survive byte for byte, and `progress.*` counts are only
 * updated where they exist (opts.counts), or added with opts.writeCounts.
 * last_activity never moves backwards, and generic writes never touch
 * `milestone` (opts.owns names FM_KEYS.milestone for the milestone writers).
 *
 * Concurrency: the write goes through store.updateText, so the file is read
 * inside state.md's lock (the front matter kept is the one on disk at write
 * time) and lands atomically; under concurrency.strict a lock that cannot be
 * taken stops the write. The file keeps its own line ending, and exactly one
 * front-matter block goes in.
 *
 * @param {string} statePath
 * @param {string} content - The new file, or the new body alone
 * @param {string} cwd
 * @param {{owns?: string[], counts?: boolean, writeCounts?: boolean, set?: Object}} [opts]
 */
function writeStateMd(statePath, content, cwd, opts = {}) {
  let r;
  try {
    r = require('./store.cjs').updateText(statePath, (disk) => {
      const out = composeStateFile(content, disk, cwd, opts);
      const eol = disk != null ? (/\r\n/.test(disk) ? '\r\n' : '\n') : null;
      return eol ? toEol(out, eol) : out;
    }, { cwd });
  } catch (err) {
    if (err && err.code === 'STATE_STACKED_FRONTMATTER') error(err.message);
    throw new Error('Failed to write state.md: ' + err.message);
  }
  if (r && r.error) error(`state.md not written: ${r.reason || r.error}`);
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
    const body = stripFrontmatter(content).replace(/\r\n/g, '\n');
    const built = { ...buildStateFrontmatter(body, cwd), contract: STATE_CONTRACT };
    output(built, raw, JSON.stringify(built, null, 2));
    return;
  }

  // `contract` is the output's shape version (STATE_CONTRACT), never a state.md
  // field: PAN's state frontmatter has no such key, so nothing is shadowed.
  const withContract = { ...frontmatter, contract: STATE_CONTRACT };
  output(withContract, raw, JSON.stringify(withContract, null, 2));
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

    // Parse blockers (the template's `### Blockers/Concerns`, or a legacy `## Blockers`)
    activeBlockers.push(...activeBlockersFromState(stateContent));
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
    // raw=true so output() emits the human summary; passing false discarded it
    // and printed JSON, making the whole lines[] block dead (M28, ADR audit 2026-08).
    output(result, true, lines.join('\n'));
    return;
  }

  output(result, raw);
}

module.exports = {
  readStateSafe: safeReadFile,
  activeBlockersFromState,
  stateExtractField,
  stateReplaceField,
  writeStateMd,
  syncStateFrontmatter,
  countPlanProgress,
  countPhaseDirPlans,
  calculateProgressBar,
  FM_KEYS,
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
