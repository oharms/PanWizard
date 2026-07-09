/**
 * Utils — Shared utility functions used across multiple modules
 *
 * Functions here were previously duplicated in core.cjs, commands.cjs,
 * state.cjs, and phase.cjs. Now centralized for single-source-of-truth.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  PLANNING_DIR,
  PHASES_DIR,
  MILESTONES_DIR,
  isPlanFile,
  isSummaryFile,
  PHASE_DIR_RE,
} = require('./constants.cjs');

// ─── File utilities ──────────────────────────────────────────────────────────

/**
 * Read and parse a JSON file, returning null on any failure.
 * @param {string} filePath - Absolute path to the JSON file
 * @returns {Object|null} Parsed JSON object, or null if unreadable/unparseable
 */
function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Remove surrounding quotes (single or double) from a string.
 * @param {string} str - Input string possibly wrapped in quotes
 * @returns {string} String with leading/trailing quotes removed
 */
function removeQuotes(str) {
  return str.replace(/^["']|["']$/g, '');
}

// ─── Phase directory utilities ───────────────────────────────────────────────

/**
 * Build the absolute path to the .planning directory.
 * @param {string} cwd - Project root directory
 * @returns {string} Absolute path to .planning/
 */
function planningPath(cwd) {
  return path.join(cwd, PLANNING_DIR);
}

/**
 * Build the absolute path to the phases directory.
 * @param {string} cwd - Project root directory
 * @returns {string} Absolute path to .planning/phases/
 */
function phasesPath(cwd) {
  return path.join(cwd, PLANNING_DIR, PHASES_DIR);
}

/**
 * Build the absolute path to the milestones directory.
 * @param {string} cwd - Project root directory
 * @returns {string} Absolute path to .planning/milestones/
 */
function milestonesPath(cwd) {
  return path.join(cwd, PLANNING_DIR, MILESTONES_DIR);
}

/**
 * Read phase directories from the phases folder, sorted by phase number.
 * @param {string} cwd - Project root directory
 * @returns {string[]} Sorted array of directory names, or empty array on failure
 */
function listPhaseDirs(cwd) {
  const { comparePhaseNum } = require('./core.cjs');
  try {
    const entries = fs.readdirSync(phasesPath(cwd), { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort((a, b) => comparePhaseNum(a, b));
  } catch {
    return [];
  }
}

/**
 * Filter an array of filenames to only plan files, sorted.
 * @param {string[]} files - Array of filenames
 * @returns {string[]} Sorted plan filenames
 */
function filterPlanFiles(files) {
  return files.filter(isPlanFile).sort();
}

/**
 * Filter an array of filenames to only summary files, sorted.
 * @param {string[]} files - Array of filenames
 * @returns {string[]} Sorted summary filenames
 */
function filterSummaryFiles(files) {
  return files.filter(isSummaryFile).sort();
}

/**
 * Extract the phase number and name from a phase directory name.
 * e.g. "01-setup-auth" → { number: "01", name: "setup-auth" }
 * @param {string} dirName - Phase directory name
 * @returns {{ number: string, name: string|null }} Parsed phase info
 */
function parsePhaseDir(dirName) {
  const match = dirName.match(PHASE_DIR_RE);
  if (!match) return { number: dirName, name: null };
  return {
    number: match[1],
    name: match[2] || null,
  };
}

/**
 * Classify phase status from file counts. Returns a granular status string.
 * @param {number} planCount - Number of plan files
 * @param {number} summaryCount - Number of summary files
 * @param {{hasContext?: boolean, hasResearch?: boolean}} [flags] - Extra file flags
 * @returns {string} One of: 'complete', 'partial', 'planned', 'researched', 'discussed', 'empty'
 */
function classifyPhaseStatus(planCount, summaryCount, flags = {}) {
  if (summaryCount >= planCount && planCount > 0) return 'complete';
  if (summaryCount > 0) return 'partial';
  if (planCount > 0) return 'planned';
  if (flags.hasResearch) return 'researched';
  if (flags.hasContext) return 'discussed';
  return 'empty';
}

/**
 * Check if a file is accessible (exists and is readable).
 * @param {string} filePath - Absolute path to check
 * @returns {boolean}
 */
function fileAccessible(filePath) {
  try { fs.accessSync(filePath, fs.constants.R_OK); return true; } catch { return false; }
}

/**
 * Detect whether Brave Search API key is available (env var or key file).
 * @returns {boolean}
 */
function hasBraveSearchKey() {
  if (process.env.BRAVE_API_KEY) return true;
  return fileAccessible(path.join(os.homedir(), '.pan-wizard', 'brave_api_key'));
}

module.exports = {
  readJsonFile,
  removeQuotes,
  planningPath,
  phasesPath,
  milestonesPath,
  listPhaseDirs,
  filterPlanFiles,
  filterSummaryFiles,
  parsePhaseDir,
  classifyPhaseStatus,
  fileAccessible,
  hasBraveSearchKey,
};
