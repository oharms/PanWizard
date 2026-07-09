# ADR-0035: Single-Page HTML HUD for the Army + Project

## Status
Accepted — 2026-06-27. A read-only observability surface over the bot-army arc (ADR-0032 squads, ADR-0033 campaign, ADR-0034 scheduled campaigns). Adds no new state and no new execution path.

## Context

By the end of the bot-army arc, a project's live state is spread across many places: `state.md` (phase/status/blockers), the roadmap/phases on disk, the squad registry (`squad list`), the campaign descriptor (`campaign status`), army worktrees (`worktree list`), the cost ledger (`cost report`), `requirements.md`, per-phase verification artifacts, and git history. Each is reachable via a `pan-tools` subcommand that prints JSON or a text table, but there was no *single glance* — nothing a human (or a stakeholder who doesn't live in the terminal) could open and read top-to-bottom to answer "what is the army doing and where is the project?"

Three constraints shaped the design:

1. **A view, never a source of truth.** A dashboard that could mutate planning state would be a liability. It must only *read* and only *write its own rendered file*, so it can never corrupt a campaign.
2. **Self-contained and portable.** The artifact has to open with zero dependencies — no server, no network, no external CSS/JS — so it can be shared (sent to a stakeholder, attached to a PR) and opened on any machine, online or off.
3. **Graceful degradation.** Most PAN projects are not running an army. The command must produce a complete, useful page for a plain project, showing army-only panels only when a campaign is scheduled or army worktrees exist.

## Decision

Add `pan-tools hud` (command `/pan:hud`, alias `/pan:dashboard`) and a `hud.cjs` core module that **aggregates** existing signals into one self-contained HTML file (default `.planning/hud.html`).

### 1. `hud.cjs` — pure aggregate + pure render

- `collectHudData(cwd, {now})` → a plain data object. Reads only via already-exported primitives (`squads.listSquads/getSquad/squadForAgent`, `campaign.readSchedule/isRunDue`, `worktree.listArmyWorktrees`, `cost.aggregate`, `core.getMilestoneInfo`, `safeReadFile`) plus direct file reads for state/roadmap/requirements. `now` is injected for testability.
- `renderHud(data)` → a complete `<!DOCTYPE html>` document with one inlined `<style>` block, no `<script>`, no external URLs. All project-derived text is HTML-escaped (`esc`) — the dashboard is XSS-safe even though it's local, because project names and commit subjects flow into it.
- `cmdHud(cwd, opts, raw)` — the only side-effecting wrapper: writes the file (or `--stdout`), optionally `--open`s it, and prints the path + a section manifest.

### 2. Up to ten panels, each self-hiding when empty

Mission banner · command stack (per-squad agent drill-down) · campaign · safety harness (Sentinel) · worktrees · roadmap · telemetry (by-squad) · requirements & quality · recent activity. The four army panels (command stack, campaign, harness, worktrees) render only when `army_active` (a campaign exists **or** army worktrees exist). Roadmap, telemetry, requirements/quality, and activity render whenever they have data.

### 3. Styling

The shipped HTML uses the bot-army dark aesthetic (amber = Mission Control/Opus, cyan = squads/Sonnet, green = workers/Haiku, violet = shared), inlined so the file stays dependency-free. Named web fonts degrade to system stacks when unavailable — no font is fetched.

## Consequences

- **One glance.** A human or stakeholder opens `.planning/hud.html` and reads the whole picture; `--open` launches it directly.
- **Zero new state.** The HUD is derived; deleting it loses nothing. It cannot corrupt planning data because it only writes its own file.
- **Composability over duplication.** Because it aggregates the same functions the individual commands use, the HUD can never disagree with `campaign status` / `cost report` / `squad list` — there is one set of readers.
- **Runtime-agnostic.** The aggregator and renderer are pure zero-dependency CommonJS; the page is identical across all five runtimes. Only `--open` depends on the host OS having a default opener.
- **Trade-off:** it's a snapshot, not live. Re-running is the refresh model (a future `--watch` could regenerate on an interval); this keeps PAN's no-daemon stance (consistent with ADR-0034).
