---
topic: streaming-io
last_updated: 2026-05-02T15:25:23.330Z
patterns:
  - id: P-1202
    summary: Streaming JSONL via readline + for-await: per-line parse, never load whole file. Handles 100MB / 1M-line files in seconds without OOM
    promoted_at: 2026-05-02T15:25:23.330Z
    source_experiments: [whoolog, whoodb]
---

# Streaming Io (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1202 — Streaming JSONL via readline + for-await: per-line parse, never load whole file. Handles 100MB / 1M-line files in seconds without OOM

**Evidence:** whoolog source.js + filter.js processed 1M-line synthetic fixture in <10s with stable memory. whoodb evaluator uses the same pattern for streaming WHERE/projection. Both verified against real PAN tokens.jsonl.

**Rule:** For line-oriented inputs (JSONL, NDJSON, log files), use Node's readline.createInterface({input: createReadStream(path)}) with for-await-of iteration. Each line parses independently — malformed lines emit a stderr warning and continue, unless --strict. NEVER use fs.readFileSync(path).split('\n') for files of unknown size. Pair with a streaming output (process.stdout.write(JSON.stringify(row) + '\n')) so the whole pipeline is bounded memory.

**Applies in:** JSONL processors, log filters, line-oriented data tools
