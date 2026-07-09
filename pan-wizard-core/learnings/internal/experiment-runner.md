---
topic: experiment-runner
last_updated: 2026-05-03T03:30:13.038Z
patterns:
  - id: P-EXP-001
    summary: new-project --auto can finish all artifacts but never commit if the run ends before the workflow's commit step (1 of 5 experiments hit this)
    promoted_at: 2026-05-02T14:35:52.700Z
    source_experiments: [whoocache]
  - id: P-EXP-002
    summary: claude -p exits at phase boundaries despite --auto and prose-based DO NOT exit (v3.7.6 cross-phase YOLO continuation fix), so multi-phase autonomous runs need one invocation per phase
    promoted_at: 2026-05-02T14:35:59.399Z
    source_experiments: [whoolog, whoocache, whooflow, whooschema, whoodb]
  - id: P-EXP-003
    summary: state.md YAML frontmatter is the authoritative truth; body prose may lag after phase completion
    promoted_at: 2026-05-02T14:36:04.863Z
    source_experiments: [whooschema, whoolog, whoocache]
  - id: P-EXP-004
    summary: 30-min DEFAULT_TIMEOUT_MS is too short for typical 3-plan phases; recommend 60+ min default
    promoted_at: 2026-05-02T14:36:15.357Z
    source_experiments: [whoolog]
  - id: P-EXP-005
    summary: 4 concurrent claude -p experiment sessions run cleanly on a single machine; no TTY contention or rate-limit issues
    promoted_at: 2026-05-02T14:36:22.170Z
    source_experiments: [whoolog, whoocache, whooflow, whooschema, whoodb]
  - id: P-NPRS-005
    summary: Single experiment can ship a 24-plan / 5-phase / 346-test / 1.46MB binary milestone in ~6h cumulative agent runtime when the planner emits decision-trace + the executor honors per-plan file ownership
    promoted_at: 2026-05-03T03:30:13.038Z
    source_experiments: [notepadrs]
---

# Experiment Runner (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-EXP-001 — Missing git identity in fresh experiment folder causes silent commit failures (whoocache root cause)

**Evidence:** whoocache: 24 min of work produced project.md, requirements.md, roadmap.md, src/{cache,atomic-write,lock,...}.js — but git log empty. **Root cause** found in summary.md: "Git identity was not configured in this environment; per environment_notes the commits returned `committed: false` with `reason: 'commit_failed'`. File outputs landed on disk (the contract). Commits can be re-run later by the user once `git config user.email / user.name` are set." `pan-tools commit` returns exit-0 with `{committed: false, reason: 'commit_failed'}` — the autonomous loop sees no error and keeps going. State.md showed Phase 1 ready. Resumed phase commands committed normally from then on, after identity was set.

**Rule:** experiment scaffolding (`pan-tools experiment new`) MUST `git init` the folder AND configure `user.email` / `user.name` (inherited from PAN source repo, falling back to placeholders) so the autonomous loop's commits don't silently fail. Fixed in `experiment.cjs initExperimentGit()` v3.7.9. As a defensive layer, `new-project.md` section 8.9 also adds an end-of-workflow safety-net commit. As a hardening item, consider making `pan-tools commit` exit non-zero on `commit_failed` so callers detect the failure mode.

**Applies in:** experiment.cjs scaffolder, new-project workflow, any tooling that wraps `pan-tools commit` in a fresh git environment

## P-EXP-002 — claude -p exits at phase boundaries despite --auto and prose-based DO NOT exit (v3.7.6 cross-phase YOLO continuation fix), so multi-phase autonomous runs need one invocation per phase

**Evidence:** All 5 experiments (whoolog, whoocache, whooflow, whooschema, whoodb) exited cleanly with exit_code=0 status=incomplete at every Phase N -> Phase N+1 boundary. Each phase needed a separate experiment run --prompt invocation. Even though state.md shows current_phase advanced and last_activity says transitioned to Phase N+1, the spawned claude session ends.

**Rule:** Treat the autonomous cross-phase chain as best-effort, not guaranteed. Scripts/CI/runners should plan for one /pan:plan-phase N --auto invocation per phase. Single-invocation multi-phase runs are a stretch goal, not the contract.

**Applies in:** any autonomous multi-phase run via claude -p, codex exec, gemini -p, opencode

## P-EXP-003 — state.md YAML frontmatter is the authoritative truth; body prose may lag after phase completion

**Evidence:** whooschema after Phase 3 completion: frontmatter showed completed_phases=3 status=completed, but body still showed Current phase 1 - Foundation, Phase 1 Executed. Same pattern observed in whoolog and whoocache to lesser degree.

**Rule:** When reading state.md programmatically (from runner.cjs, status checks, harvest scripts), parse the YAML frontmatter fields (completed_phases, current_phase, status). The body's Current Position / Phase Status sections sometimes do not re-render after phase completion. Prefer frontmatter parsers over markdown text scans.

**Applies in:** runner.cjs status checks, state.md consumers, anything reading state programmatically

## P-EXP-004 — 30-min DEFAULT_TIMEOUT_MS is too short for typical 3-plan phases; recommend 60+ min default

**Evidence:** whoolog Phase 1 first run: timed out at 30:00 after Phase 1 research only (9 commits). Resumed with 90-min timeout and finished Phase 1 fully in 26 minutes. Same pattern would have killed whooflow new-project (~60 min) if that timeout had been the default.

**Rule:** DEFAULT_TIMEOUT_MS in runner.cjs should be raised from 30 min to 60 min, OR the experiment new command should set a per-experiment timeout based on roadmap.phase_count * 8 min after the new-project run. Phase 1 of whoolog (3 plans) took 26 min; whooflow (5 plans per phase) was at 35 min when killed by 30-min cap on first run. The default cuts off real work mid-phase.

**Applies in:** runner.cjs DEFAULT_TIMEOUT_MS, experiment run --timeout default

## P-EXP-005 — 4 concurrent claude -p experiment sessions run cleanly on a single machine; no TTY contention or rate-limit issues

**Evidence:** Ran whoolog Phase 2 + whoocache Phase 1 + whooflow new-project + whooschema new-project + whoodb new-project all in parallel for ~60 minutes. All 4 concurrent sessions made independent progress, no failures, no missed commits attributable to concurrency. Wall-clock time for full 5-experiment run: ~3 hours (vs ~9 hours sequential).

**Rule:** The experiment runner can safely fan out to N=4 concurrent autonomous experiments on a single workstation. The runner's stdio ['inherit', 'pipe', 'pipe'] design holds up because claude -p does not actually CONSUME stdin (only probes for TTY). API rate limits at this concurrency are not hit on Anthropic Claude Opus 4.7. Beyond N=4, untested.

**Applies in:** experiment runner, automated multi-experiment campaigns, CI

## P-NPRS-005 — Single experiment can ship a 24-plan / 5-phase / 346-test / 1.46MB binary milestone in ~6h cumulative agent runtime when the planner emits decision-trace + the executor honors per-plan file ownership

**Evidence:** notepadrs experiment 2026-05-02→03: Phase 1 (4 plans, 18 tests) ran clean; Phase 2 (4 plans, 109 tests cumulative) ran clean; Phase 3 (5 plans, multi-tab + find/replace + worker thread + epoch cancellation) timed out at 90 min on first attempt at 77% — resumed cleanly with /pan:exec-phase 3 --auto and finished in 45 min; Phase 4 (5 plans split mid-run from 4 to handle wave-2 collision) took 50 min; Phase 5 (5 plans + dogfood + ship gate) took 55 min plan + 7 min finish wrap. Total cumulative: ~6h agent time including 1 timeout. Final binary: 1.46 MB (6.86× under the 10MB ship gate); 346 tests (11.5× the 30-test floor). Plan-checker iteration revisions caught wave-2 file collisions BEFORE execution; reasoning-trace handoff via Plan Decisions / Implementation Decisions sections kept context coherent across plan-checker → executor → verifier.

**Rule:** Auto-mode multi-phase experiments DO complete v1-shippable software in roughly 1 hour per phase IF: (a) phase plan-phase produces explicit per-plan files_modified ownership AND a decisions buckets section; (b) plan-checker is allowed to iterate (split plans, revise files_modified) BEFORE execution starts; (c) timeouts are 90 min per command, not 60 min; (d) when a phase times out at >70% complete, resume with /pan:exec-phase N --auto rather than restarting plan-phase; (e) final phase wrap (write missing summary.md + verification.md, advance state) sometimes needs a separate short prompt because the auto-runner exits when state.md says 'verifying'. The 'incomplete' status with exit_code 0 means the agent left work mid-state, not that anything failed.

**Applies in:** PAN experiment-runner orchestration; the experiment.cjs runner; auto-mode workflow guidance; planner/executor handoff design
