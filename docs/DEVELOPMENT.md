# PAN Wizard Development Guide

## Prerequisites
- Node.js >= 16.7.0 to run PAN (`engines` in `package.json`; `websearch` with a Brave key needs Node 18+ for the global `fetch` it calls); CI runs the test suite on Node 18, 20 and 22, and the coverage gate needs Node 22
- No other dependencies (zero runtime deps)

## Project Structure

```text
pan-wizard/
  bin/
    install.js                # Interactive installer (npx pan-wizard entry point)
    install-lib.cjs           # Installer functions — no filesystem writes (verifyInstall()/verifyHookEntrypoints()/dirDigest() read the filesystem; the merge and strip helpers stripPanHookEntries()/mergeCodexHooksConfig()/removeCodexPanHooks()/mergeMcpRegistration()/stripMcpRegistration()/addOpencodePermissions()/stripOpencodePermissions() edit the object they are given): converters, parsers, MCP_REGISTRATION, HOOK_EVENT_MAP
  package.json                # Zero runtime deps; devDependencies are the VS Code e2e harness only
  commands/pan/               # Command .md files (Claude Code format; converted per runtime at install)
  agents/                     # Agent .md files (specialized AI roles)
  pan-wizard-core/
    bin/
      pan-tools.cjs           # CLI dispatcher — all commands/agents call this
      lib/                    # Core CJS modules (responsibilities and the dependency graph: ARCHITECTURE.md)
        constants.cjs         # Shared path constants, file patterns, regex, FOREIGN_PLANNING_MARKERS
        core.cjs              # Model profiles, output()/error() exit-code contract, toPosix(), loadConfig(), toLf()/dominantEol()/withEol()
        utils.cjs             # readJsonFile, planningPath()/planningRel() (built on planning-root), listPhaseDirs
        planning-root.cjs     # Which .planning tree a command acts on: --track / --planning-dir + provenance (ADR-0043)
        lock.cjs              # Advisory file locking + atomic writes for .planning/ concurrency (ADR-0030)
        config.cjs            # Config CRUD (dot-notation get/set), standards catalog
        state.cjs             # state.md operations + frontmatter sync
        state-compact.cjs     # state compact — archive settled history to state-history.md (ADR-0044)
        init.cjs              # Compound init commands (bootstrap context per workflow)
        phase.cjs             # Phase CRUD facade; phase-remove.cjs — removal + renumbering cascade
        roadmap.cjs           # roadmap.md parsing (get-phase, analyze, update-plan-progress) and `roadmap slice` — one phase's slice of roadmap.md + requirements.md
        roadmap-compact.cjs   # roadmap compact — move shipped phases' sections to roadmap-history.md, leaving a stub (ADR-0044)
        verify.cjs            # Verification + health facade; verify-{drift,retro,deploy,preflight,scope}.cjs re-exported
        verify-plan-set.cjs   # `verify plan-set`: requirement coverage, same-wave file overlap and dependency checks in code; plan-check hashes and drift
        verify-integrity.cjs  # `verify test-integrity`: a phase's plan commits checked for deleted, skipped or weakened tests
        phase-gate.cjs        # `phase gate`: may a phase be marked complete; `phase complete`, exec-waves and the MCP merge request call it (`workflow.phase_gate`)
        foreign-planning.cjs  # Is this .planning/ another tool's? (gsd-core markers; planning-with-files markers make it shared, not foreign) — hygiene, health and init consult it
        milestone.cjs         # Milestone lifecycle (archive, milestones.md)
        frontmatter.cjs       # YAML-like frontmatter CRUD
        commands.cjs          # Misc facade: history-digest, scaffold, progress, todo, commit; commands-learnings.cjs re-exported
        template.cjs          # template select (picks a summary template) + template fill (built-in generators); reads nothing in templates/
        context-budget.cjs    # Context window utilization, cache block classification, cache.ttl recommendation
        focus.cjs             # Strategic project management: scan, plan, sync, exec, design, auto
        codebase.cjs          # Codebase analysis: language detection, imports, best practices
        memory.cjs            # Agent memory store: cited, expiring entries, not loaded into agents (ADR-0036); memory-optimize.cjs and memory-rebuild.cjs (ADR-0040)
        agents-md.cjs         # AGENTS.md PAN section + CLAUDE.md block: the @AGENTS.md import and a Compact instructions section (shared by the installer and memory rebuild)
        cost.cjs              # Token ledger, dated rate table, managed modelPricing (Y-6); models check; the p10/p50/p90 cost forecast `preview phase` reports
        cost-rebuild.cjs      # `cost rebuild`: the ledger regenerated from Claude Code transcripts (v3.29)
        bus.cjs               # Agent message channels (Y-7)
        preview.cjs           # Foresight: phase blast radius, dependency graph (Y-1)
        review-deep.cjs       # Deep review merge (reviewer + hardener + meta) (Y-2)
        verdict.cjs           # The pan-verdict contract: parses and validates a judge's block, or the verifier's verification.md frontmatter (ADR-0049)
        findings.cjs          # Findings ledger .planning/findings.jsonl: findings record/list/dispose/debt, and the suppressions a dismissal teaches until its file changes (ADR-0049)
        test-gate.cjs         # The test gate: `test run` / `test detect` — runs the project's own tests and parses the runner's output
        verify-red.cjs        # `verify red`: each phase test must fail at the phase's base and pass at HEAD; mutate.cjs — the `verify mutate` report
        plan-lint.cjs         # `verify review-focus` and `verify decisions`: a plan's Review Focus and its design-decision citations, checked in code
        research-lint.cjs     # `research lint`: research claims carry a source and a checked date, and go stale by type
        usage.cjs             # `usage`: local census of installed commands and agents (used, never used, unfinished) from the cost ledger and traces
        knowledge.cjs         # Grounded Q&A / discuss / playbook (Y-3)
        whatif.cjs            # Counterfactual phase replay in worktree (Y-4)
        optimize.cjs          # Circular optimization loop (trace, learn, apply, revert) (v3.5)
        git.cjs               # /pan:git command family (v3.5)
        distill.cjs           # AI code-bloat 5-pass optimizer (v3.5)
        doc-lint.cjs          # Markdown frontmatter+structure linter; `doc-lint counts` is release Gate 4
        links.cjs             # Doc–code link graph: `links validate` (ADR-0027); release Gate 5
        suggest.cjs           # "Did you mean" for unknown commands — error path only
        experiment.cjs        # Self-improvement loop scaffolding; runner.cjs — external agent runner
        learn-lint.cjs        # Learnings-store integrity linter (L-001..L-007)
        learn-index.cjs       # Learnings index + topics-for queries (per-agent relevance, or matched to the task with --cue)
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
    opencode/                 # pan-wizard.js — OpenCode plugin, installed as <opencode dir>/plugins/pan-wizard.js; keeps PAN's position through a compaction
  hooks/
    pan-*.js                  # Hook sources (pure Node.js)
    dist/                     # Build output — copied, not bundled; gitignored
      pan-statusline.js       # Writes context metrics bridge file
      pan-context-monitor.js  # PostToolUse hook — injects a context note before the host compacts (bridge file, else the session transcript)
      pan-check-update.js     # Periodic update check (spawns `npm view pan-wizard version`)
      pan-cost-logger.js      # SubagentStop hook — appends cost record to tokens.jsonl (v3.4)
      pan-trace-logger.js     # SubagentStop hook — circular optimization tracing (v3.5)
      pan-guard.js            # PreToolUse hook (BeforeTool on Gemini CLI, preToolUse on Copilot CLI) — reports or denies credential writes (A7)
      pan-stop-guard.js       # Stop hook (AfterAgent on Gemini CLI, agentStop on Copilot CLI) — blocks the auto-advance boundary drop once (v3.24)
      pan-state-reinject.js   # SessionStart hook, matcher compact (Claude Code, Codex); PreCompress then AfterTool on Gemini CLI, preCompact then postToolUse on Copilot CLI — re-injects the planning position after a compaction
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
    local-ci.cjs              # The CI gates on this machine (`npm run ci:local`); see Local CI
    install-pre-push.cjs      # Opt-in switch for the pre-push hook (`npm run hooks:pre-push`, `-- --off`)
    land.cjs                  # Squash-land a branch on main after a passing ci:local (`npm run land -- <branch>`)
    local-schedule.cjs        # Weekly Task Scheduler checks: code scan, npm outdated, market watch (`npm run ci:schedule`)
    generate-skills-docs.py   # Regenerates docs/SKILLS-REFERENCE.md and docs/SKILLS-FULL-TEXT.md
    test-surface.cjs          # Shipped-surface registry → tests/fixtures/surface.json (--write/--check/--map/--scaffold); also the liveness registry (--liveness)
    coverage-gate.cjs         # Suite under Node coverage: dispatcher arms + floors (release Gate 9)
    test-quality-lint.cjs     # Vacuous-assertion lint rules applied by tests/test-quality.test.cjs
    prompt-lint.cjs           # Prompt-contract lint over shipped prompts, applied by tests/prompt-lint.test.cjs
    build-help.cjs            # Writes /pan:help's command index from command frontmatter (--write, --check); tests/help-generated.test.cjs fails when stale
    mutation-probe.cjs        # Report-only mutation probe (npm run test:mutate)
    git-hooks/                # Tracked hooks: pre-commit (gitleaks), pre-push (local CI fast subset; inert until opted in)
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
npm run ci:local        # Every CI gate on this machine, in parallel (see Local CI)
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
6. No installer edit is needed — the installer copies `commands/pan/` recursively, so new command files ship automatically. Give the file frontmatter that `pan-tools doc-lint commands/pan` accepts, with a `group` and a `description` (the `/pan:help` index is generated from them), run `node scripts/build-help.cjs --write` and `node scripts/test-surface.cjs --write` (the surface registry lists every command file), name the command in a harness scenario or give it a reason in `tests/fixtures/liveness-allowlist.json`, and refresh the Commands row of the counts table in `CLAUDE.md`, or `npm test` fails (`tests/doc-lint.test.cjs`, `tests/help-generated.test.cjs`, `tests/surface-map.test.cjs`, `tests/claude-md-counts.test.cjs`)

## How to Add a New Agent

1. Create `agents/pan-your-agent.md`
2. Define role, context requirements, constraints, output format using XML structure
3. Add the agent to `MODEL_PROFILES` and `AGENT_BASE_EFFORT` in `core.cjs`, and set the agent's `effort:` frontmatter to that base effort (`tests/core.test.cjs` pins all three)
4. Reference from workflow .md that spawns it via Task tool
5. No installer edit is needed — the installer copies every top-level `agents/*.md` file (subdirectories are not scanned), so new agent files ship automatically. Run `node scripts/test-surface.cjs --write` (the surface registry lists every agent file), name the agent in a harness scenario or give it a reason in `tests/fixtures/liveness-allowlist.json`, and refresh the Agents row of the counts table in `CLAUDE.md`, and place the agent in a squad or the worker list in `pan-wizard-core/bin/lib/squads.cjs`, or `npm test` fails (`tests/surface-map.test.cjs`, `tests/claude-md-counts.test.cjs`, `tests/squads.test.cjs`)

## How to Add a Core Module Function

1. Add function to the appropriate `.cjs` file in `pan-wizard-core/bin/lib/`
2. Export via `module.exports`, then regenerate `tests/fixtures/module-surface.json` with the one-liner in the header of `tests/module-surface.test.cjs`, which pins every module's exports
3. Wire into `pan-tools.cjs` command routing (add case in the main switch) and name the new verb in the usage line's `Commands:` list, or the new subcommand in its group's `Unknown … subcommand. Available:` string — the surface registry and `tests/doc-command-surface.test.cjs` read them from there — then run `node scripts/test-surface.cjs --write` — `npm run test:surface` fails until the registry is refreshed, `tests/surface-map.test.cjs` until a test names the new verb (quoted, or after `pan-tools`) or the new subcommand (`<verb> <sub>`, quoted or not), and the coverage gate (`npm run test:coverage`) until a test dispatches the new arm
4. Write tests in `tests/` using `node:test` and `node:assert`

## How to Add a Hook

1. Create source in `hooks/your-hook.js`
2. Add the file to `HOOKS_TO_COPY` in `scripts/build-hooks.js`, then run `npm run build:hooks` (copy-only; no bundling — they're pure Node.js)
3. Register it in `bin/install.js` (its `buildHookCommand` call, a row in the settings.json `registrations` table, its command in the `verifyHookEntrypoints` list and in the Codex and Copilot builder calls, and the uninstall `panHooks` list), in `bin/install-lib.cjs` (`PAN_SETTINGS_HOOKS`, a `HOOK_EVENT_MAP` slot carrying each runtime's own event name or `null` — `tests/hook-vocabulary.test.cjs` rejects names a runtime does not document — the Codex and Copilot builders `mergeCodexHooksConfig` / `buildCopilotHooksConfig`, which hard-code their event names, the plugin hooks builders, and the name regex in the Codex uninstall filter `removeCodexPanHooks`), in `hookCommands()` in `scripts/build-agent-plugin.js`, and in `EVENT_HOOKS` in `scripts/test-surface.cjs`. Then run `node scripts/test-surface.cjs --write`, name the hook together with each runtime it registers on in a test, give it a driver in `DRIVERS` in `tests/hooks-e2e.test.cjs`, and refresh the Hooks row of the counts table in `CLAUDE.md`, or `npm test` fails (`tests/surface-map.test.cjs`, `tests/hooks-e2e.test.cjs`, `tests/claude-md-counts.test.cjs`). A hook Copilot registers must also carry the shared `deferToClaudeRegistration()` copy (the `.github` copy steps aside when the project's Claude settings register the same script) and be added to the `HOOKS` list in `tests/copilot-hook-dedupe.test.cjs`, unless Claude's registration of the script can never fire under Copilot, as with `pan-state-reinject.js` (its header says why)

## Writing Tests

Tests use Node.js built-in `node:test` and `node:assert`. No external framework — the one exception is the opt-in VS Code e2e harness in `tests/e2e/` (`npm run test:vscode`), which runs on Playwright.

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

The checks below decide this from the code rather than from the tests — the registry and the two lints run with the rest of the suite, the coverage gate as a run of its own (the plan is `docs/specs/testing-system-redesign-2026-09.md`):

- **The surface registry.** `node scripts/test-surface.cjs --write` derives every shipped surface — verbs from the dispatcher's usage line, subcommands from its `Unknown … subcommand. Available:` strings, dispatcher `case` arms, installer flag literals, hook × runtime registrations from `HOOK_EVENT_MAP`, MCP tools and resources, config default keys, the content directories — into `tests/fixtures/surface.json`, which is committed and reviewed like code. `tests/surface-map.test.cjs` fails when the registry drifts from the code (`npm run test:surface`) and when a row is named by no test: a verb quoted or after `pan-tools`, a subcommand as `<verb> <sub>` (a comment counts), a flag as a literal, a hook together with its runtime, an MCP tool by name, a config key as a key. A row without a test goes in `tests/fixtures/surface-allowlist.json` **with a reason**, and the entry fails once a test names it. `node scripts/test-surface.cjs --scaffold <dir>` writes one todo stub per unreferenced row; that is how a suite rebuilt from an empty directory starts.
- **The coverage gate.** `npm run test:coverage` runs the suite under Node's own instrumentation (Node 22+; the processes tests spawn are captured through the inherited `NODE_V8_COVERAGE`) and fails when a dispatcher `case` arm never executed, or when overall line or function coverage, or a module group's line coverage, falls below its floor in `tests/fixtures/coverage-policy.json` (set a point below the measured baseline). An arm no test dispatches yet is allowlisted there with a reason, and the entry fails once a test dispatches it. Release-check Gate 9 runs it; CI runs it as an advisory (`continue-on-error`) step on the Node 22 jobs.
- **The quality lint.** `tests/test-quality.test.cjs` applies `scripts/test-quality-lint.cjs` to every test file and fails on the shapes that have passed while the feature they named was broken: an OR between result-status fields (`output || error` — a crash satisfies it), an in-process call to a lib module's `cmd*` function (they end in `output()`/`error()`, which exit the process, so the test child dies and `node --test` reports the file as one passing test — always go through `runPanTools`), `assert(true)`, CLI output asserted only by its length, a platform conditional that bare-returns instead of `t.skip(reason)`, a wall-clock bound under two seconds, a read of the real home directory, a committed `test.todo`, and an `assert.ok(a.x || a.y)` that only asks whether one of several fields exists. Exceptions live in `tests/fixtures/test-quality-allowlist.json` per file and rule with a count and a reason; an entry that allows more than the file has is stale and fails too.
- **The prompt-contract lint.** `tests/prompt-lint.test.cjs` applies `scripts/prompt-lint.cjs` to `commands/pan`, `agents` and `pan-wizard-core/workflows` and fails when a `pan-tools` call names a verb or subcommand the engine does not have, an agent is told to use a tool it is not granted, a prompt @-includes engine source, an AskUserQuestion offers more than four options, a spawn names no model (or a role spawn no agent type), or a shipped prompt sends the user to a dev-only skill. Exceptions live in `tests/fixtures/prompt-lint-allowlist.json` with a reason; a stale entry fails.

The allowlists are the debt register: seeded from the suite as it stood on 2026-09-17 and burned down in the spec's phase 2 — the never-dispatched CLI arms and verbs and every "Unknown <group> subcommand" arm are now covered by `tests/dispatcher-arms.test.cjs`, which is driven from the dispatcher's own source rather than a hand-kept list.

One more check is **not** part of the gate and is run by hand: `npm run test:mutate` breaks the code on purpose — one small mutation at a time, inside a throwaway `git worktree` so your checkout is never touched — and reports the mutations the suite did not notice. Coverage says a line executed; a surviving mutant says no assertion constrained it. Some survivors are correct (equivalent mutants, defensive `|| 0` defaults, log strings), which is exactly why it reports and never fails: a survivor is a question about whether a behaviour is worth pinning.

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

## Local CI

`npm run ci:local` (`scripts/local-ci.cjs`) runs the gates GitHub CI runs, on this machine and in parallel, so a change can be verified without a pull request. Each gate writes its log to `.ci-local/logs/<gate>.log`; the run writes `.ci-local/report.json` (gitignored) and prints a one-screen summary.

| Gate | What it runs | Needs |
|---|---|---|
| `host-node18`, `-20`, `-22` | The unit and scenario suite on the host, once per Node version | fnm with those versions; without fnm, the suite runs once on the current Node (`host-node<current>`) and the others are reported skipped |
| `linux-node18`, `-20`, `-22` | The suite in `node:<N>-bookworm` containers: the checkout is mounted read-only, copied in without `node_modules` and `.git`, given its own one-commit repo, then `npm ci`, `build:hooks` and `test:all` as the unprivileged `node` user (as root, the tests that force a failed write on a read-only file cannot fail the write) | Docker running |
| `harness` | The PAN Harness at tier 0 with `--no-ledger`, requiring the double-backed scenarios to run (`--require-run`), so a missing Claude Code CLI fails instead of skipping | the Claude Code CLI |
| `gitleaks` | `gitleaks detect` over the history with `.gitleaks.toml` | gitleaks |
| `audit` | `npm audit --omit=dev --audit-level=high` | network |
| `links` | `pan-tools links validate` | — |
| `surface` | `scripts/test-surface.cjs --check` (the suite checks it too; this gate names the failure) | — |
| `coverage` | `scripts/coverage-gate.cjs` | Node 22+ |
| `codescan` | Only with `--codescan`: the CodeQL CLI's `security-extended` suite over the whole tree when it is installed, failing on a result at error level or with a security severity of high or above (what GitHub's code-scanning check blocked on) unless its rule and file are accepted, with a reason, in `.codeql-accepted.json` (seeded from the alerts dismissed on GitHub; an acceptance that no longer matches is reported stale); else Semgrep in Docker (`p/javascript`, `p/nodejs`) on the JavaScript files changed against `main` (`--codescan-all` for the whole tree). `--codescan=codeql` or `=semgrep` picks one | the CodeQL CLI, or Docker |
| `clean-tree` | After every other gate: the working tree is as it was when the run started. Work you had not committed is fine; a gate that writes into the checkout is not | git |

Whole-suite runs are scheduled so they do not starve each other: the three containers run first, together, then the host suite runs (one per Node version, then the coverage gate, which runs the suite again under instrumentation) one at a time. A host suite run beside another one, or beside the containers, times its 30-second setup hooks out. The harness and the light gates run beside all of it. Each host suite run also caps how many test files run at once (`PAN_TEST_CONCURRENCY`, read by `scripts/run-tests.cjs`; half the cores, at most 16): Node's default of one file per core but one made the Node 22 suite's wall-clock checks miss their bounds on a 40-core machine even alone, which GitHub's 4-core runners never saw. Each gate gets its own temp directory, so a test that uses a fixed name under the OS temp directory never meets another gate's copy of itself; a failed gate's temp directory is kept. One run per checkout: `.ci-local/run.lock` refuses a second.

A tool that is not installed is reported **SKIP** with how to install it, never PASS, and the summary says skipped gates did not run. Any FAIL exits 1; `--strict` makes a skip fail too. Other flags: `--only host,gitleaks` (gates whose id starts with a listed name), `--no-docker`, `--jobs N` (light gates at once, default 6), `--root <dir>`, `--out <dir>` (report, logs and lock somewhere other than `.ci-local/`), `--json`.

A full run (no `--only`, no `--fast`) also records its verdict for the commit it ran on in the git directory (`pan-ci-local/<sha>.json`, shared by every worktree). That record is what `npm run land` checks.

What stays on GitHub: the macOS jobs in `.github/workflows/ci.yml` (no Mac here; they caught the 8 KB stdout truncation in PR #52) and the npm release (`release.yml`), which publishes with provenance through OIDC trusted publishing.

**Tools.** Install once (`winget` on Windows):

```bash
winget install --id Gitleaks.Gitleaks -e
```

```bash
winget install --id Schniz.fnm -e
```

then, in a new shell, `fnm install 18`, `fnm install 20` and `fnm install 22`. The pre-commit hook starts scanning as soon as gitleaks is on `PATH`. For CodeQL (free for this public repository), download `codeql-bundle-win64.tar.gz` from the latest `codeql-bundle-v*` release of `github/codeql-action`, check it against the `.checksum.txt` beside it, and unpack it to `%USERPROFILE%\.codeql-cli`, where `local-ci.cjs` finds `codeql\codeql.exe` without a `PATH` entry. Keep tool data out of `AppData` when installing from a packaged app's terminal (the Claude desktop app's included): its writes there go to a private, virtualised copy that your own shells and Task Scheduler never see. That is why the bundle goes under `%USERPROFILE%`, and why `FNM_DIR` is set to `%USERPROFILE%\.fnm` (`setx FNM_DIR %USERPROFILE%\.fnm`) before `fnm install`. The CodeQL download:

```bash
gh release download -R github/codeql-action -p "codeql-bundle-win64.tar.gz*"
```

### Landing a change

With no pull request, a change goes branch → `ci:local` → `land`:

1. Work on a branch. Keep it up to date with `origin/main` (merge or rebase).
2. Commit everything, then run the full `npm run ci:local` on that commit. It has to start from a clean tree: uncommitted work means the gates did not test the commit alone, and `land` refuses that verdict.
3. `npm run land -- <branch>` (`scripts/land.cjs`). It refuses unless the full run passed on the branch's current HEAD with no gate skipped (`--allow-skips` overrides that one) and the branch contains `origin/main`. Then it fetches, fast-forwards `main` to `origin/main` in the checkout that has `main` (or a temporary worktree), squash-merges the branch, checks that the result is exactly the tree `ci:local` passed, commits it with the branch's summary (the first commit's subject, or `--title`; the body lists every commit), and pushes `main` to `origin`. It never force-pushes; a rejected push leaves the commit on the local `main` and says so. `--dry-run` shows the commit without making it, `--no-push` stops before the push.

GitHub is the mirror and the publisher. Since `2026-10-22`, branch protection on `main` requires only the three macOS `test` jobs, and no pull request, so `land` can push; a required check GitHub no longer runs would reject every push. The first changes landed this way were the H10 pairs (`0bb48b7`, `45323c9`).

### Scheduled checks

`npm run ci:schedule -- --install` (`scripts/local-schedule.cjs`) registers three weekly Windows Task Scheduler tasks for the current user (no admin), in place of GitHub's scheduled workflows and Dependabot:

| Task | When | Runs |
|---|---|---|
| `PanWizard-codescan` | Sunday 03:00 | `local-ci.cjs --only codescan --codescan-all`: CodeQL over the whole tree when installed, else Semgrep in Docker |
| `PanWizard-outdated` | Monday 09:00 | `npm outdated`, as a table of current, wanted and latest versions |
| `PanWizard-market-watch` | Monday 09:10 | `harness/autopilot/market-watch.cjs` |

A run missed while the machine was off starts when it is next on. The tasks run in the repository's main worktree (`--root` picks another checkout; `--node` another `node.exe`) and write to `.ci-local/scheduled/<task>/` there: a dated `.md` summary, its `.log`, and `last-run.json`, which the weekly State of PAN (`harness/autopilot/state-of-pan.cjs`) links. `--list` shows the tasks, their last result and the latest reports; `--uninstall` removes exactly the tasks `--install` added; `--run <codescan|outdated|market-watch>` runs one by hand. Off Windows, `--install` prints the equivalent crontab lines.

**Pre-push hook.** `scripts/git-hooks/pre-push` runs `local-ci.cjs --fast`: the suite on the current Node, the harness at tier 0 and gitleaks. It is tracked, but does nothing until you opt in for your clone with `npm run hooks:pre-push` (sets `git config pan.prePush true`; `npm run hooks:pre-push -- --off` clears it). Bypass once with `SKIP_PREPUSH=1 git push` or `git push --no-verify`.

## Cross-Platform Considerations

### Path Separators (EP-001)
Windows uses `\`, macOS/Linux use `/`. All JSON output must use forward slashes.

**Fix:** Use `toPosix()` from `core.cjs` when outputting file paths.

```javascript
const { toPosix } = require('./core.cjs');
// path.join('.planning', 'state.md') → '.planning\state.md' on Windows
// toPosix(relPath) → '.planning/state.md' always
```

### Dollar Sign Shell Expansion (EP-002)
Bash expands `$` in strings. If content contains `$100`, it gets mangled.

**Fix:** Write content to a temp file and pass it with the verb's file flag (`state add-blocker --text-file`, `state add-decision --summary-file`/`--rationale-file`, `findings record --file`) instead of inline strings.

### CommonJS Format (EP-003)
All modules are CommonJS (`require()`/`module.exports`): the core modules use the `.cjs` extension, and hooks, `bin/install.js` and several scripts are CommonJS `.js`. Do NOT use ESM (`import`/`export`). The exceptions are the opt-in Playwright harness in `tests/e2e/` and the native workflow scripts that `buildNativeWorkflowScripts()` in `bin/install-lib.cjs` emits for `.claude/workflows/`, which must open with `export const meta`.

### node:test Not Jest (EP-004)
Tests use `node:test` and `node:assert/strict`. Do NOT use `describe`/`it` from Jest or Mocha.

### Line Endings
A Windows checkout (`core.autocrlf=true`) holds `.planning/` with CRLF endings. A parser that matches `\n` only finds nothing there, and says nothing.

**Fix:** Parse planning files on LF and write them back in the file's own ending, with `toLf()`, `dominantEol()` and `withEol()` from `core.cjs`. Give a new parser a case in `tests/crlf-parity.test.cjs`, which runs each parser on LF and CRLF copies of the same fixture.

## How to Write a Workflow

Workflows are the Layer 2 orchestration files in `pan-wizard-core/workflows/`. They define multi-step procedures that commands execute.

1. Create `pan-wizard-core/workflows/your-workflow.md`
2. Structure it with XML steps that load state, spawn agents, and route results
3. Reference it from your command .md file via `@~/.claude/pan-wizard-core/workflows/your-workflow.md`
4. No installer edit is needed — the installer copies `pan-wizard-core/workflows/` recursively, so new workflows ship automatically. Run `node scripts/test-surface.cjs --write` (the surface registry lists every workflow file) and refresh the Workflows row of the counts table in `CLAUDE.md`, or `npm test` fails (`tests/surface-map.test.cjs`, `tests/claude-md-counts.test.cjs`)

**Workflow structure:**
```markdown
<purpose>What this workflow accomplishes.</purpose>

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
4. No installer edit is needed — the installer copies `pan-wizard-core/references/` recursively, so new references ship automatically. Refresh the References row of the counts table in `CLAUDE.md` (`tests/claude-md-counts.test.cjs` fails until you do) and add the file to the table below

**Current references:**

| Reference | Purpose |
|-----------|---------|
| `checkpoints.md` | Checkpoint types, automation patterns, auth gates |
| `continuation-format.md` | "Next Up" block format for workflow transitions |
| `decimal-phase-calculation.md` | Phase numbering logic for inserted phases |
| `design-methodology.md` | Shared design method — depth tiers and the quality bar that `pan-designer` (via `/pan:design-phase`) and `focus-design` both hold design artifacts to, and that `pan-design-checker` verifies against |
| `git-integration.md` | Commit points, commit message formats, why per-task commits |
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
| `verdict-contract.md` | The `pan-verdict` block judges end their reports with: fields, verdict → outcome per judge, finding classes, severities |
| `verification-patterns.md` | Stub detection, wiring checks, verification checklists |

## How to Customize Templates

Templates in `pan-wizard-core/templates/` scaffold new project files. Agents read these files and fill them in; `template.cjs` never loads them — it selects a summary template and writes pre-filled phase files from its own generators.

1. Templates are plain Markdown files with `{placeholder}` or `[Placeholder]` fields
2. `cmdTemplateFill()` (`template fill summary|plan|verification --phase N`) writes a pre-filled file into the phase directory from built-in generators, not from `templates/`
3. `cmdTemplateSelect()` auto-selects summary template based on plan complexity:
   - **minimal** — ≤2 tasks, ≤3 files, no decisions
   - **standard** — typical plans
   - **complex** — 7+ files, 6+ tasks, or decisions present

**Template categories:**

| Category | Templates | Used by |
|----------|-----------|---------|
| Project | project.md, requirements.md, roadmap.md, state.md | `/pan:new-project` |
| Phase | context.md, phase-prompt.md, discovery.md (research.md is unreferenced by shipped content) | `/pan:discuss-phase`, `/pan:plan-phase` (pan-planner follows discovery.md for Level 2 research) |
| Codebase | architecture.md, stack.md, conventions.md, concerns.md, integrations.md, structure.md, testing.md, relationships.md, best-practices.md | `/pan:map-codebase` |
| Summary | summary.md (summary-minimal.md, summary-standard.md and summary-complex.md are named only by `pan-tools template select`, which no shipped prompt runs) | pan-executor |
| Verification | validation.md, verification-report.md (uat.md is unreferenced by shipped content) | the `plan-phase` workflow (validation.md); pan-verifier through the `verify-phase` workflow (verification-report.md) |
| Debug | debug-subagent-prompt.md (debug.md is named only by `/pan:debug`, as the format of the debug file its continuation agent parses) | the `diagnose-issues` workflow (the native `/pan-diagnose-issues` script carries its own inline prompt) |
| Research | research-project/stack.md, features.md, architecture.md, pitfalls.md, summary.md | the project researchers `/pan:new-project` and `/pan:milestone-new` spawn, and pan-research-synthesizer (summary.md) |
| Planning / execution | user-setup.md (planner-subagent-prompt.md and standards.md are unreferenced by shipped content) | `execute-plan.md` writes `{phase}-USER-SETUP.md` from user-setup.md |
| Lifecycle | milestone-archive.md, milestone.md (retrospective.md is unreferenced by shipped content; continue-here.md is named only by `/pan:pause`, which writes `.continue-here.md` from its own `<handoff_schema>` in place of both that template and the `pause.md` workflow's inline format) | `/pan:milestone-done` |
| Spec B v2 | playbook.md (knowledge system), preview-report.md (foresight/preview) | `/pan:knowledge`, `/pan:preview` |
| Design & experiments | design.md, idea.md | `/pan:design-phase` (pan-designer), `/pan:experiment` |
| Config | config.json | Unreferenced by shipped content — `config-ensure-section` writes `buildConfigDefaults()` from `config.cjs`, not this file |

To customize: edit templates in `pan-wizard-core/templates/` directly. Changes take effect on next use. After PAN updates, check for template changes in the changelog.

## Architecture Overview

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full internal architecture guide.

Quick summary: Commands -> Workflows -> Agents -> Core Library -> .planning/ state files

### Bot Army subsystem (v3.11+)

The army turns PAN's agents into a coordinated, role-scoped army. The substrate lives in core modules — `squads.cjs` (the role registry: architecture / build / quality / release), `worktree.cjs` (branch-per-agent git-worktree isolation so parallel builders never collide), `campaign.cjs` (scheduled, self-resuming "dreaming" campaigns), and `hud.cjs` (the single-file HTML dashboard) — driven by the `/pan:army` command, the `pan-conductor` agent (Mission Control — instructed to delegate rather than implement; its `tools:` grant is not narrowed to enforce that), and the `pan-release` agent (the human merge gate). The design rationale is recorded in [ADR-0032 (squad model)](decisions/ADR-0032-squad-model.md), [ADR-0033 (army campaign)](decisions/ADR-0033-army-campaign.md), [ADR-0034 (scheduled campaigns)](decisions/ADR-0034-scheduled-campaigns.md), and [ADR-0035 (army HUD dashboard)](decisions/ADR-0035-army-hud-dashboard.md).

## Distribution Bundles

Besides the loose-file installer, two builders package PAN as a plugin. Neither output is committed (`dist/` is ignored) and neither is published yet; both are built and validated by the test suite.

| Command | Output | Consumed by | Layout |
|---|---|---|---|
| `npm run build:plugin` | `dist/pan-wizard-plugin/` | Claude Code (plugin marketplaces; the local `command`-source test bed in `marketplace/`) | `.claude-plugin/plugin.json`, `commands/`, `agents/`, `hooks/`, `workflows/`, `.mcp.json`, `pan-wizard-core/`, `evals/` (from `harness/plugin-evals/`, checkout builds only) |
| `npm run build:agent-plugin` | `dist/pan-agent-plugin/` | Copilot CLI / VS Code, Codex, Cursor, Kiro — the vendor-neutral **Agent Plugins 1.0** format (ADR-0045) | `plugin.json`, `skills/`, `mcp.json`, `pan-wizard-core/`, `hooks/` (scripts + Codex `hooks.json`), `com.github.copilot/` (agents + hooks) |

Two marketplace files in the repository point at the Agent Plugins build so a checkout can install it without publishing: `.agents/plugins/marketplace.json` (Codex, repo-scoped, discovered automatically inside the repo) and `.github/plugin/marketplace.json` (Copilot, added with `copilot plugin marketplace add`). Both reference `./dist/pan-agent-plugin`, so run the builder first. The release gate (`scripts/release-check.js`, gate 8) builds both bundles into temp directories and fails the release if either does not produce its manifest — and, since `2026-09-10`, digests the local `dist/pan-agent-plugin` (untracked — `dist/` is gitignored) against the fresh build whenever it exists, so a stale bundle behind those two marketplaces fails the release with the fix named.

The vendor directories carry their own verification status, recorded in ADR-0045: the Codex hooks shape and `${PLUGIN_ROOT}` expansion come from Codex's plugin reference, but Codex loads no hooks from this bundle, because its root `plugin.json` makes Codex treat it as an Agent Plugin and Codex skips hooks for those (Codex source, read `2026-10-19`). Codex users get PAN's hooks from a `--codex` install; the Copilot namespace and its flat PascalCase hooks come from VS Code's documentation, and a live `copilot plugin install` from a local path has since passed on Copilot CLI 1.0.88 (the harness scenario `live-gate-copilot`; the bundle lists as `pan-wizard`). No Antigravity variant is emitted — its manifest schema is closed and different.

Both builders take an output override (`PAN_PLUGIN_OUT`, `PAN_AGENT_PLUGIN_OUT`) and refuse to wipe a directory that is not a previous build of theirs. Tests never build into `dist/`: they go through `buildPluginInto()` / `buildAgentPluginInto()` in `tests/helpers.cjs`, which build into private temp directories, because `node --test` runs files in parallel and two files rebuilding one directory raced.

The skills in the Agent Plugins bundle come from the same unified-skills compiler the installer's `--unified-skills` path uses (`rewriteUnifiedSkillCommandContent`, `convertClaudeCommandToUnifiedSkill` in `bin/install-lib.cjs`). Do not add a second converter: `tests/unified-skills-install.test.cjs` pins the installer's output and `tests/agent-plugin-build.test.cjs` pins the bundle's, including that the Claude plugin build carries no bundle token or Agent Plugins artefact.

## Behavioural Harness

`harness/` is the PAN Harness (ADR-0047): JSON scenarios run against installs built from a **packed** artifact. A run packs the repository, extracts the tarball (never `npx`), installs from the package into seeded workspaces, and asserts on what the installed PAN does — the install matrix across the five runtimes, the bridge answering for another project through the per-call `cwd`, the deployed native workflow scripts, the Agent Plugins bundle, live gates on CLIs that are present, and (with a spend cap) whole execution chains. It succeeds the external PanLoop harness and lives in-repo so it cannot be lost separately from the contracts it asserts. Not shipped — `harness/` is outside the package `files` allowlist.

```bash
npm run harness                                    # tier 0 — model-free, free, about a minute
npm run harness:model -- --max-usd 50 --repeat 5 --scenario native-exec-waves-chain --scenario markdown-exec-phase-chain   # tier 2 — the chain pair; without --max-usd the cap is $15
```

Tier 0 is the one to run before a release; it includes `model` and scripted-`user` steps answered by the local model double (`harness/src/model-double.cjs`) or a committed cassette, which reach no real model and spend nothing. Model tiers spend your Claude usage (or, for a `cli` step marked `paid: true`, that CLI's credits) and are capped at $15 per run unless `--max-usd` (or `PAN_HARNESS_MAX_USD`) gives another figure; the cap is split across the model-tier scenarios in the run. Run state goes outside the checkout (`D:\pantesting\harness-runs\<run-id>\` on Windows when `D:\pantesting` exists, else the OS temp directory; `PAN_HARNESS_STATE` or `--state-dir` overrides it); `harness/ledger.jsonl` is the tracked findings history, deduped by signature. A scenario's `requires` (`cli`, `minVersion`) **skips** it with the reason when the environment cannot run it — never a pass — and a model step that never ran is a harness error, not a finding. Every assertion kind has a both-direction test in `tests/harness.test.cjs` (the double's `wire:` and `drift:` kinds in `tests/model-double.test.cjs`); add a kind there first. `harness/corpus/` holds seeded-defect projects (a clean twin, a defective twin and a held-out catching test each, every entry proven with `verify red` by `tests/harness-corpus.test.cjs`), and `harness/scripts/catch-rate.cjs` scores judge runs against them: catch rate and false-alarm rate with Wilson intervals. `harness/README.md` has the scenario schema, the tiers, and the headless background-wait ceiling the runner lifts.

## Release Process

Releases are published by CI from a tag; nothing is published from a laptop. The flow, as run for recent releases:

1. **Gate locally:** `npm run release:check`. It is the same script `prepublishOnly` runs in CI, so a red gate here is a red publish there. In order: hook build; `test:all`; `npm audit --omit=dev`; `doc-lint counts` over `docs/` (no filesystem-derived counts outside `CLAUDE.md`); `links validate` (the doc↔code link graph resolves); `npm pack` size sanity **and zero runtime dependencies**; a smoke install of the packed tarball into a temp directory; both distribution bundles building, with `dist/pan-agent-plugin` digested against the fresh build; and the coverage gate (every dispatcher arm executed plus per-group floors; skipped below Node 22). Run `npm run harness` (tier 0) as well.
2. **Refresh the counts table** in `CLAUDE.md` with the snippet it carries — the only place counts live — and, if any command or dev skill changed, regenerate the skills docs: `python scripts/generate-skills-docs.py`.
3. **Bump the version** in `package.json` and `package-lock.json` — and the `version` of the `pan-wizard` entry in `.github/plugin/marketplace.json`, which a test pins to it.
4. **Turn `## [Unreleased]` into `## [x.y.z] - YYYY-MM-DD`** in `CHANGELOG.md`.
5. **Commit as `release(x.y.z): …`** on a `release/vx.y.z` branch, run the full `npm run ci:local` on it, and land it with `npm run land -- release/vx.y.z` (see Landing a change). The macOS jobs in `ci.yml` run on the push to `main`.
6. **Tag the merge commit and push the tag by explicit refspec:**

   ```bash
   git tag vx.y.z && git push origin refs/tags/vx.y.z
   ```

   A `v*` tag triggers `.github/workflows/release.yml`, which reruns the gates through `prepublishOnly`, publishes with npm provenance, and **creates the GitHub Release** from the `CHANGELOG.md` section for that version. The npm dist-tag comes from the version (`scripts/npm-dist-tag.js`): a prerelease such as `3.31.0-rc.1` publishes under `next` and its GitHub Release is marked as a prerelease, never Latest, so `npm install pan-wizard` keeps resolving to the newest stable release; a plain version publishes under `latest`. Do not rely on `git push --follow-tags` — it has silently dropped the tag before, and then nothing publishes.

   The Release step landed after 3.29.0 was tagged (that release object was created by hand). Before it, the workflow published to npm and stopped, so every tagged version from 3.15.0 to 3.28.0 carries a tag and an npm release but no release object. The step is `continue-on-error` — the package is already published by the time it runs, so a failure there is a cosmetic omission rather than a failed release — and the run summary states plainly whether the release exists, so an omission is visible instead of silent. A re-run never clobbers an existing release.
7. **After a successful publish:** the workflow already ran `deprecate-old-versions.js --apply` and created the Release. The run summary says whether the Release exists; the deprecations appear only in the `Deprecate superseded versions` step log, which stays green even when npm refuses every one. Then upgrade the installs you maintain with the installer. When sweeping `d:\` for installs to upgrade, exclude **everything** under `d:\pantesting\` except the root — its subdirectories are audit fixtures pinned to the version they were made on, and a name-based denylist has missed them before.
