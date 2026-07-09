<purpose>
Remove an unstarted future phase from the project roadmap, delete its directory, renumber all subsequent phases to maintain a clean linear sequence, and commit the change. The git commit serves as the historical record of removal.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_arguments">
Parse the command arguments:
- Argument is the phase number to remove (integer or decimal)
- Example: `/pan:remove-phase 17` → phase = 17
- Example: `/pan:remove-phase 16.1` → phase = 16.1

If no argument provided:

```
ERROR: Phase number required
Usage: /pan:remove-phase <phase-number>
Example: /pan:remove-phase 17
```

Exit.
</step>

<step name="init_context">
Load phase operation context:

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init phase-op "${target}")
```

Extract: `phase_found`, `phase_dir`, `phase_number`, `commit_docs`, `roadmap_exists`.

Also read state.md and roadmap.md content for parsing current position.
</step>

<step name="validate_future_phase">
Verify the phase is a future phase (not started):

1. Compare target phase to current phase from state.md
2. Target must be > current phase number

If target <= current phase:

```
ERROR: Cannot remove Phase {target}

Only future phases can be removed:
- Current phase: {current}
- Phase {target} is current or completed

To abandon current work, use /pan:pause instead.
```

Exit.
</step>

<step name="confirm_removal">
Present removal summary and confirm:

```
Removing Phase {target}: {Name}

This will:
- Delete: .planning/phases/{target}-{slug}/
- Renumber all subsequent phases
- Update: roadmap.md, state.md

Proceed? (y/n)
```

Wait for confirmation.
</step>

<step name="execute_removal">
**Delegate the entire removal operation to pan-tools:**

```bash
RESULT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase remove "${target}")
```

If the phase has executed plans (summary.md files), pan-tools will error. Use `--force` only if the user confirms:

```bash
RESULT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs phase remove "${target}" --force)
```

The CLI handles:
- Deleting the phase directory
- Renumbering all subsequent directories (in reverse order to avoid conflicts)
- Renaming all files inside renumbered directories (plan.md, summary.md, etc.)
- Updating roadmap.md (removing section, renumbering all phase references, updating dependencies)
- Updating state.md (decrementing phase count)

Extract from result: `removed`, `directory_deleted`, `renamed_directories`, `renamed_files`, `roadmap_updated`, `state_updated`.
</step>

<step name="commit">
Stage and commit the removal:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "chore: remove phase {target} ({original-phase-name})" --files .planning/
```

The commit message preserves the historical record of what was removed.
</step>

<step name="completion">
Present completion summary:

```
Phase {target} ({original-name}) removed.

Changes:
- Deleted: .planning/phases/{target}-{slug}/
- Renumbered: {N} directories and {M} files
- Updated: roadmap.md, state.md
- Committed: chore: remove phase {target} ({original-name})

---

## What's Next

Would you like to:
- `/pan:progress` — see updated roadmap status
- Continue with current phase
- Review roadmap

---
```
</step>

</process>

<anti_patterns>

- Don't remove completed phases (have summary.md files) without --force
- Don't remove current or past phases
- Don't manually renumber — use `pan-tools phase remove` which handles all renumbering
- Don't add "removed phase" notes to state.md — git commit is the record
- Don't modify completed phase directories
</anti_patterns>

<success_criteria>
Phase removal is complete when:

- [ ] Target phase validated as future/unstarted
- [ ] `pan-tools phase remove` executed successfully
- [ ] Changes committed with descriptive message
- [ ] User informed of changes
</success_criteria>
