# ADR-0024: Spec B v2 Completion — Consolidated Extended Features Across v3.0-v3.4

## Status
Accepted (shipped 2026-04-18 through 2026-04-19)

## Context

Spec A (Opus 4.7 existing enhancements, ADR-0023) shipped in v2.10.0 and consumed the five core Opus 4.7 primitives (prompt caching, extended thinking, 1M context, memory, capability routing) across PAN's existing surface. With Spec A stable and producing telemetry, the question was how to ship the *extended* feature set Spec B designed.

Spec B v1 ([docs/specs/opus_47_extended_features_featureai.md](../specs/opus_47_extended_features_featureai.md)) proposed 14 new commands, 9 new agents, 14 new core modules across 5 waves — a ~3200 LOC, 15-week delta. On 2026-04-18 we accepted a consolidation pass (Spec B v2, [docs/specs/opus_47_extended_features_v2_featureai.md](../specs/opus_47_extended_features_v2_featureai.md)) that folded overlapping capabilities into 6 user-facing commands and shipped as v3.0 through v3.4 over roughly one calendar week.

This ADR records the decisions made during that arc — what was consolidated, what was explicitly deferred, why the hierarchical orchestrator was gated behind a flag, and the safety posture for features that introduced new capabilities (agents-spawn-agents, worktree isolation, MCP discovery).

## Decision

Ship Spec B v2 across five additive waves with no breaking changes. Consolidate v1's 14 items into 6 user-facing commands plus one infrastructure layer. Keep the focus system (`/pan:focus-*`) untouched — Spec B v2 items interoperate via read boundaries and optional flags only, never modifying focus commands.

### Wave breakdown

| Wave | Release | Items | Scope |
|------|---------|-------|-------|
| 1 | v3.0.0 | Y-6 cost + Y-7 bus | Observability (cost dashboard) + foundation (file-backed message channels) |
| 2 | v3.1.0 | Y-1 preview | Foresight — blast radius / dependency graph / milestone ETA in one multi-mode command |
| 3 | v3.2.0 | Y-2 review-deep + Y-3 knowledge | Security + cross-check review (2 new agents) + grounded Q&A / discussion / playbook (1 new agent, 3 modes) |
| 4 | v3.3.0 | Y-4 what-if + Y-5 mcp-bridge | Counterfactual phase replay in worktree + MCP discovery-only |
| 5 | v3.4.0 | `--hierarchical` GA + `--deep-review` wiring + auto cost instrumentation | Wave 1 bus becomes observable via `pan-conductor` + cost hook |

### Consolidation decisions (from v1)

- **Foresight** (X-1 architect + X-5 simulate + X-11 predict-milestone) → single `/pan:preview` command with three modes
- **Deep review** (X-4 self-review + X-12 harden) → single `/pan:review-deep` command with two sequential agent passes
- **Knowledge** (X-3 converse + X-6 teach + X-10 explain) → single `/pan:knowledge` command with three modes
- **Hierarchical exec** (X-2 orchestrate + X-13 bus) → infrastructure layer + opt-in flag on existing `exec-phase`, not a standalone command

### Explicit deferrals (documented, not shipped)

- **X-8 watch** (background monitoring) — no user-demand signal; external cron works today; revisit in v3.5+ if requested
- **MCP auto-injection into planner context** — requires stable MCP schema contract; ship discovery-only (Y-5) first
- **MCP auto-invocation from executor agent** — requires permission-gating + per-tool safety review
- **Cross-runtime MCP discovery protocol** — no ecosystem signal; cache schema designed generically so future non-Claude runtimes can plug in
- **`pan-conductor` nesting beyond 2 levels** — would need substantially more safety tooling; current 2-level cap is sufficient for the observed use cases

### Safety posture decisions

**Hierarchical orchestration is opt-in behind a flag, not the default.** Rationale:
1. Flat exec is cheaper (~20-30% lower total cost for equivalent work).
2. Flat exec is more predictable — each sub-agent's behavior is deterministic given plan input; hierarchical introduces a decomposition decision that varies with model reasoning.
3. Flat exec is easier to debug — linear trace vs tree trace.
4. Hierarchical is only useful when wall-clock reduction justifies the orchestration tax (phases with ≥4 autonomous plans).

The safety harness is mandatory (not advisory) for `--hierarchical`:
- Max 2 nesting levels (conductor → sub-agent; no sub-sub-agents)
- Max 12 spawns per phase
- Budget ceiling (reuses focus-auto's budget layer)
- Emergency stop via `.planning/orchestration/abort` kill-switch
- Audit trail in `.planning/orchestration/trace.json` + `.planning/bus/orchestrator.jsonl`

**Counterfactual agent runs in isolated git worktree.** Rationale: counterfactual replay inherently involves speculative file modifications. Worktree isolation is the enforcement mechanism — the agent can edit freely in the worktree without affecting the main tree, and the worktree is auto-deleted after the report is written in the main tree. The agent's contract forbids commit/push/merge and paths outside the worktree.

**MCP integration is discovery-only in v3.x.** Rationale: auto-invoking external tools (Linear, Slack, databases) without permission gating is a safety risk. Ship the read path (discovery + recommendation) first; revisit auto-invocation when MCP schemas stabilize and per-tool safety review is in place.

**Cost instrumentation is non-blocking.** Rationale: observability must never break the primary agent loop. The SubagentStop hook swallows all errors silently. Records with zero tokens (when Claude Code's event payload lacks `usage` data) are logged anyway — presence matters even when cost doesn't resolve.

## Consequences

### Positive

- **Shipped 6 user-facing commands in ~1 calendar week** instead of 13 over 15 weeks. Consolidation-first design reduced risk of abandoning mid-way.
- **Zero breaking changes.** Every feature is additive; `.planning/` gains new subdirectories but no existing file changes shape.
- **Each command has a clear single purpose.** `/pan:preview` is foresight, `/pan:cost` is observability, `/pan:review-deep` is security, `/pan:knowledge` is retrieval, `/pan:what-if` is counterfactual exploration, `/pan:mcp-bridge` is discovery. No overlap, no "which command do I use?" ambiguity.
- **Focus system untouched.** Users of `/pan:focus-*` see identical behavior. Spec B v2 features integrate via flags (`--deep-review`) or via read boundaries (cost reads focus-auto telemetry, preview reads roadmap), not by modification.
- **Safety posture is explicit.** Each new capability has documented boundaries (hierarchical caps, worktree isolation, discovery-only MCP).

### Negative

- **`--hierarchical` is Claude + Opus 4.7 only.** Other runtimes silently fall back to flat exec. This is documented but creates a capability gap — users on OpenAI/Gemini/etc. don't get hierarchical orchestration.
- **MCP bridge is Claude-only.** Other runtimes return empty `source: "empty"` gracefully, but the recommendation feature is unavailable.
- **Auto cost logging is best-effort.** Claude Code's SubagentStop payload doesn't always carry token counts. Records with zeros are honest but require the user to cross-reference provider billing for exact totals.
- **Module count grew from 17 to 24.** Surface expansion. Mitigated by: each module has a clear single responsibility, and the module inventory in ARCHITECTURE.md documents each one explicitly.
- **Spec B v1 artifacts remain in the repo.** `opus_47_extended_features_featureai.md` is marked `status: superseded` with a header banner pointing to v2. We chose preservation over deletion to maintain the design history trail.

### Neutral / Tradeoffs considered

- **Why not also ship X-8 watch?** Background monitoring is orthogonal to the Opus 4.7 capability set and doesn't reuse Spec A infrastructure. External cron + `/pan:health` cover 80% of the use case. Ship when a real user demand signal arrives.
- **Why ship bus.cjs in Wave 1 before any consumer?** Y-7 infrastructure unblocks Y-2 (review-deep audit trail) and `pan-conductor` (orchestrator trace). Shipping the foundation first meant Wave 3 could implement review-deep without first implementing the bus. Separately-testable modules.
- **Why flat namespace (`/pan:*`) instead of `/pan:adv:*` for v2 items?** Flat is discoverable; namespacing clutters tab-completion. 48 commands across 6 groups is manageable; further growth would warrant reconsidering.
- **Why consolidate knowledge modes (ask/discuss/playbook) rather than ship three commands?** Single entry point means users don't have to remember which of `/pan:explain` / `/pan:converse` / `/pan:teach` to invoke. Each mode is independently invokable with a subcommand.

## Implementation Notes

### Commit history

- `0c8df85` — v3.0.0 Wave 1 (Y-6 cost + Y-7 bus)
- `1f98394` — v3.1.0 Wave 2 (Y-1 preview)
- `f3a4451` — v3.2.0 Wave 3 (Y-2 review-deep + Y-3 knowledge)
- `7faf9b2` — v3.3.0 Wave 4 (Y-4 what-if + Y-5 mcp-bridge)
- `d391599` — v3.4.0 Wave 5 (`--hierarchical` GA + `--deep-review` wiring + cost hook)

### Cumulative delta (v2.10.0 → v3.4.0)

- Tests: 2143 → 2368 (+225)
- Core modules: 17 → 24 (+7)
- Agents: 12 → 18 (+6)
- Commands: 42 → 48 (+6)
- Hooks: 3 → 4 (+1)
- Templates: ~22 → 26 (+4)
- CLI subcommands: ~110 → ~130 (+20)

### Rollback plan

Spec B v2 is entirely additive. Rollback strategy if telemetry reveals a regression:
- Remove the new commands from `commands/pan/` — host runtime sees them disappear on next session
- Remove the new agents from `agents/` — no agent, no spawn path
- `hooks/pan-cost-logger.js` — remove via installer's SubagentStop hook cleanup (`panHooks` array)
- `pan-conductor` + `--hierarchical` flag — unwired if agent missing
- `.planning/` subdirectories (`metrics/`, `bus/`, `bridge/`, `counterfactuals/`, `conversations/`, `orchestration/`, `reviews/`, `memory/`, `architecture/`) — data preserved; readers tolerate missing directories via `try/catch` in core library

No schema changes to `.planning/state.md`, `.planning/roadmap.md`, `.planning/project.md`, or any other file that existed pre-v3.0. Rollback is a commit-level operation, not a data migration.

### Future scope

Post-v3.4 work is discretionary. Candidates:
- X-8 watch (background monitoring)
- MCP auto-injection into planner context (v3.5+ if schema stabilizes)
- MCP auto-invocation from executor (v3.5+ with permission gating)
- `pan-conductor` nesting beyond 2 levels (would require deeper safety tooling)
- Cross-runtime MCP discovery protocol
- Generic instrumentation for token capture across runtimes (Gemini, OpenCode, Codex, Copilot — currently zero token visibility)

## Related

- [ADR-0023: Opus 4.7 Adoption](ADR-0023-opus-4-7-adoption.md) — baseline Spec A integration this builds on
- [Spec B v1](../specs/opus_47_extended_features_featureai.md) — original 14-item design (superseded)
- [Spec B v2](../specs/opus_47_extended_features_v2_featureai.md) — consolidated design (accepted, shipped)
- [MIGRATION-v2-to-v3.md](../MIGRATION-v2-to-v3.md) — user-facing upgrade guide
- ADR-0015 (focus-auto runner) — budget ceiling layer reused by hierarchical safety harness
- ADR-0022 (lifecycle completeness) — pan-reviewer baseline that pan-hardener + pan-meta-reviewer extend
