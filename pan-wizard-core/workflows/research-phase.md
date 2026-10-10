<purpose>
Research how to implement a phase. Spawns pan-phase-researcher with phase context.

Standalone research command. For most workflows, use `/pan:plan-phase` which integrates research automatically.
</purpose>

<process>

## Step 0: Resolve Model Profile

@~/.claude/pan-wizard-core/references/model-profile-resolution.md

Resolve model for:
- `pan-phase-researcher`

## Step 1: Normalize and Validate Phase

@~/.claude/pan-wizard-core/references/phase-argument-parsing.md

```bash
PHASE_INFO=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap get-phase "${PHASE}")
```

If `found` is false: Error and exit.

## Step 2: Check Existing Research

```bash
ls .planning/phases/*/*-research.md 2>/dev/null | grep -E "/0*${PHASE}-[^/]*/"
```

If exists: Offer update/view/skip options.

## Step 3: Gather Phase Context

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init phase-op "${PHASE}")
# Extract: phase_dir, padded_phase, phase_slug, phase_number, state_path, requirements_path, context_path
# phase_dir is null when the phase has no directory yet: create it (scaffold pads the number and honours the planning root) and use the printed path as phase_dir
case "{phase_dir}" in ""|null) node ~/.claude/pan-wizard-core/bin/pan-tools.cjs scaffold phase-dir --phase "${PHASE}" --name "{phase_name}" --raw ;; esac

# This phase's roadmap and requirements, written into the phase directory
SLICE_PATH=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs roadmap slice "${PHASE}" --write --raw)
```

## Step 4: Spawn Researcher

```
Task(
  prompt="<objective>
Research implementation approach for Phase {phase}: {name}
</objective>

<files_to_read>
- {context_path} (USER DECISIONS from /pan:discuss-phase)
- {slice_path} (This phase's roadmap and requirements; if SLICE_PATH is empty, {requirements_path} instead)
- {state_path} (Project decisions and history)
</files_to_read>

<additional_context>
Phase description: {description}
</additional_context>

<output>
Write to: {phase_dir}/{padded_phase}-research.md
</output>",
  subagent_type="pan-phase-researcher",
  model="{researcher_model}"
)
```

## Step 5: Handle Return

- `## RESEARCH COMPLETE` — Display summary, offer: Plan/Dig deeper/Review/Done
- `## RESEARCH BLOCKED` — Display the blocker, offer: Provide context / Skip research / Abort

</process>
