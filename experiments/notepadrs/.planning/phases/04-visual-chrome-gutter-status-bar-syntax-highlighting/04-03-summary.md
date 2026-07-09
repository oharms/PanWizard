---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 03
subsystem: ui
tags: [win32, status-bar, richedit, en_selchange, en_change, tcn_selchange]

# Dependency graph
requires:
  - phase: 04-01
    provides: status_bar.rs create_status_bar / set_segment / get_status_height; App.hstatus + status_height; EM_SETEVENTMASK = ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE pre-allocated
provides:
  - DetectedEncoding::label_for_status (5 variants — UTF-8/UTF-8 BOM/UTF-16 LE/UTF-16 BE/ANSI)
  - Eol::label_for_status (4 distinct values — LF/CRLF/CR/Mixed)
  - format_row_col(line, col) -> String pure helper (1-based display)
  - update_row_col_segment / update_encoding_segment / update_eol_segment / update_line_count_segment / update_all_segments unsafe helpers
  - WONTFIX-v1 P4-5 doc comment in update_row_col_segment (UTF-16 code-unit columns, not visual)
  - Status bar populated from WM_CREATE; refreshed on EN_SELCHANGE / EN_CHANGE / TCN_SELCHANGE / file open/save / encoding-EOL menu
  - 19 pure-logic tests in tests/status_bar_labels.rs
affects: [04-04b]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-segment update helper API (update_row_col_segment / update_line_count_segment) for selective updates on edit-only events; update_all_segments for tab-switch / file-open / file-save"
    - "EM_GETSEL out-pointers for caret position (UTF-16 code units), then EM_LINEFROMCHAR + EM_LINEINDEX for row:col conversion"
    - "label_for_status methods on DetectedEncoding and Eol for source-of-truth formatting at the call site"
    - "Mixed EOL collapses to 'Mixed' in status (was 'Mixed (CRLF)' etc. via .label() — narrow segment)"
    - "WONTFIX-v1 documented IN THE SOURCE per Warning #10 (P4-5: UTF-16 code-unit columns vs visual columns)"

key-files:
  created:
    - tests/status_bar_labels.rs
  modified:
    - src/encoding.rs
    - src/eol.rs
    - src/status_bar.rs
    - src/dispatch.rs

key-decisions:
  - "D-1 (UTF-16 code-unit columns, WONTFIX-v1 documented in source per Warning #10)"
  - "D-2 (1-based display row:col — Ln/Col format matches Notepad / Notepad++ / VS Code)"
  - "D-3 (per-event cadence: row:col on EN_CHANGE+EN_SELCHANGE; encoding/EOL on tab switch + menu; line count on EN_CHANGE; all-four on TCN_SELCHANGE / file open/save)"
  - "D-4 (label_for_status on enums — kept formatting near data)"
  - "D-5 / D-6 (selective updates avoid update_all_segments on every keystroke)"
  - "D-9 (editor.rs NOT mutated — Plan 04-01 D-13 pre-allocated ENM_SELCHANGE)"
  - "O-1 (no thousands separators in row:col display — matches both Notepad++ and VS Code)"
  - "O-2 ({n} lines suffix unconditional — consistent format > grammar perfection at n=1)"
  - "O-3 (populate segments at WM_CREATE — user sees defaults from first paint)"

patterns-established:
  - "Status bar update API: update_<thing>_segment for fine-grained updates; update_all_segments as the canonical batch entry"
  - "Mixed EOL representation: enum Eol::Mixed(MixedMajority) but status label collapses to plain 'Mixed' (segment width budget)"

requirements-completed: [VIEW-02, VIEW-03, VIEW-04, VIEW-05]
test-tiers: [unit]

# Metrics
duration: ~14 min
completed: 2026-05-03
---

# Phase 4 Plan 03: Status Bar Segments Wired to Live Editor State Summary

**All four status-bar segments (row:col / encoding / EOL / line count) wire to live editor events: row:col + line count tick on every edit, encoding/EOL update on tab switch + menu conversion, all four refresh together on tab switch + file open/save — no editor.rs mutation (Plan 04-01's pre-allocated ENM_SELCHANGE makes EN_SELCHANGE fire natively).**

## Performance

- **Duration:** ~14 min (2 task commits + auto-approved checkpoint)
- **Tasks:** 3 (Task 3 = human-verify checkpoint, auto-approved under --auto mode)
- **Files created:** 1 (tests/status_bar_labels.rs)
- **Files modified:** 4 (src/encoding.rs, src/eol.rs, src/status_bar.rs, src/dispatch.rs)
- **Tests added:** 19 (all passing in tests/status_bar_labels.rs)

## Accomplishments

- `DetectedEncoding::label_for_status(&self) -> &'static str` — returns "UTF-8" / "UTF-8 BOM" / "UTF-16 LE" / "UTF-16 BE" / "ANSI" (5 variants; `Cp1252` enum variant maps to "ANSI" label)
- `Eol::label_for_status(&self) -> &'static str` — returns "LF" / "CRLF" / "CR" / "Mixed" (4 distinct values; the 3 `Mixed(MixedMajority)` cases all return plain "Mixed" because the segment is narrow)
- `format_row_col(line: u32, col: u32) -> String` pure helper returning `"Ln {line}, Col {col}"` (1-based; matches Notepad / Notepad++ / VS Code)
- `update_row_col_segment(app: &App)` — EM_GETSEL → EM_LINEFROMCHAR → EM_LINEINDEX → format_row_col + set_segment(0); WONTFIX-v1 P4-5 doc comment per Warning #10
- `update_encoding_segment / update_eol_segment / update_line_count_segment` — per-segment selective updates
- `update_all_segments(app: &App)` — single-call API for tab switch, file open/save, encoding/EOL menu
- WM_CREATE: `update_all_segments` after first tab pushed → user sees `Ln 1, Col 1 | UTF-8 | CRLF | 1 lines` from first paint
- WM_NOTIFY EN_SELCHANGE → `update_row_col_segment` (only when source matches active tab)
- WM_NOTIFY TCN_SELCHANGE → `update_all_segments` after tab swap
- WM_COMMAND EN_CHANGE → `update_row_col_segment` + `update_line_count_segment` after the existing dirty/gutter relayout logic
- `set_encoding_if_changed` → `update_encoding_segment` after conversion
- `set_eol_if_changed` → `update_eol_segment` after conversion
- `open_path_external` Ok branch → `update_all_segments`
- `do_file_save` Ok branch → `update_all_segments`
- `do_file_save_as` Ok branch → `update_all_segments` (Save As may have changed encoding/EOL)
- `src/editor.rs` is NOT modified — D-9 / Blocker #2 fix preserved
- 19 pure-logic tests covering format_row_col edge cases (1,1 / typical / large / zero / no-thousands-sep / max), 5 encoding labels + uniqueness, 6 EOL variant labels (LF/CRLF/CR + 3 Mixed) + 4-distinct-values check

## Task Commits

1. **Task 1: label_for_status methods + status bar update helpers + 19 tests** — `fe65401` (feat)
2. **Task 2: Wire status bar to dispatch.rs events** — `21d272e` (feat)
3. **Task 3 (checkpoint:human-verify):** auto-approved under `--auto` mode + `workflow.auto_advance=true`

## Files Created/Modified

- `src/encoding.rs` — `DetectedEncoding::label_for_status` method
- `src/eol.rs` — `Eol::label_for_status` method (collapses Mixed(MixedMajority) → "Mixed")
- `src/status_bar.rs` — `format_row_col` pure helper + 5 unsafe segment-update helpers; WONTFIX-v1 doc comment per Warning #10
- `src/dispatch.rs` — WM_CREATE / WM_NOTIFY (EN_SELCHANGE + TCN_SELCHANGE) / WM_COMMAND EN_CHANGE / set_encoding_if_changed / set_eol_if_changed / open_path_external / do_file_save / do_file_save_as all wire status updates
- `tests/status_bar_labels.rs` — 19 pure-logic tests

## Implementation Decisions

### Taken (within plan's discretion)

- DT-1: For O-1 (thousands separators), used plain numbers (no commas). Matches Notepad++ and VS Code.
- DT-2: For O-2 ({n} lines suffix), unconditional — `format!("{n} lines")` for both n=1 and n>1 (consistent format > grammar perfection at n=1).
- DT-3: For O-3 (populate at WM_CREATE), YES — added `update_all_segments` call after the line_height_px / em_width_px capture block in WM_CREATE so the user sees `Ln 1, Col 1 | UTF-8 | CRLF | 1 lines` from first paint.

### Deviations (from plan; must explain)

**1. [Rule 1 - Bug] Plan template's `DetectedEncoding::Ansi` variant doesn't exist — actual variant is `Cp1252`**
- Found during: Task 1 build (writing `label_for_status`)
- Issue: Plan template in 04-03 used `DetectedEncoding::Ansi`, but the actual enum from Phase 2 is `Cp1252` (with the comment "ANSI fallback (Windows-1252)"). The label string is still "ANSI" — the variant name differs.
- Fix: Used `DetectedEncoding::Cp1252` in the match arm; the label string is "ANSI" as the plan intended.
- Verification: `cargo build` succeeds; tests pass.

**2. [Rule 1 - Bug] Plan template's `Eol::Mixed` is unit variant; actual is `Eol::Mixed(MixedMajority)`**
- Found during: Task 1 build (writing `Eol::label_for_status`)
- Issue: Plan template referred to `Eol::Mixed` as a unit variant. The actual enum (Phase 2) is `Eol::Mixed(MixedMajority)` carrying which style was the majority of newlines.
- Fix: Match arm uses `Eol::Mixed(_)` and returns plain "Mixed" — this matches the plan's intent for segment 2 (narrow space; the existing `.label()` method renders `Mixed (CRLF)` etc. and we kept it).
- Verification: 4 distinct values returned; tests assert this and pass.

**3. [Rule 1 - Bug] EM_GETLINECOUNT / EM_GETSEL / EM_LINEFROMCHAR / EM_LINEINDEX live in `windows::Win32::UI::Controls`, not `Controls::RichEdit`**
- Found during: Task 1 build (status_bar.rs imports)
- Issue: Plan template imported these from `Controls::RichEdit`, but in `windows-rs 0.62.2` they're EDIT messages (Edit control, not specifically RichEdit) defined at `windows::Win32::UI::Controls`.
- Fix: Changed import path to `use windows::Win32::UI::Controls::{EM_GETLINECOUNT, EM_GETSEL, EM_LINEFROMCHAR, EM_LINEINDEX};`
- Verification: `cargo build` succeeds. `EN_SELCHANGE` IS in `Controls::RichEdit` (RichEdit-specific notification); plan template's path was correct for that one.

### Open questions for verifier

- Q-1: The `Eol::Mixed` variant is rendered as plain "Mixed" in the status bar segment. The `Eol` enum has a separate `.label()` method that returns "Mixed (CRLF)" etc. — that label is still wired up via Phase 2 / Phase 4 stubs (currently `#[allow(dead_code)]`). Verifier should confirm this is acceptable: status bar uses `label_for_status` (concise), but a future hover tooltip or wider-segment redesign might switch to `.label()`.
- Q-2: `set_encoding_if_changed` / `set_eol_if_changed` are non-unsafe `fn` items; they call `unsafe` segment update helpers via inner `unsafe { ... }` blocks. Borrow checker is satisfied because the mutable borrow of `app` ends at the end of the `if let Some(tab) = app.active_mut()` arm; the segment update receives a fresh shared borrow. Verifier may want to inspect this shape to confirm soundness.

## Decisions Made

All Locked decisions D-1 through D-11 honored:
- D-1: WONTFIX-v1 P4-5 doc comment present on `update_row_col_segment`
- D-2: 1-based display via `format_row_col((line0+1) as u32, (col0+1) as u32)`
- D-3: Per-event cadence implemented (row:col on EN_CHANGE+EN_SELCHANGE; encoding/EOL on tab switch + menu; line count on EN_CHANGE; all-four on TCN_SELCHANGE / file open/save)
- D-4: `label_for_status` lives on the enums
- D-5: `update_all_segments` is the canonical batch entry point
- D-6: Selective per-segment updaters
- D-7: `format_row_col` is pure-logic in `src/status_bar.rs`
- D-8: No re-entrancy guard needed (status bar updates don't fire EN_CHANGE)
- D-9: src/editor.rs NOT mutated (verified via git diff)
- D-10: EN_SELCHANGE handled via WM_NOTIFY NMHDR.code, with active-tab guard
- D-11: tests/status_bar_labels.rs is pure-logic / no Win32 / 17+ tests (delivered 19)

## Deviations from Plan

See "Implementation Decisions / Deviations" above. Three minor adaptations to actual `windows-rs 0.62.2` + Phase 2 API surface (correct enum variant names + correct module paths). No semantic deviation from the plan.

## Issues Encountered

None.

## Next Phase Readiness

- **Wave 3 (Plan 04-04a):** No file overlap — per-language tokenizers can proceed independently.
- **Wave 4 (Plan 04-04b):** Status bar will reflect language-aware highlight events transparently — `update_all_segments` already fires on tab switch + open, both of which are when language changes most.

## Self-Check: PASSED

- `src/encoding.rs` has `DetectedEncoding::label_for_status` (verified — returns "ANSI" for Cp1252)
- `src/eol.rs` has `Eol::label_for_status` (verified — collapses Mixed variants)
- `src/status_bar.rs` has `format_row_col` + 5 unsafe segment-update helpers + WONTFIX-v1 P4-5 doc comment (verified)
- `tests/status_bar_labels.rs` exists with 19 tests, all passing (`cargo test --test status_bar_labels` → 19 passed)
- `src/editor.rs` NOT modified by this plan (verified `git diff src/editor.rs` empty)
- `cargo build --target x86_64-pc-windows-msvc` succeeds
- `cargo clippy --lib --bins -- -D warnings` passes
- `cargo test` shows 25 test suites, 0 failures
- 2 task commits present: `fe65401`, `21d272e` (verified via `git log --oneline | grep 04-03`)

---
*Phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting*
*Completed: 2026-05-03*
