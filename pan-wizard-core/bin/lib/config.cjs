/**
 * Config — Planning config CRUD operations
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { output, error, safeReadFile, toPosix, findPhaseInternal } = require('./core.cjs');
const {
  PLANNING_DIR, CONFIG_FILE, PROJECT_FILE, STANDARDS_FILE,
  STANDARDS_CATALOG, STANDARDS_CATEGORIES, STANDARDS_RECOMMENDATIONS,
  PHASE_KEYWORDS_TO_STANDARDS, STANDARDS_EXTERNAL_TOOLS,
} = require('./constants.cjs');
const { readJsonFile, planningPath, fileAccessible, hasBraveSearchKey } = require('./utils.cjs');

/**
 * Count checked checklist items in a standards section.
 * @param {string} content - Full standards.md content
 * @param {string} sectionName - Section header name (e.g., "Code Review")
 * @returns {number} Number of checked items (- [x])
 */
function countCheckedInSection(content, sectionName) {
  const sectionStart = content.indexOf('## ' + sectionName);
  if (sectionStart === -1) return 0;
  const nextSection = content.indexOf('\n## ', sectionStart + 1);
  const section = nextSection > -1 ? content.slice(sectionStart, nextSection) : content.slice(sectionStart);
  return (section.match(/- \[x\]/gi) || []).length;
}

/**
 * Ensure .planning/config.json exists, creating it with defaults if missing.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
/**
 * Build default config by merging hardcoded defaults with user-level overrides.
 * @param {boolean} hasBraveSearch - Whether Brave Search API key is available
 * @param {Object} userDefaults - User-level defaults from ~/.pan-wizard/defaults.json
 * @returns {Object} Merged config defaults
 */
function buildConfigDefaults(hasBraveSearch, userDefaults) {
  const hardcoded = {
    model_profile: 'balanced',
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'pan/phase-{phase}-{slug}',
    milestone_branch_template: 'pan/{milestone}-{slug}',
    workflow: {
      research: true,
      plan_check: true,
      verifier: true,
      nyquist_validation: false,
      phase_record_compact: false,
    },
    parallelization: true,
    brave_search: hasBraveSearch,
    budget: {
      default_points: 50,
      micro_threshold_tasks: 3,
      micro_threshold_files: 2,
    },
    commit: {
      safety_checks: true,
      conventional_types: true,
      sensitive_patterns: ['\\.env$', '\\.pem$', '\\.key$', 'credentials', 'secret', 'password', 'token'],
    },
    execution: {
      default_mode: 'wave_order',
      rollback_snapshots: true,
      error_pattern_learning: true,
    },
    routing: {
      strategy: 'static',
      provider: 'auto',
      cascade_quality_gate: true,
      complexity_thresholds: {
        downgrade_max: 2,
        upgrade_min: 6,
      },
    },
  };
  return {
    ...hardcoded,
    ...userDefaults,
    workflow: { ...hardcoded.workflow, ...(userDefaults.workflow || {}) },
    budget: { ...hardcoded.budget, ...(userDefaults.budget || {}) },
    commit: { ...hardcoded.commit, ...(userDefaults.commit || {}) },
    execution: { ...hardcoded.execution, ...(userDefaults.execution || {}) },
    routing: { ...hardcoded.routing, ...(userDefaults.routing || {}) },
  };
}

function cmdConfigEnsureSection(cwd, raw) {
  const configPath = path.join(planningPath(cwd), CONFIG_FILE);

  try { fs.mkdirSync(planningPath(cwd), { recursive: true }); }
  catch (err) { error('Failed to create .planning directory: ' + err.message); }

  if (fileAccessible(configPath)) {
    output({ created: false, reason: 'already_exists' }, raw, 'exists');
    return;
  }

  const hasBraveSearch = hasBraveSearchKey();

  const userDefaults = readJsonFile(path.join(os.homedir(), '.pan-wizard', 'defaults.json')) || {};
  const defaults = buildConfigDefaults(hasBraveSearch, userDefaults);

  try {
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
    output({ created: true, path: PLANNING_DIR + '/' + CONFIG_FILE }, raw, 'created');
  } catch (err) {
    error('Failed to create config.json: ' + err.message);
  }
}

/**
 * Set a configuration value in config.json using dot-notation key path.
 * @param {string} cwd - Working directory path
 * @param {string} keyPath - Dot-notation key path (e.g., "workflow.research")
 * @param {string} value - Value to set (auto-parsed for booleans and numbers)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdConfigSet(cwd, keyPath, value, raw) {
  const configPath = path.join(planningPath(cwd), CONFIG_FILE);

  if (!keyPath) {
    error('Usage: config-set <key.path> <value>');
  }

  // Parse value (handle booleans and numbers)
  let parsedValue = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(value) && value !== '') parsedValue = Number(value);

  // Load existing config or start with empty object
  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    // ENOENT means config doesn't exist yet — start fresh with empty object
    if (err.code !== 'ENOENT') {
      error('Failed to read config.json: ' + err.message);
    }
  }

  // Traverse the dot-notation key path to build nested objects.
  // For a path like "workflow.research", this loop walks through each
  // segment except the last, creating intermediate objects as needed.
  // After the loop, `current` points to the parent object and the
  // final segment is used as the property key for assignment.
  const keys = keyPath.split('.');
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  current[keys[keys.length - 1]] = parsedValue;

  // Write back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    const result = { updated: true, key: keyPath, value: parsedValue };
    output(result, raw, `${keyPath}=${parsedValue}`);
  } catch (err) {
    // Config file could not be written — disk full, permissions, etc.
    error('Failed to write config.json: ' + err.message);
  }
}

/**
 * Get a configuration value from config.json using dot-notation key path.
 * @param {string} cwd - Working directory path
 * @param {string} keyPath - Dot-notation key path (e.g., "workflow.auto_advance")
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdConfigGet(cwd, keyPath, raw) {
  const configPath = path.join(planningPath(cwd), CONFIG_FILE);

  if (!keyPath) {
    error('Usage: config-get <key.path>');
  }

  let config = {};
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (err) {
    if (err.code === 'ENOENT') {
      error('No config.json found at ' + configPath);
    }
    error('Failed to read config.json: ' + err.message);
  }

  // Traverse dot-notation path (e.g., "workflow.auto_advance")
  const keys = keyPath.split('.');
  let current = config;
  for (const key of keys) {
    if (current === undefined || current === null || typeof current !== 'object') {
      error(`Key not found: ${keyPath}`);
    }
    current = current[key];
  }

  if (current === undefined) {
    error(`Key not found: ${keyPath}`);
  }

  output(current, raw, String(current));
}

// ─── Standards commands ─────────────────────────────────────────────────────

/**
 * List available standards from the built-in catalog.
 * @param {string} _cwd - Working directory (unused — catalog is in-memory)
 * @param {string} category - Optional category filter
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsList(_cwd, category, raw) {
  let entries = Object.entries(STANDARDS_CATALOG);
  if (category) {
    if (!STANDARDS_CATEGORIES.includes(category)) {
      error('Unknown category: ' + category + '. Valid: ' + STANDARDS_CATEGORIES.join(', '));
    }
    entries = entries.filter(([, s]) => s.category === category);
  }
  const standards = entries.map(([id, s]) => ({
    id,
    name: s.name,
    category: s.category,
    description: s.description,
    level: s.level,
    checklist_items: s.checklist.length,
  }));
  output({ standards, count: standards.length }, raw, standards.map(s => `${s.id} — ${s.name}`).join('\n'));
}

/**
 * Parse standards.md to extract selected standard IDs.
 * @param {string} content - standards.md file content
 * @returns {string[]} Array of standard IDs found
 */
function parseStandardsFile(content) {
  const ids = [];
  for (const [id, s] of Object.entries(STANDARDS_CATALOG)) {
    if (content.includes('## ' + s.name)) ids.push(id);
  }
  return ids;
}

/**
 * Render standards.md content from selected standard IDs.
 * @param {string[]} ids - Array of standard IDs
 * @returns {string} Rendered markdown content
 */
function renderStandardsMd(ids) {
  const sections = ids.map(id => {
    const s = STANDARDS_CATALOG[id];
    if (!s) return '';
    const items = s.checklist.map(c => '- [ ] ' + c).join('\n');
    return `## ${s.name}\n\n**Category:** ${s.category} | **Level:** ${s.level}\n**Reference:** ${s.url}\n\n${s.description}\n\n### Checklist\n${items}`;
  }).filter(Boolean);

  return '# Project Standards\n\nStandards selected for this project. Agents reference this file during planning, execution, and verification.\n\n' +
    sections.join('\n\n') +
    '\n\n---\n\n> Manage standards with `pan-tools standards select|remove|status`.\n> Standards guide AI decisions — they do not replace dedicated scanning tools.\n';
}

/**
 * Add a standard to the project.
 * @param {string} cwd - Working directory
 * @param {string} standardId - Standard ID from catalog
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsSelect(cwd, standardId, raw) {
  if (!standardId) {
    error('Usage: standards select <standard-id>. Run "standards list" to see available.');
  }
  if (!STANDARDS_CATALOG[standardId]) {
    error('Unknown standard: ' + standardId + '. Run "standards list" to see available.');
  }

  const stdPath = path.join(planningPath(cwd), STANDARDS_FILE);
  const existing = safeReadFile(stdPath) || '';
  const currentIds = parseStandardsFile(existing);

  if (currentIds.includes(standardId)) {
    error(standardId + ' already in project standards');
  }

  currentIds.push(standardId);
  const content = renderStandardsMd(currentIds);

  try {
    fs.writeFileSync(stdPath, content, 'utf-8');
  } catch (err) {
    error('Failed to write standards.md: ' + err.message);
  }

  output({
    added: standardId,
    project_standards: currentIds,
    standards_file: toPosix(PLANNING_DIR + '/' + STANDARDS_FILE),
  }, raw, 'Added ' + STANDARDS_CATALOG[standardId].name);
}

/**
 * Remove a standard from the project.
 * @param {string} cwd - Working directory
 * @param {string} standardId - Standard ID to remove
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsRemove(cwd, standardId, raw) {
  if (!standardId) {
    error('Usage: standards remove <standard-id>');
  }

  const stdPath = path.join(planningPath(cwd), STANDARDS_FILE);
  const existing = safeReadFile(stdPath);
  if (!existing) {
    error('No standards.md found. Nothing to remove.');
  }

  const currentIds = parseStandardsFile(existing);
  if (!currentIds.includes(standardId)) {
    error(standardId + ' not in project standards. Current: ' + (currentIds.join(', ') || 'none'));
  }

  const newIds = currentIds.filter(id => id !== standardId);

  if (newIds.length === 0) {
    try { fs.unlinkSync(stdPath); } catch { /* ignore */ }
    output({ removed: standardId, project_standards: [], standards_file: null }, raw, 'Removed ' + standardId + ' (no standards remaining, file deleted)');
    return;
  }

  const content = renderStandardsMd(newIds);
  try {
    fs.writeFileSync(stdPath, content, 'utf-8');
  } catch (err) {
    error('Failed to write standards.md: ' + err.message);
  }

  output({
    removed: standardId,
    project_standards: newIds,
    standards_file: toPosix(PLANNING_DIR + '/' + STANDARDS_FILE),
  }, raw, 'Removed ' + standardId);
}

/**
 * Report compliance status for selected standards.
 * @param {string} cwd - Working directory
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsStatus(cwd, raw) {
  const stdPath = path.join(planningPath(cwd), STANDARDS_FILE);
  const existing = safeReadFile(stdPath);

  if (!existing) {
    output({
      project_standards: [],
      checks: [],
      overall_status: 'none',
    }, raw, 'No standards selected. Run "standards select <id>" to add one.');
    return;
  }

  const currentIds = parseStandardsFile(existing);
  const checks = currentIds.map(id => {
    const s = STANDARDS_CATALOG[id];
    if (!s) return null;
    const total = s.checklist.length;
    const checked = countCheckedInSection(existing, s.name);
    return {
      standard_id: id,
      standard_name: s.name,
      category: s.category,
      status: checked === total ? 'complete' : checked > 0 ? 'partial' : 'configured',
      checklist_items: total,
      verified_items: checked,
      coverage: Math.round((checked / total) * 100) + '%',
    };
  }).filter(Boolean);

  const allComplete = checks.every(c => c.status === 'complete');
  const anyPartial = checks.some(c => c.status === 'partial');

  output({
    project_standards: currentIds,
    checks,
    overall_status: allComplete ? 'complete' : anyPartial ? 'partial' : 'configured',
  }, raw, checks.map(c => `${c.standard_id}: ${c.coverage} (${c.verified_items}/${c.checklist_items})`).join('\n'));
}

/**
 * Recommend standards based on project.md content analysis.
 * @param {string} cwd - Working directory
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsRecommend(cwd, raw) {
  const projectPath = path.join(planningPath(cwd), PROJECT_FILE);
  const content = safeReadFile(projectPath);
  if (!content) {
    error('project.md not found. Run /pan:new-project first.');
  }

  const lower = content.toLowerCase();
  const detectedTypes = [];

  if (/\b(react|next\.?js|vue|angular|html|css|frontend|web\s*app|website|dashboard)\b/.test(lower)) detectedTypes.push('web');
  if (/\b(api|rest|graphql|endpoint|backend|server|express|fastify)\b/.test(lower)) detectedTypes.push('api');
  if (/\b(llm|gpt|claude|openai|anthropic|ai\s*model|machine\s*learning|neural|transformer)\b/.test(lower)) detectedTypes.push('ai');
  if (/\b(agent|autonomous|multi-agent|agentic|tool\s*use|tool\s*calling)\b/.test(lower)) detectedTypes.push('agent');
  if (/\b(enterprise|togaf|architecture\s*governance|compliance)\b/.test(lower)) detectedTypes.push('enterprise');
  if (/\b(cli|command.line|terminal|shell|argv)\b/.test(lower)) detectedTypes.push('cli');

  const explicitlyDetected = detectedTypes.length > 0;
  if (!explicitlyDetected) detectedTypes.push('general');

  const seen = new Set();
  const recommendations = [];
  for (const type of detectedTypes) {
    const recs = STANDARDS_RECOMMENDATIONS[type] || [];
    let perTypeIndex = 0;
    for (const id of recs) {
      if (seen.has(id)) continue;
      seen.add(id);
      const s = STANDARDS_CATALOG[id];
      const isHigh = explicitlyDetected && type !== 'general' && perTypeIndex === 0;
      recommendations.push({
        id,
        name: s.name,
        reason: type + ' project detected',
        priority: isHigh ? 'high' : 'medium',
        source_type: type,
      });
      perTypeIndex += 1;
    }
  }

  output({
    project_types: detectedTypes,
    recommendations,
  }, raw, recommendations.map(r => `[${r.priority}] ${r.id} — ${r.reason}`).join('\n'));
}

/**
 * Detect which keywords from a content string match standard-relevant keywords.
 * @param {string} content - Text content to scan
 * @returns {string[]} Unique standard IDs that match
 */
function detectStandardsFromContent(content) {
  const lower = content.toLowerCase();
  const matched = new Set();
  for (const [keyword, ids] of Object.entries(PHASE_KEYWORDS_TO_STANDARDS)) {
    if (lower.includes(keyword)) {
      for (const id of ids) matched.add(id);
    }
  }
  return Array.from(matched);
}

/**
 * Build compliance report for detected standards against selected standards.
 * @param {string[]} detectedIds - Standard IDs detected from content
 * @param {string[]} selectedIds - Standard IDs selected in standards.md
 * @param {string} stdContent - Raw standards.md content
 * @returns {Array} Compliance entries
 */
function buildComplianceReport(detectedIds, selectedIds, stdContent) {
  return detectedIds.map(id => {
    const s = STANDARDS_CATALOG[id];
    if (!s) return null;
    if (!selectedIds.includes(id)) {
      return {
        standard_id: id, standard_name: s.name, category: s.category,
        selected: false, status: 'not_selected', coverage: null,
        action: 'Consider selecting with: pan-tools standards select ' + id,
      };
    }
    const total = s.checklist.length;
    const checked = countCheckedInSection(stdContent, s.name);
    return {
      standard_id: id, standard_name: s.name, category: s.category,
      selected: true,
      status: checked === total ? 'complete' : checked > 0 ? 'partial' : 'configured',
      checklist_items: total, verified_items: checked,
      coverage: Math.round((checked / total) * 100) + '%',
    };
  }).filter(Boolean);
}

/**
 * Track which standards are relevant to a specific phase and their compliance state.
 * Analyzes phase plan.md files for keywords that map to standards.
 * @param {string} cwd - Working directory
 * @param {string} phaseNum - Phase number (e.g., "1", "2.1")
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsPhaseTrack(cwd, phaseNum, raw) {
  if (!phaseNum) {
    error('Usage: standards phase-track <phase-number>');
  }

  // Find the phase directory
  const phase = findPhaseInternal(cwd, phaseNum);
  if (!phase) {
    error('Phase ' + phaseNum + ' not found');
  }

  // Read all plan.md files in the phase directory
  const phaseDir = path.join(cwd, phase.directory);
  let files;
  try {
    files = fs.readdirSync(phaseDir);
  } catch {
    error('Cannot read phase directory: ' + phase.directory);
  }

  const planFiles = files.filter(f => f.endsWith('-plan.md') || f === 'plan.md');
  let combinedContent = '';
  for (const pf of planFiles) {
    const content = safeReadFile(path.join(phaseDir, pf));
    if (content) combinedContent += '\n' + content;
  }

  if (!combinedContent) {
    output({
      phase: phaseNum,
      phase_name: phase.name,
      relevant_standards: [],
      compliance: [],
      message: 'No plan files found in phase',
    }, raw, 'Phase ' + phaseNum + ': no plan files found');
    return;
  }

  // Detect relevant standards from phase content
  const detectedIds = detectStandardsFromContent(combinedContent);

  // Read standards.md for compliance state
  const stdPath = path.join(planningPath(cwd), STANDARDS_FILE);
  const stdContent = safeReadFile(stdPath) || '';
  const selectedIds = parseStandardsFile(stdContent);

  const compliance = buildComplianceReport(detectedIds, selectedIds, stdContent);

  output({
    phase: phaseNum,
    phase_name: phase.name,
    relevant_standards: detectedIds,
    compliance,
  }, raw, compliance.map(c => `${c.standard_id}: ${c.selected ? c.coverage || 'N/A' : 'not selected'}`).join('\n'));
}

/**
 * List external tools recommended for selected or specified standards.
 * @param {string} cwd - Working directory
 * @param {string} standardId - Optional specific standard ID
 * @param {boolean} raw - If true, output raw value
 */
function cmdStandardsTools(cwd, standardId, raw) {
  let targetIds;

  if (standardId) {
    if (!STANDARDS_CATALOG[standardId]) {
      error('Unknown standard: ' + standardId + '. Run "standards list" to see available.');
    }
    targetIds = [standardId];
  } else {
    // Use project's selected standards
    const stdPath = path.join(planningPath(cwd), STANDARDS_FILE);
    const content = safeReadFile(stdPath);
    if (!content) {
      error('No standards.md found. Select standards first or specify a standard ID.');
    }
    targetIds = parseStandardsFile(content);
    if (targetIds.length === 0) {
      error('No standards in standards.md. Run "standards select <id>" first.');
    }
  }

  const recommendations = targetIds.map(id => {
    const s = STANDARDS_CATALOG[id];
    const tools = STANDARDS_EXTERNAL_TOOLS[id] || [];
    return {
      standard_id: id,
      standard_name: s.name,
      tools,
    };
  });

  const allTools = new Map();
  for (const rec of recommendations) {
    for (const tool of rec.tools) {
      if (!allTools.has(tool.name)) allTools.set(tool.name, { ...tool, standards: [] });
      allTools.get(tool.name).standards.push(rec.standard_id);
    }
  }

  output({
    standards_queried: targetIds,
    recommendations,
    unique_tools: Array.from(allTools.values()),
  }, raw, Array.from(allTools.values()).map(t => `${t.name} — ${t.description} (${t.standards.join(', ')})`).join('\n'));
}

module.exports = {
  cmdConfigEnsureSection,
  cmdConfigSet,
  cmdConfigGet,
  cmdStandardsList,
  cmdStandardsSelect,
  cmdStandardsRemove,
  cmdStandardsStatus,
  cmdStandardsRecommend,
  cmdStandardsPhaseTrack,
  cmdStandardsTools,
  // Internal helpers exported for testing
  parseStandardsFile,
  renderStandardsMd,
  detectStandardsFromContent,
};
