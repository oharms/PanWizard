# ADR-0002: GitHub Copilot CLI Runtime Support

## Status
Accepted — fully implemented (2026-02-28)

## Context

GitHub Copilot CLI went generally available on February 25, 2026, included in all Copilot plans (Free, Pro, Pro+, Business, Enterprise). It supports custom agents (`.agent.md`), skills (`SKILL.md`), hooks (7 event types), and MCP servers — concepts that map directly to PAN Wizard's architecture.

PAN Wizard currently supports 4 terminal AI runtimes: Claude Code, OpenCode, Gemini CLI, and Codex. GitHub Copilot CLI represents the largest commercial AI developer tool ecosystem (150M+ GitHub developers) and shares structural similarities with PAN's existing runtime targets.

The key forces at play:
1. **Market timing** — First-mover advantage for structured workflow tools on a newly GA platform
2. **Architecture fit** — Copilot CLI's skill/agent/hook model maps cleanly to PAN's existing patterns
3. **Proven template** — PAN already handles 4 runtimes with format converters; a 5th follows the same pattern
4. **User demand** — Direct user request in this conversation; Copilot CLI issue #783 requesting structured planning

## Decision

Add GitHub Copilot CLI as PAN Wizard's 5th supported runtime via installer enhancement.

### Key design choices:

1. **Skills, not commands** — Install PAN commands as `skills/pan-*/SKILL.md` (Copilot CLI's native format, similar to how Codex uses `skills/pan-*/SKILL.md`)

2. **`.agent.md` extension** — Install PAN agents as `pan-*.agent.md` files (Copilot CLI convention, distinct from Claude Code's plain `.md`)

3. **Native hooks** — Use Copilot CLI's own hook system (JSON config files with event types) rather than embedding in config.json

4. **`/pan-` prefix** — Skills in Copilot CLI are invoked via `/skill-name`, so PAN commands become `/pan-new-project`, `/pan-plan-phase`, etc.

5. **Global: `~/.copilot/`, Local: `.github/`** — Follow Copilot CLI's standard paths. Local installs to `.github/` (not `.copilot/`) because Copilot CLI reads skills/agents from `.github/` for project scope.

6. **Installer-only change** — No modifications to core modules, pan-tools.cjs, or existing command/agent definitions. All conversion happens at install time.

## Consequences

### Positive
- PAN Wizard covers 5 major terminal AI runtimes — unmatched multi-runtime support
- Access to GitHub's massive developer ecosystem
- First structured workflow tool available on Copilot CLI post-GA
- Proven pattern — minimal risk, follows existing 4-runtime template
- Hook support means statusline, context monitor, and update checker all work

### Negative
- Installer grows by ~200-300 lines (already 2,157 lines for 4 runtimes)
- Another format converter to maintain (though Copilot CLI format is stable post-GA)
- Must monitor GitHub Changelog for any format changes in early GA period

### Neutral
- Command count is 37, agent count stays at 11
- No new user concepts — same PAN workflow, one more runtime option
- Test suite grows by ~16 tests for installer coverage

## Options Considered

1. **Wait for Copilot CLI format to stabilize** — Rejected because the format is already stable at GA; waiting loses first-mover advantage.

2. **Plugin distribution via `/plugin install`** — Deferred to v2. Requires GitHub repository packaging and marketplace registration. The installer approach works now and is consistent with other runtimes.

3. **Hybrid: use Codex skill format for Copilot CLI** — Rejected. While both use `SKILL.md`, Copilot CLI has its own conventions (`.agent.md` for agents, different tool names, native hook system). A dedicated converter produces cleaner results.

4. **Add as installer option (chosen)** — Consistent with how all 4 existing runtimes work. Proven pattern, minimal risk, maximum compatibility.

## Links
- Spec: `docs/specs/copilot_cli_runtime_featureai.md`
- Related: `bin/install.js` (primary implementation file)
- Related: ADR-0001 (strategic feature prioritization)
- External: [Copilot CLI GA announcement](https://github.blog/changelog/2026-02-25-github-copilot-cli-is-now-generally-available/)
- External: [Copilot CLI custom agents docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-custom-agents-for-cli)
- External: [Copilot CLI skills docs](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/create-skills)
