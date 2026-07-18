---
topic: connection-pooling
last_updated: 2026-07-18T08:42:29.859Z
patterns:
  - id: P-FH-031
    summary: Budget connection pools across services sharing one database; diagnose ceilings empirically
    promoted_at: 2026-07-18T08:42:29.859Z
    source_experiments: [field-harvest-2026-07]
---

# Connection Pooling (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FH-031 — Budget connection pools across services sharing one database; diagnose ceilings empirically

**Evidence:** A load investigation ruled out CPU, locks, thread pool, and logging by measurement, then pinpointed the wall via live connection-stats probing: the front-end's default pool consumed the entire database connection budget, leaving no headroom for workers; the target was only met by horizontally scaling the front end behind a load balancer plus explicit per-service pool sizing.

**Rule:** When several services share one database, the sum of their per-service max connection-pool sizes must fit under the database's max_connections, or one service (often a high-concurrency front end) consumes the whole budget and starves the others — surfacing as errors and request queueing, not as CPU saturation. Diagnose a throughput ceiling empirically by measuring each candidate resource (CPU, locks, pool usage, queue depth) rather than guessing; the binding constraint is frequently connection-pool exhaustion while CPU sits mostly idle. A single instance of a horizontally-scaled service also has a lower per-instance ceiling than the aggregate target, so don't conclude the target is unreachable from a one-instance test.

**Applies in:** multiple services sharing one database
