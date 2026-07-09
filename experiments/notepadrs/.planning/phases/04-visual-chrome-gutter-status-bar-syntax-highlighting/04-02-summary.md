---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 02
subsystem: ui
tags: [win32, gutter, richedit, scroll-lockstep, em_getfirstvisibleline, drawtextw]

# Dependency graph
requires:
  - phase: 04-01
    provides: Tab.gutter_hwnd field, gutter class registered, GUTTER_DEFAULT_WIDTH/PADDING_PX constants, EM_SETEVENTMASK = ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE pre-allocated
provides:
  - Full WM_PAINT impl in src/gutter.rs — right-aligned 1-indexed line numbers in editor's monospace font, lockstep with EM_GETFIRSTVISIBLELINE
  - gutter_width_for_line_count(n, em_width_px) pure helper for digit-boundary math
  - GUTTER_TEXT_COLOR = 0x808080 (50% grey)
  - App.em_width_px field cached at WM_CREATE from tmAveCharWidth
  - WM_NOTIFY EN_VSCROLL handler invalidating matching tab's gutter
  - EN_CHANGE recomputes gutter width on digit-boundary crossing + reposts WM_SIZE
  - TCN_SELCHANGE / switch_active_tab swap gutter visibility alongside RichEdit
  - 15 pure-logic tests in tests/gutter_layout.rs
affects: [04-04b, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sibling gutter WM_PAINT recovers RichEdit HWND via GetWindowLongPtrW(GWLP_USERDATA) — gutter is self-contained, no App-pointer plumbing into class WndProc"
    - "Lockstep scroll via EN_VSCROLL — Plan 04-01 D-13 pre-allocated ENM_SCROLL in EM_SETEVENTMASK; this plan only registers the WM_NOTIFY handler (no editor.rs mutation)"
    - "Capture-before-mut-borrow: read app.em_width_px (Copy i32) BEFORE app.active_mut() to avoid borrow checker conflict"
    - "Force WM_SIZE relayout by SendMessageW(hwnd, WM_SIZE, 0, packed_client_size) — re-runs the four-zone WM_SIZE arm uniformly"
    - "Digit-boundary recompute: only relayout when gutter_width changes (avoids per-keystroke MoveWindow cost)"

key-files:
  created:
    - tests/gutter_layout.rs
  modified:
    - src/gutter.rs
    - src/app.rs
    - src/dispatch.rs

key-decisions:
  - "D-1 (sibling RichEdit lookup via GWLP_USERDATA): gutter WndProc is self-contained, no App pointer plumbing"
  - "D-4 (EN_VSCROLL via pre-allocated ENM_SCROLL): no editor.rs mutation — Blocker #2 fix preserved"
  - "D-5 (digit-boundary recompute on EN_CHANGE): only relayout when crossing 10/100/1000/10000"
  - "D-7 / O-1 (App.em_width_px field): added to App, default 8, refreshed at WM_CREATE from tm.tmAveCharWidth"
  - "D-9 (gutter visibility swap inside switch_active_tab): mirrors RichEdit visibility + InvalidateRect on incoming gutter to avoid stale paint"
  - "D-11 (editor.rs NOT modified): Plan 04-01's pre-allocated mask makes this a non-mutation here"

patterns-established:
  - "Pure-logic gutter_width_for_line_count helper enables headless boundary tests (15 cases)"
  - "EN_VSCROLL → InvalidateRect(gutter) is the canonical scroll-lockstep idiom for sibling gutters in RichEdit"

requirements-completed: [VIEW-01]
test-tiers: [unit]

# Metrics
duration: ~12 min
completed: 2026-05-03
---

# Phase 4 Plan 02: Gutter Painting + Scroll Lockstep Summary

**Per-tab line-number gutter renders right-aligned numbers in the editor's monospace font, scrolls in lockstep with RichEdit via EN_VSCROLL, grows width on digit boundaries, and swaps visibility on tab switch — no editor.rs mutation (Plan 04-01's pre-allocated EM_SETEVENTMASK does the work).**

## Performance

- **Duration:** ~12 min (2 task commits + auto-approved checkpoint)
- **Tasks:** 3 (Task 3 = human-verify checkpoint, auto-approved under --auto mode)
- **Files created:** 1 (tests/gutter_layout.rs)
- **Files modified:** 3 (src/gutter.rs, src/app.rs, src/dispatch.rs)
- **Tests added:** 15 (all passing in tests/gutter_layout.rs)

## Accomplishments

- Full `gutter_wnd_proc` WM_PAINT implementation: BeginPaint/EndPaint, GWLP_USERDATA recovery of sibling RichEdit, font selection via WM_GETFONT, EM_GETFIRSTVISIBLELINE + EM_GETLINECOUNT for lockstep, DrawTextW with `DT_RIGHT | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX`
- `gutter_width_for_line_count(n: u32, em_width_px: i32) -> i32` pure helper — saturates at 7 digits for files >= 1M lines
- `GUTTER_TEXT_COLOR = COLORREF(0x808080)` (50% grey) constant
- `App.em_width_px: i32` field added; refreshed in WM_CREATE alongside `line_height_px` from `tm.tmAveCharWidth`
- `WM_NOTIFY` handler: detects `EN_VSCROLL` (1538) on any tab's RichEdit and invalidates that tab's gutter — fires natively because Plan 04-01 D-13 already enabled `ENM_SCROLL` in the EM_SETEVENTMASK
- `WM_COMMAND` EN_CHANGE branch (existing 03-02 dirty-flag logic): added gutter-width recompute via `gutter_width_for_line_count` + force-relayout via SendMessageW(WM_SIZE) when crossing a digit boundary
- `switch_active_tab`: swaps gutter visibility (`SW_HIDE`/`SW_SHOW`) alongside RichEdit visibility, then `InvalidateRect` on the incoming gutter to clear any stale paint
- 15 pure-logic tests covering every digit-count boundary (0/1/9/10/99/100/999/1000/9999/10000/100000/1M+), em-width linear scaling, padding correctness, monotonic progression
- `src/editor.rs` is NOT modified by this plan — D-11 / Blocker #2 fix preserved

## Task Commits

1. **Task 1: Gutter WM_PAINT + width helper + 15 tests** — `172ebd8` (feat)
2. **Task 2: Wire scroll lockstep + dynamic width + tab visibility** — `3f10972` (feat)
3. **Task 3 (checkpoint:human-verify):** auto-approved under `--auto` mode + `workflow.auto_advance=true`

## Files Created/Modified

- `src/gutter.rs` — gutter_wnd_proc gains WM_PAINT impl; `gutter_width_for_line_count` pure helper; `GUTTER_TEXT_COLOR` constant
- `src/app.rs` — App gains `em_width_px: i32` field, default 8 in App::new
- `src/dispatch.rs` — WM_CREATE captures em_width_px from tmAveCharWidth; WM_NOTIFY handles EN_VSCROLL → InvalidateRect(matching tab's gutter); WM_COMMAND EN_CHANGE recomputes gutter width on digit boundary + reposts WM_SIZE; switch_active_tab swaps gutter visibility
- `tests/gutter_layout.rs` — 15 pure-logic tests for `gutter_width_for_line_count`

## Implementation Decisions

### Taken (within plan's discretion)

- DT-1: For O-1 (em_width_px placement), added as a new `App` field in this plan rather than back-porting to Plan 04-01. Default 8 in App::new, refreshed at WM_CREATE from `tm.tmAveCharWidth`. Public visibility for use from `dispatch.rs`/`gutter.rs`.
- DT-2: For O-2 (gutter click-to-select-line), DEFERRED to v1.x as recommended.
- DT-3: For O-3 (color constant placement), used module-level `pub const GUTTER_TEXT_COLOR: COLORREF = COLORREF(0x808080)` in `src/gutter.rs` (reuse-friendly + grep-friendly when v1.x adds a theme).

### Deviations (from plan; must explain)

**1. [Rule 3 - Blocking] EM_GETFIRSTVISIBLELINE / EM_GETLINECOUNT live in `windows::Win32::UI::Controls`, not `Controls::RichEdit`**
- Found during: Task 1 build
- Issue: Plan template imported these from `Controls::RichEdit`, but in `windows-rs 0.62.2` they're EDIT messages defined at `windows::Win32::UI::Controls` (parent module).
- Fix: Changed import path to `use windows::Win32::UI::Controls::{EM_GETFIRSTVISIBLELINE, EM_GETLINECOUNT};`
- Verification: `cargo build` succeeds; tests pass.

**2. [Rule 1 - Bug] `tm.tmAveCharWidth` is already `i32`, no cast needed**
- Found during: Task 2 clippy gate
- Issue: Plan suggested `(tm.tmAveCharWidth as i32).max(1)`. Clippy flagged `unnecessary_cast` because `tmAveCharWidth` is already `i32` in `windows-rs 0.62.2` (the plan note "i16 in TEXTMETRICW" is outdated — it varies between TEXTMETRICA and TEXTMETRICW).
- Fix: Dropped the cast: `app.em_width_px = tm.tmAveCharWidth.max(1);`
- Verification: `cargo clippy --lib --bins -- -D warnings` clean.

### Open questions for verifier

- Q-1: The EN_VSCROLL handler in `WM_NOTIFY` is positioned BEFORE the `nm.hwndFrom == app.htabs && nm.code == TCN_SELCHANGE` check. EN_VSCROLL's `nm.hwndFrom` is the RichEdit, not the tab strip — so the order is logically correct. The handler returns LRESULT(0) on match, preventing fall-through. Verifier may want to confirm no future control's notification code conflicts with EN_VSCROLL (1538 = 0x602).
- Q-2: The dynamic gutter width recompute on EN_CHANGE only triggers a relayout when `new_width != tab.gutter_width`. The first time a buffer crosses 10 lines (→ width 56) from the default 40, this triggers correctly. The `tab.last_line_count = n` is updated in BOTH branches so it stays current.

## Decisions Made

All Locked decisions D-1 through D-11 honored:
- D-1: GWLP_USERDATA round-trip for sibling RichEdit lookup
- D-2: WM_GETFONT + SelectObject for monospace alignment
- D-3: DrawTextW with DT_RIGHT|DT_VCENTER|DT_SINGLELINE|DT_NOPREFIX
- D-4: EN_VSCROLL handler in WM_NOTIFY (no editor.rs mutation)
- D-5: Digit-boundary recompute on EN_CHANGE
- D-6: gutter_width_for_line_count pure helper as test surface
- D-7: App.em_width_px refreshed at WM_CREATE from tm.tmAveCharWidth
- D-8: GUTTER_TEXT_COLOR = 0x808080
- D-9: Gutter visibility swap in switch_active_tab + InvalidateRect on incoming
- D-10: tests/gutter_layout.rs is pure-logic / no Win32 / 12+ test cases (delivered 15)
- D-11: src/editor.rs NOT mutated (verified via git diff)

## Deviations from Plan

See "Implementation Decisions / Deviations" above. Both deviations are minor adaptations to the actual `windows-rs 0.62.2` API surface (correct module paths and types) — no semantic deviation from the plan.

## Issues Encountered

None.

## Next Phase Readiness

- **Wave 3 (Plan 04-04a):** Per-language tokenizers can proceed — type contracts in `src/syntax/mod.rs` are stable, no new constraints from this plan.
- **Wave 2 sibling (Plan 04-03):** Status bar segment wiring runs in parallel — neither needs to share files with this plan (different parts of dispatch.rs, neither touches editor.rs).
- **Wave 4 (Plan 04-04b):** Highlight pipeline can rely on `ENM_SCROLL` being enabled (also pre-allocated by 04-01) and on the established sibling-window scroll-lockstep pattern.

## Self-Check: PASSED

- `src/gutter.rs` has full WM_PAINT impl: verified BeginPaint/EndPaint/GetWindowLongPtrW/EM_GETFIRSTVISIBLELINE/EM_GETLINECOUNT/DrawTextW all present
- `gutter_width_for_line_count` exported as `pub fn` and consumed by `tests/gutter_layout.rs`
- `tests/gutter_layout.rs` exists with 15 tests, all passing (`cargo test --test gutter_layout` → 15 passed)
- `src/editor.rs` NOT modified by this plan (verified `git diff src/editor.rs` empty)
- `cargo build --target x86_64-pc-windows-msvc` succeeds
- `cargo clippy --lib --bins -- -D warnings` passes
- `cargo test` shows all suites green: phase04_data_shape (13), gutter_layout (15), tab_model (18), find_engine (31), roundtrip_matrix (14), undo_property (6), and the rest of the Phase 2/3 suites
- 2 task commits present: `172ebd8`, `3f10972` (verified via `git log --oneline | grep 04-02`)

---
*Phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting*
*Completed: 2026-05-03*
