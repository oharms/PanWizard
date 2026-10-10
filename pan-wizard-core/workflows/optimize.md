# Workflow: /pan:optimize

Manage the circular optimization loop — apply reports, check stats, control trace sessions.

## Subcommand routing

| Subcommand | Action |
|------------|--------|
| `apply` | Record the suggestions from the most recent report |
| `apply --report <file>` | Record them from a specific report |
| `revert <apply_id>` / `revert --last` | Undo one apply exactly |
| `list` | List all reports |
| `stats` | Show cumulative stats |
| `trace init` | Start a new trace session |
| `trace end` | Finalize current session |
| `trace current` | Show active session |
| `trace list` | List all sessions |

---

## apply

### Step 1 — Identify the report

Run:
```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize list
```

Use the most recent `.md` report (the full opt-report, not the `-analysis.json`).

If `--report <filename>` was specified, use that file from `.planning/optimization/reports/`.

### Step 2 — Run apply

```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize apply [--report <path>]
```

### Step 3 — Present results

Show the user:
- **Applied** — each item that was recorded (suggestions, config notes)
- **Skipped** — items that already exist, that an earlier apply already wrote, or that had unknown types
- **Still needs a person** — every suggestion in `suggestions.md`
- **The `apply_id`**, and how to undo the apply: `/pan:optimize revert <apply_id>`

If an applied item carries a `warning`, pass it on. An older report's memory actions write to `.planning/memory/`, which PAN's workflows do not load into agents.

### Step 4 — Point to manual review items

If `.planning/optimization/suggestions.md` exists, tell the user to review it for:
- Lessons (apply by writing them into the project's CLAUDE.md or AGENTS.md outside PAN's section, a test, or a comment at the cited code)
- Agent prompt improvements (apply by editing `agents/pan-*.md`)
- Workflow step additions (apply by editing `pan-wizard-core/workflows/*.md`)

---

## revert

```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize revert <apply_id>
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize revert --last
```

Show the user each reverted action and each refused one, with its reason. A refusal means someone edited the file after the apply, or a later apply also wrote it. Revert that later apply first; never force it. The status is `reverted`, `partial`, `refused` or `nothing_to_revert`.

---

## trace init

### Step 1 — Extract description

If `--description "..."` was provided, extract it from the args.

### Step 2 — Initialize session

```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace init [--description "..."]
```

Show the user the session ID and confirm that:
- The hook will automatically log agent completions to this session
- To log a specific decision/error manually: `pan-tools optimize trace log --type <type> --description "..."` 
- To end the session explicitly: `/pan:optimize trace end`

---

## trace end

```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace end
```

Show: session ID, event count, agent count, type breakdown.

---

## trace current

```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace current
```

If active: show session ID and instruct how to view events.
If none: tell user to run `/pan:optimize trace init` before their next build.

---

## stats

```
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize stats
```

Present as a summary table:

```
Trace sessions:         N
Optimization reports:   N
Total events traced:    N
Total errors traced:    N
Optimizations applied:  N
Active session:         sess_... (or none)
```

If `total_optimizations_applied` > 0, note:
> {N} suggestions have been recorded across {apply_runs} apply runs. Each helps once a person has written it where the agents read.

---

## The circular optimization loop explained

When explaining the system to users:

```
Every agent spawn → hook logs completion event
                          ↓
              .planning/optimization/traces/{session}/trace.jsonl
                          ↓
             /pan:learn → pan-optimizer reads trace
                          ↓
              .planning/optimization/reports/{session}-opt-report.md
                          ↓
             /pan:optimize apply → records suggestions
                          ↓
     A person writes each one where the agents read it
                          ↓
         Next build has better context → fewer errors/gaps
                          ↓
                  (repeat, improving each time)
```

The key insight: a lesson changes the next run only from a place the next run's agents read: the project's instructions (CLAUDE.md or AGENTS.md, outside PAN's section), a test that fails when it is broken, or the code itself. PAN's workflows do not load `.planning/memory/` into agents (ADR-0036, amended `2026-10-04`). In the harness, a lesson recorded there changed nothing that the project's state, summaries and code did not already carry. The report says where each suggestion belongs, and a person puts it there.
