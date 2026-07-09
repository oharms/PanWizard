---
phase: 03-resume-skip-downstream-dogfood
plan: 02
status: complete
completed: 2026-05-02
---

# Plan 03-02 Summary — propagateSkip BFS in src/skip.js

## What was built

`src/skip.js` exports `propagateSkip(failedId, flow, state, indegree, onEvent, nextSeq) -> number`. The function:
- Performs a BFS from `failedId` over `flow.children` (forward DAG edges).
- Marks each transitive **pending** descendant as `skipped` (via `markSkipped` from state.js) with `skip_reason = "upstream <failedId> failed"`.
- Decrements grandchildren's indegrees in the SAME loop iteration where a child is skipped (Pitfall C2 deadlock prevention).
- Emits one `{type:'task', id, status:'skipped', skip_reason, seq}` event per newly-skipped task via the supplied `onEvent` callback, with monotonic `seq` from `nextSeq()`.
- Returns the count of newly-skipped tasks so the caller can update `summary.skipped`.

## BFS algorithm

```
queue = [failedId]; visited = {failedId}
while queue not empty:
  parent = dequeue
  for child in flow.children[parent]:
    if child in visited: continue
    visited.add(child)
    if state.tasks[child].status != 'pending': continue   # diamond-convergence safety
    markSkipped(state, child, reason)
    onEvent({type:'task', id:child, status:'skipped', skip_reason, seq:nextSeq()})
    for grandchild in flow.children[child]:
      indegree[grandchild]--                              # C2 deadlock prevention
    enqueue(child)
return skippedCount
```

## Diamond-convergence safety

Tasks already in `success`, `failed`, or `skipped` status are NOT re-marked. The BFS terminates at non-pending nodes by NOT enqueuing them. A diamond convergence node reached via a non-failing path keeps its `success` state.

## M1 ordering guarantee (skip events fire AFTER parent's failed event)

`propagateSkip` is called from inside the `result.ok === false` branch of `runTaskWithRetry.then()` AFTER `markFailed + atomicWriteJson + onEvent({type:'task', status:'failed'})` have executed. Because `propagateSkip` runs synchronously within that `.then()` continuation and emits its events synchronously, JS microtask discipline guarantees the fail event precedes any skip events for the same parent. **No async reorder is possible.**

## Purity

- No `fs`, no `spawn`, no scheduler imports.
- Only imports `markSkipped` from `state.js`.
- Mutates `state.tasks` and `indegree` in place; emits via callback. No I/O.

## Tests

`test/skip.test.js` has 6 tests covering:
- Linear chain (A→B→C, A fails → B,C skipped).
- Diamond (A→{B,C}→D, A fails → B,C,D skipped exactly once each — D not double-emitted).
- C2 indegree decrement (B→D, X→D — A fails, B skipped, D's indegree decremented).
- Diamond convergence node already success → NOT re-marked.
- Independent branches unaffected (A→B fails, C→D continues).
- Monotonic seq + skip_reason references the failed parent.

All pass.

## Hand-off to Plan 04

Plan 04 will wire `propagateSkip` into:
1. `scheduler.js` failure branch (after `markFailed` + fail event in the `result.ok === false` continuation).
2. `scheduler.js` resume-startup loop (for tasks already in `failed` state on startup with no retries left — from `mergeState` terminal-failed branch).

## Commits

- `feat(03-02): add propagateSkip BFS in src/skip.js`
- `test(03-02): add skip.test.js with 6 unit tests`

## Self-Check: PASSED

- All 6 unit tests pass.
- No scheduler.js imports; no spawn; no fs.
