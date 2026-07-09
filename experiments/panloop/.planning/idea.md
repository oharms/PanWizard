---
title: "whootoc — generate a Table of Contents from a markdown file"
created: "2026-04-27"
created_by: oharms
runtime_preference: claude
budget: 30
priority: medium
---

# whootoc — markdown Table of Contents generator

A small zero-dependency Node.js CLI that reads a markdown file from `--input` (or stdin), extracts all `## ` and `### ` headings (skipping `#` for the title), and emits a nested bulleted TOC with anchor links.

## Problem

Markdown files in PAN Wizard's `docs/` directory are long (USER-GUIDE.md is 1000+ lines). A TOC generator that round-trips cleanly with the existing `## Table of Contents` sections would let us regenerate them programmatically when sections are added/removed.

## Success Criteria

- **SC-1**: `whootoc --input <file>` writes a TOC to stdout in this shape:
  ```
  - [Heading 2 Name](#heading-2-name)
    - [Heading 3 Name](#heading-3-name)
  ```
- **SC-2**: Slug rules: lowercase, replace spaces with hyphens, strip non-alphanumeric except hyphens. Match GitHub markdown anchor convention.
- **SC-3**: `--from-stdin` flag reads stdin instead of a file (composes with `cat` for piping).
- **SC-4**: `--max-depth N` caps heading depth (default 3, so `##` and `###` only).
- **SC-5**: Code-block content (lines inside triple-backtick fences) is NOT scanned for headings — they're literal content, not document structure.
- **SC-6**: ≥6 tests pass. At least one test runs the generator against PAN's actual `docs/USER-GUIDE.md` and asserts the output has 10+ entries.

## Scope

| In Scope | Out of Scope |
|----------|--------------|
| `##` and `###` headings (depth 2-3) | `#` (title), `####+` (deep) — out by SC-4 default |
| Code-fence skipping | Inline-code skipping (single-backtick) |
| GitHub-style slug | GitLab/other slug rules |
| Stdin + file input | Multi-file aggregation |

## Constraints

- Zero runtime deps (built-in `fs`, `node:test`)
- Use `process.stdout.write` not `console.log` (PAN convention)
- Apply prior universal patterns: P-401 (sync stdin), P-402 (trailing newline), P-403 (data-driven dispatcher if you need one), P-204 (assert SHAPE in tests, not exact prose)
- Test fixture: a small synthetic markdown file with various heading depths + a code fence containing a `## fake heading` to verify code-fence skipping
