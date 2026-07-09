# ADR-0031: Backlog Source + Parallel-Research/Serial-Build/Parallel-Verify for `/pan:focus-auto`

## Status
Accepted — 2026-06-12. Folds the genuinely-new ideas from a project-local `/focus-loop` campaign command (built in the MontyHall compiler project) into the existing `/pan:focus-auto` runner, generalized and opt-in.

## Context

`/pan:focus-auto` (ADR-0015) runs continuous improvement campaigns by **scanning the codebase by category** (cleanup / tests / security / …), then looping scan → plan → exec → commit with a 5-layer safety harness and budget/context stops.

A downstream project built its own loop command, `/focus-loop`, that solved three problems focus-auto doesn't:

1. **Work selection from a curated roadmap, not a code scan.** Some campaigns work a human-prioritized backlog (an OUTSTANDING tracker, a roadmap with ranked items) rather than whatever grep finds. Scan-driven selection can't express "do the next-best item from my roadmap."
2. **Parallelized research/verify around a serial build.** The proven shape is *parallel read-only research → exactly one serial implementer/builder → parallel read-only adversarial verify*. focus-auto runs these sequentially; the Workflow tool now makes the fan-out cheap.
3. **End-of-loop integrity gate.** Per-item incremental commits can leave cross-item orphans (a symbol defined only in an uncommitted file; a combined state that doesn't build clean). A single clean-build seal at loop end, plus staging-miss and orphan audits at commit time, catch this class.

That command was **~70% identical to focus-auto** and **deeply project-specific** in its content — hardcoded item IDs, test counts, build scripts, dual-platform Windows/Linux build trees, and a "builds must be serial because two corrupt the shared tree" premise that is a property of *that* project, not a universal one. Shipping it verbatim would have been the worst runtime-agnosticism violation in PAN's command set, and a near-duplicate of an existing command.

## Decision

Adopt the three ideas as **generalized, opt-in extensions to `/pan:focus-auto`** — not a second loop command.

### 1. `--source scan|backlog` (default `scan`)

- `scan` — today's behavior: category-scoped code scan via `focus scan`.
- `backlog` — rank actionable items from PAN's existing planning surface (`roadmap.md` phase/item checkboxes, `requirements.md` REQ rows) by `(UserValue + TimeCriticality + RiskReduction) / Effort`, derived from the *current* document so the order never goes stale. No project-specific item-ID lists are ever hardcoded; the ranking reads whatever the roadmap contains.

`source` is stored in the auto-run state (`.planning/focus/auto-run.json`) and validated against `FOCUS_SOURCES`.

### 2. Optional Workflow-parallel research/verify (opt-in)

- `--parallel-research` / `--parallel-verify` — when set, the per-item research and verify stages fan out via the Workflow tool (read-only agents); the implement/exec stage stays a single agent. Default off → today's sequential behavior, so nothing changes for existing users.
- The **serial-build invariant** (at most one builder at a time) is honored only when the project declares a shared-build-tree constraint in `.planning/config.json` (`concurrency.serial_build: true`). It is **off by default** — most projects build in parallel safely. This is the key generalization: the MontyHall command treated serial-build as a universal law; PAN treats it as a per-project opt-in.

### 3. Opt-in integrity gates

- `--clean-seal` — after the loop's last item, run one clean build + full verification (commands come from `config.json → verification`/`build`, never hardcoded) to catch cross-item orphans. Off by default.
- **Staging-miss guard** and **orphan audit** at commit time — generalizable commit-quality checks (no implementer-touched file left unstaged; HEAD references no symbol defined only in an uncommitted file). These are advisory checks the runner already has the information to perform.

### What is explicitly NOT adopted

Everything project-specific from `/focus-loop`: hardcoded ADR/item IDs, test counts, build/factory scripts, dual-platform assumptions, hardcoded attribution (PAN uses `processAttribution`), and the "serial-build is mandatory" premise. The MontyHall `/focus-loop` stays a correct, project-local command — that is the right home for content that specific.

## Consequences

**Positive.** One runner gains backlog-driven campaigns and an optional parallel pipeline without a duplicate command; the new commit/seal gates improve commit quality for any project; the serial-build constraint is available to projects that need it (declared, not assumed). The pattern itself is promoted as a universal learning (`learnings/universal/`) so it informs planning even where the flags aren't used.

**Negative / risks.** focus-auto's command doc grows; the backlog ranker depends on roadmap/requirements being maintained (degrades to "no actionable items" when they aren't, which is a correct stop condition). Parallel research/verify only helps when the host runtime has the Workflow tool — it's a no-op fallback to sequential elsewhere.
