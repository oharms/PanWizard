# ADR-0023: Opus 4.7 Adoption — 1M Context, Extended Thinking, Prompt Caching, Native Skills

## Status
Accepted (shipped in v2.10.0 — 2026-04-18)

## Context
PAN Wizard's architecture (through v2.9.1) was designed around Claude 3.x assumptions: 200K context windows, no native extended thinking, no prompt caching, commands delivered as slash-command `.md` files rather than discoverable skills. Opus 4.7 (GA Q2 2026) materially changes the underlying primitives:

- **1M context window** — medium codebases (up to ~700K tokens) can be ingested in a single agent call.
- **Native extended thinking** — `thinking: enabled` frontmatter with per-agent `thinking_budget`. Reasoning is visible in-band and priced per-token.
- **Prompt caching (cache_control: ephemeral)** — input blocks with stable content get a 5-minute cache TTL. Cache hits cost ~10% of cold tokens.
- **Native skills discovery** — Claude Code 1.x loads skills from `.claude/skills/*.md` with frontmatter-based trigger metadata, enabling auto-invocation.

PAN's workflow-first orchestration model made minimal use of these primitives. Competitors (Cursor 2, Windsurf, Aider) shipped multi-agent orchestration and session memory in late 2025. Without direct Opus 4.7 integration, PAN would be out-innovated on cost/latency and on workflow intelligence.

We captured the investigation in [docs/specs/opus_47_existing_enhancements_featureai.md](../specs/opus_47_existing_enhancements_featureai.md) (Spec A — 12 enhancements to existing features) and [docs/specs/opus_47_extended_features_featureai.md](../specs/opus_47_extended_features_featureai.md) (Spec B — 14 new commands/agents, deferred to v3.x).

## Decision
Ship Spec A in full as v2.10.0. Defer Spec B to v3.x as stability data arrives.

Concretely, adopt the following Opus 4.7 primitives across the existing surface:

1. **Prompt caching layer** (E-1). Single canonical set of cacheable files: `CACHEABLE_CONTEXT_FILES` = [`project.md`, `requirements.md`, `roadmap.md`, `state.md`, `standards.md`]. `buildCachedContext(cwd)` returns ordered blocks with a stable SHA for cache-key hit predictability. Commands (`plan-phase`, `exec-phase`, `verify-phase`, `focus-exec`) prime the cache once per invocation via `pan-tools cache prime --summary`.
2. **Whole-project ingest** (E-2). `/pan:map-codebase` branches on `estimateRepoTokenSize(cwd)`: single-shot mode (Opus 4.7 only) at ≤700K tokens, sharded mode (6-way parallel) above. Agent `pan-document_code` has an explicit `<mode>` block so it knows which mode it's executing in.
3. **Extended thinking** (E-3). Five verification-heavy agents enable thinking with per-agent budgets: `pan-plan-checker` (8000), `pan-verifier` (6000), `pan-integration-checker` (6000), `pan-reviewer` (4000), `pan-debugger` (8000). Installer strips these fields for non-Claude runtimes and injects a prose "think step-by-step" preamble via `translateThinkingDirective`.
4. **Agent memory layer** (E-4). New `memory.cjs` module with append-only per-agent logs at `.planning/memory/<agent>.md`. Agent-name validated against `^[a-zA-Z0-9_-]+$` to block path traversal. Compaction bounded by `DEFAULT_MAX_ENTRIES=500`. Retrospective command (`/pan:retro --write-memory`) extracts top-N gap patterns as planner lessons.
5. **Native skills shims** (E-5). Installer generates `.claude/skills/pan-<cmd>.md` for every command so host skills discovery surfaces them with frontmatter-declared descriptions.
6. **Parallel-tool execution** (E-6). `classifyStageDependencies` emits waves + a `parallelism_hint` that `focus-exec` Stage 3.0 uses to instruct parallel tool calls. `pan-executor` agent gained a `<parallel_tool_use>` block: batch reads, serialize writes.
7. **Capability-aware model routing** (E-7). `resolveModel` accepts `{context_estimate, needs_thinking, cache_warm}` hints and adjusts the profile-selected tier upward (toward reasoning) when context is large or thinking is needed, downward (toward fast) when cache is warm and context is small.
8. **Statusline & health indicators** (E-8). Statusline renders `🧠` when thinking is active and `⚡N%` when cache hit rate is known. `context-budget` reports cacheable block count, bytes, eligible percentage, and stable SHA.
9. **Installer capability detection** (E-9). `detectModelCapabilities(modelName)` classifies default model from settings.json; installer emits a post-install warning if the default model lacks features Spec A relies on.
10. **Focus-auto reflection gate** (E-10). Between cycles, `determineContinuation` emits a thinking-gated prompt that lets Opus 4.7 veto the next cycle earlier than the automatic stop rules would.
11. **Debugger hypothesis trees** (E-11). `pan-debugger` generates ≥3 hypotheses with Bayesian priors and attacks the top 2 in parallel (parallel *investigation*, not parallel *fixes*).
12. **Oldest-batch-first ordering** (E-12 — pre-existing bugfix folded into the release). `readLatestBatch` sorts ascending so an older unfinished batch executes before a newer one.

Implementation verification strategy: per-item tests, plus end-to-end scenario tests for memory persistence, skills installation, and map-codebase mode selection. Target test delta +100 to +150; actual delta was +143 (1983 → 2126).

## Consequences

### Positive
- **Cost reduction**: prompt caching saves 40-60% input tokens on multi-agent phases (measurements pending in production).
- **Better planning**: planner/verifier with extended thinking catch logic gaps before execution wastes cycles.
- **Coherent brownfield maps**: single-shot `map-codebase` eliminates stitching artifacts (contradictory version claims, missed cross-references) on repos ≤700K tokens.
- **Cross-phase learning**: memory layer makes conventions stick across phases without human re-prompting.
- **Discoverable commands**: native skills frontmatter enables host auto-invocation (e.g. "when user asks X, invoke `/pan:focus-scan`").

### Negative
- **Opus 4.7 only for best results**: single-shot `map-codebase` and extended thinking require Opus 4.7. Sonnet 4.6 / Haiku 4.5 work with degraded behavior; installer warns at install time via `detectModelCapabilities`.
- **New file on disk**: `.planning/memory/<agent>.md` files grow over time. Compaction is manual (`pan-tools memory compact <agent> [max]`) or via `/pan:retro --write-memory` bounded emission.
- **Claude-only features**: skills shims (E-5) and native thinking frontmatter (E-3) only apply to Claude Code. Non-Claude runtimes get a prose fallback for thinking; no skills shims for Codex/Gemini/OpenCode. Copilot retains its existing directory-per-skill format rather than re-using the Claude flat shim generator.
- **Spec surface growth**: `+16 tests` in the spec-required path (scenario tests under `tests/scenarios/opus-47-*`), bringing the scenario suite to 28 files.

### Neutral / Tradeoffs considered
- **Why not also ship Spec B (extended features) in v2.10?** Spec B adds 14 new commands + 9 new agents + a message bus, a roughly 3200-LOC delta. Shipping alongside Spec A would couple two independently-verifiable risk surfaces. Spec B waits for Spec A adoption telemetry (cache hit rates, thinking cost observed in practice) before committing to Wave 1 (bus, cost dashboard, architect command).
- **Why a dedicated memory module and not state.md?** state.md is per-phase and has strict schema. Memory is cross-phase, append-only, agent-scoped. Conflating them would force state.md into a role it wasn't designed for (learning log vs. execution checkpoint).
- **Why skills shims for Claude only?** Claude Code is where native skills discovery is implemented. Copilot CLI has its own skills format (directory-per-skill with `SKILL.md`) that doesn't match the flat shim shape. Reworking both runtimes to share a generator is a refactor for v3.x; the current dual implementation works.

## Implementation Notes

### Commit history
- `53c5bb5` — foundation (8 items: E-1 buildCachedContext, E-4 memory.cjs, E-9 detectModelCapabilities, E-7 resolveModel extension, E-1 cache helper, E-5 buildClaudeSkillShim, E-3 translateThinkingDirective, E-10 determineContinuation, E-6 classifyStageDependencies)
- `0f4db12` — completion (6 items: E-2 estimateRepoTokenSize, E-3 agent frontmatter, E-5 installer integration, E-8 statusline, E-9 installer integration, E-11 debugger prose)
- `21bceec` — v2.10.0 release (runtime-aware thinking strip, CLI wrappers, command integrations, version bump, CHANGELOG)
- `5fb2745` — deep integration (retro→memory, cache metrics in health, scenario tests)
- Follow-up — Spec A closeout (pan-document_code Mode, profile tier tree, 3 scenario tests, this ADR)

### Rollback plan
Spec A is additive. Rollback strategy if telemetry reveals a regression:
- **Caching**: revert `<cache_priming>` blocks in command `.md` files; `buildCachedContext` can stay in core.cjs unused.
- **Thinking**: remove `thinking:` fields from 5 agents; installer no-ops.
- **Memory**: delete `.planning/memory/` to reset; module stays.
- **Skills shims**: `rm -rf .claude/skills/pan-*.md` post-install; regenerated on next install.
- **Mode branching**: `pan-document_code` falls back to `sharded` when `mode` frontmatter is absent.

No `.planning/` schema changes; no breaking CLI contracts.

## Related

- Spec A: [opus_47_existing_enhancements_featureai.md](../specs/opus_47_existing_enhancements_featureai.md)
- Spec B: [opus_47_extended_features_featureai.md](../specs/opus_47_extended_features_featureai.md) (deferred)
- ADR-0014 (internal cleanup code quality) — baseline for the stability patterns this builds on
- ADR-0015 (focus-auto runner) — reflection gate builds on auto-runner's safety harness
- ADR-0022 (lifecycle completeness) — retro command extended here with memory write-back
