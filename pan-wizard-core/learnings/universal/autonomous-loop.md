---
topic: autonomous-loop
last_updated: 2026-06-28T00:00:00.000Z
patterns:
  - id: P-310
    summary: Autonomous build loops should fan out research and verify in parallel but keep implement/build a single serial step, then seal with one clean build at loop end
    promoted_at: 2026-06-12T00:00:00.000Z
    source_experiments: [montyhall-focus-loop]
  - id: P-350
    summary: In a parallel campaign, review a branch against its merge-base (three-dot / fork-sha diff), never two-dot main..HEAD, or a moved base produces phantom deletions and false blocks
    promoted_at: 2026-06-28T00:00:00.000Z
    source_experiments: [compliance-army-v1.1]
  - id: P-360
    summary: Campaign telemetry must be both captured (active per-step record, not just the passive hook) and trustworthy (never naive-sum a shared-session transcript — cumulative-per-turn cache-read over-counts by orders of magnitude)
    promoted_at: 2026-06-28T00:00:00.000Z
    source_experiments: [compliance-army-v1.1, lending-focus-auto, forecasting-exec]
---

# Autonomous Loop (AI-derived)

> Hand-promoted from a downstream `/focus-loop` campaign command (MontyHall compiler project) and generalized in ADR-0031. Patterns are **advisory** — orchestrators weight them against current context.

## P-310 — Parallel-research → single-serial-build → parallel-verify, then clean-seal

**Evidence:** A backlog-driven autonomous loop that landed many items per run converged on this shape (the "cc#67/cc#68" discipline): research and verification are read-only and parallelize cheaply via the Workflow tool, but the implement/build step mutates shared state and must be a *single* serial actor. Per-item incremental commits twice produced cross-item orphans — a symbol defined only in an uncommitted file, or a combined state that didn't build clean — which only a from-scratch build at loop end caught.

**Rule:** For any pick → build → verify → commit → repeat loop:

1. **Fan out research in parallel** (read-only agents): map the substrate, scope the honest-partial boundary, probe for support. Mutate nothing.
2. **Implement/build is exactly ONE serial actor** — never inside a `parallel()`. If the project's build trees corrupt under concurrency, enforce at-most-one-builder across the whole loop (a per-project opt-in, not a universal law).
3. **Fan out verify in parallel** (read-only) over the already-built tree: correctness / security / honesty lenses.
4. **Commit-quality gates:** a *staging-miss guard* (no implementer-touched file left unstaged — never `git add -A`, never a hand-picked subset) and an *orphan audit* (HEAD references no symbol defined only in an uncommitted file).
5. **Clean-build seal once at loop end:** per-item builds are incremental for speed; a single from-scratch build + full verification after the last item catches cross-item orphans the incremental builds hid.
6. **Rank the backlog from the CURRENT document** (value/effort), never a frozen ID list, so the order never goes stale; honest-partial aggressively and strike only what landed.

**Applies in:** `/pan:focus-auto` (`--source backlog`, `--parallel-research`/`--parallel-verify`/`--clean-seal`; ADR-0031), any Workflow-orchestrated build campaign, hierarchical exec (`pan-conductor`).

## P-330 — Scale agents into a coordinated army with squads, worktree isolation, and a human-gated ship

**Evidence:** The bot-army model (ADR-0032/0033) showed the durable shape for running a whole-project goal across many agents: a delegation-only coordinator (never codes) fans work to role-scoped *squads* (architecture/build/quality/release), the build squad parallelizes by giving each agent its own branch + git worktree (so concurrent builders never touch the same file), quality is adversarial and read-only, and the path to a protected branch is a human-approved gate, not a bot merge.

**Rule:** When scaling beyond a single agent:

1. **Coordinator delegates, never codes** — its tools are delegation-only; it plans, decomposes, and routes to squads, then aggregates tight summaries.
2. **Group agents into role-scoped squads with least-privilege tools** — design read-only, build read/write, quality read-only/adversarial, release always-ask. Resolve the roster from data, not hardcoded prompt lists.
3. **Parallelize by isolation, not by hope** — one branch + worktree per concurrent builder; never two agents in one tree. Serialize builds only where the build tree corrupts under concurrency (a per-project opt-in).
4. **The mutating boundary is human-gated** — merging to a protected branch is `always-ask`; recovery is revert / previous tag, never force-push or history rewrite.
5. **The harness scales with the army, not after it** — depth caps, spawn/budget ceilings, and an abort kill-switch checked before every spawn are mandatory; a longer loop must not relax a single cap. Power and safety are the same investment.

**Applies in:** `/pan:army` (ADR-0033), `pan-conductor` campaign mode, `squads.cjs` / `worktree.cjs`, any multi-agent delivery.

## P-340 — Schedule autonomy as a due-check the host fires, not a daemon you embed

**Evidence:** Making the army run over days (ADR-0034) surfaced the right boundary for a prompt-driven tool that lives inside a host session: it cannot wake itself while the session is closed, and pretending to (an embedded scheduler/daemon spawning agents in the background) is both a false promise and a security surface. The durable design split ownership — PAN owns the schedule *descriptor* and the *decision whether a run is due*; the host scheduler owns *firing* it.

**Rule:** For "run X automatically over time" in a session-bound agent:

1. **Persist a schedule descriptor, not a timer** — cadence, next-due, per-day budget, enabled/paused — in project state.
2. **Expose a cheap, side-effect-free `due` check** the external trigger polls; make the *reason* explicit (`not_yet` / `paused` / `budget_exhausted_today` / `due`) so skips are auditable.
3. **Let the host fire it** — cron / routines / a session loop / a next-open nudge — rather than embedding a background daemon.
4. **Resume from persisted state**, advancing next-due and accruing per-day spend on each run; cap the day, not just the run.
5. **Never let a schedule lower an irreversible-action gate** — scheduled or not, the human approves the merge. Autonomy extends up to the irreversible step, never through it.

**Applies in:** `campaign.cjs` + `/pan:army --schedule` (ADR-0034), any cron/`/loop`-driven PAN automation, the self-improvement loop on a cadence.

## P-350 — Review a worktree branch against its merge-base, never two-dot, when the base moves

**Evidence:** In the first production army campaign (the compliance project v1.1, 6 missions), a Quality squad **BLOCK was a false positive**: the reviewer diffed `main..HEAD` (two-dot) *after* an earlier parallel mission had merged and advanced `main` past the reviewed mission's fork point — so the already-merged mission's additions appeared as **phantom deletions** in the diff. The block was disproven only by re-diffing against the merge-base. A false block burns a whole cycle; the mirror case (phantom additions hiding a genuine deletion) can wave a bad change through a gate.

**Rule:** Whenever you review or merge a branch whose base can advance under it (every parallel campaign):

1. **Diff against the merge-base, not the moved tip** — `git diff <fork-sha>..HEAD`, or three-dot `git diff main...HEAD`. Never two-dot `main..HEAD`.
2. **Stamp the fork sha at worktree-creation time** so review and release always carry the correct base instead of recomputing it from a `main` that has since moved.
3. **A surprising diff is a base smell first** — large phantom deletions/additions of code the mission never touched means "wrong diff base," not "bad change." Re-check the base before trusting any verdict built on it.

**Applies in:** `pan-reviewer` / `pan-hardener` / `pan-integration-checker`, the `/pan:army` Quality + Release steps, `worktree.cjs` (record base sha), any parallel-branch review or merge.

## P-360 — Campaign telemetry must be both captured and trustworthy

**Evidence:** Three production projects showed campaign telemetry failing in *both* directions. (1) **Absent** — a full 5-mission army campaign (the compliance project v1.1) produced **zero** cost/trace/bus records, although the hooks were installed, registered on `SubagentStop`, and verified working in isolation; a main-loop coordinator's work never fired `SubagentStop`, so nothing was captured. (2) **Corrupted** — two projects that *did* capture (a weeks-long focus-auto loop and a phase-exec project) logged physically-impossible figures: a single subagent record claiming billions of cache-read tokens, cache-hit pinned at 100%, and many byte-identical rows. Root cause: the transcript fallback summed `usage` across *every* assistant message in a transcript whose `session_id` is shared by all subagents — so each event re-summed the whole growing transcript, and `cache_read` (re-read every turn) multiplied by the turn count. Either way the HUD, `/pan:cost`, and `/pan:optimize` consumed nothing usable.

**Rule:** For any long-running, multi-step autonomous campaign, telemetry must survive the spawn pattern *and* be numerically sane:

1. **Don't make load-bearing observability depend on a passive hook.** Subagent-stop events fire only for spawned subagents; a main-loop orchestrator's own tokens — and some headless runtimes — never trigger them.
2. **Record per-step telemetry actively** at the Learn step — tokens (an estimate is fine), duration, role, outcome — via an explicit metrics-append, so capture survives any spawn pattern.
3. **Never naive-sum a transcript to attribute one actor's usage.** Subagents share the parent session id, so summing all matching messages on every event counts the whole (growing) transcript repeatedly; cumulative-per-turn cache-read then explodes. Attribute per-event *deltas* (a high-water mark), prefer the event's own usage payload, and dedup identical writes.
4. **Sanity-check before you trust the number.** A cache-hit pinned at 100%, or cache-read far exceeding input, is a miscount — not a triumph. Cap or flag implausible records instead of aggregating them.
5. **Preflight a telemetry probe** at campaign start (write then read one record); treat empty *or* absurd telemetry as a defect, not a quiet state.

**Applies in:** `/pan:army` Phase 0 + Learn step, `pan-conductor` campaign mode, `hooks/pan-cost-logger.js` + `pan-trace-logger.js`, the HUD telemetry panels, `/pan:cost`, `/pan:optimize`.
