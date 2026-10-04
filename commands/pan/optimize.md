---
name: pan:optimize
group: Self-Improvement
description: Manage the circular optimization loop — record a report's suggestions, undo them, view stats, list reports, manage trace sessions
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
---

# /pan:optimize

Manage the circular optimization loop: record a report's suggestions, view stats, list reports.

**Usage:**
```
/pan:optimize apply
/pan:optimize apply --report <filename>
/pan:optimize revert <apply_id>
/pan:optimize revert --last
/pan:optimize list
/pan:optimize stats
/pan:optimize trace init [--description "what you're building"]
/pan:optimize trace end
/pan:optimize trace current
/pan:optimize trace list
```

**Subcommands:**

### apply
Record the suggestions from the most recent (or specified) optimization report.

Recorded automatically:
- Suggestions appended to `.planning/optimization/suggestions.md`: lessons, prompt changes and workflow changes, each naming where it belongs
- Config notes appended to `.planning/optimization/config-suggestions.md`
- An older report's memory actions (`memory_entry`, `memory`, `memory_append`) still write to `.planning/memory/`, a `memory_entry` only if it passes the checks of the `memory record` command. The result warns that PAN's workflows do not load that folder into agents

A person makes every change the suggestions describe (never auto-applied):
- Lessons, written into the project's instructions (CLAUDE.md or AGENTS.md, outside PAN's section), a test, or a comment at the cited code
- Agent prompt changes
- Workflow step additions
- Structural changes to commands

After applying, the report lists what was applied and what still needs review, plus the `apply_id` that undoes it. Every apply is recorded action by action in `.planning/optimization/applied.jsonl`: the path, whether the file was created or appended to, the exact text, and a hash of the file after the write. Applying the same report a second time writes nothing: each action names the apply that already wrote it.

### revert
Undo one apply exactly: delete the files it created and cut the text it appended (`revert --last` for the newest).

Revert never destroys work someone did since:
- It refuses a file whose content changed after the apply. The comparison ignores line endings, so a CRLF checkout still matches.
- It refuses a file that a later apply also wrote. Revert that later apply first.
- It says which files it refused, and why.

A CRLF file comes back CRLF. Applies logged before apply records existed cannot be reverted. After a revert, the same report can be applied again.

### list
List all optimization reports in `.planning/optimization/reports/`, most recent first.

### stats
Show cumulative optimization statistics:
- Total trace sessions run
- Total events traced
- Total errors/gaps/redundancies seen
- Total optimizations applied across all runs, the apply runs, the reverted runs, and the last `apply_id`
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

### trace current
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
│  /pan:optimize apply  ← record suggestions         │
│         ↓                                          │
│  You make the changes ← instructions, tests, code  │
│         ↑                                          │
│         └──────────────────────────────────────────┘
└─────────────────────────────────────────────────────┘
```

Each iteration puts what the last run lacked where the next run's agents read it: fewer repeated errors and gaps.

**See also:** `/pan:learn`, `/pan:exec-phase`
