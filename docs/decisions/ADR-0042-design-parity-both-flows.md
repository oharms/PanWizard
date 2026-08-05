# ADR-0042: Design-quality parity across the main and focus flows — shared design tiers + independent design verification

## Status

Accepted — 2026-08-05. Implemented incrementally (see `references/design-methodology.md`, `agents/pan-design-checker.md`, `agents/pan-designer.md`, `commands/pan/design-phase.md`, and the `focus-design`/`plan-phase` wiring).

## Context

PAN has two ways to reach implementation, and they were asymmetric on design quality:

- **Main flow** (phase lifecycle: `discuss-phase → research-phase → plan-phase → exec-phase → verify-phase`) produces an *executable plan* and verifies it with an **independent** adversarial agent (`pan-plan-checker`, `effort: xhigh`, goal-backward, max-2 reflexion loop). But it has **no design step**: `discuss-phase` explicitly defers architecture ("Do NOT ask about architecture choices — Claude handles these"), so architecture, ADRs, and threat modeling are left implicit.
- **Focus flow** (`focus-design`, the `/featureAI` pipeline) produces a **deep** design: a 10-phase strategic pipeline with architecture assessment, design synthesis, ADR, STRIDE-lite threat model, and a machine-checkable test plan. But its verification is **self-review only** — there is no independent checker for the spec/ADR the way `plan-phase` has `pan-plan-checker`.

So each flow was strong on the axis the other was weak on: the main flow had independent verification but shallow design; the focus flow had deep design but only self-verification. The goal is parity — **both flows get deep design AND independent design verification** — without duplicating the ~1100-line focus-design methodology into the per-phase path, and without making the frequently-run main flow slow.

## Decision

Adopt four coupled decisions:

1. **One methodology, four depth tiers.** Extract the design method into a single reference, `pan-wizard-core/references/design-methodology.md`, with tiers `spike` / `phase` / `feature` / `full`. Both entry points cite it — `focus-design` at `feature`/`full`, the main flow at `phase` — so the method can't drift between flows (consistent with the "single source of truth" rule in CLAUDE.md). The design artifact schema lives in `pan-wizard-core/templates/design.md`, with tier-gated mandatory sections.

2. **A shared, independent design-checker.** Add `agents/pan-design-checker.md`, modeled exactly on `pan-plan-checker` (`effort: xhigh`; `tools: Read, Bash, Glob, Grep`; goal-backward; adversarial; max-2 reflexion loop). It verifies design artifacts against seven dimensions: requirement coverage, ≥2 machine-checkable success criteria, architecture conformance to *discovered* project conventions, ADR honesty (real alternatives, mitigated consequences), threat coverage, testability, and scope discipline. Both flows spawn it.

3. **Ramp the main flow up with a dedicated `/pan:design-phase` command** (not folded into `plan-phase`). It runs `pan-designer` at the `phase` tier → `pan-design-checker` reflexion loop → writes `{phase}-design.md`. The lifecycle becomes `discuss → research → design → plan → verify`. `design.md` is an *optional upstream input* consumed by `pan-planner` exactly as `context.md` is, so existing projects without a design step still plan. Trivial phases auto-skip; `--skip-design` forces it. A dedicated command (vs a gate inside `plan-phase`) keeps the step optional, cacheable like `research.md`, and independently invocable.

4. **Altitude split.** Product/strategic design (demand validation, competitive intelligence, market analysis) runs **once** at feature/milestone creation (`focus-design`, and a product-design pass wired into `milestone-new`), not per phase. Per-phase design (`design-phase`) covers only architecture, ADR, threat model, design synthesis, and machine-checkable criteria — the `phase` tier — so the per-phase path stays fast.

`plan-phase` gains a `## Design` upstream input and passes it to `pan-planner`; `pan-plan-checker` gains a **Design Conformance** dimension (does the plan implement the approved design?). `focus-design` spawns `pan-design-checker` after its ADR phase and its final-artifact phase.

## Consequences

- **Parity achieved:** both flows produce deep design *and* pass it through an independent adversarial checker.
- **No duplication:** the methodology is defined once and cited twice; the checker is one agent used by both flows.
- **Bounded overhead:** the depth dial + altitude split + auto-skip + `design.md` caching keep the per-phase path cheap; the reflexion loop is capped at 2 iterations (same as `pan-plan-checker`) so verification can't stall.
- **Backward compatible:** `design.md` is optional upstream input; projects and phases without it still plan and execute unchanged.
- **Runtime-agnostic:** new agents/commands use no host-specific tools; any Workflow fan-out keeps its no-op fallback (ADR-0031), so all five runtimes are unaffected.
- **Cost:** two new agents, one new command, one reference, one template, and wiring/tests. The main-flow lifecycle gains a step (optional), which is a real behavior change teams will see.

## References

- `pan-wizard-core/references/design-methodology.md`, `pan-wizard-core/templates/design.md`
- `agents/pan-designer.md`, `agents/pan-design-checker.md`, `commands/pan/design-phase.md`
- Existing pattern this mirrors: `agents/pan-plan-checker.md`, `agents/pan-planner.md`, `commands/pan/plan-phase.md`
- Deep design source being tiered: `commands/pan/focus-design.md` (the `/featureAI` pipeline)
- Related: ADR-0031 (Workflow fan-out with no-op fallback), ADR-0038 (skill-aligned decomposition).
