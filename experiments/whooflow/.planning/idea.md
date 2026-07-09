---
title: "whooflow — declarative DAG task runner with parallelism, retry, and resume"
created: "2026-05-02"
created_by: oharms
runtime_preference: claude
budget: 50
priority: medium
---

# Idea: whooflow — small task runner that respects a DAG

A zero-dependency Node.js CLI that reads a task graph from a single JSON or YAML file, runs the tasks in topological order, parallelizing where the DAG allows, retrying on failure with backoff, and capable of resuming a partial run from a state file.

## Problem

PAN's exec-phase already runs plans in waves with dependency awareness — but the *external-tool* equivalent (build scripts, CI pipelines, data pipelines) is typically Make or Just or a 200-line bash. None of those handle "this task can run in parallel with that one but must wait for these three" + "if a task fails, retry 3× with exponential backoff" + "if I crash mid-run, resume only the unfinished tasks" without a heavy framework.

A small orchestrator with these three properties is structurally meaningful — it stresses **dependency resolution**, **parallel scheduling**, **retry logic**, and **persistent state**, none of which any past `whoo*` experiment has fully exercised. It is also a plausible building block for PAN's own future internal automation (e.g., a maintenance pipeline).

## Success Criteria

- **SC-1:** `whooflow run --file flow.json` reads a flow file, validates the DAG (no cycles, all `depends_on` keys exist), and executes tasks in topological order. Independent tasks run in parallel (default `--concurrency 4`).
- **SC-2:** Flow file format:
  ```json
  {
    "tasks": [
      { "id": "fetch", "cmd": "curl -sf https://example.com -o /tmp/x" },
      { "id": "parse", "cmd": "node parse.js /tmp/x", "depends_on": ["fetch"] },
      { "id": "report", "cmd": "node report.js", "depends_on": ["parse"], "retry": { "attempts": 3, "backoff_ms": 1000 } }
    ]
  }
  ```
  Each task: `id` (required, unique), `cmd` (string, run via shell), `depends_on` (array of ids, default `[]`), `retry` (optional `{attempts, backoff_ms}`).
- **SC-3:** State: every run writes `whooflow.state.json` next to the flow file. Each task gets `{status: pending|running|success|failed|skipped, attempts, started_at, ended_at, exit_code}`. State is written atomically after each task completes.
- **SC-4:** Resume: `whooflow run --file flow.json --resume` reads state, skips tasks already in `success`, re-runs tasks in `failed` (subject to remaining retries), and runs `pending` tasks normally.
- **SC-5:** Cycle detection: a malformed flow with `a→b→a` exits with `error: cycle detected: a → b → a` and code 2 BEFORE running anything.
- **SC-6:** Failure semantics: if task X fails after all retries, downstream tasks (`depends_on` chain) are marked `skipped` (not retried). Other independent branches continue. Final exit code is 1 if any task failed.
- **SC-7:** Output: `--format text` prints a tree of `[ ✓ ] task-id (Ns)`, `[ x ] task-id (failed after 3 attempts)`, `[ - ] task-id (skipped)`. `--format json` emits one JSON object per task transition to stdout.
- **SC-8:** ≥12 tests: linear chain, diamond DAG, cycle rejection, parallel independent tasks (verify wall-clock < sum), retry-then-success, retry-then-fail, skip-downstream-after-fail, resume from `success`, resume from `failed`, concurrency cap respected, missing-dep id rejected, malformed JSON rejected.
- **SC-9:** Dogfood: write a `flow.json` that runs PAN's actual `npm test` + `npm run build:hooks` in parallel, then runs `node -e ...` to count test files — and confirm whooflow runs it correctly with the right ordering and parallelism.

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| JSON flow file | YAML flow file (defer; JSON only at first) |
| Topological scheduling + concurrency cap | Resource pools (cpu/memory) |
| Retry with exponential backoff | Per-task timeout (defer if time) |
| Sequential resume from state | Distributed / multi-host execution |
| Shell `cmd` per task | Function-call tasks (caller passes a JS object) |
| Skipped-downstream on failure | `on_failure` hooks / cleanup tasks |
| Atomic state writes | Live progress streaming over IPC |

## Constraints

- **Tech stack:** Node.js >= 16, zero runtime deps. Pure builtins (`child_process.spawn`, `fs`, `path`, `node:test`, `node:assert/strict`).
- **Performance:** scheduler overhead per task < 5ms; a flow of 100 trivial tasks (`cmd: "true"`) finishes in under 3 seconds with `--concurrency 4`.
- **Determinism:** same flow + same state file → same final state, regardless of OS scheduling jitter (tasks complete in DAG-valid order; specific siblings may interleave but final state is identical).
- **Cross-platform:** `cmd` strings run via `spawn` with `shell: true`. Tests use OS-portable commands (`node -e`, not `sh -c`).
- **Crash safety:** writing state uses write-to-`.tmp`-then-rename. If process killed mid-task, state shows that task as `running` (not lost); resume retries it from scratch.

## Reference material

- PAN's `pan-wizard-core/workflows/exec-phase.md` — wave-based parallelism + dependency resolution model
- PAN's `pan-wizard-core/bin/lib/preview.cjs` `buildPhaseDependencyGraph` — Kahn's topological sort with parallel batching
- PAN's `pan-wizard-core/bin/lib/runner.cjs` — process spawning + state observation pattern
- The existing `whoodag` experiment — pure topological sort (whooflow is the *executable* version)

## Notes

- **Decision principle:** correctness over fanciness. A runner that always finishes in DAG-valid order with no surprises is the goal; bells and whistles wait.
- **Eat-our-own-dogfood marker:** done when a real PAN-internal flow runs successfully end-to-end and resume from a deliberately-killed mid-run produces the correct final state.
- **Promote-worthy findings expected:** parallel-batch scheduling pattern (Kahn variant with concurrency cap), retry-then-skip-downstream propagation, atomic state-file pattern, child-process exit-code aggregation across parallel runners.
- **Wave hint:** Plan 01 = flow file parsing + cycle detection + sequential execution + state file. Plan 02 = parallel scheduling + concurrency cap + retry/backoff. Plan 03 = resume + skip-downstream + dogfood test.
