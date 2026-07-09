---
phase: 03-cli-shell-glob-explain-dogfood
plan: 04
subsystem: validation

requires:
  - phase: 03-cli-shell-glob-explain-dogfood/03-03
    provides: whoodb CLI binary
provides:
  - scripts/augment-tokens-jsonl.js — idempotent JSONL nested-field migration
  - test/dogfood.test.js — SC-4 locked query end-to-end test
  - test/perf.test.js — PERF-01 + PERF-02 budgets, gated by WHOODB_RUN_PERF
affects: [milestone close]

tech-stack:
  added: []
  patterns:
    - "Idempotent JSONL augmentation (passes through pre-augmented rows)"
    - "Performance fixture caching in os.tmpdir() across test runs"
    - "Env-var gating for slow tests via { skip: !RUN }"
    - "fd-based writeSync batched JSONL generation (avoids string-concat blowup)"

key-files:
  created:
    - scripts/augment-tokens-jsonl.js
    - test/dogfood.test.js
    - test/perf.test.js
  modified:
    - .planning/metrics/tokens.jsonl (17 rows augmented in place)

key-decisions:
  - "Augment file (not change query) — locked decision in plan rationale: query is in requirements.md, file is auxiliary"
  - "ROW_COUNT bumped from 500K to 600K — 500K × 177 bytes = 88MB, just under PERF-01's 100MB floor"
  - "Child-process spawning in dogfood.test.js — consistent with cli.test.js, avoids stdout-override race"
  - "Perf timing measured wall-clock around the spawnSync call (includes ~30ms Node startup; negligible vs 5s/15s budgets)"

patterns-established:
  - "Idempotent migration scripts: check sentinel field before mutating"
  - "Skip-by-default slow tests: { skip: !process.env.GATE }"

requirements-completed: [TEST-03, PERF-01, PERF-02]
test-tiers: [integration, e2e, perf]

duration: ~10min
completed: 2026-05-02
---

# Plan 03-04: Dogfood + Performance Summary

**SC-4 dogfood query runs end-to-end against real PAN telemetry; PERF-01 (~106MB WHERE) and PERF-02 (100K GROUP BY) finish 30×+ under budget**

## Accomplishments
- `scripts/augment-tokens-jsonl.js`: 84-line idempotent migration adding nested `usage` to every row
- 17 rows in `.planning/metrics/tokens.jsonl` augmented (running script twice reports 0 augmented, 17 skipped)
- `test/dogfood.test.js`: 2 tests verify SC-4 locked query exits 0, returns plausible aggregates with non-zero `out`, sorted DESC
- `test/perf.test.js`: 3 tests (2 gated, 1 unconditional) — PERF-01 0.40s for 106.3MB, PERF-02 0.15s for 100K rows
- 173 total tests in default mode (171 pass + 2 perf skip)

## Performance Results (WHOODB_RUN_PERF=1)

| Test | Budget | Observed | Headroom |
|------|--------|----------|----------|
| PERF-01 (WHERE on ~106MB / 600K rows) | <15s | 0.40s | 37× under |
| PERF-02 (GROUP BY on 100K rows) | <5s | 0.15s | 33× under |

## Task Commits

1. **Tasks 1+2+3: augment script + dogfood + perf** — `d434874` (feat)

## Files Created/Modified
- `scripts/augment-tokens-jsonl.js` (NEW) — idempotent JSONL nested-field migration
- `.planning/metrics/tokens.jsonl` (MODIFIED) — 17 rows now have nested `usage` object
- `test/dogfood.test.js` (NEW) — SC-4 locked-query test + --explain test
- `test/perf.test.js` (NEW) — PERF-01 + PERF-02 + gating-confirmation tests

## Decisions Made
- **Bumped ROW_COUNT 500K → 600K**: At ~177 bytes per JSONL line, 500K rows = 88.6MB which falls just below PERF-01's 100MB floor. 600K rows = 106.3MB, comfortably ≥100MB.
- **Child-process spawning in dogfood test**: Consistent with cli.test.js. Avoids the same stdout-override / TAP-eating issue that caused tests 1-13 to disappear in cli.test.js Plan 03-03.
- **fd-based batched writes for fixture generation**: writeSync(fd, batch) per 5K rows beats string-concat-then-writeFileSync for 600K-row fixtures (~6 batches × 5K × 200 bytes per batch).

## Deviations from Plan
None substantive. The only adjustment was bumping fixture ROW_COUNT from the plan's 500K to 600K to clear the 100MB floor by a margin.

## Issues Encountered
**Initial ROW_COUNT undersized** — first PERF-01 run failed the `fileSize >= 100MB` precondition assertion. Fixed by increasing ROW_COUNT.

## Next Phase Readiness
- Phase 3 success criteria SC-1 (--explain), SC-2 (glob), SC-3 (perf), SC-4 (dogfood), SC-5 (EPIPE) all met
- All Phase 3 requirements (SRC-01..03, CLI-01..06, TEST-01..04, PERF-01..02) satisfied
- Ready for phase verification

---
*Phase: 03-cli-shell-glob-explain-dogfood*
*Completed: 2026-05-02*
