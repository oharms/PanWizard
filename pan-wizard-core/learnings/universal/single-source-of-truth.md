---
topic: single-source-of-truth
last_updated: 2026-07-18T08:42:29.858Z
patterns:
  - id: P-SSOT-001
    summary: When two code paths must agree on a classification, delegate both to one predicate — parallel lists diverge silently; also never pre-write a terminal status before the retry ladder runs, and never label a metric with an action that does not happen
    promoted_at: 2026-07-09T14:04:40.514Z
    source_experiments: [dispatch-postmortem]
  - id: P-SSOT-002
    summary: After changing a source of truth, re-sync every parallel copy of it — and pin the seam with a golden-reproduction end-to-end test, because per-component suites will not catch the second copy
    promoted_at: 2026-07-09T14:04:40.515Z
    source_experiments: [forecasting-campaign]
  - id: P-FH-027
    summary: Expose a second interface through the same core, not a re-implementation
    promoted_at: 2026-07-18T08:42:29.858Z
    source_experiments: [field-harvest-2026-07]
---

# Single Source Of Truth (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-SSOT-001 — When two code paths must agree on a classification, delegate both to one predicate — parallel lists diverge silently; also never pre-write a terminal status before the retry ladder runs, and never label a metric with an action that does not happen

**Evidence:** A message-dispatch postmortem in an event-driven .NET service found three stacked bugs behind silent message loss: a stage returned Success on a transient failure so nothing redelivered; a terminal status was pre-written, blocking any retry; and the redelivery filter's exception list had diverged from the exception classifier. The fix collapsed the parallel lists to a single source of truth — the retry policy delegates to the same IsTransient classifier — "so the redelivery filters can never again diverge from the classifier". A metric labelled "retry" was recording outcomes the system silently terminated.

**Rule:** If two code paths must agree on a category (is-transient, is-retriable, is-sensitive), implement the judgment ONCE and delegate both paths to it — never maintain parallel lists that must be kept in sync by discipline. Do not pre-write terminal status before the retry ladder has actually run. A metric or log label must describe what the system did, not what it was supposed to do.

**Applies in:** Retry/redelivery policies, classification predicates, status ledgers, observability labels.

## P-SSOT-002 — After changing a source of truth, re-sync every parallel copy of it — and pin the seam with a golden-reproduction end-to-end test, because per-component suites will not catch the second copy

**Evidence:** After an engine re-calibration updated golden values, the web UI's default inputs/segments stayed on the old seed: the deployed default scenario ran ~90% below golden and no suite failed, because engine tests checked the engine and UI tests checked the UI — nothing reproduced the golden case through both. The campaign post-mortem recorded the durable rule: after any engine re-calibration, re-sync the UI defaults (a parallel copy of the truth) and keep a golden-reproduction end-to-end test as the load-bearing check.

**Rule:** Inventory every place a source-of-truth value is duplicated (UI defaults, fixtures, docs, seeds). When the truth changes, re-sync all copies in the same change — and protect the seam permanently with one end-to-end test that reproduces the golden case through every layer, since per-layer suites cannot see a stale sibling copy.

**Applies in:** Golden values, calibration constants, default configs duplicated across layers, cross-repo copies.

## P-FH-027 — Expose a second interface through the same core, not a re-implementation

**Evidence:** A new protocol's handlers were made to call the exact same service cores and the exact same output-masking mapper the existing REST endpoints used; the REST endpoints were refactored into thin shims so behavior could not diverge between the two surfaces.

**Rule:** When adding a second surface (new protocol, CLI, batch path) over existing functionality, extract the existing logic into a shared core and have both surfaces call it, rather than re-implementing the flow behind the new surface. Auth, validation, tenant isolation, and output masking are then inherited identically and cannot drift; the original surface becomes a thin wire-shim over the same core. Re-implementing PII masking or auth per surface is the classic source of a leak on one path but not the other.

**Applies in:** adding a second interface (protocol/CLI/batch) over existing logic
