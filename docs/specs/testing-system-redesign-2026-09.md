# Spec: Testing System Redesign — surface-derived coverage that survives a rewrite

**Generated:** 2026-09-17 · **Method:** `/featureAI` · **Tree:** `main` + the uncommitted v3.28.1 cost-attribution work · **Status:** proposed

---

## Phase 0 — Problem Framing

### 0.1 Problem statement

The suite is large and green, and it still let three things through in one week: hook rows that booked a whole session's usage to one subagent (no test drove the hook against a real per-agent transcript), a test file that reported one passing test while fifteen of its sixteen never executed (an in-process call reached `output()`, which exits the process), and a dozen "did not crash" assertions that a crash satisfies. The measured picture (2026-09-17, Node's own coverage instrumentation over every shipped file) is 93.6% of lines and 94.0% of functions executed — good — but 31% of the CLI dispatcher's branches, four verbs never dispatched by any test, every "unknown subcommand" error arm untouched, two hooks never spawned as processes, and MCP registration asserted after a real install for one runtime of five. Coverage is high where tests happened to be written and absent where nobody thought to look, because *what must be tested* is inferred from the tests rather than derived from the code. Why now: v3.28.1 rebuilds every field ledger on the strength of these tests, and the next surface change (a verb, a hook event, a runtime) will again be covered only if someone remembers.

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| A **surface registry** derived mechanically from the code: every dispatcher verb and subcommand and its error arm, every installer flag, every hook × runtime registration, every MCP tool and resource, every config default key, every shipped command, agent and workflow file | Rewriting PAN's shipped behaviour to make it easier to test |
| A **scenario map** that ties each surface item to the test that exercises it, failing when an item has none — static (a test names it) and dynamic (the arm actually executed under coverage) | Model-tier behavioural runs (the PAN Harness owns those; this spec wires tier 0 in, no more) |
| A **coverage gate** in the release check with per-group floors and an explicit, reasoned allowlist | Third-party coverage or mutation tooling as a *runtime* dependency (zero runtime dependencies is a release gate) |
| **Assertion-quality lints** that fail the suite on the shapes that proved vacuous: OR-shaped "no crash" checks, in-process `cmd*` calls, bare `return` skips, `assert.ok(true)`, unparsed CLI output | Test speed work beyond keeping the suite under the current wall-clock |
| **Process-level hook tests** for all six hooks from captured payload fixtures, and the six known-weak assertions rewritten | Playwright / VS Code e2e (unchanged) |
| A **from-scratch layout** with layer names and a migration that never breaks the glob-free runner | Moving existing files for tidiness alone |

### 0.3 Success criteria (measurable)

```
SC-1  Every dispatcher case arm (verbs, subcommands, unknown-subcommand errors) is executed by at least one
      test under coverage; the gate fails on the first arm that is not — measured from lcov, not from grep.
SC-2  Every installer flag, every hook×runtime registration, every MCP tool and resource, every config
      default key is named by at least one test that runs the real code path; the static map fails otherwise.
SC-3  Line coverage ≥ 92% overall and per group (installer ≥ 90, hooks ≥ 90, lib ≥ 92, mcp ≥ 95, dispatcher
      case arms 100%); function coverage ≥ 93%; every exclusion sits in an allowlist with a one-line reason.
SC-4  The assertion-quality lint passes with an empty allowlist for the seven banned shapes, and the six
      weak assertions found by the 2026-09-17 audit are rewritten so a broken feature fails them.
SC-5  All six hooks have a spawned, stdin-driven test from a captured payload fixture, on all runtimes that
      register them; MCP registration is asserted after a real install for all five runtimes.
SC-6  Starting from an empty tests/ directory, `node scripts/test-surface.cjs --scaffold` emits one stub per
      surface item, so a rebuilt suite cannot miss a surface by construction.
SC-7  No regression: the existing suite stays green on the 3 OS × 3 Node CI matrix; the coverage gate runs
      on the Node 22 job only (threshold flags exist from Node 22.8) and is advisory on 18/20.
SC-8  Documentation: DEVELOPMENT.md "Writing Tests" describes the layers, the doctrine and the lints;
      CONTRIBUTING.md points at the scaffold; CLAUDE.md keeps the only counts.
```

### 0.4 User stories

```
As the maintainer, I want the suite to tell me which shipped surface has no test,
so that a new verb or hook cannot ship unexercised, instead of finding out from a field ledger.

As a contributor, I want to add a subcommand and be told exactly which test to write,
so that coverage is a checklist I complete, instead of a number I hope stays high.

As the maintainer, I want a green suite to mean the assertions could have failed,
so that "4,000 tests pass" carries information, instead of counting rows that assert nothing.

As a future maintainer rebuilding the tests from scratch, I want the required inventory to come from the code,
so that a rewrite covers everything the first suite covered, instead of everything someone remembered.
```

---

## Phase 1 — Internal Reconnaissance

### 1.1 What exists

- **Runner and layers.** `scripts/run-tests.cjs` expands `tests/*.test.cjs` and `tests/scenarios/*.test.cjs` deterministically (PowerShell and Node < 22 do not expand globs). Two layers only: unit and scenario. `tests/helpers.cjs` exports `runPanTools` (real CLI via `execSync`), `createTempProject`, `cleanup`, `createScenarioRunner`, `buildPluginInto`, `buildAgentPluginInto` and the three path constants. `tests/contracts/` holds JSON-shape schemas for payloads; `tests/fixtures/` holds the module export pin and the Agent Plugins schemas.
- **Doctrine** (DEVELOPMENT.md "Writing Tests", the 2026-08 audit chain): fixtures come from emitted output, every assertion kind is proven able to fail, temp dirs only, all five runtimes where a path is runtime-specific, `node:test` not Jest.
- **Class-closing lints already in the suite**: `doc-command-surface` (the CLI surface parsed from the dispatcher's own error strings must appear in the shipped docs), `module-surface` (export pin), `claude-md-counts` (the counts table matches disk), `package-contract` (zero dependencies), `shipped-content-prefix`, `model-version-drift`, `native-workflows-drift` (script ⇄ markdown twin), `exit-code-contract` (error-family exit codes at their single point of definition), `guardrails`, `links validate` in CI. These are the model for what this spec generalises: derive the requirement from the code, assert the suite meets it.
- **Coverage baseline** (this session, dependency-free: `node --test --experimental-test-coverage` with include globs, lcov reporter, grandchild processes captured through the inherited `NODE_V8_COVERAGE`): lines 93.6%, functions 94.0%, branches 77.9%; lib 94.6, mcp 99.1, installer 92.9, hooks 91.3, scripts 87.5, dispatcher 80.2 lines / 31.2 branches. Never dispatched: `experiment`, `distill`, `squad`, `worktree`; sub-arms `optimize trace|apply|list|stats`, `learn promote|unpromote --pattern`, `learn lint --source-root`, `campaign schedule --daily-budget`, `campaign record-run`, `focus reflection`, `memory select|budget`, `doc-lint flags`, `bridge cache`, `git sync`, the MCP `git` tool, `--flag=value` parsing, and every "Unknown subcommand" arm.
- **Quality audit findings** (independent read, 2026-09-17): MCP registration after a real install asserted for OpenCode only; Gemini's settings check reduces to "hooks key truthy"; Claude's SubagentStop logger wiring asserted only on uninstall; `roadmap update-plan-progress` asserted as exit 0 only; the whatif worktree round-trip skips itself on the error it should catch; `commit --fail-on-error` asserted only inside a condition false on a machine with a global git identity; about a dozen scenario tests assert "some output or some error"; `pan-context-monitor` and `pan-check-update` never spawned; a bare `return` on Linux counts as a pass; wall-clock assertions under load; a test that snapshots the developer's real HOME.
- **The exit trap** (this session): `cost-rebuild.test.cjs` called `cmdCostRebuild` in-process; `output()` ends with `process.exit`, the child died after the first test, `node --test` reported `tests 1 / pass 1`, and CI would have stayed green. Nothing in the suite forbids it.
- **Harness.** `harness/` runs JSON scenarios against a packed, installed artifact; tier 0 is model-free and free and is already Gate 1 of `release:check`'s neighbours (`npm run harness`); it is not in CI.
- **CI.** `ci.yml`: `npm test`, `npm run test:scenarios`, `links validate`, 3 OS × Node 18/20/22; `release:check` runs `test:all` again as Gate 2.

### 1.2 Where the surface lives (the registry's sources)

| Surface | Source of truth | Extraction |
|---|---|---|
| Verbs | `pan-tools.cjs` usage line (`Commands: …`) | already parsed by `doc-command-surface` |
| Subcommands + error arms | `Unknown <group> subcommand. Available: …` strings | `suggest.cjs buildSubcommandIndex` |
| Dispatcher case arms | `case '<label>':` in `pan-tools.cjs` | line-anchored regex; lcov `DA` lines |
| Installer flags | `'--flag'` literals in `bin/install.js` | regex |
| Hook × runtime | `HOOK_EVENT_MAP` / builders in `install-lib.cjs` | require + enumerate |
| MCP tools / resources | `pan-wizard-core/mcp/tool-registry.cjs` | require + enumerate |
| Config defaults | `buildConfigDefaults()` in `config.cjs` | require, flatten keys |
| Shipped content | `commands/pan/*.md`, `agents/*.md`, `pan-wizard-core/workflows/*` | readdir |
| Hook payload shapes | captured fixtures per event | `tests/fixtures/hooks/*.json` (new) |

### 1.3 Runtime compatibility

The feature is development-side (nothing ships), but its requirements are runtime-aware: hook×runtime registration, per-runtime MCP registration, per-runtime installer paths and content conversion each become a row in the surface, so a runtime added or a hook event moved shows up as an uncovered row on the next run. Tests already run on Windows, Linux and macOS; nothing here is platform-specific except the rule that platform-conditional tests use `t.skip(reason)` so the skip is visible.

---

## Phase 2 — Comparative Notes

The spec-driven peers in `docs/COMPARISON.md` ship prompts and lightweight scripts and, as far as their public repositories show, test them thinly or not at all; PAN's practice of installing the real artifact into temp directories across five runtimes is already ahead of that field. The practices worth importing come from elsewhere:

- **Coverage as a gate, not a report** — mature CLIs fail the build on a floor with an explicit allowlist. Node's own runner supports `--test-coverage-lines/-functions/-branches` from 22.8, so the gate needs no dependency.
- **Contract-from-code** — projects that enumerate their CLI from its own help output and diff it against tests (the way `doc-command-surface` already diffs it against docs) do not regress a subcommand silently.
- **Golden payloads with provenance** — hook and webhook consumers keep captured real payloads with the producer version stamped on them; PAN's fixture doctrine says the same but has no hook payload captures yet.
- **Mutation testing** (Stryker for JavaScript) is the standard answer to "would this assertion fail?"; it is a dev-time tool with dependencies, so it is a later, optional phase here — the assertion-quality lint covers the shapes that actually bit.

Differentiation: PAN can make the surface registry itself a shipped-quality artifact (`tests/fixtures/surface.json`, committed, diffed in review), so a PR that adds a surface shows the new rows and their required tests in the same diff.

---

## Phase 3 — Design

### 3.1 Architecture

Four new pieces, one gate, one migration.

1. **`scripts/test-surface.cjs`** — extracts the registry (§1.2) and writes `tests/fixtures/surface.json` (sorted, stable). Modes: `--check` (fail if the committed file differs from the extraction: a surface changed without the registry), `--scaffold <dir>` (emit one `*.test.cjs` stub per surface item without a test, carrying the item's ID in the test title), `--map` (print the scenario map).
2. **`tests/surface-map.test.cjs`** (static half) — for each registry row, at least one test file names it as the code names it: a quoted CLI argument for verbs and subcommands, the flag literal for installer flags, the hook filename and event for hook×runtime, the tool name for MCP. Tests declare coverage by referencing the item; no tags to maintain. Failure names the row and the scaffold command.
3. **`scripts/coverage-gate.cjs`** (dynamic half; the scratchpad `lcov-summary` and `case-cov` scripts of 2026-09-17 promoted) — runs the suite under `--experimental-test-coverage` with the include globs, parses lcov, and enforces: per-group line/function floors; every dispatcher `case` arm executed; the never-called-function list against `tests/fixtures/coverage-allowlist.json` (`{ "path": "...", "symbol": "...", "reason": "interactive prompt" }`). Prints the ranked gap list on failure. Wired as Gate 9 of `release:check`, and as a CI step on the Node 22 jobs (advisory `continue-on-error` for one release, then required).
4. **`tests/test-quality.test.cjs`** — a lint over the test sources themselves. Rules, each with an allowlist entry format `{ file, line, reason }`:
   - Q1 no OR-shaped liveness assert (`output.length > 0 || error.length > 0` and variants);
   - Q2 no in-process call to a `cmd[A-Z]\w+(` export of a lib module (they reach `output()`/`error()` and exit) — use `runPanTools`;
   - Q3 no `assert.ok(true)` / `assert(true)`;
   - Q4 a `runPanTools` result must assert `success` (or `.success === false`) and, when it parses output, parse JSON — flag `.output.length` as the only assertion;
   - Q5 platform conditionals use `t.skip(reason)`, never a bare `return`;
   - Q6 no wall-clock upper bound under 2 s on a spawned process (or an explicit allowlist reason);
   - Q7 no read of the real `os.homedir()` / `process.env.HOME|USERPROFILE` unless wrapped by the `withFakeHome` helper.
5. **Hook fixtures and the hook e2e test** — `tests/fixtures/hooks/<event>-<host>.json` captured from real hosts (Claude Code `SessionStart`, `PostToolUse`, `SubagentStop` with `agent_id`, `Stop`; Codex and Copilot shapes where they differ), each with `captured_from` (host, version, date) in a sibling `.meta.json`. `tests/hooks-e2e.test.cjs` spawns every hook in `HOOKS_TO_COPY` with the matching fixture on stdin against a temp PAN project and asserts the observable effect (ledger row, trace event, cache file, statusline output, stop-guard decision) and exit code — for each runtime that registers the hook, through the installed copy in that runtime's directory.
6. **Helpers** — add to `tests/helpers.cjs`: `withFakeHome(fn)` (HOME/USERPROFILE/CLAUDE_CONFIG_DIR sandbox), `readLedger(cwd)`, `spawnHook(name, payload, cwd)`, `installInto(cwd, flags)` (the five-runtime matrix helper the scenario tests reimplement today).
7. **Layout (from scratch)** — `tests/unit/`, `tests/contract/` (CLI exit-code and JSON contracts per verb, scaffolded from the registry), `tests/install/` (installer × runtime), `tests/hooks/`, `tests/mcp/`, `tests/lint/` (the class-closing lints), `tests/scenarios/` (workflow-level). The runner takes directories, so `package.json` gains the new directories and CI needs no change. **Migration rule:** new tests go into the new layout; existing files move only when touched for another reason; `tests/*.test.cjs` stays a valid location until the last file leaves it. The counts table's "unit test files" row becomes "test files (all layers)".

### 3.2 Implementation plan

```
P1  Lints and gate (no behaviour change)
 1. scripts/test-surface.cjs            — extractor + --check/--scaffold/--map; commits tests/fixtures/surface.json
 2. tests/surface-map.test.cjs          — static map; initial allowlist = today's uncovered rows, each with a reason,
                                          burned down in P2
 3. scripts/coverage-gate.cjs           — lcov parse, group floors, case-arm rule, allowlist; release-check Gate 9;
                                          CI Node-22 step (advisory first)
 4. tests/test-quality.test.cjs         — Q1–Q7; initial allowlist = the ~12 OR-shaped asserts and the known bare returns
 5. tests/helpers.cjs                   — withFakeHome, readLedger, spawnHook, installInto

P2  Close the known gaps (the audit's six HIGHs + the dispatcher arms)
 6. tests/install/mcp-registration.test.cjs   — install, parse the runtime's MCP config, assert the `pan` entry's args resolve
                                                to an existing server.cjs, uninstall, assert removal — for all five runtimes
 7. tests/install/gemini-hooks.test.cjs       — the three event arrays carry pan-* commands; experimental.enableAgents === true
 8. tests/scenarios/hook-registration        — EXPECTED_HOOKS covers all six; SubagentStop carries both loggers on install
 9. roadmap update-plan-progress, whatif round-trip (assert.ifError), commit --fail-on-error (force the failure as
    exit-code-contract does), the OR-shaped "no crash" asserts → exit code + parsed error body
10. tests/contract/dispatcher-arms.test.cjs   — one parametrised test per never-dispatched verb/sub-arm and per
                                                "Unknown <group> subcommand" arm, asserting the exit-code contract and
                                                the Available: string; `--flag=value` parsing

P3  Hooks as processes
11. tests/fixtures/hooks/*.json + .meta.json  — captured payloads with provenance (Claude Code first; Codex/Copilot as
                                                their CLIs become available on a machine)
12. tests/hooks/hooks-e2e.test.cjs            — every hook × every registering runtime, spawned from the installed copy

P4  Layout migration + docs
13. package.json scripts                      — add the new directories to test / test:all / test:watch
14. docs/DEVELOPMENT.md "Writing Tests"       — layers, doctrine, the lint rules and how to satisfy them, the scaffold
15. CONTRIBUTING.md                           — "add a surface → run the scaffold → fill the stub"
16. CLAUDE.md                                 — counts row rename; nothing else numeric anywhere

P5  Behavioural tier in CI
17. .github/workflows/ci.yml                  — `npm run harness` (tier 0) on the ubuntu Node-22 job; run dir under the
                                                runner's temp; ledger untouched

P6  Optional, later
18. Mutation testing with Stryker as a devDependency behind `npm run test:mutate`, sampled (the hooks and the
    dispatcher first); results as a report, never a gate, until the run time is known
```

### 3.3 Test plan for the machinery itself (`tests/lint/test-system.test.cjs`)

Happy path
1. The extractor finds `state snapshot` and every group parsed by `doc-command-surface` (sanity: the parse is not vacuous).
2. `--check` passes on the committed registry and fails, naming the row, when a subcommand is added to a copied dispatcher.
3. The static map passes on the current suite plus its allowlist; removing a named test file makes it fail on that row.
4. The coverage gate passes on a fixture lcov above every floor and reports `ok` per group.
5. `--scaffold` into an empty temp dir emits one stub per registry row, each stub's title carrying the row ID.

Edge cases
6. A case arm whose first executable line is another `case` (fallthrough) is attributed to the shared body, not reported as unexecuted.
7. An allowlisted never-called function with a reason is tolerated; the same entry without a reason fails the gate.
8. Two spellings of a flag (`--flag`, `--flag=value`) count as one surface row.
9. A hook fixture whose `.meta.json` lacks `captured_from` fails the fixtures lint.

Error cases
10. Q2 flags `cmdCostRebuild(` called in a test file and points at `runPanTools`; the same call inside a `// quality-allow: reason` line is accepted once and listed.
11. Q1 flags `assert.ok(a.length > 0 || b.length > 0)` and the `||`-in-`assert.ok` variants; a parsed-JSON assertion in the same file passes.
12. A malformed lcov file makes the gate fail closed (exit 1 with the parse error), never pass.

Runtime-specific
13. The hook e2e harness spawns the SubagentStop logger through each of the four registering runtimes' installed copies and finds one ledger row per runtime with `token_source: agent-transcript`.
14. MCP registration is asserted for all five runtimes; the OpenCode and Gemini entries point at the installed `server.cjs`.

---

## Phase 4 — Specification Output

```
## Feature: Surface-derived test coverage and quality gates

### Files to Create/Modify
- scripts/test-surface.cjs                 (new) extractor, --check, --scaffold, --map
- scripts/coverage-gate.cjs                (new) lcov gate; promoted from the 2026-09-17 scratchpad scripts
- tests/fixtures/surface.json              (new, committed) the registry
- tests/fixtures/coverage-allowlist.json   (new) reasoned exclusions
- tests/fixtures/hooks/*.json, *.meta.json (new) captured hook payloads with provenance
- tests/surface-map.test.cjs               (new) static scenario map
- tests/test-quality.test.cjs              (new) Q1–Q7 lint
- tests/hooks/hooks-e2e.test.cjs           (new) every hook × registering runtime, spawned
- tests/install/mcp-registration.test.cjs  (new) five-runtime MCP registration and strip
- tests/install/gemini-hooks.test.cjs      (new) positive Gemini settings assertions
- tests/contract/dispatcher-arms.test.cjs  (new) never-dispatched arms + unknown-subcommand errors + --flag=value
- tests/lint/test-system.test.cjs          (new) the 14 cases above
- tests/helpers.cjs                        (modify) withFakeHome, readLedger, spawnHook, installInto
- tests/scenarios/hook-registration.test.cjs, tests/e2e-install.test.cjs, tests/whatif.test.cjs,
  tests/commands.test.cjs, tests/scenarios/smoke.test.cjs, tests/scenarios/feedback-errors.test.cjs,
  tests/scenarios/contracts-*.test.cjs, tests/scenarios/workflow-*.test.cjs, tests/scenarios/runtime-*.test.cjs,
  tests/scenarios/state-integrity.test.cjs  (modify) the audit's weak assertions rewritten
- scripts/release-check.js                 (modify) Gate 9: coverage gate
- .github/workflows/ci.yml                 (modify) coverage gate + tier-0 harness on the Node-22 job
- package.json                             (modify) test directories; `test:coverage`, `test:surface` scripts
- docs/DEVELOPMENT.md, CONTRIBUTING.md, CLAUDE.md (modify) layers, lints, scaffold, counts row rename

### Implementation Steps
1. P1 lints and gate with allowlists seeded from today's gaps — the suite stays green, every gap is now named.
2. P2 burn the allowlists down: dispatcher arms, the six HIGHs, the OR-shaped asserts.
3. P3 hook fixtures and the spawned hook matrix.
4. P4 layout and docs; P5 harness tier 0 in CI; P6 mutation testing as a report.

### Tests Required
- The 14 cases in §3.3; the P2 and P3 tests listed above; all existing tests unchanged in intent.

### Documentation Updates
- DEVELOPMENT.md "Writing Tests": layers, the seven lint rules with the fix for each, the scaffold workflow,
  the coverage gate and how to add an allowlist entry (reason mandatory).
- CONTRIBUTING.md: the surface-change checklist.
- CLAUDE.md: counts row rename only.
- CHANGELOG [Unreleased]: "Changed — the test suite is measured against the code's own surface".

### Runtime Matrix
| Runtime  | Supported | Notes |
|----------|-----------|-------|
| Claude   | ✅ | hooks e2e for SessionStart, PostToolUse, SubagentStop, Stop; MCP `.mcp.json` asserted |
| Codex    | ✅ | hooks e2e via `.codex/hooks.json` (async observers); MCP registration asserted; payload fixtures pending a Codex CLI on a build machine |
| Gemini   | ✅ | hooks e2e via settings.json; positive hook-event and enableAgents assertions; MCP asserted |
| OpenCode | ✅ | no hooks (asserted absent); MCP `.opencode/opencode.json` asserted (already) |
| GitHub   | ✅ | Copilot hooks via `.github/hooks/pan.json`; MCP `.github/mcp.json` asserted; payload fixtures pending a Copilot CLI |
```

---

## Phase 5 — Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| The coverage gate is flaky across OS/Node versions (different lines counted) | Medium | Gate on the Node 22 job only; floors with 1-point headroom below the measured baseline; arms rule (binary) rather than exact percentages where possible |
| Coverage of grandchild processes is lost when a test passes a custom `env` without `process.env` | Medium | Q7-style lint: `env:` objects in spawn calls must spread `process.env`; the gate's per-file table makes the drop visible |
| Allowlists become the place gaps go to die | High | Every entry needs a reason and an owner date; the surface-map failure message counts allowlisted rows; P2 burns the seed list to the interactive prompt and network calls only |
| `--scaffold` emits stubs that get committed as passing no-op tests | Medium | Stubs contain `t.todo()` and fail the quality lint until filled; `node --test` reports todo counts |
| Hook payload fixtures drift from the hosts | Medium | `.meta.json` provenance; a `models check`-style staleness note after 90 days; the real-transcript probe pattern from 2026-09-17 documented as the capture method |
| Moving test files breaks the glob-free runner or PowerShell CI | Low | Directories, not globs; runner already takes a list; new dirs added to scripts before any file moves |
| Harness tier 0 in CI is slow or needs the packed artifact's disk space | Low | It packs and installs into temp in ~10 s locally; ubuntu Node-22 job only; `continue-on-error` for one release |
| Mutation testing adds a dependency and long runs | Low | P6 is optional, sampled, report-only, devDependency only; zero runtime dependencies untouched |
| The exit trap recurs in a new shape (a helper that calls `process.exit`) | Medium | Q2 lint plus a `node --test` reporter check in `run-tests.cjs`: a file whose declared test count exceeds its reported count fails the run |
