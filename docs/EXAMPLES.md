# PAN Wizard -- Worked Examples

Realistic command sequences showing common PAN Wizard workflows. Each example
shows what you type, what PAN does behind the scenes, and what to expect.

---

## Example 1: New Project from Scratch (Full Lifecycle)

A solo developer building a CLI task manager from zero.

### Step 1 -- Initialize the project

```
/pan:new-project
```

PAN asks a series of scoping questions: what you are building, who it is for,
tech stack preferences, deployment targets, and rough scope. Answer
conversationally -- PAN extracts structure from your responses.

```
PAN: What are you building?
You: A CLI task manager called "doto". It stores tasks in a local SQLite
     database, supports priorities, due dates, and tags. Written in Python.

PAN: Who is the primary audience?
You: Developers who live in the terminal.

PAN: Any technical constraints?
You: Python 3.10+, no external service dependencies, single-file DB.
     Ship as a pip-installable package.
```

When the conversation is complete PAN creates:

- `.planning/project.md` -- vision and goals
- `.planning/requirements.md` -- scoped functional and non-functional requirements
- `.planning/roadmap.md` -- phased delivery plan (e.g., Phase 1: Core CRUD,
  Phase 2: Filtering & Tags, Phase 3: Packaging & Docs)

### Step 2 -- Discuss implementation preferences for Phase 1

```
/pan:discuss-phase 1
```

PAN asks about implementation details specific to Phase 1: database schema
choices, CLI framework (click vs argparse vs typer), output formatting, error
handling style. Your answers are recorded in `.planning/phases/01-{name}/context.md` as decisions.

```
PAN: Which CLI framework do you prefer?
You: Typer -- I want automatic --help generation and type hints.

PAN: How should tasks be displayed?
You: Rich tables for list view, plain text for single-task view.
```

### Step 3 -- Plan Phase 1

```
/pan:plan-phase 1
```

PAN spawns a researcher agent that investigates the phase's domain —
Typer best practices, SQLite schema patterns for task managers, Rich table
formatting, and Python project structure conventions. A planner agent
synthesizes research into a concrete plan. A plan-checker agent then reviews
the plan for gaps, contradictions, and missing edge cases.

Result: `.planning/phases/01-{name}/01-01-plan.md` (and additional plans) containing ordered implementation steps,
file-by-file change descriptions, and dependency notes.

### Step 4 -- Execute Phase 1

```
/pan:exec-phase 1
```

PAN reads the plan and groups independent tasks into parallel waves. Wave 1
might create the project skeleton and database module simultaneously. Wave 2
builds the CLI commands that depend on both. Each wave completes and is
verified before the next begins.

You see real-time progress as files are created and tests are run.

### Step 5 -- Verify the work

```
/pan:verify-phase 1
```

PAN walks you through user acceptance testing. It suggests specific things to
try ("run `doto add 'Buy milk' --priority high` and confirm it appears in
`doto list`") and asks you to confirm or flag issues. Fixes are applied
immediately. When you approve, `.planning/phases/01-{name}/verification.md` is written.

### Step 6 -- Complete the milestone

```
/pan:milestone-done
```

PAN archives Phase 1 artifacts, tags the release (`v0.1.0`), and updates
`.planning/roadmap.md` to mark Phase 1 as complete.

### Step 7 -- Continue to Phase 2

```
/pan:discuss-phase 2
/pan:plan-phase 2
/pan:exec-phase 2
/pan:verify-phase 2
```

Repeat the cycle. Each phase builds on the verified output of the previous one.

---

## Example 2: Adding Features to an Existing Codebase

You have a Django web app and want to add a REST API layer.

### Step 1 -- Map the existing codebase

```
/pan:map-codebase
```

PAN spawns parallel mapper agents that scan the repository, sharded by focus
area. They
catalog models, views, URL patterns, middleware, settings, test structure,
dependency versions, module relationships, and best practices. The output is
a structured understanding of what already exists, stored so that subsequent
commands have full context.

This matters because without mapping, PAN would ask generic questions during
project setup. With mapping, it already knows your models, your auth setup,
and your existing test patterns.

### Step 2 -- Initialize the API project

```
/pan:new-project
```

Because the codebase has been mapped, PAN tailors its questions to the
brownfield scenario:

```
PAN: I see a Django 4.2 app with 12 models and session-based auth.
     What do you want to add?
You: A REST API using Django REST Framework. Token auth for external
     clients, session auth for the existing frontend.

PAN: Which models need API endpoints?
You: All of them except AuditLog and AdminConfig.

PAN: Any versioning strategy?
You: URL-based: /api/v1/
```

PAN generates requirements and a roadmap that reference your actual models
by name and account for your existing URL structure.

### Step 3 -- Plan and execute

```
/pan:discuss-phase 1
/pan:plan-phase 1
/pan:exec-phase 1
```

The plan references real files in your codebase. Execution modifies existing
files (adding serializers, viewsets, URL includes) rather than generating
everything from scratch. Tests are written to match your existing test style.

---

## Example 3: Quick Bug Fix

A user reports that dates are displayed in UTC instead of local time.

```
/pan:quick
```

```
PAN: What do you need?
You: The task list shows due dates in UTC. They should display in the
     user's local timezone. The relevant code is in src/display.py.
```

PAN reads the file, identifies the formatting call, applies the fix, and
runs existing tests. No research phase, no plan document -- just a focused
change with verification.

```
PAN: Fixed. Changed `task.due_date.strftime(...)` to
     `task.due_date.astimezone(tz.tzlocal()).strftime(...)` in
     src/display.py:47. All 23 tests pass.
```

For larger ad-hoc work, use `--full` to get research and planning without
the full phase ceremony:

```
/pan:quick --full
```

```
You: Add CSV export to the task list command.
```

PAN researches CSV best practices, plans the implementation, executes it,
and verifies -- all in one flow, without creating a formal phase.

---

## Example 4: Resuming After a Break

You stopped mid-session yesterday. Today you open the project and cannot
remember where you left off.

### Check current state

```
/pan:progress
```

PAN reads `.planning/state.md` and `.planning/roadmap.md` and prints a
summary:

```
Project: doto (CLI task manager)
Milestone: v0.2.0

Phase 1: Core CRUD             [complete]
Phase 2: Filtering & Tags      [in progress]
  - discuss-phase              [complete]
  - plan-phase                 [complete]
  - exec-phase                 [partial -- wave 2 of 3 finished]
  - verify-phase               [pending]
Phase 3: Packaging & Docs      [pending]

Last activity: 2026-02-26 18:42 -- completed wave 2 (tag filtering)
Next step: /pan:exec-phase 2   (resumes at wave 3)
```

### Restore full context

```
/pan:resume
```

PAN reloads project context, phase plan, decisions from discussion, and the
execution state. It reconstructs what has been built, what remains, and any
blockers noted in `state.md`. You are back to full working context without
re-reading anything yourself.

```
PAN: Context restored. Phase 2 execution is at wave 3 of 3.
     Remaining work: date-range filtering and the `doto filter` subcommand.
     Ready to continue with /pan:exec-phase 2
```

### Saving state before stopping

When you need to stop mid-session:

```
/pan:pause
```

PAN writes current progress, open decisions, and any partial work notes to
a `.continue-here.md` handoff file in the active phase directory so that
`/pan:resume` can pick up cleanly next time.

---

## Example 5: Cost-Conscious Development

You are working on a side project and want to minimize token usage.

### Switch to the budget profile

```
/pan:profile budget
```

This configures PAN to use cheaper models for research and planning agents.
The orchestrator still uses a capable model for coordination, but the
parallel sub-agents use lighter ones.

### Disable optional stages

```
/pan:settings
```

```
PAN: Current settings:
  research: true
  plan_check: true
  verifier: false

What would you like to change?
You: Disable research and plan-check.
```

With these off, `plan-phase` skips the researcher agent and the
plan-checker agent. Planning still happens, but it relies on the model's
built-in knowledge instead of dedicated research passes.

**Token savings:** A typical phase with research and plan-check might use
80-120k tokens across the sub-agents. Disabling both reduces `plan-phase`
to roughly 15-25k tokens -- a 70-80% reduction.

### The workflow is identical

```
/pan:discuss-phase 1
/pan:plan-phase 1        # faster, cheaper -- no research or plan-check
/pan:exec-phase 1
/pan:verify-phase 1
```

The same commands, the same file structure, just fewer agent spawns. You can
re-enable research for complex phases and disable it for straightforward ones.

---

## Example 6: Multi-Phase with Scope Changes

You are three phases into a project when priorities shift.

### Original roadmap

```
Phase 1: User authentication     [complete]
Phase 2: Dashboard               [complete]
Phase 3: Reporting               [in progress]
Phase 4: Notifications           [pending]
Phase 5: Admin panel             [pending]
```

### Urgent work arrives mid-project

The team needs a webhook integration before the next demo. Insert it as a
new phase:

```
/pan:insert-phase 4 "Webhook Integration"
```

PAN inserts the new phase at position 4, shifting Notifications to 5 and
Admin Panel to 6. The roadmap updates:

```
Phase 1: User authentication     [complete]
Phase 2: Dashboard               [complete]
Phase 3: Reporting               [in progress]
Phase 4: Webhook Integration     [pending]      <-- new
Phase 5: Notifications           [pending]
Phase 6: Admin panel             [pending]
```

### Descoping work that is no longer needed

The admin panel has been deprioritized indefinitely:

```
/pan:remove-phase 6
```

```
Phase 1: User authentication     [complete]
Phase 2: Dashboard               [complete]
Phase 3: Reporting               [in progress]
Phase 4: Webhook Integration     [pending]
Phase 5: Notifications           [pending]
```

The roadmap stays clean, phase numbers stay sequential, and all state
references update automatically.

### Continue normally

```
/pan:exec-phase 3     # finish current work
/pan:verify-phase 3
/pan:discuss-phase 4     # move to the inserted phase
/pan:plan-phase 4
/pan:exec-phase 4
```

---

## Example 7: From PRD to Code (--auto Mode)

You have a product requirements document and want PAN to initialize the
project without an interactive Q&A session.

### Prepare your PRD

Your file `prd.md` contains:

```markdown
# Doto -- CLI Task Manager

## Overview
A terminal-based task manager for developers. SQLite storage,
pip-installable, Python 3.10+.

## Features
- Add, edit, delete, complete tasks
- Priority levels (low, medium, high, critical)
- Due dates with local timezone display
- Tag-based organization
- Rich table output for list views
- CSV and JSON export

## Technical Decisions
- CLI framework: Typer
- Database: SQLite via sqlite3 stdlib
- Output: Rich library for tables
- Packaging: setuptools with pyproject.toml

## Non-Functional Requirements
- Sub-100ms response for all commands
- Database migrations via simple version table
- 90%+ test coverage target
```

### Run automated initialization

```
/pan:new-project --auto @prd.md
```

PAN reads the PRD, extracts goals, requirements, constraints, and technical
decisions. Instead of asking you questions, it generates all planning
artifacts directly:

```
PAN: Read prd.md (847 tokens). Extracting project structure...

Created:
  .planning/project.md       -- vision and goals from PRD
  .planning/requirements.md  -- 14 functional, 3 non-functional requirements
  .planning/roadmap.md       -- 3 phases: Core CRUD, Organization & Export,
                                Packaging & Polish
  .planning/config.json      -- default configuration

Review the generated files. If anything needs adjustment, edit directly
or run /pan:new-project to refine interactively.
```

### Continue with normal workflow

From here the workflow is identical to the interactive path:

```
/pan:discuss-phase 1     # refine any implementation details
/pan:plan-phase 1 --auto # auto mode works here too -- skips discussion,
                         # uses PRD decisions directly
/pan:exec-phase 1
/pan:verify-phase 1
```

The `--auto` flag on `discuss-phase` and `plan-phase` tells PAN to make
reasonable decisions from context rather than asking. Useful when your PRD
is detailed enough to answer implementation questions.

---

## Quick Reference: Common Sequences

| Scenario | Command sequence |
|---|---|
| Greenfield project | `new-project` > `discuss` > `plan` > `execute` > `verify` |
| Brownfield project | `map-codebase` > `new-project` > `discuss` > `plan` > `execute` > `verify` |
| Fast bug fix | `quick` |
| Substantial ad-hoc work | `quick --full` |
| Start of day | `progress` > `resume` |
| End of day | `pause` |
| New version cycle | `milestone-done` > `milestone-new` |
| Automated from PRD | `new-project --auto @prd.md` > `plan --auto` > `execute` > `verify` |

---

## Spec B v2 worked examples (v3.0-v3.4)

### Preview a risky phase before committing

You've planned a database migration in phase 7. Before running `exec-phase`, sanity-check the blast radius.

```
/pan:preview phase 7
```

The data layer scans `01-plan.md`, `02-plan.md`, etc., extracts file paths mentioned in backticks or under known source roots (`src/`, `tests/`, etc.), and runs the risk regex over the combined plan text. The `pan-previewer` agent then synthesizes a report at `.planning/phases/07/preview.md`:

- **Files likely touched** — `src/db/migrations.js`, `src/models/User.js`, `tests/migrations.test.cjs`
- **Tests at risk** — 3 test files reference migration schemas
- **Risk signals** — `drop: true`, `migrate: true` → risk score 7/10
- **Bottom line** — "Run in a feature branch with a rollback plan. Migration reverse is not documented in plan.md."

If risk ≥ 7 or auth keywords hit, review the plan before `/pan:exec-phase`. Combine with `--deep-review` for auth/payment phases.

### Deep-review an auth phase

Phase 4 adds JWT authentication. Run exec-phase with deep-review enabled:

```
/pan:exec-phase 4 --deep-review
```

After the normal pipeline (plan → executors → reviewer → verifier), the command auto-invokes `/pan:review-deep 4`:

1. **pan-hardener** (OWASP + STRIDE) writes `.planning/reviews/04/hardener.md`. Looks for missing authorization checks, credential storage weaknesses, session management gaps.
2. **pan-meta-reviewer** reads both reviewer + hardener, writes `.planning/reviews/04/meta.md`. Flags what either missed, disputes overstated severities.
3. Merge writes `.planning/reviews/04/deep-review.md` with verdict (`ok` / `ok_with_minor` / `fix_before_merge` / `review_required` / `block`) + findings table.
4. Audit entry published to `.planning/bus/review-handoff.jsonl` for traceability.

Verdict `block` means a critical issue was found — don't merge until resolved. `review_required` means a high finding needs human sign-off.

### Generate a team playbook after milestone-done

After shipping a milestone, capture accumulated lessons for onboarding:

```
/pan:milestone-done
/pan:knowledge playbook
```

The playbook command reads `.planning/memory/*.md` — every lesson that `pan-planner`, `pan-verifier`, `pan-reviewer`, and other agents wrote during the milestone — and clusters entries into categories (Conventions / Gotchas / Decisions / Tool choices / Anti-patterns / Recurring gaps / General). Output at `.planning/playbook.md`:

```markdown
## Conventions
- 2026-04-10: Prefer bulk Postgres writes over per-row commits _— from `pan-planner`_

## Gotchas
- 2026-04-12: Async iterators finalize on throw; wrap in try/finally _— from `pan-verifier`_

## Decisions
- 2026-04-15: Chose Redis over Memcached — Redis AOF gives durability at our write rate _— from `pan-planner`_
```

New team members run `/pan:knowledge ask "what should I know before editing the cache layer?"` and get grounded answers citing the playbook plus relevant ADRs.
