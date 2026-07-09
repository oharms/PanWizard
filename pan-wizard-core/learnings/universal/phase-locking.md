---
topic: phase-locking
last_updated: 2026-05-02T17:52:25.816Z
patterns:
  - id: P-1208
    summary: Lock cross-cutting decisions (module system, error contract, exit codes) in Plan 01 of Phase 1; downstream plans IMPORT from those locked modules instead of re-deciding
    promoted_at: 2026-05-02T17:52:25.816Z
    source_experiments: [whooflow, whoocache]
---

# Phase Locking (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1208 — Lock cross-cutting decisions (module system, error contract, exit codes) in Plan 01 of Phase 1; downstream plans IMPORT from those locked modules instead of re-deciding

**Evidence:** whooflow Plan 01-01 summary: 'ESM lock-in committed in package.json — no later plan revisits the module system question. Node 18.17 floor encoded — first cross-cutting prerequisite from context.md is satisfied. Error -> exit-code contract (CLI-10) defined and tested; Plans 02-05 import from src/errors.js instead of redefining.' whoocache 02-composition: 'lock.js: no-op pass-through shim; signature locked for Phase 2 body swap.' Both shipped clean phases without cross-plan rework.

**Rule:** When breaking work into multi-plan phases, the FIRST plan should establish cross-cutting contracts that all later plans depend on: package.json type (CJS vs ESM), Node version floor, error class hierarchy, exit code map. Use a 'pass-through shim' for forward-locked APIs — write the function signature in Plan 01 returning a no-op or pass-through, swap the body in Plan N. This prevents cross-plan churn ('which error format does plan 03 use?') and means plans can be revised in isolation.

**Applies in:** multi-plan phases, multi-module CLIs, any work decomposable into a stable foundation + extensions
