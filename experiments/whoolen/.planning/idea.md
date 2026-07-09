---
title: "whoolen — markdown corpus stats aggregator"
created: "2026-04-27T13:20:00Z"
budget: 25
---

# whoolen

Walks a directory of `.md` files, computes word/line/char counts, optionally distinguishes prose vs code-block content. Emits per-file or aggregate stats.

## Success Criteria

- SC-1: `whoolen <dir>` writes per-file stats: `path<TAB>words<TAB>lines<TAB>chars`
- SC-2: `--total-only` writes only an aggregate row
- SC-3: `--no-code` excludes triple-backtick fenced blocks from word/char counts (still counts them in lines)
- SC-4: `--format json` emits `{file_count, total_words, total_lines, total_chars, files: [...]}`
- SC-5: `--exclude <glob>` skips matched files (reuses globToRegex shape from doc-lint vendor — no copy-paste; just same convention)
- SC-6: ≥7 tests pass
- SC-7: P-201 dogfood: count words across PAN's `commands/pan/*.md` (real corpus)

## Out of Scope

- HTML/embedded-frontmatter exclusion (frontmatter IS counted as content for v0.1)
- Markdown-aware tokenization (e.g. counting "**bold**" as one word) — split on whitespace only
- Per-section breakdown

## Constraints

- Zero deps; node:test
- Apply P-401 (sync I/O), P-402 (trailing newline), P-403 (no switch — comparator/formatter as data map)
- Apply P-201 (real fixture), P-204 (assert SHAPE)
