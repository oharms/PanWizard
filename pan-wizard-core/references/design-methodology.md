# Design Methodology (shared)

Single source of truth for how PAN designs a change **before** it is planned or
executed. Cited by `pan-designer` (main flow, via `/pan:design-phase`) and by
`focus-design` (the `/featureAI` feature pipeline). Both flows use the *same*
method at different **depth tiers** so design quality can't drift between them.

This reference defines: the depth tiers, what each tier must produce, and the
quality bar every design artifact is held to (the same bar `pan-design-checker`
verifies against). It does not prescribe a runtime — agents apply it with
whatever tools they have.

---

## Depth tiers

A tier selects which sections of the design artifact (`templates/design.md`) are
**mandatory**. Deeper tiers are supersets of shallower ones. Pick the shallowest
tier that fits the altitude of the work.

| Tier | Altitude | Mandatory sections | Skips | Typical entry point |
|------|----------|--------------------|-------|---------------------|
| `spike` | Throwaway PoC / trivial change | Problem · Scope · Minimal architecture | Everything else — flag as speculative | `/pan:design-phase --spike`, `focus-design --spike` |
| `phase` | One roadmap phase | Problem · Success criteria (≥2 machine-checkable) · Architecture assessment · Design synthesis · Phase-scoped ADR · Threat-lite · Test hooks | Demand validation, competitive intel, market/strategy | **`/pan:design-phase` (main-flow default)** |
| `feature` | A whole feature (internal) | `phase` + Demand validation · Error-handling design · Full STRIDE-lite threat model · Test plan · Feature ladder | Competitive intel, strategic (Blue Ocean/Wardley) | `focus-design --internal` |
| `full` | A market-facing feature | `feature` + Competitive intelligence · Strategic analysis (ERRC) · Adoption analysis | — (nothing) | `focus-design --full` (DEFAULT) |

**Altitude rule (why the tiers exist):** product/strategic design — *whether*
and *what* to build, with demand and competitive evidence — is decided **once**
at feature/milestone creation (`focus-design`, or the product-design pass in
`milestone-new`). Per-phase design (`phase` tier) covers only *how* to build an
already-scoped phase: architecture, ADR, threat, synthesis. This keeps the
frequently-run per-phase path cheap and stops the main flow re-litigating product
questions on every phase.

---

## What every tier produces

The artifact is `{scope}-design.md` from `templates/design.md`. Sections below are
ordered; a tier makes a contiguous prefix (plus its named additions) mandatory.

### 1. Problem & scope (all tiers)
- **Problem statement** — what problem exists, why it matters, cost of inaction. Concrete, not a vague generality.
- **Scope** — in-scope / out-of-scope, and the fixed boundary this design must not exceed (a phase boundary from `roadmap.md`, or a feature boundary).

### 2. Success criteria (`phase`+)
- 3–7 criteria, **at least 2 machine-checkable** (verifiable by an automated test, not manual inspection). State the check for each machine-checkable one.

### 3. Architecture assessment & synthesis (`phase`+)
- **Conventions** — extract the project's actual conventions (module layout, error style, boundaries) from the codebase; do not assume.
- **Components & boundaries** — what modules are added/touched; confirm the design honors the discovered boundaries (no layer violations).
- **Interface contract** — exact invocation + input/output schema + status/exit codes, per project convention.
- **State & filesystem scope** — reads from / writes to (must stay within project root / `.planning/`), state mutations, side effects.
- **Design decisions** — each significant decision: what was decided, why, alternatives rejected.

### 4. ADR (`phase`+)
- A right-sized Architecture Decision Record: Status · Date · Context (problem, forces, current state, requirements traceability) · Decision (summary + numbered sub-decisions with rationale + integration) · Consequences (positive **and** negative, every negative with a mitigation or explicit acceptance).
- `phase` tier: phase-scoped ADR (may be a section in `design.md`). `feature`/`full`: a standalone `docs/decisions/ADR-NNNN-*.md`.

### 5. Threat model (`phase` = lite, `feature`+ = full)
- STRIDE-lite: for each realistic threat, its vector and its mitigation (or explicit acceptance). `phase` tier covers the change's own surface; `feature`+ covers the full feature.

### 6. Error handling & diagnostics (`feature`+)
- Every error condition → output shape + handling style (validate args before side effects; safe reads return null; actionable messages).

### 7. Test plan (`phase` = hooks, `feature`+ = full)
- How each success criterion is verified; which are unit vs scenario; the seed inputs for the machine-checkable ones.

### 8. Demand & strategy (`feature`+ / `full`)
- `feature`: demand evidence (or an explicit "speculative" flag), feature ladder (v0 MVP → v1 → v2).
- `full`: competitive intelligence, strategic analysis (ERRC: eliminate/reduce/raise/create), adoption analysis.

---

## Quality bar (what `pan-design-checker` enforces)

A design artifact **passes** only when all of these hold at its tier. This is the
same checklist the independent checker verifies — designers should self-check
against it before handing off, but passing is decided by the checker, not the
author.

1. **Requirement coverage** — every stated requirement maps to a design element; nothing is silently dropped.
2. **Machine-checkable criteria** — ≥2 success criteria are automatable, and each names its check (`phase`+).
3. **Architecture conformance** — the design matches conventions *discovered* from the codebase, and introduces no layer/boundary violation.
4. **ADR honesty** — alternatives are real (not strawmen); every negative consequence has a mitigation or is explicitly accepted; no placeholder/skeleton sections (`phase`+).
5. **Threat coverage** — each identified threat is mitigated or explicitly accepted; none is left open (`phase` lite / `feature`+ full).
6. **Testability** — the test plan/hooks map to the success criteria (`phase`+).
7. **Scope discipline** — the design stays within the fixed boundary; scope-expanding ideas are captured as "deferred", never designed in.

If any dimension fails, the checker returns structured gaps and the designer
revises. The reflexion loop is capped at **2 revision iterations** (design →
check → revise → check → final) to prevent over-revision — the same guardrail
`plan-phase` uses with `pan-plan-checker`.
