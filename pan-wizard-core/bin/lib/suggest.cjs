'use strict';

/**
 * Command suggestions for unknown invocations — "did you mean …".
 *
 * ─── WHY ────────────────────────────────────────────────────────────────────
 *
 * An external harness ledger (2026-08-15) recorded `pan-tools trace …` **18
 * times** across three projects — the single most-repeated agent behaviour it
 * had seen. PAN refused correctly every time:
 *
 *     Error: Unknown command: trace. Run pan-tools --help to see available commands.
 *
 * The docs were investigated and cleared: `tests/doc-command-surface.test.cjs`
 * passes, and no shipped surface teaches the bare form. So no prose change could
 * explain those 18 sightings, and none would prevent the 19th.
 *
 * What PAN *can* fix is the RECOVERY. `trace` is not a nonsense token — it is a
 * real subcommand sitting one namespace away, under `optimize`. Answering
 * "unknown, go read the list of sixty commands" throws that away and costs a
 * round trip. Naming the correct form converts a dead end into a self-correction,
 * and it does so whatever made the caller type it — which matters precisely
 * because the cause could not be established.
 *
 * ─── HOW IT STAYS TRUE ──────────────────────────────────────────────────────
 *
 * The group→subcommand index is NOT hand-maintained. It is parsed from the
 * dispatcher's own `Unknown <group> subcommand. Available: …` error strings,
 * which are load-bearing — they are what a user sees — so they cannot rot
 * quietly. This is the same trick `tests/doc-command-surface.test.cjs` uses, kept
 * here rather than duplicated as a second list that would drift from the first.
 *
 * The parse happens ONLY on the error path, so a healthy invocation pays nothing,
 * and every step fails open: if the source cannot be read or nothing matches, the
 * caller falls back to the plain message it would have printed anyway.
 */

/**
 * Extract `group → [subcommands]` from dispatcher source text.
 *
 * Pure, so it can be tested against both the real dispatcher and fixtures.
 * Tolerates trailing usage hints in the list (e.g. `clean [--apply] …`) by
 * keeping only the leading bare token of each entry.
 *
 * @param {string} sourceText
 * @returns {Object<string, string[]>}
 */
function buildSubcommandIndex(sourceText) {
  const index = {};
  if (typeof sourceText !== 'string') return index;
  const re = /Unknown ([a-z][a-z-]*) subcommand\. Available: ([^'"`\n]+)/g;
  let m;
  while ((m = re.exec(sourceText)) !== null) {
    const group = m[1];
    const subs = m[2]
      .split(',')
      .map((s) => s.trim().split(/\s+/)[0])   // drop " [--apply]"-style hints
      .filter((s) => /^[a-z][a-z0-9-]*$/.test(s));
    if (subs.length) index[group] = subs;
  }
  return index;
}

/** Levenshtein distance, iterative and allocation-light. */
function editDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Suggest corrections for an unknown top-level command.
 *
 * Two kinds, most useful first:
 *   1. **Namespace miss** — the token IS a real subcommand of one or more groups.
 *      This is the `trace` case, and the reason this module exists.
 *   2. **Typo** — close to a real top-level command by edit distance.
 *
 * The threshold scales with length so short commands do not attract noise
 * (`cost` vs `hud` should not match) while longer ones tolerate one slip.
 *
 * @param {string} name          the unknown token
 * @param {Object} index         from buildSubcommandIndex
 * @param {string[]} topLevel    known top-level command names
 * @returns {string[]} suggestion lines, empty when nothing is close enough
 */
function suggestCommand(name, index, topLevel) {
  if (!name || typeof name !== 'string') return [];
  const token = name.trim().toLowerCase();
  if (!token) return [];
  const out = [];

  // 1. Namespace misses. Deterministically ordered so the message is stable.
  const owners = Object.keys(index || {})
    .filter((group) => (index[group] || []).includes(token))
    .sort();
  for (const group of owners) out.push(`pan-tools ${group} ${token}`);

  // 2. Typos against top-level commands — only when the token is not already a
  // known subcommand, so a correct-but-misplaced token is never muddied by
  // spelling guesses.
  if (out.length === 0 && Array.isArray(topLevel)) {
    const max = token.length <= 4 ? 1 : 2;
    const near = topLevel
      .filter((c) => typeof c === 'string' && c !== token)
      .map((c) => ({ c, d: editDistance(token, c) }))
      .filter((x) => x.d <= max)
      .sort((a, b) => a.d - b.d || a.c.localeCompare(b.c))
      .slice(0, 3)
      .map((x) => `pan-tools ${x.c}`);
    out.push(...near);
  }
  return out;
}

/**
 * Render the suggestions as the tail of an error message.
 * Returns '' when there is nothing to add, so callers can concatenate blindly.
 */
function formatSuggestions(suggestions) {
  if (!Array.isArray(suggestions) || suggestions.length === 0) return '';
  // Trailing period matters: the caller appends more prose, and without it the
  // message ran together as "…optimize trace Run pan-tools --help".
  if (suggestions.length === 1) return ` Did you mean: ${suggestions[0]}.`;
  return ` Did you mean one of: ${suggestions.join(' | ')}.`;
}

module.exports = { buildSubcommandIndex, suggestCommand, formatSuggestions, editDistance };
