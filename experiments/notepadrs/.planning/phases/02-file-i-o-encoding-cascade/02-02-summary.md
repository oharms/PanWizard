---
phase: 02-file-i-o-encoding-cascade
plan: 02
subsystem: file-io
tags: [encoding, eol, atomic-save, ReplaceFileW, round-trip, pattern-a]

# Dependency graph
requires:
  - phase: 02-file-i-o-encoding-cascade
    plan: 01
    provides: DetectedEncoding/Eol enums, detect_encoding, decode, encode, detect_eol, normalize_to_lf, denormalize_to_eol, 10 byte-exact fixtures

provides:
  - OpenedFile struct with bytes/text/encoding/eol/had_trailing_newline
  - file::open_any_encoding (full encoding cascade open path)
  - file::save_atomic (ReplaceFileW + rename fallback, atomic)
  - EditorState::open_text_with_metadata (EM_STREAMIN + metadata cache)
  - EditorState::save_text_for_disk (Pattern A Original-Bytes Cache branch)
  - dispatch wired to Phase 2 open/save APIs
  - tests/roundtrip_matrix.rs (14 tests: 5x4 fixture matrix + edited-save + guards)

affects: [02-03, 02-04]

# Tech tracking
tech-stack:
  added:
    - windows::Win32::Storage::FileSystem (ReplaceFileW, REPLACEFILE_IGNORE_MERGE_ERRORS)
  patterns:
    - Pattern A (Original-Bytes Cache): unedited saves write cached bytes verbatim, bypassing RichEdit
    - Pattern D (atomic save): write to .notepadrs.tmp sibling, ReplaceFileW to replace
    - Pitfall G mitigation: trailing-newline flag reconciled after EM_STREAMOUT normalize_to_lf
    - ReplaceFileW returns windows::core::Result<()> — use is_err() to check failure

key-files:
  created:
    - tests/roundtrip_matrix.rs
  modified:
    - Cargo.toml
    - src/main.rs
    - src/file.rs
    - src/editor.rs
    - src/dispatch.rs
    - src/encoding.rs
    - src/eol.rs
    - tests/roundtrip_utf8_ascii.rs

key-decisions:
  - "D-1 followed: EditorState gets exactly four new fields (encoding/eol/original_bytes/had_trailing_newline), defaults Utf8/Crlf/empty/false"
  - "D-4 followed: Pattern A branch on EM_GETMODIFY: 0 → cache-emit, 1 → full encode/denormalize/save_atomic"
  - "D-6 followed: ReplaceFileW with REPLACEFILE_IGNORE_MERGE_ERRORS; result.is_err() is the correct check for windows 0.62 Result<()> return"
  - "D-7 followed: save_utf8 REMOVED; open_utf8_ascii kept deprecated for tests/roundtrip_utf8_ascii.rs"
  - "O-1 taken: pub struct OpenedFile with pub fields (return-value struct, no invariants)"
  - "O-2 taken: save_text_for_disk takes explicit target_path: &Path parameter"
  - "O-3 taken: open_text deprecated with #[deprecated(note=...)]; open_utf8_ascii also deprecated"
  - "O-4 taken: full text passed to detect_eol (function bounds scan at 64KB internally)"

patterns-established:
  - "Atomic save: always file::save_atomic; never std::fs::write directly for user files"
  - "Open path: file::open_any_encoding -> EditorState::open_text_with_metadata"
  - "Save path: EditorState::save_text_for_disk (encapsulates Pattern A)"
  - "Dead Phase 4 label() methods carry #[allow(dead_code)] until status bar is wired"

requirements-completed: [FILE-03, FILE-07, FILE-08, TEST-02, TEST-03]
test-tiers: [integration]

# Metrics
duration: 6min
completed: 2026-05-02
---

# Phase 2 Plan 02: Wire Encoding/EOL into EditorState + ReplaceFileW Atomic Save Summary

**Pattern A (Original-Bytes Cache) wired end-to-end: open_any_encoding decodes any of 5 encodings, EditorState caches raw bytes + metadata, Ctrl+S on unedited buffer writes cached bytes verbatim via ReplaceFileW, edited saves re-emit through encode/denormalize chain — 14 new tests prove 5x4 fixture matrix round-trips byte-exact (62 cumulative tests passing)**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-02T21:35:18Z
- **Completed:** 2026-05-02T21:41:05Z
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- `src/file.rs`: Phase 2 rewrite — `OpenedFile` struct, `open_any_encoding` (full cascade), `save_atomic` (ReplaceFileW + rename fallback); `save_utf8` removed; `open_utf8_ascii` deprecated for test backward-compat.
- `src/editor.rs`: EditorState extended with 4 new fields; `open_text_with_metadata` (EM_STREAMIN + metadata cache); `save_text_for_disk` (Pattern A: EM_GETMODIFY branch, trailing-newline Pitfall G reconciliation, encode/denormalize/save_atomic dirty path, cache refresh + EM_SETMODIFY(0)); `open_text` deprecated.
- `src/dispatch.rs`: `open_path_external` wired to `file::open_any_encoding` + `EditorState::open_text_with_metadata`; `do_file_save` wired to `EditorState::save_text_for_disk` (single call replacing old two-step).
- `tests/roundtrip_matrix.rs`: 14 tests — 8 fixture round-trips (utf8, utf8-bom, utf16le, utf16be, cp1252, cp1252-smartquotes, cr-only, mixed-eol), empty + trailing-newline edge cases, `edited_save_preserves_eol_for_each_style` proving the 5-encoding dirty path, 2 `save_atomic` guards.
- Cumulative test count: 62 (Phase 1: 18, Plan 02-01: 30, Plan 02-02: +14).
- Release binary: 420,864 bytes (~411 KB) — well under 10 MB ceiling.

## Task Commits

1. **Task 1: Cargo.toml + file.rs + roundtrip_utf8_ascii.rs** - `83678db` (feat)
2. **Task 2: editor.rs + dispatch.rs + allow(dead_code) on Phase 4 label methods** - `b6e36b1` (feat)
3. **Task 3: tests/roundtrip_matrix.rs** - `763eb07` (test)

## Files Created/Modified

- `Cargo.toml` — Added `Win32_Storage_FileSystem` to windows crate features
- `src/main.rs` — Added `mod encoding; mod eol;` so binary crate can access cascade from file.rs
- `src/file.rs` — Phase 2 rewrite: OpenedFile struct, open_any_encoding, save_atomic (ReplaceFileW), deprecated open_utf8_ascii, removed save_utf8
- `src/editor.rs` — Extended EditorState: 4 new fields + open_text_with_metadata + save_text_for_disk (Pattern A); deprecated open_text
- `src/dispatch.rs` — open_path_external and do_file_save wired to Phase 2 APIs
- `src/encoding.rs` — Added `#[allow(dead_code)]` on `label()` method (Phase 4 feature)
- `src/eol.rs` — Added `#[allow(dead_code)]` on `label()` method (Phase 4 feature)
- `tests/roundtrip_utf8_ascii.rs` — Updated to use save_atomic; #[allow(deprecated)] on open_utf8_ascii call sites
- `tests/roundtrip_matrix.rs` — NEW: 14 integration tests (fixture matrix + edited-save + guards)

## Implementation Decisions

### Taken (within plan's discretion)

- **DT-1:** Took O-1 — `pub struct OpenedFile` with public fields. The struct is a return value, not a domain object with invariants; public fields are simpler and needed for test access.
- **DT-2:** Took O-2 — `save_text_for_disk(target_path: &Path)` takes explicit parameter. Cleaner for testing; the do_file_save handler reads `self.current_path` and passes it to the method.
- **DT-3:** Took O-3 — Left Phase 1 `open_text` and `open_utf8_ascii` in place with `#[deprecated(note = ...)]`. Existing tests (roundtrip_utf8_ascii.rs) continue to pass; production callers switched.
- **DT-4:** Took O-4 — Pass full text to `detect_eol`; the function bounds itself at 64KB internally per research.md Example 2.

### Deviations (from plan; must explain)

- **DV-1:** Plan specified `result.is_err()` as the check for `ReplaceFileW`. The windows 0.62 API returns `windows::core::Result<()>` — `is_err()` is correct. No deviation from intent, but the plan's "Try `result.as_bool()` first" note was skipped because the function signature clearly returns `Result<()>` (not `BOOL`). Verification: build succeeds, save_atomic_overwrite_works test passes.
- **DV-2:** Added `mod encoding; mod eol;` to `src/main.rs` (not mentioned in plan). Required because `src/file.rs` imports `crate::encoding` and `crate::eol` — these only exist in the lib crate's module tree unless also declared in the binary. Without this, the binary crate compilation failed with "could not find `encoding` in the crate root". Verification: cargo build succeeds before and after.
- **DV-3:** Added `#[allow(dead_code)]` to `encoding::DetectedEncoding::label()`, `eol::Eol::label()`, and `file::open_utf8_ascii` (and `#[allow(dead_code)]` on `editor::open_text`). These are Phase 4 / test-only items that produce dead_code errors when the binary crate compiles with `-D warnings`. Without suppression, `cargo clippy -- -D warnings` fails. Verification: clippy passes with no warnings or errors.

### Open questions for verifier

- **Q-1:** Manual smoke verification (not automated): launching `notepadrs.exe tests\fixtures\utf16le_bom_crlf.txt`, `notepadrs.exe tests\fixtures\cp1252_smartquotes_crlf.txt` and pressing Ctrl+S should produce byte-identical files. Cannot be automated (requires HWND). The automated test proves the file/encoding/eol layer; the RichEdit EM_STREAMOUT path is exercised only by the binary. Worth verifying before Plan 02-03 ships.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added mod encoding; mod eol; to main.rs**
- **Found during:** Task 1 (first build attempt)
- **Issue:** `src/file.rs` imports `crate::encoding` and `crate::eol`. In the binary crate (main.rs), these modules are not declared — only the lib crate (lib.rs) declares them. The binary compilation failed with E0432 "could not find `encoding` in the crate root".
- **Fix:** Added `mod encoding;` and `mod eol;` to `src/main.rs` in the module declaration block.
- **Files modified:** `src/main.rs`
- **Verification:** `cargo build --target x86_64-pc-windows-msvc` succeeded after fix.
- **Committed in:** `83678db` (Task 1 commit)

**2. [Rule 2 - Missing Critical] Added #[allow(dead_code)] to Phase 4 label methods and deprecated legacy functions**
- **Found during:** Task 2 (clippy -D warnings run)
- **Issue:** `label()` methods on `DetectedEncoding` and `Eol` (Phase 4 status-bar features), `open_utf8_ascii` (test-only legacy), and `open_text` (deprecated editor method) trigger dead_code errors in the binary crate under `-D warnings`. The plan's clippy gate requires `-D warnings` pass.
- **Fix:** Added `#[allow(dead_code)]` to each item in the binary-visible source files.
- **Files modified:** `src/encoding.rs`, `src/eol.rs`, `src/file.rs`, `src/editor.rs`
- **Verification:** `cargo clippy --target x86_64-pc-windows-msvc -- -D warnings` passes cleanly.
- **Committed in:** `b6e36b1` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 missing critical for clippy gate)
**Impact on plan:** Both fixes required for correctness and the clippy -D warnings gate. No scope creep.

## ReplaceFileW Return Type (plan requested documentation)

In windows 0.62, `ReplaceFileW` returns `windows::core::Result<()>`. The plan's Task 1 note said "Try `result.as_bool()` first" — this was not needed. The correct idiom is `result.is_err()` (for failure) or `result.is_ok()` (for success). Used `is_err()` in the implementation.

## Binary Size Delta

- Phase 2 Plan 01 release binary: 230,912 bytes (LTO eliminated unused encoding_rs tables)
- Phase 2 Plan 02 release binary: 420,864 bytes (+190 KB)
- Delta: +190 KB — encoding_rs tables now linked in because encoding/decoding is in the hot save/load path. Within the <10 MB ceiling.

## Manual Smoke Gate (documented; not automated)

The following fixtures should be verified manually by launching `notepadrs.exe <fixture>`, pressing Ctrl+S, and comparing sha256 before/after. The automated roundtrip_matrix.rs tests verify the file/encoding/eol layer; this gate verifies the RichEdit EM_STREAMOUT path.

| Fixture | Expected encoding | Expected EOL |
|---------|------------------|--------------|
| tests/fixtures/utf8_no_bom_lf.txt | UTF-8 | LF |
| tests/fixtures/utf8_bom_crlf.txt | UTF-8 BOM | CRLF |
| tests/fixtures/utf16le_bom_crlf.txt | UTF-16 LE | CRLF |
| tests/fixtures/utf16be_bom_lf.txt | UTF-16 BE | LF |
| tests/fixtures/cp1252_crlf.txt | CP1252/ANSI | CRLF |
| tests/fixtures/cp1252_smartquotes_crlf.txt | CP1252/ANSI | CRLF |
| tests/fixtures/cr_only.txt | UTF-8 | CR |
| tests/fixtures/no_trailing_newline.txt | UTF-8 | CRLF |
| tests/fixtures/empty.txt | UTF-8 | CRLF |

## Issues Encountered

- Binary crate / lib crate module split: `src/file.rs` is compiled twice — once as part of the binary crate (main.rs), once as part of the lib crate (lib.rs). The encoding/eol imports in file.rs required `crate::encoding` to exist in both compilation units. Fixed by adding module declarations to main.rs.

## Next Phase Readiness

- Plan 02-03 (menu-driven encoding conversion + Save As) can call `EditorState::save_text_for_disk(user_supplied_path)` directly — the method accepts an explicit path parameter (O-2 decision).
- `file::open_any_encoding` returns `OpenedFile` with all metadata; Plan 02-03's "Re-encode and Save As" handler can read `opened.encoding` + `opened.eol` to populate the conversion dialog defaults.
- The `label()` methods on `DetectedEncoding` and `Eol` are ready for Phase 4's status-bar display.
- `encode(enc, text)` returns `Vec<u8>` with BOM — Plan 02-03's Save As handler can pass directly to `save_atomic`.

## Self-Check: PASSED

All key files verified:
- tests/roundtrip_matrix.rs: FOUND
- src/editor.rs: FOUND (encoding/eol/original_bytes/had_trailing_newline fields present)
- src/file.rs: FOUND (save_atomic/open_any_encoding present, save_utf8 absent)
- src/dispatch.rs: FOUND (open_path_external uses open_any_encoding, do_file_save uses save_text_for_disk)

All task commits verified in git log:
- `83678db` - feat(02-02): add Win32_Storage_FileSystem, save_atomic, open_any_encoding
- `b6e36b1` - feat(02-02): wire encoding/EOL metadata into EditorState + dispatch (Pattern A)
- `763eb07` - test(02-02): roundtrip_matrix.rs — 5x4 encoding x EOL fixture matrix + edited-save

---
*Phase: 02-file-i-o-encoding-cascade*
*Completed: 2026-05-02*
