---
topic: vendor-pattern
last_updated: 2026-04-27T10:28:48.403Z
patterns:
  - id: P-801
    summary: Vendoring small zero-dep modules into a project's bin/lib/ subdirectory works for downstream consumers without npm dep
    promoted_at: 2026-04-27T10:28:48.403Z
    source_experiments: [whoorun]
---

# Vendor Pattern (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-801 — Vendoring small zero-dep modules into a project's bin/lib/ subdirectory works for downstream consumers without npm dep

**Evidence:** whoorun sess_20260427T140500 14:08Z surprise (critical): META test passed first try. lib/taskfile.js requires d:/PanWizard/pan-wizard-core/bin/lib/doc-lint/frontmatter.js by absolute path. The vendored module: exists at the documented location, exports the documented API (parseFrontmatter), parses real task-file frontmatter correctly. No npm dep, no symlink, no package.json magic.

**Rule:** When a project ships a small (<300 LOC), zero-dep, structure-stable module that's likely to be useful to downstream consumers (parser, validator, formatter), vendor it under bin/lib/<topic>/ and document the require path. The vendor pattern works as an alternative to publishing-as-npm when (a) the module's surface is small, (b) the consumer can pin to a specific source-repo path, and (c) the project doesn't want the maintenance overhead of a separate package. Trade-off: consumers must update manually when the upstream module changes — versioned by the parent project's release tag.

**Applies in:** v3.7.x design (PAN's doc-lint vendor pattern), v3.8+ when shipping more vendored utilities
