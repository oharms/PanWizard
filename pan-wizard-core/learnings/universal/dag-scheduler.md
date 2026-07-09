---
topic: dag-scheduler
last_updated: 2026-05-03T03:29:27.025Z
patterns:
  - id: P-1206
    summary: Kahn's topological sort with concurrency cap + retry-then-skip-downstream is enough for a 200-line task runner; resume from a state file falls out for free
    promoted_at: 2026-05-02T15:26:05.473Z
    source_experiments: [whooflow]
  - id: P-NPRS-002
    summary: Pre-allocate cross-plan plumbing in the foundation plan so later parallel plans don't merge-conflict on shared files
    promoted_at: 2026-05-03T03:29:27.024Z
    source_experiments: [notepadrs]
---

# Dag Scheduler (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1206 — Kahn's topological sort with concurrency cap + retry-then-skip-downstream is enough for a 200-line task runner; resume from a state file falls out for free

**Evidence:** whooflow scheduler.js + executor.js + state.js: 54 commits, 5/5 phases. Phase 3 dogfood: kill-and-resume test against npm run build:hooks succeeded. Phase 02-04 complete with --list/--dry-run preflight + SIGINT discipline. The pure-vs-effectful split (mergeState pure, executor effectful) made the tests trivial.

**Rule:** For task graphs (dependencies, build pipelines, multi-step CI), use Kahn's algorithm with these wrinkles: 1) when a wave has >concurrency tasks, schedule first N; release a slot only when one finishes. 2) on task fail after all retries, mark downstream (BFS over depends_on graph) as skipped — don't retry. 3) persist task status atomically (P-1201) after each transition. 4) resume mode: read state, skip success, re-run failed tasks subject to remaining retries, run pending normally. Pure-functional mergeState + propagateSkip + active-children separates the math from the I/O so each is testable in isolation.

**Applies in:** task runners, build pipelines, ETL orchestrators, CI workflow tools

## P-NPRS-002 — Pre-allocate cross-plan plumbing in the foundation plan so later parallel plans don't merge-conflict on shared files

**Evidence:** notepadrs Plan 03-01 (foundation): pre-allocated 12 IDM constants, 8 accelerator entries, find_state, find_dlg_hwnd, find_epoch AtomicU64, find_tx/find_rx mpsc channel, find_pending — all owned by Wave-1 foundation plan. Plans 03-02/03-03/03-04/03-05 in Waves 2-4 each touch only their own subsystem files; no merge conflicts on app.rs across 4 parallel-eligible plans.

**Rule:** In a multi-plan phase where later plans modify the same shared file (a state struct, an enum of message IDs, a routing table), have the Wave-1 foundation plan PRE-ALLOCATE every cross-plan symbol — even if the value is a stub or zero. Subsequent plans then add only their own subsystem files plus implementation bodies, not signatures. Cost: foundation plan grows by ~10-30 lines of pre-allocated stubs. Payoff: the orchestrator can run later plans in parallel without merge-conflict gymnastics on the shared state file, and reviewers see a clean per-subsystem diff.

**Applies in:** any multi-plan phase touching a shared coordination file (message routing table, IDM/event ID enum, app-level state struct, registry of subsystems, menu definitions)
