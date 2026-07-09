# ADR-0008: Enhance map-codebase with Mermaid Diagrams and TOGAF Structure

## Status
Proposed

## Context
`/pan:map-codebase` produces 7 text-only markdown files describing a codebase.
Developers and AI agents struggle to quickly understand system structure from
prose alone. Visual diagrams communicate architecture 10x faster than text.
The current 7-file structure (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE,
CONVENTIONS, TESTING, CONCERNS) was designed pragmatically without mapping to
any standard architecture framework.

TOGAF's Architecture Development Method provides a proven taxonomy (Business,
Application, Data, Technology architecture domains) that would give the codebase
map principled coverage. Mermaid diagrams (text-based, renders natively in GitHub,
VS Code, GitLab, and Obsidian) would add visual communication without introducing
any runtime dependency.

## Decision
1. Add Mermaid diagram blocks to 5 of 7 codebase document templates
2. Restructure document sections to align with TOGAF architecture domains
3. Keep all 7 existing filenames unchanged (backward compatibility)
4. Update mapper agent prompts to generate diagrams as part of exploration
5. Never use Mermaid `click` directives (security)
6. Never include credentials or tokens in diagram labels (security)

### Diagram Types Per Document
- ARCHITECTURE.md: Flowchart (component relationships) + Sequence diagram (request lifecycle)
- STRUCTURE.md: Flowchart TD (directory hierarchy)
- INTEGRATIONS.md: Flowchart (external services) + ER diagram (data entities, if DB detected)
- STACK.md: Flowchart (deployment topology)
- CONCERNS.md: Quadrant chart (risk assessment)

### TOGAF Domain Mapping (without renaming files)
- Business Architecture → ARCHITECTURE.md (new section)
- Application Architecture → ARCHITECTURE.md + STRUCTURE.md (existing, restructured)
- Data Architecture → INTEGRATIONS.md (new section)
- Technology Architecture → STACK.md (new header)
- Cross-Cutting → CONVENTIONS.md, TESTING.md, CONCERNS.md (unchanged)

Mermaid was chosen over PlantUML (requires Java runtime), D2 (fewer renderers),
and PNG/SVG generation (adds runtime dependency via mmdc CLI).

## Consequences

### Positive
- Visual architecture diagrams generated automatically by mapper agents
- TOGAF alignment ensures no architecture layer is accidentally omitted
- Renders in GitHub markdown preview with zero additional tooling
- AI agents can parse Mermaid syntax for better planning context
- Zero new runtime dependencies (Mermaid is text, not a dependency)
- Graceful degradation in terminals (Mermaid blocks display as readable text)

### Negative
- Mapper agents use slightly more tokens generating diagrams (~10-15% more)
- Templates become longer (more examples for agents to follow)
- Users on plain terminals see raw Mermaid syntax instead of diagrams

### Neutral
- Existing consumers (plan-phase, exec-phase) continue working unchanged
- Same 4 mapper agents, same workflow orchestration, same 7 filenames
- Same init.cjs cmdInitMapCodebase() output — no JSON schema changes

## Options Considered
1. **PNG/SVG generation with mmdc CLI** — rejected (adds runtime dependency, violates zero-dep constraint)
2. **Separate .mmd diagram files** — rejected (consumers load .md files by name, extra files = confusion)
3. **PlantUML** — rejected (requires Java runtime)
4. **D2 (Terrastruct)** — rejected (fewer rendering targets, less AI familiarity)
5. **Mermaid in existing markdown** — chosen (zero deps, native rendering, AI-friendly)
6. **Full TOGAF ADM process** — rejected (too heavyweight for codebase mapping)
7. **TOGAF sections in existing files** — chosen (lightweight, backward-compatible)
8. **Rename files to TOGAF domains** — rejected (breaks consumer filename mapping)

## Links
- Spec: docs/specs/map_codebase_mermaid_togaf_featureai.md
- Current workflow: pan-wizard-core/workflows/map-codebase.md
- Current agent: .claude/agents/pan-document_code.md
- Current templates: pan-wizard-core/templates/codebase/*.md
- Related: ADR-0006 (focus commands — also uses .planning/ output)
