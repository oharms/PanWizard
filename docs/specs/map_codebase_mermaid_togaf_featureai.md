# Enhance map-codebase with Mermaid Diagrams & TOGAF-Aligned Structure — featureAI Specification

**Generated:** 2026-03-01
**Mode:** `--internal` (Phases 0, 1, 3, 3.5, 4, 5, 6, 7, 8, 9, 10 — skips Phase 2 competitive intel)
**Scope:** Enhance `/pan:map-codebase` to produce visual Mermaid diagrams and restructure output using TOGAF architecture layers

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

`/pan:map-codebase` currently produces 7 text-only markdown files that describe a codebase in prose. This has two limitations: (1) **No visual architecture diagrams** — developers and AI agents lose spatial understanding of system relationships, component boundaries, and data flows that diagrams communicate 10x faster than text; (2) **Ad-hoc document structure** — the current 7-file split (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE, CONVENTIONS, TESTING, CONCERNS) was designed pragmatically but doesn't map to any standard enterprise architecture framework, making it harder to ensure coverage and communicate with stakeholders who think in architectural layers.

TOGAF's Architecture Development Method provides a proven taxonomy (Business, Application, Data, Technology architecture domains) that would give the codebase map a principled structure. Mermaid diagrams (text-based, renders natively in GitHub, VS Code, and most markdown viewers) would add visual communication without introducing any runtime dependency.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Personal pain (user-stated) | This conversation | User explicitly requested: "update map-codebase to draw images of the architecture and workflows, also to break it down using TOGAF structure" |
| Industry standard | TOGAF 10 (The Open Group) | Most widely adopted enterprise architecture framework globally |
| Mermaid ubiquity | GitHub, GitLab, VS Code, Notion, Obsidian | Mermaid renders natively in all major markdown platforms — zero-friction diagrams |
| AI agent comprehension | Claude, Copilot, Gemini | AI models parse Mermaid diagram syntax well and can reason about system structure from diagrams |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Mermaid diagram blocks embedded in existing .md files | Raster image generation (PNG/SVG) — requires external tooling (`mmdc`), adds runtime dep |
| TOGAF-aligned document structure (4 architecture domains) | Full TOGAF ADM process (phases A-H) — overkill for codebase mapping |
| Updated templates for each document | New pan-tools.cjs commands — no new CLI needed |
| Updated mapper agent prompts to generate diagrams | C4 model diagrams — Mermaid C4 syntax is unstable; use standard flowchart/sequence instead |
| Updated mapper agent templates with Mermaid examples | Interactive diagram tools (D2, PlantUML) — adds dependencies |
| Backward compatibility (old 7-file names still work) | TOGAF metamodel, ArchiMate notation — too formal for codebase analysis |

### 0.4 Success Criteria

```
SC-1: Each ARCHITECTURE.md and STRUCTURE.md contains at least 2 Mermaid diagram blocks
SC-2: Documents map cleanly to TOGAF domains (Business/Application/Data/Technology)
SC-3: Mermaid diagrams render correctly in GitHub markdown preview
SC-4: No new runtime dependencies introduced
SC-5: All 875 existing tests pass with zero regressions
SC-6: Existing consumers of codebase docs (plan-phase, exec-phase) continue working
SC-7: Mapper agents generate diagrams autonomously (no manual editing required)
```

### 0.5 User Stories

```
As a developer onboarding to a new project, I want visual architecture diagrams
in the codebase map, so that I can understand system structure in seconds
instead of reading 200 lines of prose.

As an architect reviewing a PAN-managed project, I want the codebase analysis
organized by TOGAF domains, so that I can verify coverage across all
architecture layers instead of guessing which ad-hoc file covers what.

As a Claude Code agent planning a phase, I want Mermaid diagrams showing
component relationships and data flows, so that I can generate more accurate
implementation plans instead of inferring structure from text descriptions.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:map-codebase` | Full — this IS the enhancement target | Enhancement, not replacement |
| `pan-document_code` agent | Full — agents get updated prompts | Backward-compatible update |
| Codebase templates (`pan-wizard-core/templates/codebase/`) | Full — templates get updated | New fields added, no fields removed |

This is an enhancement to existing capabilities, not a new command.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 37 | 37 | +0 |
| New concepts introduced | 0 | 1 (TOGAF domain mapping — but transparent to user) | +0.5 |
| Score | — | — | **neutral (0)** — same command, richer output |

---

## Phase 1: Internal Reconnaissance

### 1.1 Current System Inventory

**Workflow:** [map-codebase.md](../../pan-wizard-core/workflows/map-codebase.md) (316 lines)
- Orchestrates 4 parallel `pan-document_code` agents
- Each agent writes directly to `.planning/codebase/`
- Orchestrator collects confirmations (file paths + line counts), not content
- Includes secret scanning, commit, and next-step offering

**Agent:** [pan-document_code.md](../../agents/pan-document_code.md)
- 4 focus areas: `tech`, `arch`, `quality`, `concerns`
- Uses templates from agent definition (inline) AND from `pan-wizard-core/templates/codebase/`
- Explores with Read, Bash, Grep, Glob; writes with Write
- Has `<forbidden_files>` block (never reads .env, credentials, etc.)
- Returns only confirmation, not document content

**Templates:** `pan-wizard-core/templates/codebase/` (7 files)
- `architecture.md` — Pattern, layers, data flow, abstractions, entry points
- `stack.md` — Languages, runtime, frameworks, dependencies, config
- `structure.md` — Directory layout, key locations, naming conventions
- `conventions.md` — Code style, naming, imports, error handling
- `testing.md` — Framework, organization, mocking, fixtures, coverage
- `integrations.md` — APIs, databases, auth, monitoring, CI/CD
- `concerns.md` — Tech debt, bugs, security, performance, fragile areas

**Core module:** [init.cjs](../../pan-wizard-core/bin/lib/init.cjs) line 683
- `cmdInitMapCodebase()` — returns mapper_model, commit_docs, codebase_dir, existing_maps
- `CODEBASE_DIR = 'codebase'` in constants.cjs

**Consumers:** plan-phase and exec-phase load codebase docs based on phase type:
| Phase Type | Documents Loaded |
|------------|------------------|
| UI/frontend | CONVENTIONS.md, STRUCTURE.md |
| API/backend | ARCHITECTURE.md, CONVENTIONS.md |
| Database/models | ARCHITECTURE.md, STACK.md |
| Testing | TESTING.md, CONVENTIONS.md |
| Integration/external | INTEGRATIONS.md, STACK.md |
| Refactor/cleanup | CONCERNS.md, ARCHITECTURE.md |
| Setup/config | STACK.md, STRUCTURE.md |

**Key constraint:** Consumers load by filename. Renaming files would break the consumer mapping.

### 1.2 Current Diagram Usage

The entire codebase uses **zero Mermaid diagrams**. The research-project ARCHITECTURE template explicitly says "Use ASCII box-drawing diagrams" — this is the pattern being upgraded.

### 1.3 Convention Enforcement Checklist

- [x] No new functions needed in `cmd*` pattern — this changes templates and agent prompts only
- [x] No file reads/writes in core modules change
- [x] No new JSON output formats
- [x] No new CLI commands
- [x] Zero runtime dependencies maintained (Mermaid is text, not a dependency)
- [x] CommonJS module format preserved

### 1.4 Dependency & Integration Map

```
[This Enhancement]
    ├── modifies: pan-document_code agent (prompts + templates)
    ├── modifies: pan-wizard-core/templates/codebase/*.md (7 templates)
    ├── modifies: pan-wizard-core/workflows/map-codebase.md (agent prompts)
    ├── preserves: init.cjs cmdInitMapCodebase() — unchanged
    ├── preserves: constants.cjs CODEBASE_DIR — unchanged
    ├── preserves: all 7 filenames (ARCHITECTURE.md, etc.) — consumer compatibility
    ├── conflicts with: nothing
    └── enables: richer context for plan-phase and exec-phase agents
```

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Decision |
|--------|----------|
| **ELIMINATE** | ASCII box-drawing diagrams (replaced by Mermaid which renders natively) |
| **REDUCE** | Prose descriptions of relationships (diagrams show this better) |
| **RAISE** | Visual communication quality, architecture coverage completeness |
| **CREATE** | TOGAF-aligned layer taxonomy, standardized diagram types per document |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                                               ↑
                                         Mermaid diagrams
                                    (commodity — text-to-diagram)
                    ↑
              TOGAF structure
         (product — well-known framework)
```

Both components are mature. We're adopting commoditized tools, not inventing new ones.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Diagrams give AI agents spatial understanding of codebases | 5 |
| **Cross-Platform** | Mermaid renders in GitHub, VS Code, all markdown viewers | 5 |
| **Developer Experience** | Visual > text for architecture comprehension | 4 |
| **Zero Dependencies** | Mermaid is text, not a dependency | 5 |
| **State Persistence** | Diagrams persist in .planning/ across sessions | 4 |
| **Verification Quality** | TOGAF ensures no architecture layer is missed | 4 |
| **Total** | | **27/30** |

### 3.4 Strategic Recommendation

**Build — enhance map-codebase with Mermaid diagrams and TOGAF-aligned sections.** This is a pure quality improvement with zero new dependencies, zero new commands, and zero breaking changes. The unique angle is that no competing AI workflow tool produces structured architecture diagrams automatically. Mermaid syntax is already well-understood by Claude, so the mapper agents can generate high-quality diagrams without new tooling. The TOGAF alignment provides principled coverage that ad-hoc document structures cannot guarantee.

---

## Phase 3.5: Architecture & Implementation Assessment

### 3.5.1 Feature Type Classification

**Core Enhancement** — modifies existing templates and agent prompts. No new modules, commands, or agents.

### 3.5.2 Layer Violation Check

- [x] No command .md files change CLI routing
- [x] No core modules gain new dependencies
- [x] No upward dependencies introduced
- [x] Agent prompts only reference Write tool (existing pattern)

### 3.5.3 Output Contract Design

No JSON output changes. The `cmdInitMapCodebase()` output is unchanged. The only change is the *content* of the `.planning/codebase/*.md` files written by agents.

### 3.5.4 State Transition Modeling

No state file mutations. `.planning/codebase/` files are overwritten on each mapping run.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | **No** |
| Changes file formats? | **Yes — content within existing .md files** (sections added, no sections removed) |
| Changes directory structure? | **No** — same 7 filenames in same directory |
| Changes installer output? | **No** |

**Migration:** None needed. New content is additive. Consumers load files by name, not by section heading. Adding Mermaid blocks and TOGAF sections won't break any existing consumer.

### 3.5.6 TOGAF Domain → Document Mapping

**The key design decision:** How to map TOGAF's 4 architecture domains onto the existing 7 documents WITHOUT renaming files (which would break consumers).

```
TOGAF Domain              Current Documents         TOGAF Section Added
─────────────────────     ────────────────────      ───────────────────
Business Architecture  →  (not covered — NEW)    →  Added as section in ARCHITECTURE.md
Application Arch.      →  ARCHITECTURE.md         →  Existing content restructured
                          STRUCTURE.md                under "Application Architecture"
Data Architecture      →  INTEGRATIONS.md          →  Added "Data Architecture" section
                          (partially in STACK.md)     with entity diagrams
Technology Architecture→  STACK.md                 →  Existing content + deployment diagram
                          INTEGRATIONS.md             under "Technology Architecture"
Cross-Cutting          →  CONVENTIONS.md           →  Unchanged (already cross-cutting)
                          TESTING.md                  Unchanged
                          CONCERNS.md                 Unchanged (risk/debt register)
```

### 3.5.7 Diagram Types Per Document

| Document | Diagram Type | Mermaid Syntax | What It Shows |
|----------|-------------|----------------|---------------|
| ARCHITECTURE.md | **Flowchart (LR)** | `graph LR` | Layer dependencies, component relationships |
| ARCHITECTURE.md | **Sequence diagram** | `sequenceDiagram` | Primary data flow / request lifecycle |
| STRUCTURE.md | **Flowchart (TD)** | `graph TD` | Directory tree as visual hierarchy |
| INTEGRATIONS.md | **Flowchart** | `graph LR` | External service connections |
| INTEGRATIONS.md | **ER diagram** | `erDiagram` | Data entity relationships (if DB detected) |
| STACK.md | **Flowchart** | `graph TD` | Deployment/infrastructure topology |
| CONCERNS.md | **Quadrant chart** | `quadrantChart` | Risk impact vs probability |
| TESTING.md | *(none — text is sufficient)* | — | — |
| CONVENTIONS.md | *(none — text is sufficient)* | — | — |

**Minimum: 5 diagrams across 4 files. Maximum: 8 diagrams across 5 files.**

### 3.5.8 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Mapper agent Mermaid generation | ~0ms | Text generation, no computation |
| Template changes | 0ms | Static markdown files |
| Consumer impact | 0ms | Consumers ignore Mermaid blocks (just markdown) |
| **Total** | **+0ms** | Pure content change, no runtime cost |

### 3.5.9 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| GitHub | Mermaid renders natively in markdown preview since 2022 |
| VS Code | Mermaid renders with built-in markdown preview or Mermaid extension |
| GitLab | Native Mermaid rendering in markdown |
| Obsidian | Native Mermaid rendering |
| Raw terminal | Mermaid blocks display as text (graceful degradation — still readable) |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**Enhanced Codebase Mapping with Visual Diagrams**

When you run `/pan:map-codebase`, the system now produces the same 7 documents but with **embedded Mermaid architecture diagrams** and **TOGAF-aligned sections**.

**Example: ARCHITECTURE.md now includes:**

````markdown
## Application Architecture

### Component Relationships

```mermaid
graph LR
    CLI[CLI Entry] --> Dispatcher[pan-tools.cjs]
    Dispatcher --> State[state.cjs]
    Dispatcher --> Phase[phase.cjs]
    Dispatcher --> Config[config.cjs]
    Phase --> Core[core.cjs]
    State --> Core
    Core --> Utils[utils.cjs]
    Core --> Constants[constants.cjs]
```

### Request Lifecycle

```mermaid
sequenceDiagram
    participant U as User
    participant C as Command .md
    participant A as Agent
    participant P as pan-tools.cjs
    participant L as lib/*.cjs
    U->>C: /pan:plan-phase 1
    C->>A: spawn pan-planner
    A->>P: node pan-tools.cjs find-phase 1
    P->>L: phase.cjs → cmdFindPhase()
    L-->>P: {directory, name, status}
    P-->>A: JSON result
    A->>A: Create plan.md
    A-->>C: Plan complete
    C-->>U: Phase 1 planned
```
````

**These diagrams render as visual graphics** in GitHub, VS Code, and any Mermaid-aware markdown viewer. In plain terminals, they display as readable text.

**TOGAF alignment** means each document now has clear sections mapping to architecture domains:
- **Business Architecture** (what the system does) — in ARCHITECTURE.md
- **Application Architecture** (how components interact) — in ARCHITECTURE.md + STRUCTURE.md
- **Data Architecture** (entities, storage, flows) — in INTEGRATIONS.md
- **Technology Architecture** (stack, deployment, infrastructure) — in STACK.md

**What does NOT change:**
- Same 7 filenames (backward compatible)
- Same 4 mapper agents
- Same workflow (orchestrator spawns agents, collects confirmations)
- Same consumers work unchanged

### 4.2 Reference-Level Explanation

#### 4.2.1 Files Modified

| File | Change Type | Description |
|------|------------|-------------|
| `pan-wizard-core/templates/codebase/architecture.md` | Major update | Add TOGAF sections, Mermaid flowchart + sequence diagram examples |
| `pan-wizard-core/templates/codebase/structure.md` | Minor update | Add Mermaid directory tree diagram example |
| `pan-wizard-core/templates/codebase/stack.md` | Minor update | Add "Technology Architecture" TOGAF header, deployment diagram example |
| `pan-wizard-core/templates/codebase/integrations.md` | Moderate update | Add "Data Architecture" section, ER diagram example |
| `pan-wizard-core/templates/codebase/concerns.md` | Minor update | Add risk quadrant chart example |
| `pan-wizard-core/templates/codebase/conventions.md` | No change | Already cross-cutting, diagrams not useful here |
| `pan-wizard-core/templates/codebase/testing.md` | No change | Test patterns are better as text |
| `.claude/agents/pan-document_code.md` | Moderate update | Add Mermaid generation instructions to agent prompts |
| `pan-wizard-core/workflows/map-codebase.md` | Minor update | Update agent prompts to mention diagram generation |

#### 4.2.2 Mermaid Syntax Standards

All diagrams must follow these conventions for consistency:

```
1. Use descriptive node IDs: `Auth[Authentication]` not `A[Authentication]`
2. Use LR (left-right) for dependency/flow diagrams
3. Use TD (top-down) for hierarchy/tree diagrams
4. Use sequenceDiagram for request lifecycles
5. Use erDiagram for data relationships (only when DB/ORM detected)
6. Use quadrantChart for risk assessment (concerns only)
7. Maximum 15 nodes per diagram (beyond that, split into multiple)
8. Always include a "### [Diagram Title]" heading before each ```mermaid block
9. Wrap diagram in standard markdown code fence: ```mermaid ... ```
```

#### 4.2.3 TOGAF Section Structure

Each document gets a TOGAF domain header where appropriate:

```markdown
## Business Architecture
<!-- What the system does, capabilities, user-facing processes -->

## Application Architecture
<!-- How components interact, layers, abstractions -->

## Data Architecture
<!-- Entities, storage, data flows, schemas -->

## Technology Architecture
<!-- Stack, deployment, infrastructure, runtime -->
```

Not every document needs all 4 sections. The mapping in 3.5.6 shows which domain goes where.

### 4.3 Design Decisions

| Decision | Rationale | What We Did NOT Do |
|----------|-----------|-------------------|
| Mermaid (not PlantUML) | Renders natively in GitHub/VS Code, no Java dep | Did not use PlantUML (requires Java runtime) |
| Mermaid (not D2) | Wider rendering support, AI models understand it better | Did not use D2 (fewer renderers) |
| Embedded in .md (not separate .mmd files) | Single-file consumption, no extra tooling | Did not create separate diagram files |
| TOGAF sections (not full TOGAF ADM) | Lightweight taxonomy, not heavy process | Did not implement ArchiMate notation |
| Same 7 filenames | Backward compatibility with consumers | Did not rename files to TOGAF domains |
| No image generation | Zero dependency constraint | Did not add mmdc/d2 as dependencies |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Diagram format | Mermaid text in markdown | PNG/SVG image files | Adds runtime dep (mmdc) | Diagrams are text-only in terminals |
| TOGAF mapping | Sections within existing files | New file per TOGAF domain | Breaks consumer compatibility | TOGAF purists may want separate files |
| Diagram count | 5-8 per mapping | 1 per document (minimal) | Misses cross-document relationships | More content for agents to generate |
| Template approach | Updated templates + agent prompts | New "diagram-only" agent | Over-engineering for a content change | All mapping agents need updating |

### 4.5 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Add Mermaid diagram examples to 4 templates + update agent prompts | Agents generate diagrams automatically | **S** |
| **v1 (Complete)** | TOGAF section headers + diagram standards + all 7 templates reviewed | Full TOGAF-aligned output with visual diagrams | **M** |
| **v2 (Enhanced)** | Optional `--render` flag that runs mmdc to produce PNG/SVG alongside markdown | Image files for presentations/docs | **L** (adds optional dep) |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this? | Same `/pan:map-codebase` command — output is automatically richer |
| What's the learning curve? | Zero — diagrams appear in existing files |
| Does it require changing existing workflows? | No — drop-in enhancement |
| What's the "aha moment"? | Opening ARCHITECTURE.md in GitHub/VS Code and seeing rendered diagrams |

---

## Phase 5: Architecture Decision Record

```markdown
# ADR-0008: Enhance map-codebase with Mermaid Diagrams and TOGAF Structure

## Status
Proposed

## Context
/pan:map-codebase produces 7 text-only markdown files describing a codebase.
Developers and AI agents struggle to quickly understand system structure from
prose alone. Visual diagrams communicate architecture 10x faster than text.
The current 7-file structure was designed pragmatically without mapping to any
standard architecture framework.

## Decision
1. Add Mermaid diagram blocks to 5 of 7 codebase document templates
2. Restructure document sections to align with TOGAF architecture domains
3. Keep all 7 existing filenames unchanged (backward compatibility)
4. Update mapper agent prompts to generate diagrams as part of exploration

Mermaid was chosen over PlantUML (requires Java), D2 (fewer renderers), and
PNG generation (would add runtime dependency). Mermaid renders natively in
GitHub, VS Code, GitLab, and Obsidian.

## Consequences

### Positive
- Visual architecture diagrams generated automatically by mapper agents
- TOGAF alignment ensures no architecture layer is accidentally omitted
- Renders in GitHub markdown preview — zero additional tooling
- AI agents can parse Mermaid syntax for better planning
- Zero new runtime dependencies

### Negative
- Mapper agents use slightly more tokens generating diagrams (~10-15% more per agent)
- Diagrams show as text in plain terminals (graceful degradation)
- Template changes require updating installed instances via /pan:update

### Neutral
- Existing consumers (plan-phase, exec-phase) continue working unchanged
- Same 4 mapper agents, same workflow, same filenames

## Options Considered
1. PNG/SVG generation with mmdc CLI — rejected (adds runtime dependency)
2. Separate .mmd diagram files — rejected (consumers load .md files by name)
3. PlantUML — rejected (requires Java runtime)
4. Mermaid in existing markdown — chosen (zero deps, native rendering)
5. Full TOGAF ADM process — rejected (too heavyweight for codebase mapping)
6. TOGAF domain sections in existing files — chosen (lightweight, backward-compatible)

## Links
- Spec: docs/specs/map_codebase_mermaid_togaf_featureai.md
- Current workflow: pan-wizard-core/workflows/map-codebase.md
- Current agent: .claude/agents/pan-document_code.md
- Templates: pan-wizard-core/templates/codebase/*.md
```

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection | Recovery | User Sees |
|-------------|----------|-----------|----------|-----------|
| Agent generates invalid Mermaid syntax | AI generation error | GitHub/VS Code shows syntax error in preview | User manually fixes or re-runs mapping | Raw Mermaid text with error annotation |
| Agent skips diagram generation | AI instruction-following | Document has no ```mermaid blocks | Template examples guide the agent; re-run with explicit prompt | Text-only document (graceful degradation) |
| Mermaid renderer not available | Environment | Terminal-only viewing | Text blocks are still readable | ```mermaid blocks display as text |
| Template file corrupted during install | Installer error | Agent falls back to inline templates | Agent has templates in its own prompt | Slightly different format |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| Verify diagrams present | `grep -c 'mermaid' .planning/codebase/*.md` | After mapping |
| Validate Mermaid syntax | Paste into mermaid.live | Manual verification |
| Count diagrams per doc | `grep -c '```mermaid' .planning/codebase/ARCHITECTURE.md` | After mapping |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| Codebase source files | Read by mapper agents | User-controlled |
| `.planning/codebase/*.md` output | Written by mapper agents | System-generated |
| Mermaid diagram content | Generated from codebase analysis | System-generated from user code |

### 7.2 Mermaid Injection Risk

**Threat:** Could Mermaid syntax in generated documents execute code?

**Analysis:** Mermaid is a **declarative diagramming language**. It does not execute code. GitHub's Mermaid renderer is sandboxed. VS Code's preview is sandboxed. There is no injection vector from Mermaid syntax.

**However:** Mermaid `click` callbacks exist in the spec but are disabled by default in all major renderers. Our templates should **never** include `click` directives.

### 7.3 Secret Exposure in Diagrams

**Existing mitigation:** The mapper agent already has a `<forbidden_files>` block preventing reading .env, credentials, keys. The workflow already runs a secret scan (`grep -E` for API key patterns) before committing.

**New consideration:** Diagrams could accidentally include:
- Database connection strings in ER diagram labels
- API endpoint URLs with embedded tokens

**Mitigation:** Add explicit instruction to agent prompt: "Never include actual credentials, connection strings, or API keys in Mermaid diagram labels. Use generic labels like 'PostgreSQL DB' not 'postgres://user:pass@host/db'."

### 7.4 Output Sanitization

- [x] No absolute paths in diagrams (use relative paths or component names)
- [x] No environment variable values in diagram labels
- [x] No API keys or tokens in diagram labels
- [x] Existing secret scan still runs before commit

---

## Phase 8: Implementation Roadmap

### 8.1 Implementation Tasks

```
### Task 1: Update ARCHITECTURE.md template
Files: pan-wizard-core/templates/codebase/architecture.md
Changes:
  - Add TOGAF "Business Architecture" section (capabilities, user processes)
  - Restructure existing content under "Application Architecture"
  - Add Mermaid flowchart example (component relationships)
  - Add Mermaid sequence diagram example (request lifecycle)
  - Update good_examples section with Mermaid
Estimate: S
Priority: P0

### Task 2: Update STRUCTURE.md template
Files: pan-wizard-core/templates/codebase/structure.md (in agent)
Changes:
  - Add Mermaid graph TD example (directory hierarchy diagram)
  - Keep existing directory listing format as complement
Estimate: XS
Priority: P0

### Task 3: Update STACK.md template
Files: pan-wizard-core/templates/codebase/stack.md
Changes:
  - Add "Technology Architecture" TOGAF header
  - Add Mermaid flowchart example (deployment/infrastructure topology)
Estimate: XS
Priority: P0

### Task 4: Update INTEGRATIONS.md template
Files: pan-wizard-core/templates/codebase/integrations.md
Changes:
  - Add "Data Architecture" TOGAF section
  - Add Mermaid ER diagram example (entity relationships, only when DB detected)
  - Add Mermaid flowchart example (external service connections)
Estimate: S
Priority: P0

### Task 5: Update CONCERNS.md template
Files: pan-wizard-core/templates/codebase/concerns.md
Changes:
  - Add Mermaid quadrant chart example (risk impact vs probability)
Estimate: XS
Priority: P1

### Task 6: Update pan-document_code agent
Files: .claude/agents/pan-document_code.md (+ all runtime copies)
Changes:
  - Add <diagram_guidelines> section with Mermaid syntax standards
  - Add "MUST generate at least 1 Mermaid diagram per document" rule
  - Add security rule: "Never include credentials in diagram labels"
  - Update inline templates to match updated template files
  - Add Mermaid examples for each focus area
Estimate: M
Priority: P0

### Task 7: Update map-codebase workflow agent prompts
Files: pan-wizard-core/workflows/map-codebase.md
Changes:
  - Update agent spawn prompts to mention diagram generation
  - Add note about TOGAF-aligned sections
Estimate: XS
Priority: P1

### Task 8: Update installer to copy updated templates
Files: bin/install.js (if templates are copied during install)
Verify: Updated templates ship with new install/update
Estimate: XS
Priority: P1

### Task 9: Tests — template validation
Files: tests/map-codebase.test.cjs (new) or add to existing test file
Tests:
  - Each template file contains at least one ```mermaid code fence
  - Each template file contains TOGAF domain headers where expected
  - Agent definition contains diagram_guidelines section
  - No ```mermaid block contains 'click' directive
Estimate: S
Priority: P0

### Task 10: Documentation
Files: docs/USER-GUIDE.md, docs/ARCHITECTURE.md, CHANGELOG.md
Changes:
  - Note Mermaid diagram support in map-codebase section
  - Mention TOGAF alignment in architecture docs
  - CHANGELOG entry
Estimate: XS
Priority: P2
```

### 8.2 Dependency Graph

```
Task 1 (ARCHITECTURE template) ─┐
Task 2 (STRUCTURE template) ────┤
Task 3 (STACK template) ────────┤ (all parallel, independent)
Task 4 (INTEGRATIONS template) ─┤
Task 5 (CONCERNS template) ─────┘
          │
          ▼
Task 6 (Update agent) ── depends on templates being finalized
          │
          ▼
Task 7 (Update workflow) ── depends on agent update
          │
          ▼
Task 8 (Installer check) ─┐
Task 9 (Tests) ────────────┤ (parallel)
Task 10 (Docs) ────────────┘
```

### 8.3 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Agents generate broken Mermaid | Medium | Low | Good examples in templates; Mermaid is forgiving |
| Agents skip diagrams entirely | Low | Medium | "MUST generate" rule in agent prompt + test assertion |
| Existing consumers confused by new sections | Very Low | Low | Consumers load by filename, not section headers |
| Templates too long for agent context | Low | Medium | Keep examples concise, max 15 nodes per diagram |
| Users on terminals can't see diagrams | Medium | Low | Diagrams display as readable text in terminals |

### 8.4 Cognitive Complexity Budget

No new functions — only template and prompt content changes. All modifications are to markdown files, not code.

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Count | What It Catches |
|-------|---------|-------|-----------------|
| **Unit** | Template content validation | 8 | Missing diagrams, missing TOGAF headers, forbidden click directives |
| **Integration** | `runPanTools('init map-codebase', tmpDir)` | 2 | init context still returns correct shape |
| **E2E** | Full map-codebase run on PAN Wizard's own codebase | 1 | Diagrams actually generated by agents |

### 9.2 Template Validation Tests

```javascript
// Test: architecture.md template contains Mermaid examples
test('architecture template has Mermaid flowchart example', () => {
  const content = fs.readFileSync('pan-wizard-core/templates/codebase/architecture.md', 'utf8');
  assert.ok(content.includes('```mermaid'), 'Should contain Mermaid code fence');
  assert.ok(content.includes('graph'), 'Should contain flowchart or sequence diagram');
});

// Test: no template contains click directive (security)
test('no template contains Mermaid click directive', () => {
  const templates = fs.readdirSync('pan-wizard-core/templates/codebase/');
  for (const file of templates) {
    const content = fs.readFileSync(`pan-wizard-core/templates/codebase/${file}`, 'utf8');
    assert.ok(!content.includes('click '), `${file} should not contain Mermaid click directive`);
  }
});

// Test: architecture template has TOGAF sections
test('architecture template has TOGAF domain sections', () => {
  const content = fs.readFileSync('pan-wizard-core/templates/codebase/architecture.md', 'utf8');
  assert.ok(content.includes('Business Architecture') || content.includes('Application Architecture'));
});

// Test: agent definition has diagram guidelines
test('mapper agent has diagram guidelines', () => {
  const content = fs.readFileSync('.claude/agents/pan-document_code.md', 'utf8');
  assert.ok(content.includes('mermaid') || content.includes('Mermaid') || content.includes('diagram'));
});
```

### 9.3 Regression Verification

- [ ] Full suite: `npm test` — all 875 existing tests pass
- [ ] `runPanTools('init map-codebase', tmpDir)` returns same JSON shape
- [ ] No existing test expectations changed

### 9.4 Performance Validation

- [ ] `npm test` runtime unchanged (~8s)
- [ ] Template files < 500 lines each (reasonable agent context consumption)
- [ ] Total template size increase < 50% (from Mermaid examples)

---

## Phase 10: Output Artifacts

### 10.1 Documents Created

- **Spec:** `docs/specs/map_codebase_mermaid_togaf_featureai.md` (this file)
- **ADR:** `docs/decisions/ADR-0008-map-codebase-mermaid-togaf.md` (to be created)

### 10.2 Report Summary

```
## /pan:focus-design --internal Complete — Enhance map-codebase with Mermaid + TOGAF

### Problem & Evidence
Codebase maps are text-only with ad-hoc structure — no visual diagrams, no standard
architecture framework. User explicitly requested this enhancement.

### Strategic Assessment
- Blue Ocean: ELIMINATE ASCII diagrams, REDUCE prose, RAISE visual quality, CREATE TOGAF alignment
- Wardley: Both Mermaid (commodity) and TOGAF (product) are mature — adoption, not invention
- Moat Score: 27/30 — strongest in Context Engineering (5), Cross-Platform (5), Zero Deps (5)
- Cognitive Load: 0 (neutral — same command, richer output)
- Recommendation: Build — pure quality improvement, zero new dependencies

### Design Summary
- Feature Type: Core Enhancement (templates + agent prompts)
- Modules Affected: 0 code modules; 7 templates, 1 agent, 1 workflow
- Output Schema Changes: None (JSON from init unchanged)
- Breaking Changes: None (same 7 filenames)
- Layer Violations: None
- Diagram Types: flowchart (LR/TD), sequenceDiagram, erDiagram, quadrantChart
- TOGAF Domains: Business, Application, Data, Technology mapped to existing files

### Feature Ladder
- v0 (MVP): Mermaid examples in 4 templates + agent prompt update — S effort
- v1 (Complete): All 7 templates + TOGAF sections + tests + docs — M effort
- v2 (Enhanced): Optional --render flag for PNG/SVG generation — L effort

### Implementation
- Tasks: 10 tasks (6 P0, 2 P1, 2 P2)
- Complexity: S-M (content changes, no new code)
- Files to create: 1 (test file or additions to existing)
- Files to modify: 9 (7 templates + 1 agent + 1 workflow)
- Tests planned: 11 (8 unit, 2 integration, 1 e2e)

### Security
- Mermaid is declarative — no code execution
- Forbidden: `click` directives in templates
- Forbidden: credentials/tokens in diagram labels
- Existing secret scan catches leaked keys

### Adoption
- Discovery: Automatic — same /pan:map-codebase command
- Learning curve: Zero — diagrams just appear
- Aha moment: Opening ARCHITECTURE.md in GitHub and seeing rendered diagrams

### Next Step
Execute implementation roadmap:
  Tasks 1-5 (templates) — parallel, S effort total
  Task 6 (agent update) — M effort, after templates
  Tasks 7-10 (workflow, installer, tests, docs) — S effort total
```
