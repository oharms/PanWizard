---
topic: idempotency
last_updated: 2026-05-03T06:32:22.183Z
patterns:
  - id: P-IDEM-001
    summary: Make resumable operations safe to retry by combining a deterministic action key, a check-before-do guard, and atomic state transitions — not retry counters
    promoted_at: 2026-05-03T06:32:22.183Z
    source_experiments: [external]
---

# Idempotency (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-IDEM-001 — Make resumable operations safe to retry by combining a deterministic action key, a check-before-do guard, and atomic state transitions — not retry counters

**Evidence:** External research synthesis: AWS API design guidance (idempotency tokens), Google Cloud client-spec (request IDs), Stripe API (Idempotency-Key header), the database literature on exactly-once semantics. PAN's own dag-scheduler P-1206 retry-then-skip-downstream rule depends on tasks being retry-safe but never explains how to make them so. Real failure modes observed: a runner that re-creates a 'created_at' timestamp on retry breaks ordering; a CLI that re-pushes a commit on retry creates a divergent ref; an installer that re-copies on retry overwrites user edits if the destination has changed since the first attempt.

**Rule:** For any operation that may run more than once (resumable pipeline, retry loop, dropped-network replay, user-triggered re-run): (1) compute a STABLE action key from the inputs (e.g. sha256 of the args), not from a timestamp or counter; (2) before executing, check whether the destination already reflects this exact action (file present with same hash, row present with same key, ref pointing where we want); (3) make the state transition atomically (write-tmp-then-rename per P-1201; INSERT … ON CONFLICT for SQL; CAS for in-memory); (4) on success record the action key so future retries short-circuit. Never use 'retry counter == N → skip' as your safety net — the counter resets on process restart but the side effect persists. Idempotency is a property of the OPERATION, not of a wrapper around it.

**Applies in:** resumable installers, sync/upload jobs, replicated writes, message-queue consumers, retry middleware, CI rerun handling, any operation that crosses a network or process boundary and may be replayed
