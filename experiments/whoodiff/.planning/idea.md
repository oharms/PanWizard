---
title: "whoodiff — semantic frontmatter diff between two .md files"
created: "2026-04-27T13:50:00Z"
budget: 25
---

# whoodiff

Compares two markdown files' YAML frontmatter and reports the structural changes — added fields, removed fields, changed values, type-shifts. Output in human or JSON; stable change codes.

## Success Criteria

- SC-1: `whoodiff a.md b.md` prints `field: <change>` lines + summary
- SC-2: Change codes: `added`, `removed`, `changed-value`, `changed-type`, `unchanged`
- SC-3: `--format json` → NDJSON of change records
- SC-4: `--unchanged` includes unchanged fields too (default: hide)
- SC-5: Exit codes: 0 = identical frontmatter, 1 = differences found, 2 = parse/IO error
- SC-6: ≥7 tests + real-world fixture (compare two PAN command files)
- SC-7: Reuse vendored doc-lint frontmatter parser? NO — keep this experiment self-contained for honest diff/find. (whoorun will consume vendored modules — saving that pattern for Experiment 5.)

## Out of Scope

- Body content diff (only frontmatter)
- Word-level diff inside string fields
- 3-way merge

## Constraints

- Zero deps
- Apply ALL prior patterns: P-401, P-402, P-403, P-501, P-602 (compose-friendly stdout)
- P-204: assert change SHAPE (codes), not exact prose
