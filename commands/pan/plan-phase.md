---
name: pan:plan-phase
group: Phase Lifecycle
description: Create detailed phase plan (plan.md) with verification loop
argument-hint: "[phase] [--auto] [--research] [--skip-research] [--gaps] [--skip-verify] [--prd <file>]"
agent: pan-planner
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
  - WebFetch
  - mcp__context7__*
---
<objective>
Create executable phase prompts (plan.md files) for a roadmap phase with integrated research and verification.

**Default flow:** Research (if needed) → Plan → Verify → Done

**Orchestrator role:** Parse arguments, validate phase, research domain (unless skipped), spawn pan-planner, verify with pan-plan-checker, iterate until pass or max iterations, present results.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/plan-phase.md
@~/.claude/pan-wizard-core/references/ui-brand.md
</execution_context>

<context>
Phase number: $ARGUMENTS (optional — auto-detects next unplanned phase if omitted)

**Flags:**
- `--research` — Force re-research even if research.md exists
- `--skip-research` — Skip research, go straight to planning
- `--gaps` — Gap closure mode (reads verification.md, skips research)
- `--skip-verify` — Skip verification loop
- `--prd <file>` — Use a PRD/acceptance criteria file instead of discuss-phase. Parses requirements into context.md automatically. Skips discuss-phase entirely.

Normalize phase input in step 2 before any directory lookups.
</context>

<reflexion_loop>
During the plan-checker verification iteration:
1. Read the plan-checker's critique carefully
2. For each identified gap: verify it is a genuine gap by re-reading the relevant requirement
3. Do not blindly accept all critiques — some may be false positives from missing context
4. Revise the plan to address genuine gaps only
5. Maximum 2 revision iterations (plan → check → revise → check → final)
This prevents over-revision while ensuring real gaps are closed.
</reflexion_loop>

<completion_contract>
Planning is complete when ALL conditions are met:
1. At least one plan.md file created in the phase directory
2. Plan-checker passed (or max 2 revision iterations exhausted with final approval)
3. Each plan contains: objective, task breakdown with estimates, dependency ordering, and key file links
4. Research.md exists (unless --skip-research was used)
5. User presented with results and next-step options

Planning FAILS if: phase not found in roadmap, or planner agent returns empty/malformed output after retries.
</completion_contract>

<common_mistakes>
Avoid these planning anti-patterns:
```
BAD:  Plan has 25 tasks for a single phase → too granular, executor loses context
GOOD: 5-8 tasks per plan, each with clear scope and testable outcome

BAD:  Task says "Implement the feature" with no file links or acceptance criteria
      → Executor guesses at scope, misses edge cases
GOOD: Task says "Add retry logic to api/client.ts:fetchData() — 3 retries with exponential backoff, tested by tests/client.test.ts"

BAD:  Plan-checker flags a gap → blindly add a task without re-reading the requirement
      → False positive becomes unnecessary work
GOOD: Re-read the requirement → confirm the gap is real → then add the task
```
</common_mistakes>

<routing_decision_tree>
Use this decision tree to select the correct path. Evaluate conditions top-to-bottom; take the FIRST match.

```
IF --gaps flag is set:
  → SKIP research (gap closure uses verification.md instead)
  → READ verification.md for the phase
  → PLAN with gap context
  → VERIFY (unless --skip-verify)

ELSE IF --prd <file> flag is set:
  → SKIP discuss-phase entirely
  → PARSE PRD file into context.md
  → SKIP research (PRD provides requirements)
  → PLAN from parsed requirements
  → VERIFY (unless --skip-verify)

ELSE IF --skip-research flag is set:
  → SKIP research
  → PLAN directly (must have roadmap context)
  → VERIFY (unless --skip-verify)

ELSE IF research.md already exists AND --research NOT set:
  → SKIP research (reuse existing)
  → PLAN using existing research.md
  → VERIFY (unless --skip-verify)

ELSE (default path):
  → RUN research (spawn pan-phase-researcher)
  → PLAN from research results
  → VERIFY (unless --skip-verify)
```

**Verification loop routing:**
```
IF --skip-verify:
  → Present plan, done

ELSE:
  → Spawn pan-plan-checker
  → IF checker PASSES: done
  → IF checker finds gaps (iteration 1): revise plan, re-check
  → IF checker finds gaps (iteration 2): final revision, present with caveats
  → Max 2 revision iterations
```
</routing_decision_tree>

<cache_priming>
**Before spawning research + planner agents, prime the prompt cache.** All sub-agents spawned within the next 5 minutes hit cached context instead of re-reading project.md / requirements.md / roadmap.md / state.md / standards.md.

Run once per invocation:
```
pan-tools cache prime --summary
```

Returns `{blocks: [{path, bytes, cache}], total_bytes, sha}`. On Claude Code with Opus 4.7, the host runtime translates these block references into `cache_control: ephemeral`. On non-Claude runtimes or older models this is a no-op — nothing breaks.
</cache_priming>

<process>
Execute the plan-phase workflow from @~/.claude/pan-wizard-core/workflows/plan-phase.md end-to-end.
Preserve all workflow gates (validation, research, planning, verification loop, routing).
</process>
