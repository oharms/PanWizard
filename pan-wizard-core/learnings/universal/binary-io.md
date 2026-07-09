---
topic: binary-io
last_updated: 2026-04-27T10:55:28.062Z
patterns:
  - id: P-1101
    summary: fs.readFileSync(path) without encoding returns Buffer (binary-safe); passing 'utf-8' would corrupt non-text files
    promoted_at: 2026-04-27T10:55:28.062Z
    source_experiments: [whoohash]
---

# Binary Io (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1101 — fs.readFileSync(path) without encoding returns Buffer (binary-safe); passing 'utf-8' would corrupt non-text files

**Evidence:** whoohash 15:10Z decision: hashing requires byte-level fidelity. fs.readFileSync(path) returns Buffer; fs.readFileSync(path, 'utf-8') returns String with replacement chars for invalid sequences.

**Rule:** When code must preserve byte content (hashing, copying, network IO, format conversion), use fs.readFileSync(path) WITHOUT the encoding argument to get a Buffer. Only pass an encoding (utf-8 etc) when you actually want the string. Confusion comes from String.length-equivalent reasoning — Buffers are bytes, Strings are code points.

**Applies in:** exec-phase (any code that reads files for hashing, copying, integrity checks, format conversion)
