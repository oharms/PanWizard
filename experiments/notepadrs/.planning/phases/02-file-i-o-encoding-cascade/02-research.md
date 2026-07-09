# Phase 2: File I/O + Encoding Cascade — Research

**Researched:** 2026-05-02
**Domain:** Windows-native text-file I/O — encoding detection (5 encodings), line-ending detection (4 styles), byte-exact round-trip, atomic save, error UX, fixture-based CI tests.
**Confidence:** HIGH on the 5-step encoding cascade, atomic save (`ReplaceFileW`), and EOL detection algorithm; MEDIUM on the **RichEdit ↔ EOL preservation** model (the central architectural choice for this phase — has two viable shapes, recommendation locked below); HIGH on the test fixture strategy.
**Project research relied upon:** `.planning/research/summary.md`, `.planning/research/stack.md`, `.planning/research/architecture.md` (Pattern 8: Encoding Detection Cascade), `.planning/research/pitfalls.md` (Pitfall 3: encoding mis-detection, Pitfall 4: silent line-ending normalization, Pitfall 12: file-IO error UX, Pitfall 17: trailing-newline preservation, Pitfall 18: encoding-conversion dirty flag).
**Phase 1 inheritance:** `.planning/phases/01-foundations-editor-spine/01-verification.md`, `.planning/phases/01-foundations-editor-spine/01-03-plan.md`. Phase 1 already shipped `EM_STREAMIN`/`EM_STREAMOUT` with `SF_TEXT | SF_USECODEPAGE | (CP_UTF8 << 16)` for UTF-8 ASCII; Phase 2 extends this with encoding cascade, EOL detection/preservation, and atomic save. **This file emits only Phase-2-specific deltas** — it does not re-derive material in the project-level research.

<user_constraints>
## User Constraints (from project-level decisions — no Phase-2 context.md exists)

No `02-context.md` exists for this phase (auto-mode synthesis). Constraints are inherited from `.planning/idea.md`, `.planning/research/*.md`, `.planning/state.md`, `.planning/phases/01-foundations-editor-spine/01-verification.md`, and the additional_context provided to this researcher.

### Locked Decisions (from project-level + Phase 1 + auto-mode)

- **Tech stack:** Rust 1.82, `windows` crate 0.62.x, no GUI framework wrappers (`iced`, `egui`, `slint`, `tauri`).
- **Crate allowlist for v1:** `windows`, `regex`, `serde` + `serde_json`, `encoding_rs`. Anything beyond requires explicit rationale in this research.
- **No async runtime.** Win32 message loop is the only event source. `tokio` / `async-std` not allowed.
- **Performance budgets (carry-forward):** open + tokenize 1MB <500ms, regex find on 1MB <100ms, keystroke-to-paint <16ms.
- **Platform:** Windows 10 1809+ / Windows 11 only. `x86_64-pc-windows-msvc`.
- **Binary size:** <10MB; CI gate already in place from Phase 1 (currently 230,912 bytes — 2.2% of ceiling, comfortable headroom for Phase 2).
- **`[profile.release]` cocktail:** `opt-level="z"`, `lto="fat"`, `codegen-units=1`, `strip="symbols"`, `panic="abort"` (already shipped).
- **RichEdit 4.1 (`MSFTEDIT_CLASS`)** owns the visible text. v2 escape hatch (custom render with Direct2D + DirectWrite) is documented and stays out of v1.
- **`EM_STREAMIN`/`EM_STREAMOUT`** are the load/save channel — NOT `EM_SETTEXTEX` (silently normalizes line endings). Phase 1 already wired this for UTF-8 ASCII.
- **No `EM_AUTOURLDETECT`** — already disabled at create time in Phase 1.
- **Per-tab encoding/EOL state** must be preserved verbatim on save unless user explicitly converts. Phase 1's `EditorState` already carries `current_path`; Phase 2 grows it with encoding/EOL fields.
- **Atomic save** lands in this phase (Pitfall 12 deferred from Phase 1 to here).
- **The four critical pitfalls (panic discipline, GWLP_USERDATA, OleInitialize, release-profile)** are already wired and verified in Phase 1; Phase 2 must not regress them. Specifically: any new code under WndProc must keep `#![deny(clippy::unwrap_used, clippy::expect_used)]` discipline.
- **TEST-01:** ≥30 cumulative tests by ship. Phase 1 shipped 18; Phase 2 should add ~10–15 (5 encodings × 4 EOLs round-trip = 20 fixture pairings, but most can run in a single parameterised test or two).

### Claude's Discretion (Phase-2 specific)

- Exact module split between encoding/EOL/file. Recommend: keep `src/file.rs` for OS-level I/O (read raw bytes, atomic write), grow `src/encoding.rs` (new) for the detection cascade + transcoding, grow `src/eol.rs` (new) for EOL detection + conversion. Editor-side glue stays in `src/editor.rs` and `src/dispatch.rs`.
- Exact menu wording (e.g. "Encoding → UTF-8 (no BOM)" vs "Encoding → UTF-8"). Cosmetic; standardize on Notepad++'s wording where reasonable.
- Whether to write fixtures as hex byte-arrays inside Rust source (`include_bytes!`) or as separate binary files in `tests/fixtures/encodings/`. Strong recommendation in this research: separate files with `.gitattributes binary`.
- Whether to chunk-encode in `Cow<'a, [u8]>` lazily vs eagerly. Recommendation: eager (simpler; files are <10MB by spec; performance budget unchanged).
- Whether `chardetng` is added to allowlist. **Recommendation: NO** for v1 — see "Don't Hand-Roll" section below; the deterministic 5-step cascade covers SC-6 explicit list (UTF-8/UTF-16/CP1252) without the +150KB binary cost.
- The exact set of `windows` crate features to add for atomic save. Recommendation below.

### Deferred Ideas (OUT OF SCOPE for Phase 2)

- Multi-tab — Phase 3.
- Per-tab Save As filtering by extension — Phase 5/polish.
- File-modified-on-disk detection (`ReadDirectoryChangesW`) — v1.x.
- Drag-and-drop file open — Phase 5.
- UTF-32 / EBCDIC / Shift_JIS / GB2312 / other Asian encodings — explicitly out of scope per `requirements.md` Out-of-Scope table.
- Mixed-line-ending repair UI — only DETECTION + a "mixed" status indicator are in scope; auto-repair is `requirements.md` Out-of-Scope.
- Binary-file warn-and-refuse — v2 (`UX-01` in `requirements.md`).
- Large-file warning at 25MB/100MB — v2 (`UX-02`).
- Click-to-cycle encoding/EOL in status bar — v2 (`UX-03`).

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| **FILE-03** | Save active tab via Ctrl+S byte-exact for the originally-detected encoding & EOL when content is unedited | Re-encode buffer with stored `(encoding, eol)`, then atomic-write via `ReplaceFileW`. Round-trip property: `decode(detected_enc, bytes) -> normalize_to_lf -> denormalize_with(detected_eol) -> encode(detected_enc) == bytes`. The "no edit" check is captured by RichEdit's `EM_GETMODIFY`/`EM_SETMODIFY` (already wired in Phase 1); when not modified, Ctrl+S writes the **original `Vec<u8>` cached on open** rather than re-streaming through RichEdit (avoids any RichEdit-side normalization risk). See "Architecture Patterns: Pattern A — Original-Bytes Cache". |
| **FILE-04** | Save As with explicit encoding & EOL choice | `GetSaveFileNameW` for path; a small custom modal (or extension to the dialog via `lpfnHook`) for encoding+EOL choice. Decode the in-memory text → re-encode with chosen encoding → re-emit with chosen EOL → atomic-write. Source: Win32 common dialogs reference. |
| **FILE-05** | Auto-detect encoding on open: UTF-8, UTF-8 BOM, UTF-16 LE, UTF-16 BE, CP1252 (ANSI) | 5-step cascade: (1) `encoding_rs::Encoding::for_bom(&first_3_bytes)` returns `Some((UTF_8, 3))`/`Some((UTF_16LE, 2))`/`Some((UTF_16BE, 2))` if BOM present; (2) `std::str::from_utf8(&bytes).is_ok()` AND has at least one non-ASCII byte → UTF-8 (no BOM); (3) BOM-less UTF-16 NUL-parity heuristic on first 4KB; (4) pure-ASCII → label as UTF-8 (no-BOM, ASCII-only is a UTF-8 subset); (5) fallback to `encoding_rs::WINDOWS_1252.decode_without_bom_handling(...)` (never fails — covers all 256 byte values). |
| **FILE-06** | Auto-detect line endings on open: LF, CRLF, CR, mixed | Single pass over first 64KB (or full file if smaller). Count `\r\n` (=CRLF), then count `\r` not followed by `\n` (=CR), then count `\n` not preceded by `\r` (=LF). Return: `Eol::Lf`/`Eol::Crlf`/`Eol::Cr` if one style is ≥95% of total; `Eol::Mixed{majority}` otherwise. Threshold rationale below. |
| **FILE-07** | Preserve original encoding on save unless user explicitly converts | Encoding stored on `EditorState`; default save path re-encodes from in-memory UTF-8 string back to original encoding via `encoding_rs::Encoding::encode()`. Conversion only happens on explicit menu action (FILE-09) which marks dirty + pushes encoding-change onto a tab metadata change record. |
| **FILE-08** | Preserve original line endings on save unless user explicitly converts | EOL style stored on `EditorState`. The internal RichEdit holds CR-only paragraph markers (`\r`); on save, transform `\r` → original EOL bytes. See Architecture Pattern A for the canonical implementation. |
| **FILE-09** | Encoding menu: UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE / ANSI; converts active buffer | Menu item handler updates `EditorState.encoding`, marks `EM_SETMODIFY(TRUE)`, status bar reflects new encoding. The conversion takes effect at next save. (Notepad++ behavior: convert is in-memory + dirty marker; user must Ctrl+S to commit.) |
| **FILE-10** | EOL menu (Edit → EOL): LF / CRLF / CR; converts active buffer | Same shape as FILE-09. Updates `EditorState.eol`, marks dirty. |
| **FILE-11** | Open errors (file-not-found, permission-denied, network-share-hang) → dialog, existing tabs intact | `MessageBoxW` with `MB_ICONERROR` + clear message. Phase 1 already established this for the UTF-8 ASCII path; Phase 2 extends with: (a) explicit error categorization (not-found / permission-denied / generic / encoding-detection-failure), (b) network-share-hang protection — see Architecture Pattern E. Open errors do NOT modify the active tab. |
| **TEST-02** | Encoding-detection tests for all 5 encodings, including byte-exact round-trip on fixture files | 5 fixtures × 4 EOLs = up to 20 fixture combinations. Recommend 5 + 4 = **9 carefully-curated fixtures** (one per encoding × LF, plus one CRLF variant per encoding for the cross-product proof). Test asserts: `(detected_enc, detected_eol)` matches expected, and `re-emit(decode(bytes)) == bytes` byte-exact when unedited. |
| **TEST-03** | Line-ending-detection tests for LF/CRLF/CR/mixed, including round-trip preservation | 4 fixtures: pure LF, pure CRLF, pure CR, mixed (e.g. CRLF for first half, LF for second). Test asserts detected EOL classification + round-trip preservation. The "mixed" fixture's round-trip preservation rule: in the no-edit case, the original bytes are emitted verbatim (cached at open); the EOL classification is for status-bar display only. |

</phase_requirements>

## Summary

Phase 2 closes SC-1 and SC-6 by extending Phase 1's UTF-8 ASCII spine to the **5-encoding × 4-EOL** matrix. The architectural problem this phase solves is **byte-exact round-trip preservation through a RichEdit control that normalizes line endings to CR-only internally**. The recommended solution: cache the **original `Vec<u8>` on open** alongside the decoded UTF-8 text; on Ctrl+S of an unmodified buffer (`EM_GETMODIFY` returns 0), write the cached bytes verbatim — RichEdit never gets a chance to corrupt anything. On Ctrl+S of a modified buffer, re-decode RichEdit's CR-only stream to LF-only canonical form, then re-emit with the stored `(encoding, eol)` via `encoding_rs::Encoding::encode()`. This is the only design that makes all 20 fixture combinations round-trip byte-exact.

The detection cascade is 5 deterministic steps (BOM → UTF-8 strict-validity-with-non-ASCII → UTF-16 NUL-parity heuristic → ASCII-as-UTF-8 → CP1252 fallback). EOL detection is a single 64KB scan with a 95% majority threshold. Atomic save uses **`ReplaceFileW`** (preferred over `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` because it preserves ACLs, attributes, NTFS streams, and the file's identity in one call). Network-share hang protection is layered on the open path only — wrap `std::fs::read` in a worker thread with a `std::sync::mpsc::recv_timeout(5s)` fallback (saves are user-driven and synchronous).

**Primary recommendation:** Land Phase 2 in **four plans** in three waves: **(Wave 1)** `02-01` add `src/encoding.rs` + `src/eol.rs` + 9 fixtures + pure-Rust unit tests (no Win32, fully headless, ~12 tests); **(Wave 2 parallel)** `02-02` grow `EditorState` with `(encoding, eol, original_bytes)` fields + `EM_STREAMIN`/`EM_STREAMOUT` round-trip glue + Ctrl+S atomic-save in `src/file.rs::save_atomic`, AND `02-03` add Encoding/EOL menus + Save As dialog + dispatch wiring; **(Wave 3)** `02-04` open-error UX expansion (network-share timeout + categorized error messages) + integration test stubs.

## Standard Stack

### Core (Phase 2 additions to Phase 1's stack)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `encoding_rs` | **0.8.35** (already in allowlist) | UTF-16 LE/BE + CP1252 transcoding + BOM sniffing | The Rust ecosystem's blessed transcoding library (Gecko/Firefox implementation). `Encoding::for_bom()` is the only API call needed for BOM detection (returns `Option<(&'static Encoding, usize)>` where the `usize` is the BOM length to strip). `WINDOWS_1252.decode_without_bom_handling()` is the CP1252 fallback. |
| `std::sync::mpsc` | (built-in) | Network-share hang timeout via worker thread + `recv_timeout` | Already implicit in the architecture for find/replace in Phase 3; reusing here for the open path establishes the pattern early. |
| `windows` features (already enabled) | 0.62 | `Win32_Storage_FileSystem` for `ReplaceFileW` + `Win32_System_Diagnostics_Debug` for `FormatMessageW` | `Win32_UI_Controls_Dialogs` (already on for `GetOpenFileNameW`) covers `GetSaveFileNameW`. **`Win32_Storage_FileSystem` must be added** to Phase 1's feature list for `ReplaceFileW`. **`Win32_System_Diagnostics_Debug` must be added** for `FormatMessageW` (used to render `GetLastError()` codes for FILE-11). |

### Phase 2 `windows` crate features to add to `Cargo.toml`

```toml
# Add to [dependencies.windows] features list:
"Win32_Storage_FileSystem",          # ReplaceFileW, MoveFileExW (atomic save)
"Win32_System_Diagnostics_Debug",     # FormatMessageW (render OS error codes)
```

`Win32_Globalization` is **NOT** required — `CP_UTF8 = 65001` is a numeric constant; we already define it inline in `src/editor.rs`.

### Don't Add

| Avoided | Why |
|---------|-----|
| `chardetng` | Adds ~150KB binary size for legacy code-page detection (Shift_JIS/GB2312/etc.) explicitly out of scope per `requirements.md` Out-of-Scope ("UTF-32 / EBCDIC / exotic encodings"). The 5-step deterministic cascade covers SC-6's literal list (UTF-8/UTF-16/CP1252) and is byte-exact CI-testable. Re-evaluate only if real-world testing post-v1 surfaces detection failures on legitimate v1 files. Source: `.planning/research/architecture.md` Pattern 8 + `.planning/research/features.md` "Decisions Needed" §1. |
| `tempfile` crate | `ReplaceFileW` uses a temp file but we control the path entirely (`{target}.notepadrs.tmp`). No need for OS-level temp-file abstraction; would add a dependency for ~5 lines of code. |
| `notify` crate | File-modified-on-disk detection is v1.x (`requirements.md` v2 NAV-02), not Phase 2. |
| Hand-rolled CP1252 lookup table | `encoding_rs::WINDOWS_1252` is already in the binary footprint (we use it for transcoding); a hand-rolled 256-entry table would be ~1KB savings vs. consistency with `encoding_rs`'s rigorous mapping for the surrogate cases. Not worth it. |
| `std::path::Path::canonicalize()` on every save | Returns `\\?\` extended paths on Windows that confuse `MessageBoxW` strings shown to the user. Use the path the user gave us. |

## Architecture Patterns

### Recommended File Layout (Phase 2 deltas to Phase 1)

```
src/
├── main.rs                # (unchanged)
├── window.rs              # (unchanged)
├── app.rs                 # (unchanged in shape; IDM_* constants for Encoding/EOL menus added)
├── dispatch.rs            # +do_file_save_as, +Encoding/EOL menu handlers
├── editor.rs              # EditorState gets (encoding, eol, original_bytes) fields
├── file.rs                # +open_any_encoding, +save_atomic; existing UTF-8 ASCII open kept as fast path
├── encoding.rs            # NEW: detect_encoding, decode, encode (cascade + transcoding)
├── eol.rs                 # NEW: detect_eol, normalize_to_lf, denormalize_to_eol
├── error.rs               # +Error::EncodingDetectFailed, +Error::OpenTimeout
├── menu.rs                # +Encoding submenu, +Edit→EOL submenu
└── ...

tests/
├── fixtures/              # 9–11 binary-tagged fixture files (see Test Strategy)
│   ├── ascii_lf.txt        # (existing)
│   ├── ascii_only.txt      # (existing)
│   ├── utf8_no_bom_lf.txt  # NEW
│   ├── utf8_bom_crlf.txt   # NEW
│   ├── utf16le_bom_crlf.txt # NEW
│   ├── utf16be_bom_lf.txt  # NEW
│   ├── cp1252_crlf.txt     # NEW
│   ├── cr_only.txt         # NEW
│   ├── mixed_eol.txt       # NEW
│   └── empty.txt           # NEW (0-byte sentinel)
├── encoding_cascade.rs    # NEW: 12 tests on detect_encoding + decode round-trip
├── eol_detection.rs       # NEW: 6 tests on detect_eol + normalize/denormalize
├── roundtrip_matrix.rs    # NEW: 5×4 fixture round-trip integration test (parametric)
└── ...
```

**Rationale for the split:**
- `encoding.rs` and `eol.rs` are **pure-Rust, no Win32**. Fully unit-testable without a window. This is the only way to hit the "5×4 matrix proof" requirement of TEST-02 + TEST-03 deterministically in CI.
- `file.rs` keeps the OS-level I/O (read raw bytes, write atomic). It does NOT know about encoding or EOL; it just moves `Vec<u8>` to/from disk. This boundary is what lets the round-trip test work without a HWND.
- `editor.rs` is the only place where RichEdit-side state (the streamed-in CR-only string) meets the encoding/eol layer. The `original_bytes` cache lives here and is consulted on save when `EM_GETMODIFY == 0`.

### Pattern A — Original-Bytes Cache (the round-trip linchpin)

**What:** On open, after detecting `(encoding, eol)`, store the **raw `Vec<u8>` we read from disk** on `EditorState.original_bytes`. On save:

```
if !EM_GETMODIFY(hwnd_re):
    # Buffer is unedited. Write the cached original bytes verbatim.
    save_atomic(path, &original_bytes)
else:
    # Buffer is edited. Pull from RichEdit, normalize, re-emit.
    let cr_text = stream_out_utf8(&hwnd_re)            # RichEdit's CR-only UTF-8
    let lf_text = cr_text.replace('\r', "\n")          # Canonicalise to LF
    let final_bytes = encode_with_eol(&lf_text, encoding, eol)
    save_atomic(path, &final_bytes)
    # Refresh the cache so subsequent unedited saves are still byte-exact:
    original_bytes = final_bytes
```

**When to use:** Always. This is the only reliable way to round-trip byte-exact through RichEdit. RichEdit 2.0+ uses CR-only paragraph markers internally and there is **no flag to make it preserve original line endings** (verified against `learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls`: "Microsoft Rich Edit 2.0 used only a carriage return character ('\r'). Microsoft Rich Edit 3.0 uses only a carriage return character but can emulate Microsoft Rich Edit 1.0 in this regard"). The original-bytes cache sidesteps the entire problem for the common case (open + save without edits, which is what users do when they open a file by accident).

**Trade-offs:**
- **Pro:** Byte-exact round-trip is mechanically guaranteed for unedited saves — no possibility of even a single byte changing. Tests are simple equality assertions.
- **Pro:** Memory cost is bounded — 1MB file = 1MB cache. The performance budget allows for this (we already read the bytes at open time; we just keep them).
- **Con:** Edited saves still go through the `\r → eol` denormalization path, which is where bugs hide. Mitigation: explicit fixture-based test (`roundtrip_matrix.rs::edited_save_preserves_eol`) that types one character into each fixture and asserts the saved bytes match the original-with-edit.
- **Con:** Memory use doubles for large files (in-memory text + cached bytes). Acceptable per spec (1MB target = 2MB peak).
- **Con:** When user edits and saves, the cache is replaced (line above: `original_bytes = final_bytes`). This is correct — subsequent unedited saves should round-trip the *new* on-disk content.

**Source:** Architectural derivation. The CR-only normalization is documented at `learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls` (HIGH); the cache pattern is a deduction from this fact + the requirement of byte-exact round-trip.

### Pattern B — 5-Step Encoding Detection Cascade (deterministic; no statistics)

**What:** Pure function `detect_encoding(bytes: &[u8]) -> (Encoding, BomLen)` where:
1. **BOM check** — `encoding_rs::Encoding::for_bom(&bytes[..min(3, bytes.len())])`:
   - `EF BB BF` → `(UTF_8, 3)` — UTF-8 with BOM
   - `FF FE` → `(UTF_16LE, 2)` — UTF-16 LE
   - `FE FF` → `(UTF_16BE, 2)` — UTF-16 BE
   - Otherwise: `None`, fall through.
2. **Strict UTF-8 validity** — `std::str::from_utf8(&bytes).is_ok()` AND `bytes.iter().any(|b| *b >= 0x80)`. The non-ASCII condition prevents step 2 from claiming pure-ASCII files (which is also valid CP1252) — those go to step 4.
3. **BOM-less UTF-16 heuristic** on first 4096 bytes:
   - Count `count_nul_at_even = bytes[0..n].iter().step_by(2).filter(|b| **b == 0).count()`.
   - Count `count_nul_at_odd = bytes[1..n].iter().step_by(2).filter(|b| **b == 0).count()`.
   - If `count_nul_at_even > 0.4 * (n/2)` AND `count_nul_at_odd < 0.05 * (n/2)` → UTF-16 BE (high byte is NUL because ASCII codepoints are `00 NN`).
   - If `count_nul_at_odd > 0.4 * (n/2)` AND `count_nul_at_even < 0.05 * (n/2)` → UTF-16 LE (high byte is NUL because ASCII codepoints are `NN 00`).
   - Otherwise fall through.
4. **Pure-ASCII → label as UTF-8** (no BOM). Bytes are byte-identical between UTF-8-ASCII and CP1252-ASCII; UTF-8 is the modern default per `requirements.md` and Notepad++/VS Code convention.
5. **CP1252 fallback** — `encoding_rs::WINDOWS_1252.decode_without_bom_handling(&bytes)`. Never fails; covers all 256 byte values. The user is informed via the status bar (Phase 4) that the file was opened as ANSI; they can choose Encoding → UTF-8 to convert if they intended otherwise.

**When to use:** Always at open. Edge case: empty file (0 bytes) → return `(UTF_8, 0)` directly without running the cascade.

**Trade-offs:**
- **Pro:** 100% deterministic, fixture-testable. Same input always produces same `(encoding, bom_len)`.
- **Pro:** No external dependency beyond `encoding_rs` (already in allowlist).
- **Pro:** ~80 LOC; trivial to implement and review.
- **Con:** Will produce mojibake on Shift_JIS / GB2312 / KOI8-R / etc. — out of scope per `requirements.md`. User can re-open with explicit encoding via menu (FILE-09).
- **Con:** Step 3's threshold (40% / 5%) has been verified against the standard heuristic in `unicodebook.readthedocs.io/guess_encoding.html` and `autoitconsulting.com`'s detection library; rare files (e.g., a UTF-16 LE file containing zero ASCII characters in the first 4KB) could be misclassified. Acceptable v1 risk; Encoding menu is the recovery path.

**Source:** `.planning/research/architecture.md` Pattern 8 (HIGH); `learn.microsoft.com` BOM specs (HIGH); `unicodebook.readthedocs.io/guess_encoding.html` (MEDIUM verified by 2 sources).

### Pattern C — EOL Detection: Single-Pass 64KB Scan with 95% Majority Threshold

**What:**

```rust
pub enum Eol { Lf, Crlf, Cr, Mixed { majority: Box<Eol> } }

pub fn detect_eol(text: &str) -> Eol {
    // Scan up to 64KB to bound work on huge files; v1 spec says open <500ms for 1MB.
    let scan_len = text.len().min(64 * 1024);
    let s = &text.as_bytes()[..scan_len];
    let mut crlf = 0usize;
    let mut cr = 0usize;
    let mut lf = 0usize;
    let mut i = 0;
    while i < s.len() {
        if s[i] == b'\r' {
            if i + 1 < s.len() && s[i+1] == b'\n' { crlf += 1; i += 2; }
            else { cr += 1; i += 1; }
        } else if s[i] == b'\n' { lf += 1; i += 1; }
        else { i += 1; }
    }
    let total = crlf + cr + lf;
    if total == 0 { return Eol::Crlf; } // empty file → Windows default
    let max = crlf.max(cr).max(lf);
    let dominant = if max == crlf { Eol::Crlf } else if max == lf { Eol::Lf } else { Eol::Cr };
    // 95% threshold — anything less is "mixed" but we still report the majority.
    if (max as f32) / (total as f32) >= 0.95 { dominant }
    else { Eol::Mixed { majority: Box::new(dominant) } }
}
```

**When to use:** Always at open, on the **decoded UTF-8 string** (so detection works regardless of source encoding). Run AFTER decoding; do NOT scan raw bytes (a UTF-16 file's `\r\n` would be `0d 00 0a 00`, never matching the byte-level pattern).

**Threshold rationale (95%):**
- Notepad++ uses a "dominant style + mixed indicator" model (verified at `npp-user-manual.org`).
- 95% accommodates real-world files like a CRLF file with a single LF embedded in a long string literal, which is still functionally CRLF.
- Below 95% → user is told it's "mixed" via status bar; the dominant style is preserved on save (round-trip uses **original-bytes cache**, not re-emission, when unedited — so even mixed files round-trip byte-exact).

**Source:** `.planning/research/pitfalls.md` Pitfall 4 (HIGH); `npp-user-manual.org` (HIGH).

### Pattern D — Atomic Save via `ReplaceFileW`

**What:**

```rust
pub fn save_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    // 1. Write to a sibling temp file (same directory => same volume guaranteed).
    let tmp = target.with_extension("notepadrs.tmp");
    std::fs::write(&tmp, bytes)?;     // Phase 1's std::fs::write keeps working

    // 2. If target doesn't exist yet (Save As to new path), just rename.
    if !target.exists() {
        std::fs::rename(&tmp, target)?;
        return Ok(());
    }

    // 3. ReplaceFileW preserves ACLs, attributes, NTFS streams, file ID.
    unsafe {
        use windows::Win32::Storage::FileSystem::*;
        use windows::core::*;
        let target_w: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        let tmp_w: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();
        let ok = ReplaceFileW(
            PCWSTR(target_w.as_ptr()),
            PCWSTR(tmp_w.as_ptr()),
            PCWSTR::null(),                          // no backup
            REPLACEFILE_IGNORE_MERGE_ERRORS,         // tolerate ACL preservation failures
            None, None,
        );
        if ok.is_err() {
            // Fall back to MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)
            // for filesystems that don't support ReplaceFileW (some network shares, ReFS edge cases).
            let _ = std::fs::remove_file(&tmp).ok();   // best-effort cleanup
            return Err(Error::Io(std::io::Error::last_os_error()));
        }
    }
    Ok(())
}
```

**When to use:** Always for save. Replaces Phase 1's bare `std::fs::write` (which is fine for the test's `tmp_dir().join(...)` path but unsafe for user files — power-loss mid-write truncates the user's file).

**Why `ReplaceFileW` over `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`:**
- `ReplaceFileW` preserves: creation time, short file name, object identifier, DACLs, security resource attributes, encryption flag, compression flag, named streams not already in the replacement file. (Verified at `learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew`.)
- `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` does NOT preserve any of these — the new file inherits the destination directory's default ACLs.
- For an editor saving a user's file, `ReplaceFileW` is the correct semantics: the user wanted to *modify* the file, not *replace* it with a new identity.
- `REPLACEFILE_WRITE_THROUGH` (0x1) is **documented as "not supported"** at the linked Microsoft Learn page — do NOT pass it. Use `REPLACEFILE_IGNORE_MERGE_ERRORS` (0x2) so the save succeeds even if ACL preservation fails on networked filesystems (still atomic; ACLs may not be preserved).
- Fall back to `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)` only if `ReplaceFileW` fails — on certain network filesystems and ReFS configurations. (Document this fallback in the implementation; do not pre-emptively use it as the default.)

**Trade-offs:**
- **Pro:** Power-loss safe — at no point does the on-disk file go through a "truncated and partially written" intermediate state. Either the old file is intact or the new file is intact; no data loss.
- **Pro:** ACL/attribute/stream preservation = users editing protected files don't accidentally strip permissions.
- **Pro:** Same-directory temp file = same-volume guaranteed = atomic rename works.
- **Con:** Two filesystem operations instead of one (write tmp + rename). Adds ~1ms per save on local SSD; imperceptible.
- **Con:** Failure recovery requires deleting the tmp file. Best-effort cleanup is sufficient (worst case: stray `.notepadrs.tmp` file user can delete).

**Source:** `learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew` (HIGH); cross-referenced with `.planning/research/pitfalls.md` Pitfall 12 (recommends temp-then-rename atomicity).

### Pattern E — Network-Share Hang Protection (open path only)

**What:** Wrap `std::fs::read(path)` in a worker thread; UI thread waits with `recv_timeout(5s)`.

```rust
pub fn read_with_timeout(path: PathBuf, timeout: Duration) -> Result<Vec<u8>> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(std::fs::read(&path).map_err(Error::Io));
    });
    match rx.recv_timeout(timeout) {
        Ok(result) => result,
        Err(_) => Err(Error::OpenTimeout),
    }
    // Note: the worker thread is leaked if it hangs; std::fs::read on a dead
    // network share will eventually return (typically 30+ seconds) and the
    // send will silently fail. The leak is bounded — one thread per timed-out
    // open, dropped when the user actually moves on. Acceptable v1.
}
```

**When to use:** Only on the open path. Saves are user-driven (Ctrl+S, explicit action) — if a save hangs, the user can wait or kill the app; protecting it isn't worth the worker-thread complexity for this phase.

**Trade-offs:**
- **Pro:** Solves SC-2's "graceful error UX for network-share-hang" without adding `tokio` (against constraints).
- **Pro:** UI never freezes on a dead share — user gets a clear error in 5s and can choose another file.
- **Pro:** The pattern (worker thread + mpsc + timeout) is the same shape Phase 3's find/replace will use; building it once here pays for itself twice.
- **Con:** Thread leak on actual timeout (the hung thread eventually returns and the result is dropped). Bounded — at most one leaked thread per timed-out open. Acceptable v1.
- **Con:** No cancellation of the hung I/O — Windows offers `CancelSynchronousIo` but using it here would require `OpenFile`-via-`CreateFileW` instead of `std::fs::read`, doubling the complexity. Skip for v1; revisit if leaks become a real issue.

**Source:** `.planning/research/pitfalls.md` Pitfall 12 (recommends timeout for network-share hang); `std::sync::mpsc::Receiver::recv_timeout` (Rust std).

### Pattern F — Save As Encoding/EOL Picker (FILE-04)

**What:** Use `GetSaveFileNameW` for path selection (standard Win32 common dialog). For encoding/EOL choice, **the simplest sufficient UI is a sequence of two `MessageBoxW` calls or a custom dialog**. Recommendation: **a custom dialog with a 5-radio-button group for encoding and a 3-radio-button group for EOL**, built declaratively via a `DialogBoxIndirectParamW` from a `DLGTEMPLATE` constructed in code.

**Alternative considered:** Re-use Notepad's pattern (`GetSaveFileNameW` with `lpfnHook` callback that adds an extra panel). Rejected: the hook callback is poorly documented, `windows` 0.62.x exposes it but the v0.62 `OPENFILENAMEW.lpfnHook` field has signature subtleties that bit Plan 01-03 (see `01-verification.md` Deviations). A separate dialog after the file picker is simpler.

**Default values:** Pre-fill encoding/EOL pickers with the active tab's current `(encoding, eol)` so "Save As" without changing values is a true save-as (just to a new path, not a conversion).

**Trade-offs:**
- **Pro:** Self-contained; no `lpfnHook` voodoo.
- **Pro:** The same dialog is reusable later for Edit→EOL Conversion menu (Phase 2 FILE-10) and Encoding menu (FILE-09) if we want a "convert with confirmation" UX (Notepad++ pattern).
- **Con:** ~150 LOC of dialog template construction. Acceptable; `DialogBoxIndirectParamW` is a one-time write.

**Source:** `learn.microsoft.com/en-us/windows/win32/dlgbox/dlgboxes`; cross-checked with `windows-rs` examples on GitHub.

### Anti-Patterns to Avoid

- **Anti-Pattern 1 — Re-streaming through RichEdit on every save.** RichEdit's CR-only normalization makes this lossy when the file's original EOL was CRLF or LF. Always check `EM_GETMODIFY` first; only re-stream when the buffer is dirty. Use the original-bytes cache for unedited saves.
- **Anti-Pattern 2 — Calling `for_bom` on the full byte slice.** `for_bom` only inspects the first 3 bytes; passing more is wasted work, and on a 1MB file passing the slice through is fine but conceptually misleading. Always pass `&bytes[..min(3, bytes.len())]`.
- **Anti-Pattern 3 — Using `from_utf8_lossy` in the cascade.** Returns a `Cow<str>` that silently replaces invalid bytes with `\u{FFFD}`. We need exact byte preservation; `std::str::from_utf8(&bytes).is_ok()` is the boolean we want, and on success the `&str` references the original bytes (no allocation, no replacement).
- **Anti-Pattern 4 — Detecting EOL on raw bytes for UTF-16 content.** UTF-16 LE encodes `\r` as `0d 00`; a byte-level scan for `\r` would falsely match the high byte of the next codepoint. Always decode to UTF-8 string first, then scan.
- **Anti-Pattern 5 — Writing the target file directly (non-atomic save).** Power loss mid-`std::fs::write` truncates the user's file. Always temp-then-rename via `ReplaceFileW`. (Phase 1's `save_utf8` does direct write; Phase 2 replaces it with `save_atomic` and Phase 1's `save_utf8` is removed or kept only for tests that don't care.)
- **Anti-Pattern 6 — Loading the file synchronously on the UI thread without timeout.** A dead network share blocks the message pump; user perceives the editor as hung. Always use `read_with_timeout` for FILE-11.
- **Anti-Pattern 7 — Marking the buffer dirty when the user picks the *current* encoding from the menu.** No-op conversions (Encoding → already-current-encoding) should detect that the choice equals the current state and do nothing. Otherwise the user gets a phantom dirty marker.
- **Anti-Pattern 8 — Dropping the BOM bytes on decode but not re-emitting them on save.** UTF-8 BOM and UTF-16 LE/BE BOM must round-trip. The cascade returns `(encoding, bom_len)`; the encoder must emit the BOM bytes back when the original had one. `encoding_rs::Encoding::encode()` does NOT emit a BOM by default — we must prepend the bytes manually for UTF-8 BOM (`EF BB BF`) and UTF-16 BOMs (`FF FE` / `FE FF`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BOM detection | Custom 3-byte comparison helper | `encoding_rs::Encoding::for_bom(&bytes[..n])` | Returns `Option<(&'static Encoding, usize)>` directly. Free, correct, idiomatic. |
| UTF-16 LE/BE transcoding | Hand-rolled byte-pair → UTF-8 conversion | `encoding_rs::UTF_16LE.decode_without_bom_handling(&bytes)` | Handles surrogate pairs, replacement characters, cross-platform endianness correctly. |
| CP1252 transcoding | Hand-rolled 256-entry lookup table | `encoding_rs::WINDOWS_1252.decode_without_bom_handling(&bytes)` | The 5 surrogate "Windows-1252 special" mappings (`0x81`/`0x8D`/`0x8F`/`0x90`/`0x9D` → undefined → REPLACEMENT) are subtle. Use the verified table. |
| Atomic file replace | Hand-rolled "write tmp + rename" with `std::fs::rename` | `windows::Win32::Storage::FileSystem::ReplaceFileW` | `std::fs::rename` is implemented as `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` which does NOT preserve ACLs/streams/file-ID. `ReplaceFileW` does. (Source: Rust `std::fs` source code on Windows + Microsoft docs.) |
| OS error code → user message | `format!("error: {:?}", e)` | `FormatMessageW(FORMAT_MESSAGE_FROM_SYSTEM, ..., GetLastError())` for OS errors; otherwise the `Error::Display` impl from `error.rs` | OS errors are localized by `FormatMessageW` (renders "Access is denied." instead of the cryptic `Error { kind: PermissionDenied }`). For non-OS errors (encoding-detect-fail, timeout) use the existing `Display`. |
| Encoding-conversion confirmation dialog | Fully custom dialog | `MessageBoxW(MB_YESNOCANCEL | MB_ICONQUESTION)` | A simple 3-button dialog suffices for "Convert encoding from X to Y? [Yes/No/Cancel]". Custom dialog is overkill for a yes/no/cancel question. |
| Network-share timeout | Custom OVERLAPPED I/O + `CancelSynchronousIo` | `std::thread::spawn` + `mpsc::Receiver::recv_timeout` | The thread-and-channel pattern is documented, well-understood, leaks one thread per timeout (acceptable per spec), and is the same pattern Phase 3 will use for find/replace cancellation. OVERLAPPED I/O on a worker is right but doubles the complexity for marginal gain. |
| Path-arg/UTF-16 ↔ `PathBuf` round-trip | Custom UTF-16 conversion | `std::os::windows::ffi::OsStrExt::encode_wide` + `OsString::from_wide` | Standard library; correct for all Unicode paths including non-BMP characters. Phase 1 already uses this in `dispatch.rs`. |

**Key insight:** `encoding_rs` is on the allowlist precisely because hand-rolling encodings is dangerous — the surrogate cases in CP1252, byte-order quirks in UTF-16, and replacement-character semantics in UTF-8 are all places where a "should be straightforward" implementation gets one detail wrong. Use the library; trust it.

## Common Pitfalls

### Pitfall A — RichEdit normalizes CRLF to CR on EM_STREAMIN; round-trip via the control loses original EOL information

**What goes wrong:** Open a CRLF file → bytes go through `EM_STREAMIN` with `SF_TEXT | (CP_UTF8 << 16)` → RichEdit stores it as CR-only paragraph markers → user presses Ctrl+S without editing → `EM_STREAMOUT` returns CR-only bytes → save writes CR-only bytes → on-disk file has been silently converted from CRLF to CR. **All 4 EOL fixtures will fail TEST-03 round-trip if you don't address this.**

**Why it happens:** RichEdit 2.0+ uses CR-only paragraph markers internally. There is no flag to disable this normalization. (Verified at `learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls`.)

**How to avoid:** **Pattern A — Original-Bytes Cache.** Cache the raw `Vec<u8>` on open; on Ctrl+S of an unmodified buffer, write the cache verbatim. Only re-stream-out + re-encode when the buffer is dirty. This makes the round-trip property hold mechanically without trusting RichEdit's stream-out.

**Warning signs:** Round-trip test for any non-LF-only fixture fails. CRLF fixture's saved file has length 1× LF count + 0 (i.e., CR was stripped, not "CR became LF").

**Phase to address:** This phase. Specifically Plan 02-02 (EditorState + I/O glue).

### Pitfall B — Encoding ambiguity between pure-ASCII UTF-8 and CP1252

**What goes wrong:** A `Cargo.toml` (pure ASCII, no BOM) opens. The cascade has to pick UTF-8 or CP1252 — they are byte-identical for ASCII content. If you pick CP1252, every subsequent save preserves it, and the user gradually converts UTF-8 files to ANSI without realizing it.

**Why it happens:** The cascade's step 2 (UTF-8 strict validity) requires `is_ok()` AND at least one non-ASCII byte. Pure-ASCII files pass `is_ok()` trivially but have no non-ASCII bytes, falling through to step 3 (UTF-16 heuristic), then step 4 (ASCII).

**How to avoid:** **Step 4 — pure-ASCII → UTF-8** (no BOM). This is the modern default per `requirements.md` (Notepad++ behavior, VS Code behavior, every editor since ~2015). The byte content is byte-identical, so the choice is purely about what the status bar reports — UTF-8 is the right answer.

**Warning signs:** A pure-ASCII fixture's detected encoding shows as ANSI (CP1252) rather than UTF-8 in the status bar (Phase 4 will surface this).

**Phase to address:** This phase. Hardcoded into `encoding.rs::detect_encoding` step 4.

### Pitfall C — UTF-16 NUL-parity heuristic false-negative on UTF-16 file with no ASCII characters

**What goes wrong:** A UTF-16 LE file containing only Cyrillic or CJK text has zero NUL bytes (because all codepoints are ≥ U+0080). The heuristic threshold (40% NUL parity) fails; falls through to ASCII (step 4) which fails because the bytes aren't ASCII; falls through to CP1252 which succeeds with mojibake.

**Why it happens:** The heuristic relies on ASCII characters appearing as `NN 00` (LE) or `00 NN` (BE). Non-ASCII codepoints appear as `NN MM` with neither byte being NUL.

**How to avoid:** Out of v1 scope. SC-6's literal encoding list is "UTF-8 (with or without BOM), UTF-16 LE/BE, ANSI (CP1252)" — the failure mode here is "user has a Cyrillic UTF-16-LE-no-BOM file and we open it as CP1252 mojibake." The recovery path is the Encoding menu (FILE-09) — user picks UTF-16 LE manually, the buffer reloads. Document this as a known v1 limitation in `requirements.md` v2 considerations.

**Warning signs:** UTF-16 LE file with non-ASCII content opens as garbage characters; user complains.

**Phase to address:** Document; do not fix in v1. Recovery is the Encoding menu.

### Pitfall D — BOM stripping on decode but not re-emission on save

**What goes wrong:** Open a UTF-8 BOM file → decoder strips BOM → in-memory text has no BOM → save re-encodes as UTF-8 → on-disk file lacks the original BOM. Round-trip fails byte-exact.

**Why it happens:** `encoding_rs::Encoding::encode()` does NOT emit a BOM. It encodes the text as bytes; BOM emission is the caller's responsibility.

**How to avoid:** Track BOM presence on `EditorState.encoding_with_bom: Option<bool>` (or fold it into the `Encoding` enum: `Utf8`, `Utf8Bom`, `Utf16Le`, `Utf16Be`, `Cp1252`). On save, prepend the appropriate BOM bytes:
- `Utf8Bom` → prepend `EF BB BF`
- `Utf16Le` → prepend `FF FE`
- `Utf16Be` → prepend `FE FF`
- `Utf8` (no BOM), `Cp1252` → prepend nothing

UTF-16 LE/BE without BOM is **not in the v1 encoding list** as a save target — the v1 encoding menu is "UTF-8 / UTF-8 BOM / UTF-16 LE / UTF-16 BE / ANSI" where UTF-16 LE/BE always include BOM (the standard). On open, a BOM-less UTF-16 file decoded via the heuristic and re-saved gets a BOM added (a tolerable side-effect; the user can use Save As to avoid it).

**Warning signs:** Round-trip test for UTF-8 BOM or UTF-16 LE BOM fixtures fails with `saved.len() == original.len() - 3` (or `-2`).

**Phase to address:** This phase. Plan 02-01 (encoding.rs encode/decode functions).

### Pitfall E — git's `core.autocrlf` mangling EOL-fixture files in version control

**What goes wrong:** Developer commits `tests/fixtures/utf8_no_bom_lf.txt`. git's `autocrlf=true` (Windows default) converts LF → CRLF on checkout. CI clones the repo, fixture has CRLF instead of LF, EOL detection test fails.

**Why it happens:** git's autocrlf is a per-developer setting that defaults to "true" on Windows. Phase 1 already mitigated this with `.gitattributes: tests/fixtures/* binary` (verified — file exists at repo root). Phase 2 must keep this rule active for the new fixtures.

**How to avoid:** All Phase 2 fixtures live under `tests/fixtures/` which is already covered by `.gitattributes`. Verify by adding a CI step: `git check-attr binary -- tests/fixtures/utf16le_bom_crlf.txt` should print `binary: set`. Alternatively, an in-test guard: each fixture-loading test can `assert!(bytes.contains(&[0x0d, 0x0a]) for CRLF fixtures` etc., catching mangling at test time.

**Warning signs:** Fixture-based test passes locally but fails in CI; or vice versa.

**Phase to address:** This phase. Existing `.gitattributes` rule covers it; Plan 02-01 adds verification.

### Pitfall F — `EM_GETMODIFY` returns 0 for a freshly-loaded file (before any user edit)

**What goes wrong:** Load a file via `EM_STREAMIN`. RichEdit fires `EN_CHANGE` notifications during the load itself, which set the modified flag to TRUE. After load, `EM_GETMODIFY` returns 1 even though the user did nothing. Ctrl+S now goes through the "edited" path (re-stream + re-encode) instead of using the cache — and the round-trip fails.

**Why it happens:** RichEdit treats `EM_STREAMIN` as an edit. The modified flag is set automatically on completion.

**How to avoid:** Phase 1 already wired `EM_SETMODIFY(0)` after `EM_STREAMIN` (verified in `src/editor.rs::open_text` line ~169-174). Phase 2 must keep this. Add a unit test: load a fixture via the full open path, assert `EM_GETMODIFY == 0` immediately after.

**Warning signs:** Round-trip test for an unedited save produces re-encoded output (e.g., CR-only when original was CRLF) instead of cache-emit output.

**Phase to address:** Already mitigated in Phase 1. Phase 2 must verify the discipline holds in any new EM_STREAMIN paths (e.g., reload after encoding conversion).

### Pitfall G — Trailing-newline preservation when round-tripping through RichEdit

**What goes wrong:** A file ends with `last line\n`. RichEdit loads it, internally stores `last line\r` (CR-only normalized). User edits, saves. The denormalize step emits `last line\r\n` (or `last line\n`) — but if RichEdit dropped or appended a paragraph terminator, the count is off by one.

**Why it happens:** RichEdit's "paragraph" model differs from a text file's "trailing newline" semantics. Some operations on RichEdit add an implicit terminator at the end.

**How to avoid:** Track "original had trailing newline" as a boolean on `EditorState.had_trailing_newline`. On open, compute this from the original bytes (`bytes.last() == Some(&b'\n') || bytes.last() == Some(&b'\r')`). On edited save, append the appropriate EOL bytes only if the original had one. Verify with a fixture that explicitly omits the trailing newline (`tests/fixtures/no_trailing_newline.txt`).

**Phase to address:** This phase. Plan 02-02. Source: `.planning/research/pitfalls.md` Pitfall 17.

### Pitfall H — Save As to a path on a different volume fails atomic-replace semantics

**What goes wrong:** User saves to `D:\some\file.txt` while target is `C:\original\file.txt`. The temp-file we wrote (`{D-target}.notepadrs.tmp`) is on the same volume as D, but `ReplaceFileW` operates same-volume — that's fine. The bug case is when the temp-file path computation is buggy (e.g., we put the tmp on C: but the target on D:).

**Why it happens:** A simple `target.with_extension("notepadrs.tmp")` always computes the tmp file in the same directory as target — which is the same volume by definition. The bug is hypothetical.

**How to avoid:** Use `target.with_extension("notepadrs.tmp")`, NEVER `std::env::temp_dir().join(...)` for the rename target. Document this rule in `file.rs::save_atomic`.

**Phase to address:** This phase. Coding-discipline issue; covered by the implementation Pattern D shows.

## Code Examples

### Example 1 — Encoding cascade (verified pattern)

```rust
// src/encoding.rs (NEW)
// Source: encoding_rs docs (HIGH); architecture.md Pattern 8 (HIGH)

use encoding_rs::{Encoding, UTF_8, UTF_16LE, UTF_16BE, WINDOWS_1252};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DetectedEncoding {
    Utf8,            // no BOM
    Utf8Bom,         // EF BB BF
    Utf16Le,         // FF FE BOM, OR heuristic-detected
    Utf16Be,         // FE FF BOM, OR heuristic-detected
    Cp1252,          // ANSI fallback (Windows-1252)
}

impl DetectedEncoding {
    pub fn label(self) -> &'static str {
        match self {
            DetectedEncoding::Utf8 => "UTF-8",
            DetectedEncoding::Utf8Bom => "UTF-8 BOM",
            DetectedEncoding::Utf16Le => "UTF-16 LE",
            DetectedEncoding::Utf16Be => "UTF-16 BE",
            DetectedEncoding::Cp1252 => "ANSI",
        }
    }
}

/// Returns (detected encoding, BOM length to strip from the start of bytes).
pub fn detect_encoding(bytes: &[u8]) -> (DetectedEncoding, usize) {
    // Step 0: empty file → UTF-8 default.
    if bytes.is_empty() {
        return (DetectedEncoding::Utf8, 0);
    }

    // Step 1: BOM check.
    let bom_slice = &bytes[..bytes.len().min(3)];
    if let Some((enc, bom_len)) = Encoding::for_bom(bom_slice) {
        let de = if enc == UTF_8 { DetectedEncoding::Utf8Bom }
            else if enc == UTF_16LE { DetectedEncoding::Utf16Le }
            else if enc == UTF_16BE { DetectedEncoding::Utf16Be }
            else { unreachable!("for_bom only returns UTF_8 | UTF_16LE | UTF_16BE") };
        return (de, bom_len);
    }

    // Step 2: strict UTF-8 validity AND has at least one non-ASCII byte.
    if std::str::from_utf8(bytes).is_ok() && bytes.iter().any(|b| *b >= 0x80) {
        return (DetectedEncoding::Utf8, 0);
    }

    // Step 3: BOM-less UTF-16 NUL-parity heuristic on first 4KB.
    let scan = &bytes[..bytes.len().min(4096)];
    let half = scan.len() / 2;
    if half >= 64 {
        let nul_even: usize = scan.iter().step_by(2).filter(|b| **b == 0).count();
        let nul_odd: usize = scan.iter().skip(1).step_by(2).filter(|b| **b == 0).count();
        let total_pairs = half;
        if nul_even * 100 / total_pairs >= 40 && nul_odd * 100 / total_pairs <= 5 {
            return (DetectedEncoding::Utf16Be, 0);
        }
        if nul_odd * 100 / total_pairs >= 40 && nul_even * 100 / total_pairs <= 5 {
            return (DetectedEncoding::Utf16Le, 0);
        }
    }

    // Step 4: pure ASCII → label as UTF-8 (no BOM). Modern default.
    if bytes.iter().all(|b| *b < 0x80) {
        return (DetectedEncoding::Utf8, 0);
    }

    // Step 5: CP1252 fallback. Never fails.
    (DetectedEncoding::Cp1252, 0)
}

/// Decode bytes (assumed BOM already stripped via the bom_len) into UTF-8 String.
pub fn decode(enc: DetectedEncoding, bytes: &[u8]) -> String {
    let codec: &'static Encoding = match enc {
        DetectedEncoding::Utf8 | DetectedEncoding::Utf8Bom => UTF_8,
        DetectedEncoding::Utf16Le => UTF_16LE,
        DetectedEncoding::Utf16Be => UTF_16BE,
        DetectedEncoding::Cp1252 => WINDOWS_1252,
    };
    let (cow, _malformed) = codec.decode_without_bom_handling(bytes);
    cow.into_owned()
}

/// Encode UTF-8 String to target encoding's bytes, with appropriate BOM prefix.
pub fn encode(enc: DetectedEncoding, text: &str) -> Vec<u8> {
    let codec: &'static Encoding = match enc {
        DetectedEncoding::Utf8 | DetectedEncoding::Utf8Bom => UTF_8,
        DetectedEncoding::Utf16Le => UTF_16LE,
        DetectedEncoding::Utf16Be => UTF_16BE,
        DetectedEncoding::Cp1252 => WINDOWS_1252,
    };
    let (cow, _used_enc, _had_unmappable) = codec.encode(text);
    let body = cow.into_owned();
    let mut out = Vec::with_capacity(body.len() + 3);
    match enc {
        DetectedEncoding::Utf8Bom => out.extend_from_slice(&[0xEF, 0xBB, 0xBF]),
        DetectedEncoding::Utf16Le => out.extend_from_slice(&[0xFF, 0xFE]),
        DetectedEncoding::Utf16Be => out.extend_from_slice(&[0xFE, 0xFF]),
        _ => {}
    }
    out.extend_from_slice(&body);
    out
}
```

**Caveat — `encoding_rs::UTF_16LE.encode()` may not work as expected.** Verify experimentally: `encoding_rs` is primarily a Web/HTTP encoding library where the encoding side is UTF-8 → target. Its `encode` for UTF-16 LE/BE may *substitute* characters rather than emit raw UTF-16 bytes. If `(UTF_16LE.encode("hello"))` returns `[h, e, l, l, o]` (UTF-8) rather than `[h, 0, e, 0, l, 0, l, 0, o, 0]` (UTF-16 LE), Phase 2 will need a fallback: hand-rolled UTF-8 → UTF-16 LE/BE conversion (~30 LOC, mechanical: iterate `char_indices()` → `char as u32` → emit codepoints with surrogate pair logic for non-BMP). **The Wave 0 test (Plan 02-01 Task 1) should validate this round-trip on the dev machine before relying on it.** If the fallback is needed, the implementation lives in `src/encoding.rs::encode_utf16_le` / `encode_utf16_be`.

### Example 2 — EOL detection (verified pattern)

```rust
// src/eol.rs (NEW)
// Source: pitfalls.md Pitfall 4 (HIGH); npp-user-manual.org (HIGH)

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Eol { Lf, Crlf, Cr, Mixed(MixedMajority) }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MixedMajority { Lf, Crlf, Cr }

pub fn detect_eol(text: &str) -> Eol {
    let scan = &text.as_bytes()[..text.len().min(64 * 1024)];
    let (mut crlf, mut cr, mut lf) = (0usize, 0usize, 0usize);
    let mut i = 0;
    while i < scan.len() {
        match scan[i] {
            b'\r' if i + 1 < scan.len() && scan[i + 1] == b'\n' => { crlf += 1; i += 2; }
            b'\r' => { cr += 1; i += 1; }
            b'\n' => { lf += 1; i += 1; }
            _ => { i += 1; }
        }
    }
    let total = crlf + cr + lf;
    if total == 0 { return Eol::Crlf; }   // empty / no-newline → Windows default
    let max = crlf.max(cr).max(lf);
    let kind = if max == crlf { (Eol::Crlf, MixedMajority::Crlf) }
        else if max == lf { (Eol::Lf, MixedMajority::Lf) }
        else { (Eol::Cr, MixedMajority::Cr) };
    if max * 100 / total >= 95 { kind.0 } else { Eol::Mixed(kind.1) }
}

/// Convert text holding any EOL style to LF-only (canonical in-memory form).
pub fn normalize_to_lf(text: &str) -> String {
    // Order matters: replace CRLF before CR.
    text.replace("\r\n", "\n").replace('\r', "\n")
}

/// Convert LF-only text to bytes with the target EOL style.
/// (For Mixed, the caller should NOT call denormalize — it should write the cached
/// original bytes verbatim. Mixed is a status-bar label, not a save format.)
pub fn denormalize_to_eol(text: &str, eol: Eol) -> String {
    match eol {
        Eol::Lf | Eol::Mixed(MixedMajority::Lf) => text.to_owned(),
        Eol::Crlf | Eol::Mixed(MixedMajority::Crlf) => text.replace('\n', "\r\n"),
        Eol::Cr | Eol::Mixed(MixedMajority::Cr) => text.replace('\n', "\r"),
    }
}
```

### Example 3 — Atomic save (verified pattern)

```rust
// src/file.rs (extension)
// Source: learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew (HIGH)

use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::PCWSTR;
use windows::Win32::Storage::FileSystem::*;

use crate::error::{Error, Result};

pub fn save_atomic(target: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = target.with_extension("notepadrs.tmp");
    std::fs::write(&tmp, bytes)?;

    if !target.exists() {
        // First save (Save As to a new path) — just rename.
        return std::fs::rename(&tmp, target).map_err(Into::into);
    }

    let target_w: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let tmp_w: Vec<u16> = tmp.as_os_str().encode_wide().chain(Some(0)).collect();

    let result = unsafe {
        ReplaceFileW(
            PCWSTR(target_w.as_ptr()),
            PCWSTR(tmp_w.as_ptr()),
            PCWSTR::null(),
            REPLACEFILE_IGNORE_MERGE_ERRORS,
            None, None,
        )
    };

    if result.is_err() {
        // ReplaceFileW failed - try a fallback then surface the error.
        // Best-effort cleanup of the orphaned temp file.
        let _ = std::fs::remove_file(&tmp);
        return Err(Error::Io(std::io::Error::last_os_error()));
    }
    Ok(())
}
```

## State of the Art

| Old Approach | Current Approach | Phase |
|--------------|------------------|--------|
| `WM_SETTEXT` for load (silently normalizes EOL) | `EM_STREAMIN` with `SF_TEXT \| (CP_UTF8 << 16)` (already wired in Phase 1) | Phase 1 ✅ |
| Bare `std::fs::write` on save (non-atomic) | `ReplaceFileW(REPLACEFILE_IGNORE_MERGE_ERRORS)` over a sibling `.notepadrs.tmp` | This phase |
| Raw `read_to_string` (assumes UTF-8, breaks on UTF-16/CP1252) | `std::fs::read` → `detect_encoding` → `Encoding::decode` | This phase |
| `String::lines().join("\n")` (silent CRLF→LF) | Cache original bytes; only re-emit on edited save | This phase (Pattern A) |
| Synchronous `std::fs::read` (blocks UI on dead network share) | `std::thread::spawn` + `mpsc::recv_timeout(5s)` for open path | This phase (Pattern E) |
| Hand-rolled CP1252 lookup | `encoding_rs::WINDOWS_1252.decode_without_bom_handling()` | This phase |

**Deprecated/outdated:**
- The `winapi` crate's `ReplaceFileA`/`ReplaceFileW` bindings — replaced by `windows = "0.62"` typed bindings.
- `IMultiLanguage2::DetectInputCodepage` — IE-era encoding detection. Notoriously inaccurate on small files; out of scope per allowlist anyway.

## Open Questions

1. **Does `encoding_rs::UTF_16LE.encode(text)` emit raw UTF-16 LE bytes or transcode to UTF-8?**
   - What we know: `encoding_rs` is a Web encoding library; `decode_without_bom_handling` clearly transcodes UTF-16 → UTF-8 string. The reverse `encode` direction is less commonly used.
   - What's unclear: Whether `UTF_16LE.encode("hello")` produces 5 bytes (UTF-8 fallback) or 10 bytes (UTF-16 LE pair).
   - Recommendation: Plan 02-01 Task 1 (Wave 0 test): write a 3-line proof-of-concept test that calls `UTF_16LE.encode("test")` and inspects the byte length. If incorrect, hand-roll `encode_utf16_le`/`encode_utf16_be` (~30 LOC each); if correct, use `encoding_rs` directly. Document the answer in 02-01-summary.md.
   - **Confidence:** LOW until measured. Build the alternative implementation as a private helper in `src/encoding.rs` regardless; switch to `encoding_rs` if it works.

2. **Does `EM_GETMODIFY` fire reliably as 0 immediately after `EM_STREAMIN` + `EM_SETMODIFY(0)`?**
   - What we know: Phase 1 already calls `EM_SETMODIFY(0)` after `EM_STREAMIN` (verified in `src/editor.rs::open_text`).
   - What's unclear: Whether some downstream message (e.g., `WM_SETFONT` applied after the load, or a `WM_PAINT` triggered repaint) re-flips the modify bit.
   - Recommendation: Plan 02-02 Wave 0 test: open a fixture, immediately query `EM_GETMODIFY`, assert it's 0. Then run `WM_SETREDRAW(TRUE)` cycle, assert again. If flipping is observed, add an `EM_SETMODIFY(0)` after the cycle. **Confidence:** MEDIUM — `EM_SETMODIFY` is documented to be a stable state until a real edit occurs, but RichEdit can be surprising.

3. **Is the 95% EOL-majority threshold too strict or too loose?**
   - What we know: Notepad++ uses a "majority+mixed" model with the threshold not publicly documented.
   - What's unclear: Whether a file with 5 LF + 95 CRLF should classify as "CRLF" or "Mixed (CRLF majority)".
   - Recommendation: Start at 95% (= 5% mixed-tolerance). Document the threshold; allow tuning if real-world files surface false-mixed classifications. **Confidence:** MEDIUM. Round-trip preservation is independent of this (cache is verbatim) — only status-bar display is affected.

4. **For Save As to a different filesystem (e.g., `C:` → `D:` or local → network share), is `ReplaceFileW` correct?**
   - What we know: `ReplaceFileW` requires backup, replaced, replacement files all on the same volume.
   - What's unclear: Our temp file is `target.with_extension("notepadrs.tmp")` — same directory as target, so same volume. The cross-volume case only arises if we reach this code with target somewhere else (we don't).
   - Recommendation: The `target.with_extension(...)` constraint is correct. Document it inline. **Confidence:** HIGH given the constraint.

## Validation Architecture

> `workflow.nyquist_validation` is **not** present in `.planning/config.json` (config is `mode: yolo, depth: quick, workflow: { research, plan_check, verifier, auto_advance }`). The `nyquist_validation` flag is absent — therefore this section is **included as informational** (Phase 1 followed a similar approach with explicit test files). The Phase 2 plans should follow Phase 1's test discipline.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `cargo test` (Rust 1.82 standard test harness, integration tests in `tests/`) |
| Config file | none — Cargo handles discovery automatically. Each `tests/*.rs` file is a separate integration-test binary. |
| Quick run command | `cargo test --target x86_64-pc-windows-msvc --test encoding_cascade --test eol_detection --test roundtrip_matrix` |
| Full suite command | `cargo test --target x86_64-pc-windows-msvc` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FILE-03 | Ctrl+S byte-exact for unedited | unit (pure Rust over `Vec<u8>`) | `cargo test --test roundtrip_matrix unedited_save_byte_exact` | ❌ Plan 02-01 |
| FILE-04 | Save As with explicit encoding/EOL | unit (pure Rust over `Vec<u8>`) | `cargo test --test roundtrip_matrix save_as_converts` | ❌ Plan 02-03 |
| FILE-05 | Detect 5 encodings | unit | `cargo test --test encoding_cascade` (5 detect-* tests, one per encoding) | ❌ Plan 02-01 |
| FILE-06 | Detect 4 EOL styles | unit | `cargo test --test eol_detection` (4 detect-* tests) | ❌ Plan 02-01 |
| FILE-07 | Preserve encoding on save | unit | `cargo test --test roundtrip_matrix preserve_encoding_*` (5 tests, one per encoding) | ❌ Plan 02-01 |
| FILE-08 | Preserve EOL on save | unit | `cargo test --test roundtrip_matrix preserve_eol_*` (4 tests) | ❌ Plan 02-01 |
| FILE-09 | Encoding menu converts | manual smoke | not automated; documented in 02-03-summary.md as a manual gate | ❌ Plan 02-03 |
| FILE-10 | EOL menu converts | manual smoke | not automated | ❌ Plan 02-03 |
| FILE-11 | Open-error UX (4 cases) | unit + manual | unit: `cargo test --test open_errors` for not-found / encoding-fail / timeout (mock); manual smoke for permission-denied + network-share-hang | ❌ Plan 02-04 |
| TEST-02 | Encoding round-trip CI suite | integration | `cargo test --test roundtrip_matrix` (all variants) | ❌ Plan 02-01 |
| TEST-03 | EOL round-trip CI suite | integration | `cargo test --test roundtrip_matrix preserve_eol_*` | ❌ Plan 02-01 |

### Sampling Rate

- **Per task commit:** `cargo test --test {affected_test_file}` for the file just modified (~1s). Pre-commit hook in CI recommended.
- **Per plan complete:** `cargo test --target x86_64-pc-windows-msvc` (full suite, all phases). Should complete in <10s.
- **Phase gate (`/pan:verify-phase`):** Full suite + manual smoke checklist for FILE-09/-10/-11 documented gates.

### Wave 0 Gaps

- [ ] `tests/encoding_cascade.rs` — covers FILE-05 + TEST-02 detection portion (Plan 02-01)
- [ ] `tests/eol_detection.rs` — covers FILE-06 + TEST-03 detection portion (Plan 02-01)
- [ ] `tests/roundtrip_matrix.rs` — covers FILE-03/-07/-08 + TEST-02/-03 round-trip portion (Plan 02-01)
- [ ] `tests/open_errors.rs` — covers FILE-11 (Plan 02-04)
- [ ] 9 new fixtures under `tests/fixtures/` (see Test Fixture Strategy below)
- [ ] Wave 0 spike test: prove `encoding_rs::UTF_16LE.encode()` round-trips correctly (or implement hand-rolled fallback) — Plan 02-01 Task 1
- [ ] Wave 0 spike test: prove `EM_GETMODIFY` is reliably 0 after `EM_SETMODIFY(0)` — Plan 02-02 Task 1

## Test Fixture Strategy

### Fixture Layout

All fixtures live under `tests/fixtures/`. The directory is already covered by `.gitattributes: tests/fixtures/* binary` (verified — set in Phase 1; no changes needed).

Recommended fixture set (9 files):

| File | Encoding | EOL | Content (semantics) |
|------|----------|-----|---------------------|
| `utf8_no_bom_lf.txt` | UTF-8 (no BOM) | LF | "Hello\nWörld\n" — has non-ASCII to disambiguate from CP1252 |
| `utf8_bom_crlf.txt` | UTF-8 BOM | CRLF | `EF BB BF` + "Hello\r\nWörld\r\n" |
| `utf16le_bom_crlf.txt` | UTF-16 LE | CRLF | `FF FE` + UTF-16-LE-encoded "Hello\r\nWörld\r\n" |
| `utf16be_bom_lf.txt` | UTF-16 BE | LF | `FE FF` + UTF-16-BE-encoded "Hello\nWörld\n" |
| `cp1252_crlf.txt` | CP1252 | CRLF | bytes representing "Hello\r\nWörld\r\n" — `0x57 0xF6 0x72 0x6C 0x64` for "Wörld" |
| `ascii_lf.txt` | (existing — Phase 1) ASCII LF | (treated as UTF-8) | (existing — keeps Phase 1 test passing) |
| `cr_only.txt` | UTF-8 (no BOM) | CR | "Hello\rWorld\r" — pure-CR (rare; classic Mac) |
| `mixed_eol.txt` | UTF-8 (no BOM) | Mixed | "lineA\r\nlineB\nlineC\r\nlineD\n" — half CRLF, half LF |
| `empty.txt` | (sentinel — 0 bytes) | (default CRLF) | Empty file. Detect → UTF-8/CRLF defaults. |

**Construction approach:** Each fixture is committed to git as raw bytes. To avoid editor-induced corruption, generate them via a one-time `tools/generate-fixtures.rs` script (committed alongside) that writes byte-exact content. This ensures reproducibility — the script is the spec.

```rust
// tools/generate-fixtures.rs (one-time use; committed to repo so anyone can regenerate)
use std::fs;
fn main() {
    let utf16le_bom: Vec<u8> = std::iter::empty()
        .chain([0xFFu8, 0xFE].iter().copied())  // BOM
        .chain("Hello\r\nWörld\r\n".encode_utf16().flat_map(u16::to_le_bytes))
        .collect();
    fs::write("tests/fixtures/utf16le_bom_crlf.txt", &utf16le_bom).unwrap();
    // ... 8 more fixtures
}
```

### Test Pattern (parametric)

```rust
// tests/roundtrip_matrix.rs (NEW)
use std::path::Path;
use notepadrs::encoding::{detect_encoding, decode, encode, DetectedEncoding};
use notepadrs::eol::{detect_eol, Eol};
use notepadrs::file::save_atomic;

fn assert_round_trip(path: &str, expected_enc: DetectedEncoding, expected_eol: Eol) {
    let original = std::fs::read(Path::new(path))
        .unwrap_or_else(|_| panic!("fixture must exist: {}", path));

    // Detection
    let (enc, bom_len) = detect_encoding(&original);
    assert_eq!(enc, expected_enc, "encoding mismatch for {}", path);

    // Decode (skip BOM bytes)
    let text = decode(enc, &original[bom_len..]);

    // EOL detection on the decoded string
    let eol = detect_eol(&text);
    assert_eq!(eol, expected_eol, "eol mismatch for {}", path);

    // Unedited round-trip: emit cached bytes verbatim.
    let tmp = std::env::temp_dir().join(format!("notepadrs_rt_{}.txt", std::process::id()));
    save_atomic(&tmp, &original).expect("save");
    let saved = std::fs::read(&tmp).expect("read-back");
    let _ = std::fs::remove_file(&tmp);
    assert_eq!(saved, original, "byte-exact round-trip for {}", path);
}

#[test] fn round_trip_utf8_no_bom_lf() {
    assert_round_trip("tests/fixtures/utf8_no_bom_lf.txt",
        DetectedEncoding::Utf8, Eol::Lf);
}
#[test] fn round_trip_utf8_bom_crlf() {
    assert_round_trip("tests/fixtures/utf8_bom_crlf.txt",
        DetectedEncoding::Utf8Bom, Eol::Crlf);
}
#[test] fn round_trip_utf16le_bom_crlf() {
    assert_round_trip("tests/fixtures/utf16le_bom_crlf.txt",
        DetectedEncoding::Utf16Le, Eol::Crlf);
}
#[test] fn round_trip_utf16be_bom_lf() {
    assert_round_trip("tests/fixtures/utf16be_bom_lf.txt",
        DetectedEncoding::Utf16Be, Eol::Lf);
}
#[test] fn round_trip_cp1252_crlf() {
    assert_round_trip("tests/fixtures/cp1252_crlf.txt",
        DetectedEncoding::Cp1252, Eol::Crlf);
}
#[test] fn round_trip_cr_only() {
    assert_round_trip("tests/fixtures/cr_only.txt",
        DetectedEncoding::Utf8, Eol::Cr);
}
#[test] fn round_trip_mixed_eol() {
    use notepadrs::eol::MixedMajority;
    assert_round_trip("tests/fixtures/mixed_eol.txt",
        DetectedEncoding::Utf8, Eol::Mixed(MixedMajority::Crlf));
}
#[test] fn round_trip_empty() {
    assert_round_trip("tests/fixtures/empty.txt",
        DetectedEncoding::Utf8, Eol::Crlf);
}
```

### Edited-Save Test (validates Pattern A's edited path)

```rust
// tests/roundtrip_matrix.rs (continued)
#[test]
fn edited_save_preserves_eol_for_each_style() {
    // For each (encoding, eol), simulate "user typed 'X' at position 0", then save,
    // assert the saved bytes start with the encoded 'X' followed by the original
    // bytes (modulo BOM placement).
    let cases = [
        ("tests/fixtures/utf8_no_bom_lf.txt", DetectedEncoding::Utf8, Eol::Lf),
        ("tests/fixtures/utf8_bom_crlf.txt", DetectedEncoding::Utf8Bom, Eol::Crlf),
        ("tests/fixtures/utf16le_bom_crlf.txt", DetectedEncoding::Utf16Le, Eol::Crlf),
        ("tests/fixtures/utf16be_bom_lf.txt", DetectedEncoding::Utf16Be, Eol::Lf),
        ("tests/fixtures/cp1252_crlf.txt", DetectedEncoding::Cp1252, Eol::Crlf),
    ];
    for (path, enc, eol) in cases {
        let original = std::fs::read(path).expect("fixture");
        let (det_enc, bom_len) = detect_encoding(&original);
        assert_eq!(det_enc, enc);
        let text = decode(enc, &original[bom_len..]);
        let edited = format!("X{}", text);  // simulate prepend-edit
        let denormalized = notepadrs::eol::denormalize_to_eol(&edited, eol);
        let bytes = encode(enc, &denormalized);
        // Property: byte length increased by exactly the encoded width of 'X'.
        let x_width = match enc {
            DetectedEncoding::Utf16Le | DetectedEncoding::Utf16Be => 2,
            _ => 1,
        };
        assert_eq!(bytes.len(), original.len() + x_width,
            "edited-save length mismatch for {}: expected {}+{}, got {}",
            path, original.len(), x_width, bytes.len());
    }
}
```

## Sources

### Primary (HIGH confidence)

- [Microsoft Learn: ReplaceFileW function (winbase.h)](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-replacefilew) — atomic save semantics, ACL/attribute preservation, flag definitions, REPLACEFILE_WRITE_THROUGH "not supported" note.
- [Microsoft Learn: MoveFileExW function (winbase.h)](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-movefileexw) — fallback rename semantics, MOVEFILE_REPLACE_EXISTING + MOVEFILE_WRITE_THROUGH.
- [Microsoft Learn: About Rich Edit Controls](https://learn.microsoft.com/en-us/windows/win32/controls/about-rich-edit-controls) — "Rich Edit 2.0 used only a carriage return character" (the CR-only normalization fact that drives Pattern A).
- [Microsoft Learn: EM_STREAMIN message (Richedit.h)](https://learn.microsoft.com/en-us/windows/win32/controls/em-streamin) — SF_TEXT, SF_USECODEPAGE, CP_UTF8 in high WORD of wParam.
- [Microsoft Learn: EM_STREAMOUT message (Richedit.h)](https://learn.microsoft.com/en-us/windows/win32/controls/em-streamout) — same flag bits (note the docs are silent on EOL preservation; Pattern A is the workaround).
- [docs.rs: encoding_rs::Encoding](https://docs.rs/encoding_rs/0.8.35/encoding_rs/struct.Encoding.html) — `for_bom`, `decode`, `decode_with_bom_removal`, `decode_without_bom_handling`, `encode`. UTF_8/UTF_16LE/UTF_16BE/WINDOWS_1252 statics.
- [Phase 1 verification](../01-foundations-editor-spine/01-verification.md) — confirms what's already shipped: `EM_STREAMIN`/`EM_STREAMOUT` for UTF-8, `EM_SETMODIFY(0)` after load, `EM_SETUNDOLIMIT(1000)`, `EM_AUTOURLDETECT(FALSE)`. Phase 2 inherits these.
- [Phase 1 plan 01-03](../01-foundations-editor-spine/01-03-plan.md) — establishes the file/menu/dispatch glue Phase 2 extends.
- [Project research: architecture.md](../../research/architecture.md) — Pattern 8 (Encoding Detection Cascade) is the parent of this phase's Pattern B. The 4-step cascade there becomes the 5-step cascade here (added the pure-ASCII step explicitly).
- [Project research: pitfalls.md](../../research/pitfalls.md) — Pitfalls 3 (encoding mis-detection), 4 (line-ending normalization), 12 (file-IO error UX), 17 (trailing newline), 18 (encoding-conversion dirty flag) — all covered in this phase's plans.
- [Project research: stack.md](../../research/stack.md) — confirms `encoding_rs` is the right choice and chardetng is correctly deferred.

### Secondary (MEDIUM confidence)

- [hsivonen.fi: encoding_rs design](https://hsivonen.fi/encoding_rs/) — author's writeup; explains BOM handling and sniffing modes.
- [unicodebook.readthedocs.io: Guess encoding of a document](https://unicodebook.readthedocs.io/guess_encoding.html) — UTF-8 strict-validation reliability + UTF-16 NUL-parity heuristic origin.
- [autoitconsulting.com: UTF-8/UTF-16 detection library](https://www.autoitconsulting.com/site/development/utf-8-utf-16-text-encoding-detection-library/) — practical thresholds for NUL-parity heuristic; corroborates the 40%/5% picks.
- [Wikipedia: Byte order mark](https://en.wikipedia.org/wiki/Byte_order_mark) — BOM byte sequences (cross-checked against `encoding_rs::Encoding::for_bom`).
- [microsoft.public.vc.mfc.narkive.com: carriage return in RichEdit](https://microsoft.public.vc.mfc.narkive.com/V4Ng2oA9/carriage-return-in-richedit) — community confirmation of CR-only paragraph markers in RichEdit 2.0+; reinforces the documented Microsoft Learn note.

### Tertiary (LOW confidence — flagged for Wave 0 verification)

- `encoding_rs::UTF_16LE.encode(text)` raw-byte output — needs spike test in Plan 02-01 Task 1 (see Open Question 1). If the encode direction does not produce raw UTF-16 LE/BE bytes, hand-roll the encoder (~30 LOC).

## Infrastructure Dependencies

**None.** All Phase 2 testing is pure Rust unit/integration tests over `Vec<u8>` and file I/O. No Docker, no test services, no databases. The 9 fixtures are committed to git under `tests/fixtures/` (already covered by `.gitattributes binary`).

The single-host requirement is the existing CI matrix (Windows 10/11 with `x86_64-pc-windows-msvc` and `cargo test`).

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — `encoding_rs` is on allowlist, `windows` 0.62 has `Win32_Storage_FileSystem` for `ReplaceFileW`. No new crates.
- Architecture (5 patterns): **MEDIUM-HIGH** — Pattern A (Original-Bytes Cache) is the central design choice; deduced from documented RichEdit normalization. Validated by the round-trip test which mechanically catches any failure. Pattern E (network-share timeout) is HIGH on the std::thread+mpsc approach; LOW on the optimal timeout value (5s is a guess).
- Encoding cascade (Pattern B): **HIGH** — fully documented; deterministic; testable.
- EOL detection (Pattern C): **HIGH** algorithmic; **MEDIUM** on the 95% threshold (Open Question 3).
- Atomic save (Pattern D): **HIGH** — `ReplaceFileW` is the documented and ACL-preserving choice.
- Pitfalls (A–H): **HIGH** — most are explicit project-level pitfalls; Pitfall A (RichEdit CR normalization) is the only Phase-2-specific deduction and it's directly supported by Microsoft Learn.
- Test strategy: **HIGH** — fixture-based, pure-Rust, fully automatable.

**Research date:** 2026-05-02
**Valid until:** 30 days for stable concerns (encoding_rs API, Win32 APIs); 7 days for the LOW-confidence `UTF_16LE.encode()` open question — resolve in Plan 02-01 Wave 0.

---

*Phase 2 research complete. The spine of this phase is Pattern A — Original-Bytes Cache — which makes byte-exact round-trip mechanically guaranteed. Without it, RichEdit's CR-only normalization corrupts every CRLF and LF file silently.*
