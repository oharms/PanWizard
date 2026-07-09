# Relationships Template

Template for `.planning/codebase/relationships.md` - maps module dependencies and coupling.

**Purpose:** Document how modules relate to each other. Answers "what depends on what?" and "what breaks if I change X?"

---

## File Template

```markdown
# Module Relationships

**Analysis Date:** [YYYY-MM-DD]

## Dependency Overview

| Metric | Value |
|--------|-------|
| Total modules | [N] |
| Total import relationships | [N] |
| Circular dependencies | [N] |
| Orphan modules | [N] |
| Entry points | [N] |

## Module Dependency Graph

```mermaid
graph LR
    [ModuleA] --> [ModuleB]
    [ModuleB] --> [ModuleC]
```

## Circular Dependencies

[If none: "No circular dependencies detected."]

**Cycle [N]:** `[file-a]` -> `[file-b]` -> `[file-a]`
- Severity: [High/Medium/Low]
- Impact: [What breaks or is fragile]
- Fix approach: [Extract shared code, invert dependency, use interface]

## High-Coupling Modules

Modules with the most connections (incoming + outgoing):

| Module | Incoming | Outgoing | Total | Risk |
|--------|----------|----------|-------|------|
| `[path]` | [N] | [N] | [N] | [Hub/Gateway/Leaf] |

## Orphan Modules

Files that export symbols but are never imported (potential dead code):

- `[path]` - exports `[function/class names]`

[If none: "No orphan modules detected."]

## Entry Points

Application roots (files imported by nothing):

- `[path]` - [Purpose: main entry, CLI entry, test runner, etc.]

## Layer Boundaries

[Describe the architectural layers detected in the codebase]

**Layers:**
1. [Layer name] - `[directory pattern]`
2. [Layer name] - `[directory pattern]`

## Layer Violations

Imports that cross architectural boundaries:

- `[source file]` imports `[target file]` - [Why this is a violation]

[If none: "No layer violations detected."]

## Import Patterns

**Module system:** [CommonJS / ESM / Mixed]

**Internal imports:** [Relative paths / Aliases / Barrel files]

**External dependencies:** [How third-party packages are imported]

---

*Relationship analysis: [date]*
*Update when module structure changes*
```

<guidelines>
**What belongs in relationships.md:**
- Module dependency graph (Mermaid)
- Circular dependency warnings with fix suggestions
- High-coupling modules (hub detection)
- Orphan modules (dead code candidates)
- Entry points (application roots)
- Layer boundaries and violations
- Import pattern summary

**What does NOT belong here:**
- Individual function signatures (that's ARCHITECTURE.md)
- File listing (that's STRUCTURE.md)
- Code quality issues (that's CONCERNS.md)
- Technology choices (that's STACK.md)

**When filling this template:**
- Use pre-computed dependency graph data if provided in the prompt
- Verify circular dependencies by tracing the import chain
- Classify coupling risk: Hub (>10 connections), Gateway (5-10), Leaf (<5)
- Entry points are files with zero incoming edges
- Layer violations require understanding the intended architecture

**Mermaid graph guidelines:**
- Maximum 15 nodes per diagram
- Use `graph LR` for dependency flow
- Show module short names, not full paths
- Highlight circular deps with red styling if supported
- Add "... and N more" note for large graphs
</guidelines>
