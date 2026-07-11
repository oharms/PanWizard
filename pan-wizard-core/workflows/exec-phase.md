<purpose>
Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean — delegates plan execution to subagents.
</purpose>

<core_principle>
Orchestrator coordinates, not executes. Each subagent loads the full execute-plan context. Orchestrator: discover plans → analyze deps → group waves → spawn agents → handle checkpoints → collect results.
</core_principle>

<required_reading>
Read state.md before any operation to load project context.

@~/.claude/pan-wizard-core/references/guardrails.md

> **Also see:** `~/.claude/pan-wizard-core/learnings/universal/` — AI-derived patterns from prior experiments. **Don't skim the whole folder.** Run `pan-tools learn topics-for --agent executor --token-budget 5000 --raw` to load only the topics tagged relevant for execution at the configured budget. Per P-RES-002 (distractor-density research), reading every topic degrades reasoning even at modest token counts. Files appear here over time as `pan-tools learn promote` adds findings.
</required_reading>

## Re-Read Checkpoints

Context compaction may have dropped earlier sections. Re-read the relevant section *before* you begin each step — not after you hit a problem.

| Before this step | Re-read | Why |
|------------------|---------|-----|
| Spawning a subagent | This workflow's `<step name="execute">` block | Wave/segment routing is easy to misremember after compaction |
| Writing code in a plan | `references/tdd.md` + plan file | Conventions and the plan's tasks drift across long sessions |
| Committing | `references/guardrails.md` | Pre-commit shortcuts (silent model swaps, scope creep) are tempting under pressure |
| Marking phase complete | `workflows/verify-phase.md` | Completion criteria are easy to misremember |

<process>

<step name="initialize" priority="first">
Load all context in one call:

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init execute-phase "${PHASE_ARG}")
```

Parse JSON for: `executor_model`, `verifier_model`, `reviewer_model`, `commit_docs`, `parallelization`, `branching_strategy`, `branch_name`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `plans`, `incomplete_plans`, `plan_count`, `incomplete_count`, `state_exists`, `roadmap_exists`, `phase_req_ids`.

**If `phase_found` is false:** Error — phase directory not found.
**If `plan_count` is 0:** Error — no plans found in phase.
**If `state_exists` is false but `.planning/` exists:** Offer reconstruct or continue.

When `parallelization` is false, plans within a wave execute sequentially.

**Circular optimization — start trace session for this exec:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace init \
  --description "exec-phase ${PHASE_ARG}" \
  --command "exec-phase" \
  --phase "${PHASE_ARG}" 2>/dev/null || true
```
</step>

<step name="handle_branching">
Check `branching_strategy` from init:

**"none":** Skip, continue on current branch.

**"phase" or "milestone":** Use pre-computed `branch_name` from init:
```bash
git checkout -b "$BRANCH_NAME" 2>/dev/null || git checkout "$BRANCH_NAME"
```

All subsequent commits go to this branch. User handles merging.
</step>

<step name="validate_phase">
From init JSON: `phase_dir`, `plan_count`, `incomplete_count`.

Report: "Found {plan_count} plans in {phase_dir} ({incomplete_count} incomplete)"
</step>

<step name="load_phase_memory">
**Load project memory before dispatching executors — prevents re-learning patterns already solved.**

```bash
ls .planning/memory/*.md 2>/dev/null
```

If `.planning/memory/` exists and contains `.md` files:
1. **Check the memory-load budget first** (ADR-0036 — keeps per-agent injection bounded as logs grow):
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory budget --raw
```
2. **Load, size-gated — whole-file is the default:**
   - If `status` is `ok`: **read every file whole** (Read tool) and condense each entry to its rule(s) — 1–3 lines per file. This preserves the "apply every rule" contract for normal-sized logs.
   - If `status` is `warning` or `critical` (a log has grown large): load a **cue-scoped** slice per agent instead of the whole log, using the phase objective + the files this phase touches as the cue:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory select <agent> --cue "<phase objective; changed files>" --raw
```
     Run once per agent that has a memory file. The returned `selected` entries are already recency-floored and token-budgeted (the newest lessons are always included). If `selected` is empty for an agent, **fall back to reading that file whole** — never silently drop an agent's memory.
3. Store the condensed rules as a `MEMORY_RULES` block for injection into executor prompts in execute_waves.
4. **Log memory priming to trace:**
```bash
MEMORY_COUNT=$(ls .planning/memory/*.md 2>/dev/null | wc -l | tr -d ' ')
if [ "$MEMORY_COUNT" -gt "0" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type decision --category memory_primed \
    --description "Loaded ${MEMORY_COUNT} memory entries before Wave 1 dispatch" \
    --agent orchestrator --impact minor \
    --context "{\"memory_count\":${MEMORY_COUNT}}" \
    2>/dev/null || true
fi
```

If no memory files exist: skip (no trace event needed).
</step>

<step name="discover_and_group_plans">
Load plan inventory with wave grouping in one call:

```bash
PLAN_INDEX=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase-plan-index "${PHASE_NUMBER}")
```

Parse JSON for: `phase`, `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`, `task_count`, `has_summary`), `waves` (map of wave number → plan IDs), `incomplete`, `has_checkpoints`.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip non-gap_closure plans. If all filtered: "No matching incomplete plans" → exit.

Report:
```
## Execution Plan

**Phase {X}: {Name}** — {total_plans} plans across {wave_count} waves

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1 | 01-01, 01-02 | {from plan objectives, 3-8 words} |
| 2 | 01-03 | ... |
```
</step>

<step name="execute_waves">
Execute each wave in sequence. Within a wave: parallel if `PARALLELIZATION=true`, sequential if `false`.

**For each wave:**

0. **Record wave start time for duration tracking:**
   ```bash
   WAVE_START_MS=$(node -e "console.log(Date.now())")
   ```

1. **Describe what's being built (BEFORE spawning):**

   Read each plan's `<objective>`. Extract what's being built and why.

   ```
   ---
   ## Wave {N}

   **{Plan ID}: {Plan Name}**
   {2-3 sentences: what this builds, technical approach, why it matters}

   Spawning {count} agent(s)...
   ---
   ```

   - Bad: "Executing terrain generation plan"
   - Good: "Procedural terrain generator using Perlin noise — creates height maps, biome zones, and collision meshes. Required before vehicle physics can interact with ground."

2. **Spawn executor agents:**

   Pass paths only — executors read files themselves with their fresh 200k context.
   This keeps orchestrator context lean (~10-15%).

   ```
   Task(
     subagent_type="pan-executor",
     model="{executor_model}",
     prompt="
       <objective>
       Execute plan {plan_number} of phase {phase_number}-{phase_name}.
       Commit each task atomically. Create summary.md. Update state.md and roadmap.md.
       </objective>

       <execution_context>
       @~/.claude/pan-wizard-core/workflows/execute-plan.md
       @~/.claude/pan-wizard-core/templates/summary.md
       @~/.claude/pan-wizard-core/references/checkpoints.md
       @~/.claude/pan-wizard-core/references/tdd.md
       </execution_context>

       <files_to_read>
       Read these files at execution start using the Read tool:
       - {phase_dir}/{plan_file} (Plan)
       - .planning/state.md (State)
       - .planning/config.json (Config, if exists)
       - ./CLAUDE.md (Project instructions, if exists — follow project-specific guidelines and coding conventions)
       - .agents/skills/ (Project skills, if exists — list skills, read SKILL.md for each, follow relevant rules during implementation)
       </files_to_read>

       <project_memory>
       {MEMORY_RULES — insert condensed content of all .planning/memory/*.md files read in load_phase_memory step. If no memory files exist, omit this block entirely.}
       Apply every rule in this block without exception. These are lessons from previous phases that the reviewer has already verified.
       </project_memory>

       <success_criteria>
       - [ ] All tasks executed
       - [ ] Each task committed individually
       - [ ] summary.md created in plan directory
       - [ ] state.md updated with position and decisions
       - [ ] roadmap.md updated with plan progress (via `roadmap update-plan-progress`)
       </success_criteria>
     "
   )
   ```

3. **Wait for all agents in wave to complete.**

4. **Report completion — spot-check claims first:**

   For each summary.md:
   - Verify first 2 files from `key-files.created` exist on disk
   - Check `git log --oneline --all --grep="{phase}-{plan}"` returns ≥1 commit
   - Check for `## Self-Check: FAILED` marker

   If ANY spot-check fails: report which plan failed, route to failure handler — ask "Retry plan?" or "Continue with remaining waves?"

   If pass:
   ```
   ---
   ## Wave {N} Complete

   **{Plan ID}: {Plan Name}**
   {What was built — from summary.md}
   {Notable deviations, if any}

   {If more waves: what this enables for next wave}
   ---
   ```

   Log wave completion to trace (include wall-clock duration):
   ```bash
   WAVE_END_MS=$(node -e "console.log(Date.now())")
   WAVE_DURATION_MS=$((WAVE_END_MS - WAVE_START_MS))
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
     --type decision --category wave_complete \
     --description "Wave ${WAVE_NUM} complete: ${PLAN_IDS}" \
     --agent pan-executor --impact trivial \
     --context "{\"wave\":${WAVE_NUM},\"plans\":\"${PLAN_IDS}\",\"duration_ms\":${WAVE_DURATION_MS}}" \
     2>/dev/null || true
   ```

   - Bad: "Wave 2 complete. Proceeding to Wave 3."
   - Good: "Terrain system complete — 3 biome types, height-based texturing, physics collision meshes. Vehicle physics (Wave 3) can now reference ground surfaces."

5. **Handle failures:**

   **Known Claude Code bug (classifyHandoffIfNeeded):** If an agent reports "failed" with error containing `classifyHandoffIfNeeded is not defined`, this is a Claude Code runtime bug — not a PAN or agent issue. The error fires in the completion handler AFTER all tool calls finish. In this case: run the same spot-checks as step 4 (summary.md exists, git commits present, no Self-Check: FAILED). If spot-checks PASS → treat as **successful**. If spot-checks FAIL → treat as real failure below.

   For real failures: report which plan failed → ask "Continue?" or "Stop?" → if continue, dependent plans may also fail. If stop, partial completion report.

6. **Execute checkpoint plans between waves** — see `<checkpoint_handling>`.

7. **Proceed to next wave.**
</step>

<step name="checkpoint_handling">
Plans with `autonomous: false` require user interaction.

**Auto-mode checkpoint handling:**

Read auto-advance config:
```bash
AUTO_CFG=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-get workflow.auto_advance 2>/dev/null || echo "false")
```

When executor returns a checkpoint AND `AUTO_CFG` is `"true"`:
- **human-verify** → Auto-spawn continuation agent with `{user_response}` = `"approved"`. Log `⚡ Auto-approved checkpoint`.
- **decision** → Auto-spawn continuation agent with `{user_response}` = first option from checkpoint details. Log `⚡ Auto-selected: [option]`.
- **human-action** → Present to user (existing behavior below). Auth gates cannot be automated.

**Standard flow (not auto-mode, or human-action type):**

1. Spawn agent for checkpoint plan
2. Agent runs until checkpoint task or auth gate → returns structured state
3. Agent return includes: completed tasks table, current task + blocker, checkpoint type/details, what's awaited
4. **Present to user:**
   ```
   ## Checkpoint: [Type]

   **Plan:** 03-03 Dashboard Layout
   **Progress:** 2/3 tasks complete

   [Checkpoint Details from agent return]
   [Awaiting section from agent return]
   ```
5. User responds: "approved"/"done" | issue description | decision selection
6. **Spawn continuation agent (NOT resume)** using continuation-prompt.md template:
   - `{completed_tasks_table}`: From checkpoint return
   - `{resume_task_number}` + `{resume_task_name}`: Current task
   - `{user_response}`: What user provided
   - `{resume_instructions}`: Based on checkpoint type
7. Continuation agent verifies previous commits, continues from resume point
8. Repeat until plan completes or user stops

**Why fresh agent, not resume:** Resume relies on internal serialization that breaks with parallel tool calls. Fresh agents with explicit state are more reliable.

**Checkpoints in parallel waves:** Agent pauses and returns while other parallel agents may complete. Present checkpoint, spawn continuation, wait for all before next wave.
</step>

<step name="aggregate_results">
After all waves:

```markdown
## Phase {X}: {Name} Execution Complete

**Waves:** {N} | **Plans:** {M}/{total} complete

| Wave | Plans | Status |
|------|-------|--------|
| 1 | plan-01, plan-02 | ✓ Complete |
| CP | plan-03 | ✓ Verified |
| 2 | plan-04 | ✓ Complete |

### Plan Details
1. **03-01**: [one-liner from summary.md]
2. **03-02**: [one-liner from summary.md]

### Issues Encountered
[Aggregate from SUMMARYs, or "None"]
```
</step>

<step name="generate_tests">
**Auto-invoke test generation after execution completes.**

**Skip if** `--skip-tests` or `--fast` flag is present in $ARGUMENTS.

1. Record baseline test count:
```bash
TEST_BASELINE=$(npm test 2>&1 | grep -E "^ℹ tests" | awk '{print $NF}')
```

2. Invoke phase-tests workflow for the completed phase:
```
Task(
  prompt="Generate tests for phase ${PHASE_NUMBER}.
Phase directory: ${phase_dir}
Read each summary.md to understand what was built.
Generate unit and integration tests for the new code.
Discover the project's existing test patterns, directories, frameworks, and helpers before writing tests.
Follow whatever conventions the project already uses.",
  subagent_type="general-purpose"
)
```

Alternatively, if the user's AI tool supports it, invoke the command directly:
```
/pan:phase-tests ${PHASE_NUMBER}
```

3. Record new test count:
```bash
TEST_AFTER=$(npm test 2>&1 | grep -E "^ℹ tests" | awk '{print $NF}')
```

4. Report:
```
## Test Generation
- Baseline: ${TEST_BASELINE} tests
- After: ${TEST_AFTER} tests
- New tests: +$((TEST_AFTER - TEST_BASELINE))
```

**If tests fail after generation:** Report failures but continue to next step. Test issues are caught by the verify-phase test gate.
</step>

<step name="code_review">
**Spawn pan-reviewer agent to review changed files.**

**Skip if** `--skip-review` or `--fast` flag is present in $ARGUMENTS.

1. Collect changed files from executor summaries:
```bash
# Read each summary.md and extract key-files.created + key-files.modified
for summary in "$PHASE_DIR"/*-summary.md; do
  grep -A 50 "key-files" "$summary" | grep -E "^\s*-" | sed 's/^\s*- //'
done | sort -u > /tmp/review-files.txt
```

2. Spawn pan-reviewer:
```
Task(
  subagent_type="pan-reviewer",
  model="{reviewer_model}",
  prompt="
    <objective>
    Review code changed in phase ${PHASE_NUMBER} for convention compliance,
    security patterns, and code quality.
    </objective>

    <files_to_read>
    Read these files at review start:
    - ./CLAUDE.md (Project instructions, if exists)
    Changed files to review:
    ${CHANGED_FILES_LIST}
    </files_to_read>

    <context>
    Phase: ${PHASE_NUMBER} - ${PHASE_NAME}
    Phase directory: ${phase_dir}
    </context>
  "
)
```

3. Handle review results:

| Verdict | Action |
|---------|--------|
| `PASS` | Continue to verification |
| `PASS_WITH_WARNINGS` | Report warnings, continue to verification |
| `NEEDS_FIXES` | Present ERROR findings to user: "Fix before verification?" or "Continue anyway?" |

```
## Code Review Results
- Verdict: {PASS | PASS_WITH_WARNINGS | NEEDS_FIXES}
- Errors: {count}
- Warnings: {count}
- Info: {count}
{If errors: list top 5 with file:line}
```

**If user chooses "Continue anyway":** Proceed to verification. Review findings are informational, not blocking.

4. **Circular optimization — log reviewer corrections to trace bus (W1 fix):**

   When verdict is `NEEDS_FIXES`, write a `reviewer_correction` event so the optimizer can see the primary quality signal:
   ```bash
   # Extract error count from review output (parse "Errors: N" line)
   REVIEW_ERROR_COUNT=$(echo "$REVIEW_OUTPUT" | grep -E "^- Errors: [0-9]+" | grep -oE "[0-9]+" | head -1)
   REVIEW_ERROR_COUNT=${REVIEW_ERROR_COUNT:-1}
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
     --type error --category reviewer_correction \
     --description "Phase ${PHASE_NUMBER} reviewer: NEEDS_FIXES — ${REVIEW_ERROR_COUNT} error(s) found" \
     --agent pan-reviewer --impact major \
     --context "{\"phase\":\"${PHASE_NUMBER}\",\"verdict\":\"NEEDS_FIXES\",\"error_count\":${REVIEW_ERROR_COUNT}}" \
     2>/dev/null || true
   ```

   When verdict is `PASS_WITH_WARNINGS`, log a softer signal:
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
     --type decision --category reviewer_warnings \
     --description "Phase ${PHASE_NUMBER} reviewer: PASS_WITH_WARNINGS — warnings present" \
     --agent pan-reviewer --impact trivial \
     --context "{\"phase\":\"${PHASE_NUMBER}\",\"verdict\":\"PASS_WITH_WARNINGS\"}" \
     2>/dev/null || true
   ```

   When verdict is `PASS`, no trace event needed — clean passes are the expected baseline.
</step>

<step name="close_parent_artifacts">
**For decimal/polish phases only (X.Y pattern):** Close the feedback loop by resolving parent UAT and debug artifacts.

**Skip if** phase number has no decimal (e.g., `3`, `04`) — only applies to gap-closure phases like `4.1`, `03.1`.

**1. Detect decimal phase and derive parent:**
```bash
# Check if phase_number contains a decimal
if [[ "$PHASE_NUMBER" == *.* ]]; then
  PARENT_PHASE="${PHASE_NUMBER%%.*}"
fi
```

**2. Find parent UAT file:**
```bash
PARENT_INFO=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs find-phase "${PARENT_PHASE}" --raw)
# Extract directory from PARENT_INFO JSON, then find UAT file in that directory
```

**If no parent UAT found:** Skip this step (gap-closure may have been triggered by verification.md instead).

**3. Update UAT gap statuses:**

Read the parent UAT file's `## Gaps` section. For each gap entry with `status: failed`:
- Update to `status: resolved`

**4. Update UAT frontmatter:**

If all gaps now have `status: resolved`:
- Update frontmatter `status: diagnosed` → `status: resolved`
- Update frontmatter `updated:` timestamp

**5. Resolve referenced debug sessions:**

For each gap that has a `debug_session:` field:
- Read the debug session file
- Update frontmatter `status:` → `resolved`
- Update frontmatter `updated:` timestamp
- Move to resolved directory:
```bash
mkdir -p .planning/debug/resolved
mv .planning/debug/{slug}.md .planning/debug/resolved/
```

**6. Commit updated artifacts:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(phase-${PARENT_PHASE}): resolve UAT gaps and debug sessions after ${PHASE_NUMBER} gap closure" --files .planning/phases/*${PARENT_PHASE}*/*-uat.md .planning/debug/resolved/*.md
```
</step>

<step name="verify_phase_goal">
Verify phase achieved its GOAL, not just completed tasks.

```
Task(
  prompt="Verify phase {phase_number} goal achievement.
Phase directory: {phase_dir}
Phase goal: {goal from roadmap.md}
Phase requirement IDs: {phase_req_ids}
Check must_haves against actual codebase.
Cross-reference requirement IDs from PLAN frontmatter against requirements.md — every ID MUST be accounted for.
Create verification.md.",
  subagent_type="pan-verifier",
  model="{verifier_model}"
)
```

Read status:
```bash
VERIF_STATUS=$(grep "^status:" "$PHASE_DIR"/*-verification.md | cut -d: -f2 | tr -d ' ')
```

**P-1806 fix (v3.7.8):** the trace event for verify-phase outcome is logged HERE (in exec-phase.md after the verifier returns) rather than only at the end of verify-phase.md. When verification runs inline (orchestrator-as-verifier in auto mode, no separate Task spawn), the trace.log block at the bottom of verify-phase.md never executes — the orchestrator just writes verification.md and continues. By logging here, the event fires regardless of the verification path taken. Surfaced by the wookie autonomous build (v3.7.5–v3.7.7): all 5 phases used inline verification, no `verification_passed` events appeared in the trace despite v3.7.5 adding the trace block to verify-phase.md.

```bash
if [ "$VERIF_STATUS" = "passed" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type decision --category verification_passed \
    --description "Phase ${PHASE_NUMBER} verification passed (logged from exec-phase, P-1806)" \
    --agent pan-verifier --impact minor 2>/dev/null || true
elif [ "$VERIF_STATUS" = "gaps_found" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type error --category verification_gaps \
    --description "Phase ${PHASE_NUMBER} verification found gaps" \
    --agent pan-verifier --impact major 2>/dev/null || true
elif [ "$VERIF_STATUS" = "human_needed" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type decision --category verification_human_needed \
    --description "Phase ${PHASE_NUMBER} verification awaiting human review" \
    --agent pan-verifier --impact minor 2>/dev/null || true
fi
```

| Status | Action |
|--------|--------|
| `passed` | → update_roadmap |
| `human_needed` | Present items for human testing, get approval or feedback |
| `gaps_found` | Present gap summary, offer `/pan:plan-phase {phase} --gaps` |

**If human_needed:**
```
## ✓ Phase {X}: {Name} — Human Verification Required

All automated checks passed. {N} items need human testing:

{From verification.md human_verification section}

"approved" → continue | Report issues → gap closure
```

**If gaps_found:**
```
## ⚠ Phase {X}: {Name} — Gaps Found

**Score:** {N}/{M} must-haves verified
**Report:** {phase_dir}/{phase_num}-verification.md

### What's Missing
{Gap summaries from verification.md}

---
## ▶ Next Up

`/pan:plan-phase {X} --gaps`

<sub>`/clear` first → fresh context window</sub>

Also: `cat {phase_dir}/{phase_num}-verification.md` — full report
Also: `/pan:verify-phase {X}` — manual testing first
```

Gap closure cycle: `/pan:plan-phase {X} --gaps` reads verification.md → creates gap plans with `gap_closure: true` → user runs `/pan:exec-phase {X} --gaps-only` → verifier re-runs.
</step>

<step name="update_roadmap">
**Mark phase complete and update all tracking files:**

```bash
COMPLETION=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase complete "${PHASE_NUMBER}")
```

The CLI handles:
- Marking phase checkbox `[x]` with completion date
- Updating Progress table (Status → Complete, date)
- Updating plan count to final
- Advancing state.md to next phase
- Updating requirements.md traceability

Extract from result: `next_phase`, `next_phase_name`, `is_last_phase`.

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(phase-{X}): complete phase execution" --files .planning/roadmap.md .planning/state.md .planning/requirements.md {phase_dir}/*-verification.md
```

**Circular optimization — finalize trace session:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace end 2>/dev/null || true
```

Log phase completion event:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
  --type decision --category phase_complete \
  --description "Phase ${PHASE_NUMBER} execution complete (${VERIFICATION_STATUS:-verified})" \
  --agent orchestrator --impact minor 2>/dev/null || true
```
</step>

<step name="offer_next">

**Exception:** If `gaps_found`, the `verify_phase_goal` step already presents the gap-closure path (`/pan:plan-phase {X} --gaps`). No additional routing needed — skip auto-advance.

**No-transition check (spawned by auto-advance chain):**

Parse `--no-transition` flag from $ARGUMENTS.

**If `--no-transition` flag present:**

Execute-phase was spawned by plan-phase's auto-advance. Do NOT run transition.md.
After verification passes and roadmap is updated, return completion status to parent:

```
## PHASE COMPLETE

Phase: ${PHASE_NUMBER} - ${PHASE_NAME}
Plans: ${completed_count}/${total_count}
Verification: {Passed | Gaps Found}

[Include aggregate_results output]
```

STOP. Do not proceed to auto-advance or transition.

**If `--no-transition` flag is NOT present:**

**Verification gate check (before auto-advance):**

If `workflow.verifier` is true in config, confirm the current phase has a passing verification:

```bash
VERIF=$(ls "$phase_dir"/*-verification.md 2>/dev/null | head -1)
VERIF_STATUS=""
if [ -n "$VERIF" ]; then
  VERIF_STATUS=$(grep "^status:" "$VERIF" | awk '{print $2}')
fi
```

**Cross-check the written verdict against the mechanical signals (anti-rubber-stamp, ADR-0036).** The `status:` string above is authored by the verifier agent; `reconcile` re-derives the artifact/key-link checks from disk and exits non-zero when a claimed pass contradicts them:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify reconcile "${PHASE_NUMBER}" --raw
RECONCILE_EXIT=$?
```
If `RECONCILE_EXIT` is non-zero:
```
⚠ Reconcile gate: Phase ${PHASE_NUMBER} verification says "passed" but the mechanical
  checks disagree — artifacts fail substance checks or key-links are unwired.
  This is a rubber-stamped verification. Do NOT auto-advance.
  Re-run /pan:verify-phase and fix the failing artifacts/key-links.
```
STOP — do not auto-advance. Return to user.

If `VERIF_STATUS` is not `passed`:
```
⚠ Verification gate: Phase ${PHASE_NUMBER} verification status is "${VERIF_STATUS:-missing}"
  Cannot auto-advance without passing verification.
  Run /pan:verify-phase to verify this phase first.
```
STOP — do not auto-advance. Return to user.

**Auto-advance detection:**

1. Parse `--auto` flag from $ARGUMENTS
2. Read `workflow.auto_advance` from config:
   ```bash
   AUTO_CFG=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-get workflow.auto_advance 2>/dev/null || echo "false")
   ```

**If `--auto` flag present OR `AUTO_CFG` is true (AND verification passed with no gaps):**

```
╔══════════════════════════════════════════╗
║  AUTO-ADVANCING → TRANSITION             ║
║  Phase {X} verified, continuing chain    ║
╚══════════════════════════════════════════╝
```

Execute the transition workflow inline (do NOT use Task — orchestrator context is ~10-15%, transition needs phase completion data already in context):

Read and follow `~/.claude/pan-wizard-core/workflows/transition.md`, passing through the `--auto` flag so it propagates to the next phase invocation.

**If neither `--auto` nor `AUTO_CFG` is true:**

The workflow ends. The user runs `/pan:progress` or invokes the transition workflow manually.
</step>

</process>

<context_efficiency>
Orchestrator: ~10-15% context. Subagents: fresh 200k each. No polling (Task blocks). No context bleed.
</context_efficiency>

<failure_handling>
- **classifyHandoffIfNeeded false failure:** Agent reports "failed" but error is `classifyHandoffIfNeeded is not defined` → Claude Code bug, not PAN. Spot-check (SUMMARY exists, commits present) → if pass, treat as success
- **Agent fails mid-plan:** Missing summary.md → report, ask user how to proceed
- **Dependency chain breaks:** Wave 1 fails → Wave 2 dependents likely fail → user chooses attempt or skip
- **All agents in wave fail:** Systemic issue → stop, report for investigation
- **Checkpoint unresolvable:** "Skip this plan?" or "Abort phase execution?" → record partial progress in state.md
</failure_handling>

<resumption>
Re-run `/pan:exec-phase {phase}` → discover_plans finds completed SUMMARYs → skips them → resumes from first incomplete plan → continues wave execution.

state.md tracks: last completed plan, current wave, pending checkpoints.
</resumption>
