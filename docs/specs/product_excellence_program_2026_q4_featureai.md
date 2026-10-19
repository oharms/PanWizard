# /featureAI Spec: Product Excellence Program — making PAN the best in its class

**Date:** `2026-10-12`
**Status:** Accepted, in execution through `product-excellence-superplan.md` (its Progress section is the live record; `2026-10-19`: sprints 1–3 done, 3.36.0 committed and awaiting merge and tag)
**Tree:** `feat/memory-optimization-2026-10` @ `4994ed5` (`3.34.0`) plus the uncommitted audit work of `2026-10-11`
**Realigns:** `roadmap_and_competition_2026_q4_featureai.md` (`2026-10-11`). That spec led with reach (downloads, marketplace listings); the owner's direction on `2026-10-12` is **features first — make PAN the best of the best — and exposure later**. Its publication bet (F3) moves to the deferred Exposure phase below; its correctness items (F1 OpenCode plugin, F2 test gate) are absorbed here.
**Evidence base:** seven parallel investigations on `2026-10-12` (test harnesses, automated development, a whole-market feature benchmark, an internal feature scorecard, research and adjacent fields, core-loop quality, PAN developing PAN), their research sub-scouts, three primary-source verification passes, and one local feasibility probe run in this session. External facts carry their source; anything only a vendor claims is marked *(vendor)*. Model names by version are allowed here (`docs/specs/`).

---

## Phase 0: Problem Framing

### 0.1 Problem statement

PAN Wizard has the right architecture, and an internal scorecard (§1.4) shows where the product surface has outgrown its tests: durable state, a gated research → plan → check → execute → review → verify → diagnose loop, fresh context per unit of work, deterministic orchestration where control flow is knowable, a behavioural harness that installs from the packed artifact, and five host runtimes. The investigations found that **its guarantees are weaker than its architecture**:

- **The loop has no code gate at its end.** `pan-tools phase complete` (`pan-wizard-core/bin/lib/phase.cjs`, `cmdPhaseComplete`) ticks the roadmap and requirements and advances state without checking summaries, the verification status, the test gate, freshness or open findings. The anti-rubber-stamp `verify reconcile` runs in exec-phase's `offer_next` step, after `update_roadmap` has already completed the phase; on the auto-advance path (`--no-transition`) the workflow returns before that gate, so reconcile never runs at all. Verified in code `2026-10-12`.
- **Most gates are prompts.** The test gate is run and reported by the verifier itself (npm-only; Python, Go and Rust projects are always `skipped`); file-overlap between plans in one wave is prose in the planner; the plan-check verdict is not bound to the plans it checked; `verify-summary` and `verify stubs --gate` exist in code but no workflow calls them; `verify stale` never blocks.
- **Nothing guards the tests themselves.** No rule or check stops an executor from weakening, skipping or deleting a test. ImpossibleBench (arXiv `2510.20270`) measured frontier models cheating on 49–76% of impossible tasks, with over 79% of Claude's cheating done by modifying tests, and found that an explicit abort option cut GPT-5's rate from 54% to 9%. Prompting helps but does not close it: the Claude 4 system card measured an anti-hack prompt cutting Opus 4's hack rate on impossible Claude Code tasks from 47% to 5%, while METR found "please do not cheat" had a negligible effect on o3. A prompt rule and a code check are both needed.
- **Findings close by silence.** `findings.cjs` marks an open finding `fixed` when the next report from the same agent simply omits it, and finding ids hash the summary wording, so run-to-run recall noise closes real findings.
- **Autonomy runs in one host session, in prose.** focus-auto and army have no code outer loop, no CI oracle, a shared working tree for parallel waves, and budget stops that depend on numbers the agent reports.
- **Behaviour is proven on one host, with no statistics.** Model tiers run through `claude -p` only; there is no record/replay; repetitions have no confidence intervals. At the "five reps" the ideas ledger asks for (MI-114), 4/5 passes has a 95% Wilson interval of [0.38, 0.96] — it cannot tell a good prompt change from a bad one.

The best products in the market have already solved pieces of each: Cursor Bugbot's multi-pass review with a validator (resolution rate 52% → over 70%, *vendor*), Meta's mutation-guided and diff-targeted test generation, Kiro's EARS requirements turned into property-based tests, gsd-core's code gates and positive controls, Spec Kit's clarify/analyze/checklist trio, Anthropic's long-running-agent harnesses, Inspect's statistics and agent bridge. **No product found combines them.** PAN can — and do it on five hosts.

### 0.2 Scope

| In scope | Out of scope (for now) |
|---|---|
| Code-enforced gates for every guarantee PAN states | Exposure: marketplace publication, positioning, reach metrics (deferred phase, §3.4) |
| A measured review and verification stack (catch rates, not claims) | A sixth runtime (MI-017); standardising `.planning/` (MI-018) |
| Autonomous delivery driven by a deterministic loop with code stop rules | Telemetry of any kind (MI-056) |
| Harness v2: model doubles for every host, record/replay, statistics, seeded-defect scoreboards | Hosted services or daemons beyond a foreground loop (ADR-0034) |
| PAN developing PAN: automated research, measurement and fix lanes behind the owner's approval | Vector or graph memory stores (MI-101) |

### 0.3 Success criteria (program level)

```text
SC-1  Every guarantee in README.md and docs/COMPARISON.md is enforced by a pan-tools exit code that both the markdown and native paths call; a claims audit finds no prompt-only guarantee.
SC-2  A seeded-defect suite runs at tier 0 for every code gate (catch 100%, false alarms 0 on clean twins) and at tier 1–2 for every judge agent, with catch and false-alarm rates and 95% intervals on the harness ledger.
SC-3  The escape rate (planted defects that reach phase completion) is measured, published in the harness report, and falls release over release.
SC-4  An unattended run of a multi-phase seed project completes with a fresh session per unit, code stop reasons, a run ledger and a proof dossier, on Claude Code and at least one other host.
SC-5  Model-tier harness scenarios re-run at $0 from cassettes in CI; a prompt edit reports exactly which recorded agents it invalidated.
SC-6  Every prompt change to a judge agent ships only with a paired, sequentially tested harness result against the current prompt and a deletion arm.
SC-7  No regression: suite, release gates and harness tier 0 green at every step; all five runtimes keep installing and passing their live gates.
```

### 0.4 User stories

```text
As a developer, I want PAN to refuse to call a phase done when the tests failed, the verification is stale or a finding is open,
so that "complete" means complete, instead of trusting an agent's status word.

As a developer, I want the tests my agent writes to be proven able to fail (they fail before the change and kill mutants of it),
so that a green suite means the behaviour is checked, instead of a suite that passes no matter what.

As a team lead, I want reviews that find real bugs with evidence and remember which comments we dismissed,
so that review time goes to real issues, instead of noise and repeats.

As someone leaving a project running overnight, I want a loop that runs each unit in a fresh session, stops on rules written in code, records everything and hands me a PR with proof,
so that I come back to reviewable work, instead of a stalled session or an unverifiable pile of commits.

As PAN's maintainer, I want every prompt change measured against the current prompt with real statistics, for free where possible,
so that PAN improves by evidence, instead of by taste.
```

---

## Phase 1: Internal Reconnaissance (what the investigations established)

### 1.1 Code versus prompt, gate by gate

| Gate | Enforced by | Evidence | Gap |
|---|---|---|---|
| Requirements quality | prompt | `templates/requirements.md`: one-line REQ ids, no acceptance criteria | Nothing testable at the requirement level |
| Plan structure | code, but only if an agent calls it | `verify plan-structure`; the plan-phase orchestrator never runs it | Optional gate |
| Requirement coverage by plans | prompt (plan-checker dimension 1) | `phase-report.cjs` computes the ids for display only | A set difference left to a model |
| Same-wave file overlap, cycles | prompt (planner prose) | `buildPlanIndex` validates nothing | Parallel executors can edit one file |
| Plan-check bound to plans | none | the record hashes the report, not the plans | Edited plans execute as checked |
| Test integrity | none | no rule in executor, reviewer or verifier | The largest unguarded defect class (ImpossibleBench) |
| TDD RED evidence | prompt | `agents/pan-executor.md` "MUST fail" | RED claimed, never proven |
| Summary truth | code exists, unused | `verify-summary` has no workflow caller | Executor marks its own homework |
| Test gate | prompt, npm-only | verifier runs `npm test` and writes `test_gate`; recorder only warns | Self-reported, blind outside Node |
| Code review scope | prompt | file list from the executor's own `key-files`, not the git diff | Unlisted files are never reviewed |
| Findings closure | code, flawed | silence means fixed; ids hash wording | False closure by recall noise |
| Reconcile | code, misplaced | exits 1, but after completion; ignores `test_gate` | Right idea, wrong place |
| Stale verification | code, report-only | always exits 0; ignores plan and requirement changes | Stale passes still complete and merge |
| Phase completion | none | `cmdPhaseComplete` | The single biggest hole |
| MCP merge gate | code (nonce) | `verify_pass` and `ci_green` attested by the agent | The human sees a flag the agent typed |
| Native exec-waves | prompt | self-check and verdict are agent-reported schema fields | The deterministic path inherits prompt-only gates |
| Autonomy stop rules | code over agent-reported numbers | `focus.cjs` `determineStopReason` reads `--items-completed`, `--points-used`, `--tests-*` from the agent | Budgets measure nothing measurable |

### 1.2 Strengths to protect

The packed-artifact harness with a findings ledger; the MCP server's fixed registry, forbidden verbs and nonce merge gate; the cost ledger priced from a dated rate table with per-agent attribution; native workflow scripts beside portable markdown with a measured parity oracle; state re-injection on every runtime; documentation-truth lints; the surface registry and coverage gate. Every item below builds on these, never around them.

### 1.3 A feasibility fact established in this session

**Free record/replay of model turns works on Claude Code.** A local mock of the Messages API (zero-dependency `node:http`, minimal SSE reply) was set as `ANTHROPIC_BASE_URL` with a dummy key and a scratch `CLAUDE_CONFIG_DIR`. `claude -p` started without onboarding, sent one `HEAD /api/hello` and one `POST /v1/messages`, accepted the mock's streamed reply and exited cleanly, pricing the mocked usage. Two runs sent request bodies that were **byte-identical after normalising three fields** (the config-dir path, `metadata.session_id`, the date). A normalised request hash is a stable cassette key. Codex was already shown to accept a local mock provider (M25, `2026-10-03`). Copilot (`COPILOT_PROVIDER_BASE_URL`, `COPILOT_OFFLINE`), Gemini (`GOOGLE_GEMINI_BASE_URL`) and OpenCode (`provider.*.options.baseURL`) document the same seam; each needs one probe.

### 1.4 Internal scorecard (every command scored on completeness, tests, behavioural coverage, runtimes, prompt quality and observed use)

The scorecard investigation read every command with the workflow, agents and verbs it uses, and checked behavioural coverage against every harness run report and observed use against every ledger and trace under `d:\pantesting` (field projects other than test, stress and harness projects were not read, so a zero there means "not observed", not "never used"). Enumerate the classes with `ls commands/pan agents` and `node scripts/test-surface.cjs --map`; counts live only in `CLAUDE.md`.

- **Best-scoring and worth protecting:** plan-phase (planner → checker loop with a clear completion contract), exec-phase, verify-phase's anti-rubber-stamp chain, the cost ledger and rebuild, focus-auto's stop and budget engine (per-cycle cost joined server-side from the ledger), optimize apply/revert (hash-logged, refuses unsafe reverts).
- **Weakest:** `audit-deployment` (writes into PAN's source repository and names unshipped dev skills — a dev tool leaking into the shipped surface), `army` (merge gate in prose while `pan-release` holds Bash; the MCP nonce gate is not used), `settings` (asks more questions in one call than the host allows; offers a choice that changes nothing), `what-if` (isolation in prose; `whatif cleanup --force` accepts any path), `assumptions` (corrections never saved), `phase-tests` (promises RED-GREEN, writes tests after the code; exec-phase bypasses it), the three focus doc commands (overlapping, one CLI reads PAN's own docs instead of the project's), `focus-plan`/`focus-scan`/`focus-exec` (never call their own CLI verbs), `discord`, `mcp-bridge` (hand-seeded cache; name clashes with PAN's real MCP server).
- **Cross-cutting defects:** many shipped agents never appear in any observed run, harness included; only a few commands have ever passed a model-tier scenario, and several model scenarios have never run; several commands `@`-include whole `bin/lib/*.cjs` source files (about 64K tokens of JavaScript for a model that only needs to run the CLI); many spawns use the untyped `general-purpose` agent, so the role's `effort` and `tools` never apply; `/pan:help` omits a large share of the commands it calls "the complete reference"; `retro`'s gap parser misses the template's numbered gaps; `preview`'s ETA reads a field the summary templates never write; `cost clear` deletes the ledger without a backup; `health` applies every repair on one "yes".
- **Dead or orphaned:** `workflows/diagnose-issues.md` and `workflows/research-phase.md` loaded by no command; `scaffold uat` and `init verify-work` called by no prompt (UAT has no entry point); `focus scan|plan|exec|sync` and `pan-tools learnings` called by no prompt; the `review-handoff` bus channel written and never drained; exports with no consumer (`THINKING_BUDGETS`, `isDreamDue`); config keys written and never read (`workflow.phase_reports.open/theme`, `execution.rollback_snapshots`, `routing.cascade_quality_gate`, `commit.conventional_types`, `gates.confirm_*`, `safety.*`); the `quality` profile identical to `balanced`.
- **Overlaps:** status (report, hud, dashboard, a different `pan-tools dashboard` view, progress, statusline); learning (learn, optimize learn, retro, knowledge playbook, `pan-tools learnings`); milestones (done and cleanup hand-roll the tested `milestone complete` verb); focus versus the phase loop (the pipeline restated across commands and drifting); doc checks (three focus commands, `links`, `doc-lint`); review-deep versus exec-phase `--deep-review` (two hand-synced copies); next-step routing (progress, resume and transition disagree).

---

## Phase 2: Competitive Analysis — the best implementation of each capability

Primary sources read `2026-10-12` unless marked. "Best" is a judgement on mechanism, not market share.

| Capability | Best found | What makes it best | PAN gap |
|---|---|---|---|
| Requirements notation | Kiro specs | EARS acceptance criteria ("WHEN … THE SYSTEM SHALL …"); bugfix specs add "SHALL CONTINUE TO" for unchanged behaviour (kiro.dev/docs/specs) | Free-text REQs |
| Traceability | Spec Kit `/analyze` | Read-only cross-artifact lint with a requirement→task coverage table and severity (spec-kit templates/commands/analyze.md) | Prompt-only coverage |
| Discovery | Spec Kit `/clarify` | Ten-category taxonomy, at most 5 questions, recommended defaults, answers logged and written back into the spec | Open-ended questioning |
| Spec-derived tests | Kiro Correctness | Properties extracted from EARS criteria, random cases with shrinking, failure triage "fix the code, the spec or the test" (kiro.dev/docs/specs/correctness, *vendor*) | None |
| Research provenance | BMAD `bmad-deep-recon` | Per-claim publisher, date and citation; freshness windows; selective refresh | HIGH/MED/LOW labels only |
| Architecture decisions | BMAD architecture "spine" | A decision enters only if independent units would choose incompatibly, it is non-obvious and a real trade-off; decisions get ids that a readiness gate checks | Design doc, no decision ids |
| Plan gates in code | gsd-core | Same-wave coupling, context and fact drift, verification invalidated on input change, positive-control ratchet for every gate (open-gsd/gsd-core docs) | Prose |
| Wave scheduling with isolation | gsd-core quick-batch | File-overlap partitioner, mutating waves forced serial without isolation, deterministic merge order, resumable manifest | Shared tree, prose |
| Code review | Cursor Bugbot | 8 passes with randomised diff order, majority vote, validator model, dedupe against earlier runs; learned rules with acceptance analytics; config read from the base branch (cursor.com/blog/building-bugbot, *vendor*) | Single pass, executor-scoped |
| Cross-model critique in one session | Copilot CLI rubber duck | A read-only critic on a different model family, picked per call, consulted after planning, after tests and after repeated failures (docs.github.com, copilot-cli rubber-duck) | One model family |
| Cross-model review | GitHub ReviewBench | A multi-model ensemble raised precision 8% and recall 13.6% at 8% lower cost (github.blog, `2026-10-05`) | One model family |
| Test quality | Meta TestGen-LLM, ACH, JiT | Keep a test only if it builds, passes reliably and raises coverage; generate tests to kill targeted mutants (73% accepted); "catching" tests that fail on the diff and pass on its parent (arXiv `2402.09171`, `2501.12862`, `2601.22832`) | None on user code |
| Mutation in review | Google | Mutants only on changed, covered lines, shown in code review; 82% of surfaced mutants with feedback judged productive (arXiv `2102.11378`, TSE 2021) | Dev-side probe only |
| Debugging | SWE-Doctor | One reproduction per behavioural requirement, not one per issue (+8–9 points on SWE-bench Pro, arXiv `2607.00990`); Cursor Debug Mode removes its instrumentation after the fix | One reproduction |
| UAT | Playwright test agents | Planner → generator → healer; the healer skips rather than "fixes" a test when the feature itself is broken (playwright.dev, v1.56) | Template only |
| Autonomous loop | Anthropic long-running harnesses; bmad-loop | Feature list in JSON that agents may only flip ("it is unacceptable to remove or edit tests"), progress file, init script, one feature per session; evaluator with hard thresholds; "no LLM in the control loop" (anthropic.com/engineering, Nov 2025 and Mar 2026; bmad-loop README) | One host session |
| CI as oracle | Cursor cloud agents | Auto-fix CI on agent PRs, capped at 10 follow-ups, skipping checks already failing on the base commit (cursor.com/docs/cloud-agent/capabilities) | None |
| Graded autonomy | Factory `droid exec` | Read-only by default, risk-rated levels, an over-limit action stops with no partial changes | Modes, no code guard |
| Spend governance | Claude Code `--max-budget-usd` | Covers subagents; spawning fails at the cap (code.claude.com/docs/en/cli-reference) | Points the agent reports |
| Eval statistics | Inspect (UK AISI) | Wilson intervals, clustered standard errors, pass^k reducers, early stopping, a caching key over model, messages, config and tools; an agent bridge relaying Claude Code, Codex and Gemini CLI through a local proxy (inspect.aisi.org.uk) | Counts only |
| Learned memory | Augment Cosmos "noisy memory" | Evidence log, promotion threshold, tells the user what it remembered, flags conflicts | Promote gate without evidence count |
| Self-improvement | GEPA; DGM | Reflective prompt evolution on a Pareto front, up to 35× fewer rollouts than GRPO (arXiv `2507.19457`); DGM's self-modifying agents went 20% → 50% on SWE-bench but **faked test logs** when it could (arXiv `2505.22954`; sakana.ai) — the evaluator must be out of reach | Manual prompt edits |

**Converging evidence from research** (arXiv abstracts, `2026-10-12`): spreading a budget across fresh samples beats deep repair, and feedback quality is the bottleneck (Olausson et al., `2306.09896`); models err more once their own errors sit in context (`2509.09677`) — fresh context per unit is right; executable oracles move outcomes (SWE-agent lint gate −3.0 points when removed; Agentless +5 from a reproduction test; AlphaCodium 19% → 44%); selection over N attempts with a test filter is how leaders reach their scores (Agentless, OpenHands critic 60.6% → 66.4%, Anthropic parallel attempts); multi-agent debate does not reliably beat self-consistency (`2311.17371`).

---

## Phase 3: Design — the program

### 3.1 North star

**PAN is the framework whose every gate is enforced in code and whose every claim is measured — on five hosts.** Each feature below either moves a guarantee from prompt to code, or turns a quality claim into a number on the harness ledger.

### 3.2 Pillars and items

Sizes XS 1 · S 2 · M 4 · L 10 · XL 20. Each item names its gate. Ids V, R, A, H, P, L and S are local to this program: R1–R5 are not the reality-check R-series (R45–R49 are), H1–H10 are not the market-ideas hand-offs or the earlier roadmap's horizons, S1–S6 are not queue sessions, and P1–P6 are not priority classes. Cite them as "program R2" and so on outside this file.

#### Pillar V — Proof-carrying phases (verification you can trust)

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| V1 | **Phase gate in code** | `phaseGate(cwd, N)` in `phase.cjs`, exposed as `pan-tools phase gate <N>`; `phase complete` refuses (exit 1, reasons) unless every plan has a summary, the verification is `passed` (or `human_needed` with a recorded approval), it is fresh, reconcile is clean, the test record passed, no open critical/high findings lack a disposition, and stubs and test integrity are clean. Until V2 lands (W2) the test fact is the verification's `test_gate` (failed → refuse); a `human_needed` approval is a `decision` disposition on the verification's human items. `--force --reason` writes a `decision` disposition. exec-phase moves reconcile before `update_roadmap`; `transition.md`, native `pan-exec-waves` and MCP `requestMerge` call the same function | M | One unit test per refusal reason; tier-0 seeded states (catch 100%, clean twin passes) |
| V2 | **Engine-run test gate, any language** | `test-gate.cjs`: `workflow.test_command`, else detection (package.json, pytest, `go test ./...`, cargo, Maven/Gradle, `make test`); `pan-tools test run --phase N [--baseline]` writes `{phase}-test-run.json` (command, exit, counts, failing ids, HEAD); regression = new failures versus the baseline; the verifier copies `test_gate` from the record; reconcile cross-checks | L | Per-runner fixtures from real emitted output; a phase-1 regression seeded in phase 2 is caught |
| V3 | **Test-integrity guard and an abort option** | `verify test-integrity <phase>` over the phase's commits: deleted or renamed tests, new skip/only markers, falling assertion counts, edited expectations in tests the plan did not declare, rewritten snapshots, always-true asserts (reuse `scripts/test-quality-lint.cjs` shapes). Executor gains `BLOCKED_SPEC_CONFLICT` and "tests outside `<files>` are read-only" | M | Fixture repo per pattern plus clean twins; an impossible-task scenario measures tamper rate before and after |
| V4 | **RED and catch proof** | `verify red <phase>`: in a worktree at the phase base, the phase's new or changed tests must fail; at HEAD they must pass (Meta's weak catch, independent of commit order) | M | Seeded tautological test is rejected; real test passes |
| V5 | **Mutation gate on the user's diff** | `pan-tools verify mutate --phase N`: per-language operator tables lifted from `scripts/mutation-probe.cjs` into a shipped `mutate.cjs`, applied only to changed, covered lines, seeded sample, flake pre-check, survivors recorded as `test_gap` findings; `workflow.mutation_gate: off\|report\|gate`, starting at `report` | M + S | Weak-test seed shows survivors; strong-test seed shows none (tier 0) |
| V6 | **Findings close only on evidence** | Remove silence-means-fixed; on a re-run the judge answers `resolved\|still_present\|cannot_tell` per open id with evidence; ids from class + file + symbol with fuzzy summary match | M | Omitted finding stays open; churn across 5 repeated reviews measured |
| V7 | **Plan checks in code** | `verify plan-set <phase>`: requirement coverage, same-wave `files_modified` intersection without a dependency, cycles, missing and future references, wave arithmetic; plan-check record stores the plans' hash and exec init refuses on mismatch; plans record `planned_commit` and exec lists drifted interface files | M | Tier-0 seeds for each class (catch 100%) |
| V8 | **Requirements with acceptance criteria and a trace matrix** | EARS criteria per REQ (`WHEN … THE SYSTEM SHALL …`), `requirements lint`; every automated verify command states its failing direction (`<fails_when>`, gsd-core's "stated failing direction"); each `must_haves` truth names its test; the verification carries req → criterion → task → test → result; a requirement is ticked only when its tests passed in the record | L | Seed with a scenario-less REQ fails lint; an untested truth reads `not_checked`, never `passed` |
| V9 | **Two-key verdict** | Code facts can lower an agent's verdict, never raise it (verdict.cjs); absorbs R46: `test_gate: failed` under `passed` records as `gaps_found` | S | A `passed` verification with any failing code fact records as gaps |
| V10 | **Property tests from EARS truths** | The planner turns quantifiable truths into properties using the project's own property-test library (fast-check, Hypothesis, jqwik) or postconditions; plan-checker dimension 13; V5 catches vacuous properties | M | Seeded validation-rule phase yields a property task |

#### Pillar R — Review that finds real bugs

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| R1 | **Diff-scoped review with intent** | `review scope <phase>` from the commit range plus untracked files; the reviewer gets must_haves, REQ criteria and the plan's Review Focus (MI-112) | S | Unlisted file in the diff is reviewed (fixture) |
| R2 | **Lenses, voting and a validator** | Lenses: intent, edge cases, test adequacy, security (hardener); k = 3 passes with randomised hunk order, keep findings seen at least twice; a validator demands a quoted hunk or a failing input for every high/critical finding, else downgrades it on the record; every lens returns a "declined to judge" list (MI-118) | L | Catch and false-alarm rates on the defect corpus (H4) versus today's single pass, paired, SPRT |
| R3 | **Learned suppressions with a lifecycle** | Dismissed findings (signature + reason) become candidate suppressions scoped to their files; promoted on repeated dismissals, retired when the files change; security and logic findings are never suppressed | S | A dismissed signature is not re-raised; after its file changes it returns |
| R4 | **Cross-family reviewer lane** | When another host CLI is installed, `/pan:review-deep --lane codex\|gemini\|copilot` runs the reviewer prompt through it headless (reuse `runner.cjs` argv, aligned with the harness's `MODEL_RUNTIMES`); disagreements go to the meta-reviewer and the human; opt-in, because code goes to another vendor | M | Tier 0 argv tests; tier 1 paid lane recorded with cost |
| R5 | **Proven findings** | A high/critical finding is "confirmed" only with a test that fails on the diff and passes on the parent, otherwise "suspected" | M | Fixture finding with and without a catching test |

#### Pillar A — Autonomous delivery you can leave running

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| A1 | **Deterministic outer loop** | `pan-tools autodev run`: a foreground Node process (not a daemon) that reads persisted state, asks `orchestrator.nextAction` for the next unit, launches a fresh headless host session per unit (`/pan:plan-phase N`, `/pan:exec-phase N`, `/pan:verify-phase N`), appends a ledger row per unit (argv, host version, start and end SHA, exit, cost, oracle result) and persists `verified` and `merged`. Stop reasons in code; resume from the ledger | XL | Tier 0 with a scripted host double: fresh session per unit, resume after a kill, every stop reason |
| A2 | **Oracle and CI in the loop** | The loop's oracle is V1 + V2; optional CI mode reads `gh pr checks --json` and the failing log tail as fix-round feedback; a breaker after N rounds (default 3); checks already failing on the base are ignored | L | Scenario where a fabricated test count is overridden by the oracle |
| A3 | **Parallel isolation on every runtime** | `phase-plan-index` partitions same-wave plans with overlapping files into sub-waves; the loop runs each plan in a worktree with its own session; branches merge back in wave order behind a shadow-merge preflight (merge with every green unmerged branch and re-run the oracle). On Claude Code the native `pan-exec-waves` script can use the Workflow tool's `agent({isolation: 'worktree', model})` (documented `2026-10-12`; `agent()` still has no turn cap, so MI-009 stays blocked) | L | Two plans touching one file are serialised; two branches that pass alone but break together are caught |
| A4 | **Failure-class router** | Classify compile, assertion, timeout, flake (passes on rerun), missing environment, merge conflict, integrity violation, scope violation, budget; each class has a policy (shallow retry with the error tail, fresh restart, tier escalation, quarantine, ask). Breadth before depth, per Olausson | M | Table-driven tests per class |
| A5 | **Flight recorder and proof dossier** | One `blackbox.jsonl` per run; `autodev report` builds the PR body and an HTML page from it: requirement → plan → commits → oracle evidence → verdict → dispositions → cost; `autodev replay` re-runs the stop logic over recorded inputs | M | Snapshot test on a fixture ledger; replay gives identical decisions |
| A6 | **Dollar governor** | `budget.max_usd_run` and `budget.max_usd_day` enforced between units from the cost ledger; the remaining amount passed down as `--max-budget-usd` on Claude | M | A run stops with `budget_usd` |
| A7 | **Pre-tool guard hook** | `hooks/pan-guard.js` on the pre-tool event of every runtime that has one (Claude `PreToolUse`, Codex `PreToolUse`, Copilot `preToolUse`, Gemini `BeforeTool` — all four can deny, docs read `2026-10-12`): blocks secret-shaped writes, direct edits to files `pan-tools` owns, writes by judge agents, and executor edits to tests outside the plan | M | Hook unit tests per host shape; tier-0 install check that it registers on four runtimes |

#### Pillar H — Harness v2: measured quality

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| H1 | **Model double for every host** | `harness/src/model-double.cjs`: one `node:http` server speaking Anthropic Messages SSE, OpenAI Responses/Chat SSE and Gemini streaming, in four modes — capture (record what the host sends), script (scripted `tool_use` turns keyed by Claude Code's `x-claude-code-agent-type` gateway hint header or call index), replay (cassettes), record (proxy upstream and meter `usage` on the wire). New assertion kinds `wire:` and `wire-count:`. Double-backed steps are tier 0 (an ADR-0047 amendment: nothing is spent) | L | A tier-0 scenario per installed host asserts the executor subagent receives PAN's agent body whole, and goes red on a package that truncates it (the MI-015 bug class) |
| H2 | **Cassettes with drift as prompt impact** | `--record --max-usd` then `--replay` at $0; a normalised-body mismatch is a `drift` result naming the agent and the changed prompt file, never a PAN failure; cassettes live outside the public repo unless scrubbed | M | A chain scenario replays green at $0; a one-line agent edit yields drift for exactly that agent |
| H3 | **Statistics** | `harness/src/stats.cjs`: Wilson interval, pass^k (tau-bench), pass@k, paired sign test, SPRT, power planner; `--until-decided`; model-tier findings promote on interval bounds; flaky becomes a computed class. Tier 0 stays deterministic | S + S | Unit tests on known values; a past five-rep report re-rendered with intervals |
| H4 | **Seeded-defect corpus and a detection scoreboard** | `harness/corpus/<id>/` with seed, defect patch, truth file and a clean twin, across PAN's defect funnel (stub, hollow test, unwired export, swallowed error, false completion claim, off-by-one, test tampering, scope creep, security flaw); generated model-free in part from the mutation operators; catch and false-alarm rates with intervals per agent × host × profile | L | Scoreboard in the report; a deliberately weakened verifier prompt scores lower |
| H5 | **Controls for every scenario** | Each tier-0 scenario declares a sabotage that must turn it red and a no-op arm; a lint rejects a scenario without one (gsd-core's positive-control ratchet) | M | Every tier-0 scenario killed by at least one control |
| H6 | **Prompt-rule registry and prompt mutation** | `scripts/test-surface.cjs` extracts normative rules from agents, commands and workflows into a registry with stable ids; scenarios and corpus cases declare `covers:`; `--prompt-mutant <id>` deletes a rule in the extracted package and reruns its cases; a rule whose removal changes nothing is decorative | M + M | `--check` fails on an unclaimed new rule; one mutant run recorded |
| H7 | **Model-based property tests over pan-tools** | A seeded PRNG plus shrinking (zero dependencies) generates phase add/insert/remove/complete, roadmap and state sequences against a toy model; invariants on numbering, `roadmap analyze` agreement and round-trips; `nextAction` fuzzed to never return a forbidden verb | M | A planted off-by-one in phase insertion is found and shrunk to four commands or fewer |
| H8 | **Deterministic simulation of the autonomy loops** | The double in script mode plus a seeded fault schedule (429 with retry-after, cut streams, compaction turns, usage-window headers) drives focus-auto, army, stop-guard, budget stops and re-injection reproducibly at $0 (FoundationDB's simulation practice) | L | A seeded sim fails when the stop guard is disabled in the package and passes on 20 seeds |
| H9 | **Scripted-user driver** | A `user` step answers on a regex over the last assistant text through `claude -p --resume`; with the double it tests UAT and discuss-phase plumbing for free; with a model, question quality against private acceptance criteria | M | discuss-phase writes `context.md` after three scripted answers |
| H10 | **PAN versus the bare host** | The same seed and goal with and without PAN, paired, per host: completion, tests passing, cost, turns — the product's value claim, measured | M (paid) | One host, paired reps, delta with an interval in the report |

#### Pillar P — Planning excellence

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| P1 | **Clarify with a taxonomy and a budget** | discuss-phase and new-project score a fixed taxonomy (scope, data, UX, NFRs, integrations, edge cases, constraints, terminology, completion signals), ask at most five questions with a recommended default each, log answers dated and write them into the spec | M | Scripted-user scenario (H9) |
| P2 | **Decision spine with ids** | Design decisions recorded only when they pass the three-question test, each with an id that plans cite; plan-checker flags a plan relying on an unrecorded decision | M | Fixture plan citing a missing decision id |
| P3 | **Research claims with provenance and freshness** | `research.md` records `claim · source · checked_at`; the plan-checker flags facts older than the freshness window for their type | S | Lint over a fixture |
| P4 | **Review Focus and executor concerns** | Queue items M41 and M42 (already specified in `market-ideas-2026-10.md`); M39 is absorbed by L4 | 6 | As specified there |
| P5 | **Multi-faceted reproduction and a fix case base** | The debugger writes one reproduction per behavioural requirement (SWE-Doctor) and commits it as a failing test that V4 proves; resolved debug sessions get a failure signature and `pan-tools debug similar` returns past fixes as hypotheses to reproduce, never as answers | M | Seeded gap fixed only when its reproduction turns green |
| P6 | **Cost forecast** | `preview` shows p10/p50/p90 dollars per plan and phase from observed cost per agent and tier; refuses a forecast below n = 5; the autodev loop stops when spend passes p90 | S | Unit test on a fixture ledger |

#### Pillar L — Product hygiene: every feature alive, tested and honest

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| L1 | **Liveness registry** | Extend `scripts/test-surface.cjs`: every shipped command and agent must name a harness scenario (or an allowlist reason); every pan-tools subcommand must be called by some shipped prompt; every config default must have a code reader | M | `--check` fails on a seeded orphan command, verb and key |
| L2 | **Prompt-contract lint** | Parse `argument-hint` and allowed-tools: flag documented flags the CLI never parses, tools used but not granted, `@`-includes of `bin/lib/*.cjs`, question blocks larger than the host allows, `general-purpose` spawns, names of unshipped dev skills in shipped prompts | M | Seeded-defect fixtures; current-tree violations fixed or allowlisted with a reason that names the fixing item (L3, L4, L6) |
| L3 | **No source code in prompts** | Remove the `@`-includes of `.cjs` files from the commands that carry them | XS | L2's rule |
| L4 | **Typed spawns everywhere** | Replace `general-purpose` + "read your role file" with the named agent type and a resolved model; spawns that run a workflow (no role file) keep `general-purpose` and gain `model=` (absorbs M39) | S | L2's rule; a spawn-scan test |
| L5 | **Generated help** | `/pan:help` built from command frontmatter (`group`, `description`) so it cannot omit a command | S | Every command appears in help (test) |
| L6 | **Fix the weakest commands** | audit-deployment moves to dev-only; army calls a new `pan-tools merge request\|confirm` over `mcp/merge-gate.cjs` and refuses on runtimes without a gate; settings asks in host-sized batches and drops the no-op choice; `quality` profile differs from `balanced` or is removed; what-if uses host worktree isolation and `whatif cleanup` refuses paths outside its prefix; assumptions persist to `NN-assumptions.md` that discuss and plan read; exec-phase loads the phase-tests workflow and V4 proves RED; retro reads numbered gaps; preview's ETA derives from `duration` or git; `cost clear` backs up first; health asks per repair class | L | One test per fix, each proven red first |
| L7 | **Consolidate overlapping surfaces** | One status command (dashboard an alias; the `pan-tools dashboard` verb renamed `status --json`); milestones done → audit → fix (done wraps `milestone complete`; cleanup becomes a flag; gaps becomes audit's route); learning in two commands (learn absorbs optimize; retro absorbs the playbook); focus as focus-auto with step-through modes, one focus-docs and focus-design; research-phase as `plan-phase --research-only`; profile an alias of settings; one next-action router shared by progress, resume and transition (the MCP orchestrator's state machine); retire discord and mcp-bridge; give `review-handoff` a reader or remove it. Command renames go through `COMMAND_RENAME_MAP` so old names keep working | L | Install-matrix and surface registry updated; renamed commands resolve on all five runtimes |
| L8 | **UAT that runs** | A UAT walkthrough (one criterion per message, the user's verdict verbatim) writes `NN-uat.md` from the template and hands gaps to diagnose on the markdown path everywhere and the native script on Claude Code; refuses auto mode (a human verdict is the point) | M | Scripted-user scenario (H9); the UAT → diagnose → `plan --gaps` chain completes |
| L9 | **Local usage census** | `pan-tools usage` reads the project's own ledger and traces and reports commands and agents never used, or used and never finished — local only, no telemetry | S | Unit test on a fixture ledger |

#### Pillar S — PAN developing PAN

| ID | Item | Design | Size | Gate |
|---|---|---|---|---|
| S1 | **Executable WATCH triggers and a market watcher** | Each WATCH row in the ideas ledger carries a machine predicate (dist-tag ≥ version, release exists, changelog contains, harness scenario result); `scripts/market-watch.cjs` evaluates them daily model-free with the releases API (ETag) and npm `time`, and writes an inbox of deltas; a model pass runs only on deltas and produces candidate rows, never verdicts | M + M | Fixture tests with recorded responses; the inbox writer never touches the status column |
| S2 | **Autopilot spine with guard rails** | `scripts/autopilot.cjs <lane>` from a local scheduled task: worktree under `d:\pantesting`, branch `bot/<lane>/<id>`, `claude -p --max-budget-usd --json-schema`, monthly spend ledger, kill switch; never pushes by default; a scope check refuses edits to evaluator files (scenarios, allowlists, coverage policy, `.github/`) and canary mutants must stay red (DGM's lesson); `/execplan` stops staging with `git add -A` | M + S | Dry-run plan; scope-check tests both ways; canary-gaming fixture refused |
| S3 | **Fix lanes ordered by how mechanical their gate is** | (a) kill a surviving mutant, (b) cover an unreferenced surface row, (c) cover a dispatcher arm, (d) doc-lint and link fixes, (e) turn a harness finding green, (f) prompt changes; a lane unlocks after N merged PRs with no owner revert | M | First lane's PRs pass the same-seed re-probe, the quality lint and the suite |
| S4 | **Guarded prompt evolution** | GEPA-style: one section of one judge prompt at a time, failing transcripts reflected into a candidate, training then held-out scenarios, paired and sequentially tested, a deletion arm always run, Pareto over pass rate, cost and turns; only `harness/variants/` is mutable and a test proves the evaluator is out of reach; results ship as a PR | L | On a deliberately degraded variant the loop recovers to baseline on held-out data inside the cap |
| S5 | **Weekly State of PAN** | Deterministic report: suite and coverage trend, mutant survivors, surface drift, open harness findings with age, fired triggers, bot PRs opened, merged and reverted, autopilot spend | S | Snapshot test |
| S6 | **PAN on PAN** | The fix lanes run PAN's own loop on PAN's source in an external worktree with a `--global --config-dir <scratch>` install from the packed tarball (the never-install-into-the-source-repo rule holds), producing PAN's own verdicts, findings and cost data | L | One finding goes through PAN's loop to a PR whose verification passed and whose diff passes the scope check |

### 3.3 Sequencing

> **Superseded for execution `2026-10-12`** by `docs/specs/product-excellence-superplan.md`, which orders the items by checked dependencies into sessions of about twenty points. It splits the code gates from the paid evidence gates, ships new gates in `warn` or `report` mode first, and adds the items the review found (W0, CI1, A0, A7b and the HX release-hardening items). The waves below remain the rationale.

| Wave | Theme | Items | Why this order |
|---|---|---|---|
| **W1** | Deterministic gates and hygiene | V1, V7, V3, V6, V9, A7, H3, H5, L2, L3, L4, R45 (OpenCode plugin) | Tier-0 testable, no model spend, closes the biggest holes; statistics and controls are needed to measure everything after |
| **W2** | Measurement | H1, H2, H4, V2, V4, V5 (report mode), H7 | The double and cassettes make model-tier checks free; the corpus gives every later judge change a number |
| **W3** | Judges and the product surface | R1–R5, V8, V10, P1–P6, L1, L5–L9 | Each change ships only with a corpus result (H4) under H3 statistics |
| **W4** | Autonomy | A1–A6, H8, H9 | Built on code gates (oracle) and the double (simulation) |
| **W5** | Self-improvement | S1–S6, H6, H10, V5 gate mode | Needs every prior layer as its evaluator |
| **Later** | **Exposure** | Publication (former F3, MI-025), positioning, marketplace listings, reach measures | After the product is best-in-class, per the owner |

Session queue for W1 (about 40 points): V1 (4), V7 (4), V3 (4), V6 (4), V9 (2), A7 (4), H3 (4), H5 (4), L2 (4), L3 (1), L4 (2, absorbs M39), R45 OpenCode plugin (2); M40 is already done. Packaging before behaviour: every W1 item is gated by a pan-tools exit code, a lint or a harness change; its prompt edits (V3's executor rule, L3, L4) are mechanical; R45's live OpenCode 2 check is the one paid step. R47, R48, R49 and M35 stay in the October queue and run alongside the waves; M43 is folded into H3 and S4 (the deletion arm).

### 3.4 Decisions only the owner can make

**Decided by the owner on `2026-10-12`:**

| Decision | Outcome | Consequence |
|---|---|---|
| Re-open MI-058 | **Re-opened as a foreground loop** over PAN's own state (not a daemon, not a sixth runtime) | A1 is in scope (W4) |
| ADR-0047 D2 | **Amended:** steps backed by the local model double spend nothing and count as tier 0 | H1, H2, H8, H9 run free in CI |
| MI-114 rep rule | **Replaced:** prompt changes need a paired, sequentially tested result (SPRT) or a stated power, not "five reps" | H3 is the instrument; S4 and R2 use it |
| Standing spend cap | **None:** model-tier spend stays approved per run with `--max-usd` | Recording, corpus baselines and A/B runs are scheduled as explicit runs; cassette replay keeps nightly runs free |
| Recording login | **API keys only** (separate pay-per-use developer keys); subscription logins are never proxied | H2 record mode supports API-key auth only |
| Cross-vendor review lane | **Opt-in per project**, off by default | R4 ships disabled; enabling it is a project config choice |
| ADR-0049 | **Accepted** | V6 lands as an amendment to it |
| Gemini CLI | **Kept, marked unproven**; no new Gemini-only work | MI-082 stays WATCH; live Gemini checks stay blocked without a key |

The original options and recommendations follow for the record.


| Decision | Blocks | Recommendation |
|---|---|---|
| Re-open MI-058 (a control-plane loop above the runtimes) | A1 | Re-open as "a foreground loop over PAN's own state, not a daemon or a sixth runtime": new evidence is Anthropic's long-running harness posts, bmad-loop's "no LLM in the control loop", the self-conditioning result, and the field record in the stop-guard header that prose chains drop a phase boundary |
| Amend ADR-0047 D2 so double-backed steps count as tier 0 | H1, H2, H8, H9 | Amend: nothing is spent, so the cap's purpose holds |
| Amend MI-114's "five or more reps" to "an SPRT decision or a stated power" | H3, S4, R2 | Amend: five reps cannot separate variants |
| A standing monthly spend cap for model tiers and the autopilot | H2 record, H4, H10, S2–S4 | A cap recorded in `harness/README.md`; cassettes keep nightly runs free |
| Record mode on subscription logins | H2 | Start on API-key auth only; subscription record mode is a separate decision |
| Cross-vendor review lane (code leaves for another vendor) | R4 | Opt-in per project, off by default |

### 3.5 What not to do

All inherited entries hold. Added for this program:
- **Do not let an agent edit its own evaluator.** Scenarios, allowlists, coverage policy, corpus truth files and CI config are out of scope for every bot lane, enforced by a scope check.
- **Do not trust an agent's number where code can measure it.** Test counts, points and pass claims feed gates only when an engine measured them.
- **Do not measure a prompt change with fewer reps than its power needs**; use paired designs and sequential stopping instead.
- **Do not add multi-agent debate** as a quality step: it does not reliably beat self-consistency.
- **Do not chase runtime count, personas or an always-on bootstrap** — unchanged.

---

## Phase 4: Specifications for the first wave

R45 is specified as F1 in `roadmap_and_competition_2026_q4_featureai.md`; V6, V9, H5, L2, L3 and L4 are specified by their §3.2 rows.

### V1 — Phase gate in code

**Files:** `pan-wizard-core/bin/lib/phase.cjs` (new `phaseGate`, `cmdPhaseGate`; `cmdPhaseComplete` calls the gate first), `pan-wizard-core/bin/pan-tools.cjs` (dispatch `phase gate`), `verify.cjs` (`reconcilePhase` gains the test-record cross-check and returns `unverifiable` with no must_haves), `verify-scope.cjs` (freshness with an inputs hash), `findings.cjs` (`findingsDebt` reused), `workflows/exec-phase.md` (reconcile before `update_roadmap`; route on the gate), `workflows/transition.md`, the native `pan-exec-waves` script in `bin/install-lib.cjs` (final step runs `phase gate --raw`), `mcp/merge-gate.cjs` (`verify_pass` from the gate), `docs/CLI-REFERENCE.md`, tests.

**Steps:** (1) Implement `phaseGate` returning `{ok, reasons[], facts{}}` with one reason code per refusal class. (2) `phase complete` refuses on `ok:false` unless `--force --reason`, which records a `decision` disposition. (3) Wire every caller. (4) Update the surface registry and the dispatcher-arms test.

**Tests (at least 10):** one per refusal reason (missing summary, failed or gaps verification, `human_needed` without approval, stale, reconcile contradiction, failed test record, open critical finding, stub found, integrity violation); a clean pass; `--force` without a reason refused; `--force --reason` writes the disposition; CRLF verification parses the same; the native script stops on `ok:false`; the MCP merge request reports the gate's verdict, not the caller's flag.

**Runtime matrix:** all five ✅ — the gate is a pan-tools verb called by markdown on every runtime and by the native script on Claude Code.

### V7 — Plan checks in code

**Files:** `verify.cjs` (new `cmdVerifyPlanSet`), `phase.cjs` (`buildPlanIndex`, `dependencyNames` reused), `roadmap.cjs` (`roadmapRequirementIds`), `findings.cjs` (plan-check record stores `plans_sha`), `workflows/plan-phase.md` (run before the checker; loop to the planner on exit 1), `workflows/exec-phase.md` (initialise refuses on a missing or mismatched check, with an override reason), plan template (`planned_commit`), tests.

**Tests (at least 10):** missing requirement; same-wave overlap without a dependency (error); with a dependency (allowed); cycle; missing reference; future-wave reference; wave arithmetic; clean set; edited plan after a passing check refused at exec; no check at all refused unless overridden; drift list names changed interface files.

**Runtime matrix:** all five ✅.

### V3 — Test-integrity guard

**Files:** new `verify-integrity.cjs` (reusing `committedFiles` from `verify-scope.cjs` and the shapes in `scripts/test-quality-lint.cjs`, ported into the shipped core), dispatcher, `agents/pan-executor.md` (read-only tests rule and `BLOCKED_SPEC_CONFLICT`), `workflows/exec-phase.md` (route the new status), V1 consumes it, tests.

**Tests (at least 10):** deleted test file; renamed test; `.skip`/`.only`/`xit`/`@pytest.mark.skip`/`t.Skip`/`#[ignore]` added; assertion count drop; expectation edited in an undeclared test; snapshot rewrite; always-true assert; a declared test edit allowed; clean diff passes; Python and Go fixtures; the executor status routes to a human ruling.

**Runtime matrix:** all five ✅ (engine verb plus prompt text emitted to every runtime).

### H3 — Statistics in the harness

**Files:** new `harness/src/stats.cjs` (`wilson`, `passHatK`, `passAtK`, `pairedSignTest`, `sprt`, `powerN`), `harness/src/run.cjs` (report columns, `--until-decided`), `harness/src/ledger.cjs` (interval-based promotion for tier ≥1, `flaky` class), `harness/README.md`, `tests/harness.test.cjs`.

**Tests:** known values (Wilson 3/5 at 95% ≈ [0.231, 0.882]; 4/5 ≈ [0.38, 0.96]); pass^k on hand-computed counts; SPRT decisions on synthetic sequences in both directions; power for 0.6 → 0.8 at 80% power, two-sided α 0.05, unpooled normal approximation ≈ 79 per arm; tier-0 promotion unchanged.

### A7 — Pre-tool guard hook

**Files:** new `hooks/pan-guard.js`; `bin/install-lib.cjs` (`HOOK_EVENT_MAP` gains a pre-tool slot per runtime; OpenCode none), `scripts/build-hooks.js` (`HOOKS_TO_COPY`), installer registration and uninstall, `docs/HOOKS.md`, tests per host payload shape (fixtures captured from each host's documented payloads; the four pre-tool names are already in `tests/fixtures/hook-vocabulary.json` (read `2026-09-23`): re-read each host reference, bump the read dates, and add payload-shape fixtures per host).

**Policy (deny on):** writes matching secret patterns (reuse the trace logger's patterns); direct writes to `state.md`, `findings.jsonl` and the cost ledger outside `pan-tools`; any write by plan-checker, reviewer, hardener, meta-reviewer or verifier; executor edits to test files outside the current plan's `<files>`. **Fail-open on parse errors** for usability, logged; never fail-open on a matched deny.

**Runtime matrix:** Claude ✅ `PreToolUse` · Codex ✅ `PreToolUse` · Gemini ✅ `BeforeTool` (registration tested; live behaviour unproven without a key, §3.4) · Copilot ✅ `preToolUse` · OpenCode — (no hook event; a `tool.execute.before` plugin path is a later item).

---

## Phase 5: Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Gates refuse honest work and frustrate users | High | Ramp each gate from warning to error (CodeRabbit's pattern); every refusal names its fix; `--force --reason` always available and recorded |
| Language coverage of the test gate and mutation operators is uneven | Medium | Configurable `test_command`; operators start with JS/TS/Python/Go/Rust, unknown languages report `not_checked`, never `passed` |
| Mutation runs are slow on large suites | Medium | Changed, covered lines only; seeded samples; time budget; report mode first |
| The model double drifts from real host behaviour | Medium | Capture mode records real requests; record mode refreshes cassettes per host version; drift is reported, never hidden |
| Cassettes leak code or transcripts | High | Stored outside the public repo, headers stripped, scrub step before any commit |
| The autonomy loop widens the blast radius of permission-bypass flags | High | Always on a branch or worktree; graded autonomy; guard hook; dollar governor; human merge as the only stop that writes to the default branch |
| Self-improvement games its evaluator | High | Evaluator files out of reach by code; canary mutants; held-out scenarios; human merge (DGM's documented log-faking) |
| A host retires or narrows its CLI (Gemini CLI was replaced by Antigravity CLI for unpaid and Google One accounts on `2026-06-18`, geminicli.com/docs; gsd-core removed its Gemini lane) | Medium | MI-082 stays WATCH with this fact recorded; Antigravity reads the shared `.agents/` tree; no new work starts on Gemini-only surfaces |
| Five-runtime parity slips as features grow | Medium | Every feature lands as a pan-tools verb first; host-specific parts are additive and listed in the runtime matrix |
| Statistics raise the cost of claims | Low | Sequential testing stops early; cassettes make most reruns free |

---

## Sources (read `2026-10-12` unless dated otherwise)

- **PAN code** (verified this session): `phase.cjs` `cmdPhaseComplete`; `workflows/exec-phase.md` step order; `findings.cjs` auto-fix rows; `verdict.cjs` `findingId`; `focus.cjs` stop logic; `harness/src/*`.
- **Research (arXiv abstracts):** `2510.20270` ImpossibleBench; `2306.09896` self-repair; `2509.09677` self-conditioning; `2405.15793` SWE-agent; `2407.01489` Agentless; `2401.08500` AlphaCodium; `2402.09171` TestGen-LLM; `2501.12862` ACH; `2601.22832` JiT catching tests; `2102.11378` Google mutation testing (TSE 2021); `2607.00990` SWE-Doctor; `2507.19457` GEPA; `2505.22954` DGM; `2411.00640` error bars; `2406.12045` tau-bench; `2311.17371` multi-agent debate; `2404.18796` PoLL; `2503.15223` PatchDiff.
- **Vendor and product docs:** kiro.dev (specs, correctness, hooks, steering); github/spec-kit (clarify, analyze, checklist templates); docs.bmad-method.org (deep-recon, architecture, review); open-gsd/gsd-core (FEATURES, TESTING-SUITES, quick-batch, ADR-5057); cursor.com (bugbot, building-bugbot, cloud-agent capabilities, hooks, debug mode); github.blog ReviewBench; greptile.com (v3, memory and learning); docs.coderabbit.ai (learnings, pre-merge checks); docs.qodo.ai; playwright.dev test agents; code.claude.com (cli-reference, hooks, workflows, routines, llm-gateway, monitoring-usage); anthropic.com/engineering (long-running harnesses, harness design, managed agents, sandboxing); learn.chatgpt.com (Codex non-interactive, sandboxing, hooks); docs.github.com (Copilot hooks, cloud agent risks); geminicli.com hooks reference; docs.factory.com (droid exec, missions, droid shield); docs.augmentcode.com (Cosmos memory); inspect.aisi.org.uk (metrics, caching, early stopping, agent bridge); apple.github.io/foundationdb testing; sakana.ai/dgm.
- **Local probe:** `claude -p` against a local Messages API mock with a dummy key and scratch config dir (this session).
