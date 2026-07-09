# Plan 05-01 Wave-0 Spike Result — EM_SETTARGETDEVICE Word-Wrap Polarity

**Date:** 2026-05-03T02:56:52Z
**Spike binary:** `examples/wordwrap_spike.rs` (committed; rerun with `cargo run --release --example wordwrap_spike`)
**OS:** Windows 10 1809+ / 11 (RichEdit 4.1 via MSFTEDIT_CLASS)
**Method:** Insert 500-char no-space line; apply each polarity; query `EM_POSFROMCHAR` Y-coordinate for first vs last character. Wrap occurs when last char Y > first char Y (long line broke onto a new visual row).

## Trial A — lParam=0, style without WS_HSCROLL

- first char: x=1 y=0
- last  char: x=73 y=170
- wrapped: **true**

## Trial B — lParam=1, style with WS_HSCROLL

- first char: x=1 y=0
- last  char: x=3993 y=0
- wrapped: **false**

## Locked Polarity

- `WRAP_ON_LPARAM  = 0`
- `WRAP_OFF_LPARAM = 1`

These constants are committed to `src/word_wrap.rs`. The Plan 05-01 must-have `EM_SETTARGETDEVICE polarity is empirically locked by a Wave-0 spike before production code commits` is satisfied by this artifact.

**Note:** The spike binary `examples/wordwrap_spike.rs` is preserved as a permanent reproducer. If the polarity ever needs re-verification (e.g. a RichEdit version bump), rerun it and update this file plus the constants.
