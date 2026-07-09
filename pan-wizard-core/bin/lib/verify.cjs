/**
 * Verify -- Verification suite, consistency, and health validation
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { safeReadFile, normalizePhaseName, execGit, findPhaseInternal, getMilestoneInfo, toPosix, output, error } = require('./core.cjs');
const { extractFrontmatter, parseMustHavesBlock } = require('./frontmatter.cjs');
const { writeStateMd, readStateSafe } = require('./state.cjs');
const {
  PLANNING_DIR, PHASES_DIR, STATE_FILE, ROADMAP_FILE, REQUIREMENTS_FILE, CONFIG_FILE, PROJECT_FILE, PATTERNS_FILE,
  isPlanFile, isSummaryFile, isVerificationFile, PHASE_HEADER_RE, PHASE_DIR_RE, ARCHIVE_DIR_RE, FIELD_VALUE_RE,
  PLAN_SUFFIX, SUMMARY_SUFFIX, STANDARDS_FILE, STANDARDS_CATALOG, HEALTH_STATUS,
  BUILTIN_DRIFT_RULES, DRIFT_VERDICTS, BINARY_EXTENSIONS, DRIFT_MAX_FILES, DRIFT_MAX_FILE_SIZE, DRIFT_SEVERITY_WEIGHTS,
} = require('./constants.cjs');
const { planningPath, phasesPath, filterPlanFiles, filterSummaryFiles, fileAccessible } = require('./utils.cjs');
// Drift detection lives in verify-drift.cjs; re-exported below so consumers of
// verify.cjs are unaffected by the decomposition.
const { runDriftCheck, parseConventionRules, checkFileConventions, calculateDriftScore, getChangedFiles, cmdDriftCheck } = require('./verify-drift.cjs');
const { collectVerificationStats, countRoadmapPhases, groupGapPatterns, cmdRetro } = require('./verify-retro.cjs');
const { detectInstalledRuntimes, validateRuntimeInstall, cmdValidateDeployment } = require('./verify-deploy.cjs');
const { cmdPreflight, cmdDepsValidate } = require('./verify-preflight.cjs');

/**
 * Spot-check files mentioned in summary content.
 * @param {string} cwd - Working directory
 * @param {string} content - Summary content
 * @param {number} checkCount - Max files to check
 * @returns {{ filesToCheck: string[], missing: string[] }}
 */
function verifyMentionedFiles(cwd, content, checkCount) {
  const mentionedFiles = new Set();
  const patterns = [
    /`([^`]+\.[a-zA-Z]+)`/g,
    /(?:Created|Modified|Added|Updated|Edited):\s*`?([^\s`]+\.[a-zA-Z]+)`?/gi,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const fp = match[1];
      if (fp && !fp.startsWith('http') && fp.includes('/')) mentionedFiles.add(fp);
    }
  }
  const filesToCheck = Array.from(mentionedFiles).slice(0, checkCount);
  const missing = [];
  for (const file of filesToCheck) {
    if (!fileAccessible(path.join(cwd, file))) missing.push(file);
  }
  return { filesToCheck, missing };
}

/**
 * Check if any referenced commit hashes exist in git history.
 * @param {string} cwd - Working directory
 * @param {string} content - Summary content
 * @returns {boolean}
 */
function verifyCommitHashes(cwd, content) {
  const hashes = content.match(/\b[0-9a-f]{7,40}\b/g) || [];
  for (const hash of hashes.slice(0, 3)) {
    const result = execGit(cwd, ['cat-file', '-t', hash]);
    if (result.exitCode === 0 && result.stdout === 'commit') return true;
  }
  return false;
}

/**
 * Detect self-check section outcome in summary content.
 * @param {string} content - Summary content
 * @returns {'passed'|'failed'|'not_found'}
 */
function verifySelfCheck(content) {
  const selfCheckPattern = /##\s*(?:Self[- ]?Check|Verification|Quality Check)/i;
  if (!selfCheckPattern.test(content)) return 'not_found';
  const checkSection = content.slice(content.search(selfCheckPattern));
  if (/(?:fail|✗|❌|incomplete|blocked)/i.test(checkSection)) return 'failed';
  if (/(?:all\s+)?(?:pass|✓|✅|complete|succeeded)/i.test(checkSection)) return 'passed';
  return 'not_found';
}

function cmdVerifySummary(cwd, summaryPath, checkFileCount, raw) {
  if (!summaryPath) error('summary-path required');

  const fullPath = path.join(cwd, summaryPath);
  const checkCount = checkFileCount || 2;

  let content;
  try { content = fs.readFileSync(fullPath, 'utf-8'); }
  catch {
    output({
      passed: false,
      checks: { summary_exists: false, files_created: { checked: 0, found: 0, missing: [] }, commits_exist: false, self_check: 'not_found' },
      errors: ['summary.md not found'],
    }, raw, 'failed');
    return;
  }

  const errors = [];
  const { filesToCheck, missing } = verifyMentionedFiles(cwd, content, checkCount);
  const commitsExist = verifyCommitHashes(cwd, content);
  const selfCheck = verifySelfCheck(content);

  if (missing.length > 0) errors.push('Missing files: ' + missing.join(', '));
  if (!commitsExist && (content.match(/\b[0-9a-f]{7,40}\b/g) || []).length > 0) errors.push('Referenced commit hashes not found in git history');
  if (selfCheck === 'failed') errors.push('Self-check section indicates failure');

  const passed = missing.length === 0 && selfCheck !== 'failed';
  output({
    passed,
    checks: { summary_exists: true, files_created: { checked: filesToCheck.length, found: filesToCheck.length - missing.length, missing }, commits_exist: commitsExist, self_check: selfCheck },
    errors,
  }, raw, passed ? 'passed' : 'failed');
}

/**
 * Validate a plan.md structure: required frontmatter, task elements, and consistency.
 * @param {string} cwd - Working directory path
 * @param {string} filePath - Path to the plan.md file
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdVerifyPlanStructure(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const fm = extractFrontmatter(content);
  const errors = [];
  const warnings = [];

  // Check required frontmatter fields
  const required = ['phase', 'plan', 'type', 'wave', 'depends_on', 'files_modified', 'autonomous', 'must_haves'];
  for (const field of required) {
    if (fm[field] === undefined) errors.push(`Missing required frontmatter field: ${field}`);
  }

  // Parse XML <task> elements and validate each has required sub-elements:
  // <name> (required), <action> (required), <verify> (recommended),
  // <done> (recommended), <files> (recommended)
  const taskPattern = /<task[^>]*>([\s\S]*?)<\/task>/g;
  const tasks = [];
  let taskMatch;
  while ((taskMatch = taskPattern.exec(content)) !== null) {
    const taskContent = taskMatch[1];
    const nameMatch = taskContent.match(/<name>([\s\S]*?)<\/name>/);
    const taskName = nameMatch ? nameMatch[1].trim() : 'unnamed';
    const hasFiles = /<files>/.test(taskContent);
    const hasAction = /<action>/.test(taskContent);
    const hasVerify = /<verify>/.test(taskContent);
    const hasDone = /<done>/.test(taskContent);

    if (!nameMatch) errors.push('Task missing <name> element');
    if (!hasAction) errors.push(`Task '${taskName}' missing <action>`);
    if (!hasVerify) warnings.push(`Task '${taskName}' missing <verify>`);
    if (!hasDone) warnings.push(`Task '${taskName}' missing <done>`);
    if (!hasFiles) warnings.push(`Task '${taskName}' missing <files>`);

    tasks.push({ name: taskName, hasFiles, hasAction, hasVerify, hasDone });
  }

  if (tasks.length === 0) warnings.push('No <task> elements found');

  // Wave/depends_on consistency
  if (fm.wave && parseInt(fm.wave, 10) > 1 && (!fm.depends_on || (Array.isArray(fm.depends_on) && fm.depends_on.length === 0))) {
    warnings.push('Wave > 1 but depends_on is empty');
  }

  // Autonomous/checkpoint consistency
  const hasCheckpoints = /<task\s+type=["']?checkpoint/.test(content);
  if (hasCheckpoints && fm.autonomous !== 'false' && fm.autonomous !== false) {
    errors.push('Has checkpoint tasks but autonomous is not false');
  }

  output({
    valid: errors.length === 0,
    errors,
    warnings,
    task_count: tasks.length,
    tasks,
    frontmatter_fields: Object.keys(fm),
  }, raw, errors.length === 0 ? 'valid' : 'invalid');
}

/**
 * Check if all plans in a phase have corresponding summaries.
 * @param {string} cwd - Working directory path
 * @param {string} phase - Phase number to check completeness for
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdVerifyPhaseCompleteness(cwd, phase, raw) {
  if (!phase) { error('phase required'); }
  const phaseInfo = findPhaseInternal(cwd, phase);
  if (!phaseInfo || !phaseInfo.found) {
    output({ error: 'Phase not found', phase }, raw);
    return;
  }

  const errors = [];
  const warnings = [];
  const phaseDir = path.join(cwd, phaseInfo.directory);

  // List plans and summaries
  let files;
  try { files = fs.readdirSync(phaseDir); } catch { output({ error: 'Cannot read phase directory' }, raw); return; }

  const plans = files.filter(f => f.match(/-PLAN\.md$/i));
  const summaries = files.filter(f => f.match(/-SUMMARY\.md$/i));

  // Extract plan IDs (everything before -plan.md)
  const planIds = new Set(plans.map(p => p.replace(/-PLAN\.md$/i, '')));
  const summaryIds = new Set(summaries.map(s => s.replace(/-SUMMARY\.md$/i, '')));

  // Plans without summaries
  const incompletePlans = [...planIds].filter(id => !summaryIds.has(id));
  if (incompletePlans.length > 0) {
    errors.push(`Plans without summaries: ${incompletePlans.join(', ')}`);
  }

  // Summaries without plans (orphans)
  const orphanSummaries = [...summaryIds].filter(id => !planIds.has(id));
  if (orphanSummaries.length > 0) {
    warnings.push(`Summaries without plans: ${orphanSummaries.join(', ')}`);
  }

  output({
    complete: errors.length === 0,
    phase: phaseInfo.phase_number,
    plan_count: plans.length,
    summary_count: summaries.length,
    incomplete_plans: incompletePlans,
    orphan_summaries: orphanSummaries,
    errors,
    warnings,
  }, raw, errors.length === 0 ? 'complete' : 'incomplete');
}

/**
 * Verify that @-references and backtick file paths in a document resolve to existing files.
 * @param {string} cwd - Working directory path
 * @param {string} filePath - Path to the file to check references in
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdVerifyReferences(cwd, filePath, raw) {
  if (!filePath) { error('file path required'); }
  const fullPath = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: filePath }, raw); return; }

  const found = [];
  const missing = [];

  // Find @-references: @path/to/file (must contain / to be a file path)
  const atRefs = content.match(/@([^\s\n,)]+\/[^\s\n,)]+)/g) || [];
  for (const ref of atRefs) {
    const cleanRef = ref.slice(1); // remove @
    const resolved = cleanRef.startsWith('~/')
      ? path.join(process.env.HOME || '', cleanRef.slice(2))
      : path.join(cwd, cleanRef);
    if (fileAccessible(resolved)) found.push(cleanRef); else missing.push(cleanRef);
  }

  // Find backtick file paths that look like real paths (contain / and have extension)
  const backtickRefs = content.match(/`([^`]+\/[^`]+\.[a-zA-Z]{1,10})`/g) || [];
  for (const ref of backtickRefs) {
    const cleanRef = ref.slice(1, -1); // remove backticks
    if (cleanRef.startsWith('http') || cleanRef.includes('${') || cleanRef.includes('{{')) continue;
    if (found.includes(cleanRef) || missing.includes(cleanRef)) continue; // dedup
    const resolved = path.join(cwd, cleanRef);
    if (fileAccessible(resolved)) found.push(cleanRef); else missing.push(cleanRef);
  }

  output({
    valid: missing.length === 0,
    found: found.length,
    missing,
    total: found.length + missing.length,
  }, raw, missing.length === 0 ? 'valid' : 'invalid');
}

/**
 * Verify that git commit hashes exist in the repository.
 * @param {string} cwd - Working directory path
 * @param {string[]} hashes - Array of commit hashes to verify
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdVerifyCommits(cwd, hashes, raw) {
  if (!hashes || hashes.length === 0) { error('At least one commit hash required'); }

  const valid = [];
  const invalid = [];
  for (const hash of hashes) {
    const result = execGit(cwd, ['cat-file', '-t', hash]);
    if (result.exitCode === 0 && result.stdout.trim() === 'commit') {
      valid.push(hash);
    } else {
      invalid.push(hash);
    }
  }

  output({
    all_valid: invalid.length === 0,
    valid,
    invalid,
    total: hashes.length,
  }, raw, invalid.length === 0 ? 'valid' : 'invalid');
}

/**
 * Verify must_haves.artifacts from a plan.md: file existence, line counts, exports, patterns.
 * @param {string} cwd - Working directory path
 * @param {string} planFilePath - Path to the plan.md file containing artifact specs
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdVerifyArtifacts(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const artifacts = parseMustHavesBlock(content, 'artifacts');
  if (artifacts.length === 0) {
    output({ error: 'No must_haves.artifacts found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const artifact of artifacts) {
    if (typeof artifact === 'string') continue; // skip simple string items
    const artPath = artifact.path;
    if (!artPath) continue;

    const artFullPath = path.join(cwd, artPath);
    const fileContent = safeReadFile(artFullPath);
    const exists = fileContent !== null;
    const check = { path: artPath, exists, issues: [], passed: false };

    if (exists) {
      const lineCount = fileContent.split('\n').length;

      if (artifact.min_lines && lineCount < artifact.min_lines) {
        check.issues.push(`Only ${lineCount} lines, need ${artifact.min_lines}`);
      }
      if (artifact.contains && !fileContent.includes(artifact.contains)) {
        check.issues.push(`Missing pattern: ${artifact.contains}`);
      }
      if (artifact.exports) {
        const exports = Array.isArray(artifact.exports) ? artifact.exports : [artifact.exports];
        for (const exp of exports) {
          if (!fileContent.includes(exp)) check.issues.push(`Missing export: ${exp}`);
        }
      }
      check.passed = check.issues.length === 0;
    } else {
      check.issues.push('File not found');
    }

    results.push(check);
  }

  const passed = results.filter(r => r.passed).length;
  output({
    all_passed: passed === results.length,
    passed,
    total: results.length,
    artifacts: results,
  }, raw, passed === results.length ? 'valid' : 'invalid');
}

/**
 * Verify must_haves.key_links from a plan.md: source-to-target references and patterns.
 * @param {string} cwd - Working directory path
 * @param {string} planFilePath - Path to the plan.md file containing key link specs
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdVerifyKeyLinks(cwd, planFilePath, raw) {
  if (!planFilePath) { error('plan file path required'); }
  const fullPath = path.isAbsolute(planFilePath) ? planFilePath : path.join(cwd, planFilePath);
  const content = safeReadFile(fullPath);
  if (!content) { output({ error: 'File not found', path: planFilePath }, raw); return; }

  const keyLinks = parseMustHavesBlock(content, 'key_links');
  if (keyLinks.length === 0) {
    output({ error: 'No must_haves.key_links found in frontmatter', path: planFilePath }, raw);
    return;
  }

  const results = [];
  for (const link of keyLinks) {
    if (typeof link === 'string') continue;
    const check = { from: link.from, to: link.to, via: link.via || '', verified: false, detail: '' };

    const sourceContent = safeReadFile(path.join(cwd, link.from || ''));
    if (!sourceContent) {
      check.detail = 'Source file not found';
    } else if (link.pattern) {
      try {
        const regex = new RegExp(link.pattern);
        if (regex.test(sourceContent)) {
          check.verified = true;
          check.detail = 'Pattern found in source';
        } else {
          const targetContent = safeReadFile(path.join(cwd, link.to || ''));
          if (targetContent && regex.test(targetContent)) {
            check.verified = true;
            check.detail = 'Pattern found in target';
          } else {
            check.detail = `Pattern "${link.pattern}" not found in source or target`;
          }
        }
      } catch {
        // Regex compilation failed -- report the invalid pattern to the caller
        check.detail = `Invalid regex pattern: ${link.pattern}`;
      }
    } else {
      // No pattern: just check source references target
      if (sourceContent.includes(link.to || '')) {
        check.verified = true;
        check.detail = 'Target referenced in source';
      } else {
        check.detail = 'Target not referenced in source';
      }
    }

    results.push(check);
  }

  const verified = results.filter(r => r.verified).length;
  output({
    all_verified: verified === results.length,
    verified,
    total: results.length,
    links: results,
  }, raw, verified === results.length ? 'valid' : 'invalid');
}

/**
 * Validate consistency between roadmap.md and disk: phase numbering, plan gaps, orphans.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */

/**
 * Check plan numbering, plan/summary pairing, and frontmatter within each phase directory.
 * @param {string} phasesDirPath - Absolute path to .planning/phases/
 * @param {string[]} warnings - Warnings array to append to
 */
function checkPhaseInternalConsistency(phasesDirPath, warnings) {
  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort();

    for (const dir of dirs) {
      let phaseFiles;
      try {
        phaseFiles = fs.readdirSync(path.join(phasesDirPath, dir));
      } catch {
        warnings.push(`Phase ${dir} directory unreadable`);
        continue;
      }
      const plans = phaseFiles.filter(f => f.endsWith(PLAN_SUFFIX)).sort();

      // Check plan number gaps
      const planNums = plans.map(p => {
        const planMatch = p.match(/-(\d{2})-plan\.md$/);
        return planMatch ? parseInt(planMatch[1], 10) : null;
      }).filter(n => n !== null);

      for (let i = 1; i < planNums.length; i++) {
        if (planNums[i] !== planNums[i - 1] + 1) {
          warnings.push(`Gap in plan numbering in ${dir}: plan ${planNums[i - 1]} → ${planNums[i]}`);
        }
      }

      // Check summaries without matching plans
      const summaries = phaseFiles.filter(f => f.endsWith(SUMMARY_SUFFIX));
      const planIds = new Set(plans.map(p => p.replace(PLAN_SUFFIX, '')));
      const summaryIds = new Set(summaries.map(s => s.replace(SUMMARY_SUFFIX, '')));

      for (const sid of summaryIds) {
        if (!planIds.has(sid)) {
          warnings.push(`Summary ${sid}${SUMMARY_SUFFIX} in ${dir} has no matching ${PLAN_SUFFIX.slice(1)}`);
        }
      }

      // Check frontmatter in plans has required fields
      for (const plan of plans) {
        let content;
        try {
          content = fs.readFileSync(path.join(phasesDirPath, dir, plan), 'utf-8');
        } catch {
          warnings.push(`${dir}/${plan}: unreadable`);
          continue;
        }
        const fm = extractFrontmatter(content);
        if (!fm.wave) {
          warnings.push(`${dir}/${plan}: missing 'wave' in frontmatter`);
        }
      }
    }
  } catch {
    // phases/ directory may not exist or be unreadable
  }
}

function cmdValidateConsistency(cwd, raw) {
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  const phasesDirPath = phasesPath(cwd);
  const errors = [];
  const warnings = [];

  // Check for ROADMAP
  let roadmapContent;
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
  } catch {
    errors.push('roadmap.md not found');
    output({ passed: false, errors, warnings }, raw, 'failed');
    return;
  }

  // Extract phases from ROADMAP by matching "## Phase N:" header lines
  const roadmapPhases = new Set();
  PHASE_HEADER_RE.lastIndex = 0; // reset /g regex before each use
  let match;
  while ((match = PHASE_HEADER_RE.exec(roadmapContent)) !== null) {
    roadmapPhases.add(match[1]);
  }

  // Get phases on disk by reading phase directory names
  const diskPhases = new Set();
  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name);
    for (const dir of dirs) {
      const dirMatch = dir.match(/^(\d+[A-Z]?(?:\.\d+)*)/i);
      if (dirMatch) diskPhases.add(dirMatch[1]);
    }
  } catch {
    // phases/ directory may not exist yet in a fresh project
  }

  // Check: phases in ROADMAP but not on disk
  for (const p of roadmapPhases) {
    if (!diskPhases.has(p) && !diskPhases.has(normalizePhaseName(p))) {
      warnings.push(`Phase ${p} in roadmap.md but no directory on disk`);
    }
  }

  // Check: phases on disk but not in ROADMAP
  for (const p of diskPhases) {
    const unpadded = String(parseInt(p, 10));
    if (!roadmapPhases.has(p) && !roadmapPhases.has(unpadded)) {
      warnings.push(`Phase ${p} exists on disk but not in roadmap.md`);
    }
  }

  // Check: sequential phase numbers (integers only)
  const integerPhases = [...diskPhases]
    .filter(p => !p.includes('.'))
    .map(p => parseInt(p, 10))
    .sort((a, b) => a - b);

  for (let i = 1; i < integerPhases.length; i++) {
    if (integerPhases[i] !== integerPhases[i - 1] + 1) {
      warnings.push(`Gap in phase numbering: ${integerPhases[i - 1]} → ${integerPhases[i]}`);
    }
  }

  // Check: plan numbering, plan/summary pairing, and frontmatter within each phase directory
  checkPhaseInternalConsistency(phasesDirPath, warnings);

  const passed = errors.length === 0;
  output({ passed, errors, warnings, warning_count: warnings.length }, raw, passed ? 'passed' : 'failed');
}

// ─── Health check helper functions ────────────────────────────────────────────
// Each checker receives cwd and a shared issues object { errors, warnings, info, repairs }
// and populates it with any problems found. This keeps cmdValidateHealth() as a
// thin orchestrator.

/**
 * Check that the .planning/ directory exists.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 * @returns {boolean} false if .planning/ is missing (fatal), true otherwise
 */
function checkPlanningDirExists(cwd, addIssue) {
  if (!fileAccessible(planningPath(cwd))) {
    addIssue('error', 'E001', PLANNING_DIR + '/ directory not found', 'Run /pan:new-project to initialize');
    return false;
  }
  return true;
}

/**
 * Check that project.md exists and contains expected sections.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 */
function checkProjectFile(cwd, addIssue) {
  const projectPath = path.join(planningPath(cwd), PROJECT_FILE);
  let content;
  try {
    content = fs.readFileSync(projectPath, 'utf-8');
  } catch {
    addIssue('error', 'E002', PROJECT_FILE + ' not found', 'Run /pan:new-project to create');
    return;
  }
  const requiredSections = ['## What This Is', '## Core Value', '## Requirements'];
  for (const section of requiredSections) {
    if (!content.includes(section)) {
      addIssue('warning', 'W001', `${PROJECT_FILE} missing section: ${section}`, 'Add section manually');
    }
  }
}

/**
 * Check that roadmap.md exists.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 */
function checkRoadmapFile(cwd, addIssue) {
  const roadmapFullPath = path.join(planningPath(cwd), ROADMAP_FILE);
  if (!fileAccessible(roadmapFullPath)) {
    addIssue('error', 'E003', ROADMAP_FILE + ' not found', 'Run /pan:milestone-new to create roadmap');
  }
}

/**
 * Check that state.md exists and its phase references match disk.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 * @param {string[]} repairs - Mutable array of repair actions to schedule
 */
function checkStateFile(cwd, addIssue, repairs) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const phasesDirPath = phasesPath(cwd);

  let stateContent;
  try {
    stateContent = fs.readFileSync(statePath, 'utf-8');
  } catch {
    addIssue('error', 'E004', STATE_FILE + ' not found', 'Run /pan:health --repair to regenerate', true);
    repairs.push('regenerateState');
    stateContent = null;
  }
  if (stateContent === null) {
    // skip further state checks
  } else {
    // Extract phase references (e.g. "Phase 3" or "phase 01") from state.md
    const phaseRefs = [...stateContent.matchAll(/[Pp]hase\s+(\d+(?:\.\d+)*)/g)].map(match => match[1]);
    // Get disk phases for cross-reference
    const diskPhases = new Set();
    try {
      const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const dirMatch = entry.name.match(/^(\d+(?:\.\d+)*)/);
          if (dirMatch) diskPhases.add(dirMatch[1]);
        }
      }
    } catch {
      // phases/ directory may not exist yet
    }
    // Check for invalid references -- only warn if there are phases on disk
    for (const ref of phaseRefs) {
      const normalizedRef = String(parseInt(ref, 10)).padStart(2, '0');
      if (!diskPhases.has(ref) && !diskPhases.has(normalizedRef) && !diskPhases.has(String(parseInt(ref, 10)))) {
        if (diskPhases.size > 0) {
          addIssue('warning', 'W002', `${STATE_FILE} references phase ${ref}, but only phases ${[...diskPhases].sort().join(', ')} exist`, `Run /pan:health --repair to regenerate ${STATE_FILE}`, true);
          if (!repairs.includes('regenerateState')) repairs.push('regenerateState');
        }
      }
    }
  }
}

/**
 * Check that config.json is valid JSON with a recognized schema.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 * @param {string[]} repairs - Mutable array of repair actions to schedule
 */
function checkConfigFile(cwd, addIssue, repairs) {
  const configFullPath = path.join(planningPath(cwd), CONFIG_FILE);
  let rawContent;
  try {
    rawContent = fs.readFileSync(configFullPath, 'utf-8');
  } catch {
    addIssue('warning', 'W003', CONFIG_FILE + ' not found', 'Run /pan:health --repair to create with defaults', true);
    repairs.push('createConfig');
    return;
  }
  try {
    const parsed = JSON.parse(rawContent);
    // Validate known fields against allowed values
    const validProfiles = ['quality', 'balanced', 'budget'];
    if (parsed.model_profile && !validProfiles.includes(parsed.model_profile)) {
      addIssue('warning', 'W004', `${CONFIG_FILE}: invalid model_profile "${parsed.model_profile}"`, `Valid values: ${validProfiles.join(', ')}`);
    }
  } catch (err) {
    // JSON parse failed -- config is corrupt and should be reset
    addIssue('error', 'E005', `${CONFIG_FILE}: JSON parse error - ${err.message}`, 'Run /pan:health --repair to reset to defaults', true);
    repairs.push('resetConfig');
  }
}

/**
 * Check that phase directories follow the NN-name naming convention.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 */
function checkPhaseDirectories(cwd, addIssue) {
  const phasesDirPath = phasesPath(cwd);
  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.match(/^\d{2}(?:\.\d+)*-[\w-]+$/)) {
        addIssue('warning', 'W005', `Phase directory "${entry.name}" doesn't follow NN-name format`, 'Rename to match pattern (e.g., 01-setup)');
      }
    }
  } catch {
    // phases/ directory may not exist yet in a fresh project
  }
}

/**
 * Check each phase directory for orphaned plans (no matching summary) and
 * validate ROADMAP/disk phase consistency.
 * @param {string} cwd - Working directory
 * @param {Function} addIssue - Issue recording callback
 */
/**
 * Cross-check roadmap phases against disk directories.
 * @param {string} cwd - Working directory
 * @param {string} phasesDirPath - Path to phases directory
 * @param {Function} addIssue - Issue recorder
 */
function crossCheckRoadmapDisk(cwd, phasesDirPath, addIssue) {
  let roadmapContent;
  try { roadmapContent = fs.readFileSync(path.join(planningPath(cwd), ROADMAP_FILE), 'utf-8'); }
  catch { return; }

  const roadmapPhases = new Set();
  PHASE_HEADER_RE.lastIndex = 0;
  let match;
  while ((match = PHASE_HEADER_RE.exec(roadmapContent)) !== null) roadmapPhases.add(match[1]);

  const diskPhases = new Set();
  try {
    for (const entry of fs.readdirSync(phasesDirPath, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const dm = entry.name.match(/^(\d+[A-Z]?(?:\.\d+)*)/i);
        if (dm) diskPhases.add(dm[1]);
      }
    }
  } catch { /* phases/ may not exist yet */ }

  for (const p of roadmapPhases) {
    const padded = String(parseInt(p, 10)).padStart(2, '0');
    if (!diskPhases.has(p) && !diskPhases.has(padded))
      addIssue('warning', 'W006', `Phase ${p} in ${ROADMAP_FILE} but no directory on disk`, 'Create phase directory or remove from roadmap');
  }
  for (const p of diskPhases) {
    const unpadded = String(parseInt(p, 10));
    if (!roadmapPhases.has(p) && !roadmapPhases.has(unpadded))
      addIssue('warning', 'W007', `Phase ${p} exists on disk but not in ${ROADMAP_FILE}`, 'Add to roadmap or remove directory');
  }
}

function checkPhaseContents(cwd, addIssue) {
  const phasesDirPath = phasesPath(cwd);

  try {
    const entries = fs.readdirSync(phasesDirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let phaseFiles;
      try {
        phaseFiles = fs.readdirSync(path.join(phasesDirPath, entry.name));
      } catch { continue; }
      const plans = phaseFiles.filter(f => isPlanFile(f));
      const summaryBases = new Set(phaseFiles.filter(f => isSummaryFile(f)).map(s => s.replace(SUMMARY_SUFFIX, '').replace('summary.md', '')));
      for (const plan of plans) {
        const planBase = plan.replace(PLAN_SUFFIX, '').replace('plan.md', '');
        if (!summaryBases.has(planBase)) addIssue('info', 'I001', `${entry.name}/${plan} has no summary.md`, 'May be in progress');
      }
    }
  } catch { /* phases/ may not exist */ }

  crossCheckRoadmapDisk(cwd, phasesDirPath, addIssue);
}

/**
 * Perform auto-repair actions for issues flagged as repairable.
 * Currently supports: createConfig, resetConfig (write default config.json),
 * and regenerateState (rebuild state.md from ROADMAP structure).
 * @param {string} cwd - Working directory
 * @param {string[]} repairs - List of repair action names to perform
 * @returns {Array<{action: string, success: boolean, path?: string, error?: string}>}
 */
function repairIssues(cwd, repairs) {
  const configFullPath = path.join(planningPath(cwd), CONFIG_FILE);
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const repairActions = [];

  for (const repair of repairs) {
    try {
      switch (repair) {
        case 'createConfig':
        case 'resetConfig': {
          // Write a fresh config.json with sensible defaults
          const defaults = {
            model_profile: 'balanced',
            commit_docs: true,
            search_gitignored: false,
            branching_strategy: 'none',
            research: true,
            plan_checker: true,
            verifier: true,
            parallelization: true,
          };
          fs.writeFileSync(configFullPath, JSON.stringify(defaults, null, 2), 'utf-8');
          repairActions.push({ action: repair, success: true, path: CONFIG_FILE });
          break;
        }
        case 'syncRequirements': {
          const syncResult = syncRequirementCheckboxes(cwd);
          repairActions.push({ action: repair, success: !syncResult.error, fixed: syncResult.fixed, error: syncResult.error || undefined });
          break;
        }
        case 'syncRoadmap': {
          const syncResult = syncRoadmapPlanCheckboxes(cwd);
          repairActions.push({ action: repair, success: !syncResult.error, fixed: syncResult.fixed, error: syncResult.error || undefined });
          break;
        }
        case 'regenerateState': {
          // Create timestamped backup before overwriting to prevent data loss
          try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
            const backupPath = `${statePath}.bak-${timestamp}`;
            fs.copyFileSync(statePath, backupPath);
            repairActions.push({ action: 'backupState', success: true, path: backupPath });
          } catch { /* state.md absent — nothing to back up */ }
          // Generate minimal state.md scaffolding from roadmap.md structure
          const milestone = getMilestoneInfo(cwd);
          let stateContent = '# Session State\n\n';
          stateContent += '## Project Reference\n\n';
          stateContent += `See: ${PLANNING_DIR}/${PROJECT_FILE}\n\n`;
          stateContent += '## Position\n\n';
          stateContent += `**Milestone:** ${milestone.version} ${milestone.name}\n`;
          stateContent += '**Current phase:** (determining...)\n';
          stateContent += '**Status:** Resuming\n\n';
          stateContent += '## Session Log\n\n';
          stateContent += `- ${new Date().toISOString().split('T')[0]}: ${STATE_FILE} regenerated by /pan:health --repair\n`;
          writeStateMd(statePath, stateContent, cwd);
          repairActions.push({ action: repair, success: true, path: STATE_FILE });
          break;
        }
      }
    } catch (err) {
      // Repair action failed -- record the error so callers can report it
      repairActions.push({ action: repair, success: false, error: err.message });
    }
  }

  return repairActions;
}

/**
 * Check standards compliance status (optional health check dimension).
 * Reads standards.md and reports per-standard coverage as info items.
 * @param {string} cwd - Working directory
 * @param {function} addIssue - Issue reporter (severity, code, message, fix, repairable)
 */
function checkStandardsCompliance(cwd, addIssue) {
  const stdPath = path.join(planningPath(cwd), STANDARDS_FILE);
  const content = safeReadFile(stdPath);
  if (!content) {
    addIssue('info', 'STD-000', 'No standards.md found — no standards selected', 'Run "pan-tools standards select <id>" to add standards');
    return;
  }

  // Parse which standards are in the file
  const ids = [];
  for (const [id, s] of Object.entries(STANDARDS_CATALOG)) {
    if (content.includes('## ' + s.name)) ids.push(id);
  }

  if (ids.length === 0) {
    addIssue('info', 'STD-001', 'standards.md exists but contains no recognized standards', 'Run "pan-tools standards select <id>" to add standards');
    return;
  }

  let totalChecked = 0;
  let totalItems = 0;
  for (const id of ids) {
    const s = STANDARDS_CATALOG[id];
    const total = s.checklist.length;
    const sectionStart = content.indexOf('## ' + s.name);
    const nextSection = content.indexOf('\n## ', sectionStart + 1);
    const section = nextSection > -1 ? content.slice(sectionStart, nextSection) : content.slice(sectionStart);
    const checked = (section.match(/- \[x\]/gi) || []).length;
    totalChecked += checked;
    totalItems += total;

    if (checked === 0) {
      addIssue('warning', 'STD-' + id, s.name + ': 0/' + total + ' items verified (0%)', 'Review checklist in standards.md and mark completed items');
    } else if (checked < total) {
      addIssue('info', 'STD-' + id, s.name + ': ' + checked + '/' + total + ' items verified (' + Math.round((checked / total) * 100) + '%)', 'Continue verifying remaining items');
    } else {
      addIssue('info', 'STD-' + id, s.name + ': ' + checked + '/' + total + ' items verified (100%)', null);
    }
  }

  const overallPct = totalItems > 0 ? Math.round((totalChecked / totalItems) * 100) : 0;
  addIssue('info', 'STD-SUMMARY', ids.length + ' standard(s) selected, overall coverage: ' + overallPct + '%', null);
}

/**
 * Check that completed phases with verifier enabled have verification records.
 * Reports missing verification.md as warnings for phases marked complete in roadmap.
 * @param {string} cwd - Working directory path
 * @param {Function} addIssue - Issue recording callback
 */
function checkVerificationGate(cwd, addIssue) {
  const planDir = planningPath(cwd);
  const configPath = path.join(planDir, CONFIG_FILE);
  const phasesDirPath = phasesPath(cwd);

  // Only check if verifier is enabled in config
  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch { return; }
  if (!config || !config.workflow || config.workflow.verifier !== true) return;

  // Scan phase directories for those with summaries but no verification
  let phaseDirs;
  try {
    phaseDirs = fs.readdirSync(phasesDirPath, { withFileTypes: true })
      .filter(d => d.isDirectory() && /^\d/.test(d.name));
  } catch { return; }

  for (const dir of phaseDirs) {
    const dirPath = path.join(phasesDirPath, dir.name);
    const files = fs.readdirSync(dirPath);
    const hasSummary = files.some(f => /-summary\.md$/i.test(f));
    const hasVerification = files.some(f => /-verification\.md$/i.test(f));

    // Only flag phases that have summaries (executed) but no verification
    if (hasSummary && !hasVerification) {
      const phaseNum = dir.name.match(/^(\d+(?:\.\d+)?)/)?.[1] || dir.name;
      addIssue('warning', 'VERIFICATION_GATE_MISSING',
        `Phase ${phaseNum} has completed plans but no verification record (verifier is enabled)`,
        `Run /pan:verify-phase ${phaseNum} to verify this phase`);
    }
  }
}

/**
 * Sync REQUIREMENTS.md checkboxes — mark requirements as complete if their
 * linked phases are completed in roadmap.md. Returns count of boxes fixed.
 * @param {string} cwd
 * @returns {{ fixed: number, error?: string }}
 */
function syncRequirementCheckboxes(cwd) {
  const planDir = planningPath(cwd);
  const reqPath = path.join(planDir, REQUIREMENTS_FILE);
  const roadmapPath = path.join(planDir, ROADMAP_FILE);

  let reqContent, roadmapContent;
  try { reqContent = fs.readFileSync(reqPath, 'utf-8'); } catch { return { fixed: 0, error: 'requirements.md not found' }; }
  try { roadmapContent = fs.readFileSync(roadmapPath, 'utf-8'); } catch { return { fixed: 0, error: 'roadmap.md not found' }; }

  // Find completed phases (checkbox marked [x] in roadmap)
  const completedPhases = [];
  const phaseRe = /- \[x\]\s*.*Phase\s+(\d+(?:\.\d+)?)/gi;
  let m;
  while ((m = phaseRe.exec(roadmapContent)) !== null) {
    completedPhases.push(m[1]);
  }

  if (completedPhases.length === 0) return { fixed: 0 };

  // For each completed phase, find linked requirement IDs and check their boxes
  let fixed = 0;
  for (const phaseNum of completedPhases) {
    const reqMatch = roadmapContent.match(
      new RegExp(`Phase\\s+${phaseNum.replace(/\./g, '\\.')}[\\s\\S]*?\\*\\*Requirements:\\*\\*\\s*([^\\n]+)`, 'i')
    );
    if (!reqMatch) continue;
    const reqIds = reqMatch[1].replace(/[\[\]]/g, '').split(/[,\s]+/).map(id => id.trim()).filter(Boolean);
    for (const reqId of reqIds) {
      const escaped = reqId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(- \\[) (\\]\\s*\\*\\*${escaped}\\*\\*)`, 'gi');
      const before = reqContent;
      reqContent = reqContent.replace(re, '$1x$2');
      if (reqContent !== before) fixed++;
    }
  }

  if (fixed > 0) {
    try { fs.writeFileSync(reqPath, reqContent, 'utf-8'); } catch (e) { return { fixed: 0, error: e.message }; }
  }
  return { fixed };
}

/**
 * Sync ROADMAP.md plan checkboxes — mark plans as checked if corresponding
 * summary files exist on disk (indicating execution completed).
 * @param {string} cwd
 * @returns {{ fixed: number, error?: string }}
 */
function syncRoadmapPlanCheckboxes(cwd) {
  const planDir = planningPath(cwd);
  const roadmapPath = path.join(planDir, ROADMAP_FILE);

  let roadmapContent;
  try { roadmapContent = fs.readFileSync(roadmapPath, 'utf-8'); } catch { return { fixed: 0, error: 'roadmap.md not found' }; }

  // Collect all summary files on disk (indicates plan was executed)
  const phasesDir = path.join(planDir, PHASES_DIR);
  const summaryFiles = new Set();
  try {
    const dirs = fs.readdirSync(phasesDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const dir of dirs) {
      try {
        const files = fs.readdirSync(path.join(phasesDir, dir.name));
        for (const f of files) {
          if (isSummaryFile(f)) {
            // Extract plan stem: "01-02-summary.md" → "01-02"
            const stem = f.replace(/-summary\.md$/i, '');
            summaryFiles.add(stem);
          }
        }
      } catch { /* unreadable phase dir */ }
    }
  } catch { return { fixed: 0 }; }

  if (summaryFiles.size === 0) return { fixed: 0 };

  // Mark plan checkboxes: "- [ ] 01-02-plan.md" → "- [x] 01-02-plan.md"
  let fixed = 0;
  for (const stem of summaryFiles) {
    const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(- \\[) (\\]\\s*${escaped}-plan)`, 'gi');
    const before = roadmapContent;
    roadmapContent = roadmapContent.replace(re, '$1x$2');
    if (roadmapContent !== before) fixed++;
  }

  if (fixed > 0) {
    try { fs.writeFileSync(roadmapPath, roadmapContent, 'utf-8'); } catch (e) { return { fixed: 0, error: e.message }; }
  }
  return { fixed };
}

/**
 * Cross-check STATE.md progress counts against REQUIREMENTS.md checkboxes and ROADMAP.md plan checkboxes.
 * Reports mismatches as warnings so users can run --repair or investigate.
 * @param {string} cwd - Working directory path
 * @param {Function} addIssue - Issue recording callback
 * @param {string[]} [repairs] - Repair action list (pushed to when repairable)
 */
function checkStateConsistency(cwd, addIssue, repairs) {
  const planDir = planningPath(cwd);
  const statePath = path.join(planDir, STATE_FILE);
  const reqPath = path.join(planDir, REQUIREMENTS_FILE);
  const roadmapPath = path.join(planDir, ROADMAP_FILE);

  // Read STATE.md frontmatter for progress counts
  let stateFm;
  try {
    const stateContent = fs.readFileSync(statePath, 'utf-8');
    stateFm = extractFrontmatter(stateContent);
  } catch { return; } // No state file — other checks handle this
  if (!stateFm || !stateFm.progress) return;

  // Check REQUIREMENTS.md checkbox count vs STATE expectations
  try {
    const reqContent = fs.readFileSync(reqPath, 'utf-8');
    const checkedBoxes = (reqContent.match(/- \[x\]/gi) || []).length;
    const uncheckedBoxes = (reqContent.match(/- \[ \]/g) || []).length;
    const totalBoxes = checkedBoxes + uncheckedBoxes;
    if (totalBoxes > 0 && uncheckedBoxes > 0) {
      const completedPlans = Number(stateFm.progress.completed_plans) || 0;
      const totalPlans = Number(stateFm.progress.total_plans) || 0;
      // Only warn if STATE says complete but REQUIREMENTS has unchecked items
      if (completedPlans > 0 && completedPlans >= totalPlans && uncheckedBoxes > 0) {
        addIssue('warning', 'STATE_REQ_DRIFT',
          `STATE.md shows all plans complete but REQUIREMENTS.md has ${uncheckedBoxes}/${totalBoxes} unchecked checkboxes`,
          'Run /pan:health --repair to auto-check completed requirement boxes', true);
        if (repairs) repairs.push('syncRequirements');
      }
    }
  } catch { /* no REQUIREMENTS.md — not required */ }

  // Check ROADMAP.md plan checkboxes vs STATE expectations
  try {
    const roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
    // Count checked and unchecked plan lines (lines with plan filenames)
    const planLines = roadmapContent.match(/- \[[ x]\]\s*\S+-(?:plan|PLAN)\S*/gi) || [];
    const checkedPlans = planLines.filter(l => /- \[x\]/i.test(l)).length;
    const uncheckedPlans = planLines.filter(l => /- \[ \]/.test(l)).length;
    if (uncheckedPlans > 0) {
      const completedPlans = Number(stateFm.progress.completed_plans) || 0;
      const totalPlans = Number(stateFm.progress.total_plans) || 0;
      if (completedPlans > 0 && completedPlans >= totalPlans && uncheckedPlans > 0) {
        addIssue('warning', 'STATE_ROADMAP_DRIFT',
          `STATE.md shows all plans complete but ROADMAP.md has ${uncheckedPlans} unchecked plan checkboxes`,
          'Run /pan:health --repair to auto-check completed plan boxes', true);
        if (repairs) repairs.push('syncRoadmap');
      }
    }
  } catch { /* no ROADMAP.md — other checks handle this */ }
}

/**
 * Run comprehensive health checks on .planning/ structure with optional auto-repair.
 * Delegates to individual checker functions and aggregates results.
 * @param {string} cwd - Working directory path
 * @param {Object} options - Options (repair: attempt to fix repairable issues, standards: include standards check)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdValidateHealth(cwd, options, raw) {
  const errors = [];
  const warnings = [];
  const info = [];
  const repairs = [];

  // Helper to add issue with severity, code, message, fix suggestion, and repairability
  const addIssue = (severity, code, message, fix, repairable = false) => {
    const issue = { code, message, fix, repairable };
    if (severity === 'error') errors.push(issue);
    else if (severity === 'warning') warnings.push(issue);
    else info.push(issue);
  };

  // Check 1: .planning/ exists (fatal if missing -- skip remaining checks)
  if (!checkPlanningDirExists(cwd, addIssue)) {
    output({
      status: HEALTH_STATUS.BROKEN,
      errors,
      warnings,
      info,
      repairable_count: 0,
    }, raw);
    return;
  }

  // Checks 2-8: individual structure and consistency checks
  checkProjectFile(cwd, addIssue);
  checkRoadmapFile(cwd, addIssue);
  checkStateFile(cwd, addIssue, repairs);
  checkConfigFile(cwd, addIssue, repairs);
  checkPhaseDirectories(cwd, addIssue);
  checkPhaseContents(cwd, addIssue);

  // Check 8b: cross-document state consistency
  checkStateConsistency(cwd, addIssue, repairs);

  // Check 8c: verification gate (phases with verifier enabled need verification.md)
  checkVerificationGate(cwd, addIssue);

  // Check 9 (optional): standards compliance
  if (options.standards) {
    checkStandardsCompliance(cwd, addIssue);
  }

  // Perform repairs if requested and there are repairable issues
  let repairActions = [];
  if (options.repair && repairs.length > 0) {
    repairActions = repairIssues(cwd, repairs);
  }

  // Check 10 (optional): full validation — run tests and build
  let testStatus;
  let buildStatus;
  let memoryBudget;
  if (options.full) {
    testStatus = runFullTestCheck(cwd);
    buildStatus = runFullBuildCheck(cwd);
    if (testStatus.pass === false) {
      addIssue('error', 'TESTS_FAIL', `Tests failed (exit code ${testStatus.exitCode})`, 'Fix failing tests');
    }
    if (buildStatus.pass === false) {
      addIssue('error', 'BUILD_FAIL', `Build failed (exit code ${buildStatus.exitCode})`, 'Fix build errors');
    }
    // Memory-load budget (ADR-0036 acceptance signal): keep per-agent memory
    // injection bounded as logs grow. Read-only, non-blocking.
    memoryBudget = require('./memory.cjs').memoryLoadBudget(cwd);
    if (memoryBudget.status === 'critical') {
      addIssue('warning', 'MEM_BUDGET', memoryBudget.advisory, "Run 'pan-tools memory compact <agent>' or scope injection with 'memory select'");
    } else if (memoryBudget.status === 'warning') {
      addIssue('info', 'MEM_BUDGET', memoryBudget.advisory, "Run 'pan-tools memory compact <agent>' or scope injection with 'memory select'");
    }
  }

  // Determine overall status from error/warning counts
  let status;
  if (errors.length > 0) {
    status = HEALTH_STATUS.BROKEN;
  } else if (warnings.length > 0) {
    status = HEALTH_STATUS.DEGRADED;
  } else {
    status = HEALTH_STATUS.HEALTHY;
  }

  const repairableCount = errors.filter(e => e.repairable).length +
                         warnings.filter(w => w.repairable).length;

  // Check 11 (optional): drift analysis
  let driftResult;
  if (options.drift) {
    driftResult = runDriftCheck(cwd);
    if (driftResult.verdict === 'high') {
      addIssue('warning', 'DRIFT_HIGH', `High drift score: ${driftResult.drift_score} (${driftResult.violation_count} violations)`, 'Run pan-tools drift-check for details');
    } else if (driftResult.verdict === 'medium') {
      addIssue('info', 'DRIFT_MEDIUM', `Medium drift score: ${driftResult.drift_score} (${driftResult.violation_count} violations)`, 'Run pan-tools drift-check for details');
    }
  }

  // Check 12 (optional): doc-code link graph (ADR-0027)
  let linkGraphResult;
  if (options.links) {
    const links = require('./links.cjs');
    const r = links.validateAll(cwd);
    linkGraphResult = {
      status: r.summary.status,
      errors: r.summary.errors,
      warnings: r.summary.warnings,
      doc_files_scanned: r.summary.doc_files_scanned,
      source_files_scanned: r.summary.source_files_scanned,
      anchors_found: r.summary.anchors_found,
      forward_links_found: r.summary.forward_links_found,
      backlink_contracts_checked: r.summary.backlink_contracts_checked,
    };
    if (r.summary.errors > 0) {
      addIssue('warning', 'LINKS_ERR', `Link graph has ${r.summary.errors} errors (broken refs or uncovered backlink contracts)`, 'Run pan-tools links validate for details');
    }
  }

  const result = {
    status,
    errors,
    warnings,
    info,
    repairable_count: repairableCount,
    repairs_performed: repairActions.length > 0 ? repairActions : undefined,
  };
  if (options.full) {
    result.test_status = testStatus;
    result.build_status = buildStatus;
    result.memory_budget = memoryBudget;
  }
  if (options.drift) {
    result.drift_status = driftResult;
  }
  if (options.links) {
    result.link_graph = linkGraphResult;
  }

  output(result, raw);
}

/**
 * Run node --test and capture result.
 */
function runFullTestCheck(cwd) {
  try {
    const result = execFileSync('node', ['--test'], {
      cwd,
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
    });
    const testMatch = result.match(/# tests (\d+)/);
    const passMatch = result.match(/# pass (\d+)/);
    return {
      pass: true,
      exitCode: 0,
      tests: testMatch ? parseInt(testMatch[1], 10) : null,
      passing: passMatch ? parseInt(passMatch[1], 10) : null,
    };
  } catch (err) {
    return {
      pass: false,
      exitCode: err.status || 1,
      tests: null,
      passing: null,
    };
  }
}

/**
 * Run npm run build:hooks and capture result.
 */
function runFullBuildCheck(cwd) {
  const pkgPath = path.join(cwd, 'package.json');
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    if (!pkg.scripts || !pkg.scripts['build:hooks']) {
      return { pass: null, exitCode: null, skipped: true };
    }
  } catch {
    return { pass: null, exitCode: null, skipped: true };
  }

  try {
    execFileSync('npm', ['run', 'build:hooks'], {
      cwd,
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });
    return { pass: true, exitCode: 0, skipped: false };
  } catch (err) {
    return { pass: false, exitCode: err.status || 1, skipped: false };
  }
}

// ─── Preflight + deps validation — extracted to verify-preflight.cjs (re-exported below)

// ─── Drift detection — extracted to verify-drift.cjs (re-exported below) ─────

// ─── Retrospective analysis — extracted to verify-retro.cjs (re-exported below)
// ─── Deployment validation — extracted to verify-deploy.cjs (re-exported below)

module.exports = {
  cmdVerifySummary,
  cmdVerifyPlanStructure,
  cmdVerifyPhaseCompleteness,
  cmdVerifyReferences,
  cmdVerifyCommits,
  cmdVerifyArtifacts,
  cmdVerifyKeyLinks,
  cmdValidateConsistency,
  cmdValidateHealth,
  cmdPreflight,
  cmdDepsValidate,
  cmdDriftCheck,
  parseConventionRules,
  checkFileConventions,
  calculateDriftScore,
  getChangedFiles,
  cmdRetro,
  collectVerificationStats,
  countRoadmapPhases,
  groupGapPatterns,
  checkVerificationGate,
  cmdValidateDeployment,
  validateRuntimeInstall,
  detectInstalledRuntimes,
  syncRequirementCheckboxes,
  syncRoadmapPlanCheckboxes,
};
