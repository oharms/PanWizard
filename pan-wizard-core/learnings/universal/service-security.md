---
topic: service-security
last_updated: 2026-07-09T14:04:40.519Z
patterns:
  - id: P-SVC-001
    summary: Reusable security spine for authenticated CRUD services: 404-not-403 on restricted reads, role-gate every mutation, atomic conditional writes instead of check-then-act, leaf-only filenames, capped request arrays, bounded untrusted parsing
    promoted_at: 2026-07-09T14:04:40.519Z
    source_experiments: [compliance-army-v1.1]
---

# Service Security (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-SVC-001 — Reusable security spine for authenticated CRUD services: 404-not-403 on restricted reads, role-gate every mutation, atomic conditional writes instead of check-then-act, leaf-only filenames, capped request arrays, bounded untrusted parsing

**Evidence:** Two deep security reviews of a compliance platform converged on the same fix spine: return 404 (not 403) on restricted reads so existence does not leak; role-gate every mutating endpoint (a HIGH finding: any authenticated reader could attach immutable evidence because only RequireAuthorization was applied); make write-once/idempotency checks atomic via conditional headers (If-None-Match:*) instead of check-then-act; reduce user-supplied filenames to a bare leaf before pathing; cap bulk-import arrays (1,000 rows) against unbounded-insert DoS; bound untrusted document parsing against XXE and zip bombs.

**Rule:** For any authenticated CRUD/API service, apply the spine: (1) restricted reads return not-found, never forbidden; (2) every mutating endpoint has an explicit role/permission gate — authentication alone is not authorization; (3) uniqueness/write-once enforced atomically (conditional requests or DB constraints), never check-then-act; (4) user-supplied filenames reduced to a leaf name before any path join; (5) request arrays capped; (6) untrusted parsers bounded (entity expansion, decompression size).

**Applies in:** API security reviews, hardening passes, upload/import endpoints, WORM/audit stores.
