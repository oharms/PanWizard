# ADR-0014: Internal Cleanup & Code Quality Hardening

## Status
Proposed

## Context
PAN Wizard v2.3.0 has 15 core modules (4,770+ LOC), a CLI dispatcher (735+ LOC), and an installer (2,636 LOC) that have accumulated technical debt across 23 development sessions. A comprehensive 5-agent parallel audit identified ~170 issues:

- 12 functions exceed the project's own 50-line complexity budget
- 3 functions are duplicated across modules
- 11 dispatcher argument accesses lack bounds validation
- 15+ magic numbers are scattered instead of centralized in constants
- 5 dead imports/re-requires waste module surface area

The codebase is functionally correct (1,180 tests, 0 failures) and architecturally sound (clean DAG, no circular deps). This is maintenance debt, not architectural debt.

## Decision
Perform a 4-wave internal cleanup:

1. **Dead code removal** — Remove duplicate imports, unused params, redundant re-requires
2. **Duplication consolidation** — Merge `getArchivedPhaseDirs`/`listArchivedPhaseDirs`, extract shared standards parser, centralize magic numbers in constants.cjs, add `getArgValue()` dispatcher helper
3. **Complexity reduction** — Split 12 functions exceeding 50 lines by extracting focused helpers
4. **Dispatcher hardening** — Add argument validation to 11 unguarded `args[N]` accesses

All changes are behavioral no-ops — identical input produces identical output. Zero breaking changes.

## Consequences

### Positive
- All core functions comply with 50-line/3-nesting/4-param complexity budget
- Single source of truth for archive phase search, standards parsing, magic numbers
- Dispatcher rejects missing arguments with actionable errors instead of passing `undefined`
- Reduced maintenance cost for future development sessions
- Cleaner codebase for potential contributors

### Negative
- ~45 points of effort with zero user-facing feature delivery
- Risk of subtle behavior changes in extracted helpers (mitigated by 1,180 existing tests)
- Constants.cjs grows by ~15 new exports

### Neutral
- Installer is out of scope (its 22 issues warrant a separate ADR)
- Test style inconsistencies (test vs it, assert vs assert/strict) are cosmetic and deferred

## Options Considered
1. **Do nothing** — Functional but accumulates debt; next session compounds issues
2. **Full rewrite** — Unnecessary; architecture is sound, only implementation details need work
3. **Incremental 4-wave cleanup (chosen)** — Lowest risk, independently testable per wave

## Links
- Feature spec: `docs/specs/internal_cleanup_code_quality_featureai.md`
- Related: ADR-0003 (smart execution), ADR-0006 (focus commands)
- Audit methodology: 5 parallel Explore agents scanning all 15 modules + dispatcher + installer
