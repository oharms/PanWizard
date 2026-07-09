---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 04a
type: execute
wave: 3
depends_on: ["04-01"]
files_modified:
  - src/syntax/plain.rs
  - src/syntax/json.rs
  - src/syntax/markdown.rs
  - src/syntax/javascript.rs
  - src/syntax/python.rs
autonomous: true
change_class: feat
requirements: [SYNTAX-01, SYNTAX-02, SYNTAX-03, SYNTAX-04, SYNTAX-05]

must_haves:
  truths:
    - "src/syntax/plain.rs returns a single Plain token covering each non-empty line; LineEndState always Code"
    - "src/syntax/json.rs recognizes strings (with backslash escapes), numbers (negative + exponent), true/false/null keywords, structural punct {[]:,}; LineEndState always Code"
    - "src/syntax/javascript.rs recognizes the keyword set, single/double/template strings, line + block comments, regex via the after-operator heuristic, numbers; carries JsBlockComment + JsTemplateLiteral state across lines"
    - "src/syntax/python.rs recognizes keywords, single/double/triple strings, comments, decorators, numbers; carries PyTripleString state across lines"
    - "src/syntax/markdown.rs recognizes headings (#-######), bold (**), italic (*_), inline code (`), fenced code blocks; carries MdCodeFence state across lines"
    - "All five tokenizers conform to the dispatch signature `pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState)` declared by Plan 04-01's src/syntax/mod.rs"
    - "cargo build + cargo clippy --lib --bins -- -D warnings pass — tokenizer-only artifacts compile cleanly with no GUI/highlight dependencies introduced"
    - "Plan 04-05 tests/syntax_tokenizers.rs (golden-token-stream tests, scheduled in Wave 4) pass against these tokenizer implementations"
  artifacts:
    - path: "src/syntax/plain.rs"
      provides: "Plain text fallback — single Plain token per line, no multi-line state"
      contains: "fn tokenize_line"
      min_lines: 15
    - path: "src/syntax/json.rs"
      provides: "JSON tokenizer — string (with escapes), number, true/false/null, structural punct {[]:,}; no multi-line state"
      contains: "fn tokenize_line"
      min_lines: 80
    - path: "src/syntax/markdown.rs"
      provides: "Markdown tokenizer — headings (#-######), bold (**), italic (*_), inline code (`), fenced code blocks (``` and ~~~) with multi-line state, list markers (-+*)"
      contains: "MdCodeFence"
      min_lines: 100
    - path: "src/syntax/javascript.rs"
      provides: "JS/MJS tokenizer — keywords (const/let/var/function/class/etc.), strings (single/double/template), regex, numbers, line comments (//), block comments (/* */) with multi-line state, punct"
      contains: "JsBlockComment"
      min_lines: 150
    - path: "src/syntax/python.rs"
      provides: "Python tokenizer — keywords (def/class/if/for/etc.), strings (single/double/triple) with multi-line state for triple, comments (#), decorators (@), numbers, punct"
      contains: "PyTripleString"
      min_lines: 130
  key_links:
    - from: "src/syntax/{plain,json,markdown,javascript,python}.rs::tokenize_line"
      to: "src/syntax/mod.rs::tokenize_line dispatch (Plan 04-01)"
      via: "Each submodule's pub fn tokenize_line is called by the dispatch"
      pattern: "pub fn tokenize_line\\(line: &str, prev: LineEndState\\) -> \\(Vec<Token>, LineEndState\\)"
    - from: "src/syntax/javascript.rs"
      to: "LineEndState::JsBlockComment / LineEndState::JsTemplateLiteral"
      via: "Open /* without */ before EOL → JsBlockComment; open ` without ` before EOL → JsTemplateLiteral"
      pattern: "JsBlockComment|JsTemplateLiteral"
    - from: "src/syntax/python.rs"
      to: "LineEndState::PyTripleString { kind }"
      via: "Open ''' or \"\"\" without close before EOL"
      pattern: "PyTripleString"
    - from: "src/syntax/markdown.rs"
      to: "LineEndState::MdCodeFence { fence_char, fence_len }"
      via: "Open ``` or ~~~ fence at line start"
      pattern: "MdCodeFence"
---

<objective>
Implement the five hand-rolled byte-level state-machine tokenizers (Plain, JSON, Markdown, JavaScript, Python) per the dispatch signature established by Plan 04-01. **This plan does NOT touch the GUI** — no `src/highlight.rs`, no `src/dispatch.rs`, no Win32 calls. Tokenizer-only artifacts that compile + clippy-clean and feed both Plan 04-04b (highlight wiring + perf gate) and Plan 04-05 (golden-token-stream tests).

Purpose: Close SYNTAX-01..05 at the tokenizer-implementation layer. Splitting the original Plan 04-04 (which combined tokenizers + highlight pipeline + perf gate, ~900-1100 LOC across 10 files, 11 must_have truths) into 04-04a (tokenizers, this plan) + 04-04b (highlight + dispatch + perf) addresses plan-checker Blocker #1 — single-shot execution of the original 04-04 risked dropping a Pitfall mitigation silently. Splitting also lets Plan 04-05 (test suite) run in Wave 4 in parallel with 04-04b because the test suite only needs the tokenizers, not the highlight wiring.
Output: Five completed `src/syntax/{plain,json,markdown,javascript,python}.rs` modules. Tokenizers conform to the dispatch signature in `src/syntax/mod.rs`. cargo build + clippy pass.
</objective>

## Plan Decisions

(See @./.claude/pan-wizard-core/references/handoff-decisions.md for the schema.)

### Locked (executor MUST follow)

- D-1: **Hand-rolled byte-level state machines per language. NO regex, NO new crates.** idea.md crate allowlist + 04-research.md user_constraints. Each tokenizer iterates `&[u8]` (the line bytes), classifies spans, returns `(Vec<Token>, LineEndState)`. ASCII-significant chars only — non-ASCII bytes belong to identifiers/strings and are absorbed into the active token. Source: 04-research.md user_constraints "Crate allowlist" + Pattern T1.
- D-2: **Per-language scope** (idea.md "simple tokenizer per language" — keep grammar shallow):
  - **Plain:** single Plain token per non-empty line. ~15 LOC.
  - **JSON:** strings (with `\` escapes), numbers (`-?\d+(\.\d+)?(e\d+)?`), `true`/`false`/`null` keywords, `{`/`}`/`[`/`]`/`:`/`,` punct. No multi-line state. ~80 LOC.
  - **Markdown:** `#`/`##`/etc. heading at line start; `**bold**`; `*italic*`/`_italic_`; `` `code` ``; ` ``` `/`~~~` fenced code (multi-line state via `MdCodeFence { fence_char, fence_len }`); `-`/`+`/`*` list marker at line start (after optional indent). NO nested constructs (Pitfall P4-9 — accept v1 limitation). ~100 LOC.
  - **JavaScript:** keywords (`const`/`let`/`var`/`function`/`class`/`if`/`else`/`for`/`while`/`return`/`true`/`false`/`null`/`undefined`/`async`/`await`/`new`/`this`/`typeof`/`instanceof`/`import`/`export`/`from`/`default`/`break`/`continue`/`do`/`switch`/`case`/`try`/`catch`/`finally`/`throw`); single-quote strings; double-quote strings; backtick template literals (multi-line state — `${...}` treated as part of string per Open Question 4); regex literals (`/pattern/flags` — heuristic: only after `=`, `(`, `,`, `;`, `!`, `&`, `|`, `?`, `:`, `+`, `-`, `*`, `%`, `<`, `>`); numbers; `//` line comments; `/* */` block comments (multi-line state). ~150 LOC.
  - **Python:** keywords (`def`/`class`/`if`/`elif`/`else`/`for`/`while`/`return`/`True`/`False`/`None`/`async`/`await`/`import`/`from`/`as`/`with`/`pass`/`break`/`continue`/`try`/`except`/`finally`/`raise`/`lambda`/`yield`/`in`/`not`/`is`/`and`/`or`); single-quote strings; double-quote strings; triple-quote strings (`'''` and `"""` — multi-line state); `#` line comments; `@decorator`; numbers. ~130 LOC.
  - Source: 04-research.md user_constraints "Token-class palette" + idea.md SC-4.
- D-3: **Signature lock:** every per-language `tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState)`. **DO NOT add new arguments** (e.g., a `Language` parameter). Each module is already named — the dispatcher in `src/syntax/mod.rs` (Plan 04-01) calls the right submodule based on `Language`. Source: Plan 04-01 D-4 type-contract lock.
- D-4: **No GUI / no Win32 imports in any tokenizer file.** These are pure-logic byte-level state machines. The closest peer module they reach into is `crate::syntax::{LineEndState, Token, TokenClass, PyTripleKind}` from `mod.rs`. Source: 04-research.md Pattern T1.
- D-5: **JS regex-literal heuristic** (O-2 in original 04-04). Use a minimal heuristic: a `/` is a regex if the previous non-whitespace token is `=`, `(`, `,`, `;`, `:`, `+`, `-`, `*`, `%`, `<`, `>`, `!`, `&`, `|`, `?`, `^`, `~`, OR if the previous token is one of the keywords `return`, `typeof`, `instanceof`, `new`, `delete`, `void`, OR if `/` is at the start of the line (after whitespace). Otherwise classify `/` as Punct (the divide operator). Edge cases get string-classified instead of regex-classified — visually fine. Source: 04-research.md Open Question 4.
- D-6: **JS template literal `${...}` interpolation.** Treat the whole template literal (including `${expr}`) as a single String token — no parsing of the embedded expression. v1.x can parse. Source: 04-research.md "Don't Hand-Roll" — JS template literals.
- D-7: **MD list marker handling.** Color the whole line as Plain (not the marker as Punct + the rest). Recommendation: simpler v1; list markers don't need a distinct color. Source: 04-research.md O-3.
- D-8: **Decorator class for Python.** `@decorator` at line start: color whole `@<identifier>` token. Plan 04-05's `python_decorator` test tolerates either `TokenClass::Comment` OR `TokenClass::Keyword`. Recommendation: use `TokenClass::Keyword` (purple) — visually distinct from comments. Source: Plan 04-05 test tolerance.
- D-9: **Implementation pattern shared across all tokenizers:**
  - Define keywords as `&[&str]` constant per language (e.g., `const KEYWORDS: &[&str] = &["const", "let", ...]`).
  - Identifier scan: `[A-Za-z_][A-Za-z0-9_]*` (ASCII-only is fine for v1).
  - Number scan: `[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?` (lenient — failure = wrong but visible).
  - Each file head: `#![deny(clippy::unwrap_used)] #![deny(clippy::expect_used)]`.
  - No regex, no allocations per token (pre-allocate `Vec::with_capacity(line.len() / 8)` if profiling shows allocator pressure).
  - Source: 04-research.md "Don't Hand-Roll" + Pattern T1.

### Open (executor's discretion within constraints)

- O-1: **Whether to memoize `Vec<Token>` per line.** v1 doesn't — Plan 04-04b will re-tokenize on every `apply_visible_viewport` call. Memoizing would mean a `Vec<Vec<Token>>` per Tab; extra memory (~20-30 bytes/line × N lines = ~1.5MB for a 50,000-line file). Recommendation: skip for v1; only `LineEndState` is cached on Tab.line_states. If 04-04b's perf test (Layer 1, <5ms tokenize+apply) fails, this is escape hatch (a). Source: 04-research.md Open Question 1.
- O-2: **Pre-allocate token vec capacity hint.** `Vec::new()` vs `Vec::with_capacity(line.len() / 8)`. Recommendation: `Vec::new()` for v1 — Vec auto-grows fast enough; pre-alloc only adds value if profiling shows allocator pressure (it almost certainly won't for ~5-10 tokens/line).

### Considered and rejected

- R-1: **Using `regex` crate per token class.** Rejected. 04-research.md Anti-Pattern + Pitfall 5: regex per char misses 16ms budget. Source: 04-research.md "Alternatives Considered".
- R-2: **`syntect` / `tree-sitter` / `nom`.** Rejected: crate allowlist + binary size. Source: idea.md Constraints.
- R-3: **Bold + italic font weights.** Rejected: requires `cf.dwMask |= CFM_BOLD | CFM_ITALIC` and font-set logic; idea.md "simple tokenizer" + v1 scope says color only. The tokenizer DOES emit Bold and Italic TokenClass variants, but Plan 04-04b's PALETTE maps them to black (color only). Source: 04-research.md Open Question 4.
- R-4: **Memoizing Vec<Token> per line.** O-1 rationale; v1 skips.

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
@src/syntax/mod.rs
@src/syntax/plain.rs

<interfaces>
<!-- Phase 4 type contracts (set up by Plan 04-01). Tokenizers must conform to these signatures. -->

From src/syntax/mod.rs (after 04-01):
```rust
pub enum Language { Plain, Json, Markdown, JavaScript, Python }

pub enum TokenClass {
    Plain, Keyword, String, Number, Comment, Punct,
    Heading, Bold, Italic, CodeFence, Link,
}

pub struct Token { pub start: u32, pub end: u32, pub class: TokenClass }

pub enum PyTripleKind { SingleQuote, DoubleQuote }

pub enum LineEndState {
    Code,
    JsBlockComment,
    JsTemplateLiteral { backticks: u8 },
    PyTripleString { kind: PyTripleKind },
    MdCodeFence { fence_char: u8, fence_len: u8 },
}

// 04-04a implements the per-language tokenize_line; mod.rs already dispatches to the submodules.
pub fn tokenize_line(lang: Language, line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState);
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Implement plain + JSON tokenizers (the two simplest, no multi-line state)</name>
  <files>src/syntax/plain.rs, src/syntax/json.rs</files>
  <action>
**Replace the stub `tokenize_line` in `src/syntax/plain.rs`** with the real (already-trivial) impl per D-2:

```rust
//! Plain-text fallback (SYNTAX-05). No multi-line state.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use crate::syntax::{LineEndState, Token, TokenClass};

pub fn tokenize_line(line: &str, _prev: LineEndState) -> (Vec<Token>, LineEndState) {
    if line.is_empty() {
        return (Vec::new(), LineEndState::Code);
    }
    let tokens = vec![Token {
        start: 0,
        end: line.len() as u32,
        class: TokenClass::Plain,
    }];
    (tokens, LineEndState::Code)
}
```

(This is essentially what Plan 04-01 wrote — verify it's intact and just remove the `#[allow(dead_code)]` since the file is now consumed by the dispatch.)

**Replace the stub `tokenize_line` in `src/syntax/json.rs`** with the JSON state machine per D-2:

```rust
//! JSON tokenizer (SYNTAX-03). Grammar: strings (with \-escapes), numbers,
//! true/false/null literals, structural punct {[]:,}. No multi-line state.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use crate::syntax::{LineEndState, Token, TokenClass};

pub fn tokenize_line(line: &str, _prev: LineEndState) -> (Vec<Token>, LineEndState) {
    let bytes = line.as_bytes();
    let mut tokens: Vec<Token> = Vec::new();
    let mut i: u32 = 0;
    let n = bytes.len() as u32;

    while i < n {
        let c = bytes[i as usize];
        match c {
            b' ' | b'\t' | b'\r' => { i += 1; }
            b'"' => {
                let start = i;
                i += 1;
                while i < n {
                    if bytes[i as usize] == b'\\' && i + 1 < n {
                        i += 2;
                        continue;
                    }
                    if bytes[i as usize] == b'"' {
                        i += 1;
                        break;
                    }
                    i += 1;
                }
                tokens.push(Token { start, end: i, class: TokenClass::String });
            }
            b'0'..=b'9' | b'-' => {
                let start = i;
                if c == b'-' { i += 1; }
                while i < n {
                    let b = bytes[i as usize];
                    if b.is_ascii_digit() || b == b'.' || b == b'e' || b == b'E' || b == b'+' || b == b'-' {
                        i += 1;
                    } else {
                        break;
                    }
                }
                tokens.push(Token { start, end: i, class: TokenClass::Number });
            }
            b't' | b'f' | b'n' => {
                let start = i;
                while i < n && bytes[i as usize].is_ascii_alphabetic() { i += 1; }
                let word = &line[start as usize..i as usize];
                let class = if word == "true" || word == "false" || word == "null" {
                    TokenClass::Keyword
                } else {
                    TokenClass::Plain
                };
                tokens.push(Token { start, end: i, class });
            }
            b'{' | b'}' | b'[' | b']' | b':' | b',' => {
                tokens.push(Token { start: i, end: i + 1, class: TokenClass::Punct });
                i += 1;
            }
            _ => { i += 1; } // skip unknown bytes
        }
    }
    (tokens, LineEndState::Code)
}
```
  </action>
  <verify>
    <automated tier="T1">cargo build --target x86_64-pc-windows-msvc 2>&amp;1 | tail -10</automated>
    <automated tier="T1">cargo clippy --target x86_64-pc-windows-msvc --lib --bins -- -D warnings 2>&amp;1 | tail -10</automated>
    <automated tier="T1">cargo test --target x86_64-pc-windows-msvc --test phase04_data_shape 2>&amp;1 | tail -10</automated>
  </verify>
  <done>
- `src/syntax/plain.rs` returns single Plain token per non-empty line; `LineEndState::Code` always.
- `src/syntax/json.rs` recognizes strings (with backslash escapes), numbers (negative + exponent), true/false/null keywords, structural punct.
- `cargo build` + `cargo clippy --lib --bins -- -D warnings` pass with no warnings.
- Existing Plan 04-01 phase04_data_shape test still passes (no regression on the type system).
  </done>
</task>

<task type="auto">
  <name>Task 2: Implement Markdown + JavaScript tokenizers (multi-line state for fenced code, block comment, template literal)</name>
  <files>src/syntax/markdown.rs, src/syntax/javascript.rs</files>
  <action>
**Replace the stub in `src/syntax/markdown.rs`** with the Markdown state machine per D-2 + D-7:

```rust
//! Markdown tokenizer (SYNTAX-04).
//! v1 scope: headings (#-######), bold (**), italic (*_), inline code (`code`),
//! fenced code blocks (``` and ~~~) with multi-line state.
//! v1 limitations (Pitfall P4-9): NO nested constructs (list-inside-blockquote, etc.).

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use crate::syntax::{LineEndState, Token, TokenClass};

pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState) {
    let bytes = line.as_bytes();
    let n = bytes.len() as u32;
    let mut tokens: Vec<Token> = Vec::new();

    // 1) If we're inside a fenced code block, the line is either still code or the closing fence.
    if let LineEndState::MdCodeFence { fence_char, fence_len } = prev {
        let mut i = 0u32;
        // Skip leading whitespace
        while i < n && (bytes[i as usize] == b' ' || bytes[i as usize] == b'\t') { i += 1; }
        let mut count: u8 = 0;
        while i < n && bytes[i as usize] == fence_char && count < 255 {
            count = count.saturating_add(1);
            i += 1;
        }
        if count >= fence_len {
            // Closing fence — color line as CodeFence; end-state returns to Code.
            tokens.push(Token { start: 0, end: n, class: TokenClass::CodeFence });
            return (tokens, LineEndState::Code);
        }
        // Still inside the block — color whole line as CodeFence.
        tokens.push(Token { start: 0, end: n, class: TokenClass::CodeFence });
        return (tokens, LineEndState::MdCodeFence { fence_char, fence_len });
    }

    // 2) Line outside a fence. Check for opening fence.
    let mut i: u32 = 0;
    while i < n && (bytes[i as usize] == b' ' || bytes[i as usize] == b'\t') { i += 1; }
    if i < n && (bytes[i as usize] == b'`' || bytes[i as usize] == b'~') {
        let fence_char = bytes[i as usize];
        let fc_start = i;
        let mut count: u8 = 0;
        while i < n && bytes[i as usize] == fence_char && count < 255 {
            count = count.saturating_add(1);
            i += 1;
        }
        if count >= 3 {
            tokens.push(Token { start: 0, end: n, class: TokenClass::CodeFence });
            return (tokens, LineEndState::MdCodeFence { fence_char, fence_len: count });
        }
        i = fc_start; // not a fence, rewind and process inline
    }

    // 3) Heading at line start.
    let mut h_i: u32 = 0;
    if h_i < n && bytes[h_i as usize] == b'#' {
        let mut hash_count = 0;
        while h_i < n && bytes[h_i as usize] == b'#' && hash_count < 6 { hash_count += 1; h_i += 1; }
        if hash_count >= 1 && hash_count <= 6 && (h_i >= n || bytes[h_i as usize] == b' ') {
            // Whole line is a heading.
            tokens.push(Token { start: 0, end: n, class: TokenClass::Heading });
            return (tokens, LineEndState::Code);
        }
    }

    // 4) Inline scan: bold (**), italic (*_), inline code (`).
    let mut i: u32 = 0;
    while i < n {
        let c = bytes[i as usize];
        if c == b'`' {
            let start = i;
            i += 1;
            while i < n && bytes[i as usize] != b'`' { i += 1; }
            if i < n { i += 1; }
            // Inline code colored as Comment per palette mapping (04-04b D-2).
            tokens.push(Token { start, end: i, class: TokenClass::Comment });
        } else if c == b'*' && i + 1 < n && bytes[(i + 1) as usize] == b'*' {
            // Bold **...**
            let start = i;
            i += 2;
            while i + 1 < n && !(bytes[i as usize] == b'*' && bytes[(i + 1) as usize] == b'*') { i += 1; }
            if i + 1 < n { i += 2; }
            tokens.push(Token { start, end: i, class: TokenClass::Bold });
        } else if c == b'*' || c == b'_' {
            // Italic *...* or _..._
            let mark = c;
            let start = i;
            i += 1;
            while i < n && bytes[i as usize] != mark { i += 1; }
            if i < n { i += 1; }
            tokens.push(Token { start, end: i, class: TokenClass::Italic });
        } else {
            i += 1;
        }
    }
    // If no tokens were produced, fall through to a single Plain token (D-7 list-marker simplification).
    if tokens.is_empty() && n > 0 {
        tokens.push(Token { start: 0, end: n, class: TokenClass::Plain });
    }
    (tokens, LineEndState::Code)
}
```

**Replace the stub in `src/syntax/javascript.rs`** with the JS state machine per D-2 + D-5 + D-6.

Sketch (the executor must implement the full body — ~150 LOC):

```rust
//! JavaScript / MJS tokenizer (SYNTAX-01).
//! Grammar: keywords, single/double/template strings, regex (after-operator heuristic),
//! line + block comments (multi-line state), numbers, identifiers.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use crate::syntax::{LineEndState, Token, TokenClass};

const KEYWORDS: &[&str] = &[
    "const", "let", "var", "function", "class",
    "if", "else", "for", "while", "do", "return",
    "true", "false", "null", "undefined",
    "async", "await", "new", "this", "typeof", "instanceof",
    "import", "export", "from", "default",
    "break", "continue",
    "switch", "case",
    "try", "catch", "finally", "throw",
];

/// Returns true iff `/` after this token kind should be a regex, not a divide.
fn prev_token_allows_regex(prev_class: Option<TokenClass>, prev_text: &str) -> bool {
    if prev_class.is_none() { return true; } // start of line
    if matches!(prev_class, Some(TokenClass::Punct)) {
        // Common operators/punctuation that allow a regex literal next.
        return matches!(prev_text, "=" | "(" | "," | ";" | ":" | "+" | "-" | "*" | "%"
            | "<" | ">" | "!" | "&" | "|" | "?" | "^" | "~" | "[" | "{");
    }
    if matches!(prev_class, Some(TokenClass::Keyword)) {
        return matches!(prev_text, "return" | "typeof" | "instanceof" | "new" | "delete" | "void");
    }
    false
}

pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState) {
    let bytes = line.as_bytes();
    let n = bytes.len() as u32;
    let mut tokens: Vec<Token> = Vec::new();
    let mut i: u32 = 0;
    let mut state = prev;

    // Continue an unfinished block comment from the previous line.
    if let LineEndState::JsBlockComment = state {
        let start = 0u32;
        while i + 1 < n {
            if bytes[i as usize] == b'*' && bytes[(i + 1) as usize] == b'/' {
                i += 2;
                tokens.push(Token { start, end: i, class: TokenClass::Comment });
                state = LineEndState::Code;
                break;
            }
            i += 1;
        }
        if let LineEndState::JsBlockComment = state {
            // Whole line is still inside the block comment.
            tokens.push(Token { start: 0, end: n, class: TokenClass::Comment });
            return (tokens, LineEndState::JsBlockComment);
        }
    }

    // Continue an unfinished template literal.
    if let LineEndState::JsTemplateLiteral { .. } = state {
        let start = 0u32;
        while i < n {
            if bytes[i as usize] == b'`' {
                i += 1;
                tokens.push(Token { start, end: i, class: TokenClass::String });
                state = LineEndState::Code;
                break;
            }
            // Skip escape sequences \\` etc.
            if bytes[i as usize] == b'\\' && i + 1 < n {
                i += 2;
                continue;
            }
            i += 1;
        }
        if !matches!(state, LineEndState::Code) {
            tokens.push(Token { start: 0, end: n, class: TokenClass::String });
            return (tokens, state);
        }
    }

    let mut prev_class: Option<TokenClass> = None;
    let mut prev_text: String = String::new();

    while i < n {
        let c = bytes[i as usize];
        match c {
            b' ' | b'\t' | b'\r' => { i += 1; }
            b'/' if i + 1 < n && bytes[(i + 1) as usize] == b'/' => {
                // Line comment to EOL.
                let start = i;
                i = n;
                tokens.push(Token { start, end: i, class: TokenClass::Comment });
                prev_class = Some(TokenClass::Comment);
                prev_text.clear();
            }
            b'/' if i + 1 < n && bytes[(i + 1) as usize] == b'*' => {
                // Block comment — possibly multi-line.
                let start = i;
                i += 2;
                let mut closed = false;
                while i + 1 < n {
                    if bytes[i as usize] == b'*' && bytes[(i + 1) as usize] == b'/' {
                        i += 2;
                        closed = true;
                        break;
                    }
                    i += 1;
                }
                if closed {
                    tokens.push(Token { start, end: i, class: TokenClass::Comment });
                    prev_class = Some(TokenClass::Comment);
                    prev_text.clear();
                } else {
                    tokens.push(Token { start, end: n, class: TokenClass::Comment });
                    return (tokens, LineEndState::JsBlockComment);
                }
            }
            b'/' if prev_token_allows_regex(prev_class, &prev_text) => {
                // Regex literal /.../flags (D-5 heuristic).
                let start = i;
                i += 1;
                while i < n {
                    if bytes[i as usize] == b'\\' && i + 1 < n { i += 2; continue; }
                    if bytes[i as usize] == b'/' { i += 1; break; }
                    i += 1;
                }
                // Trailing flags.
                while i < n && bytes[i as usize].is_ascii_alphabetic() { i += 1; }
                tokens.push(Token { start, end: i, class: TokenClass::String });
                prev_class = Some(TokenClass::String);
                prev_text.clear();
            }
            b'"' | b'\'' => {
                let quote = c;
                let start = i;
                i += 1;
                while i < n {
                    if bytes[i as usize] == b'\\' && i + 1 < n { i += 2; continue; }
                    if bytes[i as usize] == quote { i += 1; break; }
                    i += 1;
                }
                tokens.push(Token { start, end: i, class: TokenClass::String });
                prev_class = Some(TokenClass::String);
                prev_text.clear();
            }
            b'`' => {
                // Template literal. May span lines (D-6).
                let start = i;
                i += 1;
                let mut closed = false;
                while i < n {
                    if bytes[i as usize] == b'\\' && i + 1 < n { i += 2; continue; }
                    if bytes[i as usize] == b'`' { i += 1; closed = true; break; }
                    i += 1;
                }
                if closed {
                    tokens.push(Token { start, end: i, class: TokenClass::String });
                    prev_class = Some(TokenClass::String);
                    prev_text.clear();
                } else {
                    tokens.push(Token { start, end: n, class: TokenClass::String });
                    return (tokens, LineEndState::JsTemplateLiteral { backticks: 1 });
                }
            }
            b'0'..=b'9' => {
                let start = i;
                while i < n {
                    let b = bytes[i as usize];
                    if b.is_ascii_digit() || b == b'.' || b == b'e' || b == b'E' { i += 1; } else { break; }
                }
                tokens.push(Token { start, end: i, class: TokenClass::Number });
                prev_class = Some(TokenClass::Number);
                prev_text.clear();
            }
            b'A'..=b'Z' | b'a'..=b'z' | b'_' | b'$' => {
                let start = i;
                while i < n {
                    let b = bytes[i as usize];
                    if b.is_ascii_alphanumeric() || b == b'_' || b == b'$' { i += 1; } else { break; }
                }
                let word = &line[start as usize..i as usize];
                let class = if KEYWORDS.contains(&word) { TokenClass::Keyword } else { TokenClass::Plain };
                tokens.push(Token { start, end: i, class });
                prev_class = Some(class);
                prev_text = word.to_owned();
            }
            _ => {
                // Punct (single byte, ASCII printable).
                tokens.push(Token { start: i, end: i + 1, class: TokenClass::Punct });
                prev_class = Some(TokenClass::Punct);
                prev_text = (c as char).to_string();
                i += 1;
            }
        }
    }
    (tokens, LineEndState::Code)
}
```
  </action>
  <verify>
    <automated tier="T1">cargo build --target x86_64-pc-windows-msvc 2>&amp;1 | tail -10</automated>
    <automated tier="T1">cargo clippy --target x86_64-pc-windows-msvc --lib --bins -- -D warnings 2>&amp;1 | tail -10</automated>
  </verify>
  <done>
- `src/syntax/markdown.rs` recognizes headings (#-######), bold, italic, inline code, fenced code blocks; carries `MdCodeFence { fence_char, fence_len }` across lines; closes on matching fence char count.
- `src/syntax/javascript.rs` recognizes the JS keyword set, single+double+template strings, regex (D-5 heuristic), line + block comments, numbers, identifiers; carries `JsBlockComment` and `JsTemplateLiteral` state across lines.
- `cargo build` + `cargo clippy --lib --bins -- -D warnings` pass.
  </done>
</task>

<task type="auto">
  <name>Task 3: Implement Python tokenizer (multi-line triple-string state)</name>
  <files>src/syntax/python.rs</files>
  <action>
**Replace the stub in `src/syntax/python.rs`** with the Python state machine per D-2 + D-8:

```rust
//! Python tokenizer (SYNTAX-02).
//! Grammar: keywords, single/double/triple strings (multi-line state for triple),
//! line comments (#), decorators (@), numbers, identifiers.

#![deny(clippy::unwrap_used)]
#![deny(clippy::expect_used)]

use crate::syntax::{LineEndState, PyTripleKind, Token, TokenClass};

const KEYWORDS: &[&str] = &[
    "def", "class",
    "if", "elif", "else",
    "for", "while", "return",
    "True", "False", "None",
    "async", "await",
    "import", "from", "as",
    "with",
    "pass", "break", "continue",
    "try", "except", "finally", "raise",
    "lambda", "yield",
    "in", "not", "is", "and", "or",
];

pub fn tokenize_line(line: &str, prev: LineEndState) -> (Vec<Token>, LineEndState) {
    let bytes = line.as_bytes();
    let n = bytes.len() as u32;
    let mut tokens: Vec<Token> = Vec::new();
    let mut i: u32 = 0;

    // Continue a triple-string from the previous line.
    if let LineEndState::PyTripleString { kind } = prev {
        let q = match kind { PyTripleKind::SingleQuote => b'\'', PyTripleKind::DoubleQuote => b'"' };
        let start = 0u32;
        let mut closed = false;
        while i + 2 < n {
            if bytes[i as usize] == q && bytes[(i + 1) as usize] == q && bytes[(i + 2) as usize] == q {
                i += 3;
                closed = true;
                break;
            }
            // Skip backslash-escape inside triple-string.
            if bytes[i as usize] == b'\\' && i + 1 < n { i += 2; continue; }
            i += 1;
        }
        if closed {
            tokens.push(Token { start, end: i, class: TokenClass::String });
            // fall through to normal scanning for the rest of the line
        } else {
            tokens.push(Token { start, end: n, class: TokenClass::String });
            return (tokens, LineEndState::PyTripleString { kind });
        }
    }

    while i < n {
        let c = bytes[i as usize];
        match c {
            b' ' | b'\t' | b'\r' => { i += 1; }
            b'#' => {
                // Comment to EOL.
                let start = i;
                i = n;
                tokens.push(Token { start, end: i, class: TokenClass::Comment });
            }
            b'@' if i == 0 || tokens.is_empty() => {
                // Decorator at line start.
                let start = i;
                i += 1;
                while i < n {
                    let b = bytes[i as usize];
                    if b.is_ascii_alphanumeric() || b == b'_' || b == b'.' { i += 1; } else { break; }
                }
                tokens.push(Token { start, end: i, class: TokenClass::Keyword });
            }
            b'"' | b'\'' => {
                let q = c;
                // Check for triple-quote.
                if i + 2 < n && bytes[(i + 1) as usize] == q && bytes[(i + 2) as usize] == q {
                    let start = i;
                    i += 3;
                    let mut closed = false;
                    while i + 2 < n {
                        if bytes[i as usize] == q && bytes[(i + 1) as usize] == q && bytes[(i + 2) as usize] == q {
                            i += 3;
                            closed = true;
                            break;
                        }
                        if bytes[i as usize] == b'\\' && i + 1 < n { i += 2; continue; }
                        i += 1;
                    }
                    if closed {
                        tokens.push(Token { start, end: i, class: TokenClass::String });
                    } else {
                        tokens.push(Token { start, end: n, class: TokenClass::String });
                        let kind = if q == b'\'' { PyTripleKind::SingleQuote } else { PyTripleKind::DoubleQuote };
                        return (tokens, LineEndState::PyTripleString { kind });
                    }
                } else {
                    // Single-line string.
                    let start = i;
                    i += 1;
                    while i < n {
                        if bytes[i as usize] == b'\\' && i + 1 < n { i += 2; continue; }
                        if bytes[i as usize] == q { i += 1; break; }
                        i += 1;
                    }
                    tokens.push(Token { start, end: i, class: TokenClass::String });
                }
            }
            b'0'..=b'9' => {
                let start = i;
                while i < n {
                    let b = bytes[i as usize];
                    if b.is_ascii_digit() || b == b'.' || b == b'e' || b == b'E' { i += 1; } else { break; }
                }
                tokens.push(Token { start, end: i, class: TokenClass::Number });
            }
            b'A'..=b'Z' | b'a'..=b'z' | b'_' => {
                let start = i;
                while i < n {
                    let b = bytes[i as usize];
                    if b.is_ascii_alphanumeric() || b == b'_' { i += 1; } else { break; }
                }
                let word = &line[start as usize..i as usize];
                let class = if KEYWORDS.contains(&word) { TokenClass::Keyword } else { TokenClass::Plain };
                tokens.push(Token { start, end: i, class });
            }
            _ => {
                tokens.push(Token { start: i, end: i + 1, class: TokenClass::Punct });
                i += 1;
            }
        }
    }
    (tokens, LineEndState::Code)
}
```
  </action>
  <verify>
    <automated tier="T1">cargo build --target x86_64-pc-windows-msvc 2>&amp;1 | tail -10</automated>
    <automated tier="T1">cargo clippy --target x86_64-pc-windows-msvc --lib --bins -- -D warnings 2>&amp;1 | tail -10</automated>
    <automated tier="T2">cargo test --target x86_64-pc-windows-msvc 2>&amp;1 | tail -15</automated>
  </verify>
  <done>
- `src/syntax/python.rs` recognizes the Python keyword set, single/double strings, triple strings (`'''` and `"""`) with `PyTripleString { kind }` multi-line state, hash comments, `@decorator` at line start (classed as Keyword per D-8), numbers, identifiers.
- All 5 tokenizers (plain, json, markdown, javascript, python) compile and clippy-clean with `-D warnings`.
- All Phase 2 + Phase 3 + Plan 04-01/02/03 tests still pass — no regression. (Plan 04-05's `tests/syntax_tokenizers.rs` is in Wave 4 and validates these tokenizer outputs against golden token streams.)
  </done>
</task>

</tasks>

<verification>
**Plan-level checks:**

1. **Build + clippy gates pass.** `cargo build --release` succeeds; `cargo clippy --lib --bins -- -D warnings` shows zero warnings.

2. **All five tokenizers conform to the dispatch signature.** `grep -E '^pub fn tokenize_line\(line: &str, prev: LineEndState\) -> \(Vec<Token>, LineEndState\)' src/syntax/*.rs` returns 5 hits (plain, json, markdown, javascript, python).

3. **Multi-line state implementations exist.** `grep -E 'JsBlockComment|JsTemplateLiteral|PyTripleString|MdCodeFence' src/syntax/*.rs` shows references in javascript.rs (JsBlockComment + JsTemplateLiteral), python.rs (PyTripleString), markdown.rs (MdCodeFence).

4. **No GUI / Win32 in tokenizer files.** `grep -E 'use windows::|HWND|HDC|SendMessage' src/syntax/*.rs` returns no matches.

5. **No regex / parser-combinator imports.** `grep -E 'use regex::|use nom::' src/syntax/*.rs` returns no matches.

6. **Existing tests still pass.** `cargo test --target x86_64-pc-windows-msvc 2>&1 | tail -15` shows ALL prior tests passing.
</verification>

<success_criteria>
**This plan is complete when:**
- All 5 `src/syntax/{plain,json,markdown,javascript,python}.rs` files have working `tokenize_line` implementations.
- Plain returns single Plain token per non-empty line.
- JSON tokenizer recognizes strings (with escapes), numbers, true/false/null, structural punct.
- Markdown handles headings, bold/italic/inline-code, fenced code blocks (multi-line state via MdCodeFence).
- JavaScript handles keywords, all 3 string types (single/double/template), regex via D-5 heuristic, line/block comments (with multi-line state via JsBlockComment), template literal multi-line state.
- Python handles keywords, single/double/triple strings (multi-line state for triple), comments, decorators, numbers.
- All 5 tokenizers return `(Vec<Token>, LineEndState)` matching the dispatch signature from `src/syntax/mod.rs`.
- `cargo build` succeeds; `cargo clippy --lib --bins -- -D warnings` passes.
- All Phase 2/3 + Plan 04-01/02/03 tests still pass.
- Plan 04-05's golden-token-stream tests (Wave 4) pass against these tokenizer implementations — verified after both plans land.
- 3 commits per task: `feat(04-04a): plain + JSON tokenizers`, `feat(04-04a): Markdown + JavaScript tokenizers`, `feat(04-04a): Python tokenizer`.
</success_criteria>

<output>
After completion, create `.planning/phases/04-visual-chrome-gutter-status-bar-syntax-highlighting/04-04a-summary.md` per the template at `./.claude/pan-wizard-core/templates/summary.md`. Capture: per-language tokenizer LOC, the keyword sets per language, the multi-line state transitions implemented, the JS regex heuristic edge cases observed, and any deviations (especially around Markdown nested-construct simplifications — these are intentional v1 limitations per Pitfall P4-9).
</output>
