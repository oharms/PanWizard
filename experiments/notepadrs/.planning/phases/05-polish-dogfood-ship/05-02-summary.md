---
phase: 05-polish-dogfood-ship
plan: 02
subsystem: ui
tags: [recent-files, mru, lru, serde, serde_json, win32, shell, persistence, atomic-write]

requires:
  - phase: 02-file-i-o-encoding-cascade
    provides: "file::save_atomic atomic-write template (mirrored in recent::save_to_path)"
  - phase: 03-multi-tab-find-replace
    provides: "open_path_external choke-point + fresh-tab heuristic (Plan 03-02 D-14, mirrored for IDM_RECENT click handler)"
provides:
  - "src/recent.rs: pure-logic LRU + serde + atomic write + Win32 SHGetKnownFolderPath wrapper"
  - "tests/recent_files.rs: 12 TEST-06 tests covering RECENT-01..04"
  - "Cargo.toml: serde 1.0 (derive) + serde_json 1.0 deps (allowlist-compliant)"
  - "App.recent + App.recent_hmenu fields"
  - "IDM_RECENT_BASE=200 / IDM_RECENT_MAX=209 (Phase 5 IDM range)"
  - "File → Recent Files submenu with dynamic WM_INITMENUPOPUP rebuild"
  - "open_path_external push hook — single source of truth for 'successful path open'"
  - "Stale-entry self-pruning on click"
affects: [05-03 drag-drop (transitively gets Recent Files via open_path_external), 05-04 dogfood Step 8]

tech-stack:
  added: ["serde 1.0", "serde_json 1.0"]
  patterns:
    - "AppData persistence: SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_CREATE) → JSON via serde_json::to_string_pretty/from_str → atomic tmp+rename"
    - "Pure-logic + Win32 wrapper split: save_to_path/load_from_path (test-friendly) wrapped by save/load (resolve AppData then delegate). Mirrors Phase 2 dispatch_pure.rs."
    - "WM_INITMENUPOPUP-rebuild for dynamic submenus: clear via DeleteMenu(MF_BYPOSITION) loop, then re-populate from in-memory state. No menu surgery on MRU push."
    - "Static IDM range (200-209) for dynamic submenu items: idx = cmd - IDM_RECENT_BASE"
    - "Hardening: sanitize-on-load drops oversized entries (RECENT_PATH_MAX_LEN=32_768) and truncates oversized lists"
    - "build_main_menu returns (HMENU, HMENU) so dynamic submenus can be referenced from elsewhere without re-walking the menu tree"

key-files:
  created:
    - "src/recent.rs"
    - "tests/recent_files.rs"
  modified:
    - "Cargo.toml"
    - "Cargo.lock"
    - "src/lib.rs"
    - "src/main.rs"
    - "src/app.rs"
    - "src/menu.rs"
    - "src/dispatch.rs"

key-decisions:
  - "Plan 05-02 D-1: SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_CREATE) — NOT %APPDATA% env var (handles elevation/impersonation; auto-creates folder)"
  - "Plan 05-02 D-3: paths stored as String not PathBuf (PathBuf serde is platform-quirky on non-UTF-8; reject at boundary)"
  - "Plan 05-02 D-6: case-insensitive ASCII dedupe (eq_ignore_ascii_case) — Windows paths case-insensitive but display preserves user casing"
  - "Plan 05-02 D-8: rebuild-on-popup pattern (DeleteMenu loop + AppendMenuW) — simpler reasoning than incremental MFC/Notepad++ canonical pattern"
  - "Plan 05-02 D-10: persistence trigger only on push_lru success in open_path_external — single source of truth, drag-drop (05-03) and CLI-arg open transitively benefit"
  - "Plan 05-02 D-13: sanitize-on-load mandatory — drops oversized entries and truncates to RECENT_MAX (Pitfall 10 hardening)"
  - "O-1 chose: '&N <truncated_path>' label format with middle-ellipsis truncation (matches Notepad++/VS Code)"
  - "O-2 chose: load in main.rs run_app (after SetMenu, before ShowWindow) — keeps Win32 path-lookup out of App::new"
  - "O-3 chose: filter folder paths via path.is_file() in click handler; stale entries auto-pruned on click + log line"

patterns-established:
  - "Pure-logic core, Win32 wrapper boundary: save_to_path / load_from_path are test-friendly; save / load do the AppData resolution + delegate"
  - "WM_INITMENUPOPUP dynamic submenu rebuild — generalizable beyond Recent Files (e.g. macros, themes, recent searches in v2)"

requirements-completed: [RECENT-01, RECENT-02, RECENT-03, RECENT-04, TEST-06]
test-tiers: [unit]

duration: 30 min
completed: 2026-05-03
---

# Phase 05 Plan 02: Recent Files Menu + Persistence Summary

**Recent Files MRU (cap 10) persisted to %APPDATA%/notepadrs/recent.json via serde_json + atomic tmp+rename, with WM_INITMENUPOPUP-rebuild submenu and 12 pure-logic tests covering RECENT-01..04 hardening (sanitize-on-load, stale-entry self-prune)**

## Performance

- **Duration:** ~30 min
- **Started:** 2026-05-03T03:15Z
- **Completed:** 2026-05-03T03:45Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 modified — Cargo.toml + Cargo.lock + 4 src files + main.rs)

## Accomplishments

- **`src/recent.rs`** (~110 LOC): `RecentFiles { paths: Vec<String> }` with `push_lru` (case-insensitive dedupe + insert(0) + truncate(10)), `sanitize` (drop oversized + cap), `save_to_path` / `load_from_path` (pure-logic, test-friendly), `save` / `load` (Win32 wrappers using `SHGetKnownFolderPath(FOLDERID_RoamingAppData, KF_FLAG_CREATE)`), and `recent_path` (resolves `%APPDATA%/notepadrs/recent.json` and creates the folder).
- **`tests/recent_files.rs`** (12 tests): push_lru insert/dedupe/move-to-front/cap, sanitize drop-oversized + truncate, roundtrip, missing-file fallback, malformed-JSON fallback, no-tmp-leak, sanitize-on-disk-truncates-to-RECENT_MAX, empty-serializes-minimal-JSON.
- **Cargo.toml**: `serde = { version = "1.0", features = ["derive"] }` + `serde_json = "1.0"` (allowlist-compliant per stack.md).
- **App fields**: `recent: RecentFiles` + `recent_hmenu: HMENU`; sentinel-init in `App::new`, populated in `run_app` before `ShowWindow`.
- **IDM range**: `IDM_RECENT_BASE = 200`, `IDM_RECENT_MAX = 209` (10 slots, Phase 5 range).
- **menu.rs `build_main_menu`** now returns `(menubar_hmenu, recent_submenu_hmenu)`. File menu inserts `&Recent Files` submenu between Save As and Exit. New `rebuild_recent_submenu` helper clears via DeleteMenu(MF_BYPOSITION) loop, re-populates from `&recent.paths` with `&N <middle-ellipsized-path>` labels (idx 1-9 then 0).
- **dispatch.rs**:
  - `open_path_external` push hook: after successful load, calls `app.recent.push_lru(path)` and `crate::recent::save(&app.recent)` (D-10 single source of truth — non-UTF-8 paths skipped at boundary).
  - `WM_INITMENUPOPUP`: extends the encoding/EOL/word-wrap sync with `rebuild_recent_submenu(app.recent_hmenu, &app.recent)` (gated on `!recent_hmenu.is_invalid()`).
  - `WM_COMMAND` new match arm `c if (IDM_RECENT_BASE..=IDM_RECENT_MAX).contains(&c)`: looks up path by `idx = c - IDM_RECENT_BASE`. If `path.is_file()`: mirrors Plan 03-02 D-14 fresh-tab heuristic (load-in-active-fresh else push-new-tab-and-switch), then `open_path_external`. If stale: prunes entry from `app.recent.paths`, persists, oslog-warns.

## Task Commits

1. **Task 1: pure-logic backend + TEST-06 (12 tests)** — `345c46e` (feat: add Recent Files MRU + serde persistence)
2. **Task 2: App.recent + IDM range + startup load + push hook** — `7a8304e` (feat: wire App.recent + open_path push hook)
3. **Task 3: File submenu + WM_INITMENUPOPUP rebuild + click handler** — `fd3e99e` (feat: wire File → Recent Files submenu)

## Files Created/Modified

- `src/recent.rs` (NEW) — pure-logic LRU + serde + Win32 wrapper
- `tests/recent_files.rs` (NEW) — 12 TEST-06 tests
- `Cargo.toml` — serde + serde_json deps
- `Cargo.lock` — locked versions
- `src/lib.rs` — `pub mod recent;`
- `src/main.rs` — `mod recent;` + destructure (hmenu, recent_hmenu) from build_main_menu + load() at startup
- `src/app.rs` — `recent: RecentFiles` + `recent_hmenu: HMENU` fields + IDM_RECENT_BASE/MAX constants
- `src/menu.rs` — `(HMENU, HMENU)` return type + Recent Files submenu + `rebuild_recent_submenu` + `truncate_for_menu`
- `src/dispatch.rs` — open_path_external push hook + WM_INITMENUPOPUP rebuild call + IDM_RECENT click handler with stale-entry self-prune

## Decisions Made

See `key-decisions` frontmatter. Notable:
- **Borrow discipline in IDM_RECENT click handler**: `let path_opt = app.recent.paths.get(idx).cloned()` BEFORE any `&mut app` borrow, then sequence: push_empty_tab → insert_tab_item → switch_active_tab → open_path_external. Mirrors Plan 03-02's borrow-decoupling pattern.

## Deviations from Plan

None - plan executed exactly as written. Minor adjustments:

- `GetMenuItemCount(recent_menu)` required `Some(recent_menu)` wrapper in windows-rs 0.62 (the function takes `Option<HMENU>`). One-line fix during build.
- Cargo.lock was regenerated (expected when adding deps).

## Issues Encountered

None. Smoke check via `cargo build --release` produced a clean build, full `cargo test` ran with no regressions. The recent.json file is created on the first successful open via `open_path_external` — verified pathway statically (D-10 single-source-of-truth chain).

## Next Phase Readiness

- RECENT-01..04 + TEST-06 closed.
- Plan 05-03 (drag-drop) can proceed in Wave 2: WM_DROPFILES handler will route through `open_path_external`, which already pushes to Recent Files thanks to D-10. No additional wiring needed in 05-03 to satisfy the "drag-drop populates Recent Files" must-have.
- Plan 05-04 dogfood checklist Step 8 (Recent Files persistence end-to-end) is unblocked.

---
*Phase: 05-polish-dogfood-ship*
*Completed: 2026-05-03*
