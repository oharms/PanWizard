# ADR-0029: Optional LLM Evaluator for the Self-Improvement Runner

## Status
Proposed — design spike only (IMPROVEMENT-TODO P2). Per its acceptance criteria, **no implementation until this ADR is reviewed and accepted by the maintainer.**

## Context

The v3.7.0 self-improvement loop (`runner.cjs`, `experiment.cjs`, ADR-0026) stops experiments on deterministic signals: process exit, a wall-clock timeout, a circuit breaker, and milestone-completion detection that reads `status:` out of the experiment's `state.md` (`STOP_REASONS`: success / error / timeout / circuit_breaker / manual / incomplete). For experiments whose goal is structural — "does this workflow reach milestone completion?" — this is exactly right.

It is blunt for experiments whose success criterion is genuinely qualitative: *did prompt variant B produce a better plan than variant A? Is the generated summary actually faithful to the diff?* Today those experiments stop on iteration count or timeout, and a human reads the transcripts. Claude Code's `/goal` command demonstrated the worker/evaluator split — a separate small model judging completion after every turn — but it is Claude-only and outside PAN's surface.

The temptation to resist: PAN has spent multiple releases (v3.6 guardrails, the verify/preflight/health work) moving the *planning* lifecycle toward deterministic gates. Reintroducing LLM-as-judge into phase, focus, verify, or retro would be a regression dressed as a feature. The experiment runner is the one subsystem where the work being evaluated is itself probabilistic, so probabilistic judgment is category-appropriate there — and only there.

## Decision

Add an **opt-in, pluggable evaluator** to `runner.cjs`, off by default, with the host runtime's own CLI as the only shipped backend.

### 1. Scope fence

The evaluator is consumed by `runner.cjs` only. `phase`, `focus`, `verify`, `retro`, and every other lifecycle path keep their deterministic gates untouched — this ADR explicitly does not create a precedent. Growing the scope requires a new ADR carrying evidence that a specific deterministic gate demonstrably cannot express the needed check.

### 2. Evaluator contract

```
evaluate({ transcript, goal }) → { done: boolean, reason: string }
```

- `transcript`: tail of the experiment transcript (size-capped; newest content wins).
- `goal`: the experiment's goal condition string, authored in the experiment's `idea.md` frontmatter (`evaluator_goal:`).
- The verdict and reason are appended to the experiment's run log as `evaluator` events, alongside the existing metrics records — auditable after the fact, consumed by `/pan:learn` like any other signal.
- A `done: true` verdict stops the run with a new stop reason `evaluator_done`; `done: false` lets it continue. The evaluator can only ever *stop earlier* than the deterministic bounds — the iteration cap and timeout remain the hard ceiling, so a broken evaluator can never extend a run.

### 3. Model access — zero-runtime-dependency posture

Three options were evaluated:

| Option | Verdict |
|---|---|
| Anthropic SDK behind a config flag | Rejected — introduces the project's first runtime dependency (even optional, it lands in `package.json` and the supply chain); duplicates auth the host CLI already has. |
| Shell to the host runtime's CLI | **Adopted.** `runner.cjs` already spawns `claude -p` (and other runtimes via its adapter table) with `spawnSync`; the evaluator reuses the same mechanism, auth, and `billing_pool: "agent_sdk"` tagging. Zero new dependencies. |
| Pluggable interface, no default backend | Adopted as the shape: the CLI backend is just the default plug. `experiment.evaluator.command` accepts any executable honoring the contract (prompt on argv/stdin, JSON verdict on stdout), so non-Claude hosts or air-gapped users can supply their own. |

Configuration (all under `.planning/config.json` → `experiment.evaluator`):

- `enabled`: `false` (default). Nothing changes for anyone who doesn't opt in.
- `command`: defaults to the host runtime's CLI in print mode with a small fast model (Haiku-class) — evaluation is a cheap classification call, not reasoning work.
- `interval`: evaluate every N iterations (default 1), capped by `max_checks` (default = the experiment's iteration cap) so evaluator spend is bounded and predictable.
- `timeout_ms`: per-call timeout (default 60 000).

### 4. Which experiment shapes qualify

- **Benefit:** prompt-variant comparison, output-quality judgment, "did the agent's answer satisfy this rubric" — anything where the goal lives in natural language and no file/exit-code encodes it.
- **Must remain deterministic:** any experiment whose success is wired to phase or verify state (milestone completion, plan counts, test results). The runner refuses the evaluator (`config error`) when the experiment also declares a milestone-based success condition — one experiment, one stop authority.

### 5. Failure modes

| Failure | Behavior |
|---|---|
| `enabled` but CLI/credentials missing | Warn once at run start, disable for the run, fall back to deterministic stops. The experiment proceeds. |
| Evaluator call timeout | Log an `evaluator_timeout` event, count it as "not done", continue. |
| Ambiguous/unparseable response | Treat as "not done", log `evaluator_ambiguous`; after 3 consecutive ambiguous responses, disable for the run with a warning (a misconfigured judge must not silently burn the budget). |
| Evaluator says done but milestone state disagrees | Not possible by construction — see §4: milestone-governed experiments cannot enable the evaluator. |

Every failure degrades to today's behavior. The evaluator can reduce wasted iterations; it can never make a run less safe than the deterministic bounds.

### 6. Cross-runtime behavior

The runner is the only consumer. With `enabled: false` (the default), non-Claude runtimes see zero change. With it enabled, the `command` is host-agnostic — any CLI honoring the contract works; the Claude default is convenience, not coupling.

## Consequences

**Positive.** Qualitative experiments get a stop condition that matches their nature, bounded by the existing deterministic ceiling. Evaluator verdicts become auditable log events that `/pan:learn` can mine. No new dependencies; no new auth surface; spend rides the already-tagged Agent SDK pool.

**Negative / risks.** An LLM judge is itself probabilistic — verdicts will sometimes be wrong; the mitigation is that wrong verdicts only ever end runs early, never extend them, and the transcript+reason trail makes bad judgments visible. Config surface grows by one section. The "one stop authority" rule (§4) must be enforced in code, not docs, or scope creep starts here.

**Acceptance criteria for implementation (unchanged from IMPROVEMENT-TODO):** behind `experiment.evaluator.enabled`, off by default; no change to phase/focus/verify/retro code paths; documented in `commands/pan/experiment.md` and workflows only after this ADR is accepted.
