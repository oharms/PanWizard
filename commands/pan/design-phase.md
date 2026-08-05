---
name: pan:design-phase
group: Phase Lifecycle
description: Design a roadmap phase before planning — architecture, ADR, threat-lite, machine-checkable criteria — verified by an independent checker
argument-hint: "[phase] [--spike] [--skip-design] [--redesign]"
agent: pan-designer
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - Task
  - WebFetch
  - mcp__context7__*
---
<objective>
Produce a verified design (`{phase}-design.md`) for a roadmap phase BEFORE it is planned, so `pan-planner` builds against an architecture instead of improvising one. This is the main flow's design step — the per-phase counterpart to the focus flow's `/pan:focus-design`, running the shared `phase` tier from `~/.claude/pan-wizard-core/references/design-methodology.md` (ADR-0042).

**Lifecycle position:** `discuss → research → **design** → plan → verify`.

**Orchestrator role:** parse arguments, validate phase, spawn `pan-designer` (tier `phase`), verify with `pan-design-checker`, iterate until pass or max iterations, write `{phase}-design.md`, present results.
</objective>

<altitude_boundary>
Per-phase design covers **how** to build an already-scoped phase: architecture, design decisions, a phase-scoped ADR, a threat-lite pass, and machine-checkable success criteria. It does NOT re-open product questions — demand validation, competitive intelligence, and market/strategy belong to feature/milestone creation (`/pan:focus-design`, `/pan:milestone-new`), done once, not per phase. Keep this step at the phase altitude.
</altitude_boundary>

<routing_decision_tree>
Evaluate top-to-bottom; take the FIRST match.

```
IF --skip-design:
  → Skip design entirely. Note that plan-phase will proceed WITHOUT a design.md.

ELSE IF {phase}-design.md exists AND --redesign NOT set:
  → Reuse existing design. Offer: view / redesign / continue to plan.

ELSE IF phase is trivial (auto-detect: single small task, no new module,
        no new interface, no external surface):
  → Auto-skip with a one-line rationale. A trivial phase does not need a
    design artifact; recommend proceeding to plan-phase.
  → --spike or an explicit invocation overrides auto-skip.

ELSE (default):
  → DESIGN (spawn pan-designer at tier `phase`, or `spike` if --spike)
  → VERIFY (pan-design-checker reflexion loop)
  → WRITE {phase}-design.md
```
</routing_decision_tree>

<process>
1. **Validate phase** — error if the phase number is missing or not in `roadmap.md`.
2. **Prime context** — resolve the phase directory; gather `{phase}-context.md`, `{phase}-research.md`, and the phase boundary from `roadmap.md`.
3. **Design** — spawn `pan-designer` with a `<files_to_read>` block (context, research, roadmap boundary, `CLAUDE.md`). It fills in `templates/design.md` at the `phase` tier (`spike` if `--spike`).
4. **Verify (reflexion loop)** — spawn `pan-design-checker` with the drafted design + the boundary source:
   - If it PASSES → done.
   - If it finds gaps (iteration 1) → `pan-designer` revises (address genuine gaps only), re-check.
   - If it finds gaps (iteration 2) → final revision, record remaining gaps as caveats.
   - **Max 2 revision iterations** (design → check → revise → check → final) — the same guardrail `plan-phase` uses with `pan-plan-checker`.
5. **Write** `{phase}-design.md` to the phase directory and commit via `pan-tools commit`.
6. **Present** results + next step (`/pan:plan-phase` — which will consume this design.md).
</process>

<completion_contract>
Design is complete when ALL conditions are met:
1. `{phase}-design.md` created in the phase directory (unless `--skip-design` or an auto-skipped trivial phase — state which).
2. `pan-design-checker` PASSED, or 2 revision iterations were exhausted with remaining gaps recorded as caveats.
3. The artifact contains, at the `phase` tier: problem+scope, ≥2 machine-checkable success criteria, architecture (conventions cited, no layer violation), a phase-scoped ADR (every negative consequence mitigated/accepted, no placeholders), a threat-lite pass, and test hooks.
4. User presented with results and the next-step option.

Design FAILS if: phase not found in roadmap, or the designer returns empty/malformed output after retries.
</completion_contract>

<handoff>
`{phase}-design.md` is an **optional upstream input** to `/pan:plan-phase`, consumed by `pan-planner` exactly as `{phase}-context.md` is. `pan-plan-checker` verifies the plan conforms to it (Design Conformance dimension). A phase without a design.md still plans — the design step strengthens planning, it does not gate it.
</handoff>
