---
name: Opus 4.7 Extended Feature Designs (v1, SUPERSEDED)
type: feature-spec
status: superseded
superseded_by: opus_47_extended_features_v2_featureai.md
created: 2026-04-18
owner: oharms
related: [opus_47_existing_enhancements_featureai.md]
depends_on: [opus_47_existing_enhancements_featureai.md]
---

> **⚠ Superseded.** This spec has been consolidated into [Spec B v2](opus_47_extended_features_v2_featureai.md), which folds overlapping capabilities behind fewer entry points (13 commands → 6, ~3200 LOC → ~1800, 15 weeks → 8). This v1 document is preserved for historical reference and as a catalog of sub-features that didn't survive consolidation but may be revisited later.

# Spec B — Extended Feature Designs (New Capabilities) — v1, SUPERSEDED

**Scope:** New commands, new agents, new architectural patterns that are only possible given Opus 4.7 primitives. Each feature below is a standalone module. Spec B assumes Spec A is shipped (memory.cjs, cache helpers, model routing extensions exist).

**Guiding principles:**
1. **Additive only.** No feature in Spec B breaks an existing command.
2. **Runtime-graceful.** Each feature declares minimum runtime capability; non-Claude runtimes get a documented fallback.
3. **Opt-in.** Every new command defaults off until the user runs `/pan:settings` to enable it.

---

## X-1. `/pan:architect` — Whole-Project Dependency Planner

**Problem.** PAN today plans phases linearly (phase 1 → 2 → 3 …). This assumes human-curated sequencing. With 1M context, an agent can ingest full requirements.md + roadmap.md + CLAUDE.md + codebase map in one call, then emit a *phase dependency graph* showing which phases can run in parallel, which must sequence, which have hidden coupling.

**New files.**
- `commands/pan/architect.md` — user-facing command.
- `agents/pan-architect.md` — new agent (1M-context ingestion, thinking-on).
- `pan-wizard-core/bin/lib/architect.cjs` — new core module: `buildDependencyGraph(phases)`, `detectParallelizable(graph)`, `detectHiddenCoupling(graph, codebase)`.
- `pan-wizard-core/templates/architecture-graph.md` — output template (mermaid DAG + rationale table).
- `pan-wizard-core/workflows/architect.md` — orchestrator workflow.

**Output.** `.planning/architecture/dependency-graph.md` with:
- Mermaid DAG of phase dependencies
- Rationale per edge (why phase X depends on phase Y)
- "Parallel batches" recommendation
- Risk flags (hidden coupling, circular dependencies)

**Runtime compatibility.** Opus 4.7 primary (1M context). Sonnet fallback shards into 3 agent calls with stitching.

**Test surface.** ~15 tests, new test file.

---

## X-2. `/pan:orchestrate` — Hierarchical Agent Spawning

**Problem.** Today the `Task` tool orchestrates from workflow → agent (one level). Opus 4.7 can have agents spawn agents. A *conductor* agent can decompose a phase into sub-phases and spawn specialist agents for each, without the workflow.md script mediating every step.

**New files.**
- `commands/pan/orchestrate.md` — user-facing command.
- `agents/pan-conductor.md` — top-level orchestrator agent. Reads phase plan, spawns `pan-executor`, `pan-reviewer`, `pan-verifier` in sequence with inter-agent handoff.
- `pan-wizard-core/bin/lib/orchestrate.cjs` — `buildConductorInstructions(plan)`, `trackConductorState(cwd)`.
- `.planning/orchestration/<phase>/trace.json` — audit log of conductor decisions.

**Why different from `exec-phase`:** exec-phase is deterministic (workflow.md dictates every step). Conductor is adaptive (decides mid-flight to re-plan, spawn extra research, abort a sub-task).

**Safety harness (mandatory).**
- Max 3 levels of nesting (conductor → executor → reviewer is 2 levels; no more).
- Max 12 agent spawns per phase.
- Cost ceiling (reuses focus-auto's budget layer).
- Emergency stop via `.planning/orchestration/abort` file.

**Runtime compatibility.** Claude Code + Opus 4.7 only. Documented in command doc.

**Test surface.** ~20 tests, new test file + scenario test.

---

## X-3. `/pan:converse` — Interactive Design Refinement

**Problem.** `/pan:discuss-phase` is a scripted one-shot interview. With prompt caching + memory, PAN can support multi-turn design refinement: user says "but what about X?", agent thinks, consults memory, updates context.md incrementally. Each turn's context is cached.

**New files.**
- `commands/pan/converse.md` — user-facing.
- `agents/pan-discussant.md` — new agent with memory:on, thinking:on, caching:on.
- `pan-wizard-core/bin/lib/converse.cjs` — session state, turn history.
- `.planning/conversations/<phase>/session.json` — resumable conversation state.

**Flow.**
1. User: `/pan:converse 12 "should we use Redis or Memcached?"`
2. Agent reads existing context.md, memory for phase 12, thinks, responds.
3. User: `/pan:converse 12 "what about cost at 10M req/sec?"` — cache still warm, agent refines.
4. After N turns, agent emits updated context.md candidate, user approves.

**Runtime compatibility.** All runtimes (just a chat loop). Opus + Claude gets caching benefit.

**Test surface.** ~12 tests.

---

## X-4. `/pan:self-review` — Agent Cross-Verification Network

**Problem.** pan-reviewer today reviews human-written or executor-written code once. With cheap caching + thinking, PAN can run a *cross-verification network*: reviewer reviews executor; meta-reviewer reviews the reviewer for missed issues. Tuned via 2 exchanges max.

**New files.**
- `commands/pan/self-review.md`
- `agents/pan-meta-reviewer.md` — new agent. Reviews the reviewer's review.
- `pan-wizard-core/bin/lib/self-review.cjs` — cross-check orchestration, conflict resolution (disagreements surface as user-facing questions, not silent overrides).

**Output.** `.planning/reviews/<phase>/cross-review.md` with:
- Reviewer's findings
- Meta-reviewer's additions / disputes
- Resolution table

**Runtime compatibility.** All runtimes.

**Test surface.** ~10 tests.

---

## X-5. `/pan:simulate` — Dry-Run Phase Impact Predictor

**Problem.** Users commit to `/pan:exec-phase 7` without knowing what it'll touch. A simulation agent could read the plan, the codebase, predict the blast radius (files touched, tests likely to break, migration scripts needed), and emit a preview *before* any write.

**New files.**
- `commands/pan/simulate.md`
- `agents/pan-simulator.md` — read-only agent, large context, thinking.
- `pan-wizard-core/bin/lib/simulate.cjs`.
- `.planning/phases/<N>/simulation.md` — preview document.

**Output fields.**
- Files likely to be created / modified / deleted
- Tests likely to fail (based on coverage + test file imports)
- Migration steps required
- External deps that may need bumping
- Risk score (1-10)

**Runtime compatibility.** Opus 4.7 strongest (1M context). Degrades gracefully.

**Test surface.** ~12 tests.

---

## X-6. `/pan:teach` — Project-Specific Playbook Generator

**Problem.** Every project accumulates lore ("we don't use Redux because of X", "always test with bigint for user IDs"). This lore lives in memory.cjs entries after Spec A, but nothing surfaces it to new contributors or new phases systematically.

**New files.**
- `commands/pan/teach.md`
- `pan-wizard-core/bin/lib/teach.cjs` — reads all `.planning/memory/*.md`, clusters, generates playbook sections.
- `.planning/PLAYBOOK.md` — generated output.
- `pan-wizard-core/templates/playbook.md` — template.

**Triggers.** Auto-runs after each `/pan:milestone-done`. Manual via `/pan:teach`.

**Output.** Markdown document with sections: Conventions, Gotchas, Decisions, Tool Choices, Anti-Patterns.

**Runtime compatibility.** All runtimes.

**Test surface.** ~10 tests.

---

## X-7. `/pan:bridge` — MCP Tool Awareness

**Problem.** Users with MCP servers (database, Linear, Slack) expect PAN to *know* and *use* those tools when planning. Today PAN is tool-agnostic — the plan says "update the Linear ticket" as prose, not a tool invocation.

**New files.**
- `commands/pan/bridge.md`
- `pan-wizard-core/bin/lib/bridge.cjs` — discovers MCP servers via Claude Code's MCP list API, parses tool schemas, injects tool metadata into planner context.
- `.planning/bridge/available-tools.json` — cache of detected tools.

**Behavior.** When `/pan:plan-phase` runs, if bridge is enabled, planner sees "available MCP tools: [linear.updateTicket, slack.sendMessage, postgres.query]" and references them by name in the plan. Executor then calls them natively.

**Runtime compatibility.** Claude Code (MCP-first). Others: documented as "not supported, PR welcome".

**Test surface.** ~15 tests + 1 scenario with mock MCP.

---

## X-8. `/pan:watch` — Background Monitoring Agent

**Problem.** Users want passive monitoring: "tell me when test coverage drops", "warn me if a phase has taken >8 hours". Today there's no background agent.

**New files.**
- `commands/pan/watch.md` (start/stop/status)
- `agents/pan-watcher.md` — polls project state every 10-30 min.
- `pan-wizard-core/bin/lib/watch.cjs` — scheduler state, threshold config.
- `.planning/watch/config.json`, `.planning/watch/events.log`.

**Monitored signals** (all configurable):
- Test pass rate drop >2% vs baseline
- Phase active >configurable duration
- Uncommitted changes older than N hours
- Memory file growth >10 entries/day (churn)
- CHANGELOG not updated after milestone-done

**Runtime compatibility.** Claude Code via background agent support; others via external cron (documented).

**Test surface.** ~15 tests.

---

## X-9. `/pan:what-if` — Counterfactual Phase Exploration

**Problem.** Sometimes a user wonders "what if we'd chosen SQL over NoSQL in phase 3?". Today: no way to explore without manually redoing work. With thinking + 1M context, an agent can simulate the counterfactual on a branch.

**New files.**
- `commands/pan/what-if.md`
- `agents/pan-counterfactual.md` — creates a git worktree, replays the phase with the new premise, emits a report.
- `pan-wizard-core/bin/lib/whatif.cjs` — worktree lifecycle, report generation.
- `.planning/counterfactuals/<phase>-<scenario>.md`.

**Safety.** Always runs in isolated worktree. Never touches main working tree. Worktree auto-deleted after report.

**Runtime compatibility.** Claude Code (worktree integration). Others: documented alternative via manual git branch.

**Test surface.** ~10 tests.

---

## X-10. `/pan:explain` — Grounded Architecture Q&A

**Problem.** New team member asks "why does phase 4 have a race condition fix?". Answer requires reading phase-4/plan.md + summary.md + the commit + related ADRs. Manual today.

**New files.**
- `commands/pan/explain.md`
- `agents/pan-explainer.md` — accepts natural-language question, grounds answer in actual files (plans, summaries, ADRs, commits), emits citations.
- `pan-wizard-core/bin/lib/explain.cjs` — file retrieval + citation formatter.

**Output.** Answer with inline `[ADR-0015]`, `[phase-4/summary.md:42]` citations users can click.

**Runtime compatibility.** All runtimes (it's retrieval + LLM). Opus 4.7 with 1M context can ingest more ADRs/phases in one pass.

**Test surface.** ~12 tests + scenario.

---

## X-11. `/pan:predict-milestone` — Milestone Completion Estimator

**Problem.** Users don't know when their current milestone will finish. Today PAN tracks progress % but not velocity. With memory of past phase-completion times + remaining scope, a predictor agent can estimate.

**New files.**
- `commands/pan/predict-milestone.md`
- `pan-wizard-core/bin/lib/predict.cjs` — reads phase durations from history, computes velocity, projects end date with confidence interval.
- Uses thinking-mode to reason about remaining phase complexity (not just count).

**Output.** `Estimated milestone completion: 2026-05-18 (±3 days, 70% confidence). Bottleneck: phase 8 (est. 5 days, highest complexity).`

**Runtime compatibility.** All runtimes.

**Test surface.** ~10 tests.

---

## X-12. `/pan:harden` — Security & Compliance Audit Pass

**Problem.** PAN has pan-reviewer for code quality but no dedicated security pass. OWASP/STRIDE considerations today are buried in standards.md checklist items. Opus 4.7's deeper reasoning + 1M context makes it practical to run a focused security audit agent across the whole codebase.

**New files.**
- `commands/pan/harden.md`
- `agents/pan-hardener.md` — OWASP Top 10 + STRIDE threat model agent.
- `pan-wizard-core/bin/lib/harden.cjs`.
- `.planning/security/audit-<date>.md`.

**Differentiators from `pan-reviewer`:** reviewer looks at diffs in isolation; hardener does threat modeling across the full system.

**Runtime compatibility.** Opus 4.7 primary. Degraded on smaller models.

**Test surface.** ~15 tests.

---

## X-13. Agent-to-Agent Messaging Bus (Architectural)

**Problem.** Agents today communicate only via .planning/*.md files (disk-based, polled). For Spec B's hierarchical orchestration (X-2), they need a first-class message channel.

**New files.**
- `pan-wizard-core/bin/lib/bus.cjs` — exports: `publish(channel, msg)`, `subscribe(channel, handler)`, `drain(channel)`.
- `.planning/bus/<channel>.jsonl` — append-only log of messages.
- Channels: `phase-events`, `orchestrator`, `review-handoff`, `watcher`.

**Architectural note.** This is infrastructure, not a user-facing command. Future features depend on it (X-2, X-8, X-4).

**Test surface.** ~15 tests.

---

## X-14. Cost Dashboard Command `/pan:cost`

**Problem.** Users don't see what PAN costs. With Opus 4.7's caching + tier routing + thinking budgets, per-command cost is suddenly highly variable and worth exposing.

**New files.**
- `commands/pan/cost.md`
- `pan-wizard-core/bin/lib/cost.cjs` — parse .planning/metrics/tokens.jsonl, aggregate by command/agent/day.
- `.planning/metrics/tokens.jsonl` — per-call cost log (new).
- Instrumentation hook in each agent spawn to log.

**Output formats.** table | json | chart (ascii bar chart for terminal).

**Runtime compatibility.** Claude (full). Others: shows "cost data unavailable for runtime X" until their APIs expose token usage.

**Test surface.** ~10 tests.

---

## Files to Create Summary (Spec B)

| Category | Files | Count |
|----------|-------|-------|
| New commands | architect, orchestrate, converse, self-review, simulate, teach, bridge, watch, what-if, explain, predict-milestone, harden, cost | 13 |
| New agents | pan-architect, pan-conductor, pan-discussant, pan-meta-reviewer, pan-simulator, pan-watcher, pan-counterfactual, pan-explainer, pan-hardener | 9 |
| New core modules | architect.cjs, orchestrate.cjs, converse.cjs, self-review.cjs, simulate.cjs, teach.cjs, bridge.cjs, watch.cjs, whatif.cjs, explain.cjs, predict.cjs, harden.cjs, bus.cjs, cost.cjs | 14 |
| New templates | architecture-graph, playbook, security-audit, counterfactual-report | 4 |
| New workflows | architect, orchestrate, bridge | 3 |
| Test files new | ~14 new test files | 14 |

**Estimated test count delta:** +150 to +180 tests.

**Estimated LOC impact:** ~3,200 LOC added (commands + agents + lib + tests).

---

## Implementation Order (Recommended)

**Wave 1 (foundation, 3 weeks):**
1. X-13 (bus.cjs — infrastructure everything else uses)
2. X-14 (cost — gives users visibility into what's coming)
3. X-1 (architect — biggest user-visible win from 1M context)

**Wave 2 (adaptive execution, 4 weeks):**
4. X-2 (orchestrate — leverages X-13)
5. X-5 (simulate — low-risk read-only preview)
6. X-4 (self-review — cheap, high quality return)

**Wave 3 (insight layer, 3 weeks):**
7. X-6 (teach — leverages Spec A memory)
8. X-10 (explain — citation-grounded Q&A)
9. X-11 (predict-milestone)

**Wave 4 (interactive, 3 weeks):**
10. X-3 (converse)
11. X-8 (watch — needs X-13 bus)
12. X-9 (what-if — worktree-based)

**Wave 5 (specialist audits, 2 weeks):**
13. X-12 (harden)
14. X-7 (bridge — MCP awareness, Claude-only first)

**Total Spec B calendar:** ~15 weeks. Staged waves allow partial ship after each wave.

---

## Cross-Spec Dependencies

```
Spec A (foundation)
 ├─ E-1 caching ──────┐
 ├─ E-3 thinking ─────┤
 ├─ E-4 memory ───────┤
 └─ E-7 routing ──────┤
                      ▼
Spec B depends on all foundation pieces.
 X-13 bus ← foundation for X-2, X-8, X-4
 X-1 architect ← depends on E-2 (single-shot) + E-3 (thinking)
 X-6 teach ← depends on E-4 (memory)
 X-3 converse ← depends on E-1 (caching) + E-4 (memory)
```

**Ship order:** Spec A first (6 weeks). Then Spec B Wave 1 after A is stable (ship as v3.0). Subsequent waves as minor versions (v3.1, v3.2, ...).
