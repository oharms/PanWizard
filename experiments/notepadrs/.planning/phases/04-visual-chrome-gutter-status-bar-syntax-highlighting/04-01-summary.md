---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 01
subsystem: ui
tags: [win32, gutter, status-bar, syntax-highlighting, richedit, winapi]

# Dependency graph
requires:
  - phase: 03-multi-tab-find-replace
    provides: Tab/App structs, per-tab RichEdit pattern, WM_SIZE layout, dispatch.rs message skeleton
provides:
  - Language/TokenClass/Token/LineEndState/PyTripleKind enums + lang_from_path + tokenize_line stub in src/syntax/mod.rs
  - Per-language stubs in src/syntax/{plain,json,markdown,javascript,python}.rs
  - Gutter window class registration (register_gutter_class -> u16 atom) in src/gutter.rs
  - Status bar creation + segment helpers (create_status_bar / set_segment / get_status_height) in src/status_bar.rs
  - Tab extended with 6 Phase 4 fields (gutter_hwnd/language/line_states/last_line_count/highlighting_in_progress/gutter_width)
  - App extended with 4 Phase 4 fields (hstatus/status_height/gutter_class_atom/line_height_px) + WM_APP_HIGHLIGHT_REQUEST const
  - WM_SIZE four-zone layout (tab strip / gutter / RichEdit / status bar) per tab
  - EM_SETEVENTMASK pre-allocated to ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE (full Phase-4 mask)
  - lang_from_path wired into do_file_open/open_path_external
  - 13 pure-logic tests in tests/phase04_data_shape.rs
affects: [04-02, 04-03, 04-04a, 04-04b, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pre-allocation pattern: all Phase 4 data fields, module files, and Win32 handles established in Wave 1 so Wave 2/3 plans don't collide on shared files (mirrors Plan 03-01)"
    - "MAKEINTATOM cast: gutter_atom (u16) cast to PCWSTR via `PCWSTR(gutter_atom as usize as *const u16)` for CreateWindowExW"
    - "EM_SETEVENTMASK pre-alloc: full Phase-4 mask set once in EditorState::create so 04-02 and 04-03 only add WM_NOTIFY handlers"
    - "WM_CREATE ordering: register_gutter_class → build_tab_strip → create_status_bar → push_empty_tab → line_height_px cache"
    - "Dead-code allow pattern: all un-wired items get #[allow(dead_code)] with // wired by Plan XX comment"

key-files:
  created:
    - src/syntax/mod.rs
    - src/syntax/plain.rs
    - src/syntax/json.rs
    - src/syntax/markdown.rs
    - src/syntax/javascript.rs
    - src/syntax/python.rs
    - src/gutter.rs
    - src/status_bar.rs
    - tests/phase04_data_shape.rs
    - .planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/deferred-items.md
  modified:
    - src/lib.rs
    - src/main.rs
    - src/tab.rs
    - src/app.rs
    - src/editor.rs
    - src/dispatch.rs

key-decisions:
  - "D-12 (lock-step mod declarations): gutter+status_bar module files created in same task as their lib.rs/main.rs declarations — build is green at end of each task"
  - "D-13 (EM_SETEVENTMASK pre-alloc): ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE set once in EditorState::create, eliminating 04-02/04-03 file-collision on editor.rs"
  - "D-6 (four-zone WM_SIZE): tab strip top, status bar bottom (forwarded WM_SIZE, height refreshed on each resize), gutter+RichEdit per-tab in middle"
  - "O-1 (App.gutter_class_atom field chosen over static AtomicU16): cleaner lifetime, matches existing App handle pattern"
  - "O-3 (gutter_width hardcoded 40px default): GUTTER_DEFAULT_WIDTH=40; Plan 04-02 makes it dynamic"
  - "O-4 (all 5 per-language stubs declared in syntax/mod.rs pub mod now): guarantees 04-04a only adds implementations, not pub mod lines"
  - "Deviation: Error::from_win32() does not exist in windows-result 0.4.1 — used Error::from_thread() instead (same intent, correct API)"

patterns-established:
  - "Syntax type system: Language/TokenClass/Token/LineEndState as Copy enums in src/syntax/mod.rs; per-language dispatch via match in tokenize_line"
  - "Gutter sibling pattern: gutter HWND is a sibling of RichEdit (NOT a child); GWLP_USERDATA holds sibling hwnd_re for 04-02 WM_PAINT"
  - "Status bar singleton pattern: App.hstatus, App.status_height cached at WM_CREATE, refreshed on WM_SIZE for DPI changes"
  - "Dead-code allow convention: #[allow(dead_code)] // wired by Plan 04-XX on every un-wired item"

requirements-completed: [SYNTAX-06]
test-tiers: [unit]

# Metrics
duration: 11min
completed: 2026-05-03
---

# Phase 4 Plan 01: Wave 1 Foundation Summary

**Per-tab gutter windows + singleton status bar + syntax type system (Language/Token/LineEndState) pre-allocated; EM_SETEVENTMASK pre-allocated to full Phase-4 mask; four-zone WM_SIZE layout; 13 pure tests passing**

## Performance

- **Duration:** 11 min
- **Started:** 2026-05-03T01:33:51Z
- **Completed:** 2026-05-03T01:45:18Z
- **Tasks:** 3
- **Files modified:** 15 (9 created, 6 modified)

## Accomplishments
- Created the full Phase 4 syntax type system (`Language`, `TokenClass`, `Token`, `LineEndState`, `lang_from_path`, `tokenize_line` dispatch stub) in `src/syntax/mod.rs` with 5 per-language stubs
- Registered gutter window class (`NotepadrsGutter`) and created `src/gutter.rs` + `src/status_bar.rs` with full helper APIs
- Extended `Tab` with 6 new Phase 4 fields (gutter_hwnd, language, line_states, last_line_count, highlighting_in_progress, gutter_width) and `App` with 4 new fields (hstatus, status_height, gutter_class_atom, line_height_px)
- Pre-allocated the full Phase-4 EM_SETEVENTMASK (`ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE`) in `EditorState::create` — eliminates 04-02/04-03 file-collision on `editor.rs`
- Refactored WM_SIZE to four-zone layout (tab strip / gutter / RichEdit / status bar) and WM_CREATE to register gutter class before push_empty_tab
- Shipped 13 pure-logic tests for `lang_from_path` matrix + struct defaults; all Phase 2+3 tests pass (no regressions)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/syntax/ module** - `abbb6d4` (feat)
2. **Task 2: Create gutter.rs + status_bar.rs; extend Tab** - `3974c9e` (feat)
3. **Task 3: Extend App + WM_CREATE/WM_SIZE + lang_from_path + EM_SETEVENTMASK + tests** - `ea284b5` (feat)

**Plan metadata:** (this commit) (docs: complete plan)

## Files Created/Modified

- `src/syntax/mod.rs` — Language (5 variants), TokenClass (11), Token struct, LineEndState (5 variants), lang_from_path, tokenize_line dispatch stub
- `src/syntax/plain.rs` — returns single Plain token for non-empty lines
- `src/syntax/{json,markdown,javascript,python}.rs` — stubs returning `(Vec::new(), prev)`
- `src/gutter.rs` — `register_gutter_class` (ATOM), stub `gutter_wnd_proc`, `GUTTER_CLASS_NAME`, `GUTTER_PADDING_PX`, `GUTTER_DEFAULT_WIDTH=40`
- `src/status_bar.rs` — `create_status_bar`, `set_segment`, `get_status_height`, `SEGMENT_PARTS=[140,250,320,-1]`
- `src/tab.rs` — Tab extended with 6 Phase 4 fields; `new_empty` gains `gutter_atom: u16` param; Drop destroys gutter before editor
- `src/app.rs` — App extended with 4 Phase 4 fields; `WM_APP_HIGHLIGHT_REQUEST = WM_USER+12`; `push_empty_tab` threads real atom
- `src/editor.rs` — EM_SETEVENTMASK changed from `ENM_CHANGE` to `ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE`
- `src/dispatch.rs` — WM_CREATE order: register_gutter_class → build_tab_strip → create_status_bar → push_empty_tab → line_height_px cache; WM_SIZE four-zone layout; lang_from_path wired into open_path_external
- `src/lib.rs` + `src/main.rs` — `pub mod syntax` (Task 1), `pub mod gutter; pub mod status_bar` (Task 2, same task as file creation per D-12)
- `tests/phase04_data_shape.rs` — 13 pure-logic tests

## Implementation Decisions

### Decisions Taken (Open decisions from plan)

- **O-1 (gutter atom storage):** Chose `App.gutter_class_atom: u16` field (cleaner lifetime, matches existing per-app handles like `haccel`). Not a `static AtomicU16`.
- **O-2 (register_gutter_class location):** Placed in `src/gutter.rs` per recommendation — keeps gutter ownership local.
- **O-3 (gutter_width default):** Hardcoded `GUTTER_DEFAULT_WIDTH = 40px` (not computed from em-width). Plan 04-02 makes it dynamic.
- **O-4 (per-language stub modules):** All 5 declared as `pub mod` lines in `src/syntax/mod.rs` NOW (not deferred). Each stub file exists and compiles. 04-04a only needs to add implementations.

### Deviations from Locked Decisions

**1. [Rule 1 - Bug] Error::from_win32() does not exist in windows-result 0.4.1**
- **Found during:** Task 2 (creating gutter.rs)
- **Issue:** Plan template used `Error::from_win32()` which does not exist in the windows-result 0.4.1 crate. The crate provides `Error::from_thread()`, `Error::from_hresult()`, `Error::empty()`, `Error::new()`.
- **Fix:** Used `Error::from_thread()` which reads `GetLastError()` from the current thread — equivalent intent, correct API.
- **Files modified:** `src/gutter.rs`
- **Committed in:** `3974c9e` (Task 2 commit)

**2. [Rule 2 - Missing Safety Doc] clippy::missing_safety_doc on gutter.rs + status_bar.rs**
- **Found during:** Task 2 clippy gate
- **Issue:** All four public `unsafe fn` items in the new modules lacked `# Safety` documentation sections, causing `clippy -D warnings` failure.
- **Fix:** Added `# Safety` doc comments to `register_gutter_class`, `create_status_bar`, `set_segment`, `get_status_height`.
- **Files modified:** `src/gutter.rs`, `src/status_bar.rs`
- **Committed in:** `3974c9e` (Task 2 commit)

**3. [Rule 1 - Bug] `SBARS_SIZEGRIP as u32` unnecessary cast**
- **Found during:** Task 2 clippy gate
- **Issue:** `SBARS_SIZEGRIP` is already `u32` — `as u32` cast triggered `clippy::unnecessary_cast`.
- **Fix:** Removed the cast: `WINDOW_STYLE(SBARS_SIZEGRIP)`.
- **Files modified:** `src/status_bar.rs`
- **Committed in:** `3974c9e` (Task 2 commit)

**4. [Rule 1 - Bug] GetTextMetricsW returns BOOL, not Result**
- **Found during:** Task 3 (WM_CREATE line_height_px capture)
- **Issue:** Plan template used `.is_ok()` on the return of `GetTextMetricsW`, but it returns `BOOL` not `windows::core::Result`.
- **Fix:** Changed to `.as_bool()`.
- **Files modified:** `src/dispatch.rs`
- **Committed in:** `ea284b5` (Task 3 commit)

**5. [Rule 1 - Bug] Borrow checker: cannot assign to app.line_height_px while app is borrowed via app.active()**
- **Found during:** Task 3 (WM_CREATE line_height_px capture)
- **Issue:** `if let Some(tab) = app.active() { ... app.line_height_px = ... }` — Rust borrow checker rejected the mutable assignment inside the immutable borrow from `app.active()`.
- **Fix:** Extracted `hwnd_re` with `app.active().map(|t| t.editor.hwnd_re)` to end the borrow before the mutable write.
- **Files modified:** `src/dispatch.rs`
- **Committed in:** `ea284b5` (Task 3 commit)

---

**Total deviations:** 5 auto-fixed (3 Rule 1 bugs, 1 Rule 2 missing safety doc, 1 Rule 1 wrong API name from plan template)
**Impact on plan:** All auto-fixes necessary for correctness and clippy compliance. No scope creep.

### Open Questions for Verifier

- **Line height capture timing:** The line_height_px cache in WM_CREATE fires AFTER `push_empty_tab` (so HFONT exists), but WM_GETFONT returns 0 if the font message hasn't been processed yet on this thread. The fallback (16px) is used in that case. Verifier should confirm `app.line_height_px` ends up non-zero at runtime (observable via debugger or oslog) — though this is cosmetic for Phase 4; 04-02 uses it for gutter row arithmetic.
- **`is_invalid()` on `HWND`:** The code uses `app.hstatus.0.is_null()` rather than `app.hstatus.is_invalid()` in WM_SIZE because `HWND::is_invalid()` checks for INVALID_HANDLE_VALUE (-1), not NULL. Both are correct null guards but be aware: a default-init'd HWND has a null pointer, not -1.

## Issues Encountered

- Pre-existing clippy lint failures in `tests/roundtrip_matrix.rs` and `tests/undo_property.rs` (collapsible_str_replace and ungrouped hex literals). These predate Phase 4 and are NOT caused by any 04-01 change. `cargo clippy --lib --bins -D warnings` passes cleanly; `--tests` fails on these two pre-existing files. Documented in `deferred-items.md`.

## Next Phase Readiness

- **04-02 (gutter painting):** `gutter_hwnd` exists on each `Tab`; `gutter_wnd_proc` stub is in `gutter.rs` ready to be replaced with WM_PAINT implementation; `ENM_SCROLL` already enables EN_VSCROLL notifications; `GUTTER_DEFAULT_WIDTH=40` in place.
- **04-03 (status bar wiring):** `hstatus` on App; `set_segment` helper ready; `ENM_SELCHANGE` already enables EN_SELCHANGE notifications; SEGMENT_PARTS defined.
- **04-04a (tokenizers):** `Language`/`LineEndState` types defined; per-language stubs exist; `tokenize_line` dispatch compiled and ready to receive real implementations.
- **04-04b (highlight dispatch):** `WM_APP_HIGHLIGHT_REQUEST = WM_USER+12` allocated; `highlighting_in_progress: Cell<bool>` and `line_states: Vec<LineEndState>` pre-allocated on Tab.
- **04-05 (tokenizer tests):** All type contracts published and stable.

No blockers for Wave 2 plans. Both 04-02 and 04-03 can proceed truly in parallel since neither needs to touch `editor.rs` (EM_SETEVENTMASK pre-allocated here per D-13).

---
*Phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting*
*Completed: 2026-05-03*
