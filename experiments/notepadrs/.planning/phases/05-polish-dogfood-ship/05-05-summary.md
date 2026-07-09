---
phase: 05-polish-dogfood-ship
plan: 05
subsystem: testing
tags: [ship-gate, sc-11, sc-12, build-02, test-01, release-gates]

requires:
  - phase: 05-polish-dogfood-ship
    provides: "Plans 05-01..03 closed prior to running this gate"
provides:
  - "tests/ship_gate.rs (2 tests): binary_size_under_10mb (SC-11 / BUILD-02) + test_inventory_meets_minimum_test_count (SC-12 / TEST-01)"
  - "ship-checklist.md: 7-step v1.0.0 release runbook"
  - "Programmatic enforcement: builds fail if release exe > 10MB or required test files are missing/empty"
affects: [v1.0.0 release tag procedure]

tech-stack:
  added: []
  patterns:
    - "File-inventory ship gate (D-3 / O-2-a): test-count enforcement via existence + lower-bound count of each required file. Stable across CI shapes; doesn't parse cargo test output."
    - "Two-stage CI: cargo build --release then cargo test (test_ship_gate's binary_size_under_10mb has a clear panic message naming the missing artifact when stage 1 hasn't run)"

key-files:
  created:
    - "tests/ship_gate.rs"
    - ".planning/phases/05-polish-dogfood-ship/ship-checklist.md"
  modified: []

key-decisions:
  - "Plan 05-05 D-3 / O-2-a: file-inventory check for test-count assertion (NOT parse cargo output) — stable across environments, fails loudly when a test file is removed"
  - "Plan 05-05 D-5: ship-checklist.md Step 6 (git tag + push) is human-action only — never auto-tagged or auto-pushed"
  - "Plan 05-05 D-6: this plan is autonomous (parallel with Plan 05-04 in Wave 3) — ship-gate enforces facts about already-built artifacts, independent of manual dogfood"
  - "10MB threshold = 10*1024*1024 = 10_485_760 bytes (D-2 — matches SC-11 spec language)"

patterns-established:
  - "Ship-gate-as-test: a single committed test file declaratively expresses release thresholds. Reverting / breaching a threshold fails CI before merge."

requirements-completed: []  # Plan 05-05 enforces SC-11 / SC-12 / BUILD-02 / TEST-01 but does not 'close' a single requirement ID. SC-11 / SC-12 are success criteria, not requirement IDs in requirements.md.
test-tiers: [unit]

duration: 12 min
completed: 2026-05-03
---

# Phase 05 Plan 05: SC-11 / SC-12 Ship Gate + v1.0.0 Release Checklist

**Single committed test (tests/ship_gate.rs) asserts release-binary size ≤ 10MB and ≥30 cumulative inventoried tests; ship-checklist.md documents the 7-step v1.0.0 release runbook. Pure verification scaffolding — no feature code added.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-05-03T04:03Z
- **Completed:** 2026-05-03T04:15Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- **`tests/ship_gate.rs`** (2 tests, both passing):
  - `binary_size_under_10mb` — locates release binary at `target/x86_64-pc-windows-msvc/release/notepadrs.exe` (or fallback `target/release/notepadrs.exe`), asserts size ≤ `10_485_760` bytes. **Current: 1,527,296 bytes (~1.46 MB) — well under 10MB ceiling.**
  - `test_inventory_meets_minimum_test_count` — file-existence + lower-bound-count check across 25 required test files. Asserts cumulative minimum ≥30. **Current: 340+ tests across 25 files — large headroom.**
  - Both tests panic with clear remediation guidance on breach.
- **`ship-checklist.md`**: 7 steps covering pre-flight (Plans 05-01..04 closed), clean build, automated ship gate, full test green, manual smoke (Recent Files / drag-drop / word-wrap quick-checks), distribution sanity (single exe, OS DLLs, manifest), git tag + push (human action — D-5), optional artifacts (SHA256, deferred MSI/signing).

## Task Commits

1. **Task 1: tests/ship_gate.rs (binary-size + test-count gates)** — `3875cf8` (test: SC-11 / SC-12 automated ship gate + v1.0.0 release checklist)
2. **Task 2: ship-checklist.md (v1.0.0 release procedure)** — combined into the same commit `3875cf8` (Tasks 1+2 are tightly coupled; the test file references the checklist)

## Files Created/Modified

- `tests/ship_gate.rs` (NEW) — 2 ship-gate tests
- `.planning/phases/05-polish-dogfood-ship/ship-checklist.md` (NEW) — 7-step v1.0.0 release runbook

## Decisions Made

See `key-decisions` frontmatter. Notable execution detail:

- **Path search order**: tested `target/x86_64-pc-windows-msvc/release/notepadrs.exe` FIRST because that's what this project's release builds emit (the cross-target path is what cargo defaults to when `windows-msvc` is the current host). The bare `target/release/...` fallback is for CI shapes that override the target dir.

## Deviations from Plan

None - plan executed exactly as written. Both tasks combined into one atomic commit (the test file's documentation header references the checklist, and the checklist references the test file — they're a tightly-coupled unit).

## Issues Encountered

None.

## Next Phase Readiness

- SC-11 / SC-12 verification gates landed declaratively. Any future PR that bloats the binary >10MB or removes test files fails CI immediately.
- Plan 05-04 (dogfood marker) runs in parallel; both must close for Phase 5 verification to pass.

---
*Phase: 05-polish-dogfood-ship*
*Completed: 2026-05-03*
