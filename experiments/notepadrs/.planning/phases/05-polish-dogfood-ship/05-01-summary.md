---
phase: 05-polish-dogfood-ship
plan: 01
subsystem: ui
tags: [richedit, word-wrap, win32, em_settargetdevice, view-menu]

requires:
  - phase: 03-multi-tab-find-replace
    provides: "Tab.word_wrap field pre-allocated (tab.rs:42, default false); switch_active_tab pattern"
  - phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
    provides: "WM_INITMENUPOPUP encoding/EOL sync block (extended for word-wrap checkmark)"
provides:
  - Per-tab Word Wrap toggle wired to View → Word Wrap menu (VIEW-06)
  - Default-off invariant on new tabs with horizontal scrollbar visible (VIEW-07)
  - Empirically-locked EM_SETTARGETDEVICE polarity constants (Plan 05-01 D-1)
  - apply_wrap unsafe Win32 wrapper + decide_next_wrap_state pure helper
  - 6 pure-logic tests covering toggle invariants and polarity locks
  - examples/wordwrap_spike.rs committed reproducer
affects: [05-04 dogfood marker, v1.0 ship gate]

tech-stack:
  added: []
  patterns:
    - "Wave-0 spike pattern: empirically lock undocumented Win32 behavior (EM_SETTARGETDEVICE polarity) via measurement before production constants ship"
    - "Pure-logic + Win32 wrapper split: decide_next_wrap_state (pure) + apply_wrap (unsafe) — mirrors Phase 2 dispatch_pure.rs and Phase 3 find_dispatch_pure.rs"
    - "Re-apply per-tab style on switch_active_tab: RichEdit may discard WS_HSCROLL/ES_AUTOHSCROLL across SW_HIDE/SW_SHOW (D-6)"

key-files:
  created:
    - "src/word_wrap.rs"
    - "tests/word_wrap.rs"
    - "examples/wordwrap_spike.rs"
    - ".planning/phases/05-polish-dogfood-ship/05-01-spike-result.md"
  modified:
    - "src/main.rs"
    - "src/lib.rs"
    - "src/app.rs"
    - "src/menu.rs"
    - "src/dispatch.rs"

key-decisions:
  - "Plan 05-01 D-1: Wave-0 spike runs FIRST as Task 1; production constants only land after empirical confirmation. Empirically locked WRAP_ON_LPARAM=0, WRAP_OFF_LPARAM=1 (matches community convention; observed: 500-char line at lParam=0 wraps to row 11, lParam=1 extends to x=3993 off-screen)"
  - "Plan 05-01 D-2: combine WS_HSCROLL/ES_AUTOHSCROLL style flip + EM_SETTARGETDEVICE message; both required (style alone doesn't invalidate wrapped-line cache; message alone doesn't toggle scrollbar)"
  - "Plan 05-01 D-7: WM_INITMENUPOPUP block restructured to capture &Tab (not &EditorState) so tab.word_wrap is in scope alongside the existing encoding/EOL sync"
  - "O-1 chose: cargo example binary (examples/wordwrap_spike.rs) — preserved as permanent reproducer; programmatic detection via EM_POSFROMCHAR Y-coordinate delta avoided needing manual GUI observation"
  - "O-2 chose: Tab::new_empty unchanged; switch_active_tab re-apply covers tab-creation case via the tab-switch path that follows tab creation"
  - "O-3 chose: no menu accelerator (SC-8 doesn't mandate one; keyboard real-estate reserved for v2)"

patterns-established:
  - "Empirical Win32 polarity lock: when Microsoft docs are silent on a flag's semantic, write a measurable spike, commit the result artifact, and reference it from the production constant doc-comment"

requirements-completed: [VIEW-06, VIEW-07]
test-tiers: [unit]

duration: 25 min
completed: 2026-05-03
---

# Phase 05 Plan 01: Per-tab Word Wrap Toggle Summary

**RichEdit per-tab word-wrap toggle wired to View → Word Wrap menu, with empirically-locked EM_SETTARGETDEVICE polarity (lParam=0 = wrap-on, confirmed via committed spike reproducer)**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-03T02:50Z
- **Completed:** 2026-05-03T03:15Z
- **Tasks:** 3
- **Files modified:** 9 (5 created, 4 modified)

## Accomplishments

- **Wave-0 polarity spike** ran programmatically (no GUI inspection needed): 500-char line in 400px-wide RichEdit; EM_POSFROMCHAR for the last char reported `y=170` under `lParam=0` (wrapped) and `y=0, x=3993` under `lParam=1` (off-screen). Polarity locked.
- **`src/word_wrap.rs`** ships `apply_wrap(hwnd_re, wrap_on)` (unsafe Win32 wrapper combining style flip + EM_SETTARGETDEVICE message) and `decide_next_wrap_state(prev) -> bool` (pure helper).
- **View menu** added between Search and Encoding with single `&Word Wrap` item (IDM_VIEW_WORDWRAP=140 in Phase 5 IDM range).
- **WM_INITMENUPOPUP** restructured to capture &Tab (not just &EditorState) so the existing encoding/EOL CheckMenuRadioItem block + new CheckMenuItem(IDM_VIEW_WORDWRAP, MF_CHECKED|MF_BYCOMMAND) share one source-of-truth pass.
- **switch_active_tab** re-applies the destination tab's wrap state on every tab switch (D-6) — RichEdit may discard the style across SW_HIDE/SW_SHOW.
- **6 pure-logic tests** in `tests/word_wrap.rs` (no Win32) covering toggle invariants, polarity-constant distinctness, range sanity, and empirical-lock pinning.
- **Committed reproducer** at `examples/wordwrap_spike.rs` (`cargo run --release --example wordwrap_spike`) preserves the polarity check forever.

## Task Commits

1. **Task 1: Wave-0 polarity spike** — `96c25e4` (spike: lock EM_SETTARGETDEVICE word-wrap polarity)
2. **Task 2: pure-logic tests** — `b9c8000` (test: pure-logic tests for word_wrap toggle + polarity constants)
3. **Task 3: View menu + IDM dispatch + WM_INITMENUPOPUP + tab-switch re-apply** — `23dd94b` (feat: wire View → Word Wrap menu)

## Files Created/Modified

- `src/word_wrap.rs` (NEW) — apply_wrap + decide_next_wrap_state + WRAP_ON/OFF_LPARAM constants
- `tests/word_wrap.rs` (NEW) — 6 pure-logic tests
- `examples/wordwrap_spike.rs` (NEW) — committed reproducer for re-validating polarity
- `.planning/phases/05-polish-dogfood-ship/05-01-spike-result.md` (NEW) — empirical record
- `src/main.rs` — `mod word_wrap;` declaration
- `src/lib.rs` — `pub mod word_wrap;` declaration
- `src/app.rs` — `pub const IDM_VIEW_WORDWRAP: u16 = 140;` Phase 5 IDM range
- `src/menu.rs` — &View top-level menu between &Search and E&ncoding
- `src/dispatch.rs` — IDM_VIEW_WORDWRAP arm; WM_INITMENUPOPUP word-wrap checkmark sync; switch_active_tab re-apply

## Decisions Made

See `key-decisions` frontmatter above. Highlights:

- **Programmatic empirical lock** — Initially the spike was specced as a manual MessageBox-driven observation. Used `EM_POSFROMCHAR` delta on first vs last char of a 500-char line to detect wrap state mechanically, removing the need for human GUI observation. The committed reproducer can still be inspected visually if anyone re-runs it.

## Deviations from Plan

None - plan executed exactly as written. (The empirical lock value `WRAP_ON_LPARAM=0` matches the community convention referenced in research.md, but the plan REQUIRED the spike regardless — D-1 mandates "empirical confirmation before production constants ship.")

Side note: Rust 1.95 introduced stricter clippy lints (`bool_assert_comparison`, `unusual_byte_groupings`, `collapsible_str_replace`) that flag pre-existing test files (`tests/undo_property.rs`, `tests/roundtrip_matrix.rs`). Those are out of scope for Plan 05-01; only the new `tests/word_wrap.rs` file needed an `assert!(x)` form (was `assert_eq!(x, true)`). The pre-existing lints are documented here so a future cleanup phase can address them.

## Issues Encountered

None.

## Next Phase Readiness

- VIEW-06 / VIEW-07 closed; ready for Plan 05-04 dogfood Step 10 (Word Wrap visual verification).
- Plans 05-02 (recent files) and 05-03 (drag-drop) remain disjoint from 05-01 changes — Wave 1 parallel-safe assumption confirmed.
- The empirical lock pattern is reusable for any future Win32 polarity ambiguity.

---
*Phase: 05-polish-dogfood-ship*
*Completed: 2026-05-03*
