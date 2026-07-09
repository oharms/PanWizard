# ADR-0038: Skill-Aligned Decomposition — an advisory SAD pass in phase planning

## Status

Accepted — 2026-07-09. Ships in v3.13.0. Spec: `docs/specs/skill-aligned-decomposition.md`.

Trigger: *"New Alibaba AI framework skips loading every tool, cutting agent token use 99%"* (VentureBeat, 2026-07-02), reporting **SkillWeaver** (Alibaba Cloud, arXiv 2606.18051).

## Context

SkillWeaver routes sub-tasks over a 2,209-tool MCP library via decompose → retrieve → compose. Two findings, of very different relevance to PAN:

1. **The 99% token cut does not apply here.** It exists only against a naive stuff-everything baseline (~884K tokens/query). PAN's entire skill surface (~140 command/template/reference/learnings files) is a few thousand tokens of one-line descriptions, and Claude Code already defers MCP tool schemas natively. Nothing to save.
2. **The accuracy mechanism does apply.** SkillWeaver's *Skill-Aware Decomposition* (SAD) feedback loop — draft a decomposition, retrieve loosely-matching skills, feed them back, rewrite the decomposition to match the granularity and vocabulary of skills that exist — lifted decomposition accuracy **51% → 92%**. PAN's `pan-planner` decomposes phases in exactly the one-shot pattern SkillWeaver measured: nothing checks that draft task wording lines up with the learnings topics, templates, references, and commands actually installed, so executors miss patterns that a differently-worded task would have surfaced (e.g. "handle file writes robustly" never loads `universal/atomic-state`).

ADR-0036 §"Remaining (deferred)" deferred iterative-reconstruction work "only if the minimal versions prove insufficient in the field." This ADR records a deliberate override of that deferral for the *planning-side* alignment loop specifically: built proactively on user decision (2026-07-09), justified by the smallness of the change (one module reusing shipped scoring, one advisory agent step) and bounded by the rollback criteria below.

## Decision

**1. Add an advisory SAD pass to phase planning.** New module `skill-align.cjs` + CLI `pan-tools skills index|align`. The planner drafts its task list as today, runs `skills align --draft-file <draft>`, and receives per-task top-k skill matches plus a deduped, token-budgeted vocabulary hint list. The planner (an LLM — the right place for the rewrite half of the loop) realigns task wording/granularity to the skills that exist and cites matched learnings topics in task `<action>` blocks.

**2. Keep it inside ADR-0036's yardstick.** Cue-selected (the cue is the draft task text), distilled (names + one-line descriptions, never file bodies), budget-bounded (`SKILL_ALIGN_VOCAB_BUDGET_TOKENS`, overflow reported in `dropped`, never silent), zero dependencies (reuses `scoreRelevance` from `knowledge.cjs`). No embeddings, no FAISS, no vector store — SkillWeaver's retrieval layer is exactly the index-everything shape ADR-0036 §4 forbids, and at ~140 skills a keyword scorer suffices.

**3. No persisted index.** The skill index is rebuilt per call (~140 small files, <50 ms). Deviates from both SkillWeaver's FAISS index and `learn-index.cjs`'s `index.json`; justified by scale — no staleness, no installer/manifest changes, no rebuild step.

**4. Advisory-only, fail-open, vocabulary-only.** No orchestrator step, checker dimension, or exit code depends on the pass. Missing roots (partial installs, non-Claude runtime command formats) are skipped and reported, never thrown. The planner realigns wording and granularity only — never adds tasks/scope to consume matched skills, never drops unmatched tasks.

## Alternatives considered

- **Wait for a field signal (ADR-0036's original deferral).** Overridden by user decision; the pass is small enough that the cost of building it speculatively is lower than the cost of instrumenting for the signal first. The rollback criterion below restores the deferral's spirit.
- **Embedding retrieval (SkillWeaver-faithful).** Rejected: runtime dependency, violates ADR-0036 §4, and unnecessary at ~140 skills.
- **Orchestrator-side pass (in `plan-phase.md` between planner and checker).** Rejected: plans are already written by then; the rewrite must happen inside the planner before `group_into_plans`.
- **Auto-rewriting tasks in the tool.** Rejected: deterministic code can't judge granularity; the LLM planner is already in the loop and gets the hints instead.
- **Extending `knowledge.cjs` with an `align` mode.** Rejected: `knowledge.cjs` is project-cwd-scoped Q&A; skill alignment is install-root-scoped and planning-time. A focused sibling of `learn-index.cjs` is the cleaner home.

## Consequences

- Planner task vocabulary anchors to real skill names, so executors load the right learnings topics more often — the same lever behind SkillWeaver's 51→92 jump, at PAN scale.
- One new core module, one new CLI command family, one new planner step, five constants. All shipped content stays runtime-agnostic (kinds that don't exist on a runtime index zero entries).
- **Acceptance/rollback:** watch plan-checker revision-loop iterations and `optimize trace` `plan_checker_issues` events on projects with learnings installed. If hints are consistently empty or ignored, delete the planner `skill_alignment` step (one-line revert); the CLI remains harmless.
- The fuller reasoning-driven iterative recall of ADR-0036 (cue→infer→follow→prune across turns) remains deferred; this ADR does not build it.
