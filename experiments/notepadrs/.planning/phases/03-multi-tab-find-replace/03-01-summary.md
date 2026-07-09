---
phase: 03-multi-tab-find-replace
plan: 01
subsystem: ui
tags: [refactor, tabs, win32, richedit, accelerator-table]

requires:
  - phase: 02-file-i-o-encoding-cascade
    provides: EditorState (hwnd_re/current_path/encoding/eol/original_bytes/had_trailing_newline) preserved verbatim — Tab wraps it
provides:
  - Tab struct (editor + title + id + dirty + word_wrap) with Drop impl that DestroyWindow's hwnd_re
  - CloseDecision enum + tab_close_decision pure function (testable headlessly)
  - App.tabs Vec<Tab> + active_tab usize + next_tab_id u64 (replaces App.editor Option<EditorState>)
  - Pre-allocated Phase 3 plumbing: htabs HWND, find_state FindState, find_dlg_hwnd Option<HWND>,
    find_epoch AtomicU64, find_tx/find_rx mpsc channel pair, find_pending Option<(u64, String)>
  - 12 new constants: IDM_TAB_NEW/CLOSE/NEXT/PREV (120-123), IDM_FIND_OPEN/REPLACE_OPEN/NEXT/PREV (130-133),
    IDM_FIND_REPLACE_ONE/ALL (134-135), WM_APP_FIND_RESULT (WM_USER+10), WM_APP_FIND_DIALOG_CLOSED (WM_USER+11)
  - 8 new accelerator entries: Ctrl+T/W/Tab/Shift+Tab/F/H, F3, Shift+F3
  - App::push_empty_tab(parent, initially_visible) and active()/active_mut() accessors
  - 6 pure-logic tests in tests/tab_model.rs
affects: [03-02-tab-ui, 03-03-find-engine, 03-04-find-ui, 03-05-find-worker]

tech-stack:
  added: []
  patterns:
    - "Per-tab RichEdit child window (Pattern 1) — each Tab owns its own hwnd_re; switch via SW_HIDE/SW_SHOW (vs single-RichEdit-with-buffer-swap)"
    - "Stable u64 id per tab — tab strip lParam carries id so Vec::remove(idx) shift doesn't break TCN_SELCHANGE lookup"
    - "Pre-allocate cross-plan plumbing in foundation plan — every Phase 3 IDM/field lives here so Wave 2/3/4 plans don't merge-conflict on app.rs"
    - "Pure-logic helper extracted from Win32 effect (tab_close_decision) — matches Phase 2 dispatch_pure split for headless cargo test"
    - "Drop impl for Win32 child windows — Vec::remove triggers Drop which calls DestroyWindow, no manual loop"

key-files:
  created:
    - "src/tab.rs (76 lines): Tab struct, Drop impl, CloseDecision, tab_close_decision"
    - "tests/tab_model.rs (57 lines): 6 pure-logic close-decision tests"
  modified:
    - "src/app.rs: App refactor + 12 const + 8 accels + push_empty_tab + active()/active_mut()"
    - "src/dispatch.rs: WM_CREATE/WM_SIZE/WM_INITMENUPOPUP/WM_COMMAND read app.tabs[active_tab] via app.active()/active_mut(); 8 IDM stub arms log not-yet-wired"
    - "src/main.rs: mod tab; declared"
    - "src/lib.rs: pub mod tab; + editor/log demoted to pub(crate)"

key-decisions:
  - "Each Tab owns its own RichEdit child (Pattern 1) — visibility toggles via ShowWindow rather than EM_STREAMIN buffer swap on every tab switch"
  - "EditorState shape preserved verbatim — Tab WRAPS it, no field renames or migrations to Tab"
  - "Pre-allocate ALL Phase 3 IDM constants and App fields in this plan so 03-02..03-05 don't have to each touch app.rs"
  - "FindFlags has manual Default impl with wrap=true (Notepad++ convention); auto-derive would default to false"
  - "lib.rs exposes only the pure-logic surfaces tests need (tab/dispatch_pure/encoding/eol/error/file/undo_model); editor and log demoted to pub(crate) to avoid missing_safety_docs lint cascade"
  - "App::push_empty_tab uses len-then-index pattern instead of .last_mut().expect() to satisfy clippy::expect_used (which is denied at editor.rs/dispatch.rs but not crate-wide; defensive choice)"

patterns-established:
  - "Tab.id is stable u64 from monotonic next_tab_id; index can shift on Vec::remove but id never repeats"
  - "WM_NCDESTROY drop chain: Box<App> -> Vec<Tab> -> Drop calls DestroyWindow per tab, no manual loop in WM_NCDESTROY"
  - "WM_SIZE iterates ALL tabs (Pitfall 8) so on tab switch the incoming RichEdit isn't sized stale"

requirements-completed: [TAB-07]
test-tiers: [unit]

duration: 50 min
completed: 2026-05-03
---

# Phase 3 Plan 01: Per-Tab Data Shape Summary

**App.editor: Option<EditorState> refactored into App.tabs: Vec<Tab> + active_tab usize, with Tab wrapping Phase 2's EditorState verbatim and pre-allocating every Phase 3 IDM/accelerator/find-state field so Waves 2-4 don't collide on app.rs**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-05-03T00:18:00Z
- **Completed:** 2026-05-03T01:25:00Z
- **Tasks:** 3
- **Files modified:** 5 (created: 2, modified: 3)

## Accomplishments

- Per-tab data shape established: Tab struct wrapping EditorState with title/id/dirty/word_wrap fields plus Drop impl for hwnd_re cleanup
- App.editor: Option<EditorState> entirely replaced by App.tabs: Vec<Tab> + active_tab; every Phase 2 dispatch handler now reads app.active()/active_mut() instead
- All 12 Phase 3 IDM constants (120-135), 2 WM_APP_* messages, 6 App fields (find_state/find_epoch/find_tx/find_rx/find_dlg_hwnd/find_pending), and 8 accelerators pre-allocated as `pub` so Plans 03-02..03-05 only need to USE them
- Pure-logic tab_close_decision exhaustively tested headlessly (6 tests in tests/tab_model.rs) following Phase 2's dispatch_pure precedent
- Single-tab visual identical to Phase 2 (full client area, no strip yet); 109 Phase 2 integration tests pass without modification

## Task Commits

1. **Task 1: src/tab.rs + module declarations** - `1fa6175` (feat)
2. **Task 2: App refactor + IDM/accel/find-state pre-allocation + dispatch.rs migration** - `c4c0059` (refactor)
3. **Task 3: tests/tab_model.rs with 6 pure-logic tests** - `0b0e50a` (test)

## Files Created/Modified

- `src/tab.rs` — Tab struct, Drop impl, CloseDecision, tab_close_decision (created, 76 lines)
- `tests/tab_model.rs` — 6 pure-logic close-decision tests (created, 57 lines)
- `src/app.rs` — App refactored to tabs/active_tab; +12 const, +8 accels, +push_empty_tab, +active()/active_mut() (modified)
- `src/dispatch.rs` — WM_CREATE pushes first tab; WM_SIZE iterates &app.tabs; helpers read app.active(); 8 IDM stub arms (modified)
- `src/main.rs` — mod tab; (modified)
- `src/lib.rs` — pub mod tab; editor + log demoted to pub(crate) (modified)

## Decisions Made

- **D-2 preserved literally:** EditorState's six fields (hwnd_re/current_path/encoding/eol/original_bytes/had_trailing_newline) untouched. Tab WRAPS, doesn't migrate.
- **D-7 wrap-default:** FindFlags has hand-written Default impl with wrap=true. Auto-derive would default to false (incorrect Notepad++ convention).
- **D-8 visibility on first tab:** Tab::new_empty(parent, id, initially_visible). WM_CREATE passes true; later IDM_TAB_NEW (Plan 03-02) will pass false.
- **D-9 WM_SIZE iteration:** All tabs sized, not just active — incoming RichEdit must be sized correctly when revealed.
- **lib.rs scope minimization:** editor and log demoted to pub(crate). Reason: making them pub triggered clippy::missing_safety_doc cascade on existing Phase 2 unsafe methods (open_text_with_metadata, save_text_for_disk, save_text_for_disk_as) — fixing every Safety section was scope creep beyond Plan 03-01. Tests only need the pure-logic surfaces (tab/dispatch_pure/encoding/eol/error/file/undo_model).

## Deviations from Plan

**1. [Rule 1 - Bug] Plan's `App::push_empty_tab` used `.last_mut().expect("just pushed")`, lib clippy gate denied expect_used**
- **Found during:** Task 2 (App refactor)
- **Issue:** Plan listed `Ok(self.tabs.last_mut().expect("just pushed"))` with a comment "if app.rs is also denied, use a different pattern". Clippy with -D warnings on lib + bins flagged it.
- **Fix:** Used `let len = self.tabs.len(); Ok(&mut self.tabs[len - 1])` per the plan's fallback suggestion.
- **Files modified:** src/app.rs
- **Verification:** cargo clippy --lib --bins -- -D warnings clean.
- **Committed in:** c4c0059 (Task 2 commit)

**2. [Rule 3 - Blocking] lib.rs cannot expose `pub mod editor` without re-doc'ing every unsafe fn**
- **Found during:** Task 1 (lib.rs update)
- **Issue:** Plan said "add pub mod tab" only. But tab.rs uses `crate::editor::EditorState`, so editor must be a module of the lib crate. Making it pub triggered clippy::missing_safety_doc on 4 existing unsafe methods on EditorState (open_text_with_metadata, save_text_for_disk, save_text_for_disk_as, plus open_text was already exempt). Adding 4 # Safety docs is out of scope for Plan 03-01.
- **Fix:** Demoted editor to `pub(crate) mod editor`, log to `pub(crate) mod log`, app skipped entirely (only tab.rs in lib needs editor; tests need only tab). Tab's own new_empty got a # Safety doc since it's pub.
- **Files modified:** src/lib.rs, src/tab.rs
- **Verification:** cargo clippy --lib --bins -- -D warnings clean; cargo test --test tab_model passes.
- **Committed in:** 1fa6175 (Task 1 commit)

**3. [Rule 1 - Bug] Plan's tests/tab_model.rs needed `#[allow(dead_code)]` markers added to public lib items prior to Task 2 wiring**
- **Found during:** Task 1
- **Issue:** Phase 1 bin clippy gate detected Tab/CloseDecision/tab_close_decision as dead_code in the BIN compile (which doesn't see the lib crate's tests/tab_model.rs as a caller).
- **Fix:** Added `#[allow(dead_code)]` to the struct, impl block, enum, and fn — all marked "wired by Plan 03-02".
- **Files modified:** src/tab.rs
- **Verification:** cargo clippy --lib --bins -- -D warnings clean.
- **Committed in:** 1fa6175 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (1 Rule 1 - Bug clippy lint, 1 Rule 3 - Blocking module visibility, 1 Rule 1 - Bug dead_code). All foreseen by the plan but worth documenting since the plan listed multiple options.
**Impact on plan:** No scope creep. Plan's `## Plan Decisions` and inline notes anticipated each fork.

## Issues Encountered

- Pre-existing clippy errors in tests/roundtrip_matrix.rs (collapsible_str_replace) and tests/undo_property.rs (unusual_byte_groupings) surface when running `cargo clippy --tests -- -D warnings`. These are NOT introduced by Plan 03-01 — they fail clippy on the prior commit too. Plan 03-01 stays scoped to lib + bins, leaving the test-file warnings for a separate cleanup commit (Phase 4 polish or a chore commit).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **Plan 03-02 (Wave 2):** Tab UI strip — has all the App fields it needs (htabs ready to receive HWND; IDM_TAB_* constants ready). Will modify dispatch.rs's IDM_TAB_* stubs into real handlers, add WM_NOTIFY/WM_DRAWITEM, call build_tab_strip. Plan also adds one-line EM_SETEVENTMASK to src/editor.rs.
- **Plan 03-03 (Wave 2 — parallel-safe):** Find/replace pure engine — owns src/find.rs entirely. No collision with 03-02's files (dispatch.rs/tab.rs/menu.rs/editor.rs). FindState/FindFlags pre-allocated in app.rs are ready to receive the engine's input.
- **Plans 03-04, 03-05 (Waves 3, 4):** Modeless dialog UI + worker thread — IDM_FIND_*/WM_APP_FIND_RESULT/WM_APP_FIND_DIALOG_CLOSED + find_dlg_hwnd/find_epoch/find_tx/find_rx/find_pending all ready as pre-allocated stubs.

No blockers. Single-tab manual smoke (informational): `cargo run -- tests/fixtures/utf8_no_bom_lf.txt` should open the editor with the file content visible — visually identical to Phase 2.

---
*Phase: 03-multi-tab-find-replace*
*Completed: 2026-05-03*
