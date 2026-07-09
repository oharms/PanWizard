# Phase 2: Core Pipeline - Research

**Researched:** 2026-04-27
**Domain:** Markdown parsing, slug generation, CLI I/O, Node.js native test runner
**Confidence:** HIGH

## Summary

Phase 2 implements a fence-aware markdown heading extractor, GitHub-style slug generator, nested TOC renderer, and CLI argument wiring for the `whootoc` tool. All components are pure-function, zero-dependency Node.js (ESM, v22+). The test suite uses `node:test` with `describe`/`it` blocks.

The domain is well-understood: markdown heading extraction is regex-based line scanning with a fence-toggle state machine. GitHub slug generation is a ~10-line algorithm (lowercase, spaces to hyphens, strip non-alphanumeric, track duplicates). The CLI is a thin I/O shell reading from file or stdin and writing to stdout. No external libraries are needed — all logic is string-in/string-out.

**Primary recommendation:** Implement as pure library functions in `src/lib/` (extract, slugify, render), then wire through `cli.js`. All I/O stays in `cli.js`; lib functions never touch `fs` or `process`.

<user_constraints>
## User Constraints (from context.md)

### Locked Decisions
- Fence-aware state machine: toggle boolean on triple-backtick lines
- Variable-length fences (4+ backticks): only close when closing fence has >= same number of backticks as opening
- Extract heading level and raw text from lines matching `^#{2,} ` (outside fences)
- Strip inline formatting from heading text before slugifying: bold, italic, code backticks, links (keep text)
- Respect `--max-depth N` flag (default 3, meaning `##` and `###` only)
- GitHub-style slugs: lowercase, spaces to hyphens, strip non-alphanumeric except hyphens
- Duplicate heading handling: track seen slugs, append `-1`, `-2` etc.
- Isolated slug module (`src/lib/slugify.js`) for independent unit testing
- Nested bulleted list output: `- [Heading Text](#slug)`
- `###` entries indented with 2 spaces under parent `##`
- Trailing newline (P-402)
- Written via `process.stdout.write` (not `console.log`)
- `--input <file>` reads file from disk
- `--from-stdin` reads from stdin
- `--max-depth N` caps heading depth (default 3)
- `--input` and `--from-stdin` are mutually exclusive
- Missing file -> exit code 1 with error message to stderr
- No arguments -> print usage hint and exit 1
- Use `node:test` with `describe`/`it` blocks
- Test fixture: synthetic markdown with code fence containing `## fake heading`
- Assert SHAPE not exact prose (P-204)
- Integration test: run against PAN's actual `docs/USER-GUIDE.md`, assert 10+ entries
- Minimum 6 tests covering: basic extraction, code fence skipping, variable-length fences, duplicate slugs, max-depth filtering, real-file integration
- All library functions: pure string-in / string-out
- All I/O in `cli.js` only — lib functions never touch `fs` or `process`

### Claude's Discretion
- Exact module split between `src/lib/` files (e.g., separate `extract.js`, `render.js`, or combined)
- Whether to use `node:fs` sync or async for file reading
- Exact error message wording
- Test fixture exact content beyond the specified requirements

### Deferred Ideas (OUT OF SCOPE)
- `--check` mode (exit 1 if TOC stale) — v2 ENHC-01
- Update-in-place mode — v2 ENHC-02
- YAML front matter detection — v2 ENHC-04
- Tilde fence support — v2 ENHC-05
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CLI-01 | `whootoc --input <file>` generates TOC from markdown file | CLI arg parsing pattern, `node:fs` readFileSync |
| CLI-02 | `whootoc --from-stdin` reads markdown from stdin | `process.stdin` readable stream collection |
| CLI-03 | `whootoc --max-depth N` caps heading depth (default 3) | Passed to extractor as filter parameter |
| CLI-04 | TOC output written to stdout via `process.stdout.write` | Direct write, no console.log |
| CLI-05 | Exit code 0 on success, non-zero on error | `process.exit()` with error to stderr |
| PARS-01 | Extracts `##` headings as top-level TOC entries | Regex `^(#{2,})\s+(.*)$` with fence guard |
| PARS-02 | Extracts `###` headings as nested TOC entries | Same regex, level 3 nesting |
| PARS-03 | Skips headings inside triple-backtick code fences | Fence state machine toggle |
| PARS-04 | Handles variable-length fences (4+ backticks) | Track fence length, compare on close |
| PARS-05 | Respects `--max-depth` flag | Filter by heading level in extractor |
| SLUG-01 | GitHub-style anchor slugs | Lowercase, spaces->hyphens, strip special chars |
| SLUG-02 | Duplicate heading handling with `-1`, `-2` suffixes | Seen-slugs Map counter |
| SLUG-03 | Strips inline formatting before slugifying | Regex pipeline: bold, italic, code, links |
| OUTP-01 | Nested bulleted list with anchor links | `- [Text](#slug)` format |
| OUTP-02 | `###` entries indented 2 spaces under parent `##` | Indent based on level delta from base |
| OUTP-03 | Output ends with trailing newline | Append `\n` to output string |
| TEST-01 | 6+ tests pass covering core functionality | `node:test` describe/it blocks |
| TEST-02 | Test fixture includes code fence with `## fake heading` | Synthetic fixture string |
| TEST-03 | Integration test against PAN's `docs/USER-GUIDE.md` asserts 10+ entries | Real file read in test |
| TEST-04 | Tests use `node:test` runner with zero dependencies | Built-in `node --test` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node:fs | v22+ built-in | File reading | Zero-dep, synchronous `readFileSync` sufficient for CLI |
| node:test | v22+ built-in | Test runner | Zero-dep, `describe`/`it` blocks, built-in assertions |
| node:assert | v22+ built-in | Test assertions | `strictEqual`, `ok`, `match` for shape testing |
| node:path | v22+ built-in | Path resolution | `resolve` for file paths |

### Supporting
No external libraries needed. All functionality implementable with built-in Node.js modules.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom slug function | `github-slugger` npm | Adds a runtime dependency, violates zero-dep constraint |
| `node:test` | `vitest`/`jest` | Adds devDependency, zero-dep constraint applies to dev too for simplicity |
| Manual arg parsing | `commander`/`yargs` | Only 3 flags — manual parsing is simpler and zero-dep |

**Installation:** No installation needed — all built-in.

## Architecture Patterns

### Recommended Project Structure
```
src/
├── cli.js           # I/O shell: arg parsing, file/stdin reading, stdout writing
├── lib/
│   ├── extract.js   # Fence-aware heading extractor (pure function)
│   ├── slugify.js   # GitHub-style slug generator (pure function)
│   └── render.js    # TOC renderer: headings -> markdown list (pure function)
test/
├── whootoc.test.js  # All tests in one file using describe/it blocks
└── fixtures/
    └── sample.md    # Synthetic test fixture (optional — can inline in test)
```

### Pattern 1: Pure Function Pipeline
**What:** Each transformation step is a pure function: `string -> structured data -> string`
**When to use:** Always — the core pipeline is `extract(md, maxDepth) -> headings[] -> render(headings) -> tocString`

```javascript
// Pipeline: markdown string -> heading objects -> TOC string
const headings = extract(markdownContent, maxDepth);
const toc = render(headings);
process.stdout.write(toc);
```

### Pattern 2: Fence State Machine
**What:** Track whether current line is inside a code fence using a boolean + fence length
**When to use:** During heading extraction

```javascript
let inFence = false;
let fenceLength = 0;

for (const line of lines) {
  const fenceMatch = line.match(/^(`{3,})/);
  if (fenceMatch) {
    if (!inFence) {
      inFence = true;
      fenceLength = fenceMatch[1].length;
    } else if (fenceMatch[1].length >= fenceLength) {
      inFence = false;
      fenceLength = 0;
    }
    continue;
  }
  if (inFence) continue;
  // ... extract headings here
}
```

### Pattern 3: Slug Deduplication
**What:** Track seen slugs in a Map, append counter suffix for duplicates
**When to use:** During slug generation across a document

```javascript
function createSlugger() {
  const seen = new Map();
  return function slugify(text) {
    const base = text.toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
```

### Anti-Patterns to Avoid
- **AST-based parsing:** No need for `remark`/`unified` — line-by-line regex is simpler and correct for heading extraction
- **Streaming output:** The entire TOC fits in memory — no need for streaming; build full string then write once
- **Global mutable state:** Slugger must use closure-based state, not module-level globals (breaks test isolation)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| N/A — all components are simple enough | — | — | Zero-dep constraint means everything is hand-rolled by design. The algorithms are 10-20 lines each. |

**Key insight:** This project intentionally hand-rolls everything. The slug algorithm, fence parser, and renderer are each under 30 lines. External libraries would add complexity, not reduce it.

## Common Pitfalls

### Pitfall 1: Fence Close Matching
**What goes wrong:** Closing a 4-backtick fence with 3 backticks
**Why it happens:** Naive toggle on any backtick line ignores fence length
**How to avoid:** Store opening fence length, only close when closing fence >= that length
**Warning signs:** Test with `````code````` (4-backtick) fence passes when it shouldn't

### Pitfall 2: Inline Formatting in Slugs
**What goes wrong:** Slugs contain `*`, `_`, or backtick characters from `**bold**` headings
**Why it happens:** Forgetting to strip inline formatting before slugifying
**How to avoid:** Strip formatting pipeline: links first (preserve text), then bold/italic markers, then code backticks, then slugify
**Warning signs:** Heading `## **Important** Note` produces slug `important-note` not `important--note`

### Pitfall 3: Heading Regex Matching `#` Title
**What goes wrong:** `# Title` (level 1) appears in TOC when only `##`+ should
**Why it happens:** Regex `^#+` matches one or more instead of two or more
**How to avoid:** Use `^#{2,}\s+` to require at least 2 hash marks
**Warning signs:** Title heading appearing as TOC entry

### Pitfall 4: stdin Hanging
**What goes wrong:** CLI hangs waiting for stdin when neither `--input` nor `--from-stdin` given
**Why it happens:** Accidentally reading stdin without explicit opt-in
**How to avoid:** Only read stdin when `--from-stdin` flag is explicitly present; otherwise show usage
**Warning signs:** `whootoc` with no args hangs instead of printing help

### Pitfall 5: Duplicate Slug Counter Off-by-One
**What goes wrong:** First duplicate gets `-0` instead of no suffix, or second gets `-1` instead of `-2`
**Why it happens:** Counter initialization confusion
**How to avoid:** GitHub behavior: first occurrence has no suffix, second gets `-1`, third gets `-2`
**Warning signs:** Test `## Foo` twice produces `#foo` and `#foo-1` (correct) vs `#foo-0` and `#foo-1` (wrong)

## Code Examples

### Heading Extraction (complete)
```javascript
// src/lib/extract.js
export function extract(markdown, maxDepth = 3) {
  const lines = markdown.split('\n');
  const headings = [];
  let inFence = false;
  let fenceLen = 0;

  for (const line of lines) {
    const fence = line.match(/^(`{3,})/);
    if (fence) {
      if (!inFence) { inFence = true; fenceLen = fence[1].length; }
      else if (fence[1].length >= fenceLen) { inFence = false; fenceLen = 0; }
      continue;
    }
    if (inFence) continue;

    const heading = line.match(/^(#{2,})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      if (level <= maxDepth) {
        headings.push({ level, text: stripFormatting(heading[2].trim()) });
      }
    }
  }
  return headings;
}

function stripFormatting(text) {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> text
    .replace(/\*\*(.+?)\*\*/g, '$1')           // **bold**
    .replace(/__(.+?)__/g, '$1')               // __bold__
    .replace(/\*(.+?)\*/g, '$1')               // *italic*
    .replace(/_(.+?)_/g, '$1')                 // _italic_
    .replace(/`(.+?)`/g, '$1');                // `code`
}
```

### Slug Generation (complete)
```javascript
// src/lib/slugify.js
export function createSlugger() {
  const seen = new Map();
  return function slugify(text) {
    const base = text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    const count = seen.get(base) || 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
}
```

### TOC Rendering (complete)
```javascript
// src/lib/render.js
export function render(headings, slugify) {
  const lines = [];
  const baseLevel = 2; // ## is base level (no indent)
  for (const { level, text } of headings) {
    const slug = slugify(text);
    const indent = '  '.repeat(level - baseLevel);
    lines.push(`${indent}- [${text}](#${slug})`);
  }
  return lines.join('\n') + '\n';
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node:test` experimental | `node:test` stable | Node.js 20+ | Stable describe/it, no flags needed |
| `fs.readFile` callback | `fs.readFileSync` or `fs/promises` | Node.js 10+ | Sync is fine for CLI single-file reads |

**Deprecated/outdated:**
- None relevant — all APIs used are stable in Node.js 22+

## Open Questions

1. **PAN docs/USER-GUIDE.md location**
   - What we know: Integration test must run against this file
   - What's unclear: Exact path relative to whootoc project root
   - Recommendation: Use a relative path like `../../docs/USER-GUIDE.md` or search for it at test time. If not found, skip gracefully or use a known PAN docs path.

## Sources

### Primary (HIGH confidence)
- Node.js v22 documentation — `node:test`, `node:fs`, `node:assert` APIs
- GitHub slug algorithm — well-documented behavior, matches `github-slugger` npm package

### Secondary (MEDIUM confidence)
- Context.md decisions — locked by user, fully constraining implementation

## Infrastructure Dependencies

None — unit tests only, no external infrastructure needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - All Node.js built-ins, well-documented
- Architecture: HIGH - Pure function pipeline is standard for CLI tools
- Pitfalls: HIGH - Known gotchas from markdown parsing domain

**Research date:** 2026-04-27
**Valid until:** 2026-05-27 (stable domain, no moving parts)
