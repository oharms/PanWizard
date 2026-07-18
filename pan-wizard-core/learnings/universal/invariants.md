---
topic: invariants
last_updated: 2026-07-18T08:42:29.857Z
patterns:
  - id: P-901
    summary: Round-trip tests (parse(write(x)) === x) catch asymmetric escape/decode bugs in format converters
    promoted_at: 2026-04-27T10:50:44.078Z
    source_experiments: [whoocsv]
  - id: P-FH-024
    summary: Enforce a safety invariant at one chokepoint, not at every call site
    promoted_at: 2026-07-18T08:42:29.857Z
    source_experiments: [field-harvest-2026-07]
---

# Invariants (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-901 — Round-trip tests (parse(write(x)) === x) catch asymmetric escape/decode bugs in format converters

**Evidence:** whoocsv sess_20260427T143000 14:34Z surprise: round-trip preserves data through commas/quotes/newlines. Single property test covers what 5 unit tests would

**Rule:** When writing format converters (CSV, JSON, YAML, XML, custom), include at least one round-trip test: assert parse(write(input)) deepEquals input for a representative non-trivial input. Catches escape/decode asymmetries that unit tests miss.

**Applies in:** exec-phase (any parser/serializer pair)

## P-FH-024 — Enforce a safety invariant at one chokepoint, not at every call site

**Evidence:** A refactor originally planned to add a trailing commit at ~15 publish call sites (any one of which, if forgotten, would silently drop a message) was instead realized by making the shared bus wrapper do publish-then-commit itself; 'no silent-loss path' became structural and the per-site edits were subsumed.

**Rule:** When correctness depends on a step that must follow every occurrence of an operation (e.g. flush-after-publish, unlock-after-lock, audit-after-write), route all occurrences through a single wrapper that performs both steps atomically, instead of asking each of N call sites to remember the follow-up. A forgotten step at one of many sites causes silent data loss; centralizing makes 'the unsafe path cannot exist' a structural property rather than a discipline the reviewer must re-check per site.

**Applies in:** safety steps that must follow every occurrence of an operation (flush/unlock/audit)
