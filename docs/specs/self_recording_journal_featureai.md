# Feature: Self-recording step journal (commit trailers as resume evidence)

**Status:** Design (`2026-11-02`), not built. Follow-up to ADR-0052 and `durable_orchestration_featureai.md` (Stage C, D3).
**Process:** `/featureAI`, all phases, design only.

---

## Phase 0: Problem framing

### 0.1 Problem statement

Stage C gave every plan a step journal so a crashed run resumes after the last task it can prove done. The proof only exists if the executor records it, and recording is a separate tool call made *after* the commit: the executor stages and runs `git commit`, reads the hash, then calls `pan-tools journal step --plan P --step task-N --event completed --commit $TASK_COMMIT` (`agents/pan-executor.md` task_commit_protocol step 6, `pan-wizard-core/workflows/execute-plan.md` task_commit step 6). A model that skips that call, or crashes between the two calls, leaves no line, and `resumePoint` reports `resume_at: null` (restart at task 1). These are the conditions the journal exists for: long plans, compaction, crashes. ADR-0052 names this as its first risk ("The journal only helps when the executor records it"). The fix is to make the record part of something the executor cannot skip: the task commit itself.

### 0.2 Scope

| In scope | Out of scope |
|---|---|
| A `PAN-Step` trailer in each task commit's message, written by the executor as part of the message it already writes | A git `commit-msg` hook that adds the trailer (PAN does not install git hooks into user repos) |
| `resumePoint` reading trailers from HEAD's history as evidence, merged with the journal | Changing `pan-tools commit` or `pan-tools git commit` (rejected: Alternatives) |
| Reverted task commits not counting | Quick tasks and focus cycles (their plans are not phase plans; they keep the journal as is) |
| `init resume` / open-work and hygiene H-15 seeing plans that only have trailer evidence | Fork from a checkpoint (still deferred, spec D6) |
| One git call per process for all trailer evidence, memoised by HEAD | Deterministic replay |
| A tier-0 harness scenario with a mutation control | Migration of existing journals (none needed) |

### 0.3 Success criteria

```
SC-1: A plan whose task commits carry PAN-Step trailers and which has NO journal file resumes at the first task without a trailer (init resume, journal resume-point), in all 5 runtimes (one engine path; prompts reach all runtimes through the installer's path rewrite).
SC-2: A trailer counts only while its commit is reachable from HEAD and has not been reverted by a later reachable commit.
SC-3: The journal still wins where it is newer: a step whose latest journal row is started/failed/paused/forced after the trailer commit's time is not completed by the trailer.
SC-4: resumePoint on a project with no trailers and no journal returns exactly today's output (resume_at null); existing journal tests pass unchanged.
SC-5: Evidence costs at most one `git log` per process however many plans are checked; per-step merge-base calls for journal commits are skipped when the sha is in the scanned window.
SC-6: Unit tests (>= 10 cases) and a tier-0 harness scenario whose control (the installed trailer reader disabled) turns it red.
SC-7: Prompt-lint, prompt-rules registry, surface/liveness checks, doc lints and the full suite pass; docs and ADR-0052 updated.
```

### 0.4 User stories

```
As a PAN user whose session crashed in task 7 of a 9-task plan,
I want /pan:resume to restart at task 7,
so that I don't pay for tasks 1-6 again, instead of restarting the plan because the executor forgot to journal.

As a PAN user who rebased a feature branch mid-plan,
I want the rebased task commits still to count as done,
instead of every journal line going "unverified" because its sha changed.

As a PAN user running autodev --worktrees,
I want the evidence for a plan's tasks to come back with the merge,
instead of living only in a journal file inside a worktree that is removed.
```

---

## Phase 1: Internal reconnaissance (code read `2026-11-02`)

| Area | What exists | Consequence for the design |
|---|---|---|
| `journal.cjs` | `resolvePlan` (id or path → `{id, plan, journal}`), `readJournal`, `latestByStep`, `artifactHolds` (one `merge-base --is-ancestor` per commit step), `planTasks` (`countPlanTasks`), `resumePoint` (`resume_at` is `null` when the journal has no rows), `journalsIn` (only plans that have a `-journal.jsonl` and no summary) | Trailer evidence must be merged inside `resumePoint`, and `journalsIn` must also visit plans that have trailers but no journal file |
| Executor commit protocol | Raw `git add <file>` per file, `git commit -m "{type}({phase}-{plan}): …"` with bullets, `TASK_COMMIT=$(git rev-parse --short HEAD)`, then the journal call. TDD tasks make several commits (RED `test(…)`, GREEN, REFACTOR). Consecutive trivial tasks may be coalesced into one commit (P-1605) | The trailer goes into the message template the model already fills in. Coalesced commits carry one trailer line per task. TDD: only the commit that finishes the task carries it |
| `pan-tools commit` (`commands.cjs` `commitPlanning`) | Commits **planning docs**; skipped when `commit_docs` is false or `.planning/` is gitignored | Wrong vehicle for code commits |
| `pan-tools git commit` (`git.cjs` `commitPaths`) | Code commits with safety checks: blocks on **any** deletion in the repo unless `--force`; `--type` prefixes `type: ` (no scope) | Switching the executor to it would change what its task commits do (deletion block, message shape) |
| Autodev `--worktrees` (`autodev.cjs`, `worktree.cjs`) | Each plan runs in its own worktree; merged back with `merge --no-ff` | Task commits (and their trailers) stay reachable from the main HEAD after the merge; a journal file written inside the worktree does not come back unless committed |
| Milestone numbering (`milestone-new.md`) | New milestones continue phase numbering | A plan id (`03-02`) is unique within a project in normal use, so a trailer can name the plan by id |
| Hygiene H-15 (`checkDurableState`) | `journal-abandoned`: a plan with a journal, no summary, last row older than a day | Must also see trailer-only plans |
| Open-work (`open-work.cjs`) | Adds `resume_at`, `completed_steps`, `unverified_steps` from `journalsIn` | Inherits trailer evidence through `journalsIn` |
| Harness `resume-from-journal` | `journal-tasks.cjs` commits with raw git and journals each task; control `journal-deleted` must turn it red | Must keep committing **without** trailers, or its control stops proving anything |
| Harness controls | `delete`, `write`, `replace` of a path in the workspace (`harness/src/run.cjs`) | A `replace` in the installed `journal.cjs` can disable the trailer reader: a mutation control on the shipped engine |
| git on the dev machine | `2.55` | Design uses only `git log --format=%H%x1f%ct%x1f%B`, available in every git PAN supports; no `%(trailers)` placeholder (its options vary by git version) |

### 1.3 Runtime compatibility

Nothing runtime-specific. The trailer is plain text in a commit message; the reader is engine code; the prompts are the shared executor prompt and workflow, which the installer rewrites per runtime (`~/.claude/…` paths) as today. OpenCode, Codex, Gemini and Copilot executors run the same task_commit_protocol text.

---

## Phase 2: Competitive analysis (no new research run)

- **Git trailers are the established place for machine-readable commit metadata**: `Signed-off-by`, GitHub's `Co-authored-by`, Gerrit's `Change-Id` (a stable id that survives amend and rebase, which is exactly the property needed here). `git interpret-trailers` defines the format; PAN parses leniently instead of calling it (below).
- **LangGraph / Temporal** (from the `2026-11-01` research) keep step state in their own store; the equivalent of "the step's output is its own checkpoint" is a task whose activity result is persisted atomically with its completion. Putting the step id into the commit is PAN's version of that atomicity: the work and its record land in one git operation.
- **Differentiation:** the evidence lives in the user's own history, needs no PAN state file, survives `rm -rf .planning/phases/*/…-journal.jsonl`, rebases and worktree merges, and costs no extra tool call per task.

---

## Phase 3: Design

### D1. The trailer

```
feat(03-02): add session refresh endpoint

- POST /auth/refresh rotates the refresh token
- 401 on reuse

PAN-Step: 03-02/task-4
```

- Key `PAN-Step` (matched case-insensitively), value `<plan id>/<step>`. `<plan id>` is the id `resolvePlan` returns (`03-02`, `02.1-03`, `03A-01`); `<step>` is `task-N`.
- One line per task. A coalesced commit carries a line for every task it holds.
- **Lenient parse:** any line of the message matching `^\s*PAN-Step:\s*(\S+?)\/(task-\d+)\s*$` (leading whitespace allowed, so `git merge --squash`'s indented message bodies still count). The trailer does not have to be in the last paragraph; models do not reliably add the blank line.
- Only the commit that **finishes** a task carries it. A TDD RED commit (`test(…)`) does not.

### D2. Trailer index (`journal.cjs`, new internal `trailerIndex(cwd)`)

- One call: `git log -n 1000 --format=%H%x1f%ct%x1f%B%x1e HEAD`. Commits from `git log HEAD` are reachable from HEAD by construction, so no per-step reachability call is needed.
- Window: the newest 1000 commits (`TRAILER_WINDOW`, a constant, not config). A plan whose task commits are deeper than that falls back to its journal; at a few commits per task this covers far more than any open plan.
- Parse each body for `PAN-Step` lines → `Map<"<plan>/<step>", {sha, time}>`, keeping the **newest** commit per key.
- **Reverts:** a body with `This reverts commit <sha>` removes that sha's trailers from the index (the revert is newer in the log than what it reverts, so collect reverted shas first, then build the map). A revert of the revert puts it back the same way (the whole pass works on the set of shas net-reverted).
- Also returns `shas: Set<full sha>` so `artifactHolds` can answer "reachable" for a journal commit by a prefix lookup in the window before falling back to `merge-base`. SC-5.
- **Memoised per process**, keyed by `cwd` + `git rev-parse HEAD`. `journalsIn` over a phase with several plans, `init resume` and hygiene all share one scan.
- Not a git repo, no commits, or git fails → empty index (today's behaviour).

### D3. Merge rule in `resumePoint`

For each plan task `task-N` (the plan's order; journal-only steps keep today's handling):

1. **Journal row, latest event `completed`, artifact holds** → completed, `source: 'journal'`.
2. Else, **trailer** `<id>/task-N` in the index, and the journal has no row for the step newer than the trailer commit's time whose event is not `completed` → completed, `source: 'trailer'`, `commit: <short sha>`. (A step re-started, failed, paused or forced *after* that commit is the journal's call. `forced` is never overridden.)
3. Else, journal row `completed` whose artifact does not hold → `unverified` (today).
4. Else open.

`resume_at` is the first open task when the plan has **any** evidence (journal rows or trailers); `null` only when it has neither, which keeps SC-4. `completed` items gain `source`. `all_done` is unchanged in meaning.

A rebased plan is the motivating case for rule 2 after rule 3: its journal shas are gone, but the rebased commits still carry the trailers, so the step counts as done instead of `unverified`.

### D4. Who sees trailer-only plans

- `journalsIn(cwd, phaseDir)` visits a plan without a summary if it has a journal file **or** the trailer index has any key for its id. Open-work and `init resume` inherit this.
- Hygiene H-15 `journal-abandoned`: the age of a plan's latest evidence is the newer of its last journal row and its newest trailer commit time; trailer-only plans are reported against the plan file (`<id>-plan.md`) instead of the journal path. Finding id unchanged.

### D5. Prompts

`agents/pan-executor.md` (task_commit_protocol) and `pan-wizard-core/workflows/execute-plan.md` (task_commit):

- Step 4 (commit): the message template gains the blank line and `PAN-Step: {phase}-{plan}/task-N`; one line per coalesced task; TDD — only on the commit that completes the task.
- Step 6 (journal): **removed for tasks that end in a commit** — the commit is the record. Kept, with `--file <path>` evidence, for a task that ends with nothing to commit, so `journal step` keeps a shipped caller (liveness) and those tasks still resume correctly.
- Resume instruction (executor step 3, line ~308) unchanged: `journal resume-point` now includes trailer evidence.
- Saves one tool call per task, which matters on the lean path.

### D6. Trust model (stated in the docs)

Trailer evidence is as strong as a journal line: a commit reachable from HEAD that names the step. Both live in the user's own repository; either can be written by hand to skip a task. What they cannot do is outlive their commit: a reset or a revert takes the evidence with it, so a lost task is redone, never skipped.

### Architecture decision

- **Changed:** `pan-wizard-core/bin/lib/journal.cjs` (trailer index, merge rule, `journalsIn`), `pan-wizard-core/bin/lib/hygiene.cjs` (H-15 age), `agents/pan-executor.md`, `pan-wizard-core/workflows/execute-plan.md`.
- **New:** none in the engine. Harness: one scenario and one script.
- **Installer / manifest:** no change; the changed files are already shipped and hashed.
- **ADR:** amend ADR-0052 (Decision 3 and the first Negative bullet) rather than a new ADR: same decision, stronger evidence.

### Alternatives considered

| Alternative | Verdict |
|---|---|
| `pan-tools git commit --step …` that commits and journals in one call (the first proposal) | Rejected. `commitPaths` blocks on any deletion in the repo without `--force` and prefixes `type: ` without the `(phase-plan)` scope, so it would change what task commits do; and the model must still remember to use it instead of `git commit`. The trailer rides on the message it already writes |
| `pan-tools commit --step` | Rejected: commits planning docs only, skipped under `commit_docs: false` |
| Install a `commit-msg` git hook that adds the trailer | Rejected: PAN does not write into `.git/hooks`; it would fight user hook managers (husky, lefthook) and miss commits made with `--no-verify` |
| Infer done tasks from `{type}({phase}-{plan})` commit subjects alone | Rejected: subjects do not say which task, and TDD makes several commits per task |
| `%(trailers:key=PAN-Step,valueonly)` in the git format | Rejected: option support varies by git version; parsing `%B` in JS is version-free |
| Keep the journal call as well as the trailer | Rejected for commit tasks: two records of one fact, and the call is the step models skip. Kept for no-commit tasks |

### Implementation plan

```
1. journal.cjs — trailerIndex (one git log, revert handling, memo by HEAD), merge rule in resumePoint (source field, resume_at when any evidence), journalsIn visits trailer-only plans, artifactHolds uses the index's sha set first.
2. hygiene.cjs — H-15 age = newest of journal row and trailer commit; trailer-only plans reported on the plan file.
3. agents/pan-executor.md, workflows/execute-plan.md — trailer in the commit template (coalesced, TDD rules); journal step only for no-commit tasks.
4. tests/journal-trailers.test.cjs — the cases below.
5. harness/scripts/trailer-tasks.cjs + harness/scenarios/resume-from-trailers.json (tier 0) with a replace control on the installed journal.cjs.
6. Registries — prompt-rules --write; the new scenario claims the new normative lines (covers); surface/liveness check; cassette re-record if executor-spawn changes (free, --record).
7. Docs — ARCHITECTURE (journal section), USER-GUIDE (resume), TROUBLESHOOTING (resume restarts at task 1), CLI-REFERENCE (resume-point output: source), CHANGELOG [Unreleased], ADR-0052 amendment, this spec's "as built".
```

### Test plan (`tests/journal-trailers.test.cjs`, temp git repos via `os.tmpdir()`)

Happy path
1. Two trailer commits, no journal file → `resume_at: task-3`, both `completed` with `source: 'trailer'`.
2. Coalesced commit with `task-2` and `task-3` lines → both done.
3. Journal and trailer agree → `source: 'journal'`, one entry per step.
4. `journalsIn` reports a trailer-only plan; `init resume` shows its `resume_at`.

Edge cases
5. Rebase rewrites the task commits: journal shas unreachable, trailers survive → completed via trailer, nothing in `unverified`.
6. `git revert` of task 2's commit → task 2 open; revert of the revert → done again.
7. `git reset --hard HEAD~1` drops task 2's commit → open.
8. Indented trailer (squash message) and lower-case key → counted; `PAN-Step: 03-02 task-4` (no slash) and a trailer inside a longer line → not counted.
9. Decimal and letter plan ids (`02.1-03`, `03A-01`) round-trip.
10. Journal `failed` for task 3 newer than task 3's trailer commit → open; older → done.
11. A trailer for another plan id never counts for this one; a summary-bearing plan is not visited.
12. Trailer deeper than the window → ignored (window injected small in the test).

Error / degenerate
13. Not a git repo → today's output exactly (SC-4 snapshot of the existing fixtures).
14. Repo with no commits → empty index, no throw.
15. Memo: two `resumePoint` calls in one process make one `git log` (spy on `execGit`); a new commit (HEAD moved) re-scans.

Hygiene
16. H-15 reports a trailer-only plan idle for over a day against its plan file; a fresh one is not reported.

Runtime-specific: none in the engine; the prompt changes are covered by prompt-lint (the call shapes are real) and by the tier-0 scenario installing `--claude`. Copilot/Codex/Gemini/OpenCode receive the same rewritten prompt text; `tests/` already assert the installer's path rewrite of the executor prompt.

### Harness scenario `resume-from-trailers` (tier 0, seed `journal-plan`)

1. `sh trailer-tasks.cjs <ws> 01-01 2` — commits tasks 1 and 2 with raw git, each message carrying `PAN-Step: 01-01/task-N`, **no journal call**. Expect `json:committed=2`.
2. `pan init resume` — expect `open_work.phase_plans.0.resume_at=task-3`, `…completed_steps.1.source=trailer`.
3. `sh lose-last-commit.cjs <ws>` — expect `json:reset=true`.
4. `pan journal resume-point --plan 01-01` — expect `resume_at=task-2`.

Control `trailer-reader-off` (`after: 0`): `replace` in `.claude/pan-wizard-core/bin/lib/journal.cjs` the trailer key pattern with one that never matches. Step 2 must go red: the resume point comes from the trailers, not the plan or the journal. The existing `resume-from-journal` scenario and its `journal-deleted` control stay as they are (`journal-tasks.cjs` commits without trailers).

---

## Phase 4: Specification

## Feature: Self-recording step journal

### Files to create/modify
- Modify `pan-wizard-core/bin/lib/journal.cjs`, `pan-wizard-core/bin/lib/hygiene.cjs`
- Modify `agents/pan-executor.md`, `pan-wizard-core/workflows/execute-plan.md`
- Create `tests/journal-trailers.test.cjs`
- Create `harness/scenarios/resume-from-trailers.json`, `harness/scripts/trailer-tasks.cjs`
- Update `tests/fixtures/prompt-rules.json` (+ allowlist if needed), `tests/fixtures/surface.json` if the surface script records it, `harness/cassettes/executor-spawn-claude.json` if it drifts
- Docs: `docs/ARCHITECTURE.md`, `docs/USER-GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/CLI-REFERENCE.md`, `CHANGELOG.md`, `docs/decisions/ADR-0052-durable-orchestration-over-files.md`, this spec; `CLAUDE.md` counts (test files, tests, suites)

### Implementation steps
1. Engine (D2, D3, D4) with unit tests 1-15.
2. Hygiene (D4) with test 16.
3. Prompts (D5); prompt-rules `--write`; prompt-lint.
4. Harness scenario and control; run tier 0 with `--no-ledger` and `--controls`; delete the run state.
5. Docs and ADR amendment; counts; full suite, `test-surface.cjs --check`, links validate.

### Documentation updates
- ARCHITECTURE: the journal has two evidence sources; the merge rule; the one-scan window.
- USER-GUIDE / TROUBLESHOOTING: resume works without a journal file when task commits carry `PAN-Step`; a reverted or reset task is redone.
- CLI-REFERENCE: `journal resume-point` → `completed[].source` (`journal` | `trailer`).
- CHANGELOG: one Added line, one Changed line (executor no longer makes a journal call per committed task).

### Runtime matrix

| Runtime | Supported | Notes |
|---|---|---|
| Claude | ✅ | Executor prompt text; engine reads trailers |
| Codex | ✅ | Same prompt via installer rewrite; same engine |
| Gemini | ✅ | Same |
| OpenCode | ✅ | Same |
| GitHub Copilot | ✅ | Same |

Sizing: about S–M (one engine module, one hygiene check, two prompt edits, one test file, one tier-0 scenario).

---

## Phase 5: Risk assessment

| Risk | Impact | Mitigation |
|---|---|---|
| The model omits or mistypes the trailer | Medium: resume falls back to the journal / task 1, today's behaviour, never wrong | The trailer is inside the message template it fills in; lenient key case and whitespace; the harness scenario and prompt-rule registry pin the instruction |
| Trailer on a TDD RED commit marks a task done before GREEN | Medium: resume skips the GREEN half | Prompt rule "only the commit that finishes the task"; same exposure the journal already has (a model can journal the RED sha) |
| A hand-written or stale trailer skips a task | Low | Same trust as a journal line (D6); reverts and resets remove it; `forced`/`failed` journal rows newer than the commit win |
| Plan id reused (a project that restarts phase numbering) | Low | Milestones continue numbering; the window bounds age; a summary-bearing plan is never visited |
| Large repositories make the scan slow | Low | One bounded `git log` per process, memoised; replaces per-step `merge-base` calls, so most resumes get faster |
| Squash-merge services that drop bodies (hosted squash) | Low | Only matters for an unfinished plan squashed mid-way; the journal still applies |
| Removing the per-task journal call loses `ts` for H-15 | Low | H-15 uses the trailer commit time (D4) |
| Existing installs mid-plan when they upgrade | None | Journal lines keep working; trailers add evidence; no migration |

---

## As built (`2026-11-02`)

Built as designed, with these choices recorded:

- **Reverts apply to journal commits too.** `artifactHolds` reports a journaled commit that a later reachable commit reverted as `unverified` ("was reverted"), so both evidence sources follow one rule (SC-2).
- **Journal commits in the window skip `merge-base`.** A journaled sha found among the scanned commits is reachable by construction; only older ones still cost a git call.
- **`resumePoint(cwd, plan, {window})`** takes the window for tests; production always uses `TRAILER_WINDOW`.
- **`journalsIn` walks plan files**, not journal files, visiting a plan without a summary that has a journal or any trailer in the index; output keys are the plan file names as on disk.
- **H-15** reports a trailer-only plan on its plan file with the detail `last committed task-N`; a journaled plan keeps its journal path and `last recorded …` text.
- **Prompts:** the executor and execute-plan commit templates end with the `PAN-Step` line; step 6 journals only no-commit tasks (`--file`). The two new normative lines are allowlisted with reasons (the tier-0 scenarios drive the engine, not the prompt).
- **Harness:** `resume-from-trailers` passed; its `trailer-reader-off` control (a `replace` in the installed `journal.cjs`) turned it red, as did `resume-from-journal`'s `journal-deleted` control, unchanged.
- **Live check (`2026-11-02`):** the tier-2 scenario `executor-trailers-live` runs a real executor on plan 01-01 of the two-plan seed (`/pan:exec-phase 1 --plan 01-01 --fast`), then `harness/scripts/check-trailers.cjs` checks each task commit for its line, proves the plan done from the commits with the journal set aside, and rewinds the newest task commit (a coalesced commit is allowed). The first run passed at `$0.93`. The orchestrator reported that the executor had amended its task-1 commit because git did not read the `PAN-Step` line as a trailer, most likely because a `Co-Authored-By` paragraph followed it. Both prompts now keep it in one final trailer block and say not to amend a commit only to move it. These new lines are claimed by the scenario's `covers`.
