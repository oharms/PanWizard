---
topic: schema-design
last_updated: 2026-07-18T08:42:29.861Z
patterns:
  - id: P-202
    summary: Infer schemas from real-file sampling pass; do not author them from imagination
    promoted_at: 2026-04-27T09:48:41.048Z
    source_experiments: [whooo]
  - id: P-FH-020
    summary: Don't overload a payload field as control metadata — use an explicit envelope
    promoted_at: 2026-07-18T08:42:29.855Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-021
    summary: Schema-compatibility gates must recurse into nested payloads
    promoted_at: 2026-07-18T08:42:29.856Z
    source_experiments: [field-harvest-2026-07]
  - id: P-FH-034
    summary: App-assigned identity inside a composite primary key collides on a shared column in a batch
    promoted_at: 2026-07-18T08:42:29.861Z
    source_experiments: [field-harvest-2026-07]
---

# Schema Design (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-202 — Infer schemas from real-file sampling pass; do not author them from imagination

**Evidence:** whooo trace.jsonl 11:52Z (gap major) and 11:53Z (gap minor): hand-authored name pattern rejected 44/52 PAN command files using pan: prefix; argument-hint field present in 30+ files was missing from schema entirely. 30+ unknown-field warnings as a result.

**Rule:** When authoring a schema for an existing corpus, run a sampling pass first: extract observed fields and value patterns from representative real files, THEN write the schema. Manual schemas guarantee a mismatch with reality. Provide a schema generate dir capability for any corpus-validation tool.

**Applies in:** plan-phase (designing validation tooling), exec-phase (schema authoring)

## P-FH-020 — Don't overload a payload field as control metadata — use an explicit envelope

**Evidence:** A zero-dependency router interpreted a returned object's `status` key as the HTTP status, so every handler whose body legitimately contained a `status` field misbehaved until responses were wrapped in an explicit { status, body } envelope.

**Rule:** When a minimal or hand-rolled framework treats a well-known field name (such as `status`) as control metadata, any domain payload that legitimately carries the same key collides and the framework misreads the data as control. Separate transport/control metadata from the domain payload with an explicit envelope (e.g. { status, body }) rather than reading control values directly out of the payload object.

**Applies in:** contract/envelope design; schema-drift & fingerprint gates; composite keys

## P-FH-021 — Schema-compatibility gates must recurse into nested payloads

**Evidence:** A message-contract gate validated only the envelope's fingerprint while several inner payload schemas were unguarded, meaning a breaking change to a nested schema would go undetected.

**Rule:** A contract-drift or schema-fingerprint gate that fingerprints only the outer envelope gives false confidence: a breaking change to a nested/inner schema passes undetected. Extend the compatibility/fingerprint check to every nested payload schema, not just the envelope, so nested breaking changes are actually caught.

**Applies in:** contract/envelope design; schema-drift & fingerprint gates; composite keys

## P-FH-034 — App-assigned identity inside a composite primary key collides on a shared column in a batch

**Evidence:** An entity mapped with a never-generated identity plus a composite key of (id, sampled_at) threw a duplicate-key/tracking error whenever two tenants produced rows in the same sampling cycle because every row shared the same timestamp and a zero id; a sibling entity with the same never-generated setup survived only via a distinct per-row timestamp.

**Rule:** If an entity's identity column is application-assigned (left unset / not database-generated) and it participates in a composite primary key alongside a low-cardinality or shared-per-batch column (such as a common sampling timestamp), inserting several such rows in one unit of work collides on the identical key. Make the identity column database-generated (or otherwise guarantee true per-row uniqueness) when it is part of a composite key; a sibling entity that survives usually does so only because it happens to carry a distinct per-row value in the other key column.

**Applies in:** contract/envelope design; schema-drift & fingerprint gates; composite keys
