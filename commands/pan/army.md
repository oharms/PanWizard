---
name: army
group: Army
description: Bot-army campaign — Mission Control (the reasoning-tier conductor) delegates a whole-project goal to squads (architecture / build / quality / release), each squad working branch-per-agent worktrees under a hard safety harness, gated by CI + a human merge, looping plan→delegate→execute→review→integrate→learn until the goal ships or a stop condition fires.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - Task
---

# /pan:army — Bot-Army Campaign (mission control → squads → ship)

Run a whole-project delivery as a coordinated bot army (ADR-0032 squads · ADR-0033 campaign). **Mission Control** — the reasoning-tier `pan-conductor`, elevated to campaign scope — plans the mission and delegates to **squads** over the Agent toolset rather than implementing anything itself. Each squad owns its lifecycle role; the Build squad parallelizes by giving every builder its own `army/<task>` branch in an isolated git worktree. Nothing reaches a protected branch without green CI and a human's approval. $ARGUMENTS

The army is the campaign-scale sibling of `/pan:exec-phase --hierarchical` (one phase) and `/pan:focus-auto` (a category/backlog loop). It composes both: the conductor harness bounds it, the focus-auto loop drives it, the squads structure it.

---

## Tiers — the squad rows from `pan-tools squad list`, plus PAN's own hierarchy positions

| Tier | Who | Model tier | Access |
|------|-----|-----------|--------|
| 0 · Mission Control | `pan-conductor` | `reasoning` (`mid` under `budget`) | delegation-first (Agent toolset) — instructed to route work, not write it |
| 1 · Architecture | design + planning agents — `squad show architecture` lists them | `reasoning` | `read-only` |
| 1 · Build | `pan-executor` | `reasoning` | `read-write-bash` — one branch+worktree per agent |
| 1 · Quality | adversarial review + debug agents — `squad show quality` lists them | `mid` | `read-only`, adversarial |
| 1 · Release | `pan-release` | `mid` | `always-ask` — human gate |
| 2 · Workers | the agents `squad list` reports under `workers` | `reasoning`; `budget` down-tiers **per agent** (see below) | narrow, high-volume jobs |

**Where each row comes from.** The tier-1 rows mirror the `squads[]` records `pan-tools squad list` prints — label, `tier`, `access` (their member names come from `squad show <name>`, since `squad list` reports only a count). The Tier 0 and Tier 2 rows are PAN's hierarchy positions: the same command names them under its `coordinator` and `workers` keys, but reports nothing else about them, so the Model-tier and Access values on those two rows are written here rather than returned by the command. Resolve the roster at runtime — never hardcode it: `pan-tools squad list` and `pan-tools squad show <name>`.

**Reading the Model-tier column.** These are PAN *tiers*, not model names. `reasoning` resolves to `inherit` — the model you launched with — while `mid` and `fast` map to the provider's mid/fast models (Sonnet and Haiku on Anthropic).

**Reading the Access column.** The backticked values on the tier-1 rows are the `access` labels `squad list` reports; tier 0 and tier 2 carry PAN's own. They are role contracts the conductor's prompt assigns when it delegates, not a sandbox: `squads.cjs` says of itself that it "modifies no agent and changes no execution path", so a label can differ from what an agent may actually do — expect that, since several `read-only` squad members hold `Write` to emit planning or verification artifacts. The binding grant is each agent's own `tools:` frontmatter (`grep '^tools:' agents/*.md`), and Mission Control's includes `Write` and `Bash`: routing rather than coding is how it is instructed to behave, not something the runtime prevents. The rail those grants do enforce is delegation depth — `grep -l '^tools:.*Task' agents/*.md` names every agent able to spawn another (today, `pan-conductor`), so a squad agent cannot fan out further.

**Squad tier is not profile tier.** The tier column above is a `squads.cjs` grouping attribute — what `pan-tools squad list` reports — and it is not what resolves an agent's model; that comes from the active `model_profile` (`quality` and `balanced` are `reasoning` for every agent, and `budget` is the only profile that down-tiers), plus any `model:` pin in an agent's own frontmatter. So the `mid` on the Quality and Release rows does not describe what those agents run under the default profile — under `quality` and `balanced` they resolve `reasoning` like everything else. The tier-1 values above are the squad groupings; the tier-0 and tier-2 values are per-agent profile tiers. **`budget` resolves per agent, not per row:** it sends some workers to `fast` and others to `mid`, so no single value is true of the Tier 2 row — `MODEL_PROFILES` in `pan-wizard-core/bin/lib/core.cjs` is the table, and it is the one to read rather than a tier written into a doc. For the agents that pin a model outright, `grep -l '^model: opus' agents/*.md` lists them — the pin applies on Claude Code only, since the installer strips it for the other runtimes.

---

## Concurrency model (LOAD-BEARING)

Read-only stages fan out; the mutating stage stays isolated, never shared:

| Stage | Concurrency |
|-------|-------------|
| Research (Architecture, Quality) | **Parallel** — read-only, mutate nothing |
| Build | **Parallel across agents, but each in its OWN worktree** — `pan-tools worktree create <task>`; two agents never share a tree or a file |
| Integrate / Release | **Serial, human-gated** — one merge at a time, `always-ask` |

If the project declares `concurrency.serial_build: true` in `.planning/config.json`, builds additionally run one-at-a-time even across worktrees (for build trees that corrupt under concurrency). Off by default.

---

## Safety harness (inherited from pan-conductor — mandatory)

Every cap the conductor enforces applies to the campaign, scaled up:

| Cap | Mechanism |
|-----|-----------|
| Nesting depth 2 | Mission Control spawns squad agents; squad agents MUST NOT spawn further |
| Spawn / budget ceiling | per-cycle spawn cap + `--total-budget`; stop when the next spawn exceeds remaining budget |
| Abort kill-switch | `.planning/orchestration/abort` present → stop immediately, preserve state |
| Protected main | no direct push; merge is an `always-ask` human gate |
| Worktree isolation | branch-per-agent — parallel builders cannot collide |
| Rollback never rewrite | recovery = `git revert` / previous tag; never force-push |

---

## Arguments

```
/pan:army "<goal>" [--source scan|backlog] [--max-cycles N] [--total-budget N]
          [--squads a,b,c] [--no-build-worktrees] [--push] [--clean-seal]
          [--schedule <cadence>] [--daily-budget N]
          [--dry-run] [--continue] [--stop] [--status]
```

| Flag | Default | Effect |
|------|---------|--------|
| `--source` | `backlog` | Work selection (delegates to focus-auto): `backlog` = ranked roadmap/requirements items; `scan` = category code-scan. |
| `--max-cycles` | 5 | Mission items landed before stopping. |
| `--total-budget` | 300 | Cumulative point budget. **Advisory by default** — tracked/surfaced but not a hard stop unless `--enforce-budget` / config `budget.enforce: true`. |
| `--enforce-budget` | off | Make the point budgets hard stops again (also settable via config `budget.enforce: true`). |
| `--verify-reserve` | 0.15 | Fraction of `--total-budget` (0–0.5) held back for the final Quality re-review so it can't be starved (config `budget.verify_reserve`). Advisory by default (surfaced as `into_verify_reserve`); under `--enforce-budget` it stops taking on new missions early (`budget_reserve_reached`) and the reserved points fund the closing `--clean-seal` re-verification before the last INTEGRATE. |
| `--squads` | all | Restrict to a subset, e.g. `--squads architecture,build,quality`. |
| `--no-build-worktrees` | off | Build in the main tree instead of branch-per-agent worktrees (small/serial projects). |
| `--push` | off | Push approved merges to origin (still human-gated). |
| `--clean-seal` | off | One clean build + full verification after the last item (commands from config). |
| `--schedule` | off | Arm a self-resuming campaign at this cadence (`hourly`/`daily`/`weekly`/`Nh`/`Nd`) instead of running once — writes the schedule descriptor (ADR-0034). Pair with `--daily-budget`. |
| `--daily-budget` | 300 | Per-day point budget for a scheduled campaign. Advisory by default (an indicator of the day's spend); it only pauses the day's run when `budget.enforce`/`enforce_budget` is set. |
| `--dry-run` | off | Plan + squad delegation preview only; STOP. |
| `--continue` / `--stop` / `--status` | — | Resume / halt / report from `.planning/orchestration/` + focus-auto state. |

---

## Pipeline — the six-phase loop

```
/pan:army
  Phase 0  MUSTER   — squad list + roster validate · cache prime · baseline · loop-state · abort-file clear
  Phase 1  PLAN     — Mission Control (session model, xhigh effort) decomposes the goal into dependency-ordered missions
  Phase 2  DELEGATE — pick the next item (focus-auto --source) · route to the owning squad over the Agent toolset
  Phase 3  EXECUTE  — Build squad: one army/<task> worktree per agent (parallel); Architecture/Quality research in parallel (read-only)
  Phase 4  REVIEW   — Quality squad on the built tree: reviewer + hardener + meta → verdict ladder; a block is a hard gate
  Phase 5  INTEGRATE— Release squad: prepare squash-merge → CI/verification → ALWAYS-ASK human approval → tag → deploy hand-off
  Phase 6  LEARN    — summaries return to Mission Control; retro/learn writes patterns to memory (this is "Dreaming")
  → loop to Phase 2 until a stop condition; --clean-seal once at the end
```

### Phase 0 — Muster (once)
1. **Onboarding gate (existing projects).** Run `pan-tools init new-project` to detect state. If `is_brownfield` (existing code) and `needs_codebase_map` (no `.planning/codebase/`), the army cannot plan blind — STOP and route through onboarding first: `/pan:map-codebase` (Architecture squad's `pan-document_code` maps the existing system into `.planning/codebase/`), then `/pan:new-project` to build `roadmap.md` + `requirements.md` *against the existing system*. Re-run `/pan:army` once a backlog exists. If a codebase map + roadmap already exist, continue.
2. `pan-tools squad list` and validate the roster is healthy.
3. Prime the cache; capture baseline (`git status` clean of project source; tests green or STOP). On a brownfield repo, the baseline is the current `main` — every `army/<task>` branch forks from it, so the existing code is never edited in place.
4. Ensure `.planning/orchestration/` exists; clear any stale `abort` file; init loop-state.
5. `--dry-run` → print the plan + per-squad delegation and STOP.

### Phase 1 — Plan (Mission Control)
Spawn the conductor in campaign mode (it plans, it does not code). It decomposes the goal into ordered, dependency-aware missions and assigns each to a squad.

### Phase 2–3 — Delegate + Execute
- Select the next item via `focus-auto --source {source}`.
- Architecture squad (read-only, parallel) produces the contract for a design-heavy item.
- Build squad: for each independent task, `pan-tools worktree create "<task>"` → spawn one `pan-executor` per worktree (parallel, isolated). Honor the spawn/budget caps before every spawn.

### Phase 4 — Review (Quality)
Spawn the Quality squad on the built tree (parallel, read-only). Merge findings into one verdict (`/pan:review-deep` if available). `block` / `review_required` → fix serially, then re-review. Never integrate red.

### Phase 5 — Integrate (Release, human-gated)
Spawn `pan-release`. It prepares the squash-merge, runs the configured `verification`, and surfaces an **always-ask** approval request. A human approves the merge to the protected branch; release then tags and records the rollback target. `--push` pushes the approved result.

**Phase report (opt-in build deliverable):** when `workflow.phase_reports.enabled` is `true`, generate the mission's self-contained per-phase HTML report **in the built tree, before staging the squash-merge** — `pan-tools report phase <N>` — so the report rides along in the merge as a phase deliverable. **Never run `report index` inside a squad worktree:** the timeline index is a single shared file that aggregates *all* phases, so a worktree would see only its own phase and concurrent squads would race on it. The index is a single-writer, post-merge concern (Phase 6). Never opens a browser.

### Phase 6 — Learn (Dreaming)
Squad summaries return to Mission Control. Run `/pan:retro --write-memory` (and `/pan:learn` if traces exist) so recurring patterns persist into agent memory for the next mission. Strike the landed item; update loop-state. For a scheduled campaign, also `pan-tools campaign record-run --items <n> --points <p>` so the next-due time and the day's spend advance.

**Rebuild the timeline index (single writer).** When `workflow.phase_reports.enabled` and `workflow.phase_reports.index` are `true`, Mission Control — and *only* Mission Control, on the integration branch after the merge has landed — rebuilds the project index once against the now-merged set of phases: `pan-tools report index`, then commit it (the commit honors `commit_docs`). Doing this post-merge from the single conductor is what keeps `report-index.html` consistent while builds run in parallel worktrees.

---

## Scheduled, self-resuming campaigns (ADR-0034)

PAN is not a daemon — it cannot wake itself while the session is closed. `--schedule` arms a campaign and lets an external trigger drive it; the human merge gate is never relaxed.

- **Arm:** `/pan:army "<goal>" --schedule daily --daily-budget 200` writes `.planning/orchestration/schedule.json` (cadence, daily budget, next-due) instead of running once.
- **The trigger (you wire one):** a host scheduler (Claude Code routines / cron / scheduled-tasks) or a `/loop` runs `pan-tools campaign due` and, when it reports due, invokes `/pan:army --continue`. On next session open, a due campaign is surfaced as a nudge.
- **Resume (`--continue`):** read the schedule + `.planning/orchestration/` + focus-auto state. If `campaign due` is true and the day's `--daily-budget` isn't spent, run the next mission(s), then `campaign record-run` (advances next-due, accrues the day's spend). If not due or budget-spent, report next-due and STOP.
- **Bounded spend:** point budgets (`--total-budget`, `--daily-budget`) are **advisory indicators by default** — they're tracked and surfaced, not hard stops, unless `budget.enforce` / `--enforce-budget` is set. The real bounds are `--max-cycles`, the conductor caps, the abort file, and the human merge gate at every integrate. A scheduled campaign runs the backlog down to staged, reviewed, green PRs over days.
- **Verify reserve:** a fraction of `--total-budget` (`--verify-reserve`, default 0.15) is held back so the closing Quality re-review isn't starved. Surfaced always via `campaign status` / `focus auto --status` (`into_verify_reserve`, `new_work_budget_remaining`); under `--enforce-budget` the run stops taking on new missions early (`budget_reserve_reached`) and spends the reserve on the final `--clean-seal` verification before the last INTEGRATE.

Manage it: `pan-tools campaign status` (active/paused, spent today, next-due), `campaign schedule --pause` / `--resume` / `--disable`.

---

## Completion contract
The campaign is complete when ANY holds: `--max-cycles` reached · backlog empty · abort file present · context < 25% · a mission cannot pass Quality and can't be cleanly reverted (HARD STOP — preserve state, report). (Budget exhaustion is advisory by default — a stop condition only when `budget.enforce`/`--enforce-budget` is set; under enforcement, crossing into the verify reserve (`budget_reserve_reached`) stops new missions but the reserved points still fund the closing re-verification.) Always run `--clean-seal` (unless omitted) after the last item.

## NEVER DO
- Let Mission Control write code, or let a squad agent spawn further agents (depth cap).
- Run two builders in the same worktree, or merge to a protected branch without the human gate.
- Force-push or rewrite history; recovery is revert / previous tag only.
- Hardcode the squad roster — read it from `pan-tools squad list`.
- Integrate a mission that hasn't passed Quality green.

## ALWAYS DO
- Plan on the session model Mission Control inherits, delegate over the Agent toolset, keep each squad's return a tight summary.
- One worktree per Build agent; parallel research/verify; serial human-gated integrate.
- Check the abort file + spawn/budget caps before every spawn.
- Finish with the clean-build seal; write learnings back to memory.

## Examples
```
/pan:army "ship the v1 reporting module" --source backlog --max-cycles 5
/pan:army "harden auth across the app" --squads architecture,build,quality --clean-seal
/pan:army "<goal>" --dry-run            # show the plan + squad delegation, no code
/pan:army --status                      # campaign progress
/pan:army --stop                        # graceful halt, state preserved
```
