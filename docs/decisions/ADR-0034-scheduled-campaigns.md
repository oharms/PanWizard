# ADR-0034: Scheduled, Self-Resuming Army Campaigns ("Dreaming")

## Status
Accepted — 2026-06-12. Final slice of the bot-army arc (after ADR-0032 squads, ADR-0033 campaign). Turns "the army self-drives one run" into "the army runs the backlog down over days, on a cadence, resuming itself — without ever shipping to a protected branch unattended."

## Context

`/pan:army` (ADR-0033) self-drives a campaign *within a single session*: it loops plan→delegate→execute→review→integrate→learn until a stop condition. What it does not do is run over *time* — across closed sessions, on a schedule, resuming where it left off. Three honest constraints shape the design:

1. **PAN is not a daemon.** It is prompt-driven orchestration that runs inside a host runtime session (Claude Code et al.). It cannot wake itself while the session is closed, cannot restart after a crash on its own, and must not pretend to. Anything "scheduled across sessions" requires an external trigger — the host runtime's scheduler (Claude Code routines / cron / the scheduled-tasks surface) or a human re-invocation.
2. **The merge gate is non-negotiable.** Unattended operation makes the always-ask human merge *more* important, not less. Nothing about scheduling may lower it.
3. **Anthropic's "Dreaming"** (scheduled review of sessions/memory to curate patterns) is conceptually PAN's retro/learn loop. Putting it on a cadence is the natural fit — and PAN already built the loop.

## Decision

Add a **schedule descriptor + due-check** that an external scheduler polls, plus a self-resume protocol and a cadenced "dream" (retro/learn) step. PAN owns the state and the decision *whether a run is due*; the host owns *firing* it.

### 1. `campaign.cjs` core module

A pure descriptor + scheduler-logic module (no daemon, no timers):

- **Schedule descriptor** at `.planning/orchestration/schedule.json`: `{ goal, source, cadence, daily_budget, enabled, paused, next_due, last_run, history[] }`.
- `parseCadence(str)` — `hourly` / `daily` / `weekly` / `Nh` / `Nd` → milliseconds.
- `isRunDue(schedule, now)` → `{ due, reason, next_due }`. Due when: enabled, not paused, `now ≥ next_due`, and today's recorded spend `< daily_budget`. Reasons (`disabled` / `paused` / `not_yet` / `budget_exhausted_today` / `due`) are explicit so the host scheduler logs *why* it skipped.
- `recordRun(cwd, {ts, items_landed, points_used})` — appends to capped history, sets `last_run`, advances `next_due = ts + cadence`.
- `isDreamDue(schedule, now)` — whether the retro/learn ("dream") step is due (default: once per calendar day with activity).
- CLI: `pan-tools campaign schedule` (arm/update), `campaign status`, `campaign due` (exit-coded for a scheduler to gate on).

`now` is injected for testability; the CLI passes `new Date()`.

### 2. `/pan:army --schedule <cadence>`

Arms a campaign: writes the descriptor instead of running once. Phase 6 (Learn) calls `recordRun` and advances `next_due`; Phase 0 honors `daily_budget` (stops the day's run when exhausted). Adds a **resume protocol**: `/pan:army --continue` resumes an in-progress campaign from `.planning/orchestration/` + focus-auto state; if a schedule exists and `campaign due` is true, it runs the next mission, otherwise it reports next-due and stops.

### 3. The external trigger (documented, not built)

PAN provides `campaign due` (a cheap, side-effect-free check) and the `--continue` entry point. The host fires them:

- **Claude Code routines / cron / scheduled-tasks**: a scheduled job that runs `pan-tools campaign due` and, if due, invokes `/pan:army --continue`.
- **`/loop`**: a self-paced session loop that polls `campaign due` and continues when due.
- **SessionStart nudge**: when you next open the project, surface "a scheduled campaign is due — run `/pan:army --continue`."

PAN deliberately does not embed a scheduler daemon — that would be a false promise of unattended execution it cannot keep, and a security surface (a background process spawning agents) it should not own.

### 4. The merge gate, unchanged

Scheduled or not, integration is `always-ask`: `pan-release` prepares the merge and requests approval; a human merges to the protected branch. A scheduled campaign therefore runs the backlog down to *staged, reviewed, green PRs* unattended — and waits for a human at the one irreversible step. This is the explicit contract: **autonomous up to the merge, human at the merge, forever.**

## Consequences

**Positive.** The army can advance a backlog over days on a cadence, curating memory between missions (Dreaming), with bounded daily spend and self-resume — while every irreversible action still stops for a human. The scheduler integration is a thin, honest seam (a due-check + a resume command), portable across host schedulers.

**Negative / risks.** "Scheduled" depends on an external trigger PAN doesn't control; if the host has no scheduler and the session is closed, nothing fires (correctly — PAN won't fake a daemon). A misconfigured `daily_budget` could let a cadenced campaign spend more than intended across days — mitigated by the per-day budget check and the unchanged per-run caps. The resume protocol is prompt-driven; the enforced guarantees (caps, worktree isolation, always-ask merge, branch protection) remain in code.

## Follow-ups
- Live verification of a multi-day scheduled campaign on a real project.
- Optional: a `campaign report` rollup across the history window.
