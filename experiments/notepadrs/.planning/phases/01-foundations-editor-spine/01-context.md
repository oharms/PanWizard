# Phase 1: Foundations + Editor Spine - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning
**Source:** Auto-mode synthesis (P-1803, v3.7.8) — derived from idea.md + project.md + requirements.md + roadmap.md without user dialogue

<domain>
## Phase Boundary

Stand up a single-tab UTF-8-only editor that opens via File→Open or CLI, supports full clipboard + bounded undo + redo, saves UTF-8 ASCII content correctly, and ships the four critical pitfalls + release-profile + binary-size CI gate as the structural skeleton everything else attaches to.

This phase delivers the **build-order spine**: `main.rs + WndProc + app.rs` → buffer/cursor → render → file I/O → undo. Until "open a UTF-8 file, type, save" works, nothing else has anything to integrate against. Multi-tab, encoding cascade, find/replace, syntax highlighting, gutter, status bar, recent files, drag-drop, and word wrap are all out of scope for this phase.

</domain>

<decisions>
## Implementation Decisions

### From idea.md (locked)
- **Tech stack:** Rust stable, Win32 native via the `windows` crate; no GUI framework wrappers (`iced`, `egui`, `slint`, `tauri`).
- **Crate allowlist for v1:** `windows` (or `windows-sys`), `regex`, `serde` + `serde_json`, `encoding_rs`. Anything beyond that requires explicit rationale.
- **No async runtime.** Win32 message loop is the only event source. `tokio` / `async-std` are not allowed.
- **Build:** `cargo build --release` produces a single `.exe`. No external resource files at runtime — bake icons / language definitions into the binary.
- **Performance budgets:** open + tokenize 1MB <500ms, regex find on 1MB <100ms, keystroke-to-paint <16ms.
- **Platform target:** Windows 10 (1809+) and Windows 11. No Windows 7/8.
- **Binary size:** < 10MB.
- **Code organization (suggested in idea.md, planner may adjust):** `src/main.rs` (entry + msg loop), `src/window.rs` (HWND lifecycle), `src/editor.rs` (text buffer + cursor), `src/render.rs` (paint), `src/find.rs`, `src/syntax/{js,py,json,md}.rs`, `src/encoding.rs`, `src/recent.rs`. For Phase 1 the relevant subset is `main.rs`, `window.rs`, `editor.rs` (buffer + cursor + undo), `render.rs`, plus a `file.rs` for UTF-8 open/save.
- **GUI surface decision (idea.md hint, must be locked in Plan 01):** RichEdit for v1 with custom gutter and tab strip layered on top — fastest to a working editor. Custom rendering is the v2 escape hatch.
- **Dogfood marker (project-level, not Phase 1):** v1 is "done" when the developer can use `notepadrs.exe` to open, edit, and save the project's own `Cargo.toml` without going back to another editor. Phase 1 only needs UTF-8 ASCII to work; full encoding lands in Phase 2.

### From research/summary.md (decisions inherited from research)
- **Use `windows` (typed) at 0.62.2, NOT `windows-sys`.** `windows-sys` 0.61.x lacks `Win32_UI_Controls_RichEdit`, `Win32_Graphics_Direct2D`, `Win32_Graphics_DirectWrite` feature flags. The compile-time gap closed in Aug 2025 — historical "windows-sys is leaner" no longer applies.
- **MSRV is Rust 1.82** (driven by `windows` 0.62.x), not 1.75 as idea.md says. `rust-toolchain.toml` should pin this.
- **Build target is `x86_64-pc-windows-msvc`.** MSVC only; do not ship MinGW/GNU.
- **`[profile.release]` cocktail (BUILD-02 / QUAL-01):** `opt-level = "z"`, `lto = "fat"`, `codegen-units = 1`, `strip = "symbols"`, `panic = "abort"`. Together these hit <10MB with margin (expected landing: 1–3 MB stripped).
- **Use the typed `windows::Win32::*` modules with surgical feature flags.** Plan 01 should land the minimal feature set needed to compile (likely `Win32_Foundation`, `Win32_UI_WindowsAndMessaging`, `Win32_UI_Controls`, `Win32_UI_Controls_RichEdit`, `Win32_System_LibraryLoader`, `Win32_Graphics_Gdi`, `Win32_System_Com`, `Win32_System_Ole`, `Win32_UI_Shell` for `WM_DROPFILES` later). Keep the feature list curated — it directly affects binary size.

### From research (UI surface — RichEdit decision must be locked in Plan 01)
- **Plan 01 lock-in:** Use **RichEdit 4.1 (`MSFTEDIT_CLASS` from `msftedit.dll`)** as the text viewport for v1. Rationale: saves ~5–8 person-weeks of IME, accessibility, undo, clipboard, click-selection work versus a custom-rendered text control. Document the v2 escape hatch (custom render with Direct2D + DirectWrite) and the inflection point (syntax highlighting >1MB files where RichEdit `EM_SETCHARFORMAT` becomes the bottleneck).
- **Must `LoadLibraryW("Msftedit.dll")` once at startup** before creating the control.
- **Disable `EM_AUTOURLDETECT`** at create time (RichEdit's built-in URL detection conflicts with the editor's role).
- **Use `EM_STREAMIN` for file open**, not `EM_SETTEXTEX`. `EM_SETTEXTEX` silently normalizes line endings; `EM_STREAMIN` lets us preserve them.
- **Per-tab undo bounded ~1000 ops** — for Phase 1 (single tab) this is just one bounded `VecDeque<Edit>`. RichEdit's built-in undo is acceptable for v1; the bounded-VecDeque shape is for v2 if/when we own the buffer.
- **Bounding the undo at the chokepoint** (single buffer-mutation function clears redo stack on every new edit) — get this right in Phase 1, not later. Property test: `redo(undo(state)) == state`.

### From research (the four critical pitfalls — MUST land in Phase 1)
- **QUAL-01 — `panic = "abort"`** in `[profile.release]`. Also saves 10–15% binary size. (Pitfall 1 + Pitfall 8.)
- **QUAL-02 — Window state via `GWLP_USERDATA` round-trip.** `Box<App>` raw pointer stashed in `WM_NCCREATE` via `CREATESTRUCT.lpCreateParams`, recovered with `GetWindowLongPtrW` per message. NO `static mut`, NO `Rc<RefCell>`, NO `Mutex` in the editor core. Enable `#![deny(static_mut_refs)]`. (Pitfall 2.)
- **QUAL-03 — `catch_unwind` around the WndProc body** + ban `unwrap()` / `expect()` / `RefCell` in any code reachable from the message loop. Use `#![deny(clippy::unwrap_used, clippy::expect_used)]` in `src/window.rs` and `src/render.rs`. (Pitfall 1.)
- **QUAL-04 — `OleInitialize(NULL)` at startup**, paired with `OleUninitialize` at shutdown. NEVER `CoInitializeEx`. SC-10 drag-drop in Phase 5 will silently break (`E_OUTOFMEMORY`) if this is wrong. Establish the COM apartment correctly on day one. (Pitfall 7.)

### From research (architecture inside Phase 1)
- **Reentrancy hazard:** never hold `&mut App` across `SendMessage`. Take the borrow once per WndProc dispatch, drop it before returning, never re-enter while held. Document this invariant in `window.rs`.
- **Buffer choice:** since RichEdit owns the visible text in v1, the gap-buffer-vs-piece-table micro-decision is deferred. For Phase 1 the editor sees text via `EM_STREAMIN`/`EM_STREAMOUT` and `EM_GETTEXTRANGE`. The hand-rolled gap buffer becomes relevant only when we move off RichEdit (v2). Plan 01 should explicitly defer this and not build a buffer abstraction Phase 1 doesn't need.
- **CLI argument handling:** `std::env::args` for the path argument; pass into the same code path as File→Open. Open the file *after* window creation so any error dialog has a parent window.
- **File I/O for Phase 1 only:** read/write UTF-8 (no BOM, ASCII-safe content). Round-trip test = unmodified open-then-save preserves byte-exact bytes for ASCII content. Full encoding cascade is Phase 2.

### From research (test posture)
- **TEST-01 (≥30 cumulative tests by ship)** — Phase 1 lays the foundation. Plan 01 should land at least:
  - Property test for undo: `redo(undo(s)) == s`.
  - Round-trip test for UTF-8 ASCII open→save (byte-exact when unmodified).
  - Integration test that injects a panic in the WndProc and verifies the process does NOT abort in dev builds (validates `catch_unwind`).
  - Clippy lint test enforcing `unwrap_used`/`expect_used`/`static_mut_refs` denials.
  - CI binary-size assertion (release build < 10MB).
- All tests must be `cargo test`. No external test services.

### CI gates landing in Phase 1
- `cargo build --release` step.
- Binary-size check (`< 10MB`) — fail the build if exceeded.
- `cargo clippy --release -- -D warnings -D clippy::unwrap_used -D clippy::expect_used` on WndProc-reachable modules.
- `cargo test`.

### Claude's Discretion
- Specific module file layout within the `main.rs` / `window.rs` / `editor.rs` / `render.rs` / `file.rs` skeleton (planner decides exact split).
- Internal struct names, method names, error type names.
- The `windows` feature flag set (start minimal, add as needed).
- The exact `catch_unwind` recovery strategy (log + show a toast vs log + exit gracefully — planner picks).
- Whether to use the `windows` crate's `core::Result<T>` directly or wrap in a project-local error enum for Phase 1's small surface.
- Test fixture files (which UTF-8 ASCII samples to use for the round-trip test).
- Comment density and inline-doc style.
- Whether to ship a `rust-toolchain.toml` or document the MSRV requirement in `Cargo.toml`'s `rust-version` field (or both).
- The CI provider (`actions/setup-rust`, etc.) is the planner's call given the constraints aren't specified.

</decisions>

<specifics>
## Specific References

- **`windows` crate docs:** https://docs.rs/windows/
- **Microsoft Win32 docs:** RichEdit (`RICHEDIT50W` / `MSFTEDIT_CLASS`), `WM_NCCREATE`, `GetWindowLongPtrW`, `GWLP_USERDATA`, `OleInitialize`, `OleUninitialize`, `EM_STREAMIN`, `EM_AUTOURLDETECT`, `EM_SETCHARFORMAT`.
- **`min-sized-rust`:** https://github.com/johnthagen/min-sized-rust — the canonical reference for the `[profile.release]` cocktail.
- **GitHub microsoft/windows-rs Issue #1061** — the canonical write-up for catching panics across the FFI boundary.
- **The user's idea.md `Notes` section explicitly asks the planner to lock the RichEdit-vs-custom decision in Plan 01 with rationale.** That commitment lives here: **RichEdit 4.1 / `MSFTEDIT_CLASS` for v1**, with a documented v2 escape hatch.

</specifics>

<deferred>
## Deferred Ideas

None — the auto-mode synthesis honors the original idea.md scope. The following items are explicitly deferred to other phases (already mapped in the roadmap):

- Multi-tab + per-tab state — Phase 3.
- Full encoding cascade (UTF-8 BOM, UTF-16 LE/BE, CP1252, EOL detection, conversion menu) — Phase 2.
- Find/Replace + regex — Phase 3.
- Syntax highlighting (5 languages) — Phase 4.
- Line-number gutter, status bar — Phase 4.
- Word wrap toggle, recent files, drag-and-drop — Phase 5.
- Dogfood marker on Cargo.toml — verified in Phase 5 / 6, not Phase 1.

Phase 1 must NOT pull any of those forward, and must NOT build abstractions that exist only to support them ("speculative generality" is explicitly out — see project.md "no half-finished implementations").

</deferred>

---

*Phase: 01-foundations-editor-spine*
*Context auto-synthesized: 2026-05-02 via discuss-phase P-1803 bypass — no user dialogue*
