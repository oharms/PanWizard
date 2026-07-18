---
topic: ambient-context
last_updated: 2026-07-18T08:42:29.855Z
patterns:
  - id: P-FH-017
    summary: Pin the target context explicitly for CLI tools that carry ambient global state
    promoted_at: 2026-07-18T08:42:29.855Z
    source_experiments: [field-harvest-2026-07]
---

# Ambient Context (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-FH-017 — Pin the target context explicitly for CLI tools that carry ambient global state

**Evidence:** Creating a local cluster switched the tool's current context, so a subsequent deploy intended for one environment landed on another until every command was made to pin its context flag explicitly.

**Rule:** CLI tools that operate against an implicit, mutable global context (the current cluster/namespace selection, active cloud profile, default branch/remote) can silently retarget an operation when an unrelated command mutates that context mid-workflow — sending a deploy to the wrong environment. Pass the target explicitly on every invocation via an explicit context/profile flag rather than relying on the ambient selection.

**Applies in:** CLIs over mutable global context (kube-context, cloud profile, active branch); deploy tooling
