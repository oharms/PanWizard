# Phase 2: Core Pipeline - Context

**Gathered:** 2026-04-27
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement the complete fence-aware markdown heading parser, GitHub-style slug generator, nested TOC renderer, CLI argument wiring (`--input`, `--from-stdin`, `--max-depth`), and a comprehensive `node:test` suite with 6+ tests including a real-file integration test against PAN's `docs/USER-GUIDE.md`.

</domain>

<decisions>
## Implementation Decisions

### Parser behavior
- Fence-aware state machine: toggle boolean on triple-backtick lines
- Variable-length fences (4+ backticks): only close when closing fence has >= same number of backticks as opening
- Extract heading level and raw text from lines matching `^#{2,} ` (outside fences)
- Strip inline formatting from heading text before slugifying: bold (`**`/`__`), italic (`*`/`_`), code backticks, links (`[text](url)` → keep text)
- Respect `--max-depth N` flag (default 3, meaning `##` and `###` only)

### Slug generation
- GitHub-style: lowercase, spaces to hyphens, strip non-alphanumeric except hyphens
- Duplicate heading handling: track seen slugs, append `-1`, `-2` etc. for duplicates (matching `github-slugger` behavior)
- Isolated in own module (`src/lib/slugify.js`) for independent unit testing

### Output format
- Nested bulleted list: `- [Heading Text](#slug)`
- `###` entries indented with 2 spaces under parent `##`
- Trailing newline (P-402)
- Written via `process.stdout.write` (not `console.log`)

### CLI wiring
- `--input <file>` reads file from disk
- `--from-stdin` reads from stdin (composes with `cat` for piping)
- `--max-depth N` caps heading depth (default 3)
- `--input` and `--from-stdin` are mutually exclusive — error if both provided
- Missing file → exit code 1 with error message to stderr
- No arguments → print usage hint and exit 1

### Test strategy
- Use `node:test` with `describe`/`it` blocks
- Test fixture: synthetic markdown file with various heading depths + code fence containing `## fake heading`
- Assert SHAPE not exact prose (P-204): check entry count, nesting structure, slug format
- Integration test: run against PAN's actual `docs/USER-GUIDE.md`, assert 10+ entries
- Minimum 6 tests covering: basic extraction, code fence skipping, variable-length fences, duplicate slugs, max-depth filtering, real-file integration

### Claude's Discretion
- Exact module split between `src/lib/` files (e.g., separate `extract.js`, `render.js`, or combined)
- Whether to use `node:fs` sync or async for file reading
- Exact error message wording
- Test fixture exact content beyond the specified requirements

</decisions>

<specifics>
## Specific Ideas

- Research recommended the slug algorithm is ~10 lines and can be implemented without `github-slugger` dependency
- The fence state machine is a single boolean toggle — no AST parser needed
- All library functions should be pure string-in / string-out for unit testability without mocks
- All I/O must live in `cli.js` only — lib functions never touch `fs` or `process`

</specifics>

<deferred>
## Deferred Ideas

- `--check` mode (exit 1 if TOC stale) — v2 requirement ENHC-01
- Update-in-place mode — v2 requirement ENHC-02
- YAML front matter detection — v2 requirement ENHC-04
- Tilde fence support — v2 requirement ENHC-05

</deferred>

---

*Phase: 02-core-pipeline*
*Context gathered: 2026-04-27*
