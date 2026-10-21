---
name: focus-docs
group: Focus
description: Documentation audit and sync — accuracy, freshness, links, cross-consistency and structure; --sync updates stale docs after changes
argument-hint: "[file|directory] [--deep] [--links] [--fix] [--all] [--score-only] [--min-score N] [--format markdown|json|checklist] | --sync [--readme | --docs | --arch | --all]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - WebFetch
---

# /pan:focus-docs — Documentation audit and sync

One command for a project's documentation. $ARGUMENTS

- **Default: audit.** Score documents for accuracy, freshness, links, cross-consistency and structure, and fix what `--fix` allows: follow @~/.claude/pan-wizard-core/workflows/focus-doc-audit.md.
- **`--sync`: synchronise after changes.** Check staleness and update counts and references in README, docs and architecture: follow @~/.claude/pan-wizard-core/workflows/focus-sync.md with the rest of the arguments.

The old `focus-doc-audit` and `focus-sync` names run this command as aliases.
