---
topic: error-handling
last_updated: 2026-04-27T10:57:40.942Z
patterns:
  - id: P-1209
    summary: Return errors as result object fields ({error, ...details}) rather than throwing for caller-facing pure functions
    promoted_at: 2026-04-27T10:57:40.942Z
    source_experiments: [whoodag]
    superseded_id: P-1201
    supersession_note: Renumbered 2026-05-03 — original P-1201 collided with the atomic-state.md pattern of the same ID; this is the error-handling rule.
---

# Error Handling (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1209 — Return errors as result object fields ({error, ...details}) rather than throwing for caller-facing pure functions

**Evidence:** whoodag 15:32Z decision: topoSort returns {sorted} on success or {error, cycleNodes} on failure. Caller branches on .error without try/catch. Pattern reused across whooo (parseFrontmatter), whoodiff (parseTaskFile), whoosort (validation).

**Rule:** For pure-function APIs that return data, return errors as a field on the result object ({error: string, ...context}) rather than throwing. Reasons: (1) callers don't need try/catch boilerplate, (2) errors carry structured context the caller can branch on, (3) function signatures stay synchronous-typed in JSDoc/TS without union throw types. Reserve throw for programmer errors (invalid arg shape) and for catastrophic conditions; use result-object errors for expected/recoverable failures.

**Applies in:** exec-phase (any pure-function library API), plan-phase (when designing internal contracts)
