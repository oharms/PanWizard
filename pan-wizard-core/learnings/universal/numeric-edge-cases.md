---
topic: numeric-edge-cases
last_updated: 2026-07-18T08:42:29.851Z
patterns:
  - id: P-601
    summary: Test numeric-scaling code with all-equal-values, single-value, zero, and mixed-sign edge cases
    promoted_at: 2026-04-27T10:22:49.117Z
    source_experiments: [whoograph]
  - id: P-FH-009
    summary: Ratio/delta regression detectors must handle the zero-baseline case explicitly
    promoted_at: 2026-07-18T08:42:29.851Z
    source_experiments: [field-harvest-2026-07]
---

# Numeric Edge Cases (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-601 — Test numeric-scaling code with all-equal-values, single-value, zero, and mixed-sign edge cases

**Evidence:** whoograph sess_20260427T133500 13:38Z error (major): scaleBars all-equal branch was bypassed because Math.max(...values, 0) inflated min/max range. Test 'zero range -> all bars length 1' caught it.

**Rule:** When implementing numeric scaling/normalization code (charts, percentages, ratios, gradients), write tests for ALL of: empty input, single value, all-equal values, all-zero values, mixed-sign values, and extreme range. The all-equal case is the most commonly missed because synthetic test data tends to have variation. Treat all-equal as a deliberate special case (visual indicator-only bars), not as a math edge case to silently absorb.

**Applies in:** exec-phase (any visualization, normalization, or scoring code)

## P-FH-009 — Ratio/delta regression detectors must handle the zero-baseline case explicitly

**Evidence:** A drift oracle produced infinite/garbage ratios (and a companion regression oracle silently skipped signals) whenever the baseline value was zero. The fix made both-zero return a no-drift pass, zero-to-nonzero return a failing infinite ratio, and surfaced zero-baseline signals in the summary as re-baseline candidates instead of skipping them.

**Rule:** Drift and regression detectors that compare against a baseline via ratio or percentage break at a zero baseline: both-zero must map to 'no change' (ratio 1.0), and zero-to-nonzero must map to a real regression (infinite ratio / fire), not a division error or a silent skip. Signals whose baseline is still zero (never yet observed) must be surfaced as re-baseline candidates rather than silently dropped from the comparison, or newly-appearing regressions go unmonitored.

**Applies in:** ratio/percentage regression detectors; drift gates with a baseline
