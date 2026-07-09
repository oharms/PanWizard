<purpose>
Create executable phase prompts (plan.md files) for a roadmap phase with integrated research and verification. Default flow: Research (if needed) -> Plan -> Verify -> Done. Orchestrates pan-phase-researcher, pan-planner, and pan-plan-checker agents with a revision loop (max 3 iterations).
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.

@~/.claude/pan-wizard-core/references/ui-brand.md
@~/.claude/pan-wizard-core/references/guardrails.md

> **Also see:** `~/.claude/pan-wizard-core/learnings/universal/` — AI-derived patterns from prior experiments. **Don't skim the whole folder.** Run `pan-tools learn topics-for --agent planner --token-budget 5000 --raw` to load only the topics tagged relevant for planning at the configured budget. Per P-RES-002 (distractor-density research), reading every topic degrades reasoning even at modest token counts.
</required_reading>

## Phase 0 — Clarify Phase Scope (recommended)

Before drafting the phase plan, confirm:

1. **What does "complete" look like for this phase?**
2. **What's deliberately out of scope?**
3. **Any constraints or dependencies on other phases?**

If the answers aren't already in `.planning/requirements.md` or the phase context file, ask the user. A 2-minute clarification prevents 30-minute rework downstream.

## Re-Read Checkpoints

Context compaction may have dropped earlier sections. Re-read the relevant section *before* you begin each step — not after you hit a problem.

| Before this step | Re-read | Why |
|------------------|---------|-----|
| Writing the plan | This workflow's "Plan structure" section | Plan format drifts across long sessions |
| Spawning the planner agent | `references/guardrails.md` | Code Preservation Principle applies to all generated code |
| Reviewing planner output | `references/checkpoints.md` | Checkpoint conventions are easy to misremember |
| Marking plan ready | `workflows/exec-phase.md` | The downstream consumer's expectations matter |

<process>

## 1. Initialize

Load all context in one call (paths only to minimize orchestrator context):

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init plan-phase "$PHASE")
```

Parse JSON for: `researcher_model`, `planner_model`, `checker_model`, `research_enabled`, `plan_checker_enabled`, `nyquist_validation_enabled`, `commit_docs`, `phase_found`, `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `has_research`, `has_context`, `has_plans`, `plan_count`, `planning_exists`, `roadmap_exists`, `phase_req_ids`.

**File paths (for <files_to_read> blocks):** `state_path`, `roadmap_path`, `requirements_path`, `context_path`, `research_path`, `verification_path`, `uat_path`. These are null if files don't exist.

**If `planning_exists` is false:** Error — run `/pan:new-project` first.

**Circular optimization — ensure trace session active:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace init \
  --description "plan-phase ${PHASE}" \
  --command "plan-phase" --phase "${PHASE}" 2>/dev/null || true
```

## 2. Parse and Normalize Arguments

Extract from $ARGUMENTS: phase number (integer or decimal like `2.1`), flags (`--research`, `--skip-research`, `--gaps`, `--skip-verify`, `--prd <filepath>`).

Extract `--prd <filepath>` from $ARGUMENTS. If present, set PRD_FILE to the filepath.

**If no phase number:** Detect next unplanned phase from roadmap.

**If `phase_found` is false:** Validate phase exists in roadmap.md. If valid, create the directory using `phase_slug` and `padded_phase` from init:
```bash
mkdir -p ".planning/phases/${padded_phase}-${phase_slug}"
```

**Existing artifacts from init:** `has_research`, `has_plans`, `plan_count`.

## 3. Validate Phase

```bash
PHASE_INFO=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${PHASE}")
```

**If `found` is false:** Error with available phases. **If `found` is true:** Extract `phase_number`, `phase_name`, `goal` from JSON.

## 3.5. Handle PRD Express Path

**Skip if:** No `--prd` flag in arguments.

**If `--prd <filepath>` provided:**

1. Read the PRD file:
```bash
PRD_CONTENT=$(cat "$PRD_FILE" 2>/dev/null)
if [ -z "$PRD_CONTENT" ]; then
  echo "Error: PRD file not found: $PRD_FILE"
  exit 1
fi
```

2. Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► PRD EXPRESS PATH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Using PRD: {PRD_FILE}
Generating context.md from requirements...
```

3. Parse the PRD content and generate context.md. The orchestrator should:
   - Extract all requirements, user stories, acceptance criteria, and constraints from the PRD
   - Map each to a locked decision (everything in the PRD is treated as a locked decision)
   - Identify any areas the PRD doesn't cover and mark as "Claude's Discretion"
   - Create context.md in the phase directory

4. Write context.md:
```markdown
# Phase [X]: [Name] - Context

**Gathered:** [date]
**Status:** Ready for planning
**Source:** PRD Express Path ({PRD_FILE})

<domain>
## Phase Boundary

[Extracted from PRD — what this phase delivers]

</domain>

<decisions>
## Implementation Decisions

{For each requirement/story/criterion in the PRD:}
### [Category derived from content]
- [Requirement as locked decision]

### Claude's Discretion
[Areas not covered by PRD — implementation details, technical choices]

</decisions>

<specifics>
## Specific Ideas

[Any specific references, examples, or concrete requirements from PRD]

</specifics>

<deferred>
## Deferred Ideas

[Items in PRD explicitly marked as future/v2/out-of-scope]
[If none: "None — PRD covers phase scope"]

</deferred>

---

*Phase: XX-name*
*Context gathered: [date] via PRD Express Path*
```

5. Commit:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(${padded_phase}): generate context from PRD" --files "${phase_dir}/${padded_phase}-context.md"
```

6. Set `context_content` to the generated context.md content and continue to step 5 (Handle Research).

**Effect:** This completely bypasses step 4 (Load context.md) since we just created it. The rest of the workflow (research, planning, verification) proceeds normally with the PRD-derived context.

## 4. Load context.md

**Skip if:** PRD express path was used (context.md already created in step 3.5).

Check `context_path` from init JSON.

If `context_path` is not null, display: `Using phase context from: ${context_path}`

**If `context_path` is null (no context.md exists):**

**P-1802 fix (v3.7.7):** in `--auto` mode (or when `workflow.auto_advance` is true) **do not call `AskUserQuestion`** and **do not attempt to spawn `discuss-phase` either** (discuss-phase has its own unguarded AskUserQuestion calls deeper in the workflow — they exit headless `claude -p` immediately). Instead, **proceed without a context.md**: the planner derives implementation decisions from project-level research, requirements, and the original idea.md frontmatter.

This trades user-design-input quality for autonomous reliability — in auto mode the user has already encoded their preferences in idea.md / project.md / requirements.md, so a missing per-phase context.md is acceptable. Surfaced when wookie's Phase 3 was launched directly with `/pan:plan-phase 3 --auto` (no Phase 3 context.md yet) and `/pan:discuss-phase 3 --auto` (which itself exited): both exited in 40-75 seconds with zero commits before this fix. Same root pattern as P-1301 which removed AskUserQuestion from `new-project.md`'s auto block.

**Auto-mode decision (no user prompt):**

If `--auto` flag is present in `$ARGUMENTS` OR `workflow.auto_advance` is `true` in config:

1. Log a `decision` trace event:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
  --type decision --category skip-context-auto \
  --description "Phase ${PHASE} P-1802 bypass: no context.md, proceeding with research+requirements+idea only" \
  --agent orchestrator --impact minor 2>/dev/null || true
```

2. Display: `Auto-mode: no Phase ${PHASE} context.md — planning from project-level research + requirements + idea.md`

3. Proceed to step 5 (Handle Research). The `pan-planner` agent reads project-level `.planning/research/architecture.md`, `features.md`, `stack.md` and the original `.planning/idea.md` to derive phase-scoped decisions itself.

**Interactive-mode decision tree (the original behavior; runs when neither `--auto` nor `workflow.auto_advance` is set):**

Use AskUserQuestion:
- header: "No context"
- question: "No context.md found for Phase {X}. Plans will use research and requirements only — your design preferences won't be included. Continue or capture context first?"
- options:
  - "Continue without context" — Plan using research + requirements only
  - "Run discuss-phase first" — Capture design decisions before planning

If "Continue without context": Proceed to step 5.
If "Run discuss-phase first": Display `/pan:discuss-phase {X}` and exit workflow.

## 5. Handle Research

**Skip if:** `--gaps` flag, `--skip-research` flag, or `research_enabled` is false (from init) without `--research` override.

**P-1401 lightweight-phase bypass (v3.7.3+):** Also skip per-phase research when ALL three are true:

1. The phase has only **1 plan** (read `plan_count` from init JSON)
2. The plan's `change_class` is in `[chore, docs, feat-trivial]` (i.e., scaffolding, config, single-file feat with ≤3 tasks)
3. Project-level `research/architecture.md`, `features.md`, `stack.md` already exist (so the planner has broad context to draw from)

In that case, log a `decision` trace event (`type: "decision", category: "skip-research-trivial"`) and proceed directly to step 6 (planning). Saves ~3 commits and ~5 minutes per trivial phase. Surfaced by panloop run: Phase 1 (project setup, scaffolding only) over-ceremonialized.

This is a workflow-level optimization — the planner still produces a plan, just without per-phase research.md. Phase 2+ phases with substantive build work still go through full research.

**P-1602 phase_record_compact (v3.7.5+):** When `workflow.phase_record_compact: true` AND the lightweight-phase bypass above triggers, also skip per-phase context.md creation (step 4) and emit a single combined `${PHASE_NUM}-record.md` after planning containing: goal, locked decisions (from project-level context), plan summary, must_haves. Reduces 4-file phase output (context, research, plan, summary) to a 2-file output (record, plan) for trivial phases. Off by default — opt-in via `pan-tools config-set workflow.phase_record_compact true`. Substantive phases (>1 plan or non-trivial change_class) still produce full per-phase artifacts regardless of this flag.

**If `has_research` is true (from init) AND no `--research` flag:** Use existing, skip to step 6.

**If research.md missing OR `--research` flag:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► RESEARCHING PHASE {X}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning researcher...
```

### Spawn pan-phase-researcher

```bash
PHASE_DESC=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${PHASE}" | jq -r '.section')
```

Research prompt:

```markdown
<objective>
Research how to implement Phase {phase_number}: {phase_name}
Answer: "What do I need to know to PLAN this phase well?"
</objective>

<files_to_read>
- {context_path} (USER DECISIONS from /pan:discuss-phase)
- {requirements_path} (Project requirements)
- {state_path} (Project decisions and history)
</files_to_read>

<additional_context>
**Phase description:** {phase_description}
**Phase requirement IDs (MUST address):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .agents/skills/ directory (if exists) — read SKILL.md files, research should account for project skill patterns
</additional_context>

<output>
Write to: {phase_dir}/{phase_num}-research.md
</output>
```

```
Task(
  prompt="First, read ~/.claude/agents/pan-phase-researcher.md for your role and instructions.\n\n" + research_prompt,
  subagent_type="general-purpose",
  model="{researcher_model}",
  description="Research Phase {phase}"
)
```

### Handle Researcher Return

- **`## RESEARCH COMPLETE`:** Display confirmation, continue to step 6
- **`## RESEARCH BLOCKED`:** Display blocker, offer: 1) Provide context, 2) Skip research, 3) Abort

## 5.5. Create Validation Strategy (if Nyquist enabled)

**Skip if:** `nyquist_validation_enabled` is false from INIT JSON.

After researcher completes, check if research.md contains a Validation Architecture section:

```bash
grep -l "## Validation Architecture" "${PHASE_DIR}"/*-research.md 2>/dev/null
```

**If found:**
1. Read validation template from `~/.claude/pan-wizard-core/templates/validation.md`
2. Write to `${PHASE_DIR}/${PADDED_PHASE}-validation.md`
3. Fill frontmatter: replace `{N}` with phase number, `{phase-slug}` with phase slug, `{date}` with current date
4. If `commit_docs` is true:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(phase-${PHASE}): add validation strategy"
```

**If not found (and nyquist enabled):** Display warning:
```
⚠ Nyquist validation enabled but researcher did not produce a Validation Architecture section.
  Continuing without validation strategy. Plans may fail Dimension 8 check.
```

## 6. Check Existing Plans

```bash
ls "${PHASE_DIR}"/*-plan.md 2>/dev/null
```

**If exists:** Offer: 1) Add more plans, 2) View existing, 3) Replan from scratch.

## 7. Use Context Paths from INIT

Extract from INIT JSON:

```bash
STATE_PATH=$(echo "$INIT" | jq -r '.state_path // empty')
ROADMAP_PATH=$(echo "$INIT" | jq -r '.roadmap_path // empty')
REQUIREMENTS_PATH=$(echo "$INIT" | jq -r '.requirements_path // empty')
RESEARCH_PATH=$(echo "$INIT" | jq -r '.research_path // empty')
VERIFICATION_PATH=$(echo "$INIT" | jq -r '.verification_path // empty')
UAT_PATH=$(echo "$INIT" | jq -r '.uat_path // empty')
CONTEXT_PATH=$(echo "$INIT" | jq -r '.context_path // empty')
```

## 8. Spawn pan-planner Agent

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► PLANNING PHASE {X}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning planner...
```

Planner prompt:

```markdown
<planning_context>
**Phase:** {phase_number}
**Mode:** {standard | gap_closure}

<files_to_read>
- {state_path} (Project State)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /pan:discuss-phase)
- {research_path} (Technical Research)
- {verification_path} (Verification Gaps - if --gaps)
- {uat_path} (UAT Gaps - if --gaps)
</files_to_read>

**Phase requirement IDs (every ID MUST appear in a plan's `requirements` field):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — follow project-specific guidelines
**Project skills:** Check .agents/skills/ directory (if exists) — read SKILL.md files, plans should account for project skill rules
</planning_context>

<downstream_consumer>
Output consumed by /pan:exec-phase. Plans need:
- Frontmatter (wave, depends_on, files_modified, autonomous)
- Tasks in XML format
- Verification criteria
- must_haves for goal-backward verification
</downstream_consumer>

<quality_gate>
- [ ] plan.md files created in phase directory
- [ ] Each plan has valid frontmatter
- [ ] Tasks are specific and actionable
- [ ] Task vocabulary aligned via `pan-tools skills align` (SAD pass — advisory, skip on error)
- [ ] Dependencies correctly identified
- [ ] Waves assigned for parallel execution
- [ ] must_haves derived from phase goal
</quality_gate>
```

```
Task(
  prompt="First, read ~/.claude/agents/pan-planner.md for your role and instructions.\n\n" + filled_prompt,
  subagent_type="general-purpose",
  model="{planner_model}",
  description="Plan Phase {phase}"
)
```

## 9. Handle Planner Return

- **`## PLANNING COMPLETE`:** Display plan count. If `--skip-verify` or `plan_checker_enabled` is false (from init): skip to step 13. Otherwise: step 10.
- **`## CHECKPOINT REACHED`:** Present to user, get response, spawn continuation (step 12)
- **`## PLANNING INCONCLUSIVE`:** Show attempts, offer: Add context / Retry / Manual

## 10. Spawn pan-plan-checker Agent

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► VERIFYING PLANS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning plan checker...
```

Checker prompt:

```markdown
<verification_context>
**Phase:** {phase_number}
**Phase Goal:** {goal from ROADMAP}

<files_to_read>
- {PHASE_DIR}/*-plan.md (Plans to verify)
- {roadmap_path} (Roadmap)
- {requirements_path} (Requirements)
- {context_path} (USER DECISIONS from /pan:discuss-phase)
- {research_path} (Technical Research — includes Validation Architecture)
</files_to_read>

**Phase requirement IDs (MUST ALL be covered):** {phase_req_ids}

**Project instructions:** Read ./CLAUDE.md if exists — verify plans honor project guidelines
**Project skills:** Check .agents/skills/ directory (if exists) — verify plans account for project skill rules
</verification_context>

<expected_output>
- ## VERIFICATION PASSED — all checks pass
- ## ISSUES FOUND — structured issue list
</expected_output>
```

```
Task(
  prompt=checker_prompt,
  subagent_type="pan-plan-checker",
  model="{checker_model}",
  description="Verify Phase {phase} plans"
)
```

## 11. Handle Checker Return

- **`## VERIFICATION PASSED`:** Display confirmation, proceed to step 13.
  ```bash
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type decision --category plan_verified \
    --description "Plan-checker passed for phase ${PHASE_NUMBER}" \
    --agent pan-plan-checker --impact trivial 2>/dev/null || true
  ```
- **`## ISSUES FOUND`:** Display issues, check iteration count, proceed to step 12.
  ```bash
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
    --type error --category plan_checker_issues \
    --description "Plan-checker found issues in phase ${PHASE_NUMBER} plans" \
    --agent pan-plan-checker --impact minor 2>/dev/null || true
  ```

## 12. Revision Loop (Max 3 Iterations)

Track `iteration_count` (starts at 1 after initial plan + check).

**If iteration_count < 3:**

Display: `Sending back to planner for revision... (iteration {N}/3)`

Revision prompt:

```markdown
<revision_context>
**Phase:** {phase_number}
**Mode:** revision

<files_to_read>
- {PHASE_DIR}/*-plan.md (Existing plans)
- {context_path} (USER DECISIONS from /pan:discuss-phase)
</files_to_read>

**Checker issues:** {structured_issues_from_checker}
</revision_context>

<instructions>
Make targeted updates to address checker issues.
Do NOT replan from scratch unless issues are fundamental.
Return what changed.
</instructions>
```

```
Task(
  prompt="First, read ~/.claude/agents/pan-planner.md for your role and instructions.\n\n" + revision_prompt,
  subagent_type="general-purpose",
  model="{planner_model}",
  description="Revise Phase {phase} plans"
)
```

After planner returns -> spawn checker again (step 10), increment iteration_count.

**If iteration_count >= 3:**

Display: `Max iterations reached. {N} issues remain:` + issue list

Offer: 1) Force proceed, 2) Provide guidance and retry, 3) Abandon

## 13. Present Final Status

**Sync state.md first** — without this, state.md says "Ready to plan" until the
first plan's summary lands, and `/pan:progress`/`preflight` read a stale picture:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update "Status" "Ready to execute"
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update "Current Plan" "1"
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update "Total Plans in Phase" "${PLAN_COUNT}"
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update "Last Activity" "$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs current-timestamp date --raw)"
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update "Last Activity Description" "Phase ${PHASE_NUMBER} planned — ${PLAN_COUNT} plans created"
```

Route to `<offer_next>` OR `auto_advance` depending on flags/config.

**Circular optimization — log plan creation:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs optimize trace log \
  --type decision --category plans_created \
  --description "Plan-phase complete for phase ${PHASE_NUMBER}: ${PLAN_COUNT} plans created" \
  --agent pan-planner --impact minor 2>/dev/null || true
```

## 14. Auto-Advance Check

Check for auto-advance trigger:

1. Parse `--auto` flag from $ARGUMENTS
2. Read `workflow.auto_advance` from config:
   ```bash
   AUTO_CFG=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-get workflow.auto_advance 2>/dev/null || echo "false")
   ```

**If `--auto` flag present OR `AUTO_CFG` is true:**

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► AUTO-ADVANCING TO EXECUTE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Plans ready. Spawning execute-phase...
```

Spawn execute-phase as Task with direct workflow file reference (do NOT use Skill tool — Skills don't resolve inside Task subagents):
```
Task(
  prompt="
    <objective>
    You are the execute-phase orchestrator. Execute all plans for Phase ${PHASE}: ${PHASE_NAME}.
    </objective>

    <execution_context>
    @~/.claude/pan-wizard-core/workflows/exec-phase.md
    @~/.claude/pan-wizard-core/references/checkpoints.md
    @~/.claude/pan-wizard-core/references/tdd.md
    @~/.claude/pan-wizard-core/references/model-profile-resolution.md
    </execution_context>

    <arguments>
    PHASE=${PHASE}
    ARGUMENTS='${PHASE} --auto --no-transition'
    </arguments>

    <instructions>
    1. Read exec-phase.md from execution_context for your complete workflow
    2. Follow ALL steps: initialize, handle_branching, validate_phase, discover_and_group_plans, execute_waves, aggregate_results, close_parent_artifacts, verify_phase_goal, update_roadmap
    3. The --no-transition flag means: after verification + roadmap update, STOP and return status. Do NOT run transition.md.
    4. When spawning executor agents, use subagent_type='pan-executor' with the existing @file pattern from the workflow
    5. When spawning verifier agents, use subagent_type='pan-verifier'
    6. Preserve the classifyHandoffIfNeeded workaround (spot-check on that specific error)
    7. Do NOT use the Skill tool or /pan: commands
    </instructions>
  ",
  subagent_type="general-purpose",
  description="Execute Phase ${PHASE}"
)
```

**Handle execute-phase return:**
- **PHASE COMPLETE** → Display final summary:
  ```
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   PAN ► PHASE ${PHASE} COMPLETE ✓
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Auto-advance pipeline finished.

  Next: /pan:discuss-phase ${NEXT_PHASE} --auto
  ```
- **GAPS FOUND / VERIFICATION FAILED** → Display result, stop chain:
  ```
  Auto-advance stopped: Execution needs review.

  Review the output above and continue manually:
  /pan:exec-phase ${PHASE}
  ```

**If neither `--auto` nor config enabled:**
Route to `<offer_next>` (existing behavior).

</process>

<offer_next>
Output this markdown directly (not as a code block):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► PHASE {X} PLANNED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {X}: {Name}** — {N} plan(s) in {M} wave(s)

| Wave | Plans | What it builds |
|------|-------|----------------|
| 1    | 01, 02 | [objectives] |
| 2    | 03     | [objective]  |

Research: {Completed | Used existing | Skipped}
Verification: {Passed | Passed with override | Skipped}

───────────────────────────────────────────────────────────────

## ▶ Next Up

**Execute Phase {X}** — run all {N} plans

/pan:exec-phase {X}

<sub>/clear first → fresh context window</sub>

───────────────────────────────────────────────────────────────

**Also available:**
- cat .planning/phases/{phase-dir}/*-plan.md — review plans
- /pan:plan-phase {X} --research — re-research first

───────────────────────────────────────────────────────────────
</offer_next>

<success_criteria>
- [ ] .planning/ directory validated
- [ ] Phase validated against roadmap
- [ ] Phase directory created if needed
- [ ] context.md loaded early (step 4) and passed to ALL agents
- [ ] Research completed (unless --skip-research or --gaps or exists)
- [ ] pan-phase-researcher spawned with context.md
- [ ] Existing plans checked
- [ ] pan-planner spawned with context.md + research.md
- [ ] Plans created (PLANNING COMPLETE or CHECKPOINT handled)
- [ ] pan-plan-checker spawned with context.md
- [ ] Verification passed OR user override OR max iterations with user decision
- [ ] User sees status between agent spawns
- [ ] User knows next steps
</success_criteria>
