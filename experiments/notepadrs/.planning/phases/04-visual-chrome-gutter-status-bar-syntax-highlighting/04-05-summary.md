---
phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting
plan: 05
subsystem: testing
tags: [tokenizer, golden-stream-tests, syntax-highlighting, per-language, state-machine]

# Dependency graph
requires:
  - phase: 04-04a
    provides: Five hand-rolled tokenizers (Plain/JSON/Markdown/JavaScript/Python) with tokenize_line dispatch + LineEndState multi-line state machine

provides:
  - 39 golden-token-stream tests in tests/syntax_tokenizers.rs covering all 5 languages
  - Multi-line state transition tests for JS (block comment), Python (triple-string both kinds), Markdown (fenced code backtick + tilde)
  - find_token + assert_token helpers for slice/class assertions
  - TEST-07 requirement closed

affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Golden-token-stream integration tests: find_token helper finds first token matching expected slice; assert_token checks slice + class in one call"
    - "Multi-line state test pattern: call tokenize_line 3 times (open, continuation, close), assert LineEndState at each boundary"
    - "Single-file integration test with section comments per language (matches Phase 3 find_engine.rs precedent)"
    - "No #[ignore] gating — all 39 tests run on every cargo test"

key-files:
  created:
    - tests/syntax_tokenizers.rs
  modified: []

key-decisions:
  - "D-1 (single file): all 5 languages in tests/syntax_tokenizers.rs with section comments"
  - "D-2 (no #[ignore]): all tests run on every cargo test — fast, small, essential"
  - "D-3 (in-source fixtures): inline &str literals, no fixture-loading helper"
  - "D-4 (contractual assertions): token positions + classes, NOT exact count — tolerates future tokenizer improvements"
  - "D-5 (multi-line state coverage): JS block comment 3 lines, Python triple-double 3 lines + triple-single 2 lines, Markdown backtick fence 3 lines + tilde fence 2 lines"
  - "D-9 (no Win32 imports): pure-logic test file — grep confirms zero windows:: references"
  - "D-10 (plan boundary): only imports notepadrs::syntax — does NOT reference notepadrs::highlight or notepadrs::dispatch"
  - "O-1 (taken): added single-line code tests for JS + Python to anchor multi-line state tests (code_line_returns_code_state)"

patterns-established:
  - "find_token(line, &toks, expected_str) — scans Vec<Token> for first token whose byte slice matches; returns Option<&Token>"
  - "assert_token(line, tok, expected_str, class) — combined slice + class assertion with informative failure message"
  - "Multi-line state test: open on line N, continuation on N+1, close on N+2; assert e1/e2/e3"

requirements-completed: [TEST-07]
test-tiers: [integration]

# Metrics
duration: ~2 min
completed: 2026-05-03
---

# Phase 4 Plan 05: Per-Language Tokenizer Test Suite Summary

**39 golden-token-stream integration tests across JS/Python/JSON/Markdown/Plain — covering single-line tokenization and multi-line state transitions (JsBlockComment, PyTripleString both kinds, MdCodeFence backtick + tilde), with find_token + assert_token helpers and zero #[ignore] gating.**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-05-03T02:08:57Z
- **Completed:** 2026-05-03T02:11:00Z
- **Tasks:** 1
- **Files created:** 1

## Accomplishments

- **tests/syntax_tokenizers.rs** — 39 test functions across 5 language sections; all pass on `cargo test --test syntax_tokenizers` with `test result: ok. 39 passed; 0 failed`.
- Multi-line state transitions fully exercised: JS block comment (3-line open/continue/close), Python triple-double-quote (3-line), Python triple-single-quote (2-line), Markdown backtick fence (3-line), Markdown tilde fence (2-line).
- Added `javascript_template_literal_carries_state` and `markdown_fenced_code_inner_line_class` (beyond plan minimum) for extra coverage.
- TEST-07 closed — CI now surfaces per-language tokenizer correctness as standard `cargo test` pass/fail.

## Test Count Breakdown

| Language   | Tests | Multi-line state |
|------------|-------|-----------------|
| Plain      | 3     | None (by design) |
| JSON       | 7     | None (by design) |
| JavaScript | 9     | JsBlockComment (3-line) + JsTemplateLiteral open |
| Python     | 8     | PyTripleString DoubleQuote (3-line) + SingleQuote (2-line) |
| Markdown   | 12    | MdCodeFence backtick (3-line) + tilde (2-line) + inner-line class |
| **Total**  | **39** | 5 multi-line tests |

## Task Commits

1. **Task 1: Create tests/syntax_tokenizers.rs** — `873592c` (test)

## Files Created/Modified

- `tests/syntax_tokenizers.rs` — 39 integration tests; ~474 lines; imports only `notepadrs::syntax::*`

## Implementation Decisions

### Taken (within plan's discretion)

- O-1: Added `javascript_code_line_returns_code_state` and `python_code_line_returns_code_state` — "ordinary code line returns Code" tests anchor the multi-line state tests (confirms state isn't accidentally set on non-stateful lines).
- Added `markdown_fenced_code_inner_line_class` beyond the plan minimum — asserts that lines inside a code fence emit `TokenClass::CodeFence` tokens. Closes a coverage gap identified while reading `markdown.rs`.
- Added `markdown_italic_with_underscore` — plan listed only `italic_with_asterisk`; underscore-italic uses the same code path but different delimiter, worth asserting.
- Added `javascript_template_literal_carries_state` — plan's multi-line JS test covered block comments; template literals are the other JS multi-line construct from 04-04a.

### Deviations (from plan; must explain)

None — plan executed exactly as written. The four tests above are additions (O-1 recommendation + extra coverage), not deviations from locked decisions.

### Open questions for verifier

- Q-1: Pre-existing clippy failures in `tests/roundtrip_matrix.rs` (`collapsible_str_replace`) and `tests/undo_property.rs` (`unusual_byte_groupings`) appear under `cargo clippy --tests -- -D warnings`. These are NOT caused by this plan (verified: `cargo clippy --test syntax_tokenizers -- -D warnings` passes clean). Verifier should confirm these are pre-existing and out of scope.

## Deviations from Plan

None — plan executed exactly as written. All 4 extra tests are additive coverage (plan minimum was 25; target was 30-35; shipped 39).

## Issues Encountered

- `cargo build --target x86_64-pc-windows-msvc` fails due to `src/highlight.rs` errors from in-progress Plan 04-04b (CHARFORMAT2W field names, missing Performance import). This is expected: 04-04b is running in parallel. Integration tests compile independently via the lib target without highlight.rs; `cargo test --test syntax_tokenizers` succeeds.

## Self-Check

- `tests/syntax_tokenizers.rs` exists and contains 39 `#[test]` functions (verified: `grep -E '^fn (plain|json|javascript|python|markdown)_' | wc -l` = 39)
- All 39 tests pass: `cargo test --test syntax_tokenizers` reports `test result: ok. 39 passed; 0 failed`
- Multi-line state references: `grep -E 'JsBlockComment|PyTripleString|MdCodeFence' | wc -l` = 16 (>= 6 required)
- No Win32 imports: `grep -E 'use windows::|HWND'` = 0 matches
- Plan boundary respected: `grep -E 'use notepadrs::highlight|use notepadrs::dispatch'` = 0 matches
- Commit `873592c` exists in git log
- Clippy clean on test file: `cargo clippy --test syntax_tokenizers -- -D warnings` returns Finished with no errors

## Self-Check: PASSED

## Next Phase Readiness

- TEST-07 is closed. The tokenizer suite runs on every `cargo test` without flags.
- Plan 04-04b (highlight wiring + GUI) can proceed independently — it shares no files with this plan.
- Future refactors to any of the 5 tokenizers will be caught by this suite before CI merges them.

---
*Phase: 04-visual-chrome-gutter-status-bar-syntax-highlighting*
*Completed: 2026-05-03*
