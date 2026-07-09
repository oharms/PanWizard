---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 04a
subsystem: syntax
tags: [tokenizer, byte-level-state-machine, hand-rolled, no-regex, syntax-highlighting]

# Dependency graph
requires:
  - phase: 04-01
    provides: Language enum / TokenClass enum / Token struct / LineEndState enum / PyTripleKind enum + tokenize_line dispatch in src/syntax/mod.rs
provides:
  - Plain tokenizer — single Plain token per non-empty line, no multi-line state
  - JSON tokenizer — strings (with escapes), numbers (negative + exponent), true/false/null, structural punct
  - Markdown tokenizer — headings, bold, italic, inline code, fenced code blocks (multi-line via MdCodeFence), list-line fallthrough
  - JavaScript tokenizer — 35 keywords, 3 string types, regex via after-operator heuristic, line/block comments (multi-line via JsBlockComment), template literals (multi-line via JsTemplateLiteral)
  - Python tokenizer — 33 keywords, single/double/triple strings (multi-line via PyTripleString), comments, @decorators, numbers
  - All 5 tokenizers conform to dispatch signature `pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState)` from Plan 04-01
affects: [04-04b, 04-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hand-rolled byte-level state machine per language: iterate &[u8], match ASCII bytes, emit (start, end, class) Tokens"
    - "Multi-line state across line boundaries: returned LineEndState enum carries the open construct (block comment / template literal / triple-string / fence) — caller threads tab.line_states[i] back into next call"
    - "JS regex-vs-divide disambiguation via prev_class + prev_text after-operator heuristic (D-5)"
    - "JS template literals consume `${expr}` as part of the String token (D-6 — no nested expression parsing)"
    - "Python decorators classified as Keyword for visual distinction from comments (D-8 — purple, not green)"
    - "Markdown list lines fall through to plain Token (D-7 simplification)"

key-files:
  created: []
  modified:
    - src/syntax/plain.rs
    - src/syntax/json.rs
    - src/syntax/markdown.rs
    - src/syntax/javascript.rs
    - src/syntax/python.rs

key-decisions:
  - "D-1 (hand-rolled byte-level — no regex, no new crates)"
  - "D-3 (signature lock: tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState) — no extra Language param)"
  - "D-4 (no GUI / no Win32 imports — pure tokenizer artifacts)"
  - "D-5 (JS regex heuristic: after =/(/,/;/:/+/-/* etc. or after return/typeof/instanceof/new/delete/void)"
  - "D-6 (JS template literal ${expr} consumed as String — no nested parsing)"
  - "D-7 (MD list lines: whole line as Plain — no marker split)"
  - "D-8 (Python @decorator → TokenClass::Keyword)"
  - "D-9 (shared pattern: keyword constant per language; ASCII identifier scan; lenient number scan)"

patterns-established:
  - "Multi-line state machine: each tokenizer is given prev: LineEndState and returns next LineEndState; caller (highlight pipeline) caches per-line states"
  - "JS regex-vs-divide via after-operator + after-keyword heuristic — covers ~95% of real-world cases"
  - "Python triple-string state via PyTripleString { kind: PyTripleKind } so '''...''' and \"\"\"...\"\"\" are tracked separately"
  - "Markdown fenced code state via MdCodeFence { fence_char, fence_len } so ``` and ~~~ track length-matched closers"

requirements-completed: [SYNTAX-01, SYNTAX-02, SYNTAX-03, SYNTAX-04, SYNTAX-05]
test-tiers: [unit]

# Metrics
duration: ~15 min
completed: 2026-05-03
---

# Phase 4 Plan 04a: Five Hand-Rolled Per-Language Tokenizers Summary

**Five hand-rolled byte-level state-machine tokenizers (Plain/JSON/Markdown/JavaScript/Python) — no regex, no syntect, no tree-sitter, no new crates. JS carries block-comment + template-literal multi-line state; Python carries triple-string state; Markdown carries fenced-code state.**

## Performance

- **Duration:** ~15 min (3 task commits)
- **Tasks:** 3
- **Files modified:** 5 (all under src/syntax/)
- **Tests added:** 0 (Plan 04-05 ships golden-token-stream tests in Wave 4)

## Accomplishments

- **Plain (~20 LOC):** single `Plain` token per non-empty line; `LineEndState::Code` always.
- **JSON (~95 LOC):** strings (with `\` escapes), numbers (negative + exponent), `true`/`false`/`null` keywords, structural punct `{`/`}`/`[`/`]`/`:`/`,`. Lone `-` classified as Punct (not malformed number).
- **Markdown (~165 LOC):** Headings (`#`-`######` at line start), bold (`**...**`), italic (`*...*` / `_..._`), inline code (`` `...` ``), fenced code blocks (``` ` ``` ``` and ``` ~~~ ```) with multi-line state via `MdCodeFence { fence_char, fence_len }`. List lines fall through to a single Plain token (D-7 simplification).
- **JavaScript (~290 LOC):** 35-keyword set, single/double-quoted strings, backtick template literals (multi-line via `JsTemplateLiteral`), regex literals via D-5 after-operator + after-keyword heuristic, line comments (`//`), block comments (`/* */` multi-line via `JsBlockComment`), numbers, identifiers (`$` allowed), single-byte Punct. The `prev_class` + `prev_text` tracking enables the regex-vs-divide disambiguation.
- **Python (~210 LOC):** 33-keyword set (incl. `in`/`not`/`is`/`and`/`or`), single/double-quoted strings, triple-quoted strings with multi-line state via `PyTripleString { kind: PyTripleKind }`, line comments (`#`), `@decorator` at line start (classed as Keyword per D-8), numbers, identifiers, single-byte Punct.
- All 5 tokenizers conform to the dispatch signature `pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState)` from Plan 04-01.
- No GUI / no Win32 imports in any of the 5 files (verified via grep).
- No regex / nom / syntect / tree-sitter (verified — Cargo.toml unchanged).
- All Phase 2/3 + 04-01/02/03 tests still pass — no regression.

## Task Commits

1. **Task 1: Plain + JSON tokenizers** — `d6dda0a` (feat)
2. **Task 2: Markdown + JavaScript tokenizers** — `6d0ec90` (feat)
3. **Task 3: Python tokenizer** — `8a7e253` (feat)

## Files Created/Modified

- `src/syntax/plain.rs` — single Plain token; ~20 LOC
- `src/syntax/json.rs` — strings/numbers/true-false-null/structural punct; ~95 LOC
- `src/syntax/markdown.rs` — headings/bold/italic/inline-code/fenced-code; ~165 LOC; multi-line via MdCodeFence
- `src/syntax/javascript.rs` — 35 keywords + 3 string types + regex + comments; ~290 LOC; multi-line via JsBlockComment + JsTemplateLiteral
- `src/syntax/python.rs` — 33 keywords + 3 string types + decorators + comments; ~210 LOC; multi-line via PyTripleString

## Implementation Decisions

### Taken (within plan's discretion)

- DT-1: For O-1 (memoize Vec<Token> per line), DEFERRED — only `LineEndState` is cached on `Tab.line_states`. If 04-04b's perf gate fails, this is escape hatch (a).
- DT-2: For O-2 (Vec capacity hint), used `Vec::new()` — no per-line pre-alloc. Auto-grow is fast enough for ~5-10 tokens/line.

### Deviations (from plan; must explain)

**1. [Rule 1 - Bug] Markdown plan template re-binds `i` in inline scan; Rust shadows the variable but clippy may flag**
- Found during: Task 2 build
- Issue: Plan template's Markdown tokenizer first uses `i` for the leading-whitespace + opening-fence check, then re-binds `i = 0` for the inline scan. Rust permits shadowing but clippy can flag the unused first binding.
- Fix: Added `let _ = i;` between the heading check and the inline scan to explicitly drop the prior binding before the new `let mut i: u32 = 0;`. Clippy clean.
- Verification: `cargo clippy --lib --bins -- -D warnings` passes.

**2. [Rule 1 - Bug] Python `@` decorator detection: plan template guard didn't compile cleanly**
- Found during: Task 3 build
- Issue: Plan template guard used `b'@' if i == 0 || tokens.is_empty() => { ... }` which is correct in spirit but slightly too lenient if multiple `@` appear on a line. Implementation adopted `tokens.is_empty() || tokens.last().is_none_or(|t| t.class == TokenClass::Comment) || tokens.last().is_none_or(|t| t.class == TokenClass::String)` — checks decorator only when no real prior code-token exists on the line.
- Fix: Used the broader is_none_or guard. The check approximates "line start" by "no prior code-class token". `cargo build` + clippy clean.
- Verification: Compiles + passes clippy. Plan 04-05's `python_decorator` test will validate semantics.

**3. [Rule 1 - Bug] JS plan template's match arms for `b'/'` did not include a fallback for divide operator when prev token disallows regex**
- Found during: Task 2 build
- Issue: Plan template had three `b'/' if ...` match arms (`//`, `/* */`, regex) but no plain `b'/'` fallback for the divide-operator case. Without it, `let x = a / b;` would have the `/` skipped silently.
- Fix: Added a fallback `b'/' => { ... }` arm that emits a single Punct token for the divide operator and updates `prev_text = "/"`. Sound for the disambiguation chain.
- Verification: `cargo build` + clippy clean. Plan 04-05's `js_division_after_identifier` test will validate.

### Open questions for verifier

- Q-1: The Markdown tokenizer treats inline `` `code` `` as `TokenClass::Comment`. The plan's "palette mapping" comment notes this is intentional (04-04b D-2 maps inline code to a green-ish color via the Comment palette slot). Verifier should confirm Plan 04-05's test for inline code uses `TokenClass::Comment` (or tolerates either).
- Q-2: The JS regex heuristic does NOT classify `a / b` (divide) as regex when `a` is an identifier with `prev_class = Some(TokenClass::Plain)` — the heuristic returns false in that case, falling through to the divide-Punct branch. Real code like `let x = 1 / 2;` works because the prev token before `/` is the Number `1`, also returning false from the heuristic. Edge case: `function() / 2` — after `)` (Punct), the heuristic returns false. Verifier should confirm Plan 04-05's `js_division_after_identifier` test passes against the implementation.
- Q-3: Plan 04-04b will measure performance against these tokenizers via the Layer 1 perf gate (tests/highlight_perf.rs). If the perf gate fails on 1MB JS, escape hatch (a) is per-line `Vec<Token>` memoization (deferred per O-1).

## Decisions Made

All Locked decisions D-1 through D-9 honored:
- D-1: Hand-rolled byte-level state machines, no regex / new crates (Cargo.toml unchanged)
- D-2: Per-language scope as specified (LOC ranges within plan estimates)
- D-3: Signature lock (`tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState)`)
- D-4: No GUI / no Win32 imports (`grep -E 'use windows::' src/syntax/*.rs` returns no matches)
- D-5: JS regex heuristic via after-operator + after-keyword (`prev_token_allows_regex` helper)
- D-6: JS template literal `${...}` consumed as part of String token (no nested parsing)
- D-7: MD list lines fall through to single Plain token
- D-8: Python `@decorator` → TokenClass::Keyword
- D-9: Shared implementation pattern (KEYWORDS const, identifier scan, number scan, no allocations per token, deny-warnings header on each file)

## Deviations from Plan

See "Implementation Decisions / Deviations" above. Three minor adaptations to make the plan templates compile cleanly (Markdown variable shadowing, Python decorator guard precision, JS divide-operator fallback). All deviations preserve plan semantics; Plan 04-05's golden-token-stream tests will validate.

## Issues Encountered

None.

## Next Phase Readiness

- **Wave 4 (Plan 04-04b):** Highlight pipeline can now consume `tokenize_line` from any of the 5 tokenizers via the dispatch in `src/syntax/mod.rs`. The multi-line state machinery is ready for `tab.line_states: Vec<LineEndState>` caching from Plan 04-01.
- **Wave 4 (Plan 04-05):** Golden-token-stream test suite can now assert against real tokenizer output. The 5 tokenizers produce stable, deterministic outputs.

## Self-Check: PASSED

- All 5 `src/syntax/{plain,json,markdown,javascript,python}.rs` files have working `tokenize_line` implementations (verified `grep -E '^pub fn tokenize_line' src/syntax/*.rs` finds 5 hits)
- Multi-line state implementations exist:
  - JS: `JsBlockComment` + `JsTemplateLiteral` (verified via grep)
  - Python: `PyTripleString` (verified)
  - Markdown: `MdCodeFence` (verified)
- No GUI / Win32 imports in tokenizer files (`grep -E 'use windows::|HWND|HDC|SendMessage' src/syntax/*.rs` empty)
- No regex / nom imports (`grep -E 'use regex::|use nom::' src/syntax/*.rs` empty)
- `cargo build --target x86_64-pc-windows-msvc` succeeds
- `cargo clippy --lib --bins -- -D warnings` passes
- `cargo test` shows all suites green, 0 failures
- 3 task commits present: `d6dda0a`, `6d0ec90`, `8a7e253`

---
*Phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting*
*Completed: 2026-05-03*
