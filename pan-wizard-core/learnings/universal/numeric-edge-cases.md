---
topic: numeric-edge-cases
last_updated: 2026-04-27T10:22:49.117Z
patterns:
  - id: P-601
    summary: Test numeric-scaling code with all-equal-values, single-value, zero, and mixed-sign edge cases
    promoted_at: 2026-04-27T10:22:49.117Z
    source_experiments: [whoograph]
---

# Numeric Edge Cases (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-601 — Test numeric-scaling code with all-equal-values, single-value, zero, and mixed-sign edge cases

**Evidence:** whoograph sess_20260427T133500 13:38Z error (major): scaleBars all-equal branch was bypassed because Math.max(...values, 0) inflated min/max range. Test 'zero range -> all bars length 1' caught it.

**Rule:** When implementing numeric scaling/normalization code (charts, percentages, ratios, gradients), write tests for ALL of: empty input, single value, all-equal values, all-zero values, mixed-sign values, and extreme range. The all-equal case is the most commonly missed because synthetic test data tends to have variation. Treat all-equal as a deliberate special case (visual indicator-only bars), not as a math edge case to silently absorb.

**Applies in:** exec-phase (any visualization, normalization, or scoring code)
