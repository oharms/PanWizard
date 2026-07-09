/**
 * Phase / Remove — phase removal with renumbering cascade (directories, files,
 * roadmap references, state counts).
 * Extracted from phase.cjs (IMPROVEMENT-TODO P2 module decomposition);
 * phase.cjs re-exports the public pieces, so consumers are unaffected.
 */

const fs = require('fs');
const path = require('path');
const { escapeRegex, normalizePhaseName, comparePhaseNum, output, error } = require('./core.cjs');
const { writeStateMd, readStateSafe } = require('./state.cjs');
const { ROADMAP_FILE, STATE_FILE, isSummaryFile } = require('./constants.cjs');
const { planningPath, phasesPath, fileAccessible } = require('./utils.cjs');

/**
 * Delete a phase directory from disk.
 * @param {string} phaseDir - Absolute path to the phase directory to remove
 */
function removePhaseFromDisk(phaseDir) {
  try {
    fs.rmSync(phaseDir, { recursive: true, force: true });
  } catch (e) {
    return { removed: false, error: e.message };
  }
  return { removed: true };
}

/**
 * Renumber sibling decimal phases after one is removed.
 *
 * Algorithm: When a decimal phase like 06.2 is removed, all higher-numbered
 * siblings under the same base integer (06.3, 06.4, ...) must be decremented
 * by 1 to fill the gap. We process in descending order to avoid directory
 * name collisions during rename (e.g. rename 06.4 -> 06.3 before 06.3 -> 06.2).
 *
 * @param {string} phasesDir - Absolute path to the phases directory
 * @param {string} baseInt - The integer portion of the removed phase (e.g. "06")
 * @param {number} removedDecimal - The decimal portion that was removed (e.g. 2)
 * @returns {{ renamedDirs: Array, renamedFiles: Array }}
 */
function renumberDecimalPhases(phasesDir, baseInt, removedDecimal) {
  const renamedDirs = [];
  const renamedFiles = [];

  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((left, right) => comparePhaseNum(left, right));

    // Find sibling decimals with higher numbers than the removed one
    const decPattern = new RegExp(`^${escapeRegex(String(baseInt))}\\.(\\d+)-(.+)$`);
    const toRename = [];
    for (const dir of dirs) {
      const decMatch = dir.match(decPattern);
      if (decMatch && parseInt(decMatch[1], 10) > removedDecimal) {
        toRename.push({ dir, oldDecimal: parseInt(decMatch[1], 10), slug: decMatch[2] });
      }
    }

    // Sort descending so higher-numbered dirs are renamed first,
    // preventing collisions (e.g. 06.4 -> 06.3 before 06.3 -> 06.2)
    toRename.sort((left, right) => right.oldDecimal - left.oldDecimal);

    for (const item of toRename) {
      const newDecimal = item.oldDecimal - 1;
      const oldPhaseId = `${baseInt}.${item.oldDecimal}`;
      const newPhaseId = `${baseInt}.${newDecimal}`;
      const newDirName = `${baseInt}.${newDecimal}-${item.slug}`;

      // Rename the directory itself (e.g. 06.3-foo -> 06.2-foo)
      fs.renameSync(path.join(phasesDir, item.dir), path.join(phasesDir, newDirName));
      renamedDirs.push({ from: item.dir, to: newDirName });

      // Rename files inside that contain the old phase ID prefix
      const dirFiles = fs.readdirSync(path.join(phasesDir, newDirName));
      for (const file of dirFiles) {
        // Files may have phase prefix like "06.2-01-plan.md"
        if (file.includes(oldPhaseId)) {
          const newFileName = file.replace(oldPhaseId, newPhaseId);
          fs.renameSync(
            path.join(phasesDir, newDirName, file),
            path.join(phasesDir, newDirName, newFileName)
          );
          renamedFiles.push({ from: file, to: newFileName });
        }
      }
    }
  } catch (e) {
    return { renamedDirs, renamedFiles, error: `Partial rename: ${e.message}` };
  }

  return { renamedDirs, renamedFiles };
}

/**
 * Collect phase directories that need renumbering (integer > removedInt).
 * @param {string[]} dirs - Sorted directory names
 * @param {number} removedInt - Removed phase integer
 * @returns {Array} Items to rename, sorted descending to avoid collisions
 */
function collectDirsToRenumber(dirs, removedInt) {
  const toRename = [];
  for (const dir of dirs) {
    const dirMatch = dir.match(/^(\d+)([A-Z])?(?:\.(\d+))?-(.+)$/i);
    if (!dirMatch) continue;
    const dirInt = parseInt(dirMatch[1], 10);
    if (dirInt > removedInt) {
      toRename.push({
        dir, oldInt: dirInt,
        letter: dirMatch[2] ? dirMatch[2].toUpperCase() : '',
        decimal: dirMatch[3] ? parseInt(dirMatch[3], 10) : null,
        slug: dirMatch[4],
      });
    }
  }
  toRename.sort((left, right) => {
    if (left.oldInt !== right.oldInt) return right.oldInt - left.oldInt;
    return (right.decimal || 0) - (left.decimal || 0);
  });
  return toRename;
}

/**
 * Rename a single phase directory and its internal files.
 * @param {string} phasesDir - Phases directory path
 * @param {Object} item - Rename item from collectDirsToRenumber
 * @param {Array} renamedDirs - Accumulator for renamed dirs
 * @param {Array} renamedFiles - Accumulator for renamed files
 */
function renamePhaseDir(phasesDir, item, renamedDirs, renamedFiles) {
  const newPadded = String(item.oldInt - 1).padStart(2, '0');
  const oldPadded = String(item.oldInt).padStart(2, '0');
  const suffix = (item.letter || '') + (item.decimal !== null ? `.${item.decimal}` : '');
  const oldPrefix = oldPadded + suffix;
  const newPrefix = newPadded + suffix;
  const newDirName = `${newPrefix}-${item.slug}`;

  fs.renameSync(path.join(phasesDir, item.dir), path.join(phasesDir, newDirName));
  renamedDirs.push({ from: item.dir, to: newDirName });

  for (const file of fs.readdirSync(path.join(phasesDir, newDirName))) {
    if (file.startsWith(oldPrefix)) {
      const newFileName = newPrefix + file.slice(oldPrefix.length);
      fs.renameSync(path.join(phasesDir, newDirName, file), path.join(phasesDir, newDirName, newFileName));
      renamedFiles.push({ from: file, to: newFileName });
    }
  }
}

/**
 * Renumber integer phases (and their decimal/letter children) after one is removed.
 *
 * Algorithm: When an integer phase like 05 is removed, all phases with a higher
 * integer base (06, 06.1, 06A, 07, ...) must be decremented by 1. We process
 * in descending order to avoid directory name collisions during the rename
 * cascade (e.g. rename 07 -> 06 before 06 -> 05). Each directory and its
 * contained files with the old phase prefix are renamed to reflect the new number.
 *
 * @param {string} phasesDir - Absolute path to the phases directory
 * @param {number} removedInt - The integer phase number that was removed
 * @returns {{ renamedDirs: Array, renamedFiles: Array }}
 */
function renumberIntegerPhases(phasesDir, removedInt) {
  const renamedDirs = [];
  const renamedFiles = [];
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name).sort((a, b) => comparePhaseNum(a, b));
    const toRename = collectDirsToRenumber(dirs, removedInt);
    for (const item of toRename) renamePhaseDir(phasesDir, item, renamedDirs, renamedFiles);
  } catch (e) {
    return { renamedDirs, renamedFiles, error: `Partial rename: ${e.message}` };
  }
  return { renamedDirs, renamedFiles };
}

/**
 * Rewrite roadmap.md after a phase is removed: delete the target section,
 * remove checkbox/table references, and renumber subsequent phase references.
 *
 * @param {string} cwd - Working directory path
 * @param {string} phaseNum - The phase number that was removed (as originally specified)
 * @param {boolean} isDecimal - Whether the removed phase was a decimal phase
 * @param {string} normalized - The zero-padded normalized phase number
 */
function updateRoadmapAfterRemoval(cwd, phaseNum, isDecimal, normalized) {
  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  let roadmapContent;
  try {
    roadmapContent = fs.readFileSync(roadmapPath, 'utf-8');
  } catch { return; }

  // Remove the target phase section from roadmap.md.
  // Matches from the phase heading to the next phase heading (or end of file).
  const targetEscaped = escapeRegex(phaseNum);
  const sectionPattern = new RegExp(
    `\\n?#{2,4}\\s*Phase\\s+${targetEscaped}\\s*:[\\s\\S]*?(?=\\n#{2,4}\\s+Phase\\s+\\d|$)`,
    'i'
  );
  roadmapContent = roadmapContent.replace(sectionPattern, '');

  // Remove checkbox list items referencing this phase
  const checkboxPattern = new RegExp(`\\n?-\\s*\\[[ x]\\]\\s*.*Phase\\s+${targetEscaped}[:\\s][^\\n]*`, 'gi');
  roadmapContent = roadmapContent.replace(checkboxPattern, '');

  // Remove progress table rows referencing this phase
  const tableRowPattern = new RegExp(`\\n?\\|\\s*${targetEscaped}\\.?\\s[^|]*\\|[^\\n]*`, 'gi');
  roadmapContent = roadmapContent.replace(tableRowPattern, '');

  // For integer phase removal, renumber all references to subsequent phases.
  // Walk from highest phase number down to removedInt+1, decrementing each by 1.
  // This avoids double-renaming (e.g. 8->7 then 7->6 would break if done ascending).
  if (!isDecimal) {
    const removedInt = parseInt(normalized, 10);

    // Reasonable upper bound for phase numbers
    const maxPhase = 99;
    for (let oldNum = maxPhase; oldNum > removedInt; oldNum--) {
      const newNum = oldNum - 1;
      const oldStr = String(oldNum);
      const newStr = String(newNum);
      const oldPad = oldStr.padStart(2, '0');
      const newPad = newStr.padStart(2, '0');

      // Phase headings: ## Phase 18: or ### Phase 18: -> ## Phase 17:
      roadmapContent = roadmapContent.replace(
        new RegExp(`(#{2,4}\\s*Phase\\s+)${oldStr}(\\s*:)`, 'gi'),
        `$1${newStr}$2`
      );

      // Inline phase references: "Phase 18:" or "Phase 18 " -> "Phase 17:"
      roadmapContent = roadmapContent.replace(
        new RegExp(`(Phase\\s+)${oldStr}([:\\s])`, 'g'),
        `$1${newStr}$2`
      );

      // Plan references in padded form: 18-01 -> 17-01
      roadmapContent = roadmapContent.replace(
        new RegExp(`${oldPad}-(\\d{2})`, 'g'),
        `${newPad}-$1`
      );

      // Progress table row numbers: | 18. -> | 17.
      roadmapContent = roadmapContent.replace(
        new RegExp(`(\\|\\s*)${oldStr}\\.\\s`, 'g'),
        `$1${newStr}. `
      );

      // Depends-on references: "Depends on:** Phase 18" -> "Phase 17"
      roadmapContent = roadmapContent.replace(
        new RegExp(`(Depends on:\\*\\*\\s*Phase\\s+)${oldStr}\\b`, 'gi'),
        `$1${newStr}`
      );
    }
  }

  try { fs.writeFileSync(roadmapPath, roadmapContent, 'utf-8'); } catch { /* best-effort */ }
}

/**
 * Remove a phase directory, renumber subsequent phases, and update ROADMAP/STATE.
 * @param {string} cwd - Working directory path
 * @param {string} targetPhase - Phase number to remove
 * @param {Object} options - Options (force: skip executed-work check)
 * @param {boolean} raw - If true, output raw value instead of JSON
 * @returns {void}
 */
function cmdPhaseRemove(cwd, targetPhase, options, raw) {
  if (!targetPhase) {
    error('phase number required for phase remove');
  }

  const roadmapPath = path.join(planningPath(cwd), ROADMAP_FILE);
  const phasesDir = phasesPath(cwd);
  const force = options.force || false;

  if (!fileAccessible(roadmapPath)) {
    error('roadmap.md not found');
  }

  // Normalize the target
  const normalized = normalizePhaseName(targetPhase);
  const isDecimal = targetPhase.includes('.');

  // Find and validate target directory
  let targetDir = null;
  try {
    const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => entry.name).sort((left, right) => comparePhaseNum(left, right));
    targetDir = dirs.find(dir => dir.startsWith(normalized + '-') || dir === normalized);
  } catch {
    // Phases directory does not exist; targetDir remains null
  }

  // Check for executed work (summary.md files)
  if (targetDir && !force) {
    const targetPath = path.join(phasesDir, targetDir);
    const files = fs.readdirSync(targetPath);
    const summaries = files.filter(isSummaryFile);
    if (summaries.length > 0) {
      error(`Phase ${targetPhase} has ${summaries.length} executed plan(s). Use --force to remove anyway.`);
    }
  }

  // Delete target directory
  let removeWarning = null;
  if (targetDir) {
    const removeResult = removePhaseFromDisk(path.join(phasesDir, targetDir));
    if (!removeResult.removed) {
      removeWarning = removeResult.error;
    }
  }

  // Renumber subsequent phases using the appropriate strategy
  let renamedDirs = [];
  let renamedFiles = [];

  let renameError = null;
  if (isDecimal) {
    // Decimal removal: renumber sibling decimals (e.g., removing 06.2 -> 06.3 becomes 06.2)
    const baseParts = normalized.split('.');
    const baseInt = baseParts[0];
    const removedDecimal = parseInt(baseParts[1], 10);
    const result = renumberDecimalPhases(phasesDir, baseInt, removedDecimal);
    renamedDirs = result.renamedDirs;
    renamedFiles = result.renamedFiles;
    renameError = result.error || null;
  } else {
    // Integer removal: renumber all subsequent integer phases
    const removedInt = parseInt(normalized, 10);
    const result = renumberIntegerPhases(phasesDir, removedInt);
    renamedDirs = result.renamedDirs;
    renamedFiles = result.renamedFiles;
    renameError = result.error || null;
  }

  // Update roadmap.md: remove section and renumber references
  updateRoadmapAfterRemoval(cwd, targetPhase, isDecimal, normalized);

  // Update state.md phase count
  const stateUpdated = updateStateAfterPhaseRemoval(cwd);

  const result = {
    removed: targetPhase,
    directory_deleted: targetDir || null,
    renamed_directories: renamedDirs,
    renamed_files: renamedFiles,
    roadmap_updated: true,
    state_updated: stateUpdated,
  };
  if (renameError) result.rename_warning = renameError;
  if (removeWarning) result.remove_warning = removeWarning;

  output(result, raw);
}

/**
 * Decrement phase count in state.md after a phase is removed.
 * @param {string} cwd - Working directory path
 * @returns {boolean} true if state.md was updated
 */
function updateStateAfterPhaseRemoval(cwd) {
  const statePath = path.join(planningPath(cwd), STATE_FILE);
  const content = readStateSafe(statePath);
  if (content === null) return false;

  let updated = content;
  // Decrement "Total Phases" field
  const totalPattern = /(\*\*Total Phases:\*\*\s*)(\d+)/;
  const totalMatch = updated.match(totalPattern);
  if (totalMatch) {
    updated = updated.replace(totalPattern, `$1${parseInt(totalMatch[2], 10) - 1}`);
  }
  // Decrement "Phase: X of Y" pattern
  const ofPattern = /(\bof\s+)(\d+)(\s*(?:\(|phases?))/i;
  const ofMatch = updated.match(ofPattern);
  if (ofMatch) {
    updated = updated.replace(ofPattern, `$1${parseInt(ofMatch[2], 10) - 1}$3`);
  }
  writeStateMd(statePath, updated, cwd);
  return true;
}

module.exports = {
  removePhaseFromDisk,
  renumberDecimalPhases,
  collectDirsToRenumber,
  renamePhaseDir,
  renumberIntegerPhases,
  updateRoadmapAfterRemoval,
  cmdPhaseRemove,
  updateStateAfterPhaseRemoval,
};
