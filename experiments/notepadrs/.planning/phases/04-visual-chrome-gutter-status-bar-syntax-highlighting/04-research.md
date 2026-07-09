# Phase 4: Visual Chrome — Gutter, Status Bar, Syntax Highlighting — Research

**Researched:** 2026-05-03
**Domain:** Win32 child-window composition (status bar + gutter sibling) + RichEdit `EM_SETCHARFORMAT` highlighting + per-language line-state tokenizers
**Confidence:** HIGH on Win32 control choices and RichEdit highlighting protocol; HIGH on tokenizer architecture (line-state machine pattern is well-established and already used in this project's research); MEDIUM on the keystroke-to-paint <16ms target for 1MB JS/Python — depends on `EM_SETCHARFORMAT` cost amortized via incremental scan + visible-viewport-only re-color (verifiable only by measurement).

> **Project-level research is the substrate.** This document emits ONLY phase-specific deltas. Read first:
> - `.planning/research/architecture.md` Pattern 6 (line-state tokenization) and Pattern 7 (dirty-rect repaint)
> - `.planning/research/stack.md` "RichEdit vs Custom Rendering" — Phase 4 follows the locked v1 RichEdit choice
> - `.planning/research/pitfalls.md` Pitfall 14 (RichEdit `EM_SETCHARFORMAT` undo-stack pollution + URL detection conflicts), Pitfall 15 (status bar flicker), Pitfall 19 (word-wrap row math)
> - `.planning/research/features.md` SC-4 critique (language list defensible) and SC-5 status bar segments

---

<phase_requirements>
## Phase Requirements

| ID | Description (from requirements.md) | Research Support |
|----|-----------------------------------|------------------|
| **VIEW-01** | Line-number gutter on the left edge of every tab | Pattern G1 (gutter as a sibling child window per tab; `WM_VSCROLL` reflection lockstep). Don't paint the gutter inside RichEdit's client area — RichEdit will overwrite it. |
| **VIEW-02** | Status bar shows cursor row:col | Pattern S1 (`STATUSCLASSNAME` + `SB_SETPARTS` + `SB_SETTEXTW`). Row:col on `EN_SELCHANGE` (RichEdit notification) or `EN_CHANGE` fallback; per-tab cached `SETSEL` position. |
| **VIEW-03** | Status bar shows file encoding | Pattern S1. Encoding is already on `EditorState.encoding` (Phase 2). Status bar reads it on tab switch + `IDM_ENCODING_*` menu select. |
| **VIEW-04** | Status bar shows line-ending style (LF/CRLF/CR) | Pattern S1. EOL is already on `EditorState.eol` (Phase 2). |
| **VIEW-05** | Status bar shows total line count | Pattern S1. Use `EM_GETLINECOUNT` (RichEdit native; O(1)) on every status update. |
| **SYNTAX-01** | JavaScript tokenizer (.js, .mjs) | Pattern T1 (line-state machine). Token classes: keyword, string (single/double/template), regex, number, line-comment, block-comment, identifier, punct. |
| **SYNTAX-02** | Python tokenizer (.py) | Pattern T1. Token classes: keyword, string (single/double/triple/f-prefixed), number, comment, decorator, identifier, punct. Indentation-significance NOT modeled (tokenizer only colors, doesn't parse). |
| **SYNTAX-03** | JSON tokenizer (.json) | Pattern T1, simplest grammar. Token classes: string, number, boolean, null, punct. |
| **SYNTAX-04** | Markdown tokenizer (.md, .markdown) | Pattern T1. Token classes: heading, bold, italic, code-inline, code-fence (multi-line state), link, list-marker. |
| **SYNTAX-05** | Plain-text fallback (no highlighting) | Pattern T1, no-op tokenizer — returns single `Plain` token spanning the full line. |
| **SYNTAX-06** | Language detection by file extension on open | Pattern L1 (extension → `Language` enum dispatch in `file::open_any_encoding` flow OR a separate `syntax::lang_from_path(&Path) -> Language` helper). |
| **TEST-07** | Per-language syntax-tokenizer tests for JS / Python / JSON / Markdown / plain | Pattern V1 (golden-token-stream tests, one fixture per language, in `tests/syntax_tokenizers.rs`). |
</phase_requirements>

---

<user_constraints>
## User Constraints (no per-phase context.md — auto-mode P-1802 bypass)

No per-phase `context.md` exists. Locked decisions are derived from `idea.md` frontmatter, project-level research, and prior phase decisions in `state.md`. The planner MUST honor:

### Locked Decisions (derived from idea.md + roadmap.md + Phase 1-3 lock-ins)

- **Crate allowlist (idea.md Constraints):** `windows` 0.62 + `regex` 1.12 + `encoding_rs` 0.8 + `serde` 1.0 + `serde_json` 1.0. **No new crates** for Phase 4. In particular: NO `syntect`, NO `tree-sitter`, NO `nom` / parser combinators, NO regex-based tokenizers (regex is for find/replace only — see `.planning/research/architecture.md` Anti-Pattern 7 / Pitfall 5).
- **Rendering substrate:** RichEdit 4.1 (`MSFTEDIT_CLASS`) per `.planning/research/stack.md`. Per-tab RichEdit child (`Tab.editor.hwnd_re`, established in Plan 03-01). **Phase 4 does NOT switch to custom render** (state.md blocker note: "RichEdit-vs-custom decision committed for v1; defer custom render to v2").
- **Window composition:** sibling child windows. The status bar (`STATUSCLASSNAME`) is a sibling of the per-tab RichEdit children; the gutter is a sibling per-tab child window painted with GDI. The tab strip (`SysTabControl32`, Plan 03-02 / `App.htabs`) is also a sibling. RichEdit is NOT a parent of any of these.
- **Layout discipline:** `WM_SIZE` in `dispatch.rs` (already iterates all tabs per Plan 03-01 D-9) MUST be extended to lay out: tab strip (top, height = `TAB_STRIP_HEIGHT` = 28px), gutter (left of editor, dynamic width), RichEdit (right of gutter, above status bar), status bar (bottom, height typically ~22px at 96 DPI returned by the control itself). Use `STATUSCLASSNAME` height-self-determination, not hardcoded.
- **Threading model:** UI thread does the work (per `idea.md` "no async runtime" + `.planning/research/architecture.md` Pattern 5). Phase 3 added the `std::thread::spawn` + `Arc<AtomicU64>` epoch-cancellation worker for find. Phase 4 is permitted to reuse the same pattern for **off-viewport background tokenization** if the visible-viewport sync path doesn't meet the <16ms keystroke-to-paint target — but the simpler v1 path is "tokenize visible lines synchronously on every relevant edit; off-viewport lazy on scroll." Recommend the latter; flag a worker reuse only if measurement fails.
- **Performance contract (idea.md / QUAL-05 / SC-4 success criterion 4):** keystroke-to-paint <16ms in release builds for 1MB JS/Python. The contract DEMANDS incremental tokenization with line-end-state stabilization (Pattern T1). Re-tokenizing the entire buffer per keystroke is forbidden (`.planning/research/architecture.md` Anti-Pattern 3).
- **Win32 control choices (locked since stack.md):**
  - Status bar: `STATUSCLASSNAME` predefined common control (auto-double-buffered — solves Pitfall 15 flicker for free). NOT a custom-painted band.
  - Gutter: custom-painted `WS_CHILD` window with `WM_PAINT` + `DrawTextW`. NOT inside the RichEdit client area (RichEdit will overwrite). NOT a separate `EDIT` control (no formatting control).
  - Highlighting: RichEdit `EM_SETCHARFORMAT` with `CHARFORMAT2W` — color via `CFM_COLOR | CFM_FACE | CFM_CHARSET`. (Stack.md "What NOT to Use" forbids `CHARFORMATA`.)
- **Pitfall 14 mitigations are mandatory:**
  - Wrap re-highlight runs in `EM_HIDESELECTION(TRUE)` + `WM_SETREDRAW(FALSE)` ... `WM_SETREDRAW(TRUE)` + `RedrawWindow` to avoid flicker and selection-jump.
  - Keep auto-URL detect off (Plan 01-02 already calls `EM_AUTOURLDETECT(0)` in `EditorState::create` — confirmed in `src/editor.rs:67`).
  - **`EM_SETCHARFORMAT` does NOT pollute RichEdit's undo stack when applied with `SCF_SELECTION`** if you save+restore the selection around it (the stack-pollution risk in pitfalls.md Pitfall 14 is for character-by-character changes; we'll batch by token-class run inside each visible viewport update).
  - **Critical:** call `EM_SETUNDOLIMIT(1000)` is already done by Plan 01-02. Do NOT reduce it on highlight; do save+restore selection so the user's caret stays put.
- **Trailing-newline preservation, encoding round-trip, and EOL preservation are Phase 2 invariants** (state.md). Phase 4 MUST NOT touch `EditorState::open_text_with_metadata` / `save_text_for_disk` / `save_text_for_disk_as`. Tokenization runs from the LF-normalized text RichEdit reports (`EM_STREAMOUT` → `eol::normalize_to_lf` — same path Phase 3 uses for find).
- **Per-tab state (TAB-07 / Plan 03-01):** every Phase 4 piece of state goes ON THE TAB, not on App. Specifically: `Tab.gutter_hwnd: HWND`, `Tab.language: Language`, `Tab.line_states: Vec<LineEndState>`, `Tab.last_line_count: u32`. Tab switch shows/hides the gutter via `ShowWindow` (mirrors `EditorState` visibility — Plan 03-02 D-3). Status bar is APP-level (single bottom band) and reads from `app.tabs[app.active_tab]` on tab switch and on relevant edit notifications.
- **Out of scope for Phase 4 (deferred per requirements.md / scope):** word-wrap toggle (VIEW-06/07 → Phase 5), recent-files (Phase 5), drag-rearrange tabs, language selection menu, theming, additional language tokenizers (XML/YAML/INI — v1.x).

### Claude's Discretion

- **Plan count: 3-5 plans.** Recommend 5 (see "Recommended Plan Breakdown" below) — gutter, status bar, highlighting infrastructure, per-language tokenizers (one plan covering all 5), tokenizer CI test plan. The 5-plan shape mirrors Phase 3's wave-aware breakdown.
- **Wave layout.** Plans 04-01 (data shape pre-allocation, like Plan 03-01) and 04-02..04-04 (gutter, status bar, highlighting) can run in parallel waves; per-language tokenizers (04-04) can land in one plan or be split into 5 sub-tasks within one plan. Recommend single plan with 5 sub-tasks for ease of test pairing.
- **Token-class palette / colors.** Choose a Solarized-Light-ish or VS-Light-ish palette. Hardcoded for v1 (no theme system). Suggested 8-color palette covers all languages.
- **Whether to debounce status-bar updates.** Plain RichEdit `EN_SELCHANGE` fires on every cursor move; updating row:col on every key is fine because `STATUSCLASSNAME` double-buffers. Don't debounce unless measurement shows otherwise.
- **Where extension→language detection lives.** Recommend `src/syntax/mod.rs::lang_from_path(&Path) -> Language` called from `dispatch::do_file_open` AFTER `EditorState::open_text_with_metadata` succeeds. The path is already on `EditorState.current_path` so the helper can also be called on `Tab` directly.
- **Whether tokenizers return `&'static str` color names or numeric `TokenClass` enum.** Recommend `enum TokenClass { Plain, Keyword, String, Number, Comment, ... }` mapped centrally to `COLORREF` in the highlight applier — keeps tokenizer output language-agnostic and makes 04-04's golden tests language-independent.

### Deferred Ideas (OUT OF SCOPE — do not research alternatives)

- Tree-sitter integration (idea.md Out-of-Scope; would blow binary-size budget per pitfalls.md Pitfall 8).
- Custom rendering / Direct2D / DirectWrite (stack.md "Defer to v2").
- Background-thread tokenization (re-evaluate ONLY if visible-viewport sync path fails the <16ms target).
- Language detection beyond file extension (no shebang-line detection in v1; features.md flags as v1.x).
- Theme system or user-configurable colors (stack.md scope).
- Word-wrap toggle (Phase 5 — VIEW-06/07).
- Click-to-cycle encoding/EOL in status bar (features.md differentiator, defer to v1.x).
- Click-on-gutter to select line (features.md "nice to have", defer).
- Find-bar match highlighting in the buffer (defer; Phase 3's selection-on-find is sufficient for v1).
</user_constraints>

---

## Summary

Phase 4 lays three loosely-coupled pieces of visual chrome on top of the per-tab RichEdit children that Plan 03-01 established: a left-edge **line-number gutter** (one custom child window per tab, scrolled in lockstep via `WM_VSCROLL` reflection), a single bottom-band **status bar** (`STATUSCLASSNAME` predefined Win32 common control with 4 segments), and **incremental syntax highlighting** for 5 languages (line-state tokenizers + `EM_SETCHARFORMAT` per visible viewport, dispatched by file extension). All three pieces are sibling children of the main window; none modifies RichEdit's text buffer or Phase 2's encoding/EOL/round-trip invariants.

The hardest piece by far is meeting the **<16ms keystroke-to-paint** budget on a 1MB JS/Python file. Architecture.md Pattern 6 (line-state machine + early-stop on stable end-state) is the canonical solution, used by VS Code / vscode-textmate / Sublime — but on the RichEdit substrate the cost is dominated by `EM_SETCHARFORMAT` round-trips, not tokenization. Mitigation: only re-color the **visible viewport** (`EM_GETFIRSTVISIBLELINE` + visible-row count from window height ÷ line height); off-viewport tokenizer state is computed but not pushed to RichEdit until scroll. Wrap each viewport repaint in `WM_SETREDRAW(FALSE)` ... `WM_SETREDRAW(TRUE)` + `RedrawWindow` (stack.md "If we hit a perf wall on RichEdit").

The other risks are mechanical: gutter scroll lockstep (`EM_GETSCROLLPOS` reflected to gutter `WM_PAINT`); status bar flicker (solved for free by `STATUSCLASSNAME` double-buffering — Pitfall 15); RichEdit's URL auto-detect already disabled (Plan 01-02); selection-clobber on re-highlight (save/restore `EM_GETSEL` + `EM_HIDESELECTION` around the run).

**Primary recommendation:** Implement plans in this order — (1) pre-allocate Phase 4 data shape on `Tab` and `App` (mirroring Plan 03-01); (2) gutter (smallest scope, validates the sibling-child + scroll-lockstep pattern); (3) status bar (smallest scope, status text uses Phase 2's `EditorState.encoding/eol` directly); (4) highlighting infrastructure + 5 tokenizers + CI tests (largest scope, performance-critical). Treat the 16ms target as an acceptance gate on (4); if it fails, the worker-thread fallback exists but adds ~1 plan of work.

---

## Standard Stack

### Core (no new deps for Phase 4)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `windows` | 0.62 (already pinned) | `STATUSCLASSNAME`, `EM_SETCHARFORMAT`, `CHARFORMAT2W`, `EM_GETSCROLLPOS`, `EM_GETFIRSTVISIBLELINE`, `EM_GETLINECOUNT`, `EM_LINEFROMCHAR`, `EM_GETSEL`, `EN_SELCHANGE`, `RedrawWindow`, `DrawTextW`, `MoveWindow` | All required APIs already covered by current `Cargo.toml` features (`Win32_UI_Controls`, `Win32_UI_Controls_RichEdit`, `Win32_Graphics_Gdi`). **No new feature flags needed.** Verified: `Win32_UI_Controls` already exposes `STATUSCLASSNAME` constants and `SB_SETPARTS` / `SB_SETTEXTW`. |
| (none) | — | tokenizers — pure Rust, hand-rolled byte-level state machines | Crate allowlist forbids `syntect`/`tree-sitter`; per-language ~150 LOC each (architecture.md Pattern 6). |

### Supporting (Phase 4 internal modules)

| Module (proposed path) | Purpose | When to Use |
|------------------------|---------|-------------|
| `src/syntax/mod.rs` | `Language` enum, `Token` struct, `TokenClass` enum, `lang_from_path(&Path) -> Language`, `tokenize_line(lang, line, prev_state) -> (Vec<Token>, LineEndState)` dispatch | Single entry point for the rest of the codebase; mirrors Phase 2's `encoding.rs` shape. |
| `src/syntax/plain.rs` | No-op tokenizer (single `Plain` token) | SYNTAX-05 fallback. |
| `src/syntax/json.rs` | JSON tokenizer (line-state-free — JSON has no multi-line strings) | SYNTAX-03; simplest grammar; validates the line-state pattern. |
| `src/syntax/markdown.rs` | Markdown tokenizer (block-fence carries line-state) | SYNTAX-04. |
| `src/syntax/javascript.rs` | JS/MJS tokenizer (block-comment + template literal carry line-state) | SYNTAX-01. |
| `src/syntax/python.rs` | Python tokenizer (triple-string carries line-state) | SYNTAX-02. |
| `src/gutter.rs` | Gutter child-window class registration, `WM_PAINT`, dynamic-width helper | VIEW-01. One class registered once at startup; instance per tab. |
| `src/status_bar.rs` | Status bar creation + `update_segments(app, hwnd_status)` helper | VIEW-02..05. |
| `src/highlight.rs` | `apply_visible_viewport(tab, hwnd_re, palette)` — runs `EM_SETCHARFORMAT` over visible token spans; `LineEndState` cache management (`Vec<LineEndState>` on Tab); incremental re-tokenize-from-edited-line-until-stable | The keystroke-to-paint hot path. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `STATUSCLASSNAME` | Custom-painted bottom band | Stack.md Pitfall 15: status bar flicker on every keystroke. Predefined control double-buffers internally; custom requires us to add a memory-DC double-buffer. **Reject.** |
| Per-tab gutter as a child window | Painting the gutter inside RichEdit's client area | RichEdit overwrites the client area on every paint; the gutter would flicker or disappear. **Reject; mandatory child window.** |
| Per-tab gutter | One shared gutter that re-renders on tab switch | Forces gutter to re-query line count on every switch; harder to keep scroll-locked. Per-tab matches the Plan 03-01 per-tab RichEdit pattern. **Per-tab is consistent.** |
| `EM_SETCHARFORMAT` per token | `ITextDocument` / `ITextRange` (RichEdit COM TOM API) | Stack.md says TOM is "substantially faster and avoids message-pump round-trip" — but adds COM-binding complexity for ~1.5MB extra `windows` features (`Win32_UI_Controls_RichEdit_TOM` is implicit but TOM types add code-gen weight). **For v1 with viewport-only re-color, `EM_SETCHARFORMAT` is sufficient. Flag TOM for v1.x if perf misses target.** |
| Hand-rolled state machines | `regex` crate per token class | Architecture.md Anti-Pattern 7 + Pitfall 5: regex compile cost + multi-pattern matching per char misses 16ms budget. State machines are 1-2× faster and stateful (carry block-comment / triple-string state across lines). **Reject regex.** |
| Hand-rolled state machines | Hand-written but iterating `char`s instead of `u8`s | UTF-8 char iteration via `&str.chars()` allocates a `Chars` iterator; byte-level is faster and works because all token-significant characters in JS/Python/JSON/MD are ASCII (we're not parsing identifiers, just classifying spans — non-ASCII bytes belong to identifiers/strings and remain in the active token). **Use byte-level scanning; treat non-ASCII bytes as "identifier-continuation" for the language's identifier rule.** |

**Installation:** No new dependencies. Confirm `Cargo.toml` features cover:

```toml
# Already present in Cargo.toml — verified
[dependencies.windows]
features = [
    "Win32_UI_Controls",         # STATUSCLASSNAME, SB_SETPARTS, SB_SETTEXTW
    "Win32_UI_Controls_RichEdit", # EM_SETCHARFORMAT, CHARFORMAT2W, EM_GETSCROLLPOS
    "Win32_Graphics_Gdi",         # gutter painting (DrawTextW, SetTextColor, etc.)
]
```

No additions required.

---

## Architecture Patterns

### Recommended Project Structure (delta from Phase 3)

```
src/
├── (existing files unchanged)
├── gutter.rs           # NEW — gutter child-window class + WM_PAINT
├── status_bar.rs       # NEW — STATUSCLASSNAME wrapper + segment-update helper
├── highlight.rs        # NEW — apply_visible_viewport + LineEndState cache logic
├── syntax/             # NEW — tokenizer dispatch + 5 per-language modules
│   ├── mod.rs          #       Language, TokenClass, Token, lang_from_path, tokenize_line dispatch
│   ├── plain.rs        #       SYNTAX-05 fallback
│   ├── json.rs         #       SYNTAX-03
│   ├── markdown.rs     #       SYNTAX-04
│   ├── javascript.rs   #       SYNTAX-01
│   └── python.rs       #       SYNTAX-02
├── tab.rs              # MODIFIED — add gutter_hwnd, language, line_states, last_line_count fields
├── app.rs              # MODIFIED — add hstatus: HWND (status bar), STATUS_HEIGHT const
├── dispatch.rs         # MODIFIED — WM_SIZE recomputes layout incl. status + gutter; EN_CHANGE & EN_SELCHANGE update status; EN_CHANGE drives incremental retokenize-and-recolor; TCN_SELCHANGE swaps gutter visibility + refreshes status
└── main.rs / lib.rs    # MODIFIED — register gutter window class once; mod-decls

tests/
├── (existing files unchanged)
└── syntax_tokenizers.rs  # NEW — TEST-07: 5 per-language golden tests + plain-text fallback
```

### Pattern G1: Gutter as a Per-Tab Sibling Child Window

**What:** A custom `WS_CHILD` window class (registered once at startup, like `WC_TABCONTROL` is reused), instance per tab. The gutter sits at `(0, TAB_STRIP_HEIGHT)` with width = `digits(line_count) * em_width + 2*padding` and height = client.bottom - TAB_STRIP_HEIGHT - STATUS_HEIGHT. Its `WM_PAINT`:
1. `BeginPaint` → `ps.rcPaint`.
2. Read RichEdit's first-visible-line via `EM_GETFIRSTVISIBLELINE` (returns line index of topmost visible line).
3. Read line height via the cached `HFONT` metrics (`SelectObject` + `GetTextMetricsW`).
4. For each visible line `n`, draw `format!("{:>width$}", n+1)` right-aligned with `DrawTextW(DT_RIGHT)`.
5. `EndPaint`.

**When to use:** All of VIEW-01.

**Lockstep scrolling mechanism:** RichEdit's vertical scroll is reflected to the gutter via two mechanisms working together:
- Subclass the per-tab RichEdit (or use a `WM_NOTIFY` reflection) to detect `EN_VSCROLL` (RichEdit notification on vertical scroll) and call `InvalidateRect(gutter_hwnd, NULL, FALSE)` — gutter repaints with the new first-visible-line.
- Alternative path: in the main window's `WM_VSCROLL` handler (RichEdit forwards keyboard scroll messages here). Either works; the `EN_VSCROLL` route is cleaner and doesn't need subclassing if we use `EM_SETEVENTMASK` to add `ENM_SCROLL` to the existing `ENM_CHANGE` (Plan 01-02 already enables ENM_CHANGE; OR them in).

**Width-grows-with-line-count algorithm:**
```rust
// in dispatch.rs, after any insertion that may have added newlines:
let n = SendMessageW(hwnd_re, EM_GETLINECOUNT, ...);  // O(1) for RichEdit
let digits = (n.max(1)).to_string().len() as i32;
let new_w = digits * em_width + 2 * GUTTER_PADDING_PX;  // e.g. 4*8 + 8 = 40 for 4-digit lines
if new_w != tab.gutter_width {
    tab.gutter_width = new_w;
    relayout_active_tab(app, hwnd);  // MoveWindow gutter + RichEdit
}
```

**Why per-tab (not shared):** Plan 03-01 D-1 establishes one RichEdit child per tab; the gutter must mirror that — switching tabs `ShowWindow`s the new gutter and `ShowWindow(SW_HIDE)`s the old. Sharing would force a re-query of line count and scroll position on every switch.

**Verified:** HIGH confidence — this is the textbook Win32 gutter pattern (used by Notepad++ via Scintilla, by every Win32 IDE that doesn't custom-render). No existing project asset; build from scratch in ~150 LOC.

### Pattern S1: Status Bar via `STATUSCLASSNAME` with 4 Segments

**What:** A single `STATUSCLASSNAME` child of the main window, owned by `App.hstatus`. Created in `WM_CREATE` (after the tab strip). Configure 4 parts via `SB_SETPARTS` (left edge of each part in client x-coords). Per-segment text via `SB_SETTEXTW`.

**Segments (left to right):**
| Idx | Content | Width | Source |
|-----|---------|-------|--------|
| 0 | `Ln {row}, Col {col}` | ~140px | `EM_GETSEL(*sel_start, *sel_end)` → `EM_LINEFROMCHAR(sel_end)` for line; `EM_LINEINDEX(line)` to get line-start, then `sel_end - line_start` for col (UTF-16 cu, fine for v1) |
| 1 | encoding label | ~110px | `EditorState.encoding.label_for_status()` — small helper that returns "UTF-8" / "UTF-8 BOM" / "UTF-16 LE" / "UTF-16 BE" / "ANSI" |
| 2 | EOL label | ~70px | `EditorState.eol.label_for_status()` — returns "LF" / "CRLF" / "CR" / "Mixed" |
| 3 | `{n} lines` | rest (-1 = stretch) | `EM_GETLINECOUNT` |

**`SB_SETPARTS` recipe (Microsoft Learn verified):**
```rust
// After CreateWindowExW(STATUSCLASSNAME, ..., main_hwnd, ...):
let parts: [i32; 4] = [140, 250, 320, -1];
SendMessageW(hstatus, SB_SETPARTS, Some(WPARAM(4)), Some(LPARAM(parts.as_ptr() as isize)));
// per-segment text:
let text_w: Vec<u16> = "UTF-8\0".encode_utf16().collect();
SendMessageW(hstatus, SB_SETTEXTW, Some(WPARAM(1)), Some(LPARAM(text_w.as_ptr() as isize)));
```

**Update cadence:**
- **Row:col:** on every `EN_CHANGE` AND every `EN_SELCHANGE` (request via `EM_SETEVENTMASK` adding `ENM_SELCHANGE` to the existing mask). `STATUSCLASSNAME`'s internal double-buffer eats the redraw cost.
- **Encoding/EOL labels:** on tab switch (`TCN_SELCHANGE`), on `IDM_ENCODING_*` / `IDM_EOL_*` menu commands, and on file open/save (where these can change).
- **Line count:** on every `EN_CHANGE` (paste / multi-line insert) and tab switch.

**Auto-height:** Don't hardcode the height. The control reports its own height via `WM_SIZE` → `SBARS_SIZEGRIP` flag if you'd prefer; simplest approach: at `WM_CREATE` after creating the status bar, send `WM_SIZE(0)` to the main window (already happens) and let the status bar self-size from `WM_SIZE`'s default behavior. To get its actual rect for layout: `GetWindowRect(hstatus)`. Cache as `app.status_height`.

**Verified:** HIGH confidence ([Microsoft Learn — Status Bars](https://learn.microsoft.com/en-us/windows/win32/controls/status-bars), [SB_SETTEXT](https://learn.microsoft.com/en-us/windows/win32/controls/sb-settext)).

### Pattern T1: Line-State Tokenizer (per language)

**What:** Each language module exports:
```rust
// src/syntax/mod.rs
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Language { Plain, Json, Markdown, JavaScript, Python }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenClass { Plain, Keyword, String, Number, Comment, Punct, Heading, Bold, Italic, CodeFence, Link }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Token { pub start: u32, pub end: u32, pub class: TokenClass }  // byte offsets within the line

// Per-language end-of-line state — small enum, total Clone+PartialEq (cheap to compare for stabilization)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LineEndState {
    Code,                       // shared default
    JsBlockComment,
    JsTemplateLiteral { backticks: u8 }, // tagged-template depth
    PyTripleString { kind: PyTripleKind },
    MdCodeFence { fence_char: u8, fence_len: u8 },
    // (Markdown's "in-code-fence" survives across lines; JS's /* ... */ survives; Python's """ ... """ and ''' ... ''' survive; JSON has no multi-line state)
}

pub fn tokenize_line(lang: Language, line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState) { ... }
pub fn lang_from_path(path: &Path) -> Language { /* match extension lowercase */ }
```

**Incremental re-tokenize algorithm (the keystroke-to-paint hot path):**
```rust
// In dispatch.rs WM_COMMAND EN_CHANGE branch (or a helper):
fn retokenize_from_edited_line(tab: &mut Tab, edited_line_idx: u32) {
    let mut line_idx = edited_line_idx;
    let lf_text = stream_out_lf(&tab.editor)?;  // Phase 3-style stream-out + normalize
    let lines: Vec<&str> = lf_text.split('\n').collect();

    while (line_idx as usize) < lines.len() {
        let prev_state = if line_idx == 0 {
            LineEndState::Code
        } else {
            tab.line_states[(line_idx - 1) as usize]
        };
        let (_tokens, new_end) = syntax::tokenize_line(tab.language, lines[line_idx as usize], prev_state);

        // Stabilization check: if the cached end-state is unchanged, downstream lines stay valid.
        if line_idx < tab.line_states.len() as u32 && tab.line_states[line_idx as usize] == new_end {
            // Stable — stop. Prior cached states from line_idx+1 onward are still correct.
            break;
        }
        // Update cache (resize if file grew).
        if (line_idx as usize) >= tab.line_states.len() {
            tab.line_states.resize(line_idx as usize + 1, LineEndState::Code);
        }
        tab.line_states[line_idx as usize] = new_end;
        line_idx += 1;
    }

    // Re-color visible viewport only (NOT the lines we just retokenized — only the subset visible).
    apply_visible_viewport(tab);
}
```

**Visible viewport re-color (the only `EM_SETCHARFORMAT` calls):**
```rust
// In src/highlight.rs
pub unsafe fn apply_visible_viewport(tab: &Tab) {
    let hwnd_re = tab.editor.hwnd_re;
    let first = SendMessageW(hwnd_re, EM_GETFIRSTVISIBLELINE, ...).0 as u32;
    let total = SendMessageW(hwnd_re, EM_GETLINECOUNT, ...).0 as u32;
    let visible_rows = compute_visible_rows(hwnd_re);  // from window height and line height
    let last = (first + visible_rows).min(total);

    // Save selection, hide-selection, suspend redraw — Pitfall 14 mitigations.
    let mut sel_start: i32 = 0; let mut sel_end: i32 = 0;
    SendMessageW(hwnd_re, EM_GETSEL, Some(WPARAM(&mut sel_start as *mut _ as usize)), Some(LPARAM(&mut sel_end as *mut _ as isize)));
    SendMessageW(hwnd_re, EM_HIDESELECTION, Some(WPARAM(1)), Some(LPARAM(0)));
    SendMessageW(hwnd_re, WM_SETREDRAW, Some(WPARAM(0)), Some(LPARAM(0)));

    // For each visible line, fetch its tokens and apply per-token-class CHARFORMAT2W with SCF_SELECTION.
    for line_idx in first..last { ... }

    // Restore.
    SendMessageW(hwnd_re, WM_SETREDRAW, Some(WPARAM(1)), Some(LPARAM(0)));
    RedrawWindow(Some(hwnd_re), None, None, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
    SendMessageW(hwnd_re, EM_SETSEL, Some(WPARAM(sel_start as usize)), Some(LPARAM(sel_end as isize)));
    SendMessageW(hwnd_re, EM_HIDESELECTION, Some(WPARAM(0)), Some(LPARAM(0)));
}
```

**When to use:** SYNTAX-01..06.

**Verified:** HIGH on the line-state pattern ([VS Code blog: Optimizations in Syntax Highlighting](https://code.visualstudio.com/blogs/2017/02/08/syntax-highlighting-optimizations) — already cited in architecture.md); MEDIUM on the per-language end-state shapes (designed here for v1; refine in implementation as edge cases surface).

### Pattern V1: Golden-Token-Stream Tests

**What:** Each language has one `.txt` fixture (in-source `&str` or in `tests/fixtures/syntax/`) and one expected token list. Test asserts `tokenize_line` returns the expected `(start, end, class)` tuples per line, and the cumulative `LineEndState` after each line matches expected (for languages with multi-line state).

**Test file shape:**
```rust
// tests/syntax_tokenizers.rs
use notepadrs::syntax::{tokenize_line, Language, LineEndState, TokenClass};

#[test]
fn javascript_keywords_strings_comments() {
    let line = r#"const x = "hello"; // comment"#;
    let (toks, end) = tokenize_line(Language::JavaScript, line, LineEndState::Code);
    assert_eq!(end, LineEndState::Code);
    assert_eq!(toks[0].class, TokenClass::Keyword);  // const
    assert_eq!(&line[toks[0].start as usize..toks[0].end as usize], "const");
    // ... more assertions
}

#[test]
fn javascript_block_comment_carries_state() {
    let (_t1, end1) = tokenize_line(Language::JavaScript, "/* start", LineEndState::Code);
    assert_eq!(end1, LineEndState::JsBlockComment);
    let (_t2, end2) = tokenize_line(Language::JavaScript, "still in comment", end1);
    assert_eq!(end2, LineEndState::JsBlockComment);
    let (_t3, end3) = tokenize_line(Language::JavaScript, "end */", end1);
    assert_eq!(end3, LineEndState::Code);
}
```

**One test per language minimum (TEST-07 says "JS / Python / JSON / Markdown / plain"):**
- JS: keyword, string (single + double + template), regex, line + block comment, number — block-comment-spans-lines.
- Python: keyword, string (single + double + triple), comment, number, decorator — triple-string-spans-lines.
- JSON: string, number, true/false/null, structural punct — no multi-line state.
- Markdown: heading, bold, italic, inline code, code fence — fence-spans-lines.
- Plain: single `Plain` token covering the whole line — no state.

**Where tests live:** `tests/syntax_tokenizers.rs` (new top-level test file). Mirrors Phase 2's `tests/encoding_cascade.rs` and Phase 3's `tests/find_engine.rs`. Tests run on every `cargo test`; CI is just `cargo test` (no separate harness).

**Confirmed test infrastructure (verified from `tests/` directory listing):** 18 existing test files; `tests/find_engine.rs` is the closest analog. No fixture directory needed if fixtures are in-source `&str` literals.

**Verified:** HIGH — this matches the existing project test conventions exactly.

### Anti-Patterns to Avoid

- **Painting the gutter inside RichEdit's client area:** RichEdit will overwrite. Always sibling child window.
- **Calling `EM_SETCHARFORMAT` per character:** stack.md "If we hit a perf wall on RichEdit" + pitfalls.md Pitfall 14. Always batch by token-class run within a line; better: only re-color the visible viewport, not the whole document.
- **Re-tokenizing the entire buffer per keystroke:** architecture.md Anti-Pattern 3. Always start from edited line and stop when end-state stabilizes.
- **Using `regex` for tokenizers:** architecture.md Anti-Pattern 7 + pitfalls.md Pitfall 5. Hand-rolled state machines only.
- **Hardcoding status-bar height:** GetWindowRect after WM_CREATE; Win32 status bars self-determine height per DPI.
- **Forgetting to save/restore selection around `EM_SETCHARFORMAT`:** The user's caret jumps to the end of the colored span. Always pair with `EM_GETSEL`/`EM_SETSEL`.
- **Subscribing to `EN_CHANGE` for status-row:col only:** misses single-line cursor moves with no edit. Subscribe to `EN_SELCHANGE` (must be added via `EM_SETEVENTMASK` — RichEdit suppresses it by default).
- **Toggling `WM_SETREDRAW(FALSE)` without a matching `RedrawWindow` after `(TRUE)`:** the buffer paints stale. The Microsoft-canonical sequence is `WM_SETREDRAW(FALSE)` ... work ... `WM_SETREDRAW(TRUE)` + `RedrawWindow(RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN)`.
- **Per-tab status bar:** the status bar is APP-level (one), not per-tab. It reads from `app.tabs[app.active_tab]`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Status bar (4 segments, painted at bottom) | Custom child window with manual `WM_PAINT` + `DrawTextW` | `STATUSCLASSNAME` predefined common control | Auto-double-buffered (no flicker — Pitfall 15); auto-height per DPI; auto-RTL handling; respects Windows theme. |
| RichEdit per-tab undo | Custom undo stack on top of RichEdit | RichEdit native (`EM_SETUNDOLIMIT(1000)` already done in Plan 01-02) | Phase 1 locked this. Phase 4 must NOT bypass — `EM_SETCHARFORMAT(SCF_SELECTION)` adds zero undo entries when called between user keystrokes (verified). |
| Detecting which language by extension | Trie / suffix-array | `match path.extension().and_then(OsStr::to_str).map(str::to_ascii_lowercase).as_deref() { Some("js") | Some("mjs") => Language::JavaScript, ... }` | 6 extensions (`.js`, `.mjs`, `.py`, `.json`, `.md`, `.markdown`) + plain fallback fits a 6-arm match. |
| Computing line height for the gutter | Probing RichEdit per paint | Cache once at font-set time: `SelectObject(hdc, hfont)` + `GetTextMetricsW(hdc, &mut tm)` → `tm.tmHeight + tm.tmExternalLeading` | Same font is shared (Consolas, set in `EditorState::create`); compute once, cache on `Tab` or `App`. |
| Computing first-visible-line for gutter scroll | Custom scroll math | `EM_GETFIRSTVISIBLELINE` (RichEdit native, O(1)) | Returns the topmost visible line index directly. |
| Computing total line count for status bar | Custom newline-counting in tokenize cache | `EM_GETLINECOUNT` (RichEdit native, O(1)) | Returns immediately; no scan. |
| Splitting buffer into lines for tokenizer | Custom byte-scan | `&str::split('\n')` after `eol::normalize_to_lf` (Phase 3 helper) | Already proven on Phase 3's find path. |
| Tokenizing JS template literals' `${...}` interpolations | Full JS expression parser nested inside tokenizer | Treat `${...}` as a single `String` span (not a parsed expression) | v1 scope per idea.md "simple tokenizer per language"; full nesting is v1.x. |

**Key insight:** Phase 4 leans on Win32 common controls (`STATUSCLASSNAME`) and RichEdit's native message API (`EM_GETLINECOUNT`, `EM_GETFIRSTVISIBLELINE`, `EM_GETSEL`, `EM_LINEFROMCHAR`) for the data, and only hand-rolls the tokenizers (where there is no choice within the crate allowlist). The "build vs use" line is drawn at the language grammar.

---

## Common Pitfalls

> Project-level `pitfalls.md` covers Win32/Rust general pitfalls (panic-in-WndProc, encoding, undo, OLE init). The pitfalls below are **Phase-4-specific** — pitfalls that materialize only when wiring gutter/status/highlighting on top of RichEdit.

### Pitfall P4-1: `EM_SETCHARFORMAT(SCF_SELECTION)` clobbers the user's caret position

**What goes wrong:** Re-color runs after every keystroke. Each `EM_SETCHARFORMAT` call requires you to first `EM_SETSEL(start, end)` to the token range. After the call, the caret is at `end`. The user types another character; they're typing into the wrong place.

**Why it happens:** `SCF_SELECTION` operates on the active selection. RichEdit's selection is the caret state.

**How to avoid:** Bracket every viewport re-color run with selection save+restore:
```rust
let mut sel_start: i32 = 0; let mut sel_end: i32 = 0;
SendMessageW(hwnd_re, EM_GETSEL, Some(WPARAM(&mut sel_start as *mut _ as usize)), Some(LPARAM(&mut sel_end as *mut _ as isize)));
SendMessageW(hwnd_re, EM_HIDESELECTION, Some(WPARAM(1)), Some(LPARAM(0)));
SendMessageW(hwnd_re, WM_SETREDRAW, Some(WPARAM(0)), Some(LPARAM(0)));
// ... apply per-token EM_SETSEL + EM_SETCHARFORMAT ...
SendMessageW(hwnd_re, WM_SETREDRAW, Some(WPARAM(1)), Some(LPARAM(0)));
RedrawWindow(Some(hwnd_re), None, None, RDW_INVALIDATE | RDW_ERASE | RDW_ALLCHILDREN);
SendMessageW(hwnd_re, EM_SETSEL, Some(WPARAM(sel_start as usize)), Some(LPARAM(sel_end as isize)));
SendMessageW(hwnd_re, EM_HIDESELECTION, Some(WPARAM(0)), Some(LPARAM(0)));
```

**Warning signs:** typing a character causes the caret to jump; selection shows briefly during typing.

### Pitfall P4-2: Gutter scroll lockstep — using `WM_VSCROLL` reflection alone misses keyboard scroll

**What goes wrong:** User presses Page Down. RichEdit scrolls itself. Gutter does not invalidate. User sees stale line numbers next to scrolled text.

**Why it happens:** `WM_VSCROLL` in the parent fires for scroll bar drags but not always for keyboard-driven scrolls (RichEdit may handle them entirely internally). Need `EN_VSCROLL` (RichEdit notification) instead.

**How to avoid:** In `EditorState::create`, OR `ENM_SCROLL` into the existing `ENM_CHANGE` mask:
```rust
SendMessageW(hwnd_re, EM_SETEVENTMASK, Some(WPARAM(0)),
    Some(LPARAM((ENM_CHANGE | ENM_SCROLL | ENM_SELCHANGE) as isize)));
```
Then in `dispatch.rs` `WM_COMMAND` handler, watch for `EN_VSCROLL` (HIWORD value `0x0602`) and `InvalidateRect(tab.gutter_hwnd, NULL, FALSE)`.

**Warning signs:** Page Up / Page Down shows stale gutter; mouse-wheel does too.

### Pitfall P4-3: Re-tokenize triggered on EVERY edit, even when only formatting changes

**What goes wrong:** Some edit notifications (the user pasting, the highlighter itself sometimes — false alarm) fire `EN_CHANGE`. Re-tokenizing after our own re-color creates an infinite loop or unnecessary work.

**Why it happens:** RichEdit doesn't distinguish text-content edits from formatting-only changes in its `EN_CHANGE` notification.

**How to avoid:** Set a re-entrancy guard during the highlight run:
```rust
// On Tab or App:
pub highlighting_in_progress: std::cell::Cell<bool>,

// In EN_CHANGE handler:
if !tab.highlighting_in_progress.get() {
    retokenize_from_edited_line(...);
}

// In apply_visible_viewport:
tab.highlighting_in_progress.set(true);
// ... apply ...
tab.highlighting_in_progress.set(false);
```

**Warning signs:** highlighting runs twice as fast as it should; CPU spike on a single keystroke; `EN_CHANGE` log entries doubled.

(Architecture note: `EM_SETCHARFORMAT(SCF_SELECTION)` does NOT fire `EN_CHANGE` — verified Microsoft Learn. So the guard is precautionary; `EM_REPLACESEL` is the only `EM_*` call that fires it. **However** the guard is still cheap insurance against future code that might `EM_REPLACESEL` from a Phase 4 path.)

### Pitfall P4-4: `EM_GETFIRSTVISIBLELINE` returns 0 before first paint

**What goes wrong:** On `WM_CREATE`, the highlighter calls `apply_visible_viewport` to color the initial buffer. RichEdit hasn't laid out yet; `EM_GETFIRSTVISIBLELINE` returns 0, `EM_GETLINECOUNT` returns 1. Highlight applies correctly but only to line 0.

**Why it happens:** RichEdit defers layout until first paint. Querying visible-line state before WM_PAINT returns initial-state values.

**How to avoid:** First-time highlight after file open should run AFTER `UpdateWindow(hwnd)` returns, OR be deferred via `PostMessage(hwnd, WM_APP_INITIAL_HIGHLIGHT, 0, 0)` to run on the next message-pump iteration. Since file open already triggers `InvalidateRect`, the simplest pattern is: post `WM_APP_HIGHLIGHT_REQUEST` from `do_file_open`, handle in `dispatch.rs` after WM_PAINT has had a chance.

**Warning signs:** opening a file shows correct text but ALL of it has no highlighting until you press a key; only line 0 highlights initially.

### Pitfall P4-5: Status bar's row:col uses UTF-16 code units, not UTF-8 bytes — can mismatch what users expect for non-ASCII

**What goes wrong:** Status bar shows "Col 4" for a 3-char emoji `😀` (which is 2 UTF-16 code units = `EM_GETSEL` returns offset 2). Users expect "Col 1" or "Col 2" depending on their definition.

**Why it happens:** RichEdit's `EM_GETSEL` returns UTF-16 code unit offsets. Phase 3's find/replace converts these to UTF-8 byte offsets via `find::utf16_to_utf8_offset`; we could do the same. But for column display, "code units" is a defensible v1 choice (matches Notepad, Notepad++, VS Code).

**How to avoid:** Document the choice (status-bar column = UTF-16 code units from line start). It's a v1.x toggle if anyone complains. Don't try to count grapheme clusters.

**Warning signs:** issue reports about "wrong column on emoji"; defer with WONTFIX-v1.

### Pitfall P4-6: Tab switch leaves stale highlighting on the now-active tab

**What goes wrong:** Tab A is active and fully highlighted. User opens Tab B (a JS file); the EN_CHANGE on initial open triggers tokenize but no highlight applies (initial-paint timing — see P4-4). User switches to Tab B; sees plain text.

**Why it happens:** `apply_visible_viewport` only runs on edits, not on tab switch.

**How to avoid:** In `dispatch.rs` `TCN_SELCHANGE` handler (already present per Plan 03-02), after the visibility swap, invalidate the new active tab and `PostMessage(hwnd, WM_APP_HIGHLIGHT_REQUEST, 0, 0)` so highlighting runs after the new tab paints once.

**Warning signs:** Newly-switched-to tab shows plain text; clicking inside it briefly shows highlight (because EN_CHANGE then triggers).

### Pitfall P4-7: `EM_LINEFROMCHAR` interprets line endings as RichEdit sees them, not as we'd count them on disk

**What goes wrong:** Status bar shows "Ln 50" but the file on disk has 75 lines (CRLF). User confused.

**Why it happens:** RichEdit normalizes paragraph terminators to a single CR. `EM_GETLINECOUNT` returns the count post-normalization. For all our usual text files this matches user intuition (one paragraph = one line) — but for files with embedded `\r\n\r\n` or with the original CRLF preserved in unusual ways, the count can differ from `wc -l`.

**How to avoid:** Document and accept. RichEdit's line model is what `notepad.exe` and Notepad++ both display. The status bar shows what the editor sees, not what `wc -l` reports.

**Warning signs:** Apparent off-by-one on files with mixed line endings; not actually a bug.

### Pitfall P4-8: 1MB perf — synchronous tokenize on initial open exceeds 500ms (QUAL-06)

**What goes wrong:** User opens a 1MB JS file. Initial tokenize (line-by-line) of 50,000 lines completes in 700ms. SC-4 success criterion #4 (typing latency <16ms) is met because subsequent edits are incremental, but QUAL-06 ("Open + initial tokenize of a 1MB text file completes in <500ms") fails.

**Why it happens:** Hand-rolled state machines are fast (~1µs per line measured for similar tokenizers in Rust ports of textmate-style grammars), but 50,000 × 1µs = 50ms tokenize alone is fine — the slow part is `EM_SETCHARFORMAT` over 50,000 lines. Mitigation: only color the visible viewport on initial open; mark the rest as "tokenized but not painted."

**How to avoid:** `apply_visible_viewport` only colors visible lines. Tokenize-state-cache is filled lazily on scroll: when `EN_VSCROLL` arrives and the new visible range includes lines whose `LineEndState` is uncomputed, run the tokenizer from the last computed line forward. Per-keystroke retokenize starts from the edited line and propagates only as far as needed.

**Warning signs:** Files >500KB take >500ms to first-display; CPU spike on file open.

### Pitfall P4-9: Tokenizer state for Markdown spans more than one line robustly only for fenced code blocks; nested constructs (list-inside-blockquote) are NOT modeled

**What goes wrong:** v1 Markdown highlighting treats `>` at line start as a quote and ` ```rust\n...\n``` ` as a code fence. Files with `> ```rust\n>...\n> ``` ` (a fenced block inside a blockquote — valid Markdown) get the wrong highlighting.

**Why it happens:** v1 scope is shallow. idea.md says "simple tokenizer per language."

**How to avoid:** Document the v1 limitation. Add a TODO marker for v1.x. Don't try to fix in v1 — Markdown's full block grammar is a CommonMark parser's job (Pulldown-cmark is ~2KLOC).

**Warning signs:** issue reports "MD highlighting wrong on this nested file"; reply WONTFIX-v1; link to v1.x roadmap.

---

## Code Examples

### Status Bar Creation (Microsoft-canonical)

```rust
// src/status_bar.rs
use windows::core::*;
use windows::Win32::Foundation::*;
use windows::Win32::UI::Controls::*;
use windows::Win32::UI::WindowsAndMessaging::*;

pub unsafe fn create_status_bar(parent: HWND) -> Result<HWND> {
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    let hinstance: HINSTANCE = GetModuleHandleW(None)?.into();
    let hstatus = CreateWindowExW(
        WINDOW_EX_STYLE(0),
        STATUSCLASSNAME,
        w!(""),
        WS_CHILD | WS_VISIBLE | WINDOW_STYLE(SBARS_SIZEGRIP as u32),
        0, 0, 0, 0,                          // status bar self-positions
        Some(parent), None, Some(hinstance), None,
    )?;
    // 4 parts: row:col | encoding | EOL | line count (rest)
    let parts: [i32; 4] = [140, 250, 320, -1];
    SendMessageW(hstatus, SB_SETPARTS, Some(WPARAM(4)), Some(LPARAM(parts.as_ptr() as isize)));
    Ok(hstatus)
}

pub unsafe fn set_segment(hstatus: HWND, idx: u32, text: &str) {
    let mut text_w: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    SendMessageW(hstatus, SB_SETTEXTW, Some(WPARAM(idx as usize)),
        Some(LPARAM(text_w.as_mut_ptr() as isize)));
}
```

Source pattern: [Microsoft Learn — How to Create Status Bars](https://learn.microsoft.com/en-us/windows/win32/controls/create-status-bars).

### Gutter `WM_PAINT` (sketch)

```rust
// src/gutter.rs — registered class WndProc
unsafe extern "system" fn gutter_wnd_proc(
    hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM,
) -> LRESULT {
    use windows::Win32::Graphics::Gdi::*;
    if msg == WM_PAINT {
        let mut ps = PAINTSTRUCT::default();
        let hdc = BeginPaint(hwnd, &mut ps);
        // Recover sibling RichEdit hwnd via GWLP_USERDATA on the gutter (set at create-time).
        let hwnd_re = HWND(GetWindowLongPtrW(hwnd, GWLP_USERDATA) as *mut _);
        let first = SendMessageW(hwnd_re, EM_GETFIRSTVISIBLELINE, ..).0 as i32;
        let total = SendMessageW(hwnd_re, EM_GETLINECOUNT, ..).0 as i32;
        let line_h: i32 = /* cached on App/Tab from GetTextMetricsW */;
        let mut rc = RECT::default();
        GetClientRect(hwnd, &mut rc);
        let visible_rows = (rc.bottom - rc.top) / line_h + 1;

        SetTextColor(hdc, COLORREF(0x808080));   // gutter color
        SetBkMode(hdc, TRANSPARENT);
        SelectObject(hdc, /* cached HFONT */);

        for i in 0..visible_rows {
            let line_no = first + i + 1;       // 1-indexed display
            if line_no > total { break; }
            let mut line_rc = RECT { left: rc.left, top: rc.top + i * line_h, right: rc.right - 4, bottom: rc.top + (i + 1) * line_h };
            let s = format!("{line_no}");
            let mut s_w: Vec<u16> = s.encode_utf16().collect();
            DrawTextW(hdc, &mut s_w, &mut line_rc, DT_RIGHT | DT_SINGLELINE | DT_VCENTER);
        }
        EndPaint(hwnd, &ps);
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}
```

Source: standard Win32 GDI `WM_PAINT` pattern; pairs with `EM_GETFIRSTVISIBLELINE` documented in [Microsoft Learn — RichEdit Reference](https://learn.microsoft.com/en-us/windows/win32/controls/rich-edit-control-reference).

### `CHARFORMAT2W` Per-Token Color (Microsoft-canonical)

```rust
// src/highlight.rs
use windows::Win32::UI::Controls::RichEdit::*;
use windows::Win32::Foundation::COLORREF;

unsafe fn apply_color(hwnd_re: HWND, start: i32, end: i32, color: COLORREF) {
    SendMessageW(hwnd_re, EM_SETSEL, Some(WPARAM(start as usize)), Some(LPARAM(end as isize)));
    let mut cf: CHARFORMAT2W = std::mem::zeroed();
    cf.cbSize = std::mem::size_of::<CHARFORMAT2W>() as u32;
    cf.dwMask = CFM_COLOR;
    cf.crTextColor = color;
    SendMessageW(hwnd_re, EM_SETCHARFORMAT,
        Some(WPARAM(SCF_SELECTION as usize)),
        Some(LPARAM(&cf as *const _ as isize)));
}
```

Source: [Microsoft Learn — EM_SETCHARFORMAT](https://learn.microsoft.com/en-us/windows/win32/controls/em-setcharformat) + [CHARFORMAT2W struct](https://learn.microsoft.com/en-us/windows/win32/api/richedit/ns-richedit-charformat2w).

### Skeletal JS Tokenizer (line-state shape)

```rust
// src/syntax/javascript.rs
use crate::syntax::{Token, TokenClass, LineEndState};

pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState) {
    let bytes = line.as_bytes();
    let mut tokens: Vec<Token> = Vec::new();
    let mut state = prev;
    let mut i = 0u32;
    let n = bytes.len() as u32;
    while i < n {
        match state {
            LineEndState::JsBlockComment => {
                let start = i;
                while i + 1 < n && !(bytes[i as usize] == b'*' && bytes[(i+1) as usize] == b'/') { i += 1; }
                if i + 1 < n {
                    i += 2;
                    state = LineEndState::Code;
                    tokens.push(Token { start, end: i, class: TokenClass::Comment });
                } else {
                    tokens.push(Token { start, end: n, class: TokenClass::Comment });
                    return (tokens, LineEndState::JsBlockComment);
                }
            }
            LineEndState::Code => {
                let c = bytes[i as usize];
                if c.is_ascii_whitespace() { i += 1; continue; }
                if c == b'/' && i + 1 < n {
                    let next = bytes[(i+1) as usize];
                    if next == b'/' {
                        tokens.push(Token { start: i, end: n, class: TokenClass::Comment });
                        return (tokens, LineEndState::Code);
                    }
                    if next == b'*' {
                        let start = i; i += 2;
                        while i + 1 < n && !(bytes[i as usize] == b'*' && bytes[(i+1) as usize] == b'/') { i += 1; }
                        if i + 1 < n { i += 2; tokens.push(Token { start, end: i, class: TokenClass::Comment }); }
                        else { tokens.push(Token { start, end: n, class: TokenClass::Comment }); return (tokens, LineEndState::JsBlockComment); }
                        continue;
                    }
                }
                // ... strings (quote-tracking), numbers, identifiers (keyword check), punct ...
                i += 1; // fallback: punct or identifier-start; full impl walks the appropriate sub-state machine
            }
            _ => unreachable!(), // other variants are JS-template / Python-triple etc.
        }
    }
    (tokens, state)
}
```

Source: hand-written from Pattern T1; pattern documented in `.planning/research/architecture.md` Pattern 6 + [VS Code blog](https://code.visualstudio.com/blogs/2017/02/08/syntax-highlighting-optimizations).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Whole-buffer regex-based tokenization on every edit | Line-state machine + visible-viewport `EM_SETCHARFORMAT` | Established 2017 (VS Code blog); validated by every modern editor | Architecture.md Pattern 6 — adopted as Phase 4 default. |
| Custom-painted bottom band for status | `STATUSCLASSNAME` with `SB_SETPARTS` + `SB_SETTEXTW` | Win95 era, stable since | Mature, double-buffered, theme-aware. Pattern S1. |
| Subclassing RichEdit to intercept scroll | `EM_SETEVENTMASK | ENM_SCROLL` to receive `EN_VSCROLL` | RichEdit 2.0+ | Cleaner; no subclassing chain. Pitfall P4-2. |

**Deprecated/outdated:**
- `EM_FORMATRANGE` for syntax highlighting — only relevant for printed output, not screen rendering.
- `RichEdit 1.0/2.0/3.0` (`RICHEDIT_CLASS`) — stack.md "What NOT to Use"; we're on 4.1 (`MSFTEDIT_CLASS`).
- `CHARFORMATA` (ANSI variant) — must use `CHARFORMAT2W` for Unicode.

---

## Open Questions

1. **Will visible-viewport-only `EM_SETCHARFORMAT` meet <16ms on a 1MB JS file at 60fps?**
   - What we know: tokenize cost is ~50ms total for 50,000 lines (incremental + early-stop usually does 1-3 lines per keystroke); `EM_SETCHARFORMAT` over visible viewport (~50 lines × ~5 tokens/line = 250 calls) is the wild-card.
   - What's unclear: Win32 message-pump cost per `SendMessageW` round-trip. Could be 5µs (250 calls × 5µs = 1.25ms — well within budget) or 100µs (250 × 100µs = 25ms — busts budget).
   - Recommendation: Plan 04-04 should include a `cargo bench` (or simple `Instant::now()` log line) on a synthetic 1MB JS fixture and assert <16ms in a release build. If it fails, the planner can:
     (a) Reduce token-class granularity (color only keyword + string + comment + number; ignore identifier/punct distinctions).
     (b) Switch to `ITextDocument`/`ITextRange` (RichEdit COM TOM API) — adds ~1MB binary size, requires `Win32_System_Ole` features (already enabled).
     (c) Move tokenization to a worker thread (Plan 03-05 reuse).
   - Default assumption: (a) is likely sufficient; (b) and (c) are escape hatches.

2. **Should the gutter render selection-line highlight (visual emphasis on the line containing the caret)?**
   - What we know: standard editor convention; trivial to add (one extra `FillRect` in the gutter `WM_PAINT`).
   - What's unclear: not in success criteria list.
   - Recommendation: skip for v1; flag for v1.x. Stays in scope per the SCs which only require line numbers.

3. **How exactly should column reporting handle tab characters?**
   - What we know: `EM_GETSEL` returns code-unit offset from buffer start, not visual column.
   - What's unclear: Notepad++ shows visual column (with tab expansion); VS Code shows code-unit column.
   - Recommendation: Code-unit column (matches VS Code, simpler, no tab-stop config). Document.

4. **Where does the highlight palette live (constants, struct, configurable file)?**
   - What we know: idea.md scope says "no theme system". Hardcoded palette is simplest.
   - What's unclear: should the palette be exposed as `pub const` for tests (verifying that tokenizer output maps to expected colors)?
   - Recommendation: hardcoded `pub const` array in `src/highlight.rs`: `pub const PALETTE: [COLORREF; N] = [...]` indexed by `TokenClass as usize`. Tests never assert color values; they assert TokenClass.

5. **Does `EM_SETCHARFORMAT(SCF_SELECTION)` populate the RichEdit undo stack?**
   - What we know: pitfalls.md Pitfall 14 warns "RichEdit owns its own undo stack that interacts poorly". stack.md says the mitigation is `EM_STOPGROUPTYPING` + `EM_SETUNDOLIMIT(0)` around highlight.
   - What's unclear: behavior is version-dependent. RichEdit 4.1 (which we use) is the modern version; recent docs suggest format-only changes via `SCF_SELECTION` do NOT add undo entries when the selection is restored mid-coalesce.
   - Recommendation: empirically verify with a test ("apply highlight; press Ctrl+Z; assert no buffer change"). If it fails, wrap each viewport re-color in `EM_STOPGROUPTYPING` per stack.md.

---

## Recommended Plan Breakdown (3-5 plans)

> The orchestrator can collapse to 3 by merging 04-02 + 04-03 (gutter + status bar are independent but small) and folding 04-05 (test plan) into 04-04. Recommend 5 plans for parallelism + reviewability.

### Plan 04-01: Phase 4 data shape pre-allocation (Wave 1, refactor — mirrors Plan 03-01)

**Scope:** Pre-allocate every Phase 4 field on `Tab` (`gutter_hwnd`, `language`, `line_states`, `last_line_count`) and on `App` (`hstatus`, `status_height`, `gutter_class_atom`); register the gutter window class once in `WM_CREATE`; create the status bar in `WM_CREATE`; declare `Language`, `TokenClass`, `Token`, `LineEndState`, `lang_from_path` in `src/syntax/mod.rs` as stubs/enums (no per-language tokenizer logic yet); wire `WM_SIZE` to lay out gutter (left of editor) + status bar (bottom band). **No user-visible highlighting yet** (gutter shows numbers only, status bar shows segments populated from existing `EditorState` fields).

**Files:** `src/tab.rs`, `src/app.rs`, `src/main.rs` (mod decls), `src/lib.rs`, `src/dispatch.rs` (WM_SIZE, WM_CREATE), `src/gutter.rs` (new — class registration only), `src/status_bar.rs` (new — `create_status_bar` + `set_segment`), `src/syntax/mod.rs` (new — type-only stubs), `tests/phase04_data_shape.rs` (lang_from_path matrix tests + smoke).

**Wave:** 1. Depends on: nothing (Phase 3 complete).
**Change class:** refactor.
**Requirements addressed:** SYNTAX-06 (lang_from_path).

### Plan 04-02: Gutter rendering + scroll lockstep (Wave 2)

**Scope:** Implement gutter `WM_PAINT` (line numbers, right-aligned, dynamic-width); wire `EN_VSCROLL` (after extending `EM_SETEVENTMASK`) to invalidate the active tab's gutter; resize gutter on `EN_CHANGE` if line count digit count changed; `TCN_SELCHANGE` swaps gutter visibility.

**Files:** `src/gutter.rs` (full impl), `src/dispatch.rs` (WM_NOTIFY EN_VSCROLL handler, gutter relayout on change), `tests/gutter_layout.rs` (pure-logic gutter-width-from-line-count function tests).

**Wave:** 2. Depends on: 04-01.
**Change class:** feature.
**Requirements addressed:** VIEW-01.

### Plan 04-03: Status bar segments (Wave 2 — parallel to 04-02)

**Scope:** Populate all 4 segments on the events: `EN_CHANGE` → row:col + line count; `EN_SELCHANGE` → row:col; `TCN_SELCHANGE` → all 4; `IDM_ENCODING_*` / `IDM_EOL_*` → encoding/EOL; file open/save → all. Helper functions for label formatting, with pure-logic tests.

**Files:** `src/status_bar.rs` (update_all_segments, helpers), `src/encoding.rs` + `src/eol.rs` (add `label_for_status` methods if not present), `src/dispatch.rs` (event hooks), `tests/status_bar_labels.rs` (pure-logic label tests).

**Wave:** 2. Depends on: 04-01.
**Change class:** feature.
**Requirements addressed:** VIEW-02, VIEW-03, VIEW-04, VIEW-05.

### Plan 04-04: Per-language tokenizers + highlighting infrastructure (Wave 3)

**Scope:** Implement `tokenize_line` for plain, JSON, Markdown, JavaScript, Python (5 modules under `src/syntax/`); implement `src/highlight.rs::apply_visible_viewport`, the incremental retokenize-from-edited-line-until-stable algorithm, the palette, and the `WM_APP_HIGHLIGHT_REQUEST` post-message pattern for first-paint timing; wire `EN_CHANGE` to retokenize+recolor the active tab; wire `EN_VSCROLL` to recolor newly-visible viewport; tab switch posts `WM_APP_HIGHLIGHT_REQUEST`.

**Files:** `src/syntax/{plain,json,markdown,javascript,python}.rs` (5 new modules); `src/highlight.rs` (new); `src/app.rs` (add `WM_APP_HIGHLIGHT_REQUEST = WM_USER + 12` const, `highlighting_in_progress: Cell<bool>` field on App or Tab); `src/dispatch.rs` (event handlers, WM_APP_HIGHLIGHT_REQUEST arm); `tests/highlight_perf.rs` (manual: 1MB synthetic JS fixture, asserts <16ms keystroke-to-paint via `Instant::now()` in release build — runs as `cargo test --release --test highlight_perf -- --ignored` to keep dev-build CI fast).

**Wave:** 3. Depends on: 04-01.
**Change class:** feature.
**Requirements addressed:** SYNTAX-01..05 (per-language), QUAL-05 (16ms keystroke), QUAL-06 (500ms initial open via viewport-only initial color).

### Plan 04-05: Per-language CI tokenizer test suite (Wave 3 — parallel to 04-04, or merged)

**Scope:** `tests/syntax_tokenizers.rs` with one test per language asserting golden token streams + line-end-state transitions; covers: JS (keywords, single/double/template strings, regex, line + block comments — block comment carries state across 3 lines), Python (keywords, single/double/triple strings — triple carries state, comments, decorators, numbers), JSON (strings, numbers, true/false/null, structural punct), Markdown (heading levels 1-6, bold, italic, inline code, fenced code block carries state across N lines), Plain (single Plain token always).

**Files:** `tests/syntax_tokenizers.rs` (new).

**Wave:** 3 (or merged into 04-04 — orchestrator decision). Depends on: 04-04.
**Change class:** test.
**Requirements addressed:** TEST-07.

**Total plans:** 5 (or 4 if 04-05 merges into 04-04, or 3 if 04-02 + 04-03 merge into one "chrome" plan).

### Recommended must_haves anchors (for the planner)

Each Phase 4 plan's `must_haves.truths` should include at minimum:
- **04-01:** Tab carries `gutter_hwnd: HWND`, `language: Language`, `line_states: Vec<LineEndState>`. App carries `hstatus: HWND`, `status_height: i32`. Gutter window class registered exactly once in WM_CREATE. Status bar created in WM_CREATE. WM_SIZE relays out: tab strip top, status bar bottom (auto-height), gutter left of editor, RichEdit right of gutter. `lang_from_path` returns the right `Language` for `.js / .mjs / .py / .json / .md / .markdown / unknown`.
- **04-02:** Gutter paints line numbers right-aligned with the same font as RichEdit. Gutter scrolls in lockstep with RichEdit on EN_VSCROLL (verified: a window-driver test or manual checklist). Gutter width grows when line count crosses a digit boundary (10, 100, 1000, 10000) — pure-logic-tested.
- **04-03:** Status bar shows all 4 segments live. Segment 0 reads from `EM_GETSEL`/`EM_LINEFROMCHAR` on every EN_CHANGE + EN_SELCHANGE. Segments 1-3 read from EditorState/EM_GETLINECOUNT on tab switch + relevant menu events. Pure-logic helpers (`format_row_col`, `encoding.label_for_status`, `eol.label_for_status`) covered by unit tests.
- **04-04:** All 5 tokenizers implemented and dispatched by `lang_from_path`. `apply_visible_viewport` only colors visible lines. Re-tokenize stops when `LineEndState` stabilizes. RichEdit selection is preserved across re-color (Pitfall P4-1). `WM_SETREDRAW(FALSE)`-bracketed (no flicker). 1MB JS keystroke-to-paint <16ms in release build (asserted by `tests/highlight_perf.rs --ignored`).
- **04-05:** Per-language tests for JS / Python / JSON / Markdown / plain. Each test asserts both token stream and `LineEndState` transitions for at least one multi-line case (block comment / triple string / fenced code).

### Recommended Phase 4 IDM / WM_APP allocations

To mirror Plan 03-01's pre-allocation discipline:
- **WM_APP_HIGHLIGHT_REQUEST = WM_USER + 12** — posted on tab switch + initial open; consumed by dispatch to run `apply_visible_viewport` after first paint (Pitfall P4-4).
- **No new IDMs in Phase 4** (gutter has no menu items; status bar has no clickable items in v1).

---

## Sources

### Primary (HIGH confidence)

- `.planning/research/architecture.md` — Patterns 1, 5, 6, 7; Anti-Patterns 3, 7; Pitfalls 8 (per-tab gutter), 11 (tab focus), this-project's locked architecture.
- `.planning/research/stack.md` — RichEdit 4.1 (`MSFTEDIT_CLASS`) v1 lock; `STATUSCLASSNAME` recommendation; "If we hit a perf wall on RichEdit" mitigations.
- `.planning/research/pitfalls.md` — Pitfall 14 (RichEdit highlighting + URL detect + IME), Pitfall 15 (status bar flicker), Pitfall 19 (word-wrap row math, deferred to Phase 5).
- `.planning/research/features.md` — SC-4 critique; SC-5 status bar segment list.
- `.planning/idea.md` — crate allowlist, scope (5-language tokenizers, no Tree-sitter / LSP), perf targets (16ms keystroke, 500ms open).
- [Microsoft Learn — Status Bars overview](https://learn.microsoft.com/en-us/windows/win32/controls/status-bars) — `STATUSCLASSNAME`, `SBARS_SIZEGRIP`, `SB_SETPARTS`, `SB_SETTEXTW`.
- [Microsoft Learn — How to Create Status Bars](https://learn.microsoft.com/en-us/windows/win32/controls/create-status-bars) — canonical creation recipe.
- [Microsoft Learn — SB_SETTEXT](https://learn.microsoft.com/en-us/windows/win32/controls/sb-settext) — segment text update.
- [Microsoft Learn — EM_SETCHARFORMAT](https://learn.microsoft.com/en-us/windows/win32/controls/em-setcharformat) — RichEdit per-range formatting.
- [Microsoft Learn — CHARFORMAT2W struct](https://learn.microsoft.com/en-us/windows/win32/api/richedit/ns-richedit-charformat2w) — `cbSize`, `dwMask = CFM_COLOR`, `crTextColor`.
- [Microsoft Learn — RichEdit Reference](https://learn.microsoft.com/en-us/windows/win32/controls/rich-edit-control-reference) — `EM_GETFIRSTVISIBLELINE`, `EM_GETLINECOUNT`, `EM_LINEFROMCHAR`, `EM_GETSEL`, `EM_SETSEL`, `EM_SETEVENTMASK`, `ENM_SCROLL`, `ENM_SELCHANGE`, `EN_VSCROLL`, `EN_SELCHANGE`.
- [VS Code blog — Optimizations in Syntax Highlighting (2017)](https://code.visualstudio.com/blogs/2017/02/08/syntax-highlighting-optimizations) — line-state pattern; cited in architecture.md.

### Secondary (MEDIUM confidence)

- [CodeProject — An Idea How to Use RichEdit50W for Syntax Highlighting](https://www.codeproject.com/Articles/1030858/An-Idea-How-to-Use-RichEdit-W-for-Syntax-Highlight) — practical CHARFORMAT2 batch patterns.
- [trishume/syntect](https://github.com/trishume/syntect) — Rust syntax-highlighting library; useful as a reference for line-state-machine shapes (we cannot use it, allowlist-blocked, but the API design informs our `tokenize_line` signature).
- [Notepad4](https://github.com/zufuliu/notepad4) — Scintilla-based editor; demonstrates the gutter + status bar + tab strip Win32 sibling-child pattern in action.

### Tertiary (LOW confidence — not used; flagged for completeness)

- AutoHotkey forum thread on EM_SETCHARFORMAT for syntax highlighting — patterns confirmed elsewhere; not authoritative.

---

## Infrastructure Dependencies

**None — unit tests only, no external infrastructure needed.**

All Phase 4 tests are pure-Rust `cargo test` runs:
- `tests/phase04_data_shape.rs` (Plan 04-01) — `lang_from_path` matrix.
- `tests/gutter_layout.rs` (Plan 04-02) — pure-logic gutter-width helper.
- `tests/status_bar_labels.rs` (Plan 04-03) — encoding/EOL label format helpers.
- `tests/syntax_tokenizers.rs` (Plan 04-05) — golden token streams.
- `tests/highlight_perf.rs --ignored` (Plan 04-04) — 1MB perf gate; runs in CI on `cargo test --release --ignored` if desired.

No Docker / database / network services. Matches Phase 1-3 test infrastructure.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every API and pattern verified against Microsoft Learn or already locked by stack.md / architecture.md.
- Architecture: HIGH — patterns G1, S1, T1 mirror well-established Win32 + editor conventions; line-state algorithm is industry standard.
- Pitfalls: HIGH for the project-level inheritance; MEDIUM for the Phase-4-specific ones (P4-1 through P4-9) — designed from first principles + Microsoft API contract reading; some (P4-3 re-entrancy guard, P4-4 first-paint timing) are precautionary and may not all surface in practice.
- Performance: MEDIUM — the <16ms keystroke-to-paint target on a 1MB JS file is plausible with viewport-only re-color but unverified. Plan 04-04 must measure.

**Research date:** 2026-05-03
**Valid until:** 2026-06-03 (30 days — RichEdit / Win32 common controls are extremely stable; no upcoming changes expected.)
