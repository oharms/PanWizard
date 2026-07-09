---
topic: pipe-friendly-cli
last_updated: 2026-05-02T17:52:45.798Z
patterns:
  - id: P-1207
    summary: Pipe-friendly CLI: handle EPIPE as exit-0, read stdin only when not a TTY, write one record per line with trailing newline
    promoted_at: 2026-05-02T17:52:45.798Z
    source_experiments: [whoolog, whoodb]
---

# Pipe Friendly Cli (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1207 — Pipe-friendly CLI: handle EPIPE as exit-0, read stdin only when not a TTY, write one record per line with trailing newline

**Evidence:** whoolog bin/whoolog.js: 67 lines including shebang, EPIPE-as-exit-0 handler, top-level help, subcommand dispatch. lib/source.js: Stdin only when not a TTY. Stream errors converted to clean exit 1 with stderr message. Verified by integration tests piping through head and confirming exit 0.

**Rule:** CLIs that compose with shell pipes need three behaviors: 1) EPIPE on stdout means downstream closed early (e.g. head -3 took 3 lines and exited) — listen for process.stdout error event, exit 0 not 1. 2) Read stdin ONLY when process.stdin.isTTY is false; if a TTY, stdin blocks waiting for typing. Use an explicit --files flag for files, fall back to stdin only when piped in. 3) Always write trailing newline (process.stdout.write(line + LF), not just line) so the next pipe stage sees a complete record.

**Applies in:** any zero-dep Node.js CLI intended for shell composition
