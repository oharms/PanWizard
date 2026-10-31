# Focus–Phase Integration — Feature Investigation & Spec

**Date:** `2026-10-31` · **Status:** Proposed. Stage A (registration, D2–D4, D8) is implemented (`2026-10-31`); Stages B to E are not. Implementation records the decision as an ADR that amends ADR-0015 and ADR-0031.

**Stage A as built, where it differs from the text below:** `focus open` starts no trace (focus-exec already runs `optimize trace init` and `end`). A `docs` cycle runs no tests, so its status is not capped. `focus close` also caps a `verified` claim at `partial` when the closing test run did not pass, and refuses an item id that is not in the cycle's plan or is reported both done and failed. Items neither done nor failed are listed as `not reported`, and failure reasons go to a `result_reasons` key beside `results`. The tier-0 harness scenario is left to Stage E.

The focus commands (`/pan:focus-auto`, `/pan:focus-design`, `/pan:focus-docs`) were meant to "compose with existing phase commands (not a parallel system)". That was ADR-0006, and its spec made it success criterion SC-8. They no longer do. Focus work changes the code in the session, keeps its state in `.planning/focus/`, commits with raw git, and records nothing the rest of PAN reads. `/pan:progress`, `/pan:resume`, `/pan:autodev`, the HUD and the guard cannot see it. A focus-design spec reaches no phase. Since 3.39.0 this has a sharp edge: with `instructions.routing: exclusive` and `hooks.guard: enforce`, the guard would refuse focus-auto's own edits.

This spec makes focus work a first-class unit of work in the main system. It reuses the records PAN already has (quick tasks, the state table, the commit verb, the PRD intake of plan-phase) instead of adding a parallel tracker. That last part is ADR-0006's rejected option.

---

## Phase 0: Problem framing

### 0.1 Problem statement

A user who runs a focus campaign gets real commits with no trace in PAN's own records:
- No row in state.md, and no Last Activity entry.
- `/pan:progress` and `/pan:resume` say nothing about the campaign, so after a break PAN resumes the roadmap and forgets it.
- `/pan:autodev` can start on the same tree while a campaign is mid-cycle; nothing makes them exclusive.
- A backlog campaign (`--source backlog`, ADR-0031) can implement a roadmap phase in the session. That bypasses the planner, the verifier and the phase gate, and never ticks the phase.
- `/pan:focus-design` writes its spec to `docs/specs/` and `docs/decisions/` in any project. That is PAN's own source-repo layout. No phase command reads either directory.
- The 3.39.0 request routing assumes every write outside `.planning/` belongs to a known unit of work. Focus work is the one PAN-run activity that is not one.

Now is the right time. The routing feature has just made "which unit of work owns this edit" a rule PAN can enforce. The owner also asked for the focus seam to be designed whole, not patched one edge at a time.

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| One owner per work item: phase-owned items go through the phase system, and focus executes only items no phase owns (D1) | Rewriting the focus scan, plan or prioritisation logic |
| Every focus exec cycle and focus-docs write registered as a quick-task record that the engine opens and closes (D2) | A new tracker or state file for focus (ADR-0006 rejected one) |
| Commits through `pan-tools commit`; test counts measured by the engine, not reported by the agent (D3, D4) | Running the full verifier or the phase gate on focus cycles (right-sized ceremony keeps them lean) |
| next-action, progress, resume, the HUD and autodev see focus runs and open cycles; autodev and focus-auto are mutually exclusive (D5) | Findings-ledger records for quick or focus work (needs a non-phase key; listed as a follow-up) |
| focus-design writes where the project keeps such files, and hands off to a phase through `plan-phase --prd` or to a focus plan (D6) | Changing design-phase, or the altitude split of ADR-0042 |
| A routing-table row for focus-design; help presents one system (D7) | Routing plain requests to focus-auto (campaigns start by name) |
| Stale-run detection for `auto-run.json` (D9) | Auto-healing a crashed run |

### 0.3 Success criteria

```
SC-1: In a project with instructions.routing: exclusive and hooks.guard: enforce, a full
      /pan:focus-auto cycle and a /pan:focus-docs --fix run complete on Claude Code,
      Codex, Gemini CLI and Copilot CLI without an unrouted_write denial, and a
      hand-written edit outside any cycle is still denied (guard unchanged).
SC-2: After a focus exec cycle closes, state.md has a "focus:" row in Quick Tasks
      Completed, Last Activity names it, the cycle's quick directory has a plan and a
      summary, and the batch file records each item's result.
SC-3: /pan:progress and /pan:resume name an open focus cycle or an active or stale
      focus run, and pan-tools next-action returns the focus continuation before any
      phase action while a cycle is open.
SC-4: autodev refuses to start while a focus run is active or a focus cycle is open,
      and focus-auto refuses to start while an autodev run is active; both name the
      other run.
SC-5: focus-auto --source backlog never implements a roadmap phase or a requirement
      mapped to a phase in the session; it hands the item to the phase system and
      records the hand-off.
SC-6: In a project without docs/specs/ and docs/decisions/, focus-design writes under
      .planning/designs/<slug>/; in one with both, it keeps writing there. Its hand-off
      "as a phase" adds a roadmap phase and prints the plan-phase --prd command that
      plans it from the spec.
SC-7: Commits from focus cycles go through pan-tools commit (the sensitive-pattern
      checks run), and the cycle's recorded test counts come from the engine's test
      run (tests_verified: true).
SC-8: The full suite passes; surface, prompt-rule, liveness and coverage checks pass;
      a tier-0 harness scenario exercises open, guard, close on a packed install,
      with a control that turns it red.
SC-9: Docs updated (USER-GUIDE, CLI-REFERENCE, ARCHITECTURE, help); counts only in
      CLAUDE.md.
```

### 0.4 User stories

```
As a user running a focus campaign, I want each cycle to show up in state.md and
/pan:progress, so that I and the next session can see what changed, instead of digging
through git log for "focus-auto cycle N" commits.

As a user in exclusive routing, I want focus-auto and focus-docs to work as PAN work,
so that turning on enforcement does not break PAN's own commands, instead of having
to exempt the whole tree.

As a user who designed a feature with /pan:focus-design, I want to turn the spec into
a planned phase in one step, so that the design drives planning, instead of copying
the spec into a phase description by hand.

As a user with a roadmap, I want a backlog campaign to leave phase work to the phase
system, so that my phases still pass through the verifier and the phase gate, instead
of being implemented around them.

As a user who left autodev running, I want focus-auto to refuse to start on the same
tree (and the reverse), so that two loops never commit over each other.
```

---

## Phase 1: Internal reconnaissance (code read `2026-10-31`)

### 1.1 How focus works today

| Area | Fact | Evidence |
|---|---|---|
| Engine role | `focus.cjs` keeps state only. `focus plan` writes `batch-YYYY-MM-DD.json` (overwriting that day's file) and `focus auto` writes `auto-run.json`; every other verb reads | `focus.cjs:331-413`, `:730-756` |
| Execution | `--step exec` edits code in the session. Subagents run only for security (`pan-hardener`), distillation, or `--deep-review` (`pan-hardener` then `pan-meta-reviewer`, merged by `review-deep merge`) | `focus-auto.md:92, :229, :288`; `focus-exec.md:105` |
| Commits | Raw git: stage paths, commit, tag a baseline. `batch-commit` exists but no prompt calls it (liveness allowlist) | `focus-exec.md:379-383`; `focus-auto.md:188, :326`; `liveness-allowlist.json:215` |
| Checkpoint commit | `focus auto --update` runs `git add .planning/` and commits `docs: focus-auto cycle N — …` unless `focus.auto_commit` or `commit_docs` is off | `focus.cjs:978-1001` |
| Test gate | The code compares `tests_after < tests_before` on `--update`. It re-runs the suite only with `focus.verify_tests`; otherwise the agent's counts are recorded with `tests_verified: false` | `focus.cjs:831-857, :1004` |
| Phase verbs | No focus prompt calls `state`, `roadmap`, `requirements`, `findings`, `verify` or `phase` | verb census, all focus prompts |
| Item results | DONE/FAILED is written only into the markdown scan file, in no fixed format. Nothing marks a batch finished | `focus-exec.md:357-360`; `focus.cjs:610-611` |
| Item files | A code-planned item's `file` points at its *source* (a phase directory, todo file or patterns.md), not at files to change. Prompt-planned items carry `file` or `files`; nothing reads them for scope | `focus.cjs:93, 111, 128`; `focus-plan.md:210` |
| Batch shapes | Three shapes: `batch` or `items` arrays, with different item fields. The reader accepts both keys | `focus.cjs:396, :638-642`; `focus-auto.md:281-286` |
| `auto-run.json` | Statuses `initialized`, `in_progress`, `stopped`, `completed`. A crash leaves `in_progress` forever: a new start is refused and `--continue` refuses it too, so the prompt's workaround is `--stop` then `--continue`. A manual `--step exec` records nothing | `constants.cjs:693-698`; `focus.cjs:1044-1070`; `focus-auto.md:50` |
| Backlog | `--source backlog` is prompt-only: unchecked roadmap rows and unmet REQ rows, ranked, top item per cycle. Nothing is ticked back | `focus-auto.md:140-147`; ADR-0031 |
| Safety | The code enforces regression, max cycles, total budget (only when enforced), zero-completed and weekly limit. The prompt alone enforces the per-cycle budget, revert, the security gate and drift | `focus.cjs:1003-1039` |
| focus-docs | The audit with `--fix`, sync with `--all`, and drift with `--repair` or `--create` edit docs only, never source code | `focus-doc-audit.md:370, :495`; `focus-sync.md:28` |
| focus-design | Writes `docs/specs/<f>_featureai.md` and `docs/decisions/ADR-NNNN-<f>.md` unconditionally; the next step is free text. `pan-design-checker` runs at 5.4 and at the final gate, and its verdict is not saved | `focus-design.md:1045, :1048, :1052, :1070, :886-894` |
| Design consumers | `focus-plan` reads `docs/specs/**`, `.planning/specs/`, `.planning/designs/`, `*_featureai.md` and ADRs. No phase command reads them | `focus-plan.md:38-58` |
| Planning model | A FOCUS model ("no phase spine") sits beside the PHASE model; when both are present, the phase model wins | `constants.cjs:719-733`; `utils.cjs:185-204` |
| Earlier decisions | ADR-0006: compose, don't parallel (SC-8). ADR-0015: run state in JSON, "did NOT use state.md (different lifecycle)". ADR-0031: backlog source. ADR-0042: design parity and the altitude split | `docs/decisions/ADR-0006…:47-56`; `focus_auto_runner_featureai.md:640` |

### 1.2 Main-system integration points to reuse

| Need | Existing piece | Evidence |
|---|---|---|
| A light unit of work the guard sees | A quick task: `.planning/quick/<n>-<slug>/` with an open `*-plan.md`. The guard's `workInFlight` already treats an open quick plan as in flight | `quick.md:88`; `pan-guard.js:209-221` |
| An engine-written plan | `sizing.leanQuickPlan(cwd, desc, num)`: `phase: quick`, `tier: micro`, `files_modified`, must_haves, verify = test command | `sizing.cjs:146-160` |
| Numbering | `init quick` returns `next_num` (max `^\d+-` under `quick/` + 1) | `init.cjs:426-485` |
| The state record | `stateQuickTask(description, commit, directory, status)` appends to `### Quick Tasks Completed`; `state patch` sets Last Activity | `state-write.cjs:188-218`; `quick.md:369-377` |
| Safe commits | `pan-tools commit "<msg>" --files …` with sensitive-pattern checks that unstage on a hit | `commands.cjs:374+` |
| Test counts | `test run` without `--phase` | `pan-tools.cjs:686-692` |
| Todo write-back | `todo complete <file>` | `pan-tools.cjs:991-998` |
| Phase intake from a spec | `plan-phase <N> --prd <file>`: the PRD becomes `{phase}-context.md`, with its content locked as decisions | `plan-phase.md:74, :103-187` |
| Adding a phase | `phase add <desc>` writes a roadmap section, a checklist entry and the phase directory | `phase.cjs:500-571` |
| Next action | `next-action` → `diskSnapshot` (roadmap, requirements, phases only) → the pure `nextAction` | `next-action.cjs:48-105`; `mcp/orchestrator.cjs:124-180` |
| Autodev runs | `.planning/autodev/run-*/run.json` plus `ledger.jsonl`; `latestRun` | `autodev.cjs:455-480` |
| Cost attribution | Spend is attributed to the command, so focus spend already shows by command; there is no per-unit id | `pan-cost-logger.js:798-802`; `cost.cjs:641-663` |
| Requirements | Every requirement maps to a phase in the traceability table | `templates/requirements.md:56-66` |

### 1.3 Runtime compatibility

Everything here is engine code (`pan-tools`) plus prompt text, so it ships to all five runtimes. The installer's existing converters carry the prompt changes (AskUserQuestion becomes `question` on OpenCode and keeps its Copilot rewrite). The guard is involved only through the files it already reads. It runs on Claude Code, Codex, Gemini CLI and Copilot CLI; OpenCode has no pre-tool hook, so SC-1 there is vacuous. The installer itself needs no change, and the manifest is unaffected: no new shipped file types, and the new engine code lives in existing modules.

---

## Phase 2: Competitive analysis (repository sources; no new web reads)

| Peer | Loop vs planned work | Spec into planning | Ad-hoc work in main state |
|---|---|---|---|
| gsd-core | Phases plus `/gsd:quick`; v1.18.0 does not re-ask "an ingested ADR" (MI-138, `2026-10-19`) | Ingests ADRs and decisions into planning | `/gsd:quick` records into its `.planning/` state (MI-062 adoption basis) |
| Superpowers 7.0 | Brainstorm sizes the work after understanding it: just do it, agree in chat, or design doc (MI-116, `2026-10-11`) | The design doc is the plan's input | Not recorded in the repository: UNCONFIRMED |
| Spec Kit | An `assess` go/kill step before the roadmap (MI-080, `2026-10-03`) | `specs/` feed `plan` directly | n/a |
| OpenSpec | Changes archived and merged into specs (MI-092) | Change proposals are the spec | Changes are the unit |
| Anthropic long-running harness, bmad-loop | "Fresh session per feature, a progress file, an evaluator"; "no LLM in the control loop" (MI-058 re-opened `2026-10-12`) | n/a | The progress file is the shared record |

**Read.** Peers that run loops keep one shared record that every entry point reads (a progress file, the state directory). Peers that take specs feed them straight into planning. PAN has both pieces already: the quick-task record and `plan-phase --prd`. Focus simply does not use them. The design below closes that gap with no new record type. It also follows the ledger's "Do not put a controller in the loop" (market-ideas `2026-10` note): the engine registers and closes cycles, and does not drive them.

---

## Phase 3: Design

### D1. One owner per work item

Every item a focus run could pick belongs to exactly one owner:

| Item | Owner | Focus does |
|---|---|---|
| A roadmap phase, or a plan inside one | Phase system | Hand-off only: records `routed: phase N` and points at `/pan:plan-phase N` or `/pan:exec-phase N` |
| A requirement mapped to a phase in the traceability table | Phase system | Hand-off only |
| A requirement with no phase in the table | Focus | Executes it; does not tick it (ticking stays with `phase complete`'s EARS-gated path or `validate health --repair`) |
| A pending todo | Focus | Executes it; on success, `todo complete` |
| A pattern, scan finding, security, docs or debt item | Focus | Executes it |

`focus.cjs` gains `classifyOwner(item, roadmap, requirements)`, a pure function. `focus plan` stamps `owner` on each item. A new verb `focus route <batch>` is what the prompts call: it splits a batch into `execute` and `handoff` lists, so the in-session agent never decides ownership. This amends ADR-0031. Backlog still *selects* phase work, but routes it instead of implementing it.

### D2. Each cycle is a registered quick-task record

Two engine verbs bracket every write-producing focus run:

- **`focus open [--batch <file>] [--kind exec|docs] [--run <run_id>]`**
  - Takes the next quick number (shared with `/pan:quick`, from the same code `init quick` uses).
  - Creates `.planning/quick/<n>-focus-<kind>-<date>/` and writes `<n>-plan.md` from `focusCyclePlan()`. That is the `leanQuickPlan` shape plus `source: focus`, `batch_file`, `run_id`, `items: [ids]`, and `files_modified` taken from the items' `file`/`files` values that are source paths (pointers into `.planning/` are excluded).
  - Starts a trace (`--command focus-exec` or `focus-docs`).
  - Runs `test run` once and stores `tests_before` in the plan's frontmatter (D4).
  - Refuses if a focus cycle is already open, naming it.
- **`focus close --dir <dir> --status verified|partial|failed [--commit <sha>] [--done ids] [--failed id=reason,…]`**
  - Runs `test run` for `tests_after`.
  - Writes `<n>-summary.md`: items done and failed with reasons, tests before and after, the commit.
  - Records `results: {id: done|failed|routed}` into the batch file under a new key. The scan-time `status` field is left alone, which closes "nothing marks a batch finished".
  - Calls `todo complete` for done todo items, `stateQuickTask` (description `focus: <category> — X of Y items`, the status) and `state patch` for Last Activity, and ends the trace.
  - Inside an auto run, `focus auto --update` reads the closed cycle's summary instead of the agent's reported counts.

Why a quick-task record rather than a new focus marker:
1. The guard already treats an open quick plan as in flight, so SC-1 needs **no guard change**. The guard's model of "PAN work" stays one rule.
2. state.md's Quick Tasks table, Last Activity, resume and the HUD already read these records.
3. ADR-0006 rejected a parallel tracker.

Two signals are deliberately **not** in-flight markers:
- `auto-run.json`, because a crash leaves it `in_progress` for good. That would disable `unrouted_write` indefinitely, and between cycles a run writes only inside `.planning/`.
- Batch files, because nothing marks them finished.

An abandoned open cycle *does* keep the guard permissive. That failure is fail-open and stays visible: `focus auto --status`, `/pan:progress` and a hygiene finding (D9) all name it. `focus auto --stop` closes any open cycle as `failed`.

### D3. Commits through the commit verb

The prompts stop running raw `git add` and `git commit`. A cycle commits its changed files, the quick directory and state.md with `pan-tools commit "<type>(focus-<n>): …" --files …`, so the sensitive-pattern checks apply. The baseline tag (`git tag -f focus-auto-baseline`) stays raw git, because the commit verb has no tag support and the tag never leaves the machine. The `--update` checkpoint commit keeps its own path (`focus.auto_commit`), now staging the closed cycle's files as well. `batch-commit` (no callers) is retired. Its liveness-allowlist entry and surface row go with it.

### D4. Measured, not reported

`tests_before` and `tests_after` come from `focus open` and `focus close` running `test run`. `--update` then records `tests_verified: true` without the opt-in `focus.verify_tests`, and regression detection uses measured counts. When no test command is detected, both are null and the cycle status is capped at `partial`. That mirrors how quick and phase tests treat a project with no tests. No verifier agent runs by default: right-sized ceremony keeps focus lean, and `--deep-review` remains the opt-in deeper check.

### D5. The main system sees focus

- **next-action:** `diskSnapshot` gains `focus: {run: {id, status, stale}, open_cycle: {dir, kind, opened}}`, read from `auto-run.json` and the quick directories. The pure `nextAction` puts an open focus cycle first ("close or continue focus cycle `<dir>`"), then a stale run ("`focus auto --status`, then stop or continue"). Phase actions follow as today. Existing `nextAction` cases keep their outputs, and a test pins them.
- **progress and resume:** both already call `next-action`. Their workflows add one line naming an active or stale focus run and an open cycle (`focus auto --status --raw`).
- **HUD:** the focus panel shows whenever `auto-run.json` exists, not only when there is no roadmap.
- **autodev ↔ focus-auto mutual exclusion:**
  - `runAutodev` refuses a fresh run while a focus run is `initialized` or `in_progress` and not stale, or while a focus cycle is open (`error: 'focus_active'`).
  - `focus auto` start and `--continue` refuse while the newest autodev run has no `stopped` or `completed` record in its ledger (`error: 'autodev_active'`).
  - Each names the other run's id and the command to stop it.

### D6. focus-design lands where the project keeps designs, and hands off

- **Paths in code:** a new verb `design paths <slug>` returns `{spec, decision}`:
  - When the project root has both `docs/specs/` and `docs/decisions/` (PAN's source repo, or a project that adopted that layout), it returns those directories and the next ADR number.
  - Otherwise it returns `.planning/designs/<slug>/spec.md` and `.planning/designs/<slug>/decision.md`.

  `focus-design.md` Phase 10 writes to what it returns. `focus-plan` already reads `.planning/designs/`.
- **Checker verdict saved:** the final `pan-design-checker` verdict block is written beside the spec (`check.md`). The verdict currently lives only in chat.
- **Hand-off:** `design handoff <spec> --as phase|focus` and the end-of-run question (at most four options, per the prompt lint):
  - `--as phase` runs `phase add` with the spec's title and its one-line problem statement, adds a `**Design:** <spec path>` line under the new phase's roadmap entry, and returns the command `/pan:plan-phase <N> --prd <spec>`. That uses plan-phase's existing PRD intake: the spec becomes `{phase}-context.md`, with its decisions locked.
  - `--as focus` returns the `focus-auto --step plan --mode features` command (focus-plan reads the spec).
  - Without a choice, nothing is added.
- **The altitude split (ADR-0042) is unchanged:** focus-design does demand and strategy once; design-phase does per-phase design.

### D7. Routing and help

- **Routing table:** `ROUTES` gains one row: `focus-design` — "investigate and design a feature before building it" (`route:` frontmatter added; tenth and last row under the cap). focus-auto gets no row: a campaign is a deliberate, budgeted start, and routing plain requests into an autonomous loop is the over-routing risk ADR-0050 names. The section's byte budget test still applies; it measures about 1.87 KB in exclusive mode.
- **help.md:** "Two Workflows — Pick One" becomes one system. Phases for roadmap work. Focus for upkeep campaigns, whose cycles appear as quick tasks in the same state. focus-design feeds either one. The generated command index is unchanged.

### D8. focus-docs

The modes that write (`--fix`, `--sync --all`, drift `--repair` or `--create`) bracket their edits with `focus open --kind docs` and `focus close`. The report-only modes register nothing. This also lets focus-docs work under exclusive routing without exempting `docs/**`.

### D9. Stale runs

`focus auto --status` adds `stale: true` when the run is `initialized` or `in_progress` and its newest timestamp (`started_at`, or the last cycle's) is older than `focus.stale_hours`. That is a new key in the open `focus` section, default 12. Hygiene adds an `info` finding `focus-stale-run` with the fix "`focus auto --stop`, then `--continue`". It also adds `open-task-stale` for any quick-task plan (focus or not) with no summary after 24 hours. Neither is auto-fixed.

### 3.10 Architecture decision

| Change | Where |
|---|---|
| New pure functions `classifyOwner`, `focusCyclePlan`; verbs `focus route`, `focus open`, `focus close` | `pan-wizard-core/bin/lib/focus.cjs`, dispatcher arms in `pan-tools.cjs` |
| Quick numbering shared, not copied | Extract `nextQuickNum(cwd)` from `init.cjs` `cmdInitQuick` and call it from both |
| `--update` reads the closed cycle; retire `batch-commit` | `focus.cjs`, `commands.cjs`, `pan-tools.cjs` |
| `stale` in status; `focus.stale_hours` | `focus.cjs`, `core.cjs` focus defaults |
| Snapshot and next action | `next-action.cjs` `diskSnapshot`, `mcp/orchestrator.cjs` `nextAction` |
| Mutual exclusion | `autodev.cjs` `runAutodev`; `focus.cjs` start and continue |
| HUD panel | `hud.cjs` |
| `design paths`, `design handoff` | New small module `design-handoff.cjs`; uses `phase.cjs` `phase add` and the roadmap writer |
| Hygiene checks | `hygiene.cjs` |
| Prompts | `commands/pan/focus-auto.md`, `focus-docs.md`, `focus-design.md`, `workflows/focus-exec.md`, `focus-scan.md`, `focus-plan.md`, `focus-doc-audit.md`, `focus-sync.md`, `focus-drift-walking.md`, `progress.md`, `resume-project.md`, `help.md` |
| Routing row | `commands/pan/focus-design.md` (`route:`), `agents-md.cjs` `ROUTES`, new pin hash |

**Installer and manifest:** no change. All the changes are in shipped core and prompt files the manifest already hashes. **Guard:** no code change (D2).

### 3.11 Implementation plan (stages, each shippable alone)

```
Stage A — registration (closes SC-1, SC-2, SC-7)                         ~M
  1. focus.cjs: focusCyclePlan, focus open / focus close; init.cjs: nextQuickNum shared
  2. focus-exec.md / focus-auto.md: bracket every exec cycle; pan-tools commit; drop raw git add/commit
  3. focus --update reads the closed cycle; tests_verified from measured counts
  4. focus-docs workflows: bracket the writing modes (D8)
Stage B — ownership (SC-5)                                               ~S
  5. classifyOwner + focus route; focus plan stamps owner; backlog prompt routes phase-owned items
Stage C — visibility and exclusion (SC-3, SC-4)                          ~M
  6. next-action snapshot + nextAction ordering; progress/resume lines; HUD panel
  7. autodev ↔ focus mutual exclusion; stale detection + hygiene checks (D9)
Stage D — design hand-off (SC-6)                                         ~M
  8. design-handoff.cjs (design paths, design handoff); focus-design.md Phase 10 + closing question; check.md
Stage E — routing, help, docs, gates (SC-8, SC-9)                        ~S
  9. ROUTES row + route: frontmatter + pin; help.md one-system text
 10. Docs; prompt-rules --write + allowlist reasons; surface --write; module-surface; harness scenario
 11. ADR-00NN amending ADR-0015 and ADR-0031
```

Stage A on its own already removes the exclusive-routing conflict. Stages B to E can follow in later releases.

### 3.12 Test plan

Unit tests go in `tests/focus-integration.test.cjs` unless noted. All of them use temporary projects and seams, and never the real home.

**Happy path**
1. `focus open` on a code-planned batch creates `quick/<n>-focus-exec-<date>/<n>-plan.md` with `source: focus`, the item ids, and `files_modified` containing only source paths (no `.planning/` pointers). The number follows an existing `/pan:quick` task.
2. `focus close --status verified --done a,b --failed c=reason` writes the summary, adds a `focus:` row to Quick Tasks Completed with its status, patches Last Activity, sets `results` in the batch file (scan-time `status` untouched), and runs `todo complete` for a done todo item.
3. In an auto run, `--update` after a closed cycle records the measured `tests_before` and `tests_after` with `tests_verified: true`, without `focus.verify_tests`.
4. `design handoff spec.md --as phase` adds a roadmap phase whose entry carries the `**Design:**` line, and returns `/pan:plan-phase <N> --prd <spec>`.
5. `pan-tools next-action` with an open focus cycle returns the focus continuation ahead of a phase that is ready to plan.

**Edge cases**
6. `focus open` while a cycle is open refuses and names it; `focus auto --stop` closes it as `failed`.
7. With no test command, open and close record null counts and the status caps at `partial`.
8. Batch shapes: `batch` array, `items` array, and items with `file` or `files` or neither all open correctly.
9. `design paths` in a project with only `docs/specs/` (no `docs/decisions/`) returns `.planning/designs/<slug>/`; with both it returns `docs/` and the next ADR number.
10. `classifyOwner`: a phase item, a mapped requirement, an unmapped requirement, a todo and a pattern each get the owner in the D1 table. A requirement missing from the traceability table counts as unmapped.
11. A stale run (status `in_progress`, newest timestamp older than `focus.stale_hours`) reports `stale: true`, and hygiene raises `focus-stale-run`. A fresh one raises neither.

**Error cases**
12. `focus close` on a directory that is not an open focus cycle refuses without writing.
13. A batch file with invalid JSON: `focus open` refuses with the reader's existing message and creates no directory.
14. `design handoff` on a missing spec refuses; on a project with no roadmap, `--as phase` refuses and names `/pan:new-project`.

**Runtime-specific and guard**
15. Guard, all four hook hosts (Claude, Codex `apply_patch`, Gemini `write_file`, Copilot camelCase payloads): exclusive plus enforce with a focus cycle open, so a source write is allowed. With the cycle closed, the same write is denied (`tests/project-memory-routing.test.cjs` gains these cases).
16. Mutual exclusion: autodev refuses with `focus_active` naming the focus run; `focus auto` start refuses with `autodev_active` naming the autodev run; a stale focus run does not block autodev.
17. Prompt contracts: no focus prompt contains `git commit` or `git add` (except the baseline tag); every write-producing focus workflow calls `focus open` before its first edit step and `focus close` after its commit.

**Existing tests that must stay green unchanged:** `tests/focus.test.cjs` (the auto state machine, status strings, checkpoint message, newest-batch ordering), `contracts-focus`, `workflow-focus`, `preflight` batch, and the opus-47 helpers.

**Harness:** a tier-0 scenario `focus-cycle-registered` on a packed install, model-free:
- Seed a project with a batch file. Run `focus open`.
- Feed the installed guard a write payload under exclusive plus enforce: allowed.
- Run `focus close`. Assert the state row, the summary and the batch `results`. Feed the guard the same payload: denied.
- Control: delete the open cycle's plan after `focus open`, so the first guard step must turn red.

---

## Phase 4: Specification

## Feature: Focus–phase integration

### Files to create/modify

- **Create:**
  - `pan-wizard-core/bin/lib/design-handoff.cjs`
  - `tests/focus-integration.test.cjs`
  - `harness/scenarios/focus-cycle-registered.json`
  - an ADR
- **Modify (engine):**
  - `pan-wizard-core/bin/lib/focus.cjs`, `init.cjs`, `next-action.cjs`, `autodev.cjs`, `hud.cjs`, `hygiene.cjs`, `core.cjs` (focus defaults), `commands.cjs` (retire `batch-commit`), `agents-md.cjs`
  - `pan-wizard-core/mcp/orchestrator.cjs`
  - `pan-wizard-core/bin/pan-tools.cjs`
- **Modify (prompts):**
  - `commands/pan/focus-auto.md`, `focus-docs.md`, `focus-design.md`
  - `pan-wizard-core/workflows/focus-exec.md`, `focus-scan.md`, `focus-plan.md`, `focus-doc-audit.md`, `focus-sync.md`, `focus-drift-walking.md`, `progress.md`, `resume-project.md`, `help.md`
- **Modify (fixtures):** `tests/fixtures/surface.json`, `module-surface.json`, `liveness-allowlist.json`, `prompt-rules.json` and its allowlist, and `tests/agents-md-edits.test.cjs` (new pin)

### Implementation steps

As in §3.11, stages A to E, each landing with its own tests and the suite green.

### Tests required

The 17 cases in §3.12, the guard cases added to `tests/project-memory-routing.test.cjs`, and the tier-0 harness scenario with its control.

### Documentation updates

- `docs/USER-GUIDE.md`: the focus section is rewritten as part of one system, covering cycles as quick tasks, ownership, the design hand-off and mutual exclusion. Add `focus.stale_hours` to the config table.
- `docs/CLI-REFERENCE.md`: `focus open`, `focus close`, `focus route`, `design paths` and `design handoff`; the changed `focus auto --status` output; removal of `batch-commit`.
- `docs/ARCHITECTURE.md`: the focus row now says focus composes with phases through quick-task records.
- `docs/HOOKS.md`: one line noting that an open focus cycle counts as PAN work for `unrouted_write`.
- `CHANGELOG.md`.
- Regenerate `docs/SKILLS-*.md`.

### Runtime matrix

| Runtime | Supported | Notes |
|---|---|---|
| Claude | ✅ | Guard sees open cycles; HUD panel; native AskUserQuestion for the hand-off question |
| Codex | ✅ | Guard (`apply_patch` writes) sees open cycles; prompts converted to skills as today |
| Gemini | ✅ | Guard (`write_file`) sees open cycles; TOML commands carry the prompt changes |
| OpenCode | ✅ | No pre-tool guard, so SC-1 is vacuous; everything else applies; `question` replaces AskUserQuestion |
| GitHub Copilot | ✅ | Guard (camelCase payload) sees open cycles; the `.github` hook copy defers to Claude's as today |

---

## Phase 5: Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| A crashed cycle stays open and keeps the guard permissive | Medium | Fail-open by design; named by `focus auto --status`, `/pan:progress`, next-action and the `open-task-stale` hygiene finding; `focus auto --stop` closes it |
| Quick numbering collides when `/pan:quick` and a focus cycle start together | Low | One shared `nextQuickNum`; `focus open` refuses while a focus cycle is open; a collision fails on `mkdir` and is reported, never overwritten |
| State.md's Quick Tasks table grows with every focus cycle | Medium | One row per cycle, not per item; the existing `state compact` and `hygiene` compaction already archive settled history |
| Routing phase-owned backlog items away makes `--source backlog` do less | Medium | The hand-off is recorded and shown, and the phase command is printed; ADR-0031's selection survives; the phase gate is the reason this is right |
| Prompt edits move ~50 hashed prompt rules in `focus-auto.md` | Low (churn) | Regenerate the registry; one allowlist entry per new normative line with its test as the reason; harness-claimed rules re-checked |
| The extra `test run` per cycle adds time | Low | Once at open and once at close; replaces the agent's own runs for the record; disabled automatically when no test command exists |
| focus-design writing under `.planning/designs/` hides specs that a team expected in `docs/` | Low | A project with `docs/specs/` and `docs/decisions/` keeps them; the summary names the paths written |
| Autodev and focus-auto exclusion blocks a user who abandoned one run | Medium | A stale focus run does not block autodev; both errors name the stop command |
| `design handoff --as phase` adds a phase the user did not want | Low | Runs only on an explicit choice in the closing question; `phase remove` undoes it |
| The `nextAction` reordering changes MCP clients' behaviour | Medium | Focus actions come first only while a focus cycle is open or a run is stale; pinned tests keep every existing case's output |

---

## Sources (read `2026-10-31`)

- The code and prompts cited inline (repository at `0881cc9`).
- ADR-0006, ADR-0015, ADR-0016, ADR-0017, ADR-0031, ADR-0042, ADR-0050; `docs/specs/pan_focus_commands_featureai.md`, `focus_auto_runner_featureai.md`, `continuous_autonomous_execution_featureai.md`.
- `docs/COMPARISON.md`; `docs/specs/market-ideas-ledger.md` rows MI-058, MI-062, MI-080, MI-092, MI-116, MI-138, MI-142.
