---
phase: 1
slug: build-cli
verifier: claude-direct
verified_at: 2026-04-27T11:55:00Z
status: passed
test_gate_status: passed
test_total: 39
test_passed: 39
test_failed: 0
---

# Phase 1: build-cli — Verification

## Goal-backward analysis

**Phase goal:** Ship a working markdown frontmatter linter satisfying REQ-01..REQ-10, including the dogfood gate.

### Truths verified

| # | Truth | Evidence | Status |
|---|-------|----------|--------|
| 1 | whooo lint walks a dir and validates each .md frontmatter against the schema | `cli.test.js:lint of fixtures/ exits 1` PASSES; CLI exit-code semantics correct | ✓ VERIFIED |
| 2 | whooo lint emits human OR json output based on --format | `cli.test.js:lint --format json emits parseable JSON lines` PASSES; both formatters tested | ✓ VERIFIED |
| 3 | whooo schema check validates a schema file | `cli.test.js:schema check on valid schema exits 0` PASSES | ✓ VERIFIED |
| 4 | All 8+ test cases pass | 39 tests pass (5 unit files, exceeded SC-4 ≥8 by 4.9x) | ✓ VERIFIED |
| 5 | Running whooo against PAN's commands/pan/ produces a non-empty real-world report | Final dogfood: 9 errors + 4 warnings across 52 files in 51ms | ✓ VERIFIED |

### Artifacts verified (per must_haves block in plan)

- `bin/whooo.js` ✓ exists, ~140 LOC, dispatcher routes 4 commands
- `lib/frontmatter.js` ✓ exists, ~190 LOC, supports flow + block lists
- `lib/schema.js` ✓ exists, ~165 LOC, parses schema definitions
- `lib/validate.js` ✓ exists, ~155 LOC, implements all 8 error codes
- `lib/walk.js` ✓ exists, ~100 LOC, glob-aware recursive walker
- `lib/reporter.js` ✓ exists, ~30 LOC, human + JSON formatters
- `test/frontmatter.test.js` ✓ 9 tests
- `test/schema.test.js` ✓ 8 tests
- `test/validate.test.js` ✓ 9 tests
- `test/walk.test.js` ✓ 6 tests (includes globToRegex regression test)
- `test/cli.test.js` ✓ 7 tests
- `test/fixtures/basic.schema.yml` ✓ exists, parsed by tests
- `test/fixtures/pan-cmd.schema.yml` ✓ exists, used by dogfood gate
- 7 fixture .md files (valid + 6 violation cases + 1 unknown-field) ✓

### Key links verified

- bin/whooo.js → lib/walk.js (calls walkMarkdownFiles) ✓ WIRED
- bin/whooo.js → lib/frontmatter.js (calls parseFrontmatter) ✓ WIRED
- bin/whooo.js → lib/schema.js (calls parseSchema, checkSchema) ✓ WIRED
- bin/whooo.js → lib/validate.js (calls validateAgainstSchema) ✓ WIRED
- bin/whooo.js → lib/reporter.js (calls formatHuman/formatJson/summaryLine) ✓ WIRED

## Requirements coverage

| REQ | Status | Verification |
|-----|--------|--------------|
| REQ-01 | ✓ | cli.test.js:lint of fixtures (8 files in fixtures + outputs report) |
| REQ-02 | ✓ | cli.test.js:--format json emits parseable JSON lines |
| REQ-03 | ✓ | cli.test.js:schema check on valid schema exits 0 |
| REQ-04 | ✓ | 39 tests across 5 files (target was ≥8) |
| REQ-05 | ✓ | npm test exits 0; 39/39 pass |
| REQ-06 | ✓ | Dogfood: 9 errors + 4 warnings against PAN's 52 commands/pan/*.md |
| REQ-07 | ✓ | package.json has no `dependencies` field; all imports are node:* or relative |
| REQ-08 | ✓ | Error codes documented in DESIGN_SPEC §"Error codes"; implemented in validate.js |
| REQ-09 | ✓ | toPosix() used in walk.js; all violation.file paths are POSIX |
| REQ-10 | ✓ | Lint of 52 files: 51ms (target was <1s for 100 — 20x under budget) |

## Test gate

```
$ npm test
✔ ... 39 tests pass ...
ℹ tests 39
ℹ pass 39
ℹ fail 0
ℹ duration_ms 417.46
```

## Anti-pattern scan

No TODO/FIXME/HACK/XXX in shipped lib/ or bin/. Some inline `_line` markers in schema.js for line-number tracking — documented as private (stripped in publicDef return).

## Real-world findings discovered (promote-worthy)

Six findings emerged during the build, each documented in trace.jsonl. They are listed in `01-build-cli-summary.md` § "Promote-worthy findings".

## Status

**passed** — All truths verified, all artifacts substantive, all key links wired, test gate passed, dogfood gate produced real report. Ready for harvest.
