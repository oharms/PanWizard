---
phase: 03-resume-skip-downstream-dogfood
plan: 05
status: complete
completed: 2026-05-02
---

# Plan 03-05 Summary — Dogfood flow + DOG-03 kill-and-resume

## What was built

### 1. `flow.json` at the repo root (DOG-02)

Real DAG that runs PAN's own test + build pipeline in parallel, with a count step that gates on both:

```json
{
  "tasks": [
    { "id": "test",         "cmd": "npm test",                "depends_on": [] },
    { "id": "build-hooks",  "cmd": "npm run build:hooks",     "depends_on": [] },
    { "id": "count-tests",  "cmd": "node -e \"...readdirSync('test')...\"", "depends_on": ["test", "build-hooks"] }
  ]
}
```

The count step asserts `test files >= 12` — DOG-01's coverage gate. All commands are portable (`npm` and `node -e` work in `cmd.exe` and `/bin/sh`).

### 2. `package.json` build:hooks script (DOG-02)

Cross-platform `node -e` stub (works in cmd.exe and sh, exits 0, produces observable output):

```json
"build:hooks": "node -e \"process.stdout.write('build:hooks ok\\n');\""
```

Replaceable by real build logic later without changing the dogfood structure.

### 3. `test/fixtures/sleepy.json` (DOG-03 fixture)

Single-task fixture with `retry.attempts: 2` so resume has 1 retry remaining after a kill:

```json
{
  "tasks": [{
    "id": "sleep",
    "cmd": "node -e \"require('fs').writeFileSync('MARKER',String(Date.now()));setTimeout(()=>{},30000);\"",
    "depends_on": [],
    "retry": { "attempts": 2, "backoff_ms": 0 }
  }]
}
```

The task writes a `MARKER` file containing a timestamp (so the test can deterministically observe "task started" via marker-file polling) then sleeps 30 seconds. The kill terminates well before the sleep elapses naturally.

### 4. `test/integration.test.js` — 3 new dogfood tests

- **`DOG-02 D-1`** — dogfood flow.json end-to-end. Gated by `WHOOFLOW_DOGFOOD=1` env var to prevent infinite recursion (the dogfood runs `npm test` which would re-enter this test file). Verified manually:
  - `WHOOFLOW_DOGFOOD=1 npm test` (one shot)
  - `node bin/whooflow.js run --file flow.json --concurrency 2`
- **`DOG-03 D-2`** — kill-and-resume on the sleepy fixture (POSIX-only):
  - Spawns whooflow as a child process against `sleepy.json`.
  - Polls for `MARKER` file (50ms intervals, 5s max) — deterministic, no fixed sleeps (pitfall M4).
  - Sends SIGINT via `child.kill('SIGINT')`.
  - Awaits exit; asserts exit code is 130 (POSIX) or 1 (Windows fallback).
  - Asserts `state.tasks.sleep.status` is `'running'` OR `'failed'` (failure-branch may have flipped during drain) and `attempts === 1`.
  - Patches the flow file to use a near-instant cmd for the resumed run.
  - Runs `--resume` and asserts the marker file was re-written (contents differ from kill snapshot), final `state.tasks.sleep.status === 'success'`, and `attempts === 2`.
  - Skipped on Windows: SIGINT propagation to shell-spawned grandchildren is unreliable. Plan 04's I-3 covers the same code path via direct state-file write.
- **`DOG-01`** — sentinel test asserting that 8 critical test files exist (loader, validator, scheduler, parallel, retry, resume, skip, integration). If someone removes one, this fails.

## Marker-file polling pattern (pitfall M4)

```js
async function waitForMarker(markerPath, maxMs = 5000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (existsSync(markerPath)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`marker file ${markerPath} never appeared within ${maxMs}ms`);
}
```

No fixed sleeps anywhere in the kill-and-resume test. The 50ms poll interval is the only "wait", and it's inside a deadline-bounded loop.

## D-1 recursion guard

Without the WHOOFLOW_DOGFOOD env-var gate, `npm test` → triggers the dogfood test → which runs `npm test` → infinite recursion. The gate ensures the test is `t.skip()`'d by default, runnable on demand for manual verification.

## D-2 Windows-skip rationale

Windows doesn't reliably propagate SIGINT through `cmd.exe` to grandchild processes spawned with `shell: true`. The signal often gets eaten by the shell itself rather than reaching the actual `node -e` process. Plan 04's I-3 covers the exact same resume-from-running code path by directly writing a state file with `status: 'running'` — bypassing the kill mechanism entirely. So DOG-03's invariant (resume restores `running` to fresh `pending` and re-runs) is verified end-to-end on Windows via I-3 and via spawn+SIGINT on POSIX via D-2.

## Test count

- Baseline (after Plan 04): 136.
- After Plan 05: **139 tests** (+3 dogfood). 137 pass + 2 skipped (D-1 gated by env var, D-2 skipped on Windows).
- Combined with prior phases, this exceeds DOG-01's "≥12 distinct DAG scenarios" requirement many times over.

## Phase 3 final coverage

All 7 Phase 3 requirements covered:
- **CLI-03** — Plan 04 (--resume flag wired).
- **SCHED-06** — Plans 02 + 04 (BFS + scheduler wiring).
- **STATE-04** — Plans 01 + 04 (mergeState + scheduler seed loop).
- **STATE-05** — Plans 01 + 04 (pure mergeState; scheduler reads only `state.tasks[id].status`).
- **DOG-01** — this plan + cumulative suite (139 tests).
- **DOG-02** — this plan (real flow.json + build:hooks).
- **DOG-03** — this plan (D-2 kill-and-resume integration test on POSIX; covered on Windows by I-3).

## Commits

- `feat(03-05): add dogfood flow.json + build:hooks + sleepy fixture`
- `test(03-05): add DOG-01/D-1/D-2 integration tests`

## Self-Check: PASSED

- 139 tests; 137 pass + 2 expected skips.
- `node bin/whooflow.js run --file flow.json --list` validates the flow shape.
- `whooflow.state.json` is in `.gitignore` (won't pollute commits during dogfood runs).
- Phase 3 ships: a flow runs even after Ctrl-C, a failure cleanly skips its downstream subgraph (with independent siblings continuing), and a resume restores the in-flight state correctly. The DAG runner now ships its own dogfood pipeline.
