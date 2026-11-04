# 3.42.0 — Field defects PAN-01 to PAN-25 (feature design)

**Date:** `2026-11-04` · **Source:** a field project's defect register (`.planning/pan-tool-defects.md` there), re-measured on 3.41.3 against 3.40.0 and 3.32.0 · **Status:** approved by the owner to build and release as one version

## 0. Problem

A long-running project (decimal phases such as 29.4, several shipped milestones, hundreds of plans) runs PAN with a ban on most `pan-tools state *` writers and two locally patched core files, because PAN's writers damage `state.md` and its counts. 3.41.3 fixed one of their 24 recorded defects (PAN-24, the model could not invoke commands) and added one (PAN-25). This release fixes the rest at their root, so the bans and the local patch can be dropped.

Root causes, from four investigations against the code (each reproduced in a scratch project unless marked "read"):

| Group | Defects | Root cause |
|---|---|---|
| state.md integrity | frontmatter damage, PAN-02, 13, 04, 06, 16, 01 | every write re-serialises the frontmatter from a parsed object (`syncStateFrontmatter` → `reconstructFrontmatter`), replacing `progress` whole and adding counts; counts come from a file scan that counts summary *files* (orphans included), ignores archives and case; the recorded milestone is overwritten by a guess; `last_activity` is taken from a stale body field; dates are UTC; health treats any `Phase N` mention without a directory as repairable and regenerates the file; `add-blocker` strips "none" anywhere |
| parsing and verification | PAN-15, 03, 17, 18, 08, 09 | single-line regexes for roadmap goal and criteria; requirement status table assumed three columns; milestone headings include phase headings that mention a version; a 300-character summary cap; reconcile returns `reconciled: true` for a phase with no verification; every `from` value is read as a file path |
| phases, commits, telemetry | PAN-23, 05, 14, 11, 20, 21, 22 | decimal insertion nests under the after-phase; insert writes no Progress row, a `.gitkeep`, and depends on the raw after-phase; the commit check matches unanchored words (`secret`, `token`) anywhere in a path; an explicit trace session is aged by `trace.jsonl`'s mtime, which every append refreshes; findings telemetry is fine (`findings.jsonl` is meant to be committed) and its workflows only suffer through the writers above |
| resume, install, access | PAN-25, model access, trailer order, untracked files, patched-file overwrite, update prompt, AGENTS.md line, locks | `execGit` has Node's default 1 MiB `maxBuffer` and the trailer scan swallows the failure; nothing lets a project keep chosen commands user-invoked only; the trailer order is unspecified; `.claude/pan-local-patches/` is not ignored; the installer replaces git-tracked patched files with only a hint; `/pan:update` always asks; one AGENTS.md line is unconditional; `lock_timeout` advises deleting a lock a live process holds |

## 1. Decisions

- **DD-1 Frontmatter is patched in place.** A new `patchFrontmatter(text, {set, remove})` edits only the named keys (including one level of nesting, `progress.percent`), line by line inside the `---` block. It never re-serialises: comments, quoting, order and unknown keys survive byte for byte. Each `state *` command owns a fixed set of keys:
  - `update` / `patch` / `advance-plan` / `apply` / `init`: `current_phase`, `current_phase_name`, `current_plan`, `status`, `last_activity` (only moving forward), `last_updated`;
  - `add-decision` / `add-blocker` / `resolve-blocker` / `record-metric` / `record-session` / `section` / `quick-task`: `last_updated`;
  - `update-progress` and `phase complete`: those plus the `progress.*` keys that already exist;
  - `milestone complete` / `new`: `milestone`, `milestone_name`.
  Progress keys that are absent are not added (`--write-counts` adds them). Writers go through `store.updateText`, so 3.41's lock applies.
- **DD-2 One count.** `countPlanProgress(cwd, {scope})` pairs each plan with its summary by plan id (case-insensitive suffixes, `PHASE_DIR_RE` directories only, archives under `scope: 'all'`, which no command passes yet). A phase is complete only when every plan has a summary. Completed can never exceed total. `state update-progress`, `phase complete` and the frontmatter all use it.
- **DD-3 The recorded milestone wins over a guess.** Headings that start with `Phase N` are not milestone headings. `state.md`'s `milestone:` is kept unless the roadmap marks another milestone current. Generic state writes do not write `milestone`.
- **DD-4 Health never rewrites an existing state.md.** Only a missing `state.md` (E004) is regenerated. A phase mentioned in `state.md` counts as present when it is under `phases/` or a milestone archive, compared with `normalizePhaseName`.
- **DD-5 Local dates.** `localDay()` in `utils.cjs` replaces the UTC day where PAN writes a day into state, roadmap, requirements, plans and summaries (`current-timestamp date`), milestones, todos, focus batches and learnings. Agent-memory and pattern-memory dates, and day stamps compared with UTC timestamps (cost budgets, archive file names), stay UTC.
- **DD-6 `phase complete` stages only what it wrote** (roadmap.md, requirements.md, state.md, plus the phase directory it closed) and writes the Progress row's status from the counts.
- **DD-7 Sensitive files by name, secrets by content.** The default patterns match a file's basename (`.env*` except examples, `*.pem|key|p12|pfx`, `id_(rsa|ed25519|ecdsa|dsa)` (the `.pub` halves are public and commit), `credentials.*`, `.npmrc|.netrc|.pypirc`, `secrets.(ya?ml|json|env)`); the staged content is scanned with `redact.cjs`'s rules. One constant replaces the three copies.
- **DD-8 Decimal insertion is a sibling.** Inserting after 29.4 gives the next free sibling (29.5) when there is one, else nests (29.4.1, reported). Insert and add write a Progress row, no `.gitkeep`, and depend on the phase immediately before the new one.
- **DD-9 Findings stay committed.** `findings record` and `dispose` touch no `state.md` or `roadmap.md` writer (pinned by a test); with DD-1 to DD-6 the writers the project banned are safe to call again.
- **DD-10 Trace sessions roll by age of `started_at`**, not by the trace file's mtime, in all three copies (trace logger, cost logger, `optimize.cjs`).
- **DD-11 The trailer scan reads only what it needs and reports failure.** `execGit` takes `maxBuffer` (16 MiB default); the scan asks git for matching commits only (`--grep` on `PAN-Step:` and revert lines) and lists the window's ids separately; a failed scan returns `trailer_scan_failed`, shown by `resume-point` and `init resume`, never an empty "no tasks done".
- **DD-12 Chosen commands can stay user-invoked.** `.planning/config.json` `claude.user_invoked_only: ["health", …]` (or `--user-invoked-only health,…` at install, recorded in the install manifest so updates keep it; `none` clears it) marks just those Claude commands `disable-model-invocation: true`, on install and on every update. Default: none.
- **DD-13 `PAN-Step` first.** The executor starts the final trailer block with its `PAN-Step` line(s), then `Co-Authored-By` and other trailers. The reader already accepts any position.
- **DD-14 Machine-local files are ignored, durable state is not.** A local install adds `<runtime dir>/pan-local-patches/` (`.claude/…` for Claude Code) to `.gitignore` once (marker comment); a missing `.gitignore` is created only in a git repository. Plan journals and pause files are durable and stay committable (documented).
- **DD-15 An update says what it replaced.** Files PAN replaced that git tracks and the project changed are named in red, and `/pan:update` offers `/pan:patches` at once. `/pan:update --yes` skips the confirmation.
- **DD-16 AGENTS.md defers to the project.** The memory line ends "unless this project's own instructions say otherwise".
- **DD-17 Locks explain themselves.** `lock_timeout` names the holder (pid, host) and the lock's age, and advises deleting the file only when the holder is gone.

## 2. Out of scope

Reworking `state.md`'s body format; changing what `/pan:health` checks beyond W002; automatic reapplication of local patches (core `.cjs` merges need review); a `state_writers` off switch (DD-1 to DD-6 remove the reason for the bans).

## 3. Stages and tests

| Stage | Defects | Files | Tests (each failing before the fix) |
|---|---|---|---|
| A state integrity | frontmatter, 02, 13, 04, 06, 16, 01 | `state.cjs`, `frontmatter.cjs`, `phase.cjs` (complete), `verify.cjs` (health), `utils.cjs`, date call sites | round-trip of a `state.md` with comments and unknown nested keys through every `state *` subcommand; orphan summary, upper-case plan, decimal phase 1 of 2, archive scope; `last_activity` never moves back; `phase complete` commits no stray file and writes no `Complete` at 1 of 2; health `--repair` never shrinks an existing file; `add-blocker` keeps "none" inside text; `localDay` under a UTC+2 clock |
| B parsing | 15, 03, 17, 18, 08, 09 | `roadmap.cjs`, `core.cjs` (milestones, roadmap phase), `milestone.cjs`, `focus.cjs`, `verdict.cjs`, `findings.cjs`, `verify.cjs` (reconcile, key links), `utils.cjs` | multi-line goal and wrapped or bulleted criteria; status column found by header in 3- and 5-column tables; a phase heading naming v2.0 is not a milestone; recorded `v3.0` survives a guess; a 1,200-character summary survives; reconcile exits 1 without a verification; prose `from` is skipped, a missing path still fails |
| C phases, commits, telemetry | 23, 05, 14, 11, 20, 22 | `phase.cjs` (insert, add), `roadmap.cjs` (progress row), `commands.cjs`, `constants.cjs`, `config.cjs`, `core.cjs` (patterns), trace and cost hooks, `optimize.cjs`, insert-phase workflow | 29.4 → 29.5, nested only when 29.5 exists; Progress row in order; no `.gitkeep`; depends on the predecessor; `docs/secret-rotation.md` commits, `.env` and a staged `api_key = "sk-…"` block; an old `started_at` rolls a session whatever the mtime; `findings record` leaves `state.md` and `roadmap.md` byte-identical |
| D resume, install, access | 25, model access, trailer order, untracked, overwrite, update, AGENTS.md, locks | `core.cjs` (`execGit`), `journal.cjs`, `bin/install.js`, `bin/install-lib.cjs`, `config.cjs`, `update.md` workflow and command, `agents-md.cjs`, executor and execute-plan prompts, `store.cjs` / `lock.cjs` | a log over 1 MiB still indexes trailers; a failed scan reports `trailer_scan_failed`; config `["health"]` marks only `health.md`, idempotently; `.gitignore` gains the patches line once; a modified tracked file is reported; `--yes` documented; AGENTS.md line; `lock_timeout` names the holder |

## 4. Risks

| Risk | Mitigation |
|---|---|
| A project relying on the old counts (`total_plans` added on every write) | DD-1 keeps existing keys updated by the count commands; `--write-counts` adds them |
| Tests that pinned the old behaviour (`.gitkeep`, X.Y.1 after a decimal, `.planning/api-token.txt` blocked, reconcile passing without a verification) | Updated with the reason in each test |
| A project whose `config.json` stored the old pattern list keeps the old commit refusals | `commit.sensitive_patterns` written by an old install is detected and reported by health with the fix |
| Four parallel builds touching shared files (`core.cjs`, `utils.cjs`, `phase.cjs`, `verify.cjs`, `roadmap.cjs`) | Each stage owns distinct functions; merged one at a time with the suite after each merge |
