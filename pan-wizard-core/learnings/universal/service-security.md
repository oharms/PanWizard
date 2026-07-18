---
topic: service-security
last_updated: 2026-07-18T08:42:29.857Z
patterns:
  - id: P-SVC-001
    summary: Reusable security spine for authenticated CRUD services: 404-not-403 on restricted reads, role-gate every mutation, atomic conditional writes instead of check-then-act, leaf-only filenames, capped request arrays, bounded untrusted parsing
    promoted_at: 2026-07-09T14:04:40.519Z
    source_experiments: [compliance-army-v1.1]
  - id: P-FH-016
    summary: Audit and actor identity must come from the authenticated session, not the request body
    promoted_at: 2026-07-18T08:42:29.855Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-026
    summary: Derive tenant scope from the credential, never from a request parameter
    promoted_at: 2026-07-18T08:42:29.857Z
    source_experiments: [field-harvest-2026-07]
---

# Service Security (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-SVC-001 — Reusable security spine for authenticated CRUD services: 404-not-403 on restricted reads, role-gate every mutation, atomic conditional writes instead of check-then-act, leaf-only filenames, capped request arrays, bounded untrusted parsing

**Evidence:** Two deep security reviews of a compliance platform converged on the same fix spine: return 404 (not 403) on restricted reads so existence does not leak; role-gate every mutating endpoint (a HIGH finding: any authenticated reader could attach immutable evidence because only RequireAuthorization was applied); make write-once/idempotency checks atomic via conditional headers (If-None-Match:*) instead of check-then-act; reduce user-supplied filenames to a bare leaf before pathing; cap bulk-import arrays (1,000 rows) against unbounded-insert DoS; bound untrusted document parsing against XXE and zip bombs.

**Rule:** For any authenticated CRUD/API service, apply the spine: (1) restricted reads return not-found, never forbidden; (2) every mutating endpoint has an explicit role/permission gate — authentication alone is not authorization; (3) uniqueness/write-once enforced atomically (conditional requests or DB constraints), never check-then-act; (4) user-supplied filenames reduced to a leaf name before any path join; (5) request arrays capped; (6) untrusted parsers bounded (entity expansion, decompression size).

**Applies in:** API security reviews, hardening passes, upload/import endpoints, WORM/audit stores.

## P-FH-016 — Audit and actor identity must come from the authenticated session, not the request body

**Evidence:** Several write routes stamped the acting-party identity from body-supplied values on endpoints lacking the session guard, allowing the recorded actor to be forged.

**Rule:** Fields that record who performed an action (actor, recorded_by, opened_by, maker) must be derived from the authenticated session context, never accepted from client-supplied request-body parameters. Trusting body-supplied identity lets a caller forge the audit trail. Wrap such write routes in the session guard and stamp identity from the session only; delete any request-body fallback for these fields.

**Applies in:** multi-tenant services; audit trails; authorization

## P-FH-026 — Derive tenant scope from the credential, never from a request parameter

**Evidence:** A newly exposed programmatic interface tied one credential to exactly one tenant and never accepted tenant as an argument, making cross-tenant requests structurally impossible; a tenant-isolation test asserted no existence leak across tenants.

**Rule:** In a multi-tenant service, bind the tenant to the authenticated credential/claim and never accept a tenant identifier as a caller-supplied request or tool parameter. If the tenant is a parameter, a valid credential for tenant A can be pointed at tenant B (confused-deputy / cross-tenant access). Making tenant un-passable makes cross-tenant access unrepresentable, and existence-leak tests (A's key asking for B's object returns not-found) confirm it.

**Applies in:** multi-tenant services; audit trails; authorization
