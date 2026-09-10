# PAN Wizard Development Guide

## Prerequisites
- Node.js >= 16.7.0
- No other dependencies (zero runtime deps)

## Project Structure

```
pan-wizard/
  bin/install.js              # Interactive installer (npx pan-wizard entry point)
  package.json                # Zero runtime deps; devDependencies retained for future bundling option
  commands/pan/               # Command .md files (Claude Code slash commands)
  agents/                     # Agent .md files (specialized AI roles)
  pan-wizard-core/
    bin/
      pan-tools.cjs           # CLI bridge — all commands/agents call this
      lib/                    # Core CJS modules
        core.cjs              # Model profiles, output helpers, toPosix(), loadConfig()
        config.cjs            # Config CRUD (dot-notation get/set)
        state.cjs             # state.md operations + frontmatter sync
        init.cjs              # Compound init commands (bootstrap context)
        phase.cjs             # Phase CRUD (list, add, insert, remove, complete)
        roadmap.cjs           # roadmap.md parsing (get-phase, analyze)
        verify.cjs            # Verification + health validation
        milestone.cjs         # Milestone lifecycle (archive, milestones.md)
        frontmatter.cjs       # YAML-like frontmatter CRUD
        commands.cjs          # Misc: history-digest, scaffold, progress, todo, commit
        template.cjs          # Template loading from templates/
        constants.cjs         # Shared path constants, file patterns, regex
        utils.cjs             # Shared utilities: readJsonFile, planningPath, listPhaseDirs
        context-budget.cjs    # Context window utilization estimation + token counting
        focus.cjs             # Strategic project management: scan, plan, sync, exec, design, auto
        codebase.cjs          # Codebase analysis: language detection, imports, best practices
        memory.cjs            # Cross-phase agent memory (read/append/list/compact)
        cost.cjs              # Token usage + cost dashboard (Spec B v2 Y-6)
        bus.cjs               # Agent message channels (Spec B v2 Y-7)
        preview.cjs           # Foresight: phase blast radius, dependency graph (Y-1)
        review-deep.cjs       # Deep review merge (reviewer + hardener + meta) (Y-2)
        knowledge.cjs         # Grounded Q&A / discuss / playbook (Y-3)
        whatif.cjs            # Counterfactual phase replay in worktree (Y-4)
        bridge.cjs             # MCP discovery + recommendation (Y-5)
        optimize.cjs          # Circular optimization loop (trace, learn, apply) (v3.5)
        git.cjs               # /pan:git command family (v3.5)
        distill.cjs           # AI code-bloat 5-pass optimizer (v3.5)
        doc-lint.cjs          # Markdown frontmatter+structure linter (vendored from whooo)
        experiment.cjs        # Self-improvement loop scaffolding
        runner.cjs            # External agent runner (Claude/Codex/Gemini/OpenCode)
        learn-lint.cjs        # Learnings-store integrity linter (L-001..L-005)
        learn-index.cjs       # Learnings index + topics-for queries (per-agent relevance)
        squads.cjs            # Squad registry — army roles architecture/build/quality/release (ADR-0032)
        worktree.cjs          # Branch-per-agent git worktree isolation for parallel builders (ADR-0033)
        campaign.cjs          # Scheduled self-resuming army campaigns ("dreaming") (ADR-0034)
        hud.cjs               # Single self-contained HTML dashboard of project + bot army (ADR-0035)
        skill-align.cjs       # Skill-Aligned Decomposition pass for the planner (ADR-0038)
        hygiene.cjs           # Project cleanup + version alignment (scan/clean)
    workflows/                # Workflow .md files (multi-step procedures)
    references/               # Reference .md files (loaded by agents)
    templates/                # Template files (scaffolding)
  hooks/
    dist/                     # Hooks (copied from hooks/, no bundling — they're pure Node.js)
      pan-statusline.js       # Writes context metrics bridge file
      pan-context-monitor.js  # Injects context warnings to agent
      pan-check-update.js     # Periodic update check
      pan-cost-logger.js      # SubagentStop hook — appends cost record to tokens.jsonl (v3.4)
      pan-trace-logger.js     # SubagentStop hook — circular optimization tracing (v3.5)
      pan-stop-guard.js       # Stop hook — blocks the auto-advance boundary drop once (v3.23)
  scripts/
    build-hooks.js            # Copy hooks from hooks/ to hooks/dist/ (no bundling)
  tests/                      # Test suite (node:test + node:assert)
    helpers.cjs               # Test utilities: runPanTools(), createTempProject(), cleanup()
    *.test.cjs                # Unit test files
    scenarios/                # Scenario test files (scenario + integration)
  docs/                       # User-facing documentation
  assets/                     # SVG terminal recordings
```

## Development Setup

```bash
git clone https://github.com/oharms/PanWizard.git
cd PanWizard
npm install          # Installs devDependencies only (zero runtime deps)
npm test             # Run unit tests
npm run test:scenarios  # Run scenario tests (install + integration)
npm run test:all     # Run all tests (unit + scenario)
npm run build:hooks  # Copy hooks from hooks/ to hooks/dist/ (no bundling — pure Node.js)
```

### Local Testing

Never install into the clone itself — `bin/install.js` has a hard `PAN_SOURCE_ROOT` guard that refuses to run from the source repo. Install into a separate scratch directory instead:

```bash
# From a scratch dir alongside the clone, install to test changes
cd ../pan-test && node ../PanWizard/bin/install.js --claude --local    # → ./.claude/
cd ../pan-test && node ../PanWizard/bin/install.js --claude --global   # → ~/.claude/
```

## How to Add a New Command

1. Create `commands/pan/your-command.md`
2. The filename becomes the slash command: `/pan:your-command`
3. Commands should be thin orchestrators — read state, spawn agents, route results
4. Call pan-tools for state operations: `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs <cmd> [args]`
5. Reference a workflow if multi-step logic is needed
6. That's it — the installer copies `commands/pan/` recursively, so new command files ship automatically (no installer edit needed)

## How to Add a New Agent

1. Create `agents/pan-your-agent.md`
2. Define role, context requirements, constraints, output format using XML structure
3. Add model profile entry to `core.cjs` MODEL_PROFILES table
4. Reference from workflow .md that spawns it via Task tool
5. That's it — the installer copies `agents/` recursively, so new agent files ship automatically (no installer edit needed)

## How to Add a Core Module Function

1. Add function to the appropriate `.cjs` file in `pan-wizard-core/bin/lib/`
2. Export via `module.exports`
3. Wire into `pan-tools.cjs` command routing (add case in the main switch)
4. Write tests in `tests/` using `node:test` and `node:assert`

## How to Add a Hook

1. Create source in `hooks/your-hook.js`
2. Run `npm run build:hooks` (copies hooks from `hooks/` to `hooks/dist/`; no bundling — they're pure Node.js)
3. Register in installer: hooks are copied and registered in the target runtime's settings.json

## Writing Tests

Tests use Node.js built-in `node:test` and `node:assert`. No external framework.

```javascript
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('your feature', () => {
  test('does the thing', () => {
    const tmp = createTempProject();    // Creates temp .planning/ structure
    try {
      const result = runPanTools(['your-command', 'arg'], tmp);
      assert.strictEqual(result.field, 'expected');
    } finally {
      cleanup(tmp);                     // Always clean up
    }
  });
});
```

### Test Helpers (tests/helpers.cjs)

- `runPanTools(args, cwd)` — Runs `pan-tools.cjs` with given args in cwd, returns parsed JSON
- `createTempProject(options)` — Creates temp directory with .planning/ scaffold (optional: roadmap, state, config, phases)
- `cleanup(dir)` — Recursively removes temp directory

### Running Tests

```bash
npm test                                    # All tests
node --test tests/phase.test.cjs            # Single file
node --test --test-reporter spec tests/*.test.cjs  # Verbose
```

## Cross-Platform Considerations

### Path Separators (EP-001)
Windows uses `\`, macOS/Linux use `/`. All JSON output must use forward slashes.

**Fix:** Use `toPosix()` from `core.cjs` when outputting file paths.

```javascript
const { toPosix } = require('./core.cjs');
// path.join(cwd, '.planning', 'state.md') → '.planning\state.md' on Windows
// toPosix(relPath) → '.planning/state.md' always
```

### Dollar Sign Shell Expansion (EP-002)
Bash expands `$` in strings. If content contains `$100`, it gets mangled.

**Fix:** Write content to a temp file, pass `--text-file <path>` instead of inline strings.

### CommonJS Format (EP-003)
All modules use `.cjs` extension with `require()`/`module.exports`. Do NOT use ESM (`import`/`export`).

### node:test Not Jest (EP-004)
Tests use `node:test` and `node:assert/strict`. Do NOT use `describe`/`it` from Jest or Mocha.

## How to Write a Workflow

Workflows are the Layer 2 orchestration files in `pan-wizard-core/workflows/`. They define multi-step procedures that commands execute.

1. Create `pan-wizard-core/workflows/your-workflow.md`
2. Structure it with XML steps that load state, spawn agents, and route results
3. Reference it from your command .md file via `@~/.claude/pan-wizard-core/workflows/your-workflow.md`
4. That's it — the installer copies `pan-wizard-core/workflows/` recursively, so new workflows ship automatically

**Workflow structure:**
```markdown
<objective>What this workflow accomplishes.</objective>

<step name="load_state">
Load context via pan-tools init command:
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init your-command "$PHASE")
Extract fields from JSON output.
</step>

<step name="execute">
Spawn agents via Task tool or perform direct operations.
</step>

<step name="route">
Present results and suggest next command.
</step>
```

**Naming convention:** Workflow filenames may differ from command filenames (see [ARCHITECTURE.md](ARCHITECTURE.md) for the mapping table). This allows one workflow to serve multiple commands, or internal workflows to have clearer descriptive names.

## How to Write a Reference

References are knowledge documents in `pan-wizard-core/references/` that agents load via `@`-syntax in their prompts.

1. Create `pan-wizard-core/references/your-reference.md`
2. Use XML tags for structured sections: `<overview>`, `<rules>`, `<examples>`, `<anti_patterns>`
3. Reference from agent .md files: `@~/.claude/pan-wizard-core/references/your-reference.md`
4. That's it — the installer copies `pan-wizard-core/references/` recursively, so new references ship automatically

**Current references:**

| Reference | Purpose |
|-----------|---------|
| `checkpoints.md` | Checkpoint types, automation patterns, auth gates |
| `continuation-format.md` | "Next Up" block format for workflow transitions |
| `decimal-phase-calculation.md` | Phase numbering logic for inserted phases |
| `git-integration.md` | Commit format, per-task commits, branching |
| `git-planning-commit.md` | How pan-tools commits planning docs |
| `guardrails.md` (v3.6.0+) | Behavioral guardrails — anti-patterns, Code Preservation Principle, Stop-the-Line Rule |
| `handoff-decisions.md` | Planner→executor decision-trace handoff (locked/open/rejected decisions) |
| `model-profile-resolution.md` | Agent → model mapping with inherit logic |
| `model-profiles.md` | quality/balanced/budget profile definitions |
| `phase-argument-parsing.md` | Normalize phase numbers for lookups |
| `planning-config.md` | Config schema, branching strategies, commit_docs |
| `questioning.md` | Discussion methodology for new-project/discuss-phase |
| `tdd.md` | TDD workflow (RED/GREEN/REFACTOR) in plan execution |
| `ui-brand.md` | Status banners, checkpoint boxes, progress display |
| `verification-patterns.md` | Stub detection, wiring checks, verification checklists |

## How to Customize Templates

Templates in `pan-wizard-core/templates/` scaffold new project files. The `template.cjs` module handles loading and placeholder substitution.

1. Templates are plain Markdown files with `{placeholder}` variables
2. `cmdTemplateFill()` replaces placeholders with phase/plan context
3. `cmdTemplateSelect()` auto-selects summary template based on plan complexity:
   - **minimal** — ≤2 tasks, ≤3 files, no decisions
   - **standard** — typical plans
   - **complex** — 7+ files, 6+ tasks, or decisions present

**Template categories:**

| Category | Templates | Used by |
|----------|-----------|---------|
| Project | project.md, requirements.md, roadmap.md, state.md | `/pan:new-project` |
| Phase | context.md, research.md, discovery.md, phase-prompt.md | `/pan:discuss-phase`, `/pan:plan-phase` |
| Codebase | architecture.md, stack.md, conventions.md, concerns.md, integrations.md, structure.md, testing.md, relationships.md, best-practices.md | `/pan:map-codebase` |
| Summary | summary.md, summary-minimal.md, summary-standard.md, summary-complex.md | pan-executor |
| Verification | validation.md, uat.md, verification-report.md | pan-verifier |
| Debug | debug.md, debug-subagent-prompt.md | `/pan:debug` |
| Research | research-project/stack.md, features.md, architecture.md, pitfalls.md, summary.md | pan-phase-researcher |
| Planning | planner-subagent-prompt.md, standards.md, user-setup.md | pan-planner, `/pan:new-project` |
| Lifecycle | milestone.md, milestone-archive.md, retrospective.md, continue-here.md | Milestone commands |
| Spec B v2 | playbook.md (knowledge system), preview-report.md (foresight/preview) | `/pan:knowledge`, `/pan:preview` |

To customize: edit templates in `pan-wizard-core/templates/` directly. Changes take effect on next use. After PAN updates, check for template changes in the changelog.

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full internal architecture guide.

Quick summary: Commands -> Workflows -> Agents -> Core Library -> .planning/ state files

### Bot Army subsystem (v3.11+)

The army turns PAN's agents into a coordinated, role-scoped army. The substrate lives in four core modules — `squads.cjs` (the role registry: architecture / build / quality / release), `worktree.cjs` (branch-per-agent git-worktree isolation so parallel builders never collide), `campaign.cjs` (scheduled, self-resuming "dreaming" campaigns), and `hud.cjs` (the single-file HTML dashboard) — driven by the `/pan:army` command, the `pan-conductor` agent (Mission Control — instructed to delegate rather than implement; its `tools:` grant is not narrowed to enforce that), and the `pan-release` agent (the human merge gate). The design rationale is recorded in [ADR-0032 (squad model)](decisions/ADR-0032-squad-model.md), [ADR-0033 (army campaign)](decisions/ADR-0033-army-campaign.md), [ADR-0034 (scheduled campaigns)](decisions/ADR-0034-scheduled-campaigns.md), and [ADR-0035 (army HUD dashboard)](decisions/ADR-0035-army-hud-dashboard.md).

## Distribution Bundles

Besides the loose-file installer, two builders package PAN as a plugin. Neither output is committed (`dist/` is ignored) and neither is published yet; both are built and validated by the test suite.

| Command | Output | Consumed by | Layout |
|---|---|---|---|
| `npm run build:plugin` | `dist/pan-wizard-plugin/` | Claude Code (plugin marketplaces; the local `command`-source test bed in `marketplace/`) | `.claude-plugin/plugin.json`, `commands/`, `agents/`, `hooks/`, `workflows/`, `.mcp.json`, `pan-wizard-core/` |
| `npm run build:agent-plugin` | `dist/pan-agent-plugin/` | Copilot CLI / VS Code, Codex, Cursor, Kiro — the vendor-neutral **Agent Plugins 1.0** format (ADR-0045) | `plugin.json`, `skills/`, `mcp.json`, `pan-wizard-core/`, `hooks/` (scripts + Codex `hooks.json`), `com.github.copilot/` (agents + hooks) |

Two marketplace files in the repository point at the Agent Plugins build so a checkout can install it without publishing: `.agents/plugins/marketplace.json` (Codex, repo-scoped, discovered automatically inside the repo) and `.github/plugin/marketplace.json` (Copilot, added with `copilot plugin marketplace add`). Both reference `./dist/pan-agent-plugin`, so run the builder first. The release gate (`scripts/release-check.js`, gate 8) builds both bundles into temp directories and fails the release if either does not produce its manifest.

The vendor directories carry their own verification status, recorded in ADR-0045: the Codex hooks shape and `${PLUGIN_ROOT}` expansion come from Codex's plugin reference; the Copilot namespace and its flat PascalCase hooks come from VS Code's documentation, and a live `copilot plugin install` on a machine that has the CLI is the remaining gate. No Antigravity variant is emitted — its manifest schema is closed and different.

Both builders take an output override (`PAN_PLUGIN_OUT`, `PAN_AGENT_PLUGIN_OUT`) and refuse to wipe a directory that is not a previous build of theirs. Tests never build into `dist/`: they go through `buildPluginInto()` / `buildAgentPluginInto()` in `tests/helpers.cjs`, which build into private temp directories, because `node --test` runs files in parallel and two files rebuilding one directory raced.

The skills in the Agent Plugins bundle come from the same unified-skills compiler the installer's `--unified-skills` path uses (`rewriteUnifiedSkillCommandContent`, `convertClaudeCommandToUnifiedSkill` in `bin/install-lib.cjs`). Do not add a second converter: `tests/unified-skills-install.test.cjs` pins the installer's output and `tests/agent-plugin-build.test.cjs` pins the bundle's, including that the Claude plugin stays byte-identical.

## Release Process

1. Run all tests: `npm run test:all` (all must pass)
2. Build hooks: `npm run build:hooks`
3. Update version in `package.json` — and the `version` of the `pan-wizard` entry in `.github/plugin/marketplace.json`, which a test pins to it
4. Update `CHANGELOG.md` with new version entry
5. `npm publish` (triggers `prepublishOnly`, which runs the release-check gates — tests, hook rebuild, npm pack dry-run, etc.)
