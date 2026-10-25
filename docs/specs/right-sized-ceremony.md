# Right-sized ceremony: PAN's cost and time on well-specified work

**Date:** `2026-10-24` · **Status:** Built (this change); re-measurement below · **Owner decisions:** `2026-10-24` (right-sized by default; `quality` keeps the old behaviour; `--quality` per run)

## The problem

Three paired H10 runs (`docs/specs/product-excellence-superplan.md`, H10 row) compared PAN with Claude Code on its own, both on Opus 5.5, on precisely specified work. The bare host completed every rep. PAN completed the same work and cost much more:

| Pair | Bare host | PAN | PAN ÷ bare |
|---|---|---|---|
| Single module, `/pan:quick --full` (discount codes) | $0.32, 72 s | $2.82, 748 s | about 9× cost, 10× time |
| Two-phase roadmap, `autodev` | $0.62, 144 s | $19.19, 4,659 s (one rep; the next ran out of budget) | about 30× cost, 32× time |

## Where it went (instrumented runs, `2026-10-24`)

PAN's cost logger (`.planning/metrics/tokens.jsonl`) and autodev's ledger, on the same seeds, with PAN `3.36.0`:

**`/pan:quick --full`, $2.67, 585 s.** Planner 214 s and 22k output tokens; plan-checker 111 s; executor 123 s (the work itself); verifier 48 s. The orchestrating session cost about $1.44, $1.10 of it cache writes (each new agent context re-caches its prompt and the project files).

**One autodev phase pair, $10.00, 40 min.** plan-phase 1: $5.24 and 21 min. exec-phase 1: $2.86 and 9 min. plan-phase 2: $1.75 and 10 min. Per agent: the plan-checker ran four times (91k output tokens, about $2.06, 12 min) and the planner three times (68k, about $2.00, 12 min), because the checker sent the plans back for revision; the executor cost $0.63.

**Reading.** About 70% of PAN's cost and time was planning ceremony on work whose requirements already said exactly what to build: research, then a planner and a plan-checker revising a plan, serially, every agent on the launch model at high effort. A cheaper model alone helps less than it seems: Sonnet 5.5 is half Opus 5.5's price, not a fifth.

## What changed

| Lever | `balanced` (default) and `budget` | `quality` |
|---|---|---|
| Ceremony | **Auto-sized** (`pan-wizard-core/bin/lib/sizing.cjs`): a phase that maps one to `workflow.lean_max_requirements` (5) requirements, each with an acceptance criterion or naming the artifact to build, is **lean**: no research, one short plan, the engine's plan check instead of the plan-checker agent (`pan-tools size plan-check`, which records the plan check exec-phase needs), and exec-phase without the test-generation agent and code review. A quick task whose description names an artifact and runs to 15 words or more is lean: the engine writes its one-task plan (`pan-tools size quick-plan`) and no planner runs. Anything else is **full** | Full everywhere |
| Revision loop | One revision, then the user decides | Two revisions |
| Checker output | Verdict and blocking issues only, a word budget | Unbudgeted |
| Models | Plan-checker and researchers on the mid tier (Sonnet 5.5 on Claude) | Every agent on the reasoning tier |

`--quality` on `/pan:quick`, `/pan:plan-phase`, `/pan:exec-phase` and `autodev run` (passed to every unit) gives one run the full ceremony; `--full` does the same for one command. `workflow.ceremony: full` keeps the full ceremony for a project without changing its models. `/pan:new-project` and `/pan:settings` describe the choice.

**Not done: lower effort on checks.** Claude Code reads an agent's `effort:` from its file, and no workflow passes effort per run, so lowering it there would change `quality` too. It stays as it was.

**Unchanged on purpose:** the executor's prompt (a tier-0 cassette records it, and re-recording needs an API key), the verifier on every phase (the phase gate needs its verdict), and every deterministic gate.

## Re-measurement (`2026-10-24`, the same seeds, owner-approved $8 cap)

Every run passed its project's tests and every case of the hidden acceptance check (`check-discounts.cjs`, `check-tasks.cjs`).

| Task | PAN before | PAN after | Bare host | PAN ÷ bare, after |
|---|---|---|---|---|
| Discount codes | $2.67, 585 s (`/pan:quick --full`) | $0.44, 90 s (`/pan:quick`, lean: no planner, no checker) | $0.32, 76 s | 1.4× cost, 1.2× time |
| Two-phase roadmap, `autodev` | $19.19, 4,659 s (H10 rep 1) | $4.52, 1,003 s (both phases built; stopped at the $4.50 cap before phase 2's separate verify unit) | $0.54, 121 s | 8× cost, 8× time |

Autodev per unit after: plan-phase 1 $1.29 (256 s), exec-phase 1 $1.85 (466 s), plan-phase 2 $0.77 (143 s), exec-phase 2 $0.47 (109 s). No research and no plan-checker ran; one planner per phase and one executor per phase did.

**Step 2 (built after this measurement).** A lean phase is planned by the engine: `pan-tools size phase-plan` writes one task per requirement from the requirements' own text, checks the plan in code, records the plan check and commits it, and `autodev` runs it for a lean phase's `plan` unit with no session, so a lean phase costs one exec-phase session. `/pan:plan-phase` uses it too.

**Step 2 re-measured (`2026-10-24`, owner-approved $5 cap):** autodev on the same two-phase roadmap finished both phases (`done`) for **$3.09 in 691 s**, passing every hidden acceptance case: plan 1 by the engine ($0, 1 s), execute 1 $1.65 (353 s), plan 2 by the engine ($0, 1 s), execute 2 $1.44 (334 s). Against the bare host's $0.54 and 121 s that is **5.7× cost and 5.7× time, down from about 30×** ($19.19 and 4,659 s before right-sizing). What remains is the exec-phase session itself (the executor, the verifier and the orchestrating workflow), about $1.50 and six minutes a phase.

**Bug found by the run, fixed:** when the cap was spent mid-unit, a retry started a session with `--max-budget-usd 0.00`, which Claude Code refuses; a retry now stops with `budget_usd` first.

## Optimisation set 2 and the regression check (`2026-10-24`, owner-approved $10 cap)

**Change:** autodev's unit prompt now starts with the command (`/pan:exec-phase 1 (PAN autodev unit, unattended: …)`). The earlier transcript showed each unit spending its first turns finding the command, because inside a sentence Claude Code did not expand it; now the host expands it and the session starts at `init`. **Effect on cost: within noise** ($2.89 against $3.09 for the two-phase roadmap; units ran engine plan $0, execute $1.87, engine plan $0, execute $1.02). The exploration turns were cheap; what each session pays is its fixed context: about 90k tokens of cache writes (Claude Code's system prompt and tools, the workflow, the agents' results), about $0.45 a session, and PAN's MCP tool list is only about 2,300 tokens of it.

**Regression check, live:**

| Check | Result |
|---|---|
| Lean autodev, two phases | `done`, $2.89, 745 s; hidden acceptance check passed |
| `/pan:quick --full --quality` (the old path) | planner, plan-checker and verifier all ran; $2.00, 618 s; hidden check passed |
| `/pan:plan-phase 1` on a vague phase (`clarify-export`) | sized `full` by itself: the planner wrote two plans, no engine plan; the plan-checker did not run before the session's $2.50 cap |

Plus a fresh packed install on all five runtimes (no errors; `size` answers in each runtime's core; the engine plans a lean phase and exec-phase reads its plan check as `ok`) and the full local CI.

**Where the rest of autodev's cost is:** per phase, an orchestrating session (about $0.85: mostly that fixed context), the executor (about $0.40) and the verifier (about $0.17). Plain Claude Code pays one session's fixed context for the whole job. The levers left are structural: run consecutive lean phases in one execute session, or let the engine's gates stand in for the verifier on a lean phase (a quality trade the H4 corpus cannot yet price, since its defects are too easy).

**One session per lean phase (`2026-10-25`).** For a lean phase, autodev's execute unit no longer starts `/pan:exec-phase` (an orchestrating session with an 11k-token workflow that then spawns a separate executor). It hands the session `pan-wizard-core/workflows/exec-lean.md`, which does the executor's work in that session (the plan as specification, tests never weakened, `supersedes_tests` recorded as deviations, a commit per task, the summary and state updates) and then spawns the verifier and records its verdict. The phase gate and `phase complete` stay in autodev. The verifier stays, so quality is unchanged; what goes is one session's fixed context and the orchestration turns. A full phase and `--quality` keep exec-phase.

