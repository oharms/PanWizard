# featureAI: Google `agents-cli` Adoption — Behavioral Guardrails & Workflow Hardening

> **Generated**: 2026-04-27
> **Mode**: `--full` (all phases)
> **Source project**: `d:\googlecli\agents-cli` (Google ADK skills CLI for Gemini Enterprise)
> **Feature bundle**: 5 transferable patterns; v3.6.0 ships #1, #2, #5; #3 prototype-first; #4 deferred
> **Target version**: v3.6.0
> **Predecessors**: focus_auto_runner_featureai.md (focus system), ai_drift_prevention_featureai.md (existing guardrail surface)

---

## Phase 0: Problem Framing

### 0.1 Problem Statement

PAN Wizard's structural systems — phases, milestones, focus, plans — are mature, but the project lacks a **consolidated behavioral rules surface** for AI agents. Anti-patterns (silent model swaps, skipping verification, manual scaffolding, scope creep) are addressed implicitly across many workflow files but are not named, named-and-named, and centrally referenced. After reviewing Google's `agents-cli` (a CLI + skills package that injects ADK development workflows into Claude Code, Gemini CLI, Codex, and others), three patterns stand out as cheap, high-ROI adoptions for PAN:

1. **A consolidated guardrails reference** — one short file naming the top anti-patterns, code preservation rules, and the stop-the-line regression rule
2. **Phase-gated re-read directives** in long workflows — explicit "re-read section X before phase Y" markers that resist context compaction drift
3. **A mandatory Phase 0 clarify gate** before scaffolding new work — already implicit in PAN's `requirements.md` but not enforced by workflow text

This matters NOW because: (a) PAN Wizard has just shipped v3.5.x focused on doc/manifest hardening — the codebase is stable enough for a behavioral layer, (b) all 5 runtimes share the `pan-wizard-core/references/` directory, so a single new reference doc reaches every install with zero installer logic changes, and (c) AI agents are increasingly trusted with multi-cycle autonomous work via `/pan:focus-auto` (Session 26), where unchecked shortcuts compound across cycles.

The cost of NOT building this: AI agents continue to make context-pressured shortcuts that have to be re-corrected per session — silent model selection drift, skipping `/pan:verify-phase` because "tests passed locally," manually picking focus items instead of letting `focus.cjs` allocate by budget. Each correction is cheap individually; aggregated across sessions, it becomes the dominant source of rework.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|---------------|--------|---------|
| **External pattern validation** | `d:\googlecli\agents-cli\skills\google-agents-cli-workflow\SKILL.md:242-325` | Google ships explicit "Common Shortcuts to Resist", "Code Preservation Principle", "Stop-the-Line Rule" sections. Validates the pattern is field-tested at scale |
| **Internal scattered surface** | `pan-wizard-core/workflows/*.md` (33 files) | Anti-patterns currently distributed across exec-phase.md, plan-phase.md, focus-exec.md, verify-phase.md without a single consolidated home |
| **Existing reference infrastructure** | `pan-wizard-core/references/*.md` (13 files) | The reference-include mechanism already exists and ships to all 5 runtimes — adding one more file is a known-cost operation |
| **AI drift specifically called out** | `docs/specs/ai_drift_prevention_featureai.md` | PAN already recognizes drift as a problem worth a feature spec — this proposal extends that thread with a Google-validated pattern |
| **Long-running autonomous mode** | `focus_auto_runner_featureai.md` (Session 26, ADR-0015) | `/pan:focus-auto` runs multi-cycle campaigns autonomously. Behavioral guardrails matter most when the human isn't between cycles |

**Demand status**: STRONG — external pattern validation + existing reference infrastructure + adjacent feature alignment.

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Behavioral guardrails reference (`references/guardrails.md`) | LLM-as-judge eval framework — different problem domain (Google evals *agent behavior*; PAN tests *code workflows*); 100+ pt effort with unclear demand |
| Phase-gated re-read checkpoints in 4 long workflows | Re-read directives in every workflow — only worthwhile in workflows >300 lines or with multiple phases |
| Phase 0 clarify gate strengthening in `new-project.md` and `plan-phase.md` | Hard-blocking the gate via tool refusal — workflow text is the right enforcement layer; tool-level blocks add brittleness |
| Optional `pan-tools info` self-discovery command | Replacing existing `state json` / `validate health` — `info` is composition only; if it duplicates, fold into `state json --full` |
| Cross-references from 4 workflows + 2 agents to guardrails.md | Frontmatter `requires`/`related` schema (#4) — defer until a concrete consumer (dispatcher checks, doc generator) justifies the 50+ command backfill cost |
| Tests asserting structural presence in all 5 runtime install dirs | Tests asserting AI agent behavioral compliance — out of scope for unit tests; belongs in scenario tests if anywhere |
| Documentation updates in USER-GUIDE.md and ARCHITECTURE.md | New top-level docs — additive, not architectural |

### 0.4 Success Criteria (Measurable)

```
SC-1: pan-wizard-core/references/guardrails.md exists, ≤80 lines, ships to all 5 runtimes
SC-2: 4 long workflows (exec-phase, plan-phase, verify-phase, focus-exec) reference guardrails.md
SC-3: 2 agents (pan-reviewer, pan-planner) reference guardrails.md in body
SC-4: 4 long workflows have a "## Re-Read Checkpoints" section with ≥3 entries each
SC-5: new-project.md and plan-phase.md have a "## Phase 0 — Clarify (MANDATORY)" section
SC-6: ≥15 new tests pass; 0 regressions in existing 2567 tests
SC-7: All 5 runtimes pass scenario tests (claude, codex, gemini, opencode, github copilot)
SC-8: Installer time delta ≤ 5ms (new files total < 5KB)
SC-9: (Optional, only if #3 ships) `pan-tools info` returns valid JSON in ≤200ms across all 5 runtimes
SC-10: CHANGELOG.md, USER-GUIDE.md, ARCHITECTURE.md updated for v3.6.0
```

### 0.5 User Stories

```
As a PAN Wizard user running multi-cycle autonomous campaigns via /pan:focus-auto,
I want my AI agent to refuse the Top 5 shortcuts (skipping verify-phase, silent model
swaps, manual focus item picking, scope creep, marking docs-lag-okay),
so that quality gates aren't bypassed under cycle pressure,
instead of having to re-correct the agent on every session start.

As a PAN Wizard user starting a long phase that may span multiple AI sessions,
I want the workflow to force the agent to re-read its conventions before each
sub-phase (writing tests, committing, completing),
so that context compaction doesn't quietly drop my project standards mid-task,
instead of producing inconsistent code as the conversation grows.

As a PAN Wizard user starting a new project or planning a complex phase,
I want the workflow to require the agent to ask me 4 specific questions and save
the answers to requirements.md before scaffolding code,
so that the agent doesn't guess at intent and produce wasted scaffolding,
instead of having to redo work after I clarify what I actually wanted.

As a PAN Wizard user debugging a confusing pan-tools failure,
I want one command (pan-tools info) that prints install path, version, manifest,
runtime detection, and current project state in JSON,
so that the AI agent has a known starting point for diagnosis,
instead of grepping the project to locate PAN's install directory.
```

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Map

PAN Wizard already has equivalents for several `agents-cli` features. The proposal targets only the gaps:

| `agents-cli` capability | PAN Wizard equivalent | Status | Action |
|-------------------------|-----------------------|--------|--------|
| Phase 0–7 lifecycle | Milestone → phase → focus pipeline | ✅ Equivalent or stronger | None |
| `scaffold create/enhance/upgrade` | `pan init`, `phase add/insert/remove`, `milestone-new` | ✅ Equivalent | None |
| `agents-cli info` | `state json`, `validate health` (partial) | 🟡 Gap | Prototype #3 |
| `DESIGN_SPEC.md` mandatory gate | `requirements.md`, `project_spec_*.md` (no enforcement) | 🟡 Gap | #5 — strengthen |
| Phase-gated skill re-loading | Workflow files referenced by commands once | 🟡 Gap | #2 — add re-read checkpoints |
| LLM-as-judge eval | `pan-reviewer` agent + `phase-tests` (code review only) | 🟡 Different domain | Skip — not in scope |
| Code Preservation Principle | None as explicit named rule | ❌ Gap | #1 — guardrails.md |
| Common Shortcuts to Resist | Implicit in individual workflows | ❌ Gap | #1 — guardrails.md |
| Stop-the-Line regression rule | None as explicit rule | ❌ Gap | #1 — guardrails.md |
| Skill cross-references in frontmatter | Loose prose links | 🟡 Gap | Defer #4 to v3.7+ |
| Reference samples library | None — N/A | — | Skip — no analog |

### 1.2 Codebase Search

| Target | Where to Look | Notes |
|--------|---------------|-------|
| Reference doc shipping | `bin/install-lib.cjs`, `pan-wizard-core/references/*.md` | Already 13 files; new files auto-shipped via glob |
| Workflow file convention | `pan-wizard-core/workflows/*.md` | 33 files; consistent markdown-frontmatter format |
| Agent file convention | `agents/*.md` | 20 files; consistent format |
| Frontmatter parser | `pan-wizard-core/bin/lib/frontmatter.cjs` | Existing — only need extension if #4 ships |
| `state json` output | `pan-wizard-core/bin/lib/state.cjs` (`cmdStateJson`) | Reference for `info` JSON shape |
| `validate health` | `pan-wizard-core/bin/lib/verify.cjs` | Reference for self-check pattern |
| Manifest format | `pan-file-manifest.json` (in installed dir) | New files must appear in manifest checksum |
| Test helper patterns | `tests/helpers.cjs` (`runPanTools`, `createScenarioRunner`) | Use `createScenarioRunner` for cross-runtime tests |

### 1.3 Runtime Compatibility

All proposals are runtime-agnostic. The `references/` directory is shipped identically to:

| Runtime | Install path | Reference path |
|---------|--------------|----------------|
| Claude  | `.claude/pan-wizard-core/` | `.claude/pan-wizard-core/references/guardrails.md` |
| Codex   | `.codex/pan-wizard-core/` | `.codex/pan-wizard-core/references/guardrails.md` |
| Gemini  | `.gemini/pan-wizard-core/` | `.gemini/pan-wizard-core/references/guardrails.md` |
| OpenCode | `.opencode/pan-wizard-core/` | `.opencode/pan-wizard-core/references/guardrails.md` |
| GitHub Copilot | `.github/pan-wizard-core/` | `.github/pan-wizard-core/references/guardrails.md` |

No installer changes required for #1, #2, #5. Optional `info` command (#3) needs registration in `pan-tools.cjs` dispatcher and a new `commands/pan/info.md` runtime adapter.

---

## Phase 2: Competitive / Source Analysis

### 2.1 What `agents-cli` Does Well (Transferable)

**Consolidated rules surface.** Rather than scattering anti-patterns across 7 skill files, `agents-cli` collects them in one workflow skill with a named, tabular "Common Shortcuts to Resist" section. Reference: `d:\googlecli\agents-cli\skills\google-agents-cli-workflow\SKILL.md:242-251`. The table format is grep-friendly and copy-pasteable into agent context.

**Phase-gated re-load.** The workflow skill explicitly tells agents to re-read related skills *before* each phase, not after they hit a problem (SKILL.md:33-46). This counters the silent context-compaction failure mode where agents trust stale memory.

**Mandatory Phase 0 with concrete questions.** SKILL.md:82-99 lists 4 always-ask questions plus context-conditional questions. The agent is forbidden to proceed without answers. PAN's `requirements.md` exists but has no equivalent gate text.

**Code preservation as an explicit principle.** SKILL.md:253-282 names it Principle 1, gives a worked example showing a model-version drift mistake, and explicitly enumerates what must be preserved (`model`, `api_key`, comments, formatting). PAN has no equivalent.

**Stop-the-line regression rule.** SKILL.md:325 — "If a change breaks something that was working: stop feature work and fix the regression first." Short, memorable, enforceable in workflow text.

**`info` self-discovery.** A single command prints install path, project config, version. Cited use case: when an agent hits a confusing CLI failure, `info` collapses 3-5 grep/glob calls into one (SKILL.md:394-400). Even if 70% of `info`'s data exists in `state json` today, the convenience and the install-path discovery are net new.

### 2.2 What `agents-cli` Does That We Should NOT Adopt

**LLM-as-judge eval framework.** Solves agent-behavior validation. PAN tests code workflows, not agent behavior. The infrastructure cost (evalsets, rubrics, judge models, trajectory scoring) is 100+ pts with no demand signal in PAN's session history.

**`npx skills add` distribution model.** PAN's installer (`bin/install.js`, ~2,050 LOC) is feature-complete with manifest tracking, runtime adapters, and update flow. Switching distribution mechanisms is cosmetic and breaks the existing `pan update` UX.

**Reference samples library (ADK samples).** ADK has a curated repo of working agent examples that users clone and study before scaffolding. PAN has no analog and no strong demand for one. Maintaining example projects adds drift risk.

**Hard eval-gates-deployment rule.** PAN doesn't have a "deploy" step. The closest analog is `verify-phase` blocking phase completion on test pass — which already exists.

**Strict programmatic mode (UsageError if flags missing).** PAN's CLI is interactive-friendly by design (`focus-auto` prompts, `init` walks the user through). Forcing strict mode breaks the UX.

### 2.3 Differentiation

PAN keeps its core differentiators (zero runtime deps, 5-runtime support, milestone/phase/focus pipeline, scenario-tested across runtimes). What we adopt is purely the **behavioral injection surface** — a missing layer that complements, not replaces, structural workflow.

---

## Phase 3: Design

### 3.1 Adoption Candidates Ranked by ROI

| # | Name | Effort | Risk | ROI | Decision |
|---|------|--------|------|-----|----------|
| 1 | Behavioral Guardrails Preamble (`references/guardrails.md`) | S (4-6 pts) | Low | High | **Ship in v3.6.0** |
| 2 | Phase-Gated Re-Read Directives in workflows | XS (3 pts) | Low | High | **Ship in v3.6.0** |
| 3 | `pan-tools info` self-discovery command | S (5-7 pts) | Medium (overlap risk with `state json`) | Medium | **Prototype first** — ship if non-redundant |
| 4 | Frontmatter `requires`/`related` schema | L (15-20 pts) | Medium | Low (no consumer yet) | **Defer to v3.7+** |
| 5 | DESIGN_SPEC Phase 0 Gate Strengthening | XS (2-3 pts) | Low | Medium | **Ship in v3.6.0** |

**Recommended v3.6.0 bundle: #1 + #2 + #5 (10-12 pts total).**

### 3.2 Detailed Design — #1 Behavioral Guardrails Preamble

**Location:** `pan-wizard-core/references/guardrails.md`
**Size budget:** ≤80 lines (keeps agent context bloat negligible when referenced)
**Audience:** AI agents executing PAN workflows — not human users

**Proposed contents (full draft):**

```markdown
# AI Agent Guardrails for PAN Wizard

This document is read by AI agents (Claude, Codex, Gemini, OpenCode, Copilot)
executing PAN workflows. It encodes rules that prevent the most common
shortcut failures observed across 35+ development sessions.

## Common Shortcuts to Resist

| Shortcut | Why it fails | Correct action |
|----------|--------------|----------------|
| "User's request is clear, no need to clarify" | You're guessing at intent. Phase 0 catches misunderstandings before scaffolding. | Run the Phase 0 4-question check (see `new-project.md` / `plan-phase.md`). |
| "Phase tests passed locally, /pan:verify-phase isn't needed" | One run isn't validation. verify-phase checks state consistency, doc sync, blockers, and full suite — not just the phase's own tests. | Always run `/pan:verify-phase` before marking a phase complete. |
| "I'll skip /pan:focus-scan and pick the next item myself" | Manual selection ignores priority/budget logic in `focus.cjs`. You'll bias toward easy items and miss higher-priority work. | Use `/pan:focus-scan` → `/pan:focus-plan` → `/pan:focus-exec`. |
| "I'll bump the model / add a flag / refactor while I'm here" | Scope creep. The user asked for one change; surrounding cleanup belongs in a separate item. | Do only the requested change. Note unrelated cleanup as a TODO for a future focus-scan. |
| "I'll mark this phase complete; the docs can lag behind" | Doc/state drift compounds. By the next session, the agent reads stale docs and proceeds on false assumptions. | Run `/pan:sync` before phase completion. CHANGELOG and version bumps are part of the phase, not after it. |

## Code Preservation Principle

Code modifications require surgical precision — alter only the lines directly
targeted by the user's request. Strictly preserve all surrounding code.

Before finalizing any edit, verify:
1. **Target identification** — the exact lines to change, based solely on the user's instructions
2. **Preservation check** — all code, config values (model, version, api_key), comments, and formatting outside the target are identical

If you must touch surrounding code (e.g., to fix an import a rename broke),
name it explicitly in your reply: "Also updating import in X because the
rename broke it." Never silently expand scope.

## Stop-the-Line Rule

If a change breaks something that was working: **stop feature work and fix
the regression first.** Do not push forward with "I'll circle back" — regressions
compound across sessions and become 10x harder to localize later.

A failing test, a broken command, or a manifest-checksum mismatch is a
stop-the-line event. Resume feature work only after the line is restored.

## Systematic Debugging Sequence

When something breaks, follow this sequence — don't shotgun fixes:

1. **Reproduce** — exact failing command, full error output
2. **Localize** — narrow to module, config, or environment
3. **Fix one variable at a time** — changing instruction + tool + config simultaneously means you won't know what fixed it
4. **Verify** — rerun the exact reproduction command
5. **Guard** — if the bug was non-obvious, add a test to catch regressions

## Cross-References

- `references/standards.md` — coding conventions (test patterns, error handling, path normalization)
- `workflows/exec-phase.md` — phase execution checklist
- `workflows/verify-phase.md` — phase completion validation
- `workflows/focus-exec.md` — focus item execution
```

**Workflows that reference this doc** (added line near top of each):
```markdown
> **Read first:** `references/guardrails.md` — anti-patterns and code preservation rules. Re-read at the start of every phase.
```

- `pan-wizard-core/workflows/exec-phase.md`
- `pan-wizard-core/workflows/plan-phase.md`
- `pan-wizard-core/workflows/verify-phase.md`
- `pan-wizard-core/workflows/focus-exec.md`
- `pan-wizard-core/workflows/focus-auto.md` (if exists; verify path)

**Agents that reference this doc** (added in agent body, after frontmatter):
- `agents/pan-reviewer.md`
- `agents/pan-planner.md`

### 3.3 Detailed Design — #2 Phase-Gated Re-Read Directives

**Pattern:** Add a `## Re-Read Checkpoints` section near the top of each long workflow, listing 3-5 boundaries where the agent should re-read a specific section before proceeding.

**Template** (insert at top of each target workflow):

```markdown
## Re-Read Checkpoints

Context compaction may have dropped earlier sections. Re-read the relevant
section *before* you begin each step — not after you hit a problem.

| Before this step | Re-read | Why |
|------------------|---------|-----|
| Writing code | This workflow's "Implementation" section | Conventions drift across long sessions |
| Writing tests | `references/standards.md` | Test patterns vary by module type (unit vs scenario) |
| Committing | `references/guardrails.md` | Pre-commit shortcuts are tempting under pressure |
| Marking phase complete | `workflows/verify-phase.md` | Completion criteria are easy to misremember |
```

**Targets** (4 long workflows >200 lines):
- `pan-wizard-core/workflows/exec-phase.md`
- `pan-wizard-core/workflows/plan-phase.md`
- `pan-wizard-core/workflows/verify-phase.md`
- `pan-wizard-core/workflows/focus-exec.md`

**Customization per workflow:** The "Before this step" column adapts to the workflow's actual phases. The general pattern (re-read at boundaries) is constant.

### 3.4 Detailed Design — #5 Phase 0 Clarify Gate Strengthening

**Files modified:**
- `pan-wizard-core/workflows/new-project.md`
- `pan-wizard-core/workflows/plan-phase.md`

**Insertion text (top of `new-project.md`, hard form):**

```markdown
## Phase 0 — Clarify (MANDATORY, do not skip)

Before scaffolding or coding anything, confirm with the user:

1. **What problem will this solve?** — Core purpose, not the implementation
2. **What does success look like?** — Concrete, measurable outcomes
3. **What's in scope vs out of scope?** — Boundary definition
4. **Constraints?** — Tech stack, dependencies, deadlines, runtime support requirements

**Do NOT proceed** until the user has answered. Do not assume, research, or
fill in blanks yourself. The user's intent drives everything — skipping this
step leads to wasted scaffolding and mis-aligned implementation.

Save answers to `.planning/requirements.md` (or update if exists). Confirm
with the user before scaffolding.
```

**Insertion text (top of `plan-phase.md`, lighter form):**

```markdown
## Phase 0 — Clarify Phase Scope (recommended)

Before drafting the phase plan, confirm:

1. **What does "complete" look like for this phase?**
2. **What's deliberately out of scope?**
3. **Any constraints or dependencies on other phases?**

If the answers aren't already in `.planning/requirements.md` or the phase
context file, ask the user. A 2-minute clarification prevents 30-minute rework.
```

### 3.5 Detailed Design — #3 `pan-tools info` (Prototype-First, Optional)

**⚠ Prototype before committing.** Verify the output isn't fully redundant with `state json` + `validate health`. If 80%+ overlap, fold into `state json --full` instead of adding a new command.

**Proposed JSON shape:**

```json
{
  "pan_version": "3.6.0",
  "node_version": "v20.11.0",
  "platform": "win32",
  "install": {
    "root": "/abs/path/to/.claude/pan-wizard-core",
    "manifest": "/abs/path/to/.claude/pan-file-manifest.json",
    "manifest_checksum_ok": true
  },
  "runtimes_detected": ["claude", "codex"],
  "project": {
    "exists": true,
    "planning_dir": ".planning/",
    "current_phase": "03-ui-polish",
    "current_milestone": "v3.6.0",
    "model_profile": "balanced",
    "config_path": ".planning/config.json"
  },
  "git": {
    "branch": "main",
    "clean": true,
    "ahead": 0,
    "behind": 0
  }
}
```

**Files to create:**
- `pan-wizard-core/bin/lib/info.cjs` — composes data from `state.cjs`, `config.cjs`, `git.cjs`, `verify.cjs`
- `commands/pan/info.md` — runtime adapter exposing `/pan:info`
- `tests/info.test.cjs`

**Files to modify:**
- `pan-wizard-core/bin/pan-tools.cjs` — register `info` subcommand

### 3.6 Implementation Plan (v3.6.0 bundle)

| Step | File | Change | Effort |
|------|------|--------|--------|
| 1 | `pan-wizard-core/references/guardrails.md` | Create — full text from §3.2 | S |
| 2 | `pan-wizard-core/workflows/exec-phase.md` | Add Re-Read Checkpoints + guardrails reference | XS |
| 3 | `pan-wizard-core/workflows/plan-phase.md` | Add Re-Read Checkpoints + guardrails reference + Phase 0 gate | XS |
| 4 | `pan-wizard-core/workflows/verify-phase.md` | Add Re-Read Checkpoints + guardrails reference | XS |
| 5 | `pan-wizard-core/workflows/focus-exec.md` | Add Re-Read Checkpoints + guardrails reference | XS |
| 6 | `pan-wizard-core/workflows/new-project.md` | Add Phase 0 mandatory gate | XS |
| 7 | `agents/pan-reviewer.md` | Add guardrails reference in body | XS |
| 8 | `agents/pan-planner.md` | Add guardrails reference in body | XS |
| 9 | `tests/guardrails.test.cjs` | Create — file present + content shape | S |
| 10 | `tests/workflows-checkpoints.test.cjs` | Create — Re-Read sections in 4 workflows | S |
| 11 | `tests/phase0-gate.test.cjs` | Create — Phase 0 sections in 2 workflows | XS |
| 12 | `tests/scenarios/guardrails-installed.test.cjs` | Create — file ships to all 5 runtimes | S |
| 13 | `bin/install-lib.cjs` | Verify references glob includes new file (likely no change) | XS |
| 14 | `package.json` | Bump version to 3.6.0 | XS |
| 15 | `CHANGELOG.md` | Add v3.6.0 entry | XS |
| 16 | `docs/USER-GUIDE.md` | Add "AI Agent Guardrails" section | XS |
| 17 | `docs/ARCHITECTURE.md` | Note `references/` directory's behavioral role | XS |
| 18 | (Optional #3) `pan-wizard-core/bin/lib/info.cjs` + tests + dispatcher reg + command file | All for `info` | S |

**Total v3.6.0 (without #3):** ~10-12 pts
**Total v3.6.0 (with #3):** ~15-19 pts

### 3.7 Test Plan

Minimum 15 new tests across the bundle. Distribution:

#### Unit tests (`tests/*.test.cjs`)

**`tests/guardrails.test.cjs`** (4 tests)
- `references/guardrails.md` exists at expected source path
- File is non-empty and ≤120 lines (allow 50% slack from 80-line target)
- Contains required headings: "Common Shortcuts to Resist", "Code Preservation Principle", "Stop-the-Line Rule"
- Contains required cross-references: `references/standards.md`, `workflows/exec-phase.md`, `workflows/verify-phase.md`

**`tests/workflows-checkpoints.test.cjs`** (4 tests)
- `exec-phase.md` contains `## Re-Read Checkpoints` section
- `plan-phase.md` contains `## Re-Read Checkpoints` section
- `verify-phase.md` contains `## Re-Read Checkpoints` section
- `focus-exec.md` contains `## Re-Read Checkpoints` section

**`tests/guardrails-references.test.cjs`** (6 tests)
- `exec-phase.md` references `references/guardrails.md`
- `plan-phase.md` references `references/guardrails.md`
- `verify-phase.md` references `references/guardrails.md`
- `focus-exec.md` references `references/guardrails.md`
- `agents/pan-reviewer.md` references `references/guardrails.md`
- `agents/pan-planner.md` references `references/guardrails.md`

**`tests/phase0-gate.test.cjs`** (2 tests)
- `new-project.md` contains `## Phase 0 — Clarify (MANDATORY` heading
- `plan-phase.md` contains `## Phase 0 — Clarify Phase Scope` heading

#### Scenario tests (`tests/scenarios/*.test.cjs`)

**`tests/scenarios/guardrails-installed.test.cjs`** (5 tests, one per runtime)
- After `createScenarioRunner('claude')`, `references/guardrails.md` exists in install dir
- Same for codex, gemini, opencode, copilot
- Use existing `createScenarioRunner` helper from `tests/helpers.cjs`

#### Optional — if #3 ships (`tests/info.test.cjs`, 5+ tests)
- `pan-tools info` returns valid JSON with required keys
- Returns `project.exists: false` when not in a planning dir
- Returns `git.clean: true` for clean repo, `false` for dirty
- Returns correct `pan_version` matching `package.json`
- Completes in <200ms (`assert(elapsed < 200)`)

**Test count target:** 16 new tests (without #3) → 21 with #3.

### 3.8 Documentation Updates

**`CHANGELOG.md`** — new entry:
```markdown
## v3.6.0 — 2026-MM-DD

### Added
- `references/guardrails.md` — consolidated AI agent behavioral rules (anti-patterns, Code Preservation, Stop-the-Line)
- Phase-gated re-read checkpoints in 4 long workflows (exec-phase, plan-phase, verify-phase, focus-exec)
- Mandatory Phase 0 clarify gate in new-project.md and plan-phase.md
- (Optional) `pan-tools info` — self-discovery command returning install path, version, project config

### Changed
- `pan-reviewer` and `pan-planner` agents now reference `references/guardrails.md`
```

**`docs/USER-GUIDE.md`** — new section:
```markdown
## AI Agent Guardrails

PAN Wizard ships `references/guardrails.md` — a consolidated rules doc that
all PAN workflows reference. It encodes anti-patterns (silent model swaps,
skipping verification, scope creep), the Code Preservation Principle, and
the Stop-the-Line regression rule.

This document is read by your AI coding agent (Claude, Codex, Gemini,
OpenCode, Copilot) at the start of each phase. You don't need to interact
with it directly, but you can review it at `.claude/pan-wizard-core/references/guardrails.md`
(or the equivalent path for your runtime).
```

**`docs/ARCHITECTURE.md`** — update existing references section:
```markdown
The `references/` directory ships behavioral and structural reference docs
that PAN workflows include by relative path. As of v3.6.0, this includes
`guardrails.md` for AI behavioral rules — a layer that complements the
structural workflow files in `workflows/`.
```

### 3.9 Runtime Matrix

| Runtime | Supported | Install path | Notes |
|---------|-----------|--------------|-------|
| Claude  | ✅ | `.claude/pan-wizard-core/references/guardrails.md` | Existing references include path; CLAUDE.md ingestion auto-loads on relevant prompts |
| Codex   | ✅ | `.codex/pan-wizard-core/references/guardrails.md` | AGENTS.md ingestion auto-loads |
| Gemini  | ✅ | `.gemini/pan-wizard-core/references/guardrails.md` | GEMINI.md ingestion auto-loads |
| OpenCode | ✅ | `.opencode/pan-wizard-core/references/guardrails.md` | AGENTS.md ingestion auto-loads |
| GitHub Copilot | ✅ | `.github/pan-wizard-core/references/guardrails.md` | copilot-instructions.md ingestion |

All 5 runtimes already ship the `references/` directory. The new file is purely additive content — no installer logic changes, no manifest schema changes, no runtime adapter changes.

---

## Phase 4: Specification Output (Ready-to-Implement)

### Files to Create
1. `pan-wizard-core/references/guardrails.md` — full text per §3.2
2. `tests/guardrails.test.cjs` — 4 unit tests
3. `tests/workflows-checkpoints.test.cjs` — 4 unit tests
4. `tests/guardrails-references.test.cjs` — 6 unit tests
5. `tests/phase0-gate.test.cjs` — 2 unit tests
6. `tests/scenarios/guardrails-installed.test.cjs` — 5 scenario tests
7. *(Optional #3)* `pan-wizard-core/bin/lib/info.cjs`
8. *(Optional #3)* `commands/pan/info.md`
9. *(Optional #3)* `tests/info.test.cjs`

### Files to Modify
1. `pan-wizard-core/workflows/exec-phase.md` — Re-Read Checkpoints section + guardrails reference
2. `pan-wizard-core/workflows/plan-phase.md` — Re-Read Checkpoints + guardrails reference + Phase 0 gate
3. `pan-wizard-core/workflows/verify-phase.md` — Re-Read Checkpoints + guardrails reference
4. `pan-wizard-core/workflows/focus-exec.md` — Re-Read Checkpoints + guardrails reference
5. `pan-wizard-core/workflows/new-project.md` — Phase 0 mandatory gate
6. `agents/pan-reviewer.md` — guardrails reference
7. `agents/pan-planner.md` — guardrails reference
8. `package.json` — bump version to 3.6.0
9. `CHANGELOG.md` — v3.6.0 entry
10. `docs/USER-GUIDE.md` — AI Agent Guardrails section
11. `docs/ARCHITECTURE.md` — references directory note
12. *(Optional #3)* `pan-wizard-core/bin/pan-tools.cjs` — register `info` subcommand

### Implementation Step Order (recommended)
1. Write `references/guardrails.md` (the anchor — everything else references it)
2. Write the 4 test files for guardrails + workflows-checkpoints + phase0-gate (TDD-style; tests fail before edits)
3. Edit 4 workflows (Re-Read Checkpoints + guardrails references)
4. Edit 2 workflows (Phase 0 gate in new-project.md, plan-phase.md)
5. Edit 2 agents (guardrails reference)
6. Run `npm test` — should now go green
7. Write scenario test (`guardrails-installed.test.cjs`)
8. Run `npm run test:scenarios` — verifies all 5 runtimes
9. Run `npm run test:all` — full 2567+ suite
10. Manual verify: install in `d:\pantesting` for at least 2 runtimes (claude + one other)
11. Update CHANGELOG, USER-GUIDE, ARCHITECTURE
12. Bump version, commit
13. *(Optional)* Prototype `pan-tools info`; ship if non-redundant
14. Tag v3.6.0

### Test Coverage Summary

| File | Test count | Type |
|------|------------|------|
| `tests/guardrails.test.cjs` | 4 | Unit |
| `tests/workflows-checkpoints.test.cjs` | 4 | Unit |
| `tests/guardrails-references.test.cjs` | 6 | Unit |
| `tests/phase0-gate.test.cjs` | 2 | Unit |
| `tests/scenarios/guardrails-installed.test.cjs` | 5 | Scenario |
| **Total (without #3)** | **21** | — |
| `tests/info.test.cjs` *(optional)* | 5+ | Unit |
| **Total (with #3)** | **26+** | — |

---

## Phase 5: Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Guardrails preamble bloats agent context | Medium | Medium | Keep `guardrails.md` ≤80 lines; reference by path, never inline |
| Re-read directives feel naggy / get ignored | Low | High | Frame as "before phase X" not "every action"; trust agents to skip when appropriate. Naggy directives that are skipped are still better than absent directives. |
| Phase 0 gate annoys users on small phases | Medium | Medium | Apply hard gate only to `new-project.md`; soften wording in `plan-phase.md` to "recommended" |
| `pan-tools info` (#3) duplicates `state json` | Medium | High | **Prototype first.** If 80%+ overlap, fold into `state json --full` instead of new command. |
| Frontmatter schema (#4) breaks 50+ commands during migration | High | Medium | **Deferred to v3.7+.** Do not include in v3.6.0. |
| Test count drops if removing redundant assertions | Low | Low | All changes additive; expect +21 tests, no removals |
| Cross-runtime path resolution differences | Medium | Low | Existing `references/` already ships to all 5 runtimes; verified by existing scenario tests; new test extends that pattern |
| Performance regression in installer time | Low | Low | New file <2KB; total bundle <5KB; benchmark unchanged within noise |
| Breaking change to existing installs on `pan update` | High | Low | All changes are additive content; `pan update` flow already handles new files in `references/` |
| Workflow files become harder to read with extra sections | Low | Medium | Place new sections at top so they're skim-skippable; use clear `## Re-Read Checkpoints` heading |
| AI agents misread Phase 0 gate as blocking ALL work | Low | Low | Wording explicitly scopes to "scaffolding or coding" — small bug fixes don't trigger Phase 0 |
| Guardrails drift out of sync with actual workflows | Medium | Medium | Add to `/pan:doc-audit` checklist (post-v3.6.0); catch in retros |

### Backward Compatibility

**All proposals are additive.** No existing command, workflow, or test changes behavior. Existing v3.5.x installs upgrading to v3.6.0 receive the new files via standard `pan update` flow. No migration required.

### What's Explicitly NOT in v3.6.0

- **#3 `pan-tools info`** — gated on prototype showing it's not redundant with `state json`
- **#4 Frontmatter `requires`/`related` schema** — deferred to v3.7+ until a concrete consumer exists
- **LLM-as-judge evaluation framework** — out of scope; different problem domain
- **`npx skills add` distribution** — not adopting; PAN's installer is feature-complete
- **Reference samples library** — no analog needed
- **Tool-level enforcement of Phase 0** — workflow text is the right enforcement layer

---

## Appendix A: Source File References (`agents-cli`)

| Pattern | File | Lines |
|---------|------|-------|
| Common Shortcuts to Resist (table) | `d:\googlecli\agents-cli\skills\google-agents-cli-workflow\SKILL.md` | 242-251 |
| Code Preservation Principle | same | 253-282 |
| Stop-the-Line Rule | same | 325 |
| Systematic Debugging | same | 315-326 |
| Phase-gated skill loading table | same | 33-46 |
| Phase 0 mandatory gate (4 questions) | same | 82-99 |
| `agents-cli info` description | same | 394-400 |
| Frontmatter `requires` schema | same | 12-19 |
| Skill cross-references (Related Skills) | same | 424-432 |
| Scaffold name constraints (≤26 chars) | `d:\googlecli\agents-cli\skills\google-agents-cli-scaffold\SKILL.md` | 78 |
| Critical Rules block | same | 208-218 |

## Appendix B: Mapping to PAN Wizard Existing Surface

| `agents-cli` element | PAN Wizard analog | Drift risk |
|----------------------|-------------------|------------|
| Workflow SKILL.md | `pan-wizard-core/workflows/*.md` | Low — same markdown-frontmatter format |
| `references/` (per-skill) | `pan-wizard-core/references/*.md` | None — already exists |
| `agents-cli setup` | `node bin/install.js --<runtime>` | None — different distribution model, kept as-is |
| `agents-cli info` | `state json` + `validate health` | Medium — overlap; prototype before adopting |
| Skill cross-refs | Workflow includes (prose) | Medium — defer formal schema to v3.7+ |
| `DESIGN_SPEC.md` | `.planning/requirements.md` + `project_spec_*.md` | None — equivalent artifact |

## Appendix C: Open Questions (resolve before implementation)

1. **Should `references/guardrails.md` be loaded by `CLAUDE.md` itself, or only by workflows?** Recommendation: only by workflows, to keep CLAUDE.md tight and let the agent load guardrails when context demands it.

2. **Should the Phase 0 gate in `plan-phase.md` be "MANDATORY" or "recommended"?** Recommendation: "recommended" for plan-phase (it runs frequently), "MANDATORY" for new-project (it runs rarely and getting it wrong is expensive).

3. **Should `pan-tools info` ship in v3.6.0 or wait?** Recommendation: wait. Prototype during v3.6.0 development; if it's 80%+ redundant with `state json --full`, fold into that command. If it's clearly distinct, ship in v3.6.1.

4. **Should we add a `/pan:guardrails` slash command for explicit invocation?** Recommendation: no. The reference is read by workflows, not by user choice. A slash command implies the user should think about guardrails, which inverts the goal.

5. **Should the Stop-the-Line rule include a hard threshold (e.g., "if a regression touches >2 files, escalate to user")?** Recommendation: no for v3.6.0 — keep the rule simple. Add thresholds only if observed need emerges.

6. **Should `references/guardrails.md` be versioned (e.g., date stamp at top)?** Recommendation: no — it's part of the package version (v3.6.0). The CHANGELOG tracks evolution.

---

## Verification Checklist (pre-merge)

- [ ] `references/guardrails.md` exists, is ≤120 lines, contains required sections
- [ ] 4 workflows have `## Re-Read Checkpoints` section
- [ ] 4 workflows reference `references/guardrails.md`
- [ ] 2 agents reference `references/guardrails.md`
- [ ] `new-project.md` has MANDATORY Phase 0 gate
- [ ] `plan-phase.md` has recommended Phase 0 gate
- [ ] `npm test` passes (unit tests, including 16 new)
- [ ] `npm run test:scenarios` passes (scenario tests, including 5 new)
- [ ] `npm run test:all` passes (full 2588+ test suite)
- [ ] Manual install in `d:\pantesting` for claude runtime — `references/guardrails.md` present
- [ ] Manual install in `d:\pantesting` for one other runtime — same check
- [ ] `package.json` version is 3.6.0
- [ ] `CHANGELOG.md` has v3.6.0 entry
- [ ] `docs/USER-GUIDE.md` has AI Agent Guardrails section
- [ ] `docs/ARCHITECTURE.md` mentions guardrails.md role

---

**End of spec. Ready for /pan:plan-phase or /pan:focus-plan.**
