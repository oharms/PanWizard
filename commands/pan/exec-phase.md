---
name: pan:exec-phase
group: Phase Lifecycle
description: Execute all plans in a phase with wave-based parallelization
argument-hint: "<phase-number> [--gaps-only] [--skip-tests] [--skip-review] [--fast] [--deep-review] [--hierarchical] [--auto]"
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
3. The verifier's test gate ran the suite (or verification was skipped because `workflow.verifier` is off)
4. All verified tasks committed with accurate commit messages
5. state.md updated with phase progress
6. Failed tasks (if any) logged with error classification and root cause

Execution FAILS if: a plan fails and the user stops the run, or state corruption is detected.
</completion_contract>

<wave_dependencies>
Discovery → Waves: executors commit each task themselves; the workflow's generate_tests step and the verifier's test gate run the suite (the orchestrator does not commit waves)
Wave N → Wave N+1: Each wave waits for the previous wave's executors to return; their summaries are spot-checked (summary.md, commits, no `## Self-Check: FAILED`) before the next wave starts
All Waves → Verify: the verifier's test gate judges the suite; a failed gate is a gap for `/pan:plan-phase <N> --gaps`, not a revert
Verify → Phase complete: `phase complete` runs only after verification passes (or a `human_needed` verdict is approved), or after the "verification skipped" report when `workflow.verifier` is off

HARD STOP conditions (do not proceed to next wave):
- State corruption detected (malformed state.md or plan files) → STOP execution entirely, report to user
- A plan failed and the user chose "Stop?" → partial completion report; if they continue, never run a plan that depends on a failed one (`phase-plan-index --failed`)
</wave_dependencies>

<context>
Phase: $ARGUMENTS

**Flags:**
- `--gaps-only` — Execute only gap closure plans (plans with `gap_closure: true` in frontmatter). Use after `/pan:plan-phase <N> --gaps` creates fix plans.
- `--skip-tests` — Skip automatic test generation after execution completes.
- `--skip-review` — Skip automatic code review after execution completes.
- `--fast` — Skip both test generation and code review (implies `--skip-tests --skip-review`).
- `--deep-review` — After the normal code review, run the deep review inline: the `/pan:review-deep` process, a security audit by pan-hardener plus a cross-check by pan-meta-reviewer, merged into `.planning/reviews/<N>/deep-review.md`. It builds on the normal review, so it is skipped with `--skip-review` or `--fast`. Recommended for phases touching auth, payment, PII, migrations, or public APIs. Costs roughly 3× a normal review.
- `--hierarchical` (v3.4+, Claude Code only — needs native sub-agent spawning) — Spawn `pan-conductor` as a top-level orchestrator that decomposes the phase and spawns executor/reviewer/verifier sub-agents in sequence. `pan-conductor` carries no `model:` and is spawned without one, so it runs on the model you launched the session with under every profile. Bounded by safety harness: max 2 nesting levels, 12 spawns per phase, budget ceiling, `.planning/orchestration/abort` kill-switch. On runtimes that cannot spawn nested agents, this flag is a no-op with a warning and falls back to flat exec. Use only for large phases (≥4 autonomous plans) where wall-clock reduction justifies the ~20-30% orchestration tax.
- `--auto` — Autonomous chain: sets `workflow.auto_advance`, and once verification passes with no gaps runs the transition to the next phase instead of stopping at a menu. `/pan:plan-phase --auto` passes `--auto --no-transition`, which stops after verification and the roadmap update and returns `PHASE COMPLETE`, or returns `GAPS FOUND` (no roadmap update) when verification finds gaps.

Context files are resolved inside the workflow via `pan-tools init execute-phase` and per-subagent `<files_to_read>` blocks.
</context>

<action_gating>
Each execution stage has a restricted set of appropriate actions. Using the wrong tool at the wrong stage causes regressions.

| Stage | Read | Grep/Glob | Edit/Write | Bash (tests) | Bash (git) | Agent |
|-------|------|-----------|------------|--------------|------------|-------|
| Discovery (find plans) | YES | YES | NO | NO | NO | NO |
| Wave execution | YES | YES | YES | YES | NO | YES |
| Wave verification | YES | YES | NO | YES | NO | NO |
| Final verification | YES | YES | NO | YES | NO | NO |
| State update | YES | NO | YES | NO | YES | NO |

**Key constraints:**
- Discovery: read-only — do not modify files while figuring out what to execute
- Wave verification: NO Edit/Write — you are checking work, not doing more work
- Commits: each executor commits its own tasks; the orchestrator makes no wave commits, and commits the phase's tracking files after `phase complete`
</action_gating>

<process>
**With `--hierarchical` on Claude Code:** run the workflow below, but in place of its wave execution, code review and `verify_phase_goal` spawn, spawn `pan-conductor` (`subagent_type="pan-conductor"`) with the phase number and the other flags: it runs the executors, the reviewer and the verifier itself, under its safety harness. When it returns, route on the verification its verifier wrote, as `verify_phase_goal` does, and carry on with the steps after it. On any other runtime, print `--hierarchical is not supported on <runtime>. Falling back to flat exec.` and run the workflow unchanged.

Execute the execute-phase workflow from @~/.claude/pan-wizard-core/workflows/exec-phase.md end-to-end.
Preserve all workflow gates (wave execution, checkpoint handling, verification, state updates, routing).

**Context Management Across Waves:**
- KEEP: Phase goals, test baseline, current wave tasks, file paths being modified
- SUMMARIZE: Completed wave results to one-line summaries
- DISCARD: Raw tool output from previous waves

**Attention Anchor — emit after each wave completes:**
```
Wave {N}/{total} complete | Plans: {done}/{total} | Failed: {plan IDs, or none}
Remaining waves: {list of wave numbers with task counts}
Next: Wave {N+1} — {task count} tasks [{task IDs}]
```
This prevents drift in multi-wave phases where the agent loses track of which waves remain and which plans failed.

**Task tracking:** where your runtime offers a todo or task-tracking tool, you may keep the wave list in it. Do not depend on one: some runtimes offer none on their newest models (Claude Code gates its task tools behind `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` there). The attention anchor above, the wave summaries and state.md are the record either way.

**State Intent Before Implementing (M+ tasks):**
For each STANDARD or FULL task, state before coding: "I will modify [files], adding [what], to achieve [goal]. Risk: [what could break]."

**Pre-Commit Verification Checklist — the executors commit each task themselves (there is no wave commit); check their work against it when a wave returns:**
1. Every modified file was read before editing
2. The wave's commits touch only files related to its tasks
3. No summary carries `## Self-Check: FAILED` (the suite as a whole is judged by the verifier's test gate)
4. Commit message lists only tasks that are verified (tests ran, tests passed)
5. No secrets or credentials in the wave's commits

If any check fails: treat that plan as failed and route it as the workflow's spot-check does ("Retry plan?" or "Continue with remaining waves?").

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
