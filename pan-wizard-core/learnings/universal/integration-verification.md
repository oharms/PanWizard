---
topic: integration-verification
last_updated: 2026-07-09T14:04:40.514Z
patterns:
  - id: P-INT-001
    summary: Intra-phase PASS is not integration: milestone/closure audits must verify cross-phase seams (registration, callers, non-stub bodies) and end-to-end flows, not per-phase checklists
    promoted_at: 2026-07-09T14:04:40.514Z
    source_experiments: [platform-v2-milestone-audit]
  - id: P-INT-002
    summary: Derived closure artifacts (traceability/coverage matrices) must be regenerated at close — a matrix generated in phase N silently contradicts what phase N+1 delivered
    promoted_at: 2026-07-09T14:04:40.514Z
    source_experiments: [platform-v2-milestone-audit]
---

# Integration Verification (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-INT-001 — Intra-phase PASS is not integration: milestone/closure audits must verify cross-phase seams (registration, callers, non-stub bodies) and end-to-end flows, not per-phase checklists

**Evidence:** A v2.0 milestone audit of a multi-phase platform found every phase had passed its own verification, yet five cross-phase seams were broken: a DI extension method was never called in the composition root; a decrypt endpoint unconditionally returned an error; four of five operator reconcilers were stubs that "gracefully skipped" their work; a feature gate was never registered so its compliance assertion could never fire. Component-local checks proved existence, not integration.

**Rule:** At milestone close, audit the seams: for every cross-phase contract verify (1) the provider is actually registered/wired into the running host, (2) at least one real caller exercises it, (3) the body is substantive, not a stub that skips gracefully, and (4) a representative end-to-end flow crosses the seam. A milestone is not done because each phase passed alone.

**Applies in:** Milestone audits, closure gates, goal-backward verification (key_links), multi-phase plans.

## P-INT-002 — Derived closure artifacts (traceability/coverage matrices) must be regenerated at close — a matrix generated in phase N silently contradicts what phase N+1 delivered

**Evidence:** The same milestone audit found the closure traceability matrix internally inconsistent: it was generated during phase 10 and never regenerated after phase 11 delivered items, so shipped requirements were still marked delivered:false. Any gate reading the matrix would have failed on stale data; any human reading it was misinformed.

**Rule:** Treat generated audit artifacts (traceability matrices, coverage reports, requirement rollups) as derived views that MUST be re-derived at closure time, after the last change. Never gate or report from a matrix older than the work it describes; regenerate via the same script that produced it.

**Applies in:** Closure gates, traceability matrices, requirement coverage reports, release audits.
