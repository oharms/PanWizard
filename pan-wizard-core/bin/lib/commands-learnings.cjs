/**
 * Commands / Learnings — error patterns, session history, and session-learnings
 * extraction (LEARN-NNN lifecycle), plus the shared phase-summary collector.
 * Extracted from commands.cjs (IMPROVEMENT-TODO P2 module decomposition);
 * commands.cjs re-exports the public pieces, so consumers are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { getArchivedPhaseDirs, output, error } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');
const { PLANNING_DIR, PATTERNS_FILE, SESSION_HISTORY_FILE, LEARNINGS_FILE, isSummaryFile } = require('./constants.cjs');
const { phasesPath } = require('./utils.cjs');

/**
 * Scan all phase directories (archived + current) and read summary frontmatter.
 * Returns an array of { phaseNum, dirName, frontmatter } objects for each summary found.
 *
 * Algorithm overview:
 * 1. Collect archived phase dirs from milestone archives (oldest milestones first)
 * 2. Collect current phase dirs from .planning/phases/
 * 3. For each directory, read all *-summary.md files and extract frontmatter
 *
 * @param {string} cwd - Working directory path
 * @returns {{ allPhaseDirs: Array, summaries: Array<{phaseNum: string, dirName: string, frontmatter: Object}> }}
 */
function collectPhaseSummaries(cwd) {
  const phasesDir = phasesPath(cwd);

  // Collect all phase directories: archived + current
  const allPhaseDirs = [];

  // Add archived phases first (oldest milestones first)
  const archived = getArchivedPhaseDirs(cwd);
  for (const archiveEntry of archived) {
    allPhaseDirs.push({ name: archiveEntry.name, fullPath: archiveEntry.fullPath, milestone: archiveEntry.milestone });
  }

  // Add current phases
  try {
    const currentDirs = fs.readdirSync(phasesDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .sort();
    for (const dirName of currentDirs) {
      allPhaseDirs.push({ name: dirName, fullPath: path.join(phasesDir, dirName), milestone: null });
    }
  } catch { /* phases dir missing or unreadable */ }

  const summaries = [];

  for (const { name: dirName, fullPath: dirPath } of allPhaseDirs) {
    let summaryFiles;
    try {
      summaryFiles = fs.readdirSync(dirPath).filter(filename => isSummaryFile(filename));
    } catch { continue; }

    for (const summaryFile of summaryFiles) {
      try {
        const content = fs.readFileSync(path.join(dirPath, summaryFile), 'utf-8');
        const frontmatter = extractFrontmatter(content);
        const phaseNum = frontmatter.phase || dirName.split('-')[0];

        summaries.push({ phaseNum, dirName, frontmatter });
      } catch {
        // Skip malformed summary files (broken YAML, unreadable)
      }
    }
  }

  return { allPhaseDirs, summaries };
}

/**
 * Read error patterns from .planning/patterns.md.
 * Parses PAT-NNN entries into structured objects.
 * @param {string} cwd - Working directory path
 * @returns {Array<{id: string, title: string, wrong: string, right: string, context: string|null, date: string|null}>}
 */
function readErrorPatterns(cwd) {
  const filePath = path.join(cwd, PLANNING_DIR, PATTERNS_FILE);
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  if (!content || !content.trim()) {
    return [];
  }

  const patterns = [];
  // Split on PAT-NNN headers
  const sections = content.split(/^### (PAT-\d+):\s*/m);
  // sections[0] = preamble, then alternating [id, body, id, body, ...]
  for (let i = 1; i < sections.length; i += 2) {
    const id = sections[i];
    const body = sections[i + 1] || '';

    // Title is the first line of the body
    const lines = body.split('\n');
    const title = lines[0] ? lines[0].trim() : '';
    const rest = lines.slice(1).join('\n');

    const wrongMatch = rest.match(/\*\*Wrong:\*\*\s*(.+)/);
    const rightMatch = rest.match(/\*\*Right:\*\*\s*(.+)/);
    const contextMatch = rest.match(/\*\*Context:\*\*\s*(.+)/);
    const dateMatch = rest.match(/\*\*Date:\*\*\s*(.+)/);

    // Skip entries missing required fields
    if (!wrongMatch || !rightMatch) continue;

    patterns.push({
      id,
      title,
      wrong: wrongMatch ? wrongMatch[1].trim() : null,
      right: rightMatch ? rightMatch[1].trim() : null,
      context: contextMatch ? contextMatch[1].trim() : null,
      date: dateMatch ? dateMatch[1].trim() : null,
    });
  }

  return patterns;
}

/**
 * Append a new error pattern entry to .planning/patterns.md.
 * Auto-increments the PAT-NNN ID. Creates file if missing.
 * @param {string} cwd - Working directory path
 * @param {Object} pattern - Pattern to append
 * @param {string} pattern.wrong - What went wrong
 * @param {string} pattern.right - What is correct
 * @param {string} [pattern.title] - Short title
 * @param {string} [pattern.context] - Additional context
 * @param {string} [pattern.date] - Date string (defaults to today)
 * @returns {{ id: string } | { error: string }}
 */
function appendErrorPattern(cwd, pattern) {
  if (!pattern || !pattern.wrong || !pattern.right) {
    return { error: "Pattern requires 'wrong' and 'right' fields" };
  }

  const filePath = path.join(cwd, PLANNING_DIR, PATTERNS_FILE);
  const existing = readErrorPatterns(cwd);

  // Determine next ID
  let maxNum = 0;
  for (const p of existing) {
    const m = p.id.match(/PAT-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }
  const nextId = `PAT-${String(maxNum + 1).padStart(3, '0')}`;

  const date = pattern.date || new Date().toISOString().split('T')[0];
  const title = pattern.title || 'Untitled';

  const entry = [
    '',
    `### ${nextId}: ${title}`,
    `**Wrong:** ${pattern.wrong}`,
    `**Right:** ${pattern.right}`,
    pattern.context ? `**Context:** ${pattern.context}` : null,
    `**Date:** ${date}`,
    '',
  ].filter(line => line !== null).join('\n');

  try {
    let existingContent = '';
    try {
      existingContent = fs.readFileSync(filePath, 'utf-8');
    } catch {
      // File doesn't exist — create with header
      existingContent = '# Error Patterns\n';
    }
    fs.writeFileSync(filePath, existingContent.trimEnd() + '\n' + entry, 'utf-8');
    return { id: nextId };
  } catch (e) {
    return { error: `Failed to write pattern: ${e.message}` };
  }
}

/**
 * Append a session summary to .planning/session-history.md.
 * Creates file with header if missing. Keeps last 20 entries.
 * @param {string} cwd - Working directory path
 * @param {Object} summary - Session summary
 * @param {string} summary.phase - Phase identifier
 * @param {number} [summary.plans_executed] - Plans executed
 * @param {number} [summary.tests_before] - Test count before
 * @param {number} [summary.tests_after] - Test count after
 * @param {string} [summary.key_decisions] - Key decisions made
 * @param {string} [summary.date] - Date string (defaults to today)
 * @returns {{ appended: boolean } | { error: string }}
 */
function appendSessionSummary(cwd, summary) {
  if (!summary || !summary.phase) {
    return { error: "Summary requires 'phase' field" };
  }

  const filePath = path.join(cwd, PLANNING_DIR, SESSION_HISTORY_FILE);
  const date = summary.date || new Date().toISOString().split('T')[0];

  const entry = [
    `### Session — ${date}`,
    `- **Phase:** ${summary.phase}`,
    summary.plans_executed != null ? `- **Plans Executed:** ${summary.plans_executed}` : null,
    summary.tests_before != null ? `- **Tests Before:** ${summary.tests_before}` : null,
    summary.tests_after != null ? `- **Tests After:** ${summary.tests_after}` : null,
    summary.key_decisions ? `- **Key Decisions:** ${summary.key_decisions}` : null,
    '',
  ].filter(line => line !== null).join('\n');

  try {
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      content = '# Session History\n\n';
    }

    content = content.trimEnd() + '\n\n' + entry;

    // Keep last 20 entries — split on session headers, trim oldest
    const SESSION_HEADER_RE = /^### Session — /m;
    const parts = content.split(SESSION_HEADER_RE);
    // parts[0] = header, parts[1..N] = session entries
    if (parts.length > 21) { // header + 20 entries
      const header = parts[0];
      const kept = parts.slice(parts.length - 20);
      content = header.trimEnd() + '\n\n' + kept.map(p => '### Session — ' + p).join('');
    }

    fs.writeFileSync(filePath, content, 'utf-8');
    return { appended: true };
  } catch (e) {
    return { error: `Failed to write session summary: ${e.message}` };
  }
}

// ---- Session Learnings ---------------------------------------------------------

/**
 * Parse learnings.md into structured entries.
 * Each learning has: id, type, title, detail, files (optional), date.
 * @param {string} content - Raw content of learnings.md
 * @returns {Array<{id: string, type: string, title: string, detail: string, files: string[], date: string|null}>}
 */
function parseLearnings(content) {
  if (!content || !content.trim()) return [];

  const learnings = [];
  const sections = content.split(/^### (LEARN-\d+):\s*/m);
  // sections[0] = preamble, then alternating [id, body, ...]
  for (let i = 1; i < sections.length; i += 2) {
    const id = sections[i];
    const body = sections[i + 1] || '';

    const lines = body.split('\n');
    const title = lines[0] ? lines[0].trim() : '';
    const rest = lines.slice(1).join('\n');

    const typeMatch = rest.match(/\*\*Type:\*\*\s*(.+)/);
    const detailMatch = rest.match(/\*\*Detail:\*\*\s*(.+)/);
    const filesMatch = rest.match(/\*\*Files:\*\*\s*(.+)/);
    const dateMatch = rest.match(/\*\*Date:\*\*\s*(.+)/);

    learnings.push({
      id,
      type: typeMatch ? typeMatch[1].trim() : 'unknown',
      title,
      detail: detailMatch ? detailMatch[1].trim() : '',
      files: filesMatch ? filesMatch[1].trim().split(/,\s*/) : [],
      date: dateMatch ? dateMatch[1].trim() : null,
    });
  }

  return learnings;
}

/**
 * Format a learning entry as markdown text.
 * @param {Object} learning - Learning entry
 * @returns {string}
 */
function formatLearningEntry(learning) {
  const lines = [
    `### ${learning.id}: ${learning.title}`,
    `**Type:** ${learning.type}`,
    `**Detail:** ${learning.detail}`,
  ];
  if (learning.files && learning.files.length > 0) {
    lines.push(`**Files:** ${learning.files.join(', ')}`);
  }
  if (learning.date) {
    lines.push(`**Date:** ${learning.date}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Extract learnings from session summaries and error patterns.
 * Reads session history + error patterns, extracts file co-change patterns
 * and error resolutions, writes to .planning/learnings.md.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw count instead of JSON
 * @returns {void}
 */
function cmdLearningsExtract(cwd, raw) {
  const learningsPath = path.join(cwd, PLANNING_DIR, LEARNINGS_FILE);
  const newLearnings = [];
  const today = new Date().toISOString().split('T')[0];

  // Read existing learnings to get next ID and avoid duplicates
  let existingContent = '';
  try { existingContent = fs.readFileSync(learningsPath, 'utf-8'); } catch { /* new file */ }
  const existing = parseLearnings(existingContent);
  let maxNum = 0;
  for (const l of existing) {
    const m = l.id.match(/LEARN-(\d+)/);
    if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
  }

  // Existing detail strings for dedup
  const existingDetails = new Set(existing.map(l => l.detail));

  // 1. Extract error resolutions from patterns.md
  const patterns = readErrorPatterns(cwd);
  for (const pat of patterns) {
    const detail = `${pat.wrong} -> ${pat.right}`;
    if (existingDetails.has(detail)) continue;
    existingDetails.add(detail);
    maxNum++;
    newLearnings.push({
      id: `LEARN-${String(maxNum).padStart(3, '0')}`,
      type: 'error-resolution',
      title: pat.title || 'Error pattern',
      detail,
      files: [],
      date: pat.date || today,
    });
  }

  // 2. Extract file co-change patterns from summary frontmatters
  const { summaries } = collectPhaseSummaries(cwd);
  const fileCoChanges = new Map(); // file -> Set of co-changed files

  for (const { frontmatter } of summaries) {
    const keyFiles = Array.isArray(frontmatter['key-files']) ? frontmatter['key-files'] : [];
    if (keyFiles.length < 2) continue;
    for (const file of keyFiles) {
      if (!fileCoChanges.has(file)) fileCoChanges.set(file, new Set());
      for (const other of keyFiles) {
        if (other !== file) fileCoChanges.get(file).add(other);
      }
    }
  }

  // Emit co-change learnings for files that appear together 2+ times
  const emittedPairs = new Set();
  for (const [file, coFiles] of fileCoChanges) {
    for (const coFile of coFiles) {
      const pair = [file, coFile].sort().join(' + ');
      if (emittedPairs.has(pair)) continue;
      emittedPairs.add(pair);

      // Count co-occurrences
      let count = 0;
      for (const { frontmatter } of summaries) {
        const kf = frontmatter['key-files'] || [];
        if (kf.includes(file) && kf.includes(coFile)) count++;
      }
      if (count < 2) continue;

      const detail = `${file} and ${coFile} changed together ${count} times`;
      if (existingDetails.has(detail)) continue;
      existingDetails.add(detail);
      maxNum++;
      newLearnings.push({
        id: `LEARN-${String(maxNum).padStart(3, '0')}`,
        type: 'co-change',
        title: `Co-change: ${path.basename(file)} + ${path.basename(coFile)}`,
        detail,
        files: [file, coFile],
        date: today,
      });
    }
  }

  // 3. Extract successful patterns from summaries
  for (const { frontmatter } of summaries) {
    const patterns_established = frontmatter['patterns-established'] || [];
    for (const pattern of patterns_established) {
      const detail = String(pattern);
      if (existingDetails.has(detail)) continue;
      existingDetails.add(detail);
      maxNum++;
      newLearnings.push({
        id: `LEARN-${String(maxNum).padStart(3, '0')}`,
        type: 'pattern',
        title: detail.length > 60 ? detail.substring(0, 57) + '...' : detail,
        detail,
        files: [],
        date: today,
      });
    }
  }

  // Write new learnings to file
  if (newLearnings.length > 0) {
    let content = existingContent;
    if (!content || !content.trim()) {
      content = '# Session Learnings\n\n';
    }

    for (const learning of newLearnings) {
      content = content.trimEnd() + '\n\n' + formatLearningEntry(learning);
    }

    try {
      fs.mkdirSync(path.dirname(learningsPath), { recursive: true });
      fs.writeFileSync(learningsPath, content, 'utf-8');
    } catch (e) {
      error('Failed to write learnings: ' + e.message);
    }
  }

  const result = {
    extracted: newLearnings.length,
    total: existing.length + newLearnings.length,
    by_type: {
      'error-resolution': newLearnings.filter(l => l.type === 'error-resolution').length,
      'co-change': newLearnings.filter(l => l.type === 'co-change').length,
      'pattern': newLearnings.filter(l => l.type === 'pattern').length,
    },
  };
  output(result, raw, `Extracted ${newLearnings.length} new learnings (${result.total} total)`);
}

/**
 * List all learnings from .planning/learnings.md.
 * @param {string} cwd - Working directory path
 * @param {boolean} raw - If true, output raw formatted list instead of JSON
 * @returns {void}
 */
function cmdLearningsList(cwd, raw) {
  const learningsPath = path.join(cwd, PLANNING_DIR, LEARNINGS_FILE);

  let content;
  try {
    content = fs.readFileSync(learningsPath, 'utf-8');
  } catch {
    output({ learnings: [], count: 0 }, raw, 'No learnings found');
    return;
  }

  const learnings = parseLearnings(content);
  const result = {
    learnings,
    count: learnings.length,
    by_type: {},
  };

  for (const l of learnings) {
    result.by_type[l.type] = (result.by_type[l.type] || 0) + 1;
  }

  if (raw) {
    const lines = learnings.map(l => `${l.id} [${l.type}] ${l.title}`);
    output(result, true, lines.join('\n') || 'No learnings found');
  } else {
    output(result, false);
  }
}

/**
 * Prune learnings by age (--days) or by ID (--id).
 * @param {string} cwd - Working directory path
 * @param {Object} opts - Prune options
 * @param {number|null} opts.days - Remove entries older than N days
 * @param {string|null} opts.id - Remove specific entry by ID
 * @param {boolean} raw - If true, output raw count instead of JSON
 * @returns {void}
 */
function cmdLearningsPrune(cwd, opts, raw) {
  const learningsPath = path.join(cwd, PLANNING_DIR, LEARNINGS_FILE);

  if (!opts || (opts.days == null && opts.id == null)) {
    error('Prune requires --days N or --id LEARN-NNN');
  }

  let content;
  try {
    content = fs.readFileSync(learningsPath, 'utf-8');
  } catch {
    output({ pruned: 0, remaining: 0 }, raw, 'No learnings file found');
    return;
  }

  const learnings = parseLearnings(content);
  const before = learnings.length;
  let kept;

  if (opts.id) {
    kept = learnings.filter(l => l.id !== opts.id);
  } else if (opts.days != null) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - opts.days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    kept = learnings.filter(l => !l.date || l.date >= cutoffStr);
  } else {
    kept = learnings;
  }

  const pruned = before - kept.length;

  // Rewrite file
  let newContent = '# Session Learnings\n';
  for (const learning of kept) {
    newContent += '\n' + formatLearningEntry(learning);
  }

  try {
    fs.writeFileSync(learningsPath, newContent, 'utf-8');
  } catch (e) {
    error('Failed to write learnings: ' + e.message);
  }

  const result = { pruned, remaining: kept.length };
  output(result, raw, `Pruned ${pruned} learnings (${kept.length} remaining)`);
}

module.exports = {
  collectPhaseSummaries,
  readErrorPatterns,
  appendErrorPattern,
  appendSessionSummary,
  parseLearnings,
  formatLearningEntry,
  cmdLearningsExtract,
  cmdLearningsList,
  cmdLearningsPrune,
};
