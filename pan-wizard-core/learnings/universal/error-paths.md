---
topic: error-paths
last_updated: 2026-05-02T15:25:54.602Z
patterns:
  - id: P-1205
    summary: Error-path tracking via a path stack threaded through recursive validators yields readable JSONPath like $.users[2].email instead of opaque pointers
    promoted_at: 2026-05-02T15:25:54.601Z
    source_experiments: [whooschema]
---

# Error Paths (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1205 — Error-path tracking via a path stack threaded through recursive validators yields readable JSONPath like $.users[2].email instead of opaque pointers

**Evidence:** whooschema validate.js + error-utils.js: makeError(path, rule, value, expected) + sortErrors. Phase 1 verification: 40 tests pass, errors carry JSONPath. Phase 2 added composition (oneOf/anyOf/allOf/$ref) with the same path threading. The path-tracking pattern was the differentiator vs ajv/joi alternatives that ship 'failed at /users/2/email'.

**Rule:** When recursing through nested data (validators, walkers, transformers), maintain an explicit path array and push/pop as you descend/ascend. Build error messages with $.field.array[0].nested format from that path. This costs ~3 lines per recursion frame but transforms 'validation failed' into 'validation failed at $.users[2].email: must match pattern ^.+@.+$ (got "alice")'. Aggregate ALL errors into a list, sorted by path lex order — don't short-circuit on first failure.

**Applies in:** validators, transformers, schema-driven UIs, recursive walkers
