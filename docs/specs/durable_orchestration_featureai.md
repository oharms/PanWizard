# Durable Orchestration over Files — Feature Investigation & Spec

**Status:** Design (`2026-11-02`), not implemented
**Origin:** deep research `2026-11-01` on whether a LangGraph-style engine would improve PAN. Verdict: **adapt, do not adopt**. Take the engine's ideas — a checkpoint per step, typed state transitions, typed human-approval pauses, safe concurrent writes, fork from a checkpoint — and build them over `.planning/` files with no new runtime dependency.
**Amends:** ADR-0030 (takes its escalation path), and the merge gate's record format (`pan-wizard-core/mcp/merge-gate.cjs`).
**ADR:** [ADR-0052](../decisions/ADR-0052-durable-orchestration-over-files.md), written in Stage E.

---

## Phase 0: Problem framing

### 0.1 Problem statement

PAN's orchestration state is a set of files the engine and the model both write. That is the right base: it is portable to all five runtimes, readable by a person, and survives any crash of the host CLI. But the files are written without the guarantees a durable engine gives:

- **Writes can lose each other.** Of every orchestration file, only `state.md` is written under a lock and atomically, and even there the read happens before the lock is taken. `roadmap.md`, `requirements.md`, `config.json`, `focus/auto-run.json`, batch files, autodev's `state.json`, the bus and the merge-gate approval records are read-modify-write with a plain `writeFileSync`. Two sessions, or a session and a `--stop`, can silently undo each other (ten concrete races are listed in 1.2).
- **No status has a legal-transition rule.** Focus auto-run checks some transitions without a lock; autodev runs, the state.md `Status` field, quick-task status and the roadmap's phase status accept any value. A merge request that was `merged` can be overwritten by a new request.
- **Resume restarts a whole plan.** After a crash PAN knows which plans have a summary and which do not. It does not know which tasks inside a plan finished, so it re-infers that from `git log` and the model's reading of the plan.
- **Most pauses for a person are recorded only in the conversation.** An `execute-plan` checkpoint (`human-verify`, `decision`, `human-action`), a plan-check override or an autodev `human_needed` stop leaves nothing on disk that says what it is waiting for, and the answer is checked only by the model. Lose the session and the question is lost. The merge gate is the exception, and it has no expiry, no record of when it was approved, and a confirm that can run twice.

LangGraph solves the same four problems with a checkpointer keyed by a thread id, but the research showed that the value is the saved record, not the graph runtime, and that embedding it would add five dependencies, two peer packages and a SQLite or Postgres backend. A direct peer (GSD-Lite) gets the same guarantees with a 12-state machine over one JSON file, schema-checked, version-numbered, written atomically under a lock. PAN can do the same with modules it already has (`lock.cjs`) and the verb surface every runtime already calls.

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| One write primitive for orchestration files: lock, read inside the lock, atomic write, revision check | A graph runtime, or any LangGraph/Temporal/Mastra dependency |
| A declared transition table per stateful entity, enforced by every writer and by `next-action` | Changing what the states *are* (phase discovery, focus cycle statuses) |
| An append-only step journal per run and per plan; resume from the last completed step | Deterministic replay of model calls (impossible; re-run steps call the model again) |
| Typed pauses: a file that says what it waits for, and a code-checked answer | Moving every AskUserQuestion to a pause file (only the ones that gate state) |
| The merge gate as one pause kind (expiry, single consume, approval time) | A signed approval or an identity system |
| Fork a run from a journal entry (optional, last stage) | Time travel through `.planning/` history (git already holds that) |
| Doctor/hygiene checks for the new files | A database, a daemon, a background worker |

### 0.3 Success criteria

```text
SC-1  No orchestration file under .planning/ is written by a plain read-modify-write: every writer
      named in 1.2 goes through store.cjs (a test greps the engine for writeFileSync on those paths).
SC-2  Two concurrent writers to the same file never lose an update: a multi-process test (N child
      processes x M increments) ends with exactly N*M for every JSON record and for state.md.
SC-3  Every status write is checked against a declared table; an illegal transition is refused with
      error "illegal_transition" and {entity, from, to, allowed}, and nothing is written.
SC-4  After a crash mid-plan, init resume reports the last completed task and its commit, and
      execute-plan starts at the next task (unit test + tier-0 harness scenario).
SC-5  A checkpoint, plan-check override or autodev human_needed stop leaves an open pause file; its
      answer is validated by code; a wrong answer is refused with "pause_answer_invalid".
SC-6  The merge gate refuses an expired approval, a second confirm, and a request over a merged
      record; approval time is recorded.
SC-7  Works in all 5 runtimes: every new behaviour is reached through pan-tools verbs (and the MCP
      tools that wrap them), never through a runtime-specific feature.
SC-8  Existing projects keep working: files without a revision are read as revision 0, a missing
      journal falls back to today's plan/summary inference, and no migration step is required.
SC-9  No new runtime dependency; package.json dependencies stays empty.
SC-10 Docs, the surface registry, the prompt-rule registry and CLAUDE.md counts are updated; the
      full suite and harness tier 0 pass.
```

### 0.4 User stories

```text
As a PAN user running two sessions on one project, I want each session's state change kept,
so that progress is never silently undone, instead of finding a stale status after a --stop raced
with an --update.

As a PAN user whose CLI crashed in the middle of a five-task plan, I want resume to start at
task 4, so that tasks 1-3 are not redone or re-reviewed, instead of re-reading git log by hand.

As a PAN user who closed the session while a checkpoint asked "pick option A or B", I want
/pan:resume to ask me the same question again and accept only A or B, instead of the question
being lost with the conversation.

As a maintainer, I want an illegal state change (completed -> in_progress) to fail loudly,
so that a prompt bug shows up as a refusal, instead of as corrupted state found days later.

As an operator of the MCP merge gate, I want approvals to expire and be consumed once,
so that an old token cannot merge a branch twice.
```

---

## Phase 1: Internal reconnaissance (code read `2026-11-02`)

### 1.1 What exists

| Area | Today | File |
|---|---|---|
| Lock primitive | `acquireLock`, `releaseLock`, `withFileLock`, `writeFileAtomic`, `sleepSync`. `<file>.lock` by exclusive create, ~1 s retry, 10 s stale steal; on timeout the function runs **unlocked** (ADR-0030 v1, best-effort). Rename failure on Windows falls back to a plain write | `lock.cjs` |
| Lock adoption | One caller: `writeStateMd` (`state.cjs`). Its callers read state.md *before* taking the lock | `state.cjs`, `state-write.cjs` |
| Other atomic writes | `cost-rebuild.cjs` re-implements temp + rename inline | `cost-rebuild.cjs` |
| Next action | `nextAction` in `mcp/orchestrator.cjs` is a pure function of a snapshot (`PHASE_NEXT` table; actions plan/execute/verify/request_merge/await_approval/stop). `next-action.cjs` builds the snapshot from disk and puts focus first (`nextStep`) | `mcp/orchestrator.cjs`, `next-action.cjs` |
| Merge gate | `.planning/orchestration/approvals/<slug>.json` `{id, branch, approval_token, ci_green, verify_pass, verify_source, status, requested_at}`; approval = env `PAN_MERGE_APPROVAL` equals the token; `requested_at` is always null; plain writes; no expiry; a new request overwrites a merged record | `mcp/merge-gate.cjs` |
| Resume | `init resume` → `open_work` (plans without summary, open quick tasks and focus cycles, debug sessions, `.continue-here*.md`). Restart unit is the plan | `init.cjs`, `open-work.cjs` |
| Per-task progress | Only the per-task commits and `agent-history.json` (written by the model, read by no code) | `workflows/execute-plan.md` |
| Recorded pauses | UAT results (`uat record`, enum checked by code); autodev stop rows in `ledger.jsonl`; focus `stop_reason` in `auto-run.json` | `uat.cjs`, `autodev.cjs`, `focus.cjs` |
| Unrecorded pauses | execute-plan checkpoints (`human-verify`, `decision`, `human-action`), the exec-phase plan-check override and `BLOCKED_SPEC_CONFLICT`, autodev `human_needed` (no answer channel), every other AskUserQuestion | prompts |
| Append journals | autodev `ledger.jsonl` + `blackbox.jsonl` (seq derived from the ledger, no lock); bus channels; tokens | `autodev.cjs`, `bus.cjs`, `cost.cjs` |
| Config | `concurrency` is an open section (`concurrency.serial_build` exists); ADR-0030 named `concurrency.strict` as the strict-mode switch | `core.cjs`, `config.cjs` |

### 1.2 Concrete races found

1. state.md read outside the lock (`cmdStateUpdate`, `withState`, `cmdStateAdvancePlan`) → lost update; timeout proceeds unlocked.
2. roadmap.md / requirements.md: `phase complete`, `roadmap update-plan-progress`, phase add/insert — read, regex, write, no lock.
3. `focus/auto-run.json`: `focusOpen` writes `{...run, current_cycle}` from an earlier read; a concurrent `--stop` or `--update` is overwritten and a stale status comes back.
4. Focus batch files: the close and route writes are both read-modify-write.
5. `config.json`: `cmdConfigSet` read-modify-write.
6. Autodev: seq derived from the ledger with no lock, no exclusion between two `autodev resume` calls on one run; `persistRunFacts` read-modify-write.
7. Bus consume: read all, splice, rewrite; an append in between is lost.
8. Quick numbering: `nextQuickNum` is max+1 from readdir; only the focus path detects a collision (non-recursive mkdir).
9. Merge gate: two concurrent `confirmMerge` calls can both pass `evaluateMerge`.
10. Cost cursor (`hooks/pan-cost-logger.js`): read-modify-write across concurrent hook fires.

### 1.3 Status values and how they are checked today

| Entity | Values | Checked? |
|---|---|---|
| focus auto-run | initialized / in_progress / stopped / completed | partly, without a lock |
| focus cycle | open (no summary) → verified / partial / failed | yes (close refuses a closed cycle) |
| autodev run | implied by ledger rows started / finished / stopped / ci | no; run.json has no status |
| state.md `Status` | free text, normalised on read | no |
| roadmap phase | Planned / In Progress / Complete, checkbox | only the phase gate in enforce mode |
| quick task (state.md table) | free text | no |
| UAT | testing → complete | regex guard |
| merge request | awaiting_approval → merged | evaluate only; request overwrites |

### 1.4 Runtime compatibility

Everything in this design is engine-side (`pan-wizard-core/bin/lib/`, `pan-wizard-core/mcp/`) and reached through `pan-tools` verbs that shipped prompts call in every runtime, plus MCP tools that wrap the same functions. No hook is required for correctness: the hooks keep reading files, and the one hook writer in scope (the cost cursor) adopts the same primitive by copying it, since hooks cannot require core. The native workflow scripts (Claude only) call the same verbs, so they gain journaling with no runtime-specific code. The installer copies new core modules with the rest of the core; the manifest picks them up with no change.

---

## Phase 2: Competitive analysis (from the `2026-11-01` research; primary sources listed at the end)

| System | Durability mechanism | Pause / approval | Fit for PAN |
|---|---|---|---|
| LangGraph (JS) | Checkpointer keyed by `thread_id`; in-memory by default (lost on restart); SQLite (dev) or Postgres for durability | `interrupt()` needs a checkpointer; resume with a value | Ideas only. Five deps + `@langchain/core` and `zod` peers, plus a database |
| Temporal + OpenAI Agents SDK | Event History; completed Activities are not re-run | `needsApproval` tools; serialisable `RunState` | Needs a worker process; assumes the app calls model APIs |
| Mastra workflows | Snapshots per `runId` in libSQL/Postgres/… | `resume()` validates the payload against the step's `resumeSchema` | The typed resume schema is the idea to take |
| langgraph-codex | Graph drives the Codex CLI as one node | — | Inverse of PAN (PAN lives inside the CLI); its deterministic-prep / agent step / deterministic-check shape matches PAN's native workflows |
| GSD | Markdown `STATE.md`, rebuilt if missing | — | What PAN already does |
| GSD-Lite | 12-state machine behind an MCP server; `.gsd/state.json` schema-checked, `_version` conflict check, atomic write, file lock; tasks pending → running → checkpointed → accepted | `awaiting_user` state | Closest model: small in-house state machine over files, one dependency (the MCP SDK) |

**Differentiation.** PAN keeps the state human-readable markdown where people read it (state.md, roadmap, plans, summaries) and puts machine records (journals, pauses, run records) in JSON next to it. The journals are evidence, not instructions: a step is "done" only when its recorded artifact (commit, summary, file) checks out, so a forged or stale journal line cannot skip work.

---

## Phase 3: Design

### D1. One write primitive: `store.cjs`

A new module over `lock.cjs`:

```text
readRecord(file)                         -> {data, rev, hash} | {missing: true}
updateRecord(file, mutate, opts)         -> {ok, data, rev} | {error, ...}
updateText(file, mutate, opts)           -> same, for markdown
appendLine(file, obj, opts)              -> {ok, seq}
```

- **Read inside the lock.** `updateRecord` takes the lock, reads, calls `mutate(current)`, validates, writes atomically, releases. The caller never passes data it read earlier. This closes races 1–7 and 9 by construction.
- **Revision.** JSON records carry `_rev` (integer). `updateRecord` increments it. `opts.expectRev` makes the write a compare-and-swap: a mismatch returns `error: "stale_write"` with `{expected, actual}` and writes nothing. A file without `_rev` reads as revision 0, so existing files need no migration.
- **Markdown has no field to spare.** `updateText` uses a content hash for compare-and-swap (`opts.expectHash`, SHA-1 of the raw bytes, not the LF-normalised text, so a CRLF file is not a false conflict). Nothing is added to the markdown.
- **When the model is the reader.** A prompt that reads a record, decides, and writes back gets the revision from the read verb (`--json` output carries `_rev` / `hash`) and passes `--expect-rev` / `--expect-hash` to the write verb. This is optional per verb at first and required only where the decision depends on the value read (`focus auto --update`, `phase complete`).
- **Strict by default for JSON records, best-effort for state.md.** ADR-0030's escalation path: a lock timeout on a JSON orchestration record returns `error: "lock_timeout"` (nothing written). `state.md` keeps the best-effort fallback unless `concurrency.strict: true`, because a timeout there is today's behaviour and a new refusal on the hottest file would be a new failure mode for single-agent users. The timeout itself rises from ~1 s to 5 s for strict callers (critical sections are milliseconds; the longer wait only matters under real contention).
- **Windows rename.** `writeFileAtomic` retries the rename (EPERM/EBUSY from an antivirus or an open reader) up to 5 × 20 ms before the existing fallback, and reports `atomic: false` when it fell back, so `doctor` can count them.
- **Appends.** `appendLine` takes the lock only to compute `seq` (last line + 1) and append one line; single-line appends stay as cheap as today. Autodev's ledger and the new journals use it (race 6).
- **Quick numbering** (race 8) moves to `store.reserveDir(parent, pattern)`: mkdir non-recursive in a loop from `max+1`, so every caller gets the collision check the focus path has.
- **Hook copy.** The cost-logger cursor (race 10) gets an inline copy of the lock + atomic write, pinned to `lock.cjs` by a test that compares behaviour (hooks cannot require core).

Writers moved onto `store.cjs`: state.md (read moved inside), roadmap.md, requirements.md, config.json, `focus/auto-run.json`, focus batch files, `autodev/state.json`, autodev `run.json`, autodev ledgers, bus consume, merge-gate records, quick numbering. A test fails if a module writes any of these paths with `writeFileSync` directly (the same shape as the existing doc-lint guards).

### D2. Declared transition tables: `transitions.cjs`

One table per entity, as data:

```js
const TABLES = {
  'focus.run':    { initial: ['initialized'],
                    edges: { initialized: ['in_progress', 'stopped'],
                             in_progress: ['in_progress', 'stopped', 'completed'],
                             stopped:     ['in_progress', 'initialized'],
                             completed:   [] } },
  'autodev.run':  { initial: ['running'],
                    edges: { running: ['running', 'stopped', 'finished'],
                             stopped: ['running'], finished: [] } },
  'merge.request':{ initial: ['awaiting_approval'],
                    edges: { awaiting_approval: ['merged', 'expired', 'cancelled'],
                             expired: [], cancelled: [], merged: [] } },
  'pause':        { initial: ['open'],
                    edges: { open: ['answered', 'expired', 'cancelled'],
                             answered: [], expired: [], cancelled: [] } },
  'phase':        { initial: ['planned'],
                    edges: { planned: ['in_progress', 'complete'],
                             in_progress: ['in_progress', 'complete'],
                             complete: [] } },
  'quick.task':   { initial: ['open'], edges: { open: ['done', 'partial', 'failed'] , done: [], partial: [], failed: [] } },
  'plan.step':    { initial: ['started'],
                    edges: { started: ['completed', 'failed', 'paused'],
                             paused: ['started', 'failed'], failed: ['started'], completed: [] } },
};
```

- `checkTransition(entity, from, to)` returns `null` or `{error: 'illegal_transition', entity, from, to, allowed}`. `updateRecord` takes an optional `{entity, statusField}` and refuses inside the lock, so the check and the write are one step (the focus auto-run checks today are check-then-write without a lock).
- **Escape hatch, recorded.** A writer that must override (re-opening a completed phase by hand) passes `--force --reason "<why>"`; the override is appended to the run's journal as a `forced` entry. Same shape as the phase gate's existing `--force --reason`.
- **Phase status in state.md and the roadmap** is derived, not stored as an enum today. The table applies at the verbs that change it: `phase complete` refuses a phase already complete (`illegal_transition`, `from: complete`) unless forced; `roadmap update-plan-progress` may only move forward. The free-text state.md `Status` keeps free text for display, but `state update Status` with a value that normalises to a known state is checked against the table.
- **Quick-task status** in the state.md table becomes the enum `done | partial | failed` (focus cycles use `verified` as an alias of `done`), validated by `stateQuickTask`.
- **`next-action` uses the same tables.** `nextAction` rejects a snapshot whose statuses are not states of their entity (today an unknown phase status falls back to `plan`); it returns `error: "unknown_state"` with the value so a corrupted file is reported, not routed. Its output gains `allowed`: the transitions the chosen action may make, which the MCP tool returns to the caller.
- **One source for enums.** `AUTORUN_STATUSES`, `FOCUS_CYCLE_STATUSES`, autodev's `STOP_REASONS` stay in `constants.cjs`; the tables reference them, and a test asserts every table's states are a superset of the matching constant.

### D3. Step journal and resume from the last completed step

**Format.** One JSON line per event, appended with `appendLine`:

```json
{"seq": 7, "ts": "2026-11-02T10:14:03Z", "run": "03-02", "step": "task-3",
 "event": "completed", "artifact": {"commit": "a1b2c3d"}, "by": "pan-executor"}
```

`event` ∈ `started | completed | failed | paused | resumed | forced | forked`. `artifact` is what proves the step: a commit sha, a file path with its hash, or a summary path.

**Where.**
- Plans: `.planning/phases/<phase>/<plan>-journal.jsonl`, beside the plan and its summary.
- Focus cycles: `<cycle dir>/journal.jsonl`; focus auto runs: `.planning/focus/runs/<run_id>.jsonl` (auto-run.json keeps the current snapshot; the journal is the history).
- Autodev: the existing `ledger.jsonl` *is* a journal; it adopts the same line shape (`event` replaces `type`, with `type` still read for old ledgers) and `appendLine`.

**Who writes it.** A new verb, so every runtime's prompts can call it:

```bash
pan-tools journal step --plan 03-02 --step task-3 --event completed --commit a1b2c3d
pan-tools journal show --plan 03-02 [--json]
pan-tools journal resume-point --plan 03-02 [--json]
```

`execute-plan.md` records `started` before each task and `completed` with the task commit after it (it already commits per task). `exec-phase` and the `pan-exec-waves` native script record per plan. Focus `open`/`close` record their own steps in the engine, with no prompt change.

**Evidence, not instructions.** `resume-point` returns the first step that is not `completed` *with a verified artifact*: the commit must be reachable from HEAD (`merge-base --is-ancestor`, as `focus close --commit` already checks), the file must exist with the recorded hash. A `completed` line whose artifact fails the check is reported as `unverified` and the resume point is that step. A forged or stale line therefore cannot make PAN skip work; at worst it makes PAN redo a step.

**Resume.** `open-work.cjs` adds, per unfinished plan, `{resume_at: "task-4", completed: [...], unverified: [...]}` from the journal. `resume-project.md` and `execute-plan.md` read it and start at `resume_at`, giving the executor the completed tasks and their commits (the continuation-agent table `pan-executor.md` already expects). **No journal → today's behaviour** (plan without summary restarts at the top), so old plans and runtimes whose model skips the verb still work.

**Size.** Journals are small (one line per task); `phase complete` and `milestone` archive them with the phase directory. Hygiene flags a journal whose last event is older than `focus.stale_hours`-style threshold with no summary (an abandoned plan).

### D4. Typed pauses

**Record.** `.planning/pauses/<id>.json`:

```json
{"id": "p-03-02-task-4", "_rev": 0, "kind": "decision", "status": "open",
 "run": "03-02", "step": "task-4",
 "question": "Which session store?",
 "expects": {"type": "enum", "values": ["redis", "sqlite"]},
 "created_at": "...", "expires_at": null,
 "answer": null, "answered_at": null}
```

**Kinds and their `expects`:**

| Kind | Opened by | `expects` |
|---|---|---|
| `human-verify` | execute-plan checkpoint | `{"type":"enum","values":["approved","issues"]}` plus optional `note` string |
| `decision` | execute-plan checkpoint | enum of the plan's option ids |
| `human-action` | execute-plan checkpoint | `{"type":"enum","values":["done"]}` |
| `plan-override` | exec-phase plan-check override | `{"type":"object","required":["reason"]}` |
| `spec-conflict` | exec-phase `BLOCKED_SPEC_CONFLICT` | enum of the offered resolutions |
| `autodev-human` | autodev `human_needed` stop | `{"type":"object","required":["action_taken"]}` |
| `merge` | `pan_request_merge` | `{"type":"token"}` (see D5) |

**Schema language.** Deliberately tiny and zero-dependency (`pause-schema.cjs`): `enum`, `string` (optional `pattern`, `maxLength`), `boolean`, `token`, and `object` with `required` and `properties` of those. No JSON Schema implementation; the validator is short enough to test exhaustively.

**Verbs.**

```bash
pan-tools pause open --kind decision --run 03-02 --step task-4 --question "..." --expects '<json>'
pan-tools pause answer <id> --value redis            # or --json '{"reason":"..."}'
pan-tools pause list [--open] [--json]
pan-tools pause cancel <id> --reason "..."
```

`answer` validates against `expects` inside the lock and writes `answered` (transition table `pause`). A wrong value returns `pause_answer_invalid` with the allowed values; an answered or expired pause returns `illegal_transition`. The answer is appended to the run's journal as `resumed`.

**Prompts.** `execute-plan.md` and `exec-phase.md` open the pause when the executor returns a checkpoint, ask the user (AskUserQuestion where the runtime has it, plain text elsewhere — unchanged), then call `pause answer` with the reply and pass the *validated* answer to the continuation agent. Under `workflow.auto_advance`, `human-verify` and `decision` are answered by the orchestrator through the same verb (`decision` with the plan's `auto_select`, now checked by code). Other AskUserQuestion uses (project setup, settings) stay conversation-only: they do not gate orchestration state.

**Resume and next-action.** `open_work` gains `pauses` (open ones). `next-action` puts an open pause first — `action: "answer_pause"`, with the pause id, question and allowed values — ahead of focus and phase routing, so `/pan:resume` re-asks a lost question instead of starting new work. Autodev's `human_needed` stop opens an `autodev-human` pause; `autodev run` refuses to continue the run while it is open (`pause_open`), which gives that stop the answer channel it lacks today.

**Expiry.** `expires_at` is null by default (a person may come back next week). `orchestration.pause_ttl_hours` (default none) sets it for every kind except `merge`, which has its own (D5). An expired pause is reported by `pause list` and hygiene; `next-action` offers to re-open it.

### D5. The merge gate as a pause kind

`requestMerge` keeps its file (`.planning/orchestration/approvals/<slug>.json`) and field names, adds the pause fields, and moves onto `store.cjs`:

- `requested_at` is set (today always null); `expires_at = requested_at + orchestration.approval_ttl_hours` (default 72).
- `approval_token` is stored as `token_sha256` (the token is shown once in the request's output, as today); the env var `PAN_MERGE_APPROVAL` is compared by hash. A leaked approvals file then does not leak a usable token.
- A request over a record whose status is `merged` refuses (`illegal_transition`) unless `--force --reason`; over `awaiting_approval` it supersedes (old record → `cancelled`, kept as `<slug>.<rev>.json`).
- `confirmMerge` does the evaluate and the `awaiting_approval → merged` transition inside one lock, so a second confirm sees `merged` and refuses `already_consumed` (race 9). `approved_at` is recorded.
- Refusals added: `approval_expired`. Existing refusal codes are unchanged.

### D6. Fork from a checkpoint (optional; Stage F)

```bash
pan-tools journal fork --plan 03-02 --at 5 [--branch <name>]
```

Creates a new journal `<plan>-journal.fork-<n>.jsonl` with lines 1..5 copied and a `forked` line naming the parent and seq, and prints the git command to branch at the commit recorded at seq 5 (it does not switch branches itself). The output says, in so many words, that steps after the fork point run again and may differ. This is the one LangGraph "time travel" idea with a use in PAN (retry a plan from task 3 with a different approach); it is last because it is useful only once D3 has data.

### 3.7 Architecture decision

| Question | Answer |
|---|---|
| New modules | `store.cjs` (D1), `transitions.cjs` (D2), `journal.cjs` (D3, D6), `pause.cjs` + `pause-schema.cjs` (D4). Each a pure-function core with a thin `cmd*` wrapper, like the rest of `lib/` |
| Changed modules | `lock.cjs` (rename retry, strict option, timeout), `state.cjs`/`state-write.cjs` (read inside lock), `roadmap.cjs`, `phase.cjs`, `milestone.cjs`, `verify.cjs` (roadmap/requirements writers), `config.cjs`, `focus.cjs`, `autodev.cjs`, `bus.cjs`, `utils.cjs` (`nextQuickNum` → `reserveDir`), `open-work.cjs`, `init.cjs`, `next-action.cjs`, `hygiene.cjs`, `mcp/orchestrator.cjs`, `mcp/merge-gate.cjs`, `mcp/native-tools.cjs` (+ `pan_answer_pause`, `pan_list_pauses`), `hooks/pan-cost-logger.js` (cursor) |
| Dispatcher | New verbs `journal` (step, show, resume-point, fork) and `pause` (open, answer, list, cancel), with the "Unknown <group> subcommand … Available:" guard the surface registry parses |
| Prompts | `execute-plan.md`, `exec-phase.md`, `resume-project.md`, `progress.md`, `agents/pan-executor.md`; the `pan-exec-waves` script source in `install-lib.cjs` |
| Config | `orchestration.approval_ttl_hours` (72), `orchestration.pause_ttl_hours` (none), `concurrency.strict` (false). Each must have a reader (liveness registry) |
| Installer | No change: the new modules ship with the core; the manifest hashes them like any core file |
| Manifest | No format change |
| Backward compatibility | No `_rev` → 0; no journal → today's inference; old approvals file without `token_sha256` → compared by plain token once, then rewritten hashed; old autodev ledgers read `type` |

### 3.8 Implementation plan (stages, each shippable alone)

| Stage | Content | Why this order |
|---|---|---|
| **A — store** | `store.cjs`; `lock.cjs` changes; move every writer in 1.2 onto it; `reserveDir`; cost-cursor inline copy; the "no direct write" test; `concurrency.strict` | Correctness first: fixes ten races with no new behaviour visible to a single user |
| **B — transitions** | `transitions.cjs`; enforce in `updateRecord`; `phase complete`, `state update Status`, quick-task enum, focus auto-run, autodev run status in `run.json`; `nextAction` `unknown_state` + `allowed` | Needs A (the check must sit inside the lock) |
| **C — journal + resume** | `journal.cjs`; verbs; autodev ledger shape; focus run journal; `open_work.resume_at`; execute-plan / exec-phase / exec-waves / resume prompts | Needs A (`appendLine`); independent of B |
| **D — pauses + merge gate** | `pause.cjs`, `pause-schema.cjs`; verbs; MCP tools; merge-gate migration; next-action `answer_pause`; autodev `pause_open`; prompts | Needs A and B; uses C for the `resumed` line |
| **E — integration** | ADR-0052; docs; hygiene/doctor checks; harness scenarios; prompt-rule and surface registries; CLAUDE.md counts | After the behaviour exists |
| **F — fork (optional)** | `journal fork` | Only once C has run in real projects |

### 3.8.1 Stage A as built (`2026-11-02`)

Three choices differ from D1 as written; each keeps its guarantee with a smaller change:

- **Planning markdown is locked per command, not per write.** Rather than rewriting each of the state, roadmap, requirements and config writers as an `updateText` mutation, the dispatcher calls `store.lockCommand(cwd, verb, sub)` before it dispatches. A table (`COMMAND_LOCKS`) names the files each command reads and writes, and the command holds those locks, in one fixed order, for its whole run. Holds are re-entrant, so `writeStateMd`'s own lock nests inside, and `lock.cjs` releases every held lock at process exit, since `output()` ends the process. The command's read and write fall inside one hold, which is the property D1 asks for. `updateText` exists for later stages and for callers outside the dispatcher.
- **Autodev claims a run instead of locking its ledger.** A run lasts hours, longer than any lock should be held. `run.json` records `owner: {pid, since}`, a second driver is refused `run_busy` while that process is alive, and the claim is released when `runAutodev` returns. Ledger lines stay single appends, which ADR-0030 already treats as atomic.
- **Lock files moved out of the project.** A command that holds a lock while it commits `.planning/` (`phase complete`) would have committed `<file>.lock`, and a lock beside a file showed up in directory listings and was written into planning trees PAN does not own. `lockPathFor` puts every lock in `<os temp>/pan-locks/<sha1 of the absolute path>-<name>.lock` (lower-cased on Windows). A strict wait is now measured by the clock (7 s, inside the 10 s stale window), and Windows `EPERM` on a lock being deleted counts as contention.
- **Quick numbering** goes through `reserveDir` for focus cycles. `init quick`, which returns a number the model then uses to create the directory, is unchanged. A number cannot be reserved across a model turn, and `/pan:quick` runs in a single session.

The merge gate gained only the locked confirm in this stage (race 9). Expiry, the hashed token and refusing a request over a merged record are D5, in Stage D.

### 3.8.2 Stage B as built (`2026-11-02`)

`transitions.cjs` holds four tables (`focus.run`, `autodev.run`, `merge.request`, `phase`) and the Quick Tasks status values. `store.updateRecord`'s `transition` option checks a status change inside the record's lock. Only a change of status is checked; a write that sets no status, or a record with a new identity (`run_id`, `id`), is not refused. Three points differ from D2 as written, each because an existing contract or field said otherwise:

- **`phase complete` on a complete phase stays idempotent.** `tests/scenarios/contracts-phase.test.cjs` pins it (it exits 0 with the same payload), and the autodev and transition flows rely on a retry being safe. The `phase` table is used by next-action, not by `phase complete`.
- **A merged request may be staged again.** Re-staging a branch with new commits after a merge is the documented fresh-token flow (`tests/pan-zcode-orchestration.test.cjs`), so `merged → awaiting_approval` is an edge, not a refusal.
- **state.md's `Status` stays free text.** It describes the current phase, and which change is legal depends on which phase that is. Checking it would refuse ordinary moves between phases. The phase is checked through its disk status instead. Quick-task status is an enum of the values the writers actually record (`verified`, `partial`, `failed` from focus; `Verified`, `Needs Review`, `Gaps` from `/pan:quick`; `done`), not `done | partial | failed`.

### 3.8.3 Stage C as built (`2026-11-02`)

`journal.cjs` and the `journal step | show | resume-point` verbs follow D3. The `plan.step` table is in `transitions.cjs`, and `verifyCommit` moved into `core.cjs`, where focus close and the journal share it. `open_work` adds `resume_at`, `completed_steps` and `unverified_steps` per journaled plan. The executor's commit protocol and `execute-plan` journal each task, and a continuation starts from `resume-point`. Focus open and close journal the cycle in the engine. Two choices differ from D3:

- **Autodev's ledger keeps its shape.** Its rows are units (`started`, `finished`, `stopped` per unit seq), not plan steps, and `autodev replay` and the run status read them as they are. The claim from Stage A already stops two drivers appending to one run.
- **`pan-exec-waves` writes no journal lines of its own.** Its executors journal every task through the shared commit protocol, and a plan's completion is its summary, which the script already uses to skip plans.

### 3.8.4 Stage D as built (`2026-11-02`)

`pause.cjs`, `pause-schema.cjs`, the `pause` verbs, `pan_list_pauses` and `pan_answer_pause` follow D4. The `pause` table joins `transitions.cjs`, and a second answer or a cancel of a closed pause is refused. Next-action puts `answer_pause` first, `open_work.pauses` lists open pauses, autodev's `human_needed` stops open an `autodev-human` pause, and every autodev run is refused `pause_open` until it is answered. exec-phase and execute-plan open a pause per checkpoint and record the answer through it, and auto-advance answers `human-verify` the same way. Merge requests get `requested_at`, `expires_at` and `approved_at`, with `approval_expired` as a refusal. Three points differ from D4 and D5:

- **The approval token stays in the request file.** `pan-tools merge confirm` reads it there to approve in a person's terminal. What protects an MCP merge is that the token must be in the server's environment, which an agent cannot set, so hashing the file's copy would break the CLI path and gain nothing.
- **`expects` is given by kind or `--options`.** `--expects '<json>'` remains for the rest, since JSON on a command line quotes differently in every shell PAN's runtimes use. `human-verify` uses a per-value note (`noteFor: ['issues']`), not a separate object answer.
- **An open pause is not work in flight for the guard.** Nothing edits the tree while a question is open, and the guard's `workInFlight` copy stays pinned to `open_work.in_flight` unchanged.

### 3.8.5 Stage E as built (`2026-11-02`)

ADR-0052 is written and amends ADR-0030. ARCHITECTURE gains a "Durable state" section and design decision 11. Hygiene H-15 (`checkDurableState`) reports `pause-open-stale` (a week) and `journal-abandoned` (a day, no summary). The tier-0 scenarios `resume-from-journal` and `pause-survives-session` run on the `journal-plan` seed, each with a control that the harness confirms turns it red. Opening a pause on a plan step now journals the step `paused`, so the answer's `resumed` line is a legal change. Two items wait:

- **The prompt rules stay allowlisted, not claimed.** The four rules (the executor's and execute-plan's journal step, exec-phase's pause answer, resume's pauses line) are carried out by a model. A tier-0 scenario drives the engine, not the prompt, so a `--prompt-mutant` run that deleted the rule would still pass it and wrongly report the rule as decorative. A model-tier scenario is what can claim them.
- **D6, fork from a checkpoint, is deferred** until journals have run in real projects.

### 3.9 Test plan

New files: `tests/store.test.cjs`, `tests/transitions.test.cjs`, `tests/journal.test.cjs`, `tests/pause.test.cjs`; additions to `tests/pan-zcode-orchestration.test.cjs` and `tests/phase-gate.test.cjs` (merge gate, `nextAction`), `tests/consolidate-surfaces.test.cjs` (the `next-action` router), `tests/open-work.test.cjs`, `tests/focus-integration.test.cjs`, `tests/autodev*.test.cjs`.

| # | Kind | Case |
|---|---|---|
| 1 | happy | `updateRecord` increments `_rev`, writes atomically, returns new data |
| 2 | happy | `journal resume-point` returns task-4 after three verified `completed` lines |
| 3 | happy | `pause answer` with a valid enum value moves `open → answered` and appends `resumed` |
| 4 | happy | merge request → approve → confirm records `requested_at`, `approved_at`, status `merged` |
| 5 | happy | `next-action` returns `answer_pause` ahead of focus and phase routing |
| 6 | edge | file without `_rev` reads as 0; first write sets 1 |
| 7 | edge | CRLF markdown: `updateText` hash CAS succeeds on unchanged CRLF content |
| 8 | edge | `completed` line whose commit is not reachable → `unverified`, resume at that step |
| 9 | edge | no journal → `resume_at` absent, plan restarts at top (today's behaviour) |
| 10 | edge | stale lock (holder dead, > 10 s) is stolen; strict caller succeeds |
| 11 | edge | Windows EPERM on rename: retried, then fallback reported `atomic: false` |
| 12 | edge | old approvals file with a plain token: accepted once, rewritten hashed |
| 13 | error | `expectRev` mismatch → `stale_write`, file unchanged |
| 14 | error | `completed → in_progress` on focus run → `illegal_transition` with `allowed` |
| 15 | error | `pause answer` with a value outside the enum → `pause_answer_invalid`, still `open` |
| 16 | error | second `confirmMerge` → `already_consumed`; expired → `approval_expired` |
| 17 | error | strict lock timeout → `lock_timeout`, nothing written |
| 18 | concurrency | 8 child processes × 50 `updateRecord` increments → `_rev` and counter both 400 (JSON), and the same on state.md through `state update` |
| 19 | concurrency | `focus auto --stop` racing `focus open` never resurrects `in_progress` |
| 20 | concurrency | two `appendLine` writers produce unique, gap-free `seq` |
| 21 | guard | no module writes an orchestration path with `writeFileSync` directly (grep test) |
| 22 | guard | every table's states ⊇ the matching constant in `constants.cjs` |
| 23 | runtime | installed core (packed tarball, each of the 5 runtimes in a temp dir) contains the new modules and `pan-tools journal`/`pause` run from it |
| 24 | runtime | `pan-exec-waves` script source records a journal step per plan (string assertion on the generated script) |
| 25 | prompt | execute-plan, exec-phase and resume prompts call `journal step`, `pause open/answer` and read `resume_at` (prompt-contract tests, prompt-lint verbs) |

**Harness (tier 0, model-free):**
- `resume-from-journal`: seed a plan with three journaled, committed tasks; `init resume` must name task 4. Control: delete the journal → must restart at the top.
- `pause-survives-session`: open a decision pause, start a fresh `next-action`; must return `answer_pause`; a wrong answer must be refused. Control: delete the pause file → must route to phase work.

---

## Phase 4: Specification

## Feature: Durable orchestration over files

### Files to create/modify

- **Create:** `pan-wizard-core/bin/lib/store.cjs`, `transitions.cjs`, `journal.cjs`, `pause.cjs`, `pause-schema.cjs`; `tests/store.test.cjs`, `tests/transitions.test.cjs`, `tests/journal.test.cjs`, `tests/pause.test.cjs`; `harness/scenarios/resume-from-journal.json`, `harness/scenarios/pause-survives-session.json` with seeds; `docs/decisions/ADR-0052-durable-orchestration-over-files.md`.
- **Modify:** the modules listed in 3.7; `pan-wizard-core/bin/pan-tools.cjs` (verbs, usage); `pan-wizard-core/mcp/native-tools.cjs` + `tool-registry.cjs`; `bin/install-lib.cjs` (exec-waves script source); prompts listed in 3.7; `pan-wizard-core/templates/config.json` (new keys); `tests/fixtures/surface.json`, `prompt-rules.json`, `module-surface.json`, liveness allowlist if needed.

### Implementation steps

1. Stage A: `store.cjs` + `lock.cjs` changes; migrate writers one module at a time, each with its race test; add the guard test last so it lands green.
2. Stage B: `transitions.cjs`; wire into `updateRecord`; switch each status writer; `nextAction` checks.
3. Stage C: `journal.cjs` + verbs; autodev ledger shape; `open-work` `resume_at`; prompts; exec-waves script.
4. Stage D: `pause.cjs`/`pause-schema.cjs` + verbs + MCP tools; merge-gate migration; next-action and autodev integration; prompts.
5. Stage E: ADR-0052, docs, hygiene/doctor checks, harness scenarios, registries, counts; full suite, harness tier 0, `ci:local`.
6. Stage F (optional): `journal fork`.

### Tests required

The 25 cases in 3.9 plus the two tier-0 harness scenarios. Every stage keeps the full suite green and runs `scripts/test-surface.cjs --check` and `scripts/prompt-rules.cjs --check`.

### Documentation updates

- `docs/ARCHITECTURE.md`: a "Durable state" section (store, tables, journals, pauses) and the module rows.
- `docs/CLI-REFERENCE.md`: `journal` and `pause` verbs, new refusal codes (`stale_write`, `lock_timeout`, `illegal_transition`, `unknown_state`, `pause_answer_invalid`, `pause_open`, `approval_expired`), new output fields (`_rev`, `resume_at`, `allowed`).
- `docs/USER-GUIDE.md`: resume picks up at the task; answering a pause; the three config keys.
- `docs/TROUBLESHOOTING.md`: `stale_write`, `lock_timeout`, `illegal_transition`, an `unverified` journal step, an expired approval.
- `docs/INTERNALS.md`: writing through `store.cjs` (and the guard test that enforces it).
- `docs/DEVELOPMENT.md`: adding a status → add it to its table.
- `CHANGELOG.md` `[Unreleased]`; `CLAUDE.md` counts (modules, test files, ADRs, tests).

### Runtime matrix

| Runtime | Supported | Notes |
|---|---|---|
| Claude | ✅ | Prompts call the verbs; `pan-exec-waves` records journal steps; MCP tools for pauses and the merge gate |
| Codex | ✅ | Same verbs from the prompts; MCP tools through Codex's MCP registration |
| Gemini | ✅ | Same verbs; MCP tools through Gemini's MCP registration |
| OpenCode | ✅ | Same verbs; the plugin needs no change (it re-injects position from files, which now include `resume_at`) |
| GitHub | ✅ | Copilot CLI: same verbs and MCP tools |

---

## Phase 5: Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Strict JSON locking turns contention into refusals a user has never seen | Medium | 5 s timeout on millisecond sections; refusal names the holder pid and the lock path; state.md stays best-effort unless `concurrency.strict`; doctor reports stale locks |
| Windows rename failures (antivirus, open readers) defeat atomicity | Medium | Retry before fallback; report `atomic: false`; doctor counts fallbacks |
| Model skips `journal step` | Medium | Journal is an optimisation: no journal → today's restart; harness control scenario; prompt-rule registry claims the lines |
| Forged or stale journal line skips real work | High | Steps count only with a verified artifact (reachable commit, file hash); otherwise `unverified` and resumed there |
| Transition tables reject a path real projects use (hand-edited state) | Medium | `--force --reason`, journaled; `unknown_state` reports instead of guessing; Stage B ships with the tables derived from every status the code writes today, checked by test 22 |
| Pause files pile up | Low | Answered/cancelled pauses archived with the phase; hygiene lists open pauses older than a week |
| Merge-gate format change breaks an MCP caller | Medium | Field names kept; plain-token records accepted once and rewritten; refusal codes only added |
| Hook copy of the lock drifts from `lock.cjs` | Low | Behaviour-pinning test, like the existing hook/core pins |
| Performance: a lock per write | Low | Microbenchmark in the suite: `updateRecord` p95 under 20 ms on this machine; appends unchanged outside the seq read |
| Scope creep toward a graph engine | Medium | Out-of-scope table; no node/edge runtime; tables are data checked by writers, not an executor |

---

## Review fixes (design `2026-11-02`)

A `/code-review max` of Stages A–E (fifteen verified findings, eighteen more confirmed past the cap) found that three of the stages' own mechanisms were wrong at the root, not at single call sites. The fixes below change those mechanisms; the call-site fixes follow from them.

### R1. A lock is stale only when its holder is gone

Stage A held locks for a whole command but kept ADR-0030's rule that any lock older than 10 s is stale. A live command longer than 10 s (`focus auto --update` running the suite, `merge confirm` running git) lost its lock to a waiter, and both wrote: a stop was undone, a merge could run twice. The re-entrant hold never noticed, because it trusted the in-process map.

- **Staleness is the holder's death, not the lock's age.** The lock file holds `<pid>@<hostname>`. A waiter steals a lock older than 10 s only when that pid is not alive on this host (`process.kill(pid, 0)`; EPERM counts as alive). A lock from another host is judged by age alone, as before. A live holder is never stolen from, however long it runs; a strict waiter refuses `lock_timeout` naming the holder's pid.
- **Re-entry checks ownership.** The re-entrant fast path re-reads the lock file; if it no longer names this process, the hold is re-acquired, never assumed.
- **A whole-record write states what it read.** `writeAutoRun` passes the `_rev` it read as `expectRev`, so a write built from a stale read fails `stale_write` instead of overwriting, whatever the lock did.
- **The steal branch obeys the deadline.** A failed steal waits and counts against the deadline; a strict acquire can no longer spin.

### R2. Where lock files live

Locks stay outside the project (Stage A's reason holds: nothing commits or lists them, nothing is written into a tree PAN does not own), but:

- **Per user:** `<os temp>/pan-locks-<user>/`, created mode 0700. One user's directory never blocks another's. On POSIX an EACCES is not contention: it returns unacquirable at once, as ADR-0030 had it; Windows keeps retrying EPERM/EBUSY/EACCES (the pending-delete case).
- **One name per file:** the lock name hashes the file's directory resolved through `fs.realpathSync.native` (when it exists) plus its basename, so a symlink, a junction, an 8.3 short name or macOS's `/var`→`/private/var` all meet at one lock. Processes with different temp directories still do not share locks; that limit is stated in the docs.

### R3. Every planning-markdown read-modify-write locks itself

The per-command `COMMAND_LOCKS` table could not cover writers reached through other verbs (focus close, hygiene clean, the memory auto-optimiser) and held writer locks over read-only subcommands. The read now moves inside the write's own lock, where the write happens: `withState` (every state-write verb, so focus close too), `compactState`, `compactRoadmap` (which also moves to an atomic write) and `maybeAutoOptimizeMemory` hold the file's lock from read to write. `COMMAND_LOCKS` keeps only the commands whose read and write are in separate functions, and only their writing subcommands (`state` reads, `memory` reads, `roadmap slice` without `--write` and `validate health` without `--repair` lock nothing).

### R4. Pauses and checkpoints close their journal step

- Answering a pause on a plan step with an answer that ends the step (`approved`, `done`, a decision's option) journals the step `completed`, with the answered pause file as its artifact; `issues` journals `resumed`, and the step stays open until a later pause is approved or the task is committed. `plan.step` gains `paused → completed` and `failed → completed`, so a cancelled or expired pause never strands its step.
- A pause id must match `p-[a-z0-9][a-z0-9.-]*`; anything else is refused `invalid_id` before a path is built.
- Every autodev `human_needed` stop opens its pause, from the one place every stop passes through (`finish`), and `/pan:autodev` routes `pause_open` and `run_busy`.

### R5. Records PAN cannot parse

A whole-record writer (a new focus run, a new focus batch, a new autodev run, a merge request) may replace an unparseable record: `updateRecord`'s `replaceUnreadable` moves it aside to `<file>.unreadable-<timestamp>` and writes the new one. A read-modify-write still refuses `unreadable`. Callers of `requestMerge` check for a refusal (the CLI exits 1 without a `next` hint; the MCP tool sets `isError`).

### R6. Smaller fixes

- next-action's phase table accepts the statuses PAN's own snapshot sources emit (`no_directory` → `empty`; pan://progress's `Pending`, `Planned`, `In Progress`, `Complete`).
- `resolvePlan` lets `findPhaseInternal` judge the phase part (multi-level decimal and letter phases), and the task count is shared with `phase-plan-index` (`<task>` elements, else `## Task N`).
- `open_work` checks the journal only of unfinished plans, and a step's commit with one `git merge-base --is-ancestor`.
- `bus drain` reads the entries it consumes inside the lock that rewrites the channel.
- `store` no longer creates a record's directory before taking its lock (locks no longer live beside records), so a refused call leaves nothing behind.
- `appendLine` starts its row on a new line when the file does not end in one.
- The cost-logger hook mirrors R1 and R2 (lock name, errno handling) and reads the transcript slice outside the lock, taking it only to re-check the cursor and write it.
- `orchestration.*_ttl_hours` that do not parse fall back to the default (72 for approvals, none for pauses) instead of disabling expiry, and an out-of-range value is capped.
- Tests: the strict wait is configurable (`PAN_LOCK_WAIT_MS`), planted test locks are removed after each test, and the macOS path case is covered by the identity fix.

---

## Sources (read `2026-11-01`, via the deep-research run)

- LangGraph persistence, interrupts, time travel: <https://docs.langchain.com/oss/javascript/langgraph/persistence>, <https://docs.langchain.com/oss/javascript/langgraph/interrupts>, <https://docs.langchain.com/oss/javascript/langgraph/use-time-travel/index.html>
- `@langchain/langgraph` 1.4.1 manifest: <https://cdn.jsdelivr.net/npm/@langchain/langgraph@1.4.1/package.json>
- Temporal × OpenAI Agents SDK: <https://docs.temporal.io/develop/typescript/integrations/openai-agents.md>
- Mastra snapshots and `resumeSchema`: <https://mastra.ai/docs/workflows/snapshots/llms.txt>
- langgraph-codex: <https://pypi.org/project/langgraph-codex/0.1.0/>
- GSD resume: <https://cdn.jsdelivr.net/npm/get-shit-done-codex@1.4.1/commands/gsd/resume-work.md>
- GSD-Lite: <https://github.com/sdsrss/gsd-lite>
