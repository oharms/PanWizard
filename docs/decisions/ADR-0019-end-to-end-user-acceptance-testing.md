# ADR-0019: End-to-End User Acceptance Testing

## Status
Proposed

## Context
ADR-0018 introduced the "User Reality Testing" system: a scenario runner (`createScenarioRunner`), installer function extraction (`install-lib.cjs`), 47 scenario tests, and a CI pipeline. These tests validate that `pan-tools.cjs` commands work when run from an installed location across all 5 runtimes.

However, a critical gap remains: **no test validates the host tool integration surface**. When a user installs PAN into a project folder and opens it in VS Code with Claude Code or Copilot CLI, the host tool consumes:

1. **`settings.json` / `config.json`** — Hook registration with runtime-specific key casing (PascalCase for Claude, camelCase for Copilot) and structure (nested vs flat)
2. **Command `.md` files** — Placed in runtime-specific directories (`.claude/commands/pan/`, `.github/skills/pan-*/SKILL.md`, etc.)
3. **Hook `.js` files** — Referenced by path in settings/config, must actually exist on disk
4. **Agent `.md` files** — Must have valid frontmatter (`name`, `description`) and XML structure tags (`<objective>`)

If any of these contracts break — a hook key gets the wrong casing, a command file is misplaced, a hook references a nonexistent file — the user experience silently fails. The host tool doesn't throw an error; it just doesn't discover the commands or fire the hooks.

The user explicitly identified this gap: "it works well from a system test but contain no end state user test, where the panwizard is installed into a folder opened up with VSCODE and is called via claude or copilot."

## Decision

Add 5 new scenario test files that validate the **host tool integration contract** — the file structures and schemas that Claude Code and Copilot CLI consume:

### Test File 1: `settings-schema.test.cjs`
Validates `settings.json` (Claude) and `config.json` (Copilot) after installation:
- JSON is parseable
- Hook event keys use correct casing per runtime
- Hook entries are arrays with correct internal structure
- `statusLine` key exists with `command` field
- No cross-contamination (no camelCase in Claude, no PascalCase in Copilot)

### Test File 2: `command-discovery.test.cjs`
Validates command files are placed where each runtime expects them:
- Claude: `.claude/commands/pan/*.md` with >= 30 files
- Copilot: `.github/skills/pan-*/SKILL.md` with >= 30 directories
- Codex: `.codex/skills/pan-*/SKILL.md` with >= 30 directories
- Critical commands exist by name (plan-phase, exec-phase, verify-phase, new-project, quick)
- No empty command files (size > 100 bytes)

### Test File 3: `hook-registration.test.cjs`
Validates hook entries reference real files:
- Each hook command path resolves to an existing `.js` file on disk
- 3 expected hooks present: `pan-check-update.js`, `pan-context-monitor.js`, `pan-statusline.js`
- Hook files are non-empty (> 100 bytes, not stub files)
- No duplicate hook entries (installer deduplication worked)

### Test File 4: `agent-structure.test.cjs`
Validates agent `.md` files have valid structure:
- Agent count >= 10
- Each agent has `name` in frontmatter
- Each agent body contains `<objective>` XML tag
- No empty agent files

### Test File 5: `user-workflow-e2e.test.cjs`
Validates a realistic 10-step user workflow produces coherent state:
1. Install (via createScenarioRunner)
2. Setup .planning/ structure
3. config-ensure-section
4. phase add (first)
5. phase add (second)
6. phases list (shows both)
7. state add-decision
8. state-snapshot (reflects all changes)
9. validate health (passes)
10. generate-slug (utility works in context)

### What This Does NOT Test
- LLM responses (non-deterministic)
- VS Code extension behavior (third-party code)
- Actual hook execution (requires real event triggers from host tool)
- Interactive readline prompts (requires stdin mocking)
- Full `/pan:new-project` interactive flow (requires LLM)

## Consequences

### Positive
- Host tool integration surface validated for Claude and Copilot — catches silent failures before release
- Command discoverability tested for 3 runtimes — prevents "command not found" bugs
- Hook registration integrity verified — catches reference-to-nonexistent-file bugs
- Agent structure validated — catches broken agent files early
- Full user workflow coherence tested — catches state corruption across operations
- ~50 new tests, additive only — no existing tests modified
- Zero runtime dependencies — uses only `node:test`, `node:assert`, `node:fs`, `node:path`

### Negative
- Tests document assumed host tool schemas (settings.json, config.json) which may change in future host tool releases
- Agent validation is structural only (frontmatter + XML tags) — doesn't validate prompt quality
- Workflow e2e is a subset of the full user journey (no LLM interaction, no interactive Q&A)

### Neutral
- No changes to installer, core modules, or user-facing commands
- Existing 1,466 tests completely unchanged
- `npm run test:scenarios` glob automatically picks up new files
- CI pipeline (from ADR-0018) automatically runs new tests

## Options Considered

1. **Start actual Claude Code / Copilot process and invoke commands** — Rejected: requires full IDE installation, non-deterministic, not automatable in CI, massively complex setup.

2. **Mock the host tool's config loading** — Rejected: we'd be testing our mock, not the real integration. The point is to validate real files.

3. **JSON Schema validation with a library** — Rejected: adds runtime dependency. Manual key checking is sufficient and self-documenting.

4. **Validate file contracts by reading installed directory structure (CHOSEN)** — Validate the files that host tools consume: settings/config JSON, command placement, hook references, agent structure. This is deterministic, automatable, zero-dep, and catches the exact class of bugs users report.

5. **Golden file comparison** — Partially deferred to v2: compare installed files against known-good snapshots. Good for detecting unexpected changes but brittle across versions.

## Links
- Spec: `docs/specs/end_to_end_user_acceptance_testing_featureai.md`
- Predecessor: ADR-0018 (User Reality Testing — scenario runner, installer extraction, CI)
- Related: ADR-0009 (production deployment checklist)
- Installer: `bin/install.js` (settings.json/config.json generation at lines 1520-1669)
- Scenario runner: `tests/helpers.cjs` (createScenarioRunner at lines 59-108)
