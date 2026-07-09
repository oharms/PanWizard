# Phase 3: Resume + Skip-Downstream + Dogfood — Research

**Researched:** 2026-05-02
**Domain:** Node.js DAG runner — resume semantics, BFS skip propagation, SIGINT drain, dogfood flow
**Confidence:** HIGH (codebase directly inspected; all prior project-level research confirmed against current src/)

---

## Summary

Phase 2 left the scheduler without two critical behaviors: (1) a `failed` task leaves its
downstream children permanently stuck in `pending` (scheduler never sees them again — no
skip BFS), and (2) the SIGINT handler records exit-code intent but does not drain running
children or persist the final in-progress state. Phase 3 closes both gaps and adds resume
as a pure pre-scheduler merge step.

The good news from reading the code: the Phase 2 architecture was explicitly built to make
Phase 3 cheap. `src/scheduler.js` has a `// Phase 3 will replace this with a BFS
skip-downstream propagation` comment at the exact insertion point. `src/retry.js` already
scaffolds `opts.signal` for abort propagation. `src/cli.js` already has a `// Phase 3 will
add the SIGTERM-then-SIGKILL drain protocol` comment in the SIGINT handler.

**Primary recommendation:** Implement Phase 3 as exactly three focused new modules
(`src/resume.js`, `src/skip.js`, signal drain inline in `cli.js`) and one new fixture file
(`flow.json`), then wire them in at the two already-marked insertion points in `scheduler.js`
and `cli.js`. Total new LOC estimate: ~120 across all three modules.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-03 | `--resume` flag to continue from `whooflow.state.json` | `mergeState()` pure function between validator and scheduler; CLI wires `--resume` boolean to pass old state into merge |
| SCHED-06 | BFS skip propagation on terminal failure; independent branches continue | `propagateSkip()` in `src/skip.js`; inserted at the `// Phase 3` comment in `scheduler.js` failure branch |
| STATE-04 | Resume merge rules: success→skip, failed-with-retries→pending, running→pending (preserve attempts), failed-no-retries→leave for skip, unknown task ids→clear error | Encapsulated in `src/resume.js` `mergeState()` |
| STATE-05 | Resume is a pure pre-scheduler merge step; scheduler stays oblivious to fresh-vs-resume | `mergeState(flow, oldState)` called in `cli.js` after `validateFlow`, before `buildInitialState`/`runFlow` |
| DOG-01 | ≥12 tests: linear, diamond, cycle, parallel, retry-success, retry-fail, skip-downstream, resume-from-success, resume-from-failed, resume-from-running, concurrency cap, missing-dep, malformed JSON | Covered by adding `resume.test.js` + `skip.test.js` on top of existing suite |
| DOG-02 | Real `flow.json` running `npm test` + `npm run build:hooks` in parallel + follow-up count step | New `flow.json` at repo root; `npm run build:hooks` does not exist in package.json yet — must add a stub or use an equivalent |
| DOG-03 | Kill-and-resume scenario: kill mid-task, `--resume`, verify re-run (not skip) and final state matches non-killed run | Integration test using `spawn` with kill signal + re-run |

</phase_requirements>

---

## Critical Pre-Planning Finding: `build:hooks` Script

The dogfood requirement (DOG-02) calls for `npm run build:hooks`. Reading `package.json`,
the project currently has only `"test": "node --test \"test/**/*.test.js\""`. There is no
`build:hooks` script.

**Resolution:** Add a portable `build:hooks` stub script to `package.json` as part of this
phase. The stub should be a no-op or a simple `node -e "console.log('build:hooks ok')"`.
This keeps the dogfood realistic without requiring an actual build pipeline. It must work
cross-platform (no `sh -c`, no `echo` — use `node -e`).

---

## Implementation Approach for `mergeState()`

### Location: `src/resume.js` (new file)

`mergeState(flow, oldState)` is a pure function — no disk I/O, no side effects. It returns
a new state object ready to pass to `runFlow`. The scheduler then seeds its indegree/ready
queue from this merged state exactly as it would from a fresh `buildInitialState` result.

### Merge Logic (maps to STATE-04)

```
for each task id in flow.tasks:
  if id not in oldState.tasks:
    → pendingTask(id)                    // new task added to flow since last run
  elif oldState.tasks[id].status === 'success':
    → keep as success; MARK as "pre-done" so scheduler pre-decrements indegrees
  elif oldState.tasks[id].status === 'failed' AND retriesRemaining > 0:
    → reset to pending; preserve attempts counter
  elif oldState.tasks[id].status === 'failed' AND retriesRemaining === 0:
    → leave as failed; skip-downstream BFS will fire from it on scheduler startup
  elif oldState.tasks[id].status === 'running':
    → reset to pending; preserve attempts (partial run counted as attempt)
    → CLEAR started_at, ended_at, exit_code
  elif oldState.tasks[id].status === 'pending':
    → leave as pending
  elif oldState.tasks[id].status === 'skipped':
    → reset to pending (re-evaluate once parent state is resolved)

for each task id in oldState.tasks NOT in flow.tasks:
  → throw clear error: "state references unknown task: <id>. Was flow.json edited?"
```

### `retriesRemaining` calculation

`task.retry.attempts - oldState.tasks[id].attempts`. If this is `> 0`, retries remain.

### `pending` shape for reset tasks

Preserve `attempts` count. Clear `started_at`, `ended_at`, `exit_code`, `signal`,
`skip_reason`. Status = `'pending'`.

### Scheduler seeding from merged state

The scheduler's existing seeding loop (lines 57-61 in `scheduler.js`) already does:
```js
for (const id of flow.topoOrder) {
  if (indegree[id] === 0) ready.push(id);
}
```
This needs to change for resume: tasks with `status === 'success'` must have their
**children's indegrees pre-decremented** before the ready-queue is seeded. This is the
mechanism that makes the scheduler skip already-successful tasks — their children become
ready immediately because the debt is already paid.

The architecture.md Pattern 5 sketch already shows this pattern:
```js
for (const id of Object.keys(indegree)) {
  if (state.tasks[id].status === 'success') {
    for (const c of children[id]) indegree[c]--;
  } else if (indegree[id] === 0) {
    ready.push(id);
  }
}
```

This logic is **not** in `mergeState` — it belongs in `scheduler.js` seeding, which already
handles `state`. The change to `scheduler.js` is minimal: replace the current simple seed
loop with the version that also pre-decrements for success tasks.

### Terminal-failed tasks on startup (resume)

Tasks in `failed` state with no retries remaining are left as `failed` in the merged state.
When the scheduler seeds its ready queue, it should also call `propagateSkip` for any task
that is already in `failed` state — this fires the BFS immediately on startup, marking
downstream tasks as `skipped` and pre-decrementing their children's indegrees. This prevents
the deadlock where failed-task children are stuck in `pending` with non-zero indegree.

---

## Skip-Downstream BFS Algorithm Details

### Location: `src/skip.js` (new file, ~40 LOC)

```js
export function propagateSkip(failedId, flow, state, indegree, onEvent, nextSeq) {
  const queue = [failedId];
  const visited = new Set([failedId]);
  while (queue.length) {
    const parent = queue.shift();
    for (const child of flow.children[parent]) {
      if (visited.has(child)) continue;
      visited.add(child);
      if (state.tasks[child].status === 'pending') {
        markSkipped(state, child, `upstream ${failedId} failed`);
        // Emit skip event AFTER the parent fail event has already been emitted
        // (pitfall M1: skip events must follow the terminal fail event).
        onEvent({ type: 'task', id: child, status: 'skipped',
                  skip_reason: `upstream ${failedId} failed`, seq: nextSeq() });
        // Drop this skipped task's indegree claim on its own children (pitfall C2).
        for (const grandchild of flow.children[child]) {
          indegree[grandchild]--;
        }
        queue.push(child);
      }
      // If child is already success/failed/skipped, do NOT re-mark. Diamond convergence.
    }
  }
}
```

### Key design points

1. **Only mark `pending` tasks as skipped.** A task that is already `success` in a diamond
   convergence (reached from two paths, one failed) must keep its `success` state.

2. **Decrement grandchildren's indegrees when skipping.** This is the deadlock-prevention
   step. Without it, an independent branch whose task has `depends_on: [skipped-task, X]`
   would never reach indegree=0 and the scheduler would deadlock.

3. **Start BFS from `failedId`, not from the children.** The BFS visits the failed node's
   direct children first, then transitively recurses.

4. **Emit skip event AFTER the fail event** (caller in `scheduler.js` emits the fail event
   for `failedId` before calling `propagateSkip`). This satisfies pitfall M1 ordering.

5. **Do not start BFS on individual attempt failure** (pitfall M1). The call to
   `propagateSkip` lives in the `result.ok === false` branch of `runTaskWithRetry`'s
   `.then()` — which only fires after all retries are exhausted because `runTaskWithRetry`
   handles retries internally and only resolves once (to the scheduler).

### Insertion point in `scheduler.js`

The current Phase 2 comment reads:
```js
// Phase 3 will replace this with a BFS skip-downstream propagation.
```
This is at line 173 in the failure branch. The replacement is:
```js
propagateSkip(id, flow, state, indegree, onEvent, nextSeq);
// After skip propagation, persist state (all newly-skipped tasks are now on disk).
atomicWriteJson(stateFile, state);
// Update summary for all newly-skipped tasks.
for (const [tid, task] of Object.entries(state.tasks)) {
  if (task.status === 'skipped') summary.skipped++;  // NOTE: needs double-count guard
}
```
The `summary.skipped` increment needs care — skipping is additive. Best to count skipped
tasks at propagation time by tracking how many `markSkipped` calls were made, rather than
scanning the whole state.

---

## SIGINT/Signal Handling Per OS

### Current state (Phase 2)

```js
function handleSigint() {
  process.exitCode = process.platform === 'win32' ? 1 : 130;
}
process.on('SIGINT', handleSigint);
process.on('SIGTERM', handleSigint);
```

This records the intent but does NOT drain children or write final state.

### Phase 3 upgrade

The handler must:
1. Stop accepting new tasks (drain queue — set a flag the scheduler checks).
2. Send `SIGTERM` to all running children (tracked in a Set in the executor).
3. Wait up to 5 seconds for children to exit.
4. Persist final state (tasks still `running` remain `running` per spec).
5. Exit with code 130 (POSIX) or 1 (Windows).

### Mechanism

The cleanest approach is an `AbortController` at the CLI level:
```js
const abortController = new AbortController();
function handleSigint() {
  process.exitCode = process.platform === 'win32' ? 1 : 130;
  abortController.abort();  // signals all pending retries to skip their backoff sleep
}
```

`retry.js` already has `opts.signal` scaffold. Aborting it causes pending `defaultSleep`
calls to reject, which causes `runTaskWithRetry` to reject, which the scheduler's `.catch`
handles. This drains backoff-sleeping tasks instantly.

For **actually-running children** (spawned subprocesses), the executor needs to expose a
"kill all active children" callback. Options:
- Track the active `ChildProcess` object in a Set stored in the scheduler, and expose a
  `killAll()` method to cli.js.
- Or: cli.js passes a `killAll` function to the scheduler which populates it with the
  current running children's PIDs.

Simplest approach matching existing architecture: scheduler receives an optional
`onSignalKill: (children) => void` hook, and the signal handler calls it.

### Windows vs POSIX

| Concern | POSIX | Windows |
|---------|-------|---------|
| Exit code for Ctrl-C | 130 | 1 (POSIX 130 is not standard) |
| SIGTERM to child | Received by child process | `child.kill()` calls `TerminateProcess` — unconditional kill, no grace period |
| SIGINT propagation | Console group forwards Ctrl-C to direct children | Windows console forwards Ctrl-C to cmd.exe group, then to grandchildren |
| SIGTERM support | Full | `child.kill('SIGTERM')` actually calls SIGKILL-equivalent |
| `process.on('SIGTERM')` | Works | Windows supports SIGTERM on Node process since Node 8 |

**Practical implication:** On Windows, the SIGTERM-then-5s-wait-then-SIGKILL approach still
works, but the "SIGTERM" is effectively immediate kill. This is fine for v1 — document it.

### Guard against double-invocation

Multiple Ctrl-Cs cause the handler to fire multiple times. Guard with a `let shutdownStarted
= false` flag:
```js
function handleSigint() {
  if (shutdownStarted) return;
  shutdownStarted = true;
  // ... drain logic
}
```

### No orphan children

Executor spawns with default `detached: false`. When the parent Node process exits, the
OS terminates the direct children (cmd.exe or sh) on Windows and sends SIGHUP on POSIX.
Grandchildren (the actual command inside the shell) may survive on POSIX if they `setsid`.
This is an acceptable v1 limitation — document it.

---

## Dogfood `flow.json` Design

### Location: `flow.json` at repo root (DOG-02)

```json
{
  "tasks": [
    {
      "id": "test",
      "cmd": "npm test",
      "depends_on": []
    },
    {
      "id": "build-hooks",
      "cmd": "npm run build:hooks",
      "depends_on": []
    },
    {
      "id": "count-tests",
      "cmd": "node -e \"const fs=require('fs'),p=require('path');const files=fs.readdirSync('test').filter(f=>f.endsWith('.test.js'));process.stdout.write('test files: '+files.length+'\\n');if(files.length<12)process.exit(1)\"",
      "depends_on": ["test", "build-hooks"]
    }
  ]
}
```

### Design rationale

- `test` and `build-hooks` are independent (no `depends_on`) — they run in parallel.
- `count-tests` depends on both — it starts only after both parallel tasks succeed.
- All commands use `npm` or `node -e` — cross-platform portable (no `sh -c`).
- `count-tests` asserts `files.length >= 12` and exits 1 if not — makes DOG-01 verifiable
  by the dogfood run itself.
- The `node -e` inline script uses `require()` syntax (CJS), which works in any Node
  context because `cmd` runs in a shell that spawns a new Node process — `"type": "module"`
  in `package.json` does not affect subprocess invocations via `node -e`.

### `build:hooks` stub

Add to `package.json` scripts:
```json
"build:hooks": "node -e \"process.stdout.write('build:hooks ok\\n')\""
```

This is portable, exits 0, and produces observable output. Real build logic can replace
this stub without changing the dogfood flow.

### Kill-and-resume scenario (DOG-03)

The integration test:
1. Start `whooflow run --file flow.json` via `spawn` (not `spawnSync`).
2. After the `test` task transitions to `running` (observable via state file polling or a
   brief fixed sleep), send SIGINT to the child process.
3. Read `whooflow.state.json` — assert the killed task has `status: 'running'`.
4. Run `whooflow run --file flow.json --resume` via `spawnSync`.
5. Assert exit code 0.
6. Read final `whooflow.state.json` — assert all tasks `success`.
7. Assert the `test` task's `attempts` is 2 (original attempt + resumed attempt).

**Timing concern** (pitfall M4): To avoid relying on wall-clock for "task started", write
a separate simpler fixture with a task that creates a marker file, then sleeps. This lets
the test poll for the marker file to know "task is running" before sending the kill signal.
Using the real dogfood flow for DOG-03 would be slow (npm test takes seconds) and
environment-dependent.

**Separate fixture for DOG-03:** `test/fixtures/sleepy.json` with a task `cmd: "node -e
\"require('fs').writeFileSync('MARKER','1');setTimeout(()=>{},10000)\""`. The test polls
for the MARKER file, then sends SIGINT. On resume, the task should re-create the marker with
a fresh mtime.

---

## Test Scenarios (≥12 Tests)

The existing suite has ~13 unit/integration tests across 13 test files. Phase 3 adds:

### New test file: `test/resume.test.js`

| # | Test | Req | Type |
|---|------|-----|------|
| R-1 | `mergeState`: task in `success` → stays success; scheduler pre-decrements child indegree | STATE-04 | unit |
| R-2 | `mergeState`: task in `failed` with retries remaining → reset to `pending`, preserve attempts | STATE-04 | unit |
| R-3 | `mergeState`: task in `running` → reset to `pending`, preserve attempts | STATE-04, C5 | unit |
| R-4 | `mergeState`: task in `failed` with no retries → stays failed (for skip-downstream on startup) | STATE-04 | unit |
| R-5 | `mergeState`: state references unknown task id → throws clear error | C5 | unit |
| R-6 | Full resume from `success` state: run, copy state file, run again with `--resume`, assert only non-success tasks re-run | STATE-04, STATE-05 | integration |
| R-7 | Full resume from `failed` state: run a failing flow, manually patch state, resume, assert re-run | STATE-04 | integration |
| R-8 | Full resume from `running` state: simulate kill by directly writing state with `running`, resume, assert re-run | C5, STATE-04 | integration |

### New test file: `test/skip.test.js`

| # | Test | Req | Type |
|---|------|-----|------|
| S-1 | Skip-downstream: A→B→C, A fails, B+C get `skipped`, correct events | SCHED-06 | unit (fake executor) |
| S-2 | Diamond with one failed arm: A→B, A→C, B→D, C→D. A fails. D gets skipped. C gets skipped. B gets skipped. (all downstream) | SCHED-06 | unit |
| S-3 | Independent branches: A→B (A fails), C→D (independent). D should succeed; B skipped | SCHED-06 | integration |
| S-4 | Skip events in JSON stream come AFTER the terminal fail event for the parent (M1) | M1, SCHED-06 | unit |
| S-5 | Skip-downstream at `attempts: 3`: only fires after 3rd failure, not after 1st/2nd | M1 | unit (injectable retry) |

### Additions to `test/integration.test.js` (CLI-level)

| # | Test | Req | Type |
|---|------|-----|------|
| I-1 | `--resume` on a clean successful run exits 0 and no tasks re-run | CLI-03 | integration |
| I-2 | `--resume` on a run with a failed task (with retries): task re-runs | CLI-03, STATE-04 | integration |
| I-3 | Kill-and-resume (DOG-03 simplified): write `running` state directly, resume, verify re-run | C5, DOG-03 | integration |
| I-4 | Exit code on resume with remaining failures = 1; on clean resume = 0 | N2 | integration |

### DOG-03 integration test (`test/dogfood.test.js` or added to `integration.test.js`)

| # | Test | Req | Type |
|---|------|-----|------|
| D-1 | Dogfood flow.json runs to completion (exit 0), all 3 tasks succeed | DOG-02 | integration |
| D-2 | Kill-and-resume: start dogfood with a slow task, SIGINT mid-task, `--resume`, verify correct final state | DOG-03 | integration |

### Total count

Existing: ~40 assertions across 13 files (but these count as test cases against DOG-01's
"≥12 scenarios"). New: 17 scenarios above. Combined the suite well exceeds 12 unique
behavioral scenarios.

---

## File-Level Breakdown

### New files to create

| File | Purpose | LOC estimate |
|------|---------|-------------|
| `src/resume.js` | `mergeState(flow, oldState)` pure function | ~60 |
| `src/skip.js` | `propagateSkip(failedId, flow, state, indegree, onEvent, nextSeq)` | ~40 |
| `flow.json` | Dogfood flow (npm test + build:hooks + count-tests) | ~20 |
| `test/resume.test.js` | resume.test: R-1 through R-8 | ~150 |
| `test/skip.test.js` | skip.test: S-1 through S-5 | ~120 |
| `test/fixtures/sleepy.json` | Fixture for kill-and-resume: task that writes marker then sleeps | ~15 |

### Files to modify

| File | Changes |
|------|---------|
| `src/scheduler.js` | (1) Seed loop: pre-decrement for success tasks; run `propagateSkip` for already-failed tasks on startup. (2) Failure branch: replace `// Phase 3 comment` with `propagateSkip(...)` call + state persist + summary update. ~30 lines net change. |
| `src/cli.js` | (1) Add `--resume` flag to `parseArgs`. (2) Read + merge old state when `--resume` is set. (3) Upgrade SIGINT handler to abort+drain+persist. ~40 lines net change. |
| `package.json` | Add `"build:hooks"` script stub. 1 line. |
| `test/integration.test.js` | Add I-1 through I-4 + D-1/D-2 tests. ~100 lines. |

### Files NOT to touch

`src/executor.js`, `src/retry.js` (already has `opts.signal` scaffold — just wire it in
from cli.js), `src/loader.js`, `src/validator.js`, `src/state.js`, `src/formatter.js`,
`src/preflight.js`, `src/errors.js` — all stable from Phase 2.

---

## Pitfall Defenses

### C5: `running` misinterpreted as `success` (silent loss of work)

**Concretely in this codebase:** `mergeState` in `src/resume.js` explicitly maps
`running` → `pending` with `attempts` preserved. The scheduler's success-path indegree
pre-decrement only fires for tasks with `status === 'success'`. A `running` task gets
no pre-decrement, re-enters the ready queue normally, and re-executes.

**Test:** R-8 (write `running` state manually, resume, assert task re-ran with
incremented `attempts`).

### M1: Skip cascade fires before terminal failure (premature skip)

**Concretely:** `propagateSkip` is only called in the `result.ok === false` branch of
the `runTaskWithRetry.then()` handler. `runTaskWithRetry` is a single awaited Promise
that only resolves once (after all internal retries exhaust). Individual attempt failures
inside `retry.js` never surface to the scheduler. Therefore `propagateSkip` can only be
called after terminal failure — structurally impossible to fire early.

**Test:** S-5 (task with `attempts: 3` fails; confirm skip event only after 3rd failure).

### C2: Downstream deadlock (indegree not decremented for skipped tasks)

**Concretely:** Inside `propagateSkip`, after marking a task `skipped`, we loop over
`flow.children[child]` and do `indegree[grandchild]--`. This is the same indegree map
that the scheduler uses for its ready-queue pump. An independent branch whose task has
`depends_on: [skipped-task, independent-task]` will see its indegree go to 0 when both
(a) the skipped task's contribution is removed via `propagateSkip` and (b) the
independent task finishes normally.

**Test:** S-3 (independent branches test).

### C6: Cross-platform commands in `flow.json`

**Concretely:** The dogfood `flow.json` uses only `npm test`, `npm run build:hooks`, and
`node -e "..."` with double-quoted outer string. `npm` is a universal command on any
Node.js installation. `node -e` with double-outer-quotes works in both `cmd.exe` and `sh`.
No `sh -c`, no `&&` chaining in `cmd` strings, no `echo`, no `true/false`.

**Test:** CI pipeline (GitHub Actions matrix across Windows/macOS/Linux if available).
Locally: verify dogfood flow runs on Windows by checking `cmd.exe` compatibility of every
`cmd` string.

### M6: Orphan children, multiple Ctrl-C race, exit code differences

**Concretely:** Single SIGINT/SIGTERM handler with `shutdownStarted` flag guards against
multiple invocations. On signal: set flag, call `abortController.abort()` (drains sleeping
backoffs), iterate running children set and call `child.kill('SIGTERM')` (translates to
`TerminateProcess` on Windows), wait up to 5s, persist state, exit. Exit code 130 on
POSIX, 1 on Windows.

The running children set is populated by the scheduler's `running` Set — but that tracks
task IDs, not `ChildProcess` objects. The implementation must thread the actual `ChildProcess`
references to the signal handler. Two options:
- Option A: `executor.js` tracks active processes in a module-level `Set<ChildProcess>` and
  exports a `killAll()` function.
- Option B: The scheduler receives an `onChildSpawned(child)` / `onChildExited(child)` pair
  from cli.js to populate a Set owned by cli.js.

Option A is simpler and the existing `runTask` function in `executor.js` is already the
single spawn point. Recommendation: Option A.

**Test:** I-3, D-2.

### DF-6: Trust-establishing edge case (running-on-disk from mid-task kill)

This is the DOG-03 scenario. The test creates a flow with a sleepy task, kills mid-sleep,
reads the state file to confirm `running`, resumes, asserts the task ran again (marker file
has fresh mtime), asserts final state is all-success, asserts `attempts === 2`.

### N2: Exit code wrong on resume with remaining failures

**Concretely:** On resume, `runFlow` returns `{ summary }`. `summary.failed > 0` → exit 1,
`summary.failed === 0` → exit 0. This counts only the current run's failures. But the final
state might have tasks that were `skipped` in the previous run and re-ran to `skipped` again
(if their parent still failed on resume). The exit code in cli.js already maps
`summary.failed > 0 ? 1 : 0` which is correct — it reflects whether the current run had
any failures.

The tricky case: a partial resume where the previously-failed task now succeeds, and its
previously-skipped children now run to success. This requires that `mergeState` maps
`skipped` → `pending` (already covered in merge logic above). So on resume, those tasks
get a second chance. Final exit code is 0 if all succeed.

**Test:** I-4.

### M4: Test flakiness from timing assertions

**Concretely:** The kill-and-resume test (DOG-03 / I-3) must not use a fixed sleep to
determine "task is running." Use a marker file written by the task as the signal. Poll for
the marker with a bounded loop (max 5s, check every 50ms). This is deterministic: we know
the task is running when the marker exists.

For skip-downstream tests that use fake executors (S-1 through S-5), no real timing is
involved — fake executor returns immediately.

For parallel tests that already exist (`parallel.test.js`), Phase 3 adds no new timing
assertions.

**Test:** All new tests use deterministic signals (marker files, state file status checks)
not wall-clock bounds.

---

## Validation Architecture

`workflow.nyquist_validation` is not present in `.planning/config.json` (the config only
has `mode`, `depth`, `parallelization`, `commit_docs`, `model_profile`, `workflow`). The
`workflow` object has `research`, `plan_check`, `verifier`, `auto_advance` but no
`nyquist_validation` key — treating as false/not enabled.

**Test Framework:**

| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` |
| Config file | none — discovered via `"test": "node --test \"test/**/*.test.js\""` in `package.json` |
| Quick run command | `node --test test/resume.test.js test/skip.test.js` |
| Full suite command | `npm test` (runs all `test/**/*.test.js`) |

**Phase Requirements to Test Map:**

| Req ID | Behavior | Test Type | File |
|--------|----------|-----------|------|
| CLI-03 | `--resume` flag wires mergeState | integration | `test/integration.test.js` I-1..I-4 |
| SCHED-06 | BFS skip propagation on terminal fail | unit + integration | `test/skip.test.js` S-1..S-5 |
| STATE-04 | mergeState rules for each status | unit | `test/resume.test.js` R-1..R-5 |
| STATE-05 | Scheduler unaware of fresh-vs-resume | unit | `test/resume.test.js` R-6 (scheduler gets merged state, runs identically) |
| DOG-01 | ≥12 scenarios | unit + integration | existing suite + new |
| DOG-02 | Real flow.json runs correctly | integration | `test/integration.test.js` D-1 |
| DOG-03 | Kill-and-resume scenario | integration | `test/integration.test.js` D-2 |

**Phase gate:** Full suite green (`npm test`) before `/pan:verify-phase`.

---

## Architecture Patterns Referenced

This phase does not introduce new patterns — it completes the patterns already documented in
`.planning/research/architecture.md`:

- **Pattern 3 (Skip-downstream BFS):** `src/skip.js` is the direct implementation.
- **Pattern 5 (Resume = merge pass before scheduling):** `src/resume.js` is the direct
  implementation.
- **Anti-Pattern 6 (Orphan children on SIGINT):** The Phase 3 signal handler upgrade is the
  mitigation.

---

## Open Questions

1. **AbortController wiring from SIGINT to in-flight spawned children.**
   What we know: `retry.js` has `opts.signal` scaffold that aborts backoff sleeps. What's
   unclear: when `abort()` is called during a real `runTask` (not during sleep), the child
   process is already spawned. The `abort` doesn't kill the child — only the sleep. A
   separate mechanism (Option A: `executor.js` exports `killAll()`) is needed to kill
   actually-running children.
   Recommendation: Implement Option A in Wave 1 of Phase 3 plans.

2. **`count-tests` step in `flow.json` requires `require('fs')`.**
   The project uses `"type": "module"` in `package.json`. When `npm run` or the shell
   runs `node -e "require(...)"`, it spawns a new Node.js process — the `"type": "module"`
   key in the parent's `package.json` does NOT apply to this subprocess because the subprocess
   is invoked with a `-e` flag script (not a file path). CJS `require` works in `node -e`
   regardless of `"type": "module"`. HIGH confidence from Node.js docs.

3. **`flow.json` state file location on resume.**
   The `--resume` flag reads `whooflow.state.json` from the same directory as the flow file.
   When the dogfood runs `flow.json` from the repo root, the state file will be
   `./whooflow.state.json`. This file should be in `.gitignore`. Check whether `.gitignore`
   exists and add `whooflow.state.json` if needed.

---

## Standard Stack (Delta from Project-Level Research)

No new dependencies. All Phase 3 code uses only:
- `node:fs` (state file read on `--resume`)
- `node:path`
- `node:child_process` (existing pattern in executor.js)
- `node:test` + `node:assert/strict` (test suite)

No new builtins beyond what Phase 2 already uses.

---

## Infrastructure Dependencies

None — unit tests only, no external infrastructure needed.

---

## Sources

All findings are HIGH confidence from direct code inspection:
- `src/scheduler.js` — current insertion points identified at lines 57-61 (seed loop),
  line 173 (failure branch `// Phase 3` comment)
- `src/cli.js` — SIGINT handler at line 77; `// Phase 3 will add` comment at line 80
- `src/retry.js` — `opts.signal` scaffold at line 39 (`P3: will be wired`)
- `src/state.js` — `markSkipped` already exists at line 143 (Phase 3 can use it directly)
- `package.json` — confirms `build:hooks` script does not yet exist
- `.planning/research/architecture.md` — Patterns 3, 5, Anti-Pattern 6 (direct reference)
- `.planning/research/pitfalls.md` — C5, M1, C2, C6, M6, N2, M4 (all directly cited above)

---

## Metadata

**Confidence breakdown:**
- Implementation approach: HIGH — direct code inspection, insertion points identified by comments
- Algorithm details: HIGH — architecture.md already has verified pseudocode
- Signal handling: HIGH for POSIX; MEDIUM for Windows grandchild orphan edge cases
- Dogfood design: HIGH — `npm test` works, `build:hooks` stub needs to be added
- Test scenarios: HIGH — based on existing test patterns in the codebase

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (stable domain; no external dependencies to drift)
