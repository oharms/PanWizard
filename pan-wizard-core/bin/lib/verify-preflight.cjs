/**
 * Verify / Pre-execution gates — preflight checks and dependency-graph validation.
 * Extracted from verify.cjs (IMPROVEMENT-TODO P2 module decomposition);
 * verify.cjs re-exports everything here, so consumers are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { safeReadFile, execGit, findPhaseInternal, output } = require('./core.cjs');
const { readStateSafe } = require('./state.cjs');
const {
  STATE_FILE, ROADMAP_FILE, CONFIG_FILE, PATTERNS_FILE, PHASE_DIR_RE,
} = require('./constants.cjs');
const { planningPath, phasesPath, filterSummaryFiles, fileAccessible } = require('./utils.cjs');

/**
 * Pre-flight validation: check execution prerequisites before starting work.
 * Validates state consistency, git cleanliness, blockers, and error patterns.
 * @param {string} cwd - Working directory path
 * @param {string|null} target - Optional target (phase number or 'batch')
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPreflight(cwd, target, raw) {
  const checks = [];
  const blockers = [];

  // Check 1: .planning/ directory exists
  const planDir = planningPath(cwd);
  if (fileAccessible(planDir)) {
    checks.push({ name: 'planning_dir', passed: true });
  } else {
    checks.push({ name: 'planning_dir', passed: false, detail: '.planning/ directory not found' });
    blockers.push('.planning/ directory not found — run /pan:new-project');
  }

  // Check 2: state.md is parseable
  const statePath = path.join(planDir, STATE_FILE);
  const stateContent = readStateSafe(statePath);
  if (stateContent) {
    checks.push({ name: 'state_readable', passed: true });
  } else {
    checks.push({ name: 'state_readable', passed: false, detail: 'state.md not found or unreadable' });
    blockers.push('state.md not found — run /pan:new-project');
  }

  // Check 3: no unresolved blockers in state.md
  if (stateContent) {
    const blockersMatch = stateContent.match(/##\s*Blockers\s*\n([\s\S]*?)(?=\n##|$)/i);
    const activeBlockers = [];
    if (blockersMatch) {
      const items = blockersMatch[1].match(/^-\s+(.+)$/gm) || [];
      for (const item of items) {
        const text = item.replace(/^-\s+/, '').trim();
        if (text && !/^none$/i.test(text)) {
          activeBlockers.push(text);
        }
      }
    }
    if (activeBlockers.length === 0) {
      checks.push({ name: 'no_blockers', passed: true });
    } else {
      checks.push({ name: 'no_blockers', passed: false, detail: activeBlockers.length + ' active blocker(s)' });
      for (const b of activeBlockers) blockers.push('Blocker: ' + b);
    }
  }

  // Check 4: git working tree is clean
  const gitResult = execGit(cwd, ['status', '--porcelain']);
  if (gitResult.exitCode !== 0) {
    checks.push({ name: 'git_clean', passed: true, detail: 'not a git repo or git unavailable' });
  } else {
    const dirty = gitResult.stdout.split('\n').filter(l => l.trim()).length;
    if (dirty === 0) {
      checks.push({ name: 'git_clean', passed: true });
    } else {
      checks.push({ name: 'git_clean', passed: false, detail: dirty + ' uncommitted change(s)' });
      blockers.push(dirty + ' uncommitted changes — commit or stash before executing');
    }
  }

  // Check 5: no known error patterns (check patterns.md exists and has entries)
  const patternsPath = path.join(planDir, PATTERNS_FILE);
  let patternCount = 0;
  try {
    const patternsContent = fs.readFileSync(patternsPath, 'utf-8');
    const patternMatches = patternsContent.match(/^### PAT-\d+:/gm);
    patternCount = patternMatches ? patternMatches.length : 0;
  } catch { /* no patterns file — that's fine */ }
  checks.push({ name: 'error_patterns', passed: true, detail: patternCount + ' known pattern(s)' });

  // Check 6: config.json exists
  const configPath = path.join(planDir, CONFIG_FILE);
  if (fileAccessible(configPath)) {
    checks.push({ name: 'config_exists', passed: true });
  } else {
    checks.push({ name: 'config_exists', passed: false, detail: 'config.json not found' });
  }

  // Check 7: target-specific checks
  if (target && stateContent) {
    const currentPhaseMatch = stateContent.match(/\*\*Current Phase:\*\*\s*(\S+)/);
    const currentPhase = currentPhaseMatch ? currentPhaseMatch[1] : null;
    if (target === 'batch') {
      // Check that a batch file exists
      const focusDir = path.join(planDir, 'focus');
      try {
        const files = fs.readdirSync(focusDir).filter(f => f.startsWith('batch-') && f.endsWith('.json'));
        if (files.length > 0) {
          checks.push({ name: 'batch_exists', passed: true, detail: files[files.length - 1] });
        } else {
          checks.push({ name: 'batch_exists', passed: false, detail: 'no batch file found' });
          blockers.push('No batch file — run /pan:focus-plan first');
        }
      } catch {
        checks.push({ name: 'batch_exists', passed: false, detail: 'focus/ directory not found' });
        blockers.push('No focus/ directory — run /pan:focus-scan first');
      }
    } else {
      // target is a phase number — check the phase directory exists
      const phaseResult = findPhaseInternal(cwd, target);
      if (phaseResult) {
        checks.push({ name: 'target_phase', passed: true, detail: 'Phase ' + target + ' found' });
      } else {
        checks.push({ name: 'target_phase', passed: false, detail: 'Phase ' + target + ' not found' });
        blockers.push('Phase ' + target + ' directory not found');
      }
    }
  }

  const ready = blockers.length === 0;

  output({
    ready,
    target: target || null,
    checks,
    blockers,
    passed: checks.filter(c => c.passed).length,
    total: checks.length,
  }, raw, ready ? 'ready' : 'blocked');
}

/**
 * Dependency graph validation — cross-reference roadmap phases vs disk directories
 * and requirements vs phase summaries to detect drift.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdDepsValidate(cwd, raw) {
  const planDir = planningPath(cwd);
  const issues = [];
  const orphanedReqs = [];
  const missingPhases = [];
  const orphanedDirs = [];

  // Step 1: Parse roadmap phases
  const roadmapPath = path.join(planDir, ROADMAP_FILE);
  const roadmapContent = safeReadFile(roadmapPath);
  const roadmapPhases = new Map(); // number -> name
  if (roadmapContent) {
    const headerRe = /#{2,4}\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:\s*([^\n]+)/gi;
    let match;
    while ((match = headerRe.exec(roadmapContent)) !== null) {
      roadmapPhases.set(match[1], match[2].trim());
    }
  } else {
    issues.push({ type: 'warning', message: 'roadmap.md not found' });
  }

  // Step 2: Scan disk phase directories
  const diskPhases = new Map(); // number -> dirName
  try {
    const entries = fs.readdirSync(phasesPath(cwd), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const dirMatch = entry.name.match(PHASE_DIR_RE);
        if (dirMatch) {
          diskPhases.set(dirMatch[1], entry.name);
        }
      }
    }
  } catch { /* phases dir missing */ }

  // Step 3: Cross-reference roadmap vs disk
  for (const [num, name] of roadmapPhases) {
    if (!diskPhases.has(num)) {
      missingPhases.push({ number: num, name, source: 'roadmap' });
      issues.push({ type: 'error', message: 'Phase ' + num + ' (' + name + ') in roadmap but no directory on disk' });
    }
  }
  for (const [num, dirName] of diskPhases) {
    if (!roadmapPhases.has(num)) {
      orphanedDirs.push({ number: num, directory: dirName });
      issues.push({ type: 'warning', message: 'Directory ' + dirName + ' exists on disk but Phase ' + num + ' not found in roadmap' });
    }
  }

  // Step 4: Parse requirements
  const reqPath = path.join(planDir, 'requirements.md');
  const reqContent = safeReadFile(reqPath);
  const allReqIds = [];
  const completedReqIds = new Set();
  if (reqContent) {
    // Find all REQ-NN patterns in checkbox lines
    const reqLines = reqContent.match(/^-\s*\[[ x]\]\s*\*\*([A-Z]+-\d+)\*\*/gmi) || [];
    for (const line of reqLines) {
      const idMatch = line.match(/\*\*([A-Z]+-\d+)\*\*/i);
      if (idMatch) {
        allReqIds.push(idMatch[1]);
        if (/\[x\]/i.test(line)) {
          completedReqIds.add(idMatch[1]);
        }
      }
    }
  }

  // Step 5: Check requirements traceability — find REQ IDs mentioned in summaries
  const tracedReqIds = new Set();
  for (const [, dirName] of diskPhases) {
    try {
      const files = fs.readdirSync(path.join(phasesPath(cwd), dirName));
      for (const file of filterSummaryFiles(files)) {
        const summaryContent = safeReadFile(path.join(phasesPath(cwd), dirName, file));
        if (summaryContent) {
          const mentions = summaryContent.match(/[A-Z]+-\d+/g) || [];
          for (const id of mentions) {
            if (allReqIds.includes(id)) tracedReqIds.add(id);
          }
        }
      }
    } catch { /* unreadable dir */ }
  }

  // Find requirements that are neither completed nor traced in any summary
  for (const reqId of allReqIds) {
    if (!completedReqIds.has(reqId) && !tracedReqIds.has(reqId)) {
      orphanedReqs.push(reqId);
      issues.push({ type: 'info', message: 'Requirement ' + reqId + ' not marked complete and not referenced in any summary' });
    }
  }

  const valid = issues.filter(i => i.type === 'error').length === 0;

  output({
    valid,
    issues,
    roadmap_phases: roadmapPhases.size,
    disk_phases: diskPhases.size,
    requirements_total: allReqIds.length,
    requirements_completed: completedReqIds.size,
    orphaned_reqs: orphanedReqs,
    missing_phases: missingPhases,
    orphaned_dirs: orphanedDirs,
  }, raw, valid ? 'valid' : 'issues found');
}

module.exports = {
  cmdPreflight,
  cmdDepsValidate,
};
