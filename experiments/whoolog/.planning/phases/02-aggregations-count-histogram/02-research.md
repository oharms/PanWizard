# Phase 2: Aggregations (count + histogram) - Research

**Researched:** 2026-05-02
**Domain:** In-memory hashmap/Map aggregation + integer ms time-bucket calculation — pure Node.js built-ins
**Confidence:** HIGH (project-level research is canonical; this is a delta file)

> **This is a delta file.** Project-level research is canonical for the broad domain. See:
>
> - `.planning/research/architecture.md` — accumulate-then-emit pattern, time-bucket formula, dependency graph
> - `.planning/research/stack.md` — Node.js APIs, versions, zero-dep constraint
> - `.planning/research/pitfalls.md` — Pitfalls 10/11 (histogram boundary), 13/14/25 (nested-key + Map OOM)
> - `.planning/research/features.md` — feature landscape and MVP scope
>
> This file emits only Phase-2-specific specifics: which files each plan touches, exact API shapes, key normalization contract, sort-order spec, bucket formula validation, and test map.

---

## Summary

Phase 2 builds two subcommands (`count`, `histogram`) on top of Phase 1's fully-shipped streaming foundation. Both subcommands share the same accumulate-then-emit pattern: consume the source→decode pipeline to EOF, build a `Map` accumulator, sort, then emit JSONL rows. Neither can stream output during input — they must see all rows before sorting. Memory is O(distinct values) for `count` and O(distinct buckets) for `histogram`, both of which are bounded for well-formed log files.

The only new library module is `lib/time-bucket.js` (parses `1h`/`5m`/etc. to milliseconds and computes `Math.floor(ts_ms / bucket_ms) * bucket_ms`). Everything else — `sources`, `lines`, `decode`, `compileWhere`, `compileTimeFilter`, `compileKey`, `writeJsonl` — is Phase 1 shipped code, reused unchanged. The CLI entrypoint (`bin/whoolog.js`) needs two new `case` branches for `count` and `histogram`.

**Primary recommendation:** Two plans as roadmapped — Plan 02-01 (time-bucket + histogram) and Plan 02-02 (count + aggregation tests) — with Plan 02-01 first because `histogram` has the boundary-semantics complexity that benefits from being settled before tests are written.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CNT-01 | `count --by <field>` aggregates by single field; nested keys via resolver | `compileKey` already in `lib/resolve-key.js` (l.18-33); reuse exactly as in `filter.js` |
| CNT-02 | Output `{value, count}` JSONL, sorted by count desc; ties broken by value asc | Sort comparator: `(a,b) => b[1]-a[1] \|\| String(a[0]).localeCompare(b[0])` — see Implementation Strategy §2 |
| CNT-03 | Memory O(distinct values); documented in `--help` | Pitfall 25 in `.planning/research/pitfalls.md`; must be in `--help` text |
| HST-01 | `histogram --by <ts-field> --bucket <size>` time-buckets matching rows | New `lib/time-bucket.js`; `--by` defaults to `ts`; `--bucket` is required |
| HST-02 | Bucket sizes: `1m`, `5m`, `1h`, `1d` (fixed durations; no calendar-aware) | `parseBucket` maps unit chars `m/h/d` to ms multiples — `s` is NOT in requirements |
| HST-03 | Bucket-start formula: `Math.floor(ts_ms / bucket_ms) * bucket_ms`; boundary row in later bucket | Inclusive-lower convention confirmed correct; architecture.md p.288-295 shows the formula |
| HST-04 | Output `{bucket_start, count}` JSONL sorted by bucket_start ascending | Sort: `(a,b) => a[0]-b[0]` on numeric bucket_start ms; emit as ISO string |
| HST-05 | Zero-count buckets omitted; documented in `--help` | Pitfall 11 in pitfalls.md — only Map entries that exist are emitted |
| TST-04 | Histogram boundary test: row at exactly `bucket_start` belongs to that bucket | Dedicated fixture: one row at `2026-04-01T01:00:00.000Z` with `--bucket 1h`; assert bucket_start is `2026-04-01T01:00:00.000Z` |

</phase_requirements>

---

## Key Findings

### 1. Phase 1 Shipped Utilities — What Phase 2 Reuses Unchanged

All of the following are production-ready and must NOT be reimplemented:

| Utility | File | Key Export | Phase 2 Usage |
|---------|------|-----------|---------------|
| Nested-key resolver | `lib/resolve-key.js` l.18-33 | `compileKey(path)` | `count --by field` and `histogram --by ts-field` |
| Source iterator | `lib/source.js` | `sources({ files })` | Same pattern as `filter.js` |
| JSONL decoder | `lib/decode.js` | `decode(lines(source), opts)` | Same pattern as `filter.js` |
| Where predicates | `lib/where.js` | `compileWhere(expr)` | Both subcommands support `--where` |
| Time filter | `lib/time-filter.js` | `compileTimeFilter(opts)` | Both subcommands support `--since`/`--until` |
| JSONL writer | `lib/format.js` | `writeJsonl(obj)` | Emit each result row |
| Test helper | `test/runCLI.js` | `runCLI(args, opts)` | All integration tests |

The `filter.js` subcommand (`lib/filter.js`) is the reference pattern for how a subcommand wires these utilities. `count.js` and `histogram.js` follow the same `parseArgs → compile-once → accumulate loop → sort → emit` structure.

### 2. CLI Entrypoint Wiring

`bin/whoolog.js` currently handles only `filter` (l.60-63). Phase 2 adds two new `case` branches:

```js
// In the dispatch switch (bin/whoolog.js, after existing 'filter' case):
case 'count':
  require('../lib/count').run(process.argv.slice(3));
  break;
case 'histogram':
  require('../lib/histogram').run(process.argv.slice(3));
  break;
```

The top-level help text (printed at l.12-51 in `bin/whoolog.js`) also needs the two subcommands added and the placeholder text `(Phase 2)` / `(Phase 3)` updated.

### 3. `parseArgs` Options Config for Each Subcommand

Both subcommands share most options with `filter`. The `count`-specific option is `--by`. The `histogram`-specific options are `--by` and `--bucket`. Neither needs `--where` to be stripped — it is valid for both (users can pre-filter before counting).

**count options:**
```js
{
  files:             { type: 'string',  multiple: true },
  by:                { type: 'string' },        // required; CNT-01
  where:             { type: 'string',  multiple: true },
  since:             { type: 'string' },
  until:             { type: 'string' },
  'ts-field':        { type: 'string' },
  'keep-missing-ts': { type: 'boolean' },
  'ts-required':     { type: 'boolean' },
  strict:            { type: 'boolean' },
  format:            { type: 'string' },
  help:              { type: 'boolean', short: 'h' },
}
```

**histogram options** — same as count plus `--bucket`:
```js
{
  ...same as count...,
  bucket: { type: 'string' },   // required; HST-02; e.g. '1h'
}
```

`--by` is required for both. If absent: emit usage error to stderr, exit 2.

---

## Implementation Strategy

### 1. `lib/time-bucket.js` — New Module

**`parseBucket(spec)`** — parses a bucket-size string to milliseconds.

Allowed specs per HST-02: `1m`, `5m`, `1h`, `1d`. The `s` (seconds) suffix is NOT in requirements — do not add it.

```js
// Exact formula from architecture.md p.276-287
const UNITS = { m: 60_000, h: 3_600_000, d: 86_400_000 };

function parseBucket(spec) {
  const m = /^(\d+)([mhd])$/.exec(spec);
  if (!m) {
    const e = new Error(`--bucket ${JSON.stringify(spec)}: must be one of 1m, 5m, 1h, 1d`);
    e.usage = true;
    throw e;
  }
  return parseInt(m[1], 10) * UNITS[m[2]];
}
```

**`bucketStart(tsMs, bucketMs)`** — floor formula.

```js
// Implements [bucket_start, bucket_start + bucketMs) — inclusive lower, exclusive upper.
// Math.floor(tsMs / bucketMs) * bucketMs is the canonical formula.
// A row at exactly bucket_start (e.g., ts_ms === 3600000 with 1h) gives
// Math.floor(3600000 / 3600000) * 3600000 = 3600000 — the row IS in the 01:00 bucket.
// This satisfies TST-04 / HST-03 boundary semantics.
function bucketStart(tsMs, bucketMs) {
  return Math.floor(tsMs / bucketMs) * bucketMs;
}
```

**`bucketStartIso(tsMs, bucketMs)`** — convenience wrapper that returns ISO string for the `bucket_start` output field.

```js
function bucketStartIso(tsMs, bucketMs) {
  return new Date(bucketStart(tsMs, bucketMs)).toISOString();
}
```

**Exports:** `{ parseBucket, bucketStart, bucketStartIso }`

### 2. `lib/count.js` — count Subcommand

**Accumulator:** `Map<string, number>` keyed by the _serialized_ field value.

**Key normalization (CNT-01, CNT-02):** The `--by` field value from a row can be any JSON type (string, number, boolean, null, undefined for missing). The Map key must be a string. Use `String(val ?? '(missing)')` convention — missing/undefined → `'(missing)'`, null → `'null'` (via `String(null)`), number → its string form, boolean → `'true'`/`'false'`, string → as-is. This is unambiguous because users can distinguish field not present (`(missing)`) from the string `"null"` (which becomes `'"null"'` in JSON) — but for count output, the `value` field in `{value, count}` JSONL should be the _original_ resolved value, not the normalized string key (so `{value: 5, count: 3}` not `{value: "5", count: 3}`). Store `Map<string_key, {originalValue, count}>`.

**Sort order (CNT-02):** Sort by count descending, ties broken by value ascending. Tie-breaking on the serialized key (string-compare) is stable and deterministic across runs:

```js
const rows = [...counts.entries()]
  .sort(([ka, a], [kb, b]) => {
    const diff = b.count - a.count;           // desc by count
    if (diff !== 0) return diff;
    return ka < kb ? -1 : ka > kb ? 1 : 0;   // asc by key string for tie-break
  })
  .map(([, { originalValue, count }]) => ({ value: originalValue, count }));
```

**Missing `--by` field:** If `--by` is not provided, exit 2 with a usage error before opening any files.

**`--help` must document O(distinct values):** Per CNT-03, the help text must contain wording like: "Memory usage is O(distinct values). Avoid `--by` on high-cardinality fields (e.g., unique timestamps); use `histogram --by ts --bucket 1h` instead."

**run() structure:**
```
parseArgs → validate --by present →
compile predicates + timePred (same pattern as filter.js) →
for await sources → for await decode → if passes(obj) →
  val = getByField(obj); counts.set(key, ...) →
[after loop] sort → for each row writeJsonl({value, count})
```

### 3. `lib/histogram.js` — histogram Subcommand

**The `--by` field is the timestamp field** (default behavior is `--by ts`, same as `--ts-field`). The field value is resolved via `compileKey`. The resolved value is converted to ms via `new Date(raw).getTime()` for string ISO timestamps, or used directly if it's already a number (epoch ms).

**Row omission on unparseable timestamp:** If a row's `--by` field is missing or produces `NaN` from `new Date`, skip the row silently (do not crash). This mirrors `time-filter.js`'s missing-ts drop behavior.

**Accumulator:** `Map<number, number>` keyed by bucket_start epoch ms.

**Bucket boundary (HST-03, TST-04):** The formula `Math.floor(ts_ms / bucket_ms) * bucket_ms` is correct. When `ts_ms` equals `bucket_ms * N` exactly, `Math.floor` returns `N`, so the row lands in bucket `N*bucket_ms`. For `2026-04-01T01:00:00.000Z` with `1h`: `ts_ms = 1743469200000`, `bucket_ms = 3600000`, `Math.floor(1743469200000 / 3600000) = 484297`, `484297 * 3600000 = 1743469200000 = new Date('2026-04-01T01:00:00.000Z').getTime()`. The row appears in the `01:00` bucket — not `00:00`. This matches SC-4 / TST-04.

**Use integer arithmetic only:** Do not use floating-point division that could introduce rounding errors. `Math.floor(integer / integer)` in JavaScript is exact for numbers in the safe integer range (which epoch ms values are — they are on the order of 10^12, well within Number.MAX_SAFE_INTEGER of ~9×10^15).

**Sort (HST-04):** Sort Map entries ascending by bucket_start ms: `(a, b) => a[0] - b[0]`.

**Empty buckets omitted (HST-05):** Only emit Map entries that exist. Document in `--help`.

**Output row shape:** `{ bucket_start: <ISO string>, count: <number> }` — use `.toISOString()` on the epoch ms key.

**`--bucket` is required:** If absent, exit 2 with usage error.

**run() structure:**
```
parseArgs → validate --by + --bucket present → parseBucket →
compile predicates + timePred →
compile getByField = compileKey(values.by) →
for await sources → for await decode → if passes(obj) →
  raw = getByField(obj); tsMs = typeof raw === 'number' ? raw : new Date(raw).getTime()
  if (!isNaN(tsMs)) { key = bucketStart(tsMs, bucketMs); map.set(key, (map.get(key)??0)+1) } →
[after loop] sort by key asc → for each [k, n] writeJsonl({bucket_start: new Date(k).toISOString(), count: n})
```

---

## Test Strategy (TST-04 and Suite Plan)

### TST-04 — Histogram Boundary Test (must be explicit)

Fixture:
```js
// One row at exactly 2026-04-01T01:00:00.000Z (on bucket boundary with 1h)
// One row at 2026-04-01T00:30:00.000Z (in the 00:00 bucket)
// One row at 2026-04-01T01:30:00.000Z (in the 01:00 bucket)
const rows = [
  { ts: '2026-04-01T00:30:00.000Z', x: 1 },
  { ts: '2026-04-01T01:00:00.000Z', x: 2 },  // exactly on boundary — must be in 01:00
  { ts: '2026-04-01T01:30:00.000Z', x: 3 },
];
```
Expected output (2 buckets):
- `{ bucket_start: '2026-04-01T00:00:00.000Z', count: 1 }`
- `{ bucket_start: '2026-04-01T01:00:00.000Z', count: 2 }`

Assert that `bucket_start === '2026-04-01T01:00:00.000Z'` for count=2. This directly verifies TST-04.

### Recommended Test Files

**`test/time-bucket.test.js`** — unit tests for `lib/time-bucket.js`:
- `parseBucket('1h')` returns `3600000`
- `parseBucket('5m')` returns `300000`
- `parseBucket('1d')` returns `86400000`
- `parseBucket('1s')` throws usage error (not supported)
- `parseBucket('')` throws usage error
- `bucketStart(ts_ms, 3600000)` for exact boundary (TST-04 math)
- `bucketStart(ts_ms, 3600000)` for mid-bucket

**`test/histogram.test.js`** — integration tests via `runCLI`:
- TST-04 boundary test (mandatory)
- Basic 1h bucketing: 3 rows in different hours
- `1d` bucket: rows across two days
- Empty input: exit 0, empty stdout
- Missing `--bucket` flag: exit 2
- Missing `--by` field: exit 2
- Row with unparseable timestamp is silently skipped
- Zero-count buckets absent (verify only observed buckets emitted)
- Sort ascending by `bucket_start`

**`test/count.test.js`** — integration tests via `runCLI`:
- Basic count by top-level field: `level` with `error/info/error` → sorted by count desc
- Nested key: `--by usage.model` on rows with `{usage: {model: "gpt-4"}}`
- Tie-break: two fields with equal count sorted by value asc
- Missing field rows: rows without the `--by` field appear under `value: null` or `(missing)` — confirm consistent key
- Missing `--by` flag: exit 2
- Empty input: exit 0, empty stdout
- `--help` mentions O(distinct values) (test stdout contains the phrase)

All tests use `runCLI` from `test/runCLI.js` (existing helper). Fixtures are generated programmatically in `before` hooks (same pattern as `filter.test.js`).

---

## Pitfalls for Phase 2

### Pitfall 10 (Bucket Boundary Off-by-One) — CRITICAL
**What goes wrong:** Using `Math.ceil` or not verifying the formula against an exact-boundary row.
**Guard:** The `Math.floor(ts_ms / bucket_ms) * bucket_ms` formula is correct. Verify with the TST-04 explicit boundary fixture. See pitfalls.md §Pitfall 10.

### Pitfall 11 (Empty Bucket Documentation)
**What goes wrong:** `--help` text doesn't mention that zero-count buckets are absent.
**Guard:** Include in `histogram --help`: "Buckets with no matching rows are omitted." See pitfalls.md §Pitfall 11.

### Pitfall 25 (Giant Map — Unbounded Distinct Values)
**What goes wrong:** `count --by ts` on 1 M rows creates 1 M Map entries (~200 MB).
**Guard:** Document in `count --help` that memory is O(distinct values). Recommend `histogram` for time-series. See pitfalls.md §Pitfall 25.

### Floating-Point on Bucket Math — Integer Arithmetic Required
**What goes wrong:** `ts_ms / bucket_ms` might accumulate floating-point error if either is not an integer. In practice: `new Date(isoString).getTime()` always returns an integer millisecond value, and `bucket_ms` (computed from integer parse × integer constant) is also integer. `Math.floor` on an exact integer is a no-op. **There is no floating-point problem here for epoch ms values** — they are within safe integer range. Just document the assumption: the formula is exact.

### Numeric-vs-String `value` in count output
**What goes wrong:** The `{value, count}` output row's `value` field might serialize differently depending on whether the original JSON field was a number (`5`) or string (`"5"`). Users who pipe to downstream tools care about the type.
**Contract:** Emit the original JS value (as returned by `compileKey`), not the string-normalized key. Use the Map to track both `{originalValue, count}` as documented in Implementation Strategy §2. This preserves type fidelity in JSONL output.

### Missing vs Null vs Undefined `--by` Field Values in count
Three distinct cases:
1. **Key not present** (`getByField(obj)` returns `undefined`): normalize to string key `'(missing)'`; emit `{value: null, count: N}` or `{value: "(missing)", count: N}` — pick one and document it.
2. **Key present with explicit `null`** (JSON `null`): `getByField` returns `null`; normalize to string key `'null'`; emit `{value: null, count: N}`.
3. **Nested intermediate is null** (`{usage: null}` with `--by usage.model`): `compileKey` returns `undefined` (Pitfall 14 is guarded); treat same as case 1.

**Recommended approach:** Use `JSON.stringify(val)` as the Map key (already unique across types: number `5` → `"5"`, string `"5"` → `'"5"'`, null → `"null"`, undefined → `"undefined"`). Emit `originalValue` in the output as the original resolved value (or `null` for undefined/missing). This gives consistent, type-aware keying and clean output.

---

## Existing Code Conventions (Phase 1 Delta)

Phase 2 must match these locked patterns exactly:

1. **Module structure:** `'use strict';` at top, `module.exports = { ... }` at bottom, no default exports.
2. **Subcommand `run(argv)` function:** async, accepts raw `process.argv.slice(3)`, calls `process.exit()` for all exit paths. See `lib/filter.js` l.77-143 for the canonical shape.
3. **`parseArgs` call:** `strict: true` (throws on unknown flags), `allowPositionals: false`. Error goes to stderr + exit 2.
4. **Predicate compilation:** Always compiled once before the loop. Usage errors checked via `err.usage`, exit 2; other errors exit 1.
5. **Output:** `writeJsonl(obj)` from `lib/format.js` — never `console.log`. One row per call.
6. **Error messages:** `process.stderr.write('whoolog: ...\n')` — never `console.error`.
7. **Exit codes:** 0 success (including empty results), 1 runtime error, 2 usage error. Empty result with no rows emitted → exit 0.
8. **Test fixtures:** Generated programmatically in `before()` hook using `fs.mkdtempSync`. Cleaned in `after()`. Never committed. See `test/filter.test.js` for the pattern.
9. **Test assertions:** Shape-based (parsed JSONL + field assertions + regex match). No full-output snapshot strings. See pitfalls.md §Pitfall 22.
10. **`bin/whoolog.js` dispatch:** Both new subcommands are wired via `require('../lib/count').run(...)` / `require('../lib/histogram').run(...)`.

---

## Architecture: No New Module Dependencies

Phase 2 introduces only one new file as a dependency: `lib/time-bucket.js`. All other new files (`lib/count.js`, `lib/histogram.js`, `test/count.test.js`, `test/histogram.test.js`, `test/time-bucket.test.js`) either import Phase 1 utilities or are standalone. The dependency graph is:

```
time-bucket.js   (no deps — new)
histogram.js     ← source, decode, where, time-filter, resolve-key, time-bucket, format  (all Phase 1 + new)
count.js         ← source, decode, where, time-filter, resolve-key, format               (all Phase 1)
bin/whoolog.js   ← adds require('../lib/count') + require('../lib/histogram')
```

---

## Open Questions

1. **`value` key for missing `--by` field:** Should missing field emit `{value: null, count: N}` or `{value: "(missing)", count: N}`? Either is acceptable; `null` is cleaner JSON, `"(missing)"` is more explicit. **Recommendation:** use `null` (truest to JSON semantics; downstream tools can filter `value === null`). Document in `--help`.

2. **`--by` default for `histogram`:** Should `histogram` default `--by` to `ts` (matching `--ts-field` convention), or require it explicitly? SC-3 shows `histogram --by ts --bucket 1h` with an explicit `--by`, suggesting it is always explicit. **Recommendation:** require `--by` always (no default); exit 2 if absent. Keeps behavior predictable.

3. **`5m` bucket:** HST-02 lists `1m`, `5m`, `1h`, `1d`. The `parseBucket` regex `(\d+)([mhd])` naturally accepts `5m` without special-casing. No issue; just confirm the test suite covers `5m` specifically.

---

## Validation Architecture

**SKIPPED** — `workflow.nyquist_validation` is not set in `.planning/config.json`. Standard `<verify>` blocks with bash commands suffice.

---

## Sources

This is a delta file; primary sources are in project-level research:

- `.planning/research/architecture.md` — accumulate-then-emit pattern (p.169-188), time-bucket formula (p.276-295), dependency graph (p.399-434)
- `.planning/research/pitfalls.md` — Pitfalls 10 (bucket boundary), 11 (empty buckets), 13 (path re-parse), 14 (null intermediate), 25 (giant Map)
- `.planning/research/stack.md` — Node.js built-in APIs, zero-dep constraint, performance notes
- `.planning/phases/01-streaming-foundation-filter/01-research.md` — Phase 1 code idioms (module shapes for source, decode, resolve-key, where, time-filter, format, filter)
- Verified against shipped source: `lib/resolve-key.js` (l.18-33), `lib/filter.js` (l.77-143), `lib/format.js` (l.11-13), `test/runCLI.js` (l.1-21), `bin/whoolog.js` (l.1-67)

## Infrastructure Dependencies

None — unit tests only, no external infrastructure needed. All integration tests use `spawnSync` against generated programmatic fixtures.

---

## Metadata

**Confidence breakdown:**
- Accumulate-then-emit pattern: HIGH — explicitly documented in architecture.md and matches Phase 1 pattern
- Time-bucket formula: HIGH — `Math.floor(ts_ms / bucket_ms) * bucket_ms` verified for integer correctness; boundary case traced manually
- Key normalization contract: HIGH — `JSON.stringify` as Map key is the natural JS idiom; original value preserved for output
- Sort orders: HIGH — comparators derived directly from requirement text (CNT-02: count desc, value asc; HST-04: bucket_start asc)
- Pitfall guards: HIGH — sourced from pitfalls.md with phase-level traceability

**Research date:** 2026-05-02
**Valid until:** 2026-07-02 (stable Node.js built-ins; low churn risk)
