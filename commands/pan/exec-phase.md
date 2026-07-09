---
name: pan:exec-phase
group: Phase Lifecycle
description: Execute all plans in a phase with wave-based parallelization
argument-hint: "<phase-number> [--gaps-only] [--skip-tests] [--skip-review] [--fast]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Bash
  - Task
  - TodoWrite
  - AskUserQuestion
---
<objective>
Execute all plans in a phase using wave-based parallel execution.

Orchestrator stays lean: discover plans, analyze dependencies, group into waves, spawn subagents, collect results. Each subagent loads the full execute-plan context and handles its own plan.

Context budget: ~15% orchestrator, 100% fresh per subagent.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/exec-phase.md
@~/.claude/pan-wizard-core/references/ui-brand.md
</execution_context>

<completion_contract>
Execution is complete when ALL conditions are met:
1. Every plan in the phase has been dispatched to a subagent
2. All subagents have returned (success or failure)
3. Full test suite passes with count >= pre-execution baseline
4. All verified tasks committed with accurate commit messages
5. state.md updated with phase progress
6. Failed tasks (if any) logged with error classification and root cause

Execution FAILS if: test count drops below baseline after all retries, or state corruption is detected.
</completion_contract>

<wave_dependencies>
Discovery → Baseline: Test baseline MUST be captured before any wave executes (regression detection requires it)
Baseline → Wave N: Each wave MUST wait for the previous wave to complete and pass verification
Wave N → Commit N: Wave changes MUST pass tests before committing (don't commit broken code)
All Waves → Final Verify: Full test suite MUST pass after all waves complete
Final Verify → State Update: state.md MUST only be updated after verification passes

HARD STOP conditions (do not proceed to next wave):
- Baseline capture fails (test suite broken before we start) → STOP, report to user
- Wave N test count drops below baseline after 3 retries → revert wave, mark all wave tasks FAILED, continue to next wave
- State corruption detected (malformed state.md or plan files) → STOP execution entirely, report to user
- All waves complete but final test count < baseline → revert last wave, re-verify
</wave_dependencies>

<context>
Phase: $ARGUMENTS

**Flags:**
- `--gaps-only` — Execute only gap closure plans (plans with `gap_closure: true` in frontmatter). Use after verify-work creates fix plans.
- `--skip-tests` — Skip automatic test generation after execution completes.
- `--skip-review` — Skip automatic code review after execution completes.
- `--fast` — Skip both test generation and code review (implies `--skip-tests --skip-review`).
- `--deep-review` (v3.4+) — After the normal reviewer step, also run `/pan:review-deep <phase>` (security audit via pan-hardener + cross-check via pan-meta-reviewer). Produces `.planning/reviews/<N>/deep-review.md`. Recommended for phases touching auth, payment, PII, migrations, or public APIs. Costs roughly 3× a normal review.
- `--hierarchical` (v3.4+, Claude + Opus 4.7 only) — Spawn `pan-conductor` as a top-level orchestrator that decomposes the phase and spawns executor/reviewer/verifier sub-agents in sequence. Bounded by safety harness: max 2 nesting levels, 12 spawns per phase, budget ceiling, `.planning/orchestration/abort` kill-switch. On non-Claude runtimes or older models, this flag is a no-op with a warning and falls back to flat exec. Use only for large phases (≥4 autonomous plans) where wall-clock reduction justifies the ~20-30% orchestration tax.

Context files are resolved inside the workflow via `pan-tools init execute-phase` and per-subagent `<files_to_read>` blocks.
</context>

<action_gating>
Each execution stage has a restricted set of appropriate actions. Using the wrong tool at the wrong stage causes regressions.

| Stage | Read | Grep/Glob | Edit/Write | Bash (tests) | Bash (git) | Agent |
|-------|------|-----------|------------|--------------|------------|-------|
| Discovery (find plans) | YES | YES | NO | NO | NO | NO |
| Baseline capture | YES | NO | NO | YES | YES | NO |
| Wave execution | YES | YES | YES | YES | NO | YES |
| Wave verification | YES | YES | NO | YES | NO | NO |
| Wave commit | NO | NO | NO | NO | YES | NO |
| Final verification | YES | YES | NO | YES | NO | NO |
| State update | YES | NO | YES | NO | YES | NO |

**Key constraints:**
- Discovery: read-only — do not modify files while figuring out what to execute
- Baseline: run tests + git status only — no code changes before baseline is captured
- Wave verification: NO Edit/Write — you are checking work, not doing more work
- Wave commit: git operations only — all code changes must be done before committing
</action_gating>

<cache_priming>
**Before Discovery, prime the prompt cache once per invocation.** All subagents spawned within the next 5 minutes will hit the cache instead of re-sending the full context.

Run once:
```
pan-tools cache prime --summary
```

This returns `{blocks: [{path, bytes, cache}], total_bytes, sha}` for the cacheable set (project.md, requirements.md, roadmap.md, state.md, standards.md). The `sha` is stable across identical inputs, so repeated calls within the phase hit cached reads.

When spawning subagents for wave execution, include the cacheable block paths in each agent's system-context so the host runtime (Claude Code with Opus 4.7) can mark them `cache_control: ephemeral`. On non-Claude runtimes or older models, this step is a no-op — nothing breaks, just no savings.
</cache_priming>

<process>
Execute the execute-phase workflow from @~/.claude/pan-wizard-core/workflows/exec-phase.md end-to-end.
Preserve all workflow gates (wave execution, checkpoint handling, verification, state updates, routing).

**Context Management Across Waves:**
- KEEP: Phase goals, test baseline, current wave tasks, file paths being modified
- SUMMARIZE: Completed wave results to one-line summaries
- DISCARD: Raw tool output from previous waves

**Attention Anchor — emit after each wave completes:**
```
Wave {N}/{total} complete | Tasks: {done}/{total} | Tests: {baseline} → {current}
Remaining waves: {list of wave numbers with task counts}
Next: Wave {N+1} — {task count} tasks [{task IDs}]
```
This prevents drift in multi-wave phases where the agent loses track of which waves remain and what the test baseline was.

**State Intent Before Implementing (M+ tasks):**
For each STANDARD or FULL task, state before coding: "I will modify [files], adding [what], to achieve [goal]. Risk: [what could break]."

**Pre-Commit Verification Checklist — apply before each wave commit:**
1. Every modified file was read before editing
2. `git diff --stat` contains only files related to the current wave's tasks
3. Test suite passes and count meets or exceeds pre-wave baseline
4. Commit message lists only tasks that are verified (tests ran, tests passed)
5. No secrets or credentials staged

If any check fails: fix and re-verify before committing.

**Error Recovery Classification — apply when any task fails:**
- RECOVERABLE (retry up to 3 times): test failure after code change, build syntax error, file not found (search for moved path)
- UNRECOVERABLE (mark task FAILED, continue to next): same failure after 3 retries, permission errors, state corruption, unrelated test regression
Never let a failed task block the rest of the wave.

**Anti-Overengineering:**
Implement exactly what the plan says. Do not add features, refactor surrounding code, add comments to unchanged files, or create abstractions for one-time operations.

**Common Anti-Patterns (avoid these):**
```
BAD:  Task says "add input validation" → you also refactor the error handler, add logging, and rename variables
      → 3 unrelated changes pollute the diff, risk regressions in untested paths
GOOD: Add validation only → commit → let the next task handle error handling if planned

BAD:  Test fails → change the test's expected output to match the broken code
      → Bug is now hidden, passes CI, breaks in production
GOOD: Test fails → read the test intent → fix the code to match the expected behavior
```
</process>
