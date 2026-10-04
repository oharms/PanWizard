'use strict';

/**
 * roadmap compact — move shipped phases' detail out of roadmap.md (memory optimisation O3).
 *
 * roadmap.md only grows: every phase adds a detail section (goal, success criteria,
 * plan list, notes) and nothing ever takes one away. A 54-phase field project's
 * roadmap reached 476 KB, about 119k tokens. Phase agents now read a slice of it
 * (`roadmap slice`, O2), but the roadmapper, the milestone workflows and people
 * still read it whole. This bounds it the way `state compact` bounds state.md
 * (ADR-0044).
 *
 * Safety, in order of importance:
 *   1. Nothing is deleted. Sections are appended to roadmap-history.md FIRST, and
 *      only then shortened in roadmap.md, so an interruption can only duplicate.
 *   2. Only a shipped phase moves: its checklist line is ticked, it is not the
 *      current phase in state.md, and it is not one of the `keep` most recently
 *      shipped phases (default 2), which the next phase's planning may lean on.
 *   3. A stub stays: the heading and the Goal, Depends on and Requirements lines,
 *      so goal lookups, the dependency goals in a slice and `roadmap analyze` still
 *      read the phase.
 *   4. A section already compacted is never compacted again.
 *   5. Dry-run by default; `--apply` writes. Declines when nothing would shrink.
 *   6. Parsed on LF and written back in the file's own line ending.
 */

const fs = require('fs');
const path = require('path');
const { ROADMAP_FILE, STATE_FILE, CHARS_PER_TOKEN } = require('./constants.cjs');
const { planningPath, planningRel } = require('./utils.cjs');
const { output, safeReadFile, toLf, dominantEol, withEol } = require('./core.cjs');

const ROADMAP_HISTORY_FILE = 'roadmap-history.md';
const ROADMAP_COMPACT_KEEP = 2;
/** The line a stub carries in place of the section's body. */
const STUB_MARK = '_Shipped; the full section is in [roadmap-history.md]';

const PHASE_HEADING_RE = /^(#{2,4})\s*Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:\s*(.+?)\s*$/;
const KEPT_LINE_RE = /^\*\*(Goal|Depends on|Requirements)(?::\*\*|\*\*:)/i;
const unpad = (n) => String(n).replace(/^0+(?=\d)/, '');

/**
 * The phase detail sections of roadmap.md (LF text): each runs from its heading to
 * the next heading at its level or above, or to an HTML block boundary such as a
 * milestone's `</details>`, so a trailing progress table never rides along.
 * Trailing blank lines stay outside the section.
 */
function phaseSections(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(PHASE_HEADING_RE);
    if (!m) continue;
    const level = m[1].length;
    let end = i + 1;
    for (; end < lines.length; end++) {
      const h = lines[end].match(/^(#{1,6})\s/);
      if (h && h[1].length <= level) break;
      if (/^\s*<\/?details\b/i.test(lines[end])) break;
    }
    let last = end;
    while (last > i + 1 && !lines[last - 1].trim()) last--;
    out.push({ start: i, end: last, number: unpad(m[2]), title: m[3], heading: lines[i] });
  }
  return out;
}

/** Phase numbers whose checklist line is ticked (`- [x] **Phase 3: …`). */
function shippedPhases(lines) {
  const s = new Set();
  for (const l of lines) {
    const m = l.match(/^\s*-\s*\[[xX]\]\s*\*{0,2}Phase\s+(\d+[A-Z]?(?:\.\d+)*)\s*:/);
    if (m) s.add(unpad(m[1]));
  }
  return s;
}

/** The current phase named in state.md, or null. */
function currentPhase(stateText) {
  const t = toLf(stateText || '');
  const m = t.match(/\*\*Current Phase:\*\*\s*([0-9]+[A-Z]?(?:\.[0-9]+)*)/i) || t.match(/^current_phase:\s*"?([0-9]+[A-Z]?(?:\.[0-9]+)*)/m);
  return m ? unpad(m[1]) : null;
}

/** The stub left in roadmap.md for an archived section. */
function stubFor(sectionLines, stamp) {
  const kept = [];
  const seen = new Set();
  for (const l of sectionLines.slice(1)) {
    const m = l.match(KEPT_LINE_RE);
    if (m && !seen.has(m[1].toLowerCase())) { seen.add(m[1].toLowerCase()); kept.push(l); }
  }
  return [sectionLines[0], ...kept, '', `${STUB_MARK}(${ROADMAP_HISTORY_FILE}) (compacted ${stamp})._`];
}

/**
 * Pure: plan (and build) a compaction of roadmap.md text.
 * @param {string} roadmap - roadmap.md content
 * @param {{keep?: number, current?: string|null, now?: number}} [opts]
 * @returns {{sections: Array, archivable: Array, content: string, archivedText: string, bytes_before: number, bytes_after: number}}
 */
function planRoadmapCompaction(roadmap, opts = {}) {
  const keep = Number.isInteger(opts.keep) && opts.keep >= 0 ? opts.keep : ROADMAP_COMPACT_KEEP;
  const eol = dominantEol(roadmap);
  const lines = toLf(roadmap).split('\n');
  const shipped = shippedPhases(lines);
  const sections = phaseSections(lines);
  const stamp = new Date(opts.now || Date.now()).toISOString().slice(0, 10);

  const isStub = (s) => lines.slice(s.start, s.end).some(l => l.startsWith(STUB_MARK));
  const candidates = sections.filter(s => shipped.has(s.number) && !isStub(s) && s.number !== opts.current);
  const keepSet = new Set(candidates.slice(Math.max(0, candidates.length - keep)).map(s => s.start));

  const verdicts = sections.map(s => {
    let archive = false;
    let reason;
    if (isStub(s)) reason = 'already compacted';
    else if (!shipped.has(s.number)) reason = 'not shipped — its checklist line is not ticked';
    else if (s.number === opts.current) reason = 'the current phase in state.md';
    else if (keepSet.has(s.start)) reason = `one of the ${keep} most recently shipped phases`;
    else { archive = true; reason = 'shipped'; }
    return { phase: s.number, title: s.title, bytes: lines.slice(s.start, s.end).join('\n').length, archive, reason, start: s.start, end: s.end };
  });

  const toArchive = verdicts.filter(v => v.archive);
  const next = [];
  let cursor = 0;
  for (const v of toArchive) {
    next.push(...lines.slice(cursor, v.start), ...stubFor(lines.slice(v.start, v.end), stamp));
    cursor = v.end;
  }
  next.push(...lines.slice(cursor));
  const content = withEol(next.join('\n'), eol);
  const archivedText = toArchive.map(v => lines.slice(v.start, v.end).join('\n')).join('\n\n');

  let archivable = toArchive.map(({ start, end, ...rest }) => rest);
  let after = content.length;
  // A stub on a tiny section can cost more than the section: decline rather than
  // churn roadmap.md to make it bigger.
  if (archivable.length && after >= roadmap.length) {
    for (const v of verdicts) if (v.archive) { v.archive = false; v.reason = 'archiving it would not shrink roadmap.md'; }
    archivable = [];
    after = roadmap.length;
  }
  return {
    sections: verdicts.map(({ start, end, ...rest }) => rest),
    archivable,
    content: archivable.length ? content : roadmap,
    archivedText: archivable.length ? archivedText : '',
    bytes_before: roadmap.length,
    bytes_after: after,
    stamp,
  };
}

/**
 * Plan or apply `roadmap compact` for a project. Archive is written BEFORE
 * roadmap.md is rewritten, so an interruption can only ever leave a duplicate.
 * @param {string} cwd
 * @param {{apply?: boolean, keep?: number, now?: number}} [opts]
 */
function compactRoadmap(cwd, opts = {}) {
  const roadmapPath = planningPath(cwd, ROADMAP_FILE);
  const roadmap = safeReadFile(roadmapPath);
  if (roadmap == null) return { found: false, path: planningRel(ROADMAP_FILE), archivable: [], applied: false };
  const current = currentPhase(safeReadFile(planningPath(cwd, STATE_FILE)));
  const plan = planRoadmapCompaction(roadmap, { keep: opts.keep, current, now: opts.now });
  const result = {
    found: true,
    path: planningRel(ROADMAP_FILE),
    history_path: planningRel(ROADMAP_HISTORY_FILE),
    keep: Number.isInteger(opts.keep) && opts.keep >= 0 ? opts.keep : ROADMAP_COMPACT_KEEP,
    current_phase: current,
    sections: plan.sections,
    archivable: plan.archivable,
    bytes_before: plan.bytes_before,
    bytes_after: plan.bytes_after,
    tokens_before: Math.ceil(plan.bytes_before / CHARS_PER_TOKEN),
    tokens_after: Math.ceil(plan.bytes_after / CHARS_PER_TOKEN),
    applied: false,
    dry_run: !opts.apply,
  };
  if (!opts.apply || !plan.archivable.length) return result;

  // 1. History first. The preamble is created with an exclusive open (no
  //    check-then-write race); appends follow the history file's own line ending.
  const historyPath = planningPath(cwd, ROADMAP_HISTORY_FILE);
  const preamble = `# Roadmap history\n\nPhase sections compacted out of ${ROADMAP_FILE} by \`pan-tools roadmap compact\`.\n`
    + 'They are kept verbatim; roadmap.md keeps a stub with each heading, goal, dependencies and requirements.\n';
  try {
    fs.writeFileSync(historyPath, preamble, { flag: 'wx', encoding: 'utf-8' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  const histEol = dominantEol(safeReadFile(historyPath) || '');
  fs.appendFileSync(historyPath, withEol(`\n\n<!-- compacted from ${ROADMAP_FILE} on ${plan.stamp} -->\n${plan.archivedText}\n`, histEol), 'utf-8');

  // 2. Only now shorten roadmap.md.
  fs.writeFileSync(roadmapPath, plan.content, 'utf-8');
  return { ...result, applied: true, dry_run: false, archived: plan.archivable.map(v => v.phase) };
}

/** How many sections a compaction would archive now — hygiene offers the fix only then. */
function roadmapCompactionAvailable(cwd) {
  try { return compactRoadmap(cwd).archivable.length; } catch { return 0; }
}

/** `roadmap compact [--apply] [--keep N]` */
function cmdRoadmapCompact(cwd, opts, raw) {
  const r = compactRoadmap(cwd, opts);
  if (!r.found) { output(r, raw, 'roadmap.md not found'); return; }
  const saved = Math.max(0, r.tokens_before - r.tokens_after);
  const summary = r.applied
    ? `archived ${r.archived.length} phase section(s) to ${r.history_path}; roadmap.md ~${saved} tokens smaller`
    : r.archivable.length
      ? `would archive ${r.archivable.length} phase section(s) (phases ${r.archivable.map(v => v.phase).join(', ')}); roadmap.md ~${saved} tokens smaller — rerun with --apply`
      : 'nothing to compact — no shipped phase past the most recent ones';
  output(r, raw, summary);
}

module.exports = {
  ROADMAP_HISTORY_FILE,
  ROADMAP_COMPACT_KEEP,
  planRoadmapCompaction,
  compactRoadmap,
  roadmapCompactionAvailable,
  cmdRoadmapCompact,
};
