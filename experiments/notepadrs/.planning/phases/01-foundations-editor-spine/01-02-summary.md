---
phase: 01-foundations-editor-spine
plan: 02
status: complete
date: 2026-05-02
---

# Plan 01-02 Summary - Window Lifecycle + RichEdit + Accelerators

## What landed

The full WinMain → OleInitialize → window class → WndProc → RichEdit pipeline with all four critical pitfalls baked in:
- QUAL-01 (panic=abort in [profile.release]) - already in 01-01.
- QUAL-02 (Box<App> via GWLP_USERDATA, no static mut, clippy::static_mut_refs denied).
- QUAL-03 (catch_unwind+AssertUnwindSafe in WndProc; clippy::unwrap_used/expect_used denied in window.rs/dispatch.rs/editor.rs).
- QUAL-04 (OleInitialize/OleUninitialize bracketing the message loop; CoInitializeEx never called).

## Final windows-crate features

Added to 01-01's set:
- `Win32_System_Diagnostics_Debug` (for `OutputDebugStringW` in `src/log.rs`).
- `Win32_UI_Input_KeyboardAndMouse` (for `VK_O/S/X/C/V/A/Z/Y` and `ACCEL_VIRT_FLAGS`).

Final feature list now:
```
"Win32_Foundation",
"Win32_UI_WindowsAndMessaging",
"Win32_UI_Controls",
"Win32_UI_Controls_RichEdit",
"Win32_UI_Controls_Dialogs",
"Win32_UI_Shell",
"Win32_UI_HiDpi",
"Win32_System_LibraryLoader",
"Win32_System_Com",
"Win32_System_Ole",
"Win32_System_Diagnostics_Debug",
"Win32_UI_Input_KeyboardAndMouse",
"Win32_Graphics_Gdi",
```

## Binary size

Release binary after 01-02: **209,920 bytes** (~205 KiB, ~2% of 10 MiB ceiling).

## EditorState shape (for Plan 01-03)

```rust
pub struct EditorState {
    pub hwnd_re: HWND,                                // RichEdit child window
    pub current_path: Option<std::path::PathBuf>,     // populated by open_text in 01-03
}

impl EditorState {
    pub unsafe fn create(parent: HWND) -> crate::error::Result<Self>;
    // open_text and save_text are TODO for Plan 01-03.
}
```

`hwnd_re` is `pub` (accessible cross-module). Plan 01-03 should add:
- `pub unsafe fn open_text(&mut self, utf8_bytes: &[u8], path: std::path::PathBuf) -> Result<()>`
- `pub unsafe fn save_text(&self) -> Result<Vec<u8>>`

## Deviations from plan

**1. windows 0.62 API differences from the plan spec.** The plan referenced several APIs that have changed in `windows = "0.62.2"`:
- `OleInitialize` returns `windows_core::Result<()>` (not `HRESULT`); the call became `unsafe { OleInitialize(None)? }` in `main.rs`. S_FALSE (already initialized) is mapped to `Ok(())` by the crate, so any `Err` is a real failure.
- `Error::from_win32()` was renamed to `Error::from_thread()`. Used in `main.rs` (RegisterClassW failure path) and `editor.rs` (font creation failure path).
- `UpdateWindow` is in `windows::Win32::Graphics::Gdi`, not `WindowsAndMessaging`.
- `EM_SETSEL` is in `windows::Win32::UI::Controls`, not `RichEdit`.
- `SendMessageW` parameters are `Option<WPARAM>` and `Option<LPARAM>` (the plan spec already matched the new ABI).
- `ACCEL_VIRT_FLAGS` is constructed by combining `FVIRTKEY | FCONTROL` directly (operator overloads on the wrapper type), not by `ACCEL_VIRT_FLAGS(FVIRTKEY.0 | FCONTROL.0)`.
- `ES_MULTILINE/ES_AUTOVSCROLL/ES_NOHIDESEL` are `i32` (not the wrapper type the plan suggested) and are cast `as u32`.
- `CreateWindowExW` returns `Result<HWND>` directly, so the error path uses `?` rather than `is_invalid()`-then-`from_win32`.

**2. `cfg(any(test, debug_assertions))` placement.** The plan put the `WM_APP_TEST_PANIC` handler at the bottom of the dispatch match (with `m if m == ...`). Rust's match-arm cfg gating works with `if` guards but the import of the constant must also be cfg-gated for release builds (where the arm is absent). Solution: matched `msg == WM_APP_TEST_PANIC` *before* the main match block, in a `#[cfg(any(test, debug_assertions))]` scope, and gated the `use crate::app::WM_APP_TEST_PANIC` import the same way.

**3. `#[allow(dead_code)]` on items wired in 01-03.** The clippy `-D warnings` gate (which `dead_code` is part of in release) needs `IDM_FILE_OPEN`/`IDM_FILE_SAVE`/`IDM_FILE_EXIT`/`WM_APP_TEST_PANIC`/`current_path`/`Error::Misc`/`Error::Io`/`Error::Utf8` to be tolerated until 01-03 wires them up. Each is `#[allow(dead_code)]` with an inline note explaining when it gets used.

**4. `identity_op` clippy fix.** The plan's `(wparam.0 as u16 & 0xffff) as u32` triggers `clippy::identity_op` because `& 0xffff` on a `u16` is identity. Simplified to `(wparam.0 as u16) as u32`.

**5. panic-injection at top of dispatch.** The `WM_APP_TEST_PANIC` arm sits *before* the main `match msg` block (instead of inside it as a guard) so `cfg`-gating the import + arm together is straightforward. Behaviorally identical.

## Verification results

- `cargo build --release --target x86_64-pc-windows-msvc` succeeds; binary 209,920 bytes (well under 10 MiB).
- `cargo build --target x86_64-pc-windows-msvc` (debug) succeeds.
- `cargo clippy --release --target x86_64-pc-windows-msvc -- -D warnings` passes.
- `cargo clippy --target x86_64-pc-windows-msvc -- -D warnings` (debug) passes.
- `cargo test --target x86_64-pc-windows-msvc` passes 9 tests:
  - cargo_profile: 1 (release_profile_has_required_flags)
  - com_init: 2 (main_does_not_use_coinitialize_ex, main_uses_ole_initialize - now un-ignored)
  - panic_safety: 6 (catch_unwind, dispatch_module_denies, window_module_denies, wnd_proc_uses_catch_unwind, wnd_proc_module_denies, no_static_mut_in_window_module)

Manual smoke (NOT run in CI - requires interactive desktop): launching `notepadrs.exe` would show a window with an empty RichEdit child; typing/Ctrl+X/C/V/A/Z/Y all forward to RichEdit. Plan 01-03's Wave 3 will manually verify the file-open path on the same window.

## Self-Check: PASS

- [x] All 8 source files (`src/main.rs`, `src/app.rs`, `src/window.rs`, `src/dispatch.rs`, `src/editor.rs`, `src/log.rs`, `src/test_hooks.rs`, `src/error.rs`) compile.
- [x] cargo build --release: succeeds; binary <10MB (209,920 bytes).
- [x] cargo clippy --release -- -D warnings: passes.
- [x] cargo test: 9 passing, 0 ignored, 0 failed.
- [x] No `static mut` in src/.
- [x] No `unwrap()`/`expect()` in `src/window.rs`, `src/dispatch.rs`, `src/editor.rs` (lint-enforced).
- [x] `main_uses_ole_initialize` is no longer `#[ignore]`d and now passes.
