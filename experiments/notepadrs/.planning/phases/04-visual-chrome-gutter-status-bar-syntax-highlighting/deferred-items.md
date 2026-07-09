# Phase 04 Deferred Items

## Pre-existing Clippy Lint Issues (out of scope for 04-01)

Discovered during Plan 04-01 Task 3 clippy `--tests` pass. These exist in test files
that predate Phase 4 and were NOT introduced by any 04-01 changes.

### 1. `tests/undo_property.rs:10:32` — `digits of hex, binary or octal literal not in groups of equal size`

Pre-existing since Phase 2/3. Not caused by 04-01 changes.

### 2. `tests/roundtrip_matrix.rs:40:37` — `collapsible_str_replace`: used consecutive `str::replace` calls

`scratch_path(&fixture.replace('/', "_").replace('\\', "_"))` should be
`scratch_path(&fixture.replace(['/', '\\'], "_"))`.

Pre-existing since Phase 2. Not caused by 04-01 changes.

**Impact:** `cargo clippy --tests -D warnings` fails on these two files.
`cargo clippy --lib --bins -D warnings` passes clean (no new issues from Phase 4 code).

**Recommended fix:** Fix both in a future chore commit or as part of Phase 5 polish.
