---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
verified: 2026-05-03T00:00:00Z
status: human_needed
score: 5/5 must-haves auto-verified (GUI visual aspects require human)
re_verification:
  previous_status: human_needed
  previous_score: 5/5
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Gutter visual — line numbers visible, scroll lockstep, dynamic width"
    expected: "Right-aligned 1-indexed line numbers in Consolas monospace, grey color, scrolling in lockstep with text via keyboard / mouse / scrollbar drag; gutter visibly widens when line count crosses 10/100/1000"
    why_human: "WM_PAINT rendering, scroll synchronization behavior, and pixel-accurate alignment can only be confirmed with a running Win32 binary"
  - test: "Status bar visual — all 4 segments update in real time"
    expected: "Ln N, Col N updates on every cursor move and keystroke; encoding and EOL labels reflect the active file; line count increments/decrements with edits; all 4 refresh immediately on tab switch"
    why_human: "Win32 STATUSCLASSNAME repaint timing and per-event responsiveness cannot be confirmed without a running binary"
  - test: "Syntax highlighting visual — correct colors per language on real files"
    expected: "JS/Python keywords in purple, strings in green, comments in mid-green; JSON strings/numbers colored; Markdown headings in dark red, code fences in green; unknown-extension files show no color (all black)"
    why_human: "EM_SETCHARFORMAT rendering and color fidelity can only be confirmed visually with a running binary"
  - test: "Layer-2 perf gate — keystroke-to-paint latency <16ms on 1MB JS in release"
    expected: "With NOTEPADRS_PERF_LOG=1, every keystroke on a 1MB JS file emits elapsed_us < 16000 in the debug output"
    why_human: "Real Win32 EM_SETCHARFORMAT + paint cost can only be measured at runtime; Layer-1 MockSink gate confirms the tokenizer+apply layer is well within budget (24.4us) but does not include Win32 paint cost"
---

# Phase 4: Visual Chrome — Gutter, Status Bar, Syntax Highlighting Verification Report

**Phase Goal:** Deliver SC-4 and SC-5 — the editor paints a line-number gutter, a status bar showing row:col / encoding / EOL / line count, and applies syntax highlighting via per-language tokenizers (JS, Python, JSON, Markdown, plain-text fallback) selected by file extension on open.

**Verified:** 2026-05-03
**Status:** human_needed
**Re-verification:** Yes — previous verification existed (status: human_needed, no gaps). This pass independently confirms all code-layer evidence and refreshes the Layer-1 perf gate numbers.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every tab shows a line-number gutter that scrolls in lockstep with text and grows in width as line count grows | AUTO-VERIFIED | `src/gutter.rs` WM_PAINT impl with EM_GETFIRSTVISIBLELINE + DrawTextW(DT_RIGHT); EN_VSCROLL handler invalidates gutter; EN_CHANGE recomputes width on digit boundary; 15 tests in `tests/gutter_layout.rs` all pass |
| 2 | Status bar always shows row:col / encoding / EOL / line count, updating immediately on edits and tab switches | AUTO-VERIFIED | `src/status_bar.rs` exposes all 6 helpers; dispatch wires EN_SELCHANGE, EN_CHANGE, TCN_SELCHANGE, file open/save, encoding/EOL menu; 19 tests in `tests/status_bar_labels.rs` all pass |
| 3 | Opening a file with known extension tokenizes with the matching language tokenizer; unknown falls back to plain | AUTO-VERIFIED | `lang_from_path` dispatches .js/.mjs → JS, .py → Python, .json → JSON, .md/.markdown → Markdown, else Plain; `dispatch.rs` sets `tab.language = lang_from_path(p)` on open; 39 golden-token-stream tests pass |
| 4 | Typing into 1MB JS/Python file keeps keystroke-to-paint under 16ms in release (incremental tokenization re-runs only affected lines until state stabilizes) | LAYER-1 AUTO-VERIFIED | `tests/highlight_perf.rs` (MockSink, release): tokenize+apply 50-line viewport = 33.6µs (budget 5ms, 149× under); incremental retokenize per-run = 217ns (budget 5ms, 23,000× under); full 1MB JS tokenize = 18.99ms (budget 500ms, 26× under) |
| 5 | CI runs per-language tokenizer tests and the suite passes on every build | AUTO-VERIFIED | `tests/syntax_tokenizers.rs` — 39 tests, no `#[ignore]`, all pass; covers all 5 languages + multi-line state transitions |

**Score:** 5/5 truths auto-verified; 4 require human visual confirmation

---

### Required Artifacts

| Artifact | Min Size | Actual | Status | Key Evidence |
|----------|----------|--------|--------|--------------|
| `src/gutter.rs` | 120 lines | 179 lines | VERIFIED | WM_PAINT, GWLP_USERDATA lookup, EM_GETFIRSTVISIBLELINE, DrawTextW, gutter_width_for_line_count |
| `src/status_bar.rs` | 80 lines | 219 lines | VERIFIED | format_row_col, update_all_segments + 4 individual helpers, WONTFIX-v1 P4-5 doc comment |
| `src/encoding.rs` | — | 200+ lines | VERIFIED | label_for_status() returns "UTF-8"/"UTF-8 BOM"/"UTF-16 LE"/"UTF-16 BE"/"ANSI" |
| `src/eol.rs` | — | 60+ lines | VERIFIED | label_for_status() returns "LF"/"CRLF"/"CR"/"Mixed" (Mixed(_) collapses majority) |
| `src/syntax/plain.rs` | 15 lines | 19 lines | VERIFIED | Returns single Plain token per non-empty line; LineEndState::Code always |
| `src/syntax/json.rs` | 80 lines | 107 lines | VERIFIED | Strings (with escapes), numbers, true/false/null keywords, structural punct |
| `src/syntax/markdown.rs` | 100 lines | 172 lines | VERIFIED | Headings, bold/italic/inline code, MdCodeFence multi-line state |
| `src/syntax/javascript.rs` | 150 lines | 316 lines | VERIFIED | Keywords, strings, regex heuristic, JsBlockComment + JsTemplateLiteral multi-line state |
| `src/syntax/python.rs` | 130 lines | 229 lines | VERIFIED | Keywords, single/double/triple strings, PyTripleString multi-line state, decorators |
| `src/highlight.rs` | — | 286 lines | VERIFIED | palette(), CharFormatSink trait, RealEMSetCharFormatSink, apply_visible_viewport, apply_viewport_with_sink, retokenize_from_edited_line, full_buffer_retokenize |
| `tests/gutter_layout.rs` | 60 lines | 113 lines | VERIFIED | 15 tests, all pass |
| `tests/status_bar_labels.rs` | 80 lines | 134 lines | VERIFIED | 19 tests (not 17 as planned — 2 extra), all pass |
| `tests/syntax_tokenizers.rs` | — | 474 lines | VERIFIED | 39 tests, all pass |
| `tests/highlight_perf.rs` | — | 182 lines | VERIFIED | 3 #[ignore] perf tests via MockSink; all pass in release |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|-----|-----|--------|---------|
| `gutter_wnd_proc` WM_PAINT | sibling RichEdit HWND | `GetWindowLongPtrW(hwnd, GWLP_USERDATA)` | WIRED | `src/gutter.rs` line 114 |
| `gutter_wnd_proc` WM_PAINT | EM_GETFIRSTVISIBLELINE + EM_GETLINECOUNT | `SendMessageW` on sibling RichEdit | WIRED | `src/gutter.rs` lines 140-141 |
| `dispatch.rs` EN_VSCROLL handler | `InvalidateRect(tab.gutter_hwnd, ...)` | tabs.iter().find to match source HWND | WIRED | `src/dispatch.rs` lines 443-446 |
| `dispatch.rs` EN_CHANGE | `gutter_width_for_line_count` | digit-boundary check + WM_SIZE repost | WIRED | `src/dispatch.rs` line 247 |
| `switch_active_tab` TCN_SELCHANGE | gutter ShowWindow(SW_HIDE/SW_SHOW) | outgoing/incoming gutter HWNDs | WIRED | `src/dispatch.rs` lines 1119-1127 |
| `dispatch.rs` EN_SELCHANGE | `update_row_col_segment(app)` | WM_NOTIFY path, source HWND check | WIRED | `src/dispatch.rs` line 478 |
| `dispatch.rs` TCN_SELCHANGE | `update_all_segments(app)` | after RichEdit + gutter swap | WIRED | `src/dispatch.rs` line 496 |
| `dispatch.rs` EN_CHANGE | `update_row_col_segment` + `update_line_count_segment` | after dirty flag and gutter logic | WIRED | `src/dispatch.rs` lines 263-264 |
| `do_file_open` / `do_file_save` / `do_file_save_as` | `update_all_segments(app)` | Ok success branch | WIRED | `src/dispatch.rs` lines 853, 909, 988 |
| `update_encoding_segment` | `DetectedEncoding::label_for_status` | reads `tab.editor.encoding` | WIRED | `src/status_bar.rs` line 169 |
| `update_eol_segment` | `Eol::label_for_status` | reads `tab.editor.eol` | WIRED | `src/status_bar.rs` line 184 |
| `open_path_external` / `do_file_open` | `tab.language = lang_from_path(p)` | after open succeeds | WIRED | `src/dispatch.rs` line 842 |
| `dispatch.rs` EN_CHANGE | `retokenize_from_edited_line` + `apply_visible_viewport` | highlight pipeline, skipped for Plain language | WIRED | `src/dispatch.rs` lines 295-297 |
| `dispatch.rs` EN_VSCROLL | `apply_visible_viewport` | immutable iter().find (Warning #7) | WIRED | `src/dispatch.rs` lines 463-465 |
| `dispatch.rs` WM_APP_HIGHLIGHT_REQUEST | `full_buffer_retokenize` + `apply_visible_viewport` | deferred first highlight (Pitfall P4-4) | WIRED | `src/dispatch.rs` lines 607-610 |
| `syntax/mod.rs::tokenize_line` | per-language submodule dispatch | match Language::* | WIRED | `src/syntax/mod.rs` lines 107-111 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| VIEW-01 | 04-02 | Line-number gutter on left edge of every tab | SATISFIED | `src/gutter.rs` WM_PAINT; 15 tests pass |
| VIEW-02 | 04-03 | Status bar shows cursor row:col | SATISFIED | `update_row_col_segment` wired at EN_SELCHANGE + EN_CHANGE |
| VIEW-03 | 04-03 | Status bar shows file encoding | SATISFIED | `update_encoding_segment` via `label_for_status`; 5 encoding tests pass |
| VIEW-04 | 04-03 | Status bar shows line-ending style (LF/CRLF/CR/Mixed) | SATISFIED | `update_eol_segment` via `label_for_status`; 4 EOL tests pass |
| VIEW-05 | 04-03 | Status bar shows total line count | SATISFIED | `update_line_count_segment` via EM_GETLINECOUNT; updates on EN_CHANGE |
| SYNTAX-01 | 04-04a | JavaScript tokenizer (.js, .mjs) | SATISFIED | `src/syntax/javascript.rs` 316 LOC; 9 tests including JsBlockComment + JsTemplateLiteral multi-line |
| SYNTAX-02 | 04-04a | Python tokenizer (.py) | SATISFIED | `src/syntax/python.rs` 229 LOC; 8 tests including PyTripleString multi-line |
| SYNTAX-03 | 04-04a | JSON tokenizer (.json) | SATISFIED | `src/syntax/json.rs` 107 LOC; 7 tests |
| SYNTAX-04 | 04-04a | Markdown tokenizer (.md, .markdown) | SATISFIED | `src/syntax/markdown.rs` 172 LOC; 12 tests including MdCodeFence multi-line |
| SYNTAX-05 | 04-04a | Plain-text fallback for unknown extensions | SATISFIED | `src/syntax/plain.rs` 19 LOC; 3 tests |
| SYNTAX-06 | 04-01 | Language detection by file extension on open | SATISFIED | `lang_from_path` in `src/syntax/mod.rs`; set at `open_path_external` line 842 |
| TEST-07 | 04-05 | Per-language tokenizer tests in CI | SATISFIED | 39 tests in `tests/syntax_tokenizers.rs`; no `#[ignore]`; all pass |

All 12 Phase 4 requirement IDs accounted for. All marked SATISFIED.

---

### Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `tests/roundtrip_matrix.rs` | `collapsible_str_replace` clippy lint | Info | Pre-Phase-4 (Phase 2 commit `763eb07`); not introduced by Phase 4 work |
| `tests/undo_property.rs` | `unusual_byte_groupings` clippy lint | Info | Pre-Phase-4 (Phase 1 commit `9d55be7`); not introduced by Phase 4 work |

No blocker anti-patterns in any Phase 4 files. Clippy failures in pre-existing test files are out of scope. The Phase 4 source files (`src/gutter.rs`, `src/highlight.rs`, `src/status_bar.rs`, `src/syntax/*.rs`, `src/dispatch.rs` additions) all pass `cargo clippy --lib --bins -- -D warnings`.

---

### Test Coverage Alignment

| Suite | Tests | Status | Notes |
|-------|-------|--------|-------|
| `tests/gutter_layout.rs` | 15 | PASS | Pure-logic; gutter_width_for_line_count at all digit boundaries |
| `tests/status_bar_labels.rs` | 19 | PASS | Pure-logic; format_row_col + all encoding/EOL label variants (19, not 17 as planned — 2 extra added) |
| `tests/syntax_tokenizers.rs` | 39 | PASS | Integration; golden-token-stream for all 5 languages; multi-line state transitions |
| `tests/highlight_perf.rs` | 3 | PASS (release, --ignored) | Layer-1 perf gate via MockSink; all 3 pass with 26-23,000× margin |

Total new tests added in Phase 4: approximately 76 (15 + 19 + 39 + 3). Combined with pre-existing 240+, brings total above 315.

---

### Human Verification Required

**1. Gutter Visual Rendering and Scroll Lockstep (SC-1)**

**Test:** `cargo run --release --target x86_64-pc-windows-msvc`, open a 100+ line file, scroll with keyboard (Page Down/Up, arrows), mouse wheel, and scrollbar drag.
**Expected:** Right-aligned 1-indexed line numbers visible in Consolas monospace at ~50% grey (0x808080), each number aligned to the same row as its text line; scrolling in all three modes keeps gutter and text perfectly synchronized; typing past line 10/100/1000 causes the gutter to visibly widen one column.
**Why human:** WM_PAINT rendering accuracy, scroll synchronization behavior, and pixel-level alignment require a running Win32 binary to confirm visually.

**2. Status Bar Live Updates (SC-2)**

**Test:** With the release binary running, type text, move cursor with arrow keys, click in different positions, open files with different encodings and EOL styles, switch between tabs, use the Encoding and EOL menus.
**Expected:** Segment 0 (Ln/Col) updates immediately on every cursor move and keystroke; segment 1 (encoding) reflects the file's actual encoding and changes after encoding menu; segment 2 (EOL) shows LF/CRLF/CR/Mixed and changes after EOL menu; segment 3 (line count) increments and decrements as lines are added/removed; all 4 refresh on tab switch.
**Why human:** Win32 STATUSCLASSNAME update timing and per-event UI responsiveness require a running binary.

**3. Syntax Highlighting Visual Colors (SC-3)**

**Test:** Open a .js file, a .py file, a .json file, a .md file, and a file with an unknown extension (.txt or .xyz) in separate tabs.
**Expected:** JS/Python: keywords (const/def/class/etc.) in purple, strings in green, comments in mid-green, numbers in green; JSON: string values in green, numbers in green, true/false/null in purple, structural punct in black; Markdown: #headings in dark red, `inline code` and fenced blocks in green; unknown extension: all text in black (no highlighting).
**Why human:** EM_SETCHARFORMAT color application and visual fidelity can only be confirmed visually.

**4. Layer-2 Perf Gate — <16ms Keystroke-to-Paint on 1MB JS (SC-4)**

**Test:** `set NOTEPADRS_PERF_LOG=1 && cargo run --release --target x86_64-pc-windows-msvc`, open a ~1MB JS file, type 100+ characters, observe the debug output (terminal in debug or DebugView in release).
**Expected:** Every `[perf] highlight: lines=N elapsed_us=M` line shows `elapsed_us < 16000` (16ms). The Layer-1 gate shows the tokenizer+apply layer uses 33.6µs for a 50-line viewport, leaving over 15ms of headroom for real Win32 EM_SETCHARFORMAT + paint cost.
**Why human:** Real Win32 paint cost can only be measured at runtime with an actual RichEdit HWND.

---

## Summary

Phase 4 goal is **fully achieved at the code and test layer**. All 12 requirement IDs are satisfied. All 5 success criteria pass automated verification:

- SC-1 (gutter): 179-line WM_PAINT impl with full scroll-lockstep wiring; 15 pure-logic tests pass.
- SC-2 (status bar): 219-line status_bar.rs with 6 update helpers; all dispatch events wired; 19 tests pass.
- SC-3 (extension-based tokenization): 5 tokenizers totaling 843 LOC; dispatch wires `lang_from_path` on file open; `full_buffer_retokenize` + `apply_visible_viewport` on WM_APP_HIGHLIGHT_REQUEST; 39 golden-token-stream tests pass.
- SC-4 (perf): Layer-1 MockSink gate passes with 149-23,000× margin; Layer-2 QPC env-gated log is in place.
- SC-5 (CI tests): 39 tests, no `#[ignore]`, pass on every `cargo test`.

The `human_needed` status reflects that four of five SCs include GUI rendering and real-time behavior aspects (gutter paint, status bar updates, highlighting colors, Layer-2 perf) that require a human with a running release binary to fully confirm. There are no code-layer gaps or missing artifacts.

Pre-existing clippy lint failures in `tests/roundtrip_matrix.rs` and `tests/undo_property.rs` (both from Phase 1-2) are informational — not introduced by Phase 4 and out of verification scope.

---

_Verified: 2026-05-03_
_Verifier: Claude (pan-verifier)_
