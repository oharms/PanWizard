/**
 * Verify / Drift detection — convention-drift scoring for changed files.
 * Extracted from verify.cjs (IMPROVEMENT-TODO P2 module decomposition);
 * verify.cjs re-exports everything here, so consumers are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { safeReadFile, execGit, toPosix, output, error } = require('./core.cjs');
const {
  BUILTIN_DRIFT_RULES, DRIFT_VERDICTS, BINARY_EXTENSIONS, DRIFT_MAX_FILES, DRIFT_MAX_FILE_SIZE, DRIFT_SEVERITY_WEIGHTS,
} = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

/**
 * Parse convention rules from CONVENTIONS.md markdown content.
 * Extracts anti-pattern rules from prose containing "instead of", "not", "never".
 * Run drift check internally and return result object (no output).
 * Used by cmdValidateHealth --drift.
 */
function runDriftCheck(cwd) {
  const conventionsPath = path.join(planningPath(cwd), 'codebase', 'CONVENTIONS.md');
  const conventionsContent = safeReadFile(conventionsPath);
  const claudeMdContent = safeReadFile(path.join(cwd, 'CLAUDE.md'));
  const combined = [conventionsContent, claudeMdContent].filter(Boolean).join('\n');
  const rules = parseConventionRules(combined || null);
  const files = getChangedFiles(cwd);
  const allViolations = [];
  let filesChecked = 0;
  for (const filePath of files) {
    const fullPath = path.join(cwd, filePath);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > DRIFT_MAX_FILE_SIZE) continue;
    } catch { continue; }
    const content = safeReadFile(fullPath);
    if (!content) continue;
    filesChecked++;
    allViolations.push(...checkFileConventions(filePath, content, rules));
  }
  const { score, verdict } = calculateDriftScore(allViolations, filesChecked, rules.length);
  return { drift_score: score, verdict, violation_count: allViolations.length, files_checked: filesChecked };
}

/**
 * Always merges with BUILTIN_DRIFT_RULES.
 * @param {string|null} content - Markdown content from CONVENTIONS.md
 * @returns {Array} Array of rule objects {id, antiPattern, message, severity, fileGlob}
 */
function parseConventionRules(content) {
  const parsed = [];
  if (content) {
    // Match lines with inline code containing negation patterns
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      // Pattern: "Use X instead of `Y`" or "Never use `Y`" or "Don't use `Y`"
      const negMatch = line.match(/(?:instead of|never use|don'?t use|avoid|not)\s+`([^`]+)`/i);
      if (negMatch) {
        const raw = negMatch[1].trim();
        try {
          const antiPattern = new RegExp('\\b' + raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
          parsed.push({
            id: 'conv-' + raw.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase().slice(0, 30),
            antiPattern,
            message: line.trim().slice(0, 120),
            severity: 'warning',
            fileGlob: null,
          });
        } catch { /* invalid regex — skip */ }
      }
    }
  }
  // Merge: parsed + builtins, dedup by id (parsed takes priority)
  const ids = new Set(parsed.map(r => r.id));
  for (const rule of BUILTIN_DRIFT_RULES) {
    if (!ids.has(rule.id)) parsed.push(rule);
  }
  return parsed;
}

/**
 * Check a single file's content against convention rules.
 * @param {string} filePath - Relative file path (for glob matching and output)
 * @param {string} content - File content
 * @param {Array} rules - Convention rules from parseConventionRules
 * @returns {Array} violations [{file, line, rule, message, severity}]
 */
function checkFileConventions(filePath, content, rules) {
  const violations = [];
  const lines = content.split(/\r?\n/);
  for (const rule of rules) {
    // Check fileGlob match (simple endsWith check — zero-dep)
    if (rule.fileGlob && !filePath.endsWith(rule.fileGlob)) continue;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comment-only lines
      if (/^\s*(\/\/|\/?\*|\*)/.test(line)) continue;
      if (rule.antiPattern.test(line)) {
        violations.push({
          file: toPosix(filePath),
          line: i + 1,
          rule: rule.id,
          message: rule.message,
          severity: rule.severity,
        });
      }
    }
  }
  return violations;
}

/**
 * Calculate drift score from violations.
 * @param {Array} violations - All violations across checked files
 * @param {number} filesChecked - Number of files checked
 * @param {number} rulesCount - Total rules applied
 * @returns {{score: number, verdict: string}}
 */
function calculateDriftScore(violations, filesChecked, rulesCount) {
  if (filesChecked === 0 || rulesCount === 0) return { score: 0, verdict: 'clean' };
  let weighted = 0;
  for (const v of violations) {
    weighted += DRIFT_SEVERITY_WEIGHTS[v.severity] || 0;
  }
  const ceiling = filesChecked * rulesCount * 0.3;
  const score = Math.min(1.0, weighted / Math.max(ceiling, 1));
  const rounded = Math.round(score * 100) / 100;
  const verdict = DRIFT_VERDICTS.find(b => rounded <= b.max)?.verdict || 'high';
  return { score: rounded, verdict };
}

/**
 * Get list of changed files from git diff.
 * @param {string} cwd - Working directory
 * @param {string} [sinceRef] - Git ref to diff against (default: HEAD)
 * @returns {string[]} Array of relative file paths
 */
function getChangedFiles(cwd, sinceRef) {
  const ref = sinceRef || 'HEAD';
  // Try staged + unstaged first, then diff against ref
  const result = execGit(cwd, ['diff', '--name-only', ref]);
  if (result.exitCode !== 0) return [];
  const stagedResult = execGit(cwd, ['diff', '--name-only', '--cached']);
  const allFiles = new Set();
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.trim()) allFiles.add(line.trim());
  }
  if (stagedResult.exitCode === 0) {
    for (const line of stagedResult.stdout.split(/\r?\n/)) {
      if (line.trim()) allFiles.add(line.trim());
    }
  }
  // Filter out binary extensions and limit
  const filtered = [];
  for (const f of allFiles) {
    const ext = path.extname(f).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) continue;
    filtered.push(f);
    if (filtered.length >= DRIFT_MAX_FILES) break;
  }
  return filtered;
}

/**
 * Run drift check on changed files against project conventions.
 * @param {string} cwd - Working directory
 * @param {boolean} raw - Raw output mode
 * @param {string[]} args - CLI arguments
 */
function cmdDriftCheck(cwd, raw, args) {
  // Parse flags
  let sinceRef = null;
  let threshold = 0.5;
  let specificFiles = null;
  const verbose = process.env.PAN_VERBOSE === '1';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--since' && args[i + 1]) { sinceRef = args[++i]; }
    else if (args[i] === '--threshold' && args[i + 1]) {
      const t = parseFloat(args[++i]);
      if (isNaN(t) || t < 0 || t > 1) { error('threshold must be 0.0-1.0'); return; }
      threshold = t;
    }
    else if (args[i] === '--files' && args[i + 1]) { specificFiles = args[++i].split(',').map(f => f.trim()); }
  }

  // Load convention rules
  const conventionsPath = path.join(planningPath(cwd), 'codebase', 'CONVENTIONS.md');
  const conventionsContent = safeReadFile(conventionsPath);
  const claudeMdContent = safeReadFile(path.join(cwd, 'CLAUDE.md'));
  const combined = [conventionsContent, claudeMdContent].filter(Boolean).join('\n');
  const rules = parseConventionRules(combined || null);

  // Get files to check
  let files;
  if (specificFiles) {
    files = specificFiles;
  } else {
    files = getChangedFiles(cwd, sinceRef);
  }

  // Check each file
  const allViolations = [];
  let filesChecked = 0;
  for (const filePath of files) {
    const fullPath = path.join(cwd, filePath);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > DRIFT_MAX_FILE_SIZE) continue;
    } catch { continue; }
    const content = safeReadFile(fullPath);
    if (!content) continue;
    filesChecked++;
    const violations = checkFileConventions(filePath, content, rules);
    allViolations.push(...violations);
  }

  // Calculate score
  const { score, verdict } = calculateDriftScore(allViolations, filesChecked, rules.length);
  const passed = score <= threshold;
  const summary = filesChecked === 0
    ? 'no files changed'
    : rules.length === 0
      ? 'no conventions loaded'
      : `drift: ${score} (${verdict}) — ${allViolations.length} violations in ${filesChecked} files`;

  const result = {
    drift_score: score,
    verdict,
    passed,
    threshold,
    violations: allViolations,
    violation_count: allViolations.length,
    files_checked: filesChecked,
    conventions_loaded: rules.length,
    summary,
  };
  if (verbose) {
    const byFile = {};
    for (const v of allViolations) {
      if (!byFile[v.file]) byFile[v.file] = [];
      byFile[v.file].push({ line: v.line, rule: v.rule, message: v.message, severity: v.severity });
    }
    result.per_file = byFile;
  }
  output(result, raw, summary);
}

module.exports = {
  runDriftCheck,
  parseConventionRules,
  checkFileConventions,
  calculateDriftScore,
  getChangedFiles,
  cmdDriftCheck,
};
