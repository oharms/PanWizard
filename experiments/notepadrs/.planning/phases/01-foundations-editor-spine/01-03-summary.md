---
phase: 01-foundations-editor-spine
plan: 03
status: complete
date: 2026-05-02
---

# Plan 01-03 Summary - File I/O (UTF-8 ASCII open/save + CLI arg + Round-trip)

## What landed

Phase 1's file I/O surface:
- **FILE-01**: File→Open dialog (Ctrl+O / IDM_FILE_OPEN) using `GetOpenFileNameW`, loads file via `EM_STREAMIN` with CP_UTF8.
- **FILE-02**: CLI path argument: `notepadrs.exe path/to/file.txt` opens the file at startup.
- **Ctrl+S**: writes RichEdit content via `EM_STREAMOUT` (CP_UTF8) and `std::fs::write` to `current_path`. Byte-exact round-trip when content is unedited (asserted by test).
- **Error UX**: any open/save failure surfaces a `MessageBoxW` with the OS error string. Existing buffer is never lost on error.
- **Save-As placeholder**: `current_path == None` ⇒ MessageBox "Save As is not yet implemented (Phase 2)".

## Streaming flag bits used

`STREAM_FORMAT_UTF8 = SF_TEXT (0x0001) | SF_USECODEPAGE (0x0020) | (CP_UTF8 (65001) << 16)` — packed into the WPARAM of `SendMessageW(EM_STREAMIN/EM_STREAMOUT, STREAM_FORMAT_UTF8, &editstream)`.

## EDITSTREAMCALLBACK ABI

In `windows = "0.62"`, `EDITSTREAMCALLBACK = Option<unsafe extern "system" fn(usize, *mut u8, i32, *mut i32) -> u32>`. Both stream-in and stream-out share this signature (the `*mut u8` is the buffer to write to / read from; the direction is implicit from the message). Direct `Some(stream_in_cb)` / `Some(stream_out_cb)` works without `transmute`.

For stream-out we re-cast the `*mut u8` as `*const u8` via `from_raw_parts(buf as *const u8, ...)` for the slice copy, but we don't write to the buffer — RichEdit owns it.

## Final binary size

**230,912 bytes** (~225 KiB, ~2.2% of 10 MiB ceiling). Growth from 01-02 (209,920 bytes) is ~21KB for the file-I/O machinery + dialogs.

## Cargo.toml feature deltas

No new features needed — all the necessary types are already enabled:
- `Win32_UI_Controls_RichEdit` (already there): EDITSTREAM, EM_STREAMIN/EM_STREAMOUT, SF_TEXT, SF_USECODEPAGE.
- `Win32_UI_Controls` (already there): EM_SETMODIFY, EM_EMPTYUNDOBUFFER.
- `Win32_UI_Controls_Dialogs` (already there): GetOpenFileNameW, OPENFILENAMEW, OFN_*.
- `Win32_UI_WindowsAndMessaging` (already there): MessageBoxW, CreateMenu, CreatePopupMenu, AppendMenuW, SetMenu.

## `[lib]` integration with Plan 01-04

Plan 01-04 added `[lib]` with `pub mod undo_model;`. Plan 01-03 extends `src/lib.rs` to also re-export `pub mod error;` and `pub mod file;`. `tests/roundtrip_utf8_ascii.rs` imports via `use notepadrs::file;` — clean, no `#[path]` trick needed.

The bin (`src/main.rs`) still has its own private modules (`mod file;`, `mod error;`, etc.) so the binary is self-contained. Cargo allows lib + bin in one crate; both compile.

## Test count after Plan 01-03

**18 tests** total across 5 test binaries:
- `cargo_profile`: 1
- `com_init`: 2
- `panic_safety`: 6
- `undo_property`: 6
- `roundtrip_utf8_ascii`: 3 (NEW)

TEST-01's ≥30-test target: 18 done, 12 remaining for Phase 2 (encoding-cascade round-trips at multiple fixtures will easily clear).

## Manual smoke verification

- [x] `target/x86_64-pc-windows-msvc/release/notepadrs.exe` is a 230,912-byte PE32+ GUI executable for x86-64.
- Manual smoke (NOT run in this CI invocation - requires interactive desktop):
  1. Launch `notepadrs.exe` with no args → empty window opens; Ctrl+S shows the "Save As is Phase 2" dialog.
  2. Launch `notepadrs.exe tests\fixtures\ascii_lf.txt` → fixture content appears in the editor.
  3. Press Ctrl+S without typing → file on disk is byte-identical (verified by `tests/roundtrip_utf8_ascii.rs`'s in-process round-trip; the manual smoke confirms RichEdit's STREAMIN/STREAMOUT preserves bytes too).
  4. Click File→Open → standard Windows file picker; pick a different file → it loads.
  5. Type some text, Ctrl+Z → undoes; Ctrl+Y → redoes (RichEdit's built-in).

## Deviations from plan

**1. Callback return type is `u32`, not `i32`.** The plan's spec said the EDITSTREAMCALLBACK returns `i32`. In `windows = "0.62"` it's `u32`. Updated both `stream_in_cb` and `stream_out_cb` to return `u32` (0 = success, non-zero = failure).

**2. EM_EMPTYUNDOBUFFER + EM_SETMODIFY paths.** The plan referenced these from `windows::Win32::UI::Controls::RichEdit`. They actually live at `windows::Win32::UI::Controls::{EM_EMPTYUNDOBUFFER, EM_SETMODIFY}` (one level up from the RichEdit module). Adjusted import.

**3. `do_file_open` borrows `app` from `_app`.** The plan's `do_file_open` takes `&mut App` but never uses it (the path comes from `GetOpenFileNameW`'s buffer; the actual editor state mutation happens in `open_path_external`'s GWLP_USERDATA round-trip). Renamed parameter to `_app` to silence the unused-variable warning.

**4. `unsafe fn show_error` is not `pub`.** Module-private — only the dispatch.rs callers need it.

## Self-Check: PASS

- [x] `src/file.rs` provides `open_utf8_ascii` and `save_utf8`.
- [x] `src/editor.rs::EditorState` exposes `open_text(&[u8], PathBuf)` and `save_text() -> Vec<u8>`.
- [x] `src/menu.rs::build_main_menu` constructs the File menu.
- [x] `src/main.rs` parses CLI arg and calls `dispatch::open_path_external`.
- [x] `src/dispatch.rs` IDM_FILE_OPEN/SAVE handlers do real work; errors surface via MessageBoxW.
- [x] `tests/fixtures/ascii_lf.txt`, `ascii_only.txt` exist with LF-only line endings (verified via `xxd`).
- [x] `tests/roundtrip_utf8_ascii.rs` 3 tests, all passing.
- [x] All 18 cumulative `cargo test` checks pass.
- [x] `cargo build --release`: 230,912 bytes (well under 10 MiB).
- [x] `cargo clippy --release -- -D warnings`: passes.
