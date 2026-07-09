---
topic: flaky-triage
last_updated: 2026-07-09T14:04:40.517Z
patterns:
  - id: P-FLK-001
    summary: A failure under contended/parallel load that passes N isolated re-runs is environmental, not a regression — triage with isolated re-runs and decompose aggregate counts into disabled/timeout/genuinely-failed before reacting
    promoted_at: 2026-07-09T14:04:40.516Z
    source_experiments: [montyhall-cycle-close]
  - id: P-FLK-002
    summary: Non-deterministic verdicts (perf, endurance, memory) need windowed statistics — widen the analysis window rather than biasing the sampler, and require 2-of-3 reproduction before a finding becomes a ticket
    promoted_at: 2026-07-09T14:04:40.517Z
    source_experiments: [mph-factory-limits]
---

# Flaky Triage (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FLK-001 — A failure under contended/parallel load that passes N isolated re-runs is environmental, not a regression — triage with isolated re-runs and decompose aggregate counts into disabled/timeout/genuinely-failed before reacting

**Evidence:** A cycle-close investigation of "8 failed" concurrent GC tests ran the suspects isolated: pass/fail/pass, then 5/5 PASS — deterministically green alone, failing only under concurrent test-runner load. The aggregate count was also misleading: it mixed ~100 disabled tests and load-induced timeouts with only two genuine (and flaky) failures. Fixing "the regression" mid-sweep would have burned a cycle on an environmental artifact.

**Rule:** Before treating a red test as a regression: (1) re-run it isolated 3-5 times; deterministic pass in isolation + failure only under load = environmental, log it to a known-red list instead of fixing mid-sweep; (2) decompose aggregate failure counts into disabled / timed-out / genuinely-failed — never react to the headline number; (3) record the triage so the next sweep does not re-investigate.

**Applies in:** CI triage, autonomous fix loops, test-gate policies, cycle-close retrospectives.

## P-FLK-002 — Non-deterministic verdicts (perf, endurance, memory) need windowed statistics — widen the analysis window rather than biasing the sampler, and require 2-of-3 reproduction before a finding becomes a ticket

**Evidence:** An endurance/limits harness codified: "If you find yourself wanting to wait for the system to settle before sampling, the right answer is to widen the analysis window, not to bias the sampler." Marathon failures must reproduce in 2 of 3 independent re-runs before becoming a ticket; singletons accumulate in a watch bucket that auto-promotes only after repeated appearances.

**Rule:** For perf/endurance/resource checks: never pass or fail on a single sample — use windowed signals (slopes with confidence intervals, percentiles over a window). Never bias sampling to make results stable; widen the window instead. Gate findings on independent reproduction (2-of-3); park singletons in a watch bucket that promotes on recurrence rather than discarding them.

**Applies in:** Perf gates, endurance harnesses, memory-leak detection, any statistically noisy verification.
