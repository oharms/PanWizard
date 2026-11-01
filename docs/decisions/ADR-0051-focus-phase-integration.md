# ADR-0051: Focus is part of the phase system's state

## Status

Proposed — 2026-11-01. Designed in `/featureAI` (spec `docs/specs/focus_phase_integration_featureai.md`, with the Stage A.1 design added after a `/code-review max` pass) and built in five stages the same day on the maintainer's instruction. The maintainer accepts or amends it at release review. It amends ADR-0015 (the focus auto-runner) and ADR-0031 (the backlog source).

## Context

The focus commands (`/pan:focus-auto`, `/pan:focus-docs`, `/pan:focus-design`) grew beside the phase system rather than inside it:

- `focus-auto --step exec` implemented items in session and committed with raw git. It left no record the rest of PAN reads: state.md, `/pan:progress` and `/pan:resume` could not see focus work.
- Under exclusive routing with the guard enforcing (ADR-0050), the `unrouted_write` rule would deny a focus run's own edits, since only phase plans, quick tasks and debug sessions counted as work in flight. Neither `auto-run.json` nor a batch file could serve: a crash leaves the first `in_progress` for good, and nothing marks the second finished.
- `--source backlog` (ADR-0031) selected roadmap phases and mapped requirements and implemented them, skipping the phase system's plan check, verification and EARS-gated requirement tick.
- `/pan:focus-design` wrote to `docs/specs/` and `docs/decisions/` in every project, where nothing else in PAN looked, and its design reached neither a phase nor focus.
- Autodev and focus-auto could run side by side, each reading the other's edits as its own.

## Decision

1. **A focus cycle is a quick-task record.** `focus open` registers a cycle as `.planning/quick/<n>-focus-<kind>-<date>/` with a plan (`source: focus`), numbered with `/pan:quick`. `focus close` writes the summary last, and the summary is what closes the cycle. The guard, state.md and resume see it with no focus-specific code in the guard. ADR-0006's rule against a parallel tracker holds.
2. **The engine owns the cycle's facts, not the agent.**
   - `focus close --files` commits the cycle's source through the source commit path, so `commit_docs` does not skip it. It then commits the cycle's record under the planning rules, the todo moves included.
   - `focus open` keeps the test run as the cycle's baseline. The close derives the status from the measurements, and the agent's claim can only lower it. A failure already present at open is pre-existing; a regression is `failed` and never committed.
   - `focus auto --update` records the cycle the run's `focus open` named (`current_cycle`), never one it searched for.
   - The commit-safety deleted-file check now reads the deletions the commit would make (staged ones), for every commit verb.
3. **One owner per item** (amends ADR-0031). A roadmap phase, a plan inside one, and a requirement the traceability table maps to a phase belong to the phase system. `focus route` hands them to `/pan:plan-phase` or `/pan:exec-phase`, and `focus open` applies the same split, so the in-session agent never decides it. Backlog still selects phase work; it routes it instead of doing it. A requirement mapped to no phase stays a focus item, left unticked.
4. **The rest of PAN sees focus** (amends ADR-0015):
   - `next-action` (and so progress and resume) puts an open cycle or a stale run ahead of phase routing.
   - `init resume` lists open work through one `openWork()`, which a test pins to the guard's own copy, since a hook cannot require core.
   - The HUD has a focus panel. Hygiene reports stale runs (`focus.stale_hours`, default 12) and quick tasks open for a day.
   - Autodev and focus-auto refuse to start beside each other; a stale run on either side does not block.
5. **A design lands where the project keeps designs, and is handed on.**
   - `design paths` returns `docs/specs/` and `docs/decisions/` only when the project has both, else `.planning/designs/<slug>/`. The checker's verdict is saved beside the spec.
   - `design handoff --as phase` adds a roadmap phase that names the spec and is planned with `/pan:plan-phase <N> --prd <spec>`. `--as focus` hands it to the focus plan step. The altitude split of ADR-0042 is unchanged.
6. **Routing gets one row.** `focus-design` ("investigate and design a feature before building it") joins the AGENTS.md table. `focus-auto` gets none: a campaign is a deliberate, budgeted start, and routing plain requests into an autonomous loop is the over-routing ADR-0050 warns of.

## Consequences

- Every write-producing focus run leaves a quick task, a summary, a state row and batch `results` behind, and commits through the safety checks.
- **A close can now fail where a hand-written commit used to succeed:** a sensitive path or a staged deletion refuses it. The cycle stays open and nothing is written, and the prompts name the way out: fix the cause, or commit yourself and close with `--commit <sha>`.
- Backlog campaigns do less themselves. Phase work they select appears as hand-offs with the phase command instead of being implemented.
- **Two engine test runs per exec cycle** (open and close) replace the agent's reported counts; a project with no test command records none, and its cycles cap at `partial`.
- `auto-run.json` gains `current_cycle`. A run started before this change takes the flag path at `--update`, as an unregistered cycle does.
- The AGENTS.md section grows by one row; its earlier advisory and exclusive texts are recognised by hash, so an upgrade replaces them.
- **Verified:** unit tests, and the tier-0 harness scenario `focus-cycle-registered`, whose control (the registered cycle deleted) turns it red.
- **Not yet measured:** whether model sessions follow the routing and close steps as written. No paid tier ran.
