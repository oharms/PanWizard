<purpose>

Start a new milestone cycle for an existing project. Loads project context, gathers milestone goals (from MILESTONE-context.md or conversation), updates project.md and state.md, optionally runs parallel research, defines scoped requirements with REQ-IDs, spawns the roadmapper to create phased execution plan, and commits all artifacts. Brownfield equivalent of new-project.

</purpose>

<required_reading>

Read all files referenced by the invoking prompt's execution_context before starting.

</required_reading>

<process>

## 1. Load Context

- Read project.md (existing project, validated requirements, decisions)
- Read milestones.md (what shipped previously)
- Read state.md (pending todos, blockers)
- Check for MILESTONE-context.md (optional pre-seeded context, if the user prepared one)

## 2. Gather Milestone Goals

**If MILESTONE-context.md exists:**
- Use features and scope from MILESTONE-context.md
- Present summary for confirmation

**If no context file:**
- Present what shipped in last milestone
- Ask: "What do you want to build next?"
- Use AskUserQuestion to explore features, priorities, constraints, scope

## 3. Determine Milestone Version

- Parse last version from milestones.md
- Suggest next version (v1.0 → v1.1, or v2.0 for major)
- Confirm with user

## 4. Update project.md

Add/update:

```markdown
## Current Milestone: v[X.Y] [Name]

**Goal:** [One sentence describing milestone focus]

**Target features:**
- [Feature 1]
- [Feature 2]
- [Feature 3]
```

Update Active requirements section and "Last updated" footer.

## 5. Update state.md

Reset the position for the new milestone through the engine, keeping the Accumulated Context of the last one:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs state init --core-value "<core value from project.md>" --focus "Milestone v[X.Y] [Name]" --phase "Not started" --phase-name "Defining requirements" --status "Defining requirements" --activity "Milestone v[X.Y] started" --force --keep-context
```

The old state.md is backed up first. The engine writes every section of the template and keeps the frontmatter in sync; never write state.md with the Write or Edit tool (under `hooks.guard: enforce` the guard denies it).

## 6. Cleanup and Commit

Delete MILESTONE-context.md if exists (consumed). If git tracks it, add its path to `--files` so the deletion is committed (`--force` confirms it; a tracked deletion blocks the commit otherwise):

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: start milestone v[X.Y] [Name]" --files .planning/project.md .planning/state.md [path of the deleted MILESTONE-context.md, if git tracked it] --force
```

## 7. Load Context and Resolve Models

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init new-milestone)
```

Extract from init JSON: `researcher_model`, `roadmapper_model`, `commit_docs`, `research_enabled`, `current_milestone`, `project_exists`, `roadmap_exists`.

## 8. Research Decision

Research is **off by default** and answers questions; it never surveys a domain or adds scope (the same contract as `/pan:new-project` step 6).

AskUserQuestion: "Research open questions for the new features before defining requirements?"
- "Skip research (Recommended)" — Go straight to requirements
- "Research open questions" — Answer up to 5 questions that block building the new features, each with a source

`/pan:plan-phase` keeps its own setting (`workflow.research`, off by default; `/pan:settings` changes it).

**If "Research open questions":**

List at most **5** open questions the milestone's goals leave unanswered and that block building the NEW features (a technology choice, an external API's behaviour, a data format, a limit or rule; never what already exists). Write them as a numbered list to `.planning/research/questions.md` (`mkdir -p .planning/research` first):

```markdown
# Research questions — milestone v[X.Y]

1. [question] — blocks: [the decision it settles]
```

**No questions → no research.** If nothing blocks building, write no file, say so, and continue to Step 9.

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► RESEARCHING {N} QUESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```
Task(prompt="
<files_to_read>
- .planning/research/questions.md (The questions: answer these and nothing else)
- .planning/project.md (Project context; what exists is not a question)
</files_to_read>

<output>
Write to: .planning/research/research-summary.md
One row per question: | # | Question | Answer | Source | Confidence | Decision it settles |, or `unknown — assume: …`. At most 4 searches or fetches per question. Anything that suggests new scope goes under ## Ideas (v2 candidates). Do not commit.
</output>
", subagent_type="pan-project-researcher", model="{researcher_model}", description="Answer research questions")
```

Check the answers:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs research check .planning/research/questions.md .planning/research/research-summary.md
```

Exit 1: send its `errors` to the researcher once as a revision. One revision at most; then proceed, with each question still unsourced recorded under `## Unknowns` in research-summary.md with the assumption you will use. Commit:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: answer milestone research questions" --files .planning/research/questions.md .planning/research/research-summary.md
```

Display the decisions settled, the unknowns with their assumptions, and the number of ideas (offered in Step 9 as future candidates, never added to this milestone by themselves).

**If "Skip research":** Continue to Step 9.

## 9. Define Requirements

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► DEFINING REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Read project.md: core value, current milestone goals, validated requirements (what exists).

**If research exists:** Read `.planning/research/research-summary.md`. Its answers settle decisions the requirements use; its `## Ideas (v2 candidates)` are offered as future candidates the user may promote, never added to this milestone by themselves.

Gather requirements through conversation. Ask: "What are the main things users need to do with [new features]?" Clarify, probe for related capabilities, group into categories.

**Scope each category** via AskUserQuestion (multiSelect: true, header max 12 chars):
- "[Feature 1]" — [brief description]
- "[Feature 2]" — [brief description]
- "None for this milestone" — Defer entire category

Track: Selected → this milestone. Unselected → future or out of scope (ask which when unclear).

**Identify gaps** via AskUserQuestion:
- "No, that covers it" — Proceed
- "Yes, let me add some" — Capture additions

**Generate requirements.md:**
- v1 Requirements grouped by category (checkboxes, REQ-IDs)
- Future Requirements (deferred)
- Out of Scope (explicit exclusions with reasoning)
- Traceability section (empty, filled by roadmap)

**REQ-ID format:** `[CATEGORY]-[NUMBER]` (AUTH-01, NOTIF-02). Continue numbering from existing.

**Requirement quality criteria:**

Good requirements are:
- **Specific and testable:** "User can reset password via email link" (not "Handle password reset")
- **User-centric:** "User can X" (not "System does Y")
- **Atomic:** One capability per requirement (not "User can login and manage profile")
- **Independent:** Minimal dependencies on other requirements

Present FULL requirements list for confirmation:

```
## Milestone v[X.Y] Requirements

### [Category 1]
- [ ] **CAT1-01**: User can do X
- [ ] **CAT1-02**: User can do Y

### [Category 2]
- [ ] **CAT2-01**: User can do Z

Does this capture what you're building? (yes / adjust)
```

If "adjust": Return to scoping.

**Commit requirements:**
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: define milestone v[X.Y] requirements" --files .planning/requirements.md
```

## 10. Create Roadmap

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► CREATING ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning roadmapper...
```

**Starting phase number:** Read milestones.md for last phase number. Continue from there (v1.0 ended at phase 5 → v1.1 starts at phase 6).

```
Task(prompt="
<planning_context>
<files_to_read>
- .planning/project.md
- .planning/requirements.md
- .planning/research/research-summary.md (if exists; older projects: .planning/research/summary.md)
- .planning/config.json
- .planning/milestones.md
</files_to_read>
</planning_context>

<instructions>
Create roadmap for milestone v[X.Y]:
1. Start phase numbering from [N]
2. Derive phases from THIS MILESTONE's requirements only
3. Map every requirement to exactly one phase
4. Derive 2-5 success criteria per phase (observable user behaviors)
5. Validate 100% coverage
6. Write roadmap.md immediately; initialise state.md with `pan-tools state init ... --force --keep-context` (it exists from step 5), never the Write tool; update requirements.md traceability
7. Return ROADMAP CREATED with summary

Write files first, then return.
</instructions>
", subagent_type="pan-roadmapper", model="{roadmapper_model}", description="Create roadmap")
```

**Handle return:**

**If `## ROADMAP BLOCKED`:** Present blocker, work with user, re-spawn.

**If `## ROADMAP CREATED`:** Read roadmap.md, present inline:

```
## Proposed Roadmap

**[N] phases** | **[X] requirements mapped** | All covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| [N] | [Name] | [Goal] | [REQ-IDs] | [count] |

### Phase Details

**Phase [N]: [Name]**
Goal: [goal]
Requirements: [REQ-IDs]
Success criteria:
1. [criterion]
2. [criterion]
```

**Ask for approval** via AskUserQuestion:
- "Approve" — Commit and continue
- "Adjust phases" — Tell me what to change
- "Review full file" — Show raw roadmap.md

**If "Adjust":** Get notes, re-spawn roadmapper with revision context, loop until approved.
**If "Review":** Display raw roadmap.md, re-ask.

**Commit roadmap** (after approval):
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: create milestone v[X.Y] roadmap ([N] phases)" --files .planning/roadmap.md .planning/state.md .planning/requirements.md
```

## 11. Done

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► MILESTONE INITIALIZED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Milestone v[X.Y]: [Name]**

| Artifact       | Location                    |
|----------------|-----------------------------|
| Project        | `.planning/project.md`      |
| Research       | `.planning/research/`       |
| Requirements   | `.planning/requirements.md` |
| Roadmap        | `.planning/roadmap.md`      |

**[N] phases** | **[X] requirements** | Ready to build ✓

## ▶ Next Up

**Phase [N]: [Phase Name]** — [Goal]

`/pan:discuss-phase [N]` — gather context and clarify approach

<sub>`/clear` first → fresh context window</sub>

Also: `/pan:plan-phase [N]` — skip discussion, plan directly
```

</process>

<success_criteria>
- [ ] project.md updated with Current Milestone section
- [ ] state.md reset for new milestone
- [ ] MILESTONE-context.md consumed and deleted (if existed)
- [ ] Research completed (if selected) — 4 parallel agents, milestone-aware
- [ ] Requirements gathered and scoped per category
- [ ] requirements.md created with REQ-IDs
- [ ] pan-roadmapper spawned with phase numbering context
- [ ] Roadmap files written immediately (not draft)
- [ ] User feedback incorporated (if any)
- [ ] roadmap.md phases continue from previous milestone
- [ ] All commits made (if planning docs committed)
- [ ] User knows next step: `/pan:discuss-phase [N]`

**Atomic commits:** Each phase commits its artifacts immediately.
</success_criteria>
