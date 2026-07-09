# Dogfood Checklist — Phase 5 / v1.0.0 Release Marker

**Generated:** 2026-05-03
**Binary under test:** `target/release/notepadrs.exe`
  (or `target/x86_64-pc-windows-msvc/release/notepadrs.exe`)

This is the existential test for notepadrs v1: **"The developer can open,
edit, and save the project's own `Cargo.toml` in `notepadrs.exe` without
going back to another editor."**

The 10 steps below extend the 9-step procedure from `05-research.md`
§"Dogfood Marker (operational definition)" with explicit pass/fail
criteria. **Step 7 (`cargo build` after the round-trip) is the BLOCKING
gate** — failure means the v1.0.0 release is paused until the bug is
fixed.

Walk through every step on a Windows 10 (1809+) or Windows 11 desktop.
Record outcomes in the checkboxes. Any FAIL on a non-optional step blocks
the release.

---

## Step 1: Build the release binary

**Action:** From the project root:
```
cargo build --release
```

**Pass criteria:**
- Build completes without error
- `target/x86_64-pc-windows-msvc/release/notepadrs.exe` (or
  `target/release/notepadrs.exe`) exists
- File size <10MB (asserted automatically in Plan 05-05; sanity-check here)

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 2: Launch notepadrs with Cargo.toml

**Action:** From the project root:
```
target\x86_64-pc-windows-msvc\release\notepadrs.exe Cargo.toml
```
(or `target\release\notepadrs.exe Cargo.toml` if your build emits there)

**Pass criteria:**
- Window opens without panic / error dialog
- `Cargo.toml` contents visible in the editor
- Title bar shows the filename
- Tab strip shows a single tab labeled `Cargo.toml` (no leading asterisk —
  file is clean on load)

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 3: Verify chrome and detection

**Pass criteria:**
- Status bar shows: `Ln 1, Col 1 | UTF-8 | LF` (or `CRLF` — whichever the
  on-disk `Cargo.toml` uses; this project's repo uses CRLF on Windows)
- Total line count visible in status bar
- Line-number gutter visible on the left of the editor
- Syntax highlighting: TOML is **not** in Phase 4's language list, so
  plain-text fallback applies (no colorized highlighting). This is
  intentional — confirm `lang_from_path("Cargo.toml")` returns `Plain`.

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 4: Edit Cargo.toml

**Action:** Add a single line near the bottom of the file:
```
# notepadrs dogfood test {today's date}
```

**Pass criteria:**
- Tab title acquires a leading asterisk (dirty marker)
- Status bar `Ln`/`Col` updates as the cursor moves
- Line count in status bar increments by 1
- The new line is visible at the cursor position

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 5: Save (Ctrl+S)

**Action:** Press Ctrl+S.

**Pass criteria:**
- Asterisk clears from the tab title (clean marker)
- No error dialog appears
- Status bar refreshes (encoding/EOL stay the same)

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 6: Quit notepadrs

**Action:** File → Exit (or close the window).

**Pass criteria:**
- Window closes cleanly
- No "Save changes?" prompt (we just saved)

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 7: BLOCKING — `cargo build` from the shell

**Action:** From the project root:
```
cargo build
```

**Pass criteria (BLOCKING — release-blocking failure if any fail):**
- Build succeeds
- No TOML parse errors
- `git diff Cargo.toml` shows ONLY the comment line addition — no spurious
  EOL changes, no whole-file rewrite, no character drift

**Result:** [ ] PASS  [ ] **FAIL — RELEASE BLOCKED** — notes: ___

If FAIL: revert the change with `git checkout Cargo.toml` and investigate.
Most likely causes:
- Encoding cascade misdetected the file → save wrote different bytes than
  original
- EOL preservation broke → save normalized EOL
- Non-edited bytes were touched (Pattern A original-bytes cache failed)

**Cleanup after PASS:** the comment line can stay (cosmetic) or be reverted
via `git checkout Cargo.toml`. The marker is the round-trip survival, not
the comment itself.

---

## Step 8: Recent Files persistence (RECENT-03)

**Action:** Relaunch notepadrs WITHOUT arguments:
```
target\x86_64-pc-windows-msvc\release\notepadrs.exe
```
Then click File → Recent Files.

**Pass criteria:**
- `Cargo.toml` appears in the Recent Files submenu (most-recent first)
- Clicking it reopens the file (in the active empty tab if it's still
  fresh; otherwise in a new tab)
- `%APPDATA%\notepadrs\recent.json` exists and contains the path

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 9: Drag-and-drop (DND-01)

**Action:** From File Explorer, drag a small text file (e.g., `README.md`
or a sample `.py`) onto the notepadrs window.

**Pass criteria:**
- File opens in a new tab (or in the active fresh tab if there is one)
- Editor shows the file contents
- Multi-file drop test: select 2-3 files in Explorer, drag together — each
  opens in its own tab in drop order
- Folder drops do nothing (no error dialog, no crash — silently ignored
  per Plan 05-03 D-6)

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Step 10 (additional — Word Wrap, VIEW-06/07)

**Action:** With `Cargo.toml` (or any file with long lines) open, click
View → Word Wrap.

**Pass criteria:**
- Menu item shows MF_CHECKED after click
- Long lines wrap to the editor's right edge (no horizontal scrollbar)
- Click View → Word Wrap again — checkmark clears, horizontal scrollbar
  reappears, long lines extend off-screen

**Result:** [ ] PASS  [ ] FAIL — notes: ___

---

## Overall outcome

- [ ] **ALL PASS** — Phase 5 closes the dogfood marker; cleared to ship
- [ ] **PARTIAL** — Plan 05-05 ship-gate may proceed for non-blocking
      failures; document remediation here
- [ ] **BLOCKED** — Step 7 failed; v1.0.0 release on hold

**Reviewer:** ___
**Date:** ___
**Outcome:** ___

---

## Automated companion

The optional `tests/dogfood_marker.rs` (committed under O-1) provides a
GUI-free byte-exact load smoke for `Cargo.toml`. Run via:
```
cargo test --test dogfood_marker
```

It complements (does NOT replace) the manual procedure above — the GUI
parts (save round-trip, recent files menu, drag-drop, word wrap toggle)
require interactive testing on a real Windows desktop.
