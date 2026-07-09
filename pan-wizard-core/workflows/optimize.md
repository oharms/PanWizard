# Workflow: /pan:optimize

Manage the circular optimization loop — apply reports, check stats, control trace sessions.

## Subcommand routing

| Subcommand | Action |
|------------|--------|
| `apply` | Apply safe recommendations from most recent report |
| `apply --report <file>` | Apply from a specific report |
| `list` | List all reports |
| `stats` | Show cumulative stats |
| `trace init` | Start a new trace session |
| `trace end` | Finalize current session |
| `trace status` | Show active session |
| `trace list` | List all sessions |

---

## apply

### Step 1 — Identify the report

Run:
```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize list
```

Use the most recent `.md` report (the full opt-report, not the `-analysis.json`).

If `--report <filename>` was specified, use that file from `.planning/optimization/reports/`.

### Step 2 — Run apply

```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize apply [--report <path>]
```

### Step 3 — Present results

Show the user:
- **Applied** — each item that was written (memory entries, notes)
- **Skipped** — items that already exist or had unknown types
- **Still needs review** — prompt/workflow suggestions in `suggestions.md`

If memory entries were written, tell the user:
> Memory entries have been added to `.planning/memory/`. They will be loaded on the next agent run, reducing future memory misses for these topics.

### Step 4 — Point to manual review items

If `.planning/optimization/suggestions.md` exists, tell the user to review it for:
- Agent prompt improvements (apply by editing `agents/pan-*.md`)
- Workflow step additions (apply by editing `pan-wizard-core/workflows/*.md`)

---

## trace init

### Step 1 — Extract description

If `--description "..."` was provided, extract it from the args.

### Step 2 — Initialize session

```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize trace init [--description "..."]
```

Show the user the session ID and confirm that:
- The hook will automatically log agent completions to this session
- To log a specific decision/error manually: `pan-tools optimize trace log --type <type> --description "..."` 
- To end the session explicitly: `/pan:optimize trace end`

---

## trace end

```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize trace end
```

Show: session ID, event count, agent count, type breakdown.

---

## trace status

```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize trace current
```

If active: show session ID and instruct how to view events.
If none: tell user to run `/pan:optimize trace init` before their next build.

---

## stats

```
node .claude/pan-wizard-core/bin/pan-tools.cjs optimize stats
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
> {N} optimizations have been applied across {apply_runs} apply runs. Each applied memory entry reduces future knowledge gaps.

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
             /pan:optimize apply → writes memory entries
                          ↓
         Next build has better context → fewer errors/gaps
                          ↓
                  (repeat, improving each time)
```

The key insight: each apply run populates `.planning/memory/` with cached knowledge. Future agent runs load this memory and skip the research/inference that caused gaps. The error rate trends down. The optimization score trends up.
