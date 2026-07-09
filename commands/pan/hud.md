---
name: pan:hud
group: Observability
description: Generate a single-page, self-contained HTML dashboard of the bot army and the project's current state
argument-hint: "[--out <file>] [--open] [--stdout]"
allowed-tools:
  - Read
  - Bash
---

<objective>
Render one **self-contained HTML page** — no server, no network, no external CSS or JS — that shows the whole picture of a PAN project and its bot army in their current state.

It is a *view*, not a new source of truth: every panel aggregates state PAN already tracks (`state.md`, the roadmap/phases on disk, the squad registry, the campaign schedule, army worktrees, the cost ledger, `requirements.md`, verification artifacts, and git history). The command writes only the rendered file, so it can never corrupt planning data.

Default output is `.planning/hud.html`. Open it in any browser. Re-run any time for a fresh snapshot.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/bin/lib/hud.cjs
</execution_context>

<usage>

```
pan-tools hud [--out <file>] [--open] [--stdout]
```

**Flags:**
- `--out <file>` — write to a custom path instead of `.planning/hud.html` (relative paths resolve against the project root).
- `--open` — best-effort: launch the file in the default browser after writing (cross-platform; silently no-ops if no opener is available).
- `--stdout` — print the HTML to stdout instead of writing a file (for piping into another tool or a web response).

**JSON result shape** (default, when not `--stdout`):
```json
{
  "path": ".planning/hud.html",
  "bytes": 18234,
  "army_active": true,
  "sections": ["mission", "command-stack", "campaign", "safety-harness", "worktrees", "roadmap", "telemetry", "requirements-quality", "activity"],
  "opened": false
}
```

</usage>

<panels>

The dashboard is composed of up to ten panels. Panels render only when they have data — a plain (non-army) project still gets a complete, useful page.

| Panel | What it shows | Source |
|-------|---------------|--------|
| **Mission banner** | Project, core value, status, version/milestone + metric cards (progress, phase, requirements, spend) | `package.json`, `project.md`, `state.md`, phase scan, cost ledger |
| **Command stack** *(army)* | Mission Control over the four squads with per-squad agent drill-down (active / idle, calls, tokens) | squad registry + cost ledger |
| **Campaign** *(army)* | Cadence, next-due, daily-budget bar, last run, run history | `schedule.json` |
| **Safety harness** *(army)* | Merge gate, abort switch (pause), active worktrees, daily budget, concurrency | config + pause file + worktrees + schedule |
| **Worktrees** *(army)* | Active `army/*` branches and their paths | `git worktree list` |
| **Roadmap** | Every phase with status + completion | phases on disk |
| **Telemetry** | Total spend, tokens, cache-hit rate, by-squad breakdown | cost ledger |
| **Requirements & quality** | Requirements done/open + last verification artifacts | `requirements.md`, phase `*-verification.md` / `*-uat.md` |
| **Recent activity** | Last commits (the army's committed output) | `git log` |

*(army)* panels appear only when a campaign is scheduled or army worktrees exist — graceful degradation per ADR-0035.

</panels>

<workflow>

**Glance check:** run `/pan:hud --open` to see the project and army at a glance in your browser.

**Share status:** the file is fully self-contained — send `.planning/hud.html` to anyone; it opens with no dependencies.

**During a campaign:** re-run after each cycle to watch squads, budget, worktrees, and committed output evolve. Pair with `/pan:army` and `pan-tools campaign status`.

**Pipe it:** `pan-tools hud --stdout > dashboard.html` or feed the JSON result into another tool.

</workflow>

<runtime_compatibility>

| Runtime | Support |
|---------|---------|
| Claude Code | Full |
| OpenCode | Full |
| Gemini | Full |
| Codex | Full |
| Copilot CLI | Full |

The aggregator and renderer are pure, zero-dependency, runtime-agnostic CommonJS — the dashboard is identical across all five runtimes. `--open` depends on the host OS having a default browser opener.

</runtime_compatibility>
