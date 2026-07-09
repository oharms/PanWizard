---
name: pan:hygiene
group: System
description: Scan the project for PAN version drift and stale artifacts (legacy filenames, memory bloat, poisoned ledgers, trace debris) and apply safe cleanups
argument-hint: "[--apply] [--trace-age-days N]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---
<objective>
Keep a PAN-managed project aligned with the latest PAN version and free of accumulated history debris. Detects: outdated runtime installs (per-runtime manifest version vs latest), legacy uppercase planning filenames, orphaned atomic-write .tmp files, per-agent memory logs past the compaction cap, cost ledgers poisoned by pre-v3.12.4 telemetry, stale optimization trace sessions, and stray fragment `.planning/` directories.
</objective>

<process>

## 1. Scan

```bash
SCAN=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs hygiene scan)
```

Parse JSON: `findings[]` (`check`, `severity`, `path`, `detail`, `fixable`), `installs[]`, `latest_version`, `summary`.

Display the findings grouped by severity (critical → warn → info). If `summary.total` is 0: report "Project is clean and aligned" and stop.

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
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs hygiene clean
```

Then ask the user (AskUserQuestion, header "Apply fixes", options: "Apply safe fixes" / "Skip") unless running headless — in auto/headless contexts, report the dry-run only and stop.

**With `--apply` (or after user confirmation):**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs hygiene clean --apply
```

Safe fixes are: lowercase renames of legacy planning filenames, deletion of aged .tmp orphans, memory-log compaction, poisoned-ledger quarantine (rename in place — never deleted), and pruning of trace sessions past retention (newest 5 always kept). Pass through `--trace-age-days N` if provided.

## 4. Report

Summarize: fixes executed / failed / left manual, plus the installer command if version drift remains. Recommend re-running `/pan:hygiene` after the installer to confirm alignment.

</process>

<success_criteria>
- [ ] Scan run and findings presented by severity
- [ ] Version drift reported with the exact installer command (never auto-run)
- [ ] Safe fixes applied only with --apply or explicit user confirmation
- [ ] Nothing user-authored deleted — quarantine renames only
- [ ] Final summary states executed/failed/manual counts
</success_criteria>
