# ADR-0017: Enhanced focus-design with Autonomous Investigation

## Status
Proposed

## Context
PAN's `/pan:focus-design` is the most comprehensive AI feature specification workflow in the ecosystem (10 phases, 4 modes, strategic analysis, security modeling, ADR generation). However, competitive analysis reveals three critical gaps:

1. **No autonomous codebase investigation** before spec creation — Cline's `/deep-planning` leads here with silent grep/read before asking any questions, consistently called "game changer" by users
2. **No impact analysis** showing what existing modules are affected — no competitor does this either, representing an opportunity to lead
3. **Clarification questions are generic templates**, not grounded in discovered code patterns — Cline's informed questions (referencing actual found patterns) are the industry benchmark

Additionally, the older `/featureAI` command (730 lines in `.claude/commands/`) contains stale hardcoded counts (31 commands, 604 tests, 14 modules) and should be deprecated in favor of focus-design.

The competitive landscape in March 2026 includes:
- **Cline `/deep-planning`**: Best autonomous investigation, clean context separation
- **Windsurf megaplan**: Structured clarification questionnaire, persistent plan.md
- **Amazon Kiro**: Requirements → Design → Tasks three-phase spec with hooks
- **GitHub Spec-Kit**: Constitution + spec + plan + tasks (4x slower than iterative prompting per Scott Logic)
- **Cursor Rules**: Context injection, no spec workflow
- **Aider Architect**: Two-model separation, no persistent artifact

## Decision
Enhance the existing `commands/pan/focus-design.md` command file with 10 additive changes:

1. **Phase 0.8: Autonomous Codebase Investigation** — silent discovery + impact analysis before any design work
2. **Phase 0.2.5: Before/After State Specification** — explicit current→desired behavior mapping (from Copilot Workspace)
3. **Structured Acceptance Criteria** — table format with verification methods and pass conditions
4. **Remove all hardcoded counts** — use dynamic language throughout
5. **Scope Calibration Guidance** — auto-mode selection table for agents
6. **Dynamic Competitor Selection** — domain-aware research, not hardcoded 6 tools
7. **Phase 1.5: Informed Clarification** — questions MUST reference discovered code patterns
8. **MCP/context7 Tools** — add to allowed-tools frontmatter
9. **Updated Convention Checklist** — PAN-specific function names (readStateSafe, output, toPosix, etc.)
10. **Enhanced Report Summary** — investigation depth, competitive position, informed questions

This is a command .md file enhancement only — zero code changes needed.

## Consequences

### Positive
- Specs grounded in actual code patterns instead of generic templates
- Impact analysis prevents implementation surprises (blast radius known before design)
- Best-in-industry depth: investigation + strategic analysis + security + testing — no competitor combines all four
- Zero code changes needed — immediate deployment across all 5 runtimes
- Informed questions save user time (no generic "do you want tests?" — always want tests)
- Scope calibration prevents overkill for small features (Scott Logic's SDD critique addressed)

### Negative
- Command file grows from ~664 to ~800 lines (more complex for maintainers)
- Investigation phase adds ~20% more time to full-mode runs
- /featureAI users must update their muscle memory to focus-design

### Neutral
- Spec format remains markdown (no structural change to output artifacts)
- Existing specs produced by focus-design v1 remain valid
- All 4 modes (full/internal/outward/spike) remain — new phases follow mode skip rules

## Options Considered
1. **Keep focus-design as-is** — Rejected: competitive gap is real and widening (Cline, Kiro, Windsurf all advancing)
2. **Create a new command (/pan:focus-design-v2)** — Rejected: unnecessary command proliferation, cognitive load +1
3. **Enhance focus-design.md (chosen)** — Best: additive changes, zero breaking changes, immediate impact
4. **Build investigation into a separate agent** — Rejected: investigation must be inline to ground subsequent phases; separate agent loses context

## Links
- Spec: `docs/specs/focus_design_v2_featureai.md`
- Related commands: focus-design.md, featureAI.md (deprecated)
- Predecessor: ADR-0006 (Focus Commands), ADR-0015 (Focus Auto-Runner)
- Competitive analysis sources: Cline docs, Windsurf Wave 10, Kiro docs, Spec-Kit, Martin Fowler SDD analysis
