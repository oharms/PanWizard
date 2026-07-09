# Phase 1: Parse + Validate + Sequential Run + Atomic State - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning
**Source:** Auto-mode synthesis (P-1803, v3.7.8) — derived from idea.md + project.md + requirements.md without user dialogue

<domain>
## Phase Boundary

A user can run a JSON flow file end-to-end on a single core, with malformed flows rejected before any task runs and state written crash-safely after every transition. This phase establishes the data shapes (Flow IR, state JSON), the atomic-write contract, and the deterministic ordering that every later phase rides on.

**Cross-cutting prerequisite:** `package.json` `engines.node` set to `>=18.17.0` before any code lands — first task of Phase 1's first plan, not a deferred admin item.

</domain>

<decisions>
## Implementation Decisions

### From idea.md (locked spec items)

- **Flow file format is JSON only.** Each task has `id` (required, unique non-empty string), `cmd` (string, run via shell), optional `depends_on` (array of ids, default `[]`), optional `retry` (`{attempts: int >= 1, backoff_ms: int >= 0}`). YAML and function-call task shapes are explicitly out of scope — preserves the zero-dep constraint.
- **State file is `whooflow.state.json` next to the flow file.** Each task entry: `{status: pending|running|success|failed|skipped, attempts, started_at, ended_at, exit_code}`. Written atomically after each task completes.
- **Cycle detection runs BEFORE any task starts.** Malformed `a→b→a` exits with `error: cycle detected: a → b → a` and exit code 2.
- **Output `--format text` prints a tree** of `[ ✓ ] task-id (Ns)`, `[ x ] task-id (failed after N attempts)`, `[ - ] task-id (skipped)`. The JSON format lands in Phase 2; Phase 1 only needs `--format text`.
- **Cross-platform `cmd` execution** via `child_process.spawn` with `shell: true`. Tests use OS-portable invocations (`node -e "..."`, never `sh -c` or bare `echo`).
- **Crash safety:** writing state uses write-to-`.tmp`-then-rename. If process killed mid-task, state shows that task as `running` (not lost). Phase 1 establishes this contract; full resume logic is Phase 3.
- **Decision principle:** correctness over fanciness. A runner that always finishes in DAG-valid order with no surprises is the goal.

### From project.md Key Decisions (ratified before planning)

- **Node floor `>=18.17`** (not `>=16`) — gives `node:util parseArgs`, `node:test`, `structuredClone` natively. First task of Phase 1's first plan: set `engines.node` in `package.json`.
- **JSON flow files only** — preserve zero-dep constraint.
- **Atomic state writes** use write-tmp + `fsyncSync` + rename (not just rename). Same-directory tmp file (never `os.tmpdir()`). Windows EPERM/EBUSY retry 2-3× before failing.
- **Skip-downstream propagates only on terminal fail** — relevant in P3 but the state-shape Phase 1 establishes must accommodate this (so the `failed` status reflects "after all retries exhausted," not "current attempt failed").

### From requirements.md (Phase 1 mapped REQ-IDs — locked scope)

- **CLI-01:** `whooflow run --file <path>` reads the JSON flow file
- **CLI-02:** `--concurrency <N>` flag accepted (default 4) — Phase 1 only needs to parse it; concurrent execution is Phase 2
- **CLI-07:** `--help` and `--version` print usage / version and exit
- **CLI-08:** Color output auto-detects TTY and honors `NO_COLOR`
- **CLI-09:** Status glyphs `[ ✓ ]` / `[ x ]` / `[ - ]` with ASCII fallback on Windows; per-task duration shown
- **CLI-10:** Exit codes 0 success / 1 task-fail / 2 validation/cycle error
- **PARSE-01:** Reject malformed JSON with clear error and exit code 2
- **PARSE-02:** Validate each task has unique non-empty `id` and string `cmd`
- **PARSE-03:** Validate `depends_on` references existing task ids; named error on unknowns
- **PARSE-04:** Validate `retry` shape when present
- **PARSE-05:** Cycle detection prints actual cycle path; exits 2 before any spawn
- **SCHED-01:** Tasks run in topological order (Phase 1: sequential, concurrency 1)
- **SCHED-05:** Final state is deterministic for same flow + same state file
- **EXEC-01:** Tasks execute via `child_process.spawn` with `shell: true`
- **EXEC-02:** Resolve only on child's `'close'` event (not `'exit'`); `null` exit code = failure
- **STATE-01:** Per-task entry `{status, attempts, started_at, ended_at, exit_code}` in `whooflow.state.json`
- **STATE-02:** Atomic write: tmp + fsync + rename, with Windows EPERM/EBUSY retry
- **STATE-03:** Write after every task transition (not batched)

### From research/architecture.md (module decomposition — guidance for planner)

- 8 modules: `cli`, `loader`, `validator`, `scheduler`, `executor`, `state`, `formatter`, plus `errors` and `clock` as cross-cutting helpers.
- Phase 1 ships a sequential single-task version of `executor` (no retry — that's P2) and `scheduler` (concurrency 1 — slot-based parallelism is P2).
- `clock` indirection introduced now even though P1 doesn't need fake timers — pays off in P2 testing without retrofit.
- ESM (not CommonJS) — research recommendation.

### From research/pitfalls.md (must defend against in Phase 1)

- **C1** Cycle errors must be readable: iterative Kahn (no recursion → no RangeError on long chains), with leftover-DFS to recover the actual path. Never just "cycle exists."
- **C2** Ready-queue starvation from un-normalized `depends_on` (e.g., `null`/`undefined`) — normalize at parse time.
- **C3** Use `'close'` event, never `'exit'` — `'exit'` fires before stdio drain.
- **C4** Atomic state writes need fsync + same-dir tmp + Windows EPERM/EBUSY retry. Naive write+rename is insufficient.
- **C6** Cross-platform shell quoting: tests/dogfood use `node -e "..."`-style invocations only.
- **M5** Schema validation must be aggregate (collect all errors, not first-fail) — else users fix one error, re-run, hit the next.
- **N1** Diagnostic logs go to stderr from day one; stdout is reserved for the structured event stream so P2's `--format json` doesn't have to retrofit.
- **N3** Read-only directory failure should surface at startup via a write-test, not mid-run.
- **N4** `Date.now()` for wall-clock timestamps; `process.hrtime.bigint()` for durations (NTP/DST-immune).

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

</decisions>

<specifics>
## Specific References

- **PAN's own scheduler patterns** are reference material, not modules to import:
  - `D:\PanWizard\pan-wizard-core\bin\lib\preview.cjs` — `buildPhaseDependencyGraph` shows Kahn's topological sort (Phase 1 borrows the algorithm structure for cycle detection)
  - `D:\PanWizard\pan-wizard-core\bin\lib\runner.cjs` — process spawning + state observation pattern (Phase 1 upgrades the state-write pattern to crash-safe atomic + fsync)
- **Test commands must be portable.** `node -e "console.log('ok')"` and `node -e "process.exit(N)"` for exit-code tests. Never `sh -c`, never bare `echo` (PowerShell has aliasing).
- **State file co-located with flow file.** `whooflow run --file ./pipeline/flow.json` writes `./pipeline/whooflow.state.json` (not next to the runner binary, not in `os.tmpdir()`).
- **Status glyphs:** unicode `[ ✓ ]` / `[ x ]` / `[ - ]` on POSIX TTY; ASCII fallback `[ v ]` / `[ x ]` / `[ - ]` on Windows or when `NO_COLOR` / non-TTY. (`x` and `-` are already ASCII.)
- **Exit code mapping:** 0 all-success, 1 any task failed, 2 validation/cycle/missing-file (any error before tasks could run).

</specifics>

<deferred>
## Deferred Ideas

None — auto-mode synthesis honors the original idea.md scope. The following items appeared in upstream artifacts but are explicitly Phase 2 or Phase 3 and are NOT to be implemented here:

- Concurrent execution / slot-based scheduler — Phase 2 (Phase 1 only parses `--concurrency` flag)
- Retry with backoff — Phase 2 (Phase 1's executor runs each task exactly once)
- `--dry-run`, `--list`, `--format json` — Phase 2
- `--resume` flag, skip-downstream propagation, dogfood `flow.json` — Phase 3

</deferred>

---

*Phase: 01-parse-validate-sequential-run-atomic-state*
*Context auto-synthesized: 2026-05-02 via discuss-phase P-1803 bypass — no user dialogue*
