---
topic: test-strategy
last_updated: 2026-04-27T10:25:32.100Z
patterns:
  - id: P-201
    summary: Test parsers and validators against real-world corpus fixtures from day one, not synthetic ones
    promoted_at: 2026-04-27T09:48:31.640Z
    source_experiments: [whooo]
  - id: P-701
    summary: When all tests pass first-run on a non-trivial build, that's a saturation signal — promoted patterns are constraining the design space
    promoted_at: 2026-04-27T10:25:32.100Z
    source_experiments: [whoodiff]
---

# Test Strategy (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-201 — Test parsers and validators against real-world corpus fixtures from day one, not synthetic ones

**Evidence:** whooo sess_20260427T113000 trace.jsonl 11:50Z surprise event: 252 errors on PAN dogfood despite 39/39 unit tests passing. Synthetic fixtures gave false green light; the block-style YAML list scope-cut in DESIGN_SPEC was wrong but invisible to unit tests.

**Rule:** When building any parser, validator, or schema-checker for a structured format, include at least one fixture sampled DIRECTLY from the real-world corpus before declaring v1 done. The dogfood gate runs BEFORE asserting passed, not after. Synthetic fixtures lie; real-corpus fixtures don't.

**Applies in:** plan-phase (fixture planning), exec-phase (parser/validator implementation), verify-phase (gate definition)

## P-701 — When all tests pass first-run on a non-trivial build, that's a saturation signal — promoted patterns are constraining the design space

**Evidence:** whoodiff sess_20260427T135000 13:57Z surprise: 12 tests, all passed first run, zero deviations during a multi-file build with diff/format/parser logic. With 9 prior universal patterns (P-201..P-205, P-401..P-403, P-501, P-602) acting as default behavior, the space of wrong choices is heavily constrained. Compare to whooo (first run: 8 unit tests passed but 252 errors on dogfood) and whoosort (1 deviation).

**Rule:** Track per-experiment 'first-run pass rate' (% of tests passing without iteration) as a quality signal for the promote pipeline. Rising rate = patterns are saturating; design space is shrinking. Falling rate = need more diverse experiments to surface new failure modes. Saturation isn't slowdown — it's the point: the loop's job is to convert lessons into defaults, then the defaults work invisibly.

**Applies in:** promote workflow, /pan:learn analysis, post-experiment retrospective
