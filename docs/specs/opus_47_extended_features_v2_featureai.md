---
name: Opus 4.7 Extended Features (Consolidated)
type: feature-spec
status: accepted
accepted: 2026-04-18
created: 2026-04-18
owner: oharms
supersedes: opus_47_extended_features_featureai.md
depends_on: opus_47_existing_enhancements_featureai.md
decisions:
  - adopt_v2_over_v1: yes
  - wave_1_scope: cost_plus_bus (ships as v3.0)
  - namespace: flat (no /pan:adv:*)
---

# Spec B v2 — Extended Feature Designs (Consolidated)

**This spec supersedes [opus_47_extended_features_featureai.md](opus_47_extended_features_featureai.md).**

**Scope:** New capabilities layered on top of Spec A (shipped in v2.10.0). Consolidated from 13 user-facing commands down to 6 via intent-based grouping. The focus system (`/pan:focus-*`) is deliberately untouched — Spec B v2 interoperates with it via read boundaries and opt-in flags, never by modification.

**Guiding principles:**
1. **Group by user intent, not capability.** Foresight, deep review, knowledge, cost — each gets one entry point with sub-modes where needed.
2. **Additive only.** No feature in v2 breaks an existing command, agent, or `.planning/` file.
3. **Infrastructure is not a command.** Hierarchical agent spawning + message bus ship as a capability behind a flag (`/pan:exec-phase --hierarchical`), not as a standalone command.
4. **Runtime-graceful.** Each feature declares minimum runtime capability; non-Claude runtimes get a documented fallback.
5. **Opt-in.** Every new command defaults off until the user enables it via `/pan:settings`.

---

## Consolidation map (v1 → v2)

| User intent | Spec B v1 items folded in | Spec B v2 entry point |
|-------------|---------------------------|-----------------------|
| See the future before committing | X-1 architect, X-5 simulate, X-11 predict-milestone | **Y-1** `/pan:preview {phases|milestone|phase N}` |
| Catch more in code review | X-4 self-review, X-12 harden | **Y-2** `/pan:review-deep` |
| Q&A, refine, teach | X-3 converse, X-6 teach, X-10 explain | **Y-3** `/pan:knowledge {ask|discuss|playbook}` |
| Explore alternatives | X-9 what-if | **Y-4** `/pan:what-if` (unchanged) |
| Discover external tools | X-7 bridge | **Y-5** `/pan:mcp-bridge` (reduced to discover+report) |
| See what PAN costs | X-14 cost | **Y-6** `/pan:cost` (unchanged) |
| Hierarchical agent spawning | X-2 orchestrate, X-13 bus | **Y-7** infrastructure: `exec-phase --hierarchical` + `bus.cjs` |

**Cut from v1:**
- X-8 watch — deferred to v3.x (no user-demand signal; cron works today).
- X-2 orchestrate as standalone command — folded into Y-7.
- X-13 bus as standalone surface — folded into Y-7.

---

## Y-1. `/pan:preview` — Foresight Entry Point

Consolidates X-1 architect + X-5 simulate + X-11 predict-milestone into one command with three modes.

**Problem.** Users wonder "what happens if I run phase 7?" or "when will this milestone finish?" or "which phases can run in parallel?". Previously these required 3 separate commands. One entry point, three modes, shared agent.

### Modes

| Mode | Invocation | What it does |
|------|------------|--------------|
| `phase N` | `/pan:preview phase 7` | Simulate the phase: files likely touched, tests likely to break, migration steps, risk score 1-10. Read-only agent, large context, thinking-on. (Was X-5 simulate.) |
| `phases` | `/pan:preview phases` | Phase dependency graph: mermaid DAG, parallelizable batches, hidden coupling flags. (Was X-1 architect.) |
| `milestone` | `/pan:preview milestone` | Completion estimator: velocity from phase history, ETA ± confidence interval, bottleneck identification. (Was X-11 predict-milestone.) |

### New files

- `commands/pan/preview.md` — single user-facing command with mode routing
- `agents/pan-previewer.md` — single agent, branches behavior by mode (read-only always)
- `pan-wizard-core/bin/lib/preview.cjs` — consolidated module: `buildPhasePreview()`, `buildPhaseDependencyGraph()`, `buildMilestoneETA()`
- `pan-wizard-core/templates/preview-report.md` — shared output template

### Output paths

- `phase N` → `.planning/phases/<N>/preview.md`
- `phases` → `.planning/architecture/dependency-graph.md`
- `milestone` → `.planning/milestones/preview-<date>.md`

### Runtime compatibility

Opus 4.7 primary (1M context for full-repo analysis in `phases` mode). Sonnet fallback shards into 3 agent calls. Other runtimes: mode `phase N` works via existing pattern; `phases` gets a "requires ≥200K context, upgrade to Opus 4.7 for single-shot analysis" note.

### Tests (~15)

- `tests/preview.test.cjs` — unit tests for each mode's data layer
- `tests/scenarios/preview-phase.test.cjs` — E2E: create temp project, run preview, validate output shape

---

## Y-2. `/pan:review-deep` — Security + Cross-Check Review

Consolidates X-4 self-review + X-12 harden.

**Problem.** `pan-reviewer` catches convention and style issues. For high-stakes phases (auth, payment, PII), we want (1) OWASP/STRIDE security audit, AND (2) a second reviewer verifying the first one didn't miss anything. Today both would require two commands; v2 ships as one.

### Single command, two passes

1. **Security pass** — pan-hardener agent does OWASP Top 10 + STRIDE threat modeling on the files changed in the phase.
2. **Cross-review pass** — pan-meta-reviewer reads pan-reviewer's review + pan-hardener's audit, flags anything the reviewer missed, disputes anything overstated.

Outputs merge into a single report.

### New files

- `commands/pan/review-deep.md`
- `agents/pan-hardener.md` — OWASP Top 10 + STRIDE threat model agent
- `agents/pan-meta-reviewer.md` — reviews reviewer + hardener output
- `pan-wizard-core/bin/lib/review-deep.cjs` — orchestration, merge logic, conflict surfacing
- `.planning/reviews/<phase>/deep-review.md` — output document

### Invocation

- Standalone: `/pan:review-deep <phase>` after `/pan:exec-phase` completes.
- Integrated: `/pan:exec-phase --deep-review <phase>` auto-runs after the normal review step.
- In focus: `/pan:focus-exec --deep-review` runs per high-stakes item.

### Runtime compatibility

All 5 runtimes. Opus 4.7 benefits from thinking on both hardener and meta-reviewer.

### Tests (~12)

- Unit: `review-deep.cjs` merge logic, conflict table generation
- Scenario: E2E phase with known OWASP-relevant code (e.g. unsanitized input) → assert hardener flags it

---

## Y-3. `/pan:knowledge` — Grounded Q&A, Refinement, Playbooks

Consolidates X-3 converse + X-6 teach + X-10 explain into one multi-mode command.

**Problem.** Three overlapping features (Q&A with citations, multi-turn design refinement, playbook generation from memory) each solve a "context retrieval" problem. User shouldn't have to remember which command does which.

### Modes

| Mode | Invocation | What it does |
|------|------------|--------------|
| `ask` | `/pan:knowledge ask "why does phase 4 have a race condition fix?"` | Retrieval-grounded answer with inline citations `[ADR-0015]`, `[phase-4/summary.md:42]`. (Was X-10 explain.) |
| `discuss` | `/pan:knowledge discuss 12 "Redis vs Memcached"` | Multi-turn conversation about phase N, session state saved to `.planning/conversations/<phase>/session.json`. Uses prompt caching + memory. (Was X-3 converse.) |
| `playbook` | `/pan:knowledge playbook` | Generate `.planning/PLAYBOOK.md` from all agents' memory (E-4 layer). Auto-runs after `/pan:milestone-done`. (Was X-6 teach.) |

### New files

- `commands/pan/knowledge.md` — mode router
- `agents/pan-knowledge.md` — single agent handling all three modes (stateful via session file)
- `pan-wizard-core/bin/lib/knowledge.cjs` — retrieval (ask), session state (discuss), playbook synthesis (playbook)
- `pan-wizard-core/templates/playbook.md` — for playbook mode

### Leverages existing Spec A infrastructure

- **ask** reuses `buildCachedContext()` (E-1) for stable input prefixes
- **discuss** reuses E-4 memory per phase
- **playbook** reads `.planning/memory/*.md` directly (E-4)

### Runtime compatibility

All runtimes. Opus + Claude gets caching benefit on multi-turn `discuss`.

### Tests (~15)

- `tests/knowledge.test.cjs` — mode routing, retrieval, session state, playbook synthesis
- `tests/scenarios/knowledge-ask-cites.test.cjs` — ask returns valid citations that point to real files
- `tests/scenarios/knowledge-playbook-from-memory.test.cjs` — E2E: seed memory, run playbook, assert PLAYBOOK.md content

---

## Y-4. `/pan:what-if` — Counterfactual Phase Exploration

**Unchanged from v1 X-9** — already narrow enough to stand alone.

- Creates a git worktree, replays the phase with a different premise, emits a comparison report, auto-deletes the worktree.
- `.planning/counterfactuals/<phase>-<scenario>.md` — preview doc stays in the main tree.
- Claude Code primary (worktree integration best); other runtimes get a documented manual git-branch fallback.

### Tests (~10)

- `tests/whatif.test.cjs` — worktree lifecycle, report generation
- `tests/scenarios/whatif-isolated.test.cjs` — E2E: mutation in worktree doesn't leak to main

---

## Y-5. `/pan:mcp-bridge` — MCP Discovery Only

**Reduced scope from v1 X-7.** Instead of deep MCP integration at planning time (which requires modifying `plan-phase` workflow + MCP tool schema translation), v2 ships the minimum viable version: **discover available MCP tools and report on them**. Auto-injection into plans defers to v3.x.

### What it does

- `/pan:mcp-bridge list` — discovers MCP servers visible to Claude Code, lists their tool schemas, writes `.planning/bridge/available-tools.json`.
- `/pan:mcp-bridge recommend <phase>` — given a phase plan, recommends which MCP tools might apply ("phase 7 writes to Linear → consider `linear.updateTicket`").

**Explicitly NOT in v2:** auto-injection into planner context, auto-invocation of MCP tools from executor agent. Those require schema stability contracts that Claude Code's MCP doesn't yet guarantee.

### New files

- `commands/pan/mcp-bridge.md`
- `pan-wizard-core/bin/lib/bridge.cjs` — discovery + recommendation logic
- `.planning/bridge/available-tools.json` — discovery cache

### Runtime compatibility

Claude Code only (MCP is Claude-first). Other runtimes: command prints "MCP not available on this runtime".

### Tests (~8)

- Unit: `bridge.cjs` recommendation heuristics
- Scenario: `tests/scenarios/mcp-bridge-discovery.test.cjs` with a mock MCP server

---

## Y-6. `/pan:cost` — Cost Dashboard

**Unchanged from v1 X-14** — already narrow and valuable. First priority to ship in Wave 1 because users need cost visibility *before* opting into other Opus 4.7 features.

### Files

- `commands/pan/cost.md`
- `pan-wizard-core/bin/lib/cost.cjs` — parse `.planning/metrics/tokens.jsonl`, aggregate by command/agent/day
- `.planning/metrics/tokens.jsonl` — per-call cost log (new)
- Instrumentation hook in each agent spawn logs to this file

### Output formats

`table` (default) | `json` | `chart` (ascii bar chart in terminal)

### Runtime compatibility

Claude full visibility. Other runtimes: shows "cost data unavailable for runtime X" with a pointer to the runtime's own billing dashboard.

### Tests (~10)

- Unit: parse jsonl, aggregate, format (table/json/chart)
- Scenario: append telemetry, invoke `/pan:cost`, assert aggregation matches

---

## Y-7. Infrastructure (no user command)

Consolidates X-2 orchestrate + X-13 bus.

**What ships:** `pan-wizard-core/bin/lib/bus.cjs` (file-based message channels at `.planning/bus/<channel>.jsonl`) + a new flag `exec-phase --hierarchical` that enables one agent (conductor) to spawn sub-agents (executors, reviewers, verifiers) in sequence with bounded safety.

**Why no user command:** hierarchical spawning is an *execution strategy*, not a user intent. Users already know `/pan:exec-phase`. They opt into the strategy.

### Safety harness (mandatory)

- Max 3 levels of nesting (conductor → executor → reviewer = 2 levels; no more).
- Max 12 agent spawns per phase.
- Cost ceiling (reuses focus-auto's budget layer).
- Emergency stop via `.planning/orchestration/abort` file.
- Audit trail: every spawn logged to `.planning/bus/orchestrator.jsonl`.

### New files

- `pan-wizard-core/bin/lib/bus.cjs` — `publish()`, `subscribe()`, `drain()` (file-backed, append-only)
- `agents/pan-conductor.md` — top-level orchestrator (only invoked when `--hierarchical` is set)
- Extension to `commands/pan/exec-phase.md` — document the new flag

### Runtime compatibility

Claude Code + Opus 4.7 only for hierarchical mode (requires native subagent spawning). Other runtimes: `--hierarchical` flag is a no-op with a documented warning, falls back to flat exec.

### Tests (~18)

- Unit: `bus.cjs` channel semantics, drain, concurrent append
- Scenario: E2E `/pan:exec-phase N --hierarchical` with abort file triggered mid-execution

---

## Files to Create Summary (Spec B v2)

| Category | Files | Count |
|----------|-------|-------|
| New commands | preview, review-deep, knowledge, what-if, mcp-bridge, cost | **6** |
| New agents | pan-previewer, pan-hardener, pan-meta-reviewer, pan-knowledge, pan-conductor | **5** |
| New core modules | preview.cjs, review-deep.cjs, knowledge.cjs, whatif.cjs, bridge.cjs, cost.cjs, bus.cjs | **7** |
| New templates | preview-report, playbook | **2** |
| Test files new | ~10 test files | **10** |
| Flag on existing command | `exec-phase --hierarchical`, `exec-phase --deep-review`, `focus-exec --deep-review` | — |

**Compared to v1:**
- Commands: 13 → 6 (**-54%**)
- Agents: 9 → 5 (**-44%**)
- Core modules: 14 → 7 (**-50%**)
- Templates: 4 → 2 (**-50%**)
- Test files: 14 → 10 (**-29%**)
- Estimated LOC: ~3200 → ~1800 (**-44%**)

**Estimated test count delta:** +110 to +140.

---

## Implementation Order

**Wave 1 (foundation + visibility, 2-3 weeks):**
1. **Y-6 `/pan:cost`** — ship first. Gives users visibility before they opt into Opus 4.7-heavy features. Enables data-driven decisions for later waves.
2. **Y-7 bus.cjs** (infrastructure only, no user command yet) — unblocks Y-2 + Y-3 + any future hierarchical flow.

**Wave 2 (foresight, 2-3 weeks):**
3. **Y-1 `/pan:preview`** (all 3 modes). Biggest user-visible win from Opus 4.7's 1M context.

**Wave 3 (deep review + knowledge, 3 weeks):**
4. **Y-2 `/pan:review-deep`** — leverages Y-7 bus for agent coordination.
5. **Y-3 `/pan:knowledge`** (all 3 modes) — reuses E-4 memory + E-1 caching.

**Wave 4 (narrow features, 1-2 weeks):**
6. **Y-4 `/pan:what-if`** — worktree-based, narrow scope.
7. **Y-5 `/pan:mcp-bridge`** — discovery-only, Claude-only.

**Wave 5 (opt-in infrastructure, 1 week):**
8. **Y-7 `exec-phase --hierarchical`** flag — now that bus.cjs exists + has been shipped + telemetry from Y-6 proves cost is controllable, enable the flag.

**Total calendar:** ~8 weeks vs v1's 15 weeks.

### Release naming

- **v3.0** — Wave 1 (Y-6 cost + Y-7 infra). Major version because it introduces a new instrumentation file (`.planning/metrics/tokens.jsonl`).
- **v3.1** — Wave 2 (Y-1 preview).
- **v3.2** — Wave 3 (Y-2 review-deep + Y-3 knowledge).
- **v3.3** — Wave 4 (Y-4 what-if + Y-5 mcp-bridge).
- **v3.4** — Wave 5 (`--hierarchical` flag goes GA).

---

## Runtime Matrix (consolidated)

| Feature | Claude | Codex | Gemini | OpenCode | Copilot | Notes |
|---------|--------|-------|--------|----------|---------|-------|
| Y-1 preview (phase) | ✅ | ✅ | ✅ | ✅ | ✅ | Works everywhere; Opus best |
| Y-1 preview (phases, 1M single-shot) | ✅ Opus 4.7 | ⚠ Sharded | ⚠ Sharded | ⚠ Sharded | ⚠ Sharded | 1M ctx required for single-shot |
| Y-1 preview (milestone) | ✅ | ✅ | ✅ | ✅ | ✅ | Pure statistical, model-agnostic |
| Y-2 review-deep | ✅ | ✅ | ✅ | ✅ | ✅ | Thinking benefits on Opus 4.7 |
| Y-3 knowledge (ask) | ✅ | ✅ | ✅ | ✅ | ✅ | Citation format is plain markdown |
| Y-3 knowledge (discuss) | ✅ Cache bonus | ✅ | ✅ | ✅ | ✅ | Prompt caching a Claude-only bonus |
| Y-3 knowledge (playbook) | ✅ | ✅ | ✅ | ✅ | ✅ | File-based, all runtimes |
| Y-4 what-if | ✅ | ⚠ Branch-only | ⚠ | ⚠ | ⚠ | Worktree best in Claude |
| Y-5 mcp-bridge | ✅ | ❌ | ❌ | ❌ | ❌ | MCP is Claude-first |
| Y-6 cost | ✅ Full | ⚠ Limited | ⚠ Limited | ⚠ Limited | ⚠ Limited | Token-usage API coverage varies |
| Y-7 hierarchical exec | ✅ Opus 4.7 | ❌ | ❌ | ❌ | ❌ | Subagent spawn needs Claude |

---

## Cross-Spec Dependencies

```
Spec A (v2.10.0, shipped)
 ├─ E-1 caching ────────────── used by Y-3 discuss
 ├─ E-4 memory ──────────────── used by Y-3 playbook, Y-2 audit trail
 ├─ E-3 thinking ────────────── benefits Y-1, Y-2 on Opus 4.7
 └─ E-7 routing ────────────────── Y-1 phases mode forces reasoning tier

Spec B v2
 ├─ Y-6 cost ─────────────── foundation, ships first, unblocks everything else
 ├─ Y-7 bus.cjs ──────────── foundation, blocks Y-2 agent coordination
 ├─ Y-1 preview ────────── leverages E-1 + E-3 + E-7 (Spec A)
 ├─ Y-2 review-deep ────── depends on Y-7 bus
 ├─ Y-3 knowledge ────────── depends on E-1 + E-4 (Spec A)
 ├─ Y-4 what-if ──────────── standalone
 └─ Y-5 mcp-bridge ──────── standalone, Claude-only
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Consolidation hides useful granularity (users prefer 3 narrow commands over 1 multi-mode) | M | M | Ship with flag-parity: every mode has a dedicated flag + can be invoked standalone |
| `/pan:preview phases` (1M-ctx) degrades to sharded poorly on Sonnet | M | M | Sharded fallback emits a prominent "confidence: low" marker |
| Hierarchical exec runaway cost | L | H | Hard caps on spawn depth + count + budget; abort file; audit trail |
| MCP schema churn breaks Y-5 discovery | M | L | MCP is Claude-only; cached discovery; explicit version negotiation |
| Y-6 cost instrumentation causes perf regression | L | L | Non-blocking jsonl append; benchmark installer time before/after |
| Users on Sonnet adopt Y-1/Y-2 and see degraded results, blame PAN | M | M | Each command prints capability detection at startup; installer warns on older models (already in E-9) |
| Telemetry files (`.planning/metrics/tokens.jsonl`) grow unbounded | M | L | Ship with documented rotation: truncate after 90 days; compaction CLI if needed |
| Bus.cjs concurrent writes corrupt channel files | L | H | File locking via `flock`/Windows file handle semantics; extensive scenario tests |

---

## Decision Points for User

Three calls needed before Wave 1 implementation starts:

1. **Adopt v2 or keep v1?** v2 is smaller + ships faster + covers the same user intents via consolidation. v1 ships more raw surface area but takes ~2× the calendar. **Recommendation: v2.**

2. **Wave 1 scope — cost + bus, or just cost?** Cost alone is ~2 weeks and immediately valuable. Adding bus.cjs in Wave 1 unblocks Y-2 for Wave 3 but adds a week. **Recommendation: both — ship as v3.0 together.**

3. **Namespace — keep flat `/pan:*` or introduce `/pan:adv:*` for v2 items?** 6 new commands on top of 42 existing = 48 total. Flat is probably fine; namespacing helps discovery but clutters tab-completion. **Recommendation: keep flat.**

---

## What was cut vs Spec B v1 (explicit deferral list)

Preserved in [Spec B v1](opus_47_extended_features_featureai.md) for future consideration:

- **X-8 watch** (background monitoring). Cut entirely from v2. Revisit v3.x if users request it.
- **X-2 orchestrate as standalone command**. Folded into `exec-phase --hierarchical` flag. The underlying capability still ships; it's just not its own command.
- **X-13 bus as user-facing surface**. The module still ships as Y-7 infrastructure, just without a user command to interact with it directly.
- **Sub-features in X-3 converse / X-6 teach / X-10 explain that didn't survive consolidation:** e.g. X-10's "auto-invoked on ambiguous user questions" and X-6's "auto-run after every `milestone-done`". Both can still be enabled via `/pan:settings` toggles in Y-3 knowledge mode routing.

These items remain valid feature ideas — they just don't warrant standalone commands in the next milestone.
