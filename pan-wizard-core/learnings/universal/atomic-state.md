---
topic: atomic-state
last_updated: 2026-05-02T15:25:15.594Z
patterns:
  - id: P-1201
    summary: Atomic state-file pattern: write to file.tmp, fsync, rename. Survives kill -9 mid-write. Use the existing file's content if read fails on the .tmp
    promoted_at: 2026-05-02T15:25:15.594Z
    source_experiments: [whoocache, whooflow]
---

# Atomic State (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1201 — Atomic state-file pattern: write to file.tmp, fsync, rename. Survives kill -9 mid-write. Use the existing file's content if read fails on the .tmp

**Evidence:** whoocache index-file.js, whooflow state.js — both implemented this independently for parallel-process safety. Survived kill -9 mid-write tests. The pattern is well-established in databases (write-ahead log, MANIFEST in LevelDB) and now appears twice in zero-dep Node.js cache/runner contexts.

**Rule:** When persisting state that must survive crashes or concurrent access (cache index, run-state, session metadata, scheduler state), always: 1) write JSON to <name>.tmp 2) call fsync (or fs.writeFileSync which buffers) 3) rename <name>.tmp -> <name>. Never write directly to <name>. On read, prefer <name>; if <name>.tmp exists alone, log a warning and treat the original as truth (or recover via the .tmp if you trust it more).

**Applies in:** any state file accessed by multiple processes or that must survive crashes
