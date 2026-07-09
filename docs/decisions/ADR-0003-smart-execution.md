# ADR-0003: Smart Execution System

**Status:** Accepted
**Date:** 2026-03-01
**Context:** Workflow Integration Redesign — `docs/specs/workflow-integration-redesign.md`

## Decision

Implement a tiered execution system with budget tracking, commit safety, rollback snapshots, and error pattern learning to improve execution efficiency and safety.

## Context

The execute-phase workflow treated all plans identically regardless of complexity. A 1-task typo fix consumed the same agent lifecycle (spawn, execute, verify, summarize) as a 12-task multi-module refactor. This led to:

- **Context waste:** Simple tasks consumed full 200K context windows unnecessarily
- **No budget awareness:** Sessions could attempt more work than practically feasible
- **No safety nets:** Sensitive files could be committed accidentally; no easy rollback
- **No learning:** Repeated mistakes weren't captured across sessions

## Approach

### Tier Classification (MICRO / STANDARD / FULL)

Plans are classified based on complexity signals from frontmatter:

| Tier | Criteria | Agent Behavior |
|------|----------|----------------|
| MICRO | task_count <= 3 AND files_modified <= 2 | Minimal context, fast verification |
| STANDARD | task_count <= 8 | Normal execution with full verification |
| FULL | task_count > 8 OR autonomous=false | Extended context, human-in-loop possible |

Explicit `tier` field in frontmatter overrides the algorithm.

### Budget Point System

| Effort | Points | Meaning |
|--------|--------|---------|
| XS | 1 | Config tweak, typo fix |
| S | 2 | Single-file bug fix |
| M | 4 | Multi-file feature |
| L | 10 | Multi-module change |
| XL | 20 | New subsystem |

Default budget: 50 points per session. Configurable via `--budget N` (1-200) or `config.budget.default_points`.

### Commit Safety

Before committing, check for:
1. **Deleted files** — warn unless `--force`
2. **Sensitive files** — block `.env`, `.pem`, `.key`, `credentials`, etc.

Patterns configurable via `config.commit.sensitive_patterns`.

### Rollback Snapshots

`rollback-snapshot <phase>` creates a git tag `pan-rollback-{phase}-{timestamp}` at current HEAD before execution begins. Easy `git reset --hard pan-rollback-...` to undo a failed execution.

### Error Pattern Learning

`readErrorPatterns()` and `appendErrorPattern()` manage `.planning/patterns.md` — a structured log of PAT-NNN entries capturing what went wrong, what's correct, and context. Patterns persist across sessions.

### Session History

`appendSessionSummary()` appends to `.planning/session-history.md`, keeping the last 20 entries. Tracks phase, plans executed, test counts before/after, and key decisions.

## Consequences

### Positive
- XS/S tasks can complete in 1 agent round-trip (MICRO tier)
- Budget prevents context exhaustion from over-ambitious sessions
- Commit safety catches accidental secret leaks
- Rollback tags provide easy recovery from failed executions
- Error patterns enable cross-session learning

### Negative
- Additional complexity in plan frontmatter (tier, priority, effort fields)
- Budget system requires effort estimation upfront
- patterns.md and session-history.md add to planning directory size

## Alternatives Considered

1. **Dynamic tier detection at runtime** — Rejected; frontmatter-based classification is simpler and predictable
2. **Token-based budget instead of points** — Rejected; token costs vary by model, points are stable
3. **Automatic rollback on test failure** — Deferred; too aggressive for v0.3.0, may lose valid partial work
