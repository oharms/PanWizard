# ADR-0052: Durable orchestration over files, not a graph engine

## Status

Proposed — 2026-11-02. Prompted by a deep-research run (2026-11-01) on whether a LangGraph-style engine would improve PAN, designed in `/featureAI` (spec `docs/specs/durable_orchestration_featureai.md`), and built in five stages the same day on the maintainer's instruction. The maintainer accepts or amends it at release review. It takes the escalation path ADR-0030 left open (wider lock adoption and strict mode).

## Context

PAN's orchestration state is a set of files under `.planning/` that the engine and the model both write. That base is right for PAN: it works the same in all five runtimes, a person can read it, and it survives any crash of the host CLI. But the files were written without the guarantees a durable workflow engine gives:

- **Writes could lose each other.** Only `state.md` was written under a lock, and even there the read came before the lock. Roadmap, requirements, config, focus runs and batches, autodev run records, merge-gate approvals and the bus were plain read-modify-write. The design found ten concrete races, among them a `focus auto --stop` undone by a cycle opening at the same time and two confirms of one merge.
- **No status had a declared set of legal changes.** Focus runs checked some changes without a lock; autodev runs, quick-task statuses and merge requests checked none.
- **Resume restarted a whole plan**, re-inferring progress inside it from `git log` and the model's reading of the plan.
- **A question to a person lived only in the conversation.** A checkpoint, a plan-check override or an autodev `human_needed` stop left nothing on disk, and the answer was checked only by the model.

The research found that LangGraph's pauses, time travel and crash recovery all rest on one mechanism, a checkpointer keyed by a thread id. Its in-memory default loses everything on restart, so durability needs SQLite or Postgres. The package brings five runtime dependencies plus the `@langchain/core` and `zod` peers. Temporal and Mastra assume an application that calls model APIs and runs its own worker or database. The only LangGraph-plus-coding-CLI project found runs the CLI as one node of the graph, the inverse of PAN, which lives inside the CLI. A direct peer, GSD-Lite, gets the same guarantees from a small state machine over one JSON file: schema-checked, version-numbered, written atomically under a lock.

## Decision

Adapt the ideas; do not adopt an engine. Five parts, each over files, each reached through `pan-tools` verbs every runtime already calls:

1. **One write path (`store.cjs`, Stage A).**
   - JSON records are read inside their lock, written atomically, and carry `_rev`, with an optional compare-and-swap (`stale_write`).
   - Markdown gets the same through a hash of its raw bytes.
   - Journal lines are numbered under the lock, and numbered directories are claimed under one.
   - A dispatcher command that edits planning markdown holds those files' locks for its whole run.
   - Locks are re-entrant, released at process exit, and kept outside the project (`<os temp>/pan-locks/`), so nothing commits or lists them.
   - Strict waits are timed (7 s, inside the 10 s stale window). `concurrency.strict` turns a markdown lock timeout into `lock_timeout`.
   - Autodev claims its run (`run_busy`).
2. **Declared state tables (`transitions.cjs`, Stage B).** Focus runs, autodev runs, merge requests, plan steps, pauses and phases each declare their states and the changes allowed. A writer checks a change inside the record's lock (`illegal_transition`, `unknown_state`, with `allowed`), and next-action stops on a phase status no table knows instead of planning again.
3. **A step journal (`journal.cjs`, Stage C).** `<plan>-journal.jsonl` beside each plan records each task's commit. Resume starts at the first task the journal cannot prove done. A line is evidence, not an instruction: a commit no longer reachable from HEAD, or a changed file, makes PAN redo the step, never skip it.
4. **Typed pauses (`pause.cjs`, Stage D).** A question to a person is a file that says what answer it takes, and the answer is checked in code. Next-action asks an open pause before any other work, and autodev does not run while its `human_needed` pause is open. Merge requests expire (`orchestration.approval_ttl_hours`, default 72) and record when they were approved.
5. **Checks (Stage E).** Hygiene reports a pause open for a week and a journaled plan abandoned for a day. Tier-0 harness scenarios prove resume and pauses against a packed install, each with a control that must turn it red.

Fork from a checkpoint (the spec's D6) is deferred until journals have run in real projects.

## Consequences

**Positive.**
- Concurrent PAN processes no longer lose each other's writes.
- A corrupted or foreign status is reported, not routed on.
- A crash mid-plan costs one task, not the plan.
- A question survives the session that asked it.
- All of it keeps PAN's zero-dependency, five-runtime, human-readable state.
- Projects need no migration: a record without `_rev` reads as revision 0, a plan without a journal restarts at its first task, and a request without `expires_at` never expires.

**Negative / risks.**
- Strict locks turn contention into refusals a user had not seen before. They are bounded to JSON orchestration records and to markdown under `concurrency.strict`.
- The journal only helps when the executor records it. A model that skips the step gets today's behaviour, not a wrong one.
- Contracts the suite pins kept three of the spec's refusals out:
  - `phase complete` on a complete phase stays idempotent;
  - a merged branch may be staged again;
  - state.md's `Status` stays free text.
- This is not deterministic replay. A redone step calls the model again and may differ, as LangGraph's own replay does.

## Alternatives considered

- **Embed LangGraph.js.** Rejected: runtime dependencies and peers, a database for durability, and an engine shaped for apps that call model APIs, not for prompts running inside a host CLI.
- **Temporal or Mastra.** Rejected for the same reason, plus a worker process none of the five runtimes provides.
- **Section-merging (CRDT-like) writes.** Still rejected, as in ADR-0030: a wrong automatic merge of human-readable markdown is worse than a refused write.
