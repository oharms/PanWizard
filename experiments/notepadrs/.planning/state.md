---
pan_state_version: 1.0
milestone: v1.0
milestone_name: v1.0-ready
milestone_status: ready_to_ship
current_phase: 5
current_phase_name: Polish + Dogfood + Ship
current_plan: 05-05 done — Phase 5 verified
status: milestone_ready
stopped_at: All 5 phases / 24 plans complete; Phase 5 verification = 5/5 truths AUTO-VERIFIED at code+test layer; v1.0.0 release pending dogfood Step 7 manual gate + git tag
last_updated: "2026-05-03T04:35:00.000Z"
last_activity: 2026-05-03
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 24
  completed_plans: 24
  percent: 100
release:
  version: v1.0.0
  status: ready_pending_manual_gate
  blocking_gate: "dogfood-checklist.md Step 7 (cargo build after Cargo.toml round-trip in notepadrs.exe)"
  ship_runbook: ".planning/phases/05-polish-dogfood-ship/ship-checklist.md"
  binary_size_bytes: 1527296
  cumulative_tests: 346
---

# Project State

## Project Reference

See: .planning/project.md (updated 2026-05-02)

**Core value:** A Notepad++ user can open, edit, and save a text file in `notepadrs.exe` without giving up encoding correctness, multi-tab editing, or regex find/replace — and the developer dogfoods it on the project's own `Cargo.toml`.
**Current focus:** v1.0.0 release — milestone ready; pending manual dogfood Step 7 gate + `git tag v1.0.0`

## Current Position

**Current Phase:** 5 (last phase — milestone close-out)
**Current Phase Name:** Polish + Dogfood + Ship
**Current Plan:** 05-05 done — Phase 5 verification report committed
**Total Plans in Phase:** 5 (05-01 through 05-05) — all complete
**Total Phases:** 5 — all complete
**Status:** v1.0 milestone READY — all phases verified at code+test layer; v1.0.0 release pending manual dogfood Step 7 gate + `git tag v1.0.0` (per ship-checklist.md Step 6, human-action only)
**Last Activity:** 2026-05-03
**Last Activity Description:** Phase 5 verification report (.planning/phases/05-polish-dogfood-ship/05-verification.md) committed — 5/5 truths AUTO-VERIFIED at code+test layer; visual GUI confirmation + Step 7 save round-trip flagged HUMAN-VERIFY
**Progress:** [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 02-file-i-o-encoding-cascade P01 | 35 | 3 tasks | 11 files |
| Phase 02-file-i-o-encoding-cascade P02 | 6 | 3 tasks | 9 files |
| Phase 02-file-i-o-encoding-cascade P03 | 25 | 3 tasks | 8 files |
| Phase 02-file-i-o-encoding-cascade P04 | 20 | 3 tasks | 5 files |
| Phase 03 P01 | 50 min | 3 tasks | 5 files |
| Phase 03 P03 | 7 | 3 tasks | 6 files |
| Phase 03 P02 | 25 | 3 tasks | 5 files |
| Phase 03 P04 | 10m | 4 tasks | 7 files |
| Phase 03-multi-tab-find-replace P04 | 11 | 4 tasks | 7 files |
| Phase 03-multi-tab-find-replace P05 | 8 | 4 tasks | 7 files |
| Phase 03-multi-tab-find-replace P05 | 7 | 4 tasks | 7 files |
| Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting P01 | 11 | 3 tasks | 15 files |
| Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting P02 | 5 | 3 tasks | 4 files |
| Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting P04a | 15 | 3 tasks | 5 files |
| Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting P05 | 2 | 1 tasks | 1 files |
| Phase 05 P01 | 25 min | 3 tasks | 9 files |
| Phase 05 P02 | 30 min | 3 tasks | 9 files |
| Phase 05 P03 | 18 min | 2 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in project.md Key Decisions table.
Recent decisions affecting current work:

- Roadmap: 5 phases (collapsed Polish + Quality Gate from research's recommended 6 — binary-size CI gate front-loads to Phase 1, dogfood marker stays as natural conclusion of polish phase).
- Roadmap: Critical pitfalls (panic discipline, GWLP_USERDATA, OleInitialize, release-profile flags) front-loaded as QUAL-01..04 in Phase 1 to avoid multi-day retrofit cost.
- Roadmap: Encoding cascade (Phase 2) precedes multi-tab (Phase 3) so per-tab encoding state has a foundation before tabs replicate it.
- Pending Plan-01: RichEdit vs custom-render commit (research recommends RichEdit for v1, document v2 escape hatch).
- [Phase 02]: 5-step encoding cascade: BOM > strict UTF-8 with non-ASCII > NUL-parity heuristic > pure ASCII (never CP1252) > CP1252 fallback
- [Phase 02]: Wave 0 spike resolved: encoding_rs v0.8.35 UTF_16LE.encode() emits raw UTF-16 bytes; hand-rolled fallback compiled but not live
- [Phase 02]: EOL detection runs on decoded str not raw bytes; 95% majority threshold; Mixed carries dominant style for status-bar
- [Phase 02-file-i-o-encoding-cascade]: Pattern A (Original-Bytes Cache): unedited saves write cached bytes verbatim via ReplaceFileW, bypassing RichEdit CR normalization — the linchpin for byte-exact round-trip
- [Phase 02-file-i-o-encoding-cascade]: ReplaceFileW returns windows::core::Result<()> in windows 0.62 — use is_err() not as_bool()
- [Phase 02-file-i-o-encoding-cascade]: IDM_* range 110-118: Save As=110, encoding UTF8..ANSI=111-115, EOL LF..CR=116-118; range 119-122 reserved for 02-04
- [Phase 02-file-i-o-encoding-cascade]: dispatch_pure module split: pure decision logic (encoding_change_decision, eol_change_decision) separated from Win32 effects for headless unit testing
- [Phase 02-file-i-o-encoding-cascade]: Windows AppCompat shim blocks test binaries named *dispatch* from cargo test (ERROR_ELEVATION_REQUIRED 740); test file renamed to menu_action_tests.rs
- [Phase 02-file-i-o-encoding-cascade]: Task 2b (DialogBoxIndirectParamW single dialog) deferred to Phase 4; sequential MessageBox picker shipped as v1 Save As UX
- [Phase 02-file-i-o-encoding-cascade]: Pattern E (read_with_timeout): worker thread + mpsc::recv_timeout for bounded-timeout file reads; generic closure for deterministic test injection
- [Phase 02-file-i-o-encoding-cascade]: FILE-11 UX: categorize_open_error_with_os_msg in dispatch_pure.rs with os_msg_provider closure; dispatch.rs thin wrapper supplies FormatMessageW; each error variant gets distinct user-facing message
- [Phase 02-file-i-o-encoding-cascade]: Worker thread leaked on timeout (bounded, acceptable for v1); CancelSynchronousIo deferred to v1.x (D-9)
- [Phase 03]: regex 1.12 chosen as the only new dep for find/replace engine; fancy-regex/regex-lite/regex::bytes all rejected with rationale
- [Phase 03]: Pure-logic find/replace engine on UTF-8 byte offsets; UTF-16 conversion isolated as helpers (utf8_to_utf16_units / utf16_to_utf8_offset)
- [Phase 03]: CompileError ladder (Empty / EmptyMatch / Regex) lets UI distinguish silent-no-op vs status-line vs red-border without parsing error strings
- [Phase 03]: Plan 03-02 SysTabControl32 owner-drawn strip: TCS_OWNERDRAWFIXED + TCS_FOCUSNEVER, height 28px; tab.id stable u64 in TCITEM lParam (Pattern 8); switch order hide → show → SetFocus → active_tab → find_epoch++ → title (D-11, Pitfall 9, 11)
- [Phase 03]: Plan 03-02 dirty propagation: EN_CHANGE enabled via EM_SETEVENTMASK + ENM_CHANGE in EditorState::create (D-6, one-line edit); WM_COMMAND HIWORD == 0x0300 branch matched BEFORE IDM cmd switch; pure-logic decide_dirty_after_change extracted for headless SC-2.2 test coverage (BLOCKER 3 closed)
- [Phase 03]: Plan 03-02 do_file_open D-14 fresh-tab heuristic: load in active tab when current_path.is_none() && !dirty && original_bytes.is_empty(); otherwise push new tab + switch. Mirrors Notepad++/VS Code behavior
- [Phase 03]: Plan 03-04 D-1: modeless Find/Replace dialog via CreateWindowExW (no .rc resource); D-8 Replace All ONE-undo via EM_STOPGROUPTYPING + EM_SETTEXTEX(ST_KEEPUNDO); deviated to placing pure helpers in find_dispatch_pure.rs (not dispatch.rs) to avoid lib visibility cascade
- [Phase 03-multi-tab-find-replace]: Plan 03-04: Modeless Find/Replace dialog via CreateWindowExW (no .rc), pure-logic helpers split into src/find_dispatch_pure.rs to avoid lib-level crate::log resolution issue, test file renamed to find_replace_pure.rs to sidestep Windows AppCompat shim on *dispatch* binaries (error 740)
- [Phase 03-multi-tab-find-replace]: [Phase 03-05]: Worker thread + epoch cancellation pattern (FIND-10) — std::thread::spawn + Arc<AtomicU64> + mpsc::Sender; closure-injected wakeup (BLOCKER 2 / Phase 2 read_with_timeout precedent) makes spawn_find testable without HWND. Production passes PostMessageW closure; tests pass |_| {}.
- [Phase 03-multi-tab-find-replace]: Plan 03-05: Worker-thread find for buffers >1MB via std::thread::spawn + Arc<AtomicU64> epoch cancellation + closure-injected PostMessageW wakeup (BLOCKER 2). spawn_find<F: Fn(u64) + Send + 'static> mirrors Phase 2 read_with_timeout<F>. find_pending stash keys (epoch, lf_text) for the WM_APP_FIND_RESULT handler. 1MB threshold (D-1, QUAL-07). Worker thread leak on cancellation accepted as bounded (D-9, Phase 2 precedent).
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-01 D-13: EM_SETEVENTMASK pre-allocated to ENM_CHANGE|ENM_SCROLL|ENM_SELCHANGE in EditorState::create — Plans 04-02 and 04-03 can run truly parallel (no editor.rs collision)
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-01 D-12: gutter+status_bar module files created in same task as their lib.rs/main.rs declarations (build green at end of each task; no placeholder one-line files)
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-01: Per-tab gutter as sibling child window (MAKEINTATOM cast: `PCWSTR(atom as usize as *const u16)`); GWLP_USERDATA on gutter holds sibling hwnd_re for 04-02 WM_PAINT; Drop destroys gutter before editor (LIFO)
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-01: WM_APP_HIGHLIGHT_REQUEST = WM_USER+12 (continues WM_USER+10/+11 sequence from Phase 3); all WM_APP allocations in app.rs
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-01: Error::from_win32() does not exist in windows-result 0.4.1 — use Error::from_thread() instead (reads GetLastError from current thread)
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-02: gutter WM_PAINT + EN_VSCROLL lockstep via pre-allocated ENM_SCROLL (no editor.rs mutation); gutter_width_for_line_count pure helper; App.em_width_px from tmAveCharWidth; switch_active_tab swaps gutter visibility
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-03 D-3 (per-event cadence): row:col ticks on EN_CHANGE+EN_SELCHANGE; encoding/EOL on menu commands + tab switch; line count on EN_CHANGE; all-four on TCN_SELCHANGE/file open/save
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-03: label_for_status on DetectedEncoding+Eol enums (zero-allocation &'static str); MixedMajority variants all collapse to 'Mixed' for status bar (narrow segment); WONTFIX-v1 P4-5 UTF-16-code-unit columns documented IN SOURCE per Warning #10
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-04a: Five hand-rolled byte-level tokenizers — no regex, no new crates; JS carries JsBlockComment+JsTemplateLiteral state; Python carries PyTripleString state; Markdown carries MdCodeFence state
- [Phase 04-visual-chrome-gutter-status-bar-syntax-highlighting]: Plan 04-05: 39 golden-token-stream tests (find_token + assert_token helpers); multi-line state tests for JS/Python/Markdown; no #[ignore]; TEST-07 closed
- [Phase 05-polish-dogfood-ship]: Plan 05-01: View → Word Wrap toggle wired via EM_SETTARGETDEVICE (Wave-0 spike-locked polarity: lParam=0 = wrap-on); per-tab persistence via App.tabs[i].word_wrap; tab-switch re-applies the saved polarity (VIEW-06, VIEW-07)
- [Phase 05-polish-dogfood-ship]: Plan 05-02: Recent Files MRU (≤10) with serde + atomic write to %APPDATA%\notepadrs\recent.json; WM_INITMENUPOPUP rebuilds the submenu; IDM_RECENT_BASE..+9 dispatch; open_path_external is the single push hook shared with CLI / dialog / drag-drop (RECENT-01..04, TEST-06)
- [Phase 05-polish-dogfood-ship]: Plan 05-03: WM_DROPFILES drag-drop (NOT IDropTarget) wired in WM_CREATE via DragAcceptFiles(true); pure helpers utf16_to_pathbuf + is_droppable_file in dispatch_pure.rs; first-drop fresh-tab heuristic + subsequent-drops push-new-tab; DragFinish always-on-exit (DND-01)
- [Phase 05-polish-dogfood-ship]: Plan 05-04: Two-track dogfood verification — automated load-path smoke (tests/dogfood_marker.rs, 2 tests on the project's own Cargo.toml) + 10-step manual checklist with BLOCKING flag on Step 7 (cargo build after round-trip). User-approved Phase 5 close-out.
- [Phase 05-polish-dogfood-ship]: Plan 05-05: SC-11 / SC-12 ship gate — tests/ship_gate.rs (binary_size_under_10mb: current 1.46MB / 10MB ceiling; test_inventory_meets_minimum_test_count: file-inventory check, 25 required test files, 346 cumulative tests vs ≥30 floor); ship-checklist.md 7-step v1.0.0 release runbook with Step 6 (git tag + push) flagged human-action only

### Pending Todos

None yet.

### Blockers/Concerns

- Plan-01 must commit the RichEdit-vs-custom-render decision in writing before any UI code lands. Research recommends RichEdit 4.1 (`MSFTEDIT_CLASS`) for v1 with custom gutter + status bar + tabs layered on top, deferring custom render to v2 if syntax-highlighting performance fails on >1MB files.

## Session Continuity

**Last session:** 2026-05-03T04:30:00.000Z
**Stopped At:** Completed Phase 5 (5/5 plans); running Phase 5 verification + milestone close-out
**Resume File:** None
