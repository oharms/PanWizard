# Learnings (AI-derived patterns)

This directory holds AI-derived behavioral patterns extracted from real PAN
Wizard sessions via the **self-improvement loop** (v3.7.0+, see
[ADR-0026](../../docs/decisions/ADR-0026-self-improvement-loop.md)).

Patterns are produced by running `pan-tools learn promote --pattern <id>` over
harvested experiment data. They are **advisory** — orchestrators weight them
against current context, not as hard rules.

## Two-tier layout

| Tier | Path | Shipped to user installs? | Purpose |
|------|------|---------------------------|---------|
| **Universal** | `universal/` | ✅ yes | Patterns that generalize across projects (test conventions, commit hygiene, deviation rules). Workflows reference these. |
| **Internal**  | `internal/`  | ❌ no  | PAN-development-specific patterns (installer quirks, source-repo conventions). Useful only when working on PAN itself. |

The installer ships `learnings/universal/` to all 5 runtime install dirs
(`.claude/`, `.codex/`, `.gemini/`, `.opencode/`, `.github/`) alongside
`references/`. `learnings/internal/` is **never installed** — it stays in
the source repo. Negative tests in
`tests/scenarios/learnings-installed.test.cjs` enforce this.

## Topic file structure

Each topic file is markdown with YAML frontmatter:

```markdown
---
topic: <name>
last_updated: <ISO-8601>
patterns:
  - id: P-001
    summary: <one-line>
    promoted_at: <ISO-8601>
    source_experiments: [<slug>, ...]
---

# <Topic Name> (AI-derived)

## P-001 — <one-line>
**Evidence:** <count> trace events across experiments <list>
**Rule:** <imperative statement>
**Applies in:** <workflow names>
```

## Lifecycle

1. **Promote** — `pan-tools learn promote --pattern <id> --scope universal --topic <name>` appends a pattern to the topic file (creates the file if absent).
2. **Unpromote** — `pan-tools learn unpromote --pattern <id> --topic <name>` removes a pattern (for rollback).
3. **List** — `pan-tools learn list-promoted` shows the inventory across both tiers.

## Why two tiers

PAN-internal patterns risk being shipped as universal advice when they only
apply when the project *is* PAN. Examples:

- **PAN-internal**: "Always commit individually, never `git add -A`" (because of source repo's pre-commit hooks)
- **Universal**: "Run the full test suite before marking a phase complete"

The promote step uses a heuristic filter on file paths in the pattern's
evidence. References to `pan-wizard-core/`, `bin/install.js`, `commands/pan/*`
suggest `internal` scope. The human running `promote` makes the final call.

## Maintenance

These files are **AI-managed**. Direct human edits create drift between
the frontmatter `pattern_ids` list and the body content. For human-authored
behavioral content, use `references/` instead — that's the canonical
hand-authored channel (e.g., `references/guardrails.md` shipped in v3.6.0).
