<required_reading>

**Read these files NOW:**

1. `.planning/state.md`
2. `.planning/project.md`
3. `.planning/roadmap.md`
4. Current phase's plan files (`*-plan.md`)
5. Current phase's summary files (`*-summary.md`)

</required_reading>

<purpose>

Mark current phase complete and advance to next. This is the natural point where progress tracking and project.md evolution happen.

"Planning next phase" = "current phase is done"

</purpose>

<state_write_policy>

**P-1604 (v3.7.5) — batch state.md writes.** This workflow contains 5 logically separate state.md updates: position, progress bar, Project Reference, Accumulated Context, Session Continuity. Earlier versions wrote each as its own edit + commit, which produced 5 commits per transition (visible as state-file thrash in trace logs).

**Required pattern from v3.7.5 onward:**

1. Run the steps below to *plan* each state.md update, but **do not write or commit** between them. Hold the changes in memory.
2. After `update_session_continuity_after_transition` (the last state.md-touching step before `offer_next_phase`), perform a **single Edit** that applies all four section updates (Project Reference, Accumulated Context, Session Continuity, plus the progress bar from `update_current_position_after_transition`).
3. Then issue **one** commit:
   ```bash
   node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs(transition): phase ${current_phase} → ${next_phase} (state, progress, context)"
   ```
   The `phase complete` call inside `update_roadmap_and_state` makes its own commit (roadmap + state position) — that one stays separate, since it must run first to compute `next_phase`.

Net result per transition: 2 commits instead of 5. Reduces git noise and keeps `/pan:learn` overhead metrics (commits_per_minute) honest. Substantive content of each step below is unchanged — only the **timing of the write** changes.

</state_write_policy>

<process>

<step name="load_project_state" priority="first">

Before transition, read project state:

```bash
cat .planning/state.md 2>/dev/null
cat .planning/project.md 2>/dev/null
```

Parse current position to verify we're transitioning the right phase.
Note accumulated context that may need updating after transition.

</step>

<step name="verify_completion">

Check current phase has all plan summaries:

```bash
ls .planning/phases/XX-current/*-plan.md 2>/dev/null | sort
ls .planning/phases/XX-current/*-summary.md 2>/dev/null | sort
```

**Verification logic:**

- Count PLAN files
- Count SUMMARY files
- If counts match: all plans complete
- If counts don't match: incomplete

<config-check>

```bash
cat .planning/config.json 2>/dev/null
```

</config-check>

**If all plans complete:**

<if mode="yolo">

```
⚡ Auto-approved: Transition Phase [X] → Phase [X+1]
Phase [X] complete — all [Y] plans finished.

Proceeding to mark done and advance...
```

Proceed directly to cleanup_handoff step.

</if>

<if mode="interactive" OR="custom with gates.confirm_transition true">

Ask: "Phase [X] complete — all [Y] plans finished. Ready to mark done and move to Phase [X+1]?"

Wait for confirmation before proceeding.

</if>

**If plans incomplete:**

**SAFETY RAIL: always_confirm_destructive applies here.**
Skipping incomplete plans is destructive — ALWAYS prompt regardless of mode.

Present:

```
Phase [X] has incomplete plans:
- {phase}-01-summary.md ✓ Complete
- {phase}-02-summary.md ✗ Missing
- {phase}-03-summary.md ✗ Missing

⚠️ Safety rail: Skipping plans requires confirmation (destructive action)

Options:
1. Continue current phase (execute remaining plans)
2. Mark complete anyway (skip remaining plans)
3. Review what's left
```

Wait for user decision.

</step>

<step name="cleanup_handoff">

Check for lingering handoffs:

```bash
ls .planning/phases/XX-current/.continue-here*.md 2>/dev/null
```

If found, delete them — phase is complete, handoffs are stale.

</step>

<step name="update_roadmap_and_state">

**Delegate roadmap.md and state.md updates to pan-tools:**

```bash
TRANSITION=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase complete "${current_phase}")
```

The CLI handles:
- Marking the phase checkbox as `[x]` complete with today's date
- Updating plan count to final (e.g., "3/3 plans complete")
- Updating the Progress table (Status → Complete, adding date)
- Advancing state.md to next phase (Current Phase, Status → Ready to plan, Current Plan → Not started)
- Detecting if this is the last phase in the milestone

Extract from result: `completed_phase`, `plans_executed`, `next_phase`, `next_phase_name`, `is_last_phase`.

</step>

<step name="archive_prompts">

If prompts were generated for the phase, they stay in place.
The `completed/` subfolder pattern from create-meta-prompts handles archival.

</step>

<step name="evolve_project">

Evolve project.md to reflect learnings from completed phase.

**Read phase summaries:**

```bash
cat .planning/phases/XX-current/*-summary.md
```

**Assess requirement changes:**

1. **Requirements validated?**
   - Any Active requirements shipped in this phase?
   - Move to Validated with phase reference: `- ✓ [Requirement] — Phase X`

2. **Requirements invalidated?**
   - Any Active requirements discovered to be unnecessary or wrong?
   - Move to Out of Scope with reason: `- [Requirement] — [why invalidated]`

3. **Requirements emerged?**
   - Any new requirements discovered during building?
   - Add to Active: `- [ ] [New requirement]`

4. **Decisions to log?**
   - Extract decisions from summary.md files
   - Add to Key Decisions table with outcome if known

5. **"What This Is" still accurate?**
   - If the product has meaningfully changed, update the description
   - Keep it current and accurate

**Update project.md:**

Make the edits inline. Update "Last updated" footer:

```markdown
---
*Last updated: [date] after Phase [X]*
```

**Example evolution:**

Before:

```markdown
### Active

- [ ] JWT authentication
- [ ] Real-time sync < 500ms
- [ ] Offline mode

### Out of Scope

- OAuth2 — complexity not needed for v1
```

After (Phase 2 shipped JWT auth, discovered rate limiting needed):

```markdown
### Validated

- ✓ JWT authentication — Phase 2

### Active

- [ ] Real-time sync < 500ms
- [ ] Offline mode
- [ ] Rate limiting on sync endpoint

### Out of Scope

- OAuth2 — complexity not needed for v1
```

**Step complete when:**

- [ ] Phase summaries reviewed for learnings
- [ ] Validated requirements moved from Active
- [ ] Invalidated requirements moved to Out of Scope with reason
- [ ] Emerged requirements added to Active
- [ ] New decisions logged with rationale
- [ ] "What This Is" updated if product changed
- [ ] "Last updated" footer reflects this transition

</step>

<step name="update_current_position_after_transition">

**Note:** Basic position updates (Current Phase, Status, Current Plan, Last Activity) were already handled by `pan-tools phase complete` in the update_roadmap_and_state step.

Verify the updates are correct by reading state.md. If the progress bar needs updating, use:

```bash
PROGRESS=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs progress bar --raw)
```

Update the progress bar line in state.md with the result.

**Step complete when:**

- [ ] Phase number incremented to next phase (done by phase complete)
- [ ] Plan status reset to "Not started" (done by phase complete)
- [ ] Status shows "Ready to plan" (done by phase complete)
- [ ] Progress bar reflects total completed plans

</step>

<step name="update_project_reference">

Update Project Reference section in state.md.

```markdown
## Project Reference

See: .planning/project.md (updated [today])

**Core value:** [Current core value from project.md]
**Current focus:** [Next phase name]
```

Update the date and current focus to reflect the transition.

</step>

<step name="review_accumulated_context">

Review and update Accumulated Context section in state.md.

**Decisions:**

- Note recent decisions from this phase (3-5 max)
- Full log lives in project.md Key Decisions table

**Blockers/Concerns:**

- Review blockers from completed phase
- If addressed in this phase: Remove from list
- If still relevant for future: Keep with "Phase X" prefix
- Add any new concerns from completed phase's summaries

**Example:**

Before:

```markdown
### Blockers/Concerns

- ⚠️ [Phase 1] Database schema not indexed for common queries
- ⚠️ [Phase 2] WebSocket reconnection behavior on flaky networks unknown
```

After (if database indexing was addressed in Phase 2):

```markdown
### Blockers/Concerns

- ⚠️ [Phase 2] WebSocket reconnection behavior on flaky networks unknown
```

**Step complete when:**

- [ ] Recent decisions noted (full log in project.md)
- [ ] Resolved blockers removed from list
- [ ] Unresolved blockers kept with phase prefix
- [ ] New concerns from completed phase added

</step>

<step name="update_session_continuity_after_transition">

Update Session Continuity section in state.md to reflect transition completion.

**P-1804 fix (v3.7.8):** the "Stopped at" line is mirrored into the frontmatter `stopped_at:` field by `syncStateFrontmatter()`. Direct `Edit` on the body alone leaves frontmatter and body out of sync — that's why the wookie run's frontmatter still showed `"Phase 1 plan 01-01 executed, awaiting verification"` after Phase 5 completed. **Use `pan-tools state update` for "Stopped at"** so the frontmatter resyncs automatically; the other two lines (Last session, Resume file) have no frontmatter mirror and can be edited directly.

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state update "Stopped at" "Phase ${current_phase} complete, ready to plan Phase ${next_phase}"
```

Then Edit state.md (still under the P-1604 batched-write policy — fold this Edit into the final batched Edit at the end of the workflow):

**Format:**

```markdown
Last session: [today]
Stopped at: Phase [X] complete, ready to plan Phase [X+1]
Resume file: None
```

**Step complete when:**

- [ ] Last session timestamp updated to current date and time
- [ ] Stopped at field updated **via `pan-tools state update`** (not raw Edit) so the frontmatter `stopped_at` field stays in sync
- [ ] Resume file confirmed as None (transitions don't use resume files)

</step>

<step name="offer_next_phase">

**MANDATORY: Verify milestone status before presenting next steps.**

**Use the transition result from `pan-tools phase complete`:**

The `is_last_phase` field from the phase complete result tells you directly:
- `is_last_phase: false` → More phases remain → Go to **Route A**
- `is_last_phase: true` → Milestone complete → Go to **Route B**

The `next_phase` and `next_phase_name` fields give you the next phase details.

If you need additional context, use:
```bash
ROADMAP=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap analyze)
```

This returns all phases with goals, disk status, and completion info.

---

**Route A: More phases remain in milestone**

Read roadmap.md to get the next phase's name and goal.

**Check if next phase has context.md:**

```bash
ls .planning/phases/*[X+1]*/*-context.md 2>/dev/null
```

**If next phase exists:**

<if mode="yolo">

**P-1801 fix (v3.7.6):** In auto mode, **spawn the next phase as a Task subagent** — same pattern as `plan-phase.md`'s auto-advance to exec-phase. Prose-based "DO NOT exit. Read X" instructions (the v3.7.4 P-1701 attempt) were not behaviorally binding: the orchestrator returned from sub-agent calls and exited cleanly at the phase boundary. A `Task(...)` invocation is a tool call the orchestrator cannot ignore — control flow is forced into the next phase's workflow.

Cost trade-off: each Task spawn restarts context (loses the cumulative cache reads from the previous phase). Acceptable because: (1) cross-phase cache value is low — phase N's plan/research is mostly irrelevant to phase N+1's executor — and (2) reliability beats marginal cost optimization for autonomous runs.

**If context.md exists for the next phase:**

Display:
```
Phase [X] marked complete.

Next: Phase [X+1] — [Name]

⚡ Auto-spawning Phase [X+1] planning...
```

Then spawn the next phase as a Task subagent — do NOT call SlashCommand or attempt in-context continuation:

```
Task(
  prompt="
    <objective>
    You are the plan-phase orchestrator. Plan all work for Phase ${NEXT_PHASE}: ${NEXT_PHASE_NAME}.
    </objective>

    <execution_context>
    @~/.claude/pan-wizard-core/workflows/plan-phase.md
    @~/.claude/pan-wizard-core/references/guardrails.md
    @~/.claude/pan-wizard-core/references/model-profile-resolution.md
    </execution_context>

    <arguments>
    PHASE=${NEXT_PHASE}
    ARGUMENTS='${NEXT_PHASE} --auto'
    </arguments>

    <instructions>
    1. Read plan-phase.md from execution_context for your complete workflow.
    2. Follow ALL steps: initialize, validate_phase, load context.md, handle research (P-1401 bypass if applicable), spawn pan-planner, optionally spawn pan-plan-checker, then auto-advance to exec-phase via Task (per plan-phase.md step 14).
    3. After exec-phase completes and verification passes, exec-phase will return to its own auto-advance handler which spawns transition.md — that transition will spawn Phase ${NEXT_PHASE}+1 via this same pattern, recursing until milestone-done.
    4. Do NOT use the Skill tool or /pan: commands. Do NOT exit early — let the recursion run.
    </instructions>
  ",
  subagent_type="general-purpose",
  description="Plan Phase ${NEXT_PHASE}"
)
```

**If context.md does NOT exist for the next phase:**

Display:
```
Phase [X] marked complete.

Next: Phase [X+1] — [Name]

⚡ Auto-spawning Phase [X+1] discussion (no context.md)...
```

Then spawn discuss-phase as a Task subagent:

```
Task(
  prompt="
    <objective>
    You are the discuss-phase orchestrator. Capture decisions for Phase ${NEXT_PHASE}: ${NEXT_PHASE_NAME}, then auto-advance to plan-phase.
    </objective>

    <execution_context>
    @~/.claude/pan-wizard-core/workflows/discuss-phase.md
    @~/.claude/pan-wizard-core/references/questioning.md
    </execution_context>

    <arguments>
    PHASE=${NEXT_PHASE}
    ARGUMENTS='${NEXT_PHASE} --auto'
    </arguments>

    <instructions>
    1. Read discuss-phase.md from execution_context for your complete workflow.
    2. In --auto mode, use sensible defaults rather than blocking on AskUserQuestion (P-1301 pattern).
    3. After context.md is captured, auto-advance to plan-phase via Task spawn (the discuss-phase auto-advance step handles this).
    4. Do NOT use the Skill tool or /pan: commands. Do NOT exit early.
    </instructions>
  ",
  subagent_type="general-purpose",
  description="Discuss Phase ${NEXT_PHASE}"
)
```

**Handle next-phase Task return:**
- **PHASE COMPLETE** (the spawned chain reached verification + roadmap update for ${NEXT_PHASE} and beyond, and either hit milestone-done or recursed further) → Done. Workflow chain finished.
- **GAPS FOUND / FAILED / TIMEOUT** → Display the failure, stop the recursion, return status to user. Do NOT attempt to skip ahead.

</if>

<if mode="interactive" OR="custom with gates.confirm_transition true">

**If context.md does NOT exist:**

```
## ✓ Phase [X] Complete

---

## ▶ Next Up

**Phase [X+1]: [Name]** — [Goal from roadmap.md]

`/pan:discuss-phase [X+1]` — gather context and clarify approach

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- `/pan:plan-phase [X+1]` — skip discussion, plan directly
- `/pan:research-phase [X+1]` — investigate unknowns

---
```

**If context.md exists:**

```
## ✓ Phase [X] Complete

---

## ▶ Next Up

**Phase [X+1]: [Name]** — [Goal from roadmap.md]
<sub>✓ Context gathered, ready to plan</sub>

`/pan:plan-phase [X+1]`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- `/pan:discuss-phase [X+1]` — revisit context
- `/pan:research-phase [X+1]` — investigate unknowns

---
```

</if>

---

**Route B: Milestone complete (all phases done)**

**Clear auto-advance** — milestone boundary is the natural stopping point:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-set workflow.auto_advance false
```

<if mode="yolo">

```
Phase {X} marked complete.

🎉 Milestone {version} is 100% complete — all {N} phases finished!

⚡ Auto-continuing: Complete milestone and archive
```

Exit skill and invoke SlashCommand("/pan:milestone-done {version}")

</if>

<if mode="interactive" OR="custom with gates.confirm_transition true">

```
## ✓ Phase {X}: {Phase Name} Complete

🎉 Milestone {version} is 100% complete — all {N} phases finished!

---

## ▶ Next Up

**Complete Milestone {version}** — archive and prepare for next

`/pan:milestone-done {version}`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- Review accomplishments before archiving

---
```

</if>

</step>

</process>

<implicit_tracking>
Progress tracking is IMPLICIT: planning phase N implies phases 1-(N-1) complete. No separate progress step—forward motion IS progress.
</implicit_tracking>

<partial_completion>

If user wants to move on but phase isn't fully complete:

```
Phase [X] has incomplete plans:
- {phase}-02-plan.md (not executed)
- {phase}-03-plan.md (not executed)

Options:
1. Mark complete anyway (plans weren't needed)
2. Defer work to later phase
3. Stay and finish current phase
```

Respect user judgment — they know if work matters.

**If marking complete with incomplete plans:**

- Update ROADMAP: "2/3 plans complete" (not "3/3")
- Note in transition message which plans were skipped

</partial_completion>

<success_criteria>

Transition is complete when:

- [ ] Current phase plan summaries verified (all exist or user chose to skip)
- [ ] Any stale handoffs deleted
- [ ] roadmap.md updated with completion status and plan count
- [ ] project.md evolved (requirements, decisions, description if needed)
- [ ] state.md updated (position, project reference, context, session)
- [ ] Progress table updated
- [ ] User knows next steps

</success_criteria>
