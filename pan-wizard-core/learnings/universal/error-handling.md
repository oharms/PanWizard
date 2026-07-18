---
topic: error-handling
last_updated: 2026-07-18T08:42:29.856Z
patterns:
  - id: P-1209
    summary: Return errors as result object fields ({error, ...details}) rather than throwing for caller-facing pure functions
    promoted_at: 2026-04-27T10:57:40.942Z
    source_experiments: [whoodag]
  - id: P-FH-022
    summary: Classify errors by structured codes and class, not by matching message text
    promoted_at: 2026-07-18T08:42:29.856Z
    source_experiments: [field-harvest-2026-07]
---

# Error Handling (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1209 — Return errors as result object fields ({error, ...details}) rather than throwing for caller-facing pure functions

**Evidence:** whoodag 15:32Z decision: topoSort returns {sorted} on success or {error, cycleNodes} on failure. Caller branches on .error without try/catch. Pattern reused across whooo (parseFrontmatter), whoodiff (parseTaskFile), whoosort (validation).

**Rule:** For pure-function APIs that return data, return errors as a field on the result object ({error: string, ...context}) rather than throwing. Reasons: (1) callers don't need try/catch boilerplate, (2) errors carry structured context the caller can branch on, (3) function signatures stay synchronous-typed in JSDoc/TS without union throw types. Reserve throw for programmer errors (invalid arg shape) and for catastrophic conditions; use result-object errors for expected/recoverable failures.

**Applies in:** exec-phase (any pure-function library API), plan-phase (when designing internal contracts)

## P-FH-022 — Classify errors by structured codes and class, not by matching message text

**Evidence:** A message-string regex missed a one-word 'timeout' variant that the structured error-code path already handled correctly; separately, a bare catch collapsed network, HTTP, malformed, and internal errors into a single opaque upstream code.

**Rule:** Branch error handling on structured error codes and a deliberate taxonomy (network vs HTTP-4xx/5xx vs malformed-response vs internal bug), not on regex/substring matching of human-readable message strings, which is brittle and locale/library-dependent. Collapsing all failures into one opaque code destroys diagnosability; preserve the original detail in a dev-only field and sanitize it in higher tiers.

**Applies in:** error classification and control-flow branching
