'use strict';

// ─── AGENTS.md universal rules layer (ADR-0028 Phase 3) ─────────────────────
//
// AGENTS.md is the cross-runtime project-instructions standard; Codex,
// OpenCode and Copilot CLI read it natively, Claude Code only through the @AGENTS.md
// import in CLAUDE.md; Gemini CLI reads GEMINI.md by default, not this file. PAN contributes one
// marker-fenced section so agents in any runtime understand the PAN context
// when reading the repo. User content outside the markers is never touched, and
// neither is a section the project edited inside them: PAN replaces only text it
// generated itself, this release's or an earlier one's (sectionState). A project
// whose work does not live in .planning/ said so in its own words there, and an
// update put PAN's generic text back (field report, 2026-10-21).
//
// SSOT NOTE: these builders are the single source of truth for the AGENTS.md
// PAN section and the CLAUDE.md @AGENTS.md bridge. They live under
// pan-wizard-core/ (shipped into every install) so the installer AND the
// installed `pan-tools memory rebuild` regenerate byte-identical content.
// bin/install-lib.cjs re-exports these names for backward compatibility.

const PAN_AGENTS_BEGIN = '<!-- BEGIN PAN WIZARD -->';
const PAN_AGENTS_END = '<!-- END PAN WIZARD -->';
const crypto = require('crypto');

// What earlier releases generated between the markers, by sha256 (first 16 hex) of the
// text with LF line endings, trimmed. Taken from the builders at every commit that
// changed them. A section with any other text was written by the project.
const PRIOR_AGENTS_SECTIONS = Object.freeze([
  'a92a7488b866611d', // to 2026-10-03: "PAN commands install as pan-* skills/commands"
  'c66f9afd44d80489', // 2026-10-03 to 2026-10-21: commands named per runtime (M34)
]);
const PRIOR_CLAUDE_BRIDGES = Object.freeze([
  '918b1c90559355ef', // the @AGENTS.md import alone
  '90d0654c91061ec1', // the import and compact instructions (O8), to 2026-10-21
]);

const innerHash = (text) => crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);

/** The text between PAN's markers, or null when the markers are absent. */
function fencedInner(existing) {
  if (!existing) return null;
  const b = existing.indexOf(PAN_AGENTS_BEGIN);
  const e = existing.indexOf(PAN_AGENTS_END);
  if (b === -1 || e === -1 || e < b) return null;
  return existing.slice(b + PAN_AGENTS_BEGIN.length, e);
}

/**
 * Build the PAN section for AGENTS.md (marker-fenced, runtime-neutral).
 * @returns {string} The fenced section, no leading/trailing blank lines.
 */
function buildAgentsMdSection() {
  return [
    PAN_AGENTS_BEGIN,
    '## PAN Wizard',
    '',
    'This project uses PAN Wizard for structured, phase-based planning and execution.',
    '',
    '- When this project plans with PAN, `.planning/` holds that state (state.md, roadmap.md, phase directories): change it through PAN commands, not by hand. Where this project keeps its work elsewhere, its own instructions say so and win.',
    // One section serves every runtime in the project, so it names each one's form
    // (the README's list); `/pan-help` alone sent Claude Code users to a command
    // that does not exist there (prompt audit, market-ideas M34).
    '- PAN\'s commands are named per runtime: `/pan:help`, `/pan:new-project`, `/pan:exec-phase` in Claude Code and Gemini CLI; `/pan-help` and so on in OpenCode, Copilot CLI and unified-skills Claude installs; `$pan-help` in Codex. Start with the help command.',
    '- The `pan-tools` dispatcher backs every command; it lives under `pan-wizard-core/` inside the runtime\'s config directory (or `.agents/` for unified installs).',
    PAN_AGENTS_END,
  ].join('\n');
}

/**
 * Whose text sits between PAN's markers: 'absent' (no markers), 'pan' (this release's
 * text or an earlier release's), or 'edited' (the project changed it).
 * @param {string|null} existing - AGENTS.md (or CLAUDE.md) content
 * @param {'agents'|'claude'} [kind]
 */
function sectionState(existing, kind = 'agents') {
  const inner = fencedInner(existing);
  if (inner === null) return 'absent';
  const known = kind === 'claude'
    ? [...PRIOR_CLAUDE_BRIDGES, innerHash(fencedInner(buildClaudeMdBridge()))]
    : [...PRIOR_AGENTS_SECTIONS, innerHash(fencedInner(buildAgentsMdSection()))];
  return known.includes(innerHash(inner)) ? 'pan' : 'edited';
}

/**
 * Insert or replace the PAN section in AGENTS.md content.
 * - No existing content (null/empty) → just the section.
 * - Markers present around text PAN generated → replace exactly the fenced block,
 *   preserving everything around it.
 * - Markers present around text the project edited → return the content unchanged.
 * - Markers absent → append with a separating blank line.
 * @param {string|null} existing - Current AGENTS.md content, or null if absent
 * @param {string} section - Output of buildAgentsMdSection()
 * @returns {string} New file content (always newline-terminated)
 */
function upsertAgentsMdSection(existing, section) {
  if (!existing || !existing.trim()) {
    return section + '\n';
  }
  const beginIdx = existing.indexOf(PAN_AGENTS_BEGIN);
  const endIdx = existing.indexOf(PAN_AGENTS_END);
  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    if (sectionState(existing, 'agents') === 'edited') return existing;
    const before = existing.slice(0, beginIdx);
    const after = existing.slice(endIdx + PAN_AGENTS_END.length);
    return before + section + after;
  }
  return existing.trimEnd() + '\n\n' + section + '\n';
}

/**
 * Remove the PAN section from AGENTS.md content.
 * @param {string} existing - Current AGENTS.md content
 * @returns {string|null} Content without the PAN block, or null when nothing
 *   meaningful remains (caller should delete the file).
 */
function removeAgentsMdSection(existing) {
  if (!existing) return null;
  const beginIdx = existing.indexOf(PAN_AGENTS_BEGIN);
  const endIdx = existing.indexOf(PAN_AGENTS_END);
  if (beginIdx === -1 || endIdx === -1 || endIdx < beginIdx) {
    return existing; // no PAN block — leave untouched
  }
  const before = existing.slice(0, beginIdx);
  const after = existing.slice(endIdx + PAN_AGENTS_END.length);
  const remaining = (before.trimEnd() + '\n\n' + after.trimStart()).trim();
  return remaining ? remaining + '\n' : null;
}

/**
 * PAN's block in CLAUDE.md: the @AGENTS.md import, and Claude Code's "Compact
 * instructions" section (memory optimisation O8). Claude Code reads a section of
 * that name in the project-root CLAUDE.md when it summarises a conversation, and
 * re-reads CLAUDE.md from disk after compaction. The section names what the summary
 * must keep for PAN work to resume where it stopped.
 *
 * Codex is deliberately left out: its `compact_prompt` replaces the built-in
 * compaction prompt rather than adding to it, and the default OpenAI provider
 * ignores it (read 2026-10-04), so PAN would be swapping a tuned prompt for one
 * that may never run. PAN's state re-injection after compaction covers Codex.
 */
function buildClaudeMdBridge() {
  return [
    PAN_AGENTS_BEGIN,
    '@AGENTS.md',
    '',
    '# Compact instructions',
    '',
    'When this conversation is compacted, keep what PAN work needs to resume where it stopped:',
    '- the current phase and plan, and the task in progress with its stopping point, with the path of the file that records them (`.planning/state.md` when the project keeps one);',
    '- decisions made in this session that are not yet written down;',
    '- the files changed since the last commit.',
    'Leave out file contents and command output: they can be read again.',
    PAN_AGENTS_END,
  ].join('\n');
}

/**
 * Ensure CLAUDE.md carries PAN's block: the marker-fenced @AGENTS.md import
 * (Claude Code's documented pattern for adopting the universal rules file) and
 * the compact instructions. Idempotent; preserves all user content. An older PAN
 * bridge (the import alone) is replaced in place, so a reinstall or `memory
 * rebuild` brings existing projects up to date.
 * @param {string|null} existing - Current CLAUDE.md content, or null if absent
 * @returns {string} New file content
 */
function ensureClaudeMdImport(existing) {
  const block = buildClaudeMdBridge();
  if (!existing || !existing.trim()) {
    return block + '\n';
  }
  const beginIdx = existing.indexOf(PAN_AGENTS_BEGIN);
  const endIdx = existing.indexOf(PAN_AGENTS_END);
  if (beginIdx !== -1) {
    // PAN's own bridge, as some release generated it: bring it up to date. A block the
    // project edited, or any other PAN block, is left alone.
    if (endIdx > beginIdx && sectionState(existing, 'claude') === 'pan') {
      const eol = existing.includes('\r\n') ? '\r\n' : '\n';
      return existing.slice(0, beginIdx) + block.replace(/\n/g, eol) + existing.slice(endIdx + PAN_AGENTS_END.length);
    }
    return existing;
  }
  if (/^@AGENTS\.md\s*$/m.test(existing)) {
    return existing; // user already imports AGENTS.md themselves
  }
  return existing.trimEnd() + '\n\n' + block + '\n';
}

/**
 * Remove the PAN bridge block from CLAUDE.md content.
 * @param {string} existing - Current CLAUDE.md content
 * @returns {string|null} Content without the bridge, or null when nothing
 *   meaningful remains (caller should delete the file).
 */
function removeClaudeMdImport(existing) {
  return removeAgentsMdSection(existing);
}

module.exports = {
  sectionState,
  PRIOR_AGENTS_SECTIONS,
  PRIOR_CLAUDE_BRIDGES,
  PAN_AGENTS_BEGIN,
  PAN_AGENTS_END,
  buildAgentsMdSection,
  upsertAgentsMdSection,
  removeAgentsMdSection,
  buildClaudeMdBridge,
  ensureClaudeMdImport,
  removeClaudeMdImport,
};
