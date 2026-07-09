# Phase 3: Multi-Tab + Find/Replace — Research

**Researched:** 2026-05-03
**Domain:** Multi-tab text editor on top of RichEdit + per-tab state migration + regex find/replace with worker-thread cancellation
**Confidence:** HIGH on tab data shape, regex crate, atomic-cancellation pattern, RichEdit selection APIs; MEDIUM on the **per-tab RichEdit child window vs single-RichEdit-with-buffer-swap** fork (recommendation locked below); HIGH on Find UI surface and accelerator wiring. There is **no** Phase 3 `context.md` (auto mode, P-1802 bypass), so constraints are inherited from project-level research, requirements.md, and the existing Phase 1/2 code shape.
**Project research relied upon:** `.planning/research/summary.md`, `.planning/research/stack.md`, `.planning/research/architecture.md` (Pattern 4 per-tab state, Pattern 5 worker thread + PostMessage, Pattern 7 dirty-rect repaint), `.planning/research/pitfalls.md` (Pitfall 5 regex workflow, Pitfall 6 undo correctness across tabs, Pitfall 11 tab focus / IME, Pitfall 14 RichEdit-vs-custom). **This file emits only Phase-3-specific deltas** — it does not re-derive material in the project-level research.
**Phase 1/2 inheritance:** `.planning/phases/01-foundations-editor-spine/` (entire RichEdit + WndProc + GWLP_USERDATA + accelerator-table spine), `.planning/phases/02-file-i-o-encoding-cascade/` (Pattern A original-bytes cache, atomic save, encoding/EOL state on `EditorState`).

<user_constraints>
## User Constraints (derived — no Phase-3 context.md exists)

No `03-context.md` exists for this phase (auto-mode synthesis, P-1802 bypass). Constraints are inherited from `.planning/idea.md`, `.planning/requirements.md`, `.planning/research/*.md`, `.planning/state.md`, the Phase 1/2 verification docs, and the additional_context provided to this researcher.

### Locked Decisions (from project-level + Phase 1/2 + auto-mode)

- **Tech stack:** Rust 1.82, `windows` crate 0.62.x, no GUI framework wrappers. `regex` crate is on the allowlist; `fancy-regex` is NOT (Pitfall 5: backtracking engines are a UI-freeze hazard).
- **Crate allowlist for v1:** `windows`, `regex`, `serde` + `serde_json`, `encoding_rs`. Phase 3 needs `regex` (newly enabled) and continues to use `windows` features already declared. **No new crate required.**
- **No async runtime.** Win32 message loop is the only event source. Worker threads are bare `std::thread::spawn` + `std::sync::mpsc` + `PostMessage(hwnd, WM_APP+N, ...)`. Already proven in Phase 2 via `read_with_timeout`.
- **Performance budgets (carry-forward):** keystroke-to-paint <16ms, regex find on 1MB <100ms (synchronous path), >1MB on a worker thread without freezing UI (`QUAL-07`).
- **Platform:** Windows 10 1809+ / Windows 11 only. `x86_64-pc-windows-msvc`.
- **Binary size:** <10MB. Adding `regex` will add ~600KB-1MB compiled DFA tables; Phase 1 currently sits at ~230KB (~2% of ceiling), so the budget easily absorbs this. CI gate already enforces.
- **`[profile.release]` cocktail** (`opt-level="z"`, `lto="fat"`, `codegen-units=1`, `strip="symbols"`, `panic="abort"`) — already shipped, must not regress.
- **RichEdit 4.1 (`MSFTEDIT_CLASS`)** owns the visible text. The v2 escape hatch (custom render) stays out of v1.
- **`EM_STREAMIN`/`EM_STREAMOUT`** are the load/save channel. Phase 2's Pattern A (Original-Bytes Cache) is the byte-exact round-trip mechanism and is preserved per-tab.
- **`#![deny(clippy::unwrap_used, clippy::expect_used)]`** discipline in `src/window.rs`, `src/editor.rs`, `src/dispatch.rs`. Any new code in these modules must comply.
- **Reentrancy rule (carry-forward):** never hold `&mut App` across `SendMessage`. Re-borrow per branch; drop before any synchronous Win32 call that could re-enter WndProc.
- **No `Rc<RefCell>`, no `Arc<Mutex<EditorState>>`** in the editor core. Worker threads receive `Vec<u8>` snapshots; results return via `mpsc::Sender` + `PostMessage` wakeup. Cancellation via `AtomicU64` epoch counter.
- **TEST-04 lands here:** "Regex find/replace tests covering literal, case-insensitive, whole-word, and regex modes." Cumulative test count target: ≥30 by ship; Phase 1+2 shipped 18+33=51 (per state.md the suite is well over 30 already), so Phase 3 adds quality-of-coverage tests, not quantity-fillers.
- **Carry-forward pitfalls:** Pitfall 11 (tab focus / IME on switch — must `SetFocus` after `TCN_SELCHANGE`), Pitfall 13 (Notepad++ UX expectations — confirm-before-close dialog must offer Save/Don't-Save/Cancel, not Yes/No).
- **Notepad++ behavioral parity (per features.md):** Wrap around defaults ON. After a successful find, the matched range is **selected** (SC-3.4 — `EM_EXSETSEL`/`EM_SETSEL`), not just highlighted. Replace-All collapses to one undo step (RichEdit's `EM_SETUNDOLIMIT(1000)` already bounds this; we call `SendMessage(hwnd_re, EM_STOPGROUPTYPING, 0, 0)` before and after the loop to keep it as one group). Grey-out "backward direction" in regex mode (matches Notepad++; `regex` crate has no native reverse search anyway).

### Claude's Discretion (Phase-3 specific)

- **Tab UI mechanism: `SysTabControl32` with `TCS_OWNERDRAWFIXED` (project-level recommended) vs custom-drawn tab strip.** Recommendation locked below: `SysTabControl32` (owner-drawn for the asterisk).
- **Per-tab strategy: one RichEdit child per tab (visibility toggle on switch) vs single RichEdit with buffer swap.** Recommendation locked below: **one RichEdit per tab**. Pitfall 11 (IME state on tab switch) is decisively cleaner with this design.
- **Find/Replace UI: dockable bar at bottom (Notepad++ uses a top-modal dialog) vs modeless dialog.** Recommendation: **modeless dialog** (`CreateDialogIndirectParamW` with a `DLGTEMPLATE`, or a child window that floats over the editor). Locks Phase 3 scope; matches Notepad++ behavior; no need to allocate paint real-estate inside the editor.
- **Find/Replace state scope: per-tab vs global.** Recommendation: **global** (one `FindState` on `App`). Notepad++ default; user expectation; cheaper to implement.
- **Regex flavour: `regex` (str-based) vs `regex::bytes` (byte-based).** Recommendation: **`regex`** (str). RichEdit gives us UTF-8 via `EM_STREAMOUT`; matching against `&str` is the natural shape. `regex::bytes` would only matter if we ever needed to match patterns containing invalid UTF-8 (out of scope).
- **Worker-thread threshold for "go async":** Recommendation: **buffer length > 1 MB** OR pattern compile takes more than ~10ms. Below that, run synchronously on the UI thread. Project-level Pattern 5 specifies "1MB" as the threshold; preserve.
- **Module split.** Recommendation: `src/find.rs` (find/replace logic + worker glue), `src/find_ui.rs` (the dialog), `src/tab.rs` (Tab struct + tab strip wrapper), `src/worker.rs` (generic worker-thread + PostMessage dispatcher — re-usable for Phase 4 background syntax tokenization). `src/editor.rs` is renamed shape: `EditorState` becomes per-tab; `App.editor: Option<EditorState>` becomes `App.tabs: Vec<Tab>`.
- **Naming:** `Tab { editor: EditorState, title: String, id: u64 }` keeps `EditorState` mostly unchanged (Phase 2's per-tab fields already exist). The stable `id: u64` defends against tab-index instability when tabs are reordered/closed.

### Deferred Ideas (OUT OF SCOPE for Phase 3)

- **Drag-rearrange of tabs** — explicitly out of scope per `requirements.md` Out-of-Scope.
- **Per-tab close-X button** — implies switching to fully custom-drawn tabs; SC-2 doesn't require it; Ctrl+W covers close. Defer to v2.
- **Find In Files / multi-file find** — out of scope per `requirements.md` Out-of-Scope.
- **Mark / Bookmark all matches, Find All in Current Document results pane, search history dropdown, Count button, Extended-mode escapes (`\n`, `\t`, `\xFF`)** — all "Defer to v1.x" per `features.md` SC-3 minimum surface; not in the 18 phase requirements.
- **Backward-direction in regex mode** — grey it out; matches Notepad++. Regex crate has no native reverse search, and "find all then pick last-before-cursor" doubles work for marginal value.
- **Replace All across all open tabs** — single-tab-only per SC-3.4 ("in the active buffer").
- **Bookmark per tab / per cursor session restore** — v2 polish.
- **In-selection toggle for Replace All on a multi-line selection** — TODO list says yes but not in 18 reqs. Recommendation: ship if cheap (~1h) since it's a Notepad++ table-stake; defer the dedicated test if time-tight.
- **Window-position persistence per tab session** — v2.
- **CJK IME composition correctness across tab switches** — Pitfall 11 covered defensively (commit composition on switch). Full IME correctness QA is v1.x.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **TAB-01** | New empty tab via Ctrl+T | Accelerator → `WM_COMMAND(IDM_TAB_NEW)` → `App::add_tab(EditorState::new_empty())` → create per-tab RichEdit child → `TCM_INSERTITEM` on tab strip → `TCM_SETCURSEL` to focus the new tab. |
| **TAB-02** | Close active tab via Ctrl+W | Accelerator → `WM_COMMAND(IDM_TAB_CLOSE)` → if dirty (TAB-03), prompt; else `App::close_tab(idx)` → `TCM_DELETEITEM` → `DestroyWindow(richedit_hwnd)` → if `tabs.is_empty()` close window OR keep one empty default tab (decision: keep one empty default tab, matches Notepad++; quitting requires Alt+F4 / File→Exit). |
| **TAB-03** | Closing dirty tab prompts Save/Discard/Cancel | `MessageBoxW` with `MB_YESNOCANCEL | MB_ICONQUESTION`, button text reading "Save (Yes) / Don't Save (No) / Cancel" because `MessageBoxW` doesn't natively let you re-label buttons (or use `TaskDialog` for re-labeled buttons — see Pitfall 13). For v1: `MB_YESNOCANCEL` with the prompt text spelling out the mapping ("Save changes to <file>? \n\n Yes = Save \n No = Discard \n Cancel = keep tab open"). Cancel aborts the close; Save invokes the FILE-03 save path then closes; Discard closes immediately. |
| **TAB-04** | Ctrl+Tab next, Ctrl+Shift+Tab previous | **Accelerator table** entries `FCONTROL\|FVIRTKEY VK_TAB` → `IDM_TAB_NEXT`, `FCONTROL\|FSHIFT\|FVIRTKEY VK_TAB` → `IDM_TAB_PREV`. **Critical:** `SysTabControl32` does **not** natively handle Ctrl+Tab keyboard navigation (verified at learn.microsoft.com — the `WM_KEYDOWN` handler "Processes direction keys" but Ctrl+Tab is not a direction key). Parent window must catch it via accelerator. Plan must add these to the existing `build_accelerator_table()` in `src/app.rs`. |
| **TAB-05** | Click a tab to switch | Free with `SysTabControl32` — emits `TCN_SELCHANGE` (parent's `WM_NOTIFY`); we already have the dispatch pattern. Handler: hide outgoing tab's RichEdit child, show incoming tab's RichEdit child, `SetFocus(incoming.hwnd_re)` (Pitfall 11), repaint title bar to reflect new tab name. |
| **TAB-06** | Asterisk in tab title when buffer dirty | RichEdit fires `EN_CHANGE` notifications via `WM_COMMAND` to parent; on each, set `tab.dirty = true`. After save (FILE-03), set `tab.dirty = false`. The tab strip is owner-drawn (`TCS_OWNERDRAWFIXED`) so we paint the title with a leading `* ` when `tab.dirty` (or `●` per pitfalls.md UX-pitfall — recommend `* ` for SC-2 literal compliance, prefix with single Unicode bullet `●` only as a visual-distinctness pass in polish phase). On dirty change, `InvalidateRect(htabs, ...)` for the affected tab. |
| **TAB-07** | Each tab independent (buffer/cursor/encoding/EOL/undo/word-wrap) | All already in `EditorState` from Phase 1/2. Wrap in `Tab { editor: EditorState, title: String, id: u64, dirty: bool }`. RichEdit owns its own per-instance buffer/cursor/undo (one HWND per tab → automatically isolated). Encoding/EOL/`original_bytes`/`had_trailing_newline` already on `EditorState`. **Word-wrap** (SC-8) ships in Phase 5; Phase 3 ensures the per-tab shape is in place so Phase 5 just adds a bool field — no retrofit. |
| **FIND-01** | Ctrl+F opens Find bar | Accelerator → `WM_COMMAND(IDM_FIND_OPEN)` → modeless dialog (Find variant). Focus to the find input. |
| **FIND-02** | Ctrl+H opens Find & Replace | Same dialog as FIND-01 but in "Replace" mode (extra row visible). One dialog template, mode flag toggles which row is shown. |
| **FIND-03** | F3 / Shift+F3 (Find Next / Find Prev) | Accelerator → `IDM_FIND_NEXT` / `IDM_FIND_PREV`. Reuses the current pattern + flags (or empties if no prior). For regex mode, "Find Prev" requires "find all forward then pick last match before cursor" because the `regex` crate has no reverse search (verified docs.rs/regex). For literal/whole-word in non-regex mode, Phase 3 can use `EM_FINDTEXTEXW` (RichEdit built-in, supports backward via `FR_DOWN` flag), OR run our own search consistently — recommend **own search consistently** so the code path is uniform across regex/non-regex (avoids double-implementation of "match next" semantics). |
| **FIND-04** | Case-sensitive toggle | In our regex compile: pattern wrapped with `(?i)` prefix when toggle OFF; left bare when toggle ON. For non-regex literal mode: `RegexBuilder::new(&regex::escape(pat)).case_insensitive(!case_sensitive).build()`. |
| **FIND-05** | Whole-word toggle | Pattern wrapped with `\b...\b` boundaries. In regex mode, Notepad++ greys this out (mirror that to match user expectation); in literal mode, `RegexBuilder::new(&format!(r"\b{}\b", regex::escape(pat))).build()`. Note: in regex mode, the user composes their own boundaries; we leave the toggle disabled so we don't double-wrap and break their intentional regex. |
| **FIND-06** | Regex mode toggle, powered by `regex` crate | Pattern compiled directly via `RegexBuilder`. Cap `RegexBuilder::size_limit(10 * 1024 * 1024)` (Pitfall 5: prevents pathological-pattern compile-time DoS). Compile failures show a red-bordered input + status-line message; do NOT crash. |
| **FIND-07** | Replace single match | If there is a current selection AND the selection matches the find pattern: replace it via `EM_REPLACESEL(can_undo=TRUE, replacement)`, then advance to next match (FIND-03 logic). If no current selection or selection doesn't match: do a Find Next first; user clicks Replace again to commit. Notepad++ behavior. |
| **FIND-08** | Replace All in active buffer | Wrap operation in `EM_STOPGROUPTYPING` boundaries so all replacements collapse to ONE undo step (Pitfall 6: replace-all should be one undo). Iterate matches; build the new buffer via `regex::Captures::expand` for capture-group references (`$1`, `$0`, etc.); `EM_SETTEXTEX(ST_KEEPUNDO, new_text)` once at the end. Mark `EM_SETMODIFY(TRUE)`. |
| **FIND-09** | Wrap-around at buffer boundaries | When `find_iter` from cursor reaches end with no match, restart from offset 0 and search up to original cursor. If still no match, status line: "Pattern not found". When wrapping happens, status line: "Wrapped to top" (Notepad++ convention from features.md SC-3). |
| **FIND-10** | Worker thread for >1MB regex; cancel/discard stale | **Pattern 5 (project architecture).** Spawn `std::thread::spawn` with a snapshot (`buffer_text.clone()` — a `String`, ~1ms for 1MB), the compiled `Regex`, an `epoch: u64`, and an `mpsc::Sender<FindResult>`. App holds `find_epoch: AtomicU64`. New find/replace request increments the epoch; worker checks `app.find_epoch.load(Acquire) == my_epoch` before each `mpsc::send` and returns early if stale. Worker signals readiness via `PostMessage(hwnd, WM_APP_FIND_RESULT, epoch as WPARAM, 0)`; UI thread drains `mpsc::Receiver` and applies if epoch is still current. Cancellation = bump epoch (worker self-terminates on next check). |
| **TEST-04** | Tests covering literal, case-insensitive, whole-word, regex modes | `tests/find_engine.rs` (pure-logic, headless): unit tests for the `find_engine` module — no Win32 needed. Test matrix: `{literal, regex} × {case-sensitive, case-insensitive} × {whole-word, no-whole-word} × {forward, backward, wrap-around}`. ~12-16 tests is the natural shape. Plus: `tests/replace_engine.rs` (3-5 tests on Replace single, Replace All, capture-group expansion, undo-as-single-step verification via the `undo_model` shape from Phase 1). Worker-thread cancellation pattern is testable separately via `tests/find_worker.rs` (4-6 tests on epoch-discard semantics — pure mpsc + AtomicU64, no Win32). |

</phase_requirements>

## Summary

Phase 3 turns the single-tab Phase-1/2 spine into an N-tab editor and adds Find/Replace. The architectural shape is dictated by two non-negotiable constraints from the existing code: (1) Phase 2's `EditorState` already carries everything a tab needs (`current_path`, `encoding`, `eol`, `original_bytes`, `had_trailing_newline`, `hwnd_re`) — Phase 3 just promotes `App.editor: Option<EditorState>` to `App.tabs: Vec<Tab>` where `Tab { editor: EditorState, title: String, id: u64, dirty: bool }`. (2) The accelerator table in `src/app.rs::build_accelerator_table()` is the canonical place for new shortcuts (Ctrl+T, Ctrl+W, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+F, Ctrl+H, F3, Shift+F3); the WndProc dispatcher in `src/dispatch.rs` already routes `WM_COMMAND` and is the only place to add new IDM_* handlers.

The recommended UI shape is **one RichEdit child window per tab**, with visibility toggled on tab switch — not a single RichEdit with buffer swap. Pitfall 11 (IME state on tab switch) is decisively cleaner with a child-per-tab: each RichEdit owns its own undo stack, IME composition state, scroll position, and cursor; switching tabs is `ShowWindow(out, SW_HIDE)` + `ShowWindow(in, SW_SHOW)` + `SetFocus(in.hwnd_re)`. The buffer-swap design would force us to commit IME compositions, save+restore cursor/undo across N tabs, and re-stream EM_STREAMIN on every switch — substantially more code and substantially more risk. The cost of N RichEdit children is ~50KB of working set per tab (Notepad++ does the same thing) — well within the v1 envelope.

The Find/Replace engine is a thin layer over the `regex` crate. Pure-logic functions (`find_engine::find_next(text, pattern, flags, cursor) -> Option<Match>`, `replace_engine::replace_all(text, pattern, repl, flags) -> (new_text, count)`) live in `src/find.rs` and are headless-testable. The Win32 side (`src/find_ui.rs`) is a modeless dialog window (template via `CreateWindowExW` rather than a `.rc` file — keeps the no-resource-files constraint) that drives the engine and applies results to the active tab via `EM_SETSEL` (select the match — SC-3.4) and `EM_REPLACESEL` / `EM_SETTEXTEX` (replace).

The worker-thread + PostMessage cancellation pattern is the third architectural piece. **It is the same pattern Phase 4 will reuse for background syntax tokenization** (project research summary: "building it once in Phase 3 pays for itself twice"). Worker-thread snapshots the buffer (`Vec<u8>` clone, ~1ms for 1MB), runs `Regex::find_iter` on the snapshot, and posts results back via `mpsc::Sender` + `PostMessage(hwnd, WM_APP_FIND_RESULT, epoch, 0)`. Stale results are discarded by the UI thread comparing the message's `epoch` against `App.find_epoch: AtomicU64`. Cancellation is just `find_epoch.fetch_add(1, Release)` — workers self-terminate on next check.

**Primary recommendation:** Land Phase 3 in **5 plans** in three waves: **(Wave 1)** `03-01` per-tab data shape (`Tab` struct, `App.tabs: Vec<Tab>`, dirty flag, no UI yet); **(Wave 2 parallel)** `03-02` tab UI (`SysTabControl32` owner-drawn, accelerators, switch/close/new, confirm-before-close), `03-03` find/replace engine (pure-logic regex layer, all 4 modes, no UI), `03-04` find/replace UI (modeless dialog, `EM_SETSEL`/`EM_REPLACESEL` glue); **(Wave 3)** `03-05` worker-thread + epoch cancellation for FIND-10 + integration tests.

## Standard Stack

### Core (Phase 3 additions to Phase 2's stack)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `regex` | **1.12.3** (verified — see project-level stack.md) | Find/replace engine (FIND-06) | Already in the v1 allowlist. Pike-NFA based, immune to ReDoS by design (verified, project pitfalls.md Pitfall 5). `RegexBuilder::case_insensitive(bool)` covers FIND-04. `regex::escape` covers literal-mode safety. `Captures::expand` covers `$1`/`$0` group references in replacement strings. |
| `std::sync::mpsc` | (built-in) | Worker thread → UI thread result channel | Already used in Phase 2 (`read_with_timeout`); reuse pattern. |
| `std::sync::atomic::AtomicU64` | (built-in) | Find/replace epoch counter for cancellation | Bare std::sync; no extra crate. Workers compare `Acquire`-loaded epoch against their own; UI bumps with `Release`. |
| `std::thread::spawn` | (built-in) | Worker thread for >1MB regex | Already used in Phase 2; same shape. No tokio. |

### `windows` crate features required by Phase 3

```toml
# Already enabled (carry-forward from Phase 1/2):
"Win32_UI_WindowsAndMessaging",     # WM_COMMAND, WM_NOTIFY, accelerators, MessageBoxW
"Win32_UI_Controls",                 # tab control class WC_TABCONTROL, EM_GETSEL, EM_SETSEL
"Win32_UI_Controls_RichEdit",        # EM_FINDTEXTEXW, EM_EXSETSEL, EM_GETTEXTRANGE, EM_REPLACESEL
"Win32_UI_Controls_Dialogs",         # GetSaveFileNameW already in
"Win32_UI_Input_KeyboardAndMouse",   # ACCEL, FVIRTKEY/FCONTROL/FSHIFT
"Win32_Graphics_Gdi",                # WM_DRAWITEM owner-draw
"Win32_Foundation", "Win32_System_LibraryLoader", "Win32_System_Com", "Win32_System_Ole",
"Win32_Storage_FileSystem", "Win32_System_Diagnostics_Debug", "Win32_UI_Shell", "Win32_UI_HiDpi",

# Add to [dependencies.windows] features list for Phase 3:
# (None new — owner-draw uses Win32_UI_WindowsAndMessaging WM_DRAWITEM already, tab control class
#  WC_TABCONTROL is in Win32_UI_Controls already, EM_FINDTEXTEXW/EM_EXSETSEL are in Win32_UI_Controls_RichEdit
#  already. Need to add `regex` as an unconditional dep.)
```

```toml
# Cargo.toml [dependencies] addition:
regex = "1.12"
```

That's it. `regex` is the only new dependency.

### Don't Add

| Avoided | Why |
|---------|-----|
| `fancy-regex` | Backtracking engine; subject to catastrophic-backtracking UI freezes (Pitfalls.md Pitfall 5). Notepad++ uses Boost.Regex (PCRE-style) and *does* have this bug. The `regex` crate's lack of lookbehind/atomic-groups is documented in features.md SC-3 — accept the gap; do not import a backtracking engine. |
| `regex-lite` | Tiny size win, but lacks the full Unicode features (`(?i)`, `\b`, etc.) we explicitly need for FIND-04/FIND-05. Wrong tradeoff. |
| `regex::bytes::Regex` | Would let us match against `&[u8]` directly. But RichEdit gives us UTF-8 via `EM_STREAMOUT`; matching against `&str` is the natural shape and avoids byte-vs-char-offset confusion at selection-set time. Stay with `regex::Regex`. |
| `crossbeam-channel` | `std::sync::mpsc` is sufficient; it's what we already use. No need for crossbeam's faster channel — the channel isn't the bottleneck. |
| Custom thread pool / `rayon` | We spawn at most one worker at a time (epoch-cancelled). `std::thread::spawn` per request is fine; the OS thread-create cost (~50µs) is negligible vs. the find work it does (typically multi-ms). |
| New file-watching crate (e.g. `notify`) for cross-tab sync | Out of scope for Phase 3. v1.x feature. |
| `Win32_UI_Controls_Dialogs` for the Find dialog | The Find dialog is a custom child window (`CreateWindowExW` on a registered class) NOT a built-in `FindText`/`ReplaceText` common dialog. The latter is a deprecated API with poor UX; project-level features.md prescribes our own bar. Already-enabled features cover everything. |

## Architecture Patterns

### Recommended File Layout (Phase 3 deltas to Phase 2)

```
src/
├── main.rs                # +Add IDM_TAB_*, IDM_FIND_* to accelerator table (one-line edits)
├── window.rs              # (unchanged trampoline; works for any &mut App)
├── app.rs                 # tabs: Vec<Tab>, active_tab: usize, find_state: FindState,
│                          #   find_epoch: AtomicU64, find_rx: mpsc::Receiver<FindMsg>,
│                          #   IDM_TAB_NEW=120, IDM_TAB_CLOSE=121, IDM_TAB_NEXT=122, IDM_TAB_PREV=123,
│                          #   IDM_FIND_OPEN=130, IDM_FIND_REPLACE_OPEN=131, IDM_FIND_NEXT=132, IDM_FIND_PREV=133
├── tab.rs                 # NEW — Tab struct, build_tab_strip(), TCN_SELCHANGE handler
├── editor.rs              # (existing EditorState — UNCHANGED in shape; methods unchanged.
│                          #   Phase 3 owns the lifecycle from Tab, not App.)
├── find.rs                # NEW — pure-logic find/replace engine (no Win32):
│                          #   FindFlags { case_sensitive: bool, whole_word: bool, regex: bool, wrap: bool, backward: bool },
│                          #   compile(pattern, flags) -> Result<Regex, CompileError>,
│                          #   find_next(text, regex, cursor, backward, wrap) -> Option<Match>,
│                          #   replace_all(text, regex, replacement) -> (String, usize)
├── find_ui.rs             # NEW — modeless dialog (CreateWindowExW on a registered class):
│                          #   layout: pattern input, replace input, 4 toggles, 5 buttons (Find Next/Prev/Replace/Replace All/Close),
│                          #   status line; pumps via main message loop (IsDialogMessage)
├── find_worker.rs         # NEW — worker-thread + epoch-cancelled find:
│                          #   spawn_find(snapshot: String, regex: Regex, epoch: u64, hwnd: HWND, tx: mpsc::Sender<FindMsg>)
├── dispatch.rs            # +WM_NOTIFY (TCN_SELCHANGE, TCN_SELCHANGING),
│                          # +WM_COMMAND (IDM_TAB_*, IDM_FIND_*),
│                          # +WM_DRAWITEM (tab strip owner-draw),
│                          # +WM_APP_FIND_RESULT (worker callback)
├── menu.rs                # +Tabs menu (New / Close / Next / Previous), +Search menu (Find / Replace / Find Next / Find Prev)
└── ...

tests/
├── find_engine.rs          # NEW — pure unit tests for find/replace logic, no Win32. ~12-16 tests.
├── replace_engine.rs       # NEW — pure unit tests for Replace All semantics, capture groups,
│                           #   single-undo property. ~5-8 tests.
├── find_worker.rs          # NEW — worker thread + epoch cancellation tests using only mpsc + AtomicU64.
│                           #   ~4-6 tests.
├── tab_model.rs            # NEW — pure unit tests for Tab struct, dirty propagation, close-confirmation
│                           #   logic (extracted as pure function tab_close_decision(tab) -> CloseAction).
│                           #   ~6-10 tests.
└── ...
```

**Rationale for the splits:**
- `find.rs` is pure Rust — no Win32, no HWND. This is what makes TEST-04 mechanically testable: the entire matrix runs in `cargo test --lib` in milliseconds without spinning up a window. Same boundary as Phase 2's `encoding.rs` / `eol.rs`.
- `find_ui.rs` and `find_worker.rs` are the "thin Win32 shell" around the pure logic. Following Phase 2's `dispatch_pure.rs` precedent, the *decision* logic (e.g., should we go async? what's the new cursor after replace?) is testable functions in `find.rs`; the side effects are in `find_ui.rs` / `find_worker.rs` and rely on integration tests + manual QA.
- `tab.rs` keeps tab-strip wrapping in one place. The pure-logic `tab_close_decision(dirty: bool, has_path: bool) -> CloseAction { Save, Discard, Cancel }` (exposed for testing) extracts the "should we prompt?" decision; the actual `MessageBoxW` call stays in `dispatch.rs`.
- `find_worker.rs` separation pays dividends in Phase 4 — the same epoch+mpsc+PostMessage pattern is reused for background syntax tokenization. Building it as a generic-ish module here saves work later.

### Pattern 1 — Per-Tab RichEdit Child Window (locked recommendation)

**What:** Each tab owns its own `HWND` of class `MSFTEDIT_CLASS`. `App` holds `tabs: Vec<Tab>` and `active_tab: usize`. Tab switch hides the outgoing tab's HWND and shows the incoming tab's HWND. Each per-tab HWND has its own `EditorState` containing the path/encoding/EOL/original_bytes already-shipped from Phase 2.

```rust
// src/tab.rs
pub struct Tab {
    pub editor: EditorState,            // hwnd_re + Phase 2 metadata fields
    pub title: String,                  // file name (or "Untitled")
    pub id: u64,                        // stable across reorder/close
    pub dirty: bool,                    // updated on EN_CHANGE; cleared on save
}

// src/app.rs (replaces editor: Option<EditorState>)
pub struct App {
    pub tabs: Vec<Tab>,
    pub active_tab: usize,              // index into tabs
    pub next_tab_id: u64,
    pub htabs: HWND,                    // SysTabControl32 strip
    pub haccel: HACCEL,
    pub find: FindState,
    pub find_epoch: std::sync::atomic::AtomicU64,
    pub find_rx: std::sync::mpsc::Receiver<FindMsg>,
    pub find_tx: std::sync::mpsc::Sender<FindMsg>,
}
```

**Why this over single-RichEdit-with-buffer-swap:**
- **Pitfall 11 mitigation**: each RichEdit owns its own IME composition context. Tab switch doesn't need to commit/restore — just hide. (Single-RichEdit design *would* need to commit pending compositions on every switch, and either save+restore cursor/scroll/undo or accept losing them.)
- **Per-tab undo bounded ~1000 ops (SC-7)**: each RichEdit has its own undo manager. Already configured via `EM_SETUNDOLIMIT(1000)` per instance from Phase 1. Single-RichEdit design would force us to roll our own multi-tab undo tracker.
- **No re-stream cost on switch**: switching tabs is `ShowWindow(out, SW_HIDE) ; ShowWindow(in, SW_SHOW)` — O(1) Win32 calls. Single-RichEdit design would `EM_STREAMIN` the new buffer on every switch — for 1MB this is multi-ms and forfeits the user-visible cursor position.
- **Working set cost is acceptable**: ~50KB per RichEdit instance × 20 tabs = 1MB. Notepad++ uses the same model.

**Trade-offs / risks:**
- **Memory** scales with tab count. At 20 tabs of 1MB files, baseline working set is roughly 20MB (text bytes × 2 for in-memory cache + RichEdit's internal copy). Still OK on 4GB+ machines.
- **Z-order management**: only the active tab's RichEdit is `WS_VISIBLE`. New tabs are created `WS_CHILD | WS_VISIBLE` and immediately others get `ShowWindow(SW_HIDE)`. Be careful with `WS_CLIPCHILDREN` on the parent so hidden RichEdits don't paint stripes through the active one.
- **Resize discipline**: when the window resizes, ALL tab RichEdits must `MoveWindow` to the new client-minus-tabstrip rectangle. (Or: set them all to the same rectangle once and rely on `WS_VISIBLE` swap.)

**Source:** Architecture Pattern 4 in project research; Pitfall 11 risk analysis in pitfalls.md.

### Pattern 2 — Tab Strip via `SysTabControl32` Owner-Draw

**What:** Create a `WC_TABCONTROL` ("SysTabControl32") child of the main window, height ~28px, top-aligned. Style: `WS_CHILD | WS_VISIBLE | TCS_OWNERDRAWFIXED | TCS_FIXEDWIDTH=NO`. Items added via `TCM_INSERTITEM` with `TCITEM { mask: TCIF_TEXT | TCIF_PARAM, pszText: title_utf16, lParam: tab.id }`. `TCN_SELCHANGE` fires (via parent's `WM_NOTIFY`) on click. `WM_DRAWITEM` fires for each tab paint when owner-draw is active.

**Critical**: `SysTabControl32` does NOT natively handle Ctrl+Tab keyboard navigation (verified at learn.microsoft.com — its `WM_KEYDOWN` handler "Processes direction keys" only). Parent window must catch Ctrl+Tab via the accelerator table (Pattern 3 below).

**Owner-draw paint** (in dispatch.rs `WM_DRAWITEM` handler):
```rust
// pseudo-Rust
let dis = &*(lparam.0 as *const DRAWITEMSTRUCT);
let tab_idx = dis.itemID as usize;
if let Some(tab) = app.tabs.get(tab_idx) {
    let title = if tab.dirty {
        format!("* {}", tab.title)        // SC-2: leading asterisk
    } else {
        tab.title.clone()
    };
    // DrawTextW into dis.hDC within dis.rcItem
    // Honor dis.itemState ODS_SELECTED for active-tab visuals
}
```

**On `EN_CHANGE`** (dispatched from RichEdit child via `WM_COMMAND` to parent): set `tab.dirty = true`, then `InvalidateRect(htabs, &tab_rect, FALSE)` to repaint just that tab. Avoid full-tabstrip repaint (Pattern 7 dirty-rect from project research).

**On save** (FILE-03 path in dispatch.rs): set `tab.dirty = false` after successful save, `InvalidateRect(htabs, &tab_rect, FALSE)`.

**Source:** [Microsoft Learn: About Tab Controls](https://learn.microsoft.com/en-us/windows/win32/controls/tab-controls) (HIGH); pitfalls.md UX-pitfall on dirty-marker visibility.

### Pattern 3 — Accelerator Table Extension

**What:** Phase 1 already established the accelerator pattern in `src/app.rs::build_accelerator_table()`. Phase 3 extends with:

```rust
// in build_accelerator_table(), append:
ACCEL { fVirt: FVIRTKEY | FCONTROL,             key: VK_T.0,    cmd: IDM_TAB_NEW },
ACCEL { fVirt: FVIRTKEY | FCONTROL,             key: VK_W.0,    cmd: IDM_TAB_CLOSE },
ACCEL { fVirt: FVIRTKEY | FCONTROL,             key: VK_TAB.0,  cmd: IDM_TAB_NEXT },
ACCEL { fVirt: FVIRTKEY | FCONTROL | FSHIFT,    key: VK_TAB.0,  cmd: IDM_TAB_PREV },
ACCEL { fVirt: FVIRTKEY | FCONTROL,             key: VK_F.0,    cmd: IDM_FIND_OPEN },
ACCEL { fVirt: FVIRTKEY | FCONTROL,             key: VK_H.0,    cmd: IDM_FIND_REPLACE_OPEN },
ACCEL { fVirt: FVIRTKEY,                        key: VK_F3.0,   cmd: IDM_FIND_NEXT },
ACCEL { fVirt: FVIRTKEY | FSHIFT,               key: VK_F3.0,   cmd: IDM_FIND_PREV },
```

**Reentrancy note:** `TranslateAcceleratorW` already runs in `main.rs`'s message loop before `DispatchMessageW`. The accelerator dispatches `WM_COMMAND` to the active window, so dispatch.rs `WM_COMMAND` handler picks up the new IDM_*. No new infrastructure needed.

**Find dialog focus issue:** When the modeless Find dialog is open, accelerators bound to the main window won't fire while the dialog has focus. Resolution: in the message loop, pre-dispatch via `IsDialogMessageW(hfind_dlg, &mut msg)` if `hfind_dlg` is non-null AND visible — that handles Tab/Esc/Enter inside the dialog naturally. F3/Shift+F3 should still work everywhere (including in the find dialog) — `TranslateAcceleratorW` is called with the *main* hwnd, which is the focus's ancestor, so it fires. Verify this in QA.

### Pattern 4 — Find/Replace Engine (pure logic in `src/find.rs`)

**What:**
```rust
// src/find.rs (pure-logic, no Win32)
use regex::{Regex, RegexBuilder};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FindFlags {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regex: bool,
    pub wrap: bool,
    pub backward: bool,
}

#[derive(Debug)]
pub enum CompileError {
    Empty,                              // empty pattern
    Regex(regex::Error),                // forwarded from RegexBuilder
}

pub fn compile(pattern: &str, flags: FindFlags) -> Result<Regex, CompileError> {
    if pattern.is_empty() { return Err(CompileError::Empty); }
    let final_pat = if flags.regex {
        pattern.to_owned()              // user-supplied raw regex
    } else if flags.whole_word {
        format!(r"\b{}\b", regex::escape(pattern))
    } else {
        regex::escape(pattern)          // literal-mode safety
    };
    RegexBuilder::new(&final_pat)
        .case_insensitive(!flags.case_sensitive)
        .size_limit(10 * 1024 * 1024)   // Pitfall 5: cap pathological compile
        .build()
        .map_err(CompileError::Regex)
}

#[derive(Debug, Clone, Copy)]
pub struct FindHit {
    pub start: usize,                   // byte offset in text
    pub end: usize,                     // byte offset (exclusive)
    pub wrapped: bool,                  // true if wrap-around occurred
}

/// Find next match starting from `cursor` (byte offset). If `flags.backward`,
/// returns the last match strictly before `cursor`. If wrap is enabled and no
/// match is found before EOF (or BOF for backward), restart from the other end.
pub fn find_next(text: &str, regex: &Regex, cursor: usize, flags: FindFlags) -> Option<FindHit> {
    if flags.backward {
        // No native reverse search in `regex` crate — find all matches up to `cursor`,
        // pick the last one (project pitfalls.md Pitfall 5 / verified docs.rs/regex).
        let last_before = regex.find_iter(&text[..cursor.min(text.len())]).last();
        if let Some(m) = last_before {
            return Some(FindHit { start: m.start(), end: m.end(), wrapped: false });
        }
        if flags.wrap {
            // Restart from end and find last match strictly after cursor.
            let last_overall = regex.find_iter(text).last()?;
            if last_overall.start() > cursor {
                return Some(FindHit { start: last_overall.start(), end: last_overall.end(), wrapped: true });
            }
        }
        None
    } else {
        if let Some(m) = regex.find(&text[cursor..]) {
            return Some(FindHit { start: cursor + m.start(), end: cursor + m.end(), wrapped: false });
        }
        if flags.wrap {
            let m = regex.find(&text[..cursor.min(text.len())])?;
            return Some(FindHit { start: m.start(), end: m.end(), wrapped: true });
        }
        None
    }
}

/// Replace all matches in `text`, returning (new_text, count). Capture-group
/// references in `replacement` ($0, $1, ${name}) are honored via `Captures::expand`.
pub fn replace_all(text: &str, regex: &Regex, replacement: &str) -> (String, usize) {
    let count = regex.find_iter(text).count();
    let new_text = regex.replace_all(text, replacement).into_owned();
    (new_text, count)
}
```

**Why the byte-offset shape:** Win32 RichEdit selection is byte-offset based for ANSI but character-offset for `EM_EXSETSEL` — actually for Unicode RichEdit, `CHARRANGE.cpMin/cpMax` are UTF-16 code-unit offsets. Phase 3 must convert: when applying a `FindHit` (UTF-8 byte offset) to RichEdit's selection, walk the buffer's UTF-8 → UTF-16 code-unit count. This is a `text[..byte_offset].encode_utf16().count()`. Fast for the small distances involved. **This is the single foot-gun where byte vs char offsets must not be conflated** — flag it in the plan, write a unit test that exercises it on a multi-byte UTF-8 fixture.

**`replace_all` undo step** (Pitfall 6): the entire replace happens via one `EM_SETTEXTEX(ST_KEEPUNDO, new_text)` after `EM_STOPGROUPTYPING`. RichEdit treats this as one undo unit. The `replace_engine.rs` integration test verifies via `tests/undo_property.rs` (or its Phase 3 extension) that one Replace All = one Ctrl+Z restores.

**Trade-offs:**
- **Pro:** All four FIND-04/05/06 mode combos route through one compiler. Adding a new toggle later is a one-line edit.
- **Pro:** Pure logic; tests run in milliseconds.
- **Con:** Backward search in regex mode is O(n) per find-prev call. For 1MB files this is ~10ms — acceptable. Above 1MB this should be on the worker thread (Pattern 5).

**Source:** project pitfalls.md Pitfall 5 (verified at docs.rs/regex/1.12.3); regex crate's RegexBuilder API (HIGH).

### Pattern 5 — Worker Thread + Epoch Cancellation (FIND-10)

**What:** For find/replace on buffers > 1MB:
```rust
// src/find_worker.rs
pub enum FindMsg {
    Hit { epoch: u64, hit: FindHit },
    Done { epoch: u64, total: usize },
    Error { epoch: u64, msg: String },
}

pub fn spawn_find(
    snapshot: String,
    regex: Regex,
    cursor: usize,
    flags: FindFlags,
    epoch: u64,
    epoch_atomic: Arc<AtomicU64>,        // shared with App.find_epoch
    hwnd: HWND,
    tx: mpsc::Sender<FindMsg>,
) {
    std::thread::spawn(move || {
        // Periodically check stale-epoch; for find_iter this means: between matches.
        let mut count = 0;
        for m in regex.find_iter(&snapshot) {
            if epoch_atomic.load(Ordering::Acquire) != epoch {
                return;                    // stale — abandon
            }
            count += 1;
            // For "find next from cursor", filter; etc. — here just send first.
            // (real impl: send an iterator of hits OR send first match for find-next semantics)
            let _ = tx.send(FindMsg::Hit { epoch, hit: FindHit { start: m.start(), end: m.end(), wrapped: false } });
            unsafe {
                let _ = PostMessageW(Some(hwnd), WM_APP_FIND_RESULT,
                                     WPARAM(epoch as usize), LPARAM(0));
            }
            break;                         // for find-next: stop after first hit
        }
        let _ = tx.send(FindMsg::Done { epoch, total: count });
    });
}
```

UI-thread handler:
```rust
// dispatch.rs WM_APP_FIND_RESULT branch:
let epoch = wparam.0 as u64;
if epoch != app.find_epoch.load(Ordering::Acquire) {
    return LRESULT(0);                     // stale — discard
}
while let Ok(msg) = app.find_rx.try_recv() {
    match msg {
        FindMsg::Hit { epoch: e, hit } if e == epoch => apply_hit(app, hit),
        _ => {} // stale — drop
    }
}
```

**Why epoch counter (not bool / channel-close):**
- **Bool flag**: requires `Acquire/Release` coordination AND can't distinguish "request 5 cancelled" from "request 5 still running while request 6 runs in parallel". Epochs trivially handle out-of-order cleanup.
- **Channel close**: requires the worker to write into the channel; a worker stuck inside `Regex::find_iter` can't observe channel disconnection. Epoch check between matches (or via a periodic timer) is the only cancellation mechanism that works mid-regex.
- **`AtomicU64`** vs `AtomicBool`: easy — increment per request; workers compare. `fetch_add(1, Release)` is the cancellation primitive. New requests are just increments. Workers know their assigned epoch from the spawn site.

**Cancellation timing**: between matches in `find_iter`. For pathological "matches every byte" patterns, this is fine (millions of checks/sec). For "matches nothing" patterns on a 100MB file, the worker runs to completion with no cancellation point — but the `regex` crate is linear-time so this is bounded at <1s on a sane CPU. Acceptable for v1; v1.x could add a periodic epoch-check via a custom iterator if 100MB+ files become common.

**Source:** Architecture Pattern 5 (project), used in Phase 2's `read_with_timeout`. `PostMessage` semantics from Microsoft Learn (HIGH).

### Pattern 6 — Confirm-Before-Close UX (TAB-03)

**What:** When user presses Ctrl+W (or otherwise closes a dirty tab), present `MessageBoxW` with `MB_YESNOCANCEL | MB_ICONQUESTION`:

```rust
unsafe fn prompt_close_dirty(parent: HWND, tab: &Tab) -> CloseAction {
    let title = format!("Save changes to {}?\0", tab.title);
    let body = format!(
        "The file '{}' has unsaved changes.\n\n\
         Yes  = Save and close\n\
         No   = Discard changes and close\n\
         Cancel = Keep tab open\0",
        tab.title
    );
    let title_w: Vec<u16> = title.encode_utf16().collect();
    let body_w: Vec<u16> = body.encode_utf16().collect();
    let result = MessageBoxW(
        Some(parent),
        PCWSTR(body_w.as_ptr()),
        PCWSTR(title_w.as_ptr()),
        MB_YESNOCANCEL | MB_ICONQUESTION,
    );
    match result.0 {
        IDYES_VAL => CloseAction::Save,
        IDNO_VAL => CloseAction::Discard,
        _ => CloseAction::Cancel,           // IDCANCEL or any other
    }
}
```

**Why `MB_YESNOCANCEL` over `TaskDialog`:**
- **Already imported** — Phase 2 uses `MessageBoxW` extensively.
- **TaskDialog** would let us re-label buttons ("Save" / "Don't Save" / "Cancel") which is closer to native Win32 idiom (cf. Notepad++, VS Code). Cost: pulls in `Win32_UI_Controls.TaskDialog` + COMCTL32 v6 manifest assertion. Worth it eventually but adds plan-execution friction this phase.
- **Recommendation locked**: ship `MessageBoxW + MB_YESNOCANCEL` for v1. The prompt body explicitly maps Yes/No/Cancel → Save/Discard/Cancel. A v1.x polish task can swap to TaskDialog without changing the close decision logic.

**Pure-logic decision**: extract `tab_close_decision(dirty: bool, action: CloseAction) -> CloseOutcome { Close, KeepOpen, SaveAndClose }` to `src/tab.rs` — testable without Win32.

**Source:** project pitfalls.md Pitfall 13 (Notepad++ UX expectations), features.md table-stakes.

### Pattern 7 — RichEdit Selection for Found Matches (SC-3.4)

**What:** Selection (not just highlight) is the SC-3.4 contract. RichEdit selection uses **UTF-16 code unit offsets** in `EM_EXSETSEL` / `CHARRANGE`. Our buffer is UTF-8. So:

```rust
// Convert UTF-8 byte offset → UTF-16 code unit offset.
fn utf8_to_utf16_units(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].encode_utf16().count()
}

unsafe fn select_range(hwnd_re: HWND, text: &str, hit: FindHit) {
    let cu_start = utf8_to_utf16_units(text, hit.start) as i32;
    let cu_end = utf8_to_utf16_units(text, hit.end) as i32;
    let cr = CHARRANGE { cpMin: cu_start, cpMax: cu_end };
    SendMessageW(hwnd_re, EM_EXSETSEL, Some(WPARAM(0)), Some(LPARAM(&cr as *const _ as isize)));
    // Scroll into view.
    SendMessageW(hwnd_re, EM_SCROLLCARET, Some(WPARAM(0)), Some(LPARAM(0)));
}
```

**Why `EM_EXSETSEL` not `EM_SETSEL`:** `EM_SETSEL` packs cpMin/cpMax into WPARAM/LPARAM as 16-bit ints — can't represent offsets >65535 chars. For a 1MB file that's a 65K-char ceiling; we can hit it. `EM_EXSETSEL` accepts a `CHARRANGE` struct with i32 fields. Use it always.

**Source:** Microsoft Learn `EM_EXSETSEL` (HIGH); RichEdit selection model verified.

### Pattern 8 — Tab-ID Stability Under Reorder

**What:** Tab indices in `Vec<Tab>` shift on close — index 3 becomes index 2 after closing index 2. The tab strip's `lParam` field on each `TCITEM` carries our stable `tab.id: u64`. When a `TCN_SELCHANGE` arrives with a tab index, look up the active tab by id (not index) for any user-visible ID display, but use the index for `app.active_tab` since `Vec` indexing is what we ultimately need.

```rust
unsafe fn lookup_tab_by_lparam(htabs: HWND, idx: i32) -> Option<u64> {
    let mut item: TCITEMW = std::mem::zeroed();
    item.mask = TCIF_PARAM;
    if SendMessageW(htabs, TCM_GETITEMW, Some(WPARAM(idx as usize)),
                    Some(LPARAM(&mut item as *mut _ as isize))).0 != 0 {
        Some(item.lParam.0 as u64)
    } else { None }
}
```

**Why bother:** Future v2 features (drag-rearrange tabs, session restore, tab-tearout to new window) all depend on stable IDs. Putting them in now is a 4-line change; retrofitting later forces an existence-of-id audit across the codebase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Regex engine | Hand-rolled NFA / backtracker | `regex` crate (allowlist) | 600KB of well-tested Pike-NFA. ReDoS-immune by design. (Pitfalls.md Pitfall 5.) |
| Tab strip rendering | Custom-painted tab bar | `SysTabControl32` + `TCS_OWNERDRAWFIXED` (paint just the asterisk + title) | Built-in: hit-testing, theme integration, scroll buttons when tabs overflow, keyboard navigation for arrow keys. Custom would need 500+ LOC for parity. (Stack.md decision.) |
| Reverse regex search | DIY backward NFA | `regex.find_iter(&text[..cursor]).last()` | The `regex` crate has no native reverse; this idiom is O(n) and fine for v1 buffer sizes. For >1MB use the worker thread. (Verified docs.rs/regex/1.12.3.) |
| Cross-thread cancellation | Custom `Arc<Mutex<Option<bool>>>` | `Arc<AtomicU64>` epoch counter + `Acquire/Release` ordering | Lock-free, no contention with the worker, race-condition free. (Architecture.md Pattern 5.) |
| Confirm-before-close button labels | Custom dialog with WM_INITDIALOG hook to relabel buttons | `MessageBoxW` with `MB_YESNOCANCEL` + explicit prompt mapping | Pragmatic v1; TaskDialog is the v1.x polish path. (Pitfalls.md Pitfall 13.) |
| UTF-8 ↔ UTF-16 offset conversion | Hand-rolled walker | `text[..byte_offset].encode_utf16().count()` | std-only, correct, ~1µs for 1MB — not the bottleneck. |
| Replace All as N undo steps | Per-match `EM_REPLACESEL(can_undo=TRUE)` loop | Single `EM_SETTEXTEX(ST_KEEPUNDO, full_new_text)` after `EM_STOPGROUPTYPING` | Notepad++ behavior; one Ctrl+Z reverts the entire replace-all. (Pitfalls.md Pitfall 6.) |
| Backward navigation in regex mode | Try to make it work somehow | Grey out the toggle in regex mode (Notepad++ does this) | Saves UI work; sets correct user expectation. |

**Key insight:** The `regex` crate is the centerpiece. Don't fight its forward-only nature — accept that "find prev in regex mode" is `find_iter().last()` and document the cost.

## Common Pitfalls

### Pitfall 1: Holding `&mut Tab` across `SendMessage`

**What goes wrong:** `dispatch.rs` does `let tab = &mut app.tabs[idx]; SendMessageW(tab.editor.hwnd_re, EM_SETSEL, ...)` — the `SendMessageW` synchronously re-enters WndProc, which re-acquires `&mut App`, which lets handler borrow `tabs[idx]` again — UB.

**How to avoid:** Same as Phase 1 reentrancy rule. Get any data you need (HWND, byte offsets, etc.) into local variables, drop the borrow, then call `SendMessage`. The Phase 1/2 pattern (re-borrow per branch, drop before WIN32 call) generalizes.

### Pitfall 2: Tab close orphaning the RichEdit child window

**What goes wrong:** `app.tabs.remove(idx)` drops the `Tab`, dropping `EditorState`, but `EditorState.hwnd_re` is just a `HWND` (a copy of an OS handle); `Drop` for `EditorState` never calls `DestroyWindow`. The RichEdit child remains alive but unreachable, leaking GDI handles, until the parent window dies.

**How to avoid:** `Tab` (or `EditorState`) needs a `Drop` impl that calls `DestroyWindow(hwnd_re)`. Or — preferred — `App::close_tab(idx)` is the only exit point and explicitly destroys the HWND before `tabs.remove(idx)`. Same discipline as Phase 1's `WM_NCDESTROY` reclaiming `Box<App>`.

### Pitfall 3: Wrap-around infinite loop on empty regex (`.*` or `^$`)

**What goes wrong:** `regex::Regex::new(".*")` matches the empty string at every position. `find_iter` yields infinite zero-width matches; Replace All never terminates.

**How to avoid:** Reject patterns that match the empty string at compile time: after compile, check `regex.is_match("")` — if yes, refuse with "Pattern matches empty string; refusing to avoid infinite loop." (Notepad++ has this protection.) Cover with a unit test.

### Pitfall 4: Find Prev with cursor at offset 0

**What goes wrong:** `text[..0]` is empty string; no match; if `wrap` is enabled we restart from the end, but the "strictly before cursor=0" condition lets the same match return immediately, infinite loop.

**How to avoid:** When `cursor == 0` and backward, treat as "wrap immediately" — search the whole text, return last match. Cover with `find_engine.rs::backward_at_offset_0_wraps`.

### Pitfall 5: Worker holds `Arc<Mutex<EditorState>>`

**What goes wrong:** Tempting to share buffer state with the worker. Worker holds the mutex for the entire find duration; UI thread blocks on next edit. Defeats the entire point.

**How to avoid:** Snapshot the buffer (`String::clone()`, ~1ms for 1MB) before the spawn. Worker owns its snapshot. UI is unblocked. Project Anti-Pattern 8 — restate in the plan.

### Pitfall 6: `EM_SETSEL` ignored when RichEdit has no focus

**What goes wrong:** After Find Next, we set selection on the RichEdit but the user is still focused in the find dialog. The selection appears as a "highlighted" range (no caret blink); user thinks Find didn't work.

**How to avoid:** After `EM_EXSETSEL`, do NOT `SetFocus(richedit)` — leave focus in the find dialog so the user can press Find Next again. RichEdit inherits the `ES_NOHIDESEL` style (already set in Phase 1 — verified in src/editor.rs line 47) which shows selection even when unfocused. ✓ Already correct; just document it.

### Pitfall 7: Find dialog accelerator interception

**What goes wrong:** Modeless find dialog has Tab/Esc/Enter as native dialog navigation keys (`WM_GETDLGCODE` returns `DLGC_WANTALLKEYS` for input controls). When user presses F3 with focus in the dialog, the dialog's WndProc swallows it before our accelerator table sees it.

**How to avoid:** In the message loop, conditionally call `IsDialogMessageW(hfind_dlg, &mut msg)` BEFORE `TranslateAcceleratorW` only for *Tab/Esc* class messages — but for accelerator keys (F3, Ctrl+F, etc.) call `TranslateAcceleratorW` first. The standard idiom:

```rust
while GetMessageW(&mut msg, None, 0, 0).as_bool() {
    if TranslateAcceleratorW(hwnd, haccel, &msg) != 0 {
        continue;
    }
    if let Some(hdlg) = app.find_dlg_hwnd {
        if IsDialogMessageW(hdlg, &mut msg).as_bool() {
            continue;
        }
    }
    let _ = TranslateMessage(&msg);
    DispatchMessageW(&msg);
}
```

Verify: F3 in the find dialog input → finds next. Document in plan.

### Pitfall 8: Tab-strip resize doesn't propagate to RichEdit children

**What goes wrong:** `WM_SIZE` on the parent currently calls `MoveWindow` on `app.editor.as_ref()` (Phase 1's single-tab shape). When we have N tabs, only the active gets resized; on tab switch, the new tab's RichEdit has stale dimensions and renders at the wrong size briefly.

**How to avoid:** `WM_SIZE` iterates ALL tabs and calls `MoveWindow` on each `tab.editor.hwnd_re`, with the same client-area-minus-tabstrip rectangle. ~3 lines extra in the WM_SIZE handler. Cover by sizing test or manual QA.

### Pitfall 9: Async find result arrives after tab switch

**What goes wrong:** User runs find on tab A, switches to tab B, find result arrives. Naive code applies the FindHit to `app.tabs[active_tab]` (which is now B) — wrong tab gets the selection.

**How to avoid:** The `find_epoch` is incremented on *any* user action that should invalidate find: tab switch, edit, new query. Tab switch handler calls `app.find_epoch.fetch_add(1, Release)`. Stale results discarded automatically.

### Pitfall 10: Replace All on a buffer with mixed line endings

**What goes wrong:** RichEdit's internal CR-only paragraph markers mean `regex.find_iter(&em_streamout_text)` matches against `\r` not `\n` or `\r\n`. User regex `\n` doesn't match anything; user regex `\r\n` doesn't match anything; user regex `\r` matches every line break (surprising).

**How to avoid:** Phase 2 already establishes that the canonical in-memory form for save is LF-only (`normalize_to_lf` in src/eol.rs). For find/replace, run match against the **LF-normalized** text, not the RichEdit-CR text. After replace, denormalize back to the tab's stored EOL via `denormalize_to_eol` (already shipped) before pushing into RichEdit. **This is the central correctness invariant for FIND-08 — flag it prominently in the plan, cover with `tests/find_engine.rs::replace_all_preserves_eol`.**

### Pitfall 11: Tabs grow beyond visible width

**What goes wrong:** User opens 30 files; tab strip can't show them all. `SysTabControl32` shows up/down scroll arrows on overflow — works, but might surprise users who expect VS-Code-style horizontal scroll.

**How to avoid:** Default `SysTabControl32` overflow behavior is fine for v1. Document. v1.x can switch to custom-painted scrolling tabs.

## Code Examples

### Example 1: Per-Tab Data Shape Migration

```rust
// src/tab.rs — NEW module
use crate::editor::EditorState;

pub struct Tab {
    pub editor: EditorState,
    pub title: String,
    pub id: u64,
    pub dirty: bool,
}

impl Tab {
    pub fn new_empty(id: u64, parent: windows::Win32::Foundation::HWND) -> crate::error::Result<Self> {
        let editor = unsafe { EditorState::create(parent)? };
        unsafe {
            // Hide initially — Pattern 1 visibility-toggle on switch.
            use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
            let _ = ShowWindow(editor.hwnd_re, SW_HIDE);
        }
        Ok(Self { editor, title: "Untitled".to_owned(), id, dirty: false })
    }
}

impl Drop for Tab {
    fn drop(&mut self) {
        // Pitfall 2: explicit destroy on close.
        unsafe {
            use windows::Win32::UI::WindowsAndMessaging::DestroyWindow;
            let _ = DestroyWindow(self.editor.hwnd_re);
        }
    }
}

// Pure-logic close decision (testable in tests/tab_model.rs)
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseDecision {
    CanClose,                       // not dirty
    PromptUser,                     // dirty: ask Save/Discard/Cancel
}

pub fn tab_close_decision(dirty: bool) -> CloseDecision {
    if dirty { CloseDecision::PromptUser } else { CloseDecision::CanClose }
}
```

### Example 2: Tab Switch Handler

```rust
// src/dispatch.rs — WM_NOTIFY branch
use windows::Win32::UI::Controls::{NMHDR, TCN_SELCHANGE, TCN_SELCHANGING};

WM_NOTIFY => {
    let nm = &*(lparam.0 as *const NMHDR);
    if nm.hwndFrom == app.htabs && nm.code == TCN_SELCHANGE {
        let new_idx = SendMessageW(app.htabs, TCM_GETCURSEL,
                                    Some(WPARAM(0)), Some(LPARAM(0))).0 as usize;
        if new_idx < app.tabs.len() && new_idx != app.active_tab {
            // Hide outgoing.
            let _ = ShowWindow(app.tabs[app.active_tab].editor.hwnd_re, SW_HIDE);
            // Show incoming.
            let _ = ShowWindow(app.tabs[new_idx].editor.hwnd_re, SW_SHOW);
            // Pitfall 11: focus the new RichEdit so input goes there.
            let _ = SetFocus(Some(app.tabs[new_idx].editor.hwnd_re));
            app.active_tab = new_idx;
            // Discard any in-flight find results — they're for the old tab.
            app.find_epoch.fetch_add(1, std::sync::atomic::Ordering::Release);
            // Window title reflects new tab.
            update_title(hwnd, &app.tabs[new_idx]);
        }
    }
    LRESULT(0)
}
```

### Example 3: Find Engine Integration

```rust
// src/dispatch.rs — IDM_FIND_NEXT branch (synchronous path for <1MB buffers)
unsafe fn do_find_next(app: &mut App, hwnd: HWND) {
    let pattern = app.find.pattern.clone();
    let flags = app.find.flags;
    if pattern.is_empty() { return; }

    let regex = match crate::find::compile(&pattern, flags) {
        Ok(r) => r,
        Err(e) => {
            show_status(hwnd, &format!("Bad pattern: {:?}", e));
            return;
        }
    };

    let tab = match app.tabs.get_mut(app.active_tab) {
        Some(t) => t,
        None => return,
    };

    // Stream out the buffer and normalize to LF (Pitfall 10).
    let cr_text_bytes = match tab.editor.save_text() {
        Ok(b) => b,
        Err(_) => return,
    };
    let cr_text = match std::str::from_utf8(&cr_text_bytes) { Ok(s) => s, Err(_) => return };
    let lf_text = crate::eol::normalize_to_lf(cr_text);

    // Worker thread or sync path?
    if lf_text.len() > 1_000_000 {
        // Worker path: spawn, return; result arrives via WM_APP_FIND_RESULT.
        let epoch = app.find_epoch.fetch_add(1, Ordering::Release) + 1;
        crate::find_worker::spawn_find(lf_text, regex, /*cursor*/ 0, flags, epoch,
                                        app.find_epoch_arc.clone(), hwnd, app.find_tx.clone());
        return;
    }

    // Sync path: <1MB.
    let cursor_utf16 = SendMessageW(tab.editor.hwnd_re, EM_GETSEL,
                                     Some(WPARAM(0)), Some(LPARAM(0))).0 as usize;
    // (utf16 → utf8 conversion elided for brevity; helper in find.rs)
    let cursor_utf8 = utf16_to_utf8_offset(&lf_text, cursor_utf16);

    match crate::find::find_next(&lf_text, &regex, cursor_utf8, flags) {
        Some(hit) => {
            select_range(tab.editor.hwnd_re, &lf_text, hit);
            if hit.wrapped { show_status(hwnd, "Wrapped to top"); }
        }
        None => show_status(hwnd, "Pattern not found"),
    }
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hand-rolled tab control with full custom paint | `SysTabControl32` with owner-draw for the asterisk | Project decision in stack.md | -500 LOC; better keyboard nav for free; tradeoff is no per-tab close button (out of scope) |
| `find_text` / `replace_text` Win32 common dialogs | Custom modeless find bar | Long-since deprecated UX | Better keyboard handling, no dialog modality |
| `EM_FINDTEXTEXW` (RichEdit's built-in find) | `regex` crate over `EM_STREAMOUT` text | When SC-3.6 demanded regex | Uniform code path across literal/whole-word/regex; no special-casing |
| Backtracking regex engine (Boost, PCRE) | Pike-NFA (`regex` crate) | Designed-in for v1 | ReDoS-immune; trade-off is no lookbehind/atomic groups (acceptable per features.md) |
| Polling for cancellation | `AtomicU64` epoch + `Acquire/Release` | Idiomatic Rust pattern | Lock-free, race-condition-proof |

**Deprecated/outdated:**
- `EM_FINDTEXT` (ANSI-only). Use `EM_FINDTEXTEXW` if we ever need RichEdit's built-in find (we don't — `regex` covers everything).
- `RegisterClipboardFormatA`. Anything Phase 3 touches uses Unicode (`*W`) variants per Phase 1/2 discipline.
- `IsDialogMessage` (the ANSI variant). Use `IsDialogMessageW`.

## Open Questions

1. **Replace All on selection (in-selection toggle)?**
   - **What we know:** Notepad++ has it. features.md SC-3 calls it a v1 minimum but it's NOT in the 18 phase requirements.
   - **What's unclear:** Is "in selection only" worth the ~2 hours of plumbing for v1?
   - **Recommendation:** Ship if cheap (~1-2h). The find_engine API takes `(start, end)` already; restricting to selection is a pre-pass slice on the LF-normalized text. Add a checkbox to the dialog UI. If timing is tight, defer — not in 18 reqs, not blocking ship.

2. **TaskDialog vs MessageBox for confirm-before-close?**
   - **What we know:** TaskDialog allows custom button labels ("Save"/"Don't Save"/"Cancel"). MessageBox forces Yes/No/Cancel.
   - **What's unclear:** Which is more aligned with Notepad++ baseline UX?
   - **Recommendation:** MessageBox for v1 (per Pattern 6 above). Document button mapping in the prompt body. v1.x polish swap to TaskDialog.

3. **Should the worker thread also be used for Replace All on >1MB?**
   - **What we know:** SC-3.5 specifies "Regex find on a >1MB buffer runs on a worker thread" — Replace All is a related but distinct operation that allocates a fresh String of similar size.
   - **What's unclear:** Replace All is bounded-time per the regex crate's linear guarantees, so synchronously running it on a 1.5MB buffer might be ~50ms — acceptable but noticeable.
   - **Recommendation:** Phase 3 ships Replace All synchronously regardless of size. Worker-thread Replace All is a v1.x optimization. Cover the SC-3.5 contract explicitly with FIND (the Find Next path), since that's what the SC literally specifies.

4. **Word-wrap (SC-8) per-tab state — fold into TAB-07 now or defer to Phase 5?**
   - **What we know:** SC-2.1 / TAB-07 says "each tab keeps its own ... word-wrap setting." Phase 5 ships word-wrap toggle.
   - **What's unclear:** Should `Tab` have a `word_wrap: bool` field now (unused) so Phase 5 doesn't retrofit?
   - **Recommendation:** Add the field as `pub word_wrap: bool` (default `false` per SC-8 "off by default"). Cost: 1 field. Saves a Phase 5 retrofit.

## Plan Breakdown — Recommended 5 Plans, 3 Waves

### Wave 1 — Per-Tab Data Shape (Sequential)

**Plan 03-01: Per-Tab Data Shape (TAB-07 foundation)**
- Create `src/tab.rs` with `Tab` struct, `Drop` impl that destroys HWND, pure-logic `tab_close_decision`.
- Refactor `src/app.rs`: `editor: Option<EditorState>` → `tabs: Vec<Tab>` + `active_tab: usize` + `next_tab_id: u64`.
- Update WM_CREATE in `dispatch.rs` to push the initial tab.
- Update WM_SIZE to iterate all tabs.
- Update WM_NCDESTROY to drop tabs (their `Drop` destroys HWNDs).
- Update `do_file_open`/`do_file_save`/`do_file_save_as`/encoding+EOL menu handlers to use `app.tabs[app.active_tab].editor` instead of `app.editor.as_ref/as_mut`.
- Add `IDM_TAB_NEW=120, IDM_TAB_CLOSE=121, IDM_TAB_NEXT=122, IDM_TAB_PREV=123` constants.
- **No UI yet** — single tab, behavior unchanged from user perspective.
- Tests: `tests/tab_model.rs` (~6 unit tests on `tab_close_decision`, `Tab` lifecycle, dirty flag propagation).
- **Why first, sequential:** every other Phase 3 plan depends on `Vec<Tab>` shape. Splitting this would force every later plan to update both shapes simultaneously.

### Wave 2 — Three Parallel Plans

**Plan 03-02: Tab UI (TAB-01..06, TEST-04 partial)**
- Create `SysTabControl32` child window in WM_CREATE; size/position in WM_SIZE.
- Owner-draw paint (`WM_DRAWITEM`) for asterisk + title.
- `TCN_SELCHANGE` handler: hide/show RichEdits, `SetFocus`, `update_title`, increment find_epoch.
- `IDM_TAB_NEW` (Ctrl+T): create empty tab, push to `app.tabs`, `TCM_INSERTITEM`, `TCM_SETCURSEL`.
- `IDM_TAB_CLOSE` (Ctrl+W): if dirty, `prompt_close_dirty` → MessageBoxW; on confirm, `TCM_DELETEITEM` + `tabs.remove(idx)`.
- `IDM_TAB_NEXT` / `IDM_TAB_PREV` (Ctrl+Tab / Ctrl+Shift+Tab): `(active_tab + 1) % len()` / `(active_tab + len() - 1) % len()`, then `TCM_SETCURSEL`.
- Wire `EN_CHANGE` → set `tab.dirty = true` + invalidate tab.
- Wire save success → set `tab.dirty = false` + invalidate tab.
- Add `TAB-NEW`/`TAB-CLOSE`/menu entries in `src/menu.rs`.
- Update `build_accelerator_table()` in `src/app.rs`.
- Tests: extend `tests/tab_model.rs` with the close-decision matrix; manual smoke for the UI surface.

**Plan 03-03: Find/Replace Engine (FIND-04..09, TEST-04 main)**
- Create `src/find.rs` with `FindFlags`, `compile`, `find_next` (forward + backward + wrap), `replace_all`.
- `src/find_ui.rs`: minimal dialog skeleton (single function `open_find_dialog(parent, mode: FindMode)`); just lays out controls; no behavior yet.
- Add `FindState` to `App`.
- Add `IDM_FIND_OPEN, IDM_FIND_REPLACE_OPEN, IDM_FIND_NEXT, IDM_FIND_PREV` constants.
- Wire IDMs in `dispatch.rs::handle_message`.
- **Pitfall 10 implementation:** `do_find_next` always normalizes via `eol::normalize_to_lf` before regex.
- **Pitfall 3:** reject empty-match regexes at compile time.
- Tests: `tests/find_engine.rs` (12-16 tests covering literal/regex × case-sens × whole-word × forward/backward/wrap, including empty-pattern rejection, multi-byte UTF-8 fixture for offset conversion).
- Tests: `tests/replace_engine.rs` (5-8 tests on Replace All, capture-group expansion, empty-match rejection).

**Plan 03-04: Find/Replace UI (FIND-01, FIND-02, FIND-07, FIND-08)**
- Build the modeless find dialog: pattern input + replace input + 4 toggles (case-sensitive, whole-word, regex, wrap) + 5 buttons (Find Next, Find Prev, Replace, Replace All, Close) + status line.
- Use `CreateWindowExW` on a registered dialog class (NOT a `.rc` file resource — keeps the no-resource-files constraint).
- Wire dialog WM_COMMAND back to `dispatch.rs` via custom message OR direct calls (since the dialog's parent is the main window).
- `IsDialogMessageW` integration in `main.rs` message loop.
- Selection logic: `EM_EXSETSEL`, UTF-8 → UTF-16 offset conversion, `EM_SCROLLCARET`.
- Replace All: `EM_STOPGROUPTYPING` boundaries, `EM_SETTEXTEX` once.
- Status line writes ("Wrapped to top", "Pattern not found", "X replaced").
- Tests: integration tests deferred to manual QA + Plan 05 wave (the dialog UI is hard to unit-test without a window; the engine tests in 03-03 cover correctness).

### Wave 3 — Worker Thread & Final Tests (Sequential after Wave 2)

**Plan 03-05: Worker Thread + Cancellation (FIND-10) + Phase 3 Test Closure**
- Create `src/find_worker.rs` with `spawn_find(snapshot, regex, cursor, flags, epoch, ...)`.
- `App.find_epoch: AtomicU64`, `App.find_tx/find_rx: mpsc` channels.
- WM_APP_FIND_RESULT handler in `dispatch.rs`: drain `find_rx`, apply if epoch is current.
- Tab switch handler increments `find_epoch` (Pitfall 9).
- Plan 03-03's `do_find_next` adds the `>1MB → spawn_find` branch.
- Tests: `tests/find_worker.rs` (4-6 tests on epoch-discard semantics; mpsc-only, no Win32).
- Tests: `tests/find_replace_integration.rs` (1-3 tests covering "edit, find, switch tab, find result discarded").
- Update `02-research.md` precedent: `read_with_timeout` already proves the pattern; `find_worker.rs` mirrors its shape.
- **Why sequential after Wave 2:** the worker depends on `find::compile` and `App.tabs[].editor` shape from earlier plans.

### Why this 5-plan split (vs 3 or 6)?

- **3 plans** would lump tab UI + find UI + worker into one mega-plan; too much cross-cutting for a single review pass.
- **6 plans** would split find_engine into `compile`/`find_next`/`replace_all` separately; gratuitous when the three are <300 LOC together with shared types.
- **5 plans align with the "spine first, then UI in parallel, then performance" wave structure** that worked for Phase 1 (4 plans) and Phase 2 (4 plans). Wave 1 = 1 plan blocking; Wave 2 = 3 parallel; Wave 3 = 1 plan tying it together.

## Validation Architecture

Skipped — `workflow.nyquist_validation` is not set in `.planning/config.json` (verified). Phase-level validation continues to use Phase 1/2's pattern: pure-logic modules in `cargo test --lib`, integration tests in `tests/`, manual QA for UI-level behaviors.

## Sources

### Primary (HIGH confidence)
- [docs.rs/regex/1.12.3 — Regex API](https://docs.rs/regex/1.12.3/regex/struct.Regex.html) — verified `find_iter`/`find` returns forward-only matches; no native reverse search.
- [docs.rs/regex/1.12.3/regex/struct.RegexBuilder.html](https://docs.rs/regex/1.12.3/regex/struct.RegexBuilder.html) — `case_insensitive(bool)`, `size_limit(usize)` API surface verified.
- [Microsoft Learn: About Tab Controls](https://learn.microsoft.com/en-us/windows/win32/controls/tab-controls) — `TCN_SELCHANGE`/`TCN_SELCHANGING` semantics, `TCS_OWNERDRAWFIXED` + `WM_DRAWITEM` pattern, `TCM_INSERTITEM`/`TCM_DELETEITEM`/`TCM_GETCURSEL`/`TCM_SETCURSEL` verified. WM_KEYDOWN handler "Processes direction keys" — Ctrl+Tab is NOT a direction key, accelerator required (HIGH).
- [Microsoft Learn: About Rich Edit Controls](https://learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls) — `EM_EXSETSEL`, `EM_SETTEXTEX`, `EM_REPLACESEL`, `EM_STOPGROUPTYPING`, `EM_SCROLLCARET` semantics. ES_NOHIDESEL behavior verified (already set in Phase 1).
- [Microsoft Learn: PostMessage](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-postmessagew) — async cross-thread message posting; WM_USER/WM_APP ranges.
- `.planning/research/architecture.md` Pattern 4 (per-tab Vec<EditorState>), Pattern 5 (worker + PostMessage), Pattern 7 (dirty-rect repaint).
- `.planning/research/pitfalls.md` Pitfall 5 (regex workflow), Pitfall 6 (undo correctness), Pitfall 11 (tab focus / IME), Pitfall 13 (Notepad++ UX expectations).
- `.planning/research/stack.md` — `regex` 1.12.3, `SysTabControl32` owner-draw decision (verified).
- `.planning/research/features.md` — Find/Replace UI surface (Notepad++ parity table), undo granularity, behavior decisions.
- `.planning/phases/02-file-i-o-encoding-cascade/02-research.md` Pattern A (Original-Bytes Cache), Pattern E (worker thread + recv_timeout precedent).
- Existing project source: `src/app.rs`, `src/editor.rs`, `src/dispatch.rs`, `src/file.rs`, `src/eol.rs`, `src/encoding.rs` — all read; data shapes captured in this research.

### Secondary (MEDIUM confidence)
- WebSearch — "Win32 SysTabControl32 Ctrl+Tab keyboard accelerator" — confirms parent-window-must-handle finding via accelerator (no native handling).
- WebFetch on `regex::bytes::Regex` — confirms it's an alternative for `&[u8]` matching but not preferred for our `&str`-on-UTF-8 case.

### Tertiary (LOW confidence — flag for plan-time validation)
- "Replace All as one undo step via EM_STOPGROUPTYPING + EM_SETTEXTEX" — this is the recommended pattern but should be QA-verified. If RichEdit creates multiple undo entries despite the boundary, fall back to wrapping the loop in a manual `EM_SETUNDOLIMIT(0) → loop → EM_SETUNDOLIMIT(1000) → push synthetic single undo entry` workaround. Plan 03-03 should include a smoke test in QA.

## Infrastructure Dependencies

None — Phase 3 is pure-Rust + Win32, all tests are unit/integration tests in `cargo test`. No Docker, no external services. Same as Phase 1/2.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `regex` 1.12.3 verified at docs.rs; `SysTabControl32` and RichEdit Win32 messages verified at Microsoft Learn; existing Phase 1/2 source confirms data shapes.
- Architecture: HIGH on per-tab-RichEdit-child decision (Pitfall 11 mitigation is decisive); HIGH on worker-thread + epoch pattern (proven in Phase 2 `read_with_timeout`); HIGH on Find/Replace engine pure-logic boundary (mirrors Phase 2 `encoding.rs` / `eol.rs`).
- Pitfalls: HIGH on the 11 documented; one LOW-confidence assumption flagged (Replace-All-as-one-undo-step Verify in QA).
- Tests: HIGH — pure-logic engine modules unit-test trivially; worker pattern is mpsc + AtomicU64 (no Win32, fully testable).

**Research date:** 2026-05-03
**Valid until:** 2026-06-03 (30 days; `regex` and Win32 APIs are stable)

## RESEARCH COMPLETE
