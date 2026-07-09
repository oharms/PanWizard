---
phase: 03-resume-skip-downstream-dogfood
plan: 01
status: complete
completed: 2026-05-02
---

# Plan 03-01 Summary — Pure mergeState in src/resume.js

## What was built

`src/resume.js` exports a single pure function `mergeState(flow, oldState) -> newState`. The function:
- Takes the validated flow (from `src/validator.js`) and the prior state file's parsed contents.
- Returns a new state object identical in shape to `buildInitialState`'s output, ready to feed into `runFlow()`.
- Has zero I/O: no `fs`, no `Date.now()`, no `process.*`, no scheduler imports. Only `RuntimeError` from `errors.js`.

## STATE-04 merge rules table

| oldState.tasks[id].status | New status (in returned state) | Attempts handling |
|---------------------------|-------------------------------|-------------------|
| `success`                 | `success` (preserved)         | preserved         |
| `failed` + retries remaining (`attemptsAllowed > attemptsUsed`) | `pending` | preserved (carries over to next run) |
| `failed` + no retries left | `failed` (terminal — left for startup BFS) | preserved |
| `running` (interrupted)   | `pending` (Pitfall C5: partial run counts as one attempt) | preserved |
| `skipped`                 | `pending` (re-evaluate on this run) | preserved |
| `pending`                 | `pending` (normalized shape, transient fields cleared) | preserved |
| (id absent from oldState; present in flow.tasks) | `pending` (fresh) | 0 |
| (id present in oldState; absent from flow.tasks) | **throws RuntimeError** | — |

## Why mergeState is pure

STATE-05 says "scheduler stays oblivious to fresh-vs-resume mode." By isolating the merge into a pure function with zero scheduler imports, the guarantee is **structural** rather than policy:
- `mergeState` cannot trigger I/O.
- `runFlow` consumes both `buildInitialState`'s output and `mergeState`'s output identically (same shape).
- No "resume mode" flag exists anywhere.

## retriesRemaining calculation

```js
const attemptsAllowed = flow.tasks[id].retry?.attempts ?? 1;
const attemptsUsed = oldState.tasks[id].attempts ?? 0;
const retriesRemaining = attemptsAllowed - attemptsUsed;
```

If `retriesRemaining > 0` → reset to pending. If `<= 0` → terminal failed (downstream-skip BFS fires on startup in Plan 04).

## Drift check (clear error vs silent drop)

Tasks referenced by `oldState` but absent from `flow.tasks` throw a `RuntimeError`:
> `state references unknown task: <id>. Was flow.json edited after the previous run?`

This surfaces a real user error (edited flow.json between runs) rather than silently dropping work.

## New-task-added branch

Tasks newly added to the flow since the prior run are initialized as fresh `pending` (attempts=0, all timestamps null). This means mid-flow edits between runs are tolerated for **added** tasks; **removed** tasks are NOT (they error).

## Tests

`test/resume.test.js` has 11 tests covering: success preservation, failed-with-retries-reset, failed-no-retries-terminal, default-attempts-no-retry, running (C5), skipped reset, pending stays pending, unknown-task error, new-task-added, top-level field preservation, no-mutation purity. All pass.

## Hand-off to Plan 04

Plan 04 will:
- Import and call `mergeState` in `cli.js` when `--resume` is set.
- Pass the merged state to `runFlow`.
- The scheduler's seed loop will pre-decrement indegrees for tasks with `status='success'` — that's how resume "works" without any explicit mode flag.

## Commits

- `feat(03-01): add pure mergeState in src/resume.js`
- `test(03-01): add resume.test.js with 11 unit tests`

## Self-Check: PASSED

- All 11 unit tests pass.
- Full suite at 126 tests (105 baseline + 21 new from Wave 1).
- No regressions.
