---
name: pan:dashboard
group: Observability
description: Alias for /pan:hud — generate the single-page HTML dashboard of the bot army and project
argument-hint: "[--out <file>] [--open] [--stdout]"
allowed-tools:
  - Read
  - Bash
---

<objective>
`/pan:dashboard` is a discoverability alias for **`/pan:hud`** (ADR-0035). It generates the same single-page, self-contained HTML dashboard of the project and its bot army.

Run it exactly like `/pan:hud`:

```
pan-tools hud [--out <file>] [--open] [--stdout]
```

See **`/pan:hud`** for the full panel list, flags, JSON result shape, and runtime compatibility. The two commands are interchangeable.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/hud.cjs
</execution_context>
