# Ship Checklist — notepadrs v1.0.0

This is the runbook for cutting the v1.0.0 release after Phase 5 plans
05-01 through 05-04 have completed. Each step is a verification gate;
failure on any blocking step pauses the release.

---

## Pre-flight: dependencies on prior plans

- [ ] **05-01** (word wrap) closed — see `05-01-summary.md`
- [ ] **05-02** (recent files + TEST-06) closed — see `05-02-summary.md`
- [ ] **05-03** (drag-drop) closed — see `05-03-summary.md`
- [ ] **05-04** (dogfood marker) closed; Step 7 PASSED — see `05-04-summary.md`
- [ ] **05-05** (this plan) automated gates green — see test results below

## Step 1: Clean release build

```
cargo clean
cargo build --release
```

- [ ] Build completes without errors
- [ ] `target/release/notepadrs.exe` (or
      `target/x86_64-pc-windows-msvc/release/notepadrs.exe`) exists

## Step 2: Automated ship gate

```
cargo test --test ship_gate
```

- [ ] `binary_size_under_10mb` passes (release exe ≤ 10MB — SC-11 / BUILD-02)
- [ ] `test_inventory_meets_minimum_test_count` passes (≥30 tests inventoried — SC-12 / TEST-01)

## Step 3: Full test suite green

```
cargo test
```

- [ ] All test files pass with zero failures
- [ ] No `#[ignore]` tests that should be running (excluding intentional release-only ignores like `highlight_perf.rs`)
- [ ] `test result: ok. N passed` rolling totals show N ≥ 30 (SC-12)

## Step 4: Manual smoke (subset of dogfood checklist)

- [ ] Launch `target/release/notepadrs.exe` — window opens cleanly
- [ ] Launch `target/release/notepadrs.exe Cargo.toml` — file loads, encoding/EOL displayed
- [ ] Open + edit + save a fresh `test.txt` — round-trip preserved
- [ ] File → Recent Files lists previously-opened files
- [ ] Drag-and-drop a file onto the window — opens in new tab
- [ ] View → Word Wrap toggles wrapping visibly
- [ ] All four pass — proceed; any fail — pause and triage

## Step 5: Distribution sanity (BUILD-03, BUILD-04, BUILD-05)

- [ ] `target/release/notepadrs.exe` is a single file (no DLLs alongside it)
- [ ] Optional: `dumpbin /dependents target\release\notepadrs.exe` (or
      `Get-Command dumpbin`) — verify only OS-shipped DLLs are listed
      (`KERNEL32`, `USER32`, `GDI32`, `COMCTL32`, `SHELL32`, `OLE32`, `OLEAUT32`,
      `MSFTEDIT`, etc.)
- [ ] Targets `x86_64-pc-windows-msvc` (Cargo.toml MSRV 1.82, no cross-target additions)
- [ ] Manifest is embedded (Common Controls v6, DPI awareness — Phase 1 work via `embed-manifest`)

## Step 6: Git tag and push (HUMAN ACTION REQUIRED)

This step is NOT automated — it's a human's call to commit to the release.

- [ ] All Phase 5 changes committed
- [ ] `state.md` updated to reflect Phase 5 complete
- [ ] `roadmap.md` updated to mark Phase 5 [x]
- [ ] Tag the release: `git tag -a v1.0.0 -m "notepadrs v1.0.0"`
- [ ] Push to remote (if applicable): `git push origin main && git push origin v1.0.0`

## Step 7: Optional artifacts

- [ ] Copy `target/release/notepadrs.exe` to a `release/` folder for distribution
- [ ] Compute SHA256 hash for the release artifact:
      `Get-FileHash target\release\notepadrs.exe -Algorithm SHA256`
- [ ] (v2 work — DIST-01 / DIST-02) MSI installer and code-signing are deferred

---

## Outcome

- [ ] **CLEARED** — All gates green; v1.0.0 shipped
- [ ] **PAUSED** — One or more gates failed; document below

**Date:** ___
**Operator:** ___
**Notes:** ___
