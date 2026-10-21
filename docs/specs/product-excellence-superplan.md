# Product Excellence Superplan

**Date:** `2026-10-12` · **Status:** In progress: sprints 1–3 released (`3.35.0`, `3.36.0` (tagged `v3.36.0` on `e7d1011`, PR oharms/PanWizard#48, published `2026-10-19`)); sprint 4 not started (see [Progress](#progress); reviewed `2026-10-12`, review folded in) · **Source program:** `docs/specs/product_excellence_program_2026_q4_featureai.md` (item design and evidence) · **Owner decisions:** that program's §3.4
**Tree (when written):** `feat/memory-optimization-2026-10` @ `4994ed5` (`3.34.0`) plus the uncommitted audit work. This superplan **supersedes the program's §3.3 wave ordering** with a dependency-checked session order. Item ids are the program's and local to it (write "program R2" outside these two files); W0, X1, CI1, A0, A1a/A1c, A7b, L6a/L6b, V1E, V5G and HX1–HX5 are added here.

This is the executable form of the program. Every item has a priority class, a size, the files it touches, the items it depends on, a **code gate** (free, blocking: the item is not done until it is green) and, where the claim needs a model, a separate **evidence gate** (non-blocking: it runs on a per-run `--max-usd` approval and never holds up later items). `/execplan` consumes it one session at a time.

## Progress

Updated `2026-10-19`. The superplan's own order holds; nothing has been re-sequenced.

| Session | Items | State | Where |
|---|---|---|---|
| 1a, 1b, 1c | Sprint 1 (W0 … HX1) | Released in **3.35.0** | PR oharms/PanWizard#41 |
| 2a | H1, CI1, H2, H7 | Released in **3.36.0** | PR oharms/PanWizard#42 |
| 2b | V2, V4, V5 | Released in **3.36.0** | PR oharms/PanWizard#43 |
| 3a | H4, L1, R1; R49 not run | Released in **3.36.0** | PR oharms/PanWizard#44 |
| 3b | R3, P4, P2, P3, P6 | Released in **3.36.0** | PR oharms/PanWizard#45 (`a2fa00c`) |
| — | Fix outside the plan: doc-lint scans an absolute `--doc-dir` instead of silently passing | Merged | PR oharms/PanWizard#46 (`c2b3571`) |
| — | Owner request: per-phase spend budget ($20, warn only) and a $15 default harness cap | Merged | PR oharms/PanWizard#47 (`da3f493`) |
| 3c | H9, L5, L9, V1E, HX2 (release 3.36.0) | Released in **3.36.0** (squash-merged as `e7d1011`, PR oharms/PanWizard#48; `7346f93` and the follow-up fixes are in it) | branch `release/v3.36.0` |
| 4a onward | — | Not started | — |

**Open from finished sessions:**

- **R49** (session 3a) is a paid live re-run and has not run: tier-1/2 runs now default to a $15 cap (`harness/src/run.cjs`), so it needs only the owner's approval to spend; run `memory-not-loaded` on its own or raise `--max-usd`, because one run splits the cap evenly. It blocks nothing.
- **P6** (session 3b) shipped the forecast in `preview phase`. The design's last clause, the autodev loop stopping when spend passes p90, waits for the autodev loop, which does not exist yet: **A1a** (session 6a) builds its core, and **A6** (session 6b, depends on P6) already carries the stop, as `forecast_exceeded` for a unit past p90.
- **Evidence gates.** No paid evidence step in [Paid steps](#paid-steps-each-needs-a-per-run---max-usd-approval-there-is-no-standing-approval) has run yet: `harness/ledger.jsonl` holds no evidence-gate row, and the committed corpus replay is synthetic. Under the MI-114 rule, sessions 3a and 3b edited judge prompts (pan-reviewer, pan-hardener, pan-plan-checker), so each owes a paired corpus result once H4's first real baseline is paid for. Those items shipped in their safe defaults, as the rules below allow.
- **Release 3.36.0** shipped: `3.36.0` (tagged `v3.36.0` on `e7d1011`, PR oharms/PanWizard#48, published `2026-10-19`). Sprint 3's exit criterion is released. *(Corrected `2026-10-19` by the reality check; this line said the release was pending push, merge and tag.)*

## Baseline

| Metric | Value |
|---|---|
| Version | `3.34.0` (package.json) |
| Suite | green: `npm run test:all` (counts live in `CLAUDE.md`) |
| Release gates | all pass (`node scripts/release-check.js`) |
| Harness tier 0 | all pass; Antigravity skipped (no `agy`) |
| Open TODO/FIXME in shipped code | none real (`grep -rnE "\b(TODO\|FIXME\|HACK)\b" bin pan-wizard-core/bin hooks`) |
| Open GitHub issues | none |
| Inventory | commands, agents, modules, workflows and hooks: enumerate with the snippet at the top of `CLAUDE.md` |

## Sizing: why sessions are about twenty points

The superplan skill targets about forty points per session. This repository has never delivered that for work of this kind. The October queue sized sessions at 10–14 and 8–10 points. The memory program used 10, 10 and 14. Its one burst day (`2026-10-04`, O1–O12 of S and M items) still needed a separate audit and CI round before it could release. Items here are mostly M and L, and each needs a test proven red first, docs and cross-runtime wiring. So the program is packed into **sessions of about twenty points**, grouped into eight **sprints**. Each release sprint ends with a release-hardening item (HX, 6 points) that covers doc audit, CI, CodeQL and the CHANGELOG. A session that finishes early pulls the next session's first item. A session that overruns stops at an item boundary; it never stops halfway through an item.

## Priority classes

| Class | Meaning here | Points |
|---|---|---|
| **P0** | Broken: crashes, data loss, install failures | 2 |
| **P1** | Wrong: silent incorrect results, or a guarantee the code does not keep | 39 |
| **P2** | Stability: edge cases, safety rails, clean failure | 25 |
| **P3** | Missing tests: unmeasured behaviour, harness and test-system gaps | 72 |
| **P4** | Feature gaps: a runtime without the capability | 14 |
| **P5** | New features | 142 |
| **P6** | Documentation and release hardening | 30 |
| **P7** | Polish: cleanup, consolidation, UX | 26 |

**Total: 72 items, 350 points, 20 sessions in 8 sprints.** The suite, gates and installs are green. The one P0 is a latent data-loss path, found by the review rather than in the field: what-if cleanup runs `git branch -D` on whatever branch it is handed (W0, first item). Every item updates the docs it touches; HX items carry the rest of P6.

## Defaults when shipped

A new gate first ships in a mode that cannot block a working project. It is promoted only after its own evidence comes in:

| Gate | First release | Promoted |
|---|---|---|
| Phase gate (V1) `workflow.phase_gate` | `warn` in 3.35.0 | `enforce` in 3.36.0 (V1E), once V2 provides the test fact |
| Plan-set binding (V7) | legacy plan-check records without `plans_sha` warn | always refuses an edited-after-check plan set |
| Guard hook (A7) `hooks.guard` | `report`; `enforce` denies secret writes only | state-file and judge-write denies after A7b (3.37.0) |
| Review lenses (R2) `workflow.review_mode` | opt-in | default only if its evidence gate decides in its favour |
| Mutation (V5 / V5G) `workflow.mutation_gate` | `report` | `gate` is opt-in, never default |
| Cross-vendor lane (R4) | off; opt-in per project | stays opt-in (§3.4) |

## Items

| ID | Pri | Size | Pts | Title | Files | Depends on | Code gate (blocking, free) | Evidence gate (non-blocking) | Session |
|---|---|---|---|---|---|---|---|---|---|
| W0 | P0 | S | 2 | what-if cleanup deletes only branches it created: `cleanupWorktree` refuses a branch without the what-if prefix and never `-D`s an unmerged branch it did not create | pan-wizard-core/bin/lib/whatif.cjs (`cleanupWorktree`), tests/whatif*.test.cjs | — | Unit: a non-prefixed branch and an unmerged foreign branch survive cleanup; a what-if branch is removed | — | 1a |
| V9 | P1 | S | 2 | Two-key verdict: code facts only lower an agent verdict; `test_gate: failed` under `passed` records as `gaps_found` (absorbs R46) | verdict.cjs, findings.cjs, tests/verdict*.test.cjs | — | Unit: passed + test_gate failed → gaps_found; passed + skipped stays passed with the fact `not_checked` | — | 1a |
| V6 | P1 | M | 4 | Findings close only on evidence; stable finding ids (ADR-0049 amendment) | findings.cjs (recordVerdict auto-fix rows), verdict.cjs (findingId), references/verdict-contract.md, the three judge agents, ADR-0049 | — | Unit: an omitted finding stays open; a reworded finding keeps its id; churn computed over five recorded fixture reports | Churn over five live repeated reviews (paid) | 1a |
| V7 | P1 | M | 4 | `verify plan-set` in code + plan-check bound to `plans_sha` + `planned_commit` drift; legacy plan-check records without `plans_sha` warn, never refuse | verify.cjs (cmdVerifyPlanSet), phase.cjs (buildPlanIndex, dependencyNames), roadmap.cjs (roadmapRequirementIds), init.cjs (cmdInitExecPhase), findings.cjs, workflows/plan-phase.md, workflows/exec-phase.md, templates/phase-prompt.md | — | Tier-0 seeds: uncovered requirement, same-wave overlap, cycle, future ref, edited-after-check — each caught; clean set passes; legacy record → warning | — | 1a |
| V3 | P1 | M | 4 | Test-integrity guard + executor abort path (`BLOCKED_SPEC_CONFLICT`); exports `committedFiles` from verify-scope.cjs | new verify-integrity.cjs, verify-scope.cjs (export committedFiles), test-quality-lint shapes, pan-tools.cjs, agents/pan-executor.md, workflows/exec-phase.md | — | Fixture repos per pattern (deleted test, .skip/.only/xit/pytest.mark.skip/t.Skip/#[ignore], assertion drop, undeclared edit) each caught; clean twins pass | — | 1a |
| V1 | P1 | M | 4 | Phase gate in code (`workflow.phase_gate: warn\|enforce`, ships `warn`): summaries, fresh verification, clean reconcile, test fact, dispositions, stubs and integrity clean; never refuses on `not_checked`; reconcile before `update_roadmap` and on the auto-advance path; MCP requestMerge + native exec-waves use it | phase.cjs (phaseGate, cmdPhaseGate, cmdPhaseComplete), pan-tools.cjs, verify.cjs (reconcilePhase), config.cjs, workflows/exec-phase.md, workflows/transition.md, bin/install-lib.cjs (pan-exec-waves), mcp/merge-gate.cjs, docs/CLI-REFERENCE.md | V9, V6, V3 | One unit test per refusal reason in `enforce`; `warn` prints the same reasons and exits 0; `--force` needs `--reason` and records a decision; tier-0 seeded states (catch all, clean twin passes); native script stops on ok:false | — | 1a |
| R45 | P1 | S | 2 | OpenCode 2 plugin: `setup()` + compaction hook beside `server()` | pan-wizard-core/opencode/pan-wizard.js, tests/opencode-plugin.test.cjs, docs/HOOKS.md | — | Unit tests of both entry points against the v1 and v2 loader shapes | Live OpenCode 2 compaction check — needs OpenCode 2 on this machine (1.x installed); free through H1 once it lands, otherwise one paid run (paid) | 1b |
| R47 | P2 | M | 4 | OpenCode uninstall/merge recognise v1 and v2 config shapes (keep writing v1) | bin/install.js (uninstall, configureOpencodePermissions), bin/install-lib.cjs (mergeMcpRegistration, stripMcpRegistration) | — | Tests on a v2-shaped opencode.json: clean uninstall, no legacy key beside a native one | — | 1b |
| R48 | P2 | XS | 1 | Drop the Copilot attribution fallback to `~/.copilot/config.json` | bin/install.js | — | Unit test | — | 1b |
| L3 | P7 | XS | 1 | Remove @-includes of `bin/lib/*.cjs` from command prompts | commands/pan/{cost,dashboard,hud,knowledge,mcp-bridge,preview,report,review-deep,what-if}.md | — | Interim test (folded into L2): no command @-includes bin/lib | — | 1b |
| L4 | P1 | S | 2 | Typed spawns: named agent types + resolved models; workflow-runner spawns keep general-purpose with `model=` (absorbs M39) | workflows/{plan-phase,new-project,discuss-phase,exec-phase,transition,quick}.md, commands/pan/research-phase.md | — | Spawn-scan test: every Task( has model=; general-purpose only where no role file exists | — | 1b |
| X1 | P7 | XS | 1 | Uninstall removes runtime directories it leaves empty (`docs/audits/STABILITY-TEST-2026-08.md`, uninstall section; re-seen in the `2026-10-12` sanity check) | bin/install.js (uninstall) | — | Scenario: five-runtime install then uninstall leaves no empty runtime dirs | — | 1b |
| A7 | P2 | M | 4 | Pre-tool guard hook on Claude/Codex/Copilot/Gemini (`hooks.guard: off\|report\|enforce`, ships `report`; `enforce` denies secret writes only); exec-phase writes a current-plan marker the guard reads for undeclared test edits | new hooks/pan-guard.js, bin/install-lib.cjs (HOOK_EVENT_MAP pre-tool slot), bin/install.js, scripts/build-hooks.js, workflows/exec-phase.md (plan marker), tests/fixtures/hook-vocabulary.json (re-read dates, payload fixtures), docs/HOOKS.md | V3 | Hook unit tests per host payload fixture; `report` never denies; `enforce` denies a secret write; install-matrix shows registration on four runtimes; uninstall removes it | Live Gemini behaviour — unproven without a key (§3.4) | 1b |
| H5 | P3 | M | 4 | Controls for every tier-0 scenario (sabotage must turn it red) + lint | harness/src/scenario.cjs, harness/src/run.cjs (--controls), harness/scenarios/*.json, tests/harness.test.cjs | — | Every tier-0 scenario killed by ≥1 control; a scenario without one is rejected | — | 1b |
| H3 | P3 | S+S+S | 6 | Harness statistics: Wilson, pass^k, paired test, SPRT, non-inferiority, power; `--until-decided`; interval-based promotion for tier ≥1; the no-guidance and deletion arms (absorbs M43) | new harness/src/stats.cjs, harness/src/run.cjs, harness/src/ledger.cjs, harness/README.md, tests/harness.test.cjs | — | Known values (Wilson 3/5 ≈ [0.231, 0.882]); SPRT decides both directions on synthetic streams; non-inferiority at δ; tier-0 promotion unchanged; arms selectable per scenario | — | 1c |
| L2 | P3 | M | 4 | Prompt-contract lint (flags, tools, pasted source, oversized question blocks, untyped spawns, dev-skill names) | scripts/test-quality-lint.cjs or new scripts/prompt-lint.cjs, tests/prompt-audit-fixes.test.cjs, allowlist | L3, L4 | Seeded-defect fixtures caught; current-tree violations fixed or allowlisted naming the fixing item (L6a/L6b) | — | 1c |
| HX1 | P6 | M+S | 6 | Release hardening for 3.35.0: doc audit of touched docs, CI matrix and CodeQL green, CHANGELOG, field-upgrade check | CHANGELOG.md, docs/*, .github/workflows/* | V1, A7, R45, H3, L2 | `node scripts/release-check.js` all gates pass; CI green on the PR; CodeQL no new alerts | — | 1c |
| H1 | P3 | L | 10 | Model double for every host (capture/script/replay; record proxies upstream and is not tier 0), wire assertions | new harness/src/model-double.cjs, harness/src/model.cjs (per-host env/config), harness/src/scenario.cjs, harness/src/assert.cjs (wire:, wire-count:), tests/harness.test.cjs | H5 | Tier-0 scenario per installed host: executor receives the whole agent body; red on a package that truncates it; asserts ran, not skipped, where the host CLI is present | — | 2a |
| CI1 | P3 | S | 2 | CI installs a pinned Claude Code CLI on the harness job so double-backed tier 0 runs in CI (no key: the double answers) | .github/workflows/ci.yml, harness/README.md | H1 | CI log shows the double-backed scenarios ran, not skipped | — | 2a |
| H2 | P3 | M | 4 | Cassettes with drift-as-prompt-impact (record via API keys only; stored outside the repo) | harness/src/model-double.cjs, harness/src/run.cjs (--record/--replay), normaliser | H1 | A committed synthetic cassette replays green at $0; a one-line agent edit yields drift for exactly that agent | Record the first real chain cassette with an API key (paid) | 2a |
| H7 | P3 | M | 4 | Model-based property tests over pan-tools state + nextAction fuzz (zero-dep PRNG + shrink) | new tests/helpers/pbt.cjs, new tests/state-machine-pbt.test.cjs | — | A planted off-by-one in phase insertion is found and shrunk to ≤4 commands | — | 2a |
| V2 | P1 | L | 10 | Engine-run test gate, any language: `workflow.test_command` or detection; `test run --phase/--baseline` → test-run.json; verifier copies test_gate; reconcile cross-checks | new pan-wizard-core/bin/lib/test-gate.cjs, pan-tools.cjs, config.cjs, verify.cjs (runFullTestCheck), workflows/verify-phase.md, workflows/exec-phase.md, agents/pan-verifier.md, verdict.cjs | V1, V9 | Parsers tested on real emitted output (node:test spec+TAP, jest, pytest, go, cargo, JUnit); a phase-1 regression seeded in phase 2 is caught; a crash reads failed, never skipped | — | 2b |
| V4 | P5 | M | 4 | RED/catch proof: new tests fail at phase base, pass at HEAD | new verify-red.cjs, worktree.cjs, pan-tools.cjs | V2 | Seeded tautological test rejected; real test passes | — | 2b |
| V5 | P5 | M | 4 | Mutation report on the diff (report mode; mutates changed lines only, no coverage collection); `mutate.cjs` lifted from scripts/mutation-probe.cjs | new pan-wizard-core/bin/lib/mutate.cjs, pan-tools.cjs (verify mutate), workflows/verify-phase.md, config (workflow.mutation_gate: off\|report\|gate) | V2 | Weak-test seed shows survivors; strong seed none; flake pre-check aborts on a flaky suite | — | 2b |
| H4 | P3 | L | 10 | Seeded-defect corpus + detection scoreboard (catch and false-alarm rates with intervals); reuses V5 operators | new harness/corpus/<id>/, harness/scripts/catch-rate.cjs, harness/src/run.cjs report | H3, H1, V5 | Scoreboard computed from replayed cassettes at $0; corpus seeds verified by V4 (each seed's test fails on the seeded diff) | Baselines for Claude × balanced × verifier + reviewer; a deliberately weakened verifier is rejected by SPRT (catch rate lower, α 0.05, β 0.2) (paid) | 3a |
| R49 | P3 | S | 2 | Re-run resume-cost and memory-not-loaded live | harness/ | H3 | — (evidence only) | Both ledger rows resolve or are re-diagnosed with a fresh finding (paid) | 3a |
| L1 | P3 | M | 4 | Liveness registry: every command/agent names a scenario; every verb has a prompt caller; every config key a reader | scripts/test-surface.cjs, tests/surface-map.test.cjs, tests/fixtures/surface-allowlist.json | — | `--check` fails on a seeded orphan command, verb and key | — | 3a |
| R1 | P5 | S | 2 | Diff-scoped review with intent: `review scope` verb from the commit range; plans, criteria and Review Focus passed to the reviewer | new review scope verb (verify-scope.cjs committedFiles), workflows/exec-phase.md (code_review), agents/pan-reviewer.md | V3 | `review scope` output contains a committed file absent from key-files (fixture) | — | 3a |
| R3 | P5 | S | 2 | Learned suppressions with lifecycle; security/logic never suppressed | findings.cjs (suppressions), agents/pan-reviewer.md, agents/pan-hardener.md | V6 | Unit: a dismissed signature is filtered; returns after its file changes; a security-category signature is never filtered | — | 3b |
| P4 | P2 | M+S | 6 | Review Focus in plans (M41) + executor concerns and cost-if-wrong (M42) | agents/pan-planner.md, agents/pan-plan-checker.md, plan template, agents/pan-executor.md, summary template, workflows/exec-phase.md, new `verify review-focus` | — | `verify review-focus` refuses a plan without the section; static return-contract test on the executor prompt and summary template | — | 3b |
| P2 | P5 | M | 4 | Decision spine with ids; uncited decisions caught in code | templates/design.md, agents/pan-designer.md, agents/pan-plan-checker.md, new `verify decisions` | — | `verify decisions` flags a fixture plan citing a missing decision id and a decision no plan cites | — | 3b |
| P3 | P5 | S | 2 | Research claims with provenance and freshness | agents/pan-phase-researcher.md, agents/pan-project-researcher.md, research template, new `research lint` | — | `research lint` flags a claim without source or date in a fixture research file | — | 3b |
| P6 | P5 | S | 2 | Cost forecast p10/p50/p90 per plan and phase | preview.cjs, cost.cjs | — | Unit test on a fixture ledger; refuses n < 5 | — | 3b |
| H9 | P3 | M | 4 | Scripted-user driver step | harness/src/scenario.cjs (kind user), harness/src/run.cjs, new seed discuss-needed | H1 | discuss-phase writes context.md after three scripted answers (double-backed, tier 0) | — | 3c |
| L5 | P7 | S | 2 | Generated /pan:help from command frontmatter | workflows/help.md generator, commands/pan/help.md | — | Every command appears in help (test) | — | 3c |
| L9 | P7 | S | 2 | Local usage census (`pan-tools usage`) | new verb in cost.cjs/optimize.cjs trace reader | — | Unit test on a fixture ledger | — | 3c |
| V1E | P1 | XS | 1 | Phase gate default flips to `enforce` | config.cjs, templates/config.json, docs | V1, V2 | Default-config test reads `enforce`; field-upgrade note in CHANGELOG | — | 3c |
| HX2 | P6 | M+S | 6 | Release hardening for 3.36.0 | CHANGELOG.md, docs/*, .github/workflows/* | H4, V1E, L1, P4, P2 | `node scripts/release-check.js` all gates pass; CI green; CodeQL no new alerts | — | 3c |
| R2 | P5 | L | 10 | Review lenses, k-pass voting and a validator; declined-to-judge lists (MI-118); opt-in until its evidence decides | agents/pan-reviewer.md, workflows/exec-phase.md, review-deep.cjs, verdict.cjs (declined field), bin/install-lib.cjs review pipeline, config (workflow.review_mode) | R1, H4, H3 | Lens/vote/validator plumbing replays from cassettes; `declined` field round-trips; default config keeps single pass | SPRT rejects p_new ≤ p_old for catch rate (α 0.05, β 0.2) and false alarms non-inferior within δ 0.05 on the corpus; if undecided inside the approved `--max-usd`, R2 stays opt-in (paid) | 4a |
| R5 | P5 | M | 4 | Proven findings: confirmed only with a catching test (fails on diff, passes on parent) | review-deep.cjs, verify-red.cjs, agents/pan-meta-reviewer.md | V4 | Fixture finding with a catching test is confirmed; without one it stays a candidate | MI-114 paired corpus run for the meta-reviewer edit (paid) | 4a |
| P5 | P5 | M | 4 | Reproduction per requirement + resolved-debug case base (`debug similar`) | agents/pan-debugger.md, workflows/diagnose-issues.md, knowledge.cjs roots, new debug similar verb | V4 | Seeded gap closes only when its reproduction turns green; case-base ranking unit test | — | 4a |
| V8 | P5 | L | 10 | Requirements with EARS criteria, requirements lint, truth→test trace matrix; ticks only on passing tests | templates/requirements.md, new requirements lint (milestone.cjs or requirements-lint.cjs), templates/phase-prompt.md, agents/pan-planner.md, verify.cjs reconcilePhase, phase.cjs markPhaseCompleteInRoadmap | V2 | Scenario-less REQ fails lint; an untested truth reads not_checked; a tick needs a passing mapped test | MI-114 paired corpus run for the verifier and planner edits (paid) | 4b |
| V10 | P5 | M | 4 | Property tests from EARS truths (project's own library); plan-check dimension 13 in code | agents/pan-planner.md, agents/pan-plan-checker.md, agents/pan-verifier.md, `verify plan-set` (property-task check) | V8, V5, V7 | `verify plan-set` flags a validation-rule truth with no property task; V5 flags a vacuous property on a seed | MI-114 paired corpus run for the plan-checker edit (paid) | 4b |
| L8 | P4 | M | 4 | UAT that runs on every runtime (walkthrough → uat.md → diagnose) | commands/pan/verify-phase.md (--uat), new workflow, templates/uat.md, workflows/diagnose-issues.md | H9 | UAT → diagnose → plan --gaps chain completes with the scripted user (double-backed) | — | 4b |
| L6a | P1 | M+S | 6 | Weakest commands, part 1: army merge gate via `pan-tools merge`, what-if cleanup guard in the prompt, cost clear backup, health per repair | commands/pan/{army,what-if,cost,health}.md + workflows/modules, mcp/merge-gate.cjs, pan-tools.cjs | V4, W0 | One test per fix, each proven red first | — | 5a |
| L6b | P2 | M+S | 6 | Weakest commands, part 2: settings batches, quality≠balanced, assumptions persisted, phase-tests via V4, retro gaps, preview ETA, audit-deployment moved to dev | commands/pan/{settings,profile,assumptions,phase-tests,retro,preview,audit-deployment}.md + workflows/modules | V4, P6 | One test per fix, each proven red first | — | 5a |
| P1 | P5 | M | 4 | Clarify with a taxonomy and a question budget | workflows/discuss-phase.md, workflows/new-project.md, references/questioning.md | H9 | Static prompt test: taxonomy and budget present; scripted-user plumbing writes answers back (double-backed) | ≤5 questions on three live seeds (paid) | 5a |
| A0 | P7 | M | 4 | `hosts.cjs`: one host table (merges runner.cjs and the harness MODEL_RUNTIMES argv) | new pan-wizard-core/bin/lib/hosts.cjs, runner.cjs, harness/src/model.cjs | — | Argv snapshot per host unchanged before and after the merge | — | 5a |
| L7 | P7 | L | 10 | Consolidate overlapping surfaces (status, milestones, learning, focus, research, profile, one next-action router; retire discord and mcp-bridge) via COMMAND_RENAME_MAP | commands/pan/*, workflows/*, constants.cjs (COMMAND_RENAME_MAP), mcp/orchestrator.cjs, docs | L1, L6a, L6b | Install-matrix + surface registry updated; renamed commands resolve on all five runtimes | — | 5b |
| R4 | P5 | M | 4 | Cross-family reviewer lane, opt-in per project | commands/pan/review-deep.md, review-deep.cjs, hosts.cjs, config key | A0, H1 | Tier-0 argv tests; lane off by default | One paid lane run: ledger row with lane id, reps, interval, verdict (paid) | 5b |
| A7b | P2 | M | 4 | State-file writers go through pan-tools verbs (roadmapper, new-project, milestone-new); then `enforce` adds the state-file and judge-write denies | agents/pan-roadmapper.md, workflows/new-project.md, workflows/milestone-new.md, new state write verb, hooks/pan-guard.js | A7 | No shipped prompt Writes state.md (grep test); `enforce` denies a direct state.md write; the three flows still produce state.md through the verb | — | 5b |
| M35 | P7 | M | 4 | Prompt-style pass, measured (deferred M34 findings) against baseline, no-guidance and deletion arms | commands/pan/*.md, agents/*.md | H3, H4 | Static checks on the changed prompts; cassette replay green | Per changed prompt, non-inferiority at δ 0.10 against baseline (paid) | 5c |
| H6 | P3 | M+M | 8 | Prompt-rule registry + prompt mutation testing | scripts/test-surface.cjs (prompt-rule rows), tests/fixtures/prompt-rules.json, harness/src/run.cjs (--prompt-mutant) | H4, H2 | `--check` fails on an unclaimed rule; mutant generation unit-tested | One mutant run: ledger row with rule id, reps, interval, verdict (live — a mutant drifts every cassette) (paid) | 5c |
| HX3 | P6 | M+S | 6 | Release hardening for 3.37.0 | CHANGELOG.md, docs/*, .github/workflows/* | L7, R2, V8, A7b | `node scripts/release-check.js` all gates pass; CI green; CodeQL no new alerts | — | 5c |
| A1a | P5 | M+M | 8 | Autodev core (pure): run ledger, unit selection from `.planning/`, code stop reasons, resume | new pan-wizard-core/bin/lib/autodev.cjs, pan-tools.cjs | V1, V2 | Unit: stop reasons gate_failed, budget_usd, turns, no_progress, human_needed, done each produced from fixture state; resume after a simulated kill continues the same unit | — | 6a |
| A1c | P5 | M+M | 8 | Autodev launch: fresh headless session per unit through hosts.cjs, orchestrator persists verified/merged, `/pan:autodev` command | autodev.cjs, hosts.cjs, mcp/orchestrator.cjs, new commands/pan/autodev.md | A1a, A0, H1 | Tier 0 with a fake host binary: a new session per unit, resume after kill, every A1a stop reason reached end to end | — | 6a |
| A4 | P5 | M | 4 | Failure-class router | autodev.cjs, core.cjs (escalateTier) | A1c | Table-driven tests per class | — | 6b |
| A5 | P5 | M | 4 | Flight recorder + proof dossier + replay | autodev.cjs, phase-report.cjs, findings.cjs | A1c | Snapshot test on a fixture ledger; replay gives identical decisions | — | 6b |
| A6 | P5 | M | 4 | Dollar governor between units (`max_usd_run` / `max_usd_day`, both per-run approvals) + stop past the P6 p90 forecast | autodev.cjs, cost.cjs, config.cjs, campaign.cjs | A1c, P6 | A run stops with budget_usd; a unit past p90 stops with forecast_exceeded | — | 6b |
| H8 | P3 | L | 10 | Deterministic simulation of the autonomy loops with seeded faults | harness/src/model-double.cjs (fault schedule), harness/scenarios/sim-*.json | H1, A1c, A6 | A sim fails with the stop guard disabled; passes on 20 seeds | — | 6b |
| A2 | P5 | L | 10 | Oracle and CI in the loop (`gh pr checks`, breaker, skip base-failing checks) | autodev.cjs, new ci.cjs (gh is an optional external CLI) | A1c | Fixture `gh` output: a fabricated test count is overridden; the breaker trips at N rounds; a base-failing check is skipped | — | 7a |
| A3 | P4 | L | 10 | Worktrees on every runtime: overlap partitioner, worktree per plan, shadow-merge preflight; native `agent({isolation:"worktree"})` on Claude | phase.cjs (partition), worktree.cjs, autodev.cjs, bin/install-lib.cjs (pan-exec-waves) | A1c, V7 | Two plans touching one file serialised; branches that pass alone but break together caught | — | 7a |
| S1 | P5 | M+M | 8 | Executable WATCH triggers + model-free market watcher (inbox, never verdicts) | new harness/autopilot/market-watch.cjs, docs/specs/watch-triggers.json, .claude/commands/market-ideas.md | — | Fixture responses flip the right rows; the inbox writer never touches the status column; nothing under harness/autopilot ships (`npm pack --dry-run` test) | — | 7b |
| S2 | P5 | M+S | 6 | Autopilot spine: model-free by default (watcher, dry runs); model lanes only on a per-run approval; bot branches local, never pushed; scope check; canaries; /execplan explicit staging | new harness/autopilot/autopilot.cjs, harness/autopilot/bot-scope-check.cjs, .claude/commands/execplan.md | — | Dry-run plan; scope check both directions; canary-gaming fixture refused; no push path (test asserts it) | — | 7b |
| S5 | P7 | S | 2 | Weekly State of PAN report (deterministic) | new harness/autopilot/state-of-pan.cjs | S1, S2 | Snapshot test | — | 7b |
| H10 | P5 | M | 4 | PAN vs the bare host (paired, per host) | harness/scenarios/*-stock.json, stats.cjs | H3, H1 | Paired scenario pairs validate and replay from cassettes | One host, paired reps, delta with an interval (paid) | 7c |
| HX4 | P6 | M+S | 6 | Release hardening for 3.38.0 | CHANGELOG.md, docs/*, .github/workflows/* | A2, A3, H8, S5 | `node scripts/release-check.js` all gates pass; CI green; CodeQL no new alerts | — | 7c |
| S3 | P5 | M | 4 | Verifiable fix lanes ordered by gate mechanicalness | harness/autopilot/autopilot.cjs, scripts/mutation-probe.cjs, scripts/test-surface.cjs, scripts/coverage-gate.cjs | S2 | A local `bot/<lane>/<id>` branch passes same-seed re-probe, quality lint and the suite; the owner opens any PR | — | 8a |
| V5G | P5 | S | 2 | Mutation gate mode (opt-in): score below floor turns passed into gaps | mutate.cjs, verdict.cjs, config | V5 | Gate mode on a seeded weak suite turns passed into gaps_found; default stays report | — | 8a |
| S4 | P5 | L | 10 | Guarded prompt evolution (held-out, deletion arm, SPRT; evaluator out of reach) | harness/variants/, harness/src/run.cjs, new tests/evolve-guard.test.cjs, new dev skill | H3, H4, H2, S2 | evolve-guard test: the evolver cannot write the corpus, scorer or held-out split | A degraded variant recovers to non-inferior (δ 0.05) against baseline on held-out data (paid) | 8a |
| S6 | P5 | L | 10 | PAN on PAN dogfood lane (`--global --config-dir` scratch install outside the repo) | harness/autopilot/autopilot.cjs, bin/install.js (--config-dir) | S2, A1c | One finding reaches a local bot branch with a passing verification and a clean scope check | The run itself spends model time (paid) | 8b |
| HX5 | P6 | M+S | 6 | Release hardening for 3.39.0 | CHANGELOG.md, docs/*, .github/workflows/* | S3, S4, S6, V5G | `node scripts/release-check.js` all gates pass; CI green; CodeQL no new alerts | — | 8b |

## Sprints and sessions

### Sprint 1: Deterministic gates (W1, 55 points)

- **Session 1a** (20 pts): W0 (2) → V9 (2) → V6 (4) → V7 (4) → V3 (4) → V1 (4)
- **Session 1b** (19 pts): R45 (2) → R47 (4) → R48 (1) → L3 (1) → L4 (2) → X1 (1) → A7 (4) → H5 (4)
- **Session 1c** (16 pts): H3 (6) → L2 (4) → HX1 (6)

**Exit criterion:** Every guarantee at the end of the loop is a pan-tools check (shipping in `warn`/`report` mode first); the destructive what-if path is closed; the OpenCode 2 plugin loads; the harness has statistics and controls.

**Release point:** Release **3.35.0** — "gates" (phase gate `warn`, guard `report`).

### Sprint 2: Measurement foundations (W2, 38 points)

- **Session 2a** (20 pts): H1 (10) → CI1 (2) → H2 (4) → H7 (4)
- **Session 2b** (18 pts): V2 (10) → V4 (4) → V5 (4)

**Exit criterion:** Model-tier checks run free against a local model double, in CI too; the test gate runs any language in the engine; tests are proven able to fail.

**Release point:** — (no release; foundations only).

### Sprint 3: Corpus and planning quality (W2/W3, 49 points)

- **Session 3a** (18 pts): H4 (10) → R49 (2) → L1 (4) → R1 (2)
- **Session 3b** (16 pts): R3 (2) → P4 (6) → P2 (4) → P3 (2) → P6 (2)
- **Session 3c** (15 pts): H9 (4) → L5 (2) → L9 (2) → V1E (1) → HX2 (6)

**Exit criterion:** Every judge has a scoreboard; the product surface has a liveness registry; plans carry Review Focus, decisions and sourced claims checked in code; the phase gate enforces. *Met in code and released in `3.36.0`; the scoreboards are computed from a scripted replay until H4's paid baseline runs.*

**Release point:** Release **3.36.0** — "measured" (phase gate `enforce`). *Released: `3.36.0` (tagged `v3.36.0` on `e7d1011`, PR oharms/PanWizard#48, published `2026-10-19`).*

### Sprint 4: Judges, measured (W3, 36 points)

- **Session 4a** (18 pts): R2 (10) → R5 (4) → P5 (4)
- **Session 4b** (18 pts): V8 (10) → V10 (4) → L8 (4)

**Exit criterion:** Review lenses ship opt-in with their evidence gate; findings are proven; requirements trace to passing tests; UAT runs everywhere.

**Release point:** — (ships with sprint 5).

### Sprint 5: Product surface (W3, 56 points)

- **Session 5a** (20 pts): L6a (6) → L6b (6) → P1 (4) → A0 (4)
- **Session 5b** (18 pts): L7 (10) → R4 (4) → A7b (4)
- **Session 5c** (18 pts): M35 (4) → H6 (8) → HX3 (6)

**Exit criterion:** Weakest commands fixed, overlaps consolidated, clarify budgeted, one host table, cross-vendor lane opt-in, state writes through verbs, prompt style changed only by measurement.

**Release point:** Release **3.37.0** — "surface".

### Sprint 6: Autonomy loop (W4, 38 points)

- **Session 6a** (16 pts): A1a (8) → A1c (8)
- **Session 6b** (22 pts): A4 (4) → A5 (4) → A6 (4) → H8 (10)

**Exit criterion:** A foreground loop runs a project unit by unit with code stop rules, a governor and a flight recorder, proven in simulation.

**Release point:** — (ships with sprint 7).

### Sprint 7: Autonomy breadth and the autopilot spine (W4/W5, 46 points)

- **Session 7a** (20 pts): A2 (10) → A3 (10)
- **Session 7b** (16 pts): S1 (8) → S2 (6) → S5 (2)
- **Session 7c** (10 pts): H10 (4) → HX4 (6)

**Exit criterion:** CI is the oracle; worktrees on every runtime; the ideas ledger watches itself; local bot lanes exist behind guard rails, model-free by default.

**Release point:** Release **3.38.0** — "autonomy".

### Sprint 8: Self-improvement (W5, 32 points)

- **Session 8a** (16 pts): S3 (4) → V5G (2) → S4 (10)
- **Session 8b** (16 pts): S6 (10) → HX5 (6)

**Exit criterion:** Fix lanes and prompt evolution run against evaluators they cannot edit; PAN runs its own loop on itself.

**Release point:** Release **3.39.0** — "self-improving".

**Every session's gate:** each item's code gate is green. `npm run test:all`, `node scripts/release-check.js` and `npm run harness` are green, and so are the doc gates. Each new or changed test is proven red against the pre-change code.

## Critical path

Longest dependency chain by points: `V6 → V1 → V2 → A1a → A1c → A6 → H8` (48 points). The measurement chain into prompt evolution is `V6 → V1 → V2 → V5 → H4 → S4` (42 points). Slipping any item on these chains delays everything after it. V1 and V2 together gate the autonomy sprints. H1 and H4 gate every measured claim. Every other item can move within its sprint.

## Paid steps (each needs a per-run `--max-usd` approval; there is no standing approval)

Since `2026-10-18` a model-tier harness run without `--max-usd` is capped at $15 (`PAN_HARNESS_MAX_USD` changes it; owner decision). The cap is a ceiling, not an approval: each paid step below is still asked for before it runs.

No paid step blocks a later item. If an evidence gate has not run or has not decided, its item still ships, in the mode the defaults table gives it.

| Item | Evidence run |
|---|---|
| V6 (session 1a) | Churn over five live repeated reviews |
| R45 (session 1b) | Live OpenCode 2 compaction check — needs OpenCode 2 on this machine (1.x installed); free through H1 once it lands, otherwise one paid run |
| H2 (session 2a) | Record the first real chain cassette with an API key |
| H4 (session 3a) | Baselines for Claude × balanced × verifier + reviewer; a deliberately weakened verifier is rejected by SPRT (catch rate lower, α 0.05, β 0.2) |
| R49 (session 3a) | Both ledger rows resolve or are re-diagnosed with a fresh finding |
| R2 (session 4a) | SPRT rejects p_new ≤ p_old for catch rate (α 0.05, β 0.2) and false alarms non-inferior within δ 0.05 on the corpus; if undecided inside the approved `--max-usd`, R2 stays opt-in |
| R5 (session 4a) | MI-114 paired corpus run for the meta-reviewer edit |
| V8 (session 4b) | MI-114 paired corpus run for the verifier and planner edits |
| V10 (session 4b) | MI-114 paired corpus run for the plan-checker edit |
| P1 (session 5a) | ≤5 questions on three live seeds |
| R4 (session 5b) | One paid lane run: ledger row with lane id, reps, interval, verdict |
| M35 (session 5c) | Per changed prompt, non-inferiority at δ 0.10 against baseline |
| H6 (session 5c) | One mutant run: ledger row with rule id, reps, interval, verdict (live — a mutant drifts every cassette) |
| H10 (session 7c) | One host, paired reps, delta with an interval. **Pilot run `2026-10-21`** (owner-approved, `--repeat 3 --max-usd 12`, run `run-20261021-171753-uQjOWG`): `pair-shout-live` against `pair-shout-live-stock` on Claude Code (Opus 5.5), seed `two-plan-phase`, goal "add `src/shout.js` with a `node --test` test", both judged by the seed's `npm test`. All 6 reps passed. Per rep: PAN arm $1.142, $1.105, $1.230 (253 s, 265 s, 338 s); stock arm $0.136, $0.154, $0.153 (22 s, 26 s, 29 s); $3.92 spent in all. Paired deltas, PAN minus stock, 95% t interval over 3 pairs: completion +0.00 [0.00, 0.00]; cost +$1.01 [+$0.85, +$1.17]; duration +260 s [+154 s, +366 s]. Reading: on a task this small the bare host completes every time, so PAN adds about $1 and four minutes with no completion gain to show; the comparison that can show one needs a goal the bare host fails on some reps, with more pairs. Not decided |
| S4 (session 8a) | A degraded variant recovers to non-inferior (δ 0.05) against baseline on held-out data |
| S6 (session 8b) | The run itself spends model time |

Recording uses API keys only, never a subscription login. Cassettes live outside the repository. H4's first baseline is limited to Claude × balanced × verifier and reviewer. The power figure in the program (about 79 reps per arm for 0.6 → 0.8) is why a wider matrix waits.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Sizing still optimistic | Sprints slip | Sessions stop at item boundaries; the next session absorbs the rest; release points move with their sprint, never ship a half sprint |
| V1 refusals break field projects | Users blocked mid-phase | Ships `warn`; `enforce` only after V2, with a CHANGELOG field-upgrade note; `--force --reason` always available |
| A7 denies a legitimate write | A shipped flow breaks | `report` first; state-file denies only after A7b moves the writers to verbs |
| Model double diverges from real hosts | Tier 0 green, live red | Wire assertions on captured real traffic; cassette drift reports; CI1 runs the double against a real CLI |
| Evidence gates never fund | Claims stay unmeasured | Items ship in their safe default; the ledger records "undecided" rather than a pass |
| External CLIs absent (OpenCode 2, Gemini key, `agy`) | Live checks skipped | Skipped is never green; recorded as a ledger row with the reason |
| Single point of failure in autodev | Sprints 6–8 stall | A1 split into a pure core (A1a) and launch (A1c); the host table (A0) lands first and is shared with R4 |

## Rules for execution

- Work one item at a time, in the order given. A later item never starts while an earlier item's **code gate** is red; evidence gates never block.
- Every code change lands with a test proven red against the pre-change code.
- Every item updates the docs it touches in the same change. Counts stay only in `CLAUDE.md`. Version-pinned model names appear only under `docs/specs/`, `docs/decisions/`, the CHANGELOG and dated reviews.
- Once H4 lands, an edit to a judge agent prompt (verifier, reviewer, plan-checker, hardener or meta-reviewer) records a paired, sequentially tested corpus result as its evidence gate (MI-114 as amended).
- Bot and autopilot tooling lives under `harness/autopilot/`, which is not shipped. A test asserts that `npm pack --dry-run` carries none of it.
- Nothing installs into the source repository. Installs and harness state live under `d:\pantesting`.
- Never push, publish or merge without the owner. Bot branches stay local. Each session ends with a `/commit` the owner reviews.

## What not to do

Carried from the program §3.5:

- No agent edits its own evaluator.
- No agent-reported number feeds a gate where code can measure it.
- No prompt change is measured with fewer reps than its power needs.
- No multi-agent debate.
- No chasing runtime counts, no personas, no always-on bootstrap.
- Exposure is deferred.

Carried from `market-ideas-2026-10.md`: PAN does not write OpenCode v2 config shapes.

Carried from §3.4: no background model spend. A model lane runs only in the foreground, on an approval for that run.

