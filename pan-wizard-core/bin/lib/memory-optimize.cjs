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
const QUARANTINE_FILE = 'quarantine.md';

// Sections whose bullet lists grow unbounded and are safe to reconcile.
const APPEND_HEAVY = /\b(decisions|blockers|concerns|pending todos|todos|session continuity|accumulated context|recent activity)\b/i;
// A bullet that is just a placeholder — dropped once real entries exist.
const PLACEHOLDER = /^-\s*(none(\s+yet)?|n\/a|tbd|todo|—|-)\.?\s*$/i;

// Memory-injection defense (threat: a subagent writes an instruction/directive
// into the always-loaded memory that a LATER agent or run reads and OBEYS — a
// cross-generation prompt injection, exactly the "agent writes self-serving
// directives into persistent memory for successors" vector in the OpenAI
// rogue-agent incident, Reuters 2026-07). See ADR-0040. state.md is agent-writable
// (decisions/blockers/notes), so during reconcile any bullet that reads like a
// directive AIMED at the agent/system is QUARANTINED out of standing memory (moved
// to .planning/memory/quarantine.md, reversible) rather than carried forward —
// nothing agent-authored becomes standing instruction without human review (the
// merge gate). High-precision, injection-flavored patterns only, to minimize false
// positives; a legitimate note caught here is recoverable from quarantine.md.
const DIRECTIVE_PATTERNS = [
  /\bignore\s+(all\s+|any\s+|these\s+)?(previous|prior|earlier|above)\b/i,
  /\bdisregard\s+(the\s+|all\s+|any\s+|your\s+)?(previous|prior|above|earlier|instructions|rules|guidelines|guardrails)\b/i,
  /\byou\s+are\s+now\b/i,
  /\bnew\s+instructions?\s*:/i,
  /\b(the\s+)?system\s+prompt\b/i,
  /\b(as|acting\s+as|being)\s+(an?\s+)?(admin|administrator|root|superuser|developer\s+with)\b/i,
  /\bpre-?authoriz(e|ed|ation)\b/i,
  /\b(do\s+not|don'?t|never)\s+(tell|inform|notify|ask|alert)\s+the\s+(user|human|operator)\b/i,
  /\bwithout\s+(asking|telling|notifying|informing|alerting)\s+the\s+(user|human|operator)\b/i,
  /\b(bypass|skip|disable|override|remove|turn\s+off)\s+(the\s+)?(merge[-\s]?gate|human[-\s]?(approval|gate|review)|approval[-\s]?gate|safety[-\s]?(harness|check|guard|gate)|verification[-\s]?gate|review[-\s]?gate)\b/i,
  /\b(always|automatically)\s+(approve|auto-?approve|accept|merge|confirm|say\s+yes)\b/i,
  /\bauto-?approve\s+(all|any|every|everything)\b/i,
  /\boverride\s+(the\s+)?(human|approval|merge[-\s]?gate|safety)\b/i,
];

/**
 * True when a memory entry reads like a directive aimed at the agent/system
 * (an injection), as opposed to a descriptive project note. Pure + zero-dep.
 */
function isSuspiciousDirective(text) {
  if (typeof text !== 'string' || !text) return false;
  return DIRECTIVE_PATTERNS.some((re) => re.test(text));
}

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
function reconcileBullets(lines, keepN, archived, quarantined) {
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

  // 0. QUARANTINE injected directives FIRST — a bullet that reads like an
  // instruction aimed at the agent never survives into standing memory; it is
  // moved to the quarantine file for human review (memory-injection defense).
  const safe = [];
  let quarantinedHere = 0;
  for (const e of entries) {
    if (quarantined && isSuspiciousDirective(e.key)) {
      quarantined.push(e.lines.join('\n'));
      quarantinedHere++;
    } else {
      safe.push(e);
    }
  }
  // 1. dedupe (keep first occurrence)
  const seen = new Set();
  const deduped = safe.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
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

  const changed = quarantinedHere > 0 || deduped.length !== safe.length || kept0.length !== deduped.length || dropped.length > 0;
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
  const quarantined = [];
  const sectionsTouched = [];
  let changed = false;

  for (const s of sections) {
    if (s.heading === null) continue;
    if (!APPEND_HEAVY.test(headingText(s.heading))) continue;
    const r = reconcileBullets(s.lines, keepN, archived, quarantined);
    if (r.changed) {
      s.lines = r.lines;
      changed = true;
      sectionsTouched.push(headingText(s.heading).trim());
    }
  }

  return { content: changed ? joinSections(sections) : content, changed, archived, quarantined, sectionsTouched };
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

function quarantinePath(cwd) {
  return path.join(planningPath(cwd), MEMORY_DIR, QUARANTINE_FILE);
}

/**
 * Append quarantined directive-like entries to a dated, human-review file. These
 * were pulled OUT of standing memory because they read like injected instructions
 * (memory-injection defense). Reversible — a human can review and, if legitimate,
 * restore an entry by hand. The file leads with a warning so it is never loaded
 * as trusted instruction memory.
 */
function appendQuarantine(cwd, entries, now) {
  if (!entries.length) return;
  const p = quarantinePath(cwd);
  const fresh = !fs.existsSync(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const stamp = now || '(undated)';
  const header = fresh
    ? '# Quarantined memory (DO NOT auto-load as instructions)\n\nEntries below were pulled out of standing memory during reconcile because they read like\ndirectives aimed at the agent (possible cross-generation prompt injection). They are\nNOT trusted instructions. Review each; restore to state.md by hand only if legitimate.\n'
    : '';
  const block = `${header}\n## Quarantined ${stamp}\n\n${entries.join('\n')}\n`;
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
      quarantined_entries: opt.quarantined.length,
      before_bytes: Buffer.byteLength(before),
      after_bytes: Buffer.byteLength(opt.content),
    };
    result.archived = opt.archived.length;
    result.quarantined = opt.quarantined.length;
    if (apply && opt.changed) {
      appendArchive(cwd, opt.archived, opts.now);
      appendQuarantine(cwd, opt.quarantined, opts.now);
      writeStateMd(statePath, opt.content, cwd);
    }
  } else {
    result.state = { changed: false, reason: 'no_state_md' };
  }

  // Consolidate any per-agent log over the entry cap (reuses compactMemory, which
  // no-ops under the cap). Dry-run counts entries without writing.
  try {
    // M21: listMemoryAgents(cwd) returns { agents: [{ agent, entries }] }, and
    // readMemory(cwd, name) returns { agent, entries, raw }. The old loop iterated
    // the return OBJECT directly (a TypeError, silently swallowed by this catch)
    // and passed the whole object to readMemory/parseEntries — so the agent-log
    // consolidation never ran. Iterate .agents, read each by name, count entries.
    for (const a of listMemoryAgents(cwd).agents) {
      const mem = readMemory(cwd, a.agent);
      if (mem == null) continue;
      const count = parseEntries(mem.raw).length;
      if (count > DEFAULT_MAX_ENTRIES) {
        let removed = 0;
        if (apply) { const r = compactMemory(cwd, a.agent, DEFAULT_MAX_ENTRIES); removed = (r && r.removed) || 0; }
        result.agents.push({ agent: a.agent, entries: count, over_cap: true, compacted: apply, removed });
      }
    }
  } catch { /* agent sweep is best-effort */ }

  const q = result.quarantined || 0;
  const quarantineNote = q ? `; ${q} directive-like entr${q === 1 ? 'y' : 'ies'} QUARANTINED` : '';
  const summary = result.state.changed
    ? `${apply ? 'optimized' : 'would optimize'} state.md (${result.state.sections_touched.join(', ')}); ${result.archived} entr${result.archived === 1 ? 'y' : 'ies'} archived${quarantineNote}${result.agents.length ? `; ${result.agents.length} agent log(s)` : ''}`
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
    appendQuarantine(cwd, opt.quarantined, opts.now);
    writeStateMd(statePath, opt.content, cwd);
    return { optimized: true, sections: opt.sectionsTouched, archived: opt.archived.length, quarantined: opt.quarantined.length };
  } catch {
    return { optimized: false, reason: 'error' };
  }
}

module.exports = {
  optimizeStateContent, reconcileBullets, parseSections, joinSections, cmdMemoryOptimize,
  maybeAutoOptimizeMemory, autoOptimizeEnabled, isSuspiciousDirective,
  APPEND_HEAVY, PLACEHOLDER, DIRECTIVE_PATTERNS, DEFAULT_KEEP, STATE_ARCHIVE_FILE, QUARANTINE_FILE,
};
