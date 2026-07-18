---
topic: dependency-confusion
last_updated: 2026-07-18T08:42:29.855Z
patterns:
  - id: P-FH-018
    summary: Unqualified image/package names can resolve to a public namesake — qualify sources and preflight provenance
    promoted_at: 2026-07-18T08:42:29.855Z
    source_experiments: [field-harvest-2026-07]
---

# Dependency Confusion (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FH-018 — Unqualified image/package names can resolve to a public namesake — qualify sources and preflight provenance

**Evidence:** A missing locally-built image caused the toolchain to silently pull a broken public image of the same name until a preflight provenance check was added to the deploy path.

**Rule:** When an intended private/local artifact is absent, an unqualified image or package reference can silently resolve to a same-named artifact from a public registry (dependency/image confusion), pulling unknown or broken code. Fully qualify registry sources, prefer explicit local/private references, and add a preflight that verifies the artifact's provenance (digest/source) before deploying or building against it.

**Applies in:** container images; package/artifact resolution; supply-chain provenance
