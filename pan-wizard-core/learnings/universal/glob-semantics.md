---
topic: glob-semantics
last_updated: 2026-07-18T08:42:29.855Z
patterns:
  - id: P-205
    summary: Translate **/X glob to allow zero-segment match (root-level X), per gitignore/minimatch convention
    promoted_at: 2026-04-27T09:49:20.726Z
    source_experiments: [whooo]
  - id: P-FH-019
    summary: Assert a single match when a build copies an artifact via glob
    promoted_at: 2026-07-18T08:42:29.855Z
    source_experiments: [field-harvest-2026-07]
---

# Glob Semantics (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-205 — Translate **/X glob to allow zero-segment match (root-level X), per gitignore/minimatch convention

**Evidence:** whooo trace.jsonl 11:45Z (error major): globToRegex bug where **/foo.md regex required at least one slash so foo.md at root did not match. Fix: emit (?:.*/)? so the slash is optional. Caught by walk.test.js regression test.

**Rule:** When implementing glob-to-regex translation, follow gitignore/minimatch convention: **/X must match BOTH dir/sub/X AND root-level X (the **/ segment can match zero path segments). Translate the **/ prefix to (?:.*/)?  NOT .*/ . The latter requires at least one slash and silently misses root-level files.

**Applies in:** exec-phase (any glob/walker implementation), plan-phase (when planning file-walking tools)

## P-FH-019 — Assert a single match when a build copies an artifact via glob

**Evidence:** A copy glob matched both a thin jar and the boot jar and grabbed the wrong one, producing an image that failed to boot until a single-match guard was added to the build script.

**Rule:** A build step that copies an artifact via a wildcard can match more than one file — for example a thin/library jar alongside the fat/boot jar — and silently pick the wrong one, producing a broken output that still reports success. Constrain such globs to the exact artifact and assert exactly one match, failing loudly on zero or multiple matches.

**Applies in:** build steps that copy an artifact via a wildcard
