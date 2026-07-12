---
name: pan:report
group: Observability
description: Generate a self-contained HTML report for one phase, or a project-level timeline index linking every phase report
argument-hint: "phase <N> | index | all [--out <file>] [--open] [--stdout]"
allowed-tools:
  - Read
  - Bash
---

<objective>
Render **self-contained HTML reports** — no server, no network, no external CSS or JS — for the phases of a project. A per-phase report captures one phase's story (objective, roadmap position, what changed, verification and gaps); the timeline index rolls every phase into one navigable page that links to each report.

Like `pan:hud`, these are *views*, not a new source of truth: every value is read from what PAN already tracks on disk (the phase's `plan`/`summary`/`verification` artifacts and their frontmatter, `roadmap.md`, and the cost ledger). The command only writes the rendered file(s), so it can never corrupt planning data. Reports reuse the HUD's visual language, so they look like part of the same product.

Reports are honest by construction: the `verify reconcile` verdict is shown beside the (rubber-stampable) self-reported verification status, status is framed as a current-disk snapshot, and any spend is gated so a poisoned or unpriced ledger never renders a fake `$0`.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/phase-report.cjs
</execution_context>

<usage>

```
pan-tools report phase <N> [--out <file>] [--open] [--stdout]
pan-tools report index      [--out <file>] [--open] [--stdout]
pan-tools report all        [--open]
```

**Sub-actions:**
- `phase <N>` — one phase report, written to `.planning/phases/<NN-slug>/<NN>-report.html` (a sibling of that phase's `verification.md`).
- `index` — the project timeline, written to `.planning/report-index.html`; each row links to a phase report.
- `all` — regenerate every phase report plus the index in one pass.

**Flags:**
- `--out <file>` — write to a custom path instead of the default (relative paths resolve against the project root).
- `--open` — best-effort: launch the written file in the default browser (cross-platform; silently no-ops if no opener is available, and never opens when nothing was written).
- `--stdout` — print the HTML to stdout instead of writing a file (for `phase`/`index`).

**Behaviour worth knowing:**
- **Deterministic writes.** Re-running with unchanged phase data rewrites nothing (the only volatile value, the generated-at timestamp, is ignored when comparing) — so reports produce no git churn.
- **Phase-less projects.** A project with no phase/roadmap layout (a focus-auto project) has nothing to report; `index` exits with a message pointing you to `pan:hud`, whose planning-activity view covers those projects.

**JSON result shape** (`report phase`, when not `--stdout`):
```json
{
  "action": "phase",
  "phase": "03",
  "path": ".planning/phases/03-auth-sessions/03-report.html",
  "bytes": 16183,
  "status": "complete",
  "written": true,
  "opened": false
}
```

</usage>

<workflow>

**Review a phase:** run `pan-tools report phase <N> --open` to see one phase's objective, what changed, and its verification verdict at a glance.

**Share the project:** `pan-tools report index` builds the timeline entry point — send `.planning/report-index.html` and the linked phase files, or open the index and click through.

**Refresh everything:** `pan-tools report all` after a milestone regenerates every report; unchanged ones are skipped, so only what actually moved is rewritten.

**Pipe it:** `pan-tools report phase <N> --stdout > phase.html`, or feed the JSON result into another tool.

</workflow>
