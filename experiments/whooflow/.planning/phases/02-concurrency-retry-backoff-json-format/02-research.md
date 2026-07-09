# Phase 2: Concurrency + Retry/Backoff + JSON Format - Research

**Researched:** 2026-05-02
**Domain:** Slot-based ready-queue scheduling, retry-with-bounded-jittered-backoff, NDJSON event emission, pre-flight CLI ergonomics
**Confidence:** HIGH (project-level research is already prescriptive; this file emits Phase-2-specific deltas only, per P-1402)

## Summary

Phase 1 shipped a slot-based ready-queue scheduler with `cap = 1` hardcoded, an event-subscriber-shaped text formatter, and a one-shot executor (no retry). Phase 2 has **three orthogonal concerns** that compose cleanly on top of those Phase 1 seams:

1. **Concurrency.** Lift `cap = 1` to `cap = opts.concurrency` (default 4 from CLI). The scheduler structure (`indegree` map, `ready` FIFO, `running` Set, pump loop) is *already* slot-based — this is a one-line semantic change plus careful invariant validation under N concurrent in-flight tasks.
2. **Retry-with-backoff.** Wrap `runTask` in a per-task retry loop **inside the executor** (or a thin layer between scheduler and executor). The scheduler keeps seeing one `ok | fail` outcome per task, never per-attempt outcomes. Persistence ordering matters: `attempts` must be incremented + persisted to state **before** the backoff sleep starts (resume-safety).
3. **NDJSON event format.** Add a second formatter (`createJsonFormatter`) that emits `JSON.stringify(event) + '\n'` per `process.stdout.write`. Inject a monotonic `seq` field at the **scheduler emit point** (single source of truth). Use `structuredClone` to embed state snapshots safely. CLI grows a `--format` flag and an `--dry-run` / `--list` pre-flight path.

Because Phase 1 already established stdout/stderr discipline (formatter writes to stdout, diagnostics to stderr), parallelism + JSON layer cleanly without retrofitting.

**Primary recommendation:** Make Phase 2 **four plans** that mirror the three concerns plus pre-flight: (a) lift concurrency cap + add per-N invariants/tests, (b) retry wrapper around runTask + state-write-before-sleep + slot-holding semantics, (c) JSON formatter + seq emission + structuredClone + `--format` flag wiring, (d) `--dry-run` + `--list` + listener-removal discipline + single-SIGINT-at-startup. Plans (a) and (b) have a sequence dependency (retry depends on executor changes); (c) is independent; (d) depends on (c) for the `--format` plumbing.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-04 | `--format text\|json` flag (json emits NDJSON, one event per task transition on stdout) | §JSON Event Format Design (this doc); pitfalls.md N1 |
| CLI-05 | `--dry-run` prints planned execution waves and exits without spawning | §Pre-flight Commands (this doc); features.md DF-3 |
| CLI-06 | `--list` prints task ids + depends_on and exits | §Pre-flight Commands (this doc); features.md DF-4 |
| SCHED-02 | Slot-based ready-queue (NOT batch/wave) — slot opens → next ready task starts immediately | architecture.md Pattern 1 (already structurally in place); §Slot-Based Scheduler (this doc) |
| SCHED-03 | Independent tasks parallelize up to `--concurrency` slots; wall-clock for parallelizable < sum | §Slot-Based Scheduler invariants; pitfalls.md M2 |
| SCHED-04 | Scheduler overhead < 5ms/task; 100 trivial tasks under 3s at `--concurrency 4` | §Testing Strategy: 100-task perf gate; pitfalls.md M3 (FD/listener leaks) |
| EXEC-03 | Retry up to `attempts` total tries with exponential backoff seeded by `backoff_ms` | §Retry-with-Backoff Design (this doc); pitfalls.md C7 |
| EXEC-04 | At `--concurrency 1`, retrying task HOLDS its slot during backoff sleep | §Retry-with-Backoff Design — Slot-holding semantics; pitfalls.md M2 (deadlock-at-N=1 corollary) |
| EXEC-05 | `attempts` counter persisted to state BEFORE backoff sleep starts | §Retry-with-Backoff Design — State persistence ordering; pitfalls.md C7 |
</phase_requirements>

## Architectural Changes from Phase 1

### What Stays Unchanged
| Module | Why It Survives |
|--------|-----------------|
| `src/loader.js` | Flow IR shape + `depends_on` normalization is final. Retry shape was already validated for Phase 2. |
| `src/validator.js` | Iterative Kahn + `topoOrder` + `children` map. The `--dry-run` "planned waves" view layers on top of `topoOrder`/`children` — the validator itself stays put. |
| `src/state.js` | Atomic write contract is final. State shape (`{flow_file, started_at, ended_at, tasks}`) accommodates per-task `attempts` already. `markRunning` already increments `attempts` (line 122 of state.js: `t.attempts = (t.attempts ?? 0) + 1`) — Phase 2's retry loop calls it once per attempt. |
| `src/executor.js` (the inner spawn) | The `spawn(task.cmd, {shell:true, ...})` + `'close'` discipline is final. Phase 2 wraps a retry loop *around* this, not into it. |
| `src/errors.js` | Existing typed errors (`ValidationError`, `CycleError`, `RuntimeError`) cover Phase 2's surface. No new error class needed. |
| `bin/whooflow.js` | Stays a thin shebang. |

### What's Refactored (in place — minimal disruption)
| File | Change |
|------|--------|
| `src/scheduler.js` | (1) `cap = opts.concurrency ?? 1` already exists at line 30 — **one-line** wire-through is all the concurrency lift requires. (2) Add monotonic `seq` counter; thread `seq` into every emitted event. (3) Replace direct `runTask(task)` call (line 100) with `runTaskWithRetry(task, state, id, stateFile, opts)` — the retry wrapper. (4) Add a `current_attempt` to running events (Phase 1 already exposes `attempts` from state). (5) Listener-removal discipline: scheduler must not register process-level listeners per task (already true — Phase 1 only wires per-spawn handlers inside the executor). |
| `src/executor.js` | **Two functions exported:** `runTask(task)` (unchanged — single attempt) and **new** `runTaskWithRetry(task, opts)` that internally loops over `runTask` with exponential-backoff sleep between attempts. State persistence is performed by a callback (the scheduler-supplied `persistAttempt(attemptNumber)`) rather than directly — keeps the executor pure of state.js dependency, so the executor remains unit-testable. |
| `src/formatter.js` | Add **`createJsonFormatter()`** as a parallel sibling to `createTextFormatter()`. Same event-subscriber shape. Single `process.stdout.write(JSON.stringify(event) + '\n')` per event. Use `structuredClone(event)` defensively if the event embeds nested state. Existing `shouldUseColor` / `shouldUseAscii` helpers stay text-only. |
| `src/cli.js` | (1) Replace hardcoded `concurrency: 1` (line 132) with `concurrencyN`. (2) Add `--format` option to `parseArgs` config (default `'text'`, accept `'json'`). (3) Add `--dry-run` and `--list` boolean options. (4) Branch dispatch: if `--list`, run `printList(validatedFlow)` and exit 0. If `--dry-run`, run `printDryRun(validatedFlow)` and exit 0. Both validate the flow first; both exit 2 on validation/cycle error. (5) Wire format-specific formatter: `format === 'json' ? createJsonFormatter() : createTextFormatter()`. (6) Install single SIGINT handler at startup (cleanup via named handler in `child.on('close')`). |

### What's New (small files)
| File | Purpose |
|------|---------|
| `src/retry.js` (NEW, ~50 LOC) | `runTaskWithRetry(task, opts)` — retry loop + exponential backoff math + jitter + cap. Imports `runTask` from `executor.js`. Imports `setTimeout` (or accepts injectable timer for tests). **Decision below: live in `retry.js` rather than inline in executor.js.** |
| `src/preflight.js` (NEW, ~80 LOC) | `printList(validatedFlow, out)` and `printDryRun(validatedFlow, out)`. Pure functions over the validated flow's `topoOrder` + `children` + `tasks`. Output goes to `process.stdout` for both — exit 0 if validation succeeded (cycle/schema errors already threw before this is reached). |
| `test/retry.test.js` (NEW) | Unit tests for retry math (off-by-one, cap, jitter), state-write-before-sleep ordering, slot-hold semantic. |
| `test/json-formatter.test.js` (NEW) | NDJSON output discipline, `seq` monotonicity, `structuredClone` snapshot safety. |
| `test/preflight.test.js` (NEW) | `--list` + `--dry-run` output; exit codes; depth-grouping algorithm. |
| `test/parallel.test.js` (NEW) | 100-trivial-task perf gate (SCHED-04); 1-slow-+-4-fast wall-clock test (SCHED-03/M2); concurrency=1 retry-holds-slot test (EXEC-04). |
| `test/fixtures/` additions | `parallel-trivial-100.json` (100-task generator can build this in test setup), `slow-and-fast.json` (1 slow + 4 fast independent tasks), `retry-success.json` (task that fails twice then succeeds via state file), `retry-fail.json` (task that fails N times), `concurrency-1-retry-chain.json` (5-task linear chain with middle task that retries twice). |

### Decision: Why `retry.js` is its Own File (not Inline in executor.js)
Three reasons, in priority order:
1. **Test isolation.** Retry math (off-by-one, cap, jitter) is pure logic deterministic with a seedable RNG and an injectable timer. Keeping it separate lets `test/retry.test.js` exercise the math in isolation without spawning real subprocesses.
2. **State-write callback boundary.** The retry loop needs to call back into the scheduler to persist `attempts` — making this a parameter (`persistAttempt(n)`) rather than an `import`-time dependency keeps `retry.js` free of `state.js`/`scheduler.js` imports. Cleaner test seams, no circular import risk.
3. **architecture.md Pattern 4 explicitly factors retry as a separate testable unit.** Honor the pattern.

## Slot-Based Scheduler Design

### Phase 1 → Phase 2 Diff (Why It's Almost Free)

Phase 1's `runFlow` (src/scheduler.js lines 29–169) **is already** the architecture.md Pattern 1 ready-queue with these structural properties:

- `indegree[id]` map (line 36–39) — count of unresolved deps
- `ready` array seeded in `topoOrder` (line 42–45) — FIFO, deterministic insertion
- `running` Set (line 47) — slot occupancy
- `pump()` loop (line 83): `while (running.size < cap && ready.length > 0) ...` — slot semaphore
- Per-task `.then` continuation (line 100–158): on completion, decrement children's indegree, push newly-ready, re-pump

**The slot semantics are already correct.** When task `T` completes, its `.then` handler runs synchronously: `running.delete(T)`, decrement children's indegree, push to `ready`, call `pump()`. `pump()` immediately dispatches up to `cap - running.size` newly-ready tasks. There is **no wave barrier** — a fast child of T starts the instant T resolves, regardless of T's slow siblings.

### What Phase 2 Adds at the Scheduler Level

| Change | Why |
|--------|-----|
| `cap = opts.concurrency ?? 4` | Phase 1 used `?? 1`; Phase 2 default is 4 (per CLI default). CLI continues to pass the parsed value explicitly so this default is essentially a fallback. |
| Replace `runTask(task)` with `runTaskWithRetry(task, persistAttempt)` (line 100) | Threads retry concern through executor. `persistAttempt(n)` is a closure capturing `state`, `id`, `stateFile` so retry.js stays unaware of state.js. |
| Add `let seqCounter = 0; function nextSeq() { return ++seqCounter; }` at scheduler init | Single source of monotonic `seq`. **Every** event emitted by `onEvent` gets a `seq` field. Order under interleaving: scheduler's `.then` callbacks are serialized via the JS event loop microtask queue, so `seq` increments are race-free. |
| Track `currentAttempt` in events: `attempts: state.tasks[id].attempts` (already in Phase 1 line 96, 113, 129) | Phase 1 already does this. Phase 2 verifies `attempts` is consistent across multi-attempt tasks. |

### Slot-Based Scheduler Invariants (must hold under N concurrent tasks)

| Invariant | Where checked | Failure mode if broken |
|-----------|---------------|------------------------|
| `running.size <= cap` always | Top of `pump()` while-condition | Fork-bomb at high N |
| Indegree is decremented **only** on `success` (Phase 1) or `success`/`skipped` (Phase 3) — **never** on `failed` | scheduler line 118 (success), Phase 3 will add skip path | Children of failed task run with stale/missing inputs (pitfall C2) |
| `seq` is strictly increasing across **all** emitted events | `onEvent` emit sites | Consumers can't re-sort interleaved events under parallelism (pitfalls.md CC-5 #4) |
| At `--concurrency 1`, a task in `running` Set during its backoff sleep counts against `cap` | retry wrapper does NOT release/re-acquire | Deadlock-shaped semantic confusion: "0/1 slots used, no work running" (pitfalls.md M2 deadlock corollary) |
| `running.size === 0 && ready.length === 0` is the **only** termination condition | `maybeFinish()` (line 72–81) | Premature exit (run-complete fires before some children resolve) — Phase 1 already auto-fixed two race bugs here per the 01-04-summary deviations log |
| State file shows at most one task per slot in `status: running` at any natural pause point | `markRunning` + `atomicWriteJson` BEFORE spawn | Resume sees inconsistent state (pitfalls.md C5) |

### Comparison to a "Typical Worker Pool"

Worker-pool implementations (e.g., `p-limit`, `p-queue`) operate over a flat array of work items with no inter-item dependencies. Whooflow's scheduler **fuses** dependency resolution and slot management: the `ready` array is dynamic — items appear in it only when their indegree hits 0. There's no separate "queue then dispatch" phase — task availability and dispatch are interleaved on the same event-loop tick.

This is why we **don't use** `p-limit`: it's a flat semaphore with no concept of dependency graph. The scheduler's pump loop *is* the integration of indegree + slot semaphore + DAG ordering.

### Pitfall Defenses Specific to Phase 2 Concurrency

- **M2 wave-vs-slot:** Phase 1's structure prevents this by construction. Verification: write a test (`test/parallel.test.js`) with 1 slow task (200ms) + 4 fast tasks (50ms each), all independent, `--concurrency 2`. Expected wall-clock ~200ms (slow task occupies one slot continuously; four fast tasks share the other slot serially), NOT 250ms (which would indicate batch-mode). Use generous bounds (`< 350ms`) per pitfall M4.
- **M2 +1 starvation:** With FIFO ready-queue (current shape, line 42–45 + line 119 `ready.push`), tasks become ready in order. The validator's `topoOrder` ensures shallower tasks come first, but once dispatched they get out of the way as their slots free. Defer "criticality heuristic" (prefer tasks with more downstream dependents) per pitfalls.md M2 — not v1.
- **M3 FD/listener leaks:** Each `spawn` allocates 2 FDs (stdout/stderr pipes) when `stdio !== 'inherit'`. Phase 1 uses `stdio: 'inherit'` (executor.js line 24) — **keep this for Phase 2 unless `--format json` requires capture.** Decision: in `--format json`, we still inherit stdio (live output to user); we do NOT capture and embed in events because that would blow up state file + event size (pitfalls.md anti-pattern 5). The `seq` field is enough for sorting; tooling can `tail -f` the actual log files if users add per-task logging in v1.x.
- **M3 listener leaks under N parallel children:** Phase 1's executor.js attaches per-spawn listeners (`child.on('error')`, `child.on('close')`) — these are on the `child` instance which is GC'd when the task's promise resolves. **No leak** as long as the executor doesn't add listeners to long-lived emitters (`process`, etc.). **Phase 2 must add ONE process-level SIGINT listener at CLI startup, NOT per-task** (pitfalls.md M3). Watch this in code review of cli.js.

## Retry-with-Backoff Design

### Where the Retry Loop Sits

```
┌───────────────────────────────────────────────────────────────┐
│  scheduler.pump() — slot semaphore + indegree + ready FIFO    │
│                                                               │
│      runTaskWithRetry(task, persistAttempt) ───────┐          │
│                                                    │          │
│            ┌───────────────────────────────────────▼─────┐    │
│            │  retry.js — retry loop                     │    │
│            │   for attempt = 1..task.retry.attempts:    │    │
│            │     persistAttempt(attempt)   ←── BEFORE   │    │
│            │     result = await runTask(task)           │    │
│            │     if result.ok: return result            │    │
│            │     if attempt === attempts: return result │    │
│            │     await sleep(backoffWithJitter(...))    │    │
│            └────────────────────────────────────────────┘    │
│                          │                                   │
│            ┌─────────────▼────────────┐                       │
│            │  executor.runTask(task)  │  (Phase 1, unchanged) │
│            │   spawn + 'close'        │                       │
│            └──────────────────────────┘                       │
└───────────────────────────────────────────────────────────────┘
```

### State Persistence Ordering (EXEC-05 + Pitfall C7)

**The critical property:** `attempts` counter must be persisted to the state file *before* the backoff sleep begins. Otherwise a crash during sleep loses the increment, and resume gives the task a full retry budget → effectively infinite retries.

**Where Phase 1 already increments `attempts`:** `state.js` line 122 `markRunning` does `t.attempts = (t.attempts ?? 0) + 1`. Phase 1's scheduler calls `markRunning` then `atomicWriteJson` *before* spawn (lines 89–90). For Phase 2, **the retry loop calls `markRunning` + `atomicWriteJson` once per attempt, before each spawn**, which means before the next sleep. This naturally satisfies EXEC-05 — the increment is persisted before *any* sleep.

**Equivalent description:** the scheduler's `markRunning` + persist (Phase 1 lines 89–90) becomes part of `persistAttempt(n)` callback. retry.js calls it *before* calling `runTask`, NOT after the failure (otherwise we'd persist after the previous attempt completed but before the increment, defeating the purpose).

### Retry Loop Pseudocode

```js
// src/retry.js
import { runTask } from './executor.js';

const MAX_BACKOFF_MS = 30_000;  // pitfalls.md C7: cap to prevent 8-minute waits

/**
 * runTaskWithRetry(task, opts)
 *
 * task: normalized task with { id, cmd, retry: {attempts, backoff_ms} }
 * opts: {
 *   persistAttempt(attemptNumber) -> void,    // markRunning + atomicWriteJson
 *   sleepFn?: (ms, signal) -> Promise<void>,  // injectable for tests
 *   randomFn?: () -> number,                  // injectable for tests (jitter)
 *   signal?: AbortSignal,                     // CLI SIGINT cancels sleeps
 * }
 *
 * Returns the same {ok, exit_code, signal, error?} shape as runTask — the
 * scheduler sees a single ok|fail outcome, not per-attempt details.
 *
 * Pitfall C7 defenses:
 *   - "attempts: N" means N total runs (not 1+N). Off-by-one defended via < not <=.
 *   - Backoff capped at MAX_BACKOFF_MS to prevent 8-minute waits.
 *   - Equal-jitter: delay = capped * (0.5 + random*0.5). Range [0.5x, 1.0x].
 *   - persistAttempt called BEFORE sleep so a crash during sleep is recoverable.
 *
 * EXEC-04 (slot-hold semantics): the slot-holding is *implicit* — runTaskWithRetry
 * is awaited synchronously by the scheduler's pump-then-.then chain. The slot
 * (running.add(id)) is held from before the loop until after the loop completes.
 * No release/re-acquire happens inside the retry loop. The scheduler at cap=1
 * sees "1 slot used" throughout the whole retry sequence including sleep.
 */
export async function runTaskWithRetry(task, opts) {
  const attempts = task.retry?.attempts ?? 1;
  const baseMs = task.retry?.backoff_ms ?? 0;
  const persistAttempt = opts.persistAttempt;
  const sleep = opts.sleepFn ?? defaultSleep;
  const random = opts.randomFn ?? Math.random;

  let lastResult = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    persistAttempt(attempt);                     // EXEC-05: persist BEFORE sleep
    lastResult = await runTask(task);
    if (lastResult.ok) return lastResult;        // success short-circuit
    if (attempt === attempts) return lastResult; // off-by-one defense: don't sleep after last
    const capped = Math.min(MAX_BACKOFF_MS, baseMs * Math.pow(2, attempt - 1));
    const jittered = Math.floor(capped * (0.5 + random() * 0.5));
    await sleep(jittered, opts.signal);
  }
  return lastResult; // unreachable in normal flow but quiets the type-checker
}

function defaultSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new Error('aborted'));
    }, { once: true });
  });
}
```

### Off-by-One Defenses (Pitfall C7)

**Decision: `attempts: N` means N total runs, NOT 1 + N retries.** This matches user intuition ("3 attempts" = 3 runs) and matches Phase 1's loader default (`{attempts: 1, backoff_ms: 0}` = 1 run = no retry). Phase 1's validator already enforces `attempts >= 1`.

**Loop invariant:** `for (let attempt = 1; attempt <= attempts; attempt++)`. Sleep happens **between** attempts, not after the last. Test cases:
| `attempts` | `runTask` invocations | Sleep invocations |
|------------|----------------------|-------------------|
| 1 (default) | 1 | 0 |
| 2 | 2 (if first fails) | 1 |
| 3 | 3 (if first 2 fail) | 2 |

### Backoff Math (Pitfall C7)

```
delay_ms = min(MAX_BACKOFF_MS, base_ms * 2^(attempt - 1)) * (0.5 + random() * 0.5)
```

| Attempt | base=1000, 2^(attempt-1) | After cap (30s) | After jitter (range) |
|---------|--------------------------|-----------------|----------------------|
| 1 → 2 | 1000 * 1 = 1000ms | 1000ms | [500ms, 1000ms] |
| 2 → 3 | 1000 * 2 = 2000ms | 2000ms | [1000ms, 2000ms] |
| 5 → 6 | 1000 * 16 = 16s | 16s | [8s, 16s] |
| 10 → 11 | 1000 * 512 = 512s | **30s (capped)** | [15s, 30s] |

**Equal jitter** chosen over **full jitter** (jitter range [0, capped]): equal jitter still produces meaningful spread without pushing some retries to "instant" (which defeats the purpose during a thundering-herd scenario). Source: AWS Architecture Blog on backoff/jitter.

### Slot-Holding Semantics (EXEC-04)

**The decision:** the slot is held throughout retry, including backoff sleep. This is **already structurally true** because `runTaskWithRetry` is `await`-ed inside the scheduler's `.then` continuation chain — the slot (`running.add(id)` at scheduler.js line 86) doesn't get freed until the *outer* `.then` fires (which can only happen after `runTaskWithRetry` resolves with the final result).

**Why this matters at `--concurrency 1`:** if we released the slot during backoff sleep, the pump loop would see `running.size === 0` and `ready.length === 0` (no other tasks ready), and `maybeFinish()` would fire — terminating the run before the retry actually completes. Even if we worked around that (e.g., a `pendingRetries` set), the user-visible state would be "0/1 slots used, but nothing happening" — the deadlock-shaped semantic confusion pitfall M2 calls out. Holding the slot **defines** the retry as part of the task's slot occupancy.

**Test (EXEC-04 verification):** 5-task linear chain, middle task has `retry.attempts: 3, backoff_ms: 50`. Middle task `cmd` is a state-file-checking script that fails on attempts 1+2 and succeeds on attempt 3. Run with `--concurrency 1`. Assert: flow completes, all 5 tasks succeed, middle task's `attempts: 3` in final state.

### Resume-Safety (Pitfall C7's "attempts not persisted before sleep")

The **persist-before-sleep** ordering is the entire mitigation. Phase 2 doesn't ship `--resume` (that's Phase 3) but the persistence ordering must already be correct now so Phase 3 can rely on it. Concretely:

- A crash *during the spawn itself* leaves `attempts: N` in state (incremented just before the spawn). Phase 3 resume will treat this as a partial attempt and re-run.
- A crash *during the sleep* leaves `attempts: N` in state (incremented before this iteration's spawn → but the spawn already completed and failed, so this is fine). Phase 3 resume sees `failed` (or `running` if we wrote `failed` *after* the sleep; we DON'T — see below) with `attempts: N`. With remaining budget (`task.retry.attempts > N`), Phase 3 resets to `pending` and retries from attempt N+1. Without remaining budget, Phase 3 leaves it terminal.

**Subtlety:** between attempts, the task's *transient* status is "failed-but-will-retry." We should NOT write `status: failed` to disk between attempts — the task is not terminally failed, the scheduler doesn't see a failure yet, the retry loop is still running. Use `markRunning` + persist *before each attempt* (which sets `status: running`); only on the final failure (after the loop exits) does `markFailed` + persist run from the scheduler.

**This is consistent with Phase 1's state.js semantics:** `markRunning` sets `status: running` AND increments `attempts`. The retry loop reuses `markRunning` once per attempt. The state file always shows the most-recent attempt's `running` status (with the right `attempts` count) until terminal `success`/`failed` lands.

## JSON Event Format Design

### Format Decision: Single Emitter Abstraction with Two Backends

`src/formatter.js` exports `createTextFormatter()` (Phase 1) and **adds** `createJsonFormatter()` (Phase 2). Both return event subscribers with the same shape: `function onEvent(event) -> void`. The CLI picks one based on `--format`.

**Why one file, two factories** (instead of `src/formatter-json.js`):
- Both share `shouldUseColor` / `shouldUseAscii` (json doesn't use them, but co-location surfaces that no helper is duplicated).
- The ANSI-color helpers are never used by JSON; jsonFormatter doesn't `import` them.
- File grows ~50 LOC (json formatter is shorter than text formatter — no glyphs, no duration formatting beyond passing duration_ns through).

### Event Schema (NDJSON output)

Phase 1's events (architecture.md §Event Stream + Phase 1 line 92–134) already carry: `type`, `id`, `status`, `attempts`, `exit_code`, `duration_ns`, `signal`, `error`. Phase 2 **adds**:

| Field | Source | Type | Purpose |
|-------|--------|------|---------|
| `seq` | scheduler-side counter, single source | integer | Monotonic ordering for consumers under interleaved parallelism (pitfalls.md CC-5 #4) |
| `at` | `new Date().toISOString()` at emit | string | Wall-clock timestamp (pitfalls.md N4: hrtime for *durations*, Date.now-equivalent for *stamps*) |

**`seq` generation:** A `let seqCounter = 0` closure in `runFlow`. Every `onEvent({...})` call site mutates the event to add `seq: ++seqCounter`. Because `.then` continuations run on the JS microtask queue (single-threaded), `seq` increments are race-free without any locking.

**Decision: where seq is added.** Inject **at the emit site in scheduler**, NOT in the formatter. Reason: a future `--format text` consumer of the scheduler events would have wanted seq too (for debug logs); the formatter is the rendering layer, not the canonical event surface.

### Conversion of `duration_ns` for JSON

Phase 1 emits `duration_ns: BigInt`. JSON.stringify cannot serialize BigInt — throws `TypeError: Do not know how to serialize a BigInt`. Three options:
1. Convert to Number at emit (`Number(durationNs)` — loses precision above 2^53 ns ≈ 100 days; safe for any task we'd run)
2. Convert to string at emit (`durationNs.toString()`)
3. Leave as BigInt and use a JSON.stringify replacer

**Recommendation: option 1** (`Number(durationNs)` at scheduler emit time). Simplest, no consumer-side parsing. Whooflow will never run a single task for >100 days. Document the assumption in a code comment.

**Implementation:** in scheduler.js, when constructing the success/failed event, replace `duration_ns: durationNs` with `duration_ns: Number(durationNs)`. Phase 1's text formatter expected BigInt for its `formatDuration` helper — update `formatDuration` to handle Number too (or keep BigInt path AND add a Number path; both are 4-line additions).

### `structuredClone` Usage

**The pitfall to defend (pitfalls.md CC-5 #4 + idea brief):** events that embed state snapshots should not be retroactively mutated by subsequent state writes. Concrete scenario: an event embeds `state.tasks.parse` reference; later the scheduler mutates `state.tasks.parse.status = 'success'`; if a downstream consumer hasn't yet processed the event, it sees the mutated status, not the historical one.

**Phase 1's events do NOT embed full state snapshots.** They carry per-task fields (`id`, `status`, `attempts`, `exit_code`, `duration_ns`) by *value* (primitives). No reference issue exists today.

**Phase 2's options:**
- **Option A (recommended):** Keep the current event shape. No `structuredClone` needed — all fields are already pass-by-value primitives.
- **Option B (defensive):** `structuredClone(event)` once at the JSON formatter boundary, before `JSON.stringify`. Costs ~5μs per event for typical event sizes; negligible. Future-proofs against accidental embedding of mutable refs.

**Decision: Option B.** The roadmap success criterion 4 explicitly calls for `structuredClone` of state snapshots — even if Phase 2's events don't embed them, doing the clone at the formatter boundary establishes the discipline so any future event-shape change (e.g., embedding `currentState` for richer dashboards) can't introduce subtle mutation bugs. Cost is trivial.

### NDJSON Discipline (Pitfall N1)

The single emit pattern:
```js
process.stdout.write(JSON.stringify(structuredClone(event)) + '\n');
```

Hard rules:
- **Exactly one `process.stdout.write` call per event.** No `console.log` (it appends `\n` differently and may interleave on some terminals).
- **No pretty-printing.** `JSON.stringify(event)` (no `null, 2` indent) — single-line output.
- **`\n` literal in the format string.** Not platform-dependent line endings — NDJSON spec is `\n`, not `\r\n`.
- **All diagnostic output goes to `process.stderr`.** This is already established in Phase 1 (cli.js lines 75, 96, 137 all use `process.stderr.write`). Phase 2 must continue this discipline.
- **No interleaving of text + json.** When `--format json`, the text formatter is NOT subscribed. Single subscriber.

### Test Plan for JSON Output

1. Capture stdout from a 4-task diamond run with `--format json`.
2. Split on `\n`, filter empty lines, `JSON.parse` each.
3. Assert every parse succeeds.
4. Assert every event has `seq` field, integer, strictly monotonic.
5. Assert every event has `type`, `id` (for `task` events), `status` (for `task` events), `at` (ISO string).
6. Assert no diagnostic text appears on stdout (no `whooflow:` prefixed lines).

## Pre-flight Commands (`--dry-run`, `--list`)

### `--list` (CLI-06)

**Output format:** Text-only (independent of `--format` flag). Prints to stdout. Each line: `<task-id>` followed by indented `depends on: <id1>, <id2>, ...` if any.

```
$ whooflow run --file flow.json --list
fetch
parse
  depends on: fetch
report
  depends on: parse
```

**Algorithm:** Iterate `validatedFlow.topoOrder`. For each id, print id + (if `flow.tasks[id].depends_on.length > 0`) "depends on: " + comma-joined deps.

**Exit codes:** 0 if validation succeeded (we got past `validateFlow`), 2 if validation/cycle error (those errors already cause `validateFlow` to throw, which the CLI catches and exits 2 — same path as `run`).

**Implementation site:** `src/preflight.js exports printList(validatedFlow, out = process.stdout)`. CLI dispatches to it after `loadFlow + validateFlow` succeed and *before* `assertWritable`/`buildInitialState`.

### `--dry-run` (CLI-05)

**Output format:** Text-only. Prints "planned execution waves" to stdout. Each wave is a depth-grouping of tasks that would run together at unbounded concurrency. **Note: this is purely for display — the runtime scheduler is slot-based, not wave-based.**

```
$ whooflow run --file flow.json --dry-run
wave 1: fetch
wave 2: parse
wave 3: report
```

For a diamond:
```
wave 1: A
wave 2: B, C
wave 3: D
```

For 100 independent tasks:
```
wave 1: t1, t2, t3, ..., t100
```

**Depth-grouping algorithm** (over the readiness graph):
```
depth: { [id]: max(depth[parent]) + 1 } if parents exist; else 0
waves: array indexed by depth, each entry is the array of task ids at that depth
```

In code:
```js
// src/preflight.js
export function computeDepthWaves(validatedFlow) {
  const depth = Object.create(null);
  const waves = [];

  // topoOrder guarantees parents are visited before children.
  for (const id of validatedFlow.topoOrder) {
    const parents = validatedFlow.tasks[id].depends_on;
    let d = 0;
    for (const p of parents) d = Math.max(d, depth[p] + 1);
    depth[id] = d;
    if (!waves[d]) waves[d] = [];
    waves[d].push(id);
  }
  return waves;
}

export function printDryRun(validatedFlow, out = process.stdout) {
  const waves = computeDepthWaves(validatedFlow);
  for (let i = 0; i < waves.length; i++) {
    out.write(`wave ${i + 1}: ${waves[i].join(', ')}\n`);
  }
}
```

This is structurally identical to PAN's `preview.cjs::computeParallelBatches` (research/architecture.md §Pattern 1 already cites this). The depth grouping is deterministic given `topoOrder` (which is already deterministic per SCHED-05).

**Exit codes:** 0 if validation succeeded, 2 if not. Same dispatch logic as `--list`.

### CLI Plumbing for `--dry-run` and `--list`

In `src/cli.js`, after the existing `loadFlow + validateFlow` (lines 122–123):

```js
if (parsed.values.list) {
  printList(validatedFlow);
  return 0;
}
if (parsed.values['dry-run']) {
  printDryRun(validatedFlow);
  return 0;
}
// ...continue to assertWritable + runFlow
```

Add to the parseArgs config:
```js
options: {
  // existing...
  format: { type: 'string', default: 'text' },        // CLI-04
  'dry-run': { type: 'boolean' },                       // CLI-05
  list: { type: 'boolean' },                            // CLI-06
}
```

**Validation:** `parsed.values.format` must be `'text'` or `'json'`. Reject other values with exit 2 + clear error: `whooflow: --format must be 'text' or 'json' (got 'xml')`.

**Mutual exclusivity:** `--list` and `--dry-run` are independent of `--format` (both always print text). If both `--list` and `--dry-run` are passed, prefer `--list` (idea: `--list` is "structural" while `--dry-run` is "what will I do" — `--list` is more fundamental). Document but don't enforce: in code, check `--list` first, return; then check `--dry-run`, return.

## Resource Discipline (Pitfalls M3, M6)

### Listener Removal & FD Hygiene Under N Concurrent Children

Phase 1's executor.js attaches per-spawn listeners (`child.on('error', ...)`, `child.on('close', ...)`) — these are scoped to the `child` instance. When the task's promise resolves and the scheduler advances, the `child` reference is dropped and the listeners are GC'd along with it. **No accumulation.**

What we MUST NOT do in Phase 2:
- Add `process.on(...)` listeners per task — would leak.
- Use `child.stdout.on('data', ...)` without removing it on `'close'` — would leak buffer chunks.
- Use `EventEmitter` that outlives the task without `removeListener`.

Phase 1 already uses `stdio: 'inherit'` (executor.js line 24) — this means **no `child.stdout.on('data')` listeners at all**. Live output streams directly to the parent's stdout/stderr. **Keep this for Phase 2.**

### Single SIGINT Handler at Startup (Pitfall M6)

**Phase 2 must add a single SIGINT handler at CLI startup**, NOT per-task. The handler:
1. Sets a `cancelled` flag (or aborts an `AbortController`).
2. Stops accepting new tasks: `pump()` should check the flag at the top of its while loop and break.
3. For each running child: `child.kill('SIGTERM')`, then schedule SIGKILL via `setTimeout(() => child.kill('SIGKILL'), 5000)` if not yet exited. (Phase 1's executor.js doesn't track `child` references for kill — Phase 2 needs to expose `cancel()` from `runTaskWithRetry` or hold a registry of `Set<ChildProcess>`.)
4. Writes final state (in-progress tasks remain `running` per spec).
5. Exits with code 130 on POSIX, 1 on Windows (per pitfalls.md M6).

**Decision: defer SIGINT-kill-children to Phase 3.** Phase 2 needs **only** the listener-registration discipline (single handler at startup, named function so it can be removed if ever needed) — not the full kill/drain protocol, which is Phase 3's domain (idea.md Phase 3 success criterion 4: "single SIGINT handler at startup drains running children with SIGTERM-then-SIGKILL"). Phase 2's job: establish the *registration shape* without leaking.

Concrete Phase 2 code (in `src/cli.js main()` start):
```js
// Single SIGINT handler at startup. Phase 2: just record cancellation; Phase 3 will
// drain running children. Named function for symmetric removeListener if needed.
function handleSigint() {
  // Set a flag the scheduler can check; for Phase 2 we just exit gracefully.
  // (Phase 3 will replace with SIGTERM-then-SIGKILL drain protocol.)
  process.exitCode = process.platform === 'win32' ? 1 : 130;
}
process.on('SIGINT', handleSigint);
process.on('SIGTERM', handleSigint);
```

**MaxListenersExceededWarning prevention:** the above runs once per CLI invocation. Total listeners on `process`: 2 (SIGINT, SIGTERM). Well under the default 10 max.

### Named Handlers in `child.on('close')` Cleanup

Phase 1 already uses anonymous arrow functions (`child.on('close', (code, signal) => {...})`). These work but can't be removed via `removeListener`. **Phase 2 should keep using arrow handlers** — the `child` is short-lived and GC handles cleanup. Switching to named handlers buys nothing for the per-spawn case. (The "named handler" prescription in pitfalls.md M3 applies to *long-lived emitters*: `process`, scheduler-level emitters — none of which we have.)

## Testing Strategy

### Goals
- Deterministic. Mock timers + injectable RNG = no real `setTimeout`-based flakes.
- Sub-3-second total suite. Phase 1 ships 71 tests; Phase 2 should add ~20–30 (retry math, JSON discipline, parallel timing, preflight).
- Cross-platform. All `cmd` strings use `node -e "..."` — never `sh -c`, never bare `echo`.

### Per-Concern Test Plans

#### Concurrency (SCHED-02, SCHED-03, SCHED-04, M2)
- **`test/parallel.test.js` — 100-trivial-task perf gate (SCHED-04):** Build a 100-task fixture in test setup (programmatically — don't commit a 100-task JSON). Each task is `cmd: "node -e \"\""`. All independent (no `depends_on`). Run with `concurrency: 4`. Assert `elapsed < 3000ms`. Use `Date.now()` deltas with generous bound (`< 4000ms` actual to absorb CI jitter — pitfall M4).
- **`test/parallel.test.js` — slow+fast wall-clock (SCHED-03, M2):** 1 slow task (`node -e "setTimeout(()=>{}, 200)"`) + 4 fast tasks (`node -e "setTimeout(()=>{}, 50)"`), all independent, `concurrency: 2`. Assert `elapsed > 150 && elapsed < 350`. Confirms slot-based behavior (slow occupies one slot continuously; 4 fasts share other slot serially → ~200ms total) NOT batch-based (which would be ~250ms).
- **`test/parallel.test.js` — concurrency=1 ordering (regression for M2):** 5-task linear chain, `concurrency: 1`. Assert order matches Phase 1 semantic (a, b, c, d, e in order). Verifies the cap=1 path still works after lift.

#### Retry (EXEC-03, EXEC-04, EXEC-05, C7)
- **`test/retry.test.js` — math correctness:** Inject `randomFn = () => 0.5` (deterministic). Inject `sleepFn = (ms) => { sleeps.push(ms); return Promise.resolve(); }`. Assert: 3 attempts → 2 sleeps. Sleep[0] ≈ baseMs * 0.75 (jitter midpoint); Sleep[1] ≈ baseMs * 1.5; Sleep[2] ≈ baseMs * 3.0. Off-by-one: 1 attempt → 0 sleeps; 2 attempts → 1 sleep.
- **`test/retry.test.js` — cap:** `attempts: 20, backoff_ms: 1000` would give `1000 * 2^19 = 524s` uncapped. Inject sleepFn, assert all sleeps ≤ MAX_BACKOFF_MS (30000) after jitter (so ≤ 30000).
- **`test/retry.test.js` — persist-before-sleep ordering (EXEC-05):** Track `persistAttempt` calls and `sleepFn` calls in a single array (interleaved). Assert: every `sleep(ms)` is preceded by a `persistAttempt(n)` *for the next* attempt.
- **`test/parallel.test.js` — slot-hold at concurrency=1 (EXEC-04):** 5-task linear chain. Middle task has `cmd: "node -e \"const fs=require('fs'); const p='./attempt.txt'; const n = fs.existsSync(p)?Number(fs.readFileSync(p,'utf8'))+1:1; fs.writeFileSync(p,String(n)); if(n<3) process.exit(1)\"", retry: { attempts: 3, backoff_ms: 50 }`. (The marker file lives in the test's scratch dir.) Run with `concurrency: 1`. Assert: flow completes; final state shows middle task `success` with `attempts: 3`; total wall-clock < 5000ms.
- **`test/retry.test.js` — retry-then-success real spawn:** Same marker-file pattern but smaller (2 attempts). Verify executor does retry + succeeds. (Integration check, not just unit.)
- **`test/retry.test.js` — retry-then-fail real spawn:** Task always fails (`node -e "process.exit(1)"`), `attempts: 2, backoff_ms: 10`. Verify final state: `status: failed, attempts: 2, exit_code: 1`. Verify scheduler sees one `failed` event, not two.

#### JSON Format (CLI-04, N1, CC-5 #4)
- **`test/json-formatter.test.js` — NDJSON discipline:** Capture stdout from `createJsonFormatter()`-fed events for a synthetic event sequence. Assert: `out.split('\n').filter(s=>s.length).every(line => JSON.parse(line))`. Every line parses, no `\r`, no pretty-print indentation.
- **`test/json-formatter.test.js` — seq monotonicity:** Run a 4-task diamond. Capture stdout. Parse each line. Assert: `events.map(e => e.seq)` is strictly increasing starting from 1.
- **`test/json-formatter.test.js` — structuredClone snapshot safety:** Pass a synthetic event with a nested mutable object. After emit, mutate the original. Assert the parsed JSON event's nested field is unchanged.
- **`test/integration.test.js` (new test)** — full subprocess invocation with `--format json`. Capture stdout + stderr separately. Assert stdout is all-NDJSON (every line parses). Assert stderr has *no* JSON lines (text diagnostics only). Assert no interleaving.

#### Pre-flight (CLI-05, CLI-06)
- **`test/preflight.test.js` — `--list` output:** Linear, diamond, 100-task. Capture stdout. Assert exact line count + exact format ("id" or "id\n  depends on: ...").
- **`test/preflight.test.js` — `--dry-run` waves:** Linear → 3 waves; diamond → 3 waves with B,C in wave 2; 100-independent → 1 wave with 100 entries.
- **`test/preflight.test.js` — exit codes:** Valid flow + `--list` → exit 0. Cycle fixture + `--list` → exit 2 (cycle error path through validateFlow).
- **`test/preflight.test.js` — depth grouping correctness:** Programmatically build flows with known depth structures. Assert `computeDepthWaves` matches.

### Determinism Levers
- `randomFn` injectable in retry.js — tests pin to `() => 0.5`.
- `sleepFn` injectable in retry.js — tests use a fake that resolves immediately and records call args.
- `seqCounter` reset per `runFlow` call — tests can assert `seq: 1, 2, 3, ...` exactly.
- Real spawn tests use `node -e` only (Phase 1 discipline preserved).
- Use `mkdtempSync` per-test (Phase 1 pattern, see test/scheduler.test.js).
- For wall-clock assertions, use `< upper_bound` only (never `> lower_bound` — pitfall M4).

## Files Modified / Created — Exhaustive Manifest

For plan-level dependency analysis. "M" = modified, "N" = new.

| Status | File | Why |
|--------|------|-----|
| M | `src/scheduler.js` | (1) Wire `cap = opts.concurrency` (one line). (2) Add `seqCounter` + `seq` field on every emitted event. (3) Replace `runTask(task)` (line 100) with `runTaskWithRetry(task, persistAttemptFn)`. (4) Convert `duration_ns` BigInt to Number at emit (`duration_ns: Number(durationNs)`). (5) Add cancellation-flag check in `pump()` while-condition (P2 minimal — flag-only; P3 adds drain protocol). |
| M | `src/executor.js` | No structural change. Possibly a minor refactor to expose `runTask` as the single-attempt primitive that retry.js consumes (already exported). |
| M | `src/formatter.js` | Add `createJsonFormatter()` factory exported alongside `createTextFormatter()`. JSON variant: `process.stdout.write(JSON.stringify(structuredClone(event)) + '\n')`. Update `formatDuration` to handle Number duration_ns (keep BigInt branch for back-compat in case a test calls the formatter directly with BigInt). |
| M | `src/cli.js` | (1) Add `format`, `dry-run`, `list` to parseArgs options. (2) Validate `--format`. (3) Branch dispatch: `--list` → `printList` + return 0. `--dry-run` → `printDryRun` + return 0. (4) Replace `concurrency: 1` (line 132) with `concurrencyN`. (5) Pick formatter based on `parsed.values.format`. (6) Install single SIGINT/SIGTERM handler at startup. (7) Update `printHelp` to document new flags. |
| M | `package.json` | No version bump needed for Phase 2 (pre-1.0). May add `"description"` polish, no behavior change. |
| M | `test/scheduler.test.js` | Update existing tests to expect `seq` field on events. (Or relax assertions to allow unknown fields — pick ergonomics.) |
| M | `test/integration.test.js` | Add `--format json` integration tests. Add `--list` and `--dry-run` integration tests. |
| M | `test/cli.test.js` | Add unit tests for new flags (parsing, validation of `--format` value). |
| N | `src/retry.js` | `runTaskWithRetry(task, opts)` — retry loop, backoff math, jitter, cap, injectable timer/RNG, persist-before-sleep. ~50 LOC. |
| N | `src/preflight.js` | `printList(validatedFlow, out)`, `computeDepthWaves(validatedFlow)`, `printDryRun(validatedFlow, out)`. ~80 LOC. |
| N | `test/retry.test.js` | Retry math, off-by-one, cap, jitter, persist-before-sleep ordering, retry-then-success real spawn, retry-then-fail real spawn. ~150 LOC. |
| N | `test/json-formatter.test.js` | NDJSON discipline, seq monotonicity, structuredClone safety, no-stderr-mixing. ~80 LOC. |
| N | `test/preflight.test.js` | `--list` and `--dry-run` output, depth-grouping algorithm correctness, exit codes. ~100 LOC. |
| N | `test/parallel.test.js` | 100-task perf gate, slow+fast wall-clock, concurrency=1 retry-holds-slot integration. ~120 LOC. |
| N | `test/fixtures/parallel-trivial-100.json` | Generated programmatically in test setup (don't commit a 100-task fixture file). |
| N | `test/fixtures/slow-and-fast.json` | 1 slow + 4 fast independent tasks. |
| N | `test/fixtures/retry-success.json` | Marker-file flow (succeeds on attempt 3). |
| N | `test/fixtures/retry-fail.json` | Always-failing task with `retry.attempts: 2`. |
| N | `test/fixtures/concurrency-1-retry-chain.json` | 5-task linear chain with middle-retry task. |

**Plan-level dependency hint** (for the planner):
- Plan A (concurrency lift + scheduler invariants) — depends on nothing. Modifies scheduler.js + cli.js + parallel.test.js. Could be done in isolation.
- Plan B (retry wrapper) — depends on Plan A *only* if both touch scheduler.js — they do, but the conflict is small (Plan A changes one constant; Plan B replaces one function call). Either could go first; planner can serialize.
- Plan C (JSON formatter + seq) — depends on Plan A's `seq` plumbing in scheduler.js. Plan B independently touches retry, no conflict with C.
- Plan D (preflight + listener discipline) — depends on Plan C if `--format` flag plumbing is in cli.js (which it is). Otherwise independent.

Recommended order: **A → B (parallel can start C) → C → D.** Or four parallel plans with a merge step.

## Pitfall Defenses Summary

| Pitfall | Mitigation in Phase 2 | Test |
|---------|----------------------|------|
| **M2** wave-vs-slot starvation | Slot-based ready-queue is already in place from Phase 1; Phase 2 just lifts the cap | `test/parallel.test.js` slow+fast wall-clock (~200ms target, NOT 250ms) |
| **M2** deadlock-at-N=1 with retry | retry loop doesn't release the slot during sleep — `runTaskWithRetry` is awaited inside the scheduler's `.then` chain; slot stays in `running` Set | `test/parallel.test.js` concurrency=1 5-task chain with middle-retry |
| **C7** DoS-by-retry-storm (no jitter, off-by-one, attempts not persisted, no cap) | (a) `MAX_BACKOFF_MS = 30_000` cap. (b) Equal jitter (0.5–1.0× multiplier). (c) `attempts: N` = N total runs (loop is `for attempt = 1..N`). (d) `persistAttempt(n)` called BEFORE `runTask` AND BEFORE sleep. | `test/retry.test.js` math + cap + persist-before-sleep |
| **M3** FD/listener leaks under high concurrency | (a) Phase 1 uses `stdio: 'inherit'` — no per-spawn data listeners. (b) Per-spawn listeners are on the `child` (GC'd when promise resolves). (c) Phase 2 adds *one* SIGINT/SIGTERM handler at CLI startup — never per-task. (d) No `process.on(...)` calls anywhere except CLI startup. | `test/parallel.test.js` 100-task perf gate (also implicitly checks no `MaxListenersExceededWarning` since the suite captures stderr) |
| **M1** skip cascade fired on individual attempt failure | Retry loop is *internal* to executor wrapper; scheduler sees one final `ok|fail` per task. (Phase 3's skip-downstream BFS will fire only on terminal `failed` — that's the next phase, not Phase 2's concern.) | Implicit: scheduler tests still pass with single failed event per task; no per-attempt event reaches `onEvent` |
| **N1** pretty-printed / log-mixed JSON | Single `process.stdout.write(JSON.stringify(event) + '\n')` per event. No multi-line. Diagnostics only on stderr. | `test/json-formatter.test.js` + `test/integration.test.js` |
| **CC-5 #4** (monotonic seq under interleaved parallelism) | `seqCounter` closure in `runFlow`; every emit increments via `++seqCounter`; race-free because `.then` runs on JS microtask queue (single-threaded). | `test/json-formatter.test.js` strict-monotonic assertion |
| **N4** Date.now for durations | Phase 1 already uses `process.hrtime.bigint()` deltas (scheduler line 91/103). Phase 2 converts to Number for JSON (loses precision above ~100 days; documented). | `test/json-formatter.test.js` duration_ns is finite Number |
| **M4** test flakiness from timing | Generous upper bounds (`< 350ms` not `=== 200ms`). Mock timers in retry tests. `node -e "setTimeout(()=>{}, N)"` instead of `sleep`. | All timing tests use upper-bound only |
| **M6** SIGINT handler | Phase 2 establishes single-handler-at-startup discipline (named function, registered once). Phase 3 adds the SIGTERM-then-SIGKILL drain protocol. | Verified by code review of cli.js (no `process.on` inside loops) |

## Open Questions

1. **`AbortController` for sleep cancellation in Phase 2 vs Phase 3.**
   - What we know: stack.md recommends `AbortController` (global since Node 15) for cancellable backoff sleeps. Phase 2 might want this for "stop accepting tasks on SIGINT" semantics.
   - What's unclear: does Phase 2 need full SIGINT-cancels-sleep behavior, or is "let the run finish, exit code 130 next time" sufficient?
   - **Recommendation:** Phase 2 includes `signal?: AbortSignal` parameter in `runTaskWithRetry` (architecturally ready), but the CLI does NOT pass an active signal — the signal is `null`/`undefined`. Phase 3 wires the actual signal in. This way the retry.js shape is final in Phase 2, but Phase 3 adds the runtime behavior.

2. **`duration_ns` as Number vs BigInt in JSON events.**
   - What we know: BigInt can't be `JSON.stringify`'d. Number loses precision above 2^53 ns ≈ 100 days.
   - What's unclear: should we serialize as `duration_ms` (already-divided integer) instead? Cleaner but loses sub-millisecond precision.
   - **Recommendation:** Keep `duration_ns` as Number (converted at emit). Document the >100-day caveat. Test with very small durations (50ms = 50_000_000 ns) to verify round-trip.

3. **`--format json` and the text formatter co-existing.**
   - What we know: CLI picks one based on `--format`. They're mutually exclusive.
   - What's unclear: should there be a `--format both` for development? Does any user actually want this?
   - **Recommendation:** No. v1 ships text or json. If needed in v1.x, add as a discrete flag (`--format text,json`).

4. **`--dry-run` output: human-readable text vs JSON when `--format json` is also set.**
   - What we know: idea brief + roadmap show wave-format text output.
   - What's unclear: if a user passes `--dry-run --format json`, do they expect JSON output of the waves?
   - **Recommendation:** `--dry-run` is text-only regardless of `--format`. The flag is for human sanity-checking. If JSON-of-waves is needed in future, add a flag (`--print-waves-json`). Document in `--help`.

5. **`signal` field in events when `--format json`.**
   - What we know: Phase 1's executor returns `signal` (e.g., 'SIGTERM') if the child was signal-killed. Currently propagates through to formatter.
   - What's unclear: should JSON events expose the signal name?
   - **Recommendation:** Yes. Include `signal: result.signal ?? null` in failed events. Useful for debugging tooling.

## Sources

### Primary (HIGH confidence) — referenced from project research
- `.planning/research/architecture.md` — §Pattern 1 (Ready-Queue Scheduler), §Pattern 4 (Retry-Backoff Per-Task Wrapper), §Component Responsibilities, §Anti-Pattern 1 (Strict Wave/Batch Execution)
- `.planning/research/stack.md` — `AbortController`, `structuredClone`, `process.hrtime.bigint`, `setTimeout` with signal cancellation, `node:test` with mock timers, `parseArgs` for new flags
- `.planning/research/pitfalls.md` — C7 (full retry-storm prescription), M2 (wave/slot + deadlock-at-N=1), M3 (FD/listener leaks), M4 (test flakiness), M6 (signal handling), N1 (NDJSON discipline), CC-5 #4 (monotonic seq)
- `.planning/research/features.md` — DF-1 (NDJSON event stream), DF-3 (`--dry-run`), DF-4 (`--list`), TS-3 (concurrency cap), TS-4 (parallel independent tasks), TS-6 (retry with backoff)
- `.planning/idea.md` — locked spec: retry shape `{attempts, backoff_ms}`, `--format text|json`, scheduler overhead < 5ms, 100 trivial tasks under 3s

### Phase 1 deliverables (HIGH confidence — directly inspected)
- `src/scheduler.js` — current `runFlow` shape with `cap = opts.concurrency ?? 1`, ready-queue, indegree, pump loop
- `src/executor.js` — current `runTask` with `'close'` discipline + spawn-error fallback
- `src/formatter.js` — `createTextFormatter` event-subscriber shape; `shouldUseColor`/`shouldUseAscii` helpers
- `src/cli.js` — `parseArgs` config, dispatch, exit-code mapping
- `src/state.js` — `markRunning` (auto-increments `attempts`), `atomicWriteJson`
- `.planning/phases/01-parse-validate-sequential-run-atomic-state/01-04-summary.md` — scheduler shape rationale, "do NOT replace with for-loop"
- `.planning/phases/01-parse-validate-sequential-run-atomic-state/01-verification.md` — what's already verified, recommendations for Phase 2

### Secondary (MEDIUM confidence)
- AWS Architecture Blog on "Exponential Backoff and Jitter" — Equal Jitter formula `delay = capped * (0.5 + random*0.5)` (referenced in stack.md and pitfalls.md C7)

## Infrastructure Dependencies

None. Phase 2 ships unit tests + integration tests against scratch directories created with `mkdtempSync`. No Docker, no external services. The 100-trivial-task perf test runs entirely in-process (each task is `node -e "\"\""`).

## Metadata

**Confidence breakdown:**
- Architectural changes: HIGH — Phase 1's existing scheduler is *already* the architecture.md Pattern 1 ready-queue; Phase 2 lifts the cap and adds three orthogonal layers (retry wrapper, JSON formatter, preflight). Refactor scope is small and well-bounded.
- Retry math: HIGH — formula is verified against AWS canonical source; off-by-one and persistence-ordering are explicit; tests are deterministic via injectable RNG/timer.
- JSON event format: HIGH — NDJSON discipline is established in Phase 1 (stdout/stderr discipline); Phase 2 adds the json branch + seq counter + structuredClone defensively.
- Pre-flight: HIGH — depth-grouping over `topoOrder` + `depends_on` is a 10-line algorithm; output format is unambiguous.
- Resource discipline: MEDIUM — Phase 2 establishes the single-SIGINT-at-startup pattern but defers the SIGTERM-then-SIGKILL drain to Phase 3. The deferral is intentional and matches roadmap; verify the planner doesn't over-scope.
- Pitfall defenses: HIGH — each pitfall has a named test in the testing plan.

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (30 days; Phase 2 should ship within 1–2 weeks given Phase 1's velocity)

---

## RESEARCH COMPLETE

**Phase:** 2 - Concurrency + Retry/Backoff + JSON Format
**Confidence:** HIGH

### Key Findings
- Phase 1's slot-based ready-queue is already the correct shape. The "concurrency lift" is literally a one-line change (`cap = opts.concurrency` is already wired); the work is verifying invariants under N concurrent tasks via the test suite.
- Retry sits in a new `src/retry.js` (~50 LOC) — `runTaskWithRetry(task, opts)` wraps Phase 1's `runTask`. State persistence happens via a callback (`persistAttempt(n)`) so retry.js stays free of state.js imports — clean test seam. The slot-holding semantic at concurrency=1 is structural (retry is awaited inside the scheduler's `.then` chain), not a separate code path.
- JSON formatter is a sibling factory in `src/formatter.js` (`createJsonFormatter` next to `createTextFormatter`). The `seq` counter lives in the scheduler (single source of monotonicity). `structuredClone` is applied at the JSON formatter boundary defensively. `duration_ns` converts BigInt→Number at the scheduler emit point.
- `--dry-run` and `--list` use a single new file `src/preflight.js` (~80 LOC) with `computeDepthWaves` + `printList`. Both validate-then-exit-0 (or exit 2 on cycle/schema error via the existing CLI error path).
- Files modified: 5 source files + 3 test files. Files created: 2 source files + 4 test files + 5 fixtures (some generated programmatically). Plan-level work decomposes naturally into 4 plans (concurrency lift, retry, JSON, preflight) with one sequential dependency (retry consumes the executor seam; JSON consumes the seq plumbing in scheduler).

### File Created
`.planning/phases/02-concurrency-retry-backoff-json-format/02-research.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Architectural changes from Phase 1 | HIGH | Phase 1's slot-based scheduler structure was deliberately built for this lift; Phase 1 summary (01-04) explicitly says "Phase 2 lifts cap=1 with one line." |
| Slot-based scheduler design | HIGH | Pattern 1 from architecture.md; already implemented; invariants enumerated. |
| Retry-with-backoff design | HIGH | Formula verified against AWS canonical source; off-by-one and persistence-ordering explicitly defended; injectable timer/RNG keeps tests deterministic. |
| JSON event format | HIGH | NDJSON discipline already established in Phase 1; seq generation site (scheduler) is unambiguous; structuredClone is defensive insurance. |
| Pre-flight commands | HIGH | Depth-grouping is a 10-line algorithm over data the validator already produces; CLI plumbing is additive. |
| Resource discipline | MEDIUM | Phase 2 establishes single-SIGINT pattern but defers full drain protocol to Phase 3 — confirmed against roadmap; planner must not over-scope. |
| Testing strategy | HIGH | Each requirement has a named test. Determinism levers (mock timers, RNG, seqCounter) are clearly scoped. |
| Pitfall defenses | HIGH | M2, C7, M3, M1, N1, CC-5 #4 each have explicit code-level guards + tests. |

### Open Questions
1. `AbortController` signal threading: include parameter in `runTaskWithRetry` interface in Phase 2 (shape only), wire actual signal in Phase 3.
2. `duration_ns` Number vs BigInt vs ms-only: Number recommended; >100-day caveat documented.
3. `--dry-run` output format under `--format json`: text-only regardless; orthogonal flag in v1.x if requested.
4. `signal` field in JSON failed events: include for debugging.

### Ready for Planning
Research complete. Planner can now create 4 plan.md files (concurrency lift → retry → JSON formatter → preflight + listener discipline) or 4 parallel plans with a merge step. Recommended order documented in §Files Modified / Created.
