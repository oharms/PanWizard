---
phase: 02-file-i-o-encoding-cascade
plan: 03
subsystem: file-io
tags: [encoding, eol, menu, save-as, win32-menu, WM_INITMENUPOPUP, dispatch-pure]

# Dependency graph
requires:
  - phase: 02-file-i-o-encoding-cascade
    plan: 02
    provides: EditorState with encoding/eol/original_bytes/had_trailing_newline fields, save_text_for_disk (Pattern A), open_text_with_metadata
  - phase: 02-file-i-o-encoding-cascade
    plan: 01
    provides: DetectedEncoding/Eol enums, encode, decode, normalize_to_lf, denormalize_to_eol

provides:
  - File + Edit + Encoding menu bar (3 top-level menus with proper substructure)
  - IDM_* constants 110-118 (Save As, 5 encoding, 3 EOL) in src/app.rs
  - WM_INITMENUPOPUP handler (CheckMenuRadioItem syncs encoding/EOL checkmarks to active EditorState)
  - set_encoding_if_changed / set_eol_if_changed (pub, Anti-Pattern 7 no-op guards)
  - do_file_save_as (GetSaveFileNameW + sequential MessageBox picker + save_text_for_disk_as)
  - EditorState::save_text_for_disk_as (caller-supplied encoding/EOL, commits new identity on success)
  - src/dispatch_pure.rs (encoding_change_decision + eol_change_decision — pure, testable without HWND)
  - tests/menu_action_tests.rs (10 unit tests for decision logic)

affects: [02-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - WM_INITMENUPOPUP + CheckMenuRadioItem for menu state sync (radio-button group, single checked item)
    - dispatch_pure split pattern: pure decision logic in separate module for headless unit testing
    - Sequential MessageBox picker (v1 Save As UX — reliable, no DLGTEMPLATE, clunky but ships)
    - Anti-Pattern 7 mitigation: encoding/EOL handler no-ops when current == requested (prevents phantom dirty markers)

key-files:
  created:
    - src/dispatch_pure.rs
    - tests/menu_action_tests.rs
  modified:
    - src/app.rs
    - src/menu.rs
    - src/dispatch.rs
    - src/editor.rs
    - src/lib.rs
    - src/main.rs

key-decisions:
  - "D-1 followed: IDM_* range 110-118 (Save As=110, encoding UTF8..ANSI=111-115, EOL LF..CR=116-118)"
  - "D-2 followed: Encoding menu labels UTF-8 / UTF-8 with BOM / UTF-16 LE / UTF-16 BE / ANSI"
  - "D-3 followed: EOL submenu under Edit: LF (Unix) / CRLF (Windows) / CR (Mac classic)"
  - "D-4 followed: Anti-Pattern 7 — set_encoding_if_changed / set_eol_if_changed no-op when current == requested"
  - "D-5 followed: Save As flow — GetSaveFileNameW → pick_encoding_and_eol → save_text_for_disk_as; cancel at either step returns early with no state change"
  - "D-6 DEVIATED: Sequential MessageBox picker used instead of DialogBoxIndirectParamW (Task 2b deferred — see Implementation Decisions DV-1)"
  - "D-7 followed: save_text_for_disk_as mirrors save_text_for_disk's edited branch; commits encoding/EOL/path/cache on success; EM_SETMODIFY(0)"
  - "D-8 followed: Mixed EOL normalised to its majority for Save As pre-selection (3 pure EOL options only)"
  - "D-9 handled by encode(): UTF-16 LE/BE always include BOM"
  - "D-10 followed: WM_INITMENUPOPUP + CheckMenuRadioItem for radio-checked menu state"
  - "O-1 taken: CheckMenuRadioItem (radio dot, correct for single-choice group)"
  - "O-2 taken: hand-rolled MessageBox picker (no embed-resource; no DLGTEMPLATE yet)"
  - "O-3 taken: allow save to new path (OFN_OVERWRITEPROMPT for existing files)"
  - "O-4 confirmed: cancel at any stage = no state mutation"
  - "Windows AppCompat shim blocks test binaries named *dispatch* — test file renamed to menu_action_tests.rs"

patterns-established:
  - "dispatch_pure module: pure decision helpers live here; dispatch.rs calls them and handles Win32 effects"
  - "Integration test naming: avoid filenames matching Windows AppCompat installer heuristic patterns (dispatch, setup, install, update, patch)"

requirements-completed: [FILE-04, FILE-09, FILE-10]
test-tiers: [integration]

# Metrics
duration: 25min
completed: 2026-05-02
---

# Phase 2 Plan 03: Encoding/EOL Menu + Save As Summary

**Encoding menu (5 variants), EOL Conversion submenu (3 variants), and Save As dialog wired end-to-end: menu bar extended to 3 top-level menus, WM_INITMENUPOPUP syncs radio checkmarks, set_encoding_if_changed/set_eol_if_changed guard against phantom dirty markers (Anti-Pattern 7), and save_text_for_disk_as commits new encoding/EOL/path identity on success — 72 cumulative tests passing**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-05-02T23:45:00Z
- **Completed:** 2026-05-02T23:51:00Z
- **Tasks:** 3 (Task 1, Task 2a+2b coalesced, Task 3)
- **Files modified:** 6 modified + 2 created

## Accomplishments

- `src/app.rs`: 9 new IDM_* constants (110–118) following D-1 range allocation.
- `src/menu.rs`: build_main_menu extended from 1 to 3 top-level menus (File / Edit / Encoding). File adds Save As; Edit adds EOL Conversion submenu (LF/CRLF/CR); Encoding adds 5 variants (UTF-8/UTF-8 BOM/UTF-16 LE/UTF-16 BE/ANSI).
- `src/dispatch.rs`: WM_INITMENUPOPUP handler (CheckMenuRadioItem for encoding group 111-115 and EOL group 116-118); WM_COMMAND arms for all 9 new IDs; `set_encoding_if_changed` + `set_eol_if_changed` (pub, no-op on same value per Anti-Pattern 7, mark dirty + DrawMenuBar otherwise); `do_file_save_as` (GetSaveFileNameW → sequential MessageBox picker → save_text_for_disk_as); `loop_picker` helper for MB_YESNOCANCEL option walk.
- `src/editor.rs`: `save_text_for_disk_as` added — mirrors save_text_for_disk's edited branch but uses caller-supplied encoding/EOL; commits new identity on success; EM_SETMODIFY(0) clears dirty flag.
- `src/dispatch_pure.rs`: new file — `encoding_change_decision` + `eol_change_decision` (pure, no Win32); extracted so integration tests can test without HWND.
- `tests/menu_action_tests.rs`: 10 unit tests covering encoding no-op, encoding change, Utf8↔Utf8Bom symmetry, EOL no-op, EOL change, Mixed→pure, Mixed→Mixed-majority.
- Cumulative test count: 72 (62 baseline → +10 new).
- Release binary: 427,008 bytes (~417 KB) — within 10 MB ceiling.

## Task Commits

1. **Task 1: IDM_* constants + Edit/Encoding menus** - `cd28b87` (feat)
2. **Task 2a+2b: WM_INITMENUPOPUP, handlers, Save As, save_text_for_disk_as** - `e7d6727` (feat)
3. **Task 3: tests/menu_action_tests.rs** - `88ab1fb` (test)

## Files Created/Modified

- `src/app.rs` — 9 new IDM_* constants (110–118)
- `src/menu.rs` — Extended to 3-menu bar (File+Edit+Encoding)
- `src/dispatch.rs` — WM_INITMENUPOPUP, 9 new WM_COMMAND arms, set_encoding_if_changed, set_eol_if_changed, do_file_save_as, loop_picker
- `src/editor.rs` — save_text_for_disk_as method added
- `src/dispatch_pure.rs` — NEW: encoding_change_decision + eol_change_decision
- `src/lib.rs` — pub mod dispatch_pure added
- `src/main.rs` — mod dispatch_pure added
- `tests/menu_action_tests.rs` — NEW: 10 unit tests

## Implementation Decisions

### Taken (within plan's discretion)

- **DT-O1:** Chose `CheckMenuRadioItem` (O-1). Shows a radio dot rather than a checkmark — idiomatic for single-choice groups. The first ID and last ID in the group bracket (IDM_ENCODING_UTF8..IDM_ENCODING_ANSI = 111..115; IDM_EOL_LF..IDM_EOL_CR = 116..118) are passed to `CheckMenuRadioItem` with `MF_BYCOMMAND`; the handle passed is the main menubar HMENU since MF_BYCOMMAND resolves by command ID regardless of menu depth.

- **DT-O2:** Chose hand-rolled sequential MessageBox picker (O-2) for the Save As encoding/EOL selection. No DLGTEMPLATE construction; no new dependency. The `loop_picker` helper presents each option via `MB_YESNOCANCEL`: Yes = pick, No = next, Cancel = abort. The current value is always offered first so pressing Yes twice (once for encoding, once for EOL) preserves the current settings. If the user declines all options, the first is returned as the default.

- **DT-O3:** Chose `OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST` for GetSaveFileNameW (O-3). The `OFN_PATHMUSTEXIST` ensures the target directory exists; `OFN_OVERWRITEPROMPT` shows the Win32-standard "file exists, overwrite?" prompt for existing paths. New paths (directory exists, file doesn't) proceed without a prompt — intentional.

- **DT-O4:** Confirmed (O-4 re-confirmation): cancel at GetSaveFileNameW or at the encoding/EOL picker returns early from `do_file_save_as` with no state mutation. No encoding/EOL/path fields change; no dirty flag is set.

### Deviations (from plan; must explain)

- **DV-1:** D-6 specified `DialogBoxIndirectParamW` with a hand-constructed `DLGTEMPLATE` as the Save As encoding/EOL picker. The executor shipped the sequential MessageBox-based fallback described in Task 2a's deferral guidance instead. Reason: Task 2b's `DLGTEMPLATE` construction is structurally correct per the plan's reference material, but the `DLGITEMTEMPLATE` alignment requirements (DWORD-aligned, packed in a `Vec<u8>`) are fiddly and would have consumed more time than the UX improvement justifies for v1. The sequential MessageBox picker (Task 2a) is fully functional and shippable. Task 2b remains listed as a Phase 4 improvement opportunity. Verification: the `do_file_save_as` code compiles, clippy passes, and the Save As flow (path → encoding picker → EOL picker → save) is correctly structured; manual smoke would show the sequential MessageBox UI.

### Open questions for verifier

- **Q-1:** The `loop_picker` terminal case ("user pressed No to all options — return first as default") may surprise users who press No to everything expecting a Cancel result. Pressing No to every option is likely a mistake; the current behavior silently picks the first. Worth considering whether this should be changed to return None instead. The plan doesn't specify this edge case. Impact: very low-frequency UX edge case only.

- **Q-2:** `set_eol_if_changed` treats `Mixed(Crlf) != Crlf` as a real change (mark dirty). This is correct per D-4 semantics (converting Mixed to pure CRLF is a save-time re-emission). Verify that the unit test `eol_change_from_mixed_to_mixed_majority_still_proceeds` correctly captures this intent.

- **Q-3:** Manual smoke verification required: launch `notepadrs.exe tests\fixtures\utf8_no_bom_lf.txt`, click Encoding → UTF-16 LE (verify radio dot moves, title bar not immediately dirty — dirty only after confirming), click Edit → EOL Conversion → CRLF, press Ctrl+S, verify bytes `255 254` (UTF-16 LE BOM) and `13 10` (CRLF) in saved file. Cannot be automated without HWND.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added mod dispatch_pure to main.rs**
- **Found during:** Task 2 (first build attempt after creating dispatch_pure.rs)
- **Issue:** `src/dispatch.rs` imports `crate::dispatch_pure` but the binary crate (main.rs) doesn't declare the module. Same pattern as the Phase 2 Plan 02 DV-2 fix (mod encoding + mod eol needed in main.rs for the same reason).
- **Fix:** Added `mod dispatch_pure;` to `src/main.rs`.
- **Files modified:** `src/main.rs`
- **Verification:** `cargo build` succeeded after fix.
- **Committed in:** `e7d6727`

**2. [Rule 3 - Blocking] Test file renamed from menu_dispatch.rs to menu_action_tests.rs**
- **Found during:** Task 3 (first `cargo test --test menu_dispatch` run)
- **Issue:** Windows Application Compatibility Infrastructure (AppCompat) flags test binaries named `*dispatch*` for elevation via `CreateProcess`, causing `ERROR_ELEVATION_REQUIRED (os error 740)`. The binary runs fine when invoked directly via cmd.exe (which uses `ShellExecuteEx`) but cargo test uses `std::process::Command::spawn()` which calls `CreateProcess` directly and gets the elevation block. The binary itself has no manifest requesting elevation; the issue is the Windows AppCompat heuristic.
- **Fix:** Renamed `tests/menu_dispatch.rs` → `tests/menu_action_tests.rs`. The binary name is derived from the file name, so the new hash avoids the AppCompat pattern.
- **Files modified:** `tests/menu_action_tests.rs` (created), `tests/menu_dispatch.rs` (removed)
- **Verification:** `cargo test --test menu_action_tests` passes all 10 tests.
- **Committed in:** `88ab1fb`

---

**Total deviations:** 2 auto-fixed (2 blocking) + 1 plan deviation (D-6 deferred; Task 2b sequential MessageBox shipped instead)
**Impact on plan:** Auto-fixes required for build correctness and test runnability. D-6 deferral is explicitly supported by the plan's Task 2b deferral guidance. No scope creep.

## Save As UX (v1 — Sequential MessageBox)

The shipped v1 Save As flow presents encoding and EOL choices as sequential `MB_YESNOCANCEL` dialogs:

1. `File → Save As…` opens `GetSaveFileNameW` (path picker).
2. Encoding picker: 5 options, current encoding offered first. Yes=pick, No=next, Cancel=abort.
3. EOL picker: 3 options, current EOL (or Mixed majority) offered first. Yes=pick, No=next, Cancel=abort.
4. `save_text_for_disk_as` encodes and writes atomically; on success commits new encoding/EOL/path to EditorState.

Task 2b (`DialogBoxIndirectParamW` single-dialog upgrade) is deferred to Phase 4 (status-bar work, where dialog construction patterns are also relevant for Find/Replace).

## IDM_* Range Summary (for Plan 02-04)

| ID | Constant | Purpose |
|----|----------|---------|
| 100 | IDM_FILE_OPEN | File → Open |
| 101 | IDM_FILE_SAVE | File → Save |
| 102 | IDM_FILE_EXIT | File → Exit |
| 110 | IDM_FILE_SAVE_AS | File → Save As... |
| 111 | IDM_ENCODING_UTF8 | Encoding → UTF-8 |
| 112 | IDM_ENCODING_UTF8_BOM | Encoding → UTF-8 with BOM |
| 113 | IDM_ENCODING_UTF16_LE | Encoding → UTF-16 LE |
| 114 | IDM_ENCODING_UTF16_BE | Encoding → UTF-16 BE |
| 115 | IDM_ENCODING_ANSI | Encoding → ANSI |
| 116 | IDM_EOL_LF | Edit → EOL Conversion → LF |
| 117 | IDM_EOL_CRLF | Edit → EOL Conversion → CRLF |
| 118 | IDM_EOL_CR | Edit → EOL Conversion → CR |
| 119–122 | (reserved) | Plan 02-04 / Phase 3 expansion |
| 0xE001–0xE008 | (reserved) | RichEdit edit commands |

## Binary Size Delta

- Plan 02-02 release binary: 420,864 bytes
- Plan 02-03 release binary: 427,008 bytes (+6 KB)
- Delta: +6 KB — menu + dispatch code. Within 10 MB ceiling.

## Self-Check: PASSED

Key files verified:
- src/dispatch_pure.rs: FOUND
- src/app.rs: FOUND (IDM_FILE_SAVE_AS=110 present)
- src/menu.rs: FOUND (Edit + Encoding menus present)
- src/editor.rs: FOUND (save_text_for_disk_as present)
- tests/menu_action_tests.rs: FOUND

Commits verified in git log:
- `cd28b87` - feat(02-03): IDM_* constants + Edit/Encoding menus
- `e7d6727` - feat(02-03): WM_INITMENUPOPUP, handlers, Save As, save_text_for_disk_as
- `88ab1fb` - test(02-03): menu_action_tests.rs — 10 unit tests

---
*Phase: 02-file-i-o-encoding-cascade*
*Completed: 2026-05-02*
