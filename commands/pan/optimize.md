---
name: pan:optimize
group: Self-Improvement
description: Manage the circular optimization loop — apply recommendations, view stats, list reports, manage trace sessions
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# /pan:optimize

Manage the circular optimization loop: apply recommendations, view stats, list reports.

**Usage:**
```
/pan:optimize apply
/pan:optimize apply --report <filename>
/pan:optimize list
/pan:optimize stats
/pan:optimize trace init [--description "what you're building"]
/pan:optimize trace end
/pan:optimize trace status
/pan:optimize trace list
```

**Subcommands:**

### apply
Apply safe optimizations from the most recent (or specified) optimization report.

Auto-applied automatically:
- New memory entries (`.planning/memory/*.md`) — skipped if file already exists
- Suggestions appended to `.planning/optimization/suggestions.md`
- Config notes appended to `.planning/optimization/config-suggestions.md`

Requires human review (never auto-applied):
- Agent prompt changes
- Workflow step additions
- Structural changes to commands

After applying, the report lists what was applied and what still needs review.

### list
List all optimization reports in `.planning/optimization/reports/`, most recent first.

### stats
Show cumulative optimization statistics:
- Total trace sessions run
- Total events traced
- Total errors/gaps/redundancies seen
- Total optimizations applied across all runs
- Current active trace session (if any)

### trace init
Start a new trace session before running a build. The hook fires automatically on SubagentStop, but calling `trace init` first lets you attach a description to the session.

```
/pan:optimize trace init --description "building express web server"
/pan:exec-phase 1
/pan:learn
```

### trace end
Finalize the current trace session (writes summary stats to session.json).

### trace status
Show the active trace session ID and event count.

### trace list
List all trace sessions, most recent first.

---

**The circular loop:**

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  /pan:optimize trace init                           │
│         ↓                                          │
│  /pan:exec-phase N    ← agents run, hook traces    │
│         ↓                                          │
│  /pan:learn           ← analyze + report           │
│         ↓                                          │
│  /pan:optimize apply  ← write memory entries       │
│         ↓                                          │
│  Next run is smarter  ← memory populated           │
│         ↑                                          │
│         └──────────────────────────────────────────┘
└─────────────────────────────────────────────────────┘
```

Each iteration improves the model's context: fewer memory misses, fewer repeated errors, better decisions.

**See also:** `/pan:learn`, `/pan:exec-phase`
