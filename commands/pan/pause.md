---
name: pan:pause
group: Session & Progress
description: Create context handoff when pausing work mid-phase
allowed-tools:
  - Read
  - Write
  - Bash
---

<objective>
Create `.continue-here.md` handoff file to preserve complete work state across sessions.

Routes to the pause-work workflow which handles:
- Current phase detection from recent files
- Complete state gathering (position, completed work, remaining work, decisions, blockers)
- Handoff file creation with all context sections
- Git commit as WIP
- Resume instructions
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/pause.md
</execution_context>

<context>
State and phase progress are gathered in-workflow with targeted reads.
</context>

<handoff_schema>
The `.continue-here.md` file MUST contain ALL of the following sections. Missing sections cause resume failures.

```yaml
# Required fields for .continue-here.md
session_id: "{date}-{slug}"           # Unique session identifier
paused_at: "{ISO-8601 timestamp}"     # When work was paused
phase: "{phase number and name}"      # Current phase being worked on
plan: "{plan file path}"              # Which plan was active

position:
  last_completed_task: "{task ID}"    # Last task that was fully done
  next_task: "{task ID}"              # What to do next
  wave: "{wave number, if applicable}"

progress:
  tasks_done: [{id, title, status}]   # All completed tasks this session
  tasks_remaining: [{id, title}]      # What's left in the plan
  test_baseline: "{N passing}"        # Test count when session started
  test_current: "{N passing}"         # Test count at pause time

decisions:
  - "{decision made and why}"         # Choices that affect remaining work

blockers:
  - "{blocker description}"           # Anything preventing progress

context:
  files_modified: ["{paths}"]         # Files changed this session
  key_findings: ["{findings}"]        # Non-obvious discoveries
  next_action: "{specific action}"    # Exact first step on resume
```

**Why every field matters:**
- `position` → resume agent knows WHERE to start (not re-reading the whole plan)
- `progress` → resume agent knows test baseline (detects regressions vs pre-existing)
- `decisions` → resume agent won't re-debate settled questions
- `blockers` → resume agent can flag to user immediately instead of rediscovering
- `context.next_action` → resume agent's first action is productive, not exploratory
</handoff_schema>

<process>
**Follow the pause-work workflow** from `@~/.claude/pan-wizard-core/workflows/pause.md`.

The workflow handles all logic including:
1. Phase directory detection
2. State gathering with user clarifications
3. Handoff file writing with timestamp — **using the schema from `<handoff_schema>`**
4. Git commit
5. Confirmation with resume instructions
</process>
