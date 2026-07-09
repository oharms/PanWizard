# ADR-0004: Copilot CLI Interactive Experience Optimization

## Status
Proposed

## Context
PAN Wizard supports 5 AI CLI runtimes. Four of them (Claude Code, OpenCode, Gemini CLI, Codex)
have either native structured input tools or adequate text-based equivalents for user interaction.
The 5th runtime, GitHub Copilot CLI (GA 2026-02-25), has no structured input tool — there is no
`ask_user` equivalent in the documented API, and the CLI is purely text-in/text-out.

PAN's 37 commands contain 41 `AskUserQuestion` invocations across 15 workflow files, including
3 multiSelect patterns (discuss-phase, new-project, new-milestone). When installed for Copilot CLI,
these invocations are stripped (`AskUserQuestion: null` in tool mapping) and naively text-replaced
(`AskUserQuestion` → `question` in some paths), producing unstructured prose questions that confuse
users. The user-reported symptom: "On copilot the options are not coming up for select — you get
a question sheet" with a wall of unstructured text.

Competitive analysis of 6 AI coding tools (Aider, Cursor, Continue.dev, Cline, Windsurf,
GitHub Copilot Workspace) shows that structured user interaction is underserved across the industry.
Only Cline offers LLM-generated option buttons (single-select), and only Copilot Workspace offers
file-level checkboxes. No tool offers CLI-native numbered multi-select. This is a differentiation
opportunity.

## Decision
Enhance the install-time Copilot CLI converter in `bin/install.js` to:

1. **Adapter header interaction guidance** — Add a "User interaction" section to
   `getCopilotSkillAdapterHeader()` that teaches the model how to present structured choices
   as numbered text menus, handle multi-select via comma-separated numbers, and always offer
   a free-text fallback.

2. **AskUserQuestion block rewriting** — Add a `rewriteAskUserQuestionForCopilot()` function
   that uses regex to convert `AskUserQuestion` block patterns (with header/question/options)
   into explicit numbered-menu instructions with response format guidance.

3. **multiSelect handling** — Detect `multiSelect: true` patterns and add "type numbers
   separated by commas" instructions in the rewritten output.

4. **Inline reference cleanup** — Replace remaining `AskUserQuestion` text references with
   conversational equivalents ("Ask the user with numbered options").

This is an install-time conversion only. No runtime changes, no new commands, no new dependencies.

## Consequences

### Positive
- Copilot CLI users get structured interaction matching the quality of other runtimes
- All 41 interaction points across 15 workflows improved
- Leverages the decades-old "numbered menu" text-UI pattern (familiar to all developers)
- No runtime dependencies, hooks, or API changes needed
- Zero new commands, zero new concepts — transparent enhancement
- Establishes PAN as the reference implementation for text-based structured interaction in AI CLIs

### Negative
- Regex-based block rewriting is fragile — new AskUserQuestion patterns in future workflows
  must follow the existing format or the regex won't match (graceful degradation: passes through unchanged)
- Users must reinstall to get improvements (no auto-update for installed skill files)
- Model still must interpret user responses (no programmatic validation — quality depends on the model)
- Installed skill files become slightly larger (~500 bytes per file from added guidance)

### Neutral
- Install time increases by ~50ms (negligible)
- Converter function complexity increases moderately (one new ~40 line function)
- Pattern established here may need updating if Copilot CLI adds native structured input tools

## Options Considered

1. **Do nothing** — Accept Copilot CLI as a degraded runtime.
   *Rejected:* User reported the problem directly, Copilot CLI is the largest commercial AI CLI,
   and PAN's value proposition is runtime parity.

2. **Runtime prompt engineering via hooks** — Copilot CLI hooks can only deny/allow tool use,
   not modify prompts or inject context.
   *Rejected:* Technically impossible with current Copilot CLI hook API.

3. **Custom TUI framework** — Build ncurses-style widgets for Copilot CLI output.
   *Rejected:* Over-engineering; Copilot CLI doesn't support custom TUI rendering;
   not portable across terminals.

4. **Install-time converter enhancement (chosen)** — Modify existing converter functions to
   produce better output. Best fit for PAN's install-time architecture, zero runtime overhead,
   consistent with how all other runtime conversions work.

## Links
- Related to: ADR-0002 (Copilot CLI runtime support — established the converter architecture)
- Feature spec: `docs/specs/copilot_cli_interaction_featureai.md`
- Affects: `bin/install.js` (converter functions), `tests/copilot-install.test.cjs`
- AskUserQuestion reference: `pan-wizard-core/references/questioning.md`
