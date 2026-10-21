<usage>
# /pan:learn --optimize

Manage the circular optimization loop: record a report's suggestions, view stats, list reports.

**Usage:**
```
/pan:learn --optimize apply
/pan:learn --optimize apply --report <filename>
/pan:learn --optimize revert <apply_id>
/pan:learn --optimize revert --last
/pan:learn --optimize list
/pan:learn --optimize stats
/pan:learn --optimize trace init [--description "what you're building"]
/pan:learn --optimize trace end
/pan:learn --optimize trace current
/pan:learn --optimize trace list
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
- Total errors seen (`total_errors_traced`; gaps and redundancies are not totalled)
- Total optimizations applied across all runs, the apply runs, the reverted runs, and the last `apply_id`
- Current active trace session (if any)

### trace init
Start a trace session before running a build — or join the active one: `trace init` reuses an unended session started within the last hour (`reused: true`, keeping that session's description) instead of opening a new one. The hook fires automatically on SubagentStop, but calling `trace init` first lets you attach a description to a new session.

```
/pan:learn --optimize trace init --description "building express web server"
/pan:exec-phase 1
/pan:learn
```

### trace end
Finalize the current trace session (writes summary stats to session.json).

### trace current
Show the active trace session ID (`optimize trace current` returns only `session_id` and `active`; `trace list` carries each session's event count).

### trace list
List all trace sessions, most recent first.

---

**The circular loop:**

```
┌─────────────────────────────────────────────────────┐
│                                                     │
│  /pan:learn --optimize trace init                           │
│         ↓                                          │
│  /pan:exec-phase N    ← agents run, hook traces    │
│         ↓                                          │
│  /pan:learn           ← analyze + report           │
│         ↓                                          │
│  /pan:learn --optimize apply  ← record suggestions         │
│         ↓                                          │
│  You make the changes ← instructions, tests, code  │
│         ↑                                          │
│         └──────────────────────────────────────────┘
└─────────────────────────────────────────────────────┘
```

Each iteration puts what the last run lacked where the next run's agents read it: fewer repeated errors and gaps.

**See also:** `/pan:learn`, `/pan:exec-phase`
</usage>

# Workflow: /pan:learn --optimize

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
- **The `apply_id`**, and how to undo the apply: `/pan:learn --optimize revert <apply_id>`

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
- To end the session explicitly: `/pan:learn --optimize trace end`

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
If none: tell user to run `/pan:learn --optimize trace init` before their next build.

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
             /pan:learn --optimize apply → records suggestions
                          ↓
     A person writes each one where the agents read it
                          ↓
         Next build has better context → fewer errors/gaps
                          ↓
                  (repeat, improving each time)
```

The key insight: a lesson changes the next run only from a place the next run's agents read: the project's instructions (CLAUDE.md or AGENTS.md, outside PAN's section), a test that fails when it is broken, or the code itself. PAN's workflows do not load `.planning/memory/` into agents (ADR-0036, amended `2026-10-04`). In the harness, a lesson recorded there changed nothing that the project's state, summaries and code did not already carry. The report says where each suggestion belongs, and a person puts it there.
