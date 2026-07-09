# Feature Spec: Contributors List & Attribution Index

> Mode: `--internal` (Phases 2, 2.5 skipped — no competitive analysis needed for attribution docs)

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard has no CONTRIBUTORS.md, no AUTHORS file, no attribution index, and no record of where design ideas originated. The project credits "PAN Wizard Contributors" in LICENSE and package.json but never names anyone. Eleven ADRs, eleven specs, and the entire focus-design pipeline reference methodologies (Blue Ocean, Wardley, STRIDE, TOGAF) and competing tools (Aider, Cursor, Cline, Windsurf, Continue.dev, Copilot Workspace) without a centralized index of influences. This matters NOW because: (a) the project is public on npm and GitHub, (b) proper attribution is an open-source norm, (c) tracing design lineage prevents reinventing wheels and helps future contributors understand WHY decisions were made.

Cost of NOT doing this: contributors go unrecognized, methodology provenance becomes tribal knowledge locked in git history, and new contributors can't see who or what shaped the project.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Personal pain (user-stated) | This conversation | User explicitly asked to "update the contributors list" and "create a proper index of where things came from" |
| Open-source norm | npm, GitHub community | Standard practice for any OSS project with multiple contributors/AI co-authors |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Create CONTRIBUTORS.md with all human + AI + bot contributors | Automating contributor detection via CI (future enhancement) |
| Create ATTRIBUTION.md indexing all methodology/tool/standard influences | Legal audit of license compatibility (not a code feature) |
| Update package.json with contributors array | Changing LICENSE copyright holder (already correct) |
| Cross-reference ADRs and specs to their inspiration sources | Rewriting ADRs to add citations retroactively |

### 0.4 Success Criteria

```
SC-1: CONTRIBUTORS.md lists every git author, co-author, and bot contributor with roles
SC-2: ATTRIBUTION.md indexes every methodology, standard, and tool that influenced design decisions
SC-3: ATTRIBUTION.md cross-references each influence to the specific ADR/spec/file where it's used
SC-4: package.json contains a contributors array with all human contributors
SC-5: No existing file modified in a breaking way
```

### 0.5 User Stories

```
As a new contributor, I want to see who built this project and what inspired it,
so that I understand the project's lineage, instead of digging through 32 git commits.

As a project maintainer, I want a single attribution index,
so that I can verify all design influences are properly credited, instead of searching across 11 ADRs and 11 specs.

As an open-source user evaluating PAN Wizard, I want to see transparent attribution,
so that I can trust the project follows community norms, instead of wondering about provenance.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| README.md docs table | None | README links to docs but has no contributor/attribution section |
| CONTRIBUTING.md | None | Describes how to contribute, not who has contributed |
| CHANGELOG.md | Partial | Lists what changed but not who/what inspired it |

No full overlap. Proceed.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 0 | 0 | 0 |
| New concepts introduced | 0 | 0 | 0 |
| Score | — | — | simplifies (-1) — reduces discovery friction |

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Git author tracking | Exists | git log | Source of contributor data |
| Co-Author-By trailers | Exists | Every commit | AI attribution pattern |
| package.json author field | Exists | package.json | Says "PAN Wizard Contributors" (collective) |
| LICENSE copyright | Exists | LICENSE | Says "PAN Wizard Contributors" |
| ADR documents | 11 exist | docs/decisions/ | Design decision provenance |
| Feature specs | 11 exist | docs/specs/ | Competitive analysis & methodology references |
| COMPARISON.md | Exists | docs/ | Tool comparison matrix |
| CHANGELOG.md | Exists | root | Change history per version |
| CONTRIBUTING.md | Exists | root | Contribution guide (no names) |
| SECURITY.md | Exists | root | Promises to credit reporters |
| CODE_OF_CONDUCT.md | Exists | root | Governance |

### 1.2 Git History Analysis

**Contributors by commit count:**

| Contributor | Type | Commits | Role |
|-------------|------|---------|------|
| oharms | Human | 28 | Creator, sole human author |
| Claude Opus 4.6 | AI Co-Author | ~28 | AI pair programmer (Co-Authored-By trailer) |
| dependabot[bot] | Bot | 4 | Automated dependency updates |
| GitHub (noreply@github.com) | System | — | Merge commit committer |

### 1.3 Methodology & Influence Inventory

**Strategic Methodologies (6):**
| Methodology | Where Used | Source/Origin |
|------------|-----------|---------------|
| Blue Ocean Strategy | focus-design Phase 3.1 | W. Chan Kim & Renée Mauborgne (2004) |
| Wardley Mapping | focus-design Phase 3.2 | Simon Wardley (2005) |
| STRIDE Threat Modeling | focus-design Phase 7 | Microsoft (1999), Loren Kohnfelder & Praerit Garg |
| TOGAF ADM | ADR-0008, map-codebase templates | The Open Group |
| Spec-Driven Development | focus-design pipeline | Industry practice |
| Architecture Decision Records | 11 ADRs | Michael Nygard (2011) |

**Industry Standards (12):**
| Standard | Where Used | Governing Body |
|----------|-----------|----------------|
| OWASP Top 10 (2025) | standards command catalog | OWASP Foundation |
| OWASP ASVS Level 1 | standards command catalog | OWASP Foundation |
| OWASP LLM Top 10 | standards command catalog | OWASP Foundation |
| OWASP Agentic Top 10 | standards command catalog | OWASP Foundation |
| WCAG 2.2 | standards command catalog | W3C/WAI |
| NIST SSDF | standards command catalog | NIST (US) |
| ISO 25010 | standards command catalog | ISO/IEC |
| STRIDE | standards command catalog | Microsoft |
| CWE Top 25 | standards command catalog | MITRE |
| SOC 2 Dev Controls | standards command catalog | AICPA |
| TOGAF ADM | standards command catalog, ADR-0008 | The Open Group |
| Conventional Commits | standards command catalog, commit system | conventionalcommits.org |

**Competing Tools Analyzed (8):**
| Tool | Where Referenced | What We Learned |
|------|-----------------|-----------------|
| Aider | COMPARISON.md, focus-design Phase 2 | Auto-commit per edit, repo map |
| Cursor | COMPARISON.md, specs | Embeddings indexing, .cursorrules, multi-agent |
| Continue.dev | COMPARISON.md, focus-design Phase 2 | IDE extension, context providers |
| Cline | COMPARISON.md, specs | Separate plan/act modes → inspired PAN tiers |
| Windsurf | COMPARISON.md, specs | RAG + AST indexing, Wave multi-agent |
| GitHub Copilot Workspace | COMPARISON.md, focus-design Phase 2 | Task decomposition, plan-execute-verify |
| Devin | COMPARISON.md | Cloud IDE, sandbox execution |
| Taskmaster AI | focus-commands spec | Task breakdown, prioritization → same problem space as focus-scan |

**Scanning/Quality Tools Referenced (5):**
| Tool | Where Referenced | Relationship |
|------|-----------------|-------------|
| SonarQube | standards spec | OWASP/CWE/PCI DSS rule support |
| Semgrep | standards spec | 4000+ rules by standard |
| Snyk | standards spec | Compliance dashboards |
| CodeQL | standards spec | CWE/OWASP categories |
| esbuild | build system | Only devDependency (hook bundler) |

**Development Standards (4):**
| Standard | Where Used | URL |
|----------|-----------|-----|
| Semantic Versioning 2.0.0 | CHANGELOG, versioning | https://semver.org/spec/v2.0.0.html |
| Keep a Changelog 1.0.0 | CHANGELOG format | https://keepachangelog.com/en/1.0.0/ |
| Contributor Covenant 2.0 | CODE_OF_CONDUCT.md | https://contributor-covenant.org/version/2/0/ |
| XDG Base Directory | OpenCode install paths | freedesktop.org specification |

**Cognitive Science (1):**
| Concept | Where Used | Origin |
|---------|-----------|--------|
| Miller's Law | ADR-0006 (focus-commands naming) | George A. Miller (1956) |

**AI Security Research (2):**
| Finding | Where Referenced | Sources |
|---------|-----------------|---------|
| 24.7-45% of AI code has security flaws | standards spec | Multiple 2025-2026 studies |
| "Vibe coding" security consensus | standards spec | Black Duck, Palo Alto Networks, Dark Reading |

**Community Initiatives (2):**
| Initiative | Where Referenced | What |
|-----------|-----------------|------|
| Secure Code Warrior AI Security Rules | standards spec | Cross-tool AI security rules (June 2025) |
| OpenSSF Security Guide for AI Assistants | standards spec | AI code instruction security (Sep 2025) |

### 1.4 Dependency & Integration Map

```
[CONTRIBUTORS.md] — new file, no code dependencies
    ├── data source: git log (read-only)
    ├── data source: package.json author field
    └── linked from: README.md

[ATTRIBUTION.md] — new file, no code dependencies
    ├── data source: docs/decisions/ADR-0001..0011
    ├── data source: docs/specs/*_featureai.md
    ├── data source: docs/COMPARISON.md
    ├── data source: commands/pan/focus-design.md
    └── linked from: README.md
```

No circular dependencies. No code changes. Documentation only.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Vague "PAN Wizard Contributors" without names |
| **REDUCE** | What should be reduced? | Time to discover who built what and why |
| **RAISE** | What should be raised? | Transparency, trust, attribution quality |
| **CREATE** | What should we create? | CONTRIBUTORS.md + ATTRIBUTION.md cross-referenced index |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                                               ▲
                                               │
                                    CONTRIBUTORS.md (commodity)
                                    ATTRIBUTION.md (custom-built → product)
```

CONTRIBUTORS.md is commodity — every project has one. ATTRIBUTION.md as an influence index is more novel — most projects don't trace design lineage this explicitly. Position as a differentiator.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| Context Engineering | Helps contributors understand design context | 2 |
| Cross-Platform | N/A (docs, not code) | 0 |
| Developer Experience | Reduces onboarding friction for new contributors | 3 |
| Zero Dependencies | N/A (no code) | 0 |
| State Persistence | N/A | 0 |
| Verification Quality | N/A | 0 |

### 3.4 Strategic Recommendation

**Build this.** It's zero-risk (documentation only), addresses a direct user request, fills a gap every open-source project should cover, and the attribution index is genuinely useful — tracing 6 methodologies, 12 standards, 8 competitor analyses, and 11 ADRs to their origins creates a knowledge map that future contributors will value. The unique angle is the ATTRIBUTION.md influence index, which goes beyond a typical "credits" section to show the intellectual lineage of every design decision.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

| Type | Description |
|------|-------------|
| **Documentation** | New markdown files + minor package.json update |

No dispatcher changes. No module changes. No agent changes. No hook changes.

### 3.5.2 Layer Violation Check

- [x] No code layers involved — documentation only
- [x] No imports, no module dependencies
- [x] No output() calls

### 3.5.3 Output Contract Design

N/A — no CLI output. Files are static markdown.

### 3.5.4 State Transition Modeling

N/A — no state mutations.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | No |
| Changes file formats? | No |
| Changes directory structure? | No |
| Changes installer output? | No |

### 3.5.6 Composability Analysis

N/A — documentation files.

### 3.5.7 Performance Budget

N/A — no runtime cost.

### 3.5.8 Cross-Platform Considerations

Markdown renders identically on all platforms. No path issues.

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

PAN Wizard now ships with two new files:

**CONTRIBUTORS.md** — Lists every person, AI, and bot that contributed to the project, with their role and how they contributed. Check here to see who built what.

**ATTRIBUTION.md** — An influence index showing where every design idea came from. If you wonder "why does PAN use Blue Ocean Strategy in focus-design?" or "which competing tools were analyzed?", this file has the answer with cross-references to the specific ADR or spec.

Both files are linked from README.md.

### 4.2 Reference-Level Explanation

#### CONTRIBUTORS.md Structure
```markdown
# Contributors

## Core Team
- **oharms** — Creator, architect, sole human author (28 commits)

## AI Contributors
- **Claude Opus 4.6** (Anthropic) — AI pair programmer, co-authored all human commits

## Automated Contributors
- **dependabot[bot]** — Dependency updates (4 commits)

## How to Get Listed
See CONTRIBUTING.md for how to contribute.
```

#### ATTRIBUTION.md Structure
```markdown
# Attribution & Influence Index

## Strategic Methodologies
| Methodology | Origin | Used In | Purpose |
|...table...|

## Industry Standards
| Standard | Governing Body | Used In | Purpose |
|...table...|

## Competing Tools Analyzed
| Tool | What We Learned | Referenced In |
|...table...|

## Development Standards
| Standard | URL | Used In |
|...table...|

## Research & Community
| Source | Finding | Referenced In |
|...table...|

## Cognitive Science
| Concept | Origin | Used In |
|...table...|
```

### 4.3 Design Decisions

| Decision | Rationale |
|----------|-----------|
| Separate CONTRIBUTORS.md and ATTRIBUTION.md | Contributors = people, Attribution = ideas. Different audiences. |
| Cross-reference to ADRs/specs by file path | Enables click-through navigation on GitHub |
| Include AI as contributor | Transparent about AI-assisted development — community norm emerging |
| Include dependabot | Even automated contributions deserve attribution |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Separate files | CONTRIBUTORS.md + ATTRIBUTION.md | Single CREDITS.md | Conflates people and ideas | Two files to maintain |
| Static files | Hand-maintained markdown | Auto-generated from git | Over-engineering for 1 human contributor | Manual updates needed |
| package.json update | Add contributors array | Leave as-is | npm best practice to list contributors | Minor |

### 4.5 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | CONTRIBUTORS.md + ATTRIBUTION.md + package.json update | Full attribution | XS |
| **v1 (Complete)** | Add links from README.md | Discoverable | XS |
| **v2 (Enhanced)** | CLI command `pan-tools contributors` to output JSON | Machine-readable | S (future) |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | README docs table, GitHub repo root |
| What's the learning curve? | Zero — it's markdown files |
| Does it require changing existing workflows? | No |
| What's the "aha moment"? | Seeing the full lineage of design decisions in one place |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0012-contributors-attribution-index.md`

---

## Phase 6: Error Handling & Diagnostics Design

N/A — documentation files have no error conditions. If a file is missing, GitHub shows 404. No CLI involved.

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface Inventory

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| CONTRIBUTORS.md | Read (GitHub, local) | System-generated (from git data) |
| ATTRIBUTION.md | Read (GitHub, local) | System-generated (from ADR/spec data) |

### 7.2 Risks

| Risk | Mitigation |
|------|-----------|
| Email exposure in CONTRIBUTORS.md | Use noreply GitHub emails only |
| Incorrect attribution | Cross-verify against git log and ADR content |
| Stale data | Document last-updated date, note manual maintenance |

### 7.3 Output Sanitization

- [x] No absolute filesystem paths
- [x] No environment variable values
- [x] No personal email addresses (use noreply@)
- [x] No API keys or tokens

---

## Phase 8: Implementation Roadmap

### 8.1 Implementation Tasks

```
### Task 1: Create CONTRIBUTORS.md
Files: CONTRIBUTORS.md (new)
Estimate: XS
Priority: P0

### Task 2: Create ATTRIBUTION.md
Files: ATTRIBUTION.md (new)
Estimate: S
Priority: P0

### Task 3: Update package.json contributors
Files: package.json
Estimate: XS
Priority: P1

### Task 4: Link from README.md
Files: README.md
Estimate: XS
Priority: P1
```

### 8.2 Dependency Graph
```
Task 1 ─┐
         ├──> Task 4 (link both from README)
Task 2 ─┘
Task 3 (independent)
```

### 8.3 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Missing an influence source | Low | Low | Comprehensive scan already done in Phase 1 |
| Attribution error | Low | Medium | Cross-reference every entry to source file |

---

## Phase 9: Test Plan

No automated tests needed — documentation files. Verification is manual:

- [ ] CONTRIBUTORS.md matches git log data exactly
- [ ] ATTRIBUTION.md cross-references resolve to real files
- [ ] package.json is valid JSON after edit
- [ ] README.md links work

---

## Phase 10: Output Artifacts

### 10.1 Specification: This file (`docs/specs/contributors_attribution_index_featureai.md`)
### 10.2 ADR: `docs/decisions/ADR-0012-contributors-attribution-index.md`
### 10.3 Deliverables: CONTRIBUTORS.md, ATTRIBUTION.md, package.json update, README.md links
