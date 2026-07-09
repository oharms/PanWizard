/**
 * Verify / Retrospective analysis — milestone retro over historical .planning/ data.
 * Extracted from verify.cjs (IMPROVEMENT-TODO P2 module decomposition);
 * verify.cjs re-exports everything here, so consumers are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { safeReadFile, output } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { ROADMAP_FILE, isVerificationFile } = require('./constants.cjs');
const { planningPath, phasesPath } = require('./utils.cjs');

/**
 * Scan verification files in a phases directory and collect stats.
 * @param {string} phasesDir - Absolute path to phases directory
 * @returns {{ total: number, passed: number, gaps_found: number, human_needed: number, gap_patterns: string[] }}
 */
function collectVerificationStats(phasesDir) {
  const stats = { total: 0, passed: 0, gaps_found: 0, human_needed: 0, gap_patterns: [] };
  let dirs;
  try { dirs = fs.readdirSync(phasesDir, { withFileTypes: true }); } catch { return stats; }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const phaseDir = path.join(phasesDir, d.name);
    let files;
    try { files = fs.readdirSync(phaseDir); } catch { continue; }
    for (const f of files) {
      if (!isVerificationFile(f)) continue;
      stats.total++;
      const content = safeReadFile(path.join(phaseDir, f));
      if (!content) continue;
      const fm = extractFrontmatter(content);
      const status = (fm.status || '').toLowerCase();
      if (status === 'passed') stats.passed++;
      else if (status === 'gaps_found') stats.gaps_found++;
      else if (status === 'human_needed') stats.human_needed++;
      // Extract gap descriptions from ## Gaps section
      const gapsMatch = content.match(/## Gaps[\s\S]*?(?=\n## |$)/);
      if (gapsMatch) {
        const lines = gapsMatch[0].split('\n').filter(l => l.match(/^[-*]\s+/));
        for (const line of lines) {
          const desc = line.replace(/^[-*]\s+/, '').trim();
          if (desc) stats.gap_patterns.push(desc);
        }
      }
    }
  }
  return stats;
}

/**
 * Count phases from roadmap: total planned, completed, and decimal (gap closure) phases.
 * @param {string} roadmapContent - Roadmap file content
 * @returns {{ planned: number, completed: number, decimal_phases: number }}
 */
function countRoadmapPhases(roadmapContent) {
  const result = { planned: 0, completed: 0, decimal_phases: 0 };
  const checkboxRe = /- \[([ x])\]\s*(?:\*\*)?Phase\s+(\d+[A-Z]?(?:\.\d+)*)/gi;
  let m;
  while ((m = checkboxRe.exec(roadmapContent)) !== null) {
    result.planned++;
    if (m[1] === 'x') result.completed++;
    if (m[2].includes('.')) result.decimal_phases++;
  }
  return result;
}

/**
 * Group gap patterns by similarity (simple keyword grouping).
 * @param {string[]} patterns - Raw gap descriptions
 * @returns {Array<{pattern: string, count: number}>}
 */
function groupGapPatterns(patterns) {
  const groups = {};
  for (const p of patterns) {
    const key = p.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const words = key.split(/\s+/).slice(0, 3).join(' ');
    groups[words] = (groups[words] || 0) + 1;
  }
  return Object.entries(groups)
    .map(([pattern, count]) => ({ pattern, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

/**
 * Milestone retrospective — analyze historical .planning/ data for process improvement.
 * @param {string} cwd - Working directory
 * @param {boolean} raw - Raw output flag
 */
function cmdRetro(cwd, raw, args) {
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  const roadmapContent = safeReadFile(roadmapPath);
  if (!roadmapContent) {
    return output({ error: 'roadmap.md not found' }, raw, 'roadmap.md not found');
  }

  const phases = countRoadmapPhases(roadmapContent);
  const pDir = phasesPath(cwd);
  const verification = collectVerificationStats(pDir);
  const gapGroups = groupGapPatterns(verification.gap_patterns);

  // Estimation accuracy: planned phases vs actual (including decimal gap closures)
  const basePlanned = phases.planned - phases.decimal_phases;
  const estimationAccuracy = basePlanned > 0
    ? Math.round((basePlanned / phases.planned) * 100)
    : 100;

  const result = {
    phases_planned: phases.planned,
    phases_completed: phases.completed,
    phases_decimal: phases.decimal_phases,
    estimation_accuracy_pct: estimationAccuracy,
    verifications_total: verification.total,
    verifications_passed_first_try: verification.passed,
    verifications_gaps_found: verification.gaps_found,
    verifications_human_needed: verification.human_needed,
    first_try_rate_pct: verification.total > 0
      ? Math.round((verification.passed / verification.total) * 100)
      : null,
    common_gap_patterns: gapGroups,
  };

  // E-4: optional memory write. Top gap patterns become lessons for pan-planner
  // (they surface what plans routinely miss). First-try rate deltas feed
  // pan-verifier memory.
  const argsList = Array.isArray(args) ? args : [];
  if (argsList.includes('--write-memory')) {
    const { appendMemory } = require('./memory.cjs');
    const lessons_written = { 'pan-planner': 0, 'pan-verifier': 0 };
    const maxIdx = argsList.indexOf('--max');
    const maxLessons = maxIdx !== -1 && argsList[maxIdx + 1]
      ? Math.max(1, Math.min(10, Number(argsList[maxIdx + 1]) || 3))
      : 3;

    // Top N gap patterns → planner memory as single-line lessons.
    const top = gapGroups.slice(0, maxLessons);
    for (const g of top) {
      const lesson = `Recurring plan gap (${g.count}x across phases): "${g.pattern}" — factor into plan-checker inputs`;
      const r = appendMemory(cwd, 'pan-planner', lesson);
      if (r.appended) lessons_written['pan-planner'] += 1;
    }

    // Low first-try rate → verifier memory.
    if (verification.total >= 3 && result.first_try_rate_pct != null && result.first_try_rate_pct < 60) {
      const lesson = `First-try verification rate ${result.first_try_rate_pct}% over ${verification.total} runs — tighten verification criteria and pre-exec checks`;
      const r = appendMemory(cwd, 'pan-verifier', lesson);
      if (r.appended) lessons_written['pan-verifier'] += 1;
    }

    result.memory = { wrote: lessons_written, max: maxLessons };
  }

  const rawLines = [
    `Phases: ${phases.completed}/${phases.planned} completed (${phases.decimal_phases} gap closures)`,
    `Estimation accuracy: ${estimationAccuracy}%`,
    `Verifications: ${verification.passed}/${verification.total} passed first try`,
    `Gaps found: ${verification.gaps_found}, Human needed: ${verification.human_needed}`,
  ];
  if (gapGroups.length > 0) {
    rawLines.push('Common gap patterns:');
    for (const g of gapGroups) rawLines.push(`  - ${g.pattern} (${g.count}x)`);
  }
  if (result.memory) {
    rawLines.push(`Memory: wrote ${result.memory.wrote['pan-planner']} planner + ${result.memory.wrote['pan-verifier']} verifier lessons`);
  }

  output(result, raw, rawLines.join('\n'));
}

module.exports = {
  collectVerificationStats,
  countRoadmapPhases,
  groupGapPatterns,
  cmdRetro,
};
