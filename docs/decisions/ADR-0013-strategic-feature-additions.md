# ADR-0013: Strategic Feature Additions (Industry Analysis)

## Status
Accepted

## Context
PAN Wizard v2.2.0 is a mature CLI workflow automation tool with 37 commands, 15 modules, and 5-runtime support. A competitive analysis of 6 AI coding tools (Aider, Cursor, Continue.dev, Cline, Windsurf, GitHub Copilot Workspace) identified that PAN is 18-24 months ahead on structured workflow orchestration but should deepen existing moats rather than expand surface area.

Key industry findings:
- #1 user pain point across all tools: context loss between sessions ("AI amnesia")
- Planning-before-coding is now table-stakes (4/6 competitors have it)
- Zero competitors have formal milestone lifecycle or cross-session verification
- Context engineering identified as strategic priority (Anthropic 2026 report)
- AI coding agent market growing from $7.8B to $52B by 2030

## Decision
Add 4 practical features that strengthen existing differentiators without over-engineering:

1. **Pre-Flight Checks** (`preflight`) -- Validate execution prerequisites before spending tokens
2. **Project Dashboard** (`dashboard`) -- Single-command aggregated project overview
3. **Session Intelligence** (`learnings extract/list/prune`) -- Auto-extract patterns from sessions
4. **Dependency Validation** (`deps validate`) -- Cross-reference roadmap vs reality

All features: zero runtime dependencies, CommonJS, works across all 5 runtimes.

## Consequences

### Positive
- Raises moat score from 25/30 to 29/30
- Addresses #1 industry pain point (session learning)
- Pre-flight checks prevent the most common execution failure (broken baseline)
- Dashboard makes .planning/ state immediately actionable
- All features build on existing architecture (verify.cjs, state.cjs, commands.cjs)

### Negative
- +4 new commands increases cognitive load slightly
- Session learning requires structured session data (appendSessionSummary, appendErrorPattern)
- Dashboard aggregates multiple files, so performance depends on .planning/ size

### Neutral
- Command count increases from 37 to 41
- No new modules needed (features fit into existing verify.cjs, state.cjs, commands.cjs)

## Options Considered
1. **IDE integration** -- Rejected. PAN is CLI-first; competing with Cursor/Windsurf on IDE is losing strategy.
2. **Parallel agent orchestration** -- Rejected. PAN's value is execution quality, not speed.
3. **Auto-iteration loops** -- Rejected. Windsurf's approach is opaque; PAN values transparency.
4. **Deepen existing moats (chosen)** -- Build practical features that strengthen PAN's unique workflow management position.

## Links
- Spec: docs/specs/industry_analysis_strategic_additions_featureai.md
- Batch: .planning/focus/batch-2026-03-03.json
- Related: ADR-0006 (focus commands), ADR-0003 (smart execution)
