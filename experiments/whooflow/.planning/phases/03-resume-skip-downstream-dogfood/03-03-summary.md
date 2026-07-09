---
phase: 03-resume-skip-downstream-dogfood
plan: 03
status: complete
completed: 2026-05-02
---

# Plan 03-03 Summary — executor active-children tracking + abort signal

## What was built

`src/executor.js` now has:
1. **Module-level `activeChildren` Set** — every spawned `ChildProcess` is added immediately after `spawn()` returns and removed inside the `'close'` / `'error'` handlers (the same callbacks that resolve the `runTask` Promise). Set, not array, so duplicate-add is impossible.
2. **`getActiveChildren()` export** — returns a snapshot `Array<ChildProcess>` (copy of the set) so callers can iterate without mutation hazards. Used by Plan 04's SIGINT drain.
3. **`killActiveChildren(signal='SIGTERM')` export** — best-effort iteration calling `child.kill(signal)`. Wrapped in try/catch — a child that has already exited but hasn't been removed from the set yet is harmless (kill on a dead pid is a no-op).
4. **`opts.signal` AbortSignal handling** — `runTask(task, opts)` now accepts `opts.signal`. If the signal aborts mid-run (or is already aborted at call time), the live spawned child is killed via `child.kill('SIGTERM')`. The `'close'` handler still resolves the promise with `ok:false / exit_code:-1`.

## Public contract preservation

The `runTask(task, opts)` contract is **unchanged**:
- Same return shape: `Promise<{ok, exit_code, signal, error?}>`.
- Same `'close'`-event resolution discipline (Pitfall C3 — never `'exit'`).
- Same `shell: true / stdio: 'inherit' / windowsHide: true`.
- Always resolves; never rejects.

## Active-children tracking pattern

```js
const child = spawn(task.cmd, {...});
activeChildren.add(child);
// 'close' handler:
//   activeChildren.delete(child); cleanupListeners(); resolve({...});
// 'error' handler (setImmediate fallback):
//   activeChildren.delete(child); cleanupListeners(); resolve({error});
```

## opts.signal handling

- If `opts.signal.aborted === true` at call time: kill immediately, no listener registered.
- Otherwise: register an `addEventListener('abort', killer, { once: true })`; pair with `removeEventListener` in `cleanupListeners()` so listener counts never grow past the active-children count (bounded by `--concurrency`).

## Cross-platform note

On **Windows**, `child.kill('SIGTERM')` translates to `TerminateProcess` (immediate). On **POSIX**, the child receives SIGTERM and may handle it before exit. Either way, `'close'` fires and `runTask` resolves. Tests don't assert on the exact `result.signal` value because Windows often reports null where POSIX reports `'SIGTERM'`.

## Tests

`test/executor.test.js` has 4 new tests (existing 5 unchanged):
- `getActiveChildren` reflects in-flight children and drains on close.
- `killActiveChildren('SIGTERM')` kills in-flight children → `runTask` resolves with `ok:false / exit_code:-1`.
- `opts.signal` abort mid-run kills the child.
- `opts.signal` already-aborted at call time kills the child before close.

All pass on Windows.

## Hand-off to Plan 04

Plan 04's `cli.js` SIGINT/SIGTERM handler will:
1. Call `abortController.abort()` — drains pending retry sleeps via `retry.js` opts.signal.
2. Call `killActiveChildren('SIGTERM')` — drains live spawned children.
3. Schedule `setTimeout(() => killActiveChildren('SIGKILL'), 5000).unref()` — SIGKILL fallback.
4. The `runFlow` promise settles naturally as each killed `runTask` resolves with `ok:false`. `main()` then writes final state and returns.

No explicit `process.exit()` — process exits naturally via `process.exitCode = 130|1`.

## Commits

- `feat(03-03): add active-children tracking + opts.signal to executor`
- `test(03-03): add 4 executor tests for tracking + kill semantics`

## Self-Check: PASSED

- All 4 new + 5 existing executor tests pass on Windows.
- `runTask` public contract unchanged — `retry.js` and `scheduler.js` continue to work without modification.
