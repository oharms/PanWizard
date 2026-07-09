---
name: pan:resume
group: Session & Progress
description: Resume work from previous session with full context restoration
allowed-tools:
  - Read
  - Bash
  - Write
  - AskUserQuestion
  - SlashCommand
---

<objective>
Restore complete project context and resume work seamlessly from previous session.

Routes to the resume-project workflow which handles:

- state.md loading (or reconstruction if missing)
- Checkpoint detection (.continue-here files)
- Incomplete work detection (PLAN without SUMMARY)
- Status presentation
- Context-aware next action routing
  </objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/resume-project.md
</execution_context>

<handoff_consumption>
When a `.continue-here.md` file exists, parse it as structured handoff data before presenting options.

**Required extraction (in order):**
1. `position.next_task` → This is the FIRST thing to tell the user
2. `blockers` → If non-empty, surface BEFORE offering to continue
3. `decisions` → Load into context so they are not re-debated
4. `progress.test_baseline` + `progress.test_current` → Verify current test count matches `test_current` (detect drift since pause)
5. `context.next_action` → Use as the default suggested action

**Resume validation:**
- If `test_current` at resume time differs from stored value → warn user: "Test count changed since pause ({stored} → {current}). Someone else may have committed."
- If `position.next_task` references a task not in the plan → warn: plan may have been revised since pause
- If `blockers` exist → present them and ask if resolved before continuing

**Anti-pattern:**
```
BAD:  Resume reads .continue-here.md, ignores position, re-reads entire plan from scratch
      → Wastes context on already-completed work, may re-implement done tasks
GOOD: Resume extracts position.next_task, skips completed tasks, starts exactly where paused
```
</handoff_consumption>

<routing_decision_tree>
Use this decision tree to select the correct resumption path. Evaluate top-to-bottom; take the FIRST match.

```
IF .planning/ does not exist:
  → "No project found. Run /pan:new-project to get started."
  → STOP

ELSE IF .continue-here.md exists:
  → PARSE handoff file using <handoff_consumption> protocol
  → PRESENT: position, blockers, next action
  → ROUTE to the command that was paused (exec-phase, plan-phase, etc.)

ELSE IF state.md exists AND has status "in_progress":
  → FIND incomplete work: plans without summaries, phases mid-execution
  → IF incomplete phase found:
    → PRESENT phase status + what remains
    → OFFER: continue execution (/pan:exec-phase) or verify (/pan:verify-phase)
  → IF no incomplete work but active milestone:
    → PRESENT milestone progress
    → OFFER: next unplanned phase (/pan:plan-phase) or audit (/pan:milestone-audit)

ELSE IF state.md exists AND has status "blocked":
  → PRESENT blockers from state.md
  → OFFER: debug (/pan:debug) or unblock manually

ELSE IF state.md exists AND has status "completed":
  → "Current milestone is complete. Run /pan:milestone-done or /pan:milestone-new."
  → STOP

ELSE (state.md missing or unreadable):
  → ATTEMPT reconstruction from .planning/ artifacts
  → IF reconstruction succeeds: re-enter tree above
  → IF reconstruction fails: "State is corrupted. Run /pan:new-project or restore from git."
```
</routing_decision_tree>

<process>
**Follow the resume-project workflow** from `@~/.claude/pan-wizard-core/workflows/resume-project.md`.

The workflow handles all resumption logic including:

1. Project existence verification
2. state.md loading or reconstruction
3. Checkpoint and incomplete work detection — **parse using `<handoff_consumption>` protocol**
4. Visual status presentation
5. Context-aware option offering (checks context.md before suggesting plan vs discuss)
6. Routing to appropriate next command — **following `<routing_decision_tree>`**
7. Session continuity updates
   </process>
