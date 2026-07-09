---
topic: invariants
last_updated: 2026-04-27T10:50:44.078Z
patterns:
  - id: P-901
    summary: Round-trip tests (parse(write(x)) === x) catch asymmetric escape/decode bugs in format converters
    promoted_at: 2026-04-27T10:50:44.078Z
    source_experiments: [whoocsv]
---

# Invariants (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-901 — Round-trip tests (parse(write(x)) === x) catch asymmetric escape/decode bugs in format converters

**Evidence:** whoocsv sess_20260427T143000 14:34Z surprise: round-trip preserves data through commas/quotes/newlines. Single property test covers what 5 unit tests would

**Rule:** When writing format converters (CSV, JSON, YAML, XML, custom), include at least one round-trip test: assert parse(write(input)) deepEquals input for a representative non-trivial input. Catches escape/decode asymmetries that unit tests miss.

**Applies in:** exec-phase (any parser/serializer pair)
