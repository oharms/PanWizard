# ADR-0046: Newer Claude Code subagent frontmatter — what PAN adopts, and what it declines

## Status

Accepted — 2026-09-10. A decision record, not a feature: four fields are declined with reasons, and the one capability PAN does want (a longer prompt-cache lifetime for subagents) is delivered as a **recommendation from measured data** rather than as emitted frontmatter. Plan items 7a/7b of `docs/specs/market-delta-2026-09-superplan.md`.

## Context

Claude Code's subagent frontmatter grew a set of fields PAN's agents do not use: `maxTurns` (now yielding partial, resumable output — 2.1.246/2.1.259), `memory` (`user` / `project` / `local` scopes), `isolation: worktree`, `skills:` preload, `experimental.cacheTtl` (2.1.248), and the `fork` spawn mode that inherits the parent's context and cache. The August review listed them as "unadopted"; this record decides each on its merits. Two constraints frame every decision:

- **PAN's quality guarantee is that every agent starts from zero context and reads its inputs from disk.** Anything that trades that for convenience changes the thing PAN sells.
- **ADR-0028's frontmatter rule:** a field is emitted only where a runtime has been seen to read it, and PAN ships the same agents to five runtimes. A Claude-only field must be stripped for the other four and must earn its place on Claude.

## Decisions

**D1 — `maxTurns`: declined as a shipped default.** PAN agents run whole protocols — a planner writes a complete plan set, a verifier walks every success criterion. A turn cap mid-protocol leaves a half-written artifact on disk that the next hop will read as finished; the "partial + resume" contract only helps when the *orchestrator* notices the partial flag and resumes, and PAN's orchestrators are markdown prose — exactly the layer PanLoop finding 0 showed drops steps at its lowest-context moment. Revisit when a native workflow owns the orchestration, where honouring a partial result and re-issuing the agent is a mechanical step the script cannot skim past. Budgeting remains the `budget` profile's job (cheaper tiers, not fewer turns).

**D2 — `memory`: declined.** PAN already has two memory surfaces with explicit curation rules: `.planning/memory/*.md` (project rules injected into executor prompts, verified by the reviewer) and the learnings store with its `learn promote` gate. A third, agent-private memory that Claude Code curates by its own rules — and that only exists on one runtime — would diverge from those two and be invisible to PAN's hygiene and drift checks. If per-agent recall is wanted, it belongs in `.planning/memory/` where every runtime and every check can see it.

**D3 — `isolation: worktree`: declined for the shipped agents.** The execution protocol requires the executor to commit to the project's branch and to update `state.md`, `roadmap.md` and `summary.md` where the orchestrator and the verifier will read them; an executor in a private worktree would leave those on a branch the main checkout cannot see. Where PAN wants isolation it already has it, with explicit naming and teardown: `worktree.cjs` and the `army/<task>` branches (ADR-0033, P-1815). Two isolation mechanisms with different cleanup rules is the class of defect P-1815 closed.

**D4 — `skills:` preload: declined.** The field injects each listed skill's *full body* into the agent at startup. PAN's agents already instruct the model to read project skills from `.agents/skills/` when they exist, which loads only what a task needs. Preloading would put every listed body into every agent call — the opposite of the cached-context discipline ADR-0044 imposed.

**D5 — `experimental.cacheTtl` and `subagentPromptCacheTtl`: recommend, do not emit.** The one-hour lifetime is worth having for a phase whose agents are spaced more than five minutes apart, and worthless for a burst that never idles; one-hour writes bill at 2× base input against 1.25×. PAN cannot know which pattern a project has — but its cost ledger can. `context-budget` now reports `cache.ttl` (cache writes that followed an idle gap of five to sixty minutes, the misses a one-hour lifetime would have avoided) and hygiene raises an `info` finding naming the setting when the pattern recurs. The user makes the trade with the numbers in front of them. Emitting `experimental.cacheTtl: 1h` on selected agents was considered and rejected: it is marked experimental, it would need stripping on four runtimes, and it hard-codes a cost decision that varies per project.

**D6 — `fork` spawn mode: declined for the planning chain, allowed nowhere by default.** Forking inherits the parent's full conversation and cache. That is the inverse of PAN's fresh-context guarantee for the planner, executor, verifier and reviewer. It suits a cheap same-context follow-up and nothing in PAN's chain is that.

## Consequences

- Nothing is emitted; ADR-0028's rule is untouched. The plan's item 7b ("adopt whatever 7a accepts") closes with no adoption, by decision rather than omission.
- The cache-lifetime capability arrives as data (`cache.ttl`) plus a documented setting, so the recommendation improves as the ledger grows and is wrong for nobody.
- D1 names its own revisit trigger: native workflows owning orchestration. When `pan-exec-waves` or a successor runs executors, a `maxTurns` on those spawns with a scripted re-issue is the right shape, and this record should be superseded for that path.
- **`2026-09-26` — the trigger fired, and D1 still stands.** `pan-exec-waves` (3.28.0) owns the executor spawns, so market-ideas queue item M9 took the revisit up. The Workflow tool's `agent()` takes `label`, `phase`, `schema`, `model`, `effort`, `isolation` and `agentType` — no turn cap per spawn (the workflow-authoring reference, read that day). The only other place for `maxTurns` is `pan-executor`'s frontmatter, and a cap there binds every executor spawn, the markdown `exec-phase` path included — exactly what D1 declined. So nothing ships; revisit when the engine offers a per-spawn cap, or if PAN ever emits a wave-only executor agent for the native path.

## Alternatives considered

- Emit `maxTurns` only on read-only agents (researcher, verifier). Rejected: a verifier cut off mid-criteria writes a verification file that reads as complete.
- Emit `memory: project` on `pan-reviewer` to accumulate recurring findings. Rejected in favour of `.planning/memory/` — same benefit, visible to hygiene and to all five runtimes.
- Emit `experimental.cacheTtl: 1h` on `pan-executor` and `pan-verifier`. Rejected per D5.
