---
topic: output-conventions
last_updated: 2026-04-27T10:15:00.961Z
patterns:
  - id: P-402
    summary: Always emit a trailing newline from CLI output
    promoted_at: 2026-04-27T10:15:00.960Z
    source_experiments: [whoosort]
---

# Output Conventions (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-402 — Always emit a trailing newline from CLI output

**Evidence:** whoosort 13:12Z gap: trailing-newline convention enforced in joinLines but not documented in --help. Most Unix tools do this; downstream tooling expects it.

**Rule:** CLI tools should always emit a trailing newline at the end of output unless the user explicitly opts out. Mirrors POSIX text-file convention and matches downstream expectations (pipes, byte counters, line counters). Document the behavior in --help and tests can assert it deterministically.

**Applies in:** exec-phase (CLI implementation)
