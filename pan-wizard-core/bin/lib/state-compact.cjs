/**
 * state compact — move closed history out of state.md.
 *
 * state.md sits in CACHEABLE_CONTEXT_FILES, so it is re-read into EVERY agent
 * call. Its section writers only ever append (`sectionBody.trimEnd() + entry`),
 * so the file can only grow: a field project reached 54 KB, of which 30 KB was
 * a June session log, a resolved milestone audit, and three phase closures —
 * roughly 7k tokens of settled history re-read on every call for months. Prompt
 * cache reads outweigh generated tokens by about two orders of magnitude in a
 * PAN project, which makes this file the single largest recurring cost.
 *
 * The rule this module encodes: PAN already knows how to bound its other
 * append-only store (`memory compact`); state.md gets the same treatment.
 *
 * Safety, in order of importance:
 *   1. Nothing is ever deleted. Sections are appended to state-history.md
 *      FIRST, and only then removed from state.md.
 *   2. `state get <section>` can read ANY heading by name, so a section is
 *      archived only when it is unambiguously historical — a dated heading
 *      past the retention window, or one that says "closure". Everything else
 *      stays, including anything unrecognised.
 *   3. A protected list guards the headings PAN itself reads and writes, so
 *      they survive even if a title were to match the historical patterns.
 *   4. Dry-run by default. `--apply` is required to touch either file.
 */

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');
const {
  STATE_FILE,
  STATE_HISTORY_FILE,
  STATE_COMPACT_KEEP_DAYS,
  CHARS_PER_TOKEN,
} = require('./constants.cjs');
const { planningPath, planningRel } = require('./utils.cjs');

/**
 * Headings PAN's own tooling reads or writes. Never archived, whatever else
 * matches — `state.cjs` parses Decisions/Blockers/Session by name, and the
 * remainder are the live working set a resumed session depends on.
 */
const PROTECTED_HEADINGS = [
  /^decisions/i,
  /^accumulated/i,
  /^blockers/i,
  /^concerns/i,
  /^session\b/i,
  /^next action/i,
  /^phase progress/i,
  /^project reference/i,
  /^source authority/i,
  /^toolchain/i,
  /^metrics/i,
  /^current/i,
  /^status/i,
];

/** Marker left in state.md where an archived section used to be. */
const POINTER_PREFIX = '_Archived to ';

/**
 * Body fields that `state.cjs::extractFieldsFromState` reads to REGENERATE the
 * frontmatter on every write. It takes the FIRST `**Field:**` match anywhere in
 * the body, so removing a section that carries one can silently change which
 * value wins — a compaction that quietly rewrites `status:` or `Current Phase`
 * would be exactly the kind of invisible damage this tool must not do.
 *
 * A section carrying any of these is therefore never archived, regardless of
 * how historical its heading looks.
 */
const FRONTMATTER_SOURCE_FIELDS = [
  'Current Phase', 'Current Phase Name', 'Current Plan', 'Total Phases',
  'Total Plans in Phase', 'Status', 'Progress', 'Last Activity',
  'Last Activity Description', 'Stopped At', 'Stopped at', 'Paused At',
];

const FRONTMATTER_SOURCE_RE = new RegExp(
  '\\*\\*(?:' + FRONTMATTER_SOURCE_FIELDS.map(f => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + '):\\*\\*',
  'i'
);

/** A heading that opens with an ISO date: "## 2026-06-04 — Post-milestone session". */
const DATED_HEADING_RE = /^\s*(\d{4}-\d{2}-\d{2})\b/;

/** A heading recording a closed unit of work: "## Phase 3 closure" / "## Phase 3 closed". */
const CLOSURE_HEADING_RE = /\b(closure|closures|closed)\b/i;

/**
 * Split state.md into its preamble and top-level (H2) sections.
 *
 * Only `## ` headings split the file; deeper headings belong to their parent
 * section, because `state.cjs` writes Decisions/Blockers as `###` nested inside
 * an H2 and splitting on those would tear a live section in half.
 *
 * @param {string} content - full state.md text
 * @returns {{preamble: string, sections: Array<{title: string, text: string, start: number}>}}
 */
function splitSections(content) {
  const lines = String(content || '').split(/\r?\n/);
  const heads = [];
  lines.forEach((line, i) => {
    if (/^##(?!#)\s+/.test(line)) heads.push({ i, title: line.replace(/^##\s+/, '').trim() });
  });

  const preamble = lines.slice(0, heads.length ? heads[0].i : lines.length).join('\n');
  const sections = heads.map((h, k) => {
    const end = k + 1 < heads.length ? heads[k + 1].i : lines.length;
    return { title: h.title, text: lines.slice(h.i, end).join('\n'), start: h.i + 1 };
  });
  return { preamble, sections };
}

/**
 * Decide whether one section is settled history.
 *
 * @param {{title: string}} section
 * @param {number} keepDays - dated sections newer than this stay
 * @param {number} now - epoch ms, injectable for tests
 * @returns {{archive: boolean, reason: string}}
 */
function classifySection(section, keepDays, now) {
  const title = section.title || '';
  const text = section.text || '';

  // Already compacted: the section is now just a pointer at its archived body.
  // Without this a closure heading would be re-archived on every run, appending
  // the same pointer to state-history.md forever.
  if (text.includes(POINTER_PREFIX)) {
    return { archive: false, reason: 'already archived — only a pointer remains' };
  }

  if (PROTECTED_HEADINGS.some(re => re.test(title))) {
    return { archive: false, reason: 'protected — PAN reads or writes this section' };
  }

  if (FRONTMATTER_SOURCE_RE.test(section.text || '')) {
    return { archive: false, reason: 'carries a field the frontmatter is rebuilt from — moving it could change state.md metadata' };
  }

  const dated = title.match(DATED_HEADING_RE);
  if (dated) {
    const t = Date.parse(dated[1]);
    if (!Number.isFinite(t)) return { archive: false, reason: 'unparseable date — left in place' };
    const ageDays = Math.floor((now - t) / (24 * 3600 * 1000));
    if (ageDays > keepDays) {
      return { archive: true, reason: `dated section ${ageDays}d old (keep ${keepDays}d)` };
    }
    return { archive: false, reason: `dated section ${ageDays}d old — within the ${keepDays}d window` };
  }

  if (CLOSURE_HEADING_RE.test(title)) {
    return { archive: true, reason: 'closure record — the work it describes is finished' };
  }

  return { archive: false, reason: 'not recognised as history — left in place' };
}

/**
 * Rebuild state.md with the named sections replaced by a pointer.
 *
 * Shared by the planner and the applier so a dry-run reports the exact bytes
 * `--apply` will produce, rather than an estimate that could disagree with it.
 *
 * @param {string} content - current state.md text
 * @param {Set<string>} toArchive - section titles to replace
 * @param {string} stamp - YYYY-MM-DD recorded in each pointer
 * @returns {string} the rebuilt file
 */
function rebuildState(content, toArchive, stamp) {
  const { preamble, sections } = splitSections(content);
  const parts = [preamble.trimEnd()];
  for (const s of sections) {
    parts.push(toArchive.has(s.title)
      ? `## ${s.title}\n\n${POINTER_PREFIX}[${STATE_HISTORY_FILE}](${STATE_HISTORY_FILE}) on ${stamp}._`
      : s.text.trimEnd());
  }
  return parts.filter(Boolean).join('\n\n') + '\n';
}

/**
 * Plan a compaction without touching anything.
 *
 * @param {string} cwd - project root
 * @param {Object} [opts] - {keepDays, now}
 * @returns {Object} plan with per-section verdicts and before/after sizes
 */
function planStateCompaction(cwd, opts = {}) {
  const keepDays = Number.isFinite(Number(opts.keepDays)) && opts.keepDays !== null && opts.keepDays !== undefined
    ? Number(opts.keepDays)
    : STATE_COMPACT_KEEP_DAYS;
  const now = opts.now || Date.now();
  const statePath = planningPath(cwd, STATE_FILE);

  let content;
  try {
    content = fs.readFileSync(statePath, 'utf-8');
  } catch {
    return { found: false, path: planningRel(STATE_FILE), sections: [], archivable: [], keep_days: keepDays };
  }

  const { preamble, sections } = splitSections(content);
  const verdicts = sections.map(s => {
    const c = classifySection(s, keepDays, now);
    return { title: s.title, bytes: s.text.length, archive: c.archive, reason: c.reason };
  });

  let archivable = verdicts.filter(v => v.archive);
  const bytesBefore = content.length;
  // Build the post-compaction text for real rather than estimating it. An
  // estimate that ignores pointer overhead can claim a saving on a file where
  // the pointers cost more than the sections they replace — a dry-run that
  // overstates its own benefit is worse than no dry-run.
  const stamp = new Date(now).toISOString().slice(0, 10);
  let bytesAfter = rebuildState(content, new Set(archivable.map(v => v.title)), stamp).length;

  // The point of compaction is a smaller re-read on every agent call. On a file
  // whose history sections are tiny, the pointers left behind cost more than the
  // bodies they replace — churning state.md to make it BIGGER helps nobody, so
  // stand down and say why.
  if (archivable.length > 0 && bytesAfter >= bytesBefore) {
    for (const v of verdicts) {
      if (!v.archive) continue;
      v.archive = false;
      v.reason = 'archiving it would not shrink state.md — the pointer costs more than the section';
    }
    archivable = [];
    bytesAfter = bytesBefore;
  }

  return {
    found: true,
    path: planningRel(STATE_FILE),
    history_path: planningRel(STATE_HISTORY_FILE),
    keep_days: keepDays,
    sections: verdicts,
    archivable,
    bytes_before: bytesBefore,
    bytes_after: bytesAfter,
    tokens_before: Math.ceil(bytesBefore / CHARS_PER_TOKEN),
    tokens_after: Math.ceil(bytesAfter / CHARS_PER_TOKEN),
    tokens_saved_per_call: Math.max(0, Math.ceil((bytesBefore - bytesAfter) / CHARS_PER_TOKEN)),
  };
}

/**
 * Apply a compaction. Archive is written BEFORE state.md is rewritten, so an
 * interruption can only ever leave a duplicate — never a loss.
 *
 * @param {string} cwd - project root
 * @param {Object} [opts] - {keepDays, now, apply}
 * @returns {Object} result
 */
function compactState(cwd, opts = {}) {
  const plan = planStateCompaction(cwd, opts);
  if (!plan.found) return { ...plan, applied: false, dry_run: !opts.apply };
  if (!opts.apply || plan.archivable.length === 0) {
    return { ...plan, applied: false, dry_run: !opts.apply, archived: [] };
  }

  const statePath = planningPath(cwd, STATE_FILE);
  const historyPath = planningPath(cwd, STATE_HISTORY_FILE);
  const content = fs.readFileSync(statePath, 'utf-8');
  const { sections } = splitSections(content);
  const now = opts.now || Date.now();
  const stamp = new Date(now).toISOString().slice(0, 10);

  const toArchive = new Set(plan.archivable.map(v => v.title));
  const archivedText = sections.filter(s => toArchive.has(s.title)).map(s => s.text.trimEnd()).join('\n\n');

  // 1. Append to history FIRST, so an interruption can only ever duplicate.
  //
  //    The preamble is created with an exclusive open rather than an
  //    existsSync check. Check-then-write is a time-of-check/time-of-use race
  //    (CWE-367): two compactions running together would each see "absent" and
  //    each prepend a preamble. `wx` makes creation atomic — EEXIST simply
  //    means someone else won, which is the outcome we wanted anyway.
  const preamble = `# State history\n\nSections compacted out of ${STATE_FILE} by \`pan-tools state compact\`.\n`
    + 'They are kept verbatim and are no longer re-read into agent context.\n';
  try {
    fs.writeFileSync(historyPath, preamble, { flag: 'wx', encoding: 'utf-8' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
  }
  fs.appendFileSync(historyPath,
    `\n\n<!-- compacted from ${STATE_FILE} on ${stamp} -->\n${archivedText}\n`, 'utf-8');

  // 2. Only now rewrite state.md, replacing each archived section with a pointer.
  const next = rebuildState(content, toArchive, stamp);

  const { writeStateMd } = require('./state.cjs');
  writeStateMd(statePath, next, cwd);

  return {
    ...plan,
    applied: true,
    dry_run: false,
    archived: plan.archivable.map(v => v.title),
    bytes_after: next.length,
    tokens_after: Math.ceil(next.length / CHARS_PER_TOKEN),
    tokens_saved_per_call: Math.max(0, Math.ceil((plan.bytes_before - next.length) / CHARS_PER_TOKEN)),
  };
}

/** CLI wrapper for `state compact`. */
function cmdStateCompact(cwd, opts, raw) {
  const result = compactState(cwd, opts);
  if (!result.found) {
    error(`${result.path} not found — nothing to compact`);
    return;
  }
  if (!raw) return output(result, false);

  const lines = [];
  lines.push(result.applied
    ? `state compact — APPLIED (${result.archived.length} section(s) archived)`
    : `state compact — DRY-RUN (pass --apply to execute)`);
  lines.push(`  ${result.path}: ${(result.bytes_before / 1024).toFixed(1)} KB (~${result.tokens_before} tokens) re-read on every agent call`);
  for (const s of result.sections) {
    lines.push(`   ${s.archive ? '→' : '·'} ${(s.bytes / 1024).toFixed(1).padStart(6)} KB  ${s.title.slice(0, 54)}`);
    lines.push(`        ${s.reason}`);
  }
  if (result.archivable.length === 0) {
    lines.push('  Nothing to compact — no settled history past the retention window.');
  } else {
    lines.push(`  → ${result.history_path}`);
    lines.push(`  after: ~${result.tokens_after} tokens (saves ~${result.tokens_saved_per_call} tokens per agent call)`);
  }
  output(result, true, lines.join('\n'));
}

module.exports = {
  splitSections,
  classifySection,
  planStateCompaction,
  compactState,
  cmdStateCompact,
  PROTECTED_HEADINGS,
};
