---
phase: XX-name
plan: YY
subsystem: [primary category]
tags: [searchable tech]
provides:
  - [bullet list of what was built/delivered]
affects: [list of phase names or keywords]
test-tiers: []  # Optional — Test tiers exercised: [unit, integration, e2e, visual]
tech-stack:
  added: [libraries/tools]
  patterns: [architectural/code patterns]
key-files:
  created: [important files created]
  modified: [important files modified]
key-decisions:
  - "Decision 1"
duration: Xmin
completed: YYYY-MM-DD
---

# Phase [X]: [Name] Summary

**[Substantive one-liner describing outcome]**

## Performance
- **Duration:** [time]
- **Tasks:** [count completed]
- **Files modified:** [count]

## Accomplishments
- [Key outcome 1]
- [Key outcome 2]

## Task Commits
1. **Task 1: [task name]** - `hash`
2. **Task 2: [task name]** - `hash`
3. **Task 3: [task name]** - `hash`

## Files Created/Modified
- `path/to/file.ts` - What it does
- `path/to/another.ts` - What it does

## Implementation Decisions
<!-- Schema: @~/.claude/pan-wizard-core/references/handoff-decisions.md -->

### Taken (within plan's discretion)
- DT-1: Chose [option] for O-N. Reason: [rationale].

### Deviations (from plan; must explain)
- DV-1: Plan said [X]; I did [Y]. Reason: [rationale]. Verification: [how I confirmed Y is acceptable].

### Open questions for verifier
- Q-1: [question]. Why it matters: [stake].

<!-- If none: replace ALL three buckets with:
     "No deviations or open questions — implementation followed plan exactly." -->

## Next Phase Readiness
[What's ready for next phase]
