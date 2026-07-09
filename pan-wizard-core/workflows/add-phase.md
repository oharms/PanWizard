<purpose>
Add a new integer phase to the end of the current milestone in the roadmap. Automatically calculates next phase number, creates phase directory, and updates roadmap structure.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_arguments">
Parse the command arguments:
- All arguments become the phase description
- Example: `/pan:add-phase Add authentication` → description = "Add authentication"
- Example: `/pan:add-phase Fix critical performance issues` → description = "Fix critical performance issues"

If no arguments provided:

```
ERROR: Phase description required
Usage: /pan:add-phase <description>
Example: /pan:add-phase Add authentication system
```

Exit.
</step>

<step name="init_context">
Load phase operation context:

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init phase-op "0")
```

Check `roadmap_exists` from init JSON. If false:
```
ERROR: No roadmap found (.planning/roadmap.md)
Run /pan:new-project to initialize.
```
Exit.
</step>

<step name="add_phase">
**Delegate the phase addition to pan-tools:**

```bash
RESULT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase add "${description}")
```

The CLI handles:
- Finding the highest existing integer phase number
- Calculating next phase number (max + 1)
- Generating slug from description
- Creating the phase directory (`.planning/phases/{NN}-{slug}/`)
- Inserting the phase entry into roadmap.md with Goal, Depends on, and Plans sections

Extract from result: `phase_number`, `padded`, `name`, `slug`, `directory`.
</step>

<step name="update_project_state">
Update state.md to reflect the new phase:

1. Read `.planning/state.md`
2. Under "## Accumulated Context" → "### Roadmap Evolution" add entry:
   ```
   - Phase {N} added: {description}
   ```

If "Roadmap Evolution" section doesn't exist, create it.
</step>

<step name="completion">
Present completion summary:

```
Phase {N} added to current milestone:
- Description: {description}
- Directory: .planning/phases/{phase-num}-{slug}/
- Status: Not planned yet

Roadmap updated: .planning/roadmap.md

---

## ▶ Next Up

**Phase {N}: {description}**

`/pan:plan-phase {N}`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- `/pan:add-phase <description>` — add another phase
- Review roadmap

---
```
</step>

</process>

<success_criteria>
- [ ] `pan-tools phase add` executed successfully
- [ ] Phase directory created
- [ ] Roadmap updated with new phase entry
- [ ] state.md updated with roadmap evolution note
- [ ] User informed of next steps
</success_criteria>
