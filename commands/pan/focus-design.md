---
name: focus-design
group: Focus
description: Strategic 10-phase feature investigation, design, and specification pipeline
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - WebSearch
  - WebFetch
  - mcp__context7__resolve-library-id
  - mcp__context7__get-library-docs
---

# /pan:focus-design — Strategic Feature Investigation, Design & Specification

Research, design, and specify a new feature with strategic analysis. $ARGUMENTS

**Goal:** Produce a best-of-breed feature specification that (a) validates the problem with evidence, (b) maps the competitive landscape, (c) identifies strategic differentiation, (d) designs an architecturally sound implementation, (e) plans for error handling, security, and testability from day one, (f) defines an incremental delivery ladder, and (g) outputs a ready-to-implement spec with ADR, test plan, and implementation tasks.

**Methodology:** Synthesizes Spec-Driven Development, Blue Ocean Strategy, Wardley Mapping, STRIDE-lite threat modeling, Architecture Decision Records, and structured workflow methodology into a single investigative pipeline.

---

## CRITICAL: Project Scope Boundary

This command investigates and designs features for the **host project** — NOT for PAN Wizard itself.

**NEVER investigate, design for, or reference these PAN infrastructure directories as part of the project:**
- `.claude/`, `.github/copilot-instructions.md`, `.opencode/`, `.gemini/`, `.codex/` — PAN runtime directories
- `.planning/` — PAN planning state (read for context, but don't treat as project source code)
- Any `pan-wizard-core/`, `pan-tools`, agent `.md`, or command `.md` files within those directories

**These directories are PAN's own tooling installed into the project.** They are not part of the project's source code, not part of its feature set, and not something to fix, improve, or design features for.

If you find yourself analyzing PAN command files, agent definitions, or `pan-tools` dispatcher code as "project code" — STOP. You have crossed the scope boundary. Refocus on the project's actual source code.

---

## Tool Selection Priority

Use the simplest sufficient tool for each research operation:
1. **Grep/Glob** — for finding patterns and files in the local codebase
2. **Read** — for examining specific files identified by Grep/Glob
3. **Bash** — for git history, test runs, build commands
4. **Agent (subagent)** — for broad exploration spanning many files (>5 reads)
5. **WebSearch/WebFetch** — for external research after local sources are exhausted
6. **mcp__context7__*** — for library documentation lookups

Prefer local evidence over web research. Start with the codebase, then broaden.

## Context Management Across Phases

This pipeline spans 10+ phases. Manage context to maintain quality:
- **KEEP:** Problem statement, success criteria, key architectural decisions, file paths being designed for
- **SUMMARIZE:** Research findings (compress to key takeaways after each research phase), competitive analysis results
- **DISCARD:** Raw web fetch content after extracting relevant data, superseded design drafts
- After Phase 3 (Strategic Analysis), summarize all findings from Phases 0-3 into a compact brief before entering design phases

**Progressive context loading — load only what the current phase needs:**

| Phase | What to Load | What NOT to Load Yet |
|-------|-------------|---------------------|
| 0. Problem | User's feature description, project README | Implementation details, test files |
| 1. Landscape | Web search results, competitor docs | Project internals |
| 2. Codebase | Relevant source files (Glob→Grep→Read) | Unrelated modules, full test suite |
| 3. Strategic | Findings from 0-2 (summarized) | Raw web content (discard after summary) |
| 4-6. Design | Architecture files, key modules, API surface | Test implementation details |
| 7-8. Spec | Design decisions from 4-6, test patterns | Research raw data (long gone) |
| 9. Output | Spec template, ADR template | Everything else (already in spec) |

**Why:** A 10-phase pipeline that loads everything in Phase 0 exhausts context by Phase 5. Each phase loads only its inputs, summarizes its outputs, and discards its raw data.

---

## Reasoning Protocol

For research and analysis phases (0, 1, 2, 3), follow observe-think-act:
1. **OBSERVE** — State what you found (code patterns, competitive data, user needs)
2. **THINK** — Reason about what this means for the design
3. **ACT** — Record the finding and move to the next investigation step
This keeps research structured and prevents rabbit holes.

## Meta-Prompting: Self-Generated Investigation Strategy

Before starting Phase 0, generate your own investigation plan based on the feature description:

```
Given: "{feature description}"
My investigation strategy:
1. What is the core problem? → {how I'll validate it}
2. Who are the competitors? → {what to search for}
3. What codebase areas are affected? → {what to Glob/Grep for}
4. What are the likely architectural constraints? → {what to read}
5. What risks should I watch for? → {security, performance, compatibility}
6. What is the ideal output format? → {spec structure for this feature type}
```

This self-generated strategy adapts to the specific feature rather than following a generic checklist. A "add caching layer" feature needs different investigation than "add OAuth provider" — the meta-prompt captures that difference upfront.

**After Phase 3, regenerate:** The strategy may need revision based on what you've learned. Update it before entering design phases.

---

## Complete All Phases For Selected Mode

When `/pan:focus-design` is invoked, execute all phases for the selected mode automatically. Do not stop to ask questions between phases or skip phases beyond what the mode specifies. Complete the full investigation and produce all output artifacts. The only permitted pause is the Strategy Gate in Phase 3 (if the user passed `--gate`).

**Modes (mutually exclusive — pick one, default `--full`):**

### `--full` — Complete 10-Phase Investigation (DEFAULT)
Run ALL phases. Nothing skipped. This is the gold standard.
```
Phases: 0 -> 0.8 -> 1 -> 1.5 -> 2 -> 2.5(if --audit) -> 3 -> 3.5 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Use case: New features, public-facing commands, anything that ships to users
```

### `--internal` — Internal Development Focus
Skip competitive research (Phase 2) and reality check (Phase 2.5). Focus on architecture, implementation, hardening, and testing. For internal tooling where there are no competitors to analyze.
```
Phases: 0 -> 0.8 -> 1 -> 3 -> 3.5 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10
Skips: Phase 1.5 (Informed Clarification), Phase 2 (Competitive Intelligence), Phase 2.5 (Reality Check)
Use case: Internal APIs, dev tooling, refactoring, infrastructure work
```

### `--outward` — Strategic & Market Analysis Focus
Emphasize competitive intelligence and strategic positioning. Skip error handling and security hardening (Phases 6, 7) and produce a lighter implementation roadmap. For market research, strategic decisions, and feature evaluation.
```
Phases: 0 -> 0.8 -> 1 -> 2 -> 2.5(if --audit) -> 3 -> 3.5 -> 4 -> 5 -> 8(tasks only) -> 10
Skips: Phase 1.5 (Informed Clarification), Phase 6 (Error Handling), Phase 7 (Security), Phase 9 (Test Plan)
Lighter: Phase 8 (tasks list only — no dependency graph, no risk register)
Use case: Evaluating whether to build, competitive positioning, strategic ADRs
```

### `--spike` — Fast Proof-of-Concept
Minimal 4-phase pass: validate the problem, scan the codebase, synthesize a design, output implementation tasks. No competitive research, no strategic analysis, no hardening.
```
Phases: 0(lite) -> 1(lite) -> 4 -> 8
Lite Phase 0: Problem statement + scope only (skip demand evidence, user stories, cannibalization)
Lite Phase 1: Codebase search + conventions only (skip architecture scan, dependency map)
Skips: Phases 0.8, 1.5, 2, 2.5, 3, 3.5, 5, 6, 7, 9, 10(spec saved, no ADR)
Use case: Quick prototyping, time-boxed exploration, "should we even try this?"
```

**Modifiers (layer on top of any mode):**
- `--gate` — Pause after Phase 3 (Strategy) for user review before proceeding to design
- `--audit` — Add Phase 2.5 reality check of existing implementation (not available with `--spike`)
- `--mvp` — Stop after generating the v0 (MVP) task list — skip v1/v2 layers

### Scope Calibration (Auto-Detection)
If the user doesn't specify a mode, assess scope before starting:

| Signal | Suggested Mode | Rationale |
|--------|---------------|-----------|
| Bug fix or single-function change | `--spike` | Minimal investigation needed |
| New internal module, service, or utility | `--internal` | No competitive research needed |
| New API endpoint, component, or contained feature | `--internal` | Architecture-focused |
| User-facing feature with competitive alternatives | `--full` | Need competitive intelligence |
| "Should we build X?" strategic question | `--outward` | Focus on market analysis |
| Enhancement to existing feature (small blast radius) | `--internal` | Architecture-focused |
| Enhancement to existing feature (large blast radius) | `--full` | Full investigation warranted |

Present the suggested mode and rationale. If the user hasn't specified, use the suggestion.

**Mode + Phase Matrix:**

| Phase | `--full` | `--internal` | `--outward` | `--spike` |
|-------|----------|-------------|-------------|-----------|
| 0: Problem Framing | Full | Full | Full | Lite (statement + scope only) |
| 0.8: Codebase Investigation | Full | Full | Full | **SKIP** |
| 1: Internal Recon | Full | Full | Full | Lite (codebase + conventions only) |
| 1.5: Informed Clarification | Full | **SKIP** | **SKIP** | **SKIP** |
| 2: Competitive Intel | Full | **SKIP** | Full | **SKIP** |
| 2.5: Reality Check | With --audit | **SKIP** | With --audit | **SKIP** |
| 3: Strategic Analysis | Full | Full | Full | **SKIP** |
| 3.5: Architecture | Full | Full | Full | **SKIP** |
| 4: Design Synthesis | Full | Full | Full | Full |
| 5: ADR | Full | Full | Full | **SKIP** |
| 6: Error Handling | Full | Full | **SKIP** | **SKIP** |
| 7: Security | Full | Full | **SKIP** | **SKIP** |
| 8: Implementation | Full | Full | Tasks only | Full |
| 9: Test Plan | Full | Full | **SKIP** | **SKIP** |
| 10: Output Artifacts | Full | Full | Spec + ADR | Spec only |

---

## Phase 0: Problem Framing & Demand Validation

> *Before designing anything, prove the problem exists and users care.*

### 0.1 Problem Statement
Write a crisp, one-paragraph problem statement answering:
- What user pain or limitation does this address?
- Why does it matter NOW for the target users (developers using AI coding assistants)?
- What is the cost of NOT doing this?

### 0.2 Demand Evidence (MANDATORY)
Gather at least 2 evidence signals that real users want this:

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| GitHub issue / feature request | repo issues | [link or "none found"] |
| Discord / community request | community channels | [quote or "none found"] |
| Competitor feature parity | [tool name] ships this | [description] |
| Personal pain (user-stated) | This conversation | [user's words] |

**If zero evidence found:** Flag this as speculative. The strategic recommendation in Phase 3.4 must justify building without demand evidence.

### 0.2.5 Before/After State (for feature enhancements)
If enhancing an existing feature (not greenfield), document explicitly:

**Current behavior (before):**
- [What the feature does now — be specific, reference actual output or UX]

**Desired behavior (after):**
- [What the feature should do — concrete, testable differences]

**Delta:**
- [What changes between before and after — this becomes the scope]

Skip this section for entirely new features with no predecessor.

### 0.3 Scope Definition
| In Scope | Out of Scope (and why) |
|----------|------------------------|
| ... | ... |

### 0.4 Success Criteria (Machine-Checkable)
Define 3-5 concrete, testable success criteria in structured format:

| ID | Criterion | Verification Method | Pass Condition |
|----|-----------|-------------------|----------------|
| SC-1 | [description] | test / grep / manual | [exact condition] |
| SC-2 | [description] | test / grep / manual | [exact condition] |
| SC-3 | No regression in existing tests | project test command | All tests pass, count >= baseline |
| SC-4 | Cross-platform compatibility (if applicable) | platform test | No platform-specific failures |
| SC-5 | [description] | test / grep / manual | [exact condition] |

At least 2 criteria must be verifiable by automated tests (not manual inspection only).

### 0.5 User Stories (3 minimum)
```
As a [target user persona discovered from project context], I want [feature],
so that [benefit], instead of [current workaround].
```

### 0.6 Cannibalization Check
Check ALL existing commands and agents for overlap:

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| [closest match 1] | None / Partial / Full | [migration path if partial/full] |
| [closest match 2] | None / Partial / Full | [migration path if partial/full] |
| [closest match 3] | None / Partial / Full | [migration path if partial/full] |

**If Full overlap found:** STOP — enhance the existing command instead of creating a new one.

### 0.7 Cognitive Load Assessment
| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | N | ? | +N |
| New concepts introduced | 0 | ? | +N |
| Score | — | — | simplifies (-1) / neutral (0) / adds complexity (+1) / significant (+2) |

**If score = +2:** Must provide explicit justification in Phase 3.4.

---

## Phase 0.8: Autonomous Codebase Investigation

> *Investigate the codebase BEFORE designing anything. Discover, don't assume.*

### 0.8.1 Silent Discovery (MANDATORY — skip only in `--spike` mode)
Before Phase 1's structured reconnaissance, perform autonomous investigation:

1. **Dependency scan**: Grep for imports/requires of modules related to the feature area
2. **Pattern discovery**: Search for similar functionality already implemented — find 2-3 existing implementations of the same type (command, agent, module, hook) and extract their patterns
3. **Convention extraction**: Read the implementations found above to learn naming, error handling, output format, and testing patterns actually used (not just documented)
4. **Test pattern discovery**: Read test files for similar features to understand assertion patterns, helper usage, and test structure conventions
5. **Integration points**: Identify which existing modules, commands, and agents this feature will touch or depend on

Record all findings as structured notes — these ground every subsequent phase.

### 0.8.2 Impact Analysis (MANDATORY — skip only in `--spike` mode)
Before any design work, surface the blast radius:

| Affected Area | Specific Item | How Affected | Risk Level |
|--------------|---------------|-------------|------------|
| Core module | [discover from 0.8.1] | New function added / existing modified | Low / Medium / High |
| Entry point / router | [discover from 0.8.1] | New routing or dispatch | Low / Medium |
| Interface / API | [discover from 0.8.1] | New or updated | Low / Medium |
| Configuration | [discover from 0.8.1] | New settings or schema changes | Low / Medium |
| Test file | [discover from 0.8.1] | New tests needed / existing updated | Low / Medium |
| Build / deploy | [discover from 0.8.1] | Updated if new artifacts | Medium |
| Documentation | [discover from 0.8.1] | Updated counts, references | Low |

If the impact table has 0 "High" entries: proceed with confidence.
If 1+ "High" entries: flag for extra design scrutiny in Phase 3.5.

### 0.8.3 Informed Context
Use discoveries from 0.8.1 and 0.8.2 to improve ALL subsequent phases:
- Phase 1 reconnaissance should focus on GAPS the investigation revealed, not re-read what was already found
- Phase 1.5 clarification questions should reference actual discovered patterns
- Phase 3 strategic analysis should assess discovered patterns, not assumed ones
- Phase 4 design should follow conventions extracted from real implementations

---

## Phase 1: Internal Reconnaissance

**Understand what the project already has before looking outward.**

### 1.1 Architecture Scan
Read and extract relevant context from:
- `README.md` — Public documentation and architecture
- User guide — User workflows
- Architecture docs — System design
- Project conventions — Known patterns and stability work

Create an **existing capabilities inventory:**
```
| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| ... | ... | ... | ... |
```

### 1.2 Codebase Search
Discover the project's actual structure from Phase 0.8 findings, then search systematically:

| Search Target | Where to Look | What to Extract |
|---------------|---------------|------------------|
| Entry points | Main files, routers, dispatchers | Request/command routing, arg parsing |
| Core logic | Business logic / domain modules | Existing patterns, helpers, shared utilities |
| API surface | Controllers, handlers, routes, commands | Public interface patterns |
| Data layer | Models, repositories, schemas, migrations | Data access patterns, ORM usage |
| Configuration | Config files, env templates, feature flags | Environment handling, feature toggling |
| Test patterns | Test files + helpers + fixtures | Testing conventions, assertion patterns |
| Build / deploy | Build scripts, CI config, Dockerfiles | Build pipeline, deployment flow |

### 1.3 Convention Enforcement Checklist
Extract the project's actual conventions from Phase 0.8 discoveries, then verify the feature design conforms. Check each category:

**Naming & Structure** (discover from existing code):
- [ ] Function/method naming follows project convention (e.g., camelCase, snake_case, verb-noun)
- [ ] File naming follows project convention (e.g., kebab-case, PascalCase, suffixes like .service, .controller)
- [ ] Module/export patterns match existing code (e.g., default exports, named exports, module.exports)

**Error Handling** (discover from existing implementations):
- [ ] Error reporting follows project pattern (e.g., custom error classes, error codes, Result types)
- [ ] File/network operations use project's established safety patterns
- [ ] User-facing errors follow project's messaging conventions

**Code Quality** (discover from linter config, CONTRIBUTING.md, or existing code):
- [ ] Complexity stays within project's established limits (check linter rules or documented standards)
- [ ] Dependencies align with project policy (check package manager, dependency philosophy)
- [ ] Language/runtime version matches project requirements

**Output & I/O** (discover from existing interfaces):
- [ ] Output format matches project convention (JSON, structured logging, CLI output format)
- [ ] Path handling follows project patterns (relative vs absolute, normalization)
- [ ] Configuration follows project pattern (env vars, config files, CLI flags)

### 1.4 Dependency & Integration Map
```
[This Feature]
    ├── depends on: [existing module A]
    ├── depends on: [existing module B]
    ├── extends: [existing command C]
    ├── conflicts with: [nothing / feature D because...]
    └── enables: [future feature E]
```

**require()/import chain:** Draw the module dependency path. Verify no circular dependencies.

---

## Phase 1.5: Informed Clarification (Full Mode Only)

> *Ask smart questions grounded in what you discovered, not generic templates.*

Based on Phase 0.8 investigation and Phase 1 reconnaissance findings, ask 2-4 INFORMED clarification questions.

### Rules
1. Questions MUST reference specific files, line numbers, or patterns found during investigation (e.g., "I found your auth uses JWT with RS256 in `auth.cjs:47` — should this feature follow the same pattern?")
2. Surface architectural decisions the investigation revealed that need user input
3. Clarify ambiguities that code inspection couldn't resolve
4. Never ask generic questions ("Do you want tests?" — always want tests)
5. Maximum 4 questions — prefer fewer, more specific ones

### When to Skip
- Skip in `--internal`, `--outward`, and `--spike` modes — make reasonable assumptions based on discovered patterns and note them in the spec
- Skip in `--full` mode if the investigation made the scope completely unambiguous
- When skipping, document assumptions made in place of asking

---

## Phase 2: Competitive Intelligence

**Research how the best AI workflow tools solve this problem.**

### 2.1 Deep-Dive Research (6+ Tools)
Select competitor tools relevant to the FEATURE DOMAIN, not a fixed list. Use web search for each.

**Competitor selection guidance:**
1. Identify the domain of the feature being designed (e.g., CI/CD, testing, API framework, state management, CLI tooling, AI coding)
2. Search for the top 6-8 tools in that domain
3. Include at least 2 open-source and 2 commercial options
4. Include the current market leader and the fastest-growing challenger

**For AI coding tool features** (when the project IS an AI coding tool):
- Research tools like Aider, Cursor, Cline, Windsurf, Continue.dev, GitHub Copilot, Amazon Kiro, and community patterns

**For all other domains:** Research the 6+ most relevant tools in the feature's problem space. The competitor set should be determined by what the feature does, not what the project is.

For each, extract: **UX** (how invoked), **Behavior** (guarantees), **Ergonomics** (love/hate), **Pitfalls** (known limits), **Evolution** (what they got wrong first).

### 2.2 Prior Art & Community Research
Search for: blog posts from domain experts, Reddit/HN discussions, open issues in competing tools.

### 2.3 Competitive Matrix
```
| Aspect | This Project | Competitor 1 | Competitor 2 | Competitor 3 | ... | Best |
|--------|-------------|-------------|-------------|-------------|-----|------|
| UX | ... | ... | ... | ... | ... | ... |
| Context | ... | ... | ... | ... | ... | ... |
| Reliability | ... | ... | ... | ... | ... | ... |
```
Populate column headers with the actual tools discovered in 2.1.

---

## Phase 2.5: Reality Check (OPTIONAL — only with `--audit` flag)

If any related implementation already exists, verify it's real:
- [ ] File existence check (not just claimed in docs)
- [ ] Code substance check (not stubs or TODOs)
- [ ] Actually run it and verify output
- [ ] Test validity check (tests assert real behavior, not just existence)
- [ ] Truth table: `| Item | Claimed | Real | Verdict |`

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework
| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | (e.g., complex config, IDE lock-in) |
| **REDUCE** | What should be reduced? | (e.g., boilerplate, setup time) |
| **RAISE** | What should be raised? | (e.g., context quality, verification) |
| **CREATE** | What should we create? | (e.g., context rot prevention, state persistence) |

### 3.2 Wardley Evolution Assessment
```
Genesis ──── Custom-Built ──── Product ──── Commodity
```
- Where is this feature in the INDUSTRY?
- Where should we position it?
- What evolution in 2-3 years? (plan for it now)

### 3.3 Strategic Moat Analysis
| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Technical Differentiation** | Does this create a capability competitors can't easily replicate? | |
| **Platform Reach** | Does this work across all platforms/runtimes the project supports? | |
| **Developer Experience** | Is this meaningfully better than alternatives? | |
| **Dependency Footprint** | Does this maintain the project's dependency philosophy? | |
| **Data Continuity** | Does this improve cross-session or cross-tool data persistence? | |
| **Quality Assurance** | Does this strengthen the project's verification/testing guarantees? | |

### 3.4 Strategic Recommendation
Based on 3.1-3.3 AND Phase 0 demand evidence, write a 1-paragraph recommendation:
- Should we build this? (Yes / No / Modified)
- What's our unique angle?
- What should we explicitly NOT copy?
- What's the strategic timing?

**If `--gate` flag: STOP HERE and present Phases 0-3 for user approval.**

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

**Design with the project's architecture, not against it.**

### 3.5.1 Feature Type Classification
Classify the feature using categories discovered from the project's architecture in Phase 0.8:

| Type | Description | Integration Pattern |
|------|-------------|--------------------|
| **New endpoint / route** | New API or CLI entry point | Add to router/dispatcher, implement handler |
| **New service / module** | New business logic unit | Create module, wire dependencies, export interface |
| **New UI component** | User-facing interface element | Create component, integrate into layout/routing |
| **New background job** | Async processing, scheduled task | Create worker, configure scheduler/queue |
| **Core enhancement** | Modify existing module | Edit module, update dependents, update tests |
| **Infrastructure** | Build, deploy, or config change | Modify pipeline, test deployment |
| **Plugin / extension** | Extensibility point or hook | Define interface, implement adapter, register |

Adapt this table to match the project's actual architecture patterns discovered in Phase 0.8.

### 3.5.2 Layer Violation Check
Using the project's architectural boundaries discovered in Phase 0.8, verify:
- [ ] New code respects the project's layer separation (e.g., controllers don't access DB directly, services don't import UI)
- [ ] Dependencies flow in the correct direction (no upward or circular dependencies)
- [ ] Public interfaces follow the project's established patterns
- [ ] No layer bypass — intermediate layers are not skipped

Document the specific layer rules discovered for this project.

### 3.5.3 Output Contract Design (Contract-First)
Define the interface/schema BEFORE implementation:
```json
{
  "field1": "type — description",
  "field2": "type — description",
  "error": "string — only present on failure"
}
```

**Contract rules:**
- [ ] Field names use project's naming convention (discover from existing interfaces)
- [ ] No field name collisions with existing output
- [ ] Error shape consistent with project's error handling pattern
- [ ] Paths in output normalized per project convention
- [ ] Output size reasonable for the use case

### 3.5.4 State Transition Modeling
**Required if the feature mutates state or planning files.**

| Current State | Action | New State | Error If Invalid |
|--------------|--------|-----------|-----------------|
| [state A] | [this command] | [state B] | [error message] |

### 3.5.5 Breaking Change Assessment
| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | Yes/No |
| Changes file formats? | Yes/No |
| Changes directory structure? | Yes/No |
| Changes installer output? | Yes/No |

**If ANY answer is Yes:** Define a migration strategy.

### 3.5.6 Composability Analysis
| Interaction | Works? | How |
|-------------|--------|-----|
| Output feeds another command's input | Yes/No | [which command] |
| Callable from an agent | Yes/No | [how] |
| Usable in a hook pipeline | Yes/No | [how] |
| Works in --raw mode for humans | Yes/No | [raw output format] |

### 3.5.7 Performance Budget
| Operation | Cost | Notes |
|-----------|------|-------|
| File reads (N x ~5ms) | ~Xms | [list files] |
| Markdown parsing | ~Xms | [if applicable] |
| Computation | ~Xms | [describe] |
| File writes (N x ~5ms) | ~Xms | [list files] |
| **Total** | **< 500ms** | Justify if exceeding |

### 3.5.8 Cross-Platform Considerations
| Platform | Consideration |
|----------|---------------|
| Windows | Path separators, shell escaping, CRLF, long path limits (if applicable) |
| Mac/Linux | POSIX paths, case-sensitive filesystem (if applicable) |
| All | Use platform-agnostic path APIs, no hardcoded separators |
| All targets | All supported platform/runtime compatibility (discover from Phase 0.8) |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation (User-Facing)
Write as if teaching this feature to a user who has never seen it:
- Introduce the feature by name
- Show 2-3 practical examples with real-world scenarios
- Explain how it interacts with existing commands they already know
- Show the error messages they'd see if they misuse it
- Explain what it does NOT do (prevent confusion)

### 4.2 Reference-Level Explanation (Technical)

#### 4.2.1 Interface Definition
```
Interface: [describe invocation — CLI command, API endpoint, function call, UI action]
Arguments / Parameters: [list with types]
Output: [schema or format from 3.5.3]
Status / Exit codes: [success and error codes per project convention]
```

#### 4.2.2 State Changes & Filesystem Scope
```
Reads from: [list — must be within project root]
Writes to: [list — must be within .planning/ or project root]
State mutations: [state changes]
Side effects: [git operations, directory creation, etc.]
```

#### 4.2.3 Error Handling
Every error condition must specify:
| Condition | JSON Output | Error Style |
|-----------|-------------|-------------|
| [missing file] | {"error": "X not found"} | safe read returns null |
| [bad args] | {"error": "X required"} | arg validation before fs ops |

### 4.3 Design Decisions
| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|

### 4.4 Drawbacks & Alternatives
| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|

### 4.5 Feature Ladder (Incremental Delivery)
| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | [smallest useful slice] | [what user can do] | XS-S |
| **v1 (Complete)** | [full feature as designed] | [full value] | S-M |
| **v2 (Enhanced)** | [future extensions] | [additional value] | M-L |

### 4.6 Adoption Analysis
| Question | Answer |
|----------|--------|
| How does the user discover this feature? | |
| What's the learning curve? | |
| Does it require changing existing workflows? | |
| What's the "aha moment"? | |

---

## Phase 5: Architecture Decision Record

> *An ADR is the institutional memory of WHY. Make it comprehensive enough that a developer joining 12 months from now can understand the full decision landscape without asking anyone.*

### 5.0 ADR Numbering
- Read existing ADRs in `docs/decisions/` to determine the next sequential number
- Format: `ADR-NNNN-<kebab-case-feature-name>.md` (e.g., `ADR-0019-webhook-support.md`)

### 5.1 ADR Structure (MANDATORY — all sections required)

The ADR MUST contain ALL of the following sections. Do NOT produce a skeleton with placeholder text — every section must have substantive, project-specific content drawn from the preceding phases.

```markdown
# ADR-NNNN: [Descriptive Title — not just feature name but what was decided]

## Status
Proposed | Accepted | Superseded by ADR-NNNN | Amended by ADR-NNNN

## Date
YYYY-MM-DD

## Context

### Problem Statement
[1-2 paragraphs: What problem exists? Why does it matter? What is the cost of inaction?
Pull directly from Phase 0.1 — do not paraphrase into vague generalities.]

### Forces & Constraints
[Enumerate the specific technical, business, regulatory, and organizational forces
that constrain the solution space. These come from Phase 0 + Phase 1 discoveries.]

- **[Force 1]:** [Specific constraint and why it matters]
- **[Force 2]:** [Specific constraint and why it matters]
- **[Force 3]:** [Specific constraint and why it matters]

### Current State
[What exists today? Reference actual files, modules, endpoints discovered in Phase 0.8.
If enhancing an existing feature, include the Before/After delta from Phase 0.2.5.]

### Requirements Traceability
[Map to the spec that triggered this ADR. List the success criteria from Phase 0.4.]

| Requirement | Source | ADR Section |
|-------------|--------|-------------|
| [SC-1 from Phase 0.4] | [spec file or user request] | Decision §X |
| [SC-2 from Phase 0.4] | [spec file or user request] | Decision §Y |

## Decision

### Summary
[1-2 sentences: The decision in plain language. A busy reader should understand
the choice from this paragraph alone.]

### Detailed Design Decisions
[Number each sub-decision. For each, state WHAT was decided and WHY.
Pull from Phase 4 design synthesis — every design choice documented there
must appear here with rationale.]

#### 1. [Sub-decision title]
**Decided:** [What]
**Rationale:** [Why — reference forces from Context, competitive findings from Phase 2,
or architectural constraints from Phase 3.5]
**Alternatives rejected:** [Brief — full analysis in Options Considered]

#### 2. [Sub-decision title]
**Decided:** [What]
**Rationale:** [Why]
**Alternatives rejected:** [Brief]

[Continue for all significant decisions — typically 3-8 sub-decisions]

### Architecture & Integration
[How does this fit into the existing system? Include the dependency map from Phase 1.4
and the layer violation check from Phase 3.5.2. Show which modules are touched.]

```
[Dependency diagram or integration flow from Phase 1.4 / 3.5.6]
```

### Interface Contract
[The output schema or API contract from Phase 3.5.3 — exact format, not just description.
Include request/response examples for APIs, CLI input/output for commands,
or data schema for storage changes.]

## Consequences

### Positive
[Minimum 3 consequences. Each must be specific and measurable, not generic platitudes.
BAD: "Better user experience" — GOOD: "Reduces statement processing failure rate
from 80% to <5% for image-based uploads"]

- **[Specific benefit 1]:** [Measurable impact]
- **[Specific benefit 2]:** [Measurable impact]
- **[Specific benefit 3]:** [Measurable impact]

### Negative
[Minimum 2 consequences. Be honest about costs and tradeoffs.
Every negative must include a mitigation strategy or explicit acceptance rationale.]

- **[Specific cost 1]:** [Impact] — *Mitigation:* [how addressed or why accepted]
- **[Specific cost 2]:** [Impact] — *Mitigation:* [how addressed or why accepted]

### Neutral
[Side effects that are neither clearly positive nor negative]

- [Side effect 1]
- [Side effect 2]

## Options Considered

> *Document ALL options evaluated, including the chosen one. For each option,
> provide enough detail that a reader can understand why it was accepted or rejected
> WITHOUT reading the full spec.*

### Option 1: [Name] — REJECTED
**Description:** [2-3 sentences: what this approach involves]
**Pros:** [Bullet list]
**Cons:** [Bullet list]
**Rejected because:** [Specific reason tied to forces/constraints in Context]

### Option 2: [Name] — REJECTED
**Description:** [2-3 sentences]
**Pros:** [Bullet list]
**Cons:** [Bullet list]
**Rejected because:** [Specific reason]

### Option 3: [Name] — CHOSEN
**Description:** [2-3 sentences]
**Pros:** [Bullet list]
**Cons:** [Bullet list — same as Negative consequences]
**Chosen because:** [Specific reason — ties back to forces, competitive position, strategic analysis]

### Option 4: [Name] — DEFERRED
**Description:** [2-3 sentences]
**Deferred because:** [Not rejected — viable for future consideration. State trigger conditions.]

[Include 3-5 options minimum. If fewer than 3 alternatives were genuinely considered,
explain why the solution space was constrained.]

### Decision Matrix (when 3+ options share comparable tradeoffs)
| Criterion (from forces) | Weight | Option 1 | Option 2 | Option 3 (chosen) |
|--------------------------|--------|----------|----------|-------------------|
| [Force/requirement 1] | High | Poor | Good | Excellent |
| [Force/requirement 2] | Medium | Good | Poor | Good |
| [Force/requirement 3] | High | N/A | Good | Excellent |
| **Weighted Score** | | Low | Medium | **High** |

## Success Criteria

[Copy directly from Phase 0.4 — these are the machine-checkable acceptance criteria
that determine whether this ADR's decision was correctly implemented.]

| ID | Criterion | Verification Method | Pass Condition |
|----|-----------|-------------------|----------------|
| SC-1 | [description] | test / grep / manual | [exact condition] |
| SC-2 | [description] | test / grep / manual | [exact condition] |
| SC-3 | No regression | project test command | All existing tests pass |

## Breaking Changes

[From Phase 3.5.5. If no breaking changes, state "None — all changes are additive."]

| Change | Impact | Migration Strategy |
|--------|--------|--------------------|
| [What changes] | [Who is affected] | [How to migrate] |

## Security Implications

[From Phase 7. Summarize the threat model and key controls.]

| Threat | Risk Level | Control |
|--------|-----------|---------|
| [Threat from STRIDE-lite] | Low/Medium/High | [Mitigation implemented] |

If no security implications: "No new attack surface introduced. [Brief justification.]"

## Performance Implications

[From Phase 3.5.7 performance budget. State the expected performance characteristics
and any budgets that must be maintained.]

| Operation | Budget | Justification |
|-----------|--------|---------------|
| [Key operation 1] | < Xms | [Why this budget] |
| [Key operation 2] | < Xms | [Why this budget] |

## Implementation Guidance

[From Phase 8. Not the full task list — just enough for an implementer to know
WHERE to start and what patterns to follow.]

| Order | Task | Files Affected | Effort |
|-------|------|---------------|--------|
| 1 | [First task] | [file paths] | XS/S/M/L |
| 2 | [Second task] | [file paths] | XS/S/M/L |

**Patterns to follow:** [Reference specific existing implementations discovered in Phase 0.8
that the implementer should use as templates]

## Feature Ladder

[From Phase 4.5. Shows the incremental delivery plan.]

| Version | Scope | Value Delivered |
|---------|-------|----------------|
| v0 (MVP) | [smallest useful slice] | [what user can do] |
| v1 (Complete) | [full feature] | [full value] |
| v2 (Enhanced) | [future extensions] | [additional value] |

## Links & References

- **Spec:** `docs/specs/<feature>_featureai.md`
- **Related ADRs:** [list with brief relationship description]
- **Supersedes:** [ADR number if replacing a previous decision, or "N/A"]
- **External references:** [Standards, RFCs, competitor docs, regulatory requirements]
- **Affected components:** [List of files/modules/services from impact analysis]
```

### 5.2 ADR Quality Gate (Self-Check Before Writing)

Before writing the ADR file, verify ALL of these:

| Check | Requirement | Source Phase |
|-------|-------------|-------------|
| Context has specific forces | Not just "we need X" — enumerate WHY and WHAT CONSTRAINS | Phase 0 + 1 |
| Decision has numbered sub-decisions | Every design choice from Phase 4 is captured with rationale | Phase 4 |
| Options >= 3 | At least 3 genuine alternatives evaluated | Phase 2 + 3 |
| Each option has pros AND cons | No straw-man options set up just to be rejected | Phase 2 + 3 |
| Consequences are specific | No generic "better UX" — measurable impacts only | Phase 3 + 4 |
| Negative consequences have mitigations | Every cost is either mitigated or explicitly accepted | Phase 4 |
| Success criteria are machine-checkable | At least 2 can be verified by automated test | Phase 0.4 |
| Breaking changes documented or "None" stated | Never omitted silently | Phase 3.5.5 |
| Security section present | Even if "no new attack surface" — must be explicit | Phase 7 |
| Performance budget stated | Key operations with time budgets | Phase 3.5.7 |
| Implementation guidance references real files | Not hypothetical paths — actual discovered locations | Phase 0.8 + 8 |
| Links trace to spec file | ADR → spec → requirements chain is complete | Phase 10 |

**If any check fails:** Go back to the relevant phase and extract the missing content. Do NOT write placeholder text.

### 5.3 ADR Anti-Patterns (NEVER DO)

- **Skeleton ADR:** `[Problem context — what forces are at play?]` — NEVER use placeholder brackets in the output
- **Single-option ADR:** Only describing the chosen approach without alternatives — this is a design doc, not an ADR
- **Consequence-free ADR:** Listing only positives — EVERY decision has real costs
- **Generic consequences:** "Improves code quality" / "Better maintainability" — be specific or remove
- **Missing rationale:** "We chose X" without explaining WHY over alternatives
- **Orphan ADR:** No link to spec, no link to related ADRs, no traceability
- **Copy-paste from spec:** The ADR is a DECISION record, not a spec summary — focus on WHY, not WHAT
- **Straw-man options:** Including obviously bad alternatives just to make the chosen option look good
- **Missing migration strategy:** Documenting breaking changes without explaining how to handle them

---

## Phase 6: Error Handling & Diagnostics Design

> *Make the feature diagnosable from day one.*

### 6.1 Failure Mode Analysis
| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| Missing required file | User error | Check before access | Actionable error message | Clear guidance on what's missing |
| Invalid arguments | User error | Input validation | Error with usage hint | Usage guidance |
| External service unavailable | Environment | Timeout / connection error | Retry or graceful degradation | Service-specific message |
| Disk full / write failure | Environment | try-catch on write | Graceful error | No crash, no data corruption |
| Malformed input data | Data corruption | Validation on parse | Skip bad data or error | Degraded but functional |
| Concurrent access | Race condition | Project's concurrency pattern | Safe fallback | No corruption |

### 6.2 Diagnostic Support
Design diagnostics using the project's existing patterns:
| Diagnostic | How | When |
|------------|-----|------|
| Verbose / debug mode | Project's debug flag pattern | Debugging |
| Structured logging | Project's logging framework | Monitoring |
| Error context | Include relevant state in errors | Failures |
| Health check | Expose status endpoint or command | Operations |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface Inventory
| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| [file/data this feature touches] | Read / Write / Execute | User-controlled / System-generated |

| Input Vector | Source | Validation Required |
|-------------|--------|-------------------|
| CLI arguments | User-typed | Type check, length limit, no shell metacharacters |
| File contents (*.md, *.json) | Disk (user-writable) | Structure validation, size limit |
| Environment variables | OS | Only read known vars, never expose in output |
| Path arguments | User-typed | Full path safety protocol (below) |

### 7.2 Path Safety Protocol (MANDATORY for any path input)
1. Resolve to absolute: `path.resolve(cwd, userPath)`
2. Verify within project: resolved path starts with `path.resolve(cwd)`
3. Reject `..` segments before resolution
4. Reject null bytes (`\0`)
5. On Windows: reject alternate data streams (`:` after drive letter position 2)

### 7.3 Output Sanitization
- [ ] No absolute filesystem paths in output (use normalized relative paths)
- [ ] No environment variable values in output
- [ ] No stack traces in error messages
- [ ] No internal function names or line numbers in user-facing errors

### 7.4 Content Validation
Every file read must validate structure before processing:
- JSON files: `JSON.parse()` inside try-catch, validate expected keys
- Markdown files: Check for expected frontmatter or section headers
- Never pass raw file content to `eval()`, `Function()`, or template strings

### 7.5 Privilege Scope Declaration
```
Reads from: [explicit directory list — must be within project root]
Writes to: [explicit directory list — must be within .planning/ or project root]
Executes shell: [Yes/No — if yes, what commands and why]
Reads outside project: [Yes/No — if yes, justify]
```

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definition (DRAFT NOW — not deferred)
Draft the command file content. The command file IS the interface for AI tools.

### 8.2 Implementation Tasks (Ordered)
Break into small, independently testable units:

```
### Task 1: [Core module changes]
Files: [paths]
Test: [test command]
Estimate: XS/S/M/L
Priority: P[0-6]

### Task 2: [CLI dispatcher routing]
...
```

### 8.3 Dependency Graph
```
Task 1 -> Task 2 -> Task 3 -> ...
```

### 8.4 Risk Register
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|

### 8.5 Cognitive Complexity Budget
Apply the project's established complexity limits (discover from linter config, CONTRIBUTING.md, or code review conventions):
- Max function length: [discover from project — check linter rules or established patterns]
- Max nesting depth: [discover from project]
- Max parameters: [discover from project — use options/config object if exceeded]

If the project has no documented limits, propose reasonable defaults and flag for team review.

---

## Phase 9: Test Plan

### 9.1 Test Pyramid (proportional to scope)
| Level | Pattern | Guidance | What It Catches |
|-------|---------|----------|-----------------|
| **Unit** | Test individual functions, mock externals | Cover all business logic paths + edge cases | Logic bugs, edge cases |
| **Integration** | Test with real dependencies (DB, filesystem, APIs) | Cover all integration boundaries | Wiring bugs, config issues, data flow |
| **E2E** | Full user workflow sequences | Cover critical user journeys | State transitions, cross-component interaction |

Scale test counts proportionally to feature complexity. Discover the project's test conventions from Phase 0.8 (framework, directory structure, naming, assertion library, helper patterns).

### 9.2 Assertion Density Requirements
Every test must assert AT MINIMUM:
- **Success tests:** (a) correct JSON shape, (b) correct values for >= 2 fields, (c) no `error` field
- **Error tests:** (a) `error` field with actionable message, (b) no data corruption, (c) clean exit

### 9.3 Boundary Value Analysis
Test these boundary conditions (adapt to project domain):
- [ ] Empty / fresh project state (no existing data)
- [ ] Minimal vs maximal input size
- [ ] Edge case inputs (special characters, unicode, empty strings, boundary numbers)
- [ ] Missing file / resource between check and access (race condition)
- [ ] Platform-specific edge cases (path lengths, encoding, line endings)
- [ ] Resource contention (file locks, concurrent access)
- [ ] Malformed / corrupted input data

### 9.4 Regression Verification
- [ ] Full suite passes unchanged
- [ ] Related modules explicitly re-tested
- [ ] No existing test expectations changed

### 9.5 Performance Validation
- [ ] Feature completes within acceptable time for typical usage (define budget based on project norms)
- [ ] No regression in full test suite runtime
- [ ] Output / response size reasonable for the use case

---

## Phase 10: Output Artifacts

### 10.1 Save Specification Document
Write complete spec to: `docs/specs/<feature_name>_featureai.md`

### 10.2 Save ADR
Write ADR to: `docs/decisions/ADR-NNNN-<feature_name>.md`

**ADR completeness gate:** Before saving, verify the ADR passes ALL checks from Phase 5.2. The ADR file must contain every section defined in Phase 5.1 with substantive content — no placeholder brackets, no skeleton sections, no missing tables. If any section would be empty, go back to the relevant phase and extract the content.

**Minimum ADR size:** A proper ADR for a `--full` mode investigation should be 80-200+ lines. If the ADR is under 60 lines, it is almost certainly missing required sections. For `--internal` mode, minimum 60 lines. For `--outward` mode, minimum 70 lines.

### 10.3 Report Summary
Output a complete summary with:
- **Problem & Evidence** — 1-sentence problem, evidence sources
- **Investigation Depth** — files read during Phase 0.8, patterns discovered, modules in impact analysis
- **Strategic Assessment** — Blue Ocean actions, Wardley position, Moat Score (N/30), Cognitive Load score, Recommendation
- **Competitive Position** — which competitors analyzed, where the project leads/lags for this feature
- **Design Summary** — feature type, modules affected, output schema, error handling, breaking changes
- **Feature Ladder** — v0/v1/v2 scope and effort
- **Implementation Tasks** — count, total complexity, files to create/modify
- **Security** — attack surface, path safety, output sanitization
- **Adoption** — discovery, learning curve, aha moment
- **Informed Questions** — count asked, what they clarified
- **Acceptance Criteria** — count, how many are machine-checkable
- **Documents Created** — spec path, ADR path, command .md path (if applicable)
- **Next Step** — recommended follow-up command

---

## NEVER DO

- Design without proving the problem exists (Phase 0 demand evidence is mandatory)
- Skip competitive research — must be best-of-breed
- Copy a tool's design without understanding WHY they made that choice
- Violate the project's dependency philosophy (discover from Phase 0.8)
- Add a feature without error handling design (Phase 6)
- Skip cross-platform considerations when the project supports multiple platforms
- Produce a spec without measurable success criteria
- Produce a spec without a test plan with enforced assertion density
- Trust existing implementation claims without `--audit` verification
- Design in isolation — always map dependencies and integration points
- Use `eval()`, `Function()`, string interpolation in shell commands, or unvalidated paths
- Violate the project's architectural layer boundaries (discover from Phase 0.8)
- Expose absolute paths, stack traces, or env vars in output
- Change existing public interfaces without a migration strategy
- Defer the interface definition to "documentation" — draft it during design
- Exceed the project's established complexity limits
- Add a feature scoring +2 on cognitive load without explicit justification
- Ship a feature with no demand evidence and no strategic justification

## ALWAYS DO

- Start from the USER's problem, not the technology
- Gather demand evidence before committing to design
- Check all existing project features for overlap before proposing new ones
- Research at least 6 competitor tools in the feature's domain before designing
- Apply Blue Ocean thinking — find where to CREATE, not just copy
- Define the output/interface contract BEFORE implementation design (contract-first)
- Write the guide-level explanation BEFORE the reference-level
- Draft the interface definition as part of the spec (it IS the integration point)
- Plan for failure (error messages, graceful degradation, actionable errors)
- Follow the project's error message conventions (discover from Phase 0.8)
- Apply the path safety protocol for any user-supplied path input
- Validate file content structure before processing (never trust disk contents)
- Follow existing patterns for output, errors, file reading
- Follow the project's dependency philosophy (discover from Phase 0.8)
- Enforce the project's test pyramid proportional to feature scope (discover from Phase 0.8)
- Verify dependency chain has no cycles
- Stay within the project's established complexity limits (discover from Phase 0.8)
- Define a feature ladder (v0 MVP -> v1 complete -> v2 enhanced)
- Model adoption friction (discovery, learning curve, aha moment)
- Produce a complete spec with ADR, ready for implementation
