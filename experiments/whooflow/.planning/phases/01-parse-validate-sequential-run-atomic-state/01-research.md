# Phase 1: Parse + Validate + Sequential Run + Atomic State - Research

**Researched:** 2026-05-02
**Domain:** Zero-dependency Node.js CLI scaffolding for DAG task runner — parse + validate + sequential exec + atomic state
**Confidence:** HIGH (project-level research already exhaustive — this file emits Phase-1-specific deltas only, per P-1402)

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions

#### From idea.md (locked spec items)

- **Flow file format is JSON only.** Each task has `id` (required, unique non-empty string), `cmd` (string, run via shell), optional `depends_on` (array of ids, default `[]`), optional `retry` (`{attempts: int >= 1, backoff_ms: int >= 0}`). YAML and function-call task shapes are explicitly out of scope — preserves the zero-dep constraint.
- **State file is `whooflow.state.json` next to the flow file.** Each task entry: `{status: pending|running|success|failed|skipped, attempts, started_at, ended_at, exit_code}`. Written atomically after each task completes.
- **Cycle detection runs BEFORE any task starts.** Malformed `a→b→a` exits with `error: cycle detected: a → b → a` and exit code 2.
- **Output `--format text` prints a tree** of `[ ✓ ] task-id (Ns)`, `[ x ] task-id (failed after N attempts)`, `[ - ] task-id (skipped)`. The JSON format lands in Phase 2; Phase 1 only needs `--format text`.
- **Cross-platform `cmd` execution** via `child_process.spawn` with `shell: true`. Tests use OS-portable invocations (`node -e "..."`, never `sh -c` or bare `echo`).
- **Crash safety:** writing state uses write-to-`.tmp`-then-rename. If process killed mid-task, state shows that task as `running` (not lost). Phase 1 establishes this contract; full resume logic is Phase 3.
- **Decision principle:** correctness over fanciness. A runner that always finishes in DAG-valid order with no surprises is the goal.

#### From project.md Key Decisions (ratified before planning)

- **Node floor `>=18.17`** (not `>=16`) — gives `node:util parseArgs`, `node:test`, `structuredClone` natively. First task of Phase 1's first plan: set `engines.node` in `package.json`.
- **JSON flow files only** — preserve zero-dep constraint.
- **Atomic state writes** use write-tmp + `fsyncSync` + rename (not just rename). Same-directory tmp file (never `os.tmpdir()`). Windows EPERM/EBUSY retry 2-3× before failing.
- **Skip-downstream propagates only on terminal fail** — relevant in P3 but the state-shape Phase 1 establishes must accommodate this (so the `failed` status reflects "after all retries exhausted," not "current attempt failed").

#### From requirements.md (Phase 1 mapped REQ-IDs — locked scope)

CLI-01, CLI-02, CLI-07, CLI-08, CLI-09, CLI-10, PARSE-01, PARSE-02, PARSE-03, PARSE-04, PARSE-05, SCHED-01, SCHED-05, EXEC-01, EXEC-02, STATE-01, STATE-02, STATE-03 (18 IDs).

### Claude's Discretion

- Module file layout (`src/cli.js`, `src/loader.js`, etc. vs `src/lib/...`) — planner picks
- Naming of internal helpers (`normalizeFlow`, `validateFlow`, `runTask`, etc.)
- Test file organization (one test file per module vs grouped)
- Test fixture data (JSON flow files for the test suite)
- Comment density and inline doc style
- ESM `import` form (named vs default)
- Whether to use `.cjs` or `.mjs` extensions or `"type": "module"` in package.json (recommend `"type": "module"` + `.js`)
- Specific ANSI escape codes for colors (any reasonable choice)
- Exact glyph fallback table on Windows (`[ v ]` / `[ x ]` / `[ - ]` is suggested but not fixed)

### Deferred Ideas (OUT OF SCOPE)

- Concurrent execution / slot-based scheduler — Phase 2 (Phase 1 only parses `--concurrency` flag)
- Retry with backoff — Phase 2 (Phase 1's executor runs each task exactly once)
- `--dry-run`, `--list`, `--format json` — Phase 2
- `--resume` flag, skip-downstream propagation, dogfood `flow.json` — Phase 3
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | `whooflow run --file <path>` reads JSON flow file | stack.md §1 (`parseArgs`); architecture.md §Components (`bin/whooflow.js` thin shell) |
| CLI-02 | `--concurrency <N>` flag accepted (default 4) | stack.md §1; Phase 1 just parses; concurrent exec is Phase 2 |
| CLI-07 | `--help` and `--version` print usage / version and exit | stack.md §1 (`parseArgs` provides flag surface); features.md TS-12 |
| CLI-08 | TTY-aware color, `NO_COLOR` honored | summary.md CC-5 #3; features.md DF-8; no-color.org spec |
| CLI-09 | Status glyphs `[ ✓ ]` / `[ x ]` / `[ - ]` with ASCII fallback on Windows; per-task duration | summary.md CC-5 #5; features.md TS-13/TS-14 |
| CLI-10 | Exit codes 0/1/2 | features.md TS-5; architecture.md §`errors` (typed errors → exit code map) |
| PARSE-01 | Reject malformed JSON, exit 2 | pitfalls.md M5; architecture.md §`loader` |
| PARSE-02 | Validate `id` unique non-empty, `cmd` string | pitfalls.md M5; architecture.md §`validator` |
| PARSE-03 | Validate `depends_on` references existing ids | pitfalls.md M5; features.md TS-9 |
| PARSE-04 | Validate `retry` shape when present | pitfalls.md M5 |
| PARSE-05 | Cycle detection prints actual cycle path; exit 2 before any spawn | pitfalls.md C1 (Kahn iterative + leftover-DFS); architecture.md §`validator` |
| SCHED-01 | Topological order at concurrency 1 | architecture.md §Pattern 1 (ready-queue, but cap=1 here) |
| SCHED-05 | Deterministic final state | features.md DF-2; pitfalls.md M5 |
| EXEC-01 | `child_process.spawn` with `shell: true` | stack.md §5; pitfalls.md C6 |
| EXEC-02 | Resolve only on `'close'`; null exit code = failure | pitfalls.md C3; stack.md §5 |
| STATE-01 | Per-task entry shape | architecture.md §Data Shapes; idea.md spec |
| STATE-02 | Atomic write tmp + fsync + rename + Windows retry | pitfalls.md C4; summary.md CC-3; stack.md §4 |
| STATE-03 | Write after every task transition (not batched) | architecture.md §Pattern 2 |
</phase_requirements>

## Summary

Per the universal P-1402 directive: project-level research at `.planning/research/{stack,architecture,pitfalls,features,summary}.md` is **already prescriptive and complete** for Phase 1. The Phase 1 builder needs three things this file adds:

1. **Build-order DAG specific to Phase 1's deferred-feature set** (no retry, no concurrency, no resume, no skip — these are Phase 2/3).
2. **Test-fixture catalog** — the exact JSON files Phase 1's test suite needs.
3. **Phase-1 pitfall map** — which pitfalls (from `pitfalls.md`) apply now vs. defer to later phases.

**Primary recommendation:** Build in eight thin plans following the architecture.md §Build Dependency Graph, with `package.json` + `engines.node` as Plan 01 Wave 0 (cross-cutting prerequisite per context.md). Use ESM (`"type": "module"`). One test file per module. Use `node:test` + `node:assert/strict` for everything.

## Standard Stack

@./.planning/research/stack.md

**No deltas for Phase 1.** Every builtin listed in stack.md §"Recommended Stack" is needed in Phase 1 except `AbortController` (P2 retry-cancellation) and `structuredClone` (P2 JSON event format). Phase 1 uses:

- `node:child_process` (`spawn` with `shell: true`, listen for `'close'`)
- `node:fs` (sync subset: `readFileSync`, `writeFileSync`, `openSync`, `fsyncSync`, `closeSync`, `renameSync`, `mkdirSync`, `unlinkSync`)
- `node:path` (`join`, `dirname`, `resolve`)
- `node:util` `parseArgs`
- `node:test` + `node:assert/strict`
- `process.hrtime.bigint()` for durations; `Date.now()` for wall-clock timestamps
- `process.stdout.isTTY` + `process.env.NO_COLOR` for color detection
- `process.platform` for Windows ASCII-fallback glyph detection

## Architecture Patterns

@./.planning/research/architecture.md

### Phase-1-Scoped Module Set

Phase 1 ships **8 modules** (architecture.md describes 10; `clock.js` and `resume.js` defer to P2/P3). The slot-based scheduler is built **structurally complete** in Phase 1 but with `concurrency = 1` hardcoded (Phase 2 lifts the cap):

| Module | File | Phase 1 Scope |
|--------|------|---------------|
| `errors` | `src/errors.js` | Typed errors (`ValidationError`, `CycleError`, `RuntimeError`) + exit-code map |
| `loader` | `src/loader.js` | Read flow file, `JSON.parse`, normalize task shape |
| `validator` | `src/validator.js` | Aggregated schema check + iterative Kahn cycle detection with leftover-DFS path recovery |
| `state` | `src/state.js` | Initial state builder + atomic persist (tmp+fsync+rename + Windows EPERM/EBUSY retry) + transition helpers |
| `executor` | `src/executor.js` | `spawn(cmd, {shell: true})`, resolve on `'close'`, **NO retry loop in P1** (calls executor once per task, decides ok/fail directly) |
| `scheduler` | `src/scheduler.js` | Slot-based ready-queue + indegree map, **`concurrency = 1` hardcoded in P1** (architecturally ready for P2 lift; see code comment) |
| `formatter` | `src/formatter.js` | `--format text` only — status glyphs (Unicode/ASCII per platform) + per-task durations from `hrtime.bigint()` |
| `cli` | `bin/whooflow.js` | `parseArgs` wiring, exit-code mapping, install pipeline |

**Module file layout decision:** `src/*.js` (flat) + `bin/whooflow.js` for the entry shebang. ESM (`"type": "module"`).

### Pattern Application Map

| Pattern (from architecture.md) | Phase 1 use |
|-------------------------------|-------------|
| Pattern 1 (Ready-Queue Scheduler) | YES — but with `cap = 1` so it degenerates to sequential. Pump loop, indegree map, ready array, running set all built |
| Pattern 2 (Atomic State Writes) | YES — full prescription (tmp + fsync + rename + Windows retry) |
| Pattern 3 (Eager Skip-Downstream BFS) | NO — defer to Phase 3. Phase 1 has no `failed` propagation; a failed task just sets exit code 1 at end of run |
| Pattern 4 (Retry-Backoff Per-Task Wrapper) | NO — defer to Phase 2. Phase 1 executor runs each task exactly once |
| Pattern 5 (Resume = Merge Pass) | NO — defer to Phase 3. Phase 1 always builds fresh state from flow |

### Module Build Order (Phase 1)

```
errors  ──┬───────────────────────────────────┐
          ▼                                   ▼
        loader ──▶ validator              state
                       │                    │
                       └────────────▶ scheduler ◀── executor
                                        │
                                        ▼
                                    formatter
                                        │
                                        ▼
                                       cli
```

Three independent roots (`errors`, `state`, `loader`) → maximum Wave 1 parallelism. `validator` after `loader` (needs Flow IR shape). `scheduler` is the integration point built last among lib modules. `cli` last of all.

## Don't Hand-Roll

@./.planning/research/stack.md

**No Phase-1 deltas.** Stack.md §"What NOT to Use" is exhaustive and already prescriptive.

## Common Pitfalls — Phase 1 Subset

@./.planning/research/pitfalls.md

**Phase 1 must defend against the following pitfalls. Each must have a corresponding test or task action.**

| Pitfall | Where it bites | Phase 1 mitigation |
|---------|---------------|---------------------|
| **C1** Recursive DFS / unreadable cycle errors / RangeError on long chains / false-positive diamonds | `validator.js` | **Iterative Kahn** for detection; leftover-DFS for path recovery; print `a → b → c → a`. Test self-loop, 2-cycle, diamond (must accept), 1000-task linear chain (must not RangeError) |
| **C2** Ready-queue starvation from un-normalized `depends_on` | `loader.js`, `scheduler.js` | Normalize at parse: every task gets explicit `depends_on: []` and `retry: {attempts: 1, backoff_ms: 0}`. Indegree decremented only on `success`/`skipped`. Watchdog test: 1-task flow must finish < 1s |
| **C3** Listen on `'exit'` instead of `'close'` → truncated output | `executor.js` | Always resolve on `'close'`. Treat `code === null` (signal-killed) as failure. Code comment because this *will* be re-broken later. Test: high-throughput stdout (>64KB) reports correctly |
| **C4** Atomic write isn't atomic on Windows | `state.js` | Same-directory tmp (`<state>.tmp`) — never `os.tmpdir()`. Sequence: `writeFileSync` → `openSync` → `fsyncSync` → `closeSync` → `renameSync`. Retry 2-3× on Windows EPERM/EBUSY with ~50ms sleep |
| **C6** Cross-platform shell quoting | tests/, fixtures | Test commands use `node -e "console.log('x')"` only — single quotes inside double quotes work in both `cmd.exe` and `sh`. Never bare `echo`, never `sh -c`, never `true`/`false` |
| **M5** Schema accepts garbage that explodes later | `validator.js` | Aggregated error reporter (collect all, not first-fail). Restrict `id` charset (`^[a-zA-Z0-9_][a-zA-Z0-9_.\-]*$`). `Number.isInteger(attempts) && attempts >= 1`; `Number.isFinite(backoff_ms) && backoff_ms >= 0`. Reject `tasks: null`, `tasks: []` (warn, exit 0), duplicate ids, empty/whitespace ids |
| **N1** NDJSON discipline / stderr separation from day one | `formatter.js`, `cli.js` | Diagnostic logs go to **stderr** unconditionally (even though `--format json` lands in P2, establish the pattern now). stdout reserved for the structured event stream |
| **N3** Read-only directory failure surfaces mid-run | `state.js` or `cli.js` | Startup write-test: `writeFileSync(stateFile + '.write-test', '')` then `unlinkSync`. Fail fast with clear "cannot write to <dir>" if it errors |
| **N4** `Date.now()` for both timing and ordering | `formatter.js`, `state.js` | `Date.now()` for **wall-clock timestamps** in state file; `process.hrtime.bigint()` for **durations** displayed to user. Two separate concepts |

**Pitfalls deferred (NOT Phase 1's problem):** C5 (resume), C7 (retry/backoff), M1 (skip cascade timing), M2 (concurrency cap fairness), M3 (FD/listener leaks under concurrency), M4 (timing-test flakiness in parallel), M6 (signal handling), N2 (resume + exit-code), N5 (test-mode interaction).

## Code Examples

### Iterative Kahn with leftover-DFS for cycle path recovery

```js
// src/validator.js
import { CycleError, ValidationError } from './errors.js';

export function detectCycle(flow) {
  // Build indegree map and adjacency.
  const indegree = Object.create(null);
  const children = Object.create(null);
  for (const id of Object.keys(flow.tasks)) {
    indegree[id] = 0;
    children[id] = [];
  }
  for (const task of Object.values(flow.tasks)) {
    for (const dep of task.depends_on) {
      indegree[task.id]++;
      children[dep].push(task.id);
    }
  }

  // Iterative Kahn — process nodes with indegree 0.
  const queue = [];
  for (const id of Object.keys(indegree)) {
    if (indegree[id] === 0) queue.push(id);
  }
  const topo = [];
  // Clone indegree because the algo mutates it.
  const remaining = { ...indegree };
  while (queue.length > 0) {
    const id = queue.shift();
    topo.push(id);
    for (const c of children[id]) {
      if (--remaining[c] === 0) queue.push(c);
    }
  }

  // Leftover nodes form one or more cycles.
  const leftover = Object.keys(remaining).filter(id => remaining[id] > 0);
  if (leftover.length > 0) {
    const path = recoverCyclePath(leftover, children);
    throw new CycleError(`cycle detected: ${path.join(' → ')}`);
  }
  return topo;
}

// Iterative DFS over leftover subgraph to recover one concrete cycle path.
function recoverCyclePath(leftover, children) {
  const leftoverSet = new Set(leftover);
  const start = leftover[0];
  const stack = [{ id: start, path: [start] }];
  const visiting = new Set([start]);
  while (stack.length > 0) {
    const { id, path } = stack[stack.length - 1];
    let found = null;
    for (const c of children[id]) {
      if (!leftoverSet.has(c)) continue;
      if (path.includes(c)) {
        // Cycle closed at c — trim path to start at c.
        const idx = path.indexOf(c);
        return [...path.slice(idx), c];
      }
      if (!visiting.has(c)) {
        found = c;
        break;
      }
    }
    if (found) {
      visiting.add(found);
      stack.push({ id: found, path: [...path, found] });
    } else {
      stack.pop();
      visiting.delete(id);
    }
  }
  // Self-loop edge case: leftover[0] points to itself.
  return [start, start];
}
```

### Atomic state write with Windows retry

```js
// src/state.js
import { writeFileSync, openSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function atomicWriteJson(targetPath, value) {
  const tmpPath = join(dirname(targetPath), `.${require('node:path').basename(targetPath)}.tmp.${process.pid}`);
  const data = JSON.stringify(value, null, 2);
  writeFileSync(tmpPath, data, 'utf8');
  const fd = openSync(tmpPath, 'r+');
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameWithRetry(tmpPath, targetPath);
}

function renameWithRetry(from, to, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { renameSync(from, to); return; }
    catch (err) {
      if (i === attempts - 1) throw err;
      if (process.platform !== 'win32') throw err;
      if (err.code !== 'EPERM' && err.code !== 'EBUSY' && err.code !== 'EACCES') throw err;
      // Synchronous sleep ~50ms via Atomics.wait on a SharedArrayBuffer is heavy;
      // a simple busy-wait loop is acceptable for a 50ms blip during AV interference.
      const until = Date.now() + 50;
      while (Date.now() < until) { /* burn ~50ms */ }
    }
  }
}
```

(Note: orchestrator-author's pseudo-code; planner should adapt the import style to ESM and decide whether `path.basename` is imported up top vs. inline.)

### Spawn with `'close'` discipline

```js
// src/executor.js
import { spawn } from 'node:child_process';

export function runTask(task, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(task.cmd, {
      shell: true,
      stdio: 'inherit',           // P1: live passthrough; P2 may capture for json events
      windowsHide: true,
    });
    child.on('error', (err) => {
      // Spawn-time error (ENOENT etc) — treat as failure with exit_code -1.
      resolve({ ok: false, exit_code: -1, error: err.message });
    });
    // CRITICAL: 'close' fires after stdio drain. 'exit' fires earlier and can truncate output.
    // See pitfalls.md C3 — this comment is here on purpose; do not "simplify" to 'exit'.
    child.on('close', (code, signal) => {
      if (code === null) {
        // Signal-killed (e.g. OOM, parent SIGTERM). Treat as failure.
        resolve({ ok: false, exit_code: -1, signal });
      } else {
        resolve({ ok: code === 0, exit_code: code });
      }
    });
  });
}
```

## Test Fixture Catalog (Phase 1)

`test/fixtures/` should contain — at minimum — these JSON files:

| Fixture | Purpose | Test that uses it |
|---------|---------|-------------------|
| `linear.json` | 3-task chain (`a → b → c`), all `node -e "process.exit(0)"` | scheduler integration; CLI integration |
| `diamond.json` | A→B, A→C, B→D, C→D — must run, NOT be flagged as cycle | validator (acceptance), scheduler |
| `cycle-2.json` | `a → b → a` | validator (cycle detection) |
| `cycle-self.json` | `a → a` | validator (self-loop) |
| `cycle-long.json` | `a → b → c → d → a` | validator (path recovery >2 nodes) |
| `dup-id.json` | Two tasks with same `id` | validator (M5) |
| `missing-dep.json` | `b.depends_on: ["nonexistent"]` | validator (PARSE-03) |
| `bad-retry.json` | `retry: { attempts: 0 }` and another with `attempts: -1` | validator (PARSE-04) |
| `empty-id.json` | `id: ""` and `id: "   "` | validator (M5) |
| `null-tasks.json` | `{"tasks": null}` and `{"tasks": []}` (separate files) | validator (M5; empty is no-op exit 0) |
| `malformed.json` | Not valid JSON (e.g., trailing comma) | loader (PARSE-01) |
| `single.json` | Single task, exit 0 | scheduler watchdog (C2 deadlock detection) |
| `single-fail.json` | Single task, `node -e "process.exit(1)"` | exit-code mapping (CLI-10) |
| `linear-stdout.json` | Single task that prints >64KB to stdout | executor C3 verification |

(Planner may consolidate fixtures or split further; this is a checklist, not a strict count.)

## State of the Art

@./.planning/research/stack.md

No Phase-1 deltas. Node 22 is the current Active LTS (2026-05-02); `engines.node: ">=18.17.0"` is the recommended floor (any cleaner alternative `>=20.10` is acceptable but ratifies the same point).

## Open Questions

1. **ESM vs CommonJS** — both context.md and state.md note this as a Phase 1 decision. **Recommendation: ESM** (`"type": "module"` + `.js` extension). All examples in this research and across project research assume ESM; modern Node defaults align; `parseArgs` and `node:test` are ergonomic in ESM. **Planner should set this in Plan 01's first task and document in project.md Key Decisions.**
2. **Windows ASCII-fallback glyph detection mechanism** — three options: (a) unconditional ASCII on `process.platform === 'win32'`, (b) detect via `chcp` shell-out, (c) sniff `LANG`/`LC_ALL` env. **Recommendation: (a)** — simplest, no shell-out, no platform-specific testing. Revisit only if a Windows user with UTF-8 code page complains.
3. **Glyph table values** — context.md "Claude's Discretion" allows variation. **Recommendation:** POSIX TTY → `[ ✓ ]` / `[ x ]` / `[ - ]` (Unicode). Windows or `NO_COLOR` or non-TTY → `[ v ]` / `[ x ]` / `[ - ]` (ASCII). `x` and `-` are already ASCII so only the success glyph changes.

## Sources

### Primary (HIGH confidence) — referenced from project research
- `.planning/research/stack.md` — full builtin survey, version compatibility, atomic-write prescription, spawn semantics
- `.planning/research/architecture.md` — module decomposition, build dependency graph, ready-queue scheduler pattern, atomic write pattern
- `.planning/research/pitfalls.md` — C1/C2/C3/C4/C6/M5/N1/N3/N4 (Phase 1 subset)
- `.planning/research/features.md` — TS-1, TS-5, TS-9, TS-10, TS-11, TS-12, TS-13, TS-14, DF-2, DF-8, DF-9, DF-10 (Phase 1 features); CC-5 differentiator notes
- `.planning/research/summary.md` — CC-1 through CC-6 cross-cutting decisions; Phase 1 acceptance summary
- `.planning/idea.md` — locked spec items
- `.planning/project.md` — Key Decisions

### Secondary
- Node.js v25 official docs (validation source for project research)
- AWS Architecture Blog (validation source for project research; not used directly in Phase 1)

## Infrastructure Dependencies

None. Phase 1 ships a single-process CLI that reads a JSON file, spawns shell commands, writes a JSON state file, and exits. Tests use `node --test` against a per-test scratch directory created with `fs.mkdtempSync(path.join(os.tmpdir(), 'whooflow-test-'))`. No Docker, no external services.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — defers to project research, no Phase 1 deltas
- Architecture: HIGH — Phase 1 is a strict subset of architecture.md's 10-module model with clear deferral list
- Pitfalls: HIGH — explicit Phase 1 subset of `pitfalls.md`; each gets a test or code-comment mitigation

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (30 days; Phase 1 should ship well within that)

---
*Phase 1 research — deltas only per P-1402; defers to project-level research for the broad domain*
