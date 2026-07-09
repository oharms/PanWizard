---
phase: 03-cli-shell-glob-explain-dogfood
status: passed
verified_by: orchestrator (inline; pan-verifier subagent unavailable in this runtime)
verified: 2026-05-02
total_tests: 173
tests_passing: 171
tests_skipped: 2 (perf, gated by WHOODB_RUN_PERF)
tests_failing: 0
---

# Phase 3 Verification Report

## Goal

> A user can install and run `whoodb query` from the command line against single files, glob patterns, and real PAN token logs, with --explain for query introspection and --format table for human-readable output.

**Status: ACHIEVED**

## Plan Completion

| Plan | Status | Summary |
|------|--------|---------|
| 03-01 | ✓ | from-resolver + multi-file evaluator (140/140 tests) |
| 03-02 | ✓ | explain + formatter modules (153/153 tests) |
| 03-03 | ✓ | CLI shell, bin entry, 15 integration tests (168/168 tests) |
| 03-04 | ✓ | Schema augmentation, dogfood test, perf budgets (173/173 in default mode) |

## Phase Success Criteria

| SC | Description | Status | Evidence |
|----|-------------|--------|----------|
| SC-1 | `--explain` prints plan + AST without filesystem I/O | ✓ | `node bin/whoodb.js query --explain "SELECT * FROM 'nonexistent.jsonl' LIMIT 1"` exits 0; CLI test verifies same |
| SC-2 | Glob FROM expands cross-platform | ✓ | `fixtures/*.jsonl` resolves to 2 files; LIMIT respected across both |
| SC-3 | Perf budgets met (PERF-01 <15s, PERF-02 <5s) | ✓ | Observed: PERF-01 0.40s for 106.3MB / 600K rows; PERF-02 0.15s for 100K rows |
| SC-4 | Dogfood query works against real PAN log | ✓ | 6 agent groups, total `out` = 551,174 tokens (non-zero), sorted DESC |
| SC-5 | `whoodb query \| head -1` exits 0 (no EPIPE crash) | ✓ | CLI-06 test (driver-script consume-then-destroy pattern) passes |

## Phase Requirements

All 15 requirement IDs in the phase frontmatter (SRC-01, SRC-02, SRC-03, CLI-01..06, TEST-01..04, PERF-01..02) are accounted for:

### Source (FROM)
- **SRC-01** ✓ Single literal path resolves to one-element array (from-resolver test 1)
- **SRC-02** ✓ Glob expands to multiple sorted forward-slash paths (from-resolver test 2 + multi-file evaluator integration)
- **SRC-03** ✓ Backslash → forward-slash normalization on Windows (from-resolver test 3)

### CLI
- **CLI-01** ✓ `whoodb query "<sql>"` runs and prints results (cli.test.js CLI-01 + smoke test)
- **CLI-02** ✓ Default JSONL output (cli.test.js CLI-02 default)
- **CLI-03** ✓ `--format table` (cli.test.js CLI-03; invalid format → exit 1)
- **CLI-04** ✓ `--explain` prints AST + plan, no I/O (cli.test.js + dogfood --explain test)
- **CLI-05** ✓ Exit codes: 0 success, 1 parse/usage, 2 IO/runtime (5 distinct CLI-05 tests)
- **CLI-06** ✓ EPIPE handler (cli.test.js child-process test)

### Test
- **TEST-01** ✓ ≥15 tests (173 total >> 15); covers SELECT *, named fields, alias, WHERE = / LIKE / IN / BETWEEN, AND/OR/NOT, GROUP BY, COUNT(*), SUM, AVG, ORDER BY ASC/DESC, LIMIT, OFFSET, nested fields, malformed JSONL, parse errors, glob input
- **TEST-02** ✓ All tests run via `node --test`, zero external dependencies
- **TEST-03** ✓ Dogfood test passes (test/dogfood.test.js)
- **TEST-04** ✓ `--explain` of full-clause query shows SCAN/FILTER/GROUP BY/AGGREGATE/SORT/LIMIT (test/explain.test.js + cli.test.js)

### Performance
- **PERF-01** ✓ WHERE on ~106MB / 600K rows: 0.40s (37× under 15s budget)
- **PERF-02** ✓ GROUP BY on 100K rows: 0.15s (33× under 5s budget)

## Test Suite

```
ℹ tests 173
ℹ pass 171
ℹ fail 0
ℹ skipped 2 (perf, gated)
ℹ duration_ms ~745
```

## Smoke Tests Performed

```bash
# SC-1 + SC-2: explain plus glob + LIMIT across multiple files
node bin/whoodb.js query --explain "SELECT * FROM 'fixtures/*.jsonl' LIMIT 5"   # exit 0, no I/O

# SC-4: dogfood query against real tokens.jsonl
node bin/whoodb.js query "SELECT agent, COUNT(*) AS calls, SUM(usage.output_tokens) AS out FROM '.planning/metrics/tokens.jsonl' GROUP BY agent ORDER BY out DESC LIMIT 10"
# Result: 6 rows, all non-zero out, descending order

# Table format
node bin/whoodb.js query --format table "SELECT agent, COUNT(*) AS calls FROM 'fixtures/aggregates.jsonl' GROUP BY agent ORDER BY calls DESC LIMIT 3"
# Result: header + separator + 3 aligned data rows

# Parse error → exit 1
node bin/whoodb.js query "SELECT * FROM" ; echo $?
# Result: stderr "parse error at column 14"; exit 1

# IO error → exit 2
node bin/whoodb.js query "SELECT * FROM 'nope.jsonl'" ; echo $?
# Result: stderr ENOENT; exit 2

# WHOODB_RUN_PERF=1 perf mode
WHOODB_RUN_PERF=1 node --test test/perf.test.js
# Result: PERF-01 0.40s / PERF-02 0.15s — both pass
```

All smoke tests produced expected output.

## Gaps

None. All 15 phase requirements verified via tests and smoke checks.

## Notes for Reviewer

1. **CLI integration tests use child-process spawning** instead of in-process `main(argv)` with stdout override. This deviates from the plan's recommended pattern but was necessary because node:test's TAP output writes asynchronously through process.stdout, and a global override eats the runner's "ok N" lines. Documented in 03-03-summary.md "Deviations from Plan" section.

2. **AST field-name correction in explain.js**: The plan's `<interfaces>` block listed `Aggregate { fn, arg: { type: 'Star' } }` etc., but the actual `src/ast.js` uses `func`, `arg: 'STAR'`, `dir`, `expr`. explain.js uses the real names. Documented in 03-02-summary.md.

3. **Perf fixture ROW_COUNT bumped 500K → 600K** to clear the 100MB floor (500K × 177 bytes = 88.6MB).

4. **Phase 3 was executed inline by the orchestrator** rather than via pan-executor subagents — Task tool was unavailable in this Claude Agent SDK runtime. All plan tasks were executed directly with the same atomic-commit, summary, and verification discipline.
