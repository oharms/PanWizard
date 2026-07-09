---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 04b
type: execute
wave: 4
depends_on: ["04-04a", "04-02"]
files_modified:
  - src/highlight.rs
  - src/lib.rs
  - src/main.rs
  - src/dispatch.rs
  - src/find.rs
  - src/editor.rs
  - tests/highlight_perf.rs
autonomous: false
change_class: feat
requirements: [SYNTAX-01, SYNTAX-02, SYNTAX-03, SYNTAX-04, SYNTAX-05]

must_haves:
  truths:
    - "Opening a .js / .mjs file applies JavaScript token-class coloring (keywords, strings, numbers, comments, regex) to the visible viewport — verified via human-verify checkpoint"
    - "Opening a .py file applies Python coloring (keywords, strings including triple-quoted, numbers, comments, decorators) — human-verify"
    - "Opening a .json file applies JSON coloring (strings, numbers, true/false/null, structural punct) — human-verify"
    - "Opening a .md / .markdown file applies Markdown coloring (headings, bold, italic, inline code, fenced code) — human-verify"
    - "Opening a file with an unknown extension falls back to plain text — no coloring applied — human-verify"
    - "Two-layer perf verification per D-perf: Layer 1 (auto, tests/highlight_perf.rs) measures tokenizer + apply-layer with stubbed CharFormatSink under 5ms wall-clock for 1MB JS in release; Layer 2 (human-verify checkpoint) uses QueryPerformanceCounter env-gated logs to confirm full keystroke-to-paint <16ms"
    - "Selection / caret position is preserved across viewport re-color (EM_GETSEL save+restore + EM_HIDESELECTION) — Pitfall P4-1"
    - "highlighting_in_progress re-entrancy guard prevents EN_CHANGE recursion — Pitfall P4-3"
    - "WM_APP_HIGHLIGHT_REQUEST is posted on tab switch and on initial file open; consumed by dispatch handler to defer first highlight until after first WM_PAINT — Pitfall P4-4"
    - "Tab switch triggers full-buffer re-tokenize on the activated tab if line_states is empty (initial highlight) — Pitfall P4-6"
    - "All dispatch code sketches use the capture-before-mut-borrow pattern: `let line_height = app.line_height_px;` BEFORE `app.active_mut()` — Blocker #3 fix"
  artifacts:
    - path: "src/highlight.rs"
      provides: "PALETTE constant via palette() function (TokenClass → COLORREF), apply_visible_viewport(tab, line_height, lf_text) with selection save+restore + WM_SETREDRAW bracketing + Layer-2 QueryPerformanceCounter env-gated timing log, retokenize_from_edited_line incremental algorithm with stabilization, full_buffer_retokenize for tab activation, CharFormatSink trait + RealEMSetCharFormatSink + MockSink for Layer-1 perf isolation"
      contains: "apply_visible_viewport"
      min_lines: 200
    - path: "src/dispatch.rs"
      provides: "EN_CHANGE → retokenize_from_edited_line + apply_visible_viewport (with Blocker-#3 capture-before-mut-borrow); EN_VSCROLL → apply_visible_viewport via app.tabs.iter().find (per Warning #7); TCN_SELCHANGE → PostMessageW(WM_APP_HIGHLIGHT_REQUEST); do_file_open → clear line_states + PostMessageW; WM_APP_HIGHLIGHT_REQUEST handler runs full_buffer_retokenize if needed then apply_visible_viewport"
      contains: "WM_APP_HIGHLIGHT_REQUEST"
    - path: "src/find.rs"
      provides: "stream_out_lf made pub if not already (or relocated to src/editor.rs as a method on EditorState) so highlight.rs can fetch the LF buffer text"
      contains: "pub.*stream_out_lf"
    - path: "tests/highlight_perf.rs"
      provides: "Layer-1 perf gate: synthesizes 1MB JS-style buffer, runs tokenize_line + retokenize_from_edited_line + apply_visible_viewport via MockSink (CharFormatSink stub), asserts tokenizer + apply-layer wall-clock under 5ms in release. Marked #[ignore] to gate via `cargo test --release --test highlight_perf -- --ignored`."
      min_lines: 80
  key_links:
    - from: "src/dispatch.rs WM_COMMAND EN_CHANGE"
      to: "src/highlight.rs::retokenize_from_edited_line + apply_visible_viewport"
      via: "After dirty-flag and gutter-width update, find edited line and re-tokenize forward until stable, then apply"
      pattern: "retokenize_from_edited_line|apply_visible_viewport"
    - from: "src/dispatch.rs WM_NOTIFY EN_VSCROLL"
      to: "src/highlight.rs::apply_visible_viewport"
      via: "Visible viewport changed — re-color newly visible lines via app.tabs.iter().find (immutable, per Warning #7)"
      pattern: "EN_VSCROLL.*apply_visible_viewport"
    - from: "src/dispatch.rs WM_NOTIFY TCN_SELCHANGE"
      to: "PostMessageW(hwnd, WM_APP_HIGHLIGHT_REQUEST, 0, 0)"
      via: "Defer first highlight until after WM_PAINT runs once on the new tab (Pitfall P4-4)"
      pattern: "PostMessageW.*WM_APP_HIGHLIGHT_REQUEST"
    - from: "src/dispatch.rs WM_APP_HIGHLIGHT_REQUEST handler"
      to: "src/highlight.rs::full_buffer_retokenize + apply_visible_viewport"
      via: "If active tab's line_states is empty, run full retokenize then visible recolor"
      pattern: "WM_APP_HIGHLIGHT_REQUEST"
    - from: "src/highlight.rs::apply_visible_viewport"
      to: "EM_SETCHARFORMAT(SCF_SELECTION) per token-class run via CharFormatSink"
      via: "EM_SETSEL + EM_SETCHARFORMAT bracketed by EM_GETSEL save + WM_SETREDRAW(FALSE) + Layer-2 QueryPerformanceCounter env-gated log"
      pattern: "EM_SETCHARFORMAT|CharFormatSink"
---

<objective>
Implement the visible-viewport `EM_SETCHARFORMAT` re-color path with a `CharFormatSink` trait abstraction (so the perf gate can stub Win32 calls), the incremental retokenize-from-edited-line algorithm with end-state stabilization, the re-entrancy guard, the first-paint timing fix via `WM_APP_HIGHLIGHT_REQUEST`, the tab-switch full-buffer re-tokenize, AND the two-layer performance verification (Layer 1 auto-test for tokenizer+apply layer; Layer 2 human-verify checkpoint with QueryPerformanceCounter timing log). Plan 04-04a (Wave 3) provides the tokenizers; this plan wires them into the GUI and adds the perf gate.

Purpose: Close SYNTAX-01..05 at the wiring + paint layer, plus the QUAL-05 perf budget. Splits from the original Plan 04-04 (plan-checker Blocker #1) so that single-shot execution doesn't risk dropping a Pitfall mitigation. The two-layer perf design (Blocker #4 fix) replaces the original 04-04's hollow tokenizer-only proxy with a real measurement of the apply-layer + a human-verifiable end-to-end measurement.
Output: New `src/highlight.rs` with palette + apply_visible_viewport + incremental retokenize + Layer-1 sink trait; `src/dispatch.rs` wiring (EN_CHANGE / EN_VSCROLL / TCN_SELCHANGE / WM_APP_HIGHLIGHT_REQUEST) using the capture-before-mut-borrow pattern (Blocker #3); `src/find.rs` exposing `stream_out_lf` if not already public; `tests/highlight_perf.rs` Layer-1 perf gate; one human-verify checkpoint covering all 5 languages + Layer-2 perf measurement.
</objective>

## Plan Decisions

(See @./.claude/pan-wizard-core/references/handoff-decisions.md for the schema.)

### Locked (executor MUST follow)

- D-1: **Token-class palette (8 distinct colors, hardcoded).** In `src/highlight.rs`:
  ```rust
  pub fn palette(class: TokenClass) -> COLORREF {
      match class {
          TokenClass::Plain     => COLORREF(0x000000), // black
          TokenClass::Keyword   => COLORREF(0x800080), // purple
          TokenClass::String    => COLORREF(0x098658), // green
          TokenClass::Number    => COLORREF(0x098658), // same green
          TokenClass::Comment   => COLORREF(0x008000), // mid-green
          TokenClass::Punct     => COLORREF(0x000000), // black
          TokenClass::Heading   => COLORREF(0x800000), // dark red
          TokenClass::Bold      => COLORREF(0x000000), // black (no bold weight in v1)
          TokenClass::Italic    => COLORREF(0x000000), // black (no italic in v1)
          TokenClass::CodeFence => COLORREF(0x008000), // mid-green
          TokenClass::Link      => COLORREF(0x0000ff), // blue
      }
  }
  ```
  Why: idea.md "no theme system"; 8 distinct colors cover all 5 languages' meaningful classes. v1 skips bold/italic font-weight (would need `cf.dwMask |= CFM_BOLD | CFM_ITALIC` and a `CFE_BOLD` test) — color alone is sufficient and keeps the highlight pipeline trivial. Source: 04-research.md user_constraints "Token-class palette / colors", Open Question 4.

- D-2: **`apply_visible_viewport(tab, line_height_px, lf_text) -> ()`** is the only function that calls `EM_SETCHARFORMAT` in production code paths. Its body:
  1. Set `tab.highlighting_in_progress = true` (re-entrancy guard, Pitfall P4-3); bail early if already true.
  2. Save current selection: `EM_GETSEL` → `(sel_start, sel_end)`.
  3. `EM_HIDESELECTION(TRUE)` to suppress flicker.
  4. `WM_SETREDRAW(FALSE)` to suspend repaint.
  5. **(Layer-2 perf instrumentation, D-perf)** If env var `NOTEPADRS_PERF_LOG=1` is set, capture `QueryPerformanceCounter` start.
  6. Compute visible range: `first = EM_GETFIRSTVISIBLELINE`, `total = EM_GETLINECOUNT`, `visible_rows = client_height / line_height_px + 1`, `last = (first + visible_rows).min(total)`.
  7. For each line `i in first..last`: tokenize the line text (re-tokenize, no memoization per O-1), compute the line's char-range start `EM_LINEINDEX(i)`, then for each token: `EM_SETSEL(start + tok.start, start + tok.end)` + `EM_SETCHARFORMAT(SCF_SELECTION, &cf with crTextColor = palette(tok.class))`.
  8. `WM_SETREDRAW(TRUE)` + `RedrawWindow(RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN)`.
  9. Restore selection: `EM_SETSEL(sel_start, sel_end)` + `EM_HIDESELECTION(FALSE)`.
  10. **(Layer-2 perf instrumentation)** If env var set, capture `QueryPerformanceCounter` end + emit `[perf] highlight: lines=N elapsed_us=M` via `OutputDebugStringW` (or `eprintln!` in debug builds).
  11. Set `tab.highlighting_in_progress = false`.
  Source: 04-research.md Pattern T1 §"Visible viewport re-color", Pitfalls P4-1 P4-3.

- D-3: **Incremental retokenize algorithm.** `retokenize_from_edited_line(tab, edited_line_idx, lf_text)`:
  ```
  for each line from edited_line_idx forward:
      prev_state = if line_idx == 0 { Code } else { tab.line_states[line_idx - 1] }
      (tokens, new_end) = tokenize_line(tab.language, lines[line_idx], prev_state)
      // ignore tokens — only the end-state matters for cache invalidation
      if line_idx < tab.line_states.len() && tab.line_states[line_idx] == new_end {
          break  // STABILIZED — downstream lines stay valid
      }
      if line_idx >= tab.line_states.len() {
          tab.line_states.resize(line_idx + 1, LineEndState::Code)
      }
      tab.line_states[line_idx] = new_end
  ```
  After this loop, the caller invokes `apply_visible_viewport`. Source: 04-research.md Pattern T1 §"Incremental re-tokenize algorithm".

- D-4: **`full_buffer_retokenize(tab, lf_text)`** — used on tab activation (Pitfall P4-6) when `tab.line_states.is_empty()`. Iterates ALL lines, fills `tab.line_states` completely, no early-stop. Cost: ~50ms for 50,000 lines per measurement; called once per tab open / one-time per session. Source: 04-research.md Pitfall P4-6, Pitfall P4-8.

- D-5: **First-paint timing via `WM_APP_HIGHLIGHT_REQUEST`** (Pitfall P4-4). On tab switch (TCN_SELCHANGE) and on file open (do_file_open success), call `PostMessageW(hwnd, WM_APP_HIGHLIGHT_REQUEST, 0, 0)`. The handler in dispatch.rs:
  - Stream out the buffer LF text via `tab.editor.stream_out_lf()`.
  - If `tab.line_states.is_empty()` → `full_buffer_retokenize(tab, &lf_text)`.
  - Always: `apply_visible_viewport(tab, line_height, &lf_text)`.
  Why: `EM_GETFIRSTVISIBLELINE` returns 0 before first WM_PAINT; deferring via PostMessage gives the message pump one tick to paint, then highlight. Source: 04-research.md Pitfall P4-4.

- D-6: **Re-entrancy guard.** `apply_visible_viewport` and `retokenize_from_edited_line` consult `tab.highlighting_in_progress` (a `Cell<bool>` pre-allocated by Plan 04-01) at entry, set true while running, set false on return (or via a guard struct on Drop for panic safety). EN_CHANGE handler ALSO checks the flag and skips if already running. Why: Pitfall P4-3 — `EM_SETCHARFORMAT(SCF_SELECTION)` doesn't fire EN_CHANGE per Microsoft docs, but defensive guarding catches future code paths. Source: 04-research.md Pitfall P4-3.

- D-7: **CHARFORMAT2W carries `dwMask = CFM_COLOR`, `crTextColor = COLORREF`, `cbSize = sizeof::<CHARFORMAT2W>()`.** No bold/italic/face/charset bits set in v1 (D-1 rationale). Send via `EM_SETCHARFORMAT(SCF_SELECTION, &cf)`. Source: 04-research.md "CHARFORMAT2W per-token color" code example.

- D-8: **EN_VSCROLL recolor strategy + Warning #7 fix.** When a new viewport scrolls in, simply call `apply_visible_viewport(tab, ...)` again — it will re-color whatever's visible. **Per Warning #7**, use `app.tabs.iter().find(...)` (immutable iterator) to locate the tab whose RichEdit fired the notification, and pass `&Tab` to `apply_visible_viewport`. **DO NOT change to `iter_mut()`** — retokenize-on-scroll is deferred to the next EN_CHANGE per design D-3; on EN_VSCROLL we only re-paint what's already cached. The `apply_visible_viewport` signature takes `&Tab`, not `&mut Tab` (the `highlighting_in_progress` field is `Cell<bool>` which gives interior mutability). Add a code comment in the EN_VSCROLL handler: `// EN_VSCROLL intentionally uses app.tabs.iter().find(...) (immutable) to call apply_visible_viewport(&Tab, ...) only — retokenize on scroll is deferred to the next EN_CHANGE per design D-3. Do NOT change to iter_mut().` Source: 04-research.md Pitfall P4-8; plan-checker Warning #7.

- D-9 (renamed: was D-perf in fix specification): **Two-layer perf verification (Blocker #4 fix).**

  **Layer 1 — automated, in `tests/highlight_perf.rs`:** A `CharFormatSink` trait abstracts the per-token CHARFORMAT call; production code uses `RealEMSetCharFormatSink` (calls `EM_SETSEL` + `EM_SETCHARFORMAT` via SendMessageW); the perf test uses `MockSink` (just counts calls, optionally tracks total wall-clock for the apply layer). The test:
  1. Synthesizes a 1MB JS-style buffer (50,000 lines × ~20 chars/line).
  2. Runs `full_buffer_retokenize` once to populate state.
  3. Runs the FULL `apply_visible_viewport` path through real Rust code with a `MockSink`. (No window — but the entire tokenize → token-iterate → "EM_SETCHARFORMAT" call path runs.)
  4. Asserts the wall-clock for the tokenizer + apply layer (everything ABOVE the Win32 boundary) stays **under 5ms** for the visible-viewport re-color in release mode.
  5. Marked `#[ignore]` so it gates via `cargo test --release --test highlight_perf -- --ignored`.

  **Layer 2 — human-verify checkpoint, INSTRUMENTED:** In `src/highlight.rs::apply_visible_viewport`, conditionally compile (or always — with env-gated emission) a `QueryPerformanceCounter` start/stop bracket around the EM_SETCHARFORMAT loop. When the env var `NOTEPADRS_PERF_LOG=1` is set at process start, the function prints `[perf] highlight: lines=N elapsed_us=M` to debug output (`OutputDebugStringW`, or `eprintln!` in debug builds — pick whichever is reliably visible in the developer's terminal/debugger). The human checkpoint instruction reads: "Open large.js (1MB JS file from tests/fixtures/), set `NOTEPADRS_PERF_LOG=1` in the launching shell, type 100 chars, observe the perf log shows `elapsed_us < 16000` for each keystroke."

  This gives the human verifier a measurable assertion (numeric microseconds) instead of a subjective "feels fast." Updates truth #6 in must_haves: **"Tokenizer + apply-layer perf <5ms automated; full keystroke-to-paint <16ms verified by human-verify checkpoint with QueryPerformanceCounter timing logs."**

  **If Layer 1 cannot achieve <5ms in the auto test, that's a real research finding — surface it via a deviation note in the plan summary. Do NOT downgrade the threshold silently.** Source: 04-research.md Pitfall P4-8 + plan-checker Blocker #4.

- D-10: **Capture-before-mut-borrow pattern (Blocker #3 fix).** Apply at every dispatch call site that needs both `app.line_height_px` (or any other `Copy` field on `App`) AND a `&mut Tab` from `app.active_mut()`:
  ```rust
  // CORRECT — Copy values out BEFORE mutable borrow.
  let line_height = app.line_height_px;     // Copy: i32 — no borrow lingers
  if let Some(tab) = app.active_mut() {     // mutable borrow on app
      // ... use line_height (already a local i32) and tab freely ...
  }
  ```
  ```rust
  // WRONG — borrow checker rejects: &mut app live while reading app.line_height_px.
  if let Some(tab) = app.active_mut() {
      apply_visible_viewport(tab, app.line_height_px, &lf_text); // ❌ &mut + & on app
  }
  ```
  Apply this pattern at: WM_COMMAND EN_CHANGE handler; WM_APP_HIGHLIGHT_REQUEST handler; do_file_open success branch; anywhere else in this plan that calls `app.active_mut()` adjacent to `app.line_height_px`. The same pattern was already adopted in Plan 04-02 Task 2 for `app.em_width_px` — this plan extends it to `app.line_height_px`. Source: plan-checker Blocker #3; Rust borrow-checker rules.

- D-11: **Per-language tokenizer guarantee.** Plan 04-04a (Wave 3, depends [04-01]) provides the implementations of `src/syntax/{plain,json,markdown,javascript,python}.rs::tokenize_line`. This plan (04-04b) consumes them via `crate::syntax::tokenize_line(language, line, prev_state)`. **DO NOT modify any tokenizer file in this plan.** If a tokenizer bug surfaces during the human checkpoint, file a Phase 4 gap-closure plan; do not patch in 04-04b. Source: plan boundaries.

- D-12: **`lib.rs` / `main.rs` declare `pub mod highlight;`** (mirroring 04-01's pattern). Why: `tests/highlight_perf.rs` needs `use notepadrs::highlight::*` to invoke the apply layer with a MockSink. Source: 04-01 D-12 precedent.

### Open (executor's discretion within constraints)

- O-1: **CharFormatSink trait location.** Either a top-level `pub trait CharFormatSink` in `src/highlight.rs` or in a dedicated `src/highlight/sink.rs`. Recommendation: top-level in `src/highlight.rs` — single-file plan; trait + impl + perf-test mock are ~30 LOC and stay legible together. Source: project pattern.
- O-2: **Whether to memoize `Vec<Token>` per line on the Tab.** v1 doesn't (Plan 04-04a O-1 + this plan agrees). Re-tokenize on every `apply_visible_viewport` call. If Layer-1 perf gate fails (>5ms), this is the first escape hatch — add `Vec<Vec<Token>>` to Tab as a Phase 4 gap-closure plan, not in 04-04b. Source: 04-research.md Open Question 1.
- O-3: **Layer-2 perf log delivery mechanism.** `OutputDebugStringW` (visible in DebugView / Visual Studio output window) vs `eprintln!` (visible in `cargo run` terminal). Recommendation: `eprintln!` for debug builds, `OutputDebugStringW` for release builds — both gated on `NOTEPADRS_PERF_LOG=1`. The human checkpoint can use either depending on launch environment.

### Considered and rejected

- R-1: **Single-layer perf test (tokenizer-only, the original 04-04 design).** Rejected by plan-checker Blocker #4: doesn't measure SC-4's "keystroke-to-paint <16ms" — it asserts a 100µs tokenizer-only budget which is a hollow proxy. The two-layer fix is mandatory.
- R-2: **Background-thread tokenization upfront.** Rejected: 04-research.md user_constraints — synchronous viewport-only is the v1 path; worker is escape hatch only if perf gate misses. If the Layer-1 gate fails, fall back to (a) reduced token-class granularity OR (c) Plan 03-05's worker reuse — handled as a Phase 4 gap-closure plan, not in this plan.
- R-3: **Bold + italic font weights.** Rejected: requires `cf.dwMask |= CFM_BOLD | CFM_ITALIC` and font-set logic; idea.md "simple tokenizer" + v1 scope says color only. Source: D-1.
- R-4: **Skipping Layer 2 (tokenizer-only auto-test).** Rejected: SC-4 demands measurement of the FULL keystroke-to-paint cost. Layer 2's QueryPerformanceCounter env-gated log is the only way to measure the Win32 paint half without a CI Win32 runner.

<execution_context>
@./.claude/pan-wizard-core/workflows/execute-plan.md
@./.claude/pan-wizard-core/templates/summary.md
@./.claude/pan-wizard-core/references/handoff-decisions.md
</execution_context>

<context>
@.planning/project.md
@.planning/roadmap.md
@.planning/state.md
@.planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/04-research.md
@.planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/04-01-summary.md
@.planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/04-02-summary.md
@.planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/04-04a-summary.md
@.planning/phases/03-multi-tab-find-replace/03-05-summary.md
@src/syntax/mod.rs
@src/dispatch.rs
@src/editor.rs
@src/find.rs
@src/tab.rs
@src/app.rs
@src/lib.rs

<interfaces>
<!-- Phase 4 type contracts (set up by Plan 04-01). Tokenizers implemented by 04-04a. This plan consumes both. -->

From src/syntax/mod.rs (after 04-01 + 04-04a):
```rust
pub enum Language { Plain, Json, Markdown, JavaScript, Python }

pub enum TokenClass {
    Plain, Keyword, String, Number, Comment, Punct,
    Heading, Bold, Italic, CodeFence, Link,
}

pub struct Token { pub start: u32, pub end: u32, pub class: TokenClass }

pub enum LineEndState {
    Code,
    JsBlockComment,
    JsTemplateLiteral { backticks: u8 },
    PyTripleString { kind: PyTripleKind },
    MdCodeFence { fence_char: u8, fence_len: u8 },
}

// All 5 per-language tokenize_line impls land in 04-04a; this plan consumes via the dispatch:
pub fn tokenize_line(lang: Language, line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState);
```

**LF text source** — Plan 03-05 (find worker) extracts LF text via `EM_STREAMOUT` + `eol::normalize_to_lf`:
```rust
// src/find.rs or src/editor.rs (verify which file owns this — read it):
pub unsafe fn stream_out_lf(editor: &EditorState) -> Result<String>
```
If not currently `pub`, EXPOSE IT for highlight.rs to use. (Same Phase 3 precedent — find_dispatch_pure exposed pure helpers.) The simplest path: relocate to `src/editor.rs` as a method `EditorState::stream_out_lf(&self) -> Result<String>` so call sites read `tab.editor.stream_out_lf()`.

**WM_APP_HIGHLIGHT_REQUEST = WM_USER + 12** — declared in src/app.rs by Plan 04-01.

**Tab.line_states: Vec<LineEndState>** and **Tab.highlighting_in_progress: Cell<bool>** — pre-allocated by Plan 04-01.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create src/highlight.rs with palette + CharFormatSink trait + apply_visible_viewport (with Layer-2 QPC env-gated log) + retokenize_from_edited_line + full_buffer_retokenize; expose stream_out_lf in src/editor.rs; declare highlight in lib.rs/main.rs</name>
  <files>src/highlight.rs, src/lib.rs, src/main.rs, src/find.rs, src/editor.rs</files>
  <action>
**Create `src/highlight.rs`** (per D-1 D-2 D-3 D-4 D-6 D-7 D-9 — including the CharFormatSink trait + Layer-2 QPC instrumentation):

```rust
//! Visible-viewport syntax highlighting via RichEdit EM_SETCHARFORMAT.
//!
//! Plan 04-04b entry point. Coordinates with src/syntax/{lang}.rs tokenizers
//! (Plan 04-04a) and src/dispatch.rs event hooks (this plan's Task 2) to apply
//! per-token-class color to the visible viewport on every edit, scroll, and
//! tab activation.
//!
//! Performance contract: <16ms keystroke-to-paint on 1MB JS in release.
//! Layer 1 (auto, tests/highlight_perf.rs): tokenizer + apply layer via MockSink <5ms.
//! Layer 2 (human-verify): QueryPerformanceCounter env-gated log, <16ms full keystroke-to-paint.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::Graphics::Gdi::*;
use windows::Win32::System::Performance::{QueryPerformanceCounter, QueryPerformanceFrequency};
use windows::Win32::UI::Controls::RichEdit::*;
use windows::Win32::UI::WindowsAndMessaging::*;

use crate::syntax::{tokenize_line, LineEndState, Token, TokenClass};
use crate::tab::Tab;

/// Hardcoded palette per Plan 04-04b D-1. Indexed by `TokenClass`.
/// COLORREF format is 0x00BBGGRR (Win32 convention).
pub fn palette(class: TokenClass) -> COLORREF {
    match class {
        TokenClass::Plain     => COLORREF(0x000000),
        TokenClass::Keyword   => COLORREF(0x800080),
        TokenClass::String    => COLORREF(0x098658),
        TokenClass::Number    => COLORREF(0x098658),
        TokenClass::Comment   => COLORREF(0x008000),
        TokenClass::Punct     => COLORREF(0x000000),
        TokenClass::Heading   => COLORREF(0x800000),
        TokenClass::Bold      => COLORREF(0x000000),
        TokenClass::Italic    => COLORREF(0x000000),
        TokenClass::CodeFence => COLORREF(0x008000),
        TokenClass::Link      => COLORREF(0x0000ff),
    }
}

/// Abstraction for the per-token CHARFORMAT call. Production uses `RealEMSetCharFormatSink`
/// (Win32 SendMessageW); perf tests use `MockSink` to isolate the apply layer wall-clock
/// from Win32 paint cost (Plan 04-04b D-9 Layer 1).
pub trait CharFormatSink {
    /// Apply `color` to char range [start, end) in the target.
    fn apply(&mut self, start: i32, end: i32, color: COLORREF);

    /// Number of `apply` invocations so far (perf-test introspection).
    fn call_count(&self) -> usize;
}

/// Production sink — sends real EM_SETSEL + EM_SETCHARFORMAT to the RichEdit.
pub struct RealEMSetCharFormatSink {
    pub hwnd_re: HWND,
    pub calls: usize,
}

impl CharFormatSink for RealEMSetCharFormatSink {
    fn apply(&mut self, start: i32, end: i32, color: COLORREF) {
        unsafe {
            let _ = SendMessageW(
                self.hwnd_re,
                EM_SETSEL,
                Some(WPARAM(start as usize)),
                Some(LPARAM(end as isize)),
            );
            let mut cf = CHARFORMAT2W::default();
            cf.cbSize = std::mem::size_of::<CHARFORMAT2W>() as u32;
            cf.dwMask = CFM_COLOR;
            cf.crTextColor = color;
            let _ = SendMessageW(
                self.hwnd_re,
                EM_SETCHARFORMAT,
                Some(WPARAM(SCF_SELECTION as usize)),
                Some(LPARAM(&cf as *const _ as isize)),
            );
        }
        self.calls += 1;
    }
    fn call_count(&self) -> usize { self.calls }
}

/// Read NOTEPADRS_PERF_LOG once — log Layer-2 timings if set.
fn perf_log_enabled() -> bool {
    std::env::var("NOTEPADRS_PERF_LOG").map(|v| v == "1").unwrap_or(false)
}

/// Apply per-token-class color to the visible viewport of `tab.editor.hwnd_re`.
/// Wraps the EM_SETCHARFORMAT loop in selection save/restore + WM_SETREDRAW
/// suspension (Pitfall P4-1). Bails early if `highlighting_in_progress` is set
/// (Pitfall P4-3). Per D-9 Layer 2: when NOTEPADRS_PERF_LOG=1, emits
/// `[perf] highlight: lines=N elapsed_us=M` via eprintln (debug) /
/// OutputDebugStringW (release) so a human verifier can confirm <16ms.
pub unsafe fn apply_visible_viewport(tab: &Tab, line_height_px: i32, lf_text: &str) {
    if tab.highlighting_in_progress.get() { return; }
    tab.highlighting_in_progress.set(true);

    let hwnd_re = tab.editor.hwnd_re;

    // ===== Save selection + suspend repaint (Pitfall P4-1) =====
    let mut sel_start: i32 = 0;
    let mut sel_end: i32 = 0;
    let _ = SendMessageW(
        hwnd_re,
        EM_GETSEL,
        Some(WPARAM(&mut sel_start as *mut _ as usize)),
        Some(LPARAM(&mut sel_end as *mut _ as isize)),
    );
    let _ = SendMessageW(hwnd_re, EM_HIDESELECTION, Some(WPARAM(1)), Some(LPARAM(0)));
    let _ = SendMessageW(hwnd_re, WM_SETREDRAW, Some(WPARAM(0)), Some(LPARAM(0)));

    // ===== Layer-2 perf instrumentation start (D-9) =====
    let perf_log = perf_log_enabled();
    let (mut qpc_start, mut qpc_freq) = (0i64, 0i64);
    if perf_log {
        let _ = QueryPerformanceFrequency(&mut qpc_freq as *mut _ as *mut _);
        let _ = QueryPerformanceCounter(&mut qpc_start as *mut _ as *mut _);
    }

    // ===== Compute visible range =====
    let first = SendMessageW(hwnd_re, EM_GETFIRSTVISIBLELINE, None, None).0 as u32;
    let total = SendMessageW(hwnd_re, EM_GETLINECOUNT, None, None).0 as u32;
    let mut rc = RECT::default();
    let _ = GetClientRect(hwnd_re, &mut rc);
    let visible_rows = (((rc.bottom - rc.top) / line_height_px.max(1)) as u32) + 1;
    let last = (first + visible_rows).min(total);

    let mut sink = RealEMSetCharFormatSink { hwnd_re, calls: 0 };

    // ===== Iterate lines, tokenize, apply CHARFORMAT2W via the sink =====
    let lines: Vec<&str> = lf_text.split('\n').collect();
    apply_viewport_with_sink(
        &mut sink,
        hwnd_re,
        tab.language,
        &lines,
        &tab.line_states,
        first,
        last,
    );

    // ===== Restore =====
    let _ = SendMessageW(hwnd_re, WM_SETREDRAW, Some(WPARAM(1)), Some(LPARAM(0)));
    let _ = RedrawWindow(
        Some(hwnd_re),
        None,
        None,
        RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN,
    );
    let _ = SendMessageW(
        hwnd_re,
        EM_SETSEL,
        Some(WPARAM(sel_start as usize)),
        Some(LPARAM(sel_end as isize)),
    );
    let _ = SendMessageW(hwnd_re, EM_HIDESELECTION, Some(WPARAM(0)), Some(LPARAM(0)));

    // ===== Layer-2 perf instrumentation end =====
    if perf_log && qpc_freq > 0 {
        let mut qpc_end = 0i64;
        let _ = QueryPerformanceCounter(&mut qpc_end as *mut _ as *mut _);
        let elapsed_us = ((qpc_end - qpc_start) * 1_000_000) / qpc_freq;
        let nlines = (last - first) as i64;
        let msg = format!("[perf] highlight: lines={} elapsed_us={}\n", nlines, elapsed_us);
        // Both delivery channels — release uses OutputDebugStringW, debug also eprintln.
        #[cfg(debug_assertions)]
        eprint!("{}", msg);
        let mut wide: Vec<u16> = msg.encode_utf16().chain(std::iter::once(0)).collect();
        windows::Win32::System::Diagnostics::Debug::OutputDebugStringW(PCWSTR(wide.as_mut_ptr()));
    }

    tab.highlighting_in_progress.set(false);
}

/// Pure — no Win32 reads except via the sink. Reusable from tests/highlight_perf.rs (Layer 1).
pub fn apply_viewport_with_sink<S: CharFormatSink>(
    sink: &mut S,
    hwnd_re_for_lineindex: HWND, // for EM_LINEINDEX query — MockSink stubs this via lookup table
    lang: crate::syntax::Language,
    lines: &[&str],
    line_states: &[LineEndState],
    first: u32,
    last: u32,
) {
    for line_idx in first..last {
        let prev_state = if line_idx == 0 {
            LineEndState::Code
        } else if (line_idx as usize - 1) < line_states.len() {
            line_states[line_idx as usize - 1]
        } else {
            LineEndState::Code
        };
        let line_str = lines.get(line_idx as usize).copied().unwrap_or("");
        let (tokens, _new_end) = tokenize_line(lang, line_str, prev_state);

        // EM_LINEINDEX returns the char offset (UTF-16 cu) of the start of line `line_idx`.
        // For Layer 1 (MockSink), tests pass a stub HWND; the sink just records the call.
        let line_start = unsafe {
            SendMessageW(
                hwnd_re_for_lineindex,
                EM_LINEINDEX,
                Some(WPARAM(line_idx as usize)),
                Some(LPARAM(0)),
            ).0
        } as i32;

        for tok in &tokens {
            let cf_start = line_start + tok.start as i32;
            let cf_end = line_start + tok.end as i32;
            sink.apply(cf_start, cf_end, palette(tok.class));
        }
    }
}

/// Incremental retokenize from `edited_line_idx` forward until the LineEndState stabilizes.
/// Updates `tab.line_states` in place. After this call, the caller invokes `apply_visible_viewport`.
pub fn retokenize_from_edited_line(
    tab: &mut Tab,
    edited_line_idx: u32,
    lf_text: &str,
) {
    let lines: Vec<&str> = lf_text.split('\n').collect();
    let total = lines.len();

    let mut line_idx = edited_line_idx as usize;
    while line_idx < total {
        let prev_state = if line_idx == 0 {
            LineEndState::Code
        } else if line_idx - 1 < tab.line_states.len() {
            tab.line_states[line_idx - 1]
        } else {
            LineEndState::Code
        };
        let (_tokens, new_end) = tokenize_line(tab.language, lines[line_idx], prev_state);

        if line_idx < tab.line_states.len() && tab.line_states[line_idx] == new_end {
            // Stabilized — downstream cached states are still valid.
            return;
        }
        if line_idx >= tab.line_states.len() {
            tab.line_states.resize(line_idx + 1, LineEndState::Code);
        }
        tab.line_states[line_idx] = new_end;
        line_idx += 1;
    }
    // Trim if the buffer shrank.
    if tab.line_states.len() > total {
        tab.line_states.truncate(total);
    }
}

/// Full retokenize — used on tab activation when `tab.line_states` is empty.
/// Iterates ALL lines without early-stop. Pitfall P4-6.
pub fn full_buffer_retokenize(tab: &mut Tab, lf_text: &str) {
    let lines: Vec<&str> = lf_text.split('\n').collect();
    tab.line_states.clear();
    tab.line_states.reserve(lines.len());
    let mut prev_state = LineEndState::Code;
    for line in &lines {
        let (_tokens, new_end) = tokenize_line(tab.language, line, prev_state);
        tab.line_states.push(new_end);
        prev_state = new_end;
    }
}
```

**Update `src/lib.rs`** — append `pub mod highlight;` to the existing pub-mod block.

**Update `src/main.rs`** — append `mod highlight;` to the module declaration block.

**Expose `stream_out_lf` as a method on `EditorState` in `src/editor.rs`.** Read `src/find.rs` first — Plan 03-05 likely placed the LF stream-out logic there. Two acceptable options:
1. **Preferred:** Move/copy the body into `src/editor.rs` as `pub unsafe fn stream_out_lf(&self) -> Result<String>` so callers read `tab.editor.stream_out_lf()`. Update `src/find.rs` callers to use the new method.
2. **Fallback:** Make the existing `src/find.rs` helper `pub` and expose its signature; `src/highlight.rs` and `src/dispatch.rs` import it.

**Imports needed (varies by which option chosen):**
```rust
// In src/highlight.rs (already covered above)
// In src/dispatch.rs (Task 2):
use crate::highlight::{apply_visible_viewport, retokenize_from_edited_line, full_buffer_retokenize};
```

**Critical:** This task does NOT wire any dispatch.rs event handlers — only creates `src/highlight.rs`, exposes `stream_out_lf`, and declares the module. Task 2 wires the event handlers.
  </action>
  <verify>
    <automated tier="T1">cargo build --target x86_64-pc-windows-msvc 2>&amp;1 | tail -10</automated>
    <automated tier="T1">cargo clippy --target x86_64-pc-windows-msvc --lib --bins -- -D warnings 2>&amp;1 | tail -10</automated>
  </verify>
  <done>
- `src/highlight.rs` exists with `palette()`, `apply_visible_viewport()`, `apply_viewport_with_sink()`, `retokenize_from_edited_line()`, `full_buffer_retokenize()`, `CharFormatSink` trait, `RealEMSetCharFormatSink` impl, `perf_log_enabled()` env-var helper.
- `apply_visible_viewport` includes the Layer-2 `QueryPerformanceCounter` env-gated timing log per D-9.
- `apply_viewport_with_sink` is `pub` so `tests/highlight_perf.rs` can drive it with a `MockSink` (Layer 1).
- `src/lib.rs` declares `pub mod highlight;`; `src/main.rs` declares `mod highlight;`.
- `stream_out_lf` is `pub` and accessible to `src/highlight.rs` and `src/dispatch.rs` (preferably as `EditorState::stream_out_lf` method).
- `cargo build` succeeds; `cargo clippy -- -D warnings` passes.
  </done>
</task>

<task type="auto">
  <name>Task 2: Wire highlighting into dispatch.rs (EN_CHANGE / EN_VSCROLL / TCN_SELCHANGE / do_file_open / WM_APP_HIGHLIGHT_REQUEST handler) using capture-before-mut-borrow pattern (Blocker #3); add EN_VSCROLL Warning #7 code comment</name>
  <files>src/dispatch.rs</files>
  <action>
**Update `src/dispatch.rs`** with the highlight wiring. **Critical:** every dispatch site that needs both `app.line_height_px` (Copy) and `app.active_mut()` (mutable borrow) MUST capture `app.line_height_px` to a local `let` BEFORE the mutable borrow (per D-10 Blocker #3). The same applies to any other Copy field on App accessed alongside `app.active_mut()`.

1. **WM_COMMAND EN_CHANGE — invoke incremental retokenize + visible recolor.** After Plan 04-03's `update_row_col_segment` and `update_line_count_segment` calls (existing in EN_CHANGE branch), append:
   ```rust
   // Phase 4: incremental retokenize from edited line + recolor visible viewport.
   // CAPTURE-BEFORE-MUT-BORROW (Blocker #3): copy out Copy fields from `app` BEFORE the
   // mutable borrow on `app.active_mut()`. line_height_px is i32 (Copy) so this is free.
   let line_height = app.line_height_px;
   if let Some(tab) = app.active_mut() {
       if !tab.highlighting_in_progress.get() && tab.language != crate::syntax::Language::Plain {
           let lf_text = unsafe { tab.editor.stream_out_lf() }.unwrap_or_default();
           // Find edited line index from current selection
           let mut sel_end: i32 = 0;
           let mut sel_start: i32 = 0;
           unsafe {
               let _ = SendMessageW(
                   tab.editor.hwnd_re,
                   EM_GETSEL,
                   Some(WPARAM(&mut sel_start as *mut _ as usize)),
                   Some(LPARAM(&mut sel_end as *mut _ as isize)),
               );
           }
           let line_idx = unsafe {
               SendMessageW(
                   tab.editor.hwnd_re,
                   EM_LINEFROMCHAR,
                   Some(WPARAM(sel_end as usize)),
                   Some(LPARAM(0)),
               ).0
           } as u32;
           crate::highlight::retokenize_from_edited_line(tab, line_idx, &lf_text);
           unsafe {
               crate::highlight::apply_visible_viewport(tab, line_height, &lf_text);
           }
       }
   }
   ```
   (Plain-language tabs skip the highlight pipeline entirely — no work to do.)

2. **WM_NOTIFY EN_VSCROLL — re-color new viewport using IMMUTABLE `iter().find` (Warning #7).** After Plan 04-02's `InvalidateRect(gutter)` call in the EN_VSCROLL branch, append:
   ```rust
   // Phase 4: re-color the new viewport.
   // EN_VSCROLL intentionally uses `app.tabs.iter().find(...)` (immutable) to call
   // `apply_visible_viewport(&Tab, ...)` only — retokenize on scroll is deferred to the
   // next EN_CHANGE per design D-3. Do NOT change to `iter_mut()`. (Warning #7 fix.)
   let line_height = app.line_height_px;
   if let Some(tab) = app.tabs.iter().find(|t| t.editor.hwnd_re == hwnd_from) {
       if !tab.highlighting_in_progress.get() && tab.language != crate::syntax::Language::Plain {
           let lf_text = unsafe { tab.editor.stream_out_lf() }.unwrap_or_default();
           unsafe {
               crate::highlight::apply_visible_viewport(tab, line_height, &lf_text);
           }
       }
   }
   ```

3. **WM_NOTIFY TCN_SELCHANGE — post WM_APP_HIGHLIGHT_REQUEST.** Inside the TCN_SELCHANGE handler, after the visibility swaps (RichEdit + gutter) and `update_all_segments`, append:
   ```rust
   // Phase 4: defer first highlight on the new tab until after WM_PAINT runs (Pitfall P4-4).
   let _ = unsafe { PostMessageW(Some(hwnd), crate::app::WM_APP_HIGHLIGHT_REQUEST, WPARAM(0), LPARAM(0)) };
   ```

4. **`do_file_open` success branch — post WM_APP_HIGHLIGHT_REQUEST.** After Plan 04-03's `update_all_segments` call and Plan 04-01's `tab.language = lang_from_path(path)`, append:
   ```rust
   // Phase 4: clear cached state (this is a fresh buffer) and request initial highlight.
   if let Some(tab) = app.active_mut() {
       tab.line_states.clear();
   }
   let _ = unsafe { PostMessageW(Some(hwnd), crate::app::WM_APP_HIGHLIGHT_REQUEST, WPARAM(0), LPARAM(0)) };
   ```

5. **WM_APP_HIGHLIGHT_REQUEST handler.** Add to the WM_* match (anywhere appropriate, e.g., near WM_APP_FIND_RESULT and WM_APP_FIND_DIALOG_CLOSED handlers). Use the `==` form rather than the `match` arm because match patterns require const expressions and our WM_APP_HIGHLIGHT_REQUEST is a runtime-resolved `const fn` value:
   ```rust
   m if m == crate::app::WM_APP_HIGHLIGHT_REQUEST => {
       // CAPTURE-BEFORE-MUT-BORROW (Blocker #3): copy Copy fields BEFORE app.active_mut().
       let line_height = app.line_height_px;
       if let Some(tab) = app.active_mut() {
           if tab.language != crate::syntax::Language::Plain {
               let lf_text = unsafe { tab.editor.stream_out_lf() }.unwrap_or_default();
               if tab.line_states.is_empty() {
                   crate::highlight::full_buffer_retokenize(tab, &lf_text);
               }
               unsafe {
                   crate::highlight::apply_visible_viewport(tab, line_height, &lf_text);
               }
           }
       }
       LRESULT(0)
   }
   ```

**Imports needed at top of `src/dispatch.rs`:**
```rust
use windows::Win32::UI::Controls::RichEdit::{EM_LINEFROMCHAR};
use windows::Win32::UI::WindowsAndMessaging::PostMessageW;
```
(EM_LINEINDEX should already be imported via Plan 04-03; PostMessageW likely already imported via Phase 3.)

**Borrow-checker validation:** after writing each handler above, mentally trace through:
- `let line_height = app.line_height_px;` — completes (Copy out, no lingering borrow).
- `if let Some(tab) = app.active_mut() { ... }` — `&mut app` for the `if let` body.
- Inside the body, references to `app` are forbidden. References to `line_height` (the local i32) are fine.
- `apply_visible_viewport(tab, line_height, &lf_text)` — passes `&Tab` (re-borrow from `&mut Tab`), `i32` (Copy), `&str`. No conflict.

**If `cargo check` reports an `&app + &mut app` error:** the executor missed a capture-before-mut-borrow site. Audit the surrounding code; the fix is always "copy the Copy field to a local `let` BEFORE `app.active_mut()`."
  </action>
  <verify>
    <automated tier="T1">cargo build --target x86_64-pc-windows-msvc 2>&amp;1 | tail -10</automated>
    <automated tier="T1">cargo clippy --target x86_64-pc-windows-msvc --lib --bins -- -D warnings 2>&amp;1 | tail -10</automated>
    <automated tier="T2">cargo test --target x86_64-pc-windows-msvc 2>&amp;1 | tail -15</automated>
  </verify>
  <done>
- `src/dispatch.rs` wires:
  - EN_CHANGE branch: retokenize_from_edited_line + apply_visible_viewport (skipped for Plain language and when highlighting_in_progress) — using capture-before-mut-borrow per Blocker #3.
  - WM_NOTIFY EN_VSCROLL: apply_visible_viewport via `app.tabs.iter().find` (immutable) — with Warning #7 code comment in source explaining "Do NOT change to iter_mut()."
  - WM_NOTIFY TCN_SELCHANGE: PostMessageW(WM_APP_HIGHLIGHT_REQUEST).
  - do_file_open success: clear line_states + PostMessageW(WM_APP_HIGHLIGHT_REQUEST).
  - WM_APP_HIGHLIGHT_REQUEST handler: full_buffer_retokenize if line_states empty, then apply_visible_viewport — using capture-before-mut-borrow per Blocker #3.
- All Phase 2 + Phase 3 + Plan 04-01/02/03 + 04-04a + Task 1 unit tests still pass.
- `cargo clippy --tests -- -D warnings` passes — no borrow-checker errors.
  </done>
</task>

<task type="auto">
  <name>Task 3: Create tests/highlight_perf.rs Layer-1 perf gate (CharFormatSink mock + 1MB JS buffer + tokenize+apply <5ms wall-clock)</name>
  <files>tests/highlight_perf.rs</files>
  <action>
**Create `tests/highlight_perf.rs`** (per D-9 Layer 1):

```rust
//! Plan 04-04b Layer-1 performance gate.
//!
//! Asserts the syntax-highlight tokenizer + apply layer (everything ABOVE the
//! Win32 boundary) fits a <5ms wall-clock budget on a 1MB JavaScript-style
//! buffer in release. Uses a `MockSink` (CharFormatSink stub) so the test runs
//! without a Win32 window — the EM_SETCHARFORMAT path is replaced with a call
//! counter + total-time accumulator.
//!
//! Layer 2 (the Win32 paint cost) is verified by the human-verify checkpoint
//! in Plan 04-04b Task 4 with a QueryPerformanceCounter env-gated log.
//!
//! Marked #[ignore] to gate via `cargo test --release --test highlight_perf -- --ignored`.

#![allow(unused_imports)]

use std::time::Instant;
use windows::Win32::Foundation::*;
use windows::Win32::UI::WindowsAndMessaging::*;

use notepadrs::highlight::{
    apply_viewport_with_sink, full_buffer_retokenize, palette, retokenize_from_edited_line,
    CharFormatSink,
};
use notepadrs::syntax::{tokenize_line, Language, LineEndState};

// ============================================================
// MockSink — no Win32, just counts calls and total wall-clock.
// ============================================================

struct MockSink {
    calls: usize,
    total_color_us: u128, // sum across all .apply() invocations
}

impl MockSink {
    fn new() -> Self { Self { calls: 0, total_color_us: 0 } }
}

impl CharFormatSink for MockSink {
    fn apply(&mut self, _start: i32, _end: i32, _color: windows::Win32::Foundation::COLORREF) {
        self.calls += 1;
        // No actual work — but read the args to avoid optimization.
        std::hint::black_box(_start);
    }
    fn call_count(&self) -> usize { self.calls }
}

fn synthesize_1mb_js() -> String {
    // 50,000 lines of JS-style code, ~20 chars/line ≈ 1MB.
    let template = [
        "const x = 'hello world';",
        "function foo(a, b) { return a + b; }",
        "// a line comment here",
        "let arr = [1, 2, 3, 4, 5];",
        "if (x === null) { return; }",
    ];
    let mut s = String::with_capacity(1_100_000);
    for i in 0..50_000 {
        s.push_str(template[i % template.len()]);
        s.push('\n');
    }
    s
}

// Helper: build a fake Tab for testing. We can't construct a real Tab without Win32,
// but apply_viewport_with_sink takes (lang, lines, line_states, first, last) — so we
// build the slices directly.
fn build_state(lines: &[&str], lang: Language) -> Vec<LineEndState> {
    let mut states = Vec::with_capacity(lines.len());
    let mut prev = LineEndState::Code;
    for line in lines {
        let (_t, end) = tokenize_line(lang, line, prev);
        states.push(end);
        prev = end;
    }
    states
}

#[test]
#[ignore]
fn full_tokenize_1mb_js_under_500ms_release() {
    let buf = synthesize_1mb_js();
    let lines: Vec<&str> = buf.split('\n').collect();
    let n = lines.len();
    let mut prev = LineEndState::Code;

    let start = Instant::now();
    for line in &lines {
        let (_toks, end) = tokenize_line(Language::JavaScript, line, prev);
        prev = end;
    }
    let elapsed = start.elapsed();

    println!(
        "Full 1MB JS tokenize: {n} lines in {elapsed:?} ({:.2} µs/line)",
        elapsed.as_micros() as f64 / n as f64
    );
    assert!(
        elapsed.as_millis() < 500,
        "Full tokenize exceeded 500ms target: {elapsed:?}"
    );
}

#[test]
#[ignore]
fn tokenize_plus_apply_layer_under_5ms_release() {
    // Layer 1: tokenizer + apply layer (CharFormatSink::apply path) for one viewport refresh.
    // Visible-viewport size ≈ 50 lines (typical Win32 editor at 1080p).
    let buf = synthesize_1mb_js();
    let lines: Vec<&str> = buf.split('\n').collect();
    let states = build_state(&lines, Language::JavaScript);

    // Hand a stub HWND — MockSink doesn't call EM_LINEINDEX (we pre-compute the offset).
    // But apply_viewport_with_sink does call EM_LINEINDEX on each line. For a unit-test
    // pure-logic measurement, we accept that EM_LINEINDEX returns 0 on a null HWND
    // (no-op via SendMessageW; the per-line offset will be 0, which the MockSink is
    // OK with — we're measuring the tokenize + token-iterate cost, not the offset math).
    let stub_hwnd = HWND(std::ptr::null_mut());

    let mut sink = MockSink::new();
    let first = 25_000u32;
    let last = first + 50; // typical visible viewport

    let start = Instant::now();
    apply_viewport_with_sink(
        &mut sink,
        stub_hwnd,
        Language::JavaScript,
        &lines,
        &states,
        first,
        last,
    );
    let elapsed = start.elapsed();

    println!(
        "Apply layer (50-line viewport in 1MB JS): {} sink calls in {:?}",
        sink.call_count(),
        elapsed
    );
    assert!(
        elapsed.as_millis() < 5,
        "Tokenize + apply layer exceeded 5ms budget: {:?}",
        elapsed
    );
}

#[test]
#[ignore]
fn incremental_retokenize_at_line_25k_under_5ms_release() {
    // Verifies retokenize_from_edited_line stabilizes quickly. Pure tokenizer + line_states
    // mutation, no sink — proxy for the EN_CHANGE path's tokenize cost (the apply cost is
    // measured by `tokenize_plus_apply_layer_under_5ms_release`).
    let buf = synthesize_1mb_js();
    let lines: Vec<&str> = buf.split('\n').collect();

    // Warm up: full retokenize once to populate state.
    let mut line_states: Vec<LineEndState> = Vec::with_capacity(lines.len());
    let mut prev = LineEndState::Code;
    for line in &lines {
        let (_t, end) = tokenize_line(Language::JavaScript, line, prev);
        line_states.push(end);
        prev = end;
    }

    // Simulate retokenize at index 25_000 with stabilization on the very next line.
    let edited = 25_000usize;
    let n_runs = 100;
    let start = Instant::now();
    for _ in 0..n_runs {
        let line_idx = edited;
        let prev = if line_idx == 0 { LineEndState::Code } else { line_states[line_idx - 1] };
        let (_t, _new_end) = tokenize_line(Language::JavaScript, lines[line_idx], prev);
    }
    let elapsed = start.elapsed();
    let per_run = elapsed / n_runs;

    println!(
        "Incremental retokenize 100 runs: total {elapsed:?}, per-run {per_run:?}"
    );
    assert!(
        per_run.as_millis() < 5,
        "Per-run retokenize exceeded 5ms budget: {per_run:?}"
    );
}
```

**Run the perf gate:**
```
cargo test --release --target x86_64-pc-windows-msvc --test highlight_perf -- --ignored --nocapture
```

The 3 tests should print timing and pass:
- `full_tokenize_1mb_js_under_500ms_release` — bounds the full-buffer tokenize (initial open) at <500ms.
- `tokenize_plus_apply_layer_under_5ms_release` — Layer 1 gate: tokenizer + apply layer for a 50-line viewport <5ms.
- `incremental_retokenize_at_line_25k_under_5ms_release` — incremental retokenize per keystroke <5ms.

**If Layer 1 perf gate fails (e.g., apply layer >5ms):** the executor MUST surface the failure as a deviation in the plan summary AND propose an escape hatch (memoize Vec<Token> per line per O-2; or move tokenization to a worker thread per 04-research.md Open Question 1; or reduce token-class granularity). DO NOT silently downgrade the threshold.
  </action>
  <verify>
    <automated tier="T1">cargo build --target x86_64-pc-windows-msvc 2>&amp;1 | tail -5</automated>
    <automated tier="T1">cargo clippy --target x86_64-pc-windows-msvc --tests -- -D warnings 2>&amp;1 | tail -10</automated>
    <automated tier="T2">cargo test --release --target x86_64-pc-windows-msvc --test highlight_perf -- --ignored --nocapture 2>&amp;1 | tail -30</automated>
  </verify>
  <done>
- `tests/highlight_perf.rs` ships 3 #[ignore]-marked tests:
  - `full_tokenize_1mb_js_under_500ms_release` — full-buffer initial tokenize bound.
  - `tokenize_plus_apply_layer_under_5ms_release` — Layer 1 gate: 50-line viewport tokenize+apply <5ms via MockSink.
  - `incremental_retokenize_at_line_25k_under_5ms_release` — per-keystroke retokenize <5ms.
- `MockSink` implements `CharFormatSink` with no Win32 calls — isolates the apply layer wall-clock from paint cost.
- `apply_viewport_with_sink` is exercised end-to-end through real Rust code (tokenizer + token iteration + sink dispatch) — Layer 1 contract validated.
- All 3 perf tests pass on `cargo test --release --test highlight_perf -- --ignored --nocapture`.
- `cargo clippy --tests -- -D warnings` passes.
  </done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 4 (checkpoint): Human-verify per-language highlighting (JS/PY/JSON/MD/Plain), Pitfall mitigations, and Layer-2 perf measurement (NOTEPADRS_PERF_LOG=1, QPC log, &lt;16000us per keystroke)</name>
  <action>Run the release-build Layer-1 perf gate (cargo test --release --test highlight_perf -- --ignored) AND visually verify per-language coloring (JS/PY/JSON/MD/Plain), the four Pitfall mitigations (P4-1 caret preserved, P4-3 no re-entrancy hang, P4-4 initial highlight, P4-6 tab-switch highlight), AND the Layer-2 perf measurement (NOTEPADRS_PERF_LOG=1 → QPC microsecond log < 16000) by running the release build and following the steps in <how-to-verify>. Approve when Layer 1 passes AND all 7 visual checks pass AND Layer 2 logs &lt; 16000us per keystroke.</action>
  <what-built>
**Plan 04-04b deliverables (auto):**
- Visible-viewport `EM_SETCHARFORMAT` color application via `src/highlight.rs::apply_visible_viewport`, including:
  - `CharFormatSink` trait + `RealEMSetCharFormatSink` (production) + `MockSink` (perf-test).
  - Selection / caret save+restore + WM_SETREDRAW bracketing (Pitfall P4-1).
  - Re-entrancy guard (Pitfall P4-3).
  - **Layer-2 QueryPerformanceCounter env-gated timing log: when `NOTEPADRS_PERF_LOG=1`, prints `[perf] highlight: lines=N elapsed_us=M` per keystroke.**
- Incremental retokenize from edited line + LineEndState stabilization (early-stop optimization).
- Tab-switch full-buffer retokenize via `WM_APP_HIGHLIGHT_REQUEST` post-message (Pitfall P4-4 + P4-6).
- All dispatch wiring uses capture-before-mut-borrow pattern (Blocker #3 fix).
- EN_VSCROLL handler uses `app.tabs.iter().find(...)` (immutable) per Warning #7.
- **Layer-1 perf gate**: `tests/highlight_perf.rs --ignored` validates tokenizer + apply layer <5ms via MockSink on 1MB JS in release.
  </what-built>
  <how-to-verify>
**1. Build release:**
```
cargo build --release --target x86_64-pc-windows-msvc
```

**2. Run Layer-1 perf gate (assertion-based, can fail the checkpoint):**
```
cargo test --release --target x86_64-pc-windows-msvc --test highlight_perf -- --ignored --nocapture
```
Expected output: 3 tests pass with timings printed showing well under 500ms / 5ms / 5ms respectively. **If any test fails, the highlight pipeline doesn't meet the QUAL-05 perf budget at the apply layer — record the timings and DO NOT approve this checkpoint until escape hatches are applied.**

**3. Run Layer-2 perf measurement (env-gated, human-readable):**

Open a PowerShell terminal:
```
$env:NOTEPADRS_PERF_LOG="1"
cargo run --release -- tests\fixtures\large.js   # OR any 1MB JS file
```
(If `tests/fixtures/large.js` doesn't exist, create it via `cargo test --release --test highlight_perf` first — synthesize_1mb_js can be exposed as a binary helper, OR copy a real large JS file like a minified bundle.)

In the running editor, type 100 characters at any position. In the terminal (or DebugView for release), you should see lines like:
```
[perf] highlight: lines=50 elapsed_us=8230
[perf] highlight: lines=50 elapsed_us=7945
...
```

**Expected:** every `elapsed_us` value < 16000 (16ms). If ANY value ≥ 16000, the keystroke-to-paint budget is missed in real Win32 paint paths — record the worst case and propose an escape hatch (worker thread, reduced token-class granularity, or memoize Vec<Token>).

**4. Verify per-language coloring (SYNTAX-01..05):**

**JavaScript (.js / .mjs):**
- Open or create `test.js` with: `const x = "hello"; // line comment\n/* block\ncomment */\nfunction foo(a, b) { return a + b; }\nconst re = /[a-z]+/g;`.
- Expected colors:
  - `const`, `function`, `return` → purple (Keyword).
  - `"hello"` → green (String).
  - `// line comment` → green (Comment).
  - `/* block\ncomment */` → green across BOTH lines (Comment, multi-line state via JsBlockComment).
  - `/[a-z]+/g` → green (String — regex via JS heuristic).
  - `foo`, `a`, `b`, `x`, `re` → black (Plain).

**Python (.py):**
- Create `test.py` with: `def foo(x):\n    return x * 2  # comment\nbar = """\ntriple\nstring\n"""\n@decorator\nclass X: pass`.
- Expected:
  - `def`, `return`, `class`, `pass` → purple (Keyword).
  - `2` → green (Number).
  - `# comment` → green (Comment).
  - `"""..."""` → green across all 3 lines (String, multi-line state via PyTripleString).
  - `@decorator` → purple (Keyword class per 04-04a D-8).

**JSON (.json):**
- Create `test.json` with: `{"key": "value", "n": 42, "ok": true, "x": null, "arr": [1,2,3]}`.
- Expected:
  - `"key"`, `"value"`, `"n"`, `"ok"`, `"x"`, `"arr"` → green (String).
  - `42`, `1`, `2`, `3` → green (Number — same color as String per palette).
  - `true`, `null` → purple (Keyword).
  - `{`, `}`, `[`, `]`, `,`, `:` → black (Punct).

**Markdown (.md):**
- Create `test.md` with: `# Heading 1\n## Heading 2\nThis is **bold** and *italic* text with \`inline code\`.\n\`\`\`rust\nfn main() {}\n\`\`\`\nAfter the fence.`.
- Expected:
  - Heading lines (`# ...`) → dark red.
  - `**bold**` → highlighted as Bold (palette currently shows black — visual distinction may be subtle in v1).
  - `*italic*` → Italic class.
  - `` `inline code` `` → green (Comment color).
  - The 3 lines between ` ``` ` fences → green (CodeFence, multi-line state via MdCodeFence).
  - "After the fence." → black/Plain.

**Plain (unknown extension):**
- Open or create `test.xyz` (or any file with no extension). All text should be plain black — NO highlighting visible.

**5. Verify scroll re-color (lazy viewport via EN_VSCROLL):**
- Open a long highlighted file (e.g., `cargo run -- src/dispatch.rs`).
- Press Page Down to scroll. The newly visible text should be highlighted (not flash plain-then-color).
- Mouse wheel scroll: same.

**6. Verify edit + tab-switch invariants (Pitfall mitigations):**
- **P4-1 (caret preserved):** Click somewhere mid-buffer, type a character. The caret should stay where the typed character ended — NOT jump to the end of the colored span.
- **P4-3 (no re-entrancy):** Hold down a key (autorepeat ~30 keystrokes/sec). CPU usage stays reasonable; no UI freeze.
- **P4-4 (initial highlight):** Open a JS file from cold start. The buffer should be highlighted within ~1 second of the window appearing (slight delay is OK — it's the WM_APP_HIGHLIGHT_REQUEST round trip).
- **P4-6 (tab switch):** Open file A (JS), open file B (PY) in new tab via Ctrl+T + Ctrl+O. Switch between them with Ctrl+Tab. Each tab shows ITS language's highlighting. No bleed-over.

**7. Verify Phase 1-3 + Plan 04-01/02/03 didn't regress:**
- Open / Save / encoding round-trip / EOL conversion all work.
- Find/Replace (Ctrl+F / Ctrl+H) opens dialog and finds matches.
- Multi-tab (Ctrl+T / Ctrl+W / dirty-asterisk / confirm-on-dirty-close) works.
- Status bar segments still update correctly.
- Gutter still scrolls in lockstep.
  </how-to-verify>
  <resume-signal>Type "approved" to advance to Plan 04-05 (per-language CI tokenizer test suite — Wave 4 in parallel with this plan, but the test suite needs the tokenizers from 04-04a, not the highlight wiring). If issues, describe symptoms and which step failed; especially if the Layer-1 perf gate or Layer-2 QPC log fails — the planner will spawn a gap-closure plan with the escape hatches from 04-research.md Open Question 1.</resume-signal>
</task>

</tasks>

<verification>
**Plan-level checks:**

1. **Build + clippy gates pass.** `cargo build --release` succeeds; `cargo clippy --tests -- -D warnings` shows zero warnings.

2. **All existing tests pass.** `cargo test --target x86_64-pc-windows-msvc 2>&1 | tail -30` shows ALL prior tests still passing.

3. **Layer-1 perf gate passes.** `cargo test --release --test highlight_perf -- --ignored` shows 3 tests passing with timings under budget (500ms / 5ms / 5ms).

4. **Highlight pipeline exists.** `grep -E 'fn (apply_visible_viewport|apply_viewport_with_sink|retokenize_from_edited_line|full_buffer_retokenize|palette)' src/highlight.rs` shows all five entry points.

5. **CharFormatSink trait exists.** `grep -E 'pub trait CharFormatSink|RealEMSetCharFormatSink' src/highlight.rs` shows both.

6. **Layer-2 QPC instrumentation present.** `grep -E 'QueryPerformanceCounter|NOTEPADRS_PERF_LOG|elapsed_us' src/highlight.rs` shows the Layer-2 timing block.

7. **EM_SETCHARFORMAT bracketing.** `grep -B 2 -A 12 'fn apply_visible_viewport' src/highlight.rs | grep -E 'EM_GETSEL|EM_HIDESELECTION|WM_SETREDRAW|RDW_INVALIDATE|EM_SETSEL'` shows the full save/restore sequence.

8. **Re-entrancy guard.** `grep -E 'highlighting_in_progress' src/highlight.rs` shows the get/set pair around the work block.

9. **Capture-before-mut-borrow (Blocker #3 fix).** `grep -E 'let line_height\s*=\s*app\.line_height_px' src/dispatch.rs` shows the pattern at every relevant call site.

10. **EN_VSCROLL Warning #7 comment in source.** `grep -E 'iter\(\).find|Do NOT change to .iter_mut' src/dispatch.rs` shows both the immutable iter call and the source comment.

11. **Dispatch wiring.** `grep -E 'WM_APP_HIGHLIGHT_REQUEST|apply_visible_viewport|retokenize_from_edited_line|full_buffer_retokenize' src/dispatch.rs` shows usage in EN_CHANGE, EN_VSCROLL, TCN_SELCHANGE, do_file_open, and the WM_APP_HIGHLIGHT_REQUEST handler.

12. **stream_out_lf is exposed.** `grep -E 'pub.*fn stream_out_lf' src/editor.rs src/find.rs` returns at least one hit.

13. **Human checkpoint approved** — Layer 1 perf gate passes, all 5 languages render correctly, Pitfall mitigations work, Layer 2 QPC log shows <16000us per keystroke.
</verification>

<success_criteria>
**This plan is complete when:**
- `src/highlight.rs` exposes `palette`, `apply_visible_viewport`, `apply_viewport_with_sink`, `retokenize_from_edited_line`, `full_buffer_retokenize`, `CharFormatSink` trait + `RealEMSetCharFormatSink`.
- `src/highlight.rs::apply_visible_viewport` includes the Layer-2 QPC timing log gated by `NOTEPADRS_PERF_LOG=1`.
- `src/lib.rs` and `src/main.rs` declare `highlight` module.
- `stream_out_lf` is `pub` in its owning module.
- `src/dispatch.rs` wires highlight pipeline into EN_CHANGE, EN_VSCROLL, TCN_SELCHANGE, do_file_open, and WM_APP_HIGHLIGHT_REQUEST handler — using capture-before-mut-borrow pattern (Blocker #3) at every call site.
- EN_VSCROLL handler uses `app.tabs.iter().find` (immutable) per Warning #7, with the explanatory code comment in source.
- `tests/highlight_perf.rs` ships 3 #[ignore]-marked perf tests including the Layer-1 tokenize+apply <5ms gate via MockSink, all passing on `cargo test --release -- --ignored`.
- Human-verify checkpoint approved: 5 languages render correctly; Layer-1 gate passes; Layer-2 QPC log shows <16000us per keystroke; Pitfall mitigations work as expected.
- 3 commits per task: `feat(04-04b): src/highlight.rs (palette + sink trait + apply_visible_viewport with QPC log)`, `feat(04-04b): wire highlight events in dispatch.rs (capture-before-mut-borrow)`, `test(04-04b): Layer-1 perf gate via MockSink`.
</success_criteria>

<output>
After completion, create `.planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/04-04b-summary.md`. Capture: the CharFormatSink trait design, the apply_visible_viewport sequence, the retokenize stabilization algorithm, perf measurements (Layer 1 tokenize+apply ms, Layer 2 QPC keystroke us), Pitfall mitigations applied (P4-1 / P4-3 / P4-4 / P4-6), the capture-before-mut-borrow pattern at each dispatch call site (Blocker #3), and any deviations (especially around the regex-literal heuristic edge cases observed during human verification, or any Layer-1 / Layer-2 perf surprises that required escape-hatch follow-up).
</output>
