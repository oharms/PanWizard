# PAN Wizard Development Guide

## Prerequisites
- Node.js >= 16.7.0
- No other dependencies (zero runtime deps)

## Project Structure

```text
pan-wizard/
  bin/
    install.js                # Interactive installer (npx pan-wizard entry point)
    install-lib.cjs           # Installer functions — no filesystem writes (verifyInstall()/dirDigest() read the filesystem; the merge helpers stripPanHookEntries()/mergeCodexHooksConfig()/mergeMcpRegistration() edit the object they are given): converters, parsers, MCP_REGISTRATION, HOOK_EVENT_MAP
  package.json                # Zero runtime deps; devDependencies are the VS Code e2e harness only
  commands/pan/               # Command .md files (Claude Code format; converted per runtime at install)
  agents/                     # Agent .md files (specialized AI roles)
  pan-wizard-core/
    bin/
      pan-tools.cjs           # CLI dispatcher — all commands/agents call this
      lib/                    # Core CJS modules (responsibilities and the dependency graph: ARCHITECTURE.md)
        constants.cjs         # Shared path constants, file patterns, regex, FOREIGN_PLANNING_MARKERS
        core.cjs              # Model profiles, output()/error() exit-code contract, toPosix(), loadConfig()
        utils.cjs             # readJsonFile, planningPath()/planningRel() (built on planning-root), listPhaseDirs
        planning-root.cjs     # Which .planning tree a command acts on: --track / --planning-dir + provenance (ADR-0043)
        lock.cjs              # Advisory file locking + atomic writes for .planning/ concurrency (ADR-0030)
        config.cjs            # Config CRUD (dot-notation get/set), standards catalog
        state.cjs             # state.md operations + frontmatter sync
        state-compact.cjs     # state compact — archive settled history to state-history.md (ADR-0044)
        init.cjs              # Compound init commands (bootstrap context per workflow)
        phase.cjs             # Phase CRUD facade; phase-remove.cjs — removal + renumbering cascade
        roadmap.cjs           # roadmap.md parsing (get-phase, analyze)
        verify.cjs            # Verification + health facade; verify-{drift,retro,deploy,preflight}.cjs re-exported
        foreign-planning.cjs  # Is this .planning/ another tool's? (gsd-core markers) — hygiene, health and init consult it
        milestone.cjs         # Milestone lifecycle (archive, milestones.md)
        frontmatter.cjs       # YAML-like frontmatter CRUD
        commands.cjs          # Misc facade: history-digest, scaffold, progress, todo, commit; commands-learnings.cjs re-exported
        template.cjs          # Template loading from templates/
        context-budget.cjs    # Context window utilization, cache block classification, cache.ttl recommendation
        focus.cjs             # Strategic project management: scan, plan, sync, exec, design, auto
        codebase.cjs          # Codebase analysis: language detection, imports, best practices
        memory.cjs            # Cross-phase agent memory; memory-optimize.cjs and memory-rebuild.cjs (ADR-0040)
        agents-md.cjs         # AGENTS.md PAN section + CLAUDE.md bridge (shared by the installer and memory rebuild)
        cost.cjs              # Token ledger, dated rate table, managed modelPricing (Y-6); models check
        cost-rebuild.cjs      # `cost rebuild`: the ledger regenerated from Claude Code transcripts (v3.29)
        bus.cjs               # Agent message channels (Y-7)
        preview.cjs           # Foresight: phase blast radius, dependency graph (Y-1)
        review-deep.cjs       # Deep review merge (reviewer + hardener + meta) (Y-2)
        knowledge.cjs         # Grounded Q&A / discuss / playbook (Y-3)
        whatif.cjs            # Counterfactual phase replay in worktree (Y-4)
        bridge.cjs            # MCP discovery + recommendation — the CLIENT side (Y-5)
        optimize.cjs          # Circular optimization loop (trace, learn, apply) (v3.5)
        git.cjs               # /pan:git command family (v3.5)
        distill.cjs           # AI code-bloat 5-pass optimizer (v3.5)
        doc-lint.cjs          # Markdown frontmatter+structure linter; `doc-lint counts` is release Gate 4
        links.cjs             # Doc–code link graph: `links validate` (ADR-0027); release Gate 5
        suggest.cjs           # "Did you mean" for unknown commands — error path only
        experiment.cjs        # Self-improvement loop scaffolding; runner.cjs — external agent runner
        learn-lint.cjs        # Learnings-store integrity linter (L-001..L-006)
        learn-index.cjs       # Learnings index + topics-for queries (per-agent relevance)
        squads.cjs            # Squad registry — army roles architecture/build/quality/release (ADR-0032)
        worktree.cjs          # Branch-per-agent git worktree isolation for parallel builders (ADR-0033)
        campaign.cjs          # Scheduled self-resuming army campaigns ("dreaming") (ADR-0034)
        hud.cjs               # Single self-contained HTML dashboard of project + bot army (ADR-0035)
        phase-report.cjs      # Per-phase HTML report + timeline index (v3.15)
        skill-align.cjs       # Skill-Aligned Decomposition pass for the planner (ADR-0038)
        hygiene.cjs           # Project cleanup + version alignment (scan/clean)
    mcp/                      # MCP bridge — the SERVER side: zero-dep JSON-RPC stdio server over pan-tools (ADR-0041)
    workflows/                # Workflow .md files (multi-step procedures); the native Claude Code workflow scripts are generated by buildNativeWorkflowScripts() in bin/install-lib.cjs at install and plugin-build time, not stored here
    references/               # Reference .md files (loaded by agents)
    templates/                # Template files (scaffolding)
    learnings/                # Learnings store (universal/ ships; internal/ is stripped by the installer)
  hooks/
    pan-*.js                  # Hook sources (pure Node.js)
    dist/                     # Build output — copied, not bundled; gitignored
      pan-statusline.js       # Writes context metrics bridge file
      pan-context-monitor.js  # Injects context warnings to agent
      pan-check-update.js     # Periodic update check (spawns `npm view pan-wizard version`)
      pan-cost-logger.js      # SubagentStop hook — appends cost record to tokens.jsonl (v3.4)
      pan-trace-logger.js     # SubagentStop hook — circular optimization tracing (v3.5)
      pan-stop-guard.js       # Stop hook (AfterAgent on Gemini CLI, agentStop on Copilot CLI) — blocks the auto-advance boundary drop once (v3.24)
      pan-state-reinject.js   # SessionStart hook, matcher compact — re-injects the planning position after a compaction
  scripts/
    build-hooks.js            # Copy hooks/ → hooks/dist/ (no bundling)
    build-plugin.js           # Claude Code plugin → dist/pan-wizard-plugin/
    build-agent-plugin.js     # Agent Plugins 1.0 bundle → dist/pan-agent-plugin/ (ADR-0045)
    plugin-path.js            # Rebuilds the plugin and prints its path as one stdout line (command-source marketplace contract)
    release-check.js          # The release gates — `npm run release:check`, also `prepublishOnly`
    deprecate-old-versions.js # Post-publish housekeeping; dry-run by default, `--apply` to act; never unpublishes
    npm-dist-tag.js           # Prints the npm dist-tag a version publishes under (next for a prerelease, latest otherwise)
    run-tests.cjs             # Glob-free test runner (the CI matrix shells do not expand test globs)
    install-git-hooks.js      # `prepare` script — points core.hooksPath at scripts/git-hooks/ (the gitleaks pre-commit scan)
    generate-skills-docs.py   # Regenerates docs/SKILLS-REFERENCE.md and docs/SKILLS-FULL-TEXT.md
    test-surface.cjs          # Shipped-surface registry → tests/fixtures/surface.json (--write/--check/--map/--scaffold)
    coverage-gate.cjs         # Suite under Node coverage: dispatcher arms + floors (release Gate 9)
    test-quality-lint.cjs     # Vacuous-assertion lint rules applied by tests/test-quality.test.cjs
    mutation-probe.cjs        # Report-only mutation probe (npm run test:mutate)
    git-hooks/                # Tracked pre-commit hook (gitleaks)
  harness/                    # PAN Harness — behavioural scenarios against installs built from a packed artifact (ADR-0047); not shipped
  marketplace/                # Local command-source Claude plugin marketplace for the dev loop; not shipped
  .agents/plugins/marketplace.json   # Codex marketplace → ./dist/pan-agent-plugin (build first)
  .github/plugin/marketplace.json    # Copilot marketplace → ./dist/pan-agent-plugin (its version is pinned to package.json by a test)
  pan-zcode/                  # Experimental: ZCode subsystem — a consumer of the shared MCP bridge, with its own installer
  tests/                      # Test suite (node:test + node:assert)
    helpers.cjs               # runPanTools(), createTempProject(), cleanup(), buildPluginInto(), buildAgentPluginInto()
    *.test.cjs                # Unit test files
    scenarios/                # Scenario test files (installer + integration + workflow)
    fixtures/                 # Pinned fixtures (module export surfaces, Agent Plugins schemas, …)
  docs/                       # User and contributor docs; decisions/ (ADRs), specs/, audits/
  assets/                     # README images (hero, terminal SVG, avatar)
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
npm run release:check   # The release gates — what `npm publish` runs via prepublishOnly (see Release Process)
npm run harness         # Tier 0 of the behavioural harness: model-free, free (see Behavioural Harness)
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
3. Add the agent to `MODEL_PROFILES` and `AGENT_BASE_EFFORT` in `core.cjs`, and set the agent's `effort:` frontmatter to that base effort (`tests/core.test.cjs` pins all three)
4. Reference from workflow .md that spawns it via Task tool
5. That's it — the installer copies every top-level `agents/*.md` file (subdirectories are not scanned), so new agent files ship automatically (no installer edit needed)

## How to Add a Core Module Function

1. Add function to the appropriate `.cjs` file in `pan-wizard-core/bin/lib/`
2. Export via `module.exports`
3. Wire into `pan-tools.cjs` command routing (add case in the main switch), then run `node scripts/test-surface.cjs --write` — `npm run test:surface` fails until the registry is refreshed, `tests/surface-map.test.cjs` until a test names the new verb or subcommand as a quoted CLI argument, and the coverage gate (`npm run test:coverage`) until a test dispatches the new arm
4. Write tests in `tests/` using `node:test` and `node:assert`

## How to Add a Hook

1. Create source in `hooks/your-hook.js`
2. Add the file to `HOOKS_TO_COPY` in `scripts/build-hooks.js`, then run `npm run build:hooks` (copy-only; no bundling — they're pure Node.js)
3. Register it in `bin/install.js` (its `buildHookCommand` call, a row in the settings.json `registrations` table, and the uninstall `panHooks` list), in `bin/install-lib.cjs` (`PAN_SETTINGS_HOOKS`, a `HOOK_EVENT_MAP` slot carrying each runtime's own event name or `null` — `tests/hook-vocabulary.test.cjs` rejects names a runtime does not document — the Codex and Copilot builders `mergeCodexHooksConfig` / `buildCopilotHooksConfig`, which hard-code their event names, the plugin hooks builders, and the name regex in the Codex uninstall filter `removeCodexPanHooks`), in `hookCommands()` in `scripts/build-agent-plugin.js`, and in `EVENT_HOOKS` in `scripts/test-surface.cjs`. A hook Copilot registers must also carry the shared `deferToClaudeRegistration()` copy (the `.github` copy steps aside when the project's Claude settings register the same script) and be added to the `HOOKS` list in `tests/copilot-hook-dedupe.test.cjs`

## Writing Tests

Tests use Node.js built-in `node:test` and `node:assert`. No external framework.

```javascript
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { runPanTools, createTempProject, cleanup } = require('./helpers.cjs');

describe('your feature', () => {
  test('does the thing', () => {
    const tmp = createTempProject();    // Temp dir with an empty .planning/phases/
    try {
      const result = runPanTools('your-command arg', tmp);   // one argument string, not an array
      const data = JSON.parse(result.output);
      assert.strictEqual(data.field, 'expected');
    } finally {
      cleanup(tmp);                     // Always clean up
    }
  });
});
```

### Test Helpers (tests/helpers.cjs)

- `runPanTools(argsString, cwd)` — runs `pan-tools.cjs` with a pre-joined argument string; returns `{ success, output, error? }` where `output` is the raw stdout (`JSON.parse` it yourself)
- `createTempProject()` — creates a temp directory containing an empty `.planning/phases/` scaffold (no options)
- `cleanup(dir)` — Recursively removes temp directory
- `createScenarioRunner(runtime)` — installs PAN for `'claude'|'opencode'|'gemini'|'codex'|'copilot'` into a temp dir; returns `{ tmpDir, installedToolsPath, configDir, run(args, cwd?), cleanup() }`
- `buildPluginInto()` / `buildAgentPluginInto()` — build the two distribution bundles into a fresh private temp directory and return its path (never into `dist/`); the caller owns `cleanup(dir)`
- `TOOLS_PATH`, `INSTALLER_PATH` — absolute paths to `pan-tools.cjs` and `bin/install.js`; `RUNTIME_DIR` — the runtime → config-directory-name map (`claude` → `.claude`, …, `copilot` → `.github`) mirroring the installer's `getDirName`
- `withFakeHome(fn)` — runs `fn(fakeHome)` with `HOME`, `USERPROFILE` and `CLAUDE_CONFIG_DIR` pointed at a fresh temp directory, then restores them; tests never read the developer's real home
- `readLedger(cwd)` — the project's parsed cost-ledger rows (`[]` without a ledger)
- `spawnHook(hookFile, payload, cwd, extraEnv?)` — spawns a hook as its host would (JSON payload on stdin, the project as cwd; a file name in `hooks/` or an absolute installed path); returns `{ status, stdout, stderr }`
- `installInto(cwd, flags)` — runs the installer into `cwd` with the given flags and refuses the source repository

### What the suite must cover, and what an assertion must be

Three checks, run with the rest of the suite, decide this from the code rather than from the tests (the plan is `docs/specs/testing-system-redesign-2026-09.md`):

- **The surface registry.** `node scripts/test-surface.cjs --write` derives every shipped surface — verbs from the dispatcher's usage line, subcommands from its `Unknown … subcommand. Available:` strings, dispatcher `case` arms, installer flag literals, hook × runtime registrations from `HOOK_EVENT_MAP`, MCP tools and resources, config default keys, the content directories — into `tests/fixtures/surface.json`, which is committed and reviewed like code. `tests/surface-map.test.cjs` fails when the registry drifts from the code (`npm run test:surface`) and when a row is named by no test: a verb or subcommand as a quoted CLI argument, a flag as a literal, a hook together with its runtime, an MCP tool by name, a config key as a key. A row without a test goes in `tests/fixtures/surface-allowlist.json` **with a reason**, and the entry fails once a test names it. `node scripts/test-surface.cjs --scaffold <dir>` writes one todo stub per unreferenced row; that is how a suite rebuilt from an empty directory starts.
- **The coverage gate.** `npm run test:coverage` runs the suite under Node's own instrumentation (Node 22+; the processes tests spawn are captured through the inherited `NODE_V8_COVERAGE`) and fails when a dispatcher `case` arm never executed or a module group falls below the floors in `tests/fixtures/coverage-policy.json` (set a point below the measured baseline). An arm no test dispatches yet is allowlisted there with a reason, and the entry fails once a test dispatches it. Release-check Gate 9 runs it; CI runs it as an advisory (`continue-on-error`) step on the Node 22 jobs.
- **The quality lint.** `tests/test-quality.test.cjs` applies `scripts/test-quality-lint.cjs` to every test file and fails on the shapes that have passed while the feature they named was broken: an OR between result-status fields (`output || error` — a crash satisfies it), an in-process call to a lib module's `cmd*` function (they end in `output()`/`error()`, which exit the process, so the test child dies and `node --test` reports the file as one passing test — always go through `runPanTools`), `assert(true)`, CLI output asserted only by its length, a platform conditional that bare-returns instead of `t.skip(reason)`, a wall-clock bound under two seconds, a read of the real home directory, a committed `test.todo`, and an `assert.ok(a.x || a.y)` that only asks whether one of several fields exists. Exceptions live in `tests/fixtures/test-quality-allowlist.json` per file and rule with a count and a reason; an entry that allows more than the file has is stale and fails too.

The two allowlists are the debt register: seeded from the suite as it stood on 2026-09-17 and burned down in the spec's phase 2 — the twelve never-dispatched CLI arms, the four never-dispatched verbs and every "Unknown <group> subcommand" arm are now covered by `tests/dispatcher-arms.test.cjs`, which is driven from the dispatcher's own source rather than a hand-kept list.

A fourth check is **not** part of the gate and is run by hand: `npm run test:mutate` breaks the code on purpose — one small mutation at a time, inside a throwaway `git worktree` so your checkout is never touched — and reports the mutations the suite did not notice. Coverage says a line executed; a surviving mutant says no assertion constrained it. Some survivors are correct (equivalent mutants, defensive `|| 0` defaults, log strings), which is exactly why it reports and never fails: a survivor is a question about whether a behaviour is worth pinning.

### Running Tests

```bash
npm test                                    # Unit tests (npm run test:all adds the scenarios)
node --test tests/phase.test.cjs            # Single file
node scripts/run-tests.cjs tests            # Cross-platform runner; a tests/*.test.cjs glob only expands on bash or Node 22+
npm run test:surface                        # The committed surface registry still matches the code
npm run test:coverage                       # The suite under coverage: dispatcher arms + per-group floors (Node 22+)
npm run harness                             # Tier 0 of the PAN Harness: behavioural, model-free, free
npm run test:mutate                         # Report-only: which deliberate breakages the suite fails to notice
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
| `design-methodology.md` | Shared design method — depth tiers and the quality bar that `pan-designer` (via `/pan:design-phase`) and `focus-design` both hold design artifacts to, and that `pan-design-checker` verifies against |
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
| Phase | context.md, research.md, phase-prompt.md (discovery.md is unreferenced by shipped content) | `/pan:discuss-phase`, `/pan:plan-phase` |
| Codebase | architecture.md, stack.md, conventions.md, concerns.md, integrations.md, structure.md, testing.md, relationships.md, best-practices.md | `/pan:map-codebase` |
| Summary | summary.md, summary-minimal.md, summary-standard.md, summary-complex.md | pan-executor |
| Verification | validation.md, verification-report.md (uat.md is unreferenced by shipped content) | pan-verifier |
| Debug | debug-subagent-prompt.md (debug.md is unreferenced by shipped content) | the `diagnose-issues` workflow (the native `/pan-diagnose-issues` script carries its own inline prompt) |
| Research | research-project/stack.md, features.md, architecture.md, pitfalls.md, summary.md | pan-phase-researcher |
| Planning / execution | user-setup.md (planner-subagent-prompt.md and standards.md are unreferenced by shipped content) | `execute-plan.md` writes `{phase}-USER-SETUP.md` from user-setup.md |
| Lifecycle | milestone-archive.md (continue-here.md, milestone.md and retrospective.md are unreferenced by shipped content — `pause.md` writes `.continue-here.md` from its own inline structure) | `/pan:milestone-done` |
| Spec B v2 | playbook.md (knowledge system), preview-report.md (foresight/preview) | `/pan:knowledge`, `/pan:preview` |
| Design & experiments | design.md, idea.md | `/pan:design-phase` (pan-designer), `/pan:experiment` |
| Config | config.json | Unreferenced by shipped content — `config-ensure-section` writes `buildConfigDefaults()` from `config.cjs`, not this file |

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
| `npm run build:plugin` | `dist/pan-wizard-plugin/` | Claude Code (plugin marketplaces; the local `command`-source test bed in `marketplace/`) | `.claude-plugin/plugin.json`, `commands/`, `agents/`, `hooks/`, `workflows/`, `.mcp.json`, `pan-wizard-core/`, `evals/` (from `harness/plugin-evals/`, checkout builds only) |
| `npm run build:agent-plugin` | `dist/pan-agent-plugin/` | Copilot CLI / VS Code, Codex, Cursor, Kiro — the vendor-neutral **Agent Plugins 1.0** format (ADR-0045) | `plugin.json`, `skills/`, `mcp.json`, `pan-wizard-core/`, `hooks/` (scripts + Codex `hooks.json`), `com.github.copilot/` (agents + hooks) |

Two marketplace files in the repository point at the Agent Plugins build so a checkout can install it without publishing: `.agents/plugins/marketplace.json` (Codex, repo-scoped, discovered automatically inside the repo) and `.github/plugin/marketplace.json` (Copilot, added with `copilot plugin marketplace add`). Both reference `./dist/pan-agent-plugin`, so run the builder first. The release gate (`scripts/release-check.js`, gate 8) builds both bundles into temp directories and fails the release if either does not produce its manifest — and, since `2026-09-10`, digests the local `dist/pan-agent-plugin` (untracked — `dist/` is gitignored) against the fresh build whenever it exists, so a stale bundle behind those two marketplaces fails the release with the fix named.

The vendor directories carry their own verification status, recorded in ADR-0045: the Codex hooks shape and `${PLUGIN_ROOT}` expansion come from Codex's plugin reference; the Copilot namespace and its flat PascalCase hooks come from VS Code's documentation, and a live `copilot plugin install` from a local path has since passed on Copilot CLI 1.0.88 (the bundle lists as `pan-wizard`). No Antigravity variant is emitted — its manifest schema is closed and different.

Both builders take an output override (`PAN_PLUGIN_OUT`, `PAN_AGENT_PLUGIN_OUT`) and refuse to wipe a directory that is not a previous build of theirs. Tests never build into `dist/`: they go through `buildPluginInto()` / `buildAgentPluginInto()` in `tests/helpers.cjs`, which build into private temp directories, because `node --test` runs files in parallel and two files rebuilding one directory raced.

The skills in the Agent Plugins bundle come from the same unified-skills compiler the installer's `--unified-skills` path uses (`rewriteUnifiedSkillCommandContent`, `convertClaudeCommandToUnifiedSkill` in `bin/install-lib.cjs`). Do not add a second converter: `tests/unified-skills-install.test.cjs` pins the installer's output and `tests/agent-plugin-build.test.cjs` pins the bundle's, including that the Claude plugin build carries no bundle token or Agent Plugins artefact.

## Behavioural Harness

`harness/` is the PAN Harness (ADR-0047): JSON scenarios run against installs built from a **packed** artifact. A run packs the repository, extracts the tarball (never `npx`), installs from the package into seeded workspaces, and asserts on what the installed PAN does — the install matrix across the five runtimes, the bridge answering for another project through the per-call `cwd`, the deployed native workflow scripts, the Agent Plugins bundle, live gates on CLIs that are present, and (with a spend cap) whole execution chains. It succeeds the external PanLoop harness and lives in-repo so it cannot be lost separately from the contracts it asserts. Not shipped — `harness/` is outside the package `files` allowlist.

```bash
npm run harness                                    # tier 0 — model-free, free, about a minute
npm run harness:model -- --max-usd 10 --repeat 5   # tier 2 — chain runs; skipped (never green) without a spend cap
```

Tier 0 is the one to run before a release. Model tiers spend your Claude usage (or, for a `cli` step marked `paid: true`, that CLI's credits) and are skipped — never green — without `--max-usd`, which is split across the model-tier scenarios in the run. Run state goes outside the checkout (`D:\pantesting\harness-runs\<run-id>\` on the maintainer's machine); `harness/ledger.jsonl` is the tracked findings history, deduped by signature. A scenario's `requires` (`cli`, `minVersion`) **skips** it with the reason when the environment cannot run it — never a pass — and a model step that never ran is a harness error, not a finding. Every assertion kind has a both-direction test in `tests/harness.test.cjs`; add a kind there first. `harness/README.md` has the scenario schema, the tiers, and the headless background-wait ceiling the runner lifts.

## Release Process

Releases are published by CI from a tag; nothing is published from a laptop. The flow, as run for recent releases:

1. **Gate locally:** `npm run release:check`. It is the same script `prepublishOnly` runs in CI, so a red gate here is a red publish there. In order: hook build; `test:all`; `npm audit --omit=dev`; `doc-lint counts` over `docs/` (no filesystem-derived counts outside `CLAUDE.md`); `links validate` (the doc↔code link graph resolves); `npm pack` size sanity **and zero runtime dependencies**; a smoke install of the packed tarball into a temp directory; both distribution bundles building, with `dist/pan-agent-plugin` digested against the fresh build; and the coverage gate (every dispatcher arm executed plus per-group floors; skipped below Node 22). Run `npm run harness` (tier 0) as well.
2. **Refresh the counts table** in `CLAUDE.md` with the snippet it carries — the only place counts live — and, if any command or dev skill changed, regenerate the skills docs: `python scripts/generate-skills-docs.py`.
3. **Bump the version** in `package.json` and `package-lock.json` — and the `version` of the `pan-wizard` entry in `.github/plugin/marketplace.json`, which a test pins to it.
4. **Turn `## [Unreleased]` into `## [x.y.z] - YYYY-MM-DD`** in `CHANGELOG.md`.
5. **Commit as `release(x.y.z): …`** on a `release/vx.y.z` branch and open a PR to `main`. The required checks (secret scan, audit, the OS × Node test matrix) must be green before merge; CodeQL also runs but is not a required check.
6. **Tag the merge commit and push the tag by explicit refspec:**

   ```bash
   git tag vx.y.z && git push origin refs/tags/vx.y.z
   ```

   A `v*` tag triggers `.github/workflows/release.yml`, which reruns the gates through `prepublishOnly`, publishes with npm provenance, and **creates the GitHub Release** from the `CHANGELOG.md` section for that version. The npm dist-tag comes from the version (`scripts/npm-dist-tag.js`): a prerelease such as `3.31.0-rc.1` publishes under `next` and its GitHub Release is marked as a prerelease, never Latest, so `npm install pan-wizard` keeps resolving to the newest stable release; a plain version publishes under `latest`. Do not rely on `git push --follow-tags` — it has silently dropped the tag before, and then nothing publishes.

   The Release step landed after 3.29.0 was tagged (that release object was created by hand). Before it, the workflow published to npm and stopped, so nine tagged versions (3.20.0–3.22.0 and 3.24.0–3.28.0) carry a tag and an npm release but no release object. The step is `continue-on-error` — the package is already published by the time it runs, so a failure there is a cosmetic omission rather than a failed release — and the run summary states plainly whether the release exists, so an omission is visible instead of silent. A re-run never clobbers an existing release.
7. **After a successful publish:** the workflow already ran `deprecate-old-versions.js --apply` and created the Release; check the run summary for both. Then upgrade the installs you maintain with the installer. When sweeping `d:\` for installs to upgrade, exclude **everything** under `d:\pantesting\` except the root — its subdirectories are audit fixtures pinned to the version they were made on, and a name-based denylist has missed them before.
