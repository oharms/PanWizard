---
name: pan:learn
group: Self-Improvement
description: Analyze trace sessions or harvested experiments via pan-optimizer; generate ranked optimization reports
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
/pan:learn --experiment <slug>
/pan:learn --apply
```

**Flags:**
- `--session <id>` — analyze a specific session instead of the most recent
- `--experiment <slug>` *(v3.7.0+, W3)* — analyze a harvested experiment instead of the current project's traces. Reads from `<source-repo>/experiments/<slug>/.planning/optimization/` and writes the report to `<source-repo>/experiments/<slug>/learnings/report-<timestamp>.md`. Used by the self-improvement loop. Run `/pan:experiment harvest <slug>` first.
- `--apply` — automatically apply safe optimizations after generating the report (equivalent to running `/pan:optimize apply` immediately after)

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
- Memory cache misses (memory_miss events)
- Unexpected outcomes (surprise events)

**Output:**

The optimization report in `.planning/optimization/reports/` contains:
- Ranked error patterns with fix recommendations
- Memory gap findings with ready-to-apply memory entry content
- Redundancy analysis with token waste estimates
- Prompt improvement suggestions (require human review before applying)
- Workflow gap suggestions (require human review)
- An `## Auto-Apply Actions` JSON block for `/pan:optimize apply`
- A circular optimization score (0–100)

**Example:**
```
/pan:learn
→ Session sess_20260421T180000: 47 events (8 errors, 12 gaps, 3 redundancies)
→ Report: .planning/optimization/reports/sess_20260421T180000-opt-report.md
→ Optimization score: 72/100
→ Top finding: M1 — Express middleware order missing from memory (5 misses)
→ Auto-applicable: 3 memory entries
→ Needs review: 2 prompt improvements, 1 workflow gap
```

**See also:** `/pan:optimize`, `/pan:exec-phase`, `/pan:experiment` (v3.7.0+ self-improvement loop)

Follow the workflow at `.claude/workflows/learn.md` (or `pan-wizard-core/workflows/learn.md`).
