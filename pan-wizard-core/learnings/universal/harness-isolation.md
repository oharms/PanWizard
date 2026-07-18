---
topic: harness-isolation
last_updated: 2026-07-09T14:04:40.519Z
patterns:
  - id: P-ISO-001
    summary: Autonomous observers/fuzzers/eval harnesses must run against a SHA-locked frozen copy of the product with a path guard, and stay strictly read-only against the live workspace
    promoted_at: 2026-07-09T14:04:40.519Z
    source_experiments: [mph-factory, mph-factory-limits]
---

# Harness Isolation (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-ISO-001 — Autonomous observers/fuzzers/eval harnesses must run against a SHA-locked frozen copy of the product with a path guard, and stay strictly read-only against the live workspace

**Evidence:** Two autonomous harnesses (an optimization factory and an endurance/limits factory) both froze the compiler under test to a SHA-locked installed copy and refused to start if the binary resolved outside the frozen directory — never referencing the live workspace build tree. This kept findings attributable to a known version and made the loop safe to run unattended alongside active development.

**Rule:** An autonomous loop that observes or stresses a product must: (1) pin the product to a SHA-locked frozen artifact; (2) guard at startup that the binary under test resolves inside the frozen path, refusing to run otherwise; (3) be read-only against the live source/workspace. Findings from an unpinned target are unattributable and the loop can corrupt in-progress work.

**Applies in:** Fuzzers, eval harnesses, perf factories, CI observers running beside active development.
