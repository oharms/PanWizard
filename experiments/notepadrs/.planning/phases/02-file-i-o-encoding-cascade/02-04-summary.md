---
phase: 02-file-i-o-encoding-cascade
plan: 04
subsystem: file-io
tags: [error-handling, timeout, pattern-e, mpsc, FormatMessageW, FILE-11, categorized-errors]

# Dependency graph
requires:
  - phase: 02-file-i-o-encoding-cascade
    plan: 03
    provides: dispatch_pure.rs module with encoding_change_decision + eol_change_decision
  - phase: 02-file-i-o-encoding-cascade
    plan: 02
    provides: open_any_encoding (full encoding cascade), OpenedFile struct, save_atomic
  - phase: 02-file-i-o-encoding-cascade
    plan: 01
    provides: EncodingDetectFailed error variant reserved for this plan

provides:
  - Error::FileNotFound(String), Error::PermissionDenied(String), Error::OpenTimeout(String)
    variants with user-facing Display messages
  - file::read_with_timeout<F> (Pattern E) — worker thread + mpsc::recv_timeout with
    configurable timeout and deterministic-test injection point
  - open_any_encoding uses read_with_timeout(5s) — UI thread protected from network-share hangs
  - dispatch_pure::categorize_open_error_with_os_msg — pure error-to-message mapping,
    testable with stub os_msg_provider closure
  - dispatch::categorize_open_error + format_last_error — Win32 wrapper supplying real
    FormatMessageW-based OS message
  - dispatch::open_path_external updated to use categorize_open_error on Err (FILE-11 UX)
  - tests/open_errors.rs — 11 unit tests covering all 5 error variants + timeout mechanism

affects: [03-find-replace]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Pattern E (read_with_timeout): worker thread + mpsc::recv_timeout for bounded-timeout
      file reads; generic closure parameter enables deterministic test injection
    - categorize_open_error_with_os_msg: pure dispatch helper with injected OS message
      provider — same dispatch_pure split pattern from Plan 02-03
    - format_last_error: FormatMessageW wrapper for OS-localized error text (Win32_System_Diagnostics_Debug)
    - Worker-thread leak: acceptable for v1; one leaked thread per timed-out call (bounded)

key-files:
  created:
    - tests/open_errors.rs
  modified:
    - src/error.rs
    - src/file.rs
    - src/dispatch.rs
    - src/dispatch_pure.rs

key-decisions:
  - "D-1 followed: FileNotFound/PermissionDenied/OpenTimeout added to error.rs; EncodingDetectFailed Display updated to user-facing form"
  - "D-2 followed: read_with_timeout<F> generic over FnOnce work closure; std::thread::spawn + mpsc::recv_timeout"
  - "D-3 followed: 5s default timeout in open_any_encoding"
  - "D-4 followed: open_any_encoding uses read_with_timeout internally; public signature unchanged"
  - "D-5 followed: categorization at file layer for NotFound/PermissionDenied (deterministic ErrorKind); Io for ambiguous"
  - "D-6 followed: categorize_open_error_with_os_msg in dispatch_pure.rs with provider closure; dispatch.rs thin wrapper supplies FormatMessageW provider"
  - "D-7 confirmed: Win32_System_Diagnostics_Debug already in Cargo.toml (Phase 1); no Cargo.toml changes"
  - "D-9 followed: worker thread leaked on timeout (bounded, acceptable for v1)"
  - "D-10 followed: timeout tests use synthetic slow worker (100ms timeout, 500ms sleep) — no 5s wait"
  - "O-1 taken: read_with_timeout is pub (symmetric with open_any_encoding, accessible from tests)"
  - "O-2 taken: match in dispatch_pure.rs (idiomatic Rust; categorize_open_error_with_os_msg uses match over variants)"
  - "O-3 taken: deferred — no Cancel button on open; complexity disproportionate to v1 benefit"
  - "O-4 taken: fallback hint is actionable English ('Check that the file is not open...')"

patterns-established:
  - "read_with_timeout pattern: use for any blocking I/O that could hang on network resources"
  - "Error categorization: file layer handles deterministic ErrorKinds; dispatch layer handles UI text"
  - "Testable Win32 helpers: inject OS message via closure to dispatch_pure, supply real FormatMessageW in dispatch"

requirements-completed: [FILE-11]
test-tiers: [integration]

# Metrics
duration: 20min
completed: 2026-05-02
---

# Phase 2 Plan 04: FILE-11 Categorized Open Errors + Pattern E read_with_timeout Summary

**read_with_timeout (Pattern E) protects the UI thread from network-share hangs, four FILE-11 error paths (file-not-found, permission-denied, timeout, encoding-detect-fail) each produce distinct user-facing MessageBox messages via categorize_open_error_with_os_msg in dispatch_pure.rs — 83 cumulative tests passing, Phase 2 requirements complete**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-05-02T23:55:00Z
- **Completed:** 2026-05-03T00:15:00Z
- **Tasks:** 3
- **Files modified:** 4 modified + 1 created

## Accomplishments

- `src/error.rs`: 3 new Error variants (FileNotFound, PermissionDenied, OpenTimeout) + updated Display arms — EncodingDetectFailed Display updated to user-facing form matching D-6 spec.
- `src/file.rs`: `read_with_timeout<F>` (Pattern E) — generic over work closure, spawns `std::thread::spawn`, waits with `mpsc::recv_timeout`. Categorizes `NotFound`/`PermissionDenied` ErrorKinds at file layer; all other errors pass through as `Error::Io`. `open_any_encoding` updated to call `read_with_timeout(path, Duration::from_secs(5), ...)` instead of bare `std::fs::read`.
- `src/dispatch_pure.rs`: `categorize_open_error_with_os_msg` — pure match over all Error variants, each producing a distinct bespoke user-facing string. Takes `os_msg_provider: impl Fn() -> Option<String>` closure so tests can inject stub messages without Win32.
- `src/dispatch.rs`: `format_last_error` — FormatMessageW wrapper for OS-localized error text. `categorize_open_error` — thin wrapper supplying real FormatMessageW provider to the pure helper. `open_path_external` updated to call `categorize_open_error` on Err (FILE-11 UX; existing buffer is never overwritten on error).
- `tests/open_errors.rs`: 11 tests — 6 categorization (FileNotFound, PermissionDenied with/without OS msg, OpenTimeout, EncodingDetectFailed, generic Io) + 4 read_with_timeout (fast path, file-not-found, deterministic 100ms timeout, zero-ms smoke) + open_any_encoding missing-file end-to-end.
- Cumulative test count: 83 (72 baseline + 11 new). Binary: 463,360 bytes (~452 KB).

## Task Commits

1. **Task 1: error.rs new variants + file.rs read_with_timeout** - `42ab91a` (feat)
2. **Task 2: dispatch.rs categorize_open_error + format_last_error + open_path_external** - `2bcaa39` (feat)
3. **Task 3: tests/open_errors.rs + OpenedFile #[derive(Debug)]** - `06f3f0c` (test)

## Files Created/Modified

- `src/error.rs` — 3 new Error variants (FileNotFound, PermissionDenied, OpenTimeout) with Display arms
- `src/file.rs` — read_with_timeout<F> (Pattern E) + open_any_encoding uses 5s timeout; #[derive(Debug)] on OpenedFile
- `src/dispatch.rs` — format_last_error, categorize_open_error (thin wrapper), open_path_external updated
- `src/dispatch_pure.rs` — categorize_open_error_with_os_msg appended (extending Plan 02-03's file)
- `tests/open_errors.rs` — NEW: 11 unit tests

## Implementation Decisions

### Taken (within plan's discretion)

- **DT-O1:** `read_with_timeout` is `pub` (O-1). Symmetric with `open_any_encoding`; accessible from `tests/open_errors.rs` without special visibility. Constraints satisfied.

- **DT-O2:** `categorize_open_error_with_os_msg` uses `match` on Error variants (O-2). Idiomatic Rust; the helper-method approach is over-engineered for 5 variants. All 5 variants have distinct arms.

- **DT-O3:** No Cancel button on the open-in-progress path (O-3). Complexity is disproportionate to v1 benefit: requires WM_USER+N back-channel from a button click to interrupt `recv_timeout`. Deferred. The design path: post `WM_APP_CANCEL_OPEN` from a Cancel button handler; `read_with_timeout` would need a `cancel_flag: Arc<AtomicBool>` parameter and the worker thread would check it. Document for v1.x.

- **DT-O4:** PermissionDenied fallback is "Check that the file is not open in another program and that you have read permission." (O-4). Actionable English; users who want raw error codes can read the kernel debugger.

- **DT-impl:** Implemented `categorize_open_error_with_os_msg` in `dispatch_pure.rs` from the start rather than inlining logic in `dispatch.rs` first and refactoring in Task 3. The plan's Task 3 note says "Task 2 may have inlined the match logic; this task moves the match into dispatch_pure.rs". Going directly to the clean final design saves the intermediate refactor step and produces the same result.

### Deviations (from plan; must explain)

No deviations from plan intent. One auto-fix applied:

- **DV-auto:** `#[derive(Debug)]` added to `OpenedFile` (Rule 1 auto-fix). Found during Task 3 compilation of `tests/open_errors.rs` — the test's `panic!` format string `{:?}` requires `Debug` on `Result<OpenedFile, _>`. `OpenedFile` had no `Debug` impl. Fix: added `#[derive(Debug)]` to `OpenedFile` in `src/file.rs`. No semantic change; all existing tests still pass. Committed in `06f3f0c`.

### Open questions for verifier

- **Q-1:** Manual smoke required for PermissionDenied and network-share-hang paths (cannot be automated):
  - `notepadrs.exe C:\Windows\System32\config\SAM` — should show "Access denied: ..." MessageBox. The FormatMessageW text will be OS-locale-dependent.
  - Network-share timeout: requires a real SMB share that hangs. Test on a paused VM mount or by pointing at `\\127.0.0.1\nonexistent\file.txt` (likely returns NotFound quickly rather than hanging). Genuine 5s timeout proof requires manual test on an unresponsive share.
- **Q-2:** The leaked worker thread on timeout is documented in code comments and D-9. If real-world usage shows multiple rapid open attempts on a hanging share, thread accumulation should be monitored. `CancelSynchronousIo` path is documented in D-9 for v1.x if needed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added #[derive(Debug)] to OpenedFile**
- **Found during:** Task 3 (first `cargo test --test open_errors` compile)
- **Issue:** `tests/open_errors.rs` uses `{:?}` format in `panic!` for `Result<OpenedFile, Error>`. `OpenedFile` had no `Debug` impl, causing compile error E0277.
- **Fix:** Added `#[derive(Debug)]` to `pub struct OpenedFile` in `src/file.rs`.
- **Files modified:** `src/file.rs`
- **Verification:** `cargo test --test open_errors` compiled and all 11 tests passed.
- **Committed in:** `06f3f0c`

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug/compile error)
**Impact on plan:** Required for test compilation. No semantic change to existing behaviour. No scope creep.

## FILE-11 Error Cases — Automated Coverage

| Case | Error variant | Test | Message contains |
|------|--------------|------|-----------------|
| File not found | FileNotFound | `categorize_file_not_found`, `read_with_timeout_returns_file_not_found_error`, `open_any_encoding_categorizes_missing_file` | "File not found" |
| Permission denied | PermissionDenied | `categorize_permission_denied_with_os_msg`, `categorize_permission_denied_fallback_message` | "Access denied" |
| Network-share hang | OpenTimeout | `categorize_open_timeout`, `read_with_timeout_fires_on_slow_worker` | "timed out (5s)", "network share" |
| Encoding detect fail | EncodingDetectFailed | `categorize_encoding_detect_failed` | "Could not detect encoding" |

Manual smoke (not automated):
- PermissionDenied: `notepadrs.exe C:\Windows\System32\config\SAM` — window opens, "Access denied:" dialog, editor remains usable.
- Network-share timeout: requires paused VM with SMB mount — documented as manual gate; the automated `read_with_timeout_fires_on_slow_worker` test proves the mechanism with a 100ms synthetic timeout.

## Binary Size Delta

- Plan 02-03 release binary: 427,008 bytes
- Plan 02-04 release binary: 463,360 bytes (+36 KB)
- Delta: +36 KB — FormatMessageW + mpsc/thread runtime + error formatting code. Within 10 MB ceiling.
- Note: `Win32_System_Diagnostics_Debug` was already in Cargo.toml features (added in Phase 1); the delta is primarily the new error formatting and dispatch code.

## Phase 2 Requirements Coverage Summary

All 11 Phase 2 requirements are now complete:

| Req ID | Plan | Description |
|--------|------|-------------|
| FILE-03 | 02-02 | Encoding cascade open |
| FILE-04 | 02-03 | Encoding conversion menu |
| FILE-07 | 02-02 | EditorState encoding/EOL metadata |
| FILE-08 | 02-02 | Atomic save (ReplaceFileW) |
| FILE-09 | 02-03 | Save As with encoding/EOL picker |
| FILE-10 | 02-03 | EOL conversion menu |
| FILE-11 | 02-04 | Categorized open errors + timeout |
| TEST-02 | 02-02 | Round-trip fixture matrix |
| TEST-03 | 02-02 | Edited-save EOL preservation |

Phase 2 is ready for `/pan:verify-phase 2`.

## Self-Check: PASSED

Key files verified:
- src/error.rs: FOUND (FileNotFound, PermissionDenied, OpenTimeout variants present)
- src/file.rs: FOUND (read_with_timeout present, open_any_encoding uses it)
- src/dispatch.rs: FOUND (format_last_error, categorize_open_error present)
- src/dispatch_pure.rs: FOUND (categorize_open_error_with_os_msg present)
- tests/open_errors.rs: FOUND (11 tests)

Commits verified in git log:
- `42ab91a` - feat(02-04): add FileNotFound/PermissionDenied/OpenTimeout variants + read_with_timeout
- `2bcaa39` - feat(02-04): categorize_open_error + format_last_error + open_path_external FILE-11 UX
- `06f3f0c` - test(02-04): open_errors.rs — 11 tests for FILE-11 categorization + read_with_timeout

---
*Phase: 02-file-i-o-encoding-cascade*
*Completed: 2026-05-02*
