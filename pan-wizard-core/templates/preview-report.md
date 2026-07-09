<!--
Template for pan-previewer output. Agent fills in sections based on mode
(phase | phases | milestone). Not all sections apply to all modes — see
commands/pan/preview.md for the per-mode contract.

Placeholders:
  {{mode}}          — "phase" | "phases" | "milestone"
  {{title}}         — e.g. "Phase 7 — API Refactor" or "v3.1"
  {{generated_at}}  — ISO timestamp
  {{risk_score}}    — 1-10 (phase mode)
  {{confidence}}    — 0-100 (milestone mode)
-->

---
mode: {{mode}}
generated_at: {{generated_at}}
source: pan-previewer
---

# Preview: {{title}}

## Summary

{{one-paragraph-verdict}}

## Files likely touched

<!-- phase mode only; grouped by source/tests/docs -->
- `{{file_path}}` — {{role}}

## Tests at risk

<!-- phase mode only -->
- `{{test_path}}` — {{reason}}

## Migration steps

<!-- phase mode, only when risk_signals.migrate is true -->
1. {{step}}

## External deps

<!-- phase mode, only when relevant -->
- {{package}} — {{version_concern}}

## Mermaid

<!-- phases mode only; raw source from data layer inside a fenced mermaid block -->
```mermaid
{{mermaid_source}}
```

## Parallel batches

<!-- phases mode only -->
### Batch 1
- Phase {{num}} — {{name}}

## Hidden coupling

<!-- phases mode only; may be "none found" -->
- Phase {{from}} → Phase {{to}} — inferred from prose mention; consider promoting to `depends_on:` frontmatter.

## Current state

<!-- milestone mode only -->
- Phases completed: {{completed}} / {{total}}
- Velocity: {{phases_per_week}} phases/week (sample size {{sample_size}})

## Projection

<!-- milestone mode only -->
- ETA: **{{eta_date}}**
- Confidence: {{confidence}}%

## Bottleneck

<!-- milestone mode only -->
- Phase {{phase_num}} — {{reason}}

## Caveats

<!-- milestone mode only -->
- {{caveat}}

## Risk assessment

<!-- phase mode only; narrative, cites specific signals -->
{{narrative}}

## Bottom line

**{{one-sentence-verdict}}**
