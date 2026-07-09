---
spec: doc-code-link-graph
adr: ADR-0027
status: accepted
created: 2026-05-03
---

# Spec: Doc–Code Link Graph

This spec is the W0 gate for [ADR-0027](../decisions/ADR-0027-doc-code-link-graph.md). It defines the on-disk grammars, the scanner contracts, the lint passes, the output schema, and the failure modes that the W1–W3 implementation must satisfy. Where this spec and the ADR diverge, the spec is authoritative for behavior; the ADR is authoritative for rationale.

## 1. Surfaces

The link graph spans **two surfaces**:

| Surface | Files | What it carries |
|---|---|---|
| Docs | `docs/`, `pan-wizard-core/{workflows,templates,references,learnings}/`, `commands/`, `agents/`, `CLAUDE.md`, `README.md` | Inline `[[<id>]]` body refs, `must_haves.key_links` frontmatter, `require-code-mention: true` frontmatter |
| Code | `pan-wizard-core/`, `bin/`, `hooks/`, `scripts/` | `@pan: <id>` source-comment anchors |

Source roots are configurable via `--source-root` and `--doc-root` flags (repeatable); defaults match the table above.

## 2. Doc-side grammars

### 2.1 Inline link `[[<id>]]`

Body-text reference. Forms:

```
[[ADR-0021]]                      → resolves to docs/decisions/ADR-0021-*.md
[[docs/specs/example.md]]         → resolves to that exact path
[[learnings/universal/test-iso]]  → resolves to pan-wizard-core/learnings/universal/test-iso.md
[[ADR-0021#Decision]]             → file + section anchor
```

Recognition regex: `\[\[([^\[\]\s|][^\[\]]*?)\]\]` (anchored to non-bracket, non-leading-pipe to keep markdown table cells safe).

### 2.2 Frontmatter `must_haves.key_links`

Existing mechanism, unchanged. Continues to be verified by [verify.cjs:cmdVerifyKeyLinks](../../pan-wizard-core/bin/lib/verify.cjs). The link-graph forward pass treats each `key_links` entry as one forward link with a regex-backed assertion; integration is read-only — `links validate` never rewrites `key_links` blocks.

### 2.3 Frontmatter `require-code-mention: true`

Optional. When set, the doc declares that at least one source-anchor (`@pan:`) under the configured source roots must resolve to it. Default is `false`/absent (advisory). Authors opt docs in; the tool does not.

## 3. Code-side grammar: `@pan: <id>`

A source comment of the form:

```
<comment-leader>[whitespace]@pan:[whitespace]<id>
```

`<comment-leader>` is one of:

| Leader | Used by | Languages |
|---|---|---|
| `//` | JS, TS, CJS | `*.cjs`, `*.js`, `*.ts`, `*.mjs` |
| `#` | Shell, Python | `*.sh`, `*.py`, `*.ps1` |
| `<!--` | HTML / Markdown | `*.md`, `*.html` (closing `-->` is permitted on the same line and ignored) |

`<id>` matches one of the doc-id forms in §4.

Recognition regex (per leader, line-anchored, leading whitespace permitted):

- JS/TS:   `^\s*//\s*@pan:\s*([^\s].*?)\s*$`
- Shell:   `^\s*#\s*@pan:\s*([^\s].*?)\s*$`
- HTML:    `^\s*<!--\s*@pan:\s*([^\s].*?)\s*(?:-->)?\s*$`

Anchors are line-scoped — multi-line block comments are not parsed. Anchors found inside string literals are out of scope; the line-anchor regex avoids most false positives because string literals on a line do not begin with the comment leader.

A file may carry multiple anchors. Convention: cluster anchors at the top of the file under a single banner comment.

## 4. Doc-id resolution

Input form → resolution order (first match wins):

1. **`ADR-NNNN`** (case-insensitive `ADR-` prefix, exactly 4 digits) → glob `docs/decisions/ADR-NNNN-*.md`. Zero or many matches → unresolved.
2. **`<path>` ending in `.md`** → exact relative-to-repo-root path.
3. **`<path>` not ending in `.md`** → try `<path>.md` first, else `<path>/README.md`. Used by `learnings/universal/<topic>` shorthand.
4. **`<doc>#<section>`** → split on `#`; resolve `<doc>` per (1)–(3); then verify a markdown heading whose flattened slug matches `<section>`. Slug = lowercase + spaces→`-` + remove non-`[a-z0-9-]`.

Doc-ids are stored canonically as POSIX-style paths. The resolver returns `{ resolved: boolean, path?: string, section?: string, reason?: string }`.

## 5. Lint passes

`pan-tools links validate [--strict] [--json] [--source-root <p>...] [--doc-root <p>...] [--root <p>]`

Three sequential passes; all findings collected into one report.

### 5.1 Forward-link resolution (`F-001` through `F-099`)

For each markdown file under doc roots:

| Code | Severity | Trigger |
|---|---|---|
| F-001 | error | `[[<id>]]` does not resolve to a file |
| F-002 | error | `[[<doc>#<section>]]` resolves a file but the named section is missing |
| F-003 | warning | `must_haves.key_links` entry's `from` or `to` path does not exist |
| F-004 | warning | `must_haves.key_links` entry's `pattern` is not a valid regex |

`F-003` and `F-004` are the existing `cmdVerifyKeyLinks` checks reframed as graph findings. The original command keeps working in parallel; calling it from the new lint is left to a follow-up to avoid double-walks.

### 5.2 Backlink contract (`B-001` through `B-099`)

For each doc with `require-code-mention: true` in frontmatter:

| Code | Severity | Trigger |
|---|---|---|
| B-001 | error | Zero `@pan:` anchors under source roots resolve to this doc |
| B-002 | warning | All resolving anchors are in the same single source file (single-point-of-truth signal — informational) |

`B-001` is the load-bearing check. `B-002` is informational and does not flip the report status under `--strict`.

### 5.3 Anchor-target existence (`A-001` through `A-099`)

For each `@pan: <id>` anchor under source roots:

| Code | Severity | Trigger |
|---|---|---|
| A-001 | error | `<id>` does not resolve to a file under doc roots |
| A-002 | warning | `<id>` includes a `#section` that doesn't match any heading in the resolved file |
| A-003 | warning | Anchor uses a deprecated form (reserved for future migrations; no triggers in v1) |

## 6. Output schema

Both `--json` and human modes share the same underlying object; human mode adds a flat-text summary line via `output()`.

```json
{
  "ok": false,
  "summary": {
    "total_findings": 3,
    "errors": 2,
    "warnings": 1,
    "status": "fail",
    "doc_files_scanned": 142,
    "source_files_scanned": 38,
    "anchors_found": 7,
    "forward_links_found": 51,
    "backlink_contracts_checked": 3
  },
  "findings": [
    {
      "code": "F-001",
      "severity": "error",
      "source": "docs/USER-GUIDE.md",
      "source_line": 87,
      "target": "ADR-9999",
      "detail": "ADR-9999 did not match any file under docs/decisions/"
    },
    {
      "code": "B-001",
      "severity": "error",
      "source": "docs/decisions/ADR-0026-self-improvement-loop.md",
      "target": null,
      "detail": "require-code-mention is true but no @pan: anchors resolve to this doc"
    },
    {
      "code": "A-002",
      "severity": "warning",
      "source": "pan-wizard-core/bin/lib/experiment.cjs",
      "source_line": 3,
      "target": "ADR-0026#NonexistentSection",
      "detail": "Section anchor not found in resolved file"
    }
  ]
}
```

`status` is `pass` when `errors === 0` and (without `--strict`) is also `pass` when only warnings are present. `--strict` flips status to `fail` if any finding exists. Process exit code is `0` for `pass`, `1` for `fail`.

## 7. Module API surface

`pan-wizard-core/bin/lib/links.cjs` exports:

```
validateAll(rootDir, opts)         → { ok, summary, findings }
scanForwardLinks(docRoots, cwd)    → [{ source, sourceLine, rawId, resolved, ... }]
scanAnchors(sourceRoots, cwd)      → [{ source, sourceLine, rawId, resolved, ... }]
resolveDocId(rawId, cwd)           → { resolved, path?, section?, reason? }
parseAnchorLine(line, leader)      → string|null  (returns the rawId or null)
parseInlineLinks(text)             → [{ rawId, line }]
cmdLinksValidate(cwd, opts)        → void  (writes to stdout via output())
```

`opts` shape:

```
{
  sourceRoots: string[]?,   // defaults to ['pan-wizard-core', 'bin', 'hooks', 'scripts']
  docRoots:    string[]?,   // defaults to ['docs', 'pan-wizard-core/workflows',
                            //                'pan-wizard-core/templates',
                            //                'pan-wizard-core/references',
                            //                'pan-wizard-core/learnings',
                            //                'commands', 'agents']
  strict:      boolean,     // default false
  raw:         boolean,     // for output() — passed through
}
```

## 8. Reuse contracts

The implementation MUST reuse the following existing modules; no parallel walkers, no parallel parsers.

| Concern | Module | Function |
|---|---|---|
| Recursive markdown walk | [doc-lint/walk.js](../../pan-wizard-core/bin/lib/doc-lint/walk.js) | `walkMarkdownFiles(dir, {exclude})` |
| Frontmatter parse | [frontmatter.cjs](../../pan-wizard-core/bin/lib/frontmatter.cjs) | `extractFrontmatter(content)` |
| `key_links` block parse | [frontmatter.cjs](../../pan-wizard-core/bin/lib/frontmatter.cjs) | `parseMustHavesBlock(content, 'key_links')` |
| File reads + path normalization | [core.cjs](../../pan-wizard-core/bin/lib/core.cjs) | `safeReadFile`, `toPosix` |
| Output framing | [core.cjs](../../pan-wizard-core/bin/lib/core.cjs) | `output(obj, raw, humanLine?)` |

For source-side scanning the implementation walks file extensions directly via `fs.readdirSync` recursion — no dependency on the `walkMarkdownFiles` walker (which is markdown-only).

## 9. Failure modes

| Mode | Behavior |
|---|---|
| Doc root does not exist | Skip silently; record skipped roots in summary as informational |
| Source root does not exist | Skip silently; record skipped roots in summary as informational |
| File read error mid-walk | Emit a finding with code `F-005` or `A-005` (severity warning) — do not abort |
| Frontmatter parse error | Treat doc as having no frontmatter for that file's contract checks; not a finding |
| Regex pattern in `key_links` is invalid | Emit `F-004`; do not abort |
| Anchor with empty id (`@pan:` followed by nothing) | Emit `A-004` warning; skip resolution |

`links validate` MUST NOT throw under any normal repo state. All errors are findings.

## 10. Cross-platform requirements

- All path output uses POSIX-style forward slashes via `toPosix()`.
- All path comparisons normalize via `toPosix()` before equality.
- Doc-ids that are ADR shortcuts are case-insensitive on the `ADR-` prefix only (the `NNNN-<slug>` portion preserves case as on disk).
- The walker must not follow symlinks (matches existing `walkMarkdownFiles` behavior).

## 11. Acceptance criteria

The W1–W3 implementation is acceptance-complete when:

1. **W1**: `node pan-wizard-core/bin/pan-tools.cjs links validate --json` runs against a hand-crafted fixture project (under `tests/fixtures/links-graph/`) and emits the schema in §6 with correct findings for: a deliberately broken `[[<id>]]`, a deliberately stale `@pan:` anchor, a doc with `require-code-mention` and zero anchors, and a clean control case. Unit tests in `tests/links.test.cjs` assert all four findings.
2. **W2**: Running against the source repo of PAN itself (the real `docs/` + source tree) returns `status: pass` in advisory mode (warnings allowed), excluding `require-code-mention` opt-ins (none yet at W2).
3. **W3**: After opting three canary ADRs into `require-code-mention: true` and placing the corresponding `@pan:` anchors in their primary implementation files, `pan-tools links validate --strict` returns `status: pass`. `pan-tools validate health` shows a `link_graph` summary line.

## 12. Out of scope (explicit deferrals)

These are listed in [ADR-0027](../decisions/ADR-0027-doc-code-link-graph.md#future-scope) and intentionally not specified here:

- `pan-tools links refs <doc>` (reverse query)
- `pan-tools links expand <file>` (inline expansion into prompts)
- Auto-anchor suggestion path inside `pan-optimizer`
- Migration of `must_haves.key_links` to inline `[[<id>]]`
- Commit-time hook gating
- AST-based code parsing
