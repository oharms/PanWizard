---
phase: 01-foundations-editor-spine
plan: 04
status: complete
date: 2026-05-02
---

# Plan 01-04 Summary - Undo Property Test (TEST-05 contract)

## What landed

A pure-logic `UndoModel` in `src/undo_model.rs` that captures the Phase-1 undo contract:
- bounded ring at UNDO_LIMIT=1000 with FIFO eviction;
- single buffer-mutation chokepoint (`apply()`) that always clears the redo stack;
- `redo(undo(state)) == state` for arbitrary apply sequences;
- explicit-boundary coalescing (commit_group()), with deletes auto-breaking groups.

`src/lib.rs` re-exports `pub mod undo_model;` so the integration test can import via `notepadrs::undo_model::UndoModel`. `Cargo.toml` now has `[lib]` and `[[bin]]` entries (both targets coexist - cargo allows it).

## Final UndoModel API

```rust
pub const UNDO_LIMIT: usize = 1000;

pub enum Edit {
    Insert { at: usize, bytes: Vec<u8> },
    Delete { at: usize, bytes: Vec<u8> },
}

pub struct UndoModel { /* private fields */ }

impl UndoModel {
    pub fn new() -> Self;
    pub fn from_bytes(bytes: Vec<u8>) -> Self;
    pub fn state(&self) -> &[u8];
    pub fn apply(&mut self, edit: Edit) -> Result<(), String>;
    pub fn commit_group(&mut self);
    pub fn undo(&mut self) -> bool;
    pub fn redo(&mut self) -> bool;
    pub fn undo_depth(&self) -> usize;
    pub fn redo_depth(&self) -> usize;
}

impl Default for UndoModel { /* */ }
```

## Implementation deviation from plan

The plan suggested storing the *inverse* of each forward edit on the undo stack. I implemented the simpler dual: store the *forward* edit on the undo stack and recompute the inverse at undo time. The two are equivalent in correctness but the forward-edit storage is more obvious to reason about:

- `apply(edit)` mutates the buffer forward and pushes the original `edit` onto undo_stack.
- `undo()` pops the step, replays each forward edit in *reverse* order with the inverse operation: an Insert becomes a drain, a Delete becomes a splice. Then pushes the same step (forward edits, original order) onto redo_stack.
- `redo()` pops from redo_stack and replays forward edits in original order.

This avoids the "inverse-of-inverse" reasoning cited as subtle in the plan's note. All 6 property tests pass.

## Test count

After Plan 01-04, cumulative test count is **15 tests** across 4 test binaries:
- `cargo_profile`: 1
- `com_init`: 2
- `panic_safety`: 6
- `undo_property`: 6

Phase 1's TEST-01 target is ≥30; Plan 01-03 will add ~3 round-trip tests bringing the total to ~18, and Phase 2's encoding round-trips will easily clear the remaining ~12 needed.

## `[lib]` interaction with Plan 01-03

Plan 01-04 created `src/lib.rs` and added `[lib]` + `[[bin]]` to `Cargo.toml`. Plan 01-03's `tests/roundtrip_utf8_ascii.rs` was originally planned to use the `#[path = "..."]` trick to inline `src/file.rs` and `src/error.rs`. Now that `[lib]` exists, Plan 01-03 has two valid paths:

1. **(Recommended)** Re-export `pub mod file;` and `pub mod error;` in `src/lib.rs`, then have the test import them from the lib (cleaner, avoids `#[path]` headache).
2. Keep the `#[path]` trick (still works because the bin still has `src/file.rs` etc. as private modules).

Either is fine - 01-03 will pick.

## Test seed determinism

The property test uses a hand-rolled LCG with seed `0xC0FFEE` (per D-5). 32 random trials of 30-80 ops each pass deterministically. The `rand` crate is not on the allowlist, so this LCG is a 10-LOC handroll.

## Phase 2 open questions

- **Wall-clock idle-timeout coalescing.** Currently the model uses *explicit* boundaries only (`commit_group()`). Wall-clock idle-timeout coalescing (group inserts within N ms of each other) is non-deterministic and unsuitable for `cargo test`; the project plan defers it to Phase 4 when an event-loop hook can drive deterministic group-end events.
- **Wiring into editor.rs.** Phase 1 keeps RichEdit's built-in undo. Phase 2's per-tab encoding state may need per-tab undo - that's the natural point to wire the `UndoModel` in.

## Verification results

- `cargo build --release --target x86_64-pc-windows-msvc` succeeds; binary still 209,920 bytes (no growth - undo_model is small).
- `cargo clippy --release --target x86_64-pc-windows-msvc -- -D warnings` passes.
- `cargo test --target x86_64-pc-windows-msvc --test undo_property` passes 6 tests deterministically.
- `cargo test --target x86_64-pc-windows-msvc` passes 15 tests cumulative.

## Self-Check: PASS

- [x] `src/undo_model.rs` with full API.
- [x] `src/lib.rs` re-exports `pub mod undo_model`.
- [x] `Cargo.toml` `[lib]` + `[[bin]]` entries.
- [x] `tests/undo_property.rs` 6 tests, all passing.
- [x] `redo(undo(s)) == s` invariant verified for 32 random trials.
- [x] FIFO bound at 1000 enforced and tested.
- [x] Coalescing rules tested (group, commit_group, delete-break).
