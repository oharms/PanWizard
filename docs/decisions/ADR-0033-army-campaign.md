# ADR-0033: Army Campaign — Mission Control, Worktree-per-Agent, Human-Gated Ship

## Status
Accepted — 2026-06-12. Second slice of "PAN as a bot army" (after ADR-0032 squads). Adds the campaign command that drives the squads, the branch-per-agent build substrate, the Release agent, and the conductor's campaign mode. Builds on the existing `pan-conductor` safety harness (ADR-0024 hierarchical exec) and the focus-auto loop (ADR-0015/0031).

## Context

ADR-0032 turned PAN's agents into four squads but left them inert. The bot-army model needs an orchestration that actually runs a whole-project goal through them: a coordinator that plans and delegates (never codes), squads that own lifecycle roles, parallel builders that don't collide, adversarial quality, and a human-gated path to production — looping until the goal ships, bounded by a hard harness.

PAN already has every ingredient: the conductor (Opus, delegation-only, capped), the focus-auto loop (pick→plan→exec→commit), worktree isolation (`whatif.cjs`, generalized to `worktree.cjs`), git rollback/tagging, the bus, telemetry, and memory. What was missing was the assembly: a campaign command, a Release agent, and the conductor knowing it can run at campaign scale.

## Decision

### 1. `/pan:army` campaign command

A whole-project delivery loop: Muster → Plan → Delegate → Execute → Review → Integrate → Learn, repeated until a stop condition. It composes existing machinery rather than reinventing it — `pan-tools squad list` for the roster, `focus-auto --source` for item selection, `worktree create` for parallel builds, the conductor harness for safety, `/pan:retro --write-memory` for the learn step. Arguments mirror focus-auto plus army-specific flags (`--squads`, `--no-build-worktrees`, `--clean-seal`).

### 2. Worktree-per-agent build substrate (`worktree.cjs`)

The Build squad parallelizes by giving each `pan-executor` its own `army/<task>` branch + isolated git worktree, so concurrent builders never share a working tree or a file — the structural guarantee behind safe parallel building. `army/`-prefixed and removal-guarded (won't delete a non-army branch). Off-switchable with `--no-build-worktrees` for small/serial projects. Optional `concurrency.serial_build` (ADR-0031) additionally serializes builds for trees that corrupt under concurrency.

### 3. The Release agent (`pan-release`)

Fills the Release squad's roster (ADR-0032 left it empty by design). Always-ask, never codes: it prepares the squash-merge, runs the configured verification, and surfaces a human-approval request — a person merges to the protected branch, not a bot. Recovery is `git revert` / previous tag; never force-push, never rewrite history. Registered in `MODEL_PROFILES` + `AGENT_BASE_EFFORT` (mid tier, high effort) so the parity drift test stays green.

### 4. Conductor campaign mode

`pan-conductor` gains a `<campaign_mode>` section: when invoked by `/pan:army` it is Mission Control — delegates to squads (roster resolved at runtime), parallelizes Build by worktree, gates integration through a human, and carries learnings back via retro. **Every Tier-0 cap is unchanged** — nesting depth 2, spawn/budget ceiling, abort kill-switch. The campaign is a longer loop around the same bounded core; it relaxes nothing.

## Consequences

**Positive.** PAN can now run a goal end-to-end as a coordinated army: parallel isolated builds, adversarial review, human-gated ship, learning loop — all on primitives that already shipped and are already tested. The human merge gate and worktree isolation make the scale-up safe by construction.

**Negative / risks.** Agents-spawn-agents is inherently riskier than flat exec, and a campaign runs that pattern in a long loop — which is exactly why the harness is mandatory and the spend/abort/human-merge gates are non-negotiable. The campaign command is prompt-driven (markdown), so its guarantees are only as strong as the model's adherence to the doc; the *enforced* guarantees live in code (worktree isolation, the conductor caps, the always-ask release contract, protected-branch settings). Live multi-agent verification on a real project is the remaining validation step before recommending it as a default.

## Follow-ups
- ADR-0034: scheduled "Dreaming" (put the self-improvement/retro loop on a cadence).
- Live campaign verification on a real multi-plan project; per-runtime gating (campaign mode is Claude + Opus, like hierarchical exec).
