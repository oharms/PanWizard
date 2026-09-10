---
name: focus-design
group: Focus
description: Strategic 10-phase feature investigation, design, and specification pipeline
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - WebSearch
  - WebFetch
  - mcp__context7__resolve-library-id
  - mcp__context7__get-library-docs
---

# /pan:focus-design — Strategic Feature Investigation, Design & Specification

Research, design, and specify a new feature with strategic analysis. $ARGUMENTS

**Goal:** Produce a best-of-breed feature specification that (a) validates the problem with evidence, (b) maps the competitive landscape, (c) identifies strategic differentiation, (d) designs an architecturally sound implementation, (e) plans for error handling, security, and testability from day one, (f) defines an incremental delivery ladder, and (g) outputs a ready-to-implement spec with ADR, test plan, and implementation tasks.

**Methodology:** Synthesizes Spec-Driven Development, Blue Ocean Strategy, Wardley Mapping, STRIDE-lite threat modeling, Architecture Decision Records, and structured workflow methodology into a single investigative pipeline. The design-quality bar and depth tiers are the shared ones in `~/.claude/pan-wizard-core/references/design-methodology.md` (this pipeline runs the `feature`/`full` tiers; the main flow's `/pan:design-phase` runs the `phase` tier) — and the same independent verifier, `pan-design-checker`, gates both (ADR-0042).

---

## CRITICAL: Project Scope Boundary

This command investigates and designs features for the **host project** — NOT for PAN Wizard itself.

**NEVER investigate, design for, or reference these PAN infrastructure directories as part of the project:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- `.planning/` — PAN planning state (read for context, but don't treat as project source code)
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within those directories

**These directories are PAN's own tooling installed into the project.** They are not part of the project's source code, not part of its feature set, and not something to fix, improve, or design features for.

If you find yourself analyzing PAN command files, agent definitions, or `pan-tools` dispatcher code as "project code" — STOP. You have crossed the scope boundary. Refocus on the project's actual source code.

---

## Tool Selection Priority

Use the simplest sufficient tool for each research operation:
1. **Grep/Glob** — for finding patterns and files in the local codebase
2. **Read** — for examining specific files identified by Grep/Glob
3. **Bash** — for git history, test runs, build commands
4. **Agent (subagent)** — for broad exploration spanning many files (>5 reads)
5. **WebSearch/WebFetch** — for external research after local sources are exhausted
6. **mcp__context7__*** — for library documentation lookups

Prefer local evidence over web research. Start with the codebase, then broaden.

## Context Management Across Phases

This pipeline spans 10+ phases. Manage context to maintain quality:
- **KEEP:** Problem statement, success criteria, key architectural decisions, file paths being designed for
- **SUMMARIZE:** Research findings (compress to key takeaways after each research phase), competitive analysis results
- **DISCARD:** Raw web fetch content after extracting relevant data, superseded design drafts
- After Phase 3 (Strategic Analysis), summarize all findings from Phases 0-3 into a compact brief before entering design phases

**Progressive context loading — load only what the current phase needs:**

| Phase | What to Load | What NOT to Load Yet |
|-------|-------------|---------------------|
| 0. Problem | User's feature description, project README | Implementation details, test files |
| 1. Landscape | Web search results, competitor docs | Project internals |
| 2. Codebase | Relevant source files (Glob→Grep→Read) | Unrelated modules, full test suite |
| 3. Strategic | Findings from 0-2 (summarized) | Raw web content (discard after summary) |
| 4-6. Design | Architecture files, key modules, API surface | Test implementation details |
| 7-8. Spec | Design decisions from 4-6, test patterns | Research raw data (long gone) |
| 9. Output | Spec template, ADR template | Everything else (already in spec) |

**Why:** A 10-phase pipeline that loads everything in Phase 0 exhausts context by Phase 5. Each phase loads only its inputs, summarizes its outputs, and discards its raw data.

---

## Reasoning Protocol

For research and analysis phases (0, 1, 2, 3), follow observe-think-act:
1. **OBSERVE** — State what you found (code patterns, competitive data, user needs)
2. **THINK** — Reason about what this means for the design
3. **ACT** — Record the finding and move to the next investigation step
This keeps research structured and prevents rabbit holes.

## Meta-Prompting: Self-Generated Investigation Strategy

Before starting Phase 0, generate your own investigation plan based on the feature description:

```
Given: "{feature description}"
My investigation strategy:
1. What is the core problem? → {how I'll validate it}
2. Who are the competitors? → {what to search for}
3. What codebase areas are affected? → {what to Glob/Grep for}
4. What are the likely architectural constraints? → {what to read}
5. What risks should I watch for? → {security, performance, compatibility}
6. What is the ideal output format? → {spec structure for this feature type}
```

This self-generated strategy adapts to the specific feature rather than following a generic checklist. A "add caching layer" feature needs different investigation than "add OAuth provider" — the meta-prompt captures that difference upfront.

**After Phase 3, regenerate:** The strategy may need revision based on what you've learned. Update it before entering design phases.

---

## Complete All Phases For Selected Mode

When `/pan:focus-design` is invoked, execute all phases for the selected mode automatically. Do not stop to ask questions between phases or skip phases beyond what the mode specifies. Complete the full investigation and produce all output artifacts. The only permitted pause is the Strategy Gate in Phase 3 (if the user passed `--gate`).

**Modes (mutually exclusive — pick one, default `--full`):**

### `--full` — Complete 10-Phase Investigation (DEFAULT)
Run ALL phases. Nothing skipped. This is the gold standard.
```
Phases: 0 -> 0.8 -> 1 -> 1.5 -> 2 -> 2.5(if --audit) -> 3 -> 3.5 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Use case: New features, public-facing commands, anything that ships to users
```

### `--internal` — Internal Development Focus
Skip competitive research (Phase 2) and reality check (Phase 2.5). Focus on architecture, implementation, hardening, and testing. For internal tooling where there are no competitors to analyze.
```
Phases: 0 -> 0.8 -> 1 -> 3 -> 3.5 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Skips: Phase 1.5 (Informed Clarification), Phase 2 (Competitive Intelligence), Phase 2.5 (Reality Check)
Use case: Internal APIs, dev tooling, refactoring, infrastructure work
```

### `--outward` — Strategic & Market Analysis Focus
Emphasize competitive intelligence and strategic positioning. Skip error handling and security hardening (Phases 6, 7) and produce a lighter implementation roadmap. For market research, strategic decisions, and feature evaluation.
```
Phases: 0 -> 0.8 -> 1 -> 2 -> 2.5(if --audit) -> 3 -> 3.5 -> 4 -> 5 -> 8(tasks only) -> 10
Skips: Phase 1.5 (Informed Clarification), Phase 6 (Error Handling), Phase 7 (Security), Phase 9 (Test Plan)
Lighter: Phase 8 (tasks list only — no dependency graph, no risk register)
Use case: Evaluating whether to build, competitive positioning, strategic ADRs
```

### `--spike` — Fast Proof-of-Concept
Minimal 4-phase pass: validate the problem, scan the codebase, synthesize a design, output implementation tasks. No competitive research, no strategic analysis, no hardening.
```
Phases: 0(lite) -> 1(lite) -> 4 -> 8
Lite Phase 0: Problem statement + scope only (skip demand evidence, user stories, cannibalization)
Lite Phase 1: Codebase search + conventions only (skip architecture scan, dependency map)
Skips: Phases 0.8, 1.5, 2, 2.5, 3, 3.5, 5, 6, 7, 9, 10(spec saved, no ADR)
Use case: Quick prototyping, time-boxed exploration, "should we even try this?"
```

**Modifiers (layer on top of any mode):**
- `--gate` — Pause after Phase 3 (Strategy) for user review before proceeding to design
- `--audit` — Add Phase 2.5 reality check of existing implementation (not available with `--spike`)
- `--mvp` — Stop after generating the v0 (MVP) task list — skip v1/v2 layers

### Scope Calibration (Auto-Detection)
If the user doesn't specify a mode, assess scope before starting:

| Signal | Suggested Mode | Rationale |
|--------|---------------|-----------|
| Bug fix or single-function change | `--spike` | Minimal investigation needed |
| New internal module, service, or utility | `--internal` | No competitive research needed |
| New API endpoint, component, or contained feature | `--internal` | Architecture-focused |
| User-facing feature with competitive alternatives | `--full` | Need competitive intelligence |
| "Should we build X?" strategic question | `--outward` | Focus on market analysis |
| Enhancement to existing feature (small blast radius) | `--internal` | Architecture-focused |
| Enhancement to existing feature (large blast radius) | `--full` | Full investigation warranted |

Present the suggested mode and rationale. If the user hasn't specified, use the suggestion.

**Mode + Phase Matrix:**

| Phase | `--full` | `--internal` | `--outward` | `--spike` |
|-------|----------|-------------|-------------|-----------|
| 0: Problem Framing | Full | Full | Full | Lite (statement + scope only) |
| 0.8: Codebase Investigation | Full | Full | Full | **SKIP** |
| 1: Internal Recon | Full | Full | Full | Lite (codebase + conventions only) |
| 1.5: Informed Clarification | Full | **SKIP** | **SKIP** | **SKIP** |
| 2: Competitive Intel | Full | **SKIP** | Full | **SKIP** |
| 2.5: Reality Check | With --audit | **SKIP** | With --audit | **SKIP** |
| 3: Strategic Analysis | Full | Full | Full | **SKIP** |
| 3.5: Architecture | Full | Full | Full | **SKIP** |
| 4: Design Synthesis | Full | Full | Full | Full |
| 5: ADR | Full | Full | Full | **SKIP** |
| 6: Error Handling | Full | Full | **SKIP** | **SKIP** |
| 7: Security | Full | Full | **SKIP** | **SKIP** |
| 8: Implementation | Full | Full | Tasks only | Full |
| 9: Test Plan | Full | Full | **SKIP** | **SKIP** |
| 10: Output Artifacts | Full | Full | Spec + ADR | Spec only |

---

## Phases 0–9: The Procedure

The phase-by-phase procedure for Phases 0 through 9 lives in `~/.claude/pan-wizard-core/references/focus-design-procedure.md`. **Before starting Phase 0, read that file with the Read tool** and execute it exactly as written — the mode table above says which phases apply to the selected mode. Do not work from memory or paraphrase it: if the file cannot be read, stop and report the path. When Phase 9 is complete, continue with Phase 10 below.

Why it is a separate file: this command's activation body exceeded the Agent Skills recommendation by a wide margin (reality check RC19 / plan item R21, 2026-09-10). Activation now loads the contract — scope boundary, tool priority, context management, modes, output artefacts — and the procedure is loaded when it is needed. Whether that changes the artefacts produced is measured by the A/B scenarios `focus-design-ab-original` and `focus-design-ab-split` in the harness, not assumed.

## Phase 10: Output Artifacts

### 10.1 Save Specification Document
Write complete spec to: `docs/specs/<feature_name>_featureai.md`

### 10.2 Save ADR
Write ADR to: `docs/decisions/ADR-NNNN-<feature_name>.md`

**ADR completeness gate:** Before saving, verify the ADR passes ALL checks from Phase 5.2. The ADR file must contain every section defined in Phase 5.1 with substantive content — no placeholder brackets, no skeleton sections, no missing tables. If any section would be empty, go back to the relevant phase and extract the content.

**Independent verification gate:** The final artifact must have PASSED `pan-design-checker` in Phase 5.4 (or reached the 2-iteration cap with remaining gaps recorded as caveats). Re-run the checker here on the *saved* spec + ADR as a final gate — the independent pass, not just the 5.2 self-check, is what authorizes handing this design to `/pan:focus-plan`.

**Minimum ADR size:** A proper ADR for a `--full` mode investigation should be 80-200+ lines. If the ADR is under 60 lines, it is almost certainly missing required sections. For `--internal` mode, minimum 60 lines. For `--outward` mode, minimum 70 lines.

### 10.3 Report Summary
Output a complete summary with:
- **Problem & Evidence** — 1-sentence problem, evidence sources
- **Investigation Depth** — files read during Phase 0.8, patterns discovered, modules in impact analysis
- **Strategic Assessment** — Blue Ocean actions, Wardley position, Moat Score (N/30), Cognitive Load score, Recommendation
- **Competitive Position** — which competitors analyzed, where the project leads/lags for this feature
- **Design Summary** — feature type, modules affected, output schema, error handling, breaking changes
- **Feature Ladder** — v0/v1/v2 scope and effort
- **Implementation Tasks** — count, total complexity, files to create/modify
- **Security** — attack surface, path safety, output sanitization
- **Adoption** — discovery, learning curve, aha moment
- **Informed Questions** — count asked, what they clarified
- **Acceptance Criteria** — count, how many are machine-checkable
- **Documents Created** — spec path, ADR path, command .md path (if applicable)
- **Next Step** — recommended follow-up command

---

## NEVER DO

- Design without proving the problem exists (Phase 0 demand evidence is mandatory)
- Skip competitive research — must be best-of-breed
- Copy a tool's design without understanding WHY they made that choice
- Violate the project's dependency philosophy (discover from Phase 0.8)
- Add a feature without error handling design (Phase 6)
- Skip cross-platform considerations when the project supports multiple platforms
- Produce a spec without measurable success criteria
- Produce a spec without a test plan with enforced assertion density
- Trust existing implementation claims without `--audit` verification
- Design in isolation — always map dependencies and integration points
- Use `eval()`, `Function()`, string interpolation in shell commands, or unvalidated paths
- Violate the project's architectural layer boundaries (discover from Phase 0.8)
- Expose absolute paths, stack traces, or env vars in output
- Change existing public interfaces without a migration strategy
- Defer the interface definition to "documentation" — draft it during design
- Exceed the project's established complexity limits
- Add a feature scoring +2 on cognitive load without explicit justification
- Ship a feature with no demand evidence and no strategic justification

## ALWAYS DO

- Start from the USER's problem, not the technology
- Gather demand evidence before committing to design
- Check all existing project features for overlap before proposing new ones
- Research at least 6 competitor tools in the feature's domain before designing
- Apply Blue Ocean thinking — find where to CREATE, not just copy
- Define the output/interface contract BEFORE implementation design (contract-first)
- Write the guide-level explanation BEFORE the reference-level
- Draft the interface definition as part of the spec (it IS the integration point)
- Plan for failure (error messages, graceful degradation, actionable errors)
- Follow the project's error message conventions (discover from Phase 0.8)
- Apply the path safety protocol for any user-supplied path input
- Validate file content structure before processing (never trust disk contents)
- Follow existing patterns for output, errors, file reading
- Follow the project's dependency philosophy (discover from Phase 0.8)
- Enforce the project's test pyramid proportional to feature scope (discover from Phase 0.8)
- Verify dependency chain has no cycles
- Stay within the project's established complexity limits (discover from Phase 0.8)
- Define a feature ladder (v0 MVP -> v1 complete -> v2 enhanced)
- Model adoption friction (discovery, learning curve, aha moment)
- Produce a complete spec with ADR, ready for implementation
