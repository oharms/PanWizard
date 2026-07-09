# ADR-0036: Agentic Memory Architecture — Distill-and-Select over Retrieve-then-Reason

## Status

Accepted — 2026-07-02. Records a memory-design *principle* PAN already largely follows, classifies PAN's three memory layers against it, and — as of v3.13.0 — implements the bounded-memory follow-ups (FW-2 `selectMemory`, the acceptance-signal telemetry gate, soft auto-compaction, and a minimal FW-1). Repo-only: `docs/` is not in `package.json` `files`, so this decision doc is not shipped to installs. (Two factual errors about `context-budget.cjs` in the original draft were corrected after an e2e review — see the corrected text below.)

Trigger: *"New agentic memory framework uses 118K tokens per query. LangMem burns through 3.26M."* (VentureBeat, 2026-06-26), reporting **MRAgent** from National University of Singapore.

## Context

### The finding

On the **LongMemEval** long-horizon-conversation benchmark, prompt-token consumption per query differed by ~**27×** across agent-memory frameworks doing the *same task*:

| Framework | Tokens / query | Runtime |
|---|---:|---:|
| MRAgent (active reconstruction) | ~118K | 586 s |
| A-MEM | ~632K | 1,122 s |
| LangMem | ~3.26M | — |

Backbones: Gemini 2.5 Flash and Claude Sonnet 4.5. Baselines: standard RAG, A-MEM, MemoryOS, LangMem, Mem0. MRAgent's thesis is that the dominant **"retrieve-then-reason"** memory pattern is the cost driver, because it:

1. **Can't revise mid-reasoning** — one batch retrieval up front; if reasoning reveals a missing fact, it can't go back.
2. **Floods context with surface matches** — top-k similarity returns look-alikes, not what's relevant, so the window fills with noise (and noise is tokens).
3. **Is statically structured** — fixed top-k, fixed relevance function, no adaptivity.

MRAgent instead does *active, associative reconstruction*: it explores memory sequentially (cue → tag → content), infers new search constraints from what it has found, follows the best path, and **prunes irrelevant branches** — pulling only what the current reasoning step needs.

> Confidence: the framework name (MRAgent / NUS), the three token figures, the benchmarks, the backbones, and the baseline list are corroborated across two independent sources. Finer details from a single secondary source (exact arXiv id, the `cue-tag-content` node naming, a GitHub repo) are "probably right, verify before citing." The *decision* below does not depend on any unverified detail.

### Why this matters to PAN specifically

Memory architecture is a **first-order token-cost lever**, and PAN just spent a release (v3.12.4) fixing token *over-counting* in the bot army (`docs/FIELD-REPORT-army-2026-06.md`, ADR-0033/0034). The army (ADR-0032) fans out Mission Control → squads → many workers; whatever each agent loads into context is multiplied by the fleet. A 27× swing in memory-load cost is therefore a 27× swing in campaign spend. This ADR asks: **where does each PAN memory layer sit on the retrieve-then-reason ↔ distill-and-select axis, and what, if anything, should change?**

### PAN's three memory layers today

| Layer | Module | What it does | Load pattern |
|---|---|---|---|
| **Cross-project learnings** | `learnings/` + `commands-learnings.cjs`, `distill.cjs`, `learn-index.cjs`, `learn-lint.cjs`, `pan-distiller` | Distilled, deduped patterns (`universal/` ships; `internal/` is source-only). Agents load a **topic-selected** slice via `learn topics-for` during planning/review. | **Distill-and-select** — small, high-signal, cue-selected. Right side of the axis. |
| **Per-agent project memory** | `memory.cjs` | Append-only `.planning/memory/<agent>.md`; each agent reads its log at invocation start, appends lessons at end; compaction trims to `DEFAULT_MAX_ENTRIES` (500). | **Whole-file read** (`readMemory`). Because compaction was manual-only and never auto-triggered, a log could grow *past* 500 without bound between manual compactions, and the whole file is injected into every executor. FW-2 (`selectMemory`, v3.13.0) adds a cue + recency + token-budgeted read alongside it, and a soft auto-compaction hook now caps unbounded growth. |
| **Grounded Q&A** | `knowledge.cjs` (`ask` mode) | Retrieves candidate files from a **fixed** `CITATION_ROOTS` list and formats citation context for `pan-knowledge`. | **Retrieve-then-reason with a static structure** — the exact pattern MRAgent critiques: one-shot, fixed roots, no mid-reasoning revision. |

`context-budget.cjs` **reports** context utilization of the `.planning` core files and current-phase plans as a visibility signal a human can act on — but it does **not** enforce a bound on what any agent loads, and it does not read `memory/` or `learnings/` at all. It is a HUD, not a backstop. The only real load-time budget is an explicit token budget: `learn topics-for --token-budget` for learnings, and (v3.13.0) `selectMemory`'s budget for memory.

## Decision

**1. Adopt "distill-and-select over retrieve-then-reason" as PAN's explicit memory-design principle.** Any memory a PAN agent loads must be (a) **distilled** — small and high-signal, not raw history; (b) **selected by cue/topic**, not returned as an unfiltered top-k batch; and (c) **bounded** by an explicit token budget at load time (as `learnings/` already is via `learn topics-for --token-budget`, and `memory.cjs` now is via `selectMemory`). Do **not** cite `context-budget.cjs` as the bounding mechanism — it is read-only reporting and never observes `memory/` or `learnings/`. This principle is the yardstick every future memory feature is reviewed against.

**2. Affirm `learnings/` as the reference implementation — no change.** The distill (`distill.cjs`/`pan-distiller`) → promote-gate → topic-select (`learn topics-for`) pipeline already embodies the principle. It is validated by this finding, not challenged by it. Keep it.

**3. Bring both other layers onto the axis (implemented v3.13.0):**
   - `memory.cjs` — the whole-file read was the one genuinely unbounded path. `selectMemory` adds a cue + recency-floored + token-budgeted read (whole-file `readMemory` retained for back-compat); `exec-phase` uses it **size-gated** — whole-file by default, scoped only when the memory budget flags a large log, with a whole-file fallback if a cue matches nothing. A soft auto-compaction hook caps growth.
   - `knowledge.cjs` `ask` — `--recall-cue` re-scores the already-gathered candidates against a follow-up cue and returns a tighter `recall_sources` slice (no second walk, no deps): the minimal, in-design adoption of MRAgent's sequential exploration.

   *Scope note (C6): PAN never had "no mid-task recall" broadly — the workflow-driving orchestrator already re-pulls a budgeted learnings slice via `learn topics-for`. The genuine gap is **no active, reasoning-driven iterative reconstruction** (MRAgent's cue→infer→follow→prune); the spawned `pan-executor` sub-agent still receives a static injected slice.*

**4. Guardrail — never adopt an index-everything / top-k-at-query store (the LangMem shape).** That is the 3.26M-token failure mode. PAN's zero-runtime-dependency, no-vector-database stance is a *feature* here, not a limitation: it forecloses the most expensive design by construction.

## Alternatives considered

- **Do nothing (status quo).** Rejected: `knowledge ask` and unbounded `memory.cjs` logs will flood context as projects and campaigns scale, and the army multiplies the token cost. The finding makes the trajectory explicit.
- **Add a vector-store / LangMem-style RAG memory.** Rejected: it *is* the 27× / 3.26M failure mode, adds a runtime dependency (violating PAN's zero-dep design), and buys nothing the distill-and-select model doesn't already give at a fraction of the tokens.
- **Full MRAgent port** (a cue→tag→content memory graph plus an LLM distillation pipeline). Rejected as premature and heavy. PAN already has distillation (`distill.cjs`) and cue/topic selection (`learn topics-for`); the *only* missing piece is the iterative recall loop. Porting the whole architecture would rebuild what exists to graft on one behavior. Scope to that behavior instead.

## Consequences

- **A yardstick.** "Distill-and-select, cue-selected, budget-bounded — never index-everything top-k" is now the review test for any memory change. Reviewers can cite this ADR.
- **`learnings/` validated, untouched.** The finding is external corroboration of the existing design.
- **Two concrete, bounded follow-ups identified** (see Future Work), each small in scope precisely because PAN already has the distillation and selection machinery.
- **Token cost stays bounded as the army scales** — directly protecting the quantity v3.12.4's telemetry work now measures accurately. This ADR is the design-side complement to that fix: v3.12.4 made spend *observable*; this keeps it *low*.
- **Trade-off — latency for tokens.** Iterative recall adds tool round-trips versus one-shot retrieval. Accepted: MRAgent still *halved* runtime (1,122 s → 586 s) despite exploring sequentially, because it wasn't processing hundreds of thousands of noise tokens. For PAN's async, human-gated army, bounded tokens beat a marginal round-trip.
- **No user-facing change and nothing shipped.** `docs/` is not in `package.json` `files`; this is a repo decision doc. Deploying the current release does not ship an in-progress decision.

## Delivered in v3.13.0, and what remains

- **FW-2 — `memory.cjs` bounded read (done).** `selectMemory(cwd, agent, {cue, tokenBudget, recencyFloor})` — cue-relevant, recency-floored, token-budgeted; whole-file `readMemory` retained. Wired into `exec-phase` size-gated with a whole-file fallback. CLI: `pan-tools memory select`.
- **Soft auto-compaction (done).** `appendMemory` trims to `DEFAULT_MAX_ENTRIES` once a log crosses `MEMORY_SOFT_CAP_MULT×` (2×) that cap — closes the "grows past 500 unbounded" hole; surfaced via an `auto_compacted` field so it is never fully silent.
- **Acceptance signal (done).** `memoryLoadBudget()` / `pan-tools memory budget`, wired into `validate health --full`: estimates whole-memory injection tokens vs the median per-agent input from the (suspect-quarantined) cost ledger; degrades to an absolute-token check when the ledger is thin.
- **FW-1 minimal (done).** `knowledge ask --recall-cue` second-pass rescoring of the already-gathered candidates.
- **Remaining (deferred).** A fuller reasoning-driven iterative reconstruction (cue→infer→follow→prune across turns) and a shared `recall` primitive unifying memory + knowledge (FW-3). Build these only if the minimal versions prove insufficient in the field — the acceptance signal is the trigger.

> **Corroboration (2026-07-09):** Alibaba's **SkillWeaver** (arXiv 2606.18051) independently confirms this ADR's principle from the tool-routing side — retrieve-and-route over a skill library instead of loading everything cut per-query context ~99% vs the naive baseline. Its *Skill-Aware Decomposition* feedback loop (decompose → retrieve → realign) was adopted for PAN's planner as an advisory pass in **ADR-0038**, which deliberately overrides the "wait for a field signal" deferral above for that one planning-side behavior.

## References

- VentureBeat, *"New agentic memory framework uses 118K tokens per query. LangMem burns through 3.26M."* (2026-06-26).
- Related PAN ADRs: ADR-0026 (self-improvement loop / learnings), ADR-0032 (squad model), ADR-0033/0034 (army campaigns), ADR-0035 (army HUD). Field data: `docs/FIELD-REPORT-army-2026-06.md`.
- Modules: `pan-wizard-core/bin/lib/{memory,knowledge,distill,learn-index,learn-lint,commands-learnings,context-budget}.cjs`; `pan-wizard-core/learnings/`.
