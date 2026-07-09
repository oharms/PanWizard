---
title: "whooschema — JSON Schema (Draft-07 subset) validator with helpful error paths"
created: "2026-05-02"
created_by: oharms
runtime_preference: claude
budget: 35
priority: medium
---

# Idea: whooschema — minimal JSON Schema validator

A zero-dependency Node.js library + CLI that validates JSON documents against a useful subset of JSON Schema Draft-07. The headline feature is **error reporting quality**: every violation reports a JSONPath like `$.users[2].email` plus the rule that failed and the actual vs expected — so callers can build great error messages instead of `"validation failed at /users/2/email: failed to validate"`.

## Problem

PAN already has frontmatter validation (handcrafted regex checks in `frontmatter.cjs`) but no general JSON validator. Real-world need: validating `config.json`, `pan-file-manifest.json`, `experiment.json`, `tokens.jsonl` records, and incoming agent data. Existing libraries (`ajv`, `joi`) are heavy and have transitive deps. A small Schema validator that handles the 80% cases with great error paths is dogfood-worthy.

This experiment is interesting because it stresses **recursive data traversal**, **schema composition** (`oneOf`, `anyOf`, `allOf`), **error aggregation** (collect all violations, not just the first), and **path tracking** through nested arrays/objects — none of which past `whoo*` experiments have hit.

## Success Criteria

- **SC-1:** Library API: `validate(schema, data) => { valid: bool, errors: [{path, rule, message, value, expected}] }`. Errors are an aggregated list — validation does NOT short-circuit on first failure.
- **SC-2:** Supported keywords (Draft-07 subset):
  - **Type:** `type` (string, number, integer, boolean, null, array, object)
  - **Strings:** `minLength`, `maxLength`, `pattern`, `enum`, `format` (limited to `email`, `uri`, `date`, `date-time`, `uuid`)
  - **Numbers:** `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
  - **Arrays:** `items`, `minItems`, `maxItems`, `uniqueItems`
  - **Objects:** `properties`, `required`, `additionalProperties` (true/false), `patternProperties`
  - **Composition:** `oneOf`, `anyOf`, `allOf`, `not`
  - **References:** `$ref` to local pointers only (`#/definitions/foo`); no remote refs.
- **SC-3:** Error path format: JSONPath-style — `$.users[2].email` for arrays, `$.config.model_profile` for objects. Root violation is `$`.
- **SC-4:** Error aggregation: `validate(schema, data)` for an object with 5 violations returns all 5 errors, sorted by path lex order.
- **SC-5:** CLI: `whooschema validate --schema <file> --data <file>` prints `OK` and exits 0 if valid, prints one line per error and exits 1 otherwise. `--format json` emits the full error array as JSON.
- **SC-6:** ≥14 tests: each supported keyword has at least one passing and one failing case; nested object/array path correctness; oneOf with multiple matches (must fail); allOf with combined constraints; ref resolution with `$ref`; cycle in $ref rejected (don't infinite-loop); unknown keyword warned (not failed) so forward-compat is gentle; multi-error aggregation order; `pattern` invalid regex rejected at schema-load time; `format` unknown ignored not failed.
- **SC-7:** Dogfood: validate PAN's actual `.planning/config.json` against a hand-written `config.schema.json` and produce a clean OK on a real config.
- **SC-8:** Performance: validate a 1MB JSON document against a 200-line schema in under 200ms.

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| Draft-07 keyword subset listed above | `if/then/else`, `dependentRequired`, `contains`, `propertyNames` |
| Local `$ref` resolution | Remote `$ref` (HTTP, file system) |
| Aggregated error list | Custom error message templates |
| `oneOf` / `anyOf` / `allOf` / `not` | `definitions` recursion limit configuration |
| `format` validation: email, uri, date, date-time, uuid | Other formats (ipv4, regex, hostname) |
| JSON Schema for the schema itself (meta-validate) | Auto-generate schema from data |

## Constraints

- **Tech stack:** Node.js >= 16, zero runtime deps. Pure builtins (`fs`, `path`, `node:test`, `node:assert/strict`).
- **Performance:** see SC-8.
- **Determinism:** error order is path lex-sorted; same schema + data → exact same error array.
- **Cross-platform:** path output uses forward slashes.
- **Behavior on schema errors:** an invalid schema (bad regex, unknown keyword in strict mode, $ref cycle) is rejected at load with a clear error before any data is checked.

## Reference material

- PAN's `pan-wizard-core/bin/lib/frontmatter.cjs` — current validation patterns to study
- PAN's `pan-file-manifest.json` and `.planning/config.json` — real-world dogfood targets
- JSON Schema Draft-07 spec — implement the subset listed in SC-2
- The existing `whooo` linter — schema-driven validation pattern, similar shape

## Notes

- **Decision principle:** error path quality is the differentiator — it's why a 600-line library beats `ajv` for "give me a nice error message". Optimize that path.
- **Eat-our-own-dogfood marker:** done when validating PAN's `config.json` against a hand-written `config.schema.json` produces `OK`, and a deliberately-broken copy produces a list of human-readable error paths.
- **Promote-worthy findings expected:** path-tracking pattern through recursive validation, error-aggregation strategy (collect-all vs short-circuit per branch — especially in `oneOf` / `anyOf` where you need to know *why* none of the branches matched), `$ref` cycle detection, format validators as plug-in functions.
- **Wave hint:** Plan 01 = type + primitive keywords + path tracking + error aggregation. Plan 02 = composition keywords (`oneOf`, `anyOf`, `allOf`, `not`) + `$ref` resolution. Plan 03 = `format` validators + CLI + dogfood.
