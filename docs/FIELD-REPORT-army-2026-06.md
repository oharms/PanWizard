# Field Report — Production PAN Campaigns (2026-06)

Optimizations for PAN itself, mined from real projects that ran PAN hard (not test fixtures): **three deep dives** plus a **fleet sweep of all six D: installs** (see the sweep section below). Read-only inspection of each project's `.planning/` artifacts, git history, and installed hooks — nothing in those projects was modified.

| Project | How it used PAN | Key artifact |
|---|---|---|
| `<compliance-project>` | `/pan:army` campaign v1.1 — main-loop Mission Control, 5 missions landed | `orchestration/missions.md` |
| `<lending-project>` | `/pan:focus-auto` backlog loop — ~40 batches over weeks | `metrics/tokens.jsonl` (1012 records) |
| `<forecasting-project>` | phase-based exec + army design | `bot-army.md`, `metrics/tokens.jsonl` (106 records) |

Project-specific numbers below are case-study **evidence**, not PAN's own counts (those live only in `CLAUDE.md`).

---

## 1. ⭐⭐ Cost telemetry is broken — absent in one mode, *corrupted* in the others

This is the biggest finding, and it took all three projects to see it.

**Absent (main-loop army).** the compliance project ran a full 5-mission campaign and produced **zero** `tokens.jsonl` / traces / bus events — even though the cost+trace hooks are installed, registered on `SubagentStop`, and **verified working in isolation** (a synthetic payload appends a correct record). `SubagentStop` only fires for Task-spawned subagents; a main-loop Mission Control's own work never triggers it, so the campaign ran blind.

**Corrupted (where it *is* captured).** the lending project and the forecasting project *do* have `tokens.jsonl` — and the data is unusable:

- the lending project: **7.9 trillion** cache-read tokens across 1012 records; **cache-hit pinned at 100%**; a *single* subagent record claims `input=16.8M, output=38.6M, cache_read=13.3 billion` (impossible for one agent); **933/1012 records inflated**, and the top records are **byte-identical** (same session `224ff330…`).
- the forecasting project: same shape, milder (max single-record cache_read 376M; 76/106 inflated) — severity tracks session length.

**Root cause** (`hooks/pan-cost-logger.js` + `pan-trace-logger.js`, `readUsageFromTranscript`): when the `SubagentStop` payload lacks `usage` (headless/Task spawns), the hook falls back to **summing `usage` across every assistant message in the transcript** filtered by `session_id`. Three compounding faults:
1. **Subagents share the parent `session_id`**, so the filter never isolates one subagent — every `SubagentStop` sums the *entire, still-growing* transcript.
2. **`cache_read_input_tokens` is cumulative per turn** (each turn re-reads the cached prefix), so summing across N turns multiplies the cached context by N → billions.
3. The same cumulative total is then **written once per `SubagentStop` firing** → the ledger stores the transcript-sum many times over (hence the byte-identical rows).

Net: `/pan:cost`, the HUD telemetry panels, and `/pan:optimize` all consume garbage wherever capture "works," and get nothing where the army is main-loop driven. Cost-in-USD would be astronomically wrong (trillions of tokens × rate).

**Fix in PAN:**
- **Attribute per-subagent deltas, not whole-transcript sums.** Track a per-session high-water mark (last-processed message index / byte offset / ts) under `.planning/metrics/`; on each `SubagentStop` sum only messages appended since the previous firing.
- **Prefer the payload's own `data.usage`** when present; use the transcript only for the final turn, never a cumulative sum.
- **Don't sum `cache_read` across turns as independent** — record the last turn's figure (or per-turn deltas), and **sanity-cap**: a record whose `cache_read ≫ input` (the 100%-hit tell) is almost certainly miscounted — drop or flag it.
- **Dedup** writes by `(session, last-message-ts)`.
- **Capture actively too** (see the army case): the campaign Learn step should append a per-mission record so observability survives the main-loop pattern.

→ Folded into **P-360** (campaign telemetry must be both *captured* and *trustworthy*).

## 2. ⭐ Two-dot diff caused a false Quality block
**Evidence (the compliance project, Mission D):** a Quality BLOCK was a false positive — the reviewer diffed `main..HEAD` (two-dot) *after* an earlier parallel mission merged and moved `main` past D's fork, so already-merged code showed as **phantom deletions**. The army diagnosed it itself and wrote a process note. A false block burns a cycle; the mirror case can wave a bad change through.
**Fix:** reviewers/hardener/integration-checker and the `/pan:army` Quality + Release steps diff the **merge-base** (`<fork-sha>..HEAD` / three-dot `main...HEAD`), never two-dot; `worktree.cjs` stamps the fork sha at creation. → promoted as **P-350**.

## 3. The campaign ledger has no canonical home — tooling is blind to it
**Evidence:** three projects, three conventions: the compliance project `orchestration/missions.md` (live campaign log), the forecasting project `.planning/bot-army.md` (army design/governance doc), and PAN's own `campaign status` / HUD read `schedule.json` (absent in both). So the richest artifacts of each campaign are invisible to PAN's tools, and `campaign status` reports "no campaign" while a real one ran.
**Fix:** define one canonical, machine-readable campaign-state file the army writes and `campaign status` + the HUD read. The hand-authored `missions.md` table is an excellent human view — standardize its schema and have tooling parse it (or emit a structured sibling), rather than inventing a third format.

## 4. Velocity metrics never populated
**Evidence (the compliance project):** `state.md → Performance Metrics` reads "Total plans completed: 0 · Average duration: —" despite 11 phases / 34 plans plus the campaign.
**Fix:** record per-plan / per-mission duration + counts at completion (exec-phase + army Learn) so velocity, the HUD, and estimation feedback have data.

## 5. Minor
- **Bookkeeping commit overhead** — the compliance project adds a `chore(army): record Mission X landed` commit per mission (already batched C+D once); fold into the merge commit.
- **`tier` null on hook records** — even valid cost records carry `tier:null`, so `/pan:cost` by-tier and the HUD tier view stay empty; resolve `tier` from the agent name in the hook.
- **Stray test worktree** — the forecasting project has `D:/tmp/wt-worktree-smoke` lingering; worktree cleanup should sweep abandoned smoke/test trees.

---

## Fleet sweep — all six installs (2026-06-28)

A read-only pass over every D: install that has PAN, to test whether the findings generalize. They do — and three new ones surfaced.

| Project | How PAN is used | cost records | inflated | max 1-record cache-read | dup rows | `state.md` |
|---|---|---|---|---|---|---|
| the compliance project | army (main-loop) | **0** | — | — | — | ✓ phase |
| the forecasting project | phase + army | 158 | 128 | 0.8 B | 15 | ✓ phase |
| the lending project | focus-auto (36 batches) | 1012 | 956 | **13.3 B** | 76 | — |
| montyhall_Door_One | custom loop (~10k inbox) | 379 | 305 | 9.2 B | 45 | — |
| the spec-factory project | optimize-only | 119 | 119 | 0.8 B | 2 | — |
| lugh | optimize-only | 19 | 9 | 1.2 B | 1 | — |

**Confirmations:**
- **The cost over-count is universal** — every install that captured telemetry (5/5) is inflated; severity scales with loop length (lugh's 19 records → the lending project' 1012 records / 13.3 B). Not a one-project fluke.
- **The optimize/trace loop itself works** — `optimization/traces` has real content (the forecasting project 12, others 1–2). The corruption is specific to **cost** (`tokens.jsonl`), not traces. (Correction to an earlier assumption.)
- **Campaign-ledger sprawl is worse than thought** — four filenames in the wild: `missions.md`, `mission-F-decision.md`, `campaign.md`, `bot-army.md` — none read by `campaign status`/HUD.

**New findings:**

### 6. ⭐ PAN's observability assumes the phase lifecycle, but most real usage isn't phase-shaped
**4 of 6 installs have no `state.md` at all.** Real usage clusters into three modes, only one of which PAN's state/progress/HUD/velocity tooling understands:
- **phase + army** (the compliance project, the forecasting project) — has `state.md`;
- **focus-auto / backlog loop** (the lending project — 36 batches, weeks long) — no `state.md`;
- **optimize-only** (the spec-factory project, lugh — only `metrics/` + `optimization/`) — no planning state at all.

The `/pan:hud` I built, `state-snapshot`, `progress`, and velocity all key off `state.md` phase fields — so for **the majority of real projects they render near-empty or degrade**. 
**Fix:** the HUD/progress layer should detect the active mode and reflect focus-auto batches / optimize sessions when there's no phase state — observability should follow how PAN is actually used, not assume phases.

### 7. `bus.cjs` has zero adoption fleet-wide
**0 of 6** installs have a single `bus/` channel. A shipped module + three commands (`bus publish|drain|list`) with no real-world use — and the HUD's activity feed (which could read it) will therefore always be empty.
**Fix:** either wire the bus into army/focus coordination so it earns its place (and the HUD activity panel populates from real agent messages), or acknowledge that file-based coordination won and slim the surface.

### 8. A ~10k-item autonomous loop was hand-built *on top of* PAN — mine it
montyhall_Door_One runs a bespoke `/focus-loop` (user-local command) with a harness PAN doesn't provide: a durable **work-queue** (`inbox/` — **9,981 files**), **heartbeat** liveness, **cycle-close**, **parity** cross-checks, and **snapshots** (77). P-310 already harvested its parallel-research→serial-build shape; the **queue + heartbeat + snapshot + parity** infrastructure is unharvested and is the blueprint for making PAN's own `focus-auto`/army loops robust at the ~10k-item scale users actually push them to.
**Fix:** evaluate folding a durable work-queue + heartbeat/liveness + cycle snapshots into `focus-auto` / the army loop, rather than every serious user re-inventing them.

## What worked (validated — preserve)

- **Risk-ascending mission ordering** with the risky migration deferred behind an explicit-go gate (the compliance project F).
- **Adversarial Quality caught real bugs** before merge — a DoS/disposed-stream and an authorization leak (the compliance project A, E).
- **Human-gated ship + rollback discipline** — per-mission rollback targets, always-ask merges, no force-push.
- **Brownfield onboarding-first** — codebase maps built before any squad coded.
- **Branch/worktree-per-task isolation** and clean squash-merge-per-mission history.
- **`/pan:focus-auto` sustained a weeks-long backlog campaign** (the lending project, ~40 batches) — the loop scales over time.

## Patterns promoted to the shipped store
`pan-wizard-core/learnings/universal/autonomous-loop.md` — every future campaign inherits them:
- **P-350** — review against the merge-base, never two-dot, when the base moves.
- **P-360** — campaign telemetry must be both *captured* (active per-step record, not just the passive hook) and *trustworthy* (never naive-sum a shared-session transcript; cache-read is cumulative-per-turn).

## Quick-win checklist
- [ ] **Fix the cost-logger transcript over-count** (per-subagent delta + cache-read handling + dedup + sanity-cap) — `hooks/pan-cost-logger.js`, `pan-trace-logger.js`. *(universal — 5/5 installs affected)*
- [ ] Merge-base review + fork-sha stamping (P-350) — reviewers, `/pan:army`, `worktree.cjs`.
- [ ] Active per-mission telemetry + Phase-0 probe (P-360) — `/pan:army`.
- [ ] **Mode-aware observability** — HUD/`progress`/velocity reflect focus-auto batches & optimize sessions when there's no `state.md` (4/6 installs). *(finding 6)*
- [ ] Canonical campaign-state file read by `campaign status` + HUD (retire the `missions.md`/`campaign.md`/`bot-army.md` sprawl). *(finding 3/5)*
- [ ] Decide `bus.cjs`'s fate — wire it into army/focus coordination (and the HUD activity feed) or slim it; zero adoption fleet-wide. *(finding 7)*
- [ ] Evaluate folding a durable work-queue + heartbeat + cycle snapshots into `focus-auto`/army loops — the harness montyhall hand-built at ~10k-item scale. *(finding 8)*
- [ ] Per-plan duration/counts → velocity (exec-phase + Learn).
- [ ] (minor) fold bookkeeping commits · resolve `tier` on hook records · sweep stray worktrees.
