---
topic: io-patterns
last_updated: 2026-04-27T10:15:00.878Z
patterns:
  - id: P-401
    summary: Synchronous stdin via fs.readFileSync(0) is the cleanest CLI pattern
    promoted_at: 2026-04-27T10:15:00.877Z
    source_experiments: [whoosort]
---

# Io Patterns (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-401 — Synchronous stdin via fs.readFileSync(0) is the cleanest CLI pattern

**Evidence:** whoosort sess_20260427T130000 11:06Z decision: sync matches CLI shape, eliminates buffering bugs, plays well with spawnSync({input}) for tests. Async stdin only justified for streaming gigabytes.

**Rule:** When building a CLI that reads stdin, prefer fs.readFileSync(0, 'utf-8') over async stream consumption unless you actually need to process unbounded input. Sync I/O matches the shape of node-test spawnSync({input}), avoids buffering bugs, and keeps the CLI synchronous-by-default which simplifies error handling.

**Applies in:** exec-phase (CLI implementation), test-strategy (subprocess testing of stdin-driven tools)
