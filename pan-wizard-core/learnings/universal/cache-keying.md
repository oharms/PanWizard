---
topic: cache-keying
last_updated: 2026-07-18T08:42:29.852Z
patterns:
  - id: P-FH-011
    summary: Cache entries must be keyed by every input that determines the value
    promoted_at: 2026-07-18T08:42:29.852Z
    source_experiments: [field-harvest-2026-07]
---

# Cache Keying (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FH-011 — Cache entries must be keyed by every input that determines the value

**Evidence:** A process-global 'current date' cache selected its TTL from the active environment but overwrote a single unkeyed slot; it was correct only while one process served one configuration and would serve a value from the wrong configuration under multi-tenant reuse.

**Rule:** A memoization or cache held at module/singleton scope must be keyed by all inputs that affect the cached value (tenant, environment, configuration identity), not merely gated by a time-to-live. A time-only cache silently returns a value computed for one configuration to a request running under a different configuration whenever a single process ever serves mixed configurations. Either key the cache by a composite of the value-determining inputs, or explicitly document and enforce a single-configuration-per-process constraint so the latent hazard cannot surface later.

**Applies in:** module/singleton caches; processes that may serve mixed tenants/configs
