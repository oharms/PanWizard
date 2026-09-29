# Learnings (AI-derived patterns)

This directory holds AI-derived behavioral patterns extracted from real PAN
Wizard sessions via the **self-improvement loop** (v3.7.0+, see
[ADR-0026](../../docs/decisions/ADR-0026-self-improvement-loop.md)).

Patterns are promoted by hand with `pan-tools learn promote` (see Lifecycle) from
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

1. **Promote** — `pan-tools learn promote --pattern <id> --scope universal --topic <name> --summary <text> --rule <text>` appends a pattern to the topic file (creates the file if absent); `--evidence`, `--applies-in` and `--source-experiments` fill in the rest of the entry.
2. **Unpromote** — `pan-tools learn unpromote --pattern <id> --scope <universal|internal> --topic <name>` removes a pattern (for rollback) and deletes the topic file once it holds none.
3. **List** — `pan-tools learn list-promoted` shows the inventory across both tiers.
4. **Index** — `pan-tools learn build-index` regenerates `index.json`, the topic index `pan-tools learn topics-for --agent <name>` reads; promote and unpromote do not update it.

## Why two tiers

PAN-internal patterns risk being shipped as universal advice when they only
apply when the project *is* PAN. Examples:

- **PAN-internal**: "Always commit individually, never `git add -A`" (because of source repo's pre-commit hooks)
- **Universal**: "Run the full test suite before marking a phase complete"

The promote step warns when a universal-scope pattern reads like a prompt
fragment rather than a structural pattern (P-RES-007), and `pan-tools learn lint`
warns when a universal pattern's heading or Rule names PAN-internal terms such as
`pan-wizard-core` or `pan-tools`, a candidate for `internal` scope. The human
running `promote` makes the final call.

## Maintenance

These files are **AI-managed**. Direct human edits create drift between
the frontmatter `patterns` list and the body content. For human-authored
behavioral content, use `references/` instead — that's the canonical
hand-authored channel (e.g., `references/guardrails.md` shipped in v3.6.0).
