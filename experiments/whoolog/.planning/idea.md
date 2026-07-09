---
title: "whoolog — JSONL structured-log aggregator with filters and histograms"
created: "2026-05-02"
created_by: oharms
runtime_preference: claude
budget: 35
priority: medium
---

# Idea: whoolog — JSONL log aggregator

A zero-dependency Node.js CLI that reads one or more `.jsonl` log files (NDJSON), filters by time range / level / arbitrary field expressions, then either pretty-prints matching lines as a table or aggregates them into counts and time-bucketed histograms.

## Problem

Structured logs (one JSON object per line) are everywhere — `tokens.jsonl`, `trace.jsonl`, application logs, container logs — but inspecting them ad-hoc requires a chain of `jq | grep | sort | uniq -c` that is slow to compose and easy to get wrong. There is no zero-dep tool that does the common operations (filter, count by field, time-bucket histogram) in one shot.

PAN itself ships several JSONL logs (`tokens.jsonl`, optimization traces, bus channels). A purpose-built reader is dogfood-able and makes a structurally meaningful experiment that exercises:

- Multi-source input (file glob, stdin, multiple files merged)
- Streaming line parsing (don't read whole file into memory)
- Expression DSL (`level=error`, `phase>2`, `agent~^pan-`)
- Aggregation pipeline (group-by, count, histogram-by-time)
- Two output modes (table for humans, JSONL for callers)

## Success Criteria

- **SC-1:** `whoolog filter --files <glob> --where "level=error"` prints matching lines as JSONL to stdout. Multiple `--where` flags AND together.
- **SC-2:** `--since 2026-04-01 --until 2026-04-30` filters by an `ISO timestamp` field (configurable via `--ts-field ts`); rows missing the field are excluded with `--ts-required` or kept with `--keep-missing-ts`.
- **SC-3:** `whoolog count --by <field>` aggregates: prints `{value, count}` rows sorted descending by count. Supports nested keys via `usage.input_tokens`.
- **SC-4:** `whoolog histogram --by ts --bucket 1h` time-buckets rows; output is `{bucket_start, count}`. Buckets: `1m`, `5m`, `1h`, `1d`.
- **SC-5:** `--format table` and `--format json` work for every subcommand. Table is fixed-width, JSON is one row per line.
- **SC-6:** Streaming: a 100MB JSONL file is processed without OOM (read line-by-line, never buffer whole file). Verified with a generated fixture.
- **SC-7:** ≥10 tests pass: filter exact match, regex match (`~`), numeric comparison (`>`, `<`, `>=`, `<=`), AND of multiple wheres, count by nested key, histogram bucketing, stdin input, multi-file merge, malformed line handling (`--strict` vs skip), empty input.
- **SC-8:** Dogfood: running `whoolog count --files .planning/metrics/tokens.jsonl --by agent` against a real PAN tokens log produces a non-empty result (when one exists).

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| `filter`, `count`, `histogram` subcommands | `top` / `select` / `aggregate avg/sum` (defer if time) |
| Glob expansion + stdin | Watching mode |
| Where expressions: `=`, `!=`, `~` (regex), `>`, `<`, `>=`, `<=` | Boolean OR, parens — only AND across multiple `--where` flags |
| Nested field access (`a.b.c`) | Array indexing (`arr[0]`) |
| Streaming line-by-line | Random access / seekable indexing |
| Time buckets in 1m/5m/1h/1d | Calendar-aware (DST, month boundaries) |
| Malformed-line skip with warn | Auto-recovery / partial line repair |

## Constraints

- **Tech stack:** Node.js >= 16, zero runtime deps. Pure built-in modules (`fs`, `readline`, `path`, `node:test`, `node:assert/strict`, `node:child_process`).
- **Performance:** filter a 100MB / 1M-line JSONL in under 10 seconds on commodity hardware. Histogram of 1M lines in under 15 seconds.
- **Output stability:** error codes on stderr, normal output on stdout, machine-parseable JSON shape stable across releases.
- **Cross-platform:** path output uses forward slashes (PAN convention via `toPosix()`).
- **Behavior on parse errors:** malformed JSONL line emits a warning to stderr `whoolog: skipping malformed line at <file>:<lineno>` and continues, unless `--strict` is passed (then exit 1).

## Reference material

- PAN's `pan-wizard-core/bin/lib/cost.cjs` — reads `tokens.jsonl`, similar streaming pattern
- PAN's `pan-wizard-core/bin/lib/optimize.cjs` — reads `trace.jsonl`, parses lines, filters
- PAN's `commands/pan/cost.md` — example consumer of structured logs
- The existing `whooo` linter — structurally similar (file walking + per-line analysis + multi-format output)

## Notes

- **Decision principle:** ship something that works on real PAN logs first; defer fancy features.
- **Eat-our-own-dogfood marker:** done when `whoolog count --files .planning/metrics/tokens.jsonl --by agent` against a real run prints actual aggregates.
- **Promote-worthy findings expected:** streaming-line patterns (readline backpressure), nested-key resolver, time-bucket boundary handling (off-by-one on bucket edges), JSONL malformed-line policy as a lint rule.
- **Wave hint to PAN:** Plan 01 = filter + where DSL + tests; Plan 02 = count + histogram + nested-key resolver; Plan 03 = streaming + dogfood + table formatter. The CLI dispatch layer is shared and goes in Plan 01.
