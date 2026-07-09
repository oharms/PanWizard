# Phase 1: Foundation - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning
**Source:** Auto-mode synthesis (P-1803, v3.7.8) — derived from idea.md + project.md + requirements.md without user dialogue

<domain>
## Phase Boundary

Users can validate any JSON document against primitive keywords and receive JSONPath-located, fully-aggregated error objects with deterministic ordering.

This phase delivers the **foundation layer**: the public `validate(schema, data)` API, type/string/number/array/object keyword handlers, the path-tracking mechanism, the error-aggregation contract, the schema-loader skeleton (with regex-validity check and unknown-keyword warning), and the baseline test suite. Composition keywords (`oneOf`/`anyOf`/`allOf`/`not`), `$ref` resolution, format validators, and the CLI are explicitly OUT — they live in Phases 2 and 3.

</domain>

<decisions>
## Implementation Decisions

### From idea.md (locked constraints)

- **Zero runtime dependencies** — pure Node.js builtins only (`fs`, `path`, `node:test`, `node:assert/strict`). Non-negotiable.
- **Module format:** Pure ESM (per stack.md). `"type": "module"` in package.json.
- **Node minimum:** Engines `>=18` (per stack.md — Node 16 hit EOL Sept 2023, `node:test` describe/it API is unreliable before v18).
- **Public API shape:** `validate(schema, data) => { valid: bool, errors: [{path, rule, message, value, expected}] }`.
- **No short-circuit:** Validation must aggregate all errors. Single primitive call returns all violations.
- **Path format:** JSONPath-style — `$` for root, `$.field` for object properties, `$.field[2]` for array indices. Forward slashes regardless of host OS.
- **Determinism:** Errors sorted by path with numeric-aware comparator (`[2]` < `[10]`). Identical schema + data must produce byte-identical error arrays.
- **Schema-load-time validation:** Invalid `pattern` regex rejected at load with clear error before any data is checked. Unknown keywords warned (not failed) — forward-compat is gentle.
- **Type strictness:** No coercion. `"5"` does NOT pass `type: number`. NaN and Infinity rejected. `null` does not match `type: object`.

### From requirements.md → Phase 1 mapping

Locked in scope (must ship in this phase):

- **API-01..05**: Public function signature, error aggregation, deterministic numeric-aware sort, root-path `$` and JSONPath syntax, cross-platform forward-slash output.
- **TYPE-01**: `type` keyword across string/number/integer/boolean/null/array/object — including integer-vs-number distinction, NaN/Infinity rejection, `null` not matching object.
- **TYPE-02**: String keywords — `minLength`, `maxLength`, `pattern`, `enum`. (`pattern` regex compilation tested at schema load.)
- **TYPE-03**: Number keywords — `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` (with float-epsilon awareness for fractional `multipleOf`).
- **TYPE-04**: Array keywords — `items` (single schema OR tuple form), `minItems`, `maxItems`, `uniqueItems` (deep equality via canonical-key-sorted JSON.stringify, per pitfalls.md).
- **TYPE-05**: Object keywords — `properties`, `required`, `additionalProperties` (true | false), `patternProperties` with the **correct** interaction: `additionalProperties` rejects only keys not matched by either `properties` or `patternProperties` (per pitfalls.md).
- **LOAD-01**: Invalid `pattern` regex throws a clear load-time error.
- **LOAD-02**: Unknown keywords warned (`console.warn` once per unknown keyword), not failed. Note: `additionalProperties` as a SCHEMA OBJECT (not just true/false) is treated as the permissive `true` case in this phase — the schema-object form is deferred to Phase 2 alongside other recursive composition. (Flagged as a known gap in research summary; revisit if dogfood reveals need.)
- **TEST-01..02**: ≥14 tests via `node --test`, zero runtime deps in production code.

### From research (architecture.md / pitfalls.md)

- **Path tracking:** Immutable string accumulator passed as argument to every recursive validator call. **Never mutate** a shared path stack — pitfalls.md confirms this is the #1 source of corrupted error paths in custom validators.
- **Error aggregation:** Every keyword handler appends to a shared `errors` array; no early return. Each handler is a pure function returning the new error list (or mutates a passed-in array — planner decides).
- **Deterministic sort:** Custom path comparator that segments the path and compares each segment with numeric-aware coercion. Naive lex sort breaks `[10]` vs `[9]`.
- **Module layout for this phase:**
  - `src/validate.js` — public API entry point
  - `src/schema-loader.js` — load + regex-compile + unknown-keyword warn
  - `src/validator-core.js` — `validateNode(schema, data, path, errors)` recursive walker
  - `src/keyword-handlers.js` — `type`, string/number/array/object keyword handlers
  - `src/error-utils.js` — error object factory + path comparator + path-segment helpers
  - Composition handlers, ref-resolver, formats, and CLI files are NOT created in this phase.
- **Test layout:** `test/*.test.js` per source file, plus `test/integration.test.js` for multi-error aggregation and sort determinism.

### Claude's Discretion

- Internal function signatures for `validateNode`, error factory, path-segment helpers (planner decides exact shape).
- Test fixture structure and naming.
- Whether `validateNode` mutates an `errors` array or returns one (immutable vs accumulator — both meet the contract).
- Internal module boundary between `keyword-handlers.js` and `validator-core.js` (one file vs split).
- Test framework conventions (describe blocks vs flat tests).
- Comment density and inline doc style.
- Whether `additionalProperties` defaults treat `undefined` as `true` (permissive, per spec) or strict — go with spec default (permissive).
- `multipleOf` epsilon strategy for floating-point cases.
- `uniqueItems` canonical-stringify implementation (research suggests sorted-key JSON.stringify; planner can pick).

</decisions>

<specifics>
## Specific References

- **PAN's `pan-wizard-core/bin/lib/frontmatter.cjs`** — current ad-hoc validation patterns. Worth reading to understand what whooschema is replacing, but don't import or depend on it.
- **JSON Schema Draft-07 spec** — the authoritative source for keyword semantics. Implement the subset listed in idea.md SC-2.
- **JSON Schema Test Suite (per architecture.md)** — worth pulling per-keyword test files for the keywords scoped here, copied into `test/fixtures/`. Skip out-of-scope keyword tests.
- **Existing `whooo` linter** (mentioned in idea.md) — schema-driven validation pattern reference if helpful.
- **JSONPath** — paths use the `$` prefix and dot/bracket notation; not RFC 6901 JSON Pointer (`/users/2/email`).

</specifics>

<deferred>
## Deferred Ideas

None — auto-mode synthesis honors the original idea.md scope.

The following are explicit Phase 2/3 work surfaced by research and listed here for traceability only:

- `additionalProperties` as a sub-schema (not just true/false) — Phase 2 (recursive composition).
- All composition keywords (`oneOf`, `anyOf`, `allOf`, `not`) — Phase 2.
- Local `$ref` resolution + cycle detection — Phase 2.
- Format validators (email, uri, date, date-time, uuid) — Phase 3.
- CLI binary, `--format json`, exit codes — Phase 3.
- Dogfood (validate `.planning/config.json` against handwritten schema) — Phase 3.
- Performance benchmark (1MB / 200ms) — Phase 3.

</deferred>

---

*Phase: 01-foundation*
*Context auto-synthesized: 2026-05-02 via discuss-phase P-1803 bypass — no user dialogue*
