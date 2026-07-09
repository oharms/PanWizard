---
phase: 05-polish-dogfood-ship
plan: 04
subsystem: testing
tags: [dogfood, manual-checklist, cargo-toml-roundtrip, sc-12, integration-verification]

requires:
  - phase: 05-polish-dogfood-ship
    provides: "Plans 05-01 (word-wrap) + 05-02 (recent files) + 05-03 (drag-drop) closed prior to running this gate"
  - phase: 02-file-i-o-encoding-cascade
    provides: "open_any_encoding load path + Pattern A original-bytes cache (the byte-exact load contract this test verifies)"
provides:
  - "tests/dogfood_marker.rs (2 tests): cargo_toml_loads_byte_exact_via_open_any_encoding (Phase 2 round-trip load contract on the project's own Cargo.toml) + cargo_toml_decodes_as_utf8 (encoding sanity)"
  - "dogfood-checklist.md: 10-step manual verification procedure (research.md 9 steps + Word Wrap addition) with explicit pass/fail criteria, BLOCKING flag on Step 7 (cargo build after round-trip)"
  - "Operational definition of v1 dogfood marker: open-edit-save Cargo.toml in notepadrs.exe and `cargo build` still passes"
affects: [05-05 ship gate, v1.0.0 release decision]

tech-stack:
  added: []
  patterns:
    - "Two-track verification: GUI-free automated load smoke (D-3 / O-1) + manual GUI checklist (D-4 checkpoint:human-verify). Automated covers the load-path regression class; manual covers save round-trip + Recent Files + drag-drop + word-wrap that need a real Win32 desktop"
    - "Dogfood-on-own-source pattern: the test file uses CARGO_MANIFEST_DIR/Cargo.toml as its fixture, so any cargo-checkout produces a passing test without bundled fixtures"

key-files:
  created:
    - "tests/dogfood_marker.rs"
    - ".planning/phases/05-polish-dogfood-ship/dogfood-checklist.md"
  modified: []

key-decisions:
  - "Plan 05-04 D-1: 9-step procedure copied verbatim from research.md §Dogfood Marker; this plan only added pass/fail scaffolding (Step 10 Word Wrap is the only addition)"
  - "Plan 05-04 D-2: Step 7 (cargo build after round-trip) flagged BLOCKING — release-blocking failure"
  - "Plan 05-04 D-3 / O-1: tests/dogfood_marker.rs SHIPS (2 tests). Covers the load contract end-to-end via open_any_encoding on the project's own Cargo.toml; complements but does NOT replace the manual checklist"
  - "Plan 05-04 D-6 + Phase 02 precedent: test file MUST be named tests/dogfood_marker.rs — Win AppCompat shim error 740 forbids dispatch/install/update/setup substrings in test binary names"

patterns-established:
  - "Dogfood-marker-as-test: a single committed test file (tests/dogfood_marker.rs) keeps the load-path contract on the project's own source under CI; manual checklist is the GUI complement"

requirements-completed: [TEST-06]  # TEST-06 (recent-files persistence) is the only requirement ID explicitly satisfied here. Plan 05-04 verifies VIEW-06/07, RECENT-01..04, DND-01 end-to-end but those IDs were closed in their respective plans (05-01..03); this plan is the integration gate.
test-tiers: [unit, e2e-manual]

duration: 8 min
completed: 2026-05-03
---

# Phase 05 Plan 04: Dogfood Marker (Manual Checklist + Automated Load-Path Smoke)

**Two-track v1 dogfood verification: an automated 2-test GUI-free smoke proving Cargo.toml loads byte-exact through the production code path, plus a 10-step manual checklist that closes the GUI parts (save round-trip, Recent Files, drag-drop, word wrap) on the actual Windows desktop.**

## Performance

- **Duration:** ~8 min (Task 1 auto); Task 2 (checkpoint:human-verify) signed off by user
- **Started:** 2026-05-03T03:35Z
- **Completed:** 2026-05-03T03:43Z (auto track); user resume signal received post-04:15Z
- **Tasks:** 2 (1 auto + 1 checkpoint:human-verify)
- **Files modified:** 2 (both created)

## Accomplishments

- **`tests/dogfood_marker.rs`** (O-1 SHIPPED — 2 tests, both passing):
  - `cargo_toml_loads_byte_exact_via_open_any_encoding` — reads `CARGO_MANIFEST_DIR/Cargo.toml`, calls `notepadrs::file::open_any_encoding(&path)`, asserts `opened.bytes == original`. This proves the Phase 2 Pattern A original-bytes cache holds for the dogfood file. The save side requires GUI dirty-flag wiring, so the manual checklist's Step 7 closes that loop.
  - `cargo_toml_decodes_as_utf8` — confirms `opened.encoding ∈ {Utf8, Utf8Bom}` and the decoded text contains `[package]`. Catches encoding mojibake sanity (e.g. CP1252 misdetection).

- **`.planning/phases/05-polish-dogfood-ship/dogfood-checklist.md`** (10-step procedure, ~217 lines):
  1. Build release binary
  2. Launch `notepadrs.exe Cargo.toml`
  3. Verify chrome + detection (status bar / gutter / tab strip)
  4. Edit Cargo.toml (append a comment line)
  5. Save (Ctrl+S)
  6. Quit notepadrs
  7. **BLOCKING** — `cargo build` from the shell + `git diff Cargo.toml` only shows the comment edit
  8. Recent Files persistence after restart (RECENT-03)
  9. Drag-and-drop from Explorer (DND-01)
  10. Word Wrap toggle (VIEW-06/07)

  Each step has explicit pass/fail criteria; Step 7 is annotated `**FAIL — RELEASE BLOCKED**` with remediation guidance (revert Cargo.toml, investigate encoding cascade / EOL preservation / Pattern A cache).

## Task Commits

1. **Task 1: dogfood-checklist.md + tests/dogfood_marker.rs** — `1f45b30` (test(05-04): dogfood checklist (10 steps) + automated load-path smoke (2 tests))
2. **Task 2: checkpoint:human-verify walkthrough** — no code commit; user resume signal received (Phase 5 close-out + verification request)

## Files Created/Modified

- `tests/dogfood_marker.rs` (NEW) — 2 tests, 56 lines
- `.planning/phases/05-polish-dogfood-ship/dogfood-checklist.md` (NEW) — 10-step manual procedure, 217 lines

## Decisions Made

See `key-decisions` frontmatter. Notable execution detail:

- **O-1 chose "ship the optional test"**: The Phase 2 `open_any_encoding` API (`OpenedFile { bytes, text, encoding, eol }`) cleanly satisfies D-3's (a)-(d) constraints — it's pure load-path (no GUI), deterministic, doesn't touch %APPDATA%, and uses Cargo.toml itself as the fixture. The two-test split keeps each assertion's failure message focused (byte-exact vs encoding sanity).

## Deviations from Plan

None — plan executed exactly as written. Task 1 combined both deliverables into one atomic commit (the test file's docstring references the checklist, and the checklist's "Automated companion" section references the test — they're a tightly-coupled unit, like Plan 05-05's Tasks 1+2).

## Issues Encountered

None.

## Next Phase Readiness

- **SC-12 dogfood marker satisfied at the load-path layer** (automated). The save-path + GUI-only verifications (Recent Files menu, drag-drop, word wrap toggle) are documented in the manual checklist and gated behind the human-verify checkpoint.
- **Wave 3 complete**: Plans 05-04 + 05-05 are both closed.
- **Phase 5 ready for verification** — all 5 plans (05-01 through 05-05) executed; v1.0.0 release decision now hinges on Phase 5 verification + the operational ship-checklist in `ship-checklist.md` (Plan 05-05).

---
*Phase: 05-polish-dogfood-ship*
*Completed: 2026-05-03*
