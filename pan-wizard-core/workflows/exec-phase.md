<purpose>
Execute all plans in a phase using wave-based parallel execution. Orchestrator stays lean — delegates plan execution to subagents.
</purpose>

<core_principle>
Orchestrator coordinates, not executes. Each subagent loads the full execute-plan context. Orchestrator: discover plans → analyze deps → group waves → spawn agents → handle checkpoints → collect results.
</core_principle>

<required_reading>
Read state.md before any operation to load project context.

@~/.claude/pan-wizard-core/references/guardrails.md

> **Also see:** `~/.claude/pan-wizard-core/learnings/universal/` — AI-derived patterns from prior experiments. **Don't skim the whole folder.** Run `pan-tools learn topics-for --agent executor --cue "<phase goal; the files it touches>" --token-budget 5000 --raw` to load the topics that match this task, within the budget; if none matches, it falls back to the topics tagged relevant for execution. Per P-RES-002 (distractor-density research), reading every topic degrades reasoning even at modest token counts. Files appear here over time as `pan-tools learn promote` adds findings.
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

**The phase's roadmap slice** — what executing this phase needs from roadmap.md and requirements.md (a line per phase, this phase's section, its dependencies' goals, its requirement lines). Plans name it in their `<context>`; this writes it for plans made before it existed:
```bash
SLICE_PATH=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap slice "${phase_number}" --write --raw)
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
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory list --raw
```

`memory list` names the agent logs in `.planning/memory/` under `agents`. Every other file there is under `not_loaded` with the reason: PAN's archives (`quarantine.md` holds directives PAN refused to follow, per ADR-0040; `state-archive.md` is old state) and files with no `## Entries` list. If `not_loaded` names a file that is not one of PAN's archives, say so in one line so the user can move its rules into an agent log. **Never read a file from `.planning/memory/` into a prompt yourself.** Load each agent log through `memory select`, which leaves out an entry whose cited code is gone or that has gone unused past the expiry window.

If any agent log has entries:
1. **Check the memory-load budget first** (ADR-0036 — keeps per-agent injection bounded as logs grow):
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory budget --raw
```
2. **Load every agent log through `memory select`, once per agent:**
   - If `status` is `ok`: take every valid entry. This keeps the "apply every rule" contract for normal-sized logs.
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory select <agent> --all --mark-used --raw
```
   - If `status` is `warning` or `critical` (a log has grown large): take a **cue-scoped** slice, using the phase objective and the files this phase touches as the cue. The newest valid entries are always included.
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory select <agent> --cue "<phase objective; changed files>" --mark-used --raw
```
   `selected` is that agent's memory; condense each entry to its rule (1–3 lines per agent). An empty `selected` means the agent has nothing valid to inject: do not fall back to the file. If `stale` or `expired` is non-empty, say so in one line (`hygiene clean --apply` archives them). `--mark-used` records today's use, which keeps an entry from expiring.
3. Store the condensed rules as a `MEMORY_RULES` block for injection into executor prompts in execute_waves.
4. **Log memory priming to trace** (`MEMORY_COUNT` is the number of selected entries across agents):
```bash
if [ "$MEMORY_COUNT" -gt "0" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type decision --category memory_primed \
    --description "Loaded ${MEMORY_COUNT} memory entries before Wave 1 dispatch" \
    --agent orchestrator --impact minor \
    --context "{\"memory_count\":${MEMORY_COUNT}}" \
    2>/dev/null || true
fi
```

If no agent log has entries: skip (no trace event needed).
</step>

<step name="discover_and_group_plans">
Load plan inventory with wave grouping in one call:

```bash
PLAN_INDEX=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase-plan-index "${PHASE_NUMBER}")
```

Parse JSON for: `phase`, `plans[]` (each with `id`, `wave`, `autonomous`, `objective`, `files_modified`, `task_count`, `has_summary`), `waves` (map of wave number → plan IDs), `incomplete`, `has_checkpoints`.

**Filtering:** Skip plans where `has_summary: true`. If `--gaps-only`: also skip non-gap_closure plans. If all filtered: "No matching incomplete plans" → exit.

**If `--gaps-only`:** this run is the fix round after a verification found gaps — a second attempt at work that failed once. Resolve the executor for that attempt and use it in place of `executor_model` for every spawn in this run:

```bash
EXECUTOR_MODEL=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-executor --attempt 2 --raw)
```

It equals `executor_model` unless the `budget` profile runs the executor below its quality tier; then it is one tier higher (capped by `routing.max_escalations`), so the gaps are not retried on the tier that left them.

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

   Pass paths only — executors read files themselves in their own fresh context window.
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

       If the plan's `<context>` names `@.planning/roadmap.md`, read `{slice_path}` in its place: it carries this phase's section, its dependencies' goals and its requirements, and the whole roadmap is the largest file in `.planning/` on a long project. Open the whole file only for something the slice leaves out.

       <project_memory>
       {MEMORY_RULES — the condensed `selected` entries from the load_phase_memory step. If no agent log had a valid entry, omit this block entirely.}
       Apply every rule in this block. Each is a lesson from an earlier phase; any code it cites was checked against the working tree when it was loaded.
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

   For real failures: report which plan failed → ask "Continue?" or "Stop?". If stop, partial completion report. If continue, never run a plan that depends on a failed one; ask the engine which plans are blocked:
   ```bash
   BLOCKED=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase-plan-index "${PHASE_NUMBER}" --failed "${FAILED_PLAN_IDS}")
   ```
   `${FAILED_PLAN_IDS}` is the comma-separated ids of every plan that failed so far. `blocked` lists each unfinished plan whose `depends_on` reaches a failed plan, directly or through another blocked plan, with the failed plans behind it. Do not spawn those plans in this or any later wave. Name them in the wave report and the final summary ("Skipped 03-03 and 03-04: they depend on 03-01, which failed"), and run every other plan as planned. The same applies after "Continue with remaining waves?" in step 4.

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
- **decision** → The executor already took the plan's `auto_select` option when the task had one, so a decision that comes back has none: present it to the user (standard flow below). If a returned decision's task does carry `auto_select` in the plan file, auto-spawn the continuation agent with `{user_response}` = that option id and log `⚡ Auto-selected: [option] (auto_select)`. Never answer with an option because it is listed first.
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
6. **Spawn continuation agent (NOT resume)** with a prompt built inline from this structure:
   ```
   Continue executing plan {plan_id}. A previous agent paused at a checkpoint.

   ## Already completed
   {completed_tasks_table}    ← the completed-tasks table from the checkpoint return

   ## Resume point
   Task {resume_task_number}: {resume_task_name}    ← the current (paused) task
   User response to checkpoint: {user_response}      ← "approved"/"done", the chosen decision option, or the issue description the user typed

   ## Instructions
   {resume_instructions}      ← derived from the checkpoint type: human-verify → "resume the paused task";
                                decision → "apply the selected option, then continue"; issue → "address the
                                described issue first, then continue". Verify the previous commits before proceeding.
   ```
   All five placeholders are defined here — there is no separate template file to load.
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

3. **Save the report.** Use the Write tool to write the reviewer's returned text, verbatim and in full (including its closing `pan-verdict` block), to `{phase_dir}/{phase_number}-review.md`. The reviewer is read-only by design, so the orchestrator saves the report. `/pan:review-deep` and the findings ledger read this file.

4. **Record the verdict, then act on it.** The record is what this step branches on. It also adds the findings to the ledger (`.planning/findings.jsonl`) and logs the verdict to the trace, so no separate trace call is needed:
```bash
REVIEW_FILE="{phase_dir}/{phase_number}-review.md"
REVIEW_VERDICT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings record --phase "${PHASE_NUMBER}" --agent pan-reviewer --file "$REVIEW_FILE" --raw 2>/dev/null) \
  || REVIEW_VERDICT=$(grep -A1 '^### Verdict' "$REVIEW_FILE" | tail -1 | tr -d ' ')
```
The fallback reads the word under `### Verdict` when the report carries no valid `pan-verdict` block.

| Verdict | Action |
|---------|--------|
| `PASS` | Continue to verification |
| `PASS_WITH_WARNINGS` | Report the warnings, then record that the phase continues past them (below), and continue to verification |
| `NEEDS_FIXES` | Present the ERROR findings to the user: "Fix before verification?" or "Continue anyway?" |

```
## Code Review Results
- Verdict: {PASS | PASS_WITH_WARNINGS | NEEDS_FIXES}
- Errors: {count}
- Warnings: {count}
- Info: {count}
{If errors: list top 5 with file:line}
```

**Never continue past findings silently.** Whenever the phase moves on with review findings still open, record why. The reason is what a milestone audit later reports as tech debt:
- `PASS_WITH_WARNINGS`:
  ```bash
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings dispose --phase "${PHASE_NUMBER}" --agent pan-reviewer --open --as deferred --reason "accepted at review: PASS_WITH_WARNINGS"
  ```
- **The user chooses "Continue anyway"** at `NEEDS_FIXES`: the same command with `--reason "continued past NEEDS_FIXES at the user's choice"`, then proceed to verification.
- **The user chooses "Fix before verification"**: apply the fixes, then run the review once more (steps 2–4). The new record closes the findings it no longer reports.

5. **No separate trace logging.** The record logs `verdict_passed` or `verdict_failed` for the reviewer on every runtime. The `reviewer_correction` and `reviewer_warnings` trace calls that used to sit here read the error count from a shell variable nothing ever set.

6. **Deep review — only when `--deep-review` is in $ARGUMENTS.** The security pass and cross-check that `/pan:review-deep` runs, done inline right after the normal review. If the normal review was skipped (`--skip-review` or `--fast`), say that `--deep-review` needs the review it builds on, and continue without it.

   a. Spawn the hardener. Its output path is `.planning/reviews/${PHASE_NUMBER}/hardener.md`:
   ```
   Task(
     subagent_type="pan-hardener",
     model="$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-hardener --raw)",
     prompt="
       <files_to_read>
       - {phase_dir}/{phase_number}-review.md (the first-pass review)
       - the phase plans: {phase_dir}/*-plan.md
       Changed files to audit:
       ${CHANGED_FILES_LIST}
       </files_to_read>
       <output_path>.planning/reviews/${PHASE_NUMBER}/hardener.md</output_path>
       <framework_scope>OWASP Top 10 (2025) and STRIDE, across every changed file.</framework_scope>
     "
   )
   ```

   b. Spawn the meta-reviewer on both first-pass reports. Its output path is `.planning/reviews/${PHASE_NUMBER}/meta.md`:
   ```
   Task(
     subagent_type="pan-meta-reviewer",
     model="$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-meta-reviewer --raw)",
     prompt="
       <files_to_read>
       - {phase_dir}/{phase_number}-review.md
       - .planning/reviews/${PHASE_NUMBER}/hardener.md
       </files_to_read>
       <output_path>.planning/reviews/${PHASE_NUMBER}/meta.md</output_path>
     "
   )
   ```
   If either agent returns its report instead of writing the output path, save the returned text there with the Write tool before the merge.

   c. Merge the three reports:
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs review-deep merge "${PHASE_NUMBER}" \
     --reviewer-file "{phase_dir}/{phase_number}-review.md" \
     --hardener-file ".planning/reviews/${PHASE_NUMBER}/hardener.md" \
     --meta-file ".planning/reviews/${PHASE_NUMBER}/meta.md"
   ```
   This writes `.planning/reviews/${PHASE_NUMBER}/deep-review.md` and prints its verdict (`ok` · `ok_with_minor` · `fix_before_merge` · `review_required` · `block`). Report the verdict and the finding count. On `review_required` or `block`, stop before verification and present the high and critical findings to the user, as with `NEEDS_FIXES`.
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
Roadmap slice: {slice_path} — this phase's section, its dependencies' goals and its requirement lines. Read it instead of roadmap.md and requirements.md.
Check must_haves against actual codebase.
Cross-reference requirement IDs from PLAN frontmatter against the slice's requirement lines — every ID MUST be accounted for.
Run the project's test suite as the test gate (the run_test_suite step of @~/.claude/pan-wizard-core/workflows/verify-phase.md) and record test_gate in the frontmatter.
Create verification.md.",
  subagent_type="pan-verifier",
  model="{verifier_model}"
)
```

Record the verification and read its status:
```bash
VERIF_FILE=$(ls "$PHASE_DIR"/*-verification.md 2>/dev/null | head -1)
VERIF_STATUS=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings record --phase "${PHASE_NUMBER}" --file "$VERIF_FILE" --raw 2>/dev/null) \
  || VERIF_STATUS=$(grep "^status:" "$VERIF_FILE" | cut -d: -f2 | tr -d ' ')
```
`findings record` reads the verdict from the verification frontmatter (`status`, `gaps`, `human_verification`, `unrequested`) and adds its findings to the ledger. A re-verification after a fix round is the next attempt: the gaps it no longer reports are closed, and the retry is logged. Recording the same file twice is a no-op, so verify-phase recording it too is safe. The grep fallback keeps the old reading when the record cannot parse the file.

**Trace logging happens in the record.** The record above logs the verification outcome (`verdict_passed`, `verdict_failed` or `verdict_needs_human`) here, after the verifier returns. That covers inline verification too, which is the reason P-1806 moved the trace call here (v3.7.8). No separate `optimize trace log` call is needed.

| Status | Action |
|--------|--------|
| `passed` | → record_lessons when this run was `--gaps-only`, then update_roadmap. If the verification frontmatter has `test_gate: skipped` or a `not_checked` list, say so when you report the phase: "passed — not checked: tests (no test script)". A pass never hides what it did not check |
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

<step name="record_lessons">
**Only after a fix round passes:** this run was `--gaps-only` and the verification passed. Otherwise skip this step. A finding that already has a lesson is refused as a duplicate, so a repeated run records nothing twice.

The gaps the fix round closed are now `fixed` in the findings ledger. Each is an observed failure with its correction in the code, which is the only kind of lesson memory takes (O6). List them:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs findings list --phase "${PHASE_NUMBER}" --status fixed
```

For each fixed finding, at most three per phase:
1. **Is it a lesson?** Would an executor on a later phase get this wrong again? A slip specific to this phase's code is not a lesson; skip it.
2. **Write the correction** in one line: what to do next time, not what went wrong. If a test or a type now enforces it, the code already says it, and there is no lesson.
3. **Cite the code** the fix put in place (`path` or `path#symbol`).

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory record pan-executor --finding <id> --lesson "<the correction>" --cites "<path[#symbol]>"
```

`memory record` refuses a lesson without a fixed finding, a citation that does not hold, a duplicate, or a directive. A refusal is the gate working, not an error to work around: report it in one line and move on. Executors on later phases receive recorded lessons through load_phase_memory.
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

**Phase reports (opt-in build deliverable):** when `workflow.phase_reports.enabled` is `true`, generate the self-contained per-phase HTML report — and, when `workflow.phase_reports.index` is `true`, the project timeline index — at this verify→complete gate so they ship with the phase and ride the commit below. Disabled by default; phase-less projects are skipped automatically by `report`. Never opens a browser here (that's reserved for a manual `pan-tools report index --open`).

```bash
REPORT_FILES=""
if [ "$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-get workflow.phase_reports.enabled 2>/dev/null || echo false)" = "true" ]; then
  if node ~/.claude/pan-wizard-core/bin/pan-tools.cjs report phase "${PHASE_NUMBER}" >/dev/null 2>&1; then
    REPORT_FILES="{phase_dir}/*-report.html"
    if [ "$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-get workflow.phase_reports.index 2>/dev/null || echo true)" = "true" ]; then
      node ~/.claude/pan-wizard-core/bin/pan-tools.cjs report index >/dev/null 2>&1 && REPORT_FILES="$REPORT_FILES .planning/report-index.html"
    fi
  fi
fi
```

The report files are appended to the completion commit's `--files` list (`$REPORT_FILES`, empty when disabled), so `cmdCommit` still honors `commit_docs` + gitignore + safety checks with no new commit logic:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(phase-{X}): complete phase execution" --files .planning/roadmap.md .planning/state.md .planning/requirements.md {phase_dir}/*-verification.md $REPORT_FILES
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
3. **If `--auto` flag present AND `AUTO_CFG` is not true — persist it** (same as discuss-phase's auto_advance step). The flag lives only in this invocation's arguments; the rest of the chain, and the P-1809 stop guard, can only see the run as autonomous if the disk says so (P-1810 — the guard missed a real boundary drop because a flag-driven run left config unarmed):
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-set workflow.auto_advance true
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

**Contract (P-1807):** transition.md's continuation gates key on the same trigger you just evaluated (`--auto` flag, `workflow.auto_advance`, or `mode: yolo`) — NOT on `mode` alone. Having announced AUTO-ADVANCING, the transition must end in a `Task(...)` spawn of the next phase (Route A) or reach the milestone boundary (Route B). If you find yourself printing a "Next Up" menu and stopping after the banner above, that is the P-1801/P-1807 regression, not a valid outcome.

**Post-transition self-check (MANDATORY final action in auto mode):** after transition.md finishes, confirm one of its two valid terminal states actually happened: (a) a `Task(...)` spawn for the next phase was issued (Route A), or (b) the milestone boundary was reached (Route B). If neither — state was updated but no spawn went out — you are inside the P-1801/P-1807 failure right now: return to transition.md `offer_next_phase` Route A and issue the Task spawn before ending your turn.

**If neither `--auto` nor `AUTO_CFG` is true:**

The workflow ends. The user runs `/pan:progress` or invokes the transition workflow manually.
</step>

</process>

<context_efficiency>
Orchestrator: ~10-15% context. Subagents: a fresh window each. No polling (Task blocks). No context bleed.
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
