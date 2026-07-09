---
title: "whoograph — ASCII bar chart from key:value pairs"
created: "2026-04-27T13:35:00Z"
budget: 25
---

# whoograph

Reads `key:value` pairs from stdin (one per line) and renders an ASCII horizontal bar chart. Auto-detects terminal width; supports manual override.

## Success Criteria

- SC-1: `printf "alpha:5\nbeta:10\ngamma:3\n" | whoograph` produces a readable horizontal bar chart with bars proportional to values.
- SC-2: `--width N` overrides terminal width (default: COLUMNS env var or 80).
- SC-3: `--sort by-value` sorts bars by value descending; `--sort by-key` alphabetic by key.
- SC-4: Negative values supported (bar grows leftward from zero, OR shown with sign indicator).
- SC-5: Edge cases: empty input → "(no data)" + exit 0; all-zero values → bars of length 0; extreme range (1, 1000000) handled without overflow.
- SC-6: ≥7 tests pass.
- SC-7: P-201 dogfood: chart of word counts per PAN command file (uses whoolen output as source).

## Out of Scope

- Vertical (column) charts
- Multi-series / grouped bars
- Color (terminal escape codes) — keep monochrome ASCII for v0.1
- Floating-point alignment beyond 1 decimal

## Constraints

- Zero deps; node:test
- Apply: P-401 (sync stdin), P-402 (trailing newline), P-403 (sorter-as-data), P-204 (assert SHAPE), P-501 (no `**/` in JSDoc!)
