---
phase: 03-multi-tab-find-replace
plan: 02
subsystem: ui
tags: [tabs, win32, richedit, owner-draw, accelerator, dirty-asterisk, dispatch]

requires:
  - phase: 03-multi-tab-find-replace
    plan: 01
    provides: Tab struct + App.tabs/active_tab/htabs/find_epoch + IDM_TAB_*/accel + push_empty_tab + tab_close_decision
provides:
  - SysTabControl32 owner-drawn tab strip (TCS_OWNERDRAWFIXED + TCS_FOCUSNEVER)
  - build_tab_strip + insert_tab_item + tab_rect + format_tab_label + format_label_for helpers
  - prompt_close_dirty (MessageBoxW MB_YESNOCANCEL) + CloseAction enum
  - decide_dirty_after_change pure helper (BLOCKER 3 — automated SC-2.2)
  - WM_NOTIFY (TCN_SELCHANGE) tab switch with hide/show/SetFocus/find_epoch++ ordering
  - WM_DRAWITEM owner-draw paint (DrawTextW + DT_END_ELLIPSIS + GetSysColor selected/unselected)
  - WM_COMMAND EN_CHANGE branch: dirty propagation via decide_dirty_after_change + partial-invalidate
  - IDM_TAB_NEW/CLOSE/NEXT/PREV real handlers (replaced 03-01 stubs)
  - WM_SIZE refined: tab strip (0,0,cx,28); RichEdit (0,28,cx,cy-28)
  - do_file_save / do_file_save_as / open_path_external dirty-clear + tab title refresh
  - do_file_open D-14 fresh-tab heuristic: load in place if active is empty Untitled, else push new
  - Tabs menu (New/Close/Next/Previous) appended between Edit and Encoding
  - EN_CHANGE notifications enabled in EditorState::create via EM_SETEVENTMASK + ENM_CHANGE (D-6)
  - 12 new tab_model tests (5 close-action + 4 dirty-decision + 3 label format)
affects: [03-04-find-ui, 03-05-find-worker]

tech-stack:
  added: []
  patterns:
    - "SysTabControl32 + TCS_OWNERDRAWFIXED + WM_DRAWITEM (Pattern 2 from research.md) — built-in hit-testing/scroll/keyboard nav, owner-draw only for the dirty asterisk"
    - "Stable id resolution via TCITEM lParam (Pattern 8) — tab strip carries u64 tab.id; index can shift on close but id never repeats"
    - "Pure-logic decide_dirty_after_change extracted from WM_COMMAND EN_CHANGE branch — same dispatch_pure split pattern as Phase 2's encoding/EOL change-decision helpers"
    - "Tab switch ordering: hide → show → SetFocus → active_tab → find_epoch.fetch_add(Release) → update_window_title (D-11, Pitfall 9, Pitfall 11)"
    - "Partial-invalidate via tab_rect + InvalidateRect on dirty change — avoids full-tabstrip flicker on every keystroke (D-5, Pattern 7)"
    - "EN_CHANGE delivered via parent's WM_COMMAND with HIWORD(wparam) == 0x0300 + lparam == source HWND; matched BEFORE the IDM cmd switch to avoid collision (D-6)"
    - "MessageBoxW MB_YESNOCANCEL with prompt body spelling Yes/No/Cancel → Save/Discard/Cancel mapping — TaskDialog deferred to v1.x polish (D-2)"

key-files:
  created:
    - ".planning/phases/03-multi-tab-find-replace/03-02-summary.md"
  modified:
    - "src/tab.rs: TAB_STRIP_HEIGHT=28, build_tab_strip, insert_tab_item, tab_rect, format_tab_label, CloseAction, prompt_close_dirty, decide_dirty_after_change, format_label_for (+114 lines)"
    - "src/dispatch.rs: imports + WM_CREATE/WM_SIZE/WM_NOTIFY/WM_DRAWITEM/WM_COMMAND EN_CHANGE branch + IDM_TAB_NEW/CLOSE/NEXT/PREV handlers + 9 helpers + do_file_open D-14 heuristic + save success dirty-clear (+413 lines)"
    - "src/menu.rs: Tabs menu with 4 items (Ctrl+T/W/Tab/Shift+Tab) appended between Edit and Encoding"
    - "src/editor.rs: EM_SETEVENTMASK + ENM_CHANGE call in EditorState::create (D-6, +6 lines)"
    - "tests/tab_model.rs: 12 new tests (close-action 5 + dirty-decision 4 + label format 3); 6→18 total (+143 lines)"
    - ".planning/roadmap.md: 03-02-plan.md checkbox marked complete"
    - ".planning/requirements.md: TAB-01..06 marked complete"

key-decisions:
  - "D-1: SysTabControl32 + TCS_OWNERDRAWFIXED is the tab strip class (per orchestrator quality_gate); custom-painted tab bar rejected (R-1)"
  - "D-2: MessageBoxW MB_YESNOCANCEL with explicit Yes/No/Cancel→Save/Discard/Cancel prompt body; TaskDialog with re-labeled buttons rejected for v1 (manifest plumbing cost)"
  - "D-3: Last-tab-close keeps a fresh Untitled tab (Notepad++ behavior); quitting requires Alt+F4/File→Exit"
  - "D-4: Tab switch increments app.find_epoch via fetch_add(1, Release) — discipline established now even though worker isn't wired until 03-05"
  - "D-5: EN_CHANGE → tab.dirty=true + partial-invalidate just that tab strip rect; full-tabstrip InvalidateRect avoided"
  - "D-6: EN_CHANGE enabled via EM_SETEVENTMASK + ENM_CHANGE in EditorState::create (one-line edit to editor.rs); routed through parent's WM_COMMAND with HIWORD == 0x0300"
  - "D-7/D-15: Tab strip height = 28px at 96 DPI; RichEdits sized (0, 28, cx, cy-28)"
  - "D-8: Owner-draw paint via DrawTextW + DT_END_ELLIPSIS; selected = COLOR_WINDOWTEXT, unselected = COLOR_GRAYTEXT"
  - "D-9: TCN_SELCHANGE looks up new index via TCM_GETCURSEL; tab.id stable across reorder via TCITEM lParam"
  - "D-11: Switch order = hide → show → SetFocus → active_tab → find_epoch++ → title (Pitfall 11 + D-4)"
  - "D-12: Window title = 'notepadrs - {format_tab_label}' — single source of truth for the dirty-asterisk prefix"
  - "D-14: do_file_open loads into the ACTIVE tab if it's a fresh empty Untitled (no path, not dirty, no original_bytes); otherwise pushes a new tab"
  - "D-16: prompt_close_dirty is the Win32 shell; tab_close_decision is the pure logic (testable headlessly)"

requirements-completed: [TAB-01, TAB-02, TAB-03, TAB-04, TAB-05, TAB-06]
test-tiers: [unit]

duration: 25 min
completed: 2026-05-03
---

# Phase 3 Plan 02: Multi-Tab UI Summary

**SysTabControl32 owner-drawn tab strip with the four IDM_TAB_* handlers wired through TCN_SELCHANGE/WM_DRAWITEM, EN_CHANGE-driven dirty asterisk on each tab, MessageBoxW Save/Discard/Cancel close prompt, and do_file_open D-14 fresh-tab heuristic — closes TAB-01..06 atop Plan 03-01's data shape**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-02T23:29:03Z (executor record_start_time)
- **Completed:** 2026-05-02T23:44:47Z
- **Tasks:** 3
- **Files modified:** 5 (created: 0, modified: 5)
- **Tests:** 12 added (tab_model 6→18); zero regressions across 163+ project tests

## Accomplishments

- SysTabControl32 strip with `TCS_OWNERDRAWFIXED | TCS_FOCUSNEVER` style, sized in WM_CREATE/WM_SIZE to (0,0,cx,28); owner-draw paint renders the dirty-asterisk-prefixed label via DrawTextW with `DT_END_ELLIPSIS`.
- All four `IDM_TAB_*` accelerator commands (Ctrl+T/W/Tab/Shift+Tab) replaced from 03-01's `oslog(...)` stubs with real handlers backed by `do_tab_new`, `do_tab_close`, and the cycle arithmetic for next/prev.
- `WM_NOTIFY` filters by `nm.hwndFrom == app.htabs && nm.code == TCN_SELCHANGE` and routes to `switch_active_tab` which executes the canonical hide → show → SetFocus → active_tab → find_epoch.fetch_add(Release) → update_window_title order (D-11, Pitfall 9, Pitfall 11).
- `WM_COMMAND` gains an EN_CHANGE branch (`HIWORD(wparam) == 0x0300`) that consumes the pure-logic `decide_dirty_after_change` helper (BLOCKER 3 — automated SC-2.2 gap closed); on transition, it updates the strip TCITEM via `TCM_SETITEMW`, partial-invalidates just that tab's rect, and refreshes the window title if the change was on the active tab.
- `do_file_save`, `do_file_save_as`, and `open_path_external` success branches now clear `tab.dirty`, refresh the strip text, partial-invalidate, and refresh the window title — the dirty asterisk lifecycle is end-to-end deterministic.
- `do_file_open` implements D-14 — the active tab loads in place when it is a fresh empty Untitled (no `current_path`, not dirty, no cached `original_bytes`); otherwise a new tab is pushed and made active before the load.
- `EditorState::create` enables EN_CHANGE notifications via the one-line `EM_SETEVENTMASK + ENM_CHANGE` (D-6) — without this the dirty asterisk path never fires.
- Tabs menu appended to the menubar between Edit and Encoding, with all four items showing accelerator hints.
- Tests grew from 6 to 18 in tests/tab_model.rs:
  * 5 close-action mapping tests (clean-skip-prompt, dirty-save-success, dirty-discard, dirty-cancel-keep, dirty-no-response-keep)
  * 4 dirty-decision matrix tests (clean+active-edit, already-dirty stays-dirty, edit-from-non-active, dirty-decision is-pure)
  * 3 label format pinning tests (clean title-only, dirty asterisk-space-prefix, untitled round-trip)

## Task Commits

1. **Task 1: tab.rs helpers + ENM_CHANGE in editor.rs + Tabs menu** — `a1f1c2a` (feat)
2. **Task 2: dispatch.rs WM_NOTIFY/WM_DRAWITEM + IDM_TAB_* + dirty propagation** — `a56472e` (feat)
3. **Task 3: tests/tab_model.rs +12 tests + drop cfg(test) gate on format_label_for** — `a1d150d` (test)

## Files Created/Modified

- `src/tab.rs` — appended tab-strip helpers, CloseAction, prompt_close_dirty, decide_dirty_after_change, format_label_for; total 250 lines (was 89)
- `src/dispatch.rs` — full Plan-03-02 wiring; total 880 lines (was 548)
- `src/menu.rs` — Tabs menu insertion; 64 lines (was 48)
- `src/editor.rs` — single `EM_SETEVENTMASK(ENM_CHANGE)` line in `EditorState::create`
- `tests/tab_model.rs` — 12 new tests; 200 lines (was 57)
- `.planning/roadmap.md` — `03-02-plan.md` checkbox marked complete
- `.planning/requirements.md` — TAB-01..06 marked complete

## Implementation Decisions

### Decisions Taken (Open / Discretion)

- **O-1: `build_tab_strip` placement.** Took the recommendation: lives in `src/tab.rs`, returning `Result<HWND>` so the caller stores it on `app.htabs`. Keeps tab presentation in one module (matches the Phase 2 shape where `build_main_menu` lives in `src/menu.rs`).
- **O-3: `update_window_title` placement.** Took the recommendation: private helper in `src/dispatch.rs`. Used `SetWindowTextW` (Phase 1 discipline — never the A variant).
- **O-4: Tab title length.** Took the recommendation: title is `path.file_name()` (basename only), full path stays in `tab.editor.current_path`. Owner-draw paint uses `DT_END_ELLIPSIS` so narrow rects truncate gracefully — never passes the full path as the tab title.

### Deviations from Locked Decisions

None. Every Locked decision (D-1 through D-16) was implemented as written:
- D-1 `TCS_OWNERDRAWFIXED` strip with `WC_TABCONTROL` — ✓
- D-2 `MessageBoxW MB_YESNOCANCEL | MB_ICONQUESTION` with explicit Yes/No/Cancel→Save/Discard/Cancel mapping in body — ✓
- D-3 Last-tab-close pushes one fresh Untitled — ✓
- D-4 Tab switch increments `find_epoch` via `fetch_add(1, Ordering::Release)` — ✓ (also on tab close)
- D-5 EN_CHANGE → partial invalidate via `tab_rect` + `InvalidateRect` — ✓
- D-6 `EM_SETEVENTMASK` with `ENM_CHANGE` in `EditorState::create` — ✓ (line at editor.rs:71-76)
- D-7/D-15 Tab strip height 28px; RichEdit y-origin 28 — ✓
- D-8 Owner-draw via `DrawTextW + DT_END_ELLIPSIS`, selected uses `COLOR_WINDOWTEXT`, unselected uses `COLOR_GRAYTEXT` — ✓
- D-9 Stable id via TCITEM lParam — ✓ (`insert_tab_item` writes `tab.id` into `lParam`)
- D-10 WM_NOTIFY filters by `nm.hwndFrom == app.htabs` — ✓
- D-11 Switch order hide → show → SetFocus → active_tab → epoch++ → title — ✓ (`switch_active_tab`)
- D-12 Window title format `"notepadrs - {format_tab_label}"` — ✓
- D-13 `do_file_open`/`do_file_save_as` update title; `do_file_save` does NOT — ✓
- D-14 `do_file_open` fresh-tab heuristic — ✓
- D-16 `prompt_close_dirty` is the Win32 shell; pure logic in `tab_close_decision` — ✓

### Open Questions for Verifier

None. The plan was unusually concrete (16 Locked + 4 Open decisions, 3 tasks, all deterministic), and the auto-fixes during execution were limited to clippy lints with obvious corrections.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `dis.CtlType == ODT_TAB.0` rejected by typed comparison**
- **Found during:** Task 2 (cargo build)
- **Issue:** Plan listed `(dis.CtlType.0 as u32) == ODT_TAB.0 as u32` style; the windows-rs 0.62 type for `dis.CtlType` is `DRAWITEMSTRUCT_CTL_TYPE` (a typed wrapper), and `ODT_TAB` is the same type — so the typed comparison `dis.CtlType == ODT_TAB` (no `.0`) is the correct idiom. The plan's `.0` form was a typed-vs-raw mismatch.
- **Fix:** Use `dis.CtlType == ODT_TAB`.
- **Files modified:** src/dispatch.rs
- **Verification:** cargo build green.
- **Committed in:** a56472e (Task 2 commit)

**2. [Rule 1 - Bug] `dis.itemState & ODS_SELECTED` rejected — no BitAnd impl**
- **Found during:** Task 2 (cargo build)
- **Issue:** `ODS_FLAGS` is a `pub struct ODS_FLAGS(pub u32)` newtype in windows 0.62 and does not implement `BitAnd`. The plan wrote `(dis.itemState & ODS_SELECTED).0 != 0`.
- **Fix:** Compare on the `.0` raw u32 directly: `(dis.itemState.0 & ODS_SELECTED.0) != 0`.
- **Files modified:** src/dispatch.rs
- **Verification:** cargo build + clippy green.
- **Committed in:** a56472e (Task 2 commit)

**3. [Rule 3 - Blocking] `SetFocus` not in `windows::Win32::UI::WindowsAndMessaging`**
- **Found during:** Task 2 (cargo build)
- **Issue:** `SetFocus` lives in `windows::Win32::UI::Input::KeyboardAndMouse` in windows 0.62, not the WindowsAndMessaging glob.
- **Fix:** Added explicit `use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;` import.
- **Files modified:** src/dispatch.rs
- **Verification:** cargo build green.
- **Committed in:** a56472e (Task 2 commit)

**4. [Rule 1 - Bug] `TCS_OWNERDRAWFIXED as u32` flagged by clippy::unnecessary_cast**
- **Found during:** Task 2 (cargo clippy --lib --bins -- -D warnings)
- **Issue:** `TCS_OWNERDRAWFIXED` and `TCS_FOCUSNEVER` are already `u32` constants in windows 0.62 — the `as u32` cast is redundant and clippy denies it.
- **Fix:** Drop the `as u32` casts; the bitwise OR with `WS_CHILD.0`/`WS_VISIBLE.0` works directly.
- **Files modified:** src/tab.rs
- **Verification:** cargo clippy --lib --bins -- -D warnings clean.
- **Committed in:** a56472e (Task 2 commit)

**5. [Rule 3 - Blocking] `cfg(any(test, doctest))` hides `format_label_for` from integration tests**
- **Found during:** Task 3 (cargo test --test tab_model)
- **Issue:** The plan recommended `#[cfg(any(test, doctest))] pub fn format_label_for(...)` so it ships only in test builds. But integration tests under `tests/` are compiled as a separate crate that links the lib; they do NOT see lib items gated by `cfg(test)`. The compiler error was `no `format_label_for` in `tab` ... found an item that was configured out`.
- **Fix:** Drop the `cfg` gate; keep `#[allow(dead_code)]` so production builds (which don't call it) stay quiet.
- **Files modified:** src/tab.rs
- **Verification:** cargo test --test tab_model passes 18 tests.
- **Committed in:** a1d150d (Task 3 commit)

---

**Total deviations:** 5, all Rule 1 (Bug) or Rule 3 (Blocking) auto-fixes — every one a windows-rs 0.62 type-system or cfg-visibility detail the plan didn't pin down. Zero architectural deviations; zero scope creep.

## Issues Encountered

- **Pre-existing clippy errors in `tests/roundtrip_matrix.rs` and `tests/undo_property.rs`** surface when running `cargo clippy --tests -- -D warnings` (collapsible_str_replace, unusual_byte_groupings). These are NOT introduced by Plan 03-02 — same items called out in 03-01-summary.md. Plan 03-02 stays scoped to lib + bins clippy, leaving those test-file warnings for a separate cleanup commit.
- **External revert of menu.rs and dispatch.rs during Task 1/2.** Two of my Edit operations on src/menu.rs and src/dispatch.rs surfaced "File has been modified since read" warnings indicating that the parallel 03-03 agent's session was clobbering files. Verified by `git diff` — files were intermittently restored to HEAD between my edits. Recovered by re-applying via Edit/Write each time; the final commit captures the correct end state. No data loss; commit history is clean.

## User Setup Required

None — no external service configuration. Single-tab visual identical to before; multi-tab UX unlocks naturally as the user presses Ctrl+T or chooses Tabs → New Tab.

## Manual Smoke (Informational — Windows host required)

These cannot run headlessly on the test machine; documented for the verifier:

1. `cargo run -- tests/fixtures/utf8_no_bom_lf.txt` — single tab with file content; window title = `notepadrs - utf8_no_bom_lf.txt`.
2. Press Ctrl+T → second tab "Untitled" appears, focus there, no asterisk.
3. Type "hello" → tab title becomes `* Untitled`, window title becomes `notepadrs - * Untitled`.
4. Press Ctrl+Tab → first tab active, Untitled greys out (unselected COLOR_GRAYTEXT).
5. Press Ctrl+W on the dirty Untitled — MessageBoxW with Save/Don't-Save/Cancel; Yes triggers Save As; No discards; Cancel keeps open.
6. Press Ctrl+W on the clean utf8 tab — closes immediately; if it was the last, a fresh Untitled replaces it (D-3).
7. File→Open another fixture — if active tab is fresh empty Untitled, loads in place; otherwise pushes a new tab (D-14).

## Next Phase Readiness

- **Plan 03-04 (Wave 3 — Find/Replace UI):** can now consume `app.htabs`/`app.active_tab`/`app.find_epoch`. The accelerator slots Ctrl+F/H, F3, Shift+F3 are wired (03-01); the IDM stubs for IDM_FIND_OPEN/REPLACE_OPEN/NEXT/PREV/REPLACE_ONE/REPLACE_ALL remain in place ready for replacement. The active-tab `RichEdit` HWND for `EM_FINDTEXT`/`EM_SETSEL`/`EM_REPLACESEL` is reachable via `app.tabs[app.active_tab].editor.hwnd_re`.
- **Plan 03-05 (Wave 4 — worker thread):** `app.find_epoch` is bumped on every tab switch, every tab close, and every tab create — when 03-05 wires `Arc<AtomicU64>` cloning into the worker spawn, stale results from a switched-away tab will be discarded automatically (Pitfall 9 contract honored).
- **No blockers.** Build, clippy --lib --bins, and the full test matrix all green; release binary 474KB (4.7% of 10MB ceiling).

## Self-Check: PASSED

- [x] summary.md exists at `.planning/phases/03-multi-tab-find-replace/03-02-summary.md`
- [x] `decide_dirty_after_change` in src/tab.rs
- [x] `build_tab_strip` in src/tab.rs
- [x] `ENM_CHANGE` in src/editor.rs
- [x] Tabs menu in src/menu.rs
- [x] WM_NOTIFY + WM_DRAWITEM branches in src/dispatch.rs
- [x] `do_tab_new` (IDM_TAB_NEW handler) in src/dispatch.rs
- [x] `decide_dirty_after_change` tests in tests/tab_model.rs
- [x] commit a1f1c2a (feat Task 1) on main
- [x] commit a56472e (feat Task 2) on main
- [x] commit a1d150d (test Task 3) on main

---
*Phase: 03-multi-tab-find-replace*
*Completed: 2026-05-03*
