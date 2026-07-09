---
topic: workaround-catalog
last_updated: 2026-07-09T14:04:40.519Z
patterns:
  - id: P-WKC-001
    summary: Catalog every env-var/toggle workaround (with schema) before its ticket closes — an uncatalogued flag that was in the ticket from day 1 cost a 5-day regression-to-fix gap because nobody tried it
    promoted_at: 2026-07-09T14:04:40.519Z
    source_experiments: [mph-factory-limits]
---

# Workaround Catalog (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-WKC-001 — Catalog every env-var/toggle workaround (with schema) before its ticket closes — an uncatalogued flag that was in the ticket from day 1 cost a 5-day regression-to-fix gap because nobody tried it

**Evidence:** An endurance-harness rule was written after a measured failure: a regression sat unfixed for 5 days although the resolving flag (a GC compaction env var) was named in the ticket from day one — it was uncatalogued, so no investigator tried it. The rule: every finding resolved by a runtime toggle/env overlay must be added to a structured overlay catalog before the ticket closes.

**Rule:** Any fix or mitigation that takes the form "set this flag / env var / toggle" must be recorded in a structured, searchable workaround catalog (name, effect, applicability, default) as a closing condition of the ticket itself. Institutional memory of overlays is part of the fix; an uncatalogued workaround will be re-discovered from scratch at day-rate cost.

**Applies in:** Ops runbooks, endurance findings, environment overlays, incident close-out checklists.
