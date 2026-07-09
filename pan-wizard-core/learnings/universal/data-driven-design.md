---
topic: data-driven-design
last_updated: 2026-04-27T10:15:01.073Z
patterns:
  - id: P-403
    summary: Comparator/validator/formatter as a data map beats a switch statement
    promoted_at: 2026-04-27T10:15:01.073Z
    source_experiments: [whoosort]
---

# Data Driven Design (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-403 — Comparator/validator/formatter as a data map beats a switch statement

**Evidence:** whoosort 13:02Z decision: COMPARATORS = { alpha, numeric, length } object map is extensible and testable in isolation. Adding modes is data, not control flow.

**Rule:** When dispatching to one of N strategies based on a string key (sort modes, output formats, validators, parsers), define them as a frozen object map rather than a switch statement. Adding a strategy becomes data + test, not control-flow modification. Generalizes to schema validators, output formatters, command dispatchers.

**Applies in:** exec-phase, plan-phase (when designing extensibility points)
