---
topic: comment-syntax
last_updated: 2026-04-27T10:19:16.013Z
patterns:
  - id: P-501
    summary: JSDoc /** block comments self-terminate on the literal **/X byte sequence (no space)
    promoted_at: 2026-04-27T10:19:16.013Z
    source_experiments: [whoolen]
---

# Comment Syntax (AI-derived)

> Auto-maintained by `pan-tools learn promote`. Each pattern was extracted from one or more experiment runs (see source_experiments). Patterns are **advisory** — orchestrators should weight them against current context.

## P-501 — JSDoc /** block comments self-terminate on the literal **/X byte sequence (no space)

**Evidence:** whoolen sess_20260427T132000 13:24Z error event (critical impact). lib/walk.js JSDoc described globToRegex fix saying 'with the **/X glob fix baked in'. Node parsed the /** as block-open and the **/ as block-close, then tried to compile 'X glob fix' as identifier. Confusing 'Unexpected identifier' SyntaxError that points at the wrong line.

**Rule:** Avoid the literal byte sequence **/ inside a /** block comment. JS block-comment syntax has no escape mechanism. Three safe alternatives: (1) use single-line // comments when documenting glob/filesystem patterns containing **/X, (2) insert a space: ** / X, (3) describe with words: 'double-star slash X'. The same bug bites any source file (TypeScript, JavaScript, JSDoc, Java, C) that mentions ** in a block comment.

**Applies in:** exec-phase (writing source comments), plan-phase (when documenting glob/filesystem patterns)
