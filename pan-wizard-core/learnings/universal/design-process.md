---
topic: design-process
last_updated: 2026-04-27T09:48:51.193Z
patterns:
  - id: P-203
    summary: Document explicit Out-of-Scope cuts in DESIGN_SPEC so deviations become spec corrections, not anonymous bug fixes
    promoted_at: 2026-04-27T09:48:51.193Z
    source_experiments: [whooo]
---

# Design Process (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-203 — Document explicit Out-of-Scope cuts in DESIGN_SPEC so deviations become spec corrections, not anonymous bug fixes

**Evidence:** whooo trace.jsonl 11:32Z (decision major) plus 11:51Z (decision minor): block-list scope cut documented in DESIGN_SPEC explicitly. When dogfood revealed the cut was wrong, the deviation event self-documented as a spec correction with a clear reference back to the original cut. Inline source comment in lib/frontmatter.js also points to the trace event.

**Rule:** Feature specs and DESIGN_SPEC documents should include an explicit Out-of-Scope table listing what v1 deliberately omits. When dogfood reveals an omission was wrong, the deviation is recognized as a spec correction (with a clear pointer to the original cut) rather than a generic bug fix. Adopt the pattern in all feature specs and ADR templates.

**Applies in:** plan-phase (spec authoring), featureAI workflow, ADR-0026 template descendants
