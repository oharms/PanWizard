/**
 * Template — Template selection and fill operations
 */

const fs = require('fs');
const path = require('path');
const {
  PLANNING_DIR, PHASES_DIR, PLAN_SUFFIX, SUMMARY_SUFFIX, VERIFICATION_SUFFIX,
  SIMPLE_TASK_THRESHOLD, SIMPLE_FILE_THRESHOLD, COMPLEX_TASK_THRESHOLD, COMPLEX_FILE_THRESHOLD,
} = require('./constants.cjs');
const { planningPath, phasesPath } = require('./utils.cjs');
const { normalizePhaseName, findPhaseInternal, generateSlugInternal, toPosix, output, error } = require('./core.cjs');
const { reconstructFrontmatter } = require('./frontmatter.cjs');

/**
 * Select the best summary template (minimal, standard, or complex) based on plan analysis.
 * @param {string} cwd - Working directory path
 * @param {string} planPath - Relative path to the plan.md file to analyze
 * @param {boolean} raw - If true, output raw template path instead of JSON
 * @returns {void}
 */
function cmdTemplateSelect(cwd, planPath, raw) {
  if (!planPath) {
    error('plan-path required');
  }

  try {
    const fullPath = path.join(cwd, planPath);
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Count task headings (### Task N)
    const taskMatch = content.match(/###\s*Task\s*\d+/g) || [];
    const taskCount = taskMatch.length;

    // Check for decision-related keywords
    const decisionMatch = content.match(/decision/gi) || [];
    const hasDecisions = decisionMatch.length > 0;

    // Count unique file path mentions (backticked paths containing a slash)
    const fileMentions = new Set();
    const filePattern = /`([^`]+\.[a-zA-Z]+)`/g;
    let fileMatch;
    while ((fileMatch = filePattern.exec(content)) !== null) {
      if (fileMatch[1].includes('/') && !fileMatch[1].startsWith('http')) {
        fileMentions.add(fileMatch[1]);
      }
    }
    const fileCount = fileMentions.size;

    // Select template based on complexity heuristics
    let template = 'templates/summary-standard.md';
    let type = 'standard';

    if (taskCount <= SIMPLE_TASK_THRESHOLD && fileCount <= SIMPLE_FILE_THRESHOLD && !hasDecisions) {
      // Simple plan: few tasks, few files, no decisions
      template = 'templates/summary-minimal.md';
      type = 'minimal';
    } else if (hasDecisions || fileCount > COMPLEX_FILE_THRESHOLD || taskCount > COMPLEX_TASK_THRESHOLD) {
      // Complex plan: has decisions, many files, or many tasks
      template = 'templates/summary-complex.md';
      type = 'complex';
    }

    const result = { template, type, taskCount, fileCount, hasDecisions };
    output(result, raw, template);
  } catch (err) {
    // Fallback to standard template on any read/parse error
    output({ template: 'templates/summary-standard.md', type: 'standard', error: err.message }, raw, 'templates/summary-standard.md');
  }
}

// ─── Template generators extracted from cmdTemplateFill ─────────────────────

/**
 * Generate the frontmatter and body for a plan template.
 * @param {string} phaseId - Full phase identifier (e.g., "01-setup-auth")
 * @param {string} planId - Zero-padded plan number (e.g., "01")
 * @param {string} phaseName - Human-readable phase name
 * @param {string} phaseSlug - Phase slug for directory naming
 * @param {string} phaseNum - Raw phase number from options
 * @param {Object} options - Additional options (type, wave, fields)
 * @returns {{frontmatter: Object, body: string, fileName: string}}
 */
function generatePlanTemplate(phaseId, planId, phaseName, phaseSlug, phaseNum, options) {
  const planType = options.type || 'execute';
  const wave = parseInt(options.wave, 10) || 1;
  const fields = options.fields || {};
  const padded = phaseId.split('-')[0]; // e.g., "01" from "01-setup-auth"

  const frontmatter = {
    phase: phaseId,
    plan: planId,
    type: planType,
    wave,
    depends_on: [],
    files_modified: [],
    autonomous: true,
    user_setup: [],
    must_haves: { truths: [], artifacts: [], key_links: [] },
    tier: null,
    priority: null,
    effort: null,
    ...fields,
  };

  const body = [
    `# Phase ${phaseNum} Plan ${planId}: [Title]`,
    '',
    '## Objective',
    '- **What:** [What this plan builds]',
    '- **Why:** [Why it matters for the phase goal]',
    '- **Output:** [Concrete deliverable]',
    '',
    '## Context',
    '@.planning/project.md',
    '@.planning/roadmap.md',
    '@.planning/state.md',
    '',
    '## Tasks',
    '',
    '<task type="code">',
    '  <name>[Task name]</name>',
    '  <files>[file paths]</files>',
    '  <action>[What to do]</action>',
    '  <verify>[How to verify]</verify>',
    '  <done>[Definition of done]</done>',
    '</task>',
    '',
    '## Verification',
    '[How to verify this plan achieved its objective]',
    '',
    '## Success Criteria',
    '- [ ] [Criterion 1]',
    '- [ ] [Criterion 2]',
  ].join('\n');

  const fileName = `${padded}-${planId}-plan.md`;
  return { frontmatter, body, fileName };
}

/**
 * Generate the frontmatter and body for a summary template.
 * @param {string} phaseId - Full phase identifier (e.g., "01-setup-auth")
 * @param {string} planId - Zero-padded plan number (e.g., "01")
 * @param {string} phaseName - Human-readable phase name
 * @param {string} phaseNum - Raw phase number from options
 * @param {Object} fields - Additional frontmatter fields to merge
 * @returns {{frontmatter: Object, body: string, fileName: string}}
 */
function generateSummaryTemplate(phaseId, planId, phaseName, phaseNum, fields) {
  const today = new Date().toISOString().split('T')[0];
  const padded = phaseId.split('-')[0];

  const frontmatter = {
    phase: phaseId,
    plan: planId,
    subsystem: '[primary category]',
    tags: [],
    provides: [],
    affects: [],
    'tech-stack': { added: [], patterns: [] },
    'key-files': { created: [], modified: [] },
    'key-decisions': [],
    'patterns-established': [],
    duration: '[X]min',
    completed: today,
    ...fields,
  };

  const body = [
    `# Phase ${phaseNum}: ${phaseName} Summary`,
    '',
    '**[Substantive one-liner describing outcome]**',
    '',
    '## Performance',
    '- **Duration:** [time]',
    '- **Tasks:** [count completed]',
    '- **Files modified:** [count]',
    '',
    '## Accomplishments',
    '- [Key outcome 1]',
    '- [Key outcome 2]',
    '',
    '## Task Commits',
    '1. **Task 1: [task name]** - `hash`',
    '',
    '## Files Created/Modified',
    '- `path/to/file.ts` - What it does',
    '',
    '## Decisions & Deviations',
    '[Key decisions or "None - followed plan as specified"]',
    '',
    '## Next Phase Readiness',
    '[What\'s ready for next phase]',
  ].join('\n');

  const fileName = `${padded}-${planId}-summary.md`;
  return { frontmatter, body, fileName };
}

/**
 * Generate the frontmatter and body for a verification template.
 * @param {string} phaseId - Full phase identifier (e.g., "01-setup-auth")
 * @param {string} phaseName - Human-readable phase name
 * @param {string} phaseNum - Raw phase number from options
 * @param {Object} fields - Additional frontmatter fields to merge
 * @returns {{frontmatter: Object, body: string, fileName: string}}
 */
function generateVerificationTemplate(phaseId, phaseName, phaseNum, fields) {
  const padded = phaseId.split('-')[0];

  const frontmatter = {
    phase: phaseId,
    verified: new Date().toISOString(),
    status: 'pending',
    score: '0/0 must-haves verified',
    ...fields,
  };

  const body = [
    `# Phase ${phaseNum}: ${phaseName} — Verification`,
    '',
    '## Observable Truths',
    '| # | Truth | Status | Evidence |',
    '|---|-------|--------|----------|',
    '| 1 | [Truth] | pending | |',
    '',
    '## Required Artifacts',
    '| Artifact | Expected | Status | Details |',
    '|----------|----------|--------|---------|',
    '| [path] | [what] | pending | |',
    '',
    '## Key Link Verification',
    '| From | To | Via | Status | Details |',
    '|------|----|----|--------|---------|',
    '| [source] | [target] | [connection] | pending | |',
    '',
    '## Requirements Coverage',
    '| Requirement | Status | Blocking Issue |',
    '|-------------|--------|----------------|',
    '| [req] | pending | |',
    '',
    '## Result',
    '[Pending verification]',
  ].join('\n');

  const fileName = `${padded}-verification.md`;
  return { frontmatter, body, fileName };
}

/**
 * Generate a pre-filled template file (summary, plan, or verification) in a phase directory.
 * Dispatches to the appropriate generator function based on templateType.
 * @param {string} cwd - Working directory path
 * @param {string} templateType - Template type: "summary", "plan", or "verification"
 * @param {Object} options - Options (phase, plan, name, type, wave, fields)
 * @param {boolean} raw - If true, output raw path instead of JSON
 * @returns {void}
 */
function cmdTemplateFill(cwd, templateType, options, raw) {
  if (!templateType) { error('template type required: summary, plan, or verification'); }
  if (!options.phase) { error('--phase required'); }

  const phaseInfo = findPhaseInternal(cwd, options.phase);
  if (!phaseInfo || !phaseInfo.found) { output({ error: 'Phase not found', phase: options.phase }, raw); return; }

  const padded = normalizePhaseName(options.phase);
  const phaseName = options.name || phaseInfo.phase_name || 'Unnamed';
  const phaseSlug = phaseInfo.phase_slug || generateSlugInternal(phaseName);
  const phaseId = `${padded}-${phaseSlug}`;
  const planNum = (options.plan || '01').padStart(2, '0');
  const fields = options.fields || {};

  let generated;

  switch (templateType) {
    case 'summary':
      generated = generateSummaryTemplate(phaseId, planNum, phaseName, options.phase, fields);
      break;
    case 'plan':
      generated = generatePlanTemplate(phaseId, planNum, phaseName, phaseSlug, options.phase, options);
      break;
    case 'verification':
      generated = generateVerificationTemplate(phaseId, phaseName, options.phase, fields);
      break;
    default:
      error(`Unknown template type: ${templateType}. Available: summary, plan, verification`);
      return;
  }

  const fullContent = `---\n${reconstructFrontmatter(generated.frontmatter)}\n---\n\n${generated.body}\n`;
  const outPath = path.join(cwd, phaseInfo.directory, generated.fileName);

  try {
    fs.writeFileSync(outPath, fullContent, { encoding: 'utf-8', flag: 'wx' });
  } catch (e) {
    if (e.code === 'EEXIST') {
      output({ error: 'File already exists', path: path.relative(cwd, outPath) }, raw);
      return;
    }
    error(`Failed to write template: ${e.message}`);
  }
  const relPath = toPosix(path.relative(cwd, outPath));
  output({ created: true, path: relPath, template: templateType }, raw, relPath);
}

module.exports = {
  cmdTemplateSelect,
  cmdTemplateFill,
  // Exported for testability
  generatePlanTemplate,
  generateSummaryTemplate,
  generateVerificationTemplate,
};
