# Design Artifact Template

Template for `{scope}-design.md` — the design a change carries **before** it is
planned or executed. Produced by `pan-designer` (per phase, via
`/pan:design-phase`) or `focus-design` (per feature). Held to the quality bar in
`references/design-methodology.md` and verified by `pan-design-checker`.

**Purpose:** Capture the *how* (and, at deeper tiers, the *whether/what*) of a
change — architecture, decisions, ADR, threats, and machine-checkable success
criteria — so the planner builds against a verified design instead of improvising
architecture inside the plan.

**Depth tiers** select which sections are mandatory (see
`references/design-methodology.md`): `spike` < `phase` < `feature` < `full`.
Sections are labeled with the tier at which they become **required**; a shallower
tier may omit them.

**Downstream consumers:**
- `pan-planner` — reads locked decisions, interface contract, and file scope to create tasks that implement the approved design (same way it reads `context.md`).
- `pan-plan-checker` — verifies the plan conforms to this design (Design Conformance dimension).
- `pan-design-checker` — verifies THIS artifact against the quality bar before it is handed off.

---

## File Template

```markdown
# [Scope]: [Name] — Design

**Tier:** spike | phase | feature | full
**Designed:** [date]
**Status:** Draft | Verified (pan-design-checker) | Superseded

<problem>
## Problem & Scope        <!-- all tiers -->

**Problem:** [What problem exists, why it matters, cost of inaction. Concrete.]

**In scope:** [What this design covers]
**Out of scope / boundary:** [The fixed boundary this must not exceed — phase boundary from roadmap.md, or feature boundary]
</problem>

<success_criteria>
## Success Criteria        <!-- phase+ -->

[3–7 criteria. At least 2 MUST be machine-checkable — name the automated check.]

| # | Criterion | Machine-checkable? | Check |
|---|-----------|--------------------|-------|
| SC-1 | [criterion] | yes | [test / command that verifies it] |
| SC-2 | [criterion] | yes | [test / command that verifies it] |
| SC-3 | [criterion] | no  | [how confirmed] |
</success_criteria>

<architecture>
## Architecture & Synthesis        <!-- phase+ -->

**Discovered conventions:** [Actual conventions extracted from the codebase — module layout, error style, boundaries. Cite files. Do not assume.]

**Components & boundaries:** [Modules added/touched; confirm no layer/boundary violation against the discovered conventions.]

**Interface contract:** [Exact invocation + input/output schema + status/exit codes, per project convention.]

**State & filesystem scope:**
- Reads from: [paths — within project root]
- Writes to: [paths — within .planning/ or project root]
- Side effects: [git ops, dir creation, etc.]

**Design decisions:**
| Decision | Chosen | Alternative rejected | Rationale |
|----------|--------|----------------------|-----------|
| [point] | [what] | [alt] | [why] |
</architecture>

<adr>
## ADR        <!-- phase+ (phase = inline; feature/full = standalone docs/decisions/ADR-NNNN) -->

**Context:** [Problem, forces/constraints, current state, requirements traceability.]
**Decision:** [Summary + numbered sub-decisions, each with rationale.]
**Consequences:** [Positive AND negative. Every negative has a mitigation or explicit acceptance — no unmitigated costs, no placeholder sections.]
</adr>

<threats>
## Threat Model        <!-- phase = lite (own surface); feature+ = full STRIDE-lite -->

| Threat | Vector | Mitigation (or explicit acceptance) |
|--------|--------|-------------------------------------|
| [threat] | [how] | [mitigation] |
</threats>

<error_handling>
## Error Handling & Diagnostics        <!-- feature+ -->

| Condition | Output shape | Handling style |
|-----------|-------------|----------------|
| [error] | [output] | [validate-before-side-effect / safe-read-null / actionable message] |
</error_handling>

<test_plan>
## Test Plan        <!-- phase = hooks; feature+ = full -->

[How each success criterion is verified — unit vs scenario, and the seed inputs for the machine-checkable ones.]
</test_plan>

<strategy>
## Demand & Strategy        <!-- feature (demand + ladder); full (+ competitive, ERRC, adoption) -->

**Demand evidence:** [Evidence, or explicit "speculative — no demand evidence" flag.]
**Feature ladder:** v0 (MVP) → v1 (complete) → v2 (enhanced).
[full tier: competitive intelligence, ERRC strategic analysis, adoption analysis.]
</strategy>

<deferred>
## Deferred Ideas        <!-- all tiers -->

[Scope-expanding ideas that came up — captured so they're not lost, explicitly NOT designed in.]
[If none: "None — design stayed within boundary."]
</deferred>

---

*Scope: [phase XX-name | feature-name]*
*Tier: [tier] · Designed: [date] · Verified: [date or "pending"]*
```

<guidelines>
**This template captures a VERIFIED design for downstream agents.**

The output should answer: "What is the architecture, what was decided and why,
how do we know it's safe, and how will we prove it works?"

**Good content (concrete, verifiable):**
- "Add `resolveRate()` to cost.cjs; longest-prefix match so tier keys win — SC verified by tests/cost.test.cjs"
- "Negative consequence: per-phase latency → mitigated by auto-skip + design.md caching"
- "Threat: agent-supplied path escapes tmpdir → mitigated by tmpRoot prefix + basename check"

**Bad content (vague, unverifiable):**
- "Good architecture"
- "Handles errors well"
- "Secure by design"

**After creation:**
- Main flow: file lives in the phase directory as `{phase_num}-design.md`; `pan-planner` consumes it.
- Focus flow: the ADR is written standalone to `docs/decisions/`; the spec to `docs/specs/`.
- `pan-design-checker` must pass the artifact (or exhaust 2 reflexion iterations) before it is handed to planning.
</guidelines>
