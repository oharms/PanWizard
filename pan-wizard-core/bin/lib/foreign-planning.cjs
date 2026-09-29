'use strict';
/**
 * Foreign planning-tree detection (reality check RC17 / plan item R15, 2026-09-10).
 *
 * gsd-core (open-gsd/gsd-core, the continuation of Get Shit Done) writes a `.planning/`
 * directory with the same core files PAN's pre-v2.2 layout used — STATE.md, ROADMAP.md,
 * PROJECT.md, REQUIREMENTS.md, MILESTONES.md in uppercase. To PAN's hygiene those read
 * as LEGACY PAN files, and `hygiene clean --apply` would rename another tool's state.
 * `validate health` would call the tree broken; `init new-project` would scaffold PAN
 * files into it. This module answers one question — does this tree belong to another
 * tool? — from POSITIVE markers PAN never writes (FOREIGN_PLANNING_MARKERS in
 * constants.cjs, sourced from gsd-core's docs/USER-GUIDE.md, read 2026-09-10).
 *
 * Rule: foreign when any marker FILE exists (a name, or a name pattern), or at least
 * two marker DIRECTORIES exist, or config.json carries any of the tool's flat dotted
 * keys (PAN nests `workflow: {}`; gsd-core writes `"workflow.discuss_mode"`). A pattern
 * directory holding the file it `requires` counts as file-strength evidence; without
 * that file it is one directory. An unreadable config.json is not evidence.
 * Returns { tool, key, evidence[], coexists } or null. Never throws. `coexists` marks
 * a tool that SHARES the tree (planning-with-files): callers keep working and report
 * it, instead of refusing the tree as another tool's.
 */
const fs = require('fs');
const path = require('path');
const { FOREIGN_PLANNING_MARKERS } = require('./constants.cjs');
const { planningPath } = require('./utils.cjs');

function detectForeignPlanningTree(planningDir) {
  let entries;
  try { entries = fs.readdirSync(planningDir, { withFileTypes: true }); } catch { return null; }
  const names = new Set(entries.map(e => e.name));
  const dirs = new Set(entries.filter(e => e.isDirectory()).map(e => e.name));
  let cfg = null;
  if (names.has('config.json')) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(planningDir, 'config.json'), 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) cfg = parsed;
    } catch { cfg = null; }
  }
  for (const [key, m] of Object.entries(FOREIGN_PLANNING_MARKERS)) {
    const fileHits = m.files.filter(f => names.has(f));
    for (const re of m.filePatterns || []) {
      for (const e of entries) if (!e.isDirectory() && re.test(e.name)) fileHits.push(e.name);
    }
    const dirHits = m.dirs.filter(d => dirs.has(d));
    const strongDirs = [];
    for (const { re, requires } of m.dirPatterns || []) {
      for (const d of [...dirs].sort()) {
        if (!re.test(d)) continue;
        let holds = false;
        try { holds = fs.existsSync(path.join(planningDir, d, requires)); } catch { holds = false; }
        if (holds) strongDirs.push(d);
        else dirHits.push(d);
      }
    }
    const configHits = cfg ? m.configKeys.filter(k => Object.prototype.hasOwnProperty.call(cfg, k)) : [];
    if (fileHits.length > 0 || strongDirs.length > 0 || dirHits.length >= 2 || configHits.length > 0) {
      return {
        tool: m.tool,
        key,
        evidence: [...fileHits, ...strongDirs.map(d => d + '/'), ...dirHits.map(d => d + '/'), ...configHits.map(k => 'config.json:' + k)],
        coexists: m.coexists === true,
      };
    }
  }
  return null;
}

/** Same check, addressed by project cwd (honours --planning-dir / --track). */
function detectForeignPlanningTreeAt(cwd) {
  return detectForeignPlanningTree(planningPath(cwd));
}

module.exports = { detectForeignPlanningTree, detectForeignPlanningTreeAt };
