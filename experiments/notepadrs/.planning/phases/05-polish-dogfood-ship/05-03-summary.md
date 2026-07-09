---
phase: 05-polish-dogfood-ship
plan: 03
subsystem: ui
tags: [drag-drop, wm_dropfiles, win32, shell, dragacceptfiles, multi-file]

requires:
  - phase: 05-polish-dogfood-ship
    provides: "Plan 05-02 open_path_external Recent Files push hook (transitively populates Recent Files for every dropped file)"
  - phase: 03-multi-tab-find-replace
    provides: "Plan 03-02 D-14 fresh-tab heuristic (mirrored in WM_DROPFILES first-drop path)"
  - phase: 01-foundations
    provides: "OleInitialize pairing in main.rs:68 (QUAL-04) — required substructure for DragAcceptFiles"
provides:
  - "WM_DROPFILES handler in src/dispatch.rs routing each path through open_path_external"
  - "DragAcceptFiles(hwnd, true) registration in WM_CREATE"
  - "src/dispatch_pure.rs utf16_to_pathbuf + is_droppable_file pure-logic helpers"
  - "tests/drag_drop_pure.rs: 9 pure-logic tests for path parsing + folder filter"
  - "First-drop fresh-tab heuristic + subsequent-drops push-new-tab pattern"
  - "Multi-file ordered drop, folder/missing-file silent ignore, no HDROP leak"
affects: [05-04 dogfood Step 9]

tech-stack:
  added: []
  patterns:
    - "WM_DROPFILES standard pattern: DragAcceptFiles in WM_CREATE → DragQueryFileW probe-then-fetch loop → DragFinish at end (always)"
    - "First-drop-vs-subsequent-drop sequencing: idx==0 uses fresh-tab heuristic; idx≥1 always pushes new tab. Avoids intermediate empty Untitled tabs (Pitfall 5)"
    - "Pure-logic + Win32 wrapper split for drag-drop: utf16_to_pathbuf + is_droppable_file in dispatch_pure.rs (testable); WM_DROPFILES match arm in dispatch.rs (Win32 shim)"

key-files:
  created:
    - "tests/drag_drop_pure.rs"
  modified:
    - "src/dispatch_pure.rs"
    - "src/dispatch.rs"

key-decisions:
  - "Plan 05-03 D-1: WM_DROPFILES (NOT IDropTarget). 10× less code; SC-10 only requires file paths"
  - "Plan 05-03 D-2: DragAcceptFiles(hwnd, true) called ONCE in WM_CREATE after status-bar setup; OleInitialize pre-existing from Phase 1"
  - "Plan 05-03 D-4: DragFinish(hdrop) is the last call in the WM_DROPFILES arm regardless of filter outcomes — no HDROP leak"
  - "Plan 05-03 D-5: first kept drop uses fresh-tab heuristic; subsequent kept drops always push new tabs. Avoids intermediate empty Untitled tabs (Pitfall 5)"
  - "Plan 05-03 D-6: folder + missing file drops silently ignored via path.is_file() filter (no error dialog)"
  - "Plan 05-03 D-7: dropped paths route through open_path_external — single source of truth shared with CLI-arg, do_file_open, and Plan 05-02 Recent click handler"
  - "O-1 chose: pure helpers in dispatch_pure.rs (extends existing module rather than create a new one)"
  - "O-3 chose: switch_active_tab is invoked for the LAST kept drop (the iteration order naturally leaves the user looking at the last-opened file)"

patterns-established:
  - "DragFinish always-on-exit-path: matches Phase 2's similar discipline for file-handle close"
  - "Fresh-tab-only-for-first-drop sequencing: generalizable to any future multi-item open path (e.g., session restore, multi-file CLI args)"

requirements-completed: [DND-01]
test-tiers: [unit]

duration: 18 min
completed: 2026-05-03
---

# Phase 05 Plan 03: Drag-and-Drop File Opening Summary

**WM_DROPFILES drag-drop wired end-to-end: dropping one or more files from File Explorer opens each in its own tab via the existing open_path_external choke-point, with first-drop fresh-tab heuristic, folder/missing-file silent ignore, and guaranteed DragFinish — transitively gains Recent Files entries via Plan 05-02 D-10**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-05-03T03:45Z
- **Completed:** 2026-05-03T04:03Z
- **Tasks:** 2 (combined into 1 atomic commit since Tasks 1+2 touch disjoint files in one logical unit)
- **Files modified:** 3 (1 created, 2 modified)

## Accomplishments

- **Pure-logic helpers** in `src/dispatch_pure.rs`:
  - `utf16_to_pathbuf(buf: &[u16]) -> Option<PathBuf>` — handles empty / null-only / no-trailing-null / embedded-null buffers
  - `is_droppable_file(path: &Path) -> bool` — thin wrapper over `path.is_file()` (D-6: drops both directories AND missing files)
- **WM_CREATE registration**: `DragAcceptFiles(hwnd, true)` called once after status-bar setup, before `LRESULT(0)` return.
- **WM_DROPFILES match arm** placed after WM_INITMENUPOPUP, before WM_COMMAND. Iterates `0..count` from `DragQueryFileW(hdrop, 0xFFFF_FFFF, None)`. For each path:
  - Probe length, fetch buffer, parse via `utf16_to_pathbuf`, filter via `is_droppable_file`
  - First kept drop: mirrors Plan 03-02 D-14 fresh-tab heuristic
  - Subsequent kept drops: always push new tab (Pitfall 5 mitigation)
  - Each routes through `open_path_external` → Recent Files transitively populated
- **`DragFinish(hdrop)` guaranteed** as the last call before LRESULT(0) regardless of how many drops were filtered out (D-4 — no HDROP leak).
- **`tests/drag_drop_pure.rs`** (9 tests): parse ASCII / Unicode / empty / null-only / no-trailing-null / embedded-null; filter rejects-directory / rejects-missing-file / accepts-existing-file.

## Task Commits

1. **Tasks 1+2 (combined): WM_DROPFILES handler + pure helpers + tests** — `fb76799` (feat: WM_DROPFILES drag-and-drop file opening (DND-01))

   Combined because both tasks touch closely-coupled code (dispatch_pure helpers consumed by dispatch.rs WM_DROPFILES arm) — splitting would have left the production code without test coverage between commits. Plan 05-03 has only 2 tasks total; combining them remains atomic-per-feature.

## Files Created/Modified

- `tests/drag_drop_pure.rs` (NEW) — 9 pure-logic tests
- `src/dispatch_pure.rs` — appended `utf16_to_pathbuf` + `is_droppable_file`
- `src/dispatch.rs` — `DragAcceptFiles` call in WM_CREATE; new WM_DROPFILES match arm

## Decisions Made

See `key-decisions` frontmatter. Notable execution detail:

- `windows-rs 0.62 DragAcceptFiles` takes a bare `bool` in the wrapper signature (`fn DragAcceptFiles(hwnd: HWND, faccept: bool)`), not a `BOOL` newtype. The wrapper internally converts to the underlying `windows_core::BOOL` via `.into()`. Initial draft used `BOOL(1)` and was corrected to `true`.

## Deviations from Plan

None - plan executed exactly as written. Combining Task 1 + Task 2 into one commit is in the spirit of "atomic per feature" (the plan describes 2 tasks but they form one indivisible feature unit; the commit message documents both).

## Issues Encountered

None.

## Next Phase Readiness

- DND-01 closed.
- Plan 05-04 dogfood Step 9 (drag-drop end-to-end) is unblocked.
- Wave 2 complete; Wave 3 (05-04 dogfood + 05-05 ship gate, parallel) can now proceed.

---
*Phase: 05-polish-dogfood-ship*
*Completed: 2026-05-03*
