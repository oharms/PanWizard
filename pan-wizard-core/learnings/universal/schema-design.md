---
topic: schema-design
last_updated: 2026-04-27T09:48:41.048Z
patterns:
  - id: P-202
    summary: Infer schemas from real-file sampling pass; do not author them from imagination
    promoted_at: 2026-04-27T09:48:41.048Z
    source_experiments: [whooo]
---

# Schema Design (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-202 — Infer schemas from real-file sampling pass; do not author them from imagination

**Evidence:** whooo trace.jsonl 11:52Z (gap major) and 11:53Z (gap minor): hand-authored name pattern rejected 44/52 PAN command files using pan: prefix; argument-hint field present in 30+ files was missing from schema entirely. 30+ unknown-field warnings as a result.

**Rule:** When authoring a schema for an existing corpus, run a sampling pass first: extract observed fields and value patterns from representative real files, THEN write the schema. Manual schemas guarantee a mismatch with reality. Provide a schema generate dir capability for any corpus-validation tool.

**Applies in:** plan-phase (designing validation tooling), exec-phase (schema authoring)
