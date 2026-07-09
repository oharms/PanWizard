---
title: "whoorun — minimal task runner consuming doc-lint vendored modules"
created: "2026-04-27T14:05:00Z"
budget: 25
---

# whoorun

A minimal sequential task runner. Reads a task file (YAML-ish frontmatter + body), executes each task as a subprocess, halts on first error (or `--continue-on-error`). The **deliberate meta-experiment**: validates that PAN's `pan-wizard-core/bin/lib/doc-lint/` vendored modules can be consumed by a downstream tool.

## Success Criteria

- SC-1: Task file format: frontmatter declares `name`, `description`; body has `## task-name` headings followed by indented `cmd:` lines.
- SC-2: `whoorun <taskfile>` runs each task sequentially, prints a summary at the end.
- SC-3: Halts on first nonzero exit unless `--continue-on-error`.
- SC-4: `--dry-run` lists tasks without executing.
- SC-5: `--filter <name>` runs only tasks whose name matches.
- SC-6: **Consumes `pan-wizard-core/bin/lib/doc-lint/frontmatter.js`** as the YAML parser. (Not via npm dep — by direct require of the source path. Validates the vendor pattern.)
- SC-7: ≥7 tests pass.
- SC-8: P-201 dogfood: write a real task file that runs whoosort + whoolen + whoograph as subprocesses.
- SC-9 (P-602 composition): Tasks emit progress lines that downstream tools could parse.

## Out of Scope

- Parallel task execution (sequential for v0.1)
- Task dependencies / DAG
- Variable interpolation across tasks
- Retries / circuit breakers

## Constraints

- Zero deps; node:test
- ALL prior patterns apply: P-201, P-203, P-204, P-205, P-401..P-403, P-501, P-601, P-602, P-701
- The doc-lint require IS the meta-test; if it fails to load or parse correctly, that's a real finding about the vendor pattern.
