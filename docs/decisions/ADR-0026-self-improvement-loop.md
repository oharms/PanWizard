---
require-code-mention: true
---

# ADR-0026: Self-Improvement Loop — Idea → External Build → Harvest → Promote → Ship

## Status
Accepted (shipped 2026-04-27 across waves W1-W4 as v3.7.0)

## Context

PAN Wizard v3.5+ shipped a complete intra-project learning loop: `pan-trace-logger` captures every agent spawn, `/pan:learn` invokes `pan-optimizer` to analyze the session, `/pan:optimize apply` writes findings to `.planning/memory/`. Each user project's PAN install learns about its own codebase over time.

What was missing: the **PAN tool itself** did not learn. Every release shipped frozen behavioral rules (`references/`, workflows, agent prose). Real-world session data — the gold mine of "what shortcuts AI agents take, where verification fails, which guardrails fire" — stayed trapped in user projects' `.planning/optimization/` directories. The next release of PAN had no idea what the previous release's sessions discovered.

The MEMORY.md note "Cross-Session Learning (PATTERNS.md auto-capture)" was deferred for exactly this reason — it needed a design spec. Spec was written 2026-04-27 (`docs/specs/self_improvement_loop_featureai.md`). This ADR records the decisions made implementing it.

## Decision

Ship a **cross-project meta-learning loop** as v3.7.0 across four additive waves. The loop:

```
1. /pan:experiment new <slug> --idea idea.md   →  scaffold isolated project outside source repo
2. /pan:experiment run <slug>                  →  spawn external AI session, observe
3. /pan:experiment harvest <slug>              →  copy telemetry back to <source>/experiments/<slug>/
4. /pan:learn --experiment <slug>              →  run pan-optimizer over harvested data
5. pan-tools learn promote --pattern <id>      →  write findings to pan-wizard-core/learnings/{universal,internal}/
6. ship as next release                        →  patterns auto-load via workflow cross-references
```

### Architecture decisions recorded here

**1. Two-tier learnings layout (`universal/` ships, `internal/` does not).**

`pan-wizard-core/learnings/universal/` ships to all 5 runtime install dirs alongside `references/`. `pan-wizard-core/learnings/internal/` stays source-only. The installer (`bin/install.js`) explicitly strips `learnings/internal/` after the recursive copy. Rationale: PAN-development-specific patterns ("always commit individually because of the source repo's hooks") must NOT leak into user installs as universal advice. A negative test in `tests/scenarios/learnings-installed.test.cjs` enforces this.

**2. Manual promote gate (no auto-promote in v3.7).**

`pan-tools learn promote` requires explicit `--pattern <id> --scope <s> --topic <t>` flags. The human picks scope and topic. Auto-promote (rules-based confidence threshold) is deferred to v3.8+ once 10+ manual promotes inform the filter design. Risk of bad auto-promote: a single misclassified PAN-internal pattern shipping as universal advice would silently pollute every user install. Manual gate eliminates this for v3.7.

**3. Subprocess runner, not VSCode UI automation.**

`runner.cjs` uses Node's `spawnSync` to invoke external runtimes headlessly (`claude -p`, `codex exec`, `gemini -p`, `opencode <prompt>`). Initial design considered driving a separate VSCode window via Playwright (Session 33 added the infrastructure), but: (a) GUI dependency adds cross-platform display setup, (b) headless display drivers are flaky, (c) CLI subprocess is sufficient for autonomous runs. Playwright stays for testing PAN inside VSCode, not for the experiment runner. GitHub Copilot CLI is **opt-out** — no documented headless prompt mode known.

**4. Observation-only watchdog agent.**

`pan-experiment-runner` agent has tools `[Read, Bash, Glob, Grep]` only — explicitly NO `Edit` or `Write`. The agent watches the experiment's `.planning/run-state.json`, decides when stop conditions fire, and reports back. It does NOT inject prompts mid-flight or fix problems in the experiment. Cleaner failure semantics: if the external session gets stuck, the timeout/circuit-breaker fires; PAN doesn't try to "save" it. Every intervention path would be a new bug surface.

**5. Experiments live outside the source repo.**

`PAN_EXPERIMENTS_ROOT_DEFAULT` is `~/pan-experiments/` (configurable via `--root`). `experiment.cjs newExperiment` refuses to scaffold inside `PAN_SOURCE_ROOT`. Mirror of the existing installer guard — the experiment folder gets a fresh PAN install, and that install would conflict with the source repo's own files.

**6. spawnSync over async spawn.**

Initial implementation used `child_process.spawn` with a custom poll-loop using `Atomics.wait`. This blocked the main thread, preventing the child's `exit` event from firing (event loop starved). Switched to `spawnSync` which has native timeout support and exits cleanly across platforms. Trade-off: real-time progress streaming is impossible in synchronous mode — `onProgress` callback fires once after exit with the full captured stdout/stderr. Documented as W3-or-later work to migrate to async/Promise mode if real-time streaming becomes load-bearing.

**7. Harvest writes inside the source repo.**

`harvestExperiment` copies telemetry to `<source-repo>/experiments/<slug>/`. This is INSIDE the source repo intentionally — harvested data becomes part of the source's git history alongside the spec/ADR/code that drove the promote decision. The PAN_SOURCE_ROOT guard (which prohibits writing the experiment ITSELF inside source) does not apply to harvest — different operation, different rules. The `experiments/` directory is intentionally not gitignored; small harvests are committed; large raw traces (`optimization/traces/sess_*/trace.jsonl`) may be gitignored selectively in the future if size becomes an issue.

**8. Streaming progress deferred.**

Original spec called for real-time `onProgress` callback during `runExperiment`. Synchronous spawnSync semantics don't support real-time streams. For W2-W4, output is captured-and-emitted-once. Real-time streaming becomes a v3.7.x or v3.8 follow-up if the autonomous loop produces sessions long enough that progress visibility matters more than synchronous CLI shape.

### Explicit deferrals (documented, not shipped)

- **Auto-promote** (rules-based confidence threshold filter) — v3.8+
- **Cross-experiment aggregation** (promote a pattern based on N experiments instead of 1) — v3.8+
- **VSCode UI automation as runner path** — keep CLI; Playwright stays for tests only
- **Bidirectional control mid-experiment** — observation-only by design
- **GitHub Copilot CLI runner** — no headless prompt mode known; document limitation
- **Container-isolated experiments** — process isolation via separate folder is sufficient for v3.7
- **Real-time progress streaming** — captured-and-emitted-once is sufficient
- **Experiment replay from a specific phase** — needs idempotency design
- **Promoting from a parsed report file** — v3.7 takes pattern data inline via flags; report-parser is v3.7.x

## Consequences

### Positive

- **PAN ships smarter every release.** Findings from real builds become part of the next product version.
- **Two-tier delivery** keeps PAN-internal patterns out of user installs without manual judgment per file.
- **Zero regressions.** All v3.6.0 behavioral guardrails still work; v3.7.0 is purely additive.
- **Test coverage:** 2627 → 2670+ across waves, with negative tests on the universal/internal split (one of the highest-stakes invariants).
- **Existing infrastructure reused:** `optimize.cjs` analysis, `pan-optimizer` agent, `references/` delivery channel, `createScenarioRunner` for tests, `focus.cjs` budget+circuit-breaker pattern.
- **Manual promote gate** keeps the human in the loop for the highest-leverage step.

### Negative

- **Module count grew from 27 to 29.** Surface expansion. Mitigation: `experiment.cjs` and `runner.cjs` have clear single responsibilities; both are documented in `ARCHITECTURE.md`.
- **`spawnSync` is synchronous and blocks pan-tools.cjs during a real run.** Real-time progress visibility is degraded. Mitigation: `runner.runExperiment` is invoked manually by the user; nothing else is competing for the main thread during a deliberate experiment run.
- **Harvest data may grow unbounded.** A trace.jsonl from a large experiment can be MB-sized. v3.7 commits it whole; v3.8+ may add gitignore rules or compression.
- **Topic-file frontmatter format is bespoke** (not standard YAML). Reason: zero-runtime-deps constraint. The parser is a 30-line minimal implementation. If a topic file is hand-edited and breaks the format, `listPromotedPatterns` skips it silently. Mitigation: `learnings/README.md` documents that topic files are AI-managed.
- **Auto-promote deferred to v3.8.** Manual gate is friction. Rationale: bad auto-promotes ship to all users; better to be slow than wrong.
- **GitHub Copilot CLI is excluded from the runner path.** Documented limitation. Copilot users can still scaffold experiments and consume promoted learnings, just not drive the runner.

### Neutral / Tradeoffs considered

- **Why not use a YAML library?** Zero-deps constraint. The frontmatter parser is 30 lines; a YAML library would be the first runtime dep ever shipped by PAN.
- **Why a single-pattern per promote command?** Multi-pattern batch would couple unrelated decisions. Each pattern gets a deliberate human review.
- **Why ship the `pan-experiment-runner` agent in W2 instead of bundling agent + module in W4?** The agent is the natural orchestrator for the runner. Shipping them together keeps the user-facing surface coherent.

## Implementation Notes

### Files added (W1-W4 cumulative)

| File | Wave | Purpose |
|------|------|---------|
| `pan-wizard-core/bin/lib/experiment.cjs` | W1 (extended W3) | 28th core module |
| `pan-wizard-core/bin/lib/runner.cjs` | W2 | 29th core module |
| `pan-wizard-core/templates/idea.md` | W1 | 27th template |
| `pan-wizard-core/learnings/README.md` | W1 | tier explainer |
| `pan-wizard-core/learnings/{universal,internal}/.gitkeep` | W1 | dir placeholders |
| `commands/pan/experiment.md` | W1 (extended W2-W3) | 52nd command |
| `agents/pan-experiment-runner.md` | W2 | 21st agent |
| `tests/experiment.test.cjs` | W1 (extended W3) | 21 unit tests |
| `tests/runner.test.cjs` | W2 | 12 unit tests |
| `tests/learn-promote.test.cjs` | W4 | 13 unit tests |
| `tests/scenarios/experiment-lifecycle.test.cjs` | W3 | 6 scenario tests |
| `tests/scenarios/learnings-installed.test.cjs` | W4 | 15 scenario tests (3×5 runtimes) |
| `docs/decisions/ADR-0026-self-improvement-loop.md` | W4 | this ADR |
| `docs/specs/self_improvement_loop_featureai.md` | W1 (commit `6a96c21`) | spec |

### Files modified

- `pan-wizard-core/bin/lib/optimize.cjs` — added promote/list-promoted/unpromote
- `pan-wizard-core/bin/pan-tools.cjs` — registered experiment + learn promote subcommands
- `commands/pan/learn.md` — added `--experiment <slug>` flag docs
- `pan-wizard-core/workflows/{exec-phase,plan-phase,verify-phase,execute-plan}.md` — reference `learnings/universal/`
- `bin/install.js` — two-tier guard strips `learnings/internal/` from installs
- `package.json` — version bump to 3.7.0
- `CHANGELOG.md`, `docs/USER-GUIDE.md`, `docs/ARCHITECTURE.md`, `MEMORY.md` — documentation

### Cumulative deltas (v3.6.0 → v3.7.0)

- Tests: 2588 → ~2670+ (+82+)
- Core modules: 27 → 29 (+2)
- Agents: 20 → 21 (+1)
- Commands: 51 → 52 (+1)
- Templates: 26 → 27 (+1)
- New top-level dir under pan-wizard-core: `learnings/{universal,internal}/`

### Rollback plan

The layer is entirely additive. Rollback steps if telemetry reveals a regression:

- Remove `pan-wizard-core/bin/lib/{experiment,runner}.cjs` — dispatcher commands degrade to "command not found"
- Remove `agents/pan-experiment-runner.md` — agent unavailable; users fall back to manual experiment runs
- Remove `pan-wizard-core/learnings/` — no shipped patterns; workflow cross-references resolve to "directory not found" but workflows continue
- Remove the `learnings/internal/` strip from `bin/install.js` — restores pre-v3.7 install behavior
- Revert workflow cross-references — workflows function identically without the new line
- Revert `optimize.cjs` extensions — `pan-tools learn promote/unpromote/list-promoted` become "command not found"

No schema changes, no manifest format changes. Rollback is a commit-level revert.

### References

- Source spec: `docs/specs/self_improvement_loop_featureai.md` (created 2026-04-27)
- Predecessor: ADR-0025 (v3.6.0 behavioral guardrails layer — proved `references/` delivery channel)
- Predecessor: Session 31 — circular optimization loop (proved trace + analyze + apply pattern)
- Test infrastructure: `tests/helpers.cjs createScenarioRunner` (Session 18)
- Budget+circuit-breaker pattern: `pan-wizard-core/bin/lib/focus.cjs` (Session 26 / ADR-0015)

## Future scope

- **v3.8.0**: auto-promote (rules-based filter, AI-confidence threshold) once 10+ manual promotes inform the design
- **v3.8.0**: cross-experiment aggregation — promote a pattern based on N experiments
- **v3.8+**: real-time progress streaming via async/Promise mode if needed
- **v3.9+**: container-isolated experiments if process isolation proves insufficient
- **v3.9+**: experiment-replay-from-phase if idempotency story is solved
- **v3.7.x**: report-file parser for promote (extract pattern from `experiments/<slug>/learnings/report-*.md` instead of inline flags)
