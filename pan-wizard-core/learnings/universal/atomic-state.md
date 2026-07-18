---
topic: atomic-state
last_updated: 2026-07-18T08:42:29.856Z
patterns:
  - id: P-1201
    summary: Atomic state-file pattern: write to file.tmp, fsync, rename. Survives kill -9 mid-write. Use the existing file's content if read fails on the .tmp
    promoted_at: 2026-05-02T15:25:15.594Z
    source_experiments: [whoocache, whooflow]
  - id: P-FH-023
    summary: Stamp exported provenance from the producing run, not current mutable state
    promoted_at: 2026-07-18T08:42:29.856Z
    source_experiments: [field-harvest-2026-07]
---

# Atomic State (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1201 — Atomic state-file pattern: write to file.tmp, fsync, rename. Survives kill -9 mid-write. Use the existing file's content if read fails on the .tmp

**Evidence:** whoocache index-file.js, whooflow state.js — both implemented this independently for parallel-process safety. Survived kill -9 mid-write tests. The pattern is well-established in databases (write-ahead log, MANIFEST in LevelDB) and now appears twice in zero-dep Node.js cache/runner contexts.

**Rule:** When persisting state that must survive crashes or concurrent access (cache index, run-state, session metadata, scheduler state), always: 1) write JSON to <name>.tmp 2) call fsync (or fs.writeFileSync which buffers) 3) rename <name>.tmp -> <name>. Never write directly to <name>. On read, prefer <name>; if <name>.tmp exists alone, log a warning and treat the original as truth (or recover via the .tmp if you trust it more).

**Applies in:** any state file accessed by multiple processes or that must survive crashes

## P-FH-023 — Stamp exported provenance from the producing run, not current mutable state

**Evidence:** An export stamped the current control values rather than the values that generated the metrics, so changing a knob after a run silently mislabelled the exported provenance.

**Rule:** When exporting results or metrics, capture the provenance/parameters from the artifacts of the run that produced them, not by re-reading the current (possibly since-changed) UI/knob/config state at export time. Re-reading live mutable state mislabels the export with inputs that never produced it. Snapshot inputs into the run artifact, or invalidate stale results whenever any producing input changes.

**Applies in:** exporting results/metrics; provenance stamping from a producing run
