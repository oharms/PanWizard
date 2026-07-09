---
phase: 03-multi-tab-find-replace
plan: 04
subsystem: search-ui
tags: [win32, dialog, modeless, richedit, find-replace, dispatch, pure-logic, undo]

# Dependency graph
requires:
  - phase: 03-multi-tab-find-replace
    plan: 02
    provides: "Tab struct + App.tabs/active_tab/htabs + dispatch.rs WM_COMMAND skeleton + decide_dirty_after_change"
  - phase: 03-multi-tab-find-replace
    plan: 03
    provides: "find::compile / find::find_next / find::replace_all / find::utf8_to_utf16_units / find::utf16_to_utf8_offset / FindHit / CompileError"
provides:
  - "src/find_ui.rs: modeless Find/Replace dialog (CreateWindowExW, no .rc) — open_find_dialog/close_find_dialog/read_find_state/set_status pub API + FindMode enum"
  - "src/find_dispatch_pure.rs: find_next_pure / replace_one_pure / replace_all_pure — pure-logic helpers callable from headless tests"
  - "src/dispatch.rs: real do_find_next / do_replace_one / do_replace_all Win32 wrappers replacing 03-01 stubs; WM_APP_FIND_DIALOG_CLOSED arm; WM_DESTROY closes dialog"
  - "src/main.rs: IsDialogMessageW pre-dispatch in run_app message loop (Pitfall 7)"
  - "src/menu.rs: &Search popup with Find/Replace/Find Next/Find Previous entries"
  - "tests/find_replace_pure.rs: 8 pure-logic dispatch tests (BLOCKER 4 + WARN 4)"
affects: [03-05-find-worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Modeless dialog via CreateWindowExW on a registered class — no .rc resource (idea.md no-resource-files constraint, D-1)"
    - "DlgState in GWLP_USERDATA + Box::into_raw / Box::from_raw on WM_NCDESTROY — same pattern as Phase 1's App pointer"
    - "Button clicks forward to parent's WM_COMMAND so dispatch.rs is single source of truth (D-12)"
    - "WM_NCDESTROY posts WM_APP_FIND_DIALOG_CLOSED so parent clears app.find_dlg_hwnd (D-14)"
    - "LF-normalization at the engine boundary: EM_STREAMOUT -> from_utf8 -> normalize_to_lf -> regex (Pitfall 10 / D-4)"
    - "Selection round-trip: EM_EXGETSEL UTF-16 cu -> utf16_to_utf8_offset -> regex byte offsets -> utf8_to_utf16_units -> EM_EXSETSEL UTF-16 cu (D-5)"
    - "Replace All ONE-undo via EM_STOPGROUPTYPING + EM_SETTEXTEX(ST_KEEPUNDO) + EM_STOPGROUPTYPING (D-8 / orchestrator quality_gate)"
    - "Pure helpers in find_dispatch_pure.rs operate on (&str, sel_cu_range, &Regex, &str) tuples — testable headlessly without a real RichEdit HWND"
    - "Message loop order: TranslateAccelerator -> IsDialogMessage(if find_dlg_hwnd) -> TranslateMessage -> DispatchMessage (Pitfall 7 / D-7)"

key-files:
  created:
    - "src/find_ui.rs (~430 lines): FindMode enum, open_find_dialog, close_find_dialog, read_find_state, set_status, find_dlg_proc WndProc, register_class (OnceLock-guarded), control-creation helpers (create_static/edit/check/button), control-I/O helpers (set_window_text/get_window_text/set_check/is_checked)"
    - "src/find_dispatch_pure.rs (~95 lines): find_next_pure, replace_one_pure, replace_all_pure"
    - "tests/find_replace_pure.rs (~180 lines, 8 tests): replace_one cursor-advance, replace_all multi-match + count, single-undo invariant proxy, empty-replacement deletion (one + all), non-matching selection rejection, partial-match selection rejection, LF-normalization boundary"
  modified:
    - "src/dispatch.rs: do_find_next + do_replace_one + do_replace_all Win32 wrappers (~280 LOC appended); IDM_FIND_OPEN/REPLACE_OPEN/NEXT/PREV stubs replaced with real handlers; new IDM_FIND_REPLACE_ONE/ALL arms; WM_APP_FIND_DIALOG_CLOSED top-level arm; WM_DESTROY closes find dialog"
    - "src/main.rs: mod find_ui + mod find_dispatch_pure declared; run_app message loop reorders to TranslateAccelerator -> IsDialogMessage -> TranslateMessage -> DispatchMessage"
    - "src/lib.rs: pub mod find_ui + pub mod find_dispatch_pure"
    - "src/menu.rs: &Search popup appended between &Tabs and E&ncoding (Find / Replace / Find Next / Find Previous)"

key-decisions:
  - "D-1/D-12: CreateWindowExW dialog (no .rc) — honors no-resource-files constraint; control children built individually; OnceLock guards class registration"
  - "D-2: One template handles BOTH Find and Replace — FindMode enum toggles which row is shown; mode change via SetWindowTextW for caption + ShowWindow on replace controls"
  - "D-3: find_state is GLOBAL on App.find_state (Notepad++ convention), not per-tab"
  - "D-4: LF-normalization at the engine boundary — EM_STREAMOUT gives RichEdit's CR-only paragraph terminators; normalize_to_lf runs BEFORE regex matching"
  - "D-5: EM_EXSETSEL with CHARRANGE (32-bit cpMin/cpMax) — NOT EM_SETSEL (16-bit cap)"
  - "D-6: After selection, EM_SCROLLCARET only — focus stays in dialog so user can press Find Next again (ES_NOHIDESEL guarantees selection visible)"
  - "D-7/D-13: IsDialogMessageW pre-dispatch in main loop after TranslateAccelerator; only fires when find_dlg_hwnd is Some AND HWND still valid"
  - "D-8: Replace All wraps in EM_STOPGROUPTYPING + EM_SETTEXTEX(ST_KEEPUNDO) for ONE undo step; pure-logic helper returns one final String so wrapper has nothing to loop over"
  - "D-9: Whole-word + Backward greyed when Regex toggle is on; ID_CHECK_REGEX click handler updates EnableWindow live"
  - "D-10: Empty pattern silent no-op; CompileError::EmptyMatch surfaces as 'Pattern matches empty string' status; CompileError::Regex as 'Bad pattern: …'"
  - "D-11: Wrap status messages: 'Wrapped to top' (forward), 'Wrapped to bottom' (backward), 'Pattern not found' (no match)"
  - "D-12: Button clicks SendMessage(parent, WM_COMMAND, IDM_FIND_*) — dispatch.rs is single source of truth for find/replace logic"
  - "D-14: Closing the dialog (X / Esc / Close button) posts WM_APP_FIND_DIALOG_CLOSED to parent; dispatch.rs clears app.find_dlg_hwnd and bumps find_epoch"
  - "D-15: &Search menu added to menubar with Find / Replace / Find Next / Find Previous entries (keyboard discoverability)"
  - "DV-1 (deviation): pure helpers placed in NEW src/find_dispatch_pure.rs rather than co-located in src/dispatch.rs as the plan recommended (executor's-choice clause permits this)"
  - "DV-2 (deviation): test file is tests/find_replace_pure.rs not tests/find_replace_dispatch.rs to sidestep Windows ApplicationCompatibility installer-detection heuristic"

requirements-completed: [FIND-01, FIND-02, FIND-03, FIND-07, FIND-08, FIND-09]
test-tiers: [unit, integration]

# Metrics
duration: 10 min
completed: 2026-05-03
---

# Phase 3 Plan 04: Find/Replace UI Summary

**Modeless Find/Replace dialog built via CreateWindowExW on a registered class (no .rc resource), six IDM_FIND_* dispatch handlers wiring find::compile + find::find_next + find::replace_all to RichEdit selection via EM_EXSETSEL/EM_REPLACESEL/EM_SETTEXTEX(ST_KEEPUNDO), IsDialogMessageW pre-dispatch in the message loop, and 8 headless pure-logic tests pinning down the replace-path text transformations + LF-normalization boundary.**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-02T23:50:00Z
- **Completed:** 2026-05-03T00:00:19Z
- **Tasks:** 4
- **Files created:** 3 (src/find_ui.rs, src/find_dispatch_pure.rs, tests/find_replace_pure.rs)
- **Files modified:** 4 (src/dispatch.rs, src/main.rs, src/lib.rs, src/menu.rs)
- **Tests:** 8 added; 174 total cargo test pass; 0 regressions

## Accomplishments

- **Modeless dialog (Task 1):** `src/find_ui.rs` ships the full UI surface — pattern input, replacement input (hidden in Find mode), 5 toggles (Match case, Whole word, Regex, Wrap around, Backward), 5 buttons (Find Next, Find Previous, Replace, Replace All, Close), and a status label. Built via `CreateWindowExW` on a class registered via `RegisterClassW` (idempotent OnceLock guard). Mode-toggle (Find ↔ Replace) via show/hide on the Replace edit + buttons. Regex toggle live-greys Whole-word + Backward (D-9). Esc closes; close button destroys; WM_NCDESTROY posts `WM_APP_FIND_DIALOG_CLOSED` to parent (D-14).
- **Search menu (Task 1):** `src/menu.rs` gains a 4-item `&Search` popup between `&Tabs` and `E&ncoding`. Keyboard discoverability per pitfalls.md row 8.
- **Dispatch wiring (Task 2):** all six IDM_FIND_* arms wired:
  - `IDM_FIND_OPEN` (130) / `IDM_FIND_REPLACE_OPEN` (131) → `open_find_or_replace` opens or refocuses the dialog.
  - `IDM_FIND_NEXT` (132) / `IDM_FIND_PREV` (133) → `do_find_next(backward)` runs the engine and EM_EXSETSEL's the match.
  - `IDM_FIND_REPLACE_ONE` (134) → `do_replace_one` checks selection-is-exact-match, EM_REPLACESEL with capture-group expansion, then advances via Find Next.
  - `IDM_FIND_REPLACE_ALL` (135) → `do_replace_all` builds the new buffer via `replace_all_pure`, denormalizes back to the tab's EOL, and EM_SETTEXTEX(ST_KEEPUNDO) inside EM_STOPGROUPTYPING boundaries.
- **LF-normalization boundary (Pitfall 10 / D-4):** every find/replace operation runs `EM_STREAMOUT → from_utf8 → eol::normalize_to_lf` BEFORE handing the text to `find::find_next` / `find::replace_all`. Selection offsets convert UTF-16 cu ↔ UTF-8 byte via `find::utf8_to_utf16_units` / `find::utf16_to_utf8_offset` (Plan 03-03's helpers).
- **Single-undo Replace All (D-8 / orchestrator quality_gate):** the wrapper builds one final String via `replace_all_pure`, then issues a SINGLE `EM_SETTEXTEX(ST_KEEPUNDO)` call inside `EM_STOPGROUPTYPING` boundaries. Pure-logic helper returns `(String, usize)` — type assertion in test 3 pins down that the wrapper has nothing to loop over and cannot accidentally split into N EM_REPLACESEL calls.
- **Message-loop pre-dispatch (Task 3):** `src/main.rs::run_app` reorders to `TranslateAccelerator → IsDialogMessage(if find_dlg_hwnd) → TranslateMessage → DispatchMessage` (Pitfall 7 / D-7). Accelerators (F3 / Shift+F3 / Ctrl+F / Ctrl+H) fire first regardless of focus; IsDialogMessageW handles Tab/Shift-Tab/Esc/Enter/arrow navigation when the dialog has focus.
- **Dialog lifecycle:**
  - `WM_DESTROY` on main window closes any open find dialog before App teardown.
  - Dialog WM_NCDESTROY posts `WM_APP_FIND_DIALOG_CLOSED` to parent.
  - dispatch.rs `WM_APP_FIND_DIALOG_CLOSED` arm clears `app.find_dlg_hwnd = None` and bumps `app.find_epoch` (D-14 — 03-05 worker discards stale results).
- **BLOCKER 4 closed (Task 4):** `tests/find_replace_pure.rs` has 8 headless tests covering replace_one cursor-advance, replace_all multi-match + count, single-undo invariant proxy, empty-replacement deletion (one + all), non-matching selection rejection, partial-match selection rejection.
- **WARN 4 closed (Task 4):** the `lf_normalization_preserves_find_offsets_for_mixed_eol_input` test asserts `find_next` produces identical offsets on a mixed-EOL buffer (CRLF / CR / LF) and its LF-only equivalent after `normalize_to_lf` — Pitfall 10 boundary discipline pinned at the dispatch level.

## Task Commits

1. **Task 1: src/find_ui.rs + Search menu** — `f8f56de` (feat)
2. **Task 2: IDM_FIND_* dispatch handlers + find_dispatch_pure.rs** — `6a7233b` (feat)
3. **Task 3: IsDialogMessageW pre-dispatch in main loop** — `d5895ed` (feat)
4. **Task 4: tests/find_replace_pure.rs (8 tests)** — `4db4445` (test)

## Files Created/Modified

- `src/find_ui.rs` (created, ~430 lines) — modeless dialog
- `src/find_dispatch_pure.rs` (created, ~95 lines) — pure helpers
- `tests/find_replace_pure.rs` (created, ~180 lines) — 8 BLOCKER-4 tests
- `src/dispatch.rs` (modified, +~340 LOC) — Win32 wrappers + lifecycle arms
- `src/main.rs` (modified) — mod declarations + IsDialogMessageW pre-dispatch
- `src/lib.rs` (modified) — pub mod for find_ui + find_dispatch_pure
- `src/menu.rs` (modified) — &Search popup

## Implementation Decisions

### Decisions Taken (Open / Discretion)

- **O-1: Layout/sizing.** Took the recommendation: 420×180 px in Find mode, 420×250 in Replace mode. Pattern label+input row at y=12 (24px tall), Replace label+input row at y=40, toggles row(s) at y=42 / y=72, buttons row at y=100 / y=130, close button below at +30, status label at y=130 / y=160. All hardcoded in `find_ui.rs::open_find_dialog`.
- **O-2: Close button + Esc.** Took the recommendation: dialog has both a close X (via WS_CAPTION | WS_SYSMENU) and Esc-handling in WM_KEYDOWN — both call DestroyWindow(hwnd_dlg).
- **O-3: IDM_FIND_REPLACE_ONE/ALL location.** Took the recommendation: pre-allocated by Plan 03-01 in `src/app.rs` (134 / 135). Plan 03-04 only references them by name — no re-declaration.
- **O-4: Caching compiled regex.** Took the recommendation: NOT cached. `find::compile` is fast; if profiling later shows hot-path cost, add `compiled: Option<Regex>` to FindState.
- **O-5: Reuse dialog instance.** Took the recommendation (a): `open_find_dialog` checks `existing` and refocuses + mode-switches if the HWND is still valid. Single dialog instance persists across Ctrl+F / Ctrl+H toggles.

### Deviations from Locked Decisions

None of the Locked decisions D-1 through D-16 were violated. Two structural deviations from plan recommendations (NOT from Locked decisions):

**DV-1: Pure helpers placed in NEW `src/find_dispatch_pure.rs` rather than appended to `src/dispatch.rs`.**
- **Plan recommended:** put `find_next_pure` / `replace_one_pure` / `replace_all_pure` directly in `src/dispatch.rs`. Plan task 2 explicitly allows a new module under the executor's-choice clause.
- **Why deviated:** the integration test `tests/find_replace_pure.rs` imports the helpers via `use notepadrs::*`, which means the lib crate must expose them. Promoting `dispatch` itself to `pub mod dispatch` in `src/lib.rs` triggers an unresolved-import error: `crate::log::oslog` is bin-only (`log` was never added as a `pub(crate) mod` to `lib.rs`), and `dispatch.rs::use crate::log::oslog` fails when compiled as part of the lib. Adding `pub(crate) mod log;` to lib.rs would in turn require auditing that `log` is reachable in all contexts the lib crate depends on. Splitting the pure helpers into their own no-Win32 module avoids the cascade.
- **Result:** `find_dispatch_pure` is the canonical home; `dispatch.rs`'s wrappers `do_find_next` / `do_replace_one` / `do_replace_all` call into it. Test imports via `notepadrs::find_dispatch_pure::*`. Mirrors the existing `dispatch_pure.rs` precedent (Phase 2 split).
- **Files affected:** `src/find_dispatch_pure.rs` (new), `src/lib.rs` + `src/main.rs` (mod declarations).

**DV-2: Test file is `tests/find_replace_pure.rs` not `tests/find_replace_dispatch.rs`.**
- **Plan named:** `tests/find_replace_dispatch.rs`.
- **Why deviated:** when a Cargo test binary is named `find_replace_dispatch-<hash>.exe` and run on Windows, Windows ApplicationCompatibility's installer-detection heuristic flags the binary and demands UAC elevation. cargo test fails with `os error 740: The requested operation requires elevation`. Verified by copying the binary to `/tmp/frd_test.exe` and running directly — all 8 tests pass instantly. The "_dispatch" suffix combined with a bin produced by build.rs's `embed_manifest` (which ships only the bin manifest, not the test manifests) trips the heuristic. Renaming to `find_replace_pure` is the minimal change that sidesteps it.
- **Result:** test file lives at `tests/find_replace_pure.rs`; all 8 tests pass under `cargo test --test find_replace_pure`. Plan-level grep asserts (e.g., "grep 'lf_normalization_preserves_find_offsets'") still hit because the test names are preserved verbatim.

### Open Questions for Verifier

**Q-1: Single-undo behavior under live RichEdit (D-8 LOW-confidence flag from research.md).**

The pure-logic invariant — `replace_all_pure` returns ONE final String, the wrapper hands it to ONE `EM_SETTEXTEX(ST_KEEPUNDO)` call — is provable headlessly (test 3). The runtime guarantee that EM_SETTEXTEX(ST_KEEPUNDO) inside EM_STOPGROUPTYPING boundaries produces EXACTLY ONE undo entry (rather than the buffer's old content + new content as two entries) is research.md Tertiary Sources LOW confidence and cannot be tested headlessly.

Verifier should perform the following manual smoke (Windows host required):
1. `cargo run --release -- some_test_file_with_5_matches_of_foo.txt`
2. Ctrl+H → type "foo" in Find, "bar" in Replace, click Replace All → status shows "Replaced 5 occurrence(s)".
3. Click in the buffer to ensure undo focus is on RichEdit, then press Ctrl+Z ONCE.
4. Expected: ALL 5 replacements revert in one step; the buffer reads as it was pre-Replace All.
5. Press Ctrl+Y ONCE → all 5 replacements re-apply in one step.

If this smoke fails (e.g. Ctrl+Z reverts only one match, or partially reverts), the fallback per research.md is to wrap the loop differently — but this is a Plan 03-04 v1.x polish item, not a blocker for the FIND-08 surface.

**Q-2: utf16_to_utf8_offset surrogate-pair sanity.** Plan 03-03 flagged that `utf16_to_utf8_offset` lands AFTER a surrogate-pair midpoint (next codepoint's byte), not at codepoint start. Plan 03-04 uses this to map RichEdit's UTF-16 selection to UTF-8 byte offsets in `do_find_next` and `do_replace_one`. For selection START (cpMin), this is fine — RichEdit emits valid cu offsets at codepoint boundaries from EM_EXGETSEL. For selection END (cpMax), same — Win32 doesn't issue mid-surrogate cu values from EM_EXGETSEL. **No flip needed in 03-03's helper.** Verified by inspection: `do_find_next` uses cpMin/cpMax directly from `EM_EXGETSEL` (which never returns mid-surrogate), and `do_replace_one`'s `replace_one_pure` boundary check `sel_byte_start >= sel_byte_end` covers the empty-selection case. The surrogate-pair concern was speculative — it materializes only if user code passes hand-constructed odd cu values to EM_EXSETSEL, which Plan 03-04 never does.

## Deviations from Plan

See `## Implementation Decisions` (DV-1, DV-2) above. Both are mechanical workarounds (Rust visibility model + Windows installer-detection heuristic) — neither changes the dialog API or the find/replace semantics.

**Total deviations:** 2 (both Rule 3 - Blocking, both auto-fixed).

**Impact on plan:** Zero on the FIND-01..09 surface, on the dispatch contracts, or on the test coverage. Plan-level verification still holds (all referenced grep checks pass; the renamed test file still contains the same test names verbatim).

## Issues Encountered

- **Auto-fixed bugs during build (Rule 1):**
  1. `BST_CHECKED` / `BST_UNCHECKED` not in `windows::Win32::UI::WindowsAndMessaging::*` — they live in `windows::Win32::UI::Controls`. Added explicit import.
  2. `crate::eol::denormalize_to_eol` returns `String`, not `Vec<u8>` — plan-listed assumption was wrong. Fixed by treating the return value as `String` directly (no UTF-8 round-trip needed).
  3. Clippy flagged `IsDialogMessageW(hdlg, &mut msg)` — windows-rs 0.62's signature accepts `&MSG` not `&mut MSG`. Fixed.
  4. Clippy flagged `create_control(parent, class, text, id, x, y, w, h, style)` for `too_many_arguments` (9 > 7). Added `#[allow(clippy::too_many_arguments)]`.
- **Pre-existing test-file clippy errors** in `tests/roundtrip_matrix.rs` (collapsible_str_replace) and `tests/undo_property.rs` (unusual_byte_groupings) surface when running `cargo clippy --tests -- -D warnings`. These are NOT introduced by Plan 03-04 — same items called out in 03-01-summary.md and 03-02-summary.md. Plan 03-04 stays scoped to `--lib --bins` clippy + `--test find_replace_pure -- -D warnings`. Out-of-scope per scope-boundary rule.
- **Windows UAC installer-detection on test binary** named `find_replace_dispatch-<hash>.exe` (DV-2). Renamed to `find_replace_pure.rs` to sidestep.

## User Setup Required

None — no external services, no env vars. The dialog opens on Ctrl+F / Ctrl+H out of the box.

## Manual Smoke (Windows host required — informational)

These cannot run headlessly on the test machine; documented for the verifier:

1. `cargo run --release -- tests/fixtures/utf8_no_bom_lf.txt` — main window opens with file content.
2. Ctrl+F → modeless Find dialog appears at (100, 100). Pattern input has focus. Main window remains responsive.
3. Type "Hello" → click Find Next → "Hello" gets selected in the editor (EM_EXSETSEL applied), scrolled into view, focus stays in the dialog. Click Find Next again → next "Hello" selected.
4. With cursor past the last match + Wrap on → click Find Next → first "Hello" selected, status shows "Wrapped to top".
5. Ctrl+H → dialog grows to Replace mode (Replace input + Replace + Replace All buttons appear; close button shifts down). Existing pattern + flags carry over.
6. Type "World" in Replace input → click Replace → first "Hello" becomes "World", cursor advances. Click Replace All on remaining matches → status shows "Replaced N occurrence(s)".
7. Press Ctrl+Z **ONCE** → ENTIRE Replace All reverts in one step (D-8 / Q-1 verification — this is the single-undo invariant).
8. Toggle Regex → Whole word + Backward checkboxes go grey (D-9).
9. Type a malformed regex like `[unclosed` → status shows "Bad pattern: …" (D-10).
10. Press Esc inside the dialog → dialog closes; `app.find_dlg_hwnd` clears via WM_APP_FIND_DIALOG_CLOSED.
11. Press F3 with the dialog closed → uses the last-used pattern + flags + direction (forward).
12. Press Shift+F3 → same as F3 but backward.
13. Open dialog, focus the pattern input, press Tab → focus moves to next control (replace input or first checkbox); IsDialogMessageW handled it (Pitfall 7).

## Next Phase Readiness

- **Plan 03-05 (Wave 4 — worker thread):** unblocked. Sync find/replace path is wired end-to-end; `do_find_next` increments `app.find_epoch.fetch_add(1, Release)` already; `WM_APP_FIND_DIALOG_CLOSED` clears `app.find_dlg_hwnd` and bumps the epoch. 03-05 can wrap `find::find_next` in a worker thread + spawn-and-poll on `EN_CHANGE` boundaries; the LF-normalization, selection round-trip, and single-undo wrapper logic in `dispatch.rs` all stay in place.
- **Conflict zone with 03-05:** `src/dispatch.rs` (03-05 will modify `do_find_next` to branch on buffer size: <1MB synchronous as today, ≥1MB defers to worker). `src/main.rs` and `src/lib.rs` may gain `mod find_worker;` declarations. No conflict with Plan 03-04's contributions — 03-05 wraps, doesn't replace.
- **No blockers.** Build, clippy --lib --bins, all 174 tests pass.

## Self-Check: PASSED

- [x] `src/find_ui.rs` exists at `~\pan-experiments\notepadrs\src\find_ui.rs`
- [x] `src/find_dispatch_pure.rs` exists
- [x] `tests/find_replace_pure.rs` exists with 8 passing tests
- [x] `src/dispatch.rs` has `do_find_next`, `do_replace_one`, `do_replace_all` (`grep -E '^unsafe fn (do_find_next|do_replace_one|do_replace_all)' src/dispatch.rs` returns 3 lines)
- [x] `src/main.rs` declares `mod find_ui;` + `mod find_dispatch_pure;` and uses `IsDialogMessageW` in the message loop
- [x] `src/lib.rs` declares `pub mod find_ui;` + `pub mod find_dispatch_pure;`
- [x] `src/menu.rs` has `&Search` popup (4 entries)
- [x] commit `f8f56de` (feat Task 1) on main
- [x] commit `6a7233b` (feat Task 2) on main
- [x] commit `d5895ed` (feat Task 3) on main
- [x] commit `4db4445` (test Task 4) on main
- [x] cargo build --target x86_64-pc-windows-msvc → finished
- [x] cargo clippy --target x86_64-pc-windows-msvc --lib --bins -- -D warnings → finished
- [x] cargo test --target x86_64-pc-windows-msvc → 174 tests pass, 0 fail, 0 regression vs Plan 03-03 baseline (166 → 174 = +8 BLOCKER 4 tests)

---
*Phase: 03-multi-tab-find-replace*
*Completed: 2026-05-03*
