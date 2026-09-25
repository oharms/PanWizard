'use strict';

// ─── AGENTS.md universal rules layer (ADR-0028 Phase 3) ─────────────────────
//
// AGENTS.md is the cross-runtime project-instructions standard; Codex,
// OpenCode and Copilot CLI read it natively, Claude Code only through the @AGENTS.md
// import in CLAUDE.md; Gemini CLI reads GEMINI.md by default, not this file. PAN contributes one
// marker-fenced section so agents in any runtime understand the PAN context
// when reading the repo. User content outside the markers is never touched.
//
// SSOT NOTE: these builders are the single source of truth for the AGENTS.md
// PAN section and the CLAUDE.md @AGENTS.md bridge. They live under
// pan-wizard-core/ (shipped into every install) so the installer AND the
// installed `pan-tools memory rebuild` regenerate byte-identical content.
// bin/install-lib.cjs re-exports these names for backward compatibility.

const PAN_AGENTS_BEGIN = '<!-- BEGIN PAN WIZARD -->';
const PAN_AGENTS_END = '<!-- END PAN WIZARD -->';

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
    '- `.planning/` is PAN\'s state directory (state.md, roadmap.md, phase directories). Treat it as the source of truth for planning state and modify it through PAN commands, not by hand.',
    '- PAN commands install as `pan-*` skills/commands (for example `/pan-help`, `/pan-new-project`, `/pan-exec-phase`). Start with `/pan-help`.',
    '- The `pan-tools` dispatcher backs every command; it lives under `pan-wizard-core/` inside the runtime\'s config directory (or `.agents/` for unified installs).',
    PAN_AGENTS_END,
  ].join('\n');
}

/**
 * Insert or replace the PAN section in AGENTS.md content.
 * - No existing content (null/empty) → just the section.
 * - Markers present → replace exactly the fenced block, preserving everything
 *   around it.
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
 * Ensure CLAUDE.md bridges to AGENTS.md via a marker-fenced @AGENTS.md import
 * (Claude Code's documented pattern for adopting the universal rules file).
 * Idempotent; preserves all user content.
 * @param {string|null} existing - Current CLAUDE.md content, or null if absent
 * @returns {string} New file content
 */
function ensureClaudeMdImport(existing) {
  const block = `${PAN_AGENTS_BEGIN}\n@AGENTS.md\n${PAN_AGENTS_END}`;
  if (!existing || !existing.trim()) {
    return block + '\n';
  }
  if (existing.includes(PAN_AGENTS_BEGIN)) {
    return existing; // bridge (or another PAN block) already present
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
  PAN_AGENTS_BEGIN,
  PAN_AGENTS_END,
  buildAgentsMdSection,
  upsertAgentsMdSection,
  removeAgentsMdSection,
  ensureClaudeMdImport,
  removeClaudeMdImport,
};
