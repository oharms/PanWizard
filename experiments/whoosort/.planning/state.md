# Project State

**Status:** Done
**Last Activity:** 2026-04-27
**Description:** Built whoosort end-to-end. 14 tests passing. P-201 dogfood: real PAN CHANGELOG headers used as fixture.

## Decisions

- **Pure functions in lib/, thin CLI in bin/** — same shape as whooo (P-203: explicit module-boundary scope cut)
- **Synchronous stdin via `fs.readFileSync(0)`** — sync matches the rest of the CLI; pipe semantics work; node:test can drive via spawnSync `input:` option
- **Cross-platform line endings**: split on \r\n|\n|\r; emit OS-native (\r\n on win32, \n elsewhere)
- **NaN-numeric sorts to end** via `Number.POSITIVE_INFINITY` (deterministic)
- **Per P-204**: tests assert output SHAPE via regex (`/^a\r?\nb\r?\nc\r?\n$/`) — works on both win32 and unix without test forks

## Findings emerging from this build

1. **Stdin-via-fd-0 with spawnSync `input:` is cleaner than piping** — no shell quoting issues, works identically on Windows and Unix
2. **Comparator-as-data pattern** (`COMPARATORS = { alpha, numeric, length }`) — extensible, testable in isolation, no switch statement
3. **Always-trailing-newline output convention** — most Unix tools do this; tests can assert it deterministically
4. **`.replace(/\r\n/g, '\n').replace(/\r/g, '\n')` is the canonical cross-platform line-split prep** — single regex `\r\n?|\n` works too but is less obvious

## Blockers

_None_
