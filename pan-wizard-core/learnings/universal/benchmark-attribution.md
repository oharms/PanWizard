---
topic: benchmark-attribution
last_updated: 2026-07-18T08:42:29.848Z
patterns:
  - id: P-FH-002
    summary: A benchmark gap shared by every same-backend toolchain is not your defect
    promoted_at: 2026-07-18T08:42:29.848Z
    source_experiments: [field-harvest-2026-07]
---

# Benchmark Attribution (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FH-002 — A benchmark gap shared by every same-backend toolchain is not your defect

**Evidence:** On several workloads, the project's output and two other independent compilers all built on the same shared backend were each slower than a fourth toolchain that bundles a newer version of that same backend — and the project actually beat the two same-backend rivals in absolute time. The gap was correctly parked as a backend-version phenomenon rather than a code defect, and a prior 'closed' anchor for that class was flagged as unrepresentative.

**Rule:** Before attributing a comparative benchmark slowdown to your own codebase, check whether independent tools that share the same code-generation backend show the same gap against the outlier. If your implementation AND two unrelated compilers all sitting on the same backend are all slower than one rival that bundles a newer version of that backend, the gap is a toolchain/backend-version artifact, not a fixable defect in your code — do not mint a fix or a defect class for it. Keep a control group of same-backend rivals in every comparison so this confound is visible.

**Applies in:** comparative benchmarking; toolchain / codegen-backend performance analysis
