<objective>
Answer the open questions that block planning a phase (at most 5). Spawns one pan-phase-researcher agent with the questions and the phase context.

**Note:** This is the standalone research mode. `/pan:plan-phase` researches only with `--research` or `workflow.research: true`.

**Use this command when:**
- You want to research without planning yet
- You want to re-research after planning is complete
- You need to investigate before deciding if a phase is feasible

**Orchestrator role:** Parse phase, validate against roadmap, check existing research, gather context, spawn researcher agent, present results.

**Why subagent:** Searching burns context. A fresh context window answers the questions, at most 4 searches or fetches each; the main context stays lean for user interaction.
</objective>

<context>
Phase number: $ARGUMENTS (required)

Normalize phase input in step 1 before any directory lookups.
</context>

<process>

## 0. Initialize Context

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init phase-op "$ARGUMENTS")
```

Extract from init JSON: `phase_dir`, `padded_phase`, `phase_slug`, `phase_number`, `phase_name`, `phase_found`, `commit_docs`, `has_research`, `state_path`, `requirements_path`, `context_path`, `research_path`. `phase_dir` is null when the phase is in the roadmap but has no directory yet: create it (`mkdir -p ".planning/phases/${padded_phase}-${phase_slug}"`) and use that path as `phase_dir`, as discuss-phase does.

Resolve researcher model:
```bash
RESEARCHER_MODEL=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs resolve-model pan-phase-researcher --raw)
```

## 1. Validate Phase

```bash
PHASE_INFO=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${phase_number}")
```

**If `found` is false:** Error and exit. **If `found` is true:** Extract `phase_number`, `phase_name`, `goal` from JSON.

## 2. Check Existing Research

Use `has_research` and `research_path` from INIT.

**If exists:** Offer: 1) Update research, 2) View existing (`research_path`), 3) Skip. Wait for response.

**If doesn't exist:** Continue.

## 3. Gather Phase Context

Write this phase's roadmap slice (its section, its dependencies' goals and its requirement lines), then use paths from INIT (do not inline file contents in orchestrator context):
```bash
SLICE_PATH=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap slice "${phase_number}" --write --raw)
```
- `slice_path` (from the command above; `requirements_path` if it is empty)
- `context_path`
- `state_path`

Present summary with phase description and what files the researcher will load.

## 4. Write the Questions and Spawn pan-phase-researcher

Research answers questions; it does not survey the phase's domain. List at most **5** open questions the phase's requirements leave unanswered and that block building (a technology choice, an external API's behaviour, a data format, a limit or rule), as a numbered list in `{phase_dir}/{padded_phase}-research-questions.md`:

```markdown
# Phase {phase_number} research questions

1. [question] — blocks: [the task or decision it settles]
```

**No questions → no research.** If nothing blocks building, write no file, say `No open questions block Phase {phase_number} — research skipped`, and stop.

```markdown
<objective>
Answer the research questions for Phase {phase_number}: {phase_name}, and nothing else.
</objective>

<files_to_read>
- {phase_dir}/{padded_phase}-research-questions.md (The questions)
- {slice_path} (This phase's roadmap and requirements)
- {context_path} (Phase context from discuss-phase, if exists)
</files_to_read>

<output>
Write to: {phase_dir}/{padded_phase}-research.md
One row per question: | # | Question | Answer | Source | Confidence | Decision it settles |, or `unknown — assume: …`. At most 4 searches or fetches per question. Anything that suggests new scope goes under ## Ideas (v2 candidates).
</output>
```

```
Task(
  prompt=filled_prompt,
  subagent_type="pan-phase-researcher",
  model="{researcher_model}",
  description="Research Phase {phase}"
)
```

Then check the answers:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs research check "{phase_dir}/{padded_phase}-research-questions.md" "{phase_dir}/{padded_phase}-research.md"
```

Exit 1: send its `errors` to the researcher once as a revision. One revision at most; then proceed, with each question still unsourced recorded under `## Unknowns` in the research file with the assumption the plan uses.

## 5. Handle Agent Return

**`## RESEARCH COMPLETE`:** Display the decisions it settled and any unknowns, offer: Plan phase, Review full, Done.

**`## RESEARCH BLOCKED`:** Show the blocker and what was attempted, offer: Provide context (then spawn a continuation, step 6), Skip research, Abort.

## 6. Spawn Continuation Agent

```markdown
<objective>
Continue research for Phase {phase_number}: {phase_name}
</objective>

<prior_state>
<files_to_read>
- {phase_dir}/{padded_phase}-research.md (Existing research)
</files_to_read>
</prior_state>

<checkpoint_response>
**Type:** {checkpoint_type}
**Response:** {user_response}
</checkpoint_response>
```

```
Task(
  prompt=continuation_prompt,
  subagent_type="pan-phase-researcher",
  model="{researcher_model}",
  description="Continue research Phase {phase}"
)
```

</process>

<success_criteria>
- [ ] Phase validated against roadmap
- [ ] Existing research checked
- [ ] At most 5 questions written (none: no research)
- [ ] One pan-phase-researcher spawned with the questions
- [ ] `research check` run, one revision at most
- [ ] Checkpoints handled correctly
- [ ] User knows next steps
</success_criteria>
