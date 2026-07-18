---
topic: concurrency
last_updated: 2026-05-03T03:29:41.164Z
patterns:
  - id: P-1204
    summary: O_EXCL lockfile + retry with bounded backoff is enough for multi-process file writes in Node — no flock needed
    promoted_at: 2026-05-02T15:25:45.482Z
    source_experiments: [whoocache]
  - id: P-NPRS-003
    summary: Worker thread + atomic epoch counter for cancellable slow operations: spawn worker tagged with current epoch; main thread bumps epoch on user action; worker checks epoch and discards stale results silently
    promoted_at: 2026-05-03T03:29:41.163Z
    source_experiments: [notepadrs]
---

# Concurrency (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1204 — O_EXCL lockfile + retry with bounded backoff is enough for multi-process file writes in Node — no flock needed

**Evidence:** whoocache lock.js + atomic-write.js: parallel-process tests with two child processes each calling set() 1000 times completed with consistent index, zero lost writes. P-1402 (whoocache 02-02 summary): 'O_EXCL lockfile + Windows rename retry' shipped Phase 2.

**Rule:** For multi-process safe writes (parallel CLI invocations sharing one cache/index/state file), use fs.openSync(lockPath, 'wx') as a 'try-acquire' (EEXIST means held). On failure, retry with random backoff 5-50ms, capped at ~10 attempts. Always wrap acquired work in try/finally and unlink the lockfile in finally. Cross-platform safe (no flock dependency). Combine with the atomic write-tmp-then-rename pattern (P-1201) so even if the lock holder is killed mid-write, recovery is automatic.

**Applies in:** shared cache/state files accessed by parallel CLI invocations, daemons

## P-NPRS-003 — Worker thread + atomic epoch counter for cancellable slow operations: spawn worker tagged with current epoch; main thread bumps epoch on user action; worker checks epoch and discards stale results silently

**Evidence:** notepadrs Plan 03-05: find/replace on >1MB buffers spawned a worker thread carrying an Arc<AtomicU64> epoch. Main thread bumped find_epoch on tab-switch / dialog-close / edit / restart. Worker posted WM_APP_FIND_RESULT only if its tagged epoch still matched current. 8 epoch-discipline integration tests verified silent-stale behavior. Closure-injected wakeup<F: Fn(u64)> kept the spawn function pure-testable (4 real-spawn tests).

**Rule:** When a slow operation (search, fetch, compile, render) may be invalidated mid-flight by a faster user action, pass an Arc<AtomicU64> epoch into the worker; the worker reads the epoch at start AND at result-post time, and discards its result silently if the epoch advanced. The main thread cancels by bumping the epoch — it does NOT join the worker, does NOT use a kill flag, does NOT use channels for cancellation. Cost: one Arc<AtomicU64> per cancellation domain, two atomic loads per worker. Payoff: zero-copy cancellation; no per-cancel-source plumbing; new cancel sources are added by adding a single fetch_add(1) call.

**Applies in:** find/search workers, async fetches that may be superseded, autocomplete/suggest backends, syntax-highlight workers, file-tree expanders, any operation where 'a newer version exists' silently invalidates an in-flight result
