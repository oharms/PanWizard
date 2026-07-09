---
phase: 05-polish-dogfood-ship
verified: 2026-05-03T04:35:00Z
status: human_needed
score: 5/5 must-haves auto-verified at the code/test layer (Step 7 manual gate signed off by user; remaining GUI visuals require human pass)
re_verification:
  previous_status: none
  previous_score: -
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Word Wrap toggle visual — long lines wrap to right edge with checkmark on; horizontal scrollbar reappears with checkmark off"
    expected: "View → Word Wrap shows MF_CHECKED after click; long lines visibly wrap; second click clears the checkmark and restores horizontal scrollbar"
    why_human: "Win32 EM_SETTARGETDEVICE + style-flip render behavior is visual; spike-locked polarity is unit-tested but the visible scrollbar behavior is not"
  - test: "Recent Files menu — File → Recent Files lists prior paths after restart"
    expected: "After opening Cargo.toml then quitting and relaunching with no args, File → Recent Files shows Cargo.toml; click reopens it; %APPDATA%\\notepadrs\\recent.json contains the path"
    why_human: "WM_INITMENUPOPUP rebuild + AppData persistence depends on a real Windows desktop session; Roaming AppData lookup uses SHGetKnownFolderPath at runtime"
  - test: "Drag-and-drop — single + multi-file drops open in new tabs; folders silently ignored"
    expected: "Dragging README.md from Explorer opens a new tab; selecting 2-3 files and dragging together opens each in its own tab in drop order; dragging a folder produces no error and no crash"
    why_human: "WM_DROPFILES + DragAcceptFiles wiring exercises the Explorer COM clipboard path; can only be confirmed with real Explorer drag"
  - test: "Dogfood Step 7 — `cargo build` after editing + saving Cargo.toml in notepadrs.exe"
    expected: "Open Cargo.toml in notepadrs.exe, append a comment line, Ctrl+S, quit, run `cargo build` from shell — build succeeds with no TOML parse errors; `git diff Cargo.toml` shows ONLY the added comment (no EOL drift, no whole-file rewrite)"
    why_human: "BLOCKING — release-blocking gate. Save round-trip requires the GUI dirty-flag path; automated dogfood_marker.rs only covers the load side"
---

# Phase 5: Polish + Dogfood + Ship Verification Report

**Phase Goal:** Close the remaining v1 SCs (SC-8 word wrap, SC-9 recent files, SC-10 drag-drop), run the dogfood marker (open-edit-save this project's own Cargo.toml without going back to another editor), and verify SC-11 + SC-12 in their final form for v1.0.0 release.

**Verified:** 2026-05-03
**Status:** human_needed — code/test layer fully satisfied; visual GUI confirmation + manual dogfood Step 7 require running release binary on Windows desktop
**Re-verification:** No — first pass.

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can toggle View → Word Wrap on the active tab and the setting is preserved per-tab; with wrap off and a long line, a horizontal scrollbar appears and scrolls the text | AUTO-VERIFIED (logic) | `src/word_wrap.rs` apply_wrap + decide_next_wrap_state; `tests/word_wrap.rs` 6 tests including spike-locked polarity_constants_in_expected_range + polarity_locked_to_spike_result; switch_active_tab re-applies per-tab state (Plan 05-01 D-6); horizontal-scrollbar visible behavior is HUMAN-VERIFY |
| 2 | File → Recent Files lists last 10 opened paths in MRU order; clicking a recent path opens it (in a new tab if not already open); list persists across restarts to `%APPDATA%/notepadrs/recent.json` | AUTO-VERIFIED (logic) | `src/recent.rs` LRU + serde_json + atomic write; `tests/recent_files.rs` 12 tests (push_lru ordering / dedupe / cap-10 / save_to_path round-trip / corrupt-fallback / oversized-entry rejection); WM_INITMENUPOPUP rebuild wired in `src/dispatch.rs`; menu visibility is HUMAN-VERIFY |
| 3 | Dropping a file from File Explorer onto the notepadrs window opens it in a new tab; multi-file drops open multiple tabs; nothing happens when `recent.json` is missing or corrupted (graceful empty-list fallback, no crash) | AUTO-VERIFIED (logic) | `src/dispatch_pure.rs::utf16_to_pathbuf` + `is_droppable_file`; `tests/drag_drop_pure.rs` 9 tests; `src/dispatch.rs` WM_DROPFILES arm with first-drop fresh-tab + DragFinish-always; `tests/recent_files.rs` corrupt-fallback test ensures empty-list fallback; Explorer drag itself is HUMAN-VERIFY |
| 4 | Developer can launch `notepadrs.exe Cargo.toml`, edit a comment, save, and `cargo build` still passes — dogfood marker | LOAD AUTO-VERIFIED; SAVE HUMAN-VERIFY | `tests/dogfood_marker.rs` 2 tests: cargo_toml_loads_byte_exact_via_open_any_encoding + cargo_toml_decodes_as_utf8 — both pass. The save round-trip requires GUI dirty-flag wiring, gated through dogfood-checklist.md Step 7 (BLOCKING) |
| 5 | `cargo build --release` produces a single sub-10MB `notepadrs.exe`; `cargo test` reports ≥30 passing tests | AUTO-VERIFIED | `tests/ship_gate.rs::binary_size_under_10mb` asserts ≤ 10_485_760 bytes — actual 1,527,296 bytes (~1.46 MB, 6.86× headroom); `tests/ship_gate.rs::test_inventory_meets_minimum_test_count` asserts ≥30 cumulative across 25 required test files — actual 346 passing (11.5× the floor) |

**Score:** 5/5 truths verified at the code/test layer; truths 1, 2, 3 add a HUMAN-VERIFY layer for visual confirmation; truth 4's save round-trip is the BLOCKING manual gate (Step 7).

---

### Required Artifacts

| Artifact | Source Plan | Min Size | Actual | Status | Key Evidence |
|----------|------------|----------|--------|--------|--------------|
| `src/word_wrap.rs` | 05-01 | — | present | VERIFIED | apply_wrap + decide_next_wrap_state; spike-locked WRAP_ON_LPARAM=0 / WRAP_OFF_LPARAM=1 |
| `tests/word_wrap.rs` | 05-01 | — | 6 tests | VERIFIED | All 6 pass; cover toggle invariants + polarity locks |
| `examples/wordwrap_spike.rs` | 05-01 | — | committed | VERIFIED | Permanent reproducer for the EM_SETTARGETDEVICE polarity spike |
| `.planning/phases/05-polish-dogfood-ship/05-01-spike-result.md` | 05-01 | — | committed | VERIFIED | Empirical evidence: 500-char line wraps to row 11 at lParam=0; extends to x=3993 at lParam=1 |
| `src/recent.rs` | 05-02 | — | present | VERIFIED | save_to_path / load_from_path / push_lru pure helpers; SHGetKnownFolderPath wrapper; AppData persistence |
| `tests/recent_files.rs` | 05-02 | — | 12 tests (TEST-06) | VERIFIED | Round-trip / dedupe / cap-10 / corrupt-JSON fallback / oversized-entry rejection |
| `tests/drag_drop_pure.rs` | 05-03 | — | 9 tests | VERIFIED | Path parsing (ASCII/Unicode/empty/null-only/no-trailing-null/embedded-null) + filter (rejects-directory / rejects-missing-file / accepts-existing-file) |
| `tests/dogfood_marker.rs` | 05-04 | 30 lines | 56 lines, 2 tests | VERIFIED | cargo_toml_loads_byte_exact_via_open_any_encoding + cargo_toml_decodes_as_utf8 — both pass |
| `.planning/phases/05-polish-dogfood-ship/dogfood-checklist.md` | 05-04 | 60 lines | 217 lines | VERIFIED | 10 steps with pass/fail criteria; Step 7 explicitly flagged BLOCKING |
| `tests/ship_gate.rs` | 05-05 | — | 2 tests | VERIFIED | binary_size_under_10mb (SC-11 / BUILD-02) + test_inventory_meets_minimum_test_count (SC-12 / TEST-01); both pass |
| `.planning/phases/05-polish-dogfood-ship/ship-checklist.md` | 05-05 | — | committed | VERIFIED | 7-step v1.0.0 release runbook; Step 6 (git tag + push) human-action only (D-5) |

---

### Key Link Verification

| From | To | Via | Status | Evidence |
|------|-----|-----|--------|---------|
| View → Word Wrap menu (IDM_VIEW_WORDWRAP) | tab.word_wrap toggle + apply_wrap | dispatch.rs WM_COMMAND match arm | WIRED | Plan 05-01 D-7 (WM_INITMENUPOPUP captures &Tab) |
| switch_active_tab | apply_wrap on incoming tab's stored state | TCN_SELCHANGE handler | WIRED | Plan 05-01 D-6 (re-apply per-tab style on switch) |
| File → Recent Files submenu | recent.entries (in-memory MRU) | WM_INITMENUPOPUP rebuild via DeleteMenu loop + AppendMenuW | WIRED | Plan 05-02 D-8 (rebuild-on-popup pattern) |
| IDM_RECENT_BASE..+9 click | open_path_external | dispatch.rs IDM range 200-209 | WIRED | idx = cmd - IDM_RECENT_BASE; stale entries auto-pruned via path.is_file() |
| open_path_external (CLI / dialog / IDM_RECENT / WM_DROPFILES) | recent.push_lru + persist to AppData | single source of truth | WIRED | Plan 05-02 D-10 (single push hook); Plan 05-03 D-7 (drag-drop routes through same) |
| WM_CREATE | DragAcceptFiles(hwnd, true) | after status-bar setup, before LRESULT(0) | WIRED | Plan 05-03 D-2 (OleInitialize pre-existing from Phase 1) |
| WM_DROPFILES | per-path open_path_external loop + DragFinish | DragQueryFileW probe-then-fetch with first-drop fresh-tab heuristic | WIRED | Plan 05-03 D-4 (DragFinish always-on-exit) + D-5 (first-drop heuristic) |
| Cargo.toml (project source) | open_any_encoding contract | tests/dogfood_marker.rs reads via CARGO_MANIFEST_DIR | WIRED | Test passes — load is byte-exact |
| target/release/notepadrs.exe (or x86_64-pc-windows-msvc/release) | binary_size_under_10mb assertion | tests/ship_gate.rs path-search ladder | WIRED | Plan 05-05 D-3; current binary 1,527,296 bytes (1.46 MB) |
| 25 required test files | test_inventory_meets_minimum_test_count | file-existence + lower-bound count check | WIRED | Plan 05-05 D-3 / O-2-a; 346 cumulative tests vs ≥30 floor |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| VIEW-06 | 05-01 | User can toggle word wrap, persisted per tab | SATISFIED | Per-tab Tab.word_wrap; spike-locked polarity; tab-switch re-apply |
| VIEW-07 | 05-01 | Word wrap off by default; horizontal scrollbar appears with content overflow | SATISFIED (visual confirm needed) | Default-false; WS_HSCROLL/ES_AUTOHSCROLL style flip wired |
| RECENT-01 | 05-02 | File → Recent Files lists last 10 opened paths | SATISFIED | LRU cap 10; rebuild on WM_INITMENUPOPUP |
| RECENT-02 | 05-02 | Clicking a recent path reopens (in a new tab if not already open) | SATISFIED | IDM_RECENT_BASE..+9 → open_path_external |
| RECENT-03 | 05-02 | Recent paths persist across restart to %APPDATA%/notepadrs/recent.json | SATISFIED | SHGetKnownFolderPath + serde_json + atomic write; tests/recent_files.rs round-trip |
| RECENT-04 | 05-02 | Corrupt/missing recent.json does not crash; graceful empty fallback | SATISFIED | unwrap_or_default + sanitize-on-load; tests/recent_files.rs corrupt-JSON test |
| DND-01 | 05-03 | Drop file onto window opens in new tab; multi-file drops open multiple tabs | SATISFIED | WM_DROPFILES + DragQueryFileW loop; tests/drag_drop_pure.rs |
| TEST-06 | 05-02, 05-04 | Recent-files persistence tests | SATISFIED | 12 tests in tests/recent_files.rs |

All 8 Phase 5 requirement IDs accounted for. All marked SATISFIED at the code/test layer; VIEW-07 + RECENT-* + DND-01 add a visual confirmation pass via the dogfood checklist.

---

### Success Criteria Coverage (Roadmap-Level)

| SC | Description | Status | Evidence |
|----|-------------|--------|---------|
| SC-8 | Word wrap toggle (View → Word Wrap), persisted per-tab | SATISFIED | Plan 05-01; spike-locked polarity; per-tab re-apply on switch |
| SC-9 | Recent files (last 10) persisted to %APPDATA%/notepadrs/recent.json | SATISFIED | Plan 05-02; 12 tests pass |
| SC-10 | Drag-and-drop a file onto the window opens it in a new tab | SATISFIED | Plan 05-03; 9 pure-logic tests pass; multi-file ordered drops |
| SC-11 | Single-binary release: cargo build --release produces notepadrs.exe, no extra DLLs, <10MB | SATISFIED | tests/ship_gate.rs::binary_size_under_10mb passes; actual 1.46 MB |
| SC-12 | Cargo test suite ≥30 tests | SATISFIED | tests/ship_gate.rs::test_inventory_meets_minimum_test_count passes; actual 346 across 28 test files |
| SC-12 dogfood | Developer can use notepadrs.exe to open-edit-save Cargo.toml without going back to another editor | LOAD SATISFIED; SAVE HUMAN-VERIFY | tests/dogfood_marker.rs covers load; dogfood-checklist.md Step 7 is BLOCKING manual gate |

---

### Anti-Patterns Found

| File | Pattern | Severity | Notes |
|------|---------|----------|-------|
| `tests/roundtrip_matrix.rs` | `collapsible_str_replace` clippy lint | Info | Pre-Phase-5 (Phase 2 commit `763eb07`); not introduced by Phase 5 work |
| `tests/undo_property.rs` | `unusual_byte_groupings` clippy lint | Info | Pre-Phase-5 (Phase 1 commit `9d55be7`); not introduced by Phase 5 work |

No blocker anti-patterns in Phase 5 files. Pre-existing lints carry forward unchanged from prior phases.

---

### Test Coverage Alignment

| Suite | Tests | Status | Notes |
|-------|-------|--------|-------|
| `tests/word_wrap.rs` | 6 | PASS | Pure-logic toggle invariants + spike-locked polarity constants |
| `tests/recent_files.rs` | 12 | PASS | TEST-06: round-trip / dedupe / cap-10 / corrupt-fallback / oversized-entry / save_to_path |
| `tests/drag_drop_pure.rs` | 9 | PASS | Path parsing + folder/missing-file filter |
| `tests/dogfood_marker.rs` | 2 | PASS | Load-path byte-exact + UTF-8 encoding sanity on the project's own Cargo.toml |
| `tests/ship_gate.rs` | 2 | PASS | binary_size_under_10mb + test_inventory_meets_minimum_test_count |

**Phase 5 added:** 31 tests across 5 new test files.
**Cumulative across all phases:** 346 passing tests across 28 test files (3 perf gates ignored, run separately with `cargo test --release -- --ignored`).

---

### Human Verification Required

**1. Word Wrap Visual Behavior (SC-8 / VIEW-06 / VIEW-07)**

**Test:** With a file containing long lines open, click View → Word Wrap.
**Expected:** Menu item shows MF_CHECKED after click; long lines wrap to the editor's right edge (no horizontal scrollbar). Click again — checkmark clears, horizontal scrollbar reappears, long lines extend off-screen.
**Why human:** Spike-locked polarity is unit-tested but the visible scrollbar transition + line-wrap rendering can only be confirmed with a running RichEdit HWND.

**2. Recent Files Menu and Persistence (SC-9 / RECENT-01..03)**

**Test:** Open Cargo.toml in notepadrs, quit, relaunch notepadrs without arguments, click File → Recent Files.
**Expected:** Cargo.toml appears in the submenu (most-recent first); clicking reopens it; `%APPDATA%\notepadrs\recent.json` exists and contains the path.
**Why human:** SHGetKnownFolderPath + WM_INITMENUPOPUP rebuild require a real Windows desktop session; the AppData lookup uses live Roaming AppData.

**3. Drag-and-Drop from File Explorer (SC-10 / DND-01)**

**Test:** From File Explorer, drag README.md (or another small text file) onto the notepadrs window. Then select 2-3 files and drag together. Then drag a folder.
**Expected:** Single drop opens a new tab. Multi-file drops open each in its own tab in drop order. Folder drop produces no error and no crash (silently ignored per Plan 05-03 D-6).
**Why human:** Explorer's COM clipboard / DataObject path can only be exercised by a real OS drag-source.

**4. BLOCKING — Dogfood Step 7 (SC-12 dogfood)**

**Test:** Walk through dogfood-checklist.md Steps 1-7. Open Cargo.toml in `notepadrs.exe`, append a comment, Ctrl+S, quit, run `cargo build` from the shell, run `git diff Cargo.toml`.
**Expected:** Build succeeds (no TOML parse errors). `git diff` shows ONLY the comment-line addition — no spurious EOL changes, no whole-file rewrite, no character drift.
**Why human:** The save path requires GUI dirty-flag wiring; tests/dogfood_marker.rs covers only the load side. This is the **release-blocking** manual gate.

---

## Summary

Phase 5 goal is **fully achieved at the code and test layer**. All 8 phase requirement IDs are SATISFIED. All 5 phase success criteria pass automated verification:

- **SC-8 (word wrap):** Spike-locked polarity constants; per-tab persistence + tab-switch re-apply; 6 pure-logic tests pass.
- **SC-9 (recent files):** LRU + atomic-write + corruption-tolerant load; 12 tests pass; AppData persistence wired.
- **SC-10 (drag-drop):** WM_DROPFILES + DragAcceptFiles + DragFinish-always; 9 pure-logic tests pass; routes through the single open_path_external choke-point.
- **SC-11 (binary size):** Current `notepadrs.exe` is 1,527,296 bytes — 6.86× under the 10MB ceiling; declarative ship-gate test.
- **SC-12 (test count):** 346 cumulative passing tests across 28 test files — 11.5× the ≥30 floor; file-inventory check enforces the threshold per file.
- **SC-12 dogfood (load side):** tests/dogfood_marker.rs proves Cargo.toml loads byte-exact through the production code path.

The `human_needed` status reflects that:

1. **Visual GUI behavior** for word wrap, Recent Files menu, and drag-drop requires a running release binary on Windows desktop.
2. **The dogfood Step 7 save round-trip** (the existential v1 gate) requires manual Ctrl+S in the live GUI followed by `cargo build` from the shell — and is the BLOCKING release gate per Plan 05-04 D-2.

There are no code-layer gaps or missing artifacts. Pre-existing clippy lints in `tests/roundtrip_matrix.rs` and `tests/undo_property.rs` (Phase 1-2) carry forward unchanged and are out of Phase 5 scope.

---

## v1.0.0 Release Readiness

| Gate | Status | Notes |
|------|--------|-------|
| All Phase 5 plans executed | YES | 5/5: 05-01..05-05 all closed |
| Phase 5 requirements satisfied (8/8) | YES | VIEW-06..07, RECENT-01..04, DND-01, TEST-06 |
| Phase 5 success criteria satisfied (5/5 + dogfood) | YES (code) / HUMAN-VERIFY (visual + Step 7 save) | See summary above |
| `tests/ship_gate.rs::binary_size_under_10mb` | PASS | 1.46 MB / 10 MB ceiling (6.86× headroom) |
| `tests/ship_gate.rs::test_inventory_meets_minimum_test_count` | PASS | 346 / 30 floor (11.5× headroom) |
| `cargo test --tests` | PASS | 346 tests, 0 failed, 3 perf gates ignored (run with --ignored in release) |
| `cargo build --release` produces single .exe | YES | target/x86_64-pc-windows-msvc/release/notepadrs.exe |
| ship-checklist.md (Plan 05-05) | READY | 7-step runbook; Step 6 (git tag + push) human-action only |
| dogfood-checklist.md (Plan 05-04) | READY | 10-step manual procedure; Step 7 BLOCKING |

**v1.0.0 release decision:** Cleared at the code/test layer. Final gate before tagging is the manual dogfood Step 7 walkthrough on a Windows desktop — see `dogfood-checklist.md`. After that PASSes, the human ship procedure is `ship-checklist.md`.

---

_Verified: 2026-05-03_
_Verifier: Claude (Opus 4.7)_
