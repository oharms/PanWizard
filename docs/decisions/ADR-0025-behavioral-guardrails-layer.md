# ADR-0025: Behavioral Guardrails Layer (v3.6.0)

## Status
Accepted (shipped 2026-04-27)

## Context

PAN Wizard's structural systems — phases, milestones, focus, plans — are mature, but anti-patterns (silent model swaps, skipping verification, manual scaffolding, scope creep) were addressed implicitly across many workflow files without a single consolidated rules surface. AI agents executing PAN workflows would routinely make context-pressured shortcuts that had to be re-corrected per session: silent model selection drift, skipping `/pan:verify-phase` because "tests passed locally," manually picking focus items instead of letting `focus.cjs` allocate by budget. Each correction was cheap individually; aggregated across sessions, it became the dominant source of rework.

Review of Google's `agents-cli` (a CLI + skills package that injects ADK development workflows into Claude Code, Gemini CLI, Codex, and others — see `docs/specs/googlecli_adoption_featureai.md`) surfaced three patterns worth adopting:

1. **A consolidated guardrails reference** — one short file naming the top anti-patterns, code preservation rules, and the stop-the-line regression rule
2. **Phase-gated re-read directives** in long workflows — explicit "re-read section X before phase Y" markers that resist context compaction drift
3. **A mandatory Phase 0 clarify gate** before scaffolding new work

Three other patterns were considered and either deferred or skipped (see "Explicit deferrals" below).

## Decision

Ship the behavioral guardrails layer as v3.6.0 — additive only, zero breaking changes. The layer consists of:

### 1. New reference doc: `pan-wizard-core/references/guardrails.md`

A single ~58-line doc consolidating:

- **Common Shortcuts to Resist** — 5-row table naming anti-patterns with rationale and correct action
- **Code Preservation Principle** — surgical-edit doctrine; preserve config values, comments, formatting outside the user's explicit target
- **Stop-the-Line Rule** — regressions halt feature work
- **Systematic Debugging Sequence** — reproduce → localize → fix one variable → verify → guard
- **Cross-References** — pointers to `tdd.md`, `verification-patterns.md`, `checkpoints.md`, and the workflows that consume guardrails

The reference ships to all 5 runtimes via the existing `references/` install path. No installer logic changes.

### 2. Re-Read Checkpoints in 4 long workflows

Each long workflow (`exec-phase.md`, `plan-phase.md`, `verify-phase.md`, `execute-plan.md`) gains a `## Re-Read Checkpoints` section near the top with a 4-row table mapping "before this step" → "re-read this" → "why." Pattern resists context compaction drift across long autonomous sessions.

### 3. Phase 0 Clarify Gate

`new-project.md` gets a **MANDATORY** Phase 0 gate with 4 questions (problem / success / scope / constraints) the agent must get answered before scaffolding. `plan-phase.md` gets a lighter "recommended" Phase 0 with 3 phase-scoped questions.

### 4. Workflow + agent cross-references to `guardrails.md`

The 4 long workflows and 2 agents (`pan-reviewer`, `pan-planner`) now reference `guardrails.md` in their required-reading or role sections. Agents are instructed to flag Code Preservation violations at high severity.

### Spec adjustment recorded here

The original spec (`googlecli_adoption_featureai.md`) listed `focus-exec.md` as the 4th target workflow for Re-Read Checkpoints. `focus-exec.md` is a *command file* (`commands/pan/focus-exec.md`), not a workflow. The 4th workflow target is **`execute-plan.md`** (448 lines), the next-longest workflow after exec-phase, plan-phase, and verify-phase. `focus-exec` as a command will get re-read directives in a future patch if needed; not in v3.6.0.

### Explicit deferrals (documented, not shipped)

- **`pan-tools info` command** — overlap with `state json` and `validate health` is high. Deferred to v3.6.1 prototype-first; ship as new command only if prototype shows ≤80% overlap, otherwise fold into `state json --full`.
- **Frontmatter `requires`/`related` schema** — defer until a concrete consumer (dispatcher precondition checks or doc generator) justifies the 50+ command backfill cost.
- **LLM-as-judge eval framework** — different problem domain; PAN tests code workflows, not agent behavior. 100+ pt effort with no demand signal.
- **Tool-level enforcement of Phase 0** — workflow text is the right enforcement layer; tool-level blocks add brittleness.
- **`npx skills add` distribution model** — PAN's installer is feature-complete; switching is cosmetic.

## Consequences

### Positive

- **One consolidated rules surface.** AI agents have a single grep-friendly file to consult instead of inferring rules from scattered workflow prose.
- **Zero breaking changes.** All edits are additive; no existing command, workflow, or test changes behavior. Existing v3.5.x installs upgrading to v3.6.0 receive new files via standard `pan update`.
- **Compounds across runtimes.** `references/` ships identically to all 5 runtime install paths (`.claude/`, `.codex/`, `.gemini/`, `.opencode/`, `.github/`). One file, five runtimes, zero installer changes.
- **Compounds across sessions.** The cost of writing guardrails.md is one-time; the benefit of resisting silent model swaps and skipped verification accrues every future AI session.
- **Test count grew.** 2567 → 2588 (+21 new tests: 16 unit across 4 new test files + 5 scenario across all 5 runtimes).
- **Pattern is reusable.** The `references/<topic>.md` + workflow-cross-reference pattern can host future behavioral layers without growing the workflow surface.

### Negative

- **AI agents may treat guardrails as advisory.** Workflow text is the enforcement layer; an agent that decides to skip Phase 0 or ignore "Stop-the-Line" cannot be hard-blocked at the tool level. Mitigation: workflow text uses "MANDATORY, do not skip" and "Do NOT proceed" framings. Agents that have ingested guardrails.md and the workflow consistently follow it; agents that haven't won't.
- **Re-read directives feel naggy if read literally.** The 4-row table at the top of each long workflow could be ignored by agents that skim. Net positive even when ignored — agents that *do* re-read avoid drift.
- **Phase 0 gate adds friction for small projects.** `new-project.md`'s 4-question gate is overhead for trivial scaffolding. Mitigation: `--auto` mode short-circuits the gate when a PRD/idea document is provided. The gate is meant for the 80% case where users haven't yet articulated requirements.
- **Spec/implementation mismatch on workflow target.** The original spec named `focus-exec.md` as a workflow target, but it's a command. Documented above; minor.
- **Maintenance debt.** `guardrails.md` will drift out of sync with actual workflows over time. Mitigation: future `/pan:doc-audit` runs should include guardrails references in their checks.

### Neutral / Tradeoffs considered

- **Why not enforce guardrails at tool-level (e.g., `pan-tools` blocks commits with "skip-tests" flags)?** Workflow text is the right enforcement layer. Tool-level blocks become brittleness when an agent encounters a legitimate edge case the tool author didn't anticipate. AI judgment + textual rules > rigid tool-level gates.
- **Why ≤80 lines for guardrails.md?** Context budget. The doc is referenced by ~6 workflow/agent files. If it bloats to 200 lines, it crowds out plan content in the agent's context window. 58 lines proved sufficient for the rule set; future additions should preserve this discipline.
- **Why a single doc instead of per-rule files?** Discoverability. One filename, one URL, one path to remember. Splitting (`code-preservation.md`, `stop-the-line.md`, `shortcuts.md`) fragments and dilutes the surface.
- **Why include `pan-reviewer` and `pan-planner` but not other agents?** These two are the highest-leverage entry points: planner generates the work, reviewer validates it. Other agents (`pan-executor`, `pan-tester`, etc.) inherit guardrails transitively via the workflows that spawn them. Adding the reference to all 20 agents would dilute the value.

## Implementation Notes

### Files added (8)
- `pan-wizard-core/references/guardrails.md` — the anchor doc
- `tests/guardrails.test.cjs` — 4 unit tests
- `tests/workflows-checkpoints.test.cjs` — 4 unit tests
- `tests/guardrails-references.test.cjs` — 6 unit tests
- `tests/phase0-gate.test.cjs` — 2 unit tests
- `tests/scenarios/guardrails-installed.test.cjs` — 5 scenario tests (one per runtime)
- `docs/decisions/ADR-0025-behavioral-guardrails-layer.md` — this ADR
- `docs/specs/googlecli_adoption_featureai.md` — the source spec (committed alongside)

### Files modified (9)
- `pan-wizard-core/workflows/exec-phase.md` — Re-Read Checkpoints + guardrails reference
- `pan-wizard-core/workflows/plan-phase.md` — Re-Read Checkpoints + guardrails reference + Phase 0 (recommended)
- `pan-wizard-core/workflows/verify-phase.md` — Re-Read Checkpoints + guardrails reference
- `pan-wizard-core/workflows/execute-plan.md` — Re-Read Checkpoints + guardrails reference
- `pan-wizard-core/workflows/new-project.md` — Phase 0 (MANDATORY) + guardrails reference
- `agents/pan-reviewer.md` — guardrails reference + flag-Code-Preservation directive
- `agents/pan-planner.md` — guardrails reference + must-enforce-in-deviation-rules directive
- `package.json` — version 3.5.2 → 3.6.0
- `CHANGELOG.md` — v3.6.0 entry

### Test deltas
- Unit: 2302 → 2318 (+16, 4 new test files)
- Scenario: 265 → 270 (+5, one per runtime)
- Total: **2567 → 2588** (+21)

### Rollback plan
The layer is entirely additive. Rollback strategy if telemetry reveals a regression:
- Remove `references/guardrails.md` — workflows referencing it will resolve to "file not found" but won't fail the workflow logic
- Remove the `## Re-Read Checkpoints` and `## Phase 0` sections from the 5 workflow files — they're plain markdown, no behavior depends on them
- Remove the `**Read also:**` lines from the 2 agent files
- Remove the 5 new test files
- No schema or manifest changes; rollback is a commit-level revert

### References
- Source spec: `docs/specs/googlecli_adoption_featureai.md` (created 2026-04-27)
- Ancestor pattern: `docs/specs/ai_drift_prevention_featureai.md` (Mar 2026)
- External pattern source: Google `agents-cli` workflow SKILL.md (`d:\googlecli\agents-cli\skills\google-agents-cli-workflow\SKILL.md` lines 242-325)

## Future scope

- **v3.6.1 prototype**: `pan-tools info` self-discovery command — measure overlap with `state json`, ship or fold accordingly
- **v3.7+**: Frontmatter `requires`/`related` schema — only if a concrete consumer (dispatcher precondition checks or auto-generated docs) emerges
- **Doc-audit integration**: future `/pan:doc-audit` runs should verify guardrails references resolve and the 5 listed shortcuts are still the right top-5
