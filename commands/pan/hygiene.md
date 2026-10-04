---
name: pan:hygiene
group: System
description: Scan the project for PAN version drift and stale artifacts (legacy filenames, memory bloat and stale entries, poisoned ledgers, trace debris, oversized planning files) and apply safe cleanups
argument-hint: "[--apply] [--trace-age-days N] [--all-tracks] [--track <name>]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---
<objective>
Keep a PAN-managed project aligned with the latest PAN version and free of accumulated history debris. Detects:
- outdated runtime installs (per-runtime manifest version vs latest);
- legacy uppercase planning filenames and orphaned atomic-write .tmp files;
- per-agent memory logs past the compaction cap (`memory-bloat`), memory entries whose cited code is gone or that went unused past the expiry window (`memory-stale`), and files in `.planning/memory/` that are not read as memory (`memory-format`);
- planning files every agent call re-reads past their budget (`cache-context`): state.md and roadmap.md, whose settled history can be archived;
- cost ledgers poisoned by pre-v3.12.4 telemetry, stale optimization trace sessions and reports, and stray fragment `.planning/` directories;
- a planning tree another tool writes into too (`shared-planning-tree`) or owns (`foreign-planning-tree`);
- Claude Code's own memory index past or near its load limit, or holding content where a one-line pointer belongs (`host-memory`). PAN only reports this one: it never writes the host's memory.
</objective>

<process>

## 1. Scan

```bash
SCAN=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs hygiene scan --all-tracks)
```

Pass `--all-tracks` by default: a project may hold several planning trees (`.planning/` plus `.planning/tracks/<name>/`), and scanning only the root tree reports "clean" for debris sitting in a sibling track. Use `--track <name>` to scan one specific tree instead.

Parse JSON: `findings[]` (`check`, `severity`, `path`, `detail`, `fixable`, `track`), `installs[]`, `latest_version`, `roots_scanned[]`, `summary` (including `summary.by_track`).

Display the findings grouped by severity (critical → warn → info), labelling each with its `track` when more than one tree was scanned.

**Always state which trees were scanned** — read `roots_scanned[]` and name them. If `summary.total` is 0, report "Project is clean and aligned" *together with* the list of trees that were read. A clean verdict without its scope is what let stale debris hide in an unscanned track; never report one without the other.

If any root has `planning_root_exists: false`, say so plainly — that is a mistyped `--track`, not a clean tree.

## 2. Version drift (manual remediation)

If any `version-alignment` findings exist, list the outdated runtimes and show the remediation:

```
Re-run the installer from the project root to align all runtimes:
  node <pan-source>/bin/install.js --claude --codex --gemini --opencode --copilot --local
(use the flags matching the runtimes reported in installs[])
```

Hygiene never runs the installer itself.

## 3. Safe cleanups

**Without `--apply` in $ARGUMENTS:** run the dry-run and present what WOULD change:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs hygiene clean --all-tracks
```

Then ask the user (AskUserQuestion, header "Apply fixes", options: "Apply safe fixes" / "Skip") unless running headless — in auto/headless contexts, report the dry-run only and stop.

**With `--apply` (or after user confirmation):**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs hygiene clean --all-tracks --apply
```

Safe fixes are: lowercase renames of legacy planning filenames, deletion of aged .tmp orphans, memory-log compaction, **memory pruning** (`prune-memory`: stale and expired entries move to `.planning/memory/archive/<agent>.md`), poisoned-ledger quarantine (rename in place — never deleted), pruning of trace sessions **and optimization reports** past retention (newest 5 of each always kept), **state.md compaction** (`compact-state`) — settled history is archived to `state-history.md` so it stops being re-read into every agent call — and **roadmap compaction** (`compact-roadmap`): shipped phases' sections move to `roadmap-history.md`, leaving a stub that `roadmap get-phase` reads back through. None of these deletes anything you wrote: the ledger is renamed, and each archive is written before the file it came from is rewritten. Each fix is applied inside its own tree's scope, so a track's debris is cleaned in that track. Pass through `--trace-age-days N` and any `--track <name>` if provided.

## 4. Report

Summarize: the trees scanned, fixes executed / failed / left manual (attributed per track), plus the installer command if version drift remains. If a `cache-context` finding appeared, state the per-call token cost it represents — that block is re-read on **every** agent call, so it is the project's largest recurring expense. If a `host-memory` finding appeared, name the index and the lines it flags so the user can tidy them: Claude Code loads only the head of that index, and PAN never edits it. Recommend re-running `/pan:hygiene` after the installer to confirm alignment.

</process>

<success_criteria>
- [ ] Scan run and findings presented by severity
- [ ] Version drift reported with the exact installer command (never auto-run)
- [ ] Safe fixes applied only with --apply or explicit user confirmation
- [ ] Nothing user-authored deleted — quarantine renames only
- [ ] Final summary states executed/failed/manual counts
</success_criteria>
