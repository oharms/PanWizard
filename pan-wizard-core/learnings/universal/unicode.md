---
topic: unicode
last_updated: 2026-04-27T10:53:02.556Z
patterns:
  - id: P-1001
    summary: JS string .length counts UTF-16 code units, not characters; surrogate pairs are length 2 but visually one character
    promoted_at: 2026-04-27T10:53:02.556Z
    source_experiments: [whooemoji]
---

# Unicode (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-1001 — JS string .length counts UTF-16 code units, not characters; surrogate pairs are length 2 but visually one character

**Evidence:** whooemoji 14:52Z surprise: rocket emoji is one emoji but '🚀'.length === 2. Test asserts both invariants explicitly to document the trap.

**Rule:** When code reasons about string length for VISUAL/USER-FACING purposes (column alignment, character limits, truncation), do NOT use String.prototype.length — it counts UTF-16 code units. Use [...str].length for code points (still wrong for grapheme clusters but better) or Intl.Segmenter for proper graphemes. When length must match user expectation (e.g. social-media char counts), document which definition you're using.

**Applies in:** exec-phase (any code that handles user-facing strings: CLIs, validators, formatters, truncators)
