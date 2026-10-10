---
name: pan:learn
group: Self-Improvement
description: Analyze trace sessions or harvested experiments via pan-optimizer; generate ranked optimization reports
argument-hint: "[--session <id> | --sessions <n> | --experiment <slug>] [--apply]"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Task
---

# /pan:learn

Analyze the most recent trace session and generate an optimization report.

**Usage:**
```
/pan:learn
/pan:learn --session <session-id>
/pan:learn --sessions 3
/pan:learn --experiment <slug>
/pan:learn --apply
```

**Flags:**
- `--session <id>` — analyze a specific session instead of the most recent
- `--sessions <n>` — pool the last n sessions into one analysis, so recommendations rest on failures that recur across runs
- `--experiment <slug>` *(v3.7.0+, W3)* — analyze a harvested experiment instead of the current project's traces: the workflow runs its `pan-tools` steps with `--cwd` set to the harvest folder (the `harvest_path` `/pan:experiment harvest <slug>` printed, `<source-repo>/experiments/<slug>/` by default), so the analysis and the optimizer's report land in that folder's `.planning/optimization/reports/`. Used by the self-improvement loop. Run `/pan:experiment harvest <slug>` first.
- `--apply` — record the report's suggestions right after generating it (equivalent to running `/pan:optimize apply` immediately after)

**What it does:**

1. Reads trace events from `.planning/optimization/traces/{session}/trace.jsonl`
2. Performs local analysis (error/gap/redundancy patterns, agent stats)
3. Writes `.planning/optimization/reports/{session}-analysis.json`
4. Invokes `pan-optimizer` agent to produce `.planning/optimization/reports/{session}-opt-report.md`
5. If `--apply` flag: immediately runs `/pan:optimize apply` on the new report
6. Prints the optimization summary

**When to run:**
- After any `/pan:exec-phase` or `/pan:focus-exec` that had a trace session active
- After a full build cycle to capture all decisions and errors
- On demand to understand what PAN did and how to make it smarter

**What it learns from:**
- Tool failures and correction loops (error events)
- Topics the model had to infer without context (gap events)
- Repeated research on the same topic (redundancy events)
- Missing knowledge an agent logged (memory_miss events)
- Unexpected outcomes (surprise events)

**Output:**

The optimization report in `.planning/optimization/reports/` contains:
- Ranked error patterns with fix recommendations
- Lessons the agents lacked, each with where it belongs: the project's instructions (CLAUDE.md or AGENTS.md, outside PAN's section), a test, or a comment at the cited code
- Redundancy analysis with token waste estimates
- Prompt improvement suggestions (require human review before applying)
- Workflow gap suggestions (require human review)
- An `## Auto-Apply Actions` JSON block, which `/pan:optimize apply` records in `.planning/optimization/suggestions.md`
- A circular optimization score (0–100)

Nothing in the report reaches an agent until a person writes it where the agents read. PAN's workflows do not load `.planning/memory/` into agents.

**Example:**
```
/pan:learn
→ Session sess_20260421T180000: 47 events (8 errors, 12 gaps, 3 redundancies)
→ Report: .planning/optimization/reports/sess_20260421T180000-opt-report.md
→ Optimization score: 72/100
→ Top finding: L1 — Express middleware order inferred 5 times (belongs in CLAUDE.md)
→ Lessons: 3
→ Needs review: 2 prompt improvements, 1 workflow gap
```

**See also:** `/pan:optimize`, `/pan:exec-phase`, `/pan:experiment` (v3.7.0+ self-improvement loop)

Follow the workflow at `~/.claude/pan-wizard-core/workflows/learn.md`.
