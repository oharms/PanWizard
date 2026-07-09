---
name: pan:links
group: Validation
description: Validate the doc-code link graph — inline wiki-style refs, source-comment anchors, and require-code-mention contracts (ADR-0027, v3.8.0+)
allowed-tools:
  - Bash
  - Read
  - Grep
---

# /pan:links

Validate the doc-code link graph. Walks `docs/`, `pan-wizard-core/`, `commands/`, and `agents/` for inline `[[<id>]]` references and `// @pan: <id>` source-comment anchors. Reports broken refs, stale anchors, and uncovered backlink contracts.

**Usage:**
```
/pan:links
/pan:links --strict
/pan:links --doc-root <path> [--doc-root <path>...]
/pan:links --source-root <path> [--source-root <path>...]
```

**Flags:**
- `--strict` — fail (exit 1) on warnings, not only errors. Default is advisory: warnings do not flip status.
- `--doc-root <path>` — override default doc roots. Repeatable.
- `--source-root <path>` — override default source roots. Repeatable.
- `--raw` — human-readable output instead of JSON.

**What it does:**

Three sequential passes share one walk pair:

1. **Forward links** — every `[[<id>]]` in body text and every `must_haves.key_links` entry must resolve. Section anchors (`[[ADR-0021#Decision]]`) check that the named heading exists.
2. **Backlink contract** — docs with `require-code-mention: true` in frontmatter must have at least one `@pan:` source anchor that resolves to them.
3. **Anchor-target existence** — every `// @pan: <id>` comment must point to a real doc.

**Doc-id forms accepted:**

- `ADR-NNNN` — resolves via glob to `docs/decisions/ADR-NNNN-*.md`
- `<path>.md` — exact path relative to repo root
- `<path>` (no extension) — tries `<path>.md` then `<path>/README.md`
- Any of the above with `#section` — verifies a heading whose slug matches

**Source-anchor grammar:**

```
// @pan: ADR-0027         (JS / TS / CJS)
# @pan: ADR-0027          (Python / shell)
<!-- @pan: ADR-0027 -->   (Markdown / HTML)
```

Anchors cluster at the top of a file under a single banner; comment leader must be the line's first non-whitespace token.

**Exit codes:**

- `0` — pass
- `1` — fail (errors present, or warnings present under `--strict`)

**Output (JSON):**

```json
{
  "ok": true,
  "summary": {
    "total_findings": 0,
    "errors": 0,
    "warnings": 0,
    "status": "pass",
    "doc_files_scanned": 280,
    "source_files_scanned": 170,
    "anchors_found": 4,
    "forward_links_found": 12,
    "backlink_contracts_checked": 3
  },
  "findings": []
}
```

**Finding codes:**

| Code | Severity | Meaning |
|---|---|---|
| F-001 | error | Inline `[[<id>]]` does not resolve |
| F-002 | error | `[[<doc>#<section>]]` resolves the file but the section is missing |
| F-003 | warning | `must_haves.key_links` entry's `from` or `to` does not exist |
| F-004 | warning | `must_haves.key_links` regex pattern is invalid |
| B-001 | error | Doc has `require-code-mention: true` but no `@pan:` anchors resolve to it |
| B-002 | warning | Doc is anchored by exactly one source file (single-source informational) |
| A-001 | error | `@pan:` anchor target does not resolve |
| A-002 | warning | `@pan:` anchor section is missing in the resolved file |
| A-004 | warning | `@pan:` anchor has empty id |

**Composing with `validate health`:**

`validate health --links` includes the link-graph summary as a `link_graph` field in the health report. Used as a pre-flight check before release. Errors degrade the health report to a warning-level issue (`LINKS_ERR`); non-blocking unless `--strict` is added to a separate `links validate` invocation.

**See also:**

- ADR-0027 — Doc–Code Link Graph
- `docs/specs/doc_code_link_graph_featureai.md` — wire-level spec
- `pan-tools doc-lint` — frontmatter schema validator (orthogonal concern)
- `pan-tools verify-key-links` — legacy frontmatter-only link verifier (subsumed; both still ship)
