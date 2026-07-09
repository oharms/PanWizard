---
topic: migration-safety
last_updated: 2026-07-09T14:04:40.516Z
patterns:
  - id: P-MIG-001
    summary: Never let unattended startup auto-migrate run destructive or irreversible DDL — a partial apply half-marks migration history and crash-loops the service; gate schema swaps behind a manual, backed-up apply with restore proven on a copy
    promoted_at: 2026-07-09T14:04:40.516Z
    source_experiments: [compliance-army-v1.1]
---

# Migration Safety (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-MIG-001 — Never let unattended startup auto-migrate run destructive or irreversible DDL — a partial apply half-marks migration history and crash-loops the service; gate schema swaps behind a manual, backed-up apply with restore proven on a copy

**Evidence:** A compliance-platform mission was declared NO-GO on a big-bang schema swap because the service ran MigrateAsync() unattended at startup: a destructive DROP TABLE would auto-apply on the next deploy, and a partial apply would leave the migrations-history table half-marked with the API crash-looping. A related landmine: inserting through an updatable filtered view left the type discriminator NULL (NOT NULL violation) — the safe design was an additive discriminator column, not a view.

**Rule:** Unattended auto-migration may only ever apply additive, reversible changes. Destructive or irreversible DDL requires: a manual off-peak apply, a taken-and-TESTED backup (restore proven on a copy first), and an explicit rollback path. Prefer additive discriminator columns over updatable views for type splits — INSERT through a filtered view does not populate the discriminator. Record NO-GO decisions durably so the next campaign does not re-litigate them.

**Applies in:** Database migrations, deploy pipelines, EF/ORM startup hooks, brownfield schema evolution.
