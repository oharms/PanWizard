---
title: "whoosort — stdin/file line sorter with dedupe"
created: "2026-04-27T13:00:00Z"
runtime_preference: claude
budget: 25
---

# whoosort

Zero-dep CLI that reads lines from stdin OR `--input <file>`, sorts (alphabetic / numeric / by length), optionally dedupes, and writes to stdout OR `--output <file>`. Cross-platform line-ending aware.

## Success Criteria

- SC-1: `cat lines | whoosort` writes sorted unique lines to stdout (default: alphabetic)
- SC-2: `--numeric` sorts as numbers (handles negatives, decimals)
- SC-3: `--length` sorts by line length
- SC-4: `--reverse` reverses the sort
- SC-5: `--unique` dedupes (post-sort)
- SC-6: `--input <f> --output <f>` reads + writes files instead of stdio
- SC-7: ≥7 tests pass
- SC-8: Cross-platform: handles both `\n` and `\r\n` line endings on input; emits OS-native on output

## Out of Scope

- Multi-file input
- In-place editing (`-i` flag)
- Unicode collation tables (uses default lexicographic)
- Stable sort guarantees beyond what JS Array.sort provides

## Constraints

- Zero deps; node:test only
- Pure functions in lib/ + thin CLI in bin/
- Per P-201: include at least one fixture sampled from real-world data (use one of PAN's CHANGELOG sections as input)
- Per P-204: assert violation/output SHAPE in tests, not exact prose
