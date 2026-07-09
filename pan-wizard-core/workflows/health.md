<purpose>
Validate `.planning/` directory integrity and report actionable issues. Checks for missing files, invalid configurations, inconsistent state, and orphaned plans. Optionally repairs auto-fixable issues.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="parse_args">
**Parse arguments:**

Check if `--repair` flag is present in the command arguments.

```
REPAIR_FLAG=""
if arguments contain "--repair"; then
  REPAIR_FLAG="--repair"
fi
```
</step>

<step name="run_health_check">
**Run health validation:**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs validate health $REPAIR_FLAG
```

Parse JSON output:
- `status`: "healthy" | "degraded" | "broken"
- `errors[]`: Critical issues (code, message, fix, repairable)
- `warnings[]`: Non-critical issues
- `info[]`: Informational notes
- `repairable_count`: Number of auto-fixable issues
- `repairs_performed[]`: Actions taken if --repair was used
</step>

<step name="run_doc_lint">
**Run frontmatter doc-lint (v3.7.1+):**

Lints the project's markdown files (commands, agents, workflows) against
the PAN command schema. Catches frontmatter drift at author time —
missing `name`, wrong types, malformed YAML — before they cause runtime
issues during install or dispatch.

```bash
# Lint commands/pan/ if it exists in the host project (PAN-source dogfood)
if [ -d commands/pan ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs doc-lint commands/pan --raw 2>&1
fi
```

A clean run prints `Linted N file(s): 0 error(s), 0 warning(s)`. Any errors
get folded into the health report's `warnings[]` section as
`code: doc-lint-frontmatter` entries — they're non-blocking but actionable.

Skip silently if `commands/pan/` doesn't exist (most user projects).
Pattern source: P-201 + P-202 + P-301 (whooo experiment, ADR-0026).
</step>

<step name="format_output">
**Format and display results:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN Health Check
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Status: HEALTHY | DEGRADED | BROKEN
Errors: N | Warnings: N | Info: N
```

**If repairs were performed:**
```
## Repairs Performed

- ✓ config.json: Created with defaults
- ✓ state.md: Regenerated from roadmap
```

**If errors exist:**
```
## Errors

- [E001] config.json: JSON parse error at line 5
  Fix: Run /pan:health --repair to reset to defaults

- [E002] project.md not found
  Fix: Run /pan:new-project to create
```

**If warnings exist:**
```
## Warnings

- [W001] state.md references phase 5, but only phases 1-3 exist
  Fix: Run /pan:health --repair to regenerate

- [W005] Phase directory "1-setup" doesn't follow NN-name format
  Fix: Rename to match pattern (e.g., 01-setup)
```

**If info exists:**
```
## Info

- [I001] 02-implementation/02-01-plan.md has no summary.md
  Note: May be in progress
```

**Footer (if repairable issues exist and --repair was NOT used):**
```
---
N issues can be auto-repaired. Run: /pan:health --repair
```
</step>

<step name="offer_repair">
**If repairable issues exist and --repair was NOT used:**

Ask user if they want to run repairs:

```
Would you like to run /pan:health --repair to fix N issues automatically?
```

If yes, re-run with --repair flag and display results.
</step>

<step name="verify_repairs">
**If repairs were performed:**

Re-run health check without --repair to confirm issues are resolved:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs validate health
```

Report final status.
</step>

</process>

<error_codes>

| Code | Severity | Description | Repairable |
|------|----------|-------------|------------|
| E001 | error | .planning/ directory not found | No |
| E002 | error | project.md not found | No |
| E003 | error | roadmap.md not found | No |
| E004 | error | state.md not found | Yes |
| E005 | error | config.json parse error | Yes |
| W001 | warning | project.md missing required section | No |
| W002 | warning | state.md references invalid phase | Yes |
| W003 | warning | config.json not found | Yes |
| W004 | warning | config.json invalid field value | No |
| W005 | warning | Phase directory naming mismatch | No |
| W006 | warning | Phase in ROADMAP but no directory | No |
| W007 | warning | Phase on disk but not in ROADMAP | No |
| I001 | info | Plan without SUMMARY (may be in progress) | No |

</error_codes>

<repair_actions>

| Action | Effect | Risk |
|--------|--------|------|
| createConfig | Create config.json with defaults | None |
| resetConfig | Delete + recreate config.json | Loses custom settings |
| regenerateState | Create state.md from ROADMAP structure | Loses session history |

**Not repairable (too risky):**
- project.md, roadmap.md content
- Phase directory renaming
- Orphaned plan cleanup

</repair_actions>
