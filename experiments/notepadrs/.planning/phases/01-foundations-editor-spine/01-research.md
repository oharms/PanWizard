# Phase 1: Foundations + Editor Spine — Research

**Researched:** 2026-05-02
**Domain:** Native Win32 + Rust GUI text editor scaffolding (RichEdit-backed, single-tab)
**Confidence:** HIGH overall — all decisions inherit from project-level research with verified Microsoft Learn / docs.rs / crates.io sources. The single MEDIUM-confidence decision (RichEdit vs custom render) is locked here per context.md.
**Project research relied upon:** `.planning/research/summary.md`, `.planning/research/stack.md`, `.planning/research/architecture.md`, `.planning/research/pitfalls.md`. This file emits **only the Phase-1-specific deltas** (file paths, exact feature flags, exact commands, exact lints, plan-level test mapping).

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions
- **Tech stack:** Rust stable, Win32 native via the `windows` crate; no GUI framework wrappers (`iced`, `egui`, `slint`, `tauri`).
- **Crate allowlist for v1:** `windows` (or `windows-sys`), `regex`, `serde` + `serde_json`, `encoding_rs`. Anything beyond that requires explicit rationale.
- **No async runtime.** Win32 message loop is the only event source. `tokio` / `async-std` are not allowed.
- **Build:** `cargo build --release` produces a single `.exe`. No external resource files at runtime — bake icons / language definitions into the binary.
- **Performance budgets:** open + tokenize 1MB <500ms, regex find on 1MB <100ms, keystroke-to-paint <16ms.
- **Platform target:** Windows 10 (1809+) and Windows 11. No Windows 7/8.
- **Binary size:** < 10MB (CI-asserted from Phase 1 onward).
- **`windows` (typed) at 0.62.2, NOT `windows-sys`** — `windows-sys` 0.61.x lacks `Win32_UI_Controls_RichEdit` feature flag.
- **MSRV: Rust 1.82** (driven by `windows` 0.62.x). Pin via `rust-toolchain.toml`.
- **Build target: `x86_64-pc-windows-msvc`.** MSVC only.
- **`[profile.release]`:** `opt-level="z"`, `lto="fat"`, `codegen-units=1`, `strip="symbols"`, `panic="abort"`.
- **Plan 01 lock-in:** Use **RichEdit 4.1 (`MSFTEDIT_CLASS` from `msftedit.dll`)** as the text viewport for v1. Document v2 escape hatch (Direct2D + DirectWrite custom render). Inflection point: syntax highlighting >1MB files where `EM_SETCHARFORMAT` becomes the bottleneck.
- **`LoadLibraryW("Msftedit.dll")`** once at startup before creating the control.
- **Disable `EM_AUTOURLDETECT`** at create time.
- **Use `EM_STREAMIN`** for file open (NOT `EM_SETTEXTEX` — it normalizes line endings).
- **QUAL-01:** `panic = "abort"` in `[profile.release]`.
- **QUAL-02:** Window state via `GWLP_USERDATA` round-trip from `WM_NCCREATE`. NO `static mut`. Enable `#![deny(static_mut_refs)]`.
- **QUAL-03:** `catch_unwind` around the WndProc body. Ban `unwrap`/`expect`/`RefCell` in code reachable from message loop. `#![deny(clippy::unwrap_used, clippy::expect_used)]` in `src/window.rs` and `src/render.rs`.
- **QUAL-04:** `OleInitialize(NULL)` at startup, paired with `OleUninitialize` at shutdown. NEVER `CoInitializeEx`.
- **Reentrancy:** never hold `&mut App` across `SendMessage`. Take borrow once per WndProc dispatch, drop before return.
- **Buffer choice:** RichEdit owns the visible text in v1 — gap-buffer-vs-piece-table micro-decision is **deferred**. Plan 01 must NOT build a buffer abstraction Phase 1 doesn't need.
- **CLI:** `std::env::args` for path argument; pass into same code path as File→Open. Open file *after* window creation (so error dialog has parent window).
- **File I/O for Phase 1 only:** read/write UTF-8 (no BOM, ASCII-safe content). Round-trip test = unmodified open-then-save preserves byte-exact bytes for ASCII content. Full encoding cascade is Phase 2.
- **Per-tab undo bounded ~1000 ops:** for Phase 1 (single tab), RichEdit's built-in undo is acceptable. The bounded-`VecDeque<Edit>` shape is for v2 if/when we own the buffer.
- **Bounding the undo at the chokepoint:** property test `redo(undo(state)) == state`.
- **TEST-01 foundation:** Phase 1 lays foundation toward ≥30 cumulative tests by ship.
- **TEST-05:** Undo/redo property test (`redo(undo(s)) == s`) plus coalescing tests.
- **CI gates landing in Phase 1:** `cargo build --release`, binary-size check (<10MB) failing build if exceeded, `cargo clippy` with deny lints, `cargo test`.

### Claude's Discretion
- Specific module file layout within the `main.rs` / `window.rs` / `editor.rs` / `render.rs` / `file.rs` skeleton.
- Internal struct names, method names, error type names.
- The `windows` feature flag set (start minimal, add as needed).
- The exact `catch_unwind` recovery strategy (log + show toast vs log + exit gracefully).
- Whether to use `windows::core::Result<T>` directly or wrap in a project-local error enum.
- Test fixture files for the round-trip test.
- Comment density and inline-doc style.
- Whether to ship `rust-toolchain.toml` or document MSRV in `Cargo.toml`'s `rust-version` field (or both).
- The CI provider (`actions/setup-rust`, etc.).

### Deferred Ideas (OUT OF SCOPE for Phase 1)
- Multi-tab + per-tab state — Phase 3.
- Full encoding cascade (UTF-8 BOM, UTF-16 LE/BE, CP1252, EOL detection, conversion menu) — Phase 2.
- Find/Replace + regex — Phase 3.
- Syntax highlighting (5 languages) — Phase 4.
- Line-number gutter, status bar — Phase 4.
- Word wrap toggle, recent files, drag-and-drop — Phase 5.
- Dogfood marker on Cargo.toml — verified in Phase 5/6.

Phase 1 must NOT pull these forward, and must NOT build abstractions that exist only to support them.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| FILE-01 | User can open file via File→Open menu (Ctrl+O) | `GetOpenFileNameW` (Win32 common dialog) → `std::fs::read` → `EM_STREAMIN` into RichEdit. |
| FILE-02 | Launch with path arg (`notepadrs.exe path\to\file.txt`) opens at startup | `std::env::args().nth(1)` after window creation, share code path with FILE-01. |
| EDIT-01 | Cut (Ctrl+X) | RichEdit built-in via `WM_CUT` (translated from accelerator). |
| EDIT-02 | Copy (Ctrl+C) | RichEdit built-in via `WM_COPY`. |
| EDIT-03 | Paste (Ctrl+V) | RichEdit built-in via `WM_PASTE`. |
| EDIT-04 | Select All (Ctrl+A) | `EM_SETSEL(0, -1)` from accelerator. |
| EDIT-05 | Undo (Ctrl+Z), bounded ~1000 ops | RichEdit built-in `EM_UNDO`. Set `EM_SETUNDOLIMIT(1000)` at create time. |
| EDIT-06 | Redo (Ctrl+Y), redo stack clears on new edit | RichEdit built-in `EM_REDO` (auto-clears redo on new edit). |
| BUILD-01 | `cargo build --release` produces single `notepadrs.exe` | Pure Cargo configuration; no subcrates in workspace. |
| BUILD-02 | Release binary <10MB (CI assertion) | `[profile.release]` cocktail + CI step that `stat`s the .exe and fails if >10MB. |
| BUILD-03 | Runtime depends only on Windows-10-shipped DLLs | `dumpbin /dependents` check; static-link CRT via `+crt-static` rustflag OR avoid that flag and accept `vcruntime140.dll` (which ships with VS redistributable). Decision: use `+crt-static` to avoid the redistributable dependency entirely (RichEdit `msftedit.dll`, kernel32.dll, user32.dll, gdi32.dll, ole32.dll, comdlg32.dll, shell32.dll all ship in-box). |
| BUILD-04 | Targets `x86_64-pc-windows-msvc`; supports Win10 1809+ / Win11 only | `rust-toolchain.toml` pins target; embedded application manifest sets supported-OS GUIDs. |
| BUILD-05 | MSRV is Rust 1.82; `rust-toolchain.toml` pins this | `rust-toolchain.toml` with `channel = "1.82.0"` (or `>=1.82` and `cargo` enforces it). |
| QUAL-01 | `[profile.release]` cocktail | Cargo.toml profile section; verified by CI building release. |
| QUAL-02 | Window state via `GWLP_USERDATA`, no `static mut` | `#![deny(static_mut_refs)]` in `src/window.rs`. |
| QUAL-03 | `catch_unwind` around WndProc body; deny `unwrap`/`expect` in WndProc-reachable modules | `#![deny(clippy::unwrap_used, clippy::expect_used)]` in `src/window.rs` and `src/render.rs`. Integration test injects panic via dev-only message. |
| QUAL-04 | `OleInitialize(NULL)` at startup, `OleUninitialize` at shutdown | Called from `WinMain` before window creation. |
| QUAL-05 | Keystroke-to-paint <16ms for 1MB buffer | Inherited from RichEdit; no Phase-1-specific work (validated cumulatively at ship). |
| QUAL-06 | Open + tokenize 1MB <500ms | No tokenizer in Phase 1 (Phase 4); this requirement is a forward-looking budget — Phase 1 must not regress it. Open path uses `std::fs::read` + `EM_STREAMIN`, both O(n) and well under 500ms for 1MB. |
| QUAL-07 | Regex find on 1MB <100ms | No find in Phase 1 (Phase 3); forward-looking budget. |
| TEST-01 | ≥30 cumulative tests by ship; Phase 1 lays foundation | Phase 1 contributes: undo property test, UTF-8 ASCII round-trip test, panic-resilience integration test, lint enforcement tests. Estimated Phase 1 contribution: 8–12 tests. |
| TEST-05 | Undo/redo property test (`redo(undo(s)) == s`) plus coalescing tests | Pure-logic test in `tests/undo_property.rs` over RichEdit's `EM_UNDO`/`EM_REDO` semantics OR over a phase-1 model that simulates them. Decision below. |
</phase_requirements>

## Summary

Phase 1 stands up the **build-order spine** (`main.rs` → `window.rs` (WndProc + `GWLP_USERDATA` trampoline + `catch_unwind`) → `app.rs` (root state, single-tab `EditorState`) → `editor.rs` (RichEdit child window wrapper) → `file.rs` (UTF-8 ASCII open/save)) plus the four critical pitfalls (panic discipline, `GWLP_USERDATA`, `OleInitialize`, `[profile.release]` cocktail) plus the binary-size CI gate. Until "open a UTF-8 file, type, save" works, nothing else has anything to integrate against.

**Primary recommendation:** Land the spine and CI gates as **four plans** in three waves: (Wave 1) `01-01` Cargo + toolchain + release-profile + CI scaffolding (no code yet, but every flag and lint is in writing); (Wave 2 parallel) `01-02` window lifecycle (WndProc + `GWLP_USERDATA` + `catch_unwind` + `OleInitialize` + RichEdit child + accelerators for cut/copy/paste/select-all/undo/redo) and `01-03` file I/O (UTF-8 open/save + CLI arg + File→Open dialog + Ctrl+S); (Wave 3) `01-04` test harness consolidation and panic-injection integration test.

## Standard Stack

### Core (Phase-1 subset of project allowlist)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `windows` | 0.62.2 | Win32 API bindings | Microsoft-official; required for `MSFTEDIT_CLASS`/RichEdit messages and `OleInitialize`/`OleUninitialize`. |
| `std` | (1.82) | `std::fs::read`/`write`, `std::env::args`, `std::panic::catch_unwind`, `std::collections::VecDeque` (for v2-undo-shape if used) | Built-in. |

### Phase-1 `windows` crate features (minimal — every feature has a binary-size cost)

```toml
[dependencies.windows]
version = "0.62"
features = [
    # Window lifecycle
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_System_LibraryLoader",       # LoadLibraryW for msftedit.dll
    # RichEdit child control
    "Win32_UI_Controls",
    "Win32_UI_Controls_RichEdit",        # MSFTEDIT_CLASS, EM_STREAMIN, EM_SETUNDOLIMIT
    # File→Open common dialog
    "Win32_UI_Shell",                    # GetOpenFileNameW resides under Win32_UI_Controls.Dialogs in newer crate; verify on docs.rs
    # COM apartment + OLE
    "Win32_System_Com",
    "Win32_System_Ole",
    # Painting (RichEdit paints itself; we only need WM_PAINT default-handling)
    "Win32_Graphics_Gdi",
    # Application manifest / DPI awareness (Phase 1 sets per-monitor v2 awareness)
    "Win32_UI_HiDpi",
]
```

**Note on `GetOpenFileNameW` location:** in `windows` 0.62.x, `GetOpenFileNameW` is under `Win32::UI::Controls::Dialogs`. The umbrella feature flag is `Win32_UI_Controls_Dialogs` — verify exact name on docs.rs at plan-execution time and add if needed. The above feature list is a **minimum**; the executor may add **only** what's required for FILE-01 / FILE-02 and must justify each addition in the plan summary.

### Supporting (none for Phase 1)

`regex`, `serde`, `serde_json`, `encoding_rs` are project-allowed but **NOT used in Phase 1**:
- `regex`: Phase 3 (find/replace).
- `serde`/`serde_json`: Phase 5 (recent files).
- `encoding_rs`: Phase 2 (full cascade). Phase 1 uses raw `std::fs::read` with the UTF-8-ASCII assumption.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| RichEdit 4.1 (`MSFTEDIT_CLASS`) | Custom render with Direct2D + DirectWrite | LOCKED to RichEdit per context.md. Custom render is the v2 escape hatch when syntax highlighting >1MB hits `EM_SETCHARFORMAT` ceiling. |
| RichEdit's built-in undo (`EM_UNDO`) | Hand-rolled `VecDeque<Edit>` with coalescing | LOCKED: Phase 1 uses RichEdit's built-in undo (which has coalescing and bounded depth). Set bound via `EM_SETUNDOLIMIT(1000)`. The `VecDeque<Edit>` shape is for v2. |
| `panic = "abort"` | `panic = "unwind"` + actual panic recovery | LOCKED: `abort` per project decision (saves ~10–15% binary, prevents partial-state survival on panic). `catch_unwind` still wraps WndProc — under `panic=abort` it's a no-op but the discipline is in place for dev builds (`cargo test` and `cargo run --debug`) where unwinding is on. |
| `+crt-static` rustflag for static CRT linkage | Dynamic CRT (`vcruntime140.dll`) | LOCKED via BUILD-03: static link to avoid the redistributable. Cost: ~200–500KB binary growth (acceptable, well under 10MB ceiling). |

**Toolchain installation (one-time):**

```powershell
rustup toolchain install 1.82.0
rustup target add x86_64-pc-windows-msvc
```

## Architecture Patterns

### Recommended Project Structure (Phase 1 subset)

```
notepadrs/
├── Cargo.toml                    # [package] + [dependencies] + [profile.release] cocktail
├── rust-toolchain.toml           # channel = "1.82.0", target = "x86_64-pc-windows-msvc"
├── build.rs                      # embeds the application manifest (DPI awareness + supported-OS)
├── notepadrs.manifest            # XML manifest enabling per-monitor v2 DPI + Win10/11 supported-OS GUIDs
├── src/
│   ├── main.rs                   # WinMain entry, OleInitialize, register window class, create window, msg loop, OleUninitialize
│   ├── app.rs                    # struct App { editor: EditorState }   single-tab in Phase 1
│   ├── window.rs                 # extern "system" wnd_proc + GWLP_USERDATA + catch_unwind + dispatch by msg
│   ├── editor.rs                 # struct EditorState — RichEdit child HWND, current file path, undo limit setup
│   ├── file.rs                   # open(path) -> Result<String>, save(path, &str) -> Result<()>; UTF-8 ASCII only for Phase 1
│   ├── menu.rs                   # File→Open / File→Save / File→Exit, accelerators (Ctrl+O / Ctrl+S / Ctrl+Q)
│   └── error.rs                  # enum Error wrapping std::io::Error and windows::core::Error
├── tests/
│   ├── undo_property.rs          # TEST-05: redo(undo(s)) == s
│   ├── roundtrip_utf8_ascii.rs   # FILE-01/FILE-02 + Ctrl+S round-trip on ASCII fixtures
│   └── panic_safety.rs           # QUAL-03: dev-only WM_USER+1 message that panics; assert process survives
├── tests/fixtures/
│   ├── ascii_lf.txt
│   └── ascii_only.txt
└── .github/workflows/
    └── ci.yml                    # build, clippy, test, binary-size assertion
```

**Rationale for departing from `architecture.md`'s richer structure:** project-level architecture.md anticipates the v1-final layout (`editor/` folder with `buffer.rs`/`cursor.rs`/`undo.rs`, `render/` folder, `syntax/`, `find.rs`, `worker.rs`, `recent.rs`, `tabs.rs`). For Phase 1 with RichEdit owning text/cursor/undo, those abstractions are unjustified. Plans must NOT build a `buffer.rs` Phase 1 doesn't need ("speculative generality" anti-pattern from project.md). The full structure lands incrementally in Phases 2–5 as features come online.

### Pattern 1: WndProc Trampoline with `GWLP_USERDATA` (QUAL-02)

**What:** `WM_NCCREATE` recovers `Box<App>` from `CREATESTRUCT.lpCreateParams`, stashes the raw pointer via `SetWindowLongPtrW(hwnd, GWLP_USERDATA, ptr as isize)`. Every subsequent message recovers via `GetWindowLongPtrW`. `WM_NCDESTROY` reclaims the `Box<App>` via `Box::from_raw` to drop cleanly.

**When to use:** Always for Win32 GUI in Rust. Source: `architecture.md` Pattern 1 (HIGH confidence, Microsoft Learn + Rust users forum).

**Phase 1 specifics:**
- The pointer must be installed in `WM_NCCREATE`, not `WM_CREATE` (NCCREATE comes earlier and is the documented hook for this pattern).
- Reentrancy: every handler does `let app = unsafe { &mut *(GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut App) };` and **drops the borrow before any `SendMessage` call**. To enforce this, do not assign `&mut app.editor` at the top of the handler; instead, re-borrow per branch.
- `WM_NCDESTROY` calls `Box::from_raw(ptr)` to reclaim the box; without this we leak `App` (acceptable since process is exiting, but explicit cleanup is cleaner and removes Miri/Valgrind warnings).

### Pattern 2: `catch_unwind` Trampoline (QUAL-03)

**What:** The `extern "system" fn wnd_proc` body wraps the dispatch inside `std::panic::catch_unwind(AssertUnwindSafe(|| { ... }))`. On `Err`, log to `OutputDebugStringW` and return `DefWindowProcW(hwnd, msg, wparam, lparam)` so the OS gets a sane reply.

**When to use:** Always — see Pitfall 1 in `pitfalls.md` (HIGH confidence). Even under `panic = "abort"` (release), the wrapper is a no-op and costs nothing; under unwinding panic (default `cargo test` and `cargo run --debug`), it prevents the process from dying on a buggy handler.

**Phase 1 specifics:**
- `AssertUnwindSafe` is required because `&mut App` is not `UnwindSafe` (`App` contains `HWND` which is `UnwindSafe` but the `&mut` reference taints the closure). The assertion is sound here because we do not access partially-mutated state after a panic — we just return `DefWindowProcW`.
- Log via `OutputDebugStringW("notepadrs WndProc panic: <msg>")` — this requires a manual `format!` of the `Box<dyn Any>` payload (downcast to `&str` and `&String`). The integration test for QUAL-03 (panic injection) reads from `OutputDebugString` is NOT trivial; instead, the test sets a static `AtomicBool` "panic_was_caught" inside the catch handler and asserts it became `true`.

### Pattern 3: `OleInitialize` at Startup (QUAL-04)

**What:** First call in `WinMain` (after parsing CLI args) is `OleInitialize(None)`. Pair with `OleUninitialize()` at the end of `WinMain` (after the message loop returns).

**When to use:** Always for any Win32 app that may use OLE (drag-drop, RichEdit's `IDropTarget`, the common-dialog `GetOpenFileNameW` chain). Source: `pitfalls.md` Pitfall 7 (HIGH confidence).

**Phase 1 specifics:**
- Even though Phase 1 doesn't ship drag-drop (Phase 5) or RichEdit OLE callbacks, calling `OleInitialize` now establishes the **STA threading model** for the UI thread permanently. Once set, it cannot be changed. Doing it later means SC-10 silently breaks with `E_OUTOFMEMORY` and is hard to debug.
- `OleInitialize` returns `S_OK` or `S_FALSE` (already initialized). Both are success. Only `RPC_E_CHANGED_MODE` is a true failure (means another component on the thread already initialized COM with a conflicting mode). For Phase 1 that's an unrecoverable startup error — show a `MessageBoxW` and exit.

### Pattern 4: RichEdit Child Window Setup

**What:** Create a single child RichEdit window filling the client area of the main window. On startup: `LoadLibraryW("msftedit.dll")` (returns `HMODULE`; we ignore the value but the load **must** happen before `CreateWindowExW` of `MSFTEDIT_CLASS`). Create the control with styles `WS_CHILD | WS_VISIBLE | WS_VSCROLL | ES_MULTILINE | ES_AUTOVSCROLL | ES_NOHIDESEL`. After creation:
- `SendMessageW(hwnd_re, EM_SETUNDOLIMIT, 1000, 0)` — bound undo per EDIT-05.
- `SendMessageW(hwnd_re, EM_AUTOURLDETECT, 0 /* AURL_ENABLEURL=0 disables */, 0)` — disable auto-URL detection per project decision.
- `SendMessageW(hwnd_re, EM_SETEVENTMASK, 0, ENM_NONE)` — Phase 1 doesn't need notifications (`EN_CHANGE`, etc.); add later when dirty-flag tracking lands.

**When to use:** Always (Phase 1's only edit control).

**Phase 1 specifics:**
- `LoadLibraryW("msftedit.dll")` is the modern (RichEdit 4.1) class loader. The older `riched20.dll` is `RICHEDIT_CLASS` (RichEdit 2.0/3.0); we want `MSFTEDIT_CLASS` from `msftedit.dll`.
- Place the RichEdit window so it fills the client rect; on `WM_SIZE` of the main window, call `MoveWindow(hwnd_re, 0, 0, cx, cy, TRUE)`.
- `WM_SETFONT` with a fixed-width font (Consolas or Cascadia Mono) makes the editor feel like a code editor; **Phase 1 may use the system default** (deferred polish) — but if shipping the default is too ugly to dogfood, `CreateFontW` with `Consolas, 10pt` is one extra task. **Decision: Phase 1 sets `Consolas 10pt`** because the dogfood marker pre-test (read this file in notepadrs) is more meaningful with monospace.

### Pattern 5: File Open / Save for UTF-8 ASCII (FILE-01, FILE-02)

**What:** UTF-8 ASCII open/save for Phase 1 only. No encoding detection (Phase 2). Algorithm:

**Open:**
1. Parse path: `std::env::args().nth(1)` for CLI, or `GetOpenFileNameW` for File→Open.
2. `std::fs::read(&path) -> Vec<u8>`.
3. `std::str::from_utf8(&bytes)` — if `Err`, show MessageBoxW "File is not valid UTF-8 ASCII (Phase 2 will add encoding detection)" and bail.
4. Convert to UTF-16 via `bytes.encode_utf16().collect::<Vec<u16>>()` then NUL-terminate.
5. `SendMessageW(hwnd_re, WM_SETTEXT, 0, utf16_ptr as LPARAM)` — for Phase 1 ASCII content, `WM_SETTEXT` is acceptable. Per context.md, `EM_STREAMIN` is the production path; we use `WM_SETTEXT` for Phase-1 simplicity and lock the `EM_STREAMIN` switch in Phase 2 (where line-ending preservation matters). **Decision: use `EM_STREAMIN` from day one** — the streaming callback is ~20 LOC, prevents the line-ending normalization bug Phase 2 would otherwise have to fix, and matches the locked decision in context.md.
6. `SendMessageW(hwnd_re, EM_SETMODIFY, 0, 0)` — clear the modified flag (we just loaded fresh content).

**Save:**
1. `SendMessageW(hwnd_re, EM_GETTEXTLENGTHEX, ...)` to get UTF-16 length, allocate buffer, `EM_STREAMOUT` (or `WM_GETTEXT` for Phase 1).
2. UTF-16 → UTF-8 via `String::from_utf16(&buf)`. If `Err`, show MessageBoxW and bail.
3. `std::fs::write(&path, &utf8_bytes)`.

**Why use `EM_STREAMIN`/`EM_STREAMOUT`:**
- `EM_SETTEXTEX` silently normalizes line endings (CRLF → CR per Microsoft docs). Phase 1's ASCII round-trip test would fail if the source file uses CRLF.
- `EM_STREAMIN` accepts a callback that delivers raw bytes; we can pass UTF-8 bytes directly with `SF_TEXT | SF_USECODEPAGE | (CP_UTF8 << 16)` flags. This preserves whatever line endings the source file has.
- For Phase 1 ASCII content with LF endings, both paths work; choosing `EM_STREAMIN` now means Phase 2 doesn't have to switch.

**When to use:** Always for FILE-01 / FILE-02. Source: `architecture.md` File Open Flow + `pitfalls.md` Pitfall 4.

### Pattern 6: Accelerator Table for Cut/Copy/Paste/SelectAll/Undo/Redo/Open/Save

**What:** RichEdit handles `WM_CUT`/`WM_COPY`/`WM_PASTE` internally when those messages arrive; the accelerator table maps Ctrl+X → `WM_CUT` etc. and routes them to the focused control (RichEdit). For Ctrl+A, `EM_SETSEL(0, -1)`. For Ctrl+Z/Y, `EM_UNDO`/`EM_REDO`. For Ctrl+O/S/Q, custom command IDs that File menu also dispatches.

**Phase 1 specifics:**
- Accelerator table built via `CreateAcceleratorTableW` with an `ACCEL[]` array. Loaded once at startup; stored in `App` so the message loop can pass it to `TranslateAcceleratorW(hwnd, accel, &mut msg)` between `GetMessage` and `TranslateMessage`.
- The standard idiom: `if !TranslateAcceleratorW(hwnd_main, accel, &mut msg).as_bool() { TranslateMessage(&msg); DispatchMessage(&msg); }`.
- Accelerators must dispatch to the **main window**, which routes commands to the active RichEdit child. This means `WM_COMMAND` handlers in `wnd_proc` for the custom IDs (`IDM_FILE_OPEN`, `IDM_FILE_SAVE`, etc.) and `WM_CUT`/`WM_COPY`/`WM_PASTE` forwarded via `SendMessageW(hwnd_re, msg, 0, 0)`.

### Anti-Patterns to Avoid (Phase-1-specific)

| Anti-pattern | Why bad | What to do instead |
|---|---|---|
| Build a `gap_buffer.rs` "in case Phase 4 needs it" | Speculative generality. Phase 1 doesn't need a buffer — RichEdit owns text. Project.md explicitly bans "no half-finished implementations." | Defer all buffer code to v2 / Phase-where-RichEdit-is-replaced. |
| Use `static mut APP: Option<App> = None` because the WndProc has no `&mut self` | UB; aliasing on reentrant message dispatch. | `GWLP_USERDATA` round-trip — Pattern 1 above. |
| Put `unwrap()` in any handler "to fix later" | Pitfall 1 in pitfalls.md — first surprising input crashes the editor and loses the buffer. | `#![deny(clippy::unwrap_used)]` in `src/window.rs` + `src/render.rs` (the WndProc-reachable modules). Bubble errors via `Result<LRESULT, Error>` and log on `Err`. |
| Call `CoInitializeEx(NULL, COINIT_APARTMENTTHREADED)` "because that's what C++ examples show" | Pitfall 7: drag-drop will silently fail in Phase 5 with `E_OUTOFMEMORY`. | `OleInitialize(None)` per Pattern 3. |
| Use `EM_SETTEXTEX` to load file content because it's simpler | Silently normalizes line endings (Pitfall 4). Phase 2's round-trip test would fail. | `EM_STREAMIN` with `SF_TEXT | (CP_UTF8 << 16)` per Pattern 5. |
| Set `panic = "unwind"` in release "for safety" | Adds ~10–15% binary size; overlaps with `catch_unwind` we already have. The tradeoff is wrong: we want abort on release to keep size down, and dev builds (which test the panic-injection integration test) already use `unwind`. | LOCKED: `panic = "abort"` in `[profile.release]`. Dev/test builds inherit `unwind` from the dev profile. |

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Text editing primitives (caret, selection, click-to-position, double-click-word, IME) | Custom-render text engine | RichEdit 4.1 (`MSFTEDIT_CLASS`) | 5–8 person-weeks saved per stack.md. Locked decision. |
| File→Open dialog | Custom file picker | `GetOpenFileNameW` (Common Item Dialog) | Built-in, theme-aware, free. |
| Undo/redo state machine for Phase 1 | Custom `VecDeque<Edit>` | RichEdit's built-in `EM_UNDO`/`EM_REDO` (bounded via `EM_SETUNDOLIMIT`) | RichEdit owns the buffer; rolling our own would mean intercepting every keystroke. The bounded `VecDeque<Edit>` shape comes back in v2 if/when we own the buffer. |
| Clipboard plumbing | Custom `OpenClipboard`/`SetClipboardData` | RichEdit's built-in `WM_CUT`/`WM_COPY`/`WM_PASTE` | Free with the control. |
| Status bar | Custom paint | (Deferred to Phase 4 — `STATUSCLASSNAME`) | Out of scope for Phase 1. |

**Key insight:** Phase 1 succeeds by **not building things RichEdit gives free.** Every line of code in `editor.rs` is suspect — most editor concerns are RichEdit's job in v1.

## Common Pitfalls (Phase-1 specific — see `.planning/research/pitfalls.md` for full set)

### Pitfall A: Forgetting `LoadLibraryW("msftedit.dll")` before `CreateWindowExW(MSFTEDIT_CLASS, ...)`

**What goes wrong:** `CreateWindowExW` returns `NULL` with `GetLastError() == ERROR_CANNOT_FIND_WND_CLASS`. Editor exits with empty window or panics on the unwrap.

**Why:** RichEdit 4.1's class is registered when `msftedit.dll` loads. Some Windows configurations don't auto-load it (it's a "delayed" library). Calling `LoadLibraryW` forces registration.

**How to avoid:** First line of window initialization: `let _ = LoadLibraryW(w!("msftedit.dll"))?;`. Don't bother freeing — the DLL stays loaded for app lifetime.

**Warning signs:** `CreateWindowExW` returns null when creating the RichEdit child but the main window creates fine.

### Pitfall B: `WM_NCCREATE` returning `0` instead of calling `DefWindowProcW`

**What goes wrong:** Window creation is aborted; no error visible.

**Why:** `WM_NCCREATE` must return non-zero from `DefWindowProcW` for the window to actually be created. Custom handlers that just return `0` after stashing the userdata kill the window.

**How to avoid:** After stashing the userdata pointer, **call `DefWindowProcW(hwnd, msg, wparam, lparam)`** and return its result.

### Pitfall C: Cargo.toml `[profile.release]` without `[profile.release.package."*"]` not catching dependency-side optimization

**What goes wrong:** `windows` crate's generated code is optimized at the call sites but the dependency itself still has `opt-level = 3` for sub-deps that recompile separately. Binary stays larger than expected.

**Why:** Cargo profiles apply to the workspace's compilation but each dep can opt out via its own profile overrides — usually they don't, but `windows` has internal helpers that do.

**How to avoid (Phase 1):** Trust the standard cocktail; verify with `cargo bloat --release -n 30` at end of Phase 1. The expected binary is 1–3 MB per stack.md. If it's >5MB, audit features and re-run bloat. **Don't preemptively add `[profile.release.package."*"]` overrides** — they can backfire (some deps need `opt-level=3` for correctness in proc-macros).

### Pitfall D: CI binary-size assertion using `du` or `ls -la` in a shell that's not Bash on Windows

**What goes wrong:** GitHub Actions runner uses PowerShell on Windows by default; `du -h` doesn't exist there.

**How to avoid:** Use `Get-Item target\release\notepadrs.exe | ForEach-Object { $_.Length }` in PowerShell, or specify `shell: bash` on the step. Recommended: PowerShell-native one-liner that fails the build:

```powershell
$size = (Get-Item target\release\notepadrs.exe).Length
$max = 10485760  # 10 MB
if ($size -gt $max) {
  Write-Error "Binary $size bytes exceeds 10MB ceiling ($max bytes)"
  exit 1
}
Write-Host "Binary size: $size bytes (under 10MB ceiling)"
```

### Pitfall E: `EM_STREAMIN` callback signature in Rust (`windows` crate vs hand-rolled)

**What goes wrong:** The `EDITSTREAM` struct has a callback with C ABI `extern "system" fn(DWORD_PTR, *mut u8, LONG, *mut LONG) -> LONG`. Implementing it in Rust requires a `extern "system" fn` and passing self via the `dwCookie` field.

**How to avoid:** Standard FFI pattern — `extern "system" fn stream_in_cb(cookie: usize, buf: *mut u8, cb: i32, pcb: *mut i32) -> i32`. Cookie is `&mut StreamState` cast to `usize`. Read up to `cb` bytes from the source `Vec<u8>`, copy to `buf`, write count to `*pcb`, return 0 on success / non-zero on error.

**Reference implementation:** ~30 LOC in `editor.rs::stream_in_callback`. Test with a 1MB ASCII fixture to validate.

## Code Examples (verified patterns from Microsoft Learn / `windows` crate samples)

### Example 1: WndProc trampoline with `GWLP_USERDATA` + `catch_unwind`

```rust
// src/window.rs
use std::panic::{catch_unwind, AssertUnwindSafe};
use windows::Win32::Foundation::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use crate::app::App;

pub unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    // WM_NCCREATE: stash the App pointer.
    if msg == WM_NCCREATE {
        let cs = lparam.0 as *const CREATESTRUCTW;
        let app_ptr = (*cs).lpCreateParams as *mut App;
        SetWindowLongPtrW(hwnd, GWLP_USERDATA, app_ptr as isize);
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }

    // Recover &mut App from userdata. Null-check so DefWindowProcW handles
    // pre-NCCREATE messages.
    let app_ptr = GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut App;
    if app_ptr.is_null() {
        return DefWindowProcW(hwnd, msg, wparam, lparam);
    }

    // Wrap dispatch in catch_unwind. AssertUnwindSafe is sound because we
    // do not access partially-mutated state after a panic — we just return
    // DefWindowProcW.
    let result = catch_unwind(AssertUnwindSafe(|| {
        let app = &mut *app_ptr;
        crate::dispatch::handle_message(app, hwnd, msg, wparam, lparam)
    }));

    match result {
        Ok(lresult) => lresult,
        Err(payload) => {
            // Log the panic message (best-effort) and let DefWindowProcW reply.
            let msg_str = if let Some(s) = payload.downcast_ref::<&'static str>() {
                *s
            } else if let Some(s) = payload.downcast_ref::<String>() {
                s.as_str()
            } else {
                "(non-string panic payload)"
            };
            crate::log::oslog(&format!("notepadrs WndProc panic [msg=0x{:x}]: {}", msg, msg_str));
            #[cfg(test)]
            crate::test_hooks::PANIC_CAUGHT.store(true, std::sync::atomic::Ordering::Relaxed);
            DefWindowProcW(hwnd, msg, wparam, lparam)
        }
    }
}

// On WM_NCDESTROY (handled inside `dispatch::handle_message`): reclaim Box<App>.
// pub fn on_nc_destroy(hwnd: HWND) {
//     let ptr = unsafe { GetWindowLongPtrW(hwnd, GWLP_USERDATA) } as *mut App;
//     if !ptr.is_null() {
//         let _boxed = unsafe { Box::from_raw(ptr) };
//         unsafe { SetWindowLongPtrW(hwnd, GWLP_USERDATA, 0) };
//     }
// }
```

Source pattern: [Rust Tutorials: Triangle From Scratch — Win32](https://rust-tutorials.github.io/triangle-from-scratch/opening_a_window/win32.html) (HIGH confidence) + [windows-rs Issue #1061](https://github.com/microsoft/windows-rs/issues/1061) (HIGH confidence).

### Example 2: `OleInitialize` paired with `OleUninitialize`

```rust
// src/main.rs (excerpt)
use windows::Win32::System::Ole::*;

fn main_inner() -> windows::core::Result<i32> {
    unsafe {
        // STA apartment for the UI thread. Establishes OLE substructure required
        // for SC-10 drag-drop in Phase 5 — must be called before window creation.
        let hr = OleInitialize(None);
        if hr.is_err() && hr != HRESULT(0x8001_0106u32 as i32) /* RPC_E_CHANGED_MODE */ {
            // S_OK and S_FALSE are both success. Other failures are fatal.
            return Err(windows::core::Error::from(hr));
        }

        let result = run_app();  // creates main window + RichEdit, runs message loop

        OleUninitialize();
        result
    }
}

fn main() {
    let exit_code = match main_inner() {
        Ok(code) => code,
        Err(e) => {
            // Best-effort error UI then exit.
            eprintln!("notepadrs startup error: {:?}", e);
            1
        }
    };
    std::process::exit(exit_code);
}
```

Source: [Microsoft Learn: OleInitialize](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-oleinitialize) (HIGH).

### Example 3: `[profile.release]` cocktail (QUAL-01 / BUILD-02)

```toml
# Cargo.toml

[package]
name = "notepadrs"
version = "0.1.0"
edition = "2021"
rust-version = "1.82"

[dependencies.windows]
version = "0.62"
features = [
    "Win32_Foundation",
    "Win32_UI_WindowsAndMessaging",
    "Win32_UI_Controls",
    "Win32_UI_Controls_RichEdit",
    "Win32_UI_Controls_Dialogs",     # GetOpenFileNameW (verify exact path)
    "Win32_UI_Shell",
    "Win32_UI_HiDpi",
    "Win32_System_LibraryLoader",
    "Win32_System_Com",
    "Win32_System_Ole",
    "Win32_Graphics_Gdi",
]

[profile.release]
opt-level = "z"
lto = "fat"
codegen-units = 1
strip = "symbols"
panic = "abort"

# Static CRT linkage to satisfy BUILD-03 (no vcruntime140.dll dependency).
# Note: this also affects dev/test builds; a separate dev profile may relax it
# if test compile times suffer. For Phase 1 we accept the uniformity.
[profile.release.build-override]
debug = false
```

Plus `.cargo/config.toml`:

```toml
[target.x86_64-pc-windows-msvc]
rustflags = ["-C", "target-feature=+crt-static"]
```

Source: [min-sized-rust](https://github.com/johnthagen/min-sized-rust) (HIGH) + Cargo Profiles docs (HIGH).

### Example 4: CI binary-size assertion

```yaml
# .github/workflows/ci.yml (excerpt)
name: CI

on: [push, pull_request]

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - name: Install Rust 1.82.0
        uses: dtolnay/rust-toolchain@1.82.0
        with:
          targets: x86_64-pc-windows-msvc
          components: clippy
      - name: Build release
        run: cargo build --release --target x86_64-pc-windows-msvc
      - name: Assert binary size <10MB
        shell: pwsh
        run: |
          $exe = "target\x86_64-pc-windows-msvc\release\notepadrs.exe"
          if (-not (Test-Path $exe)) { throw "Binary not found: $exe" }
          $size = (Get-Item $exe).Length
          $max = 10485760
          Write-Host "Binary size: $size bytes ($([math]::Round($size/1MB, 2)) MB)"
          if ($size -gt $max) {
            Write-Error "Binary $size bytes exceeds 10MB ceiling ($max bytes)"
            exit 1
          }
      - name: Clippy (deny WndProc-reachable lints)
        run: cargo clippy --release --target x86_64-pc-windows-msvc -- -D warnings
      - name: Test
        run: cargo test --target x86_64-pc-windows-msvc
```

Source: GitHub Actions docs + dtolnay/rust-toolchain action (HIGH).

## State of the Art (Phase-1-relevant deltas vs older patterns)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `winapi` crate (frozen 2021) | `windows` 0.62.x | 2025 | Phase 1 must use `windows`, not `winapi`. |
| `windows-sys` for everything to keep size down | `windows` 0.62.x with surgical features | August 2025 | The `windows-link`/`raw-dylib` unification closed the size gap. `windows-sys` no longer exposes RichEdit features anyway. |
| `RICHEDIT_CLASS` (RichEdit 2.0/3.0, riched20.dll) | `MSFTEDIT_CLASS` (RichEdit 4.1, msftedit.dll) | 2010+ | Use `MSFTEDIT_CLASS`. The older class is unmaintained on Win10/11. |
| `static mut` window state | `GWLP_USERDATA` round-trip | Always | Never `static mut`. |
| `panic = "unwind"` for "safety" | `panic = "abort"` for binary size | 2020+ in editors | Locked decision; pairs with `catch_unwind` in dev builds. |
| Dynamic CRT (`vcruntime140.dll`) | `+crt-static` for self-contained .exe | 2020+ for distribution | BUILD-03 demands no third-party DLLs; `+crt-static` is the textbook fix. |

**Deprecated/outdated:**
- `lazy_static!` / `once_cell::sync::OnceCell` for window state — `std::sync::OnceLock` (Rust 1.70+) supersedes both, but for window state, `GWLP_USERDATA` is correct and neither alternative applies.
- `EM_SETTEXTEX` for file load — silently normalizes line endings; use `EM_STREAMIN`.

## Open Questions (Phase-1-specific)

1. **`Win32_UI_Controls_Dialogs` feature path in `windows` 0.62.2.**
   - What we know: `GetOpenFileNameW` is at `windows::Win32::UI::Controls::Dialogs::GetOpenFileNameW`.
   - What's unclear: Whether the umbrella feature flag is named `Win32_UI_Controls_Dialogs` or whether it's pulled in by `Win32_UI_Controls`. docs.rs feature page must be checked at execution time.
   - Recommendation: Plan 01-03 starts with `Win32_UI_Controls_Dialogs` in the feature list; if compile fails, the executor fixes by checking docs.rs feature flags and adjusting.

2. **Whether to use `Box<App>` or `Pin<Box<App>>`.**
   - What we know: `App` will not move once installed via `GWLP_USERDATA` (the raw pointer is stored).
   - What's unclear: Whether `App` contains any `!Unpin` types (it shouldn't in Phase 1 — no self-references, no async).
   - Recommendation: Use `Box<App>` (simpler). If `Phase 4`'s background tokenization adds self-referential structure, revisit.

3. **`EM_STREAMIN` vs simpler `WM_SETTEXT` for Phase 1 ASCII content.**
   - What we know: `EM_STREAMIN` is the locked decision per context.md and avoids the line-ending normalization bug.
   - What's unclear: Whether the implementation effort (FFI callback) is worth the Phase 1 simplicity tradeoff.
   - Recommendation: **Use `EM_STREAMIN` from day one.** ~30 LOC, reused in Phase 2. Any cheaper Phase 1 path would be wasted Phase 2 work.

## Validation Architecture

> Skipping per `workflow.nyquist_validation` is not set in `.planning/config.json` (only `workflow.research`, `workflow.plan_check`, `workflow.verifier`, `workflow.auto_advance` are present — nyquist defaults to false). This section is therefore optional, but Phase 1's CI gates inherit from BUILD/QUAL requirements which require every behavioral truth to have an automated verification command.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `cargo test` (built-in) |
| Config file | `Cargo.toml` (no `[tests]` block needed — convention-based discovery) |
| Quick run command | `cargo test --target x86_64-pc-windows-msvc` |
| Full suite command | `cargo test --target x86_64-pc-windows-msvc --release` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILE-01 | Open via menu (Ctrl+O) | T3 (manual smoke + integration) | Manual: launch + Ctrl+O + select fixture; Auto: covered by FILE-02 + roundtrip test | ❌ Wave 0 — `tests/roundtrip_utf8_ascii.rs` |
| FILE-02 | Launch with path arg | T3 (integration) | `cargo test --test roundtrip_utf8_ascii` (uses `Command::new(notepadrs.exe).arg(fixture)` path then asserts output) — but Phase 1 ASCII roundtrip can be tested by exposing `app::open_file(path) -> Result<()>` as a `pub(crate)` function and unit-testing it | ❌ Wave 0 |
| EDIT-01..04 | Cut/Copy/Paste/SelectAll | T3 (RichEdit-built-in; manual smoke is sufficient) | Manual checklist | ❌ N/A — RichEdit covers |
| EDIT-05/06 | Undo/Redo | T1 (property test on the model) | `cargo test --test undo_property` | ❌ Wave 0 — `tests/undo_property.rs` |
| BUILD-01 | `cargo build --release` produces .exe | T2 (CI verifies) | `cargo build --release --target x86_64-pc-windows-msvc` succeeds | n/a (build verification) |
| BUILD-02 | <10MB | T2 (CI verifies) | PowerShell size check (Example 4) | ❌ Wave 0 — `.github/workflows/ci.yml` |
| BUILD-03 | No third-party DLL deps | T2 (CI verifies via `dumpbin`) | `dumpbin /dependents target\release\notepadrs.exe` shows only Win-shipped DLLs | ❌ Wave 0 — CI step |
| BUILD-04 | MSVC target | T1 (cargo configuration) | `rustup target list --installed` shows `x86_64-pc-windows-msvc` | n/a |
| BUILD-05 | MSRV 1.82 | T1 (cargo configuration) | `cargo +1.82.0 build` succeeds; `Cargo.toml` has `rust-version = "1.82"` | n/a |
| QUAL-01 | release-profile cocktail | T1 (Cargo.toml inspection) | grep test that `Cargo.toml` contains the five flags | ❌ Wave 0 — `tests/cargo_profile.rs` |
| QUAL-02 | No `static mut` window state | T1 (lint) | `cargo clippy --release -- -D static_mut_refs` passes | n/a (lint) |
| QUAL-03 | `catch_unwind` + ban unwrap/expect in WndProc-reachable | T1 (lint) + T2 (panic-injection integration) | `cargo clippy ... -D clippy::unwrap_used -D clippy::expect_used` passes; `cargo test --test panic_safety` runs without process abort | ❌ Wave 0 — `tests/panic_safety.rs` |
| QUAL-04 | `OleInitialize` (not `CoInitializeEx`) | T1 (grep test) | grep test that `src/main.rs` contains `OleInitialize` and NOT `CoInitializeEx` | ❌ Wave 0 — `tests/com_init.rs` |
| QUAL-05/06/07 | Performance budgets | (deferred to ship) | n/a in Phase 1 | n/a |
| TEST-01 | ≥30 cumulative tests | T1 (count) | `cargo test 2>&1 \| Select-String "test result:"` cumulative count | n/a (cumulative across phases) |
| TEST-05 | Undo property test | T1 | `cargo test --test undo_property` | covered above |

### Sampling Rate
- **Per task commit:** `cargo test --target x86_64-pc-windows-msvc` (default profile)
- **Per wave merge:** `cargo build --release && cargo test --release && cargo clippy --release -- -D warnings`
- **Phase gate:** Full CI run (`.github/workflows/ci.yml`) green before `/pan:verify-phase`

### Wave 0 Gaps (test scaffolding required before implementation tasks)

- [ ] `tests/roundtrip_utf8_ascii.rs` — covers FILE-01, FILE-02 (UTF-8 ASCII open + save round-trip)
- [ ] `tests/undo_property.rs` — covers EDIT-05, EDIT-06, TEST-05 (property test using a model that mirrors RichEdit semantics, OR a direct RichEdit instance via test-only HWND creation — the model approach is simpler and tests the bound contract)
- [ ] `tests/panic_safety.rs` — covers QUAL-03 (creates a window, posts a dev-only `WM_USER+1` message that panics inside the handler, verifies process did not abort and `PANIC_CAUGHT` flag was set)
- [ ] `tests/cargo_profile.rs` — covers QUAL-01 (parses `Cargo.toml`, asserts `[profile.release]` contains all five flags)
- [ ] `tests/com_init.rs` — covers QUAL-04 (grep test against `src/main.rs`)
- [ ] `tests/fixtures/ascii_lf.txt` — fixture for round-trip (10–20 lines of pure ASCII with LF endings)
- [ ] `tests/fixtures/ascii_only.txt` — fixture for path-arg launch (single-line ASCII)
- [ ] `.github/workflows/ci.yml` — build, clippy, test, binary-size, dumpbin checks

## Sources

### Primary (HIGH confidence — verified at research time or pre-existing in `.planning/research/`)
- [Microsoft Learn: About Rich Edit Controls](https://learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls) — RichEdit 4.1 / `MSFTEDIT_CLASS`
- [Microsoft Learn: WM_NCCREATE](https://learn.microsoft.com/en-us/windows/win32/api/winuser/wm-nccreate) — userdata install hook
- [Microsoft Learn: GetOpenFileNameW](https://learn.microsoft.com/en-us/windows/win32/api/commdlg/nf-commdlg-getopenfilenamew) — File→Open dialog
- [Microsoft Learn: OleInitialize](https://learn.microsoft.com/en-us/windows/win32/api/ole2/nf-ole2-oleinitialize) — STA apartment for UI thread
- [Microsoft Learn: EM_STREAMIN](https://learn.microsoft.com/en-us/windows/win32/controls/em-streamin) — preserves line endings
- [docs.rs: windows 0.62.2 features](https://docs.rs/crate/windows/0.62.2/features) — feature flag matrix
- [min-sized-rust](https://github.com/johnthagen/min-sized-rust) — `[profile.release]` cocktail
- [GitHub microsoft/windows-rs Issue #1061](https://github.com/microsoft/windows-rs/issues/1061) — `catch_unwind` across FFI
- Project research files (all HIGH-confidence inheritance): `.planning/research/summary.md`, `stack.md`, `architecture.md`, `pitfalls.md`

### Secondary (MEDIUM confidence — community / single-source verified)
- [Rust Tutorials: Triangle From Scratch — Win32](https://rust-tutorials.github.io/triangle-from-scratch/opening_a_window/win32.html) — `GWLP_USERDATA` worked example
- [users.rust-lang.org: Idiomatic WNDPROC callback](https://users.rust-lang.org/t/idiomatic-way-to-pass-a-callback-wndproc-to-the-win32-api/87184) — community confirmation

## Infrastructure Dependencies

**None.** Phase 1 is a pure-Rust desktop binary with no external service, no Docker, no test infrastructure beyond `cargo test`. All tests are T1/T2 (unit + cargo-test integration); no T3 (E2E with running binary) is strictly required since the panic-safety test creates an HWND in-process. CI runs on `windows-latest` GitHub-hosted runners.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — inherited verbatim from `.planning/research/stack.md` with no Phase-1-specific deltas.
- Architecture: HIGH — inherited from `.planning/research/architecture.md`. The Phase-1-specific simplification (RichEdit owns text/cursor/undo, no `buffer.rs`/`undo.rs` yet) is a faithful application of the locked decision.
- Pitfalls: HIGH — inherited from `.planning/research/pitfalls.md`. Phase-1-specific pitfalls A–E are mechanical implementation gotchas verified against Microsoft Learn.

**Research date:** 2026-05-02
**Valid until:** 2026-06-02 (30 days; stack is stable. Re-validate `windows` crate version at start of Phase 2.)
