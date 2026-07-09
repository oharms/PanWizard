# Phase 5: Polish + Dogfood + Ship — Research

**Researched:** 2026-05-03
**Domain:** Win32 RichEdit word-wrap toggle; AppData JSON persistence with serde/atomic write; WM_DROPFILES drag-drop integration; ship/dogfood verification gates
**Confidence:** HIGH on persistence + drag-drop + ship gate; MEDIUM on RichEdit word-wrap polarity (community-attested but undocumented; needs Wave-0 spike)

> Cross-references project-level research:
> - `.planning/research/architecture.md` — system structure (RichEdit child per tab, GWLP_USERDATA pattern)
> - `.planning/research/stack.md` — `windows` 0.62, `serde` 1.0, `serde_json` 1.0, `WM_DROPFILES` over `IDropTarget` decision (lines 230-249)
> - `.planning/research/pitfalls.md` — Pitfall 7 (OLE init), Pitfall 10 (recent-files corruption), Pitfall 13 (Notepad++ UX), Pitfall 19 (word-wrap row math)
> - `.planning/research/features.md` — SC-8 / SC-9 / SC-10 behavior expectations

This file emits ONLY phase-specific deltas: file-level integration points, the word-wrap polarity gotcha, recent-files JSON shape, drag-drop wiring details, and the ship-gate plan breakdown. The broad territory (which crates, which APIs, which patterns) is already locked in stack.md and architecture.md.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VIEW-06 | User can toggle word wrap (View → Word Wrap), persisted per tab | Pattern: `EM_SETTARGETDEVICE(NULL, 0/1)` per RichEdit; `Tab.word_wrap` field already pre-allocated in tab.rs:42; menu IDM range 140-149 reserved by this phase |
| VIEW-07 | Word wrap is off by default; horizontal scrollbar appears when wrap is off and content overflows | Combine WS_HSCROLL + ES_AUTOHSCROLL style for wrap-off; SetWindowLongPtrW + SetWindowPos(SWP_FRAMECHANGED) refresh; reapply on tab create (per-tab default `false` already in tab.rs:116) |
| RECENT-01 | File → Recent Files lists last 10 opened paths | LRU `Vec<PathBuf>` cap 10; menu rebuilt on WM_INITMENUPOPUP; click dispatches via dynamic IDM range (proposed 200-209) |
| RECENT-02 | Clicking a recent path reopens (in new tab if not already open) | Existing `dispatch::open_path_external(hwnd, path)` is the natural hook; reuse `do_file_open`'s active-fresh-tab heuristic |
| RECENT-03 | Recent paths persist to `%APPDATA%/notepadrs/recent.json` and survive restart | `SHGetKnownFolderPath(FOLDERID_RoamingAppData)` → `notepadrs/recent.json`; serde_json + atomic write (write `.tmp`, `fs::rename`); load at startup, save on push/order-change |
| RECENT-04 | Corrupt or missing recent.json does not crash; graceful fallback to empty | `Result::unwrap_or_default()` discipline; `Pitfall 10` mitigations: catch deserialize errors, validate (≤10 entries, path len ≤32K), discard and start empty |
| DND-01 | Dropping a file onto window opens it in new tab; multi-file drops open multiple tabs | `DragAcceptFiles(hwnd, TRUE)` in WM_CREATE after OleInitialize (already in main.rs:68); `WM_DROPFILES` handler iterates `DragQueryFileW`; each path → `open_path_external` |
| TEST-06 | Recent-files persistence tests (round-trip + corrupt fallback) | Pure-logic helpers in `recent.rs`: `serialize/deserialize/push_lru`; tests cover write→read identity, missing file, malformed JSON, oversized entry rejection, capacity cap |
</phase_requirements>

## Summary

Phase 5 closes three small features (word wrap, recent files, drag-drop), runs the dogfood marker (open `Cargo.toml`, edit, save, `cargo build` still passes), and verifies the v1.0.0 release gate (`cargo build --release` <10MB single .exe; `cargo test` ≥30 passing). All three features are on the standard Win32 + Rust shelf with well-known patterns; the integration risk is low because the per-tab data shape (`Tab.word_wrap`) and the open pipeline (`open_path_external`) were already pre-allocated in earlier phases.

The single non-obvious item is the **word-wrap toggle polarity** — `EM_SETTARGETDEVICE` is documented for WYSIWYG/printer line widths, not word wrap, and the wrap-toggle use is a community-attested "undocumented but works since RichEdit 1.0" idiom. Sources disagree on whether `lParam=1` enables or disables wrap. **A Wave-0 spike (one task, ~10 minutes) must lock the polarity before plans land.**

Everything else is mechanical: 1.4MB current binary easily clears the 10MB ceiling; current test suite is already at 315+ passing, so TEST-06 is the gating addition (not a count problem). The dogfood marker is operational verification, not new code.

**Primary recommendation:** Five plans in three waves — Wave 0 spike + Wave 1 (word-wrap + recent-files in parallel) + Wave 2 (drag-drop) + Wave 3 (dogfood + ship gate). Five plans because each feature is small enough to ship cleanly in its own plan, and splitting dogfood from ship gate keeps verification artifacts traceable.

## Standard Stack

### Core (already in Cargo.toml — see stack.md)

| Library | Version | Purpose | Phase 5 Use |
|---------|---------|---------|-------------|
| `windows` | 0.62 | Win32 bindings | `EM_SETTARGETDEVICE`, `WM_DROPFILES`, `DragAcceptFiles`, `DragQueryFileW`, `DragFinish`, `SHGetKnownFolderPath`, `FOLDERID_RoamingAppData` |
| `serde` | 1.0 (NEW for Phase 5 — derive feature only) | Derive Serialize/Deserialize for `RecentFiles` | `#[derive(Serialize, Deserialize)]` on the struct |
| `serde_json` | 1.0 (NEW for Phase 5) | JSON encode/decode of `recent.json` | `to_string_pretty` / `from_str` |

### Required Cargo.toml additions

```toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
```

These are explicitly on the idea.md / stack.md allowlist (line 36-37 of stack.md). No new crates beyond the original allowlist; no new `windows` features beyond what's already listed in Cargo.toml (`Win32_UI_Shell` for SHGetKnownFolderPath + DragAcceptFiles is already enabled).

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| `WM_DROPFILES` | `RegisterDragDrop` + `IDropTarget` | Full OLE drag-drop (text drops, custom data formats, drop-effect feedback) but ~150 LOC of COM vtables vs ~10 lines of WM_DROPFILES | **Use WM_DROPFILES** per stack.md decision (lines 230-249) — SC-10 only requires file paths; OleInitialize is already paired with OleUninitialize in main.rs |
| `EM_SETTARGETDEVICE` for wrap toggle | Toggle WS_HSCROLL + ES_AUTOHSCROLL via `SetWindowLongPtrW` + `SetWindowPos(SWP_FRAMECHANGED)` alone | Style-only toggle is documented; EM_SETTARGETDEVICE polarity is undocumented | **Combine both**: change styles AND send EM_SETTARGETDEVICE — community recipe (matches what AutoHotkey RichEdit lib does) |
| `serde_json` write directly | `bincode` or hand-rolled format | JSON is human-debuggable, recent.json content is trivial; serde_json is already justified for the ~50KB it adds | **JSON** — debuggability wins for non-perf-critical persistence |
| `SHGetKnownFolderPath` | Read `%APPDATA%` env var | env var works on every modern Windows but SHGetKnownFolderPath is the supported API and works under Run-As / impersonation | **Use SHGetKnownFolderPath** with FOLDERID_RoamingAppData |

## Architecture Patterns

### File Layout (additions only)

```
src/
├── recent.rs           # NEW — Plan 05-02: LRU + serde + atomic write
├── word_wrap.rs        # NEW — Plan 05-01: pure-logic apply_wrap_for_tab + Win32 wrapper
├── dispatch.rs         # +WM_DROPFILES handler (Plan 05-03), +IDM_RECENT_* dispatch (Plan 05-02), +IDM_VIEW_WORDWRAP (Plan 05-01)
├── menu.rs             # +View menu, +File→Recent Files submenu, +WM_INITMENUPOPUP recent rebuild
├── app.rs              # +recent: RecentFiles field, +pre-alloc IDM range 140-149 (View) and 200-209 (Recent slots)
├── tab.rs              # word_wrap field already exists (line 42); add helpers if needed
├── main.rs             # +DragAcceptFiles(hwnd, TRUE) once after window create
tests/
├── recent_files.rs     # NEW — TEST-06 coverage (round-trip, corrupt fallback, capacity cap)
├── word_wrap.rs        # NEW — pure-logic decision tests (per-tab toggle, default-off invariant)
└── dogfood_marker.rs   # NEW — script-friendly marker test (optional; primary verification is manual)
```

### Pattern 1: Word Wrap via EM_SETTARGETDEVICE + Style Change

**What:** RichEdit word-wrap is toggled by combining (a) a window-style flip (WS_HSCROLL + ES_AUTOHSCROLL on/off) and (b) `EM_SETTARGETDEVICE(wParam=NULL, lParam=0_or_1)`. Per-tab — each tab's RichEdit child gets its own toggle.

**When to use:** Wired to `IDM_VIEW_WORDWRAP` menu item; reapplied for fresh tabs from `Tab.word_wrap` default (false per VIEW-07).

**Confidence note (MEDIUM):** Microsoft's official `EM_SETTARGETDEVICE` doc says "If lParam is zero, no line breaks are created" — which on its face means lParam=0 disables wrapping. Multiple community sources (PowerBASIC forum, AutoHotkey RichEdit wrappers, mc-computing.com) report the OPPOSITE convention — `lParam=0` enables wrap-to-window when `wParam=NULL`. **The polarity must be confirmed by Wave-0 spike (compile, run, observe).** The recipe used by shipped RichEdit clients (AutoHotkey RichEdit.ahk in mm-autohotkey) is:

```
// Wrap to window:
SetWindowLong(hRE, GWL_STYLE, currentStyle & ~WS_HSCROLL & ~ES_AUTOHSCROLL);
SetWindowPos(hRE, NULL, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_FRAMECHANGED);
SendMessage(hRE, EM_SETTARGETDEVICE, 0, 0);  // 0 = wrap-on per community convention

// No wrap (horizontal scroll):
SetWindowLong(hRE, GWL_STYLE, currentStyle | WS_HSCROLL | ES_AUTOHSCROLL);
SetWindowPos(hRE, NULL, 0,0,0,0, SWP_NOMOVE|SWP_NOSIZE|SWP_NOZORDER|SWP_FRAMECHANGED);
SendMessage(hRE, EM_SETTARGETDEVICE, 0, 1);  // 1 = wrap-off per community convention
```

**Wave-0 spike task (~10 min):** Compile a 5-line test that creates a single RichEdit, types a long line, sends `EM_SETTARGETDEVICE(0, 0)` then `EM_SETTARGETDEVICE(0, 1)`, observes which produces wrap and which produces horizontal scroll. Lock the polarity in `word_wrap.rs` constants `WRAP_ON_LPARAM` and `WRAP_OFF_LPARAM` and document the empirical result inline. **Test once, encode permanently.**

**Source:** [Microsoft Learn EM_SETTARGETDEVICE (HIGH official, ambiguous on wrap usage)](https://learn.microsoft.com/en-us/windows/win32/controls/em-settargetdevice); [PowerBASIC RichEdit wrap toggle (MEDIUM community)](https://forum.powerbasic.com/forum/user-to-user-discussions/source-code/39559-toggle-wordwrap-in-richedit-control); [AutoHotkey RichEdit lib (MEDIUM open source)](https://github.com/majkinetor/mm-autohotkey/blob/master/RichEdit/RichEdit.ahk).

### Pattern 2: Recent Files — LRU + serde + Atomic Write

**What:** A single struct with `paths: Vec<PathBuf>` (max 10), serialized to `%APPDATA%/notepadrs/recent.json`. Push on every successful open via `open_path_external` (existing hook). Persist on every push. Load once at startup. Atomic writes via tmp-file + rename.

**Pure-logic shape (in `src/recent.rs`):**

```rust
#[derive(Serialize, Deserialize, Default, Debug, Clone)]
pub struct RecentFiles {
    /// Most-recently-opened first. Cap of 10. Use push_lru() to maintain.
    pub paths: Vec<String>,  // String not PathBuf — JSON-serializable; convert at boundary
}

pub const RECENT_MAX: usize = 10;
pub const RECENT_PATH_MAX_LEN: usize = 32_768;  // sanity cap (Pitfall 10)

impl RecentFiles {
    pub fn push_lru(&mut self, path: &str) {
        // Remove existing entry (case-sensitive — Windows paths are case-insensitive
        // but we preserve the user's casing; dedupe via case-insensitive compare).
        self.paths.retain(|p| !path.eq_ignore_ascii_case(p));
        self.paths.insert(0, path.to_string());
        self.paths.truncate(RECENT_MAX);
    }

    /// Validate: discard entries >RECENT_PATH_MAX_LEN, cap to RECENT_MAX.
    /// Used after deserialize to harden against tampered recent.json.
    pub fn sanitize(&mut self) {
        self.paths.retain(|p| p.len() <= RECENT_PATH_MAX_LEN);
        self.paths.truncate(RECENT_MAX);
    }
}

/// Resolve %APPDATA%/notepadrs/recent.json via SHGetKnownFolderPath.
/// Returns Err if FOLDERID_RoamingAppData lookup fails (rare — extreme sandbox).
pub fn recent_path() -> Result<PathBuf>;

/// Load with full graceful fallback (RECENT-04, Pitfall 10):
/// - missing file → Ok(Default)
/// - malformed JSON → Ok(Default) + log
/// - oversized entries → silently trimmed via sanitize()
pub fn load() -> RecentFiles;

/// Atomic write: serialize → write to recent.json.tmp → fs::rename.
/// Returns Err only on SHGetKnownFolderPath failure (caller may show non-fatal log).
pub fn save(rf: &RecentFiles) -> Result<()>;
```

**Why pure-logic separation:** Same pattern used in Phase 2 (`dispatch_pure.rs`, `find_dispatch_pure.rs`) — keeps unit tests off the Win32-shim dependency for TEST-06 coverage.

**Source:** [SHGetKnownFolderPath windows-rs docs (HIGH)](https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/UI/Shell/fn.SHGetKnownFolderPath.html); pitfalls.md Pitfall 10.

### Pattern 3: WM_DROPFILES Drag-Drop Wiring

**What:** Once-only `DragAcceptFiles(hwnd, TRUE)` in WM_CREATE (after OleInitialize succeeded — already paired in main.rs:68 / 73). `WM_DROPFILES` handler in dispatch.rs iterates files via `DragQueryFileW(hdrop, idx, ...)`, calls `open_path_external(hwnd, &path)` per file, and finishes with `DragFinish(hdrop)`. Multi-file drops open multiple tabs (one per file).

**Why WM_DROPFILES not IDropTarget:** SC-10 only requires file-path drops; WM_DROPFILES is ~10 lines vs ~150 lines of COM vtable for IDropTarget. Decision locked in stack.md (lines 230-249).

**Code skeleton:**

```rust
// In WM_CREATE (after window is fully created):
DragAcceptFiles(hwnd, TRUE);

// In dispatch handler:
WM_DROPFILES => {
    let hdrop = HDROP(wparam.0 as *mut _);
    let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);  // 0xFFFFFFFF returns count
    for idx in 0..count {
        let mut buf = [0u16; 260]; // MAX_PATH
        let len = DragQueryFileW(hdrop, idx, Some(&mut buf));
        if len == 0 { continue; }
        let path = PathBuf::from(String::from_utf16_lossy(&buf[..len as usize]));
        // Branch: first drop into fresh tab (matches do_file_open D-14 heuristic);
        // subsequent drops always push new tab.
        if idx == 0 && tab_is_fresh(app) {
            open_path_external(hwnd, &path);  // loads into active fresh tab
        } else {
            push_tab_then_load(app, hwnd, &path);
        }
    }
    DragFinish(hdrop);
    LRESULT(0)
}
```

**Caveat:** `WM_DROPFILES` will fire on the main window OR on the RichEdit child if RichEdit's built-in OLE drag-drop is enabled. RichEdit auto-enables drag-drop **of text content within itself** but does not consume file-path drops by default in the modern (RichEdit 4.1) class. **No need to disable RichEdit OLE drag-drop** for SC-10 — file drops route to the parent window's WM_DROPFILES, text drops within editor work as a bonus.

**Source:** [Microsoft Learn WM_DROPFILES (HIGH)](https://learn.microsoft.com/en-us/windows/win32/shell/wm-dropfiles); [DragAcceptFiles (HIGH)](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-dragacceptfiles).

### Pattern 4: Dynamic Recent-Files Submenu via WM_INITMENUPOPUP

**What:** The File → Recent Files submenu is rebuilt each time the user opens it (WM_INITMENUPOPUP event arrives). This avoids stale entries and per-push menu surgery. Each entry's `IDM` is allocated from a reserved dynamic range (proposed: 200-209 for 10 slots).

**Why rebuild-on-open instead of incremental update:** menu changes via AppendMenuW/DeleteMenu work, but the WM_INITMENUPOPUP rebuild is the documented Notepad++/MFC pattern, simpler to reason about, and keeps the menu construction in one place (`menu.rs`).

**Skeleton:**

```rust
// app.rs:
pub const IDM_RECENT_BASE: u16 = 200;  // 200..=209 (10 slots)
pub const IDM_RECENT_MAX:  u16 = 209;

// menu.rs:
pub unsafe fn rebuild_recent_submenu(file_menu: HMENU, recent: &RecentFiles) {
    // Find the Recent Files popup, clear it, repopulate.
    // Use MF_BYPOSITION or remember the popup HMENU on App.
    let recent_menu = /* lookup recent submenu HMENU */;
    let count = GetMenuItemCount(recent_menu);
    for i in (0..count).rev() {
        DeleteMenu(recent_menu, i as u32, MF_BYPOSITION);
    }
    if recent.paths.is_empty() {
        AppendMenuW(recent_menu, MF_STRING | MF_GRAYED, 0, w!("(No recent files)"));
        return;
    }
    for (idx, path) in recent.paths.iter().enumerate() {
        let label = format!("&{} {}\0", idx + 1, truncate_for_menu(path, 60));
        let label_w: Vec<u16> = label.encode_utf16().collect();
        AppendMenuW(
            recent_menu,
            MF_STRING,
            (IDM_RECENT_BASE as usize) + idx,
            PCWSTR(label_w.as_ptr())
        );
    }
}

// dispatch.rs WM_INITMENUPOPUP handler — call rebuild_recent_submenu(...);
// dispatch.rs WM_COMMAND — match cmd in IDM_RECENT_BASE..=IDM_RECENT_MAX,
//                          look up path by (cmd - IDM_RECENT_BASE), open_path_external.
```

### Anti-Patterns to Avoid

- **Eagerly serializing recent.json on every menu mouseover** — only save on push (path opened), not on read. Reading is free; writing wastes disk I/O.
- **Storing PathBuf directly in serde struct** — `PathBuf`'s serde impl is platform-quirky on non-UTF-8 paths. Use `String` and convert at boundary; reject non-UTF-8 paths from drag-drop with a log line.
- **Forgetting `DragFinish(hdrop)`** — the HDROP holds OS resources; not finishing leaks until process exit.
- **Calling `DragAcceptFiles` more than once per HWND** — idempotent but wastes a syscall; do it once in WM_CREATE.
- **Toggling word wrap by destroy+recreate the RichEdit** — would lose buffer, undo stack, scroll position, encoding metadata. Use the in-place style+message recipe (Pattern 1) only.
- **Skipping the EM_SETTARGETDEVICE step and toggling only WS_HSCROLL/ES_AUTOHSCROLL** — the style flip alone may not invalidate the existing wrapped-line cache in RichEdit; the message is what forces a full re-layout.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| AppData path | Hand-construct from `%APPDATA%` env var or `GetEnvironmentVariableW` | `SHGetKnownFolderPath(FOLDERID_RoamingAppData, ...)` | Env vars miss elevation/impersonation cases; SHGetKnownFolderPath is the supported API |
| JSON encoding | Format strings + manual escaping | `serde_json::to_string_pretty` / `from_str` | Already justified for v1; correct escaping of paths-with-quotes/backslashes is non-trivial |
| Atomic file write | Direct `fs::write` to target file | tmp-file + `fs::rename` | Power-loss leaves an empty `recent.json`; pattern from `file::save_atomic` (already in src/file.rs:92) is the template |
| Word wrap layout | Custom line-break computation in WM_PAINT | `EM_SETTARGETDEVICE` (RichEdit owns layout) | RichEdit re-flows on resize; we'd reimplement word-break + hit-test |
| Drag-drop UI | `IDropTarget` COM interface | `WM_DROPFILES` + `DragAcceptFiles` | 10× less code for the SC-10 spec; OleInitialize already paired (main.rs:68/73) |
| Recent-files dedup | "If exists, swap to front; else push" with manual index management | `Vec::retain` + `insert(0, x)` + `truncate(10)` | 3-line LRU; canonical Rust idiom |

**Key insight:** Phase 5 is almost entirely about wiring well-understood Win32 affordances. Resist any temptation to "do it right with IDropTarget" or "compute wrap manually for control" — those are v2 work, not v1.

## Common Pitfalls

### Pitfall 1: EM_SETTARGETDEVICE polarity ambiguity (DOMAIN-SPECIFIC)

**What goes wrong:** Code is written assuming `lParam=1` enables wrap; ships with View → Word Wrap "on" actually showing horizontal scrollbars (no-wrap behavior). User reports "menu does the opposite of what it says."
**Why it happens:** Microsoft's official doc says `lParam=0` means "no line breaks" — semantically opposite of what the community recipe encodes.
**How to avoid:** **Wave-0 spike** is mandatory. Build a one-task experiment: open RichEdit, type long line, send `EM_SETTARGETDEVICE(0, 0)` then `(0, 1)`, observe which causes wrap-to-window and which causes horizontal scroll. Encode the empirical result in `word_wrap.rs` as named constants (`WRAP_ON_LPARAM = 0` or `1` — whichever the test confirmed) with a doc-comment summarizing the polarity.
**Warning signs:** A V1 user (or QA) reports "Word Wrap menu item is backwards." This is the bug; rebuild from spike data.

### Pitfall 2: Recent-files corruption on first run (covered in pitfalls.md Pitfall 10)

**Phase-specific manifestation:** `%APPDATA%/notepadrs/` doesn't exist → `serde_json::from_str` fails on first launch → editor crashes. Already extensively documented in pitfalls.md Pitfall 10. **Phase 5 implementation MUST follow the prevention recipe verbatim:** `fs::create_dir_all` before write; treat any read error as `Default::default()`; atomic write via tmp-rename; sanity-cap the loaded struct.
**Test gate:** TEST-06 covers (a) write→read identity, (b) missing-file → empty, (c) malformed JSON → empty, (d) oversized entry → discarded, (e) capacity cap.

### Pitfall 3: Drag-drop while OleInitialize was wrong (covered in pitfalls.md Pitfall 7)

**Phase-specific manifestation:** Already mitigated in Phase 1 — main.rs:68 calls `OleInitialize`, not `CoInitializeEx`. Verify by reading main.rs at plan-check time. **No change needed.** If a future refactor switches to `CoInitializeEx`, drag-drop silently breaks.
**Verification:** Add an integration test (or assertion) that `DragAcceptFiles(hwnd, TRUE)` returns without error after window creation — this is a proxy for OleInitialize correctness.

### Pitfall 4: Word-wrap row math drift (covered in pitfalls.md Pitfall 19)

**Phase-specific manifestation:** Status bar Ln/Col math (Plan 04-03) reports based on `EM_LINEFROMCHAR` which RichEdit redefines after wrap toggle (visual lines vs logical lines depending on internal state). After toggling wrap on, status bar may briefly show a different row number for the same logical position.
**How to avoid:** RichEdit `EM_LINEFROMCHAR` returns the **paragraph index** (logical line), not visual line, regardless of wrap state. Phase 4's status bar already uses paragraph index, so this is a non-issue **as long as Phase 5 does not switch to a visual-line API**. Plan 05-01 must NOT change `EM_LINEFROMCHAR` calls in status_bar.rs.
**Test gate:** Manual: toggle wrap on, verify Ln/Col stays accurate.

### Pitfall 5: Multi-file drag-drop creates N empty intermediate tabs

**What goes wrong:** Naive WM_DROPFILES handler does `for path in paths { push_empty_tab(); load(path); }` — but the active-fresh-tab heuristic in `do_file_open` only consumes ONE fresh tab. Subsequent drops create empty tabs first then load, leaving visible flicker and possibly wrong tab order.
**How to avoid:** First-drop uses fresh-tab heuristic; subsequent drops always `push_empty_tab(false)` (initially hidden) then load → switch on completion. Mirror Plan 03-02 D-14's logic.
**Test gate:** Manual: drop 3 files at once; verify 3 tabs created in order, no extra empty tabs.

### Pitfall 6: Binary-size regression slips past CI

**What goes wrong:** Phase 5 adds `serde + serde_json` (~150KB compressed contribution). If a future change adds `serde-yaml` or `chrono` "for convenience," binary creeps past 10MB.
**How to avoid:** A CI check / ship-gate plan task that asserts `cargo build --release --target x86_64-pc-windows-msvc` produces a binary ≤10MB. Current binary is ~1.4MB after Phase 4; a 7× headroom is generous but not infinite.
**Test gate:** SC-12 ship-gate plan runs `cargo build --release` and explicitly checks file size; fails the plan if >10MB.

## Code Examples

### Example 1: Apply word-wrap setting to a tab's RichEdit

```rust
// src/word_wrap.rs (NEW)
//! VIEW-06 / VIEW-07: per-tab word-wrap toggle for RichEdit children.
//!
//! Polarity locked by Wave-0 spike — see WRAP_ON_LPARAM / WRAP_OFF_LPARAM constants.

use windows::Win32::Foundation::HWND;
use windows::Win32::UI::Controls::RichEdit::EM_SETTARGETDEVICE;
use windows::Win32::UI::WindowsAndMessaging::*;

/// EM_SETTARGETDEVICE lParam value that ENABLES wrap-to-window.
/// LOCKED BY WAVE-0 SPIKE: empirical result is recorded here. Do NOT change without
/// re-running the spike on Windows 10/11 with current RichEdit (msftedit.dll).
pub const WRAP_ON_LPARAM:  isize = 0;  // PROVISIONAL — Wave-0 spike confirms
pub const WRAP_OFF_LPARAM: isize = 1;  // PROVISIONAL — Wave-0 spike confirms

/// Apply the per-tab word-wrap setting to its RichEdit child.
///
/// # Safety
/// `hwnd_re` must be a valid RichEdit HWND.
pub unsafe fn apply_wrap(hwnd_re: HWND, wrap_on: bool) {
    use windows::Win32::Foundation::{LPARAM, WPARAM};
    let style_ptr = GetWindowLongPtrW(hwnd_re, GWL_STYLE);
    let mut style = style_ptr as u32;
    const WS_HSCROLL: u32 = 0x00100000;
    const ES_AUTOHSCROLL: u32 = 0x0080;
    if wrap_on {
        style &= !(WS_HSCROLL | ES_AUTOHSCROLL);
    } else {
        style |= WS_HSCROLL | ES_AUTOHSCROLL;
    }
    SetWindowLongPtrW(hwnd_re, GWL_STYLE, style as isize);
    let _ = SetWindowPos(
        hwnd_re,
        None,
        0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_FRAMECHANGED,
    );
    let lparam = if wrap_on { WRAP_ON_LPARAM } else { WRAP_OFF_LPARAM };
    let _ = SendMessageW(
        hwnd_re,
        EM_SETTARGETDEVICE,
        Some(WPARAM(0)),
        Some(LPARAM(lparam)),
    );
}
```

### Example 2: AppData path lookup + atomic save

```rust
// src/recent.rs (NEW)
use std::path::PathBuf;
use windows::Win32::UI::Shell::{SHGetKnownFolderPath, FOLDERID_RoamingAppData, KF_FLAG_CREATE};

pub fn recent_path() -> Result<PathBuf, crate::error::Error> {
    unsafe {
        // KF_FLAG_CREATE creates the folder if missing (RECENT-04 robustness).
        let pwstr = SHGetKnownFolderPath(&FOLDERID_RoamingAppData, KF_FLAG_CREATE, None)?;
        // SHGetKnownFolderPath returns a PWSTR allocated via CoTaskMemAlloc;
        // the windows-rs binding handles CoTaskMemFree on drop of the returned PWSTR
        // wrapper — verify against windows 0.62 docs.
        let s = pwstr.to_string()?;  // converts UTF-16 to String
        let dir = PathBuf::from(s).join("notepadrs");
        std::fs::create_dir_all(&dir)?;
        Ok(dir.join("recent.json"))
    }
}

pub fn save(rf: &RecentFiles) -> Result<(), crate::error::Error> {
    let target = recent_path()?;
    let json = serde_json::to_string_pretty(rf)?;
    let tmp = target.with_extension("json.tmp");
    std::fs::write(&tmp, json.as_bytes())?;
    std::fs::rename(&tmp, &target)?;
    Ok(())
}

pub fn load() -> RecentFiles {
    let path = match recent_path() {
        Ok(p) => p,
        Err(_) => return RecentFiles::default(),  // RECENT-04
    };
    let text = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return RecentFiles::default(),  // missing file → empty
    };
    let mut rf: RecentFiles = serde_json::from_str(&text).unwrap_or_default();  // Pitfall 10
    rf.sanitize();
    rf
}
```

### Example 3: WM_DROPFILES handler

```rust
// src/dispatch.rs (addition near WM_NOTIFY arm)
WM_DROPFILES => {
    use windows::Win32::UI::Shell::{DragQueryFileW, DragFinish, HDROP};
    let hdrop = HDROP(wparam.0 as *mut _);
    // Probe count via 0xFFFFFFFF.
    let count = DragQueryFileW(hdrop, 0xFFFFFFFF, None);
    for idx in 0..count {
        let len_needed = DragQueryFileW(hdrop, idx, None) as usize;
        let mut buf: Vec<u16> = vec![0; len_needed + 1];
        let len = DragQueryFileW(hdrop, idx, Some(&mut buf));
        if len == 0 { continue; }
        let path = std::path::PathBuf::from(String::from_utf16_lossy(&buf[..len as usize]));
        if idx == 0 && tab_is_fresh(app) {
            open_path_external(hwnd, &path);
        } else {
            // Mirror do_file_open's push_empty_tab + insert + switch sequence.
            do_drop_open(app, hwnd, &path);
        }
    }
    DragFinish(hdrop);
    return LRESULT(0);
}
```

## Plan Sizing & Wave Layout

This phase has 3 feature areas + dogfood + ship gate. Recommended plan structure: **5 plans across 4 waves** (Wave 0 spike + 3 feature waves).

| Plan | Title | Wave | LOC est. | Tasks | Touches | Wave dep |
|------|-------|------|----------|-------|---------|----------|
| **05-01** | Word-wrap toggle (VIEW-06, VIEW-07) | 0+1 | ~120 | 3 (Wave-0 spike, word_wrap.rs, dispatch+menu wiring) | NEW: src/word_wrap.rs, tests/word_wrap.rs · MOD: src/menu.rs (View menu), src/dispatch.rs (IDM_VIEW_WORDWRAP), src/app.rs (IDM 140), src/tab.rs (apply on visibility toggle/create) | None |
| **05-02** | Recent files (RECENT-01..04, TEST-06) | 1 | ~250 | 3 (recent.rs pure-logic + serde, menu rebuild + IDM_RECENT_*, integration into open_path_external) | NEW: src/recent.rs, tests/recent_files.rs · MOD: src/menu.rs (Recent submenu), src/dispatch.rs (WM_INITMENUPOPUP rebuild + IDM_RECENT_BASE..=MAX), src/app.rs (recent: RecentFiles field, IDM 200-209), Cargo.toml (+serde, +serde_json) | None — independent of 05-01 |
| **05-03** | Drag-and-drop (DND-01) | 2 | ~80 | 2 (DragAcceptFiles in WM_CREATE, WM_DROPFILES handler with multi-file logic) | MOD: src/dispatch.rs (WM_CREATE addition + WM_DROPFILES arm), src/main.rs (verify OleInitialize already there) · NEW: tests/drag_drop_pure.rs (pure-logic path-list parse) | 05-02 (so dropped paths feed Recent Files) |
| **05-04** | Dogfood marker (manual op + scripted helper) | 3 | ~60 | 2 (manual checklist doc, optional scripted dogfood test) | NEW: tests/dogfood_marker.rs (optional script: launch, edit, save fixture; assert byte content); .planning/phases/05-polish-dogfood-ship/dogfood-checklist.md | 05-01, 05-02, 05-03 (must be done) |
| **05-05** | Ship gate (TEST-06 final, SC-11, SC-12) | 3 | ~40 | 3 (binary-size assertion script, test-count assertion, release build verification) | NEW: tests/ship_gate.rs (or tools/check-binary-size.rs) · MOD: .planning/phases/05-polish-dogfood-ship/ship-checklist.md | 05-04 (parallel with 05-04 if 05-04 is marker-only) |

**Wave layout rationale:**
- **Wave 0 (spike)** is folded into Plan 05-01's first task — the polarity test must run before any production code commits. Single short task, ~10 minutes.
- **Wave 1** runs 05-01 and 05-02 in parallel. They touch overlapping menu.rs but in disjoint sections (View menu vs File→Recent submenu) and disjoint IDM ranges (140s vs 200s). Plan-checker should confirm no collision.
- **Wave 2** runs 05-03 alone because it depends on 05-02's recent-files pipeline (drops should append to Recent).
- **Wave 3** runs 05-04 + 05-05. Could run in parallel; the dogfood marker is the integration test for everything (so it's a verification, not new code).

**Why not 4 plans (collapse 05-04 + 05-05):** Splitting verification artifacts (dogfood is operational; ship gate is automated) makes both individually traceable. The dogfood marker is the project's existential test ("the dev uses notepadrs.exe on its own Cargo.toml") and earns its own plan.

**Why not 6+ plans:** Each plan above is small enough (40-250 LOC) to ship in a single execution. Splitting word-wrap into "menu first" + "wiring later" would create a sub-30-LOC plan with no integration value.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom drag-drop via `IDropTarget` for file open | `WM_DROPFILES` | Win95 era — both still work | We use WM_DROPFILES; 10× less code for SC-10 |
| `lazy_static!` for AppConfig | `std::sync::OnceLock` | Rust 1.70+ stable | If single-instance config needed; v1 just reads on startup |
| `winapi` for SHGetKnownFolderPath | `windows` 0.62 `SHGetKnownFolderPath` (Win32_UI_Shell feature) | windows-rs 0.x progression | Already on the right path |
| Hand-rolled JSON for recent files | `serde_json` | Rust 1.30+ ecosystem | We use serde_json (allowlisted) |

**Deprecated/outdated:**
- `winapi` crate — frozen 2021; do not use anywhere (already not used in this project)
- `SHGetFolderPathW` (without "Known") — superseded by SHGetKnownFolderPath in Vista+; we target Win10 1809+, use the new API
- `WM_DROPFILES` does NOT integrate with UAC-elevation drag-drop (where drop source is elevated, target isn't) — irrelevant for v1 (notepadrs is not typically run elevated; explicit users can right-click → Run as Admin and the consistency holds)

## Open Questions

1. **Word-wrap polarity (Pitfall 1)** — UNANSWERED. Resolved by Wave-0 spike in Plan 05-01. Recommendation: spike is task 1; constants are encoded only after empirical confirmation; rest of 05-01 depends on locked constants.

2. **Should recent-files capacity be configurable?** — RECENT-01 says "last 10." That's the spec. v2 can add a setting; v1 ships at 10.

3. **Should the View menu also have Word-Wrap state-checkmark?** — Yes (Notepad++ shows MF_CHECKED on the menu item when wrap is on). Plan 05-01 should wire WM_INITMENUPOPUP to set/clear the check based on `app.tabs[active].word_wrap`. Same pattern as Phase 2's encoding/EOL CheckMenuRadioItem already in dispatch.rs:185-203.

4. **Should drag-drop also accept folder drops?** — SC-10 says "file" not "folder." Folder drops produce a directory path; opening a directory is undefined. Recommendation: skip folders silently (check `path.is_file()` before calling `open_path_external`); v2 can iterate-over-folder if requested.

5. **Should the dogfood marker be automated?** — The spirit of the marker is operational ("dev uses it on real work"). A scripted version that launches notepadrs, reads back the result, and asserts could be added but invites flakiness. Recommendation: manual checklist as primary verification; an OPTIONAL scripted helper that asserts a byte-identical round-trip on `Cargo.toml` is a nice-to-have.

## Validation Architecture

> Skipped — `.planning/config.json` does not have `workflow.nyquist_validation` set (defaults false). Phase 5 verification follows the existing project pattern: pure-logic unit tests + integration tests, no per-task sampling rate framework.

## Infrastructure Dependencies

**None.** Phase 5 is a desktop app with no server, no database, no Docker, no CI infrastructure beyond `cargo test` + `cargo build`. The `recent.json` file is per-user appdata; tests use a temp directory or pure-logic coverage that bypasses the FS entirely.

## Test Strategy

### Current Test Inventory

Cargo test currently runs **315+ passing tests** across 24 test files (sum of all `running N tests` lines from `cargo test`):

| Test File | Tests | Origin Phase |
|-----------|-------|--------------|
| cargo_profile.rs | 1 | Phase 1 |
| com_init.rs | 2 | Phase 1 |
| encoding_cascade.rs | 16 | Phase 2 |
| eol_detection.rs | 14 | Phase 2 |
| find_engine.rs | 31 | Phase 3 |
| find_replace_integration.rs | 8 | Phase 3 |
| find_replace_pure.rs | 8 | Phase 3 |
| find_worker.rs | 12 | Phase 3 |
| gutter_layout.rs | 15 | Phase 4 |
| highlight_perf.rs | 3 (#[ignore] release) | Phase 4 |
| menu_action_tests.rs | 10 | Phase 2 |
| open_errors.rs | 11 | Phase 2 |
| panic_safety.rs | 6 | Phase 1 |
| phase02_coverage.rs | 26 | Phase 2 |
| phase03_additional.rs | 35 | Phase 3 |
| phase04_data_shape.rs | 13 | Phase 4 |
| replace_engine.rs | 8 | Phase 3 |
| roundtrip_matrix.rs | 14 | Phase 2 |
| roundtrip_utf8_ascii.rs | 3 | Phase 1 |
| status_bar_labels.rs | 19 | Phase 4 |
| syntax_tokenizers.rs | 39 | Phase 4 |
| tab_model.rs | 18 | Phase 3 |
| undo_property.rs | 6 | Phase 1 |

**TEST-01 (≥30 passing) is already exceeded by 10×.** The Phase 5 add is **TEST-06 (recent-files persistence)** — the only missing TEST requirement.

### Phase 5 Test Additions

| New Test File | Tests | Coverage | Plan |
|---------------|-------|----------|------|
| `tests/word_wrap.rs` | ~6 pure-logic | Per-tab toggle invariant, default-off, polarity locked by Wave-0 spike (constants test), idempotence | 05-01 |
| `tests/recent_files.rs` | ~10 pure-logic | LRU push (insert at front, dedupe, cap 10), serialize→deserialize round-trip, missing-file fallback, malformed-JSON fallback, oversized-entry rejection (Pitfall 10) | 05-02 (TEST-06) |
| `tests/drag_drop_pure.rs` | ~4 pure-logic | Path-buffer parse helpers (multi-path UTF-16 → Vec<PathBuf>), folder-vs-file filter, empty-drop edge case | 05-03 |
| `tests/dogfood_marker.rs` (optional) | ~1 integration | Scripted Cargo.toml round-trip (launch notepadrs, save, assert byte equality, run cargo build) | 05-04 |
| `tests/ship_gate.rs` (or `tools/check-binary-size.rs`) | ~2 | `cargo build --release` produces ≤10MB exe; `cargo test` count ≥30 | 05-05 |

**Phase 5 test target:** 315 + ~21 = ~336 total; well above SC-12 ≥30 threshold.

### Test Pitfalls (project-specific)

- **Windows AppCompat shim error 740** (Phase 2 finding): test binaries with names containing `dispatch` or other admin-keyword variants are blocked from `cargo test` with ERROR_ELEVATION_REQUIRED. **Avoid** these substrings in Phase 5 test file names: `install`, `setup`, `update`, `dispatch`. Recommended names per table above all pass this filter.
- **MockSink pattern** for any Win32-touching tests — use the same `CharFormatSink` pattern from Phase 4 if a Phase 5 test needs to verify state without a real HWND.

## Binary Size Baseline

**Current release binary** (Phase 4 complete, MSVC target): **1,472,000 bytes (~1.4 MB)** — well under the 10MB SC-11 ceiling.

```
target/x86_64-pc-windows-msvc/release/notepadrs.exe = 1,472,000 bytes
```

**Phase 5 expected delta:**
- `serde` + `serde_json` (derive-only feature, no big proc-macro pulls): ~150-300 KB compressed contribution after LTO
- `word_wrap.rs` + `recent.rs` source: <30 KB code
- New `WM_DROPFILES` import (`Win32_UI_Shell` feature group is already enabled): 0 KB

**Estimated Phase 5 release binary:** ~1.6-1.8 MB. **Headroom against 10MB:** 8.2 MB. No optimization needed; existing `[profile.release]` settings (lto=fat, opt-level=z, codegen-units=1, strip=symbols, panic=abort) already do the work.

**Ship-gate assertion:** `cargo build --release --target x86_64-pc-windows-msvc && wc -c target/x86_64-pc-windows-msvc/release/notepadrs.exe` ≤ 10485760.

## Dogfood Marker (operational definition)

**The marker (idea.md):** "v1 is done when the developer can use notepadrs.exe to open, edit, and save the project's own Cargo.toml without going back to another editor."

**Operational test (Plan 05-04):**

1. `cargo build --release --target x86_64-pc-windows-msvc`
2. Launch: `target/x86_64-pc-windows-msvc/release/notepadrs.exe Cargo.toml`
3. Verify: Cargo.toml contents visible; correct encoding (UTF-8) and EOL (LF or CRLF as in repo) shown in status bar; line numbers visible; TOML keys highlighted (or plain if .toml is not on the language list — confirm `lang_from_path("Cargo.toml")` returns Plain since .toml is not in SYNTAX-01..04).
4. Edit: change a comment or whitespace. Verify dirty asterisk appears; status bar updates.
5. Save: Ctrl+S. Verify dirty asterisk clears; status bar refreshes.
6. Quit notepadrs.
7. Verify on shell: `cargo build` succeeds (Cargo.toml is still valid TOML); `git diff` shows the comment change cleanly (no encoding/EOL drift).
8. Restart notepadrs (no args). Verify File → Recent Files lists `Cargo.toml`.
9. Drag any other file from File Explorer onto window. Verify it opens in a new tab.

**Test 7 is the dogfood gate.** If `cargo build` fails after the round-trip, encoding or EOL was corrupted (Pitfalls 3 or 4 escaped to v1). If git diff shows whole-file changes, EOL normalization broke. Both are blocking bugs.

**Manual checklist deliverable:** `.planning/phases/05-polish-dogfood-ship/dogfood-checklist.md` written by Plan 05-04 with the 9 steps above plus expected pass/fail criteria.

## Sources

### Primary (HIGH confidence)

- [Microsoft Learn — WM_DROPFILES](https://learn.microsoft.com/en-us/windows/win32/shell/wm-dropfiles) — official semantics
- [Microsoft Learn — DragAcceptFiles](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-dragacceptfiles) — registration pattern
- [Microsoft Learn — DragQueryFileW](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-dragqueryfilew) — file enumeration
- [Microsoft Learn — DragFinish](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-dragfinish) — resource cleanup
- [Microsoft Learn — EM_SETTARGETDEVICE](https://learn.microsoft.com/en-us/windows/win32/controls/em-settargetdevice) — official message reference (semantically AMBIGUOUS for wrap toggle)
- [Microsoft Learn — About Rich Edit Controls](https://learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls) — feature matrix
- [Microsoft Learn — SHGetKnownFolderPath](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shgetknownfolderpath) — official AppData path API
- [windows-rs 0.62 — SHGetKnownFolderPath](https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/UI/Shell/fn.SHGetKnownFolderPath.html) — Rust binding signature
- [windows-rs 0.62 — FOLDERID_RoamingAppData](https://microsoft.github.io/windows-docs-rs/doc/windows/Win32/UI/Shell/constant.FOLDERID_RoamingAppData.html) — known-folder GUID constant
- [Project research — `.planning/research/stack.md`](.planning/research/stack.md) — WM_DROPFILES vs IDropTarget decision (lines 230-249)
- [Project research — `.planning/research/pitfalls.md`](.planning/research/pitfalls.md) — Pitfalls 7, 10, 13, 19 directly relevant
- [serde_json docs (HIGH)](https://docs.rs/serde_json/latest/serde_json/) — to_string_pretty, from_str API

### Secondary (MEDIUM — community-attested, multi-source corroboration)

- [PowerBASIC — Toggle wordwrap in RichEdit control](https://forum.powerbasic.com/forum/user-to-user-discussions/source-code/39559-toggle-wordwrap-in-richedit-control) — community recipe for EM_SETTARGETDEVICE wrap toggle
- [mc-computing.com — RichEdit](http://mc-computing.com/languages/RichEdit.htm) — corroborates "undocumented use" attribute
- [AutoHotkey RichEdit lib (mm-autohotkey)](https://github.com/majkinetor/mm-autohotkey/blob/master/RichEdit/RichEdit.ahk) — open-source implementation reference for the wrap-toggle recipe
- [Rust Atomic Writes thread (Rust users forum)](https://users.rust-lang.org/t/how-to-write-replace-files-atomically/42821) — atomic-write tmp+rename pattern
- [`rust-atomicwrites` crate README](https://github.com/untitaker/rust-atomicwrites) — pattern reference (NOT a dependency; we hand-roll)

### Tertiary (LOW confidence — flagged for Wave-0 verification)

- **EM_SETTARGETDEVICE wrap-toggle polarity** — community sources disagree on whether `lParam=0` or `lParam=1` enables wrap. **Wave-0 spike in Plan 05-01 is mandatory** to lock the polarity empirically.

## Metadata

**Confidence breakdown:**
- Standard stack (windows 0.62 + serde + serde_json): HIGH — already in project; no new crates
- Architecture patterns: HIGH for WM_DROPFILES + recent-files (canonical), MEDIUM for word-wrap toggle (polarity TBD by spike)
- Pitfalls: HIGH — most are forwarded from project-level pitfalls.md and verified against current source state
- Plan sizing: HIGH — three small features + ship gate fit cleanly into 5 plans across 4 waves; matches Phase 4's working pattern

**Research date:** 2026-05-03
**Valid until:** 2026-08-01 (90 days for stable Win32 + Rust ecosystem; recheck if `windows` crate bumps to 0.63+)
