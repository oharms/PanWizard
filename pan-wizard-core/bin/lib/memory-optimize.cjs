'use strict';

/**
 * PAN memory optimize (A1) — trim the append-heavy tiers so the always-loaded
 * project memory stays small, per the memory-management research:
 *   - reconcile on write (dedupe / invalidate / consolidate), NEVER blind-append
 *   - retain by importance, not FIFO (never drop the tail blindly)
 *   - reversible: overflow is ARCHIVED (dated), never hard-deleted; git keeps the trace
 *   - idempotent: re-running an already-lean file is a no-op (zero git churn)
 *
 * SAFETY: this only touches TOP-LEVEL BULLET LISTS inside recognized append-heavy
 * sections (Decisions / Blockers / Concerns / Todos / Session Continuity). Tables,
 * prose, sub-bullets, frontmatter, and every other section are preserved byte-for-byte.
 * The command is dry-run by default (`--apply` to write). `optimizeStateContent` is a
 * pure function of the content, so the whole reconcile is unit-testable in isolation.
 */

const fs = require('fs');
const path = require('path');
const { output, safeReadFile } = require('./core.cjs');
const { planningPath } = require('./utils.cjs');
const { writeStateMd } = require('./state.cjs');
const { readMemory, parseEntries, listMemoryAgents, compactMemory, DEFAULT_MAX_ENTRIES, MEMORY_DIR } = require('./memory.cjs');

const DEFAULT_KEEP = 12;            // recent bullets kept inline per section
const STATE_ARCHIVE_FILE = 'state-archive.md';

// Sections whose bullet lists grow unbounded and are safe to reconcile.
const APPEND_HEAVY = /\b(decisions|blockers|concerns|pending todos|todos|session continuity|accumulated context|recent activity)\b/i;
// A bullet that is just a placeholder — dropped once real entries exist.
const PLACEHOLDER = /^-\s*(none(\s+yet)?|n\/a|tbd|todo|—|-)\.?\s*$/i;

const isHeading = (l) => /^#{1,6}\s+\S/.test(l);
const headingText = (l) => (l.match(/^#{1,6}\s+(.*)$/) || [, ''])[1];
const isBullet = (l) => /^-\s+\S/.test(l);
const isIndented = (l) => /^\s+\S/.test(l);

/** Split content into ordered blocks: an optional heading + the lines under it. */
function parseSections(content) {
  const sections = [];
  let cur = { heading: null, lines: [] };
  for (const line of content.split('\n')) {
    if (isHeading(line)) {
      sections.push(cur);
      cur = { heading: line, lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  sections.push(cur);
  return sections;
}

/** Reassemble sections into content byte-for-byte when nothing changed. */
function joinSections(sections) {
  return sections
    .flatMap((s) => (s.heading !== null ? [s.heading, ...s.lines] : s.lines))
    .join('\n');
}

/**
 * Reconcile the bullet list inside one section body: dedupe, strip placeholders,
 * and cap to the last `keepN` entries. An "entry" is a top-level `- ` bullet plus
 * its indented continuation lines, so a bullet is never orphaned from its detail.
 * Overflow entries are pushed to `archived`. Returns { lines, changed }.
 */
function reconcileBullets(lines, keepN, archived) {
  const firstB = lines.findIndex(isBullet);
  if (firstB === -1) return { lines, changed: false };

  const pre = lines.slice(0, firstB);
  const rest = lines.slice(firstB);
  const entries = [];
  let i = 0;
  for (; i < rest.length; ) {
    const l = rest[i];
    if (isBullet(l)) {
      const eLines = [l];
      i++;
      while (i < rest.length && isIndented(rest[i])) { eLines.push(rest[i]); i++; }
      entries.push({ key: eLines.join('\n').trim(), lines: eLines });
    } else if (l.trim() === '') {
      i++; // blank between bullets — normalized away
    } else {
      break; // trailer prose begins — stop grouping
    }
  }
  const trailer = rest.slice(i);

  // 1. dedupe (keep first occurrence)
  const seen = new Set();
  const deduped = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  // 2. strip placeholders once real entries exist
  const real = deduped.filter((e) => !PLACEHOLDER.test(e.key));
  const kept0 = real.length ? real : deduped;
  // 3. cap to the most-recent keepN (bullets are appended, so the tail is newest)
  let kept = kept0;
  const dropped = [];
  if (kept0.length > keepN) {
    dropped.push(...kept0.slice(0, kept0.length - keepN));
    kept = kept0.slice(-keepN);
  }
  for (const d of dropped) archived.push(d.lines.join('\n'));

  const changed = deduped.length !== entries.length || kept0.length !== deduped.length || dropped.length > 0;
  const newLines = [...pre, ...kept.flatMap((e) => e.lines), ...trailer];
  // Preserve the section's trailing blank line (the blank that separates it from
  // the next heading) so reconciling never collapses two sections together.
  const endsBlank = lines.length > 0 && lines[lines.length - 1].trim() === '';
  if (endsBlank && (newLines.length === 0 || newLines[newLines.length - 1].trim() !== '')) newLines.push('');
  return { lines: newLines, changed };
}

/**
 * Pure reconcile of state.md content.
 * @returns {{content:string, changed:boolean, archived:string[], sectionsTouched:string[]}}
 */
function optimizeStateContent(content, opts = {}) {
  const keepN = Number.isFinite(opts.keep) && opts.keep > 0 ? opts.keep : DEFAULT_KEEP;
  const sections = parseSections(content);
  const archived = [];
  const sectionsTouched = [];
  let changed = false;

  for (const s of sections) {
    if (s.heading === null) continue;
    if (!APPEND_HEAVY.test(headingText(s.heading))) continue;
    const before = archived.length;
    const r = reconcileBullets(s.lines, keepN, archived);
    if (r.changed) {
      s.lines = r.lines;
      changed = true;
      sectionsTouched.push(headingText(s.heading).trim());
    }
    void before;
  }

  return { content: changed ? joinSections(sections) : content, changed, archived, sectionsTouched };
}

// ─── Command ────────────────────────────────────────────────────────────────

function archivePath(cwd) {
  return path.join(planningPath(cwd), MEMORY_DIR, STATE_ARCHIVE_FILE);
}

/** Append trimmed entries to the dated, append-only state archive (reversible). */
function appendArchive(cwd, entries, now) {
  if (!entries.length) return;
  const p = archivePath(cwd);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = now || '(undated)';
  const block = `\n## Archived ${stamp}\n\n${entries.map((e) => e).join('\n')}\n`;
  fs.appendFileSync(p, block, 'utf-8');
}

/**
 * `memory optimize [--apply] [--keep N]` — reconcile state.md + consolidate
 * over-budget agent logs. Dry-run by default: reports what WOULD change.
 */
function cmdMemoryOptimize(cwd, opts = {}, raw) {
  const apply = !!opts.apply;
  const keep = opts.keep;
  const statePath = path.join(planningPath(cwd), 'state.md');
  const before = safeReadFile(statePath);

  const result = { apply, state: { changed: false }, agents: [], archived: 0 };

  if (before != null) {
    const opt = optimizeStateContent(before, { keep });
    result.state = {
      changed: opt.changed,
      sections_touched: opt.sectionsTouched,
      archived_entries: opt.archived.length,
      before_bytes: Buffer.byteLength(before),
      after_bytes: Buffer.byteLength(opt.content),
    };
    result.archived = opt.archived.length;
    if (apply && opt.changed) {
      appendArchive(cwd, opt.archived, opts.now);
      writeStateMd(statePath, opt.content, cwd);
    }
  } else {
    result.state = { changed: false, reason: 'no_state_md' };
  }

  // Consolidate any per-agent log over the entry cap (reuses compactMemory, which
  // no-ops under the cap). Dry-run counts entries without writing.
  try {
    for (const a of listMemoryAgents(cwd)) {
      const rawMem = readMemory(cwd, a);
      if (rawMem == null) continue;
      const count = parseEntries(rawMem).length;
      if (count > DEFAULT_MAX_ENTRIES) {
        let removed = 0;
        if (apply) { const r = compactMemory(cwd, a, DEFAULT_MAX_ENTRIES); removed = (r && r.removed) || 0; }
        result.agents.push({ agent: a, entries: count, over_cap: true, compacted: apply, removed });
      }
    }
  } catch { /* agent sweep is best-effort */ }

  const summary = result.state.changed
    ? `${apply ? 'optimized' : 'would optimize'} state.md (${result.state.sections_touched.join(', ')}); ${result.archived} entr${result.archived === 1 ? 'y' : 'ies'} archived${result.agents.length ? `; ${result.agents.length} agent log(s)` : ''}`
    : `state.md already lean${result.agents.length ? `; ${result.agents.length} agent log(s) over budget` : ''} — nothing to do`;
  output(result, raw, summary);
}

// ─── Auto-optimize (A3) — flow-embedded reconcile ────────────────────────────

/**
 * Whether auto-optimize is enabled for this project. Reads config.json directly
 * (loadConfig doesn't surface the memory block) and defaults to ON — the point
 * of the feature is that reconcile happens automatically, not by hand. Set
 * `memory.auto_optimize: false` in .planning/config.json to opt out. Absent or
 * malformed config → enabled.
 */
function autoOptimizeEnabled(cwd) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(planningPath(cwd), 'config.json'), 'utf-8'));
    return !(raw.memory && raw.memory.auto_optimize === false);
  } catch {
    return true;
  }
}

/**
 * Reconcile state.md as an embedded step of a flow (focus checkpoint, normal
 * session record). Best-effort and side-effect-light: honors the config gate,
 * is a true no-op when state.md is already lean (zero git churn), archives any
 * overflow, and NEVER throws into the calling flow. Returns a small status.
 * @returns {{optimized:boolean, reason?:string, sections?:string[], archived?:number}}
 */
function maybeAutoOptimizeMemory(cwd, opts = {}) {
  try {
    if (!autoOptimizeEnabled(cwd)) return { optimized: false, reason: 'disabled' };
    const statePath = path.join(planningPath(cwd), 'state.md');
    const before = safeReadFile(statePath);
    if (before == null) return { optimized: false, reason: 'no_state_md' };
    const opt = optimizeStateContent(before, { keep: opts.keep });
    if (!opt.changed) return { optimized: false, reason: 'clean' };
    appendArchive(cwd, opt.archived, opts.now);
    writeStateMd(statePath, opt.content, cwd);
    return { optimized: true, sections: opt.sectionsTouched, archived: opt.archived.length };
  } catch {
    return { optimized: false, reason: 'error' };
  }
}

module.exports = {
  optimizeStateContent, reconcileBullets, parseSections, joinSections, cmdMemoryOptimize,
  maybeAutoOptimizeMemory, autoOptimizeEnabled,
  APPEND_HEAVY, PLACEHOLDER, DEFAULT_KEEP, STATE_ARCHIVE_FILE,
};
