# pan-tools.cjs CLI Reference

Complete reference for `pan-tools.cjs`, the central CLI dispatcher behind PAN Wizard workflows. The dispatcher routes top-level commands and nested subcommands to core modules. Shipped commands, workflows and agents call pan-tools for state management, verification, scaffolding, context gathering, prompt-cache measurement, cross-phase memory, model-capability routing, the Spec B v2 feature set (cost dashboard, bus infrastructure, foresight previews, deep-review merge, knowledge retrieval, counterfactual worktree), the optimization additions (circular optimization loop, `/pan:git` family, `distill` AI code-bloat optimizer), and the self-improvement loop (`experiment`) plus vendored markdown linter (`doc-lint`).

```bash
node pan-tools.cjs <command> [args] [--raw] [--verbose] [--cwd <path>]
```

---

## Table of Contents

- [Global Behavior](#global-behavior)
- [Command Index](#command-index)
- [1. State Commands](#1-state-commands)
- [2. State Progression](#2-state-progression)
- [3. Phase Operations](#3-phase-operations)
- [4. Phase Listing](#4-phase-listing)
- [5. Roadmap Operations](#5-roadmap-operations)
- [6. Requirements Operations](#6-requirements-operations)
- [7. Milestone Operations](#7-milestone-operations)
- [8. Validation](#8-validation)
- [9. Verification Suite](#9-verification-suite)
- [10. Progress & Context](#10-progress--context)
- [11. Todos](#11-todos)
- [12. Scaffolding](#12-scaffolding)
- [13. Frontmatter CRUD](#13-frontmatter-crud)
- [14. Template Operations](#14-template-operations)
- [15. Config Operations](#15-config-operations)
- [16. Utility Commands](#16-utility-commands)
- [17. Compound Init Commands](#17-compound-init-commands)
- [18. Focus Commands](#18-focus-commands)
- [19. Standards Commands](#19-standards-commands)
- [20. Operations Commands](#20-operations-commands)
- [20.1 Capability-Aware Commands](#201-capability-aware-commands)
- [21. Codebase Commands](#21-codebase-commands)
- [22. Spec B v2 Commands](#22-spec-b-v2-commands)
- [23. Self-Improvement Loop Commands](#23-self-improvement-loop-commands)
- [24. Doc-Lint Commands](#24-doc-lint-commands)
- [25. Skill-Aligned Decomposition Commands](#25-skill-aligned-decomposition-commands)
- [26. Hygiene Commands](#26-hygiene-commands)
- [27. Optimization, Git and Distill Commands](#27-optimization-git-and-distill-commands)
- [28. Evidence Loop Commands](#28-evidence-loop-commands)
- [29. Bot Army and Report Commands](#29-bot-army-and-report-commands)

---

## Global Behavior

### Output Format

**Output is JSON** unless `--raw` is passed (or a flag such as `hud --stdout` asks for HTML). Under `--raw`, a command that has a plain-text form prints it instead: usually a single value suitable for shell variable capture (e.g., a directory path, a count, or `true`/`false`), for some commands a human-readable summary. A command without one prints its JSON under `--raw` too (every `init *`, `state json`, `findings dispose`).

### Output Contracts (`contract`)

Some machine-readable outputs carry a `contract` field: a version string for their shape. The outputs are `state` (`state load`), `state json`, `progress` (`progress json`), every `findings` output except `findings prove`, and the MCP resources `pan://state`, `pan://progress` and `pan://findings` that wrap them. The judges' `pan-verdict` block has one too. The rule is additive: fields are added within a major version (`1.x`) and never renamed or removed; a rename or removal is a major bump. Consumers pin the major, accept any `1.x`, and ignore fields they do not know. The key=value `--raw` form of `state load` carries no `contract` line, and no error payload (`{"error": …}`) from any of these outputs carries one.

### Debug Logging

Pass `--verbose` to any command to set `PAN_VERBOSE=1`. Few code paths read it: the archived-phase lookup writes a `[pan-tools]` line to stderr when `.planning/milestones/` cannot be read, and `drift-check` adds a `per_file` breakdown to its JSON. Nothing traces dispatch, and most commands print nothing extra.

### Large Output (`@file:` Protocol)

When JSON output exceeds ~50 KB, the tool writes it to a temporary file and prints `@file:<tmpdir>/pan-XXXXXX/out.json` instead (a fresh private directory under the OS temp dir, created with `mkdtemp`). Callers must detect the `@file:` prefix and read the file. If the temp file cannot be written, the JSON is truncated to 50 000 characters and printed to stdout instead, so treat a parse failure on a large payload as that fallback. This prevents context window pollution when AI agents consume the output.

### Exit Codes

| Code | Meaning |
|------|---------|
| `0`  | The command answered the question it was asked — including when the answer is empty or negative |
| `1`  | Failure, refusal, or a gate that tripped: the command did not produce the result the caller wanted |
| `2`  | `doc-lint` only — the schema file itself is malformed, so nothing could be linted (distinct from *finding* violations). Emitted on **both** the `--raw` and the JSON path; the JSON body additionally lists `schema_errors` |

**The exit code is the authoritative failure signal.** Gate on it. Do not gate on the presence of an `error` key in the body — see "Error Shape" below for why that test gives the wrong answer.

### Error Shape

pan-tools has **two** error mechanisms. They differ in where the text lands, not in the exit code:

| Mechanism | Text goes to | stdout | Exit code |
|---|---|---|---|
| `error(msg)` | **stderr**, as a bare `Error: <msg>` line — no JSON | empty | always `1` |
| `output(payload, …)` with a truthy top-level **error-family** key | **stdout**, as `{ "error": "<description>" }` (or, under `--raw`, the command's plain-text form when it has one) | the payload | `1` unless the command opts out (below) |

The **error family** is `error` and any key ending in `_error` — `worktree_error` (`whatif prepare`), `drain_error` (`bus drain`). A renamed error key is still an error key. Plural collections (`errors`, `schema_errors`) and counters (`error_count`) are *not* in the family: they are the detail of a verdict payload, and an empty array is truthy in JavaScript, so treating them as failure signals would fail every clean run. Commands whose result is a verdict set their exit code explicitly instead.

`error()` is used for usage errors and unmet preconditions the caller cannot act on programmatically (a missing required argument). `output()` carries a machine-readable body: a failure the caller may want to branch on (`{"error": "state.md not found"}`, `{"error": "not_a_git_repo"}`) or a deliberate refusal that protected something (`{"error": "File already exists"}`, `{"error": "dirty_working_tree"}` — the file was not overwritten, the reset did not run).

Error messages follow the pattern `"<thing> not found"` with actionable hints where appropriate.

**A JSON `error` body carries a non-zero exit.** This was not always true: every `output({ error: … })` site once exited `0`, so `pan-tools state json` in a project with no `state.md` printed `{"error":"state.md not found"}` **and reported success** — invisible to any orchestrator, hook, CI step, or autonomous loop gating on the exit code. `output()` now derives the code from the payload in one place (`core.cjs`), so the two mechanisms agree.

#### A valid-but-empty answer is not an error

An empty result is a *result*. `focus plan` on a burned-down backlog, `verify artifacts` on a plan that declares no artifacts, `template select` falling back to the documented default — each answered correctly and **exits `0`**. Some of these still carry an `error` string, because it is the only field available to explain *why* the answer is empty (`{"error": "No work items found. Run focus scan first or add phases/todos."}` at exit `0`). Such sites opt out explicitly via `core.cjs`'s `EXIT_OK`, each with a comment giving its reason; `grep -rn "EXIT_OK" pan-wizard-core/bin` enumerates every one.

That is exactly why the exit code, not the `error` key, is the failure test.

#### `<verb>: false` payloads

Mutating commands report the outcome as a past-tense flag: `{committed}`, `{updated}`, `{added}`, `{resolved}`, `{pushed}`, `{created}`. **The flag alone does not tell you whether something went wrong**, and the exit code does:

| Payload | Exit | Why |
|---|---|---|
| `{committed: false, reason: "commit_failed", error: …}` | `1` | git refused; nothing landed |
| `{committed: false, reason: …, error: "commit_blocked"}` | `1` | a safety check protected you; nothing landed (`reason` names the check: `sensitive_file_detected`, `sensitive_content_detected` or `deleted_files_detected`) |
| `{updated: false, reason: "state.md not found", error: …}` | `1` | the write had nowhere to go |
| `{resolved: false, reason: "no matching blocker", error: …}` | `1` | the blocker is still open |
| `{committed: false, reason: "nothing_to_commit"}` | `0` | no change was needed |
| `{committed: false, reason: "skipped_commit_docs_false"}` | `0` | your config said not to |
| `{advanced: false, reason: "last_plan"}` | `0` | normal end of phase |
| `{updated: false, reason: "No plans found"}` | `0` | nothing to sync |
| `{available: false, reason: "BRAVE_API_KEY not set"}` | `0` | capability unconfigured, not broken |
| `{found: false, phase_number: 12}` | `0` | the answer to the question is "no" |
| `{clean: false, …}` / `{exists: false, …}` | `0` | a description of state |

The failures carry an error-family key and the answers do not — which is *why* the same shape can mean both. This split is a per-command judgement recorded in the source next to each payload, not something you can infer from the shape.

`{available: false}` is worth one more line, because it appears with and without an error key on purpose: `websearch` with no `BRAVE_API_KEY` is unconfigured (exit `0`, degrade gracefully), while a configured search that gets an API 5xx is broken (exit `1`).

#### How a caller tells them apart

```sh
out=$(pan-tools <command>)   # stderr passes through to the terminal
code=$?
if [ "$code" -ne 0 ]; then
  # Failed, refused, or a gate tripped. The reason is in whichever stream spoke:
  #   $out non-empty -> JSON body on stdout; read its .error
  #   $out empty     -> a bare "Error: ..." line went to stderr
  :
else
  # Answered. The answer may legitimately be empty and may carry an `error`
  # string saying why -- branch on the data, never on the `error` key.
  :
fi
```

A gate whose verdict has no `error` key sets its code explicitly instead: `links validate` (`0` pass / `1` fail), `verify reconcile` (`0` reconciled / `1` contradiction, or no verification to reconcile), `verify stubs --gate`, `campaign due`. Those are documented per command.

**Help:** `pan-tools --help` (also `-h` or `help`) prints the command list and exits `0` — an explicit help request is a success. A *missing* command prints the same usage as an error and exits `1`. `pan-tools <command> [subcommand] --help` (or `-h` right after the command or subcommand) prints that command's usage lines and exits `0` without running anything, whatever other flags are given: `test run --help` used to start the test suite.

### `--cwd <path>`

Override the working directory. Accepts `--cwd /path` or `--cwd=/path`. Useful when subagents run outside the project root.

### Planning root: `--track` / `--planning-dir` / `--all-tracks`

`--cwd` moves the *project* root. These move the *planning* root inside it, so a repo holding several planning trees (several independently-planned products in one repo, a monorepo, a spike kept beside the mainline) can address any of them. See [ADR-0043](decisions/ADR-0043-addressable-planning-roots.md).

| Flag | Effect |
|---|---|
| `--track <name>` | Act on `.planning/tracks/<name>/`. Name must be a slug (`[A-Za-z0-9][A-Za-z0-9._-]*`) — it becomes a single path segment. |
| `--planning-dir <path>` | Act on an arbitrary project-relative planning tree. Absolute, drive-relative, and `..`-containing paths are rejected. |
| `--all-tracks` | Act on the root tree **and** every discovered track. Implemented for `hygiene scan`/`hygiene clean` and `init milestone-op`; other commands ignore it. |

Both value flags accept `--flag value` and `--flag=value`, and are mutually exclusive. Environment equivalents `PAN_TRACK` and `PAN_PLANNING_DIR` apply when no flag is given; flags win, and `PAN_PLANNING_DIR` outranks `PAN_TRACK`.

**Tracks are discovered, not declared.** Any directory under `.planning/tracks/` carrying a planning spine (`state.md`, `roadmap.md`, `phases/`, `focus/`, `orchestration/`, …) is a track; an incidental folder is not.

**Commands report the root they resolved.** The `hygiene` payloads and every `init *` payload except `init new-milestone` and `init verify-work` carry `planning_root`, `track`, `planning_root_source` (`default` / `env:PAN_TRACK` / `flag:--track` / …), and `planning_root_exists` (`init milestone-op --all-tracks` carries them on each entry of `tracks[]`). A mistyped `--track` therefore shows `planning_root_exists: false` next to its zero findings, instead of reading as a healthy project.

```bash
pan-tools hygiene scan --track verify --raw
pan-tools hygiene scan --all-tracks --raw
PAN_TRACK=verify pan-tools init milestone-op
```

### Module Architecture

The dispatcher (`pan-tools.cjs`) routes commands to the core modules:

| Module | Purpose |
|--------|---------|
| `state.cjs` | state.md read/write/parse |
| `state-compact.cjs` | `state compact` — moves settled history out of state.md into state-history.md so it stops being re-read into every agent call. Archive-first, dry-run by default. |
| `commands.cjs` | Utility commands (slug, timestamp, commit, estimate-cost, rollback, progress, etc.) |
| `phase.cjs` | Phase directory and plan operations |
| `init.cjs` | Compound workflow context gathering |
| `verify.cjs` | Verification, validation, and retrospective (including `retro --write-memory`); facade over the verify-* submodules |
| `verify-drift.cjs` | Convention-drift detection (`drift-check`); extracted from verify.cjs, re-exported through it |
| `verify-retro.cjs` | Milestone retrospective (`retro`); extracted from verify.cjs, re-exported through it |
| `verify-deploy.cjs` | Deployment validation (`validate deployment`); extracted from verify.cjs, re-exported through it |
| `verify-preflight.cjs` | Pre-execution gates (`preflight`, `deps validate`); extracted from verify.cjs, re-exported through it |
| `suggest.cjs` | "Did you mean" corrections for an unknown command. Pure; the group→subcommand index is parsed from the dispatcher's own `Unknown <group> subcommand … Available:`, `Unknown init workflow: … Available:` and `<group> subcommand required. Available:` strings on the error path only, so no second list can drift and a healthy call pays nothing |
| `commands-learnings.cjs` | Error patterns, session history, learnings lifecycle; extracted from commands.cjs, re-exported through it |
| `phase-remove.cjs` | Phase removal + renumbering cascade (`phase remove`); extracted from phase.cjs, re-exported through it |
| `roadmap.cjs` | roadmap.md parsing and updates, and `roadmap slice` (one phase's part of roadmap.md and requirements.md) |
| `roadmap-compact.cjs` | `roadmap compact [--apply] [--keep N]`: moves shipped phases' sections out of roadmap.md into roadmap-history.md and leaves a stub. Dry-run by default. Also reads a compacted phase's full section back for `roadmap get-phase`, `roadmap slice` and `report phase`. |
| `frontmatter.cjs` | YAML frontmatter CRUD |
| `config.cjs` | config.json management |
| `template.cjs` | Template selection and filling |
| `milestone.cjs` | Milestone archival and requirements |
| `context-budget.cjs` | Context window utilization (cache metrics surfaced in health output; cache block classified `ok`/`warn`/`critical`/`absent` with remediation advice) |
| `focus.cjs` | Focus workflow scan/plan/sync/exec/auto; `focus route`/`open`/`close` (the cycle as a quick task: ownership, open, measured close); the functions behind `focus classify-stages` and `focus reflection`. The dispatcher answers `focus design` itself. |
| `codebase.cjs` | Codebase analysis: detect-languages, analyze-imports, best-practices, `codebase estimate-size` |
| `memory.cjs` | **(E-4)** Cross-phase agent memory: `memory read`, `memory append`, `memory list`, `memory compact`, `memory select`, `memory record`, `memory prune`, `memory budget` |
| `memory-optimize.cjs` | Reconcile the always-loaded project memory: `memory optimize [--apply] [--keep N]` (dedupe / placeholder-strip / cap-with-archive state.md); also runs automatically in the focus + normal flows |
| `memory-rebuild.cjs` | Regenerate derived tools-memory: `memory rebuild [--apply] [--only agents-md]` (AGENTS.md PAN section in the project's routing mode, CLAUDE.md bridge when a local or global Claude install is visible, state.md's position keys patched in place) |
| `agents-md.cjs` | Single source for the AGENTS.md PAN section and PAN's CLAUDE.md block (the `@AGENTS.md` import plus a `# Compact instructions` section Claude Code reads when it compacts), shared by the installer and `memory rebuild` |
| `core.cjs` (CLI surface) | **(E-1)** Cached context: `cache prime [--summary]` lists the stable planning files agents re-read (wraps `buildCachedContext`). It measures them and primes nothing: the host caches each agent's prompt prefix itself. |
| `cost.cjs` | **(Y-6)** Cost dashboard: `cost report`, `cost append`, `cost clear`, `cost limits` (the host's usage-limit windows as the status line last saw them), `cost budget --phase N` (a phase's spend against `cost.phase_budget_usd`; it warns, never stops), plus `models check` rate-table staleness. Log at `.planning/metrics/tokens.jsonl`. |
| `cost-rebuild.cjs` | `cost rebuild`: rebuilds the ledger from Claude Code's session and per-agent transcripts (usage deduped per turn, agents typed from the main thread's `Agent` calls, Workflow-tool subagents included, one main-thread row per session); supersedes hook rows of rebuilt sessions, keeps the rest, moves the old ledger aside. |
| `bus.cjs` | **(Y-7)** Agent message channels: `bus publish`, `bus drain`, `bus list`. Channels at `.planning/bus/<channel>.jsonl`. |
| `preview.cjs` | **(Y-1)** Foresight: `preview phase <N>`, `preview phases`, `preview milestone`. |
| `review-deep.cjs` | **(Y-2)** Deep review merge: `review-deep merge`, `review-deep analyze`. |
| `knowledge.cjs` | **(Y-3)** Grounded Q&A: `knowledge ask`, `knowledge discuss`, `knowledge playbook`. |
| `whatif.cjs` | **(Y-4)** Counterfactual worktree: `whatif prepare`, `whatif report`, `whatif cleanup`. |
| `optimize.cjs` | Circular optimization loop: `optimize trace init/end/current/list/show/log/reconcile`, `optimize learn`, `optimize apply`, `optimize revert`, `optimize list`, `optimize stats`, the bare `learn` alias, and `learn promote/unpromote/list-promoted`. Logs at `.planning/optimization/traces/<session>/trace.jsonl`. `reconcile` rewrites `session.json` counters from `trace.jsonl` so hook-driven auto-sessions report real numbers. |
| `git.cjs` | Phase-aware git workflow: `git commit/branch/push/status/log/stash/diff/rollback/tag/sync`. Reuses `runCommitSafetyChecks` for commit hardening. |
| `distill.cjs` | AI code-bloat optimizer (multi-pass pipeline): `distill scan/analyze/report`. Cross-session memory at `.planning/memory/distill-patterns.md`. |
| `doc-lint.cjs` | Markdown frontmatter + structure linter: `doc-lint <dir>`, `doc-lint schema-check`, `doc-lint counts <dir>`, `doc-lint flags`. |
| `experiment.cjs` | Self-improvement loop scaffolding: `experiment new/list/manifest/harvest/prune`. |
| `runner.cjs` | External agent runner: `experiment run/status/stop`. Spawns Claude/Codex/Gemini/OpenCode via `spawnSync`. |
| `learn-lint.cjs` | Learnings-store integrity linter: `learn lint`. Checks L-001..L-007 (duplicate IDs, dangling cross-refs, empty source_experiments, PAN-internal terms in universal-scope rules, revision marker without `superseded_by`, universal-scope pattern citing an internal pattern id, a `cites` entry whose file or symbol is gone). |
| `learn-index.cjs` | Learnings index + queries: `learn build-index` (writes `pan-wizard-core/learnings/index.json` with topic→agent-relevance map), `learn topics-for --agent <role> [--cue <text>]` (budget-aware topic selection per agent role; with a cue, topics are ranked by how well they match it, falling back to the role when nothing matches). Replaces "skim universal/" with targeted load. |
| `squads.cjs` | **(ADR-0032)** Bot-army squad registry: `squad list`, `squad show <name>`. Role-scoped squads (`squad list` enumerates them), each carrying a model tier + an **advisory** access contract — the module's own header says it "modifies no agent and changes no execution path", so those labels are the contract the conductor is instructed to honour and the enforced grant stays each agent's `tools:` frontmatter. Registry only — drives `/pan:army` and `pan-conductor` campaign mode. |
| `worktree.cjs` | **(ADR-0033)** Branch-per-agent isolation: `worktree list`, `worktree create <task>` (`--base`), `worktree remove <path>` (`--branch`, `--force`), `worktree cleanup` (`--force`; campaign teardown sweep, v3.25+), `worktree preflight` (`--base`, `--test`, `--branches a,b`; program A3: shadow-merges the branches onto the base in a throwaway worktree and runs the test oracle). `army/<task>` branches + isolated git worktrees so parallel builders never collide. |
| `campaign.cjs` | **(ADR-0034)** Scheduled self-resuming campaigns: `campaign schedule` (arm: `--cadence`/`--daily-budget`/`--goal`/`--source`/`--pause`/`--resume`/`--disable`/`--enforce-budget`/`--advisory-budget`), `campaign status`, `campaign due` (host-scheduler gate), `campaign record-run`. Descriptor at `.planning/orchestration/schedule.json`; PAN owns the due-check, the host fires `/pan:army --continue`. Merge gate unaffected. |
| `hud.cjs` | **(ADR-0035)** Single-page HTML dashboard: `hud` (`--out`/`--open`/`--stdout`). Aggregates project + army state (mission, command stack, campaign, safety harness, worktrees, roadmap, telemetry, requirements/quality, activity) into one self-contained file (default `.planning/hud.html`). Read-only view — no new state; army panels self-hide on plain projects. |
| `skill-align.cjs` | **(ADR-0038)** Skill-Aligned Decomposition pass: `skills index` (on-the-fly index of commands/templates/references/learnings), `skills align --draft-file <p>` (score draft planner tasks against the skill surface, return budget-bounded vocabulary hints). Advisory, fail-open; used by `pan-planner` before grouping tasks into plans. |
| `hygiene.cjs` | Project cleanup + version alignment: `hygiene scan` (version drift per runtime manifest, legacy uppercase filenames, .tmp orphans, memory bloat, stale or expired agent-memory entries, memory files PAN does not read as memory, the size of Claude Code's own memory index (report-only), poisoned ledgers, stale traces and optimization reports, oversized cached context, fragment planning dirs, foreign and shared planning trees), `hygiene clean [--apply]` (dry-run by default; safe fixes only — renames, compaction of state.md, roadmap.md and agent memory, memory pruning, quarantine-by-rename, trace pruning; installer re-runs and fragment removal stay manual). |
| `phase-report.cjs` | Per-phase HTML report + project timeline index: `report phase <N>` and `report index` (`--out`/`--open`/`--stdout`; `index` also `--bundle` for one self-contained inlined file), `report all` (`--open` opens the index; writes every phase report plus the index to their default paths). Reuses `hud.cjs` rendering to produce self-contained files (per-phase `.planning/phases/<NN-slug>/<NN>-report.html`; index `.planning/report-index.html`; bundle `.planning/report-bundle.html`). Read-only view — writes only its rendered file(s), no new state; deterministic (unchanged phase data rewrites nothing); a phase-less project has nothing to report. Opt-in auto-generation at the verify→complete gate, focus-auto checkpoints, and army INTEGRATE via `workflow.phase_reports`. |
| `links.cjs` | Doc-Code Link Graph engine behind `links validate` (ADR-0027): parses frontmatter link declarations, resolves doc↔code references, and reports dangling/stale links. |
| `constants.cjs` | Shared constants used across the dispatcher — e.g. `COMMAND_RENAME_MAP` (legacy→current command names) and `FOCUS_CATEGORIES`. No CLI surface; imported by other modules. |
| `lock.cjs` | Advisory file-locking helper serializing concurrent writes to shared `.planning/` state. No CLI surface; imported where write races are possible. |
| `store.cjs` | The write path for orchestration files (focus runs and batches, autodev run records, merge-gate approvals) and the per-command locks the dispatcher takes for commands that edit `state.md`, `roadmap.md`, `requirements.md` or `config.json`. No verbs of its own; its refusals are `lock_timeout`, `stale_write` and `unreadable`. A `lock_timeout` refusal names the `lock`, its `holder` (`{pid, host}`), `lock_age_ms`, `holder_alive` and `holder_gone`, and advises deleting the lock file only when `holder_gone` (a lock released before the report gives `holder: null` and no age; an unreadable lock file gives `holder: null`). |
| `transitions.cjs` | The state tables for focus runs, autodev runs, merge requests and phases, and the Quick Tasks status values. No verbs of its own; the writers it guards refuse with `illegal_transition` (a change the table does not allow, with `allowed`), `unknown_state` and, for `state quick-task`, `invalid_status`. |
| `journal.cjs` | `journal step`, `journal show`, `journal resume-point`: the step journal beside each plan, and the resume point `open_work` reports. |
| `pause.cjs` | `pause open`, `pause answer`, `pause list`, `pause cancel`: typed pauses for a person's answer, and the `answer_pause` step next-action puts first. |
| `pause-schema.cjs` | The `expects` language of a pause and its answer validator. No verbs of its own. |
| `utils.cjs` | Planning-root path builders (`planningPath()`, `planningRel()`, `phasesPath()`, `milestonesPath()`), `fileAccessible()`/`readJsonFile()`, plan/summary file filters and `classifyPhaseStatus()`, shared by the other modules. No CLI surface. (`toPosix()` and `safeReadFile()` live in `core.cjs`.) |
| `planning-root.cjs` | Resolves WHICH planning tree a command acts on (`--track` / `--planning-dir` / `PAN_TRACK` / `PAN_PLANNING_DIR`, default `.planning`), discovers tracks under `.planning/tracks/`, and reports each resolution's provenance. Leaf module — requires only `fs`/`path`. `utils.planningPath()` / `utils.planningRel()` are the only path constructors built on it. No CLI surface. |
| `foreign-planning.cjs` | **(2026-09)** Detects a `.planning/` that another tool writes to, from markers PAN never writes. **gsd-core owns its tree:** its markers are `HANDOFF.json`, `.gsd-allow-shrink`, two or more gsd-only directories, or its flat dotted config keys. `hygiene scan`/`clean` raises one `foreign-planning-tree` warning and refuses the rename fix, `validate health` reports `E006` and stops before `E002`–`E005`, and `init new-project` refuses with an error payload; the remedy is `--planning-dir <dir>`. **planning-with-files shares the tree:** its markers are `.active_plan`, `.attestation`, `ledger-*.jsonl`, a dated task directory holding `task_plan.md`, or two of its directories (`sessions/`, dated task directories without the plan file). PAN keeps working: `hygiene` raises a `shared-planning-tree` info finding, `validate health` reports `I004`, and `init new-project` returns `shared_planning_tree`. No CLI surface of its own. |
| `verdict.cjs` | **(evidence loop)** The `pan-verdict` contract: parses the last fenced `pan-verdict` block of a judge's report, validates it (outcome, finding classes and severities, limits), reads a verification.md frontmatter through an adapter, and derives finding ids and artifact signatures. Pure; no CLI surface of its own. |
| `findings.cjs` | **(evidence loop)** The findings ledger `.planning/findings.jsonl` behind `findings record`, `findings list`, `findings dispose`, `findings debt`, `findings suppressions` and `findings prove`, and the MCP resource `pan://findings`. It is append-only and folded on read. A finding closes only on evidence (a judge's `resolved` answer, the verifier's `gaps_closed`, or a passing code fact); one a report neither repeats nor answers stays open as `unaddressed`. A regressed fix reopens, and deliberate dispositions stick, except that a dismissal only suppresses its finding until the file changes, and never a security or logic finding. Each recorded verdict is logged to the trace. |
| `phase-gate.cjs` | **(program V1)** `phase gate <N>`: whether a phase may be marked complete, in code. Refuses (one reason code each) on a plan without a summary, no verification, a failed one (with code facts applied), `human_needed` without a recorded approval, a stale verification, a reconcile contradiction, a failed test gate, open critical/high findings, committed stubs, or a test-integrity violation; what it could not check is listed in `not_checked`. `phase complete`, the native `pan-exec-waves` script and the MCP merge request all use it. |
| `verify-integrity.cjs` | **(program V3)** `verify test-integrity <phase>`: walks the phase's plan commits and reports a deleted test, a skip or only marker added (JS, Python, Go, Rust, Java), assertions dropped, an assertion edited in a test no plan declares, a rewritten snapshot, or an assertion that cannot fail; a renamed test is a warning. Uses verify-scope's `committedFiles()`. |
| `verify-plan-set.cjs` | **(program V7)** `verify plan-set <phase>`: the plan checks code can make, before the plan checker runs (requirement coverage, same-wave file overlap, missing, self and future references, cycles, wave gaps). `planCheckStatus()` binds a passing plan check to the plans it checked through the `plans_sha` the recorder stores with every plan-checker verdict; `planDrift()` lists planned files changed since a plan's `planned_commit`. `init execute-phase` carries both as `plan_check` and `plan_drift`. |
| `verify-scope.cjs` | **(evidence loop)** `verify scope <phase>`: the files a phase changed that its plans did not declare in `files_modified`, taken from its plan commits and summary key-files, for the verifier's unrequested-work check. `verify stale <phase>`: whether the files a verification covered changed since its `verified_commit`. `verify refresh <phase> --reason R`: moves a stale verification to HEAD when only comments changed. `review scope <phase>` (program R1): the files a reviewer reads (the phase's commits plus uncommitted and untracked work) and the plans' intent. Re-exported through verify.cjs. |
| `plan-lint.cjs` | **(program P4, P2)** `verify review-focus <phase>`: every plan has a `## Review Focus` of at most five items, each naming its owning task and a test, or one `None — <reason>` line. `verify decisions <phase>`: plans cite only `DD-N` decision ids the phase design records, and every recorded decision is cited. `/pan:plan-phase` runs both with `verify plan-set` before the plan checker. `verify gates <phase>`: a task's `<verify>` command that already passes before any work is flagged. |
| `research-lint.cjs` | **(program P3)** `research lint <phase\|path>`: the research file's `## Claims` table (claim · type · source · checked), or the answered rows of its answers table. A claim with no source or no date is an error; one older than its type's freshness window is `stale`. `research check <questions> <research> [--market]`: at most five questions, each answered with a source or `unknown` with an assumption, at most five comparable products. |
| `usage.cjs` | **(program L9)** `usage`: a local census of the installed commands and agents against the project's cost ledger and trace sessions: used (calls, last use), never used, and commands started but never finished. Local files only. |
| `feedback.cjs` | `feedback`: the learning report a user may share (`/pan:feedback`). Built from closed vocabularies (PAN's shipped command and agent names, finding classes, gate codes, tool-error classes …), counts coarsened, then scanned with `redact.cjs` and refused rather than printed on any hit. Reads the findings, cost, guard and trace ledgers, test-run and mutation records, config and the usage census; writes nothing. |
| `redact.cjs` | `scanText()`: the rules a text breaks (credential shapes from both hooks, Bearer headers, long mixed runs, e-mails, URLs, paths, IP addresses, project canaries), naming rules, never the text; `projectCanaries()`: the project directory, git remote owner, repository and host, branch, git user and e-mail, OS user, host name and phase slugs. Detection only. |
| `test-gate.cjs` | **(program V2)** `test run` and `test detect`: finds the project's test command in any language (or `workflow.test_command`), runs it, parses the runner's output into stable failing-test ids, and compares a phase's run with its baseline (`{NN}-test-baseline.json`, `{NN}-test-run.json`). The phase gate and the verdict recorder read the run record. |
| `verify-red.cjs` | **(program V4)** `verify red <phase>`: runs each test file the phase changed at the phase's base (in a throwaway worktree) and at HEAD; a test that passes before the phase's code exists is `not_red`. Also exports the phase-base and worktree helpers `verify mutate` uses. |
| `mutate.cjs` | **(program V5)** `verify mutate --phase N`: a seeded sample of single-operator mutations on the lines the phase changed, each run against the whole suite in a worktree at HEAD; writes `{NN}-mutation.json`. Report-only unless `workflow.mutation_gate` is `gate`. |
| `autodev.cjs` | **(program A1)** `autodev run/resume/status`: the deterministic outer loop — reads `.planning/`, asks `next-action` for the next unit, decides in code whether to stop, runs each unit in a fresh headless host session (a lean phase is planned by the engine through `size phase-plan` and executed through `workflows/exec-lean.md` in one session); ledger and state under `.planning/autodev/`. |
| `autodev-report.cjs` | **(program A5)** `autodev replay` (re-runs the stop logic over `blackbox.jsonl`) and `autodev report` (`dossier.md`/`dossier.html` beside the ledger). |
| `failure-class.cjs` | **(program A4)** Classifies a failed autodev unit and routes it: retry with the error tail, fresh restart, tier escalation, quarantine, ask a human, or stop on budget. No CLI surface. |
| `ci.cjs` | **(program A2)** CI as autodev's oracle: `gh pr checks` (`--ci`), or the project's own `npm run ci:local`/`npm test` (`--ci local`); fix rounds and a breaker. No CLI surface of its own. |
| `hosts.cjs` | **(program A0)** One table of how PAN runs each host CLI: the autonomous runner argv, the model family, the read-only review argv, the headless harness argv. No CLI surface. |
| `design-handoff.cjs` | `design paths`, `design handoff`: where `/pan:focus-design` writes its spec, ADR and checker verdict (`docs/specs/` and `docs/decisions/` when the project has both, else `.planning/designs/<slug>/`), and the hand-off of a finished design to a roadmap phase (planned with `--prd <spec>`) or to focus. |
| `next-action.cjs` | **(program L7)** `next-action`: reads roadmap.md and the phase directories into the MCP orchestrator's snapshot and maps its decision to a command; an open focus cycle or a stale focus run comes first (`action: "focus"`). |
| `open-work.cjs` | Work started and not finished (unsummarised phase plans, open quick tasks and focus cycles, debug sessions, `.continue-here` files): the `open_work` block of `init resume`, with each journaled plan's resume point. |
| `sizing.cjs` | Right-sized ceremony: `size phase/task` decide lean or full per piece of work, `size phase-plan` writes a lean phase's plans from its requirements (in waves, at most `workflow.lean_max_requirements` tasks each) and records their check, `size quick-plan` writes a lean quick task's plan, `size plan-check` is the lean path's plan check in code. |
| `cross-family.cjs` | **(program R4)** `review cross-family <phase>`: one read-only review on another host's CLI, off unless `workflow.cross_family_review` names a host. |
| `review-vote.cjs` | **(program R2)** `review vote`: merges k reviewer passes; a finding survives only with a quorum. |
| `merge.cjs` | **(program L6a)** `merge request` / `merge confirm`: the human merge gate on the CLI; confirm only in an interactive terminal. |
| `uat.cjs` | **(program L8)** `uat record` / `uat status`: UAT results written through the engine into `{phase}-uat.md`. |
| `debug-cases.cjs` | **(program P5)** `debug repro <slug>` / `debug similar "<symptom>"`: a debug session's reproduction as its closing check, and the resolved case base. |
| `state-write.cjs` | **(program A7b)** `state init`, `state section`, `state quick-task`, `state apply`: the writers of state.md as a whole or by section. |
| `requirements-lint.cjs` | **(program V8)** `verify requirements` (EARS criteria) and `verify traceability` (runs each requirement's mapped tests); `phase complete` ticks through it. |

---

## Command Index

Quick reference of every CLI command and subcommand, with its category and the module that implements it. Rows are not sorted by category; search the Category column.

| # | Command | Category | Module |
|---|---------|----------|--------|
| 1 | `state load` | State | state.cjs |
| 2 | `state json` | State | state.cjs |
| 3 | `state update` | State | state.cjs |
| 4 | `state get` | State | state.cjs |
| 5 | `state patch` | State | state.cjs |
| 6 | `state-snapshot` | State | state.cjs |
| 7 | `state advance-plan` | State Progression | state.cjs |
| 8 | `state record-metric` | State Progression | state.cjs |
| 9 | `state update-progress` | State Progression | state.cjs |
| 10 | `state add-decision` | State Progression | state.cjs |
| 11 | `state add-blocker` | State Progression | state.cjs |
| 12 | `state resolve-blocker` | State Progression | state.cjs |
| 13 | `state record-session` | State Progression | state.cjs |
| 14 | `phase next-decimal` | Phase Ops | phase.cjs |
| 15 | `phase add` | Phase Ops | phase.cjs |
| 16 | `phase insert` | Phase Ops | phase.cjs |
| 17 | `phase remove` | Phase Ops | phase-remove.cjs |
| 18 | `phase complete` | Phase Ops | phase.cjs |
| 19 | `phases list` | Phase Listing | phase.cjs |
| 20 | `phase-plan-index` | Phase Listing | phase.cjs |
| 21 | `find-phase` | Phase Listing | phase.cjs |
| 22 | `roadmap get-phase` | Roadmap | roadmap.cjs |
| 23 | `roadmap analyze` | Roadmap | roadmap.cjs |
| 24 | `roadmap update-plan-progress` | Roadmap | roadmap.cjs |
| 25 | `requirements mark-complete` | Requirements | milestone.cjs |
| 26 | `milestone complete` | Milestone | milestone.cjs |
| 27 | `validate consistency` | Validation | verify.cjs |
| 28 | `validate health` | Validation | verify.cjs |
| 29 | `validate deployment` | Validation | verify-deploy.cjs |
| 30 | `verify-summary` | Verification | verify.cjs |
| 31 | `verify plan-structure` | Verification | verify.cjs |
| 32 | `verify phase-completeness` | Verification | verify.cjs |
| 33 | `verify references` | Verification | verify.cjs |
| 34 | `verify commits` | Verification | verify.cjs |
| 35 | `verify artifacts` | Verification | verify.cjs |
| 36 | `verify key-links` | Verification | verify.cjs |
| 37 | `progress` | Progress | commands.cjs |
| 38 | `next-action` | Progress | next-action.cjs |
| 39 | `design paths` | Phase Ops | design-handoff.cjs |
| 40 | `design handoff` | Phase Ops | design-handoff.cjs |
| 41 | `context-budget` | Progress | context-budget.cjs |
| 42 | `todo complete` | Todos | commands.cjs |
| 43 | `list-todos` | Todos | commands.cjs |
| 44 | `scaffold context` | Scaffolding | commands.cjs |
| 45 | `scaffold uat` | Scaffolding | commands.cjs |
| 46 | `scaffold verification` | Scaffolding | commands.cjs |
| 47 | `scaffold phase-dir` | Scaffolding | commands.cjs |
| 48 | `frontmatter get` | Frontmatter | frontmatter.cjs |
| 49 | `frontmatter set` | Frontmatter | frontmatter.cjs |
| 50 | `frontmatter merge` | Frontmatter | frontmatter.cjs |
| 51 | `frontmatter validate` | Frontmatter | frontmatter.cjs |
| 52 | `template select` | Template | template.cjs |
| 53 | `template fill summary` | Template | template.cjs |
| 54 | `template fill plan` | Template | template.cjs |
| 55 | `template fill verification` | Template | template.cjs |
| 56 | `config-ensure-section` | Config | config.cjs |
| 57 | `config-get` | Config | config.cjs |
| 58 | `config-set` | Config | config.cjs |
| 59 | `resolve-model` | Utility | commands.cjs |
| 60 | `commit` | Utility | commands.cjs |
| 61 | `generate-slug` | Utility | commands.cjs |
| 62 | `current-timestamp` | Utility | commands.cjs |
| 63 | `verify-path-exists` | Utility | commands.cjs |
| 64 | `history-digest` | Utility | commands.cjs |
| 65 | `summary-extract` | Utility | commands.cjs |
| 66 | `websearch` | Utility | commands.cjs |
| 67 | `rollback-snapshot` | Utility | commands.cjs |
| 68 | `estimate-cost` | Utility | commands.cjs |
| 69 | `init execute-phase` | Init | init.cjs |
| 70 | `init plan-phase` | Init | init.cjs |
| 71 | `init new-project` | Init | init.cjs |
| 72 | `init new-milestone` | Init | init.cjs |
| 73 | `init quick` | Init | init.cjs |
| 74 | `init resume` | Init | init.cjs |
| 75 | `init verify-work` | Init | init.cjs |
| 76 | `init phase-op` | Init | init.cjs |
| 77 | `init todos` | Init | init.cjs |
| 78 | `init milestone-op` | Init | init.cjs |
| 79 | `init map-codebase` | Init | init.cjs |
| 80 | `init progress` | Init | init.cjs |
| 81 | `focus scan` | Focus | focus.cjs |
| 82 | `focus plan` | Focus | focus.cjs |
| 83 | `focus sync` | Focus | focus.cjs |
| 84 | `focus exec` | Focus | focus.cjs |
| 85 | `focus auto` | Focus | focus.cjs |
| 86 | `focus route` | Focus | focus.cjs |
| 87 | `focus open` | Focus | focus.cjs |
| 88 | `focus close` | Focus | focus.cjs |
| 89 | `focus design` | Focus | pan-tools.cjs (answered inline) |
| 90 | `standards list` | Standards | config.cjs |
| 91 | `standards select` | Standards | config.cjs |
| 92 | `standards remove` | Standards | config.cjs |
| 93 | `standards status` | Standards | config.cjs |
| 94 | `standards recommend` | Standards | config.cjs |
| 95 | `standards phase-track` | Standards | config.cjs |
| 96 | `standards tools` | Standards | config.cjs |
| 97 | `preflight` | Operations | verify-preflight.cjs |
| 98 | `dashboard` | Operations | state.cjs |
| 99 | `learnings extract` | Operations | commands-learnings.cjs |
| 100 | `learnings list` | Operations | commands-learnings.cjs |
| 101 | `learnings prune` | Operations | commands-learnings.cjs |
| 102 | `deps validate` | Operations | verify-preflight.cjs |
| 103 | `drift-check` | Operations | verify-drift.cjs |
| 104 | `retro` | Operations | verify-retro.cjs |
| 105 | `codebase detect-languages` | Codebase | codebase.cjs |
| 106 | `codebase analyze-imports` | Codebase | codebase.cjs |
| 107 | `codebase best-practices` | Codebase | codebase.cjs |
| 108 | `codebase estimate-size` | Spec A E-2 | codebase.cjs |
| 109 | `memory read` | Spec A E-4 | memory.cjs |
| 110 | `memory append` | Spec A E-4 | memory.cjs |
| 111 | `memory list` | Spec A E-4 | memory.cjs |
| 112 | `memory compact` | Spec A E-4 | memory.cjs |
| 113 | `cache prime` | Spec A E-1 | core.cjs |
| 114 | `focus classify-stages` | Spec A E-6 | focus.cjs |
| 115 | `focus reflection` | Spec A E-10 | focus.cjs |
| 116 | `cost report` | Spec B v2 Y-6 | cost.cjs |
| 117 | `cost append` | Spec B v2 Y-6 | cost.cjs |
| 118 | `cost clear` | Spec B v2 Y-6 | cost.cjs |
| 119 | `bus publish` | Spec B v2 Y-7 | bus.cjs |
| 120 | `bus drain` | Spec B v2 Y-7 | bus.cjs |
| 121 | `bus list` | Spec B v2 Y-7 | bus.cjs |
| 122 | `preview phase` | Spec B v2 Y-1 | preview.cjs |
| 123 | `preview phases` | Spec B v2 Y-1 | preview.cjs |
| 124 | `preview milestone` | Spec B v2 Y-1 | preview.cjs |
| 125 | `review-deep merge` | Spec B v2 Y-2 | review-deep.cjs |
| 126 | `review-deep analyze` | Spec B v2 Y-2 | review-deep.cjs |
| 127 | `knowledge ask` | Spec B v2 Y-3 | knowledge.cjs |
| 128 | `knowledge discuss` | Spec B v2 Y-3 | knowledge.cjs |
| 129 | `knowledge playbook` | Spec B v2 Y-3 | knowledge.cjs |
| 130 | `whatif prepare` | Spec B v2 Y-4 | whatif.cjs |
| 131 | `whatif report` | Spec B v2 Y-4 | whatif.cjs |
| 132 | `whatif cleanup` | Spec B v2 Y-4 | whatif.cjs |
| 133 | `optimize trace init` | Optimization | optimize.cjs |
| 134 | `optimize trace end` | Optimization | optimize.cjs |
| 135 | `optimize trace current` | Optimization | optimize.cjs |
| 136 | `optimize trace list` | Optimization | optimize.cjs |
| 137 | `optimize trace log` | Optimization | optimize.cjs |
| 138 | `optimize learn` | Optimization | optimize.cjs |
| 139 | `optimize apply` | Optimization | optimize.cjs |
| 140 | `optimize list` | Optimization | optimize.cjs |
| 141 | `optimize stats` | Optimization | optimize.cjs |
| 142 | `learn` (alias) | Optimization | optimize.cjs |
| 143 | `git commit` | Git | git.cjs |
| 144 | `git branch` | Git | git.cjs |
| 145 | `git push` | Git | git.cjs |
| 146 | `git status` | Git | git.cjs |
| 147 | `git log` | Git | git.cjs |
| 148 | `git stash` | Git | git.cjs |
| 149 | `git diff` | Git | git.cjs |
| 150 | `git rollback` | Git | git.cjs |
| 151 | `git tag` | Git | git.cjs |
| 152 | `git sync` | Git | git.cjs |
| 153 | `distill scan` | Distill | distill.cjs |
| 154 | `distill analyze` | Distill | distill.cjs |
| 155 | `distill report` | Distill | distill.cjs |
| 156 | `experiment new` | Self-Improvement Loop | experiment.cjs |
| 157 | `experiment list` | Self-Improvement Loop | experiment.cjs |
| 158 | `experiment manifest` | Self-Improvement Loop | experiment.cjs |
| 159 | `experiment run` | Self-Improvement Loop | runner.cjs |
| 160 | `experiment status` | Self-Improvement Loop | runner.cjs |
| 161 | `experiment stop` | Self-Improvement Loop | runner.cjs |
| 162 | `experiment harvest` | Self-Improvement Loop | experiment.cjs |
| 163 | `experiment prune` | Self-Improvement Loop | experiment.cjs |
| 164 | `doc-lint <dir>` | Doc-Lint | doc-lint.cjs |
| 165 | `doc-lint schema-check` | Doc-Lint | doc-lint.cjs |
| 166 | `learn promote` | Learnings | optimize.cjs |
| 167 | `learn unpromote` | Learnings | optimize.cjs |
| 168 | `learn list-promoted` | Learnings | optimize.cjs |
| 169 | `learn lint` | Learnings | learn-lint.cjs |
| 170 | `learn build-index` | Learnings | learn-index.cjs |
| 171 | `learn topics-for` | Learnings | learn-index.cjs |
| 172 | `links validate` | Doc-Code Link Graph | links.cjs |
| 173 | `squad list` | Bot Army | squads.cjs |
| 174 | `squad show` | Bot Army | squads.cjs |
| 175 | `worktree list` | Bot Army | worktree.cjs |
| 176 | `worktree create` | Bot Army | worktree.cjs |
| 177 | `worktree remove` | Bot Army | worktree.cjs |
| 178 | `worktree cleanup` | Bot Army | worktree.cjs |
| 179 | `campaign schedule` | Bot Army | campaign.cjs |
| 180 | `campaign status` | Bot Army | campaign.cjs |
| 181 | `campaign due` | Bot Army | campaign.cjs |
| 182 | `campaign record-run` | Bot Army | campaign.cjs |
| 183 | `hud` | Observability | hud.cjs |
| 184 | `models check` | Cost | cost.cjs |
| 185 | `skills index` | Planning (SAD) | skill-align.cjs |
| 186 | `skills align` | Planning (SAD) | skill-align.cjs |
| 187 | `hygiene scan` | System | hygiene.cjs |
| 188 | `hygiene clean` | System | hygiene.cjs |
| 189 | `report phase <N>` | Observability | phase-report.cjs |
| 190 | `report index` | Observability | phase-report.cjs |
| 191 | `report all` | Observability | phase-report.cjs |
| 192 | `memory optimize` | Memory | memory-optimize.cjs |
| 193 | `memory rebuild` | Memory | memory-rebuild.cjs |
| 194 | `optimize trace reconcile` | Optimization | optimize.cjs |
| 195 | `verify reconcile` | Verification | verify.cjs |
| 196 | `verify stubs` | Verification | verify.cjs |
| 197 | `memory select` | Memory | memory.cjs |
| 198 | `memory budget` | Memory | memory.cjs |
| 199 | `doc-lint counts` | Linting | doc-lint.cjs |
| 200 | `doc-lint flags` | Linting | doc-lint.cjs |
| 201 | `state compact` | State Progression | state-compact.cjs |
| 202 | `optimize trace show` | Optimization | optimize.cjs |
| 203 | `cost rebuild` | Cost | cost-rebuild.cjs |
| 204 | `findings record` | Evidence loop | findings.cjs |
| 205 | `findings list` | Evidence loop | findings.cjs |
| 206 | `findings dispose` | Evidence loop | findings.cjs |
| 207 | `findings debt` | Evidence loop | findings.cjs |
| 208 | `verify scope` | Verification | verify-scope.cjs |
| 209 | `optimize revert` | Optimization | optimize.cjs |
| 210 | `verify stale` | Verification | verify-scope.cjs |
| 211 | `version` | Utility | commands.cjs |
| 212 | `roadmap slice` | Roadmap | roadmap.cjs |
| 213 | `roadmap compact` | Roadmap | roadmap-compact.cjs |
| 214 | `memory prune` | Memory | memory.cjs |
| 215 | `memory record` | Memory | memory.cjs |
| 216 | `cost limits` | Cost | cost.cjs |
| 217 | `verify plan-set` | Verification | verify-plan-set.cjs |
| 218 | `verify test-integrity` | Verification | verify-integrity.cjs |
| 219 | `phase gate` | Phase Ops | phase-gate.cjs |
| 220 | `test run` | Verification | test-gate.cjs |
| 221 | `test detect` | Verification | test-gate.cjs |
| 222 | `verify red` | Verification | verify-red.cjs |
| 223 | `verify mutate` | Verification | mutate.cjs |
| 224 | `review scope` | Verification | verify-scope.cjs |
| 225 | `findings suppressions` | Evidence loop | findings.cjs |
| 226 | `verify review-focus` | Verification | plan-lint.cjs |
| 227 | `verify decisions` | Verification | plan-lint.cjs |
| 228 | `research lint` | Verification | research-lint.cjs |
| 229 | `state snapshot` (alias of `state-snapshot`) | State | state.cjs |
| 230 | `cost budget` | Cost | cost.cjs |
| 231 | `usage` | Observability | usage.cjs |
| 232 | `autodev run` | Autonomy | autodev.cjs |
| 233 | `autodev resume` | Autonomy | autodev.cjs |
| 234 | `autodev status` | Autonomy | autodev.cjs |
| 235 | `autodev report` | Autonomy | autodev-report.cjs |
| 236 | `autodev replay` | Autonomy | autodev-report.cjs |
| 237 | `worktree preflight` | Autonomy | worktree.cjs |
| 238 | `review cross-family` | Verification | cross-family.cjs |
| 239 | `review vote` | Verification | review-vote.cjs |
| 240 | `findings prove` | Evidence loop | findings.cjs |
| 241 | `verify gates` | Verification | plan-lint.cjs |
| 242 | `verify requirements` | Verification | requirements-lint.cjs |
| 243 | `verify traceability` | Verification | requirements-lint.cjs |
| 244 | `state init` | State | state-write.cjs |
| 245 | `state section` | State | state-write.cjs |
| 246 | `state quick-task` | State | state-write.cjs |
| 247 | `state apply` | State | state-write.cjs |
| 248 | `merge request` | Bot Army | merge.cjs |
| 249 | `merge confirm` | Bot Army | merge.cjs |
| 250 | `uat record` | Verification | uat.cjs |
| 251 | `uat status` | Verification | uat.cjs |
| 252 | `debug repro` | Verification | debug-cases.cjs |
| 253 | `debug similar` | Verification | debug-cases.cjs |
| 254 | `research check` | Verification | research-lint.cjs |
| 255 | `feedback` | Observability | feedback.cjs |
| 256 | `size phase` | Right-sized ceremony | sizing.cjs |
| 257 | `size task` | Right-sized ceremony | sizing.cjs |
| 258 | `size phase-plan` | Right-sized ceremony | sizing.cjs |
| 259 | `size quick-plan` | Right-sized ceremony | sizing.cjs |
| 260 | `size plan-check` | Right-sized ceremony | sizing.cjs |
| 261 | `journal step` | Durable orchestration | journal.cjs |
| 262 | `journal show` | Durable orchestration | journal.cjs |
| 263 | `journal resume-point` | Durable orchestration | journal.cjs |
| 264 | `pause open` | Durable orchestration | pause.cjs |
| 265 | `pause answer` | Durable orchestration | pause.cjs |
| 266 | `pause list` | Durable orchestration | pause.cjs |
| 267 | `pause cancel` | Durable orchestration | pause.cjs |
| 268 | `requirements reopen` | Requirements | milestone.cjs |
| 269 | `verify refresh` | Verification | verify-scope.cjs |

---

## 1. State Commands

Commands for reading and writing state.md — the central project state file.

### `state load`

Load project config and planning state. Workflows that need no compound context call it (`/pan:settings`, `/pan:settings --profile`, `/pan:debug`); most workflows start with an `init <workflow>` call ([§17](#17-compound-init-commands)) instead.

```bash
pan-tools state load [--raw]
pan-tools state                   # bare `state` is an alias for `state load`
```

**JSON output:**
```json
{
  "contract": "1.0",
  "config": { "model_profile": "balanced", "commit_docs": true, ... },
  "state_raw": "<full state.md content>",
  "state_exists": true,
  "roadmap_exists": true,
  "config_exists": true
}
```

**`--raw` output:** Key=value lines: `model_profile=balanced`, `commit_docs=true`, etc.

**Missing state.md is not an error here:** `state load` returns `state_exists: false` with an empty `state_raw` and exits `0`. `state json`, `state get` and the state-progression commands return `{ "error": "state.md not found" }` (exit 1); `state compact` reports it as a bare `Error: … not found — nothing to compact` line on stderr (exit 1).

**Implementation:** `state.cjs → cmdStateLoad()` — reads state.md with a tolerant `fs.readFileSync` (absence is not an error).

---

### `state json`

Output state.md frontmatter as JSON. Returns the YAML frontmatter block parsed into a JSON object. If no frontmatter exists, it is built from the markdown body.

**How writers keep the frontmatter.** Every `state` writer patches only the keys it owns, line by line; comments, quoting, order and keys PAN does not know stay byte for byte. `update`, `patch`, `advance-plan` and `apply` own `current_phase`, `current_phase_name`, `current_plan`, `status`, `last_activity` and `last_updated`; `add-decision`, `add-blocker`, `resolve-blocker`, `record-metric`, `record-session`, `section` and `quick-task` own `last_updated` only; `update-progress` and `phase complete` own the first set plus the `progress.*` keys already present; `init` owns the first set, the `progress.*` keys already present and, for a new milestone, `milestone` and `milestone_name`; `milestone complete` also owns `milestone` and `milestone_name`. `last_activity` never moves backwards, and a recorded `milestone` is replaced only by `milestone complete` (with the milestone it closes) or when the roadmap marks another milestone current.

```bash
pan-tools state json [--raw]
```

**JSON output:**
```json
{
  "pan_state_version": "1.0",
  "milestone": "v1.0",
  "milestone_name": "Core Platform",
  "current_phase": "05",
  "current_phase_name": "Setup",
  "current_plan": "2",
  "status": "executing",
  "last_updated": "2026-02-27T12:00:00.000Z",
  "last_activity": "2026-02-27",
  "progress": {
    "total_phases": 12,
    "completed_phases": 4,
    "total_plans": 30,
    "completed_plans": 18,
    "percent": 60
  },
  "contract": "1.0"
}
```

`contract` is the output's shape version (see [Output Contracts](#output-contracts-contract)), never a state.md field.

**Implementation:** `state.cjs → cmdStateJson()` — Parses YAML frontmatter first, falls back to markdown body parsing.

---

### `state update <field> <value>`

Update a single `**Field:** value` line in state.md.

```bash
pan-tools state update "Current Phase" "06"
```

**JSON output:**
```json
{ "updated": true }
```

If the field is not found (exit 1):
```json
{ "updated": false, "reason": "Field \"Current Phase\" not found in state.md", "error": "field_not_found" }
```

A missing state.md gives `error: "state_not_found"` (exit 1). Output is always JSON: `--raw` is not read.

**Note:** Field names match the bold markdown format (e.g., `"Current Phase"`, `"Status"`), case-insensitively; only the first matching line is updated.

---

### `state get [section]`

Get full state.md content, or a specific field/section.

```bash
pan-tools state get                    # Full content
pan-tools state get "Status"           # Extract **Status:** value
pan-tools state get "Session Continuity"   # Extract the ## Session Continuity section (the whole heading text)
```

**JSON output (full):**
```json
{ "content": "<full state.md content>" }
```

**JSON output (field):**
```json
{ "Status": "Executing plan 3 of 5" }
```

**`--raw` output:** The matched value or section text.

---

### `state patch --field val ...`

> If state.md is missing, `state patch` prints `Error: state.md not found` on stderr (exit 1) rather than a JSON body.

Batch update multiple `**Field:** value` lines in a single operation.

```bash
pan-tools state patch --Status "Ready to execute" --"Current Plan" "3"
```

**JSON output:**
```json
{ "updated": ["Status", "Current Plan"], "failed": [] }
```

**Note:** Flag names are converted to field names by stripping the leading `--`. Use quotes for multi-word field names.

---

### `state-snapshot`

Structured parse of state.md into a comprehensive JSON object. Unlike `state json` (which returns frontmatter), this parses the full markdown body including decisions, blockers, and session info.

```bash
pan-tools state-snapshot
pan-tools state snapshot            # equivalent alias — the spaced form dispatches to the same handler
```

**JSON output:**
```json
{
  "current_phase": "05",
  "current_phase_name": "Setup",
  "total_phases": 12,
  "current_plan": "2",
  "total_plans_in_phase": 4,
  "status": "Executing",
  "progress_percent": 60,
  "last_activity": "2026-02-27",
  "last_activity_desc": "Completed plan 1 of phase 5",
  "decisions": [{ "phase": "04", "summary": "...", "rationale": "..." }],
  "blockers": ["Waiting on API key"],
  "paused_at": null,
  "session": {
    "last_date": "2026-02-27T12:00:00.000Z",
    "stopped_at": "Finished task 3",
    "resume_file": "None"
  }
}
```

**Difference from `state json`:** `state json` returns YAML frontmatter fields. `state-snapshot` parses the full markdown body into a structured object with decisions, blockers, and session data extracted from markdown sections.

---

## 2. State Progression

Commands for advancing workflow state — plan counters, metrics, decisions, blockers, and session continuity.

### `state compact [--apply] [--keep-days N]`

Move settled history out of `state.md` into `state-history.md`. See [ADR-0044](decisions/ADR-0044-bound-the-cached-context.md).

`state.md` is in the cached context block, so **every byte is re-read into every agent call** — and its section writers only append, so the file can only grow. In the field this reached 54 KB, of which 30 KB was a ten-week-old session log, a resolved milestone audit, and three phase closures: ~7k tokens of finished work re-read on every call.

```bash
pan-tools state compact                   # dry-run: what would move, and what it saves
pan-tools state compact --apply
pan-tools state compact --keep-days 90
```

**What moves:** a section whose heading is dated past the retention window (default 30 days), or whose heading says "closure"/"closed".

**What never moves:**
- headings PAN reads or writes (matched as heading prefixes: Decisions, Accumulated…, Blockers, Concerns, Session, Next Action, Phase Progress, Project Reference, Source Authority, Toolchain, Metrics, Current…, Status) — `state get <section>` can read any heading by name
- any section carrying a field the frontmatter is patched from (`**Status:**`, `**Current Phase:**`, `**Last Activity:**`, …), because `syncStateFrontmatter` patches the frontmatter from the **first** such match in the body
- anything unrecognised — the classifier declines rather than guesses
- everything, when archiving would not actually shrink the file (on a small `state.md` the pointer costs more than the section)

**Safety:** nothing is deleted. History is appended to `state-history.md` **first**, then `state.md` is rewritten with a pointer where each archived section stood — an interruption can only duplicate, never lose. The dry-run's byte count comes from the same rebuild `--apply` uses.

**Key output fields:** `sections[]` (each with `title`, `bytes`, `archive`, `reason`), `archivable[]`, `bytes_before` / `bytes_after`, `tokens_before` / `tokens_after`, `tokens_saved_per_call`.

### `state advance-plan`

Increment the current plan counter (setting `Status` to `Ready to execute`). If the last plan is reached, set `Status` to `Phase complete — ready for verification` instead. Both update `Last Activity`; a state.md without parsable `Current Plan` and `Total Plans in Phase` fields exits 1 with an `error`.

```bash
pan-tools state advance-plan [--raw]
```

**JSON output (advanced):**
```json
{ "advanced": true, "previous_plan": 2, "current_plan": 3, "total_plans": 5 }
```

**JSON output (last plan):**
```json
{ "advanced": false, "reason": "last_plan", "current_plan": 5, "total_plans": 5, "status": "ready_for_verification" }
```

**`--raw` output:** `true` or `false`.

---

### `state record-metric --phase N --plan M --duration Xmin [--tasks N] [--files N]`

Record execution metrics in the Performance Metrics table in state.md.

```bash
pan-tools state record-metric --phase 5 --plan 1 --duration 12min --tasks 4 --files 6
```

**Flags (all required unless noted):**
- `--phase N` — Phase number
- `--plan M` — Plan number
- `--duration Xmin` — Duration string (e.g., `12min`, `2h`)
- `--tasks N` — Task count (optional)
- `--files N` — Files modified count (optional)

**JSON output:**
```json
{ "recorded": true, "phase": "5", "plan": "1", "duration": "12min" }
```

---

### `state update-progress`

Recalculate and update the progress bar in state.md from the plans under `phases/`. Each plan is paired with its own summary by plan id (`05-02-plan.md` with `05-02-summary.md`, suffixes in any case), so a summary with no plan, such as `29.4-research-summary.md`, counts for nothing and `completed` never exceeds `total`; only directories named like a phase count, and a phase is complete only when every plan in it has a summary. The frontmatter `progress.*` keys that state.md already has (`total_phases`, `completed_phases`, `total_plans`, `completed_plans`, `percent`) are updated; missing ones are added only with `--write-counts`.

```bash
pan-tools state update-progress [--write-counts] [--raw]
```

**JSON output:**
```json
{
  "updated": true,
  "percent": 60,
  "completed": 18,
  "total": 30,
  "completed_phases": 4,
  "total_phases": 12,
  "bar": "[██████░░░░] 60%",
  "counts_written": false
}
```

**`--raw` output:** The progress bar string.

---

### `state add-decision --summary "..." [--phase N] [--rationale "..."] [--summary-file path] [--rationale-file path]`

Add a decision entry to the Decisions section in state.md.

```bash
pan-tools state add-decision --summary "Use PostgreSQL" --phase 5 --rationale "Better JSON support"
pan-tools state add-decision --summary-file /tmp/decision.txt --phase 5
```

**Flags:**
- `--summary "..."` — Decision summary text (or use `--summary-file`)
- `--phase N` — Phase number (optional)
- `--rationale "..."` — Rationale text (or use `--rationale-file`)
- `--summary-file path` — Read summary from file (avoids shell escaping issues with `$` signs)
- `--rationale-file path` — Read rationale from file

**JSON output:**
```json
{ "added": true, "decision": "- [Phase 5]: Use PostgreSQL — Better JSON support" }
```

**Note:** Use `--summary-file` and `--rationale-file` for text containing shell-sensitive characters like `$`.

---

### `state add-blocker --text "..." | --text-file path`

Add a blocker to the Blockers section in state.md (`## Blockers`, `Blockers/Concerns` or `Concerns`), removing a `None yet` placeholder. Either flag gives the text; `--text-file` wins when both are passed. A missing section exits 1 with `error: "blockers_section_missing"`; `--raw` prints `true` or `false`.

```bash
pan-tools state add-blocker --text "Waiting on API credentials"
pan-tools state add-blocker --text-file /tmp/blocker.txt
```

**JSON output:**
```json
{ "added": true, "blocker": "Waiting on API credentials" }
```

---

### `state resolve-blocker --text "..."`

Remove a blocker from the Blockers section by matching text (case-insensitive substring match).

```bash
pan-tools state resolve-blocker --text "API credentials"
```

**JSON output:**
```json
{ "resolved": true, "blocker": "API credentials" }
```

If no match: `{ "resolved": false, "reason": "no matching blocker", "blocker": "API credentials", "error": "blocker_not_matched" }` — exit 1.

---

### `state record-session --stopped-at "..." [--resume-file path]`

Update session continuity fields in state.md (Last session, Stopped At, Resume File). **Side effect:** after a successful write this is the normal-flow memory checkpoint — `memory optimize` runs automatically unless `memory.auto_optimize` is `false`.

```bash
pan-tools state record-session --stopped-at "Finished plan 3, starting plan 4"
pan-tools state record-session --stopped-at "Mid-task" --resume-file .planning/phases/05-setup/05-02-plan.md
```

**Flags:**
- `--stopped-at "..."` — Description of where work stopped
- `--resume-file path` — File to resume from (default: `None`)

**JSON output:**
```json
{ "recorded": true, "updated": ["Last session", "Stopped At", "Resume File"] }
```

The fields are `**Field:** value` lines (`Last session` or `Last Date`, `Stopped At`, `Resume File`); only the ones present are updated. When none is present it prints `{ "recorded": false, "reason": "No session fields found in state.md", "error": "session_fields_missing" }` and exits 1. `--raw` prints `true` or `false`.

### `state init` · `state section <name>` · `state quick-task` · `state apply` (program A7b)

The writers of state.md as a whole or by section; every shipped writer goes through them, so the pre-tool guard's `enforce` can deny a direct write.

```bash
pan-tools state init [--core-value V] [--focus F] [--phase N] [--phase-name S] [--total-phases N] [--status S] [--activity A] [--force] [--keep-context]
pan-tools state section "<name>" (--append "<line>" | --set "<text>") [--under "<section>"]
pan-tools state quick-task --description D --commit SHA --directory DIR [--status S] [--date YYYY-MM-DD]
pan-tools state apply --json '{"fields": {...}, "sections": {"Name": {"append": [...]} | {"set": "..."}}}'
```

`init` writes a fresh state.md from the template's sections and refuses over an existing one (`state_exists`) unless `--force` (a backup is kept; `--keep-context` carries the old context over): `{written, path, backup, kept_context}`. `section` appends to or sets one section, creating it when missing. `quick-task` adds one row to the Quick Tasks Completed table (`--raw`: the row number); its `--status`, when given, is one of `verified`, `partial`, `failed`, `needs review`, `gaps` or `done` in any case, else `invalid_status` with `allowed`. `apply` writes bold fields and sections in one write (`{written, updated[], failed[]}`). All but `init` need state.md (`state_missing`).

**Module:** `state-write.cjs`

---

## 3. Phase Operations

Commands for managing phase lifecycle — adding, inserting, removing, and completing phases.

### `phase next-decimal <phase>`

Calculate the number `phase insert` would give a phase inserted after `<phase>`. After an integer phase it is the next child (`5.1`, `5.2`, …); after a decimal such as `29.4` it is the next sibling (`29.5`), and `29.4.1` with `nested: true` only when `29.5` is taken. Numbers used by a phase directory or a roadmap heading are never reused.

```bash
pan-tools phase next-decimal 5 [--raw]
```

**JSON output:**
```json
{
  "found": true,
  "base_phase": "05",
  "next": "05.1",
  "nested": false,
  "existing": []
}
```

If decimals exist: `{ ..., "next": "05.3", "existing": ["05.1", "05.2"] }`.

**`--raw` output:** The next decimal (e.g., `05.1`).

---

### `phase add <description>`

Append a new phase to roadmap.md and create the corresponding directory on disk.

```bash
pan-tools phase add "API Integration Layer" [--raw]
```

**JSON output:**
```json
{
  "phase_number": 13,
  "padded": "13",
  "name": "API Integration Layer",
  "slug": "api-integration-layer",
  "directory": ".planning/phases/13-api-integration-layer"
}
```

**`--raw` output:** The padded phase number.

**Side effects:** Creates `.planning/phases/NN-slug/` (empty, no placeholder file), appends a new `### Phase N:` detail section to roadmap.md whose `**Depends on:**` names the highest-numbered phase in the roadmap (a decimal included), adds a `- [ ] **Phase N: <name>**` checklist entry when the roadmap has a checklist, and adds a Progress-table row (`0/0`, `Not started`) when the roadmap has a table with Plans and Status columns.

---

### `phase insert <after> <description>`

Insert a decimal phase after an existing phase. Creates the directory and updates roadmap.md.

The number comes from the phase directories and the roadmap's headings together. After an integer phase `N` it is the next free `N.k`. After a decimal such as `29.4` it is the next sibling, `29.5`, when no phase has that number; only when `29.5` exists does it nest (`29.4.1`), and the output says so with `nested: true`.

```bash
pan-tools phase insert 5 "Emergency Hotfix" [--raw]
```

**JSON output:**
```json
{
  "phase_number": "05.1",
  "after_phase": "5",
  "nested": false,
  "name": "Emergency Hotfix",
  "slug": "emergency-hotfix",
  "directory": ".planning/phases/05.1-emergency-hotfix"
}
```

**`--raw` output:** The decimal phase number (e.g., `05.1`).

**Side effects:** Creates the phase directory (empty, no placeholder file); inserts the `### Phase N.k: <name> (INSERTED)` section after the after-phase and its own decimals, with `**Depends on:**` naming the phase immediately before it (the after-phase's last decimal, else the after-phase, unpadded); adds the checklist entry, and a Progress-table row (`0/0`, `Not started`, the after-phase row's number format and Milestone cell) when the roadmap has a table with Plans and Status columns, so `roadmap update-plan-progress` finds it.

---

### `phase remove <phase> [--force] [--with-decimals]`

Remove a phase, delete its directory, and renumber all subsequent phases. Also updates roadmap.md and state.md. Removing a decimal phase renumbers its higher siblings (5.3 becomes 5.2).

An integer phase that still has decimal phases inserted after it is refused, with their numbers in the error, and nothing changes: removed alone, they would be left behind and read as decimals of the phase renumbered into its place.

```bash
pan-tools phase remove 7
pan-tools phase remove 5.2 --force         # Force removal even if summaries exist
pan-tools phase remove 5 --with-decimals   # Remove phase 5 and its 5.1, 5.2 …
```

**Arguments:**
- `<phase>` — Phase number to remove
- `--force` — Allow removal of phases with executed plans (summary.md files), the decimals included
- `--with-decimals` — Also remove the integer phase's decimal phases; the output lists them as `removed_decimals`

**JSON output:**
```json
{
  "removed": "7",
  "directory_deleted": "07-feature-name",
  "renamed_directories": [
    { "from": "08-next-feature", "to": "07-next-feature" }
  ],
  "renamed_files": [
    { "from": "08-01-plan.md", "to": "07-01-plan.md" }
  ],
  "roadmap_updated": true,
  "state_updated": true
}
```

**Warning:** Without `--force`, removal is blocked if the phase has any summary.md files (indicating completed work).

---

### `phase gate <phase> [--mode warn|enforce]`

Whether a phase may be marked complete (program V1). It prints `{phase, mode, ok, reasons[], facts, not_checked[]}` and exits 1 when it refuses (`--raw`: `pass` or `refuse`). Reason codes: `no_plans`, `missing_summary`, `no_verification`, `verification_unreadable`, `verification_failed` (a failed test gate under `passed` counts), `human_needed_unapproved` (approve a human item with `findings dispose <id> --as decision --reason "…"`), `verification_stale`, `reconcile_contradiction`, `test_failed`, `open_findings` (critical or high, any judge), `stubs_found` (in the files the phase committed), `integrity_violation` (`verify test-integrity`). `not_checked` lists what it could not check, never a refusal: a skipped or unrecorded test gate, an unknown freshness, no git, no plan commits, the verifier switched off. `--mode` overrides `workflow.phase_gate` for this call. The mode changes what `phase complete` does with a refusal, not the gate's own verdict: `phase gate` exits 1 and prints `refuse` on a refusal under `warn` too.

### `phase complete <phase> [--no-commit] [--force --reason "<why>"]`

Mark a phase as done. Updates roadmap.md checkboxes and progress table, advances state.md to the next phase (recounting its `**Progress:**` bar and the frontmatter `progress.*` keys it has), and updates requirements.md traceability. The plan count pairs each plan with its own summary; the progress row says `Complete` and the checkbox is ticked only when every plan has a summary, otherwise the row says `In Progress` (`roadmap_status` in the output), as it can after `--force` or a gate in `warn` mode.

**The phase gate runs first.** Under `workflow.phase_gate: enforce` (the default; a config without the key, or with any other value, reads as `enforce`) a refusal exits 1 with `{error: "phase_gate_refused", reason, gate}` and changes nothing. Under `warn` the phase is marked complete and the output carries `gate: {ok, mode, reasons, not_checked}`. `--force --reason "<why>"` completes past a refusal and records a `decision` disposition for every open finding the gate counted (output: `gate_override`); `--force` without `--reason` is refused in either mode.

```bash
pan-tools phase complete 5 [--no-commit]
# Auto-commits what it wrote (roadmap.md, requirements.md, state.md and the phase directory; no other planning file is staged)
# as "docs(NN): complete phase — <name>" and reports commit_hash. Anything you had already staged goes into the same commit.
# Skipped when --no-commit is passed, commit_docs is false, the planning tree is gitignored, or cwd is not a git repo.
```

**JSON output:**
```json
{
  "completed_phase": "5",
  "phase_name": "setup",
  "plans_executed": "3/3",
  "next_phase": "06",
  "next_phase_name": "api-layer",
  "is_last_phase": false,
  "date": "2026-02-27",
  "roadmap_updated": true,
  "state_updated": true,
  "gate": { "ok": true, "mode": "warn", "reasons": [], "not_checked": [] }
}
```

`roadmap_status` (`Complete` or `In Progress`), `commit_hash`, `gate_override` (`{reason, refused_by[], disposed[]}`: the `--reason` text, the refusal codes it overrode, and the findings it recorded a `decision` for), `roadmap_warning`, `requirements_warning` and `requirements_held` are added when they apply. `requirements_held` lists each requirement the completion left open, `{id, status}`: `on_hold` (its traceability Status says `Held`, `On hold`, `Deferred` or `Blocked`), `moved` (it says `Reopened` or `Moved` and its Phase cell names another phase, listed in `phases`), or the status of its mapped tests; a `not_checked` entry adds `not_checked: [{file, reason}]`, each test no command could run and why (set `workflow.test_file_command` with `{file}` or `{dir}`, or record a passing `test run --phase N`). A requirement reopened onto this phase is ticked even when the phase's roadmap line does not name it. `gate` is `{error}` when the gate itself could not run.

**Side effects:** Checks off the phase checkbox in roadmap.md, updates the progress table row, advances `Current Phase` in state.md, and marks the requirements on the phase's own `**Requirements:**` line complete in requirements.md (checkbox and traceability row), reading the phase's section or, in an older roadmap, the line under its checklist entry. Both padded and unpadded phase spellings tick the same lines (`phase complete 01` and `phase complete 1` are equivalent).

**When the tick cannot land** (roadmap unreadable, no checklist entry names the phase, or the write fails), the result carries a `roadmap_warning` string describing why and `roadmap_updated` is `false` — the completion is never silently unrecorded. A `requirements_warning` string appears when requirements.md exists but could not be written; `roadmap_updated` is unaffected by it.

---

## 4. Phase Listing

Commands for discovering phase directories and their contents.

### `phases list [--type plans|summaries] [--phase N] [--include-archived]`

List phase directories or files within phases.

```bash
pan-tools phases list [--raw]
pan-tools phases list --type plans --phase 5 [--raw]
pan-tools phases list --include-archived [--raw]
```

**Flags:**
- `--type plans|summaries` — List files of a specific type instead of directories
- `--phase N` — Filter to a specific phase
- `--include-archived` — Include phases from archived milestones

**JSON output (directories):**
```json
{ "directories": ["05-setup", "06-api-layer", "07-auth"], "count": 3 }
```

**JSON output (files):**
```json
{ "files": ["05-01-plan.md", "05-02-plan.md"], "count": 2, "phase_dir": "setup" }
```

`phase_dir` is the matched directory's name without its number, and `null` without `--phase`. A `--phase` that matches nothing exits 1 with `error: "Phase not found"`. With `--include-archived`, an archived entry reads `"<dir> [<milestone>]"`.

**`--raw` output:** Newline-separated list.

---

### `phase-plan-index <phase>`

Index all plans within a phase, grouped by wave, with completion status. Used by the execute-phase workflow to determine which plans to run and in what order.

```bash
pan-tools phase-plan-index 5
pan-tools phase-plan-index 5 --failed 05-01,05-02
```

**JSON output:**
```json
{
  "phase": "05",
  "plans": [
    {
      "id": "05-01",
      "wave": 1,
      "autonomous": true,
      "objective": "Set up database schema",
      "files_modified": ["src/db/schema.ts"],
      "depends_on": [],
      "task_count": 3,
      "has_summary": true,
      "sub_wave": 0
    }
  ],
  "waves": { "1": ["05-01", "05-02"], "2": ["05-03"] },
  "sub_waves": { "1": [["05-01", "05-02"]], "2": [["05-03"]] },
  "incomplete": ["05-03"],
  "has_checkpoints": false
}
```

A phase that is not found (or whose directory cannot be read) exits 1 with an `error` and empty `plans`.

**`--failed <ids>`** (comma-separated plan ids) adds `failed` and `blocked`. `blocked` is `[{id, blocked_by[]}]`: every unfinished plan whose `depends_on` reaches a failed plan, directly or through another blocked plan, with the failed plans behind it. A `depends_on` entry may be the full id (`05-01`) or the plan number (`01`). `/pan:exec-phase` uses it after a failed plan, so continuing never runs a plan whose dependency failed.

**Note:** Plans within the same wave can execute in parallel (via parallel agents). Plans in wave 2 depend on wave 1 completion. Within a wave, plans whose `files_modified` overlap land in different `sub_waves` entries (each plan's `sub_wave` is its index), so they never run at the same time; a plan that declares no files runs alone.

---

### `find-phase <phase>`

Find a phase directory by number. Searches `.planning/phases/` only; archived milestone phases are not consulted (use `phases list --include-archived` to see them).

```bash
pan-tools find-phase 5 [--raw]
pan-tools find-phase 12A.1 [--raw]
```

**JSON output:**
```json
{
  "found": true,
  "directory": ".planning/phases/05-setup",
  "phase_number": "05",
  "phase_name": "setup",
  "plans": ["05-01-plan.md", "05-02-plan.md"],
  "summaries": ["05-01-summary.md"],
  "incomplete_plans": ["05-02-plan.md"]
}
```

Plan and summary files match in any case (an older layout wrote `-PLAN.md`). `incomplete_plans` lists the plans with no summary of their own: a summary with no plan, such as a research summary, finishes nothing. The workflows route on it instead of counting files.

**`--raw` output:** The directory path (e.g., `.planning/phases/05-setup`) or empty string if not found.

---

## 5. Roadmap Operations

Commands for reading and updating roadmap.md — the project phase plan.

### `roadmap get-phase <phase>`

Extract a phase section from roadmap.md. The number matches padded or not: `5` and `05` (the padded `phase_number` `init` returns) both find `### Phase 5:`.

```bash
pan-tools roadmap get-phase 5 [--raw]
```

**JSON output:**
```json
{
  "found": true,
  "phase_number": "5",
  "phase_name": "Database Setup",
  "goal": "Establish schema and migrations",
  "success_criteria": ["All tables created", "Seed data loaded"],
  "section": "### Phase 5: Database Setup\n\n**Goal:** ..."
}
```

**`--raw` output:** The full markdown section text.

`phase_number` echoes the argument as given. A phase not in the roadmap returns `{found: false, phase_number}` (exit 0); a phase listed in the checklist with no `### Phase N:` section exits 1 with `error: "malformed_roadmap"`; a missing roadmap.md exits 1.

**A compacted phase** (one `roadmap compact` moved out) leaves a stub in roadmap.md. For it, `get-phase` returns the full section and its success criteria from `roadmap-history.md`, and adds `"compacted": true`, `"history_path"` and `"history_found"`. If the history file is gone, you get the stub's goal and `"history_found": false`. `roadmap slice` and `report phase` read a compacted phase the same way.

---

### `roadmap analyze`

Full roadmap parse with on-disk status for every phase. This is the most comprehensive view of project progress.

```bash
pan-tools roadmap analyze
```

**JSON output:**
```json
{
  "milestones": [{ "heading": "v1.0 Core Platform", "version": "v1.0" }],
  "phases": [
    {
      "number": "5",
      "name": "Database Setup",
      "goal": "Establish schema",
      "depends_on": "Phase 4",
      "plan_count": 3,
      "summary_count": 3,
      "has_context": true,
      "has_research": false,
      "disk_status": "complete",
      "roadmap_complete": true
    }
  ],
  "phase_count": 12,
  "completed_phases": 4,
  "total_plans": 30,
  "total_summaries": 18,
  "progress_percent": 60,
  "current_phase": "5",
  "next_phase": "6",
  "missing_phase_details": null
}
```

**Disk status values:** `no_directory`, `empty`, `discussed`, `researched`, `planned`, `partial`, `complete`.

---

### `roadmap update-plan-progress <phase>`

Update the progress table row and the `**Plans:**` count in roadmap.md for a specific phase from its plans paired with their own summaries, a summary with no plan counting for nothing (the number matches padded or not), and it ticks each plan's own checkbox whose summary exists. Status is `Planned`, `In Progress`, or `Executed` once every plan has a summary. **It does not complete the phase:** before 3.42.2 a fully executed phase was ticked `(completed DATE)` and dated here, before it was verified. Only `phase complete`, past the phase gate, ticks the phase checkbox and writes the date; a phase it already ticked stays `Complete` with its own date.

The table cells are found **by header name**: the row whose first cell names the phase, in a table whose header has a Plans column and a Status column, gets those two cells (and a Completed column's date) rewritten; every other cell is left as it was. A table without Plans and Status columns is not touched — the output says `table_updated: false` with the reason in `table_reason`. The `**Plans:**` line is rewritten only inside the phase's own section, never the next phase's.

```bash
pan-tools roadmap update-plan-progress 5 [--raw]
```

**JSON output:**
```json
{
  "updated": true,
  "phase": "5",
  "plan_count": 3,
  "summary_count": 3,
  "status": "Executed",
  "complete": false,
  "all_plans_executed": true,
  "next": "verify the phase; `phase complete` ticks it and dates it",
  "table_updated": true
}
```

`complete` is true only for a phase `phase complete` already ticked. **`--raw` output:** `3/3 Executed` (plus ` (progress table not updated)` when no table row was rewritten).

---

### `roadmap slice <phase> [--write]`

The slice is what work on one phase needs from roadmap.md and requirements.md:
- **Every phase:** one line each, taken from the roadmap's checklist (any box mark), with this phase marked.
- **This phase:** its section.
- **Dependencies:** the goals of the phases it depends on.
- **Its requirements:** the requirement lines it names, with their detail lines and their traceability rows under the table header.

plan-phase (its `--research-only` form too), discuss-phase, exec-phase, verify-phase and the phase transition write it. The researcher, planner, plan checker, executors and verifier read it in place of the whole files, which a long project otherwise re-reads on every turn of every spawn. On a 54-phase field project that was ~146k tokens down to ~3k. Plans name the slice in their `<context>`; an executor given an older plan that names `@.planning/roadmap.md` reads the slice instead.

Requirement ids are taken by shape — a `CAT-01`-style token anywhere on the `**Requirements**:` line, or a comma-separated item that is a single token carrying a digit. So a line written as prose still yields its ids.

```bash
pan-tools roadmap slice 5            # the slice and its sizes
pan-tools roadmap slice 5 --write    # write <phase dir>/05-roadmap-slice.md
```

**JSON output:**
```json
{
  "found": true,
  "phase_number": "5",
  "phase_name": "Payments",
  "requirement_ids": ["PAY-01", "PAY-02"],
  "missing_requirement_ids": [],
  "depends_on": ["4"],
  "tokens": 812,
  "whole_tokens": 9650,
  "smaller_pct": 92,
  "content": "# Roadmap slice — Phase 5: Payments\n…"
}
```

**With `--write`:**
- Drops `content` and adds `written`, plus `changed` and `path` when it wrote; with no phase directory yet it is `written: false` with a `reason`.
- `--raw` prints the path. It prints nothing when nothing was written (no phase directory yet), and the workflows then fall back to the whole files.
- A run that would produce the same slice does not rewrite the file, and a CRLF checkout of it keeps CRLF.

**Not found:** `{found: false, phase_number}` (exit 0) when roadmap.md has no section for the phase; a missing roadmap.md exits 1. Without `--write`, `--raw` prints the slice markdown.

---

### `roadmap compact [--apply] [--keep N]`

Moves shipped phases' detail out of roadmap.md into `roadmap-history.md`, the way `state compact` bounds state.md. A roadmap only ever grows; one 54-phase field project's reached 476 KB.

**What moves:** a phase whose checklist line is ticked, unless it is the current phase in state.md or one of the `--keep` most recently shipped phases (default 2). The current phase never takes one of those slots.

**What stays:** a stub with the heading, the `**Goal**`, `**Depends on**` and `**Requirements**` lines and any `<!-- model_tier: … -->` override, plus a pointer to the history. `roadmap analyze` and the dependency goals in a `roadmap slice` read the stub as before. Readers that need the rest (`roadmap get-phase`, `report phase`, a slice of that phase) find the stub and read the full section from the history.

**Safety:**
- **Nothing is lost.** The history is written before roadmap.md, so an interrupted run can duplicate a section but never lose one.
- **No double moves.** A section already compacted is never compacted again.
- **No growth.** A compaction that would not shrink the file is declined.
- **Boundaries hold.** A section ends at the next phase heading, the next heading at its level or above, or a `<details>` boundary, so a trailing progress table or a milestone's `</details>` stays where it is.
- **Line endings are kept.** The file is parsed on LF and written back in its own ending.

Dry run by default. `hygiene scan` offers it as the `compact-roadmap` fix when roadmap.md is over the per-file cached-context size (`CACHE_FILE_WARN_TOKENS`, about 6k tokens) and there is something to move, and `hygiene clean --apply` runs it.

```bash
pan-tools roadmap compact                # what would move
pan-tools roadmap compact --apply        # move it
pan-tools roadmap compact --apply --keep 0
```

**JSON output (abridged):**
```json
{
  "found": true,
  "history_path": ".planning/roadmap-history.md",
  "keep": 2,
  "current_phase": "5",
  "archivable": [{ "phase": "1", "title": "Base", "bytes": 1412, "archive": true, "reason": "shipped" }],
  "tokens_before": 120951,
  "tokens_after": 38683,
  "applied": false,
  "dry_run": true
}
```

---

## 6. Requirements Operations

### `requirements mark-complete <ids>`

Mark requirement IDs as complete in requirements.md (updates checkboxes and traceability table).

```bash
pan-tools requirements mark-complete REQ-01,REQ-02
pan-tools requirements mark-complete REQ-01 REQ-02
pan-tools requirements mark-complete "[REQ-01, REQ-02]"
```

**Accepts:** Comma-separated, space-separated, or bracket-wrapped formats.

**JSON output:**
```json
{
  "updated": true,
  "marked_complete": ["REQ-01", "REQ-02"],
  "not_found": [],
  "total": 2,
  "table_updated": true,
  "table_marked": ["REQ-01", "REQ-02"]
}
```

**`--raw` output:** `2/2 requirements marked complete`. An id that is already complete has nothing left to tick and is listed under `not_found` too (`updated: false` when no id changed).

The traceability table is read by its header: the ID column is the one headed `ID`, `Req`, `Requirement` or `Requirement ID` (else the first), and the status cell is the one under `Status` (any case), wherever it sits, in every table that lists the id. Any value other than a done word (`Complete`, `Done`, …) becomes `Complete`, keeping the cell's padding. `updated` says whether anything changed (a checkbox or a row); `table_updated` and `table_marked` say whether, and for which ids, a table row changed. `warnings` (present only when there are any) names an id whose table has no `Status` column (the table is left unchanged) and an id with a checkbox but no table row.

An id whose traceability Status says `Held` (or `On hold`, `Deferred`, `Blocked`) is not ticked: it is listed under `held` as `{id, status}`, because the executor calls this command after every plan and a plan listing the id does not overturn the ruling. `--release` ticks it anyway; that is how a hold is lifted.

### `requirements reopen <ids> --reason "<why>" [--phase N] [--hold]`

Untick a requirement and record why, in the checkbox and the traceability table together.

```bash
pan-tools requirements reopen NDSB-05 --phase 7 --reason "needs production data"
pan-tools requirements reopen CIDBT-02 --hold --reason "client ruling: stays open this milestone"
```

- The checkbox goes back to `[ ]`.
- The traceability Status becomes `Reopened: <why>` (`Held: <why>` with `--hold`). A pipe in the reason is written as `/` so the table stays a table.
- With `--phase N`, the Phase cell names phase N, and phase N's `**Requirements:**` line in roadmap.md gets the id if it lacks it (so its planner sees it). The line of the phase it came from is history and is not changed.

`--reason` is required; without it nothing is written. What the ruling then does:

| Status | `phase complete` of its old phase | `phase complete` of phase N | `requirements mark-complete` | `validate health --repair` |
|---|---|---|---|---|
| `Reopened` with `--phase N` | leaves it open (`moved`) | ticks it | ticks it | leaves it open |
| `Reopened` without `--phase` | ticks it again | — | ticks it | ticks it |
| `Held` | leaves it open (`on_hold`) | leaves it open | only with `--release` | leaves it open |

A Phase cell naming a range (`Phase 3-5`) is never read as a move. Writing these Status values by hand has the same effect.

**JSON output:** `{updated, reopened[], held, status, phase, unchecked[], table_updated[], roadmap_updated[], not_found[], warnings?}`. An id with neither a checkbox nor a table row is listed under `not_found`; when no id was found, `error: "requirement_not_found"` and exit `1`. `warnings` names an id with no table row or no `Status` column (its ruling cannot be recorded, so `phase complete` may tick it again) and a `--phase` with no section or no `**Requirements:**` line in roadmap.md.

---

## 7. Milestone Operations

### `milestone complete <version> [--name <name>] [--archive-phases] [--no-commit]`

Archive a milestone: gathers stats, copies roadmap.md and requirements.md into `milestones/` (the originals stay), creates/appends milestones.md, and marks the milestone complete in state.md. Auto-commits `.planning/` and creates the git tag `milestone-<version>` (payload `commit_hash`, `tag`) unless `--no-commit` is passed, `commit_docs` is false, the planning tree is gitignored, or cwd is not a git repo.

```bash
pan-tools milestone complete v1.0 --name "Core Platform" --archive-phases
```

**Arguments:**
- `<version>` — Milestone version (e.g., `v1.0`)
- `--name <name>` — Human-readable milestone name (multi-word supported)
- `--archive-phases` — Move phase directories to `milestones/vX.Y-phases/`
- `--no-commit` — Skip the auto-commit and the tag

`name` defaults to the version when `--name` is not given.

**JSON output:**
```json
{
  "version": "v1.0",
  "name": "Core Platform",
  "date": "2026-02-27",
  "phases": 12,
  "plans": 30,
  "tasks": 85,
  "accomplishments": ["Built auth module", "Created API layer"],
  "archived": {
    "roadmap": true,
    "requirements": true,
    "audit": false,
    "phases": true
  },
  "milestones_updated": true,
  "state_updated": true
}
```

**Side effects:** Creates `milestones/` directory, copies roadmap.md and requirements.md there with a version prefix (the requirements copy gets an archive header), optionally moves phase dirs, moves `<version>-milestone-audit.md` into the archive when present (`archived.audit`), sets state.md's `Status` to `<version> milestone complete` and updates `Last Activity` and `Last Activity Description` (nothing else in the body changes; the front matter's position keys and `milestone`/`milestone_name` are patched in place (comments and unknown keys kept), and a front matter is written only if missing); archive failures are reported in `archive_warnings[]`.

---

## 8. Validation

Commands for checking project health and consistency.

### `validate consistency`

**Exit code:** always `0` — `passed: false` is a verdict, not an error-family key; gate on `passed`.

Check phase numbering, disk/roadmap synchronization, plan numbering gaps, and orphaned summaries.

```bash
pan-tools validate consistency [--raw]
```

**JSON output:**
```json
{
  "passed": true,
  "errors": [],
  "warnings": [
    "Gap in phase numbering: 5 → 7",
    "Phase 3 in roadmap.md but no directory on disk"
  ],
  "warning_count": 2
}
```

**`--raw` output:** `passed` or `failed`.

---

### `validate health [--repair [--only <class>,...]] [--standards] [--full] [--drift] [--links]`

Comprehensive `.planning/` integrity check. Validates project.md, roadmap.md, state.md, config.json, phase directory naming, and orphaned plans. With `--standards`, also checks standards compliance. With `--drift`, runs convention drift analysis. With `--links`, attaches a doc-code link-graph summary (ADR-0027).

```bash
pan-tools validate health
pan-tools validate health --repair
pan-tools validate health --standards
pan-tools validate health --full
pan-tools validate health --drift
pan-tools validate health --links
```

**Flags:**
- `--repair` — Attempt automatic repairs: create/reset config.json, regenerate a **missing** state.md (E004; an existing state.md is never rewritten, and `regenerateState` on one is reported `skipped`), recount state.md's `progress.*` front-matter keys for `STATE_PROGRESS_IMPOSSIBLE` (`recountProgress`; nothing else in the file changes), and tick requirement/plan checkboxes for `STATE_REQ_DRIFT`/`STATE_ROADMAP_DRIFT` (`syncRequirements`/`syncRoadmap`; never a requirement whose Status says `Held`, or `Reopened` onto another phase). The `status`, the issue lists and the exit code describe the tree as it was before the repairs ran; run `validate health` again to see the result.
- `--standards` — Include standards compliance check (reads standards.md, reports per-standard coverage)
- `--full` — Run tests and build checks (slower, includes test_status and build_status)
- `--drift` — Run convention drift analysis (includes drift_status with score and violations)
- `--links` — Attach `link_graph` summary (ADR-0027). Errors degrade health to a `LINKS_ERR` warning (advisory, non-blocking). Run `pan-tools links validate` standalone for the full finding list.
- `--only <class>,...` — With `--repair`, run only the named repair classes (`regenerateState`, `createConfig`, `resetConfig`, `recountProgress`, `syncRequirements`, `syncRoadmap`); the result lists the available classes as `repairs_available`.

**Exit code:** `1` when `status` is `broken` (a missing `.planning/` included), `0` for `healthy` and `degraded` — warnings are not failures. This is a verdict command: it sets the code explicitly instead of deriving it from an `error` key (see "Error Shape" above), so gate on the exit code, not on `errors.length`.

**JSON output:**
```json
{
  "status": "broken",
  "errors": [
    { "code": "E004", "message": "state.md not found", "fix": "Run /pan:health --repair to regenerate", "repairable": true }
  ],
  "warnings": [
    { "code": "W003", "message": "config.json not found", "fix": "Run /pan:health --repair to create with defaults", "repairable": true }
  ],
  "info": [
    { "code": "I001", "message": "05-setup/05-03-plan.md has no summary.md", "fix": "May be in progress", "repairable": false }
  ],
  "repairable_count": 2,
  "repairs_performed": [
    { "action": "regenerateState", "success": true, "path": "state.md" },
    { "action": "createConfig", "success": true, "path": "config.json" }
  ]
}
```

**Status values:** `healthy`, `degraded`, `broken`. `--raw` prints the same JSON.

**Error/warning codes:**

| Code | Severity | Description | Repairable |
|------|----------|-------------|------------|
| E001 | error | `.planning/` directory not found | No |
| E002 | error | `project.md` not found (phase-model projects only — a focus-model tree reports I003 instead) | No |
| E003 | error | `roadmap.md` not found (phase-model projects only — a focus-model tree reports I003 instead) | No |
| E004 | error | `state.md` not found (phase-model projects only — a focus-model tree reports I003 instead) | Yes |
| E005 | error | `config.json` JSON parse error | Yes |
| E006 | error | `.planning/` belongs to another tool (gsd-core markers found); PAN stops before E002–E005 and `--repair` writes nothing. A tool that shares the tree instead reports I004 | No |
| W001 | warning | `project.md` missing required section | No |
| W002 | warning | `state.md` references a phase found neither under `phases/` nor in a milestone archive (`milestones/v*-phases/`); phase numbers compare normalized (`05.1` = `5.1`) | No |
| W003 | warning | `config.json` not found | Yes |
| W004 | warning | `config.json` invalid `model_profile` value | No |
| W005 | warning | Phase directory naming doesn't match `NN-name` format | No |
| W006 | warning | Phase in ROADMAP at or behind the current phase, but no directory on disk (a shipped milestone's phase reports as I009) | No |
| W007 | warning | Phase on disk but not in ROADMAP | No |
| I001 | info | Plan without SUMMARY (may be in progress) | No |
| I002 | info | Phase in ROADMAP ahead of the current phase, not planned yet | No |
| I003 | info | The tree runs the focus model or an orchestration campaign, so the phase-model checks (E002–E004, W001, W002, W005–W007, I001, I002, the state-consistency and verification gates) do not apply | No |
| I004 | info | Another tool shares the planning tree (planning-with-files markers: `.active_plan`, `.attestation`, `ledger-*.jsonl`, a dated task directory holding `task_plan.md`, or two of its directories such as `sessions/`). PAN leaves its files alone and keeps checking its own | No |
| I005 | info | The planning tree is ignored by git while `commit_docs` is true, so planning commits commit nothing. planning-with-files adds `.planning/` to `.gitignore` by default. Fix: remove the entry, or set `commit_docs` to false | No |
| I006 | info | `config.json` holds keys PAN does not read, usually a typo. The fix names the nearest known key. A key starting with lowercase `x-` is your own metadata and is never reported. Fix: correct the spelling or remove the key | No |
| I007 | info | `config.json` stores the pre-3.42 default `commit.sensitive_patterns` (bare words such as `secret` and `token` anywhere in a path). PAN already reads it as today's basename defaults. Fix: remove the key, or replace it with your own list | No |
| I008 | info | Phases of shipped milestones that have no verification record, in one line. A phase belongs to a shipped milestone when a line names the version, a shipped marker (✅, shipped, complete) and its phase range (`- ✅ **v1.0 MVP** - Phases 1-4`), or when its heading sits in that milestone's section or collapsed `<details>` block; a line with an open marker (🚧, in progress, planned) is not shipped | No |
| I009 | info | Phases of shipped milestones listed in the roadmap with no directory, in one line (W006 for the rest). A folder under `milestones/vX-phases/` counts as on disk | No |
| STATE_PROGRESS_IMPOSSIBLE | warning | `state.md`'s progress counts a completed number above its total (`completed_phases` > `total_phases` or `completed_plans` > `total_plans`), as an older writer left them | Yes |
| STATE_REQ_DRIFT | warning | `state.md` shows all plans complete but `requirements.md` has unchecked boxes (a requirement held or reopened in its traceability Status is not counted) | Yes |
| STATE_ROADMAP_DRIFT | warning | `state.md` shows all plans complete but `roadmap.md` has unchecked plan boxes | Yes |
| VERIFICATION_GATE_MISSING | warning | Phase has completed plans but no verification record (verifier enabled). A phase of a shipped milestone reports as I008 instead | No |

Codes emitted only under the corresponding flag:

| Code | Severity | Flag | Description | Repairable |
|------|----------|------|-------------|------------|
| TESTS_FAIL | error | `--full` | Test run exited non-zero | No |
| BUILD_FAIL | error | `--full` | Build exited non-zero | No |
| DRIFT_HIGH | warning | `--drift` | Convention drift verdict is `high` | No |
| DRIFT_MEDIUM | info | `--drift` | Convention drift verdict is `medium` | No |
| LINKS_ERR | warning | `--links` | Link graph has broken refs or uncovered backlink contracts | No |
| STD-000 | info | `--standards` | No `standards.md` found — no standards selected | No |
| STD-001 | info | `--standards` | `standards.md` exists but contains no recognized standards | No |
| STD-*id* | warning / info | `--standards` | Per-standard coverage (warning at 0% verified, otherwise info) | No |
| STD-SUMMARY | info | `--standards` | Overall coverage across selected standards | No |

Both tables are exhaustive: every code `validate health` can emit is listed above, and
`tests/verify-health-codes.test.cjs` fails if a new code is added to the implementation
without a row here.

### `validate deployment`

Validates PAN installations in the current directory. Detects all installed runtimes (by checking for `pan-file-manifest.json`), then for each runtime validates: manifest file hashes match on-disk files, settings integrity, hook path resolution, and the **MCP server registration** the installer wrote.

```bash
pan-tools validate deployment [--raw]
```

**JSON output** — transcribed from a real run, not hand-written:
```json
{
  "status": "clean",
  "runtimes_found": 1,
  "runtimes": {
    "claude": {
      "status": "clean",
      "version": "3.26.0-rc.2",
      "total_files": 322,
      "missing": [],
      "modified": [],
      "orphaned": [],
      "settings_ok": true,
      "settings_issues": [],
      "mcp": {
        "ok": true,
        "registered": true,
        "path": ".mcp.json",
        "server": "…/pan-wizard-core/mcp/server.cjs",
        "issues": []
      }
    }
  }
}
```

> **`runtimes` is an OBJECT keyed by runtime name, not an array.** This block previously
> showed an array with a `runtime` field inside each entry — a shape the code has never
> emitted. Read it with `result.runtimes.claude`, not `result.runtimes[0]`.

**Status values:** `clean` (all files match), `modified` (hash mismatch, or an MCP registration problem), `broken` (files missing). **Exit code:** `0` whatever the `status` (gate on `status`); `1` only when no PAN install is found here (`{"error": "No PAN installations found in this directory"}`).

**The `mcp` block** reports the registration for runtimes PAN registers (`claude`, `copilot`, `gemini`, `opencode`). It distinguishes five failures that used to be indistinguishable — all previously reported `clean`:

| `mcp.issues[0]` names | Meaning |
|---|---|
| *missing* | the config file was never written — registration did not happen |
| *no "pan" entry* | the config parses but carries no `pan` registration under the runtime's container key |
| *names no server path* | a `pan` entry exists but has no `args[0]` / `command[1]` to check |
| *unreadable* | the file exists but is not valid JSON, so PAN deliberately left it untouched |
| *does not exist* | a `pan` entry is registered but its server path resolves to nothing |

`mcp.skipped` appears instead of an error in two legitimate cases: `no-registration-by-design` (Codex — its MCP config is TOML, which PAN prints rather than merges) and `bridge-not-in-this-install` (a deployment made before the bridge shipped, which correctly has nothing to verify).

---

## 9. Verification Suite

Commands for verifying plan structure, phase completeness, file references, git commits, and build artifacts. Used by the pan-verifier and pan-plan-checker agents.

**Exit code:** these verdict commands exit `0` whether the verdict passes or fails (exit `1` comes only from an unreadable input — `File not found` for `plan-structure`/`references`/`artifacts`/`key-links`, `Phase not found` or an unreadable phase directory for `phase-completeness` — and from usage errors; `verify-summary` reports a missing summary as `passed: false` at exit `0`) — gate on each command's verdict field, not the exit code: `passed` (`verify-summary`), `valid` (`plan-structure`, `references`), `complete` (`phase-completeness`), `all_valid` (`commits`, whose `valid` is the list of hashes found), `all_passed` (`artifacts`), `all_verified` (`key-links`). `verify reconcile` and `verify stubs --gate` are the exceptions and set the code explicitly; `verify scope` and `verify stale` exit `1` for a missing or unknown phase. The checks from `verify plan-set` on set their exit code from the verdict, as each entry below says.

### `verify-summary <path> [--check-count N]`

Verify a summary.md file: checks existence, spot-checks the first `--check-count` file paths containing a `/` that it mentions (backticked paths first, then the path after `Created:`, `Modified:`, `Added:`, `Updated:` or `Edited:`, in any case — so the summary template's inline `key-files` list, `created: [src/a.ts]`, is read as `[src/a.ts` and reported missing), checks that a commit hash it mentions exists (the first three are tried), and looks for self-check section status. `passed` fails on a missing summary, a missing referenced file or a failed self-check; a commit not in git history is listed in `errors` but does not fail `passed`.

```bash
pan-tools verify-summary .planning/phases/05-setup/05-01-summary.md [--raw]
pan-tools verify-summary path/to/summary.md --check-count 5
```

**Arguments:**
- `<path>` — Relative path to the summary.md file
- `--check-count N` — Number of referenced files to spot-check (default: 2; `0` and non-numeric values fall back to 2, others are clamped to 1–20)

**JSON output:**
```json
{
  "passed": true,
  "checks": {
    "summary_exists": true,
    "files_created": { "checked": 2, "found": 2, "missing": [] },
    "commits_exist": true,
    "self_check": "passed"
  },
  "errors": []
}
```

**`--raw` output:** `passed` or `failed`.

---

### `verify plan-structure <file>`

Check a plan.md file for required frontmatter fields and valid `<task>` element structure.

```bash
pan-tools verify plan-structure .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "valid": true,
  "errors": [],
  "warnings": ["Task 'setup' missing <verify>"],
  "task_count": 3,
  "tasks": [
    { "name": "setup", "type": "auto", "hasFiles": true, "hasAction": true, "hasVerify": false, "hasDone": true },
    { "name": "Select session storage", "type": "checkpoint:decision", "auto_select": "cookie" }
  ],
  "frontmatter_fields": ["phase", "plan", "type", "wave", "depends_on", "files_modified", "autonomous", "must_haves"]
}
```

**Required frontmatter:** `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous`, `must_haves`.

**Tasks.** An auto task needs `<name>` and `<action>` (errors) and should have `<verify>`, `<done>` and `<files>` (warnings). A checkpoint is checked against its own shape instead: `checkpoint:human-verify` needs `<what-built>` and `<how-to-verify>`, `checkpoint:decision` needs `<decision>` and `<options>` with at least one `<option id="…">`, and `checkpoint:human-action` needs `<action>`. A decision's optional `auto_select` must name one of its option ids (error), and a decision without it is a warning, because auto mode stops there for a human (market item M22). A fenced code block of more than 20 lines in an auto task's `<action>` is a warning: a plan records decisions, not implementation (M32). A plan with checkpoint tasks must set `autonomous: false` (error). A plan in wave 2 or later with an empty `depends_on` gets a warning, and so does a plan with no `<task>` element. A plan that looks cut off (a `<tasks>`, `<task>`, `<name>`, `<files>`, `<action>`, `<verify>` or `<done>` still open at the end of the file, or a continuation marker such as `[truncated]`) is an error, checked first (M47).

**`--raw` output:** `valid` or `invalid`.

---

### `verify phase-completeness <phase>`

Check that all plans in a phase have corresponding summaries.

```bash
pan-tools verify phase-completeness 5 [--raw]
```

**JSON output:**
```json
{
  "complete": true,
  "phase": "05",
  "plan_count": 3,
  "summary_count": 3,
  "incomplete_plans": [],
  "orphan_summaries": [],
  "errors": [],
  "warnings": []
}
```

**`--raw` output:** `complete` or `incomplete`.

---

### `verify references <file>`

Check that `@`-references and backtick file paths in a document resolve to existing files.

```bash
pan-tools verify references .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "valid": true,
  "found": 5,
  "missing": [],
  "total": 5
}
```

**`--raw` output:** `valid` or `invalid`.

---

### `verify commits <hash1> [hash2] ...`

Batch verify that commit hashes exist in the git history.

```bash
pan-tools verify commits abc1234 def5678 ghi9012 [--raw]
```

**JSON output:**
```json
{
  "all_valid": true,
  "valid": ["abc1234", "def5678", "ghi9012"],
  "invalid": [],
  "total": 3
}
```

**`--raw` output:** `valid` or `invalid`.

---

### `verify artifacts <plan-file>`

Check that `must_haves.artifacts` from a plan.md frontmatter exist on disk and meet specified criteria (min_lines, contains, exports).

```bash
pan-tools verify artifacts .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "all_passed": true,
  "passed": 2,
  "total": 2,
  "artifacts": [
    { "path": "src/db/schema.ts", "exists": true, "issues": [], "passed": true }
  ],
  "unchecked": 0
}
```

**`--raw` output:** `valid` or `invalid`. Both exit 0; callers read `all_passed`. A plan with no `must_haves.artifacts` returns an `error` but exits 0; a missing plan file exits 1.

A `path` written as prose rather than a file (no `/` or `\`, no extension, or spaces without a separator: "the settings page") is not read: its entry has `passed: null` and `skipped: "prose — not a file"`, and it counts in `unchecked`, not in `passed` or `total`.

---

### `verify key-links <plan-file>`

Check that `must_haves.key_links` from a plan.md frontmatter are satisfied (source references target, or pattern matches).

```bash
pan-tools verify key-links .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "all_verified": true,
  "verified": 2,
  "total": 2,
  "links": [
    { "from": "src/index.ts", "to": "src/db/schema.ts", "via": "import", "verified": true, "detail": "Pattern found in source" }
  ],
  "unchecked": 0
}
```

**`--raw` output:** `valid` or `invalid`.

A link whose `from` is prose ("the checkout flow"), or whose `to` is prose when it has no `pattern`, is not checked: `verified: null`, `skipped: "prose — not a file"`, counted in `unchecked` and left out of `verified` and `total`. A `from` that is a path and does not exist still fails with `Source file not found`. With a `pattern` and a prose `to`, only the source is searched.

---

### `verify reconcile <phase>`

Cross-check a phase's recorded verification against the mechanical checks of every plan's `must_haves`, so a verification.md whose `status` claims a pass while an artifact substance check fails or a key link is unwired is caught (each artifact and link in the result names its `plan`). It also reports a `test_gate` in verification.md that disagrees with the engine's test run (`test run`), a passing status over a failed run, and, under `workflow.mutation_gate: gate`, a passing status over a failed mutation gate. Exits `1` on a contradiction (and the phase gate refuses with `reconcile_contradiction`) and `0` otherwise. Nothing to reconcile is not a pass: an unknown phase reports `error: "phase_not_found"` and a phase with no verification.md `error: "verification_missing"`, both `reconciled: false` at exit `1`; under `workflow.verifier: false` a phase without one reports `reconciled: true` with `skipped: "verifier_off"`. A phase with no `must_haves` reports `reconciled: true` with a `note`. Prose artifacts and links (see `verify key-links`) are counted in `unchecked`, not as failures.

```bash
pan-tools verify reconcile 5 [--raw]
```

**`--raw` output:** `valid` or `invalid`.

---

### `verify scope <phase>`

The files a phase changed that none of its plans declared: the mechanical half of the verifier's unrequested-work check (market item M11).
- **Changed:** the files the phase's plan commits touched (subjects of the form `{type}({phase}-{plan}):`, with or without zero padding, no merges, read from a bounded window of recent history — `COMMIT_SCAN_LIMIT` in `verify-scope.cjs`), plus the summaries' `key-files`.
- **Declared:** the union of the plans' `files_modified`; a declared directory ends in `/`.
- **Excluded:** the planning tree, lockfiles, and PAN's own runtime directories, each listed in `excluded[]` with a reason.

A test for a declared file carries `hint: test_for_declared`. The verifier judges the candidates and records the real ones as `unrequested:` in verification.md.

```bash
pan-tools verify scope 3          # {phase, directory, declared[], changed[], candidates[{path, hint, sources}], excluded[], git, commits}
pan-tools verify scope 3 --raw    # the candidate count
```

Works without git (summaries only; `git: false`). Exits 1 without a phase or for an unknown one.

### `verify stale <phase>`

Whether a phase's verification still describes the code (market item M27). The verifier records the commit it checked as `verified_commit` in verification.md. Any file the phase covers that changed since that commit makes the verification stale, whether the change is committed or not. The covered files are the plans' `files_modified` and the summaries' `key-files`, minus the planning tree, lockfiles and PAN's runtime directories.

```bash
pan-tools verify stale 3          # {phase, state, verified_commit, verification, changed_since[], reason?}
pan-tools verify stale 3 --raw    # fresh | stale | unverified | unknown
```

`state` is `fresh`, `stale`, `unverified` (no verification file) or `unknown`. `unknown` comes with a `reason`: the verification records no `verified_commit`, the commit is no longer in the repository (rebased or squashed), the phase declares no files, or git is unavailable. `progress json` adds `verification` to each verified phase (and `changed_since_verification` when it is stale), and `progress table` marks a stale phase `Complete (verification stale)`. Exits 1 without a phase or for an unknown one.

### `verify refresh <phase> --reason "<what changed>"`

Move a stale verification to HEAD when nothing but comments changed since its `verified_commit` (field report on 3.42.1: a one-word comment fix made the phase gate refuse, and the only way past was editing `verified_commit` by hand). It reads `git diff -U0` from the verified commit to HEAD over the files `verify stale` lists. In each hunk, the code left on the removed lines, once comments and blank lines are cut away, must equal the code left on the added lines. On success it writes `verified_commit: <HEAD>`, `refreshed_from: <old sha>` and `refresh_reason` into the verification's front matter and logs a `verification_refreshed` decision to the trace.

```bash
pan-tools verify refresh 3 --reason "typo in a comment"   # {phase, refreshed: true, verification, refreshed_from, verified_commit, files[], reason}
pan-tools verify refresh 3 --reason "…" --raw             # refreshed | fresh | code_changed | uncommitted_changes | …
```

Comments are known by file type: `//` and `/* … */` (JavaScript, TypeScript, Go, Java, C, C++, C#, Rust, Kotlin, Swift, Scala, Dart, PHP, …), `#` (Python, shell, Ruby, Perl, R, PowerShell, YAML, TOML, Terraform, Makefile, Dockerfile, …), `--` (SQL, Lua, Haskell), `;` (ini, Lisp), `%` (TeX, Erlang). A token counts at the start of a line or after whitespace, so `http://` is code; a `#` or `//` inside a string after a space reads as a comment, which is why the reason is required and recorded. Refusals, each with an `error` key and nothing written: `reason_required`, `phase_not_found`, `verification_unverified` or `verification_unknown` (nothing to refresh), `uncommitted_changes` (commit the edit first, `files` lists them), `code_changed` (`code_changes: [{file, reason}]`: a changed line of code, a file type with no known comment syntax, or an added, deleted, renamed, binary or mode-changed file; re-verify with `/pan:verify-phase`). A verification that is already fresh returns `refreshed: false`.

### `verify plan-set <phase>`

The checks a plan set has to pass that code can make (program V7). `/pan:plan-phase` runs it before spawning the plan checker, and also when the checker is skipped (`--skip-verify`, `workflow.plan_check` off), and sends its errors straight back to the planner.

```bash
pan-tools verify plan-set 3          # {phase, ok, errors[], warnings[], plans, plans_sha, plan_check, drift[]}
pan-tools verify plan-set 3 --raw    # valid | invalid
```

**Errors** (exit 1): `uncovered_requirement` (a roadmap requirement for the phase that no plan lists), `same_wave_overlap` (two plans in one wave modifying the same file with no dependency between them), `missing_reference` (a `depends_on` that names no plan of the phase), `self_reference`, `future_reference` (a dependency in the same or a later wave), `cycle`, `missing_property_task` (a requirement whose criterion states a validation rule — `IF … THEN`, a claim over any, every, all or each input, or a "never" — covered by no plan with a property-test task: `property="true"` on a task, or "property test" / "property-based" in the plan). **Warnings**: `unknown_requirement` (a plan lists a requirement the roadmap does not give the phase) and `wave_gap` (a plan later than its dependencies need). A dependency on another phase's plan (`02-04` from phase 3) is not checked.

`plan_check` says whether the plans are the ones that passed the plan check. The recorder stores a hash of the phase's plan files (`plans_sha`, line endings normalised) with every `pan-plan-checker` verdict. `status` is `ok`, `stale` (edited since the check), `failed`, `missing`, `legacy` (recorded before hashing; a warning) or `disabled` (`workflow.plan_check` is off). `drift` lists, for each plan without a summary that records `planned_commit`, the `files_modified` that changed between that commit and `HEAD`. `init execute-phase` carries the same two as `plan_check` and `plan_drift`, and exec-phase stops on `stale`, `failed` or `missing` unless the user gives a reason. Exits 1 for an unknown phase (`phase_not_found`), an unreadable phase directory (`unreadable_phase`) or a phase with no plans (`no_plans`).

### `verify review-focus <phase>`

Every plan names what its reviewer should check first (program P4): under `## Review Focus`, at most five inputs or failure modes its requirements imply that no test exercises yet, each pinned to the task that owns the code and the test that task adds, or one `None — <reason>` line. `/pan:plan-phase` runs it with `verify plan-set` and sends errors back to the planner; `review scope` hands the section to the reviewer.

```bash
pan-tools verify review-focus 3          # {phase, ok, plans: [{plan, file, status, items}], errors[]}
pan-tools verify review-focus 3 --raw    # valid | invalid
```

**Errors** (exit 1), each `{code, plan, detail}`: `review_focus_missing` (no section), `review_focus_empty` (no items and no `None — <reason>` with a reason of three or more words), `review_focus_too_many` (more than five items), `review_focus_no_task` (an item that names no `Task N`), `review_focus_unknown_task` (a `Task N` past the plan's task count), `review_focus_no_test` (an item that names no test). A plan's `status` is `ok`, `none`, `missing` or `invalid`.

### `verify decisions <phase>`

The decision spine (program P2). The phase design (`{phase}-design.md`) records each decision that passes the three-question test with an id (`DD-1`, `DD-2` …) in the first column of its design-decisions table, or at the head of a list item or heading. Plans cite the ids they implement.

```bash
pan-tools verify decisions 3          # {phase, ok, status, design, decisions[], cited: {id: [plans]}, errors[], warnings[]}
pan-tools verify decisions 3 --raw    # valid | invalid
```

**Errors** (exit 1): `decision_unrecorded` (a plan cites an id the design does not record), `decision_uncited` (a recorded decision no plan cites), `decision_duplicate` (an id recorded twice). `status` is `checked`, `no_design` (nothing to check) or `legacy` (a design whose decisions carry no ids: a `decisions_without_ids` warning, never a refusal).

### `verify gates <phase>`

Checks each backticked command in every task's `<verify>` against the tree as it is, before any work (M48). Only simple grep gates are checked — `grep`, `rg` or `git grep` with single-letter flags, a pattern and paths — and they are interpreted in Node, never run through a shell; anything else is `not_checkable`. A gate's `status` is `passes_now`, `fails_now`, `target_missing`, `invalid` or `not_checkable`. A gate that already passes (`gate_vacuous`, unless the verify text calls it a regression guard: "regression guard", "already passes" or "must still pass") or whose pattern does not compile (`gate_invalid`) is an error (exit 1).

```bash
pan-tools verify gates 3          # {phase, ok, gates: [{plan, task, command, status, regression_guard?}], errors[]}
pan-tools verify gates 3 --raw    # valid | invalid
```

**Module:** `plan-lint.cjs`

### `verify requirements` · `verify traceability [<REQ-ID> ...] [--phase N]` (program V8)

`verify requirements` fails a v1 requirement in `requirements.md` with no EARS acceptance criterion (`req_no_scenario`, exit 1). `verify traceability` runs the tests each requirement's `Test:` sub-bullets name: `passed`, `failing` (exit 1; a missing test file counts), `not_checked` (a criterion with no mapped test) or `legacy` (no criteria). Named ids (`AUTH-01`) trace only those requirements; an argument that is not a requirement id (`auth-01`) is an error (exit 1, `not a requirement id`), not a fallback to every requirement. A missing `requirements.md` is `requirements_not_found` (exit 1) for both. `phase complete` ticks a requirement with criteria only when its trace passes. `--phase N` lets a test file no per-file command can run count as passed when the phase's engine test run (`{NN}-test-run.json`) passed, no failing or pre-existing failure names the file or its folder, and the file has not changed since the commit the run tested (`via: suite_run` on that test); `phase complete` always passes its own phase. Each test's own command has `workflow.test_timeout_minutes` as its limit (3 minutes without it).

```bash
pan-tools verify requirements        # {ok, requirements: [{id, criteria, tests}], errors[]}; --raw valid | invalid
pan-tools verify traceability        # {requirements: [{id, status, tests}], passed, failing, not_checked, legacy}; --raw passed | failing | not_checked
```

**Module:** `requirements-lint.cjs`

### `uat record <phase> --test N --result pass|issue|skipped [--reported "..."] [--severity S] [--reason "..."]` · `uat status <phase>` (program L8)

`record` sets one test's result in the phase's `{phase}-uat.md` and rebuilds `## Summary` and `## Gaps` (diagnosis fields a gap already carries survive); the session becomes `complete` when no test is pending. `--severity` is `blocker`, `major` (the default for an issue), `minor` or `cosmetic`. `status` prints the counts and the gaps (`--raw`: `N passed, M issues, K pending`). Exit 1 with `uat_not_found`, `invalid_result`, `invalid_severity` or `test_not_found`.

**Module:** `uat.cjs`

### `debug repro <slug> [--timeout <ms>]` · `debug similar "<symptom>" [--limit N]` (program P5)

`repro` runs the `command:` in a debug session's `## Reproduction` (`.planning/debug/<slug>.md`, or `resolved/`): `{slug, result, closable, requirement, command, exit}`; `result` is `green`, `red` or `none` (no command recorded), and the command exits 1 unless it is `green` (`--raw`: the result). A slug that is not letters, digits, dots, dashes and underscores is `invalid_slug`, and a missing session `session_not_found` (exit 1). `similar` ranks the resolved sessions by token overlap with the symptom: `{symptom, cases: [{slug, score, root_cause, fix, reproduction}]}` (top 5 by default; `--raw`: the slugs).

**Module:** `debug-cases.cjs`

### `feedback`

What PAN learned on this project, as a report the user reads in the chat and may paste into a GitHub issue (`/pan:feedback`). Nothing is sent.

```bash
pan-tools feedback                                   # markdown report ending in a pan-feedback/1 JSON block
pan-tools feedback --note "your words" --tool-errors # add your note, and tool-error signatures
pan-tools feedback --days 30                         # the window (default 90 days, at most 100000)
pan-tools feedback --format json                     # the machine block alone
pan-tools feedback --self-check                      # {ok, canaries_checked, canaries_skipped, bytes}
```

The report covers the settings (keys PAN defines only: enum values, booleans, money bucketed; `x-` keys, keys inside sections that hold your own names such as `model_overrides` or `focus`, and every other key are counted, never named), the phase gate as it stands now (refusal codes, unchecked checks), each judge's findings by class and folded status (fixed, deferred, dismissed, decision, open) with learned suppressions and code-fact lowering, test runs by status and runner source, mutation score buckets, spend by tier and agent (bucketed), phase-budget status and forecast accuracy (below p10, within, above p90), the commands used, never used and unfinished, guard rules, trace event types, tool errors (with `--tool-errors`: tool, class, exit code, message signature) and suggested learnings derived by fixed rules (for example a judge class dismissed in at least 60% of ten or more findings). The window covers the ledgers, test runs and mutation reports (by their start time, else the file's) and the usage census: a finding counts when it was raised, reported again or disposed inside it, a phase's budget and forecast when it spent inside it, and a row whose timestamp is missing or unreadable is kept. The phase gate is its state now. Suggestions name PAN's own judges and finding classes only.

**What it never contains:** every value is a number, a boolean, a semver, an ISO week, or a member of a closed vocabulary; anything else is counted as `other`. Counts of 1 or 2 read `<3`; money is bucketed in 1-2-5 steps; phases are counted, never named. The rendered text is then scanned (`redact.cjs`) for credentials, e-mails, URLs, paths, IP addresses and this project's canaries (directory name, git remote, branch, git user, OS user, host, phase names); a canary that is one of PAN's own words, or part of one (a phase named `profile` next to `model_profile`), is skipped, since it identifies nothing. **Any hit refuses the report:** exit 1 with `{error: "feedback_refused", rules, reason}`, naming the rules and never the matched text. A hit from `--note` asks for a rephrase; any other is a PAN bug to report by rule name. Exits 1 with `not_a_pan_project` without `.planning/`, with `invalid_days` for a `--days` that is not a number above 0 and at most 100000, with `invalid_note` for a `--note` with no words after it, and with `invalid_format` for a `--format` other than `md` or `json`. A flag given without its value is one of these errors, never a silent default.

### `usage`

Which of the installed commands and agents this project has used (program L9), from its own files only: the cost ledger (`command`, `agent` per row) and the trace sessions (`command`, `ended_at`). The inventory is the install `pan-tools` ships in, in each runtime's layout: its `commands/pan/*.md` or `*.toml` (Gemini), `commands/pan-*.md` (OpenCode), `skills/pan-*`, or the shared `.agents/skills/pan-*` beside it (Codex, and any runtime under `--unified-skills`), and its `agents/pan-*` (`.md`, `.toml`, or Copilot's `.agent.md`).

```bash
pan-tools usage          # {local_only, commands: {used[], never_used[], unfinished[], installed}, agents: {used[], never_used[], installed}, sources}
pan-tools usage --raw    # N of M commands used, K unfinished; A of B agents used
```

A used command is `{name, calls, last_used, sessions, finished}`, a used agent `{name, calls, last_used}`; both lists are sorted by calls. A command name is matched with or without its `/pan:` or `pan-` prefix. **`unfinished`** lists used commands whose every trace session stopped without `ended_at`, the newest started more than six hours ago (a newer open session may still be running). Nothing leaves the machine. Exits 0.

### `research lint <phase|path> [--now YYYY-MM-DD]`

Research claims with provenance and freshness (program P3). The phase's research file (or the file at the path) lists the claims plans will rest on in a `## Claims` table with the columns Claim, Type, Source and Checked. A research file with no `## Claims` table but an answers table (`research check`, below) is read from its answered rows: each answer is a `general` claim, its source is the Source cell and its checked date is the `YYYY-MM-DD` date in that cell; `unknown` rows are not claims.

```bash
pan-tools research lint 3                                  # {file, ok, claims, errors[], warnings[], stale[], windows}
pan-tools research lint .planning/research/stack.md --raw  # valid | invalid
```

**Errors** (exit 1), each `{code, row, claim, detail}` (`claims_missing` carries only `code` and `detail`): `claims_missing` (no `## Claims` section and no answers table), `claim_no_source` (empty, or a placeholder such as `[Official docs URL]`), `claim_no_date` (not `YYYY-MM-DD`), `claim_future_date`. **Warnings:** `claim_unknown_type` (read as `general`). **`stale`** lists `{row, claim, type, checked, age_days, window_days}` for each claim older than its type's window: `version`, `pricing` and `security` 30 days, `api` 90, `general` 180, `practice` 365. Stale is not an error: `/pan:plan-phase` passes the lint to the plan checker, which flags the stale claims a plan depends on. `--now` fixes today's date. Exits 1 with `{error, reason}` for an unknown phase (`phase_not_found`), a phase with no research file (`no_research`), a missing path (`file_not_found`) or a `--now` that is not `YYYY-MM-DD` (`invalid_now`).

### `research check <questions file> <research file> [--market]`

Research answers questions, bounded. The workflows that research (`/pan:new-project --research`, `/pan:plan-phase --research`, `/pan:milestone-new`) write at most five open questions that block building as a numbered list (`1. …`), one researcher answers them in a table `| # | Question | Answer | Source | Confidence | Decision it settles |`, and the workflow runs this check after the researcher, sends its errors back once, then proceeds with the unknowns recorded.

```bash
pan-tools research check .planning/research/questions.md .planning/research/research-summary.md   # {questions_file, research_file, ok, questions, answered, unknown, products, limits, errors[], warnings[]}
pan-tools research check q.md r.md --market --raw                                                  # valid | invalid
```

**Errors** (exit 1), each `{code, detail}` (with `question` when it names one): `no_questions` (the questions file lists none: no research should run), `too_many_questions` (more than five), `answers_missing` (no table with Question, Answer and Source columns), `question_unanswered` (a question with no row, or an empty answer), `answer_no_source` (an answer whose source is empty or a placeholder), `unknown_without_assumption` (an answer starting `unknown` that names no assumption, as in `unknown — assume: …`), `too_many_products` (a table whose first column is `Product` with more than five rows), `products_missing` (`--market` and no such table). **Warnings:** `answer_no_confidence` (not HIGH, MEDIUM or LOW), `extra_row` (a row that answers no listed question). Exits 1 with `{error, reason}` when either file is missing (`file_not_found`).

### `verify test-integrity <phase>`

Did the phase weaken the tests that judge it (program V3)? It walks the phase's own plan commits (subjects like `feat(03-01): …`) one at a time and reads each test file's diff.

```bash
pan-tools verify test-integrity 3          # {phase, checked, ok, commits, violations[], warnings[], reason?}
pan-tools verify test-integrity 3 --raw    # clean | violated | not_checked
```

**Violations** (exit 1), each `{code, file, commit, detail}`: `test_deleted`; `skip_marker_added` (`.skip`/`.only`/`.todo`, `xit`, a node:test `skip` option, `@pytest.mark.skip`/`skipif`/`xfail`, `pytest.skip()`, `@unittest.skip`, `t.Skip`, `#[ignore]`, `@Disabled`/`@Ignore`); `assertions_dropped` (more assertion lines removed than added in one file); `undeclared_test_edit` (an existing assertion changed in a test no plan lists in `files_modified`); `snapshot_rewritten` (an undeclared snapshot changed or deleted); `always_true_assert` (`assert(true)`, `expect(true).toBe(true)`, `assert True`, `assert!(true)` …). **Warnings:** `test_renamed`. A test file is a path under `test/`, `tests/`, `__tests__/`, `spec/` or `specs/`, a `*.test.*`/`*.spec.*` file, `test_*.py`, `*_test.py`/`*_test.go`, `*Test(s).java`/`.kt`/`.cs`, or a Rust file holding `#[test]` or `#[cfg(test)]`. With no git or no plan commits for the phase it reports `checked: false` with a `reason` and exits 0: not checked is never a violation.

### `review scope <phase>`

What a reviewer of the phase reads (program R1): the diff, not the executor's own list of what it touched, with the intent to judge it against. exec-phase passes it to pan-reviewer.

```bash
pan-tools review scope 3          # {phase, directory, base, files: [{path, sources, listed}], unlisted[], excluded[], intent: {plans[], requirements[], missing_requirements[]}, git, commits}
pan-tools review scope 3 --raw    # the file paths, one per line
```

**Files** are those the phase's plan commits changed (subjects like `feat(03-01): …`), the summaries' key-files, and the working tree's uncommitted and untracked files; `sources` says which of `commit`, `summary`, `uncommitted` and `untracked` each came from. The planning tree, lockfiles and PAN's runtime directories are `excluded`, and a file the phase deleted is left out. `listed` is whether a summary's key-files names the file; **`unlisted`** collects the ones it does not, the files a review driven by the summaries never saw. **`intent.plans`** holds each plan's `objective`, `must_haves` (truths, artifacts, key_links), its `## Review Focus` section (`review_focus`, null without one) and the requirement ids it claims; **`intent.requirements`** the text of each claimed id from requirements.md, with ids it does not find in `missing_requirements`. `base` is the parent of the oldest plan commit. Exit 1 for a missing or unknown phase.

### `review cross-family <phase> [--host <name>] [--reps N] [--dry-run]`

The cross-family reviewer lane (program R4). Runs the phase review once more on another host's CLI, so a model from a different family checks the change. The run is read-only: the argv comes from `hosts.cjs` (`review`) and carries no write or auto-approve flag. The prompt holds the verdict contract, the plans' intent, the files in scope and the phase's diff.

Off unless `workflow.cross_family_review` names a host (`claude`, `codex`, `copilot`, `gemini`, `opencode`); while it is off it returns `{enabled: false, reason: "lane_off"}` and runs nothing. `--host` overrides the configured host for one run. `--dry-run` prints `lane`, `host`, `family`, `bin`, `argv`, the prompt and `prompt_file` (when it would use one) and spawns nothing. `--reps N` (at most 10) runs it N times and reports each run's verdict, and `verdict` is the most common one.

On Windows a host binary that resolves to an `.exe` or `.com` is launched directly by its path; anything else (an npm `.cmd` shim) goes through cmd.exe, with each argument holding whitespace, a quote or a cmd operator quoted. A prompt passed as an argument goes through `cross-family-<host>-prompt.md` (the argument tells the host to read it) when it runs through cmd.exe or is too long for a command line.

Writes `.planning/reviews/<NN>/cross-family-<host>.md` with the host's answer. `review-deep merge … --cross-file <that file>` merges its findings as a fourth source (`coverage.by_source.cross_family`). Exits 1 with `phase_required`, `unknown_host` (a host with no review lane), `standin_missing` or `spawn_failed`.

**Module:** `cross-family.cjs`

### `review vote [--phase N] [--quorum K] [--out <file>] <pass-file>...` (program R2)

Merges k reviewer passes (`workflow.review_mode: lenses`): a finding survives only when a quorum of passes reported it (default: half the passes, rounded up), at the highest severity any pass gave it, and the verdict is recomputed from what survived. `--out` writes the merged report, which carries a normal `pan-verdict` block for `findings record`. Prints `{ok, passes, quorum, kept, dropped, verdict, out}` (`--raw`: the verdict); exit 1 on a pass with no readable block (`unreadable_pass`) or no pass at all (`no_passes`).

**Module:** `review-vote.cjs`

### `verify red <phase> [--timeout <ms>]`

Does each test the phase wrote test what the phase built (program V4)? A test that passes before the phase's code exists cannot have caught anything.

```bash
pan-tools verify red 3          # {phase, checked, ok, base, caught, files: [{file, verdict, command, base_exit, head_exit, detail?}], reason?}
pan-tools verify red 3 --raw    # caught | not_caught | not_checked
```

The **base** is the parent of the phase's oldest plan commit (subjects like `feat(03-01): …`). For each test file those commits added or changed, it runs that one file twice: in a throwaway git worktree at the base, with the file copied in from HEAD, and at HEAD. The worktree links the project's `node_modules` (untracked, so absent from a checkout) and removes the link before the worktree.

| `verdict` | When |
|---|---|
| `caught` | fails at the base (a crash on a missing module counts) and passes at HEAD |
| `not_red` | passes at the base: tautological, or testing something the phase did not change |
| `not_green` | fails at HEAD |
| `not_checked` | no command can run that one file, with the reason |

The one-file command is `workflow.test_file_command` from config.json (a `{file}` placeholder, the file; or `{dir}`, its folder as `./dir`, for runners that test a folder: `go test {dir}`), else derived from the suite's runner: `node --test <file>`, jest, vitest or mocha through `npx --no-install`, `python -m pytest <file>`, or `go test ./<dir>`. Cargo, Maven, Gradle and make have none. Exit 1 when a file is `not_red` or `not_green`; a phase with no plan commits, no changed test or no runnable one is `checked: false` and exits 0.

### `verify mutate --phase N [--max <n>] [--seed <n>] [--timeout <ms>]`

A mutation report on the phase's diff (program V5): would a test fail if the code the phase wrote were wrong?

```bash
pan-tools verify mutate --phase 3            # writes 03-mutation.json; exit 0
pan-tools verify mutate --phase 3 --raw      # "3/5 killed" | aborted:flaky | aborted:suite_fails | not_checked
```

It takes the lines the phase's plan commits changed (`git diff` from the phase's base, as `verify red` finds it) in source files that are not tests, and swaps one thing at a time on a changed line, outside comments and strings: a comparison flipped (`>=`/`>`, `<=`/`<`), equality inverted (`===`/`!==` in JS and TS, `==`/`!=` in C-family languages and Python), `&&`/`||` (`and`/`or` in Python), a boolean return inverted, `+ 1` for `- 1`. A seeded sample (`--max`, default 8; `--seed`, default 1) runs in a throwaway worktree at HEAD (uncommitted changes are not measured), the project's whole test suite once per mutant: **killed** when it fails or times out, **survived** otherwise.

Before any mutant, the unmutated suite runs twice: if it fails, the report aborts (`suite_fails`), and if one run passes and the other fails, it aborts as `flaky`, since no mutant could be read against it. The record holds `phase`, `mode`, `seed`, `checked`, `base`, `head`, `command`, `candidates`, `sampled`, `killed`, `survived`, `score` and `survivors[]` (each `{file, line, op, before, after}`); an aborted or unchecked run carries `aborted` and/or `reason` in place of `sampled`, `killed`, `survived` and `score`. The printed result adds `record`, the path it wrote. The phase may also be given positionally (`verify mutate 3`). An unknown phase exits 1; every report exits 0 except a failed gate (below), which `--raw` marks `(gate failed)`.

`workflow.mutation_gate` in config.json: `report` (the default; a report, never a refusal), `off` (runs nothing), `gate` (V5G, opt-in: the result carries `gate: {floor, failed}`, the command exits 1 when the score is below `workflow.mutation_floor` (0.6), and `verify reconcile` reports a passed verification over a failed gate as a contradiction, so the phase gate refuses). verify-phase runs it with `--max 5` after a passing test gate and lists survivors under **Test strength**.

### `test run [--phase N] [--baseline] [--rebaseline] [--command "<cmd>"] [--timeout <ms>]`

Run the project's test suite and record the result (program V2): the engine's test gate, in any language.

```bash
pan-tools test run                         # run and print the record; writes nothing
pan-tools test run --phase 3 --baseline    # before execution: 03-test-baseline.json in the phase directory
pan-tools test run --phase 3               # after: 03-test-run.json, compared with the baseline
pan-tools test run --phase 3 --raw         # passed | failed | skipped
```

**The command:** `workflow.test_command` from config.json, else the first of: package.json's `test` script (`npm test`; npm's placeholder script does not count), pytest (`pytest.ini`, `conftest.py`, `[tool.pytest…]` in pyproject.toml, `setup.cfg` or `tox.ini`: `python -m pytest`), `go.mod` (`go test ./...`), `Cargo.toml` (`cargo test`), `pom.xml` (`mvn -q test`), Gradle (`./gradlew test` or `gradle test`), a Makefile `test:` target (`make test`). `--command` overrides it for one run.

**The parse:** the runner's own output, by its shape: Node's runner (spec and TAP), jest, pytest, go test (plain or `-v`), cargo, and JUnit XML (also read from `target/surefire-reports/`, `target/failsafe-reports/` and `build/test-results/test/` after Maven or Gradle). Each failing test gets an id (`file > name`, `test_file.py::name`, `pkg > TestName`, `module::name`) that is the same from one run to the next.

**The status:**

| `status` | When |
|---|---|
| `passed` | the suite exited 0; or, against a baseline, every failure was already failing at the baseline (`preexisting_failures`) |
| `failed` | a failing test the baseline did not have (`regressions`); a failure with no baseline; a runner that exited 0 but reported failures; or the suite did not run: a non-zero exit with no failing test reported, a crash or a build error (`reason: "suite did not run: …"`), or a timeout (`reason: "the suite timed out after …"`) |
| `skipped` | nothing to run: no test command, or one that ran no tests |

**The time limit:** `--timeout <ms>`, else `workflow.test_timeout_minutes` from config.json, else 15 minutes. A run that reaches it is `failed` with `reason: "the suite timed out after N min; raise workflow.test_timeout_minutes …"`, and the record holds `timeout_ms`.

A `--baseline` run keeps an existing baseline (`kept_existing: true`, nothing run) unless `--rebaseline`: a resumed run or a gaps-only round compares against the phase's start. The record holds `version`, `kind` (`run` or `baseline`), `phase`, `command`, `source` (`flag` under `--command`), `head`, `started_at`, `exit`, `timed_out` (only when it did), `timeout_ms`, `duration_ms`, `runner`, `parsed`, `total`, `passed`, `failed`, `skipped`, `failing[]`, `status`, `reason`, `regressions[]`, `preexisting_failures[]`, `baseline` (`{head, status, failing}`, `failing` being its failure count, when compared with one) and `output_tail` (with no test command, `timed_out`, `baseline` and `output_tail` are absent); with `--phase` the printed result adds `record`, the path it wrote. The command exits 0 whatever the `status`: callers read `status` (an unknown `--phase` exits 1). The verifier copies `test_gate` from it, `verify reconcile` reports a verification whose `test_gate` disagrees with it, the verdict recorder lowers a verifier's pass over a failed run, and `phase gate` refuses on it. `validate health --full` runs the same gate.

### `test detect`

The test command the gate would run, and where it came from: `{command, source}` (`source` is `config`, `package.json`, `pytest`, `go.mod`, `Cargo.toml`, `pom.xml`, `gradle` or `Makefile`), or `{command: null, source: null, reason}`.

```bash
pan-tools test detect          # {command, source} | {command: null, source: null, reason}
pan-tools test detect --raw    # the command, or nothing
```

### `verify stubs [--gate]`

Scan the uncommitted/changed file set (git diff vs HEAD, staged/index changes, and untracked files, so it gates a handoff) for stub / fake-return markers (`not implemented`, `NotImplemented`, `throw new Error("stub"/"todo")`, HTTP `501`, `coming soon`/`placeholder`, etc.) that indicate unfinished work. With `--gate`, exits non-zero when blocking (high-severity) findings exist; without it, always reports and exits zero.

```bash
pan-tools verify stubs [--gate] [--raw]
```

**`--raw` output:** `valid` or `invalid`.

---

## 10. Progress & Context

Commands for viewing project progress and estimating context window utilization.

### `progress [json|table|bar|health]`

Render milestone progress in various formats.

```bash
pan-tools progress              # JSON (default)
pan-tools progress json
pan-tools progress table [--raw]
pan-tools progress bar [--raw]
pan-tools progress health [--raw]
```

**Subcommands:**

| Format | Description | Typical Use |
|--------|-------------|-------------|
| `json` | Structured data with per-phase breakdown | Machine consumption |
| `table` | Markdown table with progress bar header | Human review, status reports |
| `bar` | Single-line progress bar | Quick status check |
| `health` | Composite A-D health grade from 3 signals | Project health assessment |

**JSON output (json format):**
```json
{
  "contract": "1.0",
  "milestone_version": "v1.0",
  "milestone_name": "Core Platform",
  "phases": [
    { "number": "05", "name": "setup", "plans": 3, "summaries": 3, "status": "Complete" }
  ],
  "total_plans": 30,
  "total_summaries": 18,
  "percent": 60
}
```

**Table format** produces a Markdown table with progress bar header.

**Bar format** produces a single-line progress bar: `[████████████░░░░░░░░] 18/30 plans (60%)`.

**Health format** produces a composite project health score:

```json
{
  "grade": "B",
  "composite": 74,
  "progress": { "score": 60, "completed": 18, "total": 30 },
  "context": { "score": 100, "utilization": 0.053, "tokens": 10500 },
  "staleness": { "score": 63, "stalePlans": 3, "totalPhases": 8 },
  "patterns_count": 5,
  "session_count": 12
}
```

**Grade mapping:** A (>=80), B (>=60), C (>=40), D (<40).

**The `context` denominator:** `utilization` is an estimate of `state.md` + `roadmap.md` + `project.md` + every phase's plan files, divided by PAN's own fixed budget constant — 200,000 tokens (`CONTEXT_WINDOW` in `constants.cjs`) — **not a reading of your model's real window.** Nothing detects the model here either; see [`context-budget`](#context-budget) for the same assumption stated in full.

**Enhanced fields:** `patterns_count` (error patterns from `patterns.md`), `session_count` (session entries from `session-history.md`).

**`--raw` output (table/bar/health):** The rendered string.

---

### `autodev run|resume|status|report|replay [--host H] [--max-usd N] [--max-usd-day N] [--max-turns N] [--run ID] [--quality] [--worktrees] [--ci [local]] [--ci-rounds N] [--ci-push] [--ci-base REF]`

The deterministic outer loop (programs A1a, A1c). A foreground process: each turn reads `.planning/`, asks `next-action` for the next unit, decides in code whether to stop, and runs the unit. Plan, execute and verify units each get a fresh headless session on `--host` (argv from `hosts.cjs`; Copilot CLI has no unattended adapter and is refused with `unsupported_host`); `complete_phase` runs `phase complete` in the engine. A phase the engine sizes lean (`size phase`) is planned with no session (`size phase-plan`, at $0) and its execute unit runs `workflows/exec-lean.md` in one session: the executor's work, one `pan-reviewer` pass (a `NEEDS_FIXES` gets one fix round, what stays open is recorded as deferred) and the verifier; `--quality` keeps `/pan:exec-phase` for every phase.

Stop reasons: `done` (the milestone audit is next), `human_needed` (a verification with `status: human_needed`, or no roadmap), `gate_failed` (`phase complete` refused), `budget_usd` (spend reached `--max-usd`), `turns` (`--max-turns` units, 20 by default), `no_progress` (the same unit again with the disk unchanged since it ran), plus `forecast_exceeded` and `ci_failed` (below). `run` defaults to `--host claude`.

Writes `.planning/autodev/<run>/run.json` and `ledger.jsonl`: a `started` row before each unit and a `finished` row after it (`argv`, `exit`, `cost_usd` from Claude's JSON envelope, `start_sha`, `end_sha`, `snapshot_after`), and a `stopped` row with the reason. `resume` continues the latest run (or `--run`), relaunching a unit that was in flight when it died. `.planning/autodev/state.json` keeps each phase's `verified` and `merged` facts. `status` reports the latest run.

**Failures (A4, `failure-class.cjs`).** A failed session is classified: `compile` and `assertion` are retried with the error tail in the prompt, then at the next tier (Claude gets `--model`); `timeout` and `unknown` are restarted once; `flake` is quarantined; `missing_env`, `merge_conflict`, `integrity_violation` and `scope_violation` stop with `human_needed`; `budget` stops with `budget_usd`. The ledger row carries `failure_class` and `policy`.

**Resume.** `autodev resume` with no run to resume is refused with `no_run`, and so is `autodev status` before any run. An unknown subcommand is refused with `unknown_subcommand`.

**Beside focus.** A fresh run is refused with `focus_active` (`focus_run`, `open_cycle`, and the command to clear it in `reason`) while a focus cycle is open or a focus run is live and not stale; a resumed run is not checked.

**Spend (A6).** A run needs a cap: `--max-usd` or `budget.max_usd_run`, else `budget_required`. `--max-usd-day` or `budget.max_usd_day` caps today's spend across runs (UTC). Claude sessions get the remainder as `--max-budget-usd`. An execute unit that costs more than the P6 p90 forecast (per-plan p90 × the phase's plans, when the forecast has enough samples) stops the run with `forecast_exceeded`.

**Record (A5).** `blackbox.jsonl` holds every stop decision with its inputs. `autodev replay [--run ID]` re-runs the stop logic over them and returns `identical` and any `mismatches`. `autodev report [--run ID]` writes `dossier.md` and `dossier.html` beside the ledger.

**Worktrees (A3).** `--worktrees`: an execute unit whose phase has two or more pending plans runs each plan in its own git worktree and session (`exec-phase N --plan <id>`), sub-wave by sub-wave (`phase-plan-index` reports `sub_waves`: plans of a wave that share a file are split). Each sub-wave's branches pass `worktree preflight` before they are merged into the checkout; a conflict or a red merge stops with `human_needed`.

**CI (A2, `ci.cjs`).** `--ci`: after each completed phase, `gh pr checks` is the oracle. Checks whose latest run on the base branch (`--ci-base`, else `origin/HEAD`) failed are ignored. A failure starts a fix round (a `ci_fix` session given the failing names and `gh run view --log-failed` tail); `--ci-rounds N` (3) rounds later the run stops with `ci_failed`. Checks for a commit other than HEAD are `stale` and stop the run; `--ci-push` pushes after each phase. Each check is a `ci` row in the ledger. `--ci local` reads no pull request: after each completed phase it runs the project's own gate in the working directory (`npm run ci:local` when `package.json` has that script, else `npm test`; neither is `unavailable` and stops the run). The exit code decides; the failing names are the gate ids from `.ci-local/report.json` (else the script name), and the output's last lines are the fix round's feedback.

**Test safety.** With `PAN_STANDIN_DIR` set (the test suite sets it), autodev, the CI oracle and the cross-family lane run a host CLI only when a stand-in for it is in that directory.

**Module:** `autodev.cjs`, `failure-class.cjs`, `autodev-report.cjs`, `ci.cjs`

The shadow-merge check `--worktrees` runs before merging a group back is `worktree preflight` (section 29).

### `size phase <N>` · `size task "<description>"` · `size phase-plan <N>` · `size quick-plan --out <file> [--num N] "<description>"` · `size plan-check <N>` (right-sized ceremony)

Decides in code how much process a piece of work gets (`docs/specs/right-sized-ceremony.md`). `phase` and `task` print `{path, mode, reasons}` (`phase` adds `phase` and `metrics`: `{requirements, unspecified, lean_max_requirements}`; `task --file <path>` sizes a document, such as new-project's brief, instead of a description) (`--raw`: `lean` or `full`): a phase whose requirements (at least one, at most three times `workflow.lean_max_requirements`) each have an acceptance criterion or name what to build is `lean`, and so is a quick task whose description names an artifact and runs to 15 words or more. `mode` is `full` under the `quality` profile, `workflow.ceremony: full` or `--quality`, and then the path is always `full`; `--full` makes one call `full`. `phase-plan` plans a lean phase with no planner session: one task per requirement, in plans of at most `workflow.lean_max_requirements` (5) tasks, each in a wave after the one before (the task's action is the requirement's own text; a requirement that migrates or changes behaviour already built also declares the existing tests that cover the changed files as `supersedes_tests`), checked like `plan-check`, recorded as the phase's plan check and committed when `commit_docs` is on; it prints `{ok, written, path, paths, plan_dir, requirements, plan_check: "recorded", commit}` (`paths` lists every plan written, `path` the first; `supersedes_tests` when it declared any; `commit: null` with `commit_error` when the plan stands but its commit failed), and exits 1 with `not_lean`, `phase_not_found`, `has_plans` or `check_failed` (with the check's `errors`), writing nothing. `autodev` runs it for a lean phase's `plan` unit, at $0. `quick-plan` writes the lean quick task's one-task plan from its description to `--out` (`--num N` numbers it) and prints `{written: true, path}`. `plan-check` runs the plan set, every plan's structure and the plans' grep gates; when all pass it records the phase's plan check from the engine (exit 0, `recorded: true`), otherwise it records nothing and exits 1 with `errors`.

```bash
pan-tools size phase 2 --raw        # lean
pan-tools size task "add src/shout.js exporting shout(name) ..." --raw
pan-tools size plan-check 2         # {ok, errors, plans, recorded}
```

**Module:** `sizing.cjs`

### `next-action`

The one router `/pan:progress`, `/pan:resume` and the phase transition ask for the next step. It reads `roadmap.md` and the phase directories into the snapshot the MCP orchestrator's state machine keys on, and prints `{action, phase, reason, command, done}` (`--raw`: the command, or the action when there is none).

```bash
pan-tools next-action
```

`action` is one of `answer_pause`, `focus`, `plan`, `execute`, `verify`, `complete_phase`, `plan_gaps`, `audit_milestone`, `new_milestone`, `new_project` (no roadmap) or `stop`; `command` is the command that carries it out (for example `/pan:plan-phase 3`).

An open pause comes before everything else: `action: "answer_pause"`, `reason: "pause_open"`, a `pause` object (`id`, `kind`, `run`, `step`, `question`, `expects`), `open_pauses`, and a `command` (`pan-tools pause answer <id> --value <...>`) for the oldest one.

A phase whose status is not one the phase table knows stops the router (`action: "stop"`, `done: false`, `error: "unknown_state"`, the reason `phase_unknown_status_<status>`) instead of planning it again; the MCP `pan_next_action` tool does the same, and its routed answers carry `allowed`, the phase statuses open from the current one.

Focus work comes first, as `action: "focus"` with `detail` and a `focus` object (the run and the open cycle), its `reason` one of: `focus_cycle_in_progress` (the live run that opened the cycle is working it: `pan-tools focus auto --status`), `focus_run_stale` (the run recorded nothing for `focus.stale_hours`: `pan-tools focus auto --stop`, which closes its cycle, then `/pan:focus-auto --continue`) and `focus_cycle_open` (a cycle no live run owns: `pan-tools focus close --dir <dir> --status failed` once its edits are reverted or committed). With no focus work the output is unchanged. Autodev reads the phase router directly.

**Module:** `next-action.cjs`

---

### `design paths`

Where a design goes. `/pan:focus-design` asks before it writes.

```bash
pan-tools design paths <feature name or slug> [--raw]
```

A project with both `docs/specs/` and `docs/decisions/` gets `docs/specs/<slug>_featureai.md`, `docs/decisions/ADR-<NNNN>-<slug>.md` (the next ADR number) and `docs/specs/<slug>_featureai.check.md` for the checker's verdict. Any other project gets `.planning/designs/<slug>/spec.md`, `decision.md` and `check.md`, where focus-plan reads designs.

**JSON output:** `{ layout: "docs"|"planning", slug, spec, decision, check, adr_number? }`. **Refusal (exit 1):** `slug_required`. **`--raw`:** the spec path.

### `design handoff`

Hand a finished design to the phase system or to focus.

```bash
pan-tools design handoff <spec> --as phase|focus [--raw]
```

- `--as phase`: adds a roadmap phase titled from the spec's first heading, its Goal the first sentence of the spec's problem statement, and a `**Design:** <spec>` line under it, then returns `/pan:plan-phase <N> --prd <spec>`, so plan-phase takes the spec as the phase's context
- `--as focus`: changes nothing and returns `/pan:focus-auto --step plan --mode features`

**JSON output:** `{ as, spec, title, phase_number?, directory?, command, note? }` (`note` only with `--as focus`). **Refusals (exit 1):** `invalid_as`, `spec_required`, `spec_not_found`, `spec_outside_project`, `no_roadmap` (start with `/pan:new-project`, or hand the design to focus), `already_handed_off` (the roadmap already names this spec), and `phase add`'s own refusals (`roadmap_not_found`, `mkdir_failed`, `write_failed`). Any other `design` subcommand exits 1 with `Error: Unknown design subcommand. Available: paths, handoff` on stderr. **`--raw`:** the command.

**Module:** `design-handoff.cjs`

---

### `journal step` · `journal show` · `journal resume-point`

The step journal a plan resumes from after a crash: `<plan>-journal.jsonl` beside the plan, one JSON line per event (`{seq, ts, run, step, event, artifact?, note?, by?}`). The executor records each task in its commit message (`PAN-Step: <plan>/task-N`, read by `resume-point` with no journal line needed) and journals a task that ends with nothing to commit; focus records each cycle's open and close.

```bash
pan-tools journal step --plan <phase>-<plan> --step task-3 --event completed --commit <sha>
pan-tools journal step --plan <plan path> --step task-3 --event started [--note "<text>"] [--by <agent>]
pan-tools journal show --plan <phase>-<plan>
pan-tools journal resume-point --plan <phase>-<plan>
```

`--plan` is a plan id (`03-02`, phase 03, plan 02) or a plan file's path. `--event` is `started`, `completed`, `failed`, `paused`, `resumed` or `forced`. A `completed` step needs its evidence: `--commit <sha>` (a commit reachable from HEAD; stored short) or `--file <path>` (stored with its SHA-1). Event changes follow the `plan.step` table: a completed step is final, so starting it again is refused until a `forced` line records the override.

- **`step`:** `{recorded, seq, plan, step, event, journal}` (`--raw`: the seq). **Refusals (exit 1):** `plan_required`, `plan_not_found`, `step_required`, `invalid_event` (with `allowed`), `artifact_required`, `commit_unknown`, `file_missing`, `illegal_transition`, `lock_timeout`.
- **`show`:** `{plan, journal, entries}` (`--raw`: the number of entries).
- **`resume-point`:** `{plan, journal, tasks, completed: [{step, source, commit|file}], unverified: [{step, why}], resume_at, all_done}`. `tasks` counts the plan's `<task>` elements (`task-1` … `task-N`). `source` is `journal` or `trailer`: a commit among HEAD's newest 1000 whose message has the line `PAN-Step: <plan id>/task-N` (any case, leading spaces allowed; one line per task a commit holds) proves that task, unless a later commit reverted it or the journal re-started, failed, paused or forced the step after it. `resume_at` is the first task not proven done: a step recorded `completed` whose commit is no longer reachable from HEAD, was reverted, or whose file changed, is in `unverified` and is redone. No journal and no trailers: `journal: null`, `resume_at: null`, and the plan restarts at its first task. Only commits whose message has a `PAN-Step:` or `This reverts commit` line are read. When the commits cannot be read (the git call fails), the result adds `trailer_scan: {error: "trailer_scan_failed", reason}`: what is done is unknown, not nothing. `--raw`: `resume_at`, `done`, `trailer_scan_failed` (no journal and a failed scan), or `start`.

Any other `journal` subcommand exits 1 with `Error: Unknown journal subcommand. Available: step, show, resume-point` on stderr.

**Module:** `journal.cjs`

---

### `pause open` · `pause answer` · `pause list` · `pause cancel`

A typed pause for a person's answer, kept in `.planning/pauses/<id>.json` so it outlives the session that asked. A checkpoint, a plan-check override and an autodev `human_needed` stop open one; the answer is checked against what the pause expects before anything acts on it.

```bash
pan-tools pause open --kind <kind> --question "<text>" [--run <plan id or run>] [--step <step>] [--options a,b,c] [--expects '<json>']
pan-tools pause answer <id> --value <answer> [--note "<text>"]
pan-tools pause answer <id> --json '{"field": "value"}'
pan-tools pause list [--open]
pan-tools pause cancel <id> --reason "<why>"
```

`--kind` and what it expects unless `--expects` says otherwise: `human-verify` (`approved`, or `issues` with a `--note`), `human-action` (`done`), `decision` and `spec-conflict` (one of `--options`), `plan-override` and `autodev-human` (text). `--expects` takes `{"type":"enum","values":[...],"noteFor":[...]}`, `{"type":"string","pattern":"...","maxLength":n}`, `{"type":"boolean"}` or a flat `{"type":"object","required":[...],"properties":{...}}`.

- **`open`:** `{opened, pause, file}` (`--raw`: the id, `p-<kind>[-<run>][-<step>]`). The same kind, run and step while one is open returns it (`opened: false`, `existing: true`). `orchestration.pause_ttl_hours` sets `expires_at`. **Refusals:** `invalid_kind`, `question_required`, `expects_required`, `invalid_expects`.
- **`answer`:** `{answered, pause}` (`--raw`: `answered`). The pause records `answer`, `note`, `answered_at`, and `own_words: true` when the answer is not one the pause offered (text outside an enum's options, `issues` without a note, text for true/false): the person's answer is recorded as given, never refused; a pause with a `run` and `step` adds a `resumed` line to that plan's journal. **Refusals:** `pause_not_found`, `pause_answer_invalid` (an empty, oversized or malformed answer only; with `reason` and, for an enum, `allowed`), `pause_expired`, `illegal_transition` (already answered, expired or cancelled), `invalid_json`.
- **`list`:** `{pauses, open}`, newest first; an open pause past `expires_at` reads as `expired` (`--raw`: how many).
- **`cancel`:** `{cancelled, pause}`. **Refusals:** `reason_required`, `pause_not_found`, `illegal_transition`.

The MCP tools `pan_list_pauses` (read-only) and `pan_answer_pause` do the same. Any other `pause` subcommand exits 1 with `Error: Unknown pause subcommand. Available: open, answer, list, cancel` on stderr.

**Module:** `pause.cjs`

---

### `context-budget`

Estimate context window utilization for the current phase. Measures how much of the assumed context window would be consumed by loading project files, roadmap, state, and plans for the active phase. The denominator is PAN's own fixed budget constant — 200,000 tokens (`CONTEXT_WINDOW` in `constants.cjs`) — **not a reading of your model's real window.** Nothing detects the model here; the number is a deliberately conservative planning assumption, so on a larger-context model the real headroom is greater than the report implies. That constant is the window size PAN commits to, and `progress health`'s `context` block divides by the same one.

```bash
pan-tools context-budget [--raw]
```

The `cache` block classifies the cached context (`status` of `ok` / `warn` / `critical` / `absent`, with advice naming the largest file) and, under `cache.ttl`, reads the cost ledger for the prompt-cache **lifetime** signal: how many cache writes followed an idle gap of five to sixty minutes — the misses a one-hour subagent cache lifetime would have avoided. `cache.ttl.recommend` turns true only when that recurs, and `cache.ttl.advice` then names the Claude Code setting (`subagentPromptCacheTtl`) with its cost trade-off. Suspect ledger rows are excluded from the count. Rows that recorded the cache-write lifetime split (`cache_write_1h_tokens`/`cache_write_5m_tokens`, written when the transcript carries it) count only their five-minute writes — a one-hour write outlives the gap — and `cache.ttl.basis` says which way the count was made: `measured`, `mixed`, or `inferred` from gaps alone; `measured_rows`, `cache_write_1h_tokens` and `cache_write_5m_tokens` carry the measured totals.

**JSON output:**
```json
{
  "status": "healthy",
  "currentPhase": "01",
  "phaseDirectory": ".planning/phases/01-setup",
  "contextWindow": 200000,
  "budgetUtilization": 0.005,
  "plans": 2,
  "incompletePlans": 1,
  "tokens": {
    "project": 250,
    "roadmap": 150,
    "state": 100,
    "plans": 500,
    "total": 1000
  },
  "recommendation": "Within budget. ~796 more plans could fit before degradation.",
  "modelProfile": "balanced",
  "cache": { "status": "ok", "total_tokens": 500, "ttl": { "recommend": false, "setting": "subagentPromptCacheTtl" } },
  "relevanceSignal": null
}
```

*The `cache` object is abbreviated here. Its full field list is `block_count`, `block_paths`, `block_tokens`, `total_bytes`, `total_tokens`, `eligible_pct`, `status`, `warn_tokens`, `crit_tokens`, `file_warn_tokens`, `advice`, `ttl` and `sha`; the paragraph above describes `status`, `advice` and `ttl`. `cache` is `null` when the cached context cannot be built.*

Without a `.planning/` directory it prints `{error: ".planning/ directory not found", hint}` and exits 1.

**Status thresholds:**

| Status | Utilization | Meaning |
|--------|------------|---------|
| `healthy` | < 60% | Proceed normally |
| `warning` | 60% to <80% | Consider splitting the phase |
| `critical` | ≥ 80% | Phase too large, split recommended |
| `idle` | N/A | No current phase set |

**`--raw` output:** Human-readable text with budget breakdown.

---

## 11. Todos

### `todo complete <filename>`

Move a todo file from `.planning/todos/pending/` to `.planning/todos/completed/`, adding a `completed: YYYY-MM-DD` line as the first line of its front matter (or of the file, when it has no front matter).

```bash
pan-tools todo complete improve-error-handling.md [--raw]
```

**JSON output:**
```json
{ "completed": true, "file": "improve-error-handling.md", "date": "2026-02-27" }
```

**`--raw` output:** `completed`.

A file not in `pending/` prints `Error: Todo not found: <filename>` on stderr and exits 1; so does a name holding a path separator (`Not a todo file name`).

---

### `list-todos [area]`

Count and enumerate pending todo files from `.planning/todos/pending/`.

```bash
pan-tools list-todos [--raw]
pan-tools list-todos refactoring [--raw]
```

**Arguments:**
- `[area]` — Optional area filter (matches the `area:` frontmatter field in todo files)

**JSON output:**
```json
{
  "count": 3,
  "todos": [
    {
      "file": "improve-error-handling.md",
      "created": "2026-02-20",
      "title": "Improve error handling in parser",
      "area": "refactoring",
      "path": ".planning/todos/pending/improve-error-handling.md"
    }
  ]
}
```

**`--raw` output:** The count as a string.

---

## 12. Scaffolding

Commands for creating template files in phase directories. All scaffold commands use the same module entry point with type dispatch. `context`, `uat` and `verification` need `--phase` naming an existing phase directory (else exit 1), never overwrite a file that exists (`{ "created": false, "reason": "already_exists", "path": … }`, exit `0`), and take `--name "..."` to override the phase name written into the template; their `--raw` output is the created path, or `exists`. An unknown type exits 1.

### `scaffold context --phase <N>`

Create a context.md template file in a phase directory.

```bash
pan-tools scaffold context --phase 5 [--raw]
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-context.md" }
```

---

### `scaffold uat --phase <N>`

Create a uat.md template file in a phase directory.

```bash
pan-tools scaffold uat --phase 5 [--raw]
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-uat.md" }
```

---

### `scaffold verification --phase <N>`

Create a verification.md template file in a phase directory.

```bash
pan-tools scaffold verification --phase 5 [--raw]
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-verification.md" }
```

---

### `scaffold phase-dir --phase <N> --name <name>`

Create a new phase directory under `.planning/phases/`.

```bash
pan-tools scaffold phase-dir --phase 5 --name "Database Setup" [--raw]
```

**Flags:**
- `--phase <N>` — Phase number
- `--name <name>` — Phase name (used to generate slug for directory). Put it last: it takes every following word that is not a flag, so `--name "Database Setup" --phase 8` creates `08-database-setup-8`.

**JSON output:**
```json
{
  "created": true,
  "directory": ".planning/phases/05-database-setup"
}
```

**`--raw` output:** The project-relative directory (e.g. `.planning/phases/05-database-setup`).

---

## 13. Frontmatter CRUD

Commands for reading and writing YAML frontmatter in markdown files. Frontmatter is the YAML block between `---` delimiters at the top of PAN's plan.md, summary.md, and verification.md files.

### `frontmatter get <file> [--field <key>]`

Extract YAML frontmatter from a file as JSON. A plan's `must_haves.artifacts` and `must_haves.key_links` come back as objects (`{ "path": "src/db/schema.ts", "provides": "schema", "min_lines": 1 }`), read by relative indent; `frontmatter set` and `merge` write them back as lists of maps.

```bash
pan-tools frontmatter get .planning/phases/05-setup/05-01-plan.md
pan-tools frontmatter get path/to/plan.md --field wave [--raw]
```

**JSON output (all fields):**
```json
{
  "phase": "05-setup",
  "plan": "01",
  "type": "execute",
  "wave": "1",
  "depends_on": [],
  "files_modified": ["src/db/schema.ts"],
  "autonomous": "true"
}
```

**JSON output (single field):**
```json
{ "wave": "1" }
```

With `--field`, `--raw` prints the value JSON-encoded (a string keeps its quotes: `"1"`). A missing file (`error: "File not found"`) or an absent field (`error: "Field not found"`) exits 1.

---

### `frontmatter set <file> --field <key> --value <jsonVal>`

Update a single frontmatter field. The value is JSON-parsed (so `"true"` becomes boolean `true`, `"[1,2]"` becomes an array); a value that is not valid JSON is stored as the plain string. A missing file exits 1 with `error: "File not found"`.

```bash
pan-tools frontmatter set path/to/plan.md --field wave --value 2 [--raw]
pan-tools frontmatter set path/to/plan.md --field autonomous --value false [--raw]
```

**JSON output:**
```json
{ "updated": true, "field": "wave", "value": 2 }
```

**`--raw` output:** `true`.

---

### `frontmatter merge <file> --data '{json}'`

Merge a JSON object into the file's frontmatter (shallow merge — existing keys are overwritten, new keys are added).

```bash
pan-tools frontmatter merge path/to/plan.md --data '{"wave": 2, "autonomous": false}' [--raw]
```

**JSON output:**
```json
{ "merged": true, "fields": ["wave", "autonomous"] }
```

**`--raw` output:** `true`. `--data` that is not valid JSON prints `Error: Invalid JSON for --data` on stderr and exits 1.

---

### `frontmatter validate <file> --schema plan|summary|verification`

Validate that a file's frontmatter contains all required fields for the given schema.

```bash
pan-tools frontmatter validate path/to/plan.md --schema plan [--raw]
```

**Schemas and required fields:**

| Schema | Required Fields |
|--------|----------------|
| `plan` | `phase`, `plan`, `type`, `wave`, `depends_on`, `files_modified`, `autonomous`, `must_haves` |
| `summary` | `phase`, `plan`, `subsystem`, `tags`, `duration`, `completed` |
| `verification` | `phase`, `verified`, `status`, `score` |

**JSON output:**
```json
{
  "valid": true,
  "missing": [],
  "present": ["phase", "plan", "type", "wave", "depends_on", "files_modified", "autonomous", "must_haves"],
  "schema": "plan"
}
```

**`--raw` output:** `valid` or `invalid`. An invalid result still exits 0; any other `--schema` prints `Error: Unknown schema: <name>. Available: plan, summary, verification` on stderr and exits 1.

---

## 14. Template Operations

Commands for selecting and filling plan/summary/verification templates. `template fill` never overwrites: a file that exists exits 1 with `error: "File already exists"`, and a phase with no directory exits 1 with `error: "Phase not found"`. Its `--raw` output is the created path.

### `template select <plan-path>`

Select the optimal SUMMARY template based on a plan's complexity (task count, file count, decisions presence). It reports which of the `minimal`, `standard` or `complex` summary templates fits; no shipped workflow, command or agent calls it (executors write from `templates/summary.md`). An unreadable plan falls back to `standard` with an `error` string (exit `0`).

```bash
pan-tools template select .planning/phases/05-setup/05-01-plan.md [--raw]
```

**JSON output:**
```json
{
  "template": "templates/summary-standard.md",
  "type": "standard",
  "taskCount": 3,
  "fileCount": 5,
  "hasDecisions": false
}
```

**`--raw` output:** The template file path.

---

### `template fill summary --phase N [--plan M] [--name "..."] [--fields '{json}']`

Create a pre-filled summary.md file in the phase directory.

```bash
pan-tools template fill summary --phase 5 --plan 1 --name "Database Setup"
pan-tools template fill summary --phase 5 --fields '{"subsystem": "database"}'
```

**Flags:**
- `--phase N` — Phase number (required)
- `--plan M` — Plan number (default: `01`)
- `--name "..."` — Phase name override
- `--fields '{json}'` — Additional frontmatter fields to merge

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-01-summary.md", "template": "summary" }
```

---

### `template fill plan --phase N [--plan M] [--type execute|tdd] [--wave N] [--name "..."] [--fields '{json}']`

Create a pre-filled plan.md file in the phase directory. Its `## Context` names the phase's roadmap slice (`<phase dir>/<NN>-roadmap-slice.md`, written by `roadmap slice <N> --write`) instead of `@.planning/roadmap.md`.

```bash
pan-tools template fill plan --phase 5 --plan 2 --type tdd --wave 1
```

**Flags:**
- `--phase N` — Phase number (required)
- `--plan M` — Plan number (default: `01`)
- `--type execute|tdd` — Plan type (default: `execute`)
- `--wave N` — Wave number (default: `1`)
- `--name "..."` — Used only when the phase directory has no name part (e.g. `07/`): the frontmatter `phase` then takes the name's slug (`07-foo-bar`). With a named directory, `phase` comes from the directory (`05-setup`). The heading never uses the name (`# Phase 5 Plan 01: [Title]`).
- `--fields '{json}'` — Additional frontmatter fields to merge

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-02-plan.md", "template": "plan" }
```

---

### `template fill verification --phase N [--name "..."] [--fields '{json}']`

Create a pre-filled verification.md file in the phase directory.

```bash
pan-tools template fill verification --phase 5
```

**JSON output:**
```json
{ "created": true, "path": ".planning/phases/05-setup/05-verification.md", "template": "verification" }
```

---

## 15. Config Operations

Commands for managing `.planning/config.json` — the per-project configuration file.

### `config-ensure-section`

Creates `.planning/` if missing, then initializes `config.json` with defaults; the config file itself is left untouched if it already exists. Merges user-level defaults from `~/.pan-wizard/defaults.json` if available. Auto-detects Brave Search API key availability (`BRAVE_API_KEY` in the environment, or a `~/.pan-wizard/brave_api_key` file; `websearch` itself reads only the environment variable).

```bash
pan-tools config-ensure-section [--raw]
```

**JSON output (created):**
```json
{ "created": true, "path": ".planning/config.json" }
```

**JSON output (exists):**
```json
{ "created": false, "reason": "already_exists" }
```

**`--raw` output:** `created` or `exists`.

**Selected default config values** (see `buildConfigDefaults()` in `config.cjs` for the full set — it also writes `search_gitignored`, the two branch templates, `workflow.verifier`/`nyquist_validation`/`phase_record_compact`/`phase_gate` (`enforce`)/`mutation_gate` (`report`)/`mutation_floor` (`0.6`)/`review_mode` (`single`)/`cross_family_review` (`off`)/`worktree_isolation` (`false`), `hooks.guard` (`report`), `instructions` (`routing: off`), `cost.phase_budget_usd` (`20`), `budget.default_points`/micro thresholds/`max_usd_run`/`max_usd_day` (`null`), and the `commit`, `execution` and `routing` blocks):

| Key | Default | Description |
|-----|---------|-------------|
| `model_profile` | `"balanced"` | Agent model selection: `quality`, `balanced`, `budget` |
| `commit_docs` | `true` | Auto-commit planning docs after state changes |
| `parallelization` | `true` | Enable parallel wave execution |
| `branching_strategy` | `"none"` | Git branching: `none`, `phase`, `milestone` |
| `workflow.research` | `false` | Research before planning each phase (opt-in; a config that says `true` keeps it) |
| `workflow.plan_check` | `true` | Enable plan-checker agent verification loop |
| `workflow.ceremony` | `"auto"` | Right-sized ceremony (`size`): `auto` gives a precisely specified phase or quick task the lean path; `full` keeps the full ceremony without changing models (the `quality` profile also means full) |
| `workflow.lean_max_requirements` | `5` | The most tasks in one engine-written lean plan; a lean phase with more requirements is split into plans run in order, and above three times this (15) the phase goes to the planner |
| `workflow.phase_reports` | `{ enabled: false, open: false, theme: "auto", index: true }` | Opt-in HTML phase reports as a build deliverable. When `enabled`, the verify→complete gate, focus-auto checkpoints, and army INTEGRATE regenerate per-phase reports; the verify→complete gate and army's post-merge Phase 6 (LEARN) also rebuild the timeline index when `index` is set, while the focus-auto checkpoint rebuilds it whatever `index` says; default off. |
| `memory.auto_optimize` | (not written; absent = `true`) | Reconcile the always-loaded project memory automatically at the focus-auto checkpoint and the normal-flow session record. No-op when state.md is already lean. Set `false` to opt out and reconcile only via `memory optimize`. |
| `budget.enforce` | `false` | Make the spawn/point budget a hard stop. Advisory by default (tracked + surfaced, never stops a run). |
| `budget.verify_reserve` | `0.15` | Fraction of the spawn budget (0–0.5) held back for re-verification so it can't be starved. Surfaced as `new_work_budget_remaining` / `into_verify_reserve` always; a hard early stop (`budget_reserve_reached`) only under `budget.enforce` / `--enforce-budget`. Override per-run with `--verify-reserve`. |
| `cost.rates` | (built-in rate table) | Per-model `$/1M` overrides for cost estimates, e.g. `{ "<model-id>": { "input": 5, "output": 25, "cache_read": 0.5, "cache_write": 6.25, "cache_write_1h": 10 } }`. `cache_write` is the five-minute cache write; the optional `cache_write_1h` prices the one-hour share of a row that recorded the split, which otherwise bills at `cache_write`. The optional `long` block (`{ "above": 100000, "input": …, "output": …, "cache_read": …, "cache_write": …, "cache_write_1h": … }`) prices the part of a row recorded as `long_prompt` (requests whose prompt was over 100,000 tokens); `above` must be 100000, the figure the logger records at. An override row replaces the built-in row whole, so an override for a model with a long-prompt tier needs its own `long` block, or those requests bill at the base rates. Applied to both `cost append` and aggregate reporting, exactly as written. Precedence: this key, then a Claude Code managed `modelPricing` block (its `overrides` rows, times its `multiplier`), then the built-in table (times the managed `multiplier` when one is set). |
| `routing.max_escalations` | `1` | How many tiers a retry may climb under `resolve-model --attempt` (failure-tier escalation). `0` turns escalation off. |
| `cache.extra_files` | (not written; absent = no extra files) | Extra planning-root-relative docs to include in the cached context block, e.g. `["research/api-contract.md"]`. The built-in list is the *phase-model* spine (project/requirements/roadmap/state/standards), so a focus-model project measures an empty block. The block is what `cache prime`, `context-budget` and `hygiene scan` measure. It does not decide what the host caches: the host caches each agent's prompt prefix by itself. Entries are appended after the built-ins, so the `sha` of a project that sets nothing does not change; absolute paths, drive paths, and `..` segments are ignored. |
| `brave_search` | auto-detected | Brave Search API availability |

---

### `config-get <key.path>`

Read a value from `.planning/config.json`. Supports dot-notation for nested keys.

```bash
pan-tools config-get model_profile [--raw]
pan-tools config-get workflow.research [--raw]
```

**JSON output:** The value at the key path (could be string, boolean, number, object, or array).

**`--raw` output:** The value as a string; an object or array prints as JSON.

A key that is not set, including a default PAN applies without writing it (such as `memory.auto_optimize`, or `workflow.phase_gate` in a config written before that default existed), prints `Error: Key not found: <key>` on stderr and exits 1; a project with no config.json prints `Error: No config.json found at <path>` and exits 1. The command reads the file, not the effective value.

---

### `config-set <key.path> <value>`

Write a value to `.planning/config.json`. Supports dot-notation for nested keys. Automatically parses `true`/`false` as booleans and numeric strings as numbers. Creates config.json if it does not exist (`.planning/` must exist already; `config-ensure-section` creates both), and refuses (exit 1, stderr) when the existing file is valid JSON but not an object, when the value is missing, or when a key segment is `__proto__`, `constructor` or `prototype`.

```bash
pan-tools config-set model_profile quality [--raw]
pan-tools config-set workflow.research false [--raw]
pan-tools config-set parallelization true [--raw]
```

**JSON output:**
```json
{ "updated": true, "key": "workflow.research", "value": false }
```

**`--raw` output:** `key=value` string.

**Unknown keys.** A key path PAN does not read is still written, but the output gains a `warning` (also printed to stderr) naming it and the nearest known key: `unknown config key "workflow.auto_advnace": PAN does not read it; did you mean "workflow.auto_advance"?`. PAN checks the top-level key and, inside a known section such as `workflow` or `routing`, the key one level down. Sections that hold your own names (`model_overrides`, `effort_overrides`, `cost`, `cache`, `build`, `verification`, `concurrency`, `focus`, `memory`) are not checked below the top. `validate health` reports the same keys as `I006`. Keys that start with lowercase `x-` are user metadata and never warn.

---

## 16. Utility Commands

Standalone utility commands used across workflows.

### `version [--check]`

The version of the PAN core that is running and where it lives (market item M29). An install reads its `pan-wizard-core/VERSION`; a source checkout reads `package.json`.

```bash
pan-tools version                 # {version, core, install_dir, node}
pan-tools version --raw           # the version
pan-tools version --check         # … plus update: {state, latest, checked_at, cache}
pan-tools version --check --raw   # e.g. "3.31.0 (available, npm latest 3.32.0)"
```

`--check` reads the result the update-check hook last cached (`<runtime home>/cache/pan-update-check.json`) and never touches the network, so it is instant and works offline. `state` is `available`, `current`, `ahead` (this core is newer than npm's latest, such as a prerelease or a source checkout), `offline` (the last check could not reach npm) or `unchecked` (no check has run yet). The cache comes from this install's runtime home (`~/.copilot` for a `.github` install, `~/.config/opencode` for `.opencode`), else the newest any runtime wrote.

### `resolve-model <agent-type>`

Get the model name for an agent based on the current model profile in config. The model profile (`quality`/`balanced`/`budget`) determines which model tier each agent type uses.

```bash
pan-tools resolve-model pan-executor [--metadata '<json>'] [--attempt <n>] [--raw]
# --metadata: {phaseNum, fileCount, waveCount, requirementCount, isArchitectural, context_estimate, needs_thinking, cache_warm}
#             enables the roadmap per-phase tier, complexity routing (routing.strategy: complexity) and the capability hints
# --attempt:  1 for a first try; each later attempt follows a failure and climbs one tier
```

**Failure-tier escalation (`--attempt`):** a retry of work that already failed on a cheaper tier climbs one step up `fast → mid → reasoning` per failed attempt, capped by `routing.max_escalations` (default `1`; `0` turns it off) and never above the agent's own `quality` tier. Under `quality` and `balanced` every agent already runs on the reasoning tier, so the flag changes nothing there; it is the `budget` profile's retry path. A `model_overrides` entry or a roadmap per-phase tier is an explicit choice and is never escalated. With `--attempt`, a registered agent's JSON gains `attempt` and `escalated_from` (the tier it climbed from, or `null`); an unknown agent's carries neither. A value that is not a positive integer is an error. `/pan:exec-phase --gaps-only` resolves its executor as attempt 2.

**Agent types:** any key in `MODEL_PROFILES` (`core.cjs`) — the shipped `pan-*` agents, listed in the matrix below. The argument is not validated against an allowlist: a name that isn't in the table resolves to the mid tier and sets `unknown_agent: true` rather than erroring.

**JSON output:**
```json
{ "model": "inherit", "profile": "balanced", "strategy": "static", "effort": "high" }
```

For unknown agents: `{ "model": "sonnet", "profile": "balanced", "strategy": "static", "effort": "medium", "unknown_agent": true }` — unknown agents get the mid tier regardless of profile (`sonnet` under Anthropic; the detected provider's mid-tier id otherwise), and effort still follows the profile and `effort_overrides`. Invalid `--metadata` JSON is ignored (static routing), not an error.

**Under OpenCode:** the copy of PAN installed under `.opencode/` (or `~/.config/opencode/`) resolves provider-qualified ids — the provider, a slash, and the model's models.dev id, such as `openai/<model>` for an OpenAI tier (the table is `OPENCODE_MODELS` in `core.cjs`) — because OpenCode names every model `provider/model`. With `routing.provider` unset or `auto` (the default) and no `PAN_PROVIDER`, the provider is the one in OpenCode's own configured `model` (`opencode.json` at the project root, then `.opencode/opencode.json`) when it is `anthropic`, `openai` or `google`, and otherwise the runtime-directory detection's (`.opencode/` alone counts as OpenAI); the reasoning tier stays `inherit`.

**`--raw` output:** Model name string (e.g., `inherit`, `sonnet`, `haiku`). `inherit` means "use the model the session was launched with" — PAN does not name a model here, so it never goes stale as the lineup moves.

**Effort (2026-06):** alongside the tier, every agent resolves to a reasoning-effort level (`low`/`medium`/`high`/`xhigh`) — the primary within-model cost/intelligence dial on current models (it replaced fixed thinking budgets). Base levels per agent mirror the `effort:` frontmatter shipped in `agents/*.md`; the `budget` profile steps effort down one level (floor `low`); `quality`/`balanced` keep the base. Override per agent via `.planning/config.json` → `"effort_overrides": { "pan-planner": "xhigh" }`.

**Model profile matrix** (cost reset 2026-07; right-sized ceremony 2026-10):

| Agent | Quality | Balanced | Budget |
|-------|---------|----------|--------|
| planner, designer, roadmapper, executor, debugger, conductor, counterfactual | inherit | inherit | sonnet |
| the two researchers (phase and project) and the plan-checker | inherit | sonnet | haiku |
| every other registered agent — the doc writer, the verifier and the other checkers, and the review/support roster | inherit | inherit | haiku |

`quality` is `inherit` for **every** agent. `balanced` differs from it only on the plan-checker and the researchers, which it runs on the mid tier (the right-sized ceremony, `docs/specs/right-sized-ceremony.md`); `budget` down-tiers every agent. `inherit` → the reasoning tier, i.e. the model the session was launched with; `sonnet` → mid tier; `haiku` → fast tier (the `sonnet`/`haiku` names are the Anthropic mapping — `PROVIDER_MODELS` in `core.cjs` substitutes the equivalent for OpenAI/Google projects, and `inherit` is the reasoning tier on every provider). Derived from `MODEL_PROFILES` in `core.cjs` — that table is the source of truth.

---

### `commit <message> [--files f1 f2] [--amend] [--type TYPE] [--force] [--fail-on-error]`

Commit planning docs to git. Respects `commit_docs` config setting and `.gitignore`. Includes safety checks for deleted and sensitive files.

```bash
pan-tools commit "Phase 5 planning complete" [--raw]
pan-tools commit "Update plans" --files .planning/phases/05-setup/05-01-plan.md
pan-tools commit "" --amend
pan-tools commit "add-feature" --type feat
pan-tools commit "bugfix" --type fix --force
```

**Arguments:**
- `<message>` — Commit message (required unless `--amend`)
- `--files f1 f2 ...` — Specific files to stage (default: `.planning/`); the list ends at the next flag
- `--amend` — Amend the previous commit instead of creating a new one
- `--type TYPE` — Conventional commit type prefix. Valid: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`. Prepends `type: ` to message.
- `--force` — Skip deleted-file safety check
- `--fail-on-error` — Report a git refusal (e.g. missing identity) as a bare `error()` on **stderr** instead of a `commit_failed` JSON body on stdout. Both exit non-zero, so autonomous loops detect the silent-failure case where the artifact never actually landed either way; the flag only changes which stream carries the reason. (`nothing_to_commit` has no `error` key and is still a success at exit `0`.)

**Safety checks** (enabled by default via `config.commit.safety_checks`):
- **Deleted files:** Blocks a commit that would delete a file: a deletion staged in the index, whether this call staged it (a deleted path in `--files`) or it was staged before (use `--force` to override). An unstaged deletion elsewhere in the tree is not part of the commit and does not block it
- **Sensitive files:** Blocks commit if a staged file's name matches a sensitive pattern. The defaults match the basename: `.env` and `.env.*` (not `.env.example`, `.env.sample` or `.env.template`), `*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa`/`id_ed25519`/`id_ecdsa`/`id_dsa` (the `.pub` half commits), `credentials` and `credentials.*`, `.npmrc`, `.netrc`, `.pypirc`, and `secret(s).yaml|yml|json|env`. A file merely named for a secret (`docs/secret-rotation.md`, `src/token-utils.ts`) commits. `config.commit.sensitive_patterns` replaces the list; each pattern is tried on the basename and on the whole path, so a custom pattern such as `^private/` works as before. A config.json holding the pre-3.42 default list verbatim is read as today's defaults (`validate health` reports it as I007). PAN's own cost ledger, `.planning/metrics/tokens.jsonl`, is exempt
- **Sensitive content:** Blocks commit if an added or modified staged file contains a credential: a provider token or private-key shape, or a key-value secret (`api_key = "…"`, `client_secret: …`) whose value is 12 or more characters mixing letters and digits and is not a placeholder. Binary files and files over 512 KiB are not scanned. `safety_checks.sensitive_content_blocked` lists `{file, rule}`; the value itself is never printed

**JSON output:**
```json
{
  "committed": true,
  "hash": "abc1234",
  "reason": "committed",
  "type": "feat",
  "safety_checks": { "deleted_files": [], "sensitive_files_blocked": [], "sensitive_content_blocked": [] }
}
```

**Block reasons:** `deleted_files_detected`, `sensitive_file_detected`, `sensitive_content_detected`.

**Skip reasons:** `skipped_commit_docs_false`, `skipped_gitignored`, `nothing_to_commit`, `not_a_git_repo` (exit 0, with a `hint`). A blocked commit exits 1 with `error: commit_blocked`; PAN un-stages what it staged itself (`safety_checks.unstaged_by_pan`) and leaves anything you had staged beforehand untouched.

**`--raw` output:** The short hash, `skipped`, `blocked`, `nothing`, `not a git repo`, or `failed`.

---

### `rollback-snapshot <phase>`

Create a git tag snapshot before execution for easy rollback. Tag format: `pan-rollback-{phase}-{timestamp}` (dots in a decimal phase become dashes, e.g. `pan-rollback-5-1-…`; a colliding tag gets a `-1` suffix).

```bash
pan-tools rollback-snapshot 5 [--raw]
pan-tools rollback-snapshot 5.1
```

**JSON output:**
```json
{ "tag": "pan-rollback-5-20260301T120000", "hash": "abc1234", "phase": "5" }
```

**Not a git repo (or no commits):** Returns `{ "tag": null, "hash": null, "phase": "5", "warning": "Not a git repository or no commits" }` (exit 0; `--raw` prints nothing). When neither tag name can be created, `tag` is `null` with `warning: "Failed to create tag: …"`, also at exit 0.

**`--raw` output:** The tag name.

---

### `estimate-cost`

Estimate relative cost multipliers for each model profile. Shows total and average cost across all agents.

**Module:** `commands.cjs`

```bash
pan-tools estimate-cost [--raw]
```

**JSON output (numbers shown are illustrative — actual counts depend on registered agents):**
```json
{
  "estimates": [
    { "profile": "quality", "total": <N>, "average": 15.0, "agentCount": <N> },
    { "profile": "balanced", "total": <N>, "average": 13.4, "agentCount": <N> },
    { "profile": "budget", "total": <N>, "average": 1.6, "agentCount": <N> }
  ]
}
```

Each agent counts at its tier's multiplier for the profile (`COST_MULTIPLIERS` in `core.cjs`; the reasoning tier is 15×). `quality` puts every agent on the reasoning tier, so its average is 15×; `balanced` runs the plan-checker and the two researchers on the mid tier, so it sits a little below; `budget` down-tiers every agent.

**`--raw` output:** One line per profile: `quality: ~15x baseline (<N> agents)`.

---

### `generate-slug <text>`

Convert arbitrary text to a URL-safe slug.

```bash
pan-tools generate-slug "Database Migration Layer" [--raw]
```

**JSON output:**
```json
{ "slug": "database-migration-layer" }
```

**`--raw` output:** The slug string.

**Rules:** Lowercase; every run of non-alphanumeric characters (spaces, underscores, punctuation) becomes a single hyphen; leading and trailing hyphens are trimmed.

---

### `current-timestamp [format]`

Get the current timestamp.

```bash
pan-tools current-timestamp            # full (default)
pan-tools current-timestamp date       # YYYY-MM-DD
pan-tools current-timestamp filename   # YYYY-MM-DDTHH-MM-SS (no colons)
```

**Formats:**

| Format | Output | Example |
|--------|--------|---------|
| `full` | ISO 8601 | `2026-02-27T12:00:00.000Z` |
| `date` | Date only | `2026-02-27` |
| `filename` | Filesystem-safe | `2026-02-27T12-00-00` |

Any other format value is read as `full`.

**JSON output:**
```json
{ "timestamp": "2026-02-27T12:00:00.000Z" }
```

**`--raw` output:** The timestamp string.

---

### `verify-path-exists <path>`

Check whether a file or directory exists.

```bash
pan-tools verify-path-exists src/index.ts [--raw]
```

**JSON output:**
```json
{ "exists": true, "type": "file" }
```

Type is `file`, `directory`, or `other`. If not found: `{ "exists": false, "type": null }`.

**`--raw` output:** `true` or `false`.

---

### `history-digest`

Aggregate data from all summary.md files across current and archived phases. Extracts dependency graphs, decisions, patterns, and tech stack.

```bash
pan-tools history-digest [--raw]
```

**JSON output:**
```json
{
  "phases": {
    "05-setup": {
      "name": "setup",
      "provides": ["auth-module", "db-schema"],
      "affects": ["api-routes"],
      "patterns": ["repository-pattern"]
    }
  },
  "decisions": [
    { "phase": "05-setup", "decision": "Use PostgreSQL for primary storage" }
  ],
  "tech_stack": ["typescript", "express", "postgresql"]
}
```

Phases are keyed by each summary's `phase` frontmatter (`05-setup` in the summary templates; the directory's number when a summary has none), and `name` is the directory's name part with hyphens as spaces unless the summary sets `name:`. `provides` and `affects` read a nested `dependency-graph` list or the flat list the summary templates write.

**Note:** Uses the `@file:` protocol if the digest exceeds 50 KB.

---

### `summary-extract <path> [--fields f1,f2]`

Extract structured data from a summary.md file's frontmatter. `one_liner` comes from a `one-liner` frontmatter key when there is one, else from the bold line under the `# Phase … Summary` title, which is where the summary templates put it.

```bash
pan-tools summary-extract .planning/phases/05-setup/05-01-summary.md
pan-tools summary-extract path/to/summary.md --fields key_files,decisions
```

**Arguments:**
- `<path>` — Relative path to summary.md
- `--fields f1,f2,...` — Comma-separated list of fields to extract (optional; returns all if omitted)

**Available fields:** `one_liner`, `key_files`, `tech_added`, `patterns`, `decisions`, `requirements_completed`

**JSON output:**
```json
{
  "path": ".planning/phases/05-setup/05-01-summary.md",
  "one_liner": "Built authentication module with JWT support",
  "key_files": { "created": ["src/auth/index.ts"], "modified": ["src/auth/jwt.ts"] },
  "tech_added": ["jsonwebtoken"],
  "patterns": ["middleware-chain"],
  "decisions": [{ "summary": "Use JWT", "rationale": "Stateless auth for API" }],
  "requirements_completed": ["REQ-03"]
}
```

---

### `websearch <query> [--limit N] [--freshness day|week|month|year]`

Search the web via the Brave Search API. Requires `BRAVE_API_KEY` environment variable. This is the only async command in pan-tools.

```bash
pan-tools websearch "Node.js stream backpressure" --limit 5 --freshness week
```

**Arguments:**
- `<query>` — Search query string
- `--limit N` — Max results (default: 10)
- `--freshness day|week|month|year` — Recency filter, sent to Brave as `pd`/`pw`/`pm`/`py`; those codes and a `YYYY-MM-DDtoYYYY-MM-DD` range also pass through as given. Any other value is refused with an error (exit 1) before a request is made

**JSON output:**
```json
{
  "available": true,
  "query": "Node.js stream backpressure",
  "count": 5,
  "results": [
    {
      "title": "Understanding Node.js Streams",
      "url": "https://example.com/...",
      "description": "A deep dive into...",
      "age": "2 days ago"
    }
  ]
}
```

If `BRAVE_API_KEY` is not set: `{ "available": false, "reason": "BRAVE_API_KEY not set" }` (exit 0: callers fall back to their own search). With a key, a missing query, an invalid `--freshness`, an API error status or a network failure is `{ "available": false, "error": … }` and exits 1. **`--raw` output:** each result's title, URL and description, results separated by a blank line.

---

## 17. Compound Init Commands

These commands gather all context needed for a specific workflow in a single call, avoiding multiple round trips. Each init command checks file existence, reads state (most also resolve the models their workflow spawns), and returns a comprehensive JSON object that the workflow's command `.md` file consumes.

All init commands accept `--raw` (no effect — init output is always JSON) and `--cwd <path>`.

### `init execute-phase <phase> [--dry-run] [--budget N]`

All context for the execute-phase workflow. Includes tier classification, budget tracking, and execution mode.

```bash
pan-tools init execute-phase 5 [--raw]
pan-tools init execute-phase 5 --dry-run
pan-tools init execute-phase 5 --budget 30
pan-tools init execute-phase 5 --dry-run --budget 25
```

**Arguments:**
- `--dry-run` — Preview execution plan without spawning agents. Sets `dry_run: true` in output.
- `--budget N` — Override budget points (default: `budget.default_points` from config.json, 50 when unset; a value that is not a number or is below 1 is an error, above 200 is capped at 200). Plans exceeding budget set `budget_exceeded: true`.

**Key output fields:**
- `executor_model`, `verifier_model`, `reviewer_model` — Resolved model names
- `verifier_enabled` — `workflow.verifier`; when `false`, exec-phase and the native `pan-exec-waves` skip the verifier and say so
- `commit_docs`, `parallelization`, `worktree_isolation`, `branching_strategy` — Config flags
- `plan_check` — the phase's plan-check status (`verify plan-set`: `{status: ok|stale|failed|missing|legacy|disabled, …}`; `null` when the phase is not found); exec-phase stops on `stale`, `failed` or `missing`
- `plan_drift` — the planned files changed since each plan's `planned_commit` (`verify plan-set`'s `drift`)
- `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug` — Phase info
- `plans`, `summaries`, `incomplete_plans`, `plan_count`, `incomplete_count` — Plan inventory
- `branch_name` — Pre-computed branch name (if branching enabled)
- `milestone_version`, `milestone_name`, `milestone_slug` — Milestone info
- `state_exists`, `roadmap_exists`, `config_exists` — File existence checks
- `phase_req_ids` — Requirement IDs extracted from roadmap.md
- `plans_by_tier` — Tier breakdown: `{ micro: N, standard: N, full: N }`
- `total_budget_points` — Budget limit for this execution
- `estimated_points` — Total effort points (XS=1, S=2, M=4, L=10, XL=20)
- `budget_exceeded` — `true` if estimated > budget
- `execution_mode` — Execution ordering strategy (default: `wave_order`)
- `dry_run` — Whether this is a preview-only run
- `rollback_tag` — always `null` (the tag is created separately by `rollback-snapshot`)

---

### `init plan-phase <phase>`

All context for the plan-phase workflow.

```bash
pan-tools init plan-phase 5 [--raw]
```

**Key output fields:**
- `researcher_model`, `planner_model`, `checker_model` — Resolved model names
- `research_enabled`, `plan_checker_enabled`, `commit_docs` — Workflow flags
- Phase info, existing artifacts (`has_research`, `has_context`, `has_plans`)
- `context_path`, `research_path`, `verification_path`, `uat_path` — Existing file paths
- `phase_req_ids` — Requirement IDs extracted from roadmap.md

---

### `init new-project`

All context for the new-project workflow. Includes brownfield detection.

```bash
pan-tools init new-project [--raw]
```

**Key output fields:**
- `researcher_model`, `roadmapper_model` — Model names
- `project_exists`, `has_codebase_map`, `planning_exists` — Existing state
- `has_existing_code`, `has_package_file`, `is_brownfield`, `needs_codebase_map` — Brownfield detection
- `has_git` — **runs `git init` when the project is not yet a repository** and reports the result; `brave_search_available` — environment detection; `shared_planning_tree` — `{tool, evidence}` when another tool shares the planning tree (planning-with-files), else `null`. A tree another tool owns (gsd-core) is refused instead: `{error, evidence, fix}` at exit 1.

---

### `init new-milestone`

All context for the new-milestone workflow.

```bash
pan-tools init new-milestone [--raw]
```

**Key output fields:**
- `researcher_model`, `roadmapper_model` — Model names
- `current_milestone`, `current_milestone_name` — Current milestone info
- File existence checks for project.md, roadmap.md, state.md

---

### `init quick <description>`

All context for the quick task workflow.

```bash
pan-tools init quick "Fix login button alignment" [--raw]
```

**Key output fields:**
- `planner_model`, `executor_model`, `checker_model`, `verifier_model` — Model names
- `next_num`, `slug`, `description` — Quick task identifiers
- `date`, `timestamp` — Current date/time
- `quick_dir`, `task_dir` — Computed paths

---

### `init resume`

All context for the resume-project workflow.

```bash
pan-tools init resume [--raw]
```

**Key output fields:**
- `state_exists`, `roadmap_exists`, `project_exists`, `planning_exists` — File existence
- `has_interrupted_agent`, `interrupted_agent_id` — Agent state recovery
- `commit_docs` — Config
- `open_work` — Work started and not finished: `{in_flight, phase_plans: [{phase, plan, current}], quick: [{dir, plan, source: "focus"|"quick", kind?, run_id?, opened_at?}], debug: [{file}], continue_here: [{path}], pauses: [{id, kind, run, step, question, expects, created_at, expires_at}]}`. `phase_plans` lists every phase's plans with no summary, `current` marking the phase state.md names; a plan with a step journal or `PAN-Step` task commits adds `resume_at`, `completed_steps` (`[{step, source, commit|file}]`) and `unverified_steps` (`[{step, why}]`), from `journal resume-point`; when the task commits could not be read, every unfinished plan also carries `trailer_scan` (`{error: "trailer_scan_failed", reason}`). `in_flight` gives the answer the guard's `unrouted_write` rule uses: an unfinished plan in the current phase, an open quick task (a focus cycle included), or a debug session

---

### `init verify-work <phase>`

All context for the verify-work workflow.

```bash
pan-tools init verify-work 5 [--raw]
```

**Key output fields:**
- `planner_model`, `checker_model` — Model names
- Phase info, `has_verification` — Existing artifacts

---

### `init phase-op <phase>`

Generic phase operation context. Falls back to roadmap.md if no directory exists.

```bash
pan-tools init phase-op 5 [--raw]
```

**Key output fields:**
- `commit_docs`, `brave_search` — Config flags
- Phase info, existing artifacts (`has_research`, `has_context`, `has_plans`, `has_verification`)
- `context_path`, `research_path`, `verification_path`, `uat_path` — File paths (if found)

---

### `init todos [area]`

All context for todo workflows.

```bash
pan-tools init todos [--raw]
pan-tools init todos refactoring [--raw]
```

**Key output fields:**
- `todo_count`, `todos[]` — Todo inventory
- `area_filter` — Applied area filter
- `pending_dir`, `completed_dir` — Directory paths
- `pending_dir_exists`, `todos_dir_exists` — Directory existence

---

### `init milestone-op [--track <name>] [--all-tracks]`

All context for milestone operations. Backs `/pan:milestone-audit`.

```bash
pan-tools init milestone-op [--raw]
pan-tools init milestone-op --track core
pan-tools init milestone-op --all-tracks
```

**Key output fields:**
- `planning_root`, `track`, `planning_root_source`, `planning_root_exists` — which tree this came from
- `milestone_version`, `milestone_name`, `milestone_slug` — Current milestone
- `milestone_status`, `milestone_basis`, `milestone_ambiguous`, `milestone_candidates` — **how** the milestone was decided
- `phase_count`, `completed_phases`, `all_phases_complete` — Phase progress
- `archived_milestones[]`, `archive_count` — Archive info

**`milestone_basis`** is one of `marked-current` (an explicit `(current)` / 🚧 marker), `first-unshipped`, `last-shipped` (the highest label when every milestone is shipped), `state` (no milestone heading, so the `milestone:` recorded in state.md's front matter), `default` (no roadmap), or `no-milestone-heading` (no heading and nothing recorded). It exists so a caller can tell a real `v1.0` from a fallback.

A milestone heading carries a version (`v4.1`) anywhere in its text, or a letter-series label (`R-2`, `AB-C`) as its **first word** — after status glyphs and an optional "Milestone". A heading repeated later in the roadmap (a traceability or archive section) counts once.

**`milestone_ambiguous: true`** means the roadmap marks more than one milestone current — a planning-state error. The audit workflow stops rather than picking one, because auditing a silently-chosen milestone is how a report ends up describing a milestone that does not exist.

**`--all-tracks`** returns `{all_tracks, track_count, ambiguous_tracks[], tracks[]}` — one full payload per planning tree, each labelled with its own `track` and `planning_root`. Use it to see every tree's milestone state before choosing which to audit.

---

### `init map-codebase`

All context for the map-codebase workflow.

```bash
pan-tools init map-codebase [--raw]
```

**Key output fields:**
- `mapper_model` — Resolved model name
- `search_gitignored`, `parallelization` — Config flags
- `existing_maps[]`, `has_maps` — Existing codebase maps

---

### `init progress`

All context for the progress workflow.

```bash
pan-tools init progress [--raw]
```

**Key output fields:**
- `executor_model`, `planner_model` — Model names
- `milestone_version`, `milestone_name` — Milestone info
- `phases[]`, `phase_count`, `completed_count`, `in_progress_count` — Phase overview
- `current_phase`, `next_phase`, `paused_at`, `has_work_in_progress` — Current state

---

## 18. Focus Commands

Strategic project management: work item scanning, capacity budgeting, documentation sync, and execution pipelines.

**Module:** `focus.cjs`

### `focus scan`

Collect, classify, and sort all work items from phases, todos, and error patterns.

```bash
pan-tools focus scan [--lean] [--raw]
```

**Sources scanned:**
- Phase plans (roadmap.md + phase directory plan.md frontmatter)
- Pending todos (`.planning/todos/pending/`)
- Error patterns (`.planning/patterns.md`)

**Key output fields:**
- `items[]` — Sorted work items (priority, then smallest effort first) with `id`, `title`, `source`, `priority`, `effort`, `points`, `status`, `file`, and a `realityScore` on P3–P6 items
- `sources` — Count per source type: `{phases, todos, patterns}`
- `total` — Total item count
- `priorities` — Count per priority level: `{P0: N, P1: N, ...}`
- `source_todos` — `{count, items[{file, line, tag, text}]}`: `TODO`/`FIXME`/`XXX`/`HACK` markers in `pan-wizard-core/bin/lib/*.cjs` under the project root, so `{count: 0, items: []}` in any project other than the PAN source tree. Not added to `items`

When no work item is found it prints `{items: [], sources, total: 0, message: "No work items found"}` instead, with no `priorities` or `source_todos`.

**Flags:**
- `--lean` — Filter items with Reality Score < 1.5 (only affects P3-P6 items)

### `focus plan`

Create a capacity-budgeted execution batch from scanned items.

```bash
pan-tools focus plan [--budget N] [--mode MODE] [--priority P0-P6] [--lean] [--raw]
```

**Modes:**
| Mode | Budget | Algorithm |
|------|--------|-----------|
| `bugfix` | at most 40 pts | Single greedy pass over P0 → P4 in priority order (P5–P6 excluded; no item-type filter) |
| `balanced` | 50 pts | 60% stability (P0–P2), then 40% features (P3–P6) |
| `features` | 50 pts | P0 first (mandatory), then what that pass left splits 80% features (P3–P5) / 20% stability (P1–P2) |
| `full` | at least 60 pts | One greedy pass over all priorities in priority order (P0 first, smallest effort first within a priority) |

`--budget` defaults to 50 and is ignored outside 5–100; `bugfix` caps it at 40 and `full` raises it to 60. `--mode` defaults to `balanced`. `--priority P<n>` keeps only items at that priority or higher (P0 is highest). `--lean` drops P3–P6 items with a Reality Score below 1.5. With no work item it prints `{error: "No work items found. …"}` and exits 0, writing nothing.

**Key output fields:**
- `mode`, `budget`, `allocated` — Budget allocation
- `items_selected`, `items_remaining` — Batch sizing
- `batch[]` — Selected items with a `tier` field, plus a `track` (`mandatory`, `stability` or `feature`) in `balanced` and `features` mode
- `batch_file` — Path to saved batch JSON
- Each `batch[]` item carries its `owner` (`phase` or `focus`, see `focus route`)

**Writes:** `.planning/focus/batch-YYYY-MM-DD.json` (a second plan the same day overwrites it)

### `focus sync`

Check documentation staleness: the first "N commands", "N agents" and "N modules" in `README.md`, `docs/DEVELOPMENT.md`, `docs/CLI-REFERENCE.md`, `docs/USER-GUIDE.md` and `docs/ARCHITECTURE.md` against the files in `commands/pan/`, `agents/` and `pan-wizard-core/bin/lib/` (each check runs only when its directory exists, so an installed project skips them), plus renamed `/pan:` command names and the `package.json` version against the newest `CHANGELOG.md` heading. Read-only.

```bash
pan-tools focus sync [--check-only] [--tests N] [--suites N] [--raw]   # --tests/--suites supply live counts to reconcile against the docs
```

**Key output fields:**
- `actuals` — `{commands, agents, modules}` actual counts (0 for a directory that does not exist)
- `stale[]` — Stale entries: `{file, entity, documented, actual}` for a count or the version, `{file, entity: "renamed_command", old, new}` for an old command name
- `current[]` — Entries that match, `{file, entity, count}`
- `stale_count`, `needs_sync`, `check_only` — Summary

### `focus exec`

Load the newest batch in `.planning/focus/` and classify its items by execution tier. Newest means the date in the file name (`batch-YYYY-MM-DD.json` from `focus plan`, or `batch-YYYY-MM-DD-<slug>.json`), then the time the file was written for batches from the same day. That is the batch `/pan:focus-auto --step exec` runs. The items come from a `batch` array, or from `items`, which `/pan:focus-auto` and agent-written batches use. A newest batch with neither list, or one that is not valid JSON, is refused with an error that names the file; an older batch never stands in. No batch file, or an empty item list, also prints an `error` instead of the fields below; every refusal exits 1.

```bash
pan-tools focus exec [--dry-run] [--force] [--raw]   # in a git repository, refuses with dirty_working_tree (and uncommitted_count) on uncommitted changes unless --dry-run or --force
```

**Key output fields:**
- `dry_run` — Whether this is a preview
- `mode`, `budget`, `allocated` — From batch
- `total_items` — Items in batch
- `tiers` — `{micro, standard, full}` counts
- `items[]` — Full batch items
- `batch_file` — The batch file that was read

**Reads:** The newest `.planning/focus/batch-*.json`

### `focus auto`

Auto-runner state management: initialize, status, update, stop.

```bash
pan-tools focus auto [--source scan|backlog] [--category CAT] [--mode MODE] [--budget N] [--max-cycles N] [--enforce-budget] [--verify-reserve F] [--deep-review]
                     [--total-budget N] [--parallel-research] [--parallel-verify] [--clean-seal]
                     [--status] [--stop] [--update] [--continue] [--dry-run] [--raw]
```

**Categories:** cleanup (P3-P5), tests (P2-P5), stability (P0-P2), features (P3-P5), docs (P5-P6), optimize (P1-P4), prompts (P0-P6), security (P0-P2), distill (P1-P5)

**Work source (ADR-0031):** `--source scan` (default) selects work by category code-scan; `--source backlog` ranks actionable `roadmap.md`/`requirements.md` items by value/effort. `--parallel-research`/`--parallel-verify` fan those stages out via the Workflow tool (implement/exec stays serial); `--clean-seal` runs one clean build + full verification after the last item. All default off.

**Operations:**
- Default: Initialize new auto-run with category defaults (no `--category`: mode `balanced`, budget 50, all priorities). Refused while another focus run is `initialized` or `in_progress`. Defaults: `--max-cycles` 10 (1–50), `--total-budget` 500 (5–5000), `--budget` per category (5–100). Refused with `autodev_active` (exit 1, the run in `run`) while the newest autodev run has not stopped and recorded something within `focus.stale_hours`; `--continue` is refused the same way
- `--status`: Show current run state with computed budget/cycles remaining, `stale` (the run is `initialized` or `in_progress` and its newest record, the last cycle or the start, is older than `stale_hours`: `focus.stale_hours`, default 12), and `unrecorded_cycles`: closed focus cycles of this run that no `--update` recorded (a crash between the close and the update)
- `--update`: Record cycle results (pass `--items-completed`, `--items-failed`, `--points-used`, `--tests-before`, `--tests-after`, `--batch-file`, `--command`, and — for the `prompts` category — `--prompts-remaining N`). `focus open` names its cycle in the run's `current_cycle`, and `--update` records that cycle and no other: the item counts, its `status` and its `regressions` come from its summary instead of the flags, and so do both test counts when the cycle measured them (`tests_verified: true`); the cycle's directory goes in `cycle_dir`. Test counts that come from the flags are re-measured with `node --test` when `focus.verify_tests` is on, else recorded with `tests_verified: false`. While that cycle is still open, `--update` exits 1. A cycle with a regression stops the run (`regression`), and a failed cycle or one whose items all failed stops it as `stopped` (`cycle_failed`, `all_failed`), resumable with `--continue`; `zero_completed` is left for a cycle that attempted nothing. **Side effect:** in a git repository, each update runs the memory auto-optimize, regenerates the HTML reports when `workflow.phase_reports.enabled`, and checkpoint-commits `.planning/` (`commit_hash` in the output). None of the three happens when `focus.auto_commit` or `commit_docs` is false, or outside a git repository
- `--stop`: Gracefully stop an active run; the run's own cycle, if still open, is closed as `failed` (`closed_cycle` in the output). A cycle the run did not open is left alone
- `--continue`: Resume a stopped/initialized run
- `--dry-run`: Show what would be initialized without writing

**Stop conditions (auto-detected on --update):**
- `regression` — the cycle ended with fewer passing tests than it started with, or its summary records a regression
- `budget_cap` — cumulative points reached `--total-budget`; fires only when enforcement is on (`--enforce-budget` or config `budget.enforce`) — the budget is advisory otherwise
- `budget_reserve_reached` — under enforcement, spend crossed into the verify reserve (`--verify-reserve`, default `budget.verify_reserve`)
- `security_complete` / `distill_complete` — a cycle completed nothing in that category (the category-specific form of `zero_completed`)
- `prompts_complete` — the `prompts` category has no prompts remaining
- `max_cycles` — iteration limit reached
- `zero_completed` — no items completed in a cycle
- `diminishing_returns` — optimize only: items per point fell below 30% of the previous cycle's
- `weekly_limit` — a fresh `cost limits` reading puts Claude Code's 7-day usage window at or past `cost.weekly_limit_stop_pct` (default 90; `0` turns it off). Like `regression`, the run is stopped rather than completed, and `--continue` resumes it

**State file:** `.planning/focus/auto-run.json`

---

### `focus route`

Decide who owns each item of a batch, so a focus run never does the phase system's work. A roadmap phase (`phase-N`, `source: phase`), a plan inside one (a `file` under `.planning/phases/`), and a requirement that requirements.md's traceability table maps to a phase belong to the phase system. Everything else is focus's: a requirement the table maps to no phase or does not list (executed, its checkbox left alone), a todo, a pattern, a scan, docs or debt item.

```bash
pan-tools focus route [--batch <file>] [--raw]
```

- `--batch`: a path, or a name under `.planning/focus/`. Default: the newest batch
- Stamps `owner` on each item, and records each hand-off as `results[id] = "routed"` and `routes[id] = {phase, command, reason}`, keeping the batch file's modification time
- A hand-off's `command` is `/pan:exec-phase N` when the phase has plans, else `/pan:plan-phase N`; `/pan:progress` when the item names no phase

`focus open` applies the same split itself, so routing first only makes the hand-offs visible; it is never what keeps phase work out of a cycle.

**JSON output:** `{ batch_file, execute: [ids], handoff: [{id, title, phase, command, reason}] }`

**Refusals (exit 1):** `no_batch`, `batch_not_found`, `batch_unusable`, `batch_unwritable`.

**`--raw` output:** `<n> execute, <n> handoff`.

---

### `focus open`

Register a focus cycle as a quick task before its first edit. Creates `.planning/quick/<n>-focus-<kind>-<date>/<n>-plan.md`, numbered after the newest quick task (the same numbering `init quick` gives `/pan:quick`). An open quick plan counts as work in flight, so state.md, resume and the guard's `unrouted_write` rule see the cycle. For an `exec` cycle it runs the project's test command once (the one `test run` uses), records the pass count as `tests_before`, and, when the project has a test command, keeps the whole record, failing tests included, as `<n>-test-baseline.json` for the close to compare against. Inside a live auto run it sets the run's `current_cycle`.

```bash
pan-tools focus open [--batch <file>] [--kind exec|docs] [--run <run_id>] [--raw]
```

- `--batch`: a batch file, as a path or a name under `.planning/focus/`. Default: the newest batch. A `docs` cycle needs none
- `--kind`: `exec` (default) or `docs`. A docs cycle runs no tests
- `--run`: the auto run the cycle belongs to. Default: the run in `auto-run.json` while it is `initialized` or `in_progress`

The cycle registers only the items focus owns (`focus route`); the phase-owned ones come back in `handoff`. The plan's frontmatter carries `source: focus`, `focus_kind`, `batch_file`, `run_id`, `category`, `items` (the ids of the focus-owned items), `files_modified` (the items' `file`/`files` values, leaving out pointers into `.planning/`), `tests_before`, `test_command` and `opened_at`.

**JSON output:** `{ opened, num, kind, dir, plan, batch_file, run_id, items, handoff: [{id, phase, command}], files_modified, tests_before, test_status, test_command }`

**Refusals (exit 1):** `cycle_open` (another focus cycle is open; `dir` names it), `no_batch`, `batch_not_found`, `batch_unusable` (the batch reader's message), `batch_empty`, `all_routed` (every item belongs to the phase system; `handoff` lists them), `invalid_kind`, `mkdir_failed` (the directory exists: never overwritten). No refusal creates a directory.

**`--raw` output:** The cycle directory.

### `focus close`

End a focus cycle: measure, commit, record.

```bash
pan-tools focus close --dir <dir|name|number> [--status verified|partial|failed] [--files <path> ...] [--commit <sha>] [--done <id,...>] [--failed "<id>=<reason>,..."] [--raw]
```

- Runs the test command again (exec cycles) against the cycle's baseline and writes `<n>-test-run.json`. A test already failing at open is pre-existing; a new failure is a regression
- Derives the status: `failed` when no item is done, a test regressed or fewer tests pass; at most `partial` with no measured count, a run that did not pass, or an item not done; else `verified`. `--status` can only lower it (`derived_status` and `derived_from` show the measured value and why). An exec cycle may leave `--status` out; a docs cycle, which measures nothing, needs it
- `--files`: commits those paths (deletions included) with `fix(focus-<n>): <done ids>` (`docs(focus-<n>): …` for a docs cycle), through the source commit path, so `commit_docs` does not apply. Nothing is committed when a test regressed (`commit_skipped`). `--commit <sha>` instead records a commit you made, which must be reachable from HEAD
- Records `results` (`{id: "done"|"failed"}`) and `result_reasons` in the batch file, keeping its modification time; each item's scan-time `status` is left alone
- Moves each done todo item to `todos/completed/` (a bare file name only: an id that names a path completes nothing)
- Adds a row to state.md's Quick Tasks Completed table (`focus: <category> — X of Y items`, the commit, the status, the directory) and sets Last Activity. A project with no state.md closes anyway (`state: "state_missing"`); a missing Last Activity field is listed in `state_warnings`
- Writes `<n>-summary.md` last: status, the claim, commit, items done, failed (with reasons) and not reported, tests before and after, regressions and pre-existing failures. The summary is what closes the cycle, so a close that stops before it can be run again
- Commits that record under the planning rules (`record_commit`: the hash, or why not, such as `skipped_commit_docs_false`): the cycle directory, state.md, the batch file and both sides of each todo move, so no deletion is left behind

`--done` and `--failed` repeat, and each takes every word up to the next `--` flag: `--done a b` and `--done a,b` are the same. In `--failed` a comma splits only before the next `id=`, so a reason may contain commas, and an unquoted reason's words stay with the `id=` before them.

**JSON output:** `{ closed, dir, summary, status, reported_status, derived_status, derived_from?, commit, commit_skipped?, items_done, items_failed, items_not_reported, tests_before, tests_after, regressions, preexisting_failures, batch_results, todos_completed, state, state_row, state_warnings?, record_commit }`

**Refusals (exit 1), nothing written:** `invalid_status`, `not_a_focus_cycle` (no such cycle, or a plan without `source: focus`), `cycle_closed`, `unknown_items` (an id not in the cycle's plan), `conflicting_items` (an id both done and failed), `commit_conflict` (`--files` with `--commit`), `nothing_done` (`--files` with no item done), `commit_unknown` (`--commit` names no commit reachable from HEAD), `commit_blocked` (the safety checks refused `--files`: a sensitive file name, a staged credential (`sensitive_content_detected`) or a deletion, with `safety_checks` and the paths it unstaged again; fix the cause, or commit the paths yourself and close with `--commit <sha>`), `commit_failed`, `not_a_git_repo`. `state_failed`: state.md could not be updated; the cycle stays open (the batch results and todo moves already made are safe to repeat).

**`--raw` output:** The recorded status.

---

### `focus design`

Workflow-only command that routes to the multi-phase investigation pipeline.

```bash
pan-tools focus design [--raw]
```

**Output:** JSON message directing to `/pan:focus-design` workflow.

**Modes** (flags of the `/pan:focus-design` command; the CLI verb itself parses none): `--full` (default), `--internal`, `--outward`, `--spike`
**Modifiers:** `--gate`, `--audit`, `--mvp`

---

## 19. Standards Commands

Industry standards selection and advisory compliance. Select standards from a built-in catalog, get project-type recommendations, and track compliance via checklists.

**Module:** `config.cjs`

### `standards list [--category <cat>]`

List all available standards from the built-in catalog.

```bash
pan-tools standards list [--raw]
pan-tools standards list --category security
```

**Flags:**
- `--category` — Filter by category (security, accessibility, quality, architecture, process)

**JSON output:**
```json
{
  "standards": [
    { "id": "owasp-top10", "name": "OWASP Top 10 (2025)", "category": "security", "level": "foundational", "description": "...", "checklist_items": 10 }
  ],
  "count": <N>
}
```

### `standards select <id>`

Add a standard to the project. Creates/updates `.planning/standards.md`.

```bash
pan-tools standards select owasp-top10
pan-tools standards select wcag-22
```

**JSON output:**
```json
{
  "added": "owasp-top10",
  "project_standards": ["owasp-top10"],
  "standards_file": ".planning/standards.md"
}
```

**Errors:** Unknown standard ID, duplicate selection.

### `standards remove <id>`

Remove a standard from the project. Deletes standards.md when last standard removed.

```bash
pan-tools standards remove owasp-top10
```

**JSON output:**
```json
{
  "removed": "owasp-top10",
  "project_standards": ["stride"],
  "standards_file": ".planning/standards.md"
}
```

`standards_file` is `null` once the last standard is removed.

**Errors (exit 1):** no `standards.md`, a standard that is not selected.

### `standards status`

Report compliance status for all selected standards. Counts checked vs unchecked items.

```bash
pan-tools standards status [--raw]
```

**JSON output:**
```json
{
  "project_standards": ["owasp-top10", "stride"],
  "checks": [
    { "standard_id": "owasp-top10", "standard_name": "OWASP Top 10 (2025)", "category": "security", "status": "partial", "checklist_items": 10, "verified_items": 3, "coverage": "30%" }
  ],
  "overall_status": "partial"
}
```

**Status values:** `none` (no standards), `configured` (0% verified), `partial` (some verified), `complete` (all verified).

### `standards recommend`

Recommend standards based on project.md content analysis. Detects project types (web, api, ai, agent, enterprise, cli) via keyword matching; falls back to `general` when none match.

```bash
pan-tools standards recommend [--raw]
```

**JSON output:**
```json
{
  "project_types": ["web", "api"],
  "recommendations": [
    { "id": "owasp-top10", "name": "OWASP Top 10 (2025)", "reason": "web project detected", "priority": "high", "source_type": "web" }
  ]
}
```

**Requires:** `.planning/project.md` must exist.

### `standards phase-track`

Show which standards are relevant to a specific phase and their compliance state. Analyzes plan.md content for keywords that map to standards.

```bash
pan-tools standards phase-track <phase-number> [--raw]
```

**JSON output:**
```json
{
  "phase": "1",
  "phase_name": "auth-setup",
  "relevant_standards": ["owasp-top10", "owasp-asvs-l1"],
  "compliance": [
    { "standard_id": "owasp-top10", "standard_name": "OWASP Top 10 (2025)", "category": "security", "selected": true, "status": "configured", "checklist_items": 10, "verified_items": 0, "coverage": "0%" },
    { "standard_id": "owasp-asvs-l1", "standard_name": "OWASP ASVS Level 1", "category": "security", "selected": false, "status": "not_selected", "coverage": null, "action": "Consider selecting with: pan-tools standards select owasp-asvs-l1" }
  ]
}
```

**Keyword detection:** Maps phase plan content keywords (auth, login, security, accessibility, llm, agent, etc.) to relevant standard IDs.

### `standards tools`

List external scanning tools recommended for selected or specified standards.

```bash
pan-tools standards tools [standard-id] [--raw]
```

Without arguments, uses the project's selected standards. With a standard ID, shows tools for that specific standard.

**JSON output:**
```json
{
  "standards_queried": ["owasp-top10"],
  "recommendations": [
    { "standard_id": "owasp-top10", "standard_name": "OWASP Top 10 (2025)", "tools": [
      { "name": "OWASP ZAP", "url": "https://www.zaproxy.org/", "description": "Dynamic application security scanner" },
      { "name": "Semgrep", "url": "https://semgrep.dev/", "description": "Static analysis with OWASP rule packs" }
    ]}
  ],
  "unique_tools": [
    { "name": "OWASP ZAP", "url": "https://www.zaproxy.org/", "description": "Dynamic application security scanner", "standards": ["owasp-top10"] }
  ]
}
```

---

## 20. Operations Commands

Pre-flight checks, project dashboard, session learnings, and dependency validation. Based on competitive analysis of 6 AI coding tools (ADR-0013).

### `preflight [target]`

Run pre-flight validation checks before execution. Validates state, blockers, git status, config, and error patterns.

**Module:** `verify-preflight.cjs` (re-exported by `verify.cjs`)

```bash
pan-tools preflight [target] [--raw]
```

**Arguments:**
- `target` (optional) — `batch` to check for active batch file, or a phase number (e.g., `01`) to check phase directory exists

**Checks performed:**
| Check | What it validates |
|-------|-------------------|
| `planning_dir` | `.planning/` directory exists |
| `state_readable` | `state.md` can be parsed |
| `no_blockers` | No open bullets under state.md's `### Blockers/Concerns` section (or a legacy `## Blockers` heading), where `state add-blocker` writes. Runs only when state.md is readable |
| `git_clean` | Git working tree is clean (passes outside a git repository) |
| `error_patterns` | Reports count of known error patterns; never fails |
| `config_exists` | `config.json` exists |
| `batch_exists` / `target_phase` | Target-specific check, only when a target is given and state.md is readable. `batch_exists` names the newest batch, the one `focus exec` runs |

`ready` is true when no check added a blocker; each failed check adds one line to `blockers`. `--raw` prints `ready` or `blocked`.

**JSON output:**
```json
{
  "ready": true,
  "target": null,
  "checks": [
    { "name": "state_readable", "passed": true },
    { "name": "error_patterns", "passed": true, "detail": "0 known pattern(s)" }
  ],
  "blockers": [],
  "passed": 6,
  "total": 6
}
```

### `dashboard`

Aggregated project overview showing phase progress, the next phase, and the number of open blockers in state.md.

> **Not the HTML dashboard.** `pan-tools dashboard` emits a compact **JSON** project overview (this command, `state.cjs`). For the single-page **HTML** army dashboard, see the `hud` command (`hud.cjs`). The slash command `/pan:dashboard` is a discoverability **alias for `/pan:hud`** (the HTML view) — not for this JSON command.

**Module:** `state.cjs`

```bash
pan-tools dashboard [--raw]
```

**JSON output:**
```json
{
  "project": "Project Name",
  "version": "1.0.0",
  "current_phase": { "number": "03", "name": "core", "status": "Executing" },
  "blockers": 0,
  "progress": { "phases_completed": 2, "phases_total": 5, "plans_total": 6, "plans_completed": 4 },
  "milestone": { "version": "v1.0", "name": "Initial Release" },
  "next_phase": { "number": "04", "name": "testing" },
  "last_activity": "2026-03-03",
  "last_activity_description": "Completed 03-02-plan.md"
}
```

`blocker_list` (the open blockers' text) is added when `blockers` is above 0. A value state.md or the roadmap does not give is `null`.

### `learnings extract`

Auto-extract learnings from error patterns and phase summaries.

**Module:** `commands-learnings.cjs` (re-exported by `commands.cjs`)

```bash
pan-tools learnings extract [--raw]
```

**Sources:**
- Error patterns (`.planning/patterns.md`) → error-resolution learnings
- Phase summaries (`key-files` frontmatter: a flat list, or the summary templates' `{created, modified}`) → file co-change patterns (requires 2+ co-occurrences)
- Patterns established (summary frontmatter) → pattern learnings

**Writes:** `.planning/learnings.md`

**Deduplication:** Skips learnings whose detail string already exists in the file.

**JSON output:**
```json
{
  "extracted": 3,
  "total": 15,
  "by_type": { "error-resolution": 1, "co-change": 1, "pattern": 1 }
}
```

### `learnings list`

List all extracted learnings with type breakdown.

**Module:** `commands-learnings.cjs` (re-exported by `commands.cjs`)

```bash
pan-tools learnings list [--raw]
```

**JSON output:**
```json
{
  "learnings": [
    { "id": "LEARN-001", "type": "error-resolution", "title": "Import fix", "detail": "old -> new", "files": [], "date": "2026-03-01" }
  ],
  "count": 1,
  "by_type": { "error-resolution": 1 }
}
```

With no learnings it prints `{ "learnings": [], "count": 0 }`, without `by_type`.

### `learnings prune`

Remove learnings by age or specific ID.

**Module:** `commands-learnings.cjs` (re-exported by `commands.cjs`)

```bash
pan-tools learnings prune --days N [--raw]
pan-tools learnings prune --id LEARN-NNN [--raw]
```

**Flags:**
- `--days N` — Remove entries with dates older than N days
- `--id LEARN-NNN` — Remove a specific entry by ID

One of the two is required (exit 1 otherwise). With no `learnings.md` it prints `{ "pruned": 0, "remaining": 0 }`.

**JSON output:**
```json
{
  "pruned": 2,
  "remaining": 13
}
```

### `links validate`

Validate the doc–code link graph (ADR-0027). Walks `docs/`, `pan-wizard-core/{workflows,templates,references,learnings}/`, `commands/`, `agents/` for inline `[[<id>]]` refs, and `pan-wizard-core/`, `bin/`, `hooks/`, `scripts/` for `// @pan: <id>` source-comment anchors. Reports broken refs, stale anchors, and uncovered backlink contracts.

**Module:** `links.cjs`

```bash
pan-tools links validate [--strict] [--doc-root <p>] [--source-root <p>] [--raw]
```

`validate` is the default: `pan-tools links` and `pan-tools links --strict` run it too.

**Flags:**
- `--strict` — fail on real warnings, not only errors. (B-002 single-source informational warning is exempt.)
- `--doc-root <path>` — override default doc roots; repeatable.
- `--source-root <path>` — override default source roots; repeatable.

**Exit codes:**
- `0` — pass
- `1` — fail (errors present, or non-B-002 warnings under `--strict`)

**JSON output:** `{ ok, summary: { total_findings, errors, warnings, status, doc_files_scanned, source_files_scanned, anchors_found, forward_links_found, backlink_contracts_checked }, findings: [{ code, severity, source, source_line, target, detail }] }`

**Finding codes:** F-001/F-002 (broken inline / section refs, error), F-003/F-004 (key_links path / regex, warning), B-001 (uncovered `require-code-mention`, error), B-002 (single-source informational, warning), A-001 (stale anchor target, error), A-002/A-004 (missing anchor section / empty id, warning).

See ADR-0027 and `docs/specs/doc_code_link_graph_featureai.md` for the wire-level spec.

### `deps validate`

Cross-reference roadmap phases vs disk directories and detect orphaned requirements.

**Module:** `verify-preflight.cjs` (re-exported by `verify.cjs`)

```bash
pan-tools deps validate [--raw]
```

**Checks performed:**
1. Parse roadmap.md for phase headers
2. Scan `.planning/phases/` directories
3. Cross-reference: roadmap phases not on disk = `missing_phases`, disk dirs not in roadmap = `orphaned_dirs`
4. Parse requirements.md for REQ-NN IDs
5. Scan phase summaries for REQ-NN references
6. Unreferenced uncompleted requirements = `orphaned_reqs`

**JSON output:**
```json
{
  "valid": true,
  "issues": [
    { "type": "info", "message": "Requirement REQ-09 not marked complete and not referenced in any summary" }
  ],
  "roadmap_phases": 5,
  "disk_phases": 5,
  "requirements_total": 10,
  "requirements_completed": 8,
  "orphaned_reqs": ["REQ-09"],
  "missing_phases": [],
  "orphaned_dirs": []
}
```

### `drift-check`

Check changed files against project conventions and produce a quantitative drift score.

**Module:** `verify-drift.cjs` (re-exported by `verify.cjs`)

```bash
pan-tools drift-check [--since <ref>] [--threshold <0.0-1.0>] [--files <path,...>] [--verbose] [--raw]
```

**Arguments:**
- `--since <ref>` — Git ref to diff against (default: HEAD)
- `--threshold <n>` — Pass/fail threshold (default: 0.5)
- `--files <paths>` — Comma-separated specific files to check (bypasses git diff)
- `--verbose` — Include `per_file` breakdown grouping violations by file

**Convention sources:** `.planning/codebase/conventions.md` (or an older map's `CONVENTIONS.md`) + `CLAUDE.md` + the built-in PAN rules (`BUILTIN_DRIFT_RULES` in `constants.cjs`).

**JSON output:**
```json
{
  "drift_score": 0.35,
  "verdict": "low",
  "passed": true,
  "threshold": 0.5,
  "violations": [
    {"file": "lib/verify.cjs", "line": 45, "rule": "no-console-log", "message": "Use output() instead of console.log", "severity": "error"}
  ],
  "violation_count": 3,
  "files_checked": 8,
  "conventions_loaded": 12,
  "summary": "drift: 0.35 (low) — 3 violations in 8 files"
}
```

**Verdicts:** clean (0-0.2), low (0.2-0.5), medium (0.5-0.8), high (0.8-1.0).

---

### `retro`

Milestone retrospective — analyze estimation accuracy, verification patterns, and common gap types.

**Module:** `verify-retro.cjs` (re-exported by `verify.cjs`)

```bash
pan-tools retro [--write-memory] [--max N] [--raw]
```

**Flags:**
- `--write-memory` — append top-N gap patterns as lessons to `pan-planner` memory; write a verifier lesson when first-try rate < 60% over ≥3 runs. The entries are stored for `/pan:knowledge`; no workflow loads them into agents, and `/pan:retro` passes this flag only when the user gives it (ADR-0036, amended `2026-10-04`).
- `--max N` — cap the `pan-planner` gap lessons written to memory (default 3, range 1–10); the verifier lesson has its own condition.

**JSON output:**
```json
{
  "phases_planned": 8,
  "phases_completed": 6,
  "phases_decimal": 2,
  "estimation_accuracy_pct": 75,
  "verifications_total": 6,
  "verifications_passed_first_try": 4,
  "verifications_gaps_found": 2,
  "verifications_human_needed": 0,
  "first_try_rate_pct": 67,
  "common_gap_patterns": [
    {"pattern": "missing wiring between", "count": 3},
    {"pattern": "stub detected in", "count": 2}
  ],
  "memory": { "wrote": { "pan-planner": 2, "pan-verifier": 0 }, "max": 3 }
}
```

The `memory` field is omitted unless `--write-memory` is set.

**Error:** `{"error": "roadmap.md not found"}` on stdout, **exit 1**, if no `.planning/roadmap.md` exists.

---

## 20.1 Capability-Aware Commands

Commands added for Spec A (frontier-model capability enhancements). All degrade gracefully rather than error on models and runtimes that lack the underlying capability: the installer turns each agent's `effort:` into `model_reasoning_effort` in Codex's agent TOML and into a prose preamble for OpenCode, Gemini CLI and Copilot CLI. Cache priming is withdrawn: `cache prime` only measures (ADR-0023, amended). Nothing here inspects the model at runtime — in particular `codebase estimate-size` picks single-shot vs sharded from repo size alone, so on a smaller-context model you get the sharded path by lowering `--threshold` yourself; there is no automatic fallback.

### `memory read <agent>`

Read the append-only memory log for an agent. Returns parsed entries as JSON.

**Module:** `memory.cjs`

```bash
pan-tools memory read <agent> [--raw]
```

**JSON output when agent exists:**
```json
{
  "agent": "pan-planner",
  "exists": true,
  "entries": [
    "2026-04-18: Prefer bulk Postgres writes",
    "2026-04-18: Recurring plan gap (3x): missing wiring between API and UI"
  ]
}
```

Returns `{agent, exists: false, entries: []}` when no memory file exists.

### `memory append <agent> <entry> [--cites <path[#symbol]>,...]`

Append a lesson to an agent's memory. Creates file + directory if missing. Entries are auto-prefixed with today's date if not already prefixed.

```bash
pan-tools memory append <agent> <entry text can have spaces>
pan-tools memory append pan-executor "Batch inserts through the writer" --cites src/db/writer.js#bulkInsert
```

Agent name must match `^[a-zA-Z0-9_-]+$` (blocks path traversal), and may not be one of PAN's archives in the folder (`quarantine`, `state-archive`, `distill-patterns`). Newlines in the entry are collapsed to spaces.

**Citations** name the code a lesson rests on: a path relative to the project root, optionally with `#symbol`. They are stored at the end of the entry as `<!-- cites: src/db/writer.js#bulkInsert -->`. Each must hold when written: the file exists and, with a symbol, contains it (a whole word for an identifier). Otherwise the append is refused with `{ "error": "citation …" }`. `memory select` checks them again before every use.

### `memory list`

List the agent logs in `.planning/memory/` and their entry counts — the files `memory select` reads. No workflow loads them into agents (ADR-0036, amended `2026-10-04`). Every other `.md` file there is under `not_loaded` with the reason. PAN's own archives are never memory: `quarantine.md` holds directives PAN refused to follow (ADR-0040), and `state-archive.md` is old state. A file with no `## Entries` list cannot be checked or expired, so it is not loaded either.

```bash
pan-tools memory list [--raw]
```

**JSON output:**
```json
{
  "agents": [ {"agent": "pan-planner", "entries": 12}, {"agent": "pan-verifier", "entries": 4} ],
  "not_loaded": [ {"file": "quarantine.md", "reason": "PAN archive, never loaded as memory"}, {"file": "notes.md", "reason": "no `## Entries` list"} ],
  "usage": { "entries": 16, "with_evidence": 3, "cited": 5, "used": 12, "never_used": 4 }
}
```

`usage` is the memory layer's telemetry across the agent logs. It counts entries that carry evidence of the failure they came from (`memory record`), entries that cite code, and entries ever used. `memory select --mark-used` counts each day an entry is selected that way (`uses` on its line). An entry never used is memory nobody reads.

### `memory compact <agent> [max]`

Trim an agent's memory file to the last `max` entries (default 500). The entries it drops are appended to `.planning/memory/archive/<agent>.md` first, as `memory prune` does, so nothing a person recorded is lost.

```bash
pan-tools memory compact <agent> 50
```

**JSON output:**
```json
{ "compacted": true, "kept": 50, "removed": 42, "archived": 42, "archive": ".planning/memory/archive/pan-planner.md" }
```

`archived` and `archive` are left out when nothing was removed.

### `memory select <agent> [--cue <text>] [--token-budget N] [--recency-floor N] [--all] [--mark-used] [--days N]`

Return an agent's valid memory entries, for someone who hands them to an agent. No workflow does since `2026-10-04`: exec-phase and plan-phase stopped loading agent memory after the harness found no behavioural effect from it (ADR-0036, amended).

**Only valid entries are candidates.** An entry is left out, and reported, when:
- **`stale`:** one of its citations no longer holds — the file is gone, or the symbol no longer appears in it.
- **`expired`:** it has not been used for `--days` days (default `MEMORY_EXPIRE_DAYS` in `constants.cjs`; `0` turns expiry off). The clock runs from its last use, or from its date if it was never used. An undated entry never expires.

**Selection:** the newest `--recency-floor` valid entries come first, then the entries most relevant to `--cue`, until `--token-budget` is spent (both fall back to built-in defaults). The budget binds the newest entries too: one that does not fit is skipped. A log with a valid entry always returns at least one entry, its newest when no entry fits the budget. `--all` takes every valid entry with no budget.

**`--mark-used`** records today as the last use of each selected entry and adds the day to its count (`used: YYYY-MM-DD; uses: N` in the entry's `<!-- … -->` comment, beside any `cites`), which is what keeps it from expiring. Without it the command is read-only.

```bash
pan-tools memory select pan-executor --cue "auth refactor" --token-budget 2000 --recency-floor 5 [--raw]
pan-tools memory select pan-executor --all --mark-used --raw
```

**JSON output:**
```json
{
  "agent": "pan-executor", "cue": "", "mode": "all", "considered": 3,
  "selected": ["2026-10-01: Batch inserts through the writer <!-- cites: src/db/writer.js#bulkInsert -->"],
  "stale": [{ "entry": "2026-09-20: Use the legacy exporter <!-- cites: src/legacy.js -->", "missing": ["src/legacy.js (file not found)"] }],
  "expired": [{ "entry": "2026-06-01: An old lesson", "last_used": "2026-06-01" }],
  "total_tokens": 22, "dropped": 0, "marked_used": 1
}
```

### `memory record <agent> --lesson "<correction>" (--finding <id> | --trace <session>) --cites <path[#symbol]>,...`

The gated write path for agent memory. A lesson is recorded only from an observed failure that was corrected, with the correction, its evidence and a citation:

- **Evidence, one of:** `--finding <id>`, a finding in `.planning/findings.jsonl` whose status is `fixed` (a verifier gap a fix round closed); or `--trace <session>`, a trace session under `.planning/optimization/traces/` (the optimizer's recurring tool failures). The entry stores it as `evidence: finding:f_…` or `evidence: trace:<session>`.
- **Citations:** `--cites`, at least one, each holding now (see `memory append`).
- **The lesson:** one line of 20–300 characters that says the correction, what to do next time. It may not repeat the finding, carry an HTML comment, or read as a directive to bypass the process (ADR-0040).
- **Once:** a finding gets one lesson, and a lesson already in the log is not recorded again.

A refusal is reported as `{ "recorded": false, "reason": "…" }` with exit 0: it is the gate working. A missing agent or two pieces of evidence is a usage error. A recorded lesson logs a trace event of type `decision` with category `memory_recorded`, opening the day's trace session when none is active. No workflow calls it since `2026-10-04` (exec-phase's `record_lessons` step was retired with the memory injection). `optimize apply` uses it for an older report's `memory_entry` action.

```bash
pan-tools memory record pan-executor --finding f_3c9a1e07b2 \
  --lesson "Give every token type an explicit expiry constant and test the expiry path" \
  --cites src/session.js#SESSION_TTL_MS
```

### `memory prune [<agent>] [--apply] [--days N]`

Archive the entries `memory select` no longer returns: stale and expired ones, as it judges them. Covers one agent's log, or every agent log when no agent is given. The entries go to `.planning/memory/archive/<agent>.md`, each with the reason. Nothing is deleted: to restore an entry, move its line back under `## Entries`.

**Safety:** the archive is written first, and only then are those bullet lines taken out of the log, so an interruption can duplicate an entry but never lose one. Everything else in the log is left as it was, line endings included. Dry run by default.

```bash
pan-tools memory prune                       # what would move
pan-tools memory prune pan-executor --apply
pan-tools memory prune --days 0 --apply      # stale only, no expiry
```

`hygiene scan` reports these entries as `memory-stale` with the `prune-memory` fix, and `hygiene clean --apply` runs it.

### `memory budget`

Report the total token footprint of all agent memory files against the project's typical per-call **prompt** size (`median_prompt_tokens` — the median of `input + cache_read + cache_write` over the ledger's trustworthy rows): what the whole store would add to an agent's prompt if it were handed to one. No workflow hands it over since `2026-10-04`, and `validate health --full` no longer reports it. Under prompt caching the uncached `input` alone is tens of tokens, which is why the denominator is the whole prompt. Read-only.

```bash
pan-tools memory budget [--raw]
```

### `memory optimize [--apply] [--keep N]`

Reconcile the always-loaded project memory so it stays small. Reconciles state.md's append-heavy bullet sections (Decisions / Blockers / Concerns / Todos / Pending Todos / Accumulated Context / Recent Activity / Session Continuity): dedupe, strip placeholders once real entries exist, and cap to the most-recent `N` (default 12), **archiving** the overflow to `.planning/memory/state-archive.md` (bullets that read like injected instructions go to `.planning/memory/quarantine.md` instead, reported as `quarantined`) — nothing is hard-deleted. Also consolidates any per-agent episodic log over the entry cap. Tables, prose, sub-bullets, and every non-target section are preserved byte-for-byte.

Dry-run by default (reports what *would* change); pass `--apply` to write. Idempotent — a second run on already-lean content is a no-op.

```bash
pan-tools memory optimize            # dry-run: report what would change
pan-tools memory optimize --apply    # write the reconciled state.md + archive
pan-tools memory optimize --apply --keep 20
```

**JSON output:**
```json
{
  "apply": true,
  "state": { "changed": true, "sections_touched": ["Decisions"], "archived_entries": 3, "quarantined_entries": 0, "before_bytes": 18240, "after_bytes": 16975 },
  "agents": [],
  "archived": 3,
  "quarantined": 0
}
```

> Auto-optimize also runs automatically inside the focus-auto checkpoint and the normal-flow session record, gated by `memory.auto_optimize` in `.planning/config.json` (default on). Running `memory optimize` by hand is only needed for an out-of-band pass or a custom `--keep`.

### `memory rebuild [--apply] [--only agents-md]`

Regenerate PAN's *derived* tools-memory as an idempotent projection from source: the marker-fenced PAN section in `AGENTS.md` (read natively by Codex, OpenCode and Copilot CLI; Claude Code reads it through the `CLAUDE.md` bridge below; Gemini CLI through the `context.fileName` entry a Gemini install adds), written in the routing mode `instructions.routing` names (`off`, the default since 3.42.2: no table; `advisory`: a short table of which PAN command a plain request belongs to; `exclusive`: the table, and a line saying the project does that work only through PAN), PAN's block in `CLAUDE.md` (when a Claude install is visible: in the project, or a global one in the Claude user directory, which writes nothing into projects itself): the `@AGENTS.md` import and a `# Compact instructions` section that tells Claude Code's compaction summary what PAN work needs to resume. An older block holding only the import is brought up to date in place. It also patches state.md's position keys in place from the body; comments, quoting and keys PAN does not know are kept; a state.md with more than one front-matter block is reported as `action: "refused"` and left as it is. User content outside PAN's markers is never touched. Refuses to run inside the PAN source repository.

Dry-run by default; pass `--apply` to write. A second run changes nothing. `--only agents-md` rebuilds `AGENTS.md` and the bridge and leaves state.md alone (what `/pan:new-project` and `/pan:settings` run); any other `--only` value is refused with `error: "bad_only"`. A PAN section the project edited is kept and reported as `action: "kept_edited"`.

```bash
pan-tools memory rebuild             # dry-run: report the derived targets
pan-tools memory rebuild --apply     # regenerate AGENTS.md / CLAUDE.md; patch state.md's position keys
```

**JSON output:**
```json
{
  "apply": true,
  "runtimes": ["claude", "copilot"],
  "routing": "off",
  "claude_bridge": true,
  "rebuilt": [
    { "file": "AGENTS.md", "action": "update", "wrote": true },
    { "file": "CLAUDE.md", "action": "unchanged", "wrote": false },
    { "file": ".planning/state.md", "action": "update", "wrote": true }
  ],
  "changed_count": 2,
  "directive_warnings": []
}
```

`directive_warnings` lists lines in `AGENTS.md` or `CLAUDE.md` that read like directives aimed at the agent (ADR-0040), each with `file`, `line` and `text`. They are reported for review and never edited.

---

### `cache prime [--summary]`

Build an ordered, cache-eligible context block list from stable `.planning/` files (project.md, requirements.md, roadmap.md, state.md, standards.md), plus any planning-root-relative paths listed in `config.json` → `cache.extra_files` (appended after the built-ins so existing cache keys stay stable).

It is a measurement and primes nothing. The host caches each agent's prompt prefix by itself, and a command's output cannot mark another agent's prompt for caching. The shipped commands used to call it on the belief that it did; they no longer do (ADR-0023, amended). To see how much every agent re-reads, use `context-budget` or `hygiene scan`.

**Module:** `core.cjs` (wrapper in dispatcher)

```bash
pan-tools cache prime [--summary] [--raw]
```

**Flags:**
- `--summary` — omit full block content; return only `{path, bytes, cache}` metadata. Useful when the caller only needs the cache key / size estimate.

**JSON output (full):**
```json
{
  "blocks": [
    { "path": ".planning/project.md", "content": "...", "cache": true },
    { "path": ".planning/requirements.md", "content": "...", "cache": true }
  ],
  "total_bytes": 42301,
  "sha": "0632f5e0399f582d"
}
```

The `sha` is a stable 16-char prefix over file path + content, used for cache hit debugging.

---

### `codebase estimate-size [--threshold N] [--no-docs]`

Estimate total token size of a repository for single-shot vs sharded `/pan:map-codebase` mode selection.

**Module:** `codebase.cjs`

```bash
pan-tools codebase estimate-size [--threshold 700000] [--no-docs] [--raw]
```

**Flags:**
- `--threshold N` — custom single-shot ceiling in tokens (default 700000).
- `--no-docs` — skip `docs/*.md` top-level files in the estimate.

**JSON output:**
```json
{
  "total_bytes": 1872704,
  "total_tokens": 468176,
  "threshold": 700000,
  "mode": "single-shot",
  "file_count": 111,
  "languages": { "javascript": 1170060, "python": 18398, "docs": 684246 }
}
```

`mode` is `single-shot` when `total_tokens ≤ threshold`, else `sharded`. Selection is purely size-based — the module performs no model check. The default threshold assumes the consuming agent has a 1M-context window; pass a lower `--threshold` when mapping with a smaller-context model.

---

### `focus classify-stages [--stdin]`

Classify a focus-exec batch into parallel-tool-use waves + a `parallelism_hint` string. Used by `/pan:focus-auto --step exec` Stage 3.0 to decide whether to emit Reads/Greps in parallel.

**Module:** `focus.cjs`

```bash
pan-tools focus classify-stages [--stdin] [--raw]
```

**Flags:**
- `--stdin` — read items JSON from stdin instead of the newest batch file (the one `focus exec` reads). Without `--stdin`, a newest batch that has no item list is refused with the same error `focus exec` gives.

**JSON output:**
```json
{
  "waves": [
    [ {"id": "A", "tier": "MICRO"}, {"id": "B", "tier": "MICRO"} ],
    [ {"id": "C", "tier": "STANDARD"} ]
  ],
  "parallelism_hint": "emit-micro-in-parallel"
}
```

Waves: every `MICRO` item, then every `STANDARD` item, then each `FULL` item in a wave of its own; an item with no `tier` lands in no wave. Hint values: `emit-micro-in-parallel` (two or more MICRO items), else `emit-standard-in-parallel` (two or more STANDARD items), else `sequential`. With no batch file, or an unusable newest batch, it prints `{error}` and exits 1.

---

### `focus reflection`

Emit a reflection prompt between focus-auto cycles. Reads `{run, cycle, batch, tier}` from stdin (`tier` defaults to `mid`; stdin that is not JSON exits 1).

**Module:** `focus.cjs`

```bash
echo '{"run": {...}, "cycle": {...}, "batch": [...], "tier": "reasoning"}' \
  | pan-tools focus reflection [--raw]
```

**JSON output:**
```json
{ "reflect": true, "prompt": "Reflect before committing to cycle 2 of 5 in category \"cleanup\". ...", "reason": "ok" }
```

**Gate:** the reflection step is **reasoning-tier-only**. `run.reflection_enabled` wins if set — `true` forces reflection on at any tier, `false` forces it off. With the key absent, reflection is enabled only when the incoming `tier` is in `REFLECTION_THRESHOLD.enable_on_tiers` (`constants.cjs`), which is `['reasoning']`; `enabled_default` is `false`. So a `mid`/`fast` tier gets `{reflect: false}` even on a thinking-capable model — the gate reads the resolved tier, never the model's capabilities.

Returns `{reflect: false, reason: "reflection_disabled"}` when the gate is closed, and `{reflect: false, reason: "no_next_batch"}` when the proposed next batch is empty.

---

## 21. Codebase Commands

For `codebase estimate-size`, see Section 20.1 (Capability-Aware Commands) — it's the mode-selection entry point for `/pan:map-codebase` Stage 0.

### `codebase detect-languages`

Detect programming languages used in a codebase via extension mapping and manifest scanning.

**Module:** `codebase.cjs`

```bash
pan-tools codebase detect-languages [--raw]
```

**JSON output:**
```json
{
  "primary": "javascript",
  "secondary": ["python"],
  "files_by_language": {"javascript": ["src/index.js", "src/utils.js"], "python": ["scripts/deploy.py"]},
  "file_count": 3
}
```

### `codebase analyze-imports`

Build a dependency graph from import analysis with circular dependency detection.

**Module:** `codebase.cjs`

```bash
pan-tools codebase analyze-imports [--raw]
```

**JSON output:**
```json
{
  "language": "javascript",
  "modules": 12,
  "imports": 18,
  "circular_deps": [],
  "entry_points": ["src/index.js"],
  "orphan_modules": ["src/unused.js"],
  "dependency_graph": "graph LR\n    N0[index] --> N1[utils]"
}
```

### `codebase best-practices`

Detect best practices in these categories: Error Handling, Testing, Naming Conventions, Security, Performance.

**Module:** `codebase.cjs`

```bash
pan-tools codebase best-practices [--raw]
```

**JSON output:**
```json
{
  "categories": [
    {"name": "Error Handling", "score": 7, "detected_patterns": ["try-catch ratio: 35%"], "recommendations": []},
    {"name": "Testing", "score": 8, "detected_patterns": ["12 test files found", "Test config present"], "recommendations": []}
  ],
  "score": 6.4,
  "recommendations": ["Add .env to .gitignore"]
}
```

---

## 22. Spec B v2 Commands

Commands added across the five Spec B v2 waves. See [ADR-0024](decisions/ADR-0024-spec-b-v2-completion.md) for the design rationale. All modules are runtime-agnostic; agent quality varies by model capability.

### `cost report [--format json|table|chart]` (Y-6)

Aggregate per-call cost across all PAN invocations in the project.

**Module:** `cost.cjs`

```bash
pan-tools cost report [--format json|table|chart] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
```

Reads `.planning/metrics/tokens.jsonl` (append-only log — populated automatically since v3.4 by the `pan-cost-logger` SubagentStop hook, and manually via `cost append`). Aggregates by agent / command / tier / day, computes cache hit rate, and surfaces an overall USD estimate with the default rate table or `cost.rates` overrides. Three kinds of row never reach the totals and are counted instead: `suspect_excluded` (the oversum signature — more than 500M cache-read or 10M output tokens, a span over six hours, or, for a row the hook could not time, cache reads dwarfing input and output; rows measured from a single actor's own transcript, `token_source` `agent-transcript` or `session-transcript`, are exempt because they cannot carry anyone else's usage), `empty_excluded` (no tokens on any axis and no model — an unmeasured spawn), and `malformed_skipped` (unparseable lines). The table format prints them beside `Calls`.

`report` is the default subcommand: `pan-tools cost` and `pan-tools cost --format chart` run it.

Three formats:
- `json` (default) — machine-readable, full payload
- `table` — aligned columns with section-by-section breakdown
- `chart` — ASCII bar chart of per-day cost

### `cost append --model X --input-tokens N --output-tokens N ...` (Y-6)

Manually append a cost record. Used by explicit callers; the hook path handles automatic capture.

```bash
pan-tools cost append \
  [--agent <name>] [--command <name>] [--model <id>] [--tier reasoning|mid|fast] \
  [--input-tokens N] [--output-tokens N] \
  [--cache-read-tokens N] [--cache-write-tokens N] \
  [--phase <num>] [--session <id>]
```

Missing fields default to `null` or `0`. Cost is auto-computed when `model` or `tier` resolves to a known rate.

### `cost clear` (Y-6)

Delete the cost log after copying it to `tokens.jsonl.bak-<timestamp>` beside it. Returns `{cleared: true, file, backup}`; with no ledger to clear it returns `{cleared: false, error}` and exits 1. Useful at the start of a billing cycle.

### `cost rebuild [--apply] [--no-main-thread] [--claude-dir <path>]`

**Module:** `cost-rebuild.cjs`

Rebuild the ledger from Claude Code's own transcripts instead of trusting what the hooks wrote. Rows written before v3.29 were slices of the *parent* session transcript booked to whichever subagent stopped, and counted a turn once per content block; they cannot be corrected in place, but the transcripts they came from survive under `<Claude config dir>/projects/<encoded cwd>/` for Claude Code's retention window (`cleanupPeriodDays`, 30 by default). The folder is matched under the working directory as given and under its resolved real path — Claude Code names it after the real path, so a symlinked `--cwd` still finds it. The rebuild reads every session the ledger names plus every session of the project that has agent transcripts, writes one row per agent transcript (`<session>/subagents/agent-<id>.jsonl`, and `subagents/workflows/<run>/agent-<id>.jsonl` for Workflow-tool subagents) with its exact usage deduped by `message.id`, its type from the main thread's `Agent` tool call, its model and measured span, plus one row per session for the main thread's own usage (`agent: "(main thread)"`, `token_source: "session-transcript"`; `--no-main-thread` omits it). Hook rows of a rebuilt session are superseded; rows of sessions whose transcripts are gone, and caller-appended rows, are kept. A transcript folder reached only because the ledger names one of its sessions contributes that session alone (a ledger copied from another project must not import that project's history). Dry-run by default: reports each session's `superseded_rows` → `rebuilt_rows` and `old_cost_usd` → `new_cost_usd` (`--raw` prints them as `rows before → after`, `cost before → after`), priced as `cost report` prices (quarantined and empty rows at zero), and any `warnings` (an unreadable transcript contributes nothing and says so). `--apply` copies the current ledger to `tokens.jsonl.rebuilt-<date>` (`-2`, `-3`… when one exists — an earlier backup is never overwritten), carries forward any row a live hook appended while the plan was being read, writes through a temp file and rename, and writes nothing when the plan changes nothing; running it again is a no-op. `--claude-dir` overrides the Claude config directory (`CLAUDE_CONFIG_DIR`, else `~/.claude`). Plain chat sessions with neither agents nor ledger rows are left out, so the ledger stays a record of agent work and the sessions around it. Run it **before** `hygiene clean --apply` on a poisoned ledger — quarantine moves the whole file aside, and a rebuild afterwards has no rows left to keep. The main-thread row is dated to the session's last record with the whole session as its span, so a long session's own usage lands on its final day in the per-day view and in `--since`/`--until` windows; the cache-lifetime signal in `context-budget` ignores these rows. Transcripts whose last record is an interruption (`<synthetic>` model) take the model most of their records name.

```bash
pan-tools cost rebuild            # dry run — what would change, per session
pan-tools cost rebuild --apply    # write it (previous ledger kept beside it)
```

### `cost limits`

**Module:** `cost.cjs`

The host's usage-limit windows as PAN's status line last saw them: Claude Code passes `rate_limits.five_hour` and `rate_limits.seven_day` to the status line on a subscription, and the status line writes them, account-wide, to `<os-tmpdir>/pan-hooks-<uid>/claude-limits.json`.

```bash
pan-tools cost limits          # JSON
pan-tools cost limits --raw    # weekly_limit_reached | ok | no_reading
```

Returns `{available, five_hour, seven_day, age_seconds, stale, weekly_limit_stop_pct, weekly_limit_reached}`. Each window is `{used_pct, resets_at, reset_since_read}`; a window whose `resets_at` has passed reads `used_pct: 0`. A reading older than 15 minutes is `stale`, and a stale reading never reaches the stop. `weekly_limit_reached` is true when a fresh 7-day reading is at or past `cost.weekly_limit_stop_pct` in `.planning/config.json` (default `90`; `0` or `false` turns it off; any other value that is not above 0 and at most 100 falls back to `90`). `/pan:focus-auto` stops on it with `weekly_limit` (the run is resumable), and `/pan:army` checks it between missions. Headless `claude -p` runs no status line, so there is nothing to read and nothing stops on it; other runtimes pass no such block.

### `cost budget --phase <N>`

**Module:** `cost.cjs`

A phase's spend against its budget, `cost.phase_budget_usd` (default `20`; `0` or `false` turns it off; any other value that is not a positive number reads as `20`). The phase can also be given positionally.

```bash
pan-tools cost budget --phase 3          # JSON
pan-tools cost budget 3 --raw            # off | ok | near | over
```

Returns `{phase, budget_usd, spent_usd, pct, status, mode, warn_at_pct, unpriced}`. `spent_usd` sums the phase's priced ledger rows (suspect and empty rows left out, `phase: "03"` and `"3"` alike); `unpriced` counts its rows with no known rate. `status` is `near` from `warn_at_pct` (80) of the budget and `over` once spend reaches it. `mode` is always `warn`: exec-phase reports `near` and `over` after a wave and plan-phase in its final status, and nothing stops on it. Exits 0 whatever the status; exits 1 without a phase.

### `models check`

Report whether the built-in model rate table is stale.

**Module:** `cost.cjs`

```bash
pan-tools models check [--raw]
```

Returns `{rates_verified_at, age_days, stale_after_days, stale, models, tiers, managed_model_pricing, managed_pricing_multiplier}`. The rate table carries the date it was last verified against published provider pricing; `stale` flips to `true` once that date is older than the threshold (sixty days, the cadence of PAN's ecosystem reviews). The calendar cannot see a default-model change inside that window; the suite's documented-default-models fixture test catches that instead. When stale, re-verify provider pricing, update `DEFAULT_RATES`, and bump `RATES_VERIFIED_AT` in `cost.cjs`. `--raw` prints a one-line human summary instead of JSON.

`managed_model_pricing` lists the model ids of the usable `overrides` rows in a Claude Code managed `modelPricing` block (contracted per-model rates an organisation deploys through managed settings; each row carries `input`, `output`, `cacheRead` and `cacheWrite`, and a row missing one is dropped, as Claude Code drops it), and `managed_pricing_multiplier` the block's `multiplier` — above 0 and at most 10, a discount below 1 and a markup above — or `null`. A multiplier PAN could not apply is reported as `managed_pricing_multiplier_ignored`. PAN prices with those rates, times the multiplier, when present, and applies the multiplier to the built-in rates of every model no row covers, as Claude Code does — see the `cost.rates` config key for the precedence. It reads them from the directory Claude Code documents for each OS; `PAN_MANAGED_SETTINGS_DIR` redirects the lookup. An empty list means no usable row was found, not that the setting is unsupported.

### `bus publish <channel> <payload> [--source <name>]` (Y-7)

Append a message to a file-backed channel at `.planning/bus/<channel>.jsonl`.

**Module:** `bus.cjs`

Channel and source names validated against `^[a-zA-Z0-9_-]+$` (path-traversal safe). Payload is any JSON-serializable value; if not valid JSON, stored as a raw string. Returns `{published: true, ts, file, size}` (`file` is the channel file's absolute path, `size` its size in bytes after the append); an invalid channel or source name exits 1 with `error: "Invalid channel: …"` (or `"Invalid source: …"`).

### `bus drain <channel> [--mode peek|consume|archive] [--limit N] [--offset N]` (Y-7)

Read messages from a channel.

- `peek` (default) — non-destructive read
- `consume` — read, then remove only the drained window (`offset`..`offset+limit`) from the file; messages outside the window survive, and the file is emptied only when the window covers every line
- `archive` — read the window, then rename the whole channel file (every message, not only the window) to `<channel>-<timestamp>.archive.jsonl`

Returns `{entries, total, offset, more, mode}`; `--limit` defaults to 1000. A malformed line comes back as `{malformed: true, raw, …}`. An unknown `--mode` on a non-empty channel exits 1, as does a failed write or rename (`drain_error`).

### `bus list` (Y-7)

List all channels with message counts + byte sizes + active/archive flag: `{channels: [{channel, messages, bytes, archive}]}`, archived files listed under their channel's name after the active one.

### `preview phase <N>` (Y-1)

Blast-radius analysis for a single phase.

**Module:** `preview.cjs`

```bash
pan-tools preview phase <N> [--raw]
```

Returns `{phase, phase_name, directory, status, plan_count, summary_count, goal, files_mentioned, test_files_mentioned, files_mentioned_count, test_files_count, risk_signals, risk_score, plans: [{file, bytes}], cost_forecast}`. Risk keywords checked: drop / delete / migrate / rename / breaking / auth. Score 1-10. `--raw` prints the same JSON.

`cost_forecast` (program P6) is `{agent, tier, plans, min_samples, per_plan, phase}`, from the project's cost ledger with this phase's own rows (and suspect or empty rows) left out. `per_plan` is `{status: "ok", n, p10, p50, p90}`, the dollars of a `pan-executor` call at one tier (the tier of the latest executor call); tiers are never pooled. `phase` is `{status: "ok", n_phases, p10, p50, p90}`: it resamples, 2,000 times and seeded, one past phase's other agents (planner, checkers, verifier, reviewer) plus one executor call per plan. Either is `{status: "insufficient", n, needed: 5}` when fewer than five observations back it (`phase` then also carries `n_phases` and a `reason`): no forecast is better than a guess from two runs.

### `preview phases` (Y-1)

Cross-phase dependency graph with mermaid source + Kahn-style parallel batches + hidden-coupling detection.

### `preview milestone` (Y-1)

Milestone completion ETA with velocity + confidence + bottleneck identification.

### `review-deep merge <phase> --reviewer-file X --hardener-file Y [--meta-file Z]` (Y-2)

Merge reviewer + hardener + meta-reviewer findings, plus the cross-family review's with `--cross-file W` (the file `/pan:review-deep` writes when `workflow.cross_family_review` names a host), into a consolidated `.planning/reviews/<phase>/deep-review.md`. The highest severity sets the verdict: ok < ok_with_minor (low) < fix_before_merge (medium) < review_required (high) < block (critical). Relative paths resolve against the project root. Returns `{written, file, verdict, coverage, conflicts}`; with no readable input file it prints `{error}` and exits 1.

**Module:** `review-deep.cjs`

`deep-review.md` is the record; nothing is published to the bus.

### `review-deep analyze <phase> ...` (Y-2)

Same merge logic as above (same flags, `--cross-file` included) but returns the payload, `{findings, conflicts, coverage, verdict}`, without writing a file. Useful for piping.

### `knowledge ask <question> [--max-sources N] [--recall-cue <text>]` (Y-3)

Retrieve candidate source files for a natural-language question, scored by keyword frequency across `CITATION_ROOTS`: `.planning/`'s project, requirements, roadmap, state, standards and patterns files and its `phases/`, `milestones/` and `memory/` folders, plus `docs/` and the top-level `README/CHANGELOG/CLAUDE.md`. PAN's own archives in `.planning/memory/` (`quarantine.md`, `state-archive.md`, `distill-patterns.md` and `archive/`) are never offered as sources.

**Module:** `knowledge.cjs`

```bash
pan-tools knowledge ask "why does phase 4 have a race condition fix?"
pan-tools knowledge ask "how is auth wired?" --recall-cue "session tokens"
```

Returns `{question, sources: [{file, score, bytes}], total_candidates, returned}`. Keeps `project.md` and `requirements.md` among the sources even when they score zero, though they still count against `--max-sources` (default 20) and rank last at a zero score. `--recall-cue <text>` re-scores the same candidates against a second cue and adds a `recall_cue` + `recall_sources` view to the payload (no extra filesystem walk).

### `knowledge discuss <phase> --subcmd read|append ...` (Y-3)

Multi-turn session state at `.planning/conversations/<phase>/session.json`.

- `--subcmd read` — load current session (empty if new)
- `--subcmd append --role user|agent --content "..." [--cites a,b]` — append a turn

### `knowledge playbook [--preview]` (Y-3)

Cluster the agent logs in `.planning/memory/` (those `memory list` lists; PAN's archives and files with no `## Entries` list are left out) into a categorized `.planning/playbook.md` with sections: Conventions / Gotchas / Decisions / Tool choices / Anti-patterns / Recurring gaps / General.

`--preview` returns the structured payload without writing the file.

### `whatif prepare <phase> <scenario>` (Y-4)

Creates an isolated git worktree for counterfactual phase replay. Returns the phase context, `{phase, phase_name, directory, scenario, slug, plans, summaries, has_executed}`, plus `worktree: {worktree_path, branch, base}`. When the worktree cannot be created it returns the context with `worktree_error` instead and exits 1.

**Module:** `whatif.cjs`

Requires a git repo with a commit. Worktree default location: `../pan-whatif-<phase>-<slug>-<timestamp>`, a sibling of the project, on a branch prefixed `pan-whatif/`.

### `whatif report <phase> <scenario> --comparison <json>` (Y-4)

Write the counterfactual comparison report to `.planning/counterfactuals/<phase>-<slug>.md` in the main tree (not the worktree — the worktree is disposable).

Comparison JSON shape: `{summary, differences[], recommendations[], risks[], verdict}`.

### `whatif cleanup --worktree <path> [--branch <name>] [--force]` (Y-4)

Remove the worktree and, with `--branch`, delete that branch. It refuses (exit 1, nothing touched) anything what-if did not create: a `--branch` that does not start with `pan-whatif/`, or a registered worktree that is not on that branch (on any `pan-whatif/*` branch when `--branch` is omitted), or a cwd that is not a git repo. Past that check, removal is best-effort: git failures come back in `warnings[]` and the result is `{removed: true, warnings}`. `--force` applies to `git worktree remove`; the branch is always deleted with `-D`.

---

## 23. Self-Improvement Loop Commands

The autonomous external-build loop: scaffold an experiment folder, drive an external runtime against an idea.md, observe and harvest learnings. See ADR-0026 for design.

**Modules:** `experiment.cjs` (lifecycle), `runner.cjs` (execution); the `learn` verbs below are in `optimize.cjs` (`promote`, `unpromote`, `list-promoted`), `learn-lint.cjs` (`lint`) and `learn-index.cjs` (`build-index`, `topics-for`). Every `learn` verb takes `--source-root <path>`, the root whose `pan-wizard-core/learnings/` it works on (default: the PAN root the module runs from). Bare `learn`, or `learn` followed only by flags, is an alias for `optimize learn`; an unknown subcommand exits 1.

### `experiment new <slug> --idea <path> [--root <dir>] [--runtime <name>] [--budget N] [--skip-installer]`

Scaffold a new experiment folder at `<root>/<slug>/`. Copies `<idea>` to `<root>/<slug>/.planning/idea.md`, writes the `experiment.json` manifest, initialises a git repository in the folder with a local commit identity, and (unless `--skip-installer`) runs the PAN installer for the chosen runtime inside the experiment dir (in an installed, non-source PAN the installer is unavailable and the result carries `installer_skipped`). Default root: `~/pan-experiments/`. Default runtime: `claude`. Hard `PAN_SOURCE_ROOT` guard refuses to scaffold inside the source repo.

### `experiment list [--root <dir>] [--include-archived]`

Enumerate experiments under root with `{experiment_id, runtime, status, created_at, path, …}` per entry (the full `experiment.json` manifest plus `path`). By default archived experiments are omitted; pass `--include-archived` to list them too.

### `experiment manifest <slug> [--root <dir>]`

Print the experiment's `experiment.json` manifest.

### `experiment run <slug> [--root <dir>] [--prompt <text>] [--timeout <seconds>]`

Spawn the runtime adapter against the experiment via `spawnSync`, observe via `run-state.json`, return final status. Adapters live in `runner.cjs#RUNTIME_RUNNERS` — claude/codex/gemini/opencode supported, copilot is null. Default prompt: `/pan:new-project --auto @.planning/idea.md`. `--timeout` is in seconds; default 3600 (60 min). `--runtime-override <bin>:<arg1>,<arg2>` replaces the runtime binary and its arguments, for tests.

**Incomplete-run detection:** When `exit_code: 0` but `state.md` shows `status != completed`, the runner returns `stop_reason: "incomplete"` (not `success`). Distinguishes real milestone-done from premature exits.

**Billing note (Claude runtime):** since June 15, 2026, headless `claude -p` / Agent SDK usage draws from a separate monthly **Agent SDK credit pool** on Claude subscriptions — it does not count against interactive session limits, and vice versa. The `billing_pool: "agent_sdk"` tag (and the rest of the `runState.metrics` envelope) is produced only by the runner module's capture-metrics API, **not** by the `experiment run` CLI path — a CLI run's `run-state.json` has no `metrics` key. Callers needing billing reconciliation must invoke the runner module directly with metrics capture enabled.

### `experiment status <slug> [--root <dir>]`

Read snapshot from `<expPath>/.planning/run-state.json`: status, started_at, ended_at, pid, exit_code, stop_reason, elapsed_ms, events — and `metrics` only when the runner module captured them (a CLI run records none).

### `experiment stop <slug> [--root <dir>]`

Finalize/record a stopped experiment in `run-state.json`. This **cannot** terminate an already-running synchronous experiment: the runner blocks while a run is in flight and no pid is recorded to signal, so `stop` only reconciles the run-state after the run has exited. If no pid is recorded (an in-flight run), it returns an error and writes nothing. A run that already finished comes back unchanged, and an experiment with no `run-state.json` is an error.

### `experiment harvest <slug> [--root <dir>] [--source-root <dir>] [--force]`

Copy `.planning/idea.md`, `experiment.json`, `state.md`, `run-state.json`, `agent-history.json`, `optimization/` (traces + reports) and `phases/` back into a fixed destination at `<source-root>/experiments/<slug>/`. `--source-root` selects the PAN source root (destination base); `--force` overwrites an existing harvest at that path; without it an existing harvest is an error. Non-destructive — leaves the experiment folder intact for re-runs.

### `experiment prune <slug> [--root <dir>] [--hard]`

Remove the experiment. Default is a soft prune — the experiment folder is renamed to `<root>/<slug>-archived-<timestamp>` (preserved, not deleted, and left out of `experiment list` unless `--include-archived`). With `--hard`, the folder is permanently deleted.

### `learn promote --pattern <id> --scope <s> --topic <t> --summary <text> --rule <text> [--evidence <text>] [--applies-in <text>] [--source-experiments csv] [--cites <path[#symbol]>,...] [--source-root <path>]`

Append a promoted pattern into `pan-wizard-core/learnings/{scope}/{topic}.md`. Scope is `universal` (ships to installs) or `internal` (source-only, stripped at install). Refuses duplicate IDs within the same topic file. When `--scope universal` is used, classifies the rule via `classifyPatternKind()` and attaches a `warning` to the result if the rule looks prompt-fragment-shaped (per P-RES-007). `--cites` names the code the pattern rests on, relative to the source root (`path` or `path#symbol`); each citation must hold when promoted, is stored with the pattern, and `learn lint` keeps checking it (L-007). Returns `{promoted_to, pattern_id, scope, topic, promoted_at, warning?}`.

### `learn unpromote --pattern <id> --scope <s> --topic <t>`

Remove a previously promoted pattern from a topic file. Used to undo a bad promote.

### `learn list-promoted`

Walk both scopes; return inventory `{universal: [...], internal: [...], total}` with id/topic/source_experiments per pattern.

### `learn lint [--scope universal|internal] [--strict]`

Validate the learnings store integrity. Checks: L-001 duplicate IDs across files, L-002 dangling pattern cross-references, L-003 empty `source_experiments` while body cites a known experiment name, L-004 universal-scope rule prose using PAN-internal terms, L-005 revision marker (`-rN`) without `superseded_by` frontmatter on the base, L-006 universal-scope pattern citing an internal pattern id (dangles after install), L-007 a pattern `cites` entry whose file or symbol is gone (an error). Exits non-zero on errors; warnings are advisory unless `--strict`. Wired into `/check`. Module: `learn-lint.cjs`.

### `learn build-index`

Generate `pan-wizard-core/learnings/index.json` with topic→agent-relevance map, byte/token-est sizes, and pattern lists. Curated `RELEVANCE` table assigns `high|medium|low` per `(topic, agent_role)` for `planner / executor / verifier / reviewer`. Read by `topics-for`. Module: `learn-index.cjs`.

### `learn topics-for --agent <role> [--cue <text>] [--min-relevance high|medium|low] [--token-budget N]`

Query the index for the topics to load within a token budget. It returns `{agent, min_relevance, token_budget, mode, cue?, selected: [...], dropped: [...], total_tokens}`. The workflow files (`plan-phase.md`, `exec-phase.md`, `verify-phase.md`, `execute-plan.md`) use it to load only relevant patterns instead of skimming the folder, which addresses the P-RES-002 distractor-density anti-pattern. Default budget 5000 tokens.

**`--cue` (mode `cue`)** is the task: the phase goal or plan objective, and the files it touches. The workflows pass it.
- **Matching:** the cue's words are matched against each topic's name (counting double) and its patterns' summaries and rules. Common words are ignored, and a word meets its own inflections.
- **What loads:** every topic scoring at least half the best match is a candidate, whatever its role relevance. Candidates are ranked by score, then relevance, then size; each selected topic carries its `cue_score`.
- **Golden set:** on `tests/fixtures/learn-cue-golden.json` this loads about five topics per task, against thirteen for the role ranking, with precision 0.37 vs 0.06 and recall 0.76 vs 0.45.

**Without a cue, or when nothing matches it (mode `role`):** topics tagged relevant for the role at `--min-relevance` (default medium), most relevant first, then smallest first. A large topic the task needs can drop out that way, which is why the workflows pass the cue.

---

## 24. Doc-Lint Commands

Markdown frontmatter + structure linter, vendored from the whooo experiment. Validates PAN-shipped markdown against schemas in `pan-wizard-core/references/schemas/`.

**Module:** `doc-lint.cjs` (adapter) + `pan-wizard-core/bin/lib/doc-lint/{frontmatter,schema,validate,walk,reporter}.js`.

**Exit codes — every subcommand.** `0` clean · `1` violations found · `2` (`doc-lint <dir>` only) the schema itself is malformed. The verdict is identical on the `--raw` and JSON paths; gate on the exit code in either format.

> Corrected in this version: the JSON paths used to exit `0` unconditionally, because `output()` exits the process and the `process.exit(<verdict>)` line below each call was unreachable. `doc-lint --format json` therefore never failed, and `doc-lint schema-check` never failed in *either* format. Earlier revisions of this page documented the JSON path as merely "reporting `schema_errors` in the body" — that described the defect, not an intended design. If you pinned a version to that behaviour, the linter was not gating.

### `doc-lint <dir> [--schema <path>] [--format human|json] [--strict] [--exclude <glob>]`

Walk `<dir>` for `.md` files, validate each against the named schema (default: `pan-command.schema.yml`, whatever the directory). Reports violations: missing required frontmatter fields, schema-type mismatches, structural issues. `--format` applies under `--raw` (a human report, or the violations as JSON); without `--raw` the result is always the JSON payload, suitable for CI gates. Exits `1` when any violation has `severity: error` (warnings alone exit `0`), `2` if the schema could not be parsed.

### `doc-lint schema-check <path>`

Verify the YAML schema at `<path>` is syntactically valid before it's used to lint anything. `<path>` is a required positional argument. Schemas live at `pan-wizard-core/references/schemas/*.schema.yml`. Exits `1` when `ok` is false.

### `doc-lint counts <dir> [--exclude <glob>]`

Scan `<dir>` for embedded numeric counts that violate the single-source-of-truth policy (counts belong only in `CLAUDE.md`). Repeat `--exclude` to skip paths. Reports each offending count with its file and line.

### `doc-lint flags [--doc-dir <dir>]`

Detect aspirational or stale flags documented for the PAN CLI that never appear as literals in the source (`pan-wizard-core/bin`, `bin`). `--doc-dir <dir>` (repeatable; a path relative to the project root, or an absolute path) replaces the default `docs`, so list `docs` again to keep it; a missing directory is skipped. Only lines that mention `pan-tools` are checked, and findings are reported relative to the project root. Exits 1 when any doc-only flag is found. Reports each doc-only flag with its file and line.

---

## 25. Skill-Aligned Decomposition Commands

SAD pass (ADR-0038, spec `docs/specs/skill-aligned-decomposition.md`): the planner drafts its task list, retrieves the skills (commands, templates, references, learnings topics) that loosely match each task, and realigns wording/granularity to what actually exists — SkillWeaver's decompose→retrieve→realign loop, keyword-scored, zero dependencies.

**Module:** `skill-align.cjs`

### `skills index [--source-root <path>]` (ADR-0038)

Build (on the fly — nothing persisted) and print the skill index: `commands/pan/*.md`, `pan-wizard-core/templates/**` (recursive), `pan-wizard-core/references/*.md`, plus learnings topics via `learn-index.cjs`. Returns `{entries, total, by_kind, skipped_roots}`. Missing roots are skipped and reported, never thrown — partial installs and non-Claude runtime layouts degrade gracefully. Default root is the install root (resolved relative to the module); `--source-root` exists for tests.

```bash
pan-tools skills index --raw
```

### `skills align (--draft "<text>" | --draft-file <path>) [--top <k>] [--min-score <n>] [--token-budget <n>] [--source-root <path>]` (ADR-0038)

Score each draft task (bullets/numbered/checkbox lines all accepted) against the skill index using `scoreRelevance`, after stripping planning glue words from the cue. Returns per-task top-k matches (names only), `coverage`, and a deduplicated `vocabulary` hint list ranked by aggregate score and greedy-packed into the token budget (default 1500) — overflow lands in `dropped`, never silently truncated. A draft that yields no tasks, or one over the max-task threshold, is reported as an `{error}` JSON body on stdout at **exit 1** (per "Error Shape"); omitting both `--draft` and `--draft-file` is a usage error on stderr, also exit 1.

```bash
pan-tools skills align --draft-file /tmp/draft-tasks.md --raw
```

Advisory and fail-open by design: no orchestrator step or checker dimension depends on it, and `pan-planner`'s `skill_alignment` step skips on any error.

---

## 26. Hygiene Commands

Project cleanup + version alignment (see `docs/FIELD-HARVEST-2026-07.md` follow-ups). Keeps a PAN-managed project aligned with the latest PAN version and free of accumulated history debris.

**Module:** `hygiene.cjs`

Both subcommands accept the planning-root flags (`--track`, `--planning-dir`, `--all-tracks`) documented under [Global Flags](#planning-root---track----planning-dir----all-tracks). Without them, only `.planning/` is scanned — and the scan says so, since a "clean" verdict is only meaningful alongside a statement of what was looked at.

### `hygiene scan [--trace-age-days N] [--track <name>] [--all-tracks]`

Read-only findings report. Checks: per-runtime `pan-file-manifest.json` version vs the latest seen (including the executing core's own version); untracked installs (`pan-wizard-core` without a manifest); legacy uppercase planning filenames (pre-v2.2); orphaned atomic-write `.tmp` files older than 1h; per-agent memory logs past the compaction cap; **poisoned cost ledgers** — ≥50% suspect records *or* ≥50% of the token **mass** in suspect records, once the ledger holds at least 20 records (v3.27: a count-only gate passed a ledger whose 24% bad rows held 89% of the tokens); trace sessions older than retention (default 30d, newest 5 always kept); **optimization reports** past the same retention (v3.27 — traces aged out while the analysis JSON beside them never did); **cached context bloat** — the stable planning files `cache prime` lists, warned at 15k tokens and critical at 25k, with any single file over 6k called out: `state.md`, re-read on every agent call, carries the `compact-state` remedy while it has settled history to archive, and `roadmap.md`, read whole only by the roadmapper and milestone work (phase agents read `roadmap slice`), carries `compact-roadmap` while shipped phases can move to `roadmap-history.md`; fragment `.planning/` dirs with no workflow spine (phase, focus, and orchestration layouts all count as spines); a **`foreign-planning-tree`** warning when the tree carries markers of another tool (gsd-core's `HANDOFF.json`, `.gsd-allow-shrink`, two or more gsd-only directories, or its flat dotted `config.json` keys) — that tree gets the one warning and no per-tree checks, since its uppercase files would otherwise read as legacy PAN filenames; a **`shared-planning-tree`** info finding when another tool writes into the tree beside PAN (planning-with-files markers), after which PAN's own checks still run; and, under `cache-context` at `info` (`warn` once the re-written context is large), the prompt-cache lifetime recommendation that `context-budget` reports as `cache.ttl`. Memory: `memory-stale` (entries `memory select` leaves out because their cited code is gone or they went unused past the expiry window; fix `prune-memory`) and `memory-format` (a file in `.planning/memory/` with no `## Entries` list, or whose name is not a valid agent name, which `memory select` and `knowledge playbook` never read as memory (`knowledge ask` can still offer it as a source)). Once per project, read-only, `host-memory`: Claude Code's auto-memory index (`~/.claude/projects/<project>/memory/MEMORY.md`, under `CLAUDE_CONFIG_DIR` instead of `~/.claude` when that is set, or `autoMemoryDirectory`). It reports an index past the 200-line / 25 KB session-start load limit (`warn`) or near it (`info`), and index lines that hold content where a one-line pointer belongs (`info`). PAN never writes that store. Also once per project, `host-memory-routing` (`info`): a memory file in that directory with a note that describes doing PAN's work another way (editing `.planning/` or state.md by hand, a commit cadence, skipping the plan or verification, avoiding PAN), named by file and rule id, never by its text. Per tree, read-only (`info`): `focus-stale-run` (a focus run `initialized` or `in_progress` with nothing recorded for `focus.stale_hours`; fix by hand: `focus auto --stop`, then `--continue`), `open-task-stale` (a quick task, a focus cycle included, whose plan has had no summary for 24 hours; the detail names the close command for a focus cycle), `pause-open-stale` (a pause open for a week) and `journal-abandoned` (a plan with no summary whose latest journal row or `PAN-Step` task commit is a day old; reported on the journal, or on the plan when it has only commits). Also per tree, `trailer-scan-failed` (`warn`): the `PAN-Step` task commits could not be read, so resume points and abandoned-plan ages use the journals only. Returns `{findings, installs, latest_version, host_memory, planning_exists, planning_root, track, planning_root_source, planning_root_exists, all_tracks, roots_scanned, summary}` — each finding has `check`, `severity` (`critical|warn|info`), `path`, `detail`, `fix` (the action `hygiene clean` would take, e.g. `{"action": "prune-memory", "agent": "pan-executor"}`, or `null`), `fixable`, and `track` (the tree it came from; `null` for the root tree or a project-wide check). `summary.by_track` breaks findings down per tree. Version alignment is a project property and is reported once no matter how many trees are swept.

```bash
pan-tools hygiene scan --raw
```

### `hygiene clean [--apply] [--trace-age-days N] [--track <name>] [--all-tracks]`

Dry-run by default (lists what would change); `--apply` executes the safe subset: two-step case-hop renames of legacy filenames, `.tmp` orphan deletion, memory-log compaction (`compactMemory`), poisoned-ledger **quarantine-by-rename** (`tokens.jsonl.quarantined-<date>` — the poisoned rows are kept, but only the newest quarantine file survives; the hook's `.cost-cursor.json` is kept, since it tracks transcripts rather than the ledger), stale-trace and stale-report pruning, `state.md` compaction (`compact-state`, archiving settled sections to `.planning/state-history.md`, beside state.md), roadmap compaction (`compact-roadmap`), and archiving stale or expired memory entries (`prune-memory`). Version drift (remediation = re-run the installer) and fragment dirs (manual review) are never auto-fixed, and the legacy-filename rename refuses outright on a tree the scan flagged as `foreign-planning-tree` — PAN never renames another tool's state. Returns `{dry_run, applied, skipped, planning_root, track, planning_root_source, planning_root_exists, all_tracks, roots_scanned, summary}`. Under `--all-tracks` each fix is applied within its own tree's scope, so a track's bloated memory log is compacted in that track rather than in the root tree.

```bash
pan-tools hygiene clean --apply --raw
```

Wrapped by the `/pan:hygiene` command: scan → present by severity → version-drift remediation → dry-run clean → confirm → clean → report (it recommends re-running `/pan:hygiene` after the installer rather than re-scanning itself).

---

## 27. Optimization, Git and Distill Commands

Verbs the Command Index lists that had no section of their own. Wrapped by `/pan:learn --optimize`, `/pan:learn`, `/pan:git` and the `distill` focus-auto category.

### `optimize trace <init|log|end|current|list|show|reconcile>` · `optimize learn` · `optimize apply` · `optimize revert` · `optimize list` · `optimize stats`

**Module:** `optimize.cjs`. Trace sessions live at `.planning/optimization/traces/<session>/` (`trace.jsonl` + `session.json`); reports at `.planning/optimization/reports/`. Bare `learn` is the documented alias for `optimize learn`, and takes its `--session` and `--sessions` flags.

```bash
pan-tools optimize trace init --description "exec phase 5" --command exec-phase --phase 5
pan-tools optimize trace log --agent pan-executor --type decision --category deviation --impact minor --tokens-wasted 1200 --context '{"task":"05-01"}'
pan-tools optimize trace current                    # the open session
pan-tools optimize trace list                       # every session on disk (open and ended)
pan-tools optimize trace show --session <id>        # one session's events
pan-tools optimize trace reconcile [--session <id> | --all]   # rewrite session.json counters from trace.jsonl — the open session by default, one by id, or all
pan-tools optimize trace end [--session <id>]
pan-tools optimize learn [--session <id>]           # analyse events → report
pan-tools optimize learn --sessions <n>             # pool the last n sessions into one analysis
pan-tools optimize apply [--report <path>]          # record the report's suggestions in suggestions.md; prints the apply_id
pan-tools optimize revert <apply_id> | --last       # undo one apply exactly
pan-tools optimize list                             # reports on disk
pan-tools optimize stats
```

The dispatcher parses these flags for `trace`: `--session`, `--all`, `--description`, `--command`, `--phase`, `--agent`, `--type` (`decision`, `error`, `gap`, `correction`, `redundancy`, `memory_hit`, `memory_miss` or `surprise`; anything else is stored as `unknown`), `--category`, `--impact` (`critical`, `major`, `minor` or `trivial`; anything else is stored as `minor`), `--correction`, `--tokens-wasted` (number), `--context` (JSON; invalid JSON is dropped). `learn` takes `--session`, or `--sessions <n>` (a whole number; `1` analyses the current session as plain `learn` does, and a larger number writes `pooled-<k>-<newest session>-analysis.json`, `k` being the sessions actually found). `apply` takes `--report` (default: the newest report). It writes `note` actions to `optimization/suggestions.md` and `planning_note` actions to `optimization/config-suggestions.md`; on an `-analysis.json` file it derives the notes itself and points them at the project's instructions (CLAUDE.md or AGENTS.md, outside PAN's section), except a judge's repeated failures, which point at its findings in `.planning/findings.jsonl`. An older report's memory actions (`memory`, `memory_append`, `memory_entry`) still write to `.planning/memory/`, a `memory_entry` only if `memory record` accepts it, and the result gives each such write a `warning` that PAN's workflows do not load that folder into agents. `revert` takes an `apply_id` or `--last`.

**What `learn` reads.** The analysis carries `tool_error_patterns`, failed tool calls the trace hook captured from subagent transcripts. They are grouped by agent, tool, class and message, and ranked by the number of `spawns` they recur in, then by occurrences; each also carries its `sessions` count. It also carries `verdict_stats`: each judge's `pass`/`fail`/`needs_human`, its `retries`, and the retries that resolved a failure. The legacy verdict categories that older sessions hold are counted too. A tool failure becomes a suggestion only when it recurs across spawns; memory misses, knowledge gaps and a judge failing twice or more also become notes.

**Revertible applies.** Every apply is logged in `optimization/applied.jsonl` with an `apply_id` and one record per action it wrote: the path, `created` or `appended`, the exact appended text, and a line-ending-insensitive hash of the file after the write. Applying the same report again skips each action with `already applied in <apply_id>`. `revert` deletes the files an apply created and cuts the text it appended, and it refuses in two cases:
- a file that changed, or is gone, since the apply;
- a file that a later unreverted apply also wrote (reverts go last-in, first-out per file).

A CRLF file is written back CRLF. The status is `reverted`, `partial`, `refused` or `nothing_to_revert`, with `refused[]` naming each file and why. Applies logged before these records existed report `not_revertible`. `stats` counts `apply_runs` and `reverted_runs` and names the `last_apply_id`.

### `git <commit|branch|push|status|log|stash|diff|rollback|tag|sync> [...]`

**Module:** `git.cjs` — phase-aware git workflow; `commit` reuses `runCommitSafetyChecks` (deleted-file, sensitive-file-name and staged-content gates). Works in any git repo, with or without `.planning/`.

```bash
pan-tools git commit --message "..." [--type feat] [--all] [--amend] [--force] [<file>...]
pan-tools git branch <create|switch|list|delete|current> [--name <n>] [--phase <N>] [--force]   # --phase 3 names it pan/phase-3
pan-tools git push [--remote <r>] [--branch <b>] [--force]     # remote validated; --force required for a force-push
pan-tools git status
pan-tools git log [--count <N>]                     # default 10
pan-tools git stash <save|pop|list|drop> [--name <n>] [--index <i>]
pan-tools git diff [--staged] [--file <path>]
pan-tools git rollback [--tag <pan-rollback-*>] [--dry-run]    # resets --hard to the given tag, or to the lexically last pan-rollback-* tag (`git tag -l` order — not necessarily the newest; pass --tag to be explicit); refuses on a dirty tree (dirty_working_tree);
                                                               # --dry-run only reports the target — list snapshots with `pan-tools git tag list --pattern 'pan-rollback-*'`
pan-tools git tag <list|create|delete> [--name <n>] [--message <m>] [--pattern <glob>]   # --pattern for list; --name/--message for create; --name for delete
pan-tools git sync [--remote <r>] [--branch <b>] [--rebase]
```

`git status` prints `{branch, clean, staged_count, unstaged_count, untracked_count, files[]}`. `files` are the `git status --porcelain` lines with their two-letter status column kept (` M src/a.js`, `M  src/b.js`, `?? c.js`, `R  old.js -> new.js`); an entry counts as staged when its first column is set and as unstaged when its second is, so a file staged and then edited again counts in both. `--raw` prints `<branch> (clean)` or `<branch> (<N> changes)`. Outside a git repository every `git` subcommand prints `{error: "not_a_git_repo", hint}` and exits 1.

### `distill <scan|analyze|report> [--bloat-threshold N] [--touched-loc N]`

**Module:** `distill.cjs` — the deterministic passes of the AI code-bloat optimizer (phantom try/catch, unused imports, magic numbers, long functions, wide parameter lists, single-instance factories, deep nesting, repeated blocks, unreferenced exports); the `pan-distiller` agent judges only the flagged spans. Cross-session memory at `.planning/memory/distill-patterns.md`. The bloat-budget gate compares touched LOC against essential LOC; `--bloat-threshold` overrides the default ratio of `2.0`.

---

## 28. Evidence Loop Commands

**Module:** `findings.cjs` (with `verdict.cjs`). ADR-0049. PAN's judges put their verdict on record:
- the plan checker, the reviewer and the design checker end their report with a fenced `pan-verdict` JSON block;
- the verifier's verdict is its verification.md frontmatter.

The workflows save each report, record it with `findings record`, and branch on what the record prints. Whenever they continue past findings, they record why with `findings dispose`. The ledger is `.planning/findings.jsonl`: append-only, folded on read, committed with the other planning docs.

```bash
pan-tools findings record --phase 3 --file .planning/phases/03-auth/03-verification.md [--raw]
pan-tools findings record --phase 3 --agent pan-reviewer --file .planning/phases/03-auth/03-review.md --raw
pan-tools findings record --phase 3 --stdin < report.md
pan-tools findings list [--phase N] [--agent A] [--status open|fixed|deferred|dismissed|decision] [--class C] [--milestone V]
pan-tools findings dispose f_81ab3c9d20 --as dismissed --reason "generated file, not project code"
pan-tools findings dispose --phase 3 --agent pan-reviewer --open --as deferred --reason "accepted at review: PASS_WITH_WARNINGS"
pan-tools findings debt [--milestone v1.1] [--raw]
pan-tools findings suppressions [--phase N] [--agent A] [--raw]
pan-tools findings prove f_81ab3c9d20 --test .planning/reviews/3/proofs/catch.test.js [--timeout <ms>]
```

**`findings record`** takes exactly one of `--file`, `--text` or `--stdin`, plus `--phase` and optionally `--agent`.
- **Input.** It reads the last `pan-verdict` block; without one, it reads a verification frontmatter (`status`, `gaps`, `human_verification`, `unrequested`, `test_gate`, `not_checked`). It prints `{contract, recorded, duplicate, verdict_id, agent, verdict, outcome, not_checked, source_kind, attempt, phase, findings, new, rematched, resolved, unaddressed, reopened, suppressed, returned, warnings}`, plus `ledger` when it wrote a verdict, and `agent_verdict` and `lowered_by` when a code fact lowered the judge's word.
- **What was not checked.** `not_checked` lists `{check, reason}` for each check the judge could not run. A verification with `test_gate: skipped` always carries a `tests` entry, so a pass whose tests never ran is never recorded as a plain pass. The warnings name a verification that does not record `test_gate` (`test_gate_unrecorded`) and a failed gate under a passed status (`test_gate_failed_under_pass`). `--raw` prints the recorded verdict word (`gaps_found`, `NEEDS_FIXES`, `issues_found`, `GAPS` …): the judge's own word, or the lowered one when a code fact lowered it. It prints the outcome when there is no word.
- **Exit codes.** A failed verdict is data: exit 0. An unreadable input exits 1 with `{error, reason}`, for example `no_verdict`, `invalid_json`, `unsupported_contract` or `phase_not_found`. That is what a workflow's `||` fallback runs on.
- **Idempotency and attempts.** Recording the same artifact twice is a no-op that returns the first verdict. Each new verdict from an agent on a phase is the next `attempt`.
- **Code facts only lower.** A verification with `status: passed` over `test_gate: failed` records as `gaps_found`, with a high finding at `code-fact:test_gate`; the judge's word is kept as `agent_verdict`.
- **Closing on evidence.** An earlier open finding becomes `fixed` only when the new report answers it `resolved` with evidence (a `resolutions` entry, or a truth in the verifier's `re_verification.gaps_closed`), or when its code fact now passes. One the report does not repeat, or answers other than `resolved` with evidence, stays open and is listed in `unaddressed`. `still_present` reopens a `fixed` finding. A reworded report of an earlier finding keeps its id (`rematched`).
- **Trace.** It logs `verdict_passed`, `verdict_failed` or `verdict_needs_human`, plus `verdict_retry` after a failed attempt.

**`findings list`** filtered by both `--phase` and `--agent` adds `churn`: `{reports, transitions, added, dropped, rate}`, how many ids appeared or disappeared between that judge's consecutive reports.

**`findings dispose`** takes finding ids, or `--phase N [--agent A] --open`, and records `fixed`, `deferred`, `dismissed` or `decision`. It refuses `deferred`, `dismissed` and `decision` without `--reason` (exit 1: never dispose silently). A later report does not override a `deferred` or `decision` disposition; a `fixed` one, deliberate or automatic, reopens when the finding is reported again. A `dismissed` one records the hash of the file its `where` names and becomes a learned suppression (below).

**Learned suppressions.** While the dismissed finding's file is unchanged, `findings record` filters the same judge's report of the same finding (same class family, same file, same truth or a similar summary). It is not one of the verdict's findings and is listed under `suppressed` as `{id, scope, summary}`. A suppression is a `candidate` in the phase it was dismissed in, and `promoted` to every phase once the same judge's finding was dismissed in two phases. Once the file changes, the suppression retires: a report of the finding reopens it, counted in `returned`. Logic findings (`defect`, `contradicts`, `missing`, `partial`), security findings (any `pan-hardener` finding, or a summary naming injection, auth, secrets, crypto and the like) and findings with no project file are never suppressed: a report of one reopens it. **`findings suppressions`** prints `{contract, suppressions[], active}`, each suppression `{id, agent, phase, class, file, summary, reason, scope, active}`; `--agent` keeps one judge's, `--phase` keeps that phase's candidates and every promoted one, and `--raw` prints the active count.

**`findings debt`** is what `/pan:milestone-audit` reads for tech debt. For one milestone (default: the current one), it groups the `deferred` findings, each with the reason recorded at the time, and the `open` ones nobody disposed, by phase: `{contract, milestone, phases: [{phase, deferred[], open[]}], deferred_count, open_count}` (`--raw`: `N deferred, M open`).

**`findings prove`** runs a catching test for a finding (program R5): it should pass at the phase's base and fail at HEAD. Prints `{id, status, test, base, command, base_exit, head_exit, detail?, confidence}`; `status` is `confirmed` (exit 0; `confidence: confirmed`), `fails_at_base`, `passes_at_head` or `not_checked` (exit 1; `confidence: candidate`). Each run appends a `proof` row to the ledger.

**Finding vocabulary.** `class` is one of `missing`, `partial`, `contradicts`, `unrequested`, `defect`, `risk`, `quality`, `human`. `severity` is one of `critical`, `high`, `medium`, `low`, `info`. The shipped reference `pan-wizard-core/references/verdict-contract.md` maps each judge's own terms onto them.

---

## 29. Bot Army and Report Commands

The bot-army registry, worktree isolation and campaign scheduling behind `/pan:army`, and the read-only HTML views (`hud`, `report`).

### `squad list | show <name>` (ADR-0032)

Bot-army squad registry. `squad list` shows every squad (architecture / build / quality / release) with their model tier, tool-access contract, and member count; `squad show <name>` shows one squad's full roster. Read by `pan-conductor` campaign mode and `/pan:army` to resolve the roster at runtime instead of hardcoding it.

**Module:** `squads.cjs`

### `worktree list | create <task> | remove <path> | cleanup` (ADR-0033)

Branch-per-agent git worktrees for the Build squad — each builder gets its own `army/<task>` branch + isolated tree so concurrent agents never collide. Worktrees are created as **siblings of the project directory** (`../pan-army-<slug>/`). `create` accepts `--base <ref>`; `remove` accepts `--branch <name>` `--force` and refuses to delete non-`army/` branches.

`worktree cleanup [--force]` is the campaign teardown sweep: removes every registered army worktree, prunes stale registrations, and deletes `army/*` branches — but a branch whose tip is **not reachable from HEAD** (squash-merged, or aborted work that exists nowhere else) is *kept* by default and listed with the exact command to delete it; a dirty worktree is likewise kept. `--force` sweeps both. The result reports `removed_worktrees`, `deleted_branches`, `kept` (each with a reason), `pruned`, and `clean`. Run it at campaign end and on any abort path; the per-task `worktree remove <path> --branch <name>` right after a squash-merge lands is the always-correct deletion, since at that moment the merge is the permanent artifact.

**Module:** `worktree.cjs`

### `worktree preflight --branches <a,b,...> [--base <ref>] [--test <command>]` (program A3)

Shadow-merge check before a group of branches is merged back (`/pan:autodev --worktrees` runs it). It adds a throwaway detached worktree at `--base` (default `HEAD`) under the OS temp directory, runs the test command there, merges each branch in order with `--no-ff`, and runs the tests again; the worktree is removed afterwards. `--test` defaults to the project's detected test command. Returns `{ok, verdict, base, branches, test, merged, alone}`, where `verdict` is one of:
- `clean` — every branch merged and the tests pass (`ok: true`)
- `conflict` — a merge conflicted; `conflict: {branch, files, after}` names it and the branches merged before it
- `break_together` — each branch passes alone, merged together they fail
- `branch_fails` — the branches in `failing` fail on their own (`alone` maps each branch to its result)
- `base_failing` — the tests already fail on the base, so no merge can be judged
- `no_test` — no test command was given or detected

A verdict exits 0, whatever it is. Outside a git repository it prints `{error: "not_git"}`, and `{error: "worktree_failed"}` when the worktree cannot be added; both exit 1. `--raw` prints the verdict.

### `merge request <branch> [--phase N] [--ci-green]` · `merge confirm <branch>` (program L6a)

The human merge gate on the CLI, the same gate the MCP bridge uses. `request` stages the merge and prints the record without its approval token (`status: awaiting_approval`, `verify_pass`, `verify_source`, `requested_at` and `expires_at`, plus `gate` when `--phase` is given, in which case `verify_pass` is the phase gate's verdict, not the caller's word). A request can be approved for `orchestration.approval_ttl_hours` (default 72; `0` never expires); after that a confirm is refused `approval_expired` and the merge must be requested again. A confirmed merge records `approved_at`. `confirm` squash-merges only in an interactive terminal after the person types the branch name; without a TTY it exits 1 with `human_terminal_required`. There is no flag or environment variable that skips this.

**Module:** `merge.cjs`

### `campaign schedule | status | due | record-run` (ADR-0034)

Scheduled, self-resuming bot-army campaigns. PAN is not a daemon: this module owns the schedule **descriptor** and the decision of whether a run is **due** — an external trigger (host scheduler, cron, `/loop`, or a human) polls `campaign due` and fires `/pan:army --continue`. The always-ask human merge gate is never affected by scheduling. Descriptor lives at `.planning/orchestration/schedule.json`.

**Module:** `campaign.cjs`

- `campaign schedule` — arm or update the schedule. Flags: `--cadence <hourly|daily|weekly|Nh|Nd>` (default `daily` when first armed; an update without it keeps the stored cadence), `--daily-budget <points>` (default 300), `--goal <text>`, `--source <name>` (default `backlog`), `--pause`, `--resume`, `--disable`, `--enforce-budget` (the daily budget pauses the day's run once spent) and `--advisory-budget` (back to the default: tracked, never a stop). Returns the written descriptor. There is no `--enable`: after `--disable`, set `"enabled": true` in `.planning/orchestration/schedule.json` by hand.
- `campaign status` — `{scheduled, enabled, paused, cadence, daily_budget, next_due, last_run, runs, spent_today, due, reason, verify_reserve, into_verify_reserve}` (`{scheduled: false}` when nothing is armed; `goal`, `source` and `history` live only in `schedule.json` and the `campaign schedule` return). Also the default when `campaign` is run with no subcommand.
- `campaign due` — host-scheduler gate: returns `{due, reason, next_due}`. `reason` is one of `no_schedule`, `disabled`, `paused`, `budget_exhausted_today` (only when the descriptor's `enforce_budget` is `true` — the daily budget is advisory otherwise), `due`, `not_yet`. **Exit codes:** `0` — due; `1` — not due. The payload has no `error` key, so the code is set explicitly; a `cron`/`&&` trigger can gate on it without parsing the body. "Not due" is a negative *answer*, not a failure, so pair the exit code with `reason` if you need to distinguish it from a broken descriptor.
- `campaign record-run` — record a completed run and advance `next_due`. Flags: `--items <N>`, `--points <N>`.

### `hud [--out <file>] [--open] [--stdout]` (ADR-0035)

Generates a single self-contained HTML dashboard of the project + bot army (default `.planning/hud.html`). Aggregates existing state — `state.md`, roadmap/phases, the squad registry, the campaign schedule, army worktrees, the cost ledger, `requirements.md`, verification artifacts, and git history — into one page of panels. It is a read-only **view**: it writes only its own rendered file and creates no new state. Army-only panels (command stack, campaign, safety harness, worktrees) self-hide on plain (non-army) projects. A focus panel (the auto run, whether it is stale, its cycles and items, and an open focus cycle) shows whenever focus has a run or an open cycle, roadmap or not. `--out` overrides the path, `--open` launches the default browser, `--stdout` prints HTML instead of writing. The file is dependency-free (inlined CSS, no `<script>`, no network) and identical on every runtime. Distinct from the JSON `pan-tools dashboard` command (`state.cjs`), which prints a compact project overview rather than HTML.

**Module:** `hud.cjs`

### `report phase <N> [--out <file>] [--open] [--stdout] | index [--bundle] [--out <file>] [--open] [--stdout] | all [--open]`

`report all` writes every phase report plus the index to their default paths; its one flag, `--open`, opens the index in the default browser (only when the index was written or changed), and the result reports it as `opened`. Generates self-contained HTML reports for a project's phases, reusing the HUD's rendering. `report phase <N>` writes one phase's report (objective, roadmap position, what changed, verification verdict and gaps) to `.planning/phases/<NN-slug>/<NN>-report.html`; `report index` writes the project timeline to `.planning/report-index.html`, where each row links to a phase report; `report all` regenerates every phase report plus the index in one pass. Like `hud`, these are read-only **views** — every value is read from what PAN already tracks on disk (phase `plan`/`summary`/`verification` artifacts and their frontmatter, `roadmap.md`, and the cost ledger), and the command writes only its rendered file(s), so it can never corrupt planning data. Writes are deterministic: re-running with unchanged phase data rewrites nothing (the volatile generated-at timestamp is ignored when comparing), so reports produce no git churn. `--out` overrides the path, `--open` best-effort launches the default browser (only when the file was written or changed), `--stdout` prints HTML instead of writing (for `phase`/`index`). `--bundle` (on `index`) instead writes one self-contained `.planning/report-bundle.html` with every phase inlined under in-page anchors and no links to sibling files — the form to email or attach. A phase-less (focus-auto) project has nothing to report; `index` exits with a message pointing to `pan-tools hud` instead.

**Module:** `phase-report.cjs`
