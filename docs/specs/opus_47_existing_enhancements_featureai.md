---
name: Opus 4.7 Existing Feature Enhancements
type: feature-spec
status: draft
created: 2026-04-18
owner: oharms
related: [multi_model_routing_featureai.md, focus_auto_runner_featureai.md, lifecycle_completeness_featureai.md]
---

# Spec A — Opus 4.7 Enhancements to Existing PAN Features

**Scope:** Fix and enhance what already exists. No new commands, no new agents. Every change maps to an existing file in `commands/pan/`, `agents/`, `pan-wizard-core/bin/lib/`, or `bin/`.

**Guiding principle:** the installed surface stays identical (same commands, same agents, same CLI). Behavior gets faster, cheaper, and smarter by leveraging Opus 4.7 primitives (1M context, prompt caching, extended thinking, skills discovery, tool-use-first orchestration, memory).

---

## E-1. Prompt Caching Layer (Cross-Agent Cost Reduction)

**Problem.** Every agent spawn re-sends project.md + requirements.md + roadmap.md + CLAUDE.md (~15-50K input tokens) per call. In a single `/pan:exec-phase` wave that spawns 6 executors + 1 reviewer + 1 verifier, that's ~300K repeated input tokens. Opus 4.7 supports `cache_control` blocks with a 5-minute TTL.

**Change surface.**
- `pan-wizard-core/bin/lib/core.cjs` — add `buildCachedContext(cwd)` helper returning an ordered list of `{path, content, cache: true}` blocks for project.md, requirements.md, roadmap.md, state.md, standards.md (stable across agent calls in a phase).
- `pan-wizard-core/bin/lib/constants.cjs` — `CACHEABLE_CONTEXT_FILES` array.
- `agents/*.md` — each agent's preamble changes from inlined "## Project Context" dumps to a system-level cache-controlled block the host runtime injects.
- `commands/pan/exec-phase.md`, `plan-phase.md`, `verify-phase.md`, `focus-exec.md` — add a `## Cache Priming` stage that runs once per command invocation to warm the cache, then all sub-agent calls within 5 minutes read from cache.

**Runtime compatibility.**
- Claude runtime: uses `cache_control` natively.
- Codex/Gemini/OpenCode/Copilot: each host has its own cache semantics or none. Shipped agent/command files declare cacheable blocks via a `<!-- cache:stable -->` marker the installer strips/translates per runtime.

**Expected impact.** 40-60% input-token reduction across exec-phase. Measured via new `pan-tools stats cache-savings --phase N`.

**Test additions.**
- `tests/cache-priming.test.cjs` — verify buildCachedContext returns stable SHA of all context files.
- `tests/scenarios/cache-warm-cold.test.cjs` — simulate two agent calls within TTL, assert second call's input-token counter is lower.

---

## E-2. Whole-Project Ingest in `map-codebase`

**Problem.** `/pan:map-codebase` today spawns 6 parallel `pan-document_code` agents each with a 200K budget, each covering a slice of the repo. Outputs are stitched post-hoc and often contradict each other (one says "React 18", another says "React 19" because they read different lockfiles). With Opus 4.7's 1M context, medium codebases (≤800K tokens) fit in a single agent.

**Change surface.**
- `pan-wizard-core/bin/lib/codebase.cjs` — add `estimateRepoTokenSize(cwd, opts)` using the existing CHARS_PER_TOKEN constant + gitignore-aware walk.
- `agents/pan-document_code.md` — add a `## Mode` section: `single-shot` (repo fits in 1M) vs `sharded` (current 6-way parallel). Threshold at 700K tokens (leaves headroom).
- `commands/pan/map-codebase.md` — new Stage 0 that calls `pan-tools codebase estimate-size` and picks mode.

**Runtime compatibility.** Opus 4.7 only for single-shot. Sonnet/Haiku and non-Claude runtimes always take the sharded path.

**Expected impact.** On the typical PAN-sized project (~400K tokens), replaces 6 agent calls with 1 — 6× cost reduction and zero stitching artifacts. For large monorepos, falls back to current behavior.

**Test additions.**
- `tests/codebase.test.cjs` — `estimateRepoTokenSize()` returns under-estimate within 20% of actual.
- `tests/scenarios/map-codebase-single-shot.test.cjs` — small temp repo, assert mode=single-shot.
- `tests/scenarios/map-codebase-sharded-fallback.test.cjs` — simulated large repo, mode=sharded.

---

## E-3. Extended Thinking for Verification-Heavy Agents

**Problem.** `pan-plan-checker`, `pan-verifier`, `pan-integration-checker`, `pan-reviewer` all do *judgment* work. They benefit most from Opus 4.7's interleaved thinking (reasoning before tool calls). Today they answer inline without reflection, leading to rubber-stamp verifications (the v2.8.0 retrospective flagged this as a recurring pattern).

**Change surface.**
- `agents/pan-plan-checker.md`, `pan-verifier.md`, `pan-integration-checker.md`, `pan-reviewer.md` — add `thinking: enabled` and a `thinking_budget: 8000` field in frontmatter. Each agent's opening instruction changes from "Analyze this plan" to "Think step-by-step, then report".
- `pan-wizard-core/bin/lib/constants.cjs` — `THINKING_BUDGETS` map per agent type.
- `bin/install-lib.cjs` — add `translateThinkingDirective(runtime, budget)` converting the frontmatter field into runtime-specific syntax (Claude: native; Codex: `<thinking>` block prompt; Gemini: system prompt prefix).

**Runtime compatibility.** Claude native; others use prompt-level "think step by step" fallback.

**Expected impact.** Targeted: plan-checker catches ≥30% more logic gaps pre-execution (measured by comparing pre-exec vs post-exec rework rates). Verifier false-positives drop.

**Test additions.**
- `tests/frontmatter.test.cjs` — `thinking` field round-trips.
- `tests/install-lib.test.cjs` — translateThinkingDirective() per runtime.

---

## E-4. Agent Memory Layer (Cross-Phase Learning)

**Problem.** PAN's only cross-agent memory today is state.md + phase summaries. Every planner starts from zero. Opus 4.7 has native memory; PAN should register persistent memory per agent scope.

**Change surface.**
- New module: `pan-wizard-core/bin/lib/memory.cjs` (sibling to state.cjs). Exports: `readMemory(cwd, agent)`, `appendMemory(cwd, agent, entry)`, `compactMemory(cwd, agent, maxEntries)`.
- New directory: `.planning/memory/<agent-name>.md` — one file per agent, append-only log of "learned patterns" with timestamps.
- Each agent's prompt reads `.planning/memory/<self>.md` at start and is instructed to append a single-line "lesson" at end (via a new `pan-tools memory append <agent> <text>` CLI path).
- `commands/pan/retro.md` — after milestone, extract top-N lessons per agent and write to memory.

**Runtime compatibility.** All 5 runtimes — this is a file-based mechanism, not an API-level memory.

**Expected impact.** Planner references "we decided on pattern X in phase 4" in phase 9's plan without a human restating it.

**Test additions.**
- `tests/memory.test.cjs` — 10 test cases covering append/read/compact + schema validation.
- `tests/scenarios/memory-across-phases.test.cjs` — E2E: run 2 phases, verify second phase's planner reads first phase's memory.

---

## E-5. Native Skills Registration (Claude Code Host Integration)

**Problem.** Claude Code 1.x now loads skills from `.claude/skills/` (per the in-conversation skill list we observe at session start). PAN installs commands to `.claude/commands/pan/`, which Claude Code treats as slash commands — but doesn't expose them as skills-with-descriptions to other agents or to the user's available-skills list.

**Change surface.**
- `bin/install.js` — when target is `--claude`, also write a shim `.claude/skills/pan-<cmd>.md` for each command with the `name:`, `description:`, `trigger:` frontmatter matching Claude Code's skill schema. The shim body delegates to the existing `commands/pan/<cmd>.md`.
- `bin/install-lib.cjs` — new exported function `buildClaudeSkillShim(commandFrontmatter)`.
- For Copilot runtime: already uses `.github/skills/` — re-use identical shim generator.

**Runtime compatibility.** Claude + Copilot only (both use skills dir). Codex/Gemini/OpenCode use their own command model — unchanged.

**Expected impact.** PAN commands appear in Claude Code's skill list with descriptions, making auto-invocation possible ("when the user asks X, invoke pan:focus-scan").

**Test additions.**
- `tests/install-lib.test.cjs` — buildClaudeSkillShim() produces valid YAML frontmatter with name/description/trigger.
- `tests/scenarios/claude-skills-installed.test.cjs` — after install, `.claude/skills/pan-*.md` count equals `commands/pan/*.md` count.

---

## E-6. Parallel-Tool Plan Execution in `focus-exec`

**Problem.** `focus-exec`'s 6-stage pipeline runs stages sequentially even when stages are independent (Stage 3 prep + Stage 4 wave-1 planning can overlap). Opus 4.7 is markedly better at emitting parallel tool calls in a single assistant turn.

**Change surface.**
- `commands/pan/focus-exec.md` — rewrite Stage 3-4 section to explicitly instruct "emit all independent read/analyze tools in one turn".
- `pan-wizard-core/bin/lib/focus.cjs` — new helper `classifyStageDependencies(items)` returns a DAG so the command template can generate the right instructions.
- `agents/pan-executor.md` — add explicit parallel-tool-use encouragement block.

**Runtime compatibility.** Claude Code + Opus: full benefit. Others: instructions are harmless prose.

**Expected impact.** `focus-exec` wall-clock latency drops ~25% on multi-item batches.

**Test additions.**
- `tests/focus.test.cjs` — `classifyStageDependencies()` returns correct DAG for mixed-tier batches.

---

## E-7. Model Routing Extension — Cache & Think Tiers

**Problem.** The v2.9.0 multi-model router has tiers (reasoning/mid/fast) but doesn't factor in *cache warmth* or *thinking-required*. A planner call with warm cache + thinking is a different cost/quality profile than a cold mid-tier call.

**Change surface.**
- `pan-wizard-core/bin/lib/core.cjs` — extend `resolveModel(task, opts)` with new opts: `cache_warm: bool`, `needs_thinking: bool`, `context_estimate: number`.
- Logic:
  - `context_estimate > 700K` → Opus 4.7 (only model with 1M).
  - `needs_thinking` → Opus 4.7 or Sonnet 4.6 with extended-thinking.
  - `cache_warm && !needs_thinking && context_estimate < 50K` → Haiku 4.5.
- `.planning/config.json` — new `model_routing.tiers` section with defaults.
- `commands/pan/profile.md` — extend to show tier decision tree.

**Runtime compatibility.** Routing happens in core.cjs — runtime-agnostic. Non-Claude runtimes use their own tier aliases (already plumbed in v2.9.0).

**Test additions.**
- `tests/core.test.cjs` — `resolveModel()` truth table: 12 combinations of (ctx, thinking, cache).

---

## E-8. `pan-statusline` — Cache & Thinking Indicators

**Problem.** The statusline shows `model | task | dir | context %` today. Opus 4.7 workflows have two new signals users should see: cache-hit rate and whether an agent is currently thinking.

**Change surface.**
- `hooks/pan-statusline.js` — read two new fields from stdin JSON: `cache_hit_rate_pct`, `thinking_active`. Render as `🧠` when thinking, `⚡N%` for cache hits.
- `pan-wizard-core/bin/lib/context-budget.cjs` — extend health report to include cache metrics.

**Runtime compatibility.** Claude only (other runtimes don't run hooks).

**Test additions.**
- `tests/statusline.test.cjs` — 4 new test cases for the new fields.

---

## E-9. Installer — Opus 4.7 Detection & Warnings

**Problem.** Features E-1, E-2, E-3, E-6 give materially better results on Opus 4.7 vs older models. The installer should detect the user's default model and warn if they're on an older one for features that require it.

**Change surface.**
- `bin/install.js` — after settings.json is written, detect current `model` field. If set to an older Opus/Sonnet and user didn't pass `--skip-warnings`, print a yellow notice: "PAN 2.10+ is tuned for Opus 4.7. You're on X. Features E-1,E-2,E-3,E-6 degrade gracefully but benefit from upgrade."
- `bin/install-lib.cjs` — new `detectModelCapabilities(modelName)` pure function returning `{has_1m_ctx, has_thinking, has_cache}`.

**Test additions.**
- `tests/install-lib.test.cjs` — 6 cases across model strings.

---

## E-10. Focus-Auto — Interleaved Thinking Between Cycles

**Problem.** `focus-auto` loops scan→plan→exec. Between cycles it consults hardcoded stop-reason rules (max_cycles, zero_completed, regression). Opus 4.7's thinking mode can evaluate *whether the next cycle will be productive* before committing to it.

**Change surface.**
- `pan-wizard-core/bin/lib/focus.cjs` — new `determineContinuation(run, cycle, proposedNextBatch)` that emits a reasoning prompt consumed by the orchestrator agent before it calls `focus-plan` again.
- `commands/pan/focus-auto.md` — new Stage between cycle-N-complete and cycle-N+1-start: "Reflection gate" with thinking.
- `pan-wizard-core/bin/lib/constants.cjs` — `REFLECTION_THRESHOLD` (default: enabled on Opus, disabled otherwise).

**Test additions.**
- `tests/focus.test.cjs` — `determineContinuation()` emits valid prompt, respects threshold.

---

## E-11. `pan-debugger` — Chain-of-Thought Hypothesis Trees

**Problem.** The debugger agent today uses the scientific method but emits hypotheses linearly. With thinking mode, it can explore a hypothesis tree in a single turn (generate 3, rank, test top).

**Change surface.**
- `agents/pan-debugger.md` — restructure the `## Investigation Protocol` section: replace "form hypothesis → test → refine" linear flow with "think through 3 hypotheses → rank by Bayesian prior → attack top 2 in parallel (parallel tool calls)".

**Test additions.** Behavioral test via scenario: `tests/scenarios/debugger-parallel-hypotheses.test.cjs`.

---

## E-12. Fix: Oldest-Batch-First in `focus-exec` (shipped in this branch)

Already applied: `readLatestBatch()` now sorts ascending. Kept here for completeness — this is a bugfix that fits Spec A's "fix existing features" mandate.

---

## Files to Create/Modify Summary (Spec A)

| Category | Files | Count |
|----------|-------|-------|
| Core modules modified | core.cjs, codebase.cjs, focus.cjs, context-budget.cjs, constants.cjs | 5 |
| Core modules new | memory.cjs | 1 |
| Agents modified | all 12 | 12 |
| Commands modified | exec-phase, plan-phase, verify-phase, focus-exec, focus-auto, map-codebase, retro, profile | 8 |
| Hooks modified | pan-statusline.js | 1 |
| Installer | install.js, install-lib.cjs | 2 |
| Tests new | 11 new test files | 11 |
| Docs | ARCHITECTURE.md, USER-GUIDE.md, new ADR-0023 (Opus 4.7 adoption) | 3 |

**Estimated test count delta:** +90 to +110 tests.

**Estimated LOC impact:** ~800 LOC added (core + tests), ~200 LOC deleted (redundant context-dumping in agents).

---

## Implementation Order (Recommended)

1. E-1 (caching — foundation, biggest cost win)
2. E-4 (memory — foundation, unlocks learning)
3. E-3 (thinking — highest quality impact per LOC)
4. E-7 (routing extension — glues E-1+E-3 into model choice)
5. E-2 (single-shot map-codebase)
6. E-5 (skills registration — Claude Code integration)
7. E-10, E-11 (focus-auto reflection, debugger hypotheses)
8. E-6 (parallel-tool execution)
9. E-8, E-9 (UX polish)
10. E-12 (already shipped)

Each item is 1-3 days of focused work. Full Spec A ~6 weeks calendar.
