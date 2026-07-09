---
phase: 1
status: done
test_total: 14
test_passing: 14
---

# whoosort build summary

Lean-fidelity build of a stdin/file line sorter with dedupe. 14 tests passing in ~314ms.

## Files

- `lib/sort.js` (~80 LOC): pure splitLines/sortLines/joinLines/parseNumeric + COMPARATORS map
- `bin/whoosort.js` (~75 LOC): thin argv parser + I/O wrapper
- `test/sort.test.js` (14 tests): pure functions + CLI subprocess + real-world PAN-CHANGELOG fixture

## Patterns reused (memory hits)

- P-203 (lib + bin module-boundary, scope-cut as design discipline)
- P-204 (assert output SHAPE not VALUE — `/^a\r?\n.../` regex makes tests cross-platform)
- P-201 (real-world fixture — PAN CHANGELOG headers)

## New patterns surfaced (promote candidates)

- **P-401 (universal, io-pattern)** — *Synchronous stdin via `fs.readFileSync(0)` is the cleanest CLI pattern.* Avoids stream buffering bugs, plays well with `spawnSync({input: ...})` for tests, matches the synchronous shape of pan-tools. Async stdin only justified when actually streaming gigabytes.
- **P-402 (universal, output-conventions)** — *Always emit a trailing newline from CLI output.* Most Unix tools do this; downstream tooling expects it; tests can assert it. Document it in --help so byte-counters aren't surprised.
- **P-403 (universal, test-strategy)** — *Comparator-as-data > switch statement.* `COMPARATORS = { alpha, numeric, length }` is extensible and testable in isolation. Generalizes to validators, formatters, dispatchers — any "select strategy by string key" surface.

## What this experiment teaches PAN

Three of three findings are pure pattern discoveries — no new bugs in PAN itself. This is the *expected* signal from a well-prepared run that builds on prior promotes (P-201/P-203/P-204 covered most of the high-value ground; new findings are incremental).

The sub-text: **as the loop runs, per-experiment finding count drops** because earlier patterns absorb the easy wins. That's a healthy signal — saturation = the system is learning.
