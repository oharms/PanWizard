---
title: "notepadrs — native Windows text editor in Rust covering Notepad++'s major features"
created: "2026-05-02"
created_by: oharms
runtime_preference: claude
budget: 80
priority: high
---

# Idea: notepadrs

A native Windows text editor written in Rust using the Win32 API directly (no Electron, no cross-platform abstraction layer, no GUI framework wrapping). The goal is to cover the **major** features of Notepad++ — the ones a Notepad++ user actually reaches for daily — not to chase parity on every plugin and edge case.

## Problem

Native Windows text editors are dominated by C/C++ projects (Notepad++ itself, Sublime). Modern editors that are "native" in marketing (VS Code, Notion) are Electron — multi-hundred-MB Chromium installs for what should be a fast, light tool. Notepad has terrible UX. There is no canonical Rust-native, Win32-native, batteries-included text editor for Windows. This experiment proves the toolchain (`windows` crate + `windows-sys` direct, no `iced` / `egui` / `slint` wrappers) is up to the task and produces a useful single-binary editor along the way.

## Success Criteria — major features only

- **SC-1: Edit and save text files.** User can run `notepadrs.exe` on a Windows machine, open a UTF-8 / UTF-16 / ANSI text file via File → Open or `notepadrs.exe path/to/file.txt`, edit it, and save (Ctrl+S) without corrupting encoding or line endings.
- **SC-2: Multi-tab editing.** Multiple files open in tabs (Ctrl+T new tab, Ctrl+W close tab, Ctrl+Tab switch tabs). Unsaved-tab indicator (asterisk in tab title). Confirm-before-close on dirty tabs.
- **SC-3: Find / Find & Replace with regex.** Ctrl+F opens a find bar; Ctrl+H opens replace. Both support: literal match, case-sensitive toggle, whole-word toggle, and regex mode. Find-next / Find-previous / Replace / Replace-all all work. Regex backed by the `regex` crate.
- **SC-4: Syntax highlighting for at least 5 languages.** JavaScript, Python, JSON, Markdown, and plain-text-with-no-highlighting. Detected by file extension. Implementation: simple tokenizer per language (no need for full LSP / Tree-sitter at v1).
- **SC-5: Line numbers + status bar.** Gutter shows line numbers. Status bar shows: cursor row:col, file encoding, line-ending style (LF/CRLF/CR), document size in lines.
- **SC-6: Auto-detect encoding and line endings on open; preserve on save.** UTF-8 (with or without BOM), UTF-16 LE/BE, ANSI/CP1252. LF / CRLF / CR auto-detected; menu lets user convert.
- **SC-7: Standard editing operations.** Cut/Copy/Paste/Select-All/Undo/Redo via Ctrl+X/C/V/A/Z/Y. Undo history is per-tab and bounded (e.g., last 1000 ops).
- **SC-8: Word wrap toggle.** View → Word Wrap, persisted per-tab. Off by default; horizontal scrollbar when off.
- **SC-9: Recent files.** File → Recent Files lists last 10 opened paths, clickable to reopen. Persisted to `%APPDATA%/notepadrs/recent.json`.
- **SC-10: Drag-and-drop to open.** Dropping a file onto the window opens it in a new tab.
- **SC-11: Single-binary install.** `cargo build --release` produces `notepadrs.exe` in the target directory. No DLL dependencies beyond what ships with Windows. Binary size <10MB.
- **SC-12: Tests.** Cargo test suite covering: encoding detection, line-ending detection, find/replace regex, undo/redo state machine, recent-files persistence, syntax tokenizers per language. Aim for ≥30 tests.

## Scope

| In Scope | Out of Scope (deferred) |
|----------|-------------------------|
| Native Win32 via `windows` / `windows-sys` crates | Cross-platform (Linux/macOS) |
| Multi-tab editing | Multi-window (one main window with tabs) |
| Find / Replace with regex | Search-in-files (multi-file find) |
| Tokenizer-based syntax highlighting (5 languages) | Tree-sitter / LSP integration |
| UTF-8 / UTF-16 / ANSI encoding | UTF-32, EBCDIC, exotic encodings |
| LF / CRLF / CR line endings | Mixed-line-ending repair UI |
| Undo/redo per tab | Cross-tab undo / global history |
| Recent files (last 10) | Workspace / project trees |
| Drag-and-drop file open | Drag-rearrange of tabs |
| Status bar | Customizable status bar plugins |
| Word wrap toggle | Soft tabs visual rendering |
| Single binary, <10MB | Installer (MSI / WiX) — defer to v2 |
| Light theme (default Windows colors) | Dark theme, custom themes |
| | Macros (record / playback) |
| | Plugins (any plugin system) |
| | Multi-cursor / column-mode editing |
| | Code folding |
| | File comparison / diff |
| | Auto-complete |
| | Hex editor mode |
| | Built-in terminal |

## Constraints

- **Tech stack:** Rust stable (≥ 1.75). Direct Win32 via the `windows` crate (or `windows-sys` for the absolute-minimum-overhead path — planner's call). No GUI framework wrappers (no `iced`, `egui`, `slint`, `tauri`). Allowed third-party crates: `windows` (or `windows-sys`), `regex`, `serde` + `serde_json` (for recent-files persistence and any internal state), `encoding_rs` (for UTF-16 / ANSI handling). That's it. If the planner thinks another crate is essential, document the reason explicitly.
- **Performance:** open and tokenize a 1MB text file in <500ms. Find with regex in a 1MB file in <100ms. Type latency: keystroke-to-paint <16ms (one frame at 60Hz).
- **Cross-platform:** Windows-only. Don't add `cfg(unix)` paths; this is intentionally Win32-native.
- **Windows version target:** Windows 10 (1809+) and Windows 11. No support for Windows 7/8.
- **No async runtime.** Win32 message loop is the only event source; tokio / async-std are not needed and would just add weight.
- **Build:** `cargo build --release` produces a single `.exe`. No external resource files at runtime — bake icons / language definitions into the binary.
- **Code organization:** modular Rust crate. Suggested split: `src/main.rs` (entry + msg loop), `src/window.rs` (HWND lifecycle), `src/editor.rs` (text buffer + cursor), `src/render.rs` (paint), `src/find.rs`, `src/syntax/{js,py,json,md}.rs`, `src/encoding.rs`, `src/recent.rs`. Planner can adjust.

## Reference material

- The `windows` crate docs: https://docs.rs/windows/
- Microsoft Win32 docs for `RichEdit` control vs custom rendering: planner should decide whether to use the built-in `RICHEDIT50W` control or render text directly. RichEdit is faster to ship; custom rendering is more flexible. Either is acceptable. Document the choice with rationale in plan.md.
- Notepad++ feature reference: https://npp-user-manual.org/docs/getting-started/ — for the major-features list. Don't try to match every menu item; match the ONES PEOPLE ACTUALLY USE.
- Existing prior art in Rust: `lapce`, `helix`, `zed` (all are CROSS-PLATFORM and use their own GUI toolkits — explicitly NOT what we're doing here).

## Notes

- **Decision principle:** ship a real, useable editor at v1. Better to deliver SC-1 through SC-7 rock-solid than to half-implement all 12 SCs.
- **GUI choice — RichEdit vs custom render:** the planner should decide in Plan 01 and lock the decision. Both have published prior art. RichEdit gets cut/copy/paste / undo / IME composition / accessibility for free; custom rendering gives full control over highlighting and gutter rendering at the cost of reimplementing those Win32 affordances. Recommended: RichEdit for v1 with custom gutter and tab strip layered on top — fastest to a working editor.
- **Dogfood marker:** v1 is "done" when the developer can use `notepadrs.exe` to open, edit, and save the project's own `Cargo.toml` without going back to another editor.
- **Promote-worthy findings expected:** Win32 message-loop patterns in Rust, encoding-detection heuristics, regex-find performance on large buffers, the RichEdit-vs-custom tradeoff, single-binary <10MB Rust GUI techniques, GDI vs Direct2D rendering choices.
- **Future iterations** (NOT this experiment): macros, plugins, multi-cursor, code folding, search-in-files, themes, MSI installer. Out of scope for v1; document as roadmap in `roadmap.md` so future runs know where to pick up.
