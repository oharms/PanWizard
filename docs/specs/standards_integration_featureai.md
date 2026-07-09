# Feature Specification: Standards Integration for PAN Wizard

**Author:** featureAI Pipeline
**Date:** 2026-03-02
**Mode:** `--full` (10-phase investigation)
**Status:** Proposed
**ADR:** ADR-0010-standards-integration

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard orchestrates AI-assisted development across 5 runtimes, but has no systematic way for users to select, configure, and enforce industry standards (OWASP, NIST, WCAG, ISO 25010, etc.) throughout their workflow. Today, standards knowledge is baked into PAN's own code (STRIDE-lite in focus-design, Nyquist in VALIDATION.md, TOGAF in map-codebase) but users cannot configure which standards apply to *their* project or verify compliance against them. As AI-generated code increasingly introduces security vulnerabilities (~25-45% of AI-generated code contains flaws per 2025-2026 research), the cost of not providing standards guidance is shipping insecure, inaccessible, or non-compliant software.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Research data | Multiple 2025-2026 studies | 24.7-45% of AI-generated code has security flaws; 2.74x more vulnerabilities in AI-assisted PRs |
| Competitor response | Secure Code Warrior | Released open-source AI Security Rules for 6 tools (June 2025) |
| Industry standards body | OWASP | Published 3 new AI-specific standards: LLM Top 10 (2025), Agentic Top 10 (2026), AI Testing Guide (2025) |
| Industry standards body | OpenSSF | Published Security-Focused Guide for AI Code Assistant Instructions (Sep 2025) |
| Industry standards body | NIST | Finalized SP 800-218A for generative AI secure development |
| Personal pain (user-stated) | This conversation | "Consider adding standards to the processes or selection of standards, how would we do this, like OWASP for security for example" |
| Market trend | "Vibe coding" discourse | Black Duck, Palo Alto Networks, Dark Reading all published security analyses; consensus: treat AI-generated code as untrusted |

**Verdict:** Strong demand. The entire industry is converging on this need.

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Standards selection during `/pan:new-project` and `/pan:settings` | Running SAST/DAST tools (that's SonarQube/Semgrep's job, not PAN's) |
| Standards registry in `.planning/standards.md` | Certifying compliance (PAN guides, it doesn't certify) |
| Standards-aware context injection into agents (planner, executor, verifier) | Custom standard authoring (use predefined catalogs) |
| Standards compliance checking via `/pan:health --standards` | Automated code scanning (delegated to external tools) |
| Standards reporting in verification output | Legal compliance advice |
| Built-in catalog of 8-12 well-known standards | Exhaustive coverage of all industry standards |
| Project-type-based standard recommendations | Per-file or per-line standard annotations |

### 0.4 Success Criteria

```
SC-1: User can select applicable standards during /pan:new-project or /pan:settings with a single interaction
SC-2: Selected standards appear as context in planner, executor, and verifier agent prompts
SC-3: /pan:health --standards reports compliance status for each selected standard
SC-4: Feature works across all 5 supported runtimes
SC-5: Zero new runtime dependencies
SC-6: No regression in existing 1065 tests
SC-7: Standards selection adds < 200ms to any command execution
```

### 0.5 User Stories

```
As a developer building a web application with PAN Wizard, I want to select OWASP Top 10
as an applicable standard during project setup, so that every plan and verification
includes security checks, instead of manually reminding Claude about security every session.

As a team lead responsible for WCAG compliance, I want PAN's verifier to check accessibility
requirements against my selected standard, so that accessibility isn't forgotten during
AI-assisted development, instead of running a separate audit after shipping.

As a startup founder preparing for SOC 2, I want PAN to track which standards my project
follows and report compliance gaps, so that I can demonstrate due diligence to auditors,
instead of retroactively documenting security practices.

As a developer working on an AI/LLM application, I want PAN to recommend OWASP LLM Top 10
based on my project type, so that I get relevant standards without needing to know the full
catalog, instead of searching for which standards apply to my use case.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:focus-design` Phase 7 (Security) | Partial | Standards integration formalizes what focus-design does ad-hoc; focus-design becomes a consumer of the standards registry |
| `/pan:health` | Partial | Health extends to include `--standards` flag; existing checks unchanged |
| `pan-verifier` agent | Partial | Verifier gains standards-aware checklist injection; existing verification unchanged |
| `pan-plan-checker` agent | Partial | Plan-checker can validate plans reference applicable standards; existing 8 dimensions unchanged |
| `/pan:settings` | Partial | Settings gains standards selection UI; existing config unchanged |

**No full overlap.** This is a cross-cutting enhancement that enriches existing commands, not a replacement.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 37 | 37 | +0 (no new commands) |
| New concepts introduced | 0 | 1 (standards selection) | +1 |
| Score | — | — | neutral (0) — enhances existing commands, no new invocations to learn |

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| STRIDE-lite threat model | Active | `focus-design.md` Phase 7 | Becomes consumer of standards registry |
| Nyquist test sampling | Active | `templates/VALIDATION.md` | Test standard already formalized |
| TOGAF architecture mapping | Active | `pan-document_code.md`, ADR-0008 | Architecture standard already used |
| Conventional commits | Active | `commit --type` flag | Commit standard enforced |
| Semver versioning | Active | `package.json`, ADR-0007 | Versioning standard followed |
| Keep a Changelog | Active | `CHANGELOG.md` | Documentation standard followed |
| 4-level verification | Active | `pan-verifier.md` | Exists/Substantive/Wired/Functional |
| 8-dimension plan check | Active | `pan-plan-checker.md` | Quality gate before execution |
| Health check system | Active | `verify.cjs` (E001-E007, W001-W007) | Infrastructure for standards checks |
| Commit safety checks | Active | `core.cjs` | OWASP-like secret detection |
| Path safety protocol | Active | `focus-design.md` Phase 7.2 | Input validation standard |
| Requirements traceability | Active | `templates/requirements.md` | REQ-ID tracking |
| Config system | Active | `config.cjs` + `.planning/config.json` | Extension point for standards config |
| Error patterns | Active | `.planning/patterns.md` | Cross-session learning |

### 1.2 Key Integration Points

| Search Target | Location | Relevant Pattern |
|---------------|----------|------------------|
| Config loading | `config.cjs` | `loadConfig()` returns sections, `cmdConfigEnsureSection()` merges defaults |
| Health checks | `verify.cjs` | `cmdValidateHealth()` with E/W/I prefixed checks, repair support |
| Agent context | `workflows/*.md` | Agents read `.planning/` files; standards file would be auto-loaded |
| Verifier prompt | `agents/pan-verifier.md` | Could inject standards checklist section |
| Plan-checker prompt | `agents/pan-plan-checker.md` | Could add 9th dimension: standards compliance |
| Settings command | `commands/pan/settings.md` | Interactive config; add standards section |
| New-project flow | `commands/pan/new-project.md` | Project setup; add standards selection step |
| Init module | `init.cjs` | Phase initialization loads context files |
| Focus-design | `commands/pan/focus-design.md` | Phase 7 security; reference standards registry |

### 1.3 Convention Enforcement Checklist

- [x] Function naming: `cmd*` for CLI entry points, `check*` for validators
- [x] Safe read pattern: `safeReadFile()` from `core.cjs`
- [x] File writes: try-catch wrapped
- [x] JSON output: via `output()` from `core.cjs`
- [x] Errors: via `error()` from `core.cjs`
- [x] Path normalization: `toPosix()` from `utils.cjs`
- [x] Module exports at bottom
- [x] Subcommand routing via dispatcher pattern
- [x] CommonJS `.cjs` format
- [x] Zero runtime dependencies

### 1.4 Dependency & Integration Map

```
[Standards Integration]
    ├── depends on: config.cjs (loadConfig, cmdConfigEnsureSection)
    ├── depends on: core.cjs (safeReadFile, output, error)
    ├── depends on: constants.cjs (new STANDARDS_FILE constant)
    ├── depends on: verify.cjs (extends health checks)
    ├── extends: /pan:settings (standards selection)
    ├── extends: /pan:new-project (standards recommendation)
    ├── extends: /pan:health (--standards flag)
    ├── extends: pan-verifier (standards checklist injection)
    ├── extends: pan-plan-checker (9th dimension)
    ├── conflicts with: nothing
    └── enables: future compliance reporting, CI/CD integration
```

No circular dependencies introduced. Standards data flows one direction: config → registry file → agent context.

---

## Phase 2: Competitive Intelligence

### 2.1 How Competitor Tools Handle Standards

| Tool | Standards Approach | Mechanism | Strengths | Weaknesses |
|------|-------------------|-----------|-----------|------------|
| **Cursor** | `.cursorrules` instruction files | Static MDC files with OWASP/ASVS rules (community: Van-LLM-Crew, matank001) | Rich ecosystem of community rules | No built-in catalog; user must find/curate rules |
| **GitHub Copilot** | `.github/copilot-instructions.md` + native pattern blocking | Built-in insecure pattern detection + instruction file | Only tool with native blocking | Narrow pattern coverage; ~39% of generated code still has flaws |
| **Cline** | `.clinerules` instruction files | Static rule files | Flexible, community-driven | No standard selection; user must write rules |
| **Aider** | `.aider.conf.yml` conventions | Config-based instructions | Simple, straightforward | No standards awareness at all |
| **Windsurf** | Cascade rules | Workflow-level rules | Context-aware | No standards framework |
| **Copilot Workspace** | No explicit standards | Task decomposition only | Good planning | No compliance awareness |

### 2.2 Industry Tools (Scanning-Focused)

| Tool | Standards Mapped | Presentation | Developer UX |
|------|-----------------|--------------|-------------|
| **SonarQube** | OWASP Top 10, ASVS, CWE Top 25, PCI DSS, STIG, CASA | Dedicated compliance dashboards, PDF reports | Rules tagged with standard metadata; inline visibility |
| **Semgrep** | OWASP Top 10, CWE Top 25, OWASP Mobile | 4,000+ rules organized by standard | Registry with language + OWASP category filtering |
| **Snyk** | SOC 2, ISO 27001, PCI DSS, OWASP Top 10, OWASP SAMM | Compliance dashboard, PR integration | Automated scanning with standard-tagged findings |
| **CodeQL** | CWE Top 25, OWASP categories, WASC | Queries organized by CWE directory | Findings as GitHub alerts with CWE references |

### 2.3 Community Initiatives

| Initiative | What It Does | Relevance |
|-----------|-------------|-----------|
| **Secure Code Warrior AI Security Rules** | Open-source rules for 6 AI tools (OWASP-mapped) | First cross-tool standard; could be a catalog source |
| **OpenSSF Security Guide for AI Assistants** | Instruction file template covering input validation, supply chain, secrets | Template we could adopt/reference |
| **R.A.I.L.G.U.A.R.D** (Cloud Security Alliance) | Cursor-specific secure coding framework | Framework methodology applicable to PAN |

### 2.4 Competitive Matrix

| Aspect | PAN (Current) | PAN (Proposed) | Cursor | Copilot | SonarQube |
|--------|--------------|----------------|--------|---------|-----------|
| Standards catalog | None | 8-12 built-in | Community rules | None | 6+ standards |
| Project-type recommendations | None | Auto-suggest | None | None | None |
| Agent context injection | N/A | Standards in every agent | Rules in system prompt | Instructions file | N/A |
| Compliance reporting | None | health --standards | None | None | PDF dashboards |
| Cross-tool support | 5 runtimes | 5 runtimes | Cursor only | Copilot only | Any CI/CD |
| Selection UX | N/A | Interactive in settings | Manual file editing | Manual file editing | Admin console |
| Planning integration | None | Planner + verifier | None | None | N/A |
| Verification integration | None | Verifier checklist | None | None | Quality gates |

**Gap identified:** No AI coding tool provides *standards selection with planning and verification integration*. They all either do instruction files (static) or scanning (reactive). PAN can be first to provide *proactive standards guidance throughout the workflow*.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Eliminate the need to manually write security rules; eliminate "hope-based compliance" where standards are followed only when remembered |
| **REDUCE** | What should be reduced? | Reduce the friction of standards adoption from "research + write rules + configure CI" to "select from menu during project setup" |
| **RAISE** | What should be raised? | Raise standards from static instruction files to dynamic context that flows through planning, execution, AND verification |
| **CREATE** | What should we create? | Create project-type-aware standards recommendations; create verification-integrated compliance reporting; create the first standards-aware AI workflow system |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                  ^                ^
                  |                |
          Standards in         SAST/DAST
          AI workflows          scanning
```

- **Industry position:** Standards in AI coding workflows are at Genesis/Custom-Built. Every team writes their own `.cursorrules`. No product-grade solution exists.
- **PAN position:** We should be the first Product-grade implementation — a curated catalog with intelligent recommendations.
- **2-3 year evolution:** Standards integration will become expected in all AI workflow tools. First-mover advantage is real.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Standards as context in every agent — not static rules, dynamic guidance | 5 |
| **Cross-Platform** | Standards work identically across all 5 runtimes | 4 |
| **Developer Experience** | Select standards from menu → automatic enforcement throughout workflow | 5 |
| **Zero Dependencies** | Pure JS standards catalog, no external tools required | 5 |
| **State Persistence** | standards.md persists across sessions, agents always see it | 4 |
| **Verification Quality** | Verifier checks actual deliverables against selected standards | 5 |
| **Total** | | **28/30** |

### 3.4 Strategic Recommendation

**Yes, build this.** PAN's unique angle is *standards as workflow context* — not scanning code (SonarQube does that) and not writing static rule files (community does that). PAN should be the first tool to make standards selection as easy as choosing a model profile, then automatically flow those standards through every agent interaction: researchers investigate standard-compliant patterns, planners include standard checks in tasks, executors follow standard guidance, and verifiers validate against standard criteria. Do NOT copy the "instruction file" approach (static, forgotten). Do NOT try to build a scanner (wrong tool for the job). Do recommend external scanning tools (Semgrep, SonarQube) in the standards report output. Build now — the "vibe coding" security discourse has created a window of attention.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

| Type | Applies | Description |
|------|---------|-------------|
| **Core Enhancement** | Yes | Add `standards.cjs` module (or extend `config.cjs`) |
| **New Command** | No | No new commands — extend existing `/pan:settings` and `/pan:health` |
| **Agent Enhancement** | Yes | Inject standards context into verifier and plan-checker prompts |
| **Workflow Enhancement** | Yes | `new-project.md` gains standards selection step |
| **Installer Enhancement** | No | Standards are project-level, not runtime-level |
| **Template Enhancement** | Yes | New `standards.md` template |

### 3.5.2 Layer Violation Check

- [x] Command files invoke CLI (`pan-tools standards ...`) — not direct module calls
- [x] Core module (`config.cjs` or new `standards.cjs`) returns data — no agent imports
- [x] `output()` only from `cmd*` entry points
- [x] No upward dependencies

### 3.5.3 Output Contract Design

**`pan-tools standards list`** — List available standards catalog
```json
{
  "standards": [
    {
      "id": "owasp-top10",
      "name": "OWASP Top 10 (2025)",
      "category": "security",
      "description": "Top 10 web application security risks",
      "applicable_to": ["web", "api", "all"],
      "level": "foundational",
      "url": "https://owasp.org/www-project-top-ten/"
    }
  ],
  "count": 12
}
```

**`pan-tools standards status`** — Report project standards compliance
```json
{
  "project_standards": ["owasp-top10", "wcag-22"],
  "checks": [
    {
      "standard_id": "owasp-top10",
      "standard_name": "OWASP Top 10 (2025)",
      "status": "configured",
      "checklist_items": 10,
      "verified_items": 0,
      "coverage": "0%"
    }
  ],
  "overall_status": "configured"
}
```

**`pan-tools standards select <id>`** — Add standard to project
```json
{
  "added": "owasp-top10",
  "project_standards": ["owasp-top10"],
  "standards_file": ".planning/standards.md"
}
```

**`pan-tools standards recommend`** — Recommend standards based on project.md
```json
{
  "project_type": "web-application",
  "recommendations": [
    { "id": "owasp-top10", "reason": "Web application detected", "priority": "high" },
    { "id": "wcag-22", "reason": "User-facing UI detected", "priority": "medium" }
  ]
}
```

### 3.5.4 State Transition Modeling

| Current State | Action | New State | Error If Invalid |
|--------------|--------|-----------|-----------------|
| No standards.md | `standards select owasp-top10` | standards.md created with OWASP section | — |
| standards.md exists | `standards select wcag-22` | standards.md updated, WCAG section appended | — |
| standards.md with standard X | `standards remove X` | Section removed from standards.md | "Standard X not in project" |
| No project.md | `standards recommend` | Error | "project.md required for recommendations" |

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | No — new subcommand output, existing untouched |
| Changes file formats? | No — adds new optional file (standards.md) |
| Changes directory structure? | No — standards.md lives in existing `.planning/` |
| Changes installer output? | No |

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| Output feeds another command's input | Yes | `standards recommend` feeds `standards select` |
| Callable from an agent | Yes | Agents call `pan-tools standards status` for context |
| Usable in a hook pipeline | Yes | Post-execution hook could check `standards status` |
| Works in --raw mode | Yes | Human-readable table for `standards list` and `standards status` |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| Load catalog (in-memory JS object) | ~1ms | Static data, no file I/O |
| Read standards.md | ~5ms | Single file read |
| Read project.md (for recommendations) | ~5ms | Single file read |
| Parse standards sections | ~2ms | Regex/string matching |
| Write standards.md | ~5ms | Single file write |
| **Total** | **< 20ms** | Well under 500ms budget |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| Windows | No path issues — standards.md is a single file in .planning/ |
| Mac/Linux | No issues |
| All runtimes | Standards catalog is embedded in JS, works everywhere |
| All runtimes | standards.md is plain Markdown, readable by all AI tools |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**Standards Integration** lets you tell PAN which industry standards your project should follow. Instead of hoping Claude remembers to check for SQL injection or accessibility, you select your standards once and PAN automatically includes them in every planning, execution, and verification step.

**Example 1: Web Application Setup**
```
/pan:new-project
...
> PAN recommends: OWASP Top 10, WCAG 2.2, OWASP ASVS Level 1
> Select standards to apply: [1] All recommended  [2] Choose manually  [3] Skip
```
Select "All recommended" and every plan will include security and accessibility checks. The verifier will flag if your deliverables skip OWASP requirements.

**Example 2: Adding Standards Later**
```
/pan:settings
> Standards: Select project standards
> Available: OWASP Top 10, WCAG 2.2, NIST SSDF, ISO 25010, ...
> Currently selected: (none)
> Add: owasp-top10, wcag-22
```

**Example 3: Checking Compliance**
```
/pan:health --standards
Standards Compliance Report
| Standard | Status | Verified | Coverage |
|----------|--------|----------|----------|
| OWASP Top 10 | configured | 3/10 | 30% |
| WCAG 2.2 | configured | 0/4 | 0% |
```

**What it does NOT do:**
- Does NOT run SAST/DAST scanning (use Semgrep, SonarQube for that)
- Does NOT certify compliance (PAN guides, it doesn't audit)
- Does NOT enforce standards as blocking gates (advisory, not mandatory)
- Does NOT replace dedicated security tools

### 4.2 Reference-Level Explanation

#### 4.2.1 Command Interface

```
pan-tools standards list [--category <cat>]
pan-tools standards recommend [--cwd <path>]
pan-tools standards select <id> [--cwd <path>]
pan-tools standards remove <id> [--cwd <path>]
pan-tools standards status [--cwd <path>]
```

All commands support `--raw` for human-readable output.

#### 4.2.2 State Changes & Filesystem Scope

```
Reads from:
  .planning/standards.md (standards registry)
  .planning/project.md (for recommend)
  .planning/config.json (standards config section)

Writes to:
  .planning/standards.md (select/remove)

State mutations: standards.md content
Side effects: None (no git operations, no directory creation)
```

#### 4.2.3 Error Handling

| Condition | JSON Output | Error Style |
|-----------|-------------|-------------|
| No .planning/ dir | `{"error": ".planning directory not found"}` | Safe read returns null |
| Unknown standard ID | `{"error": "Unknown standard: xyz. Run 'standards list' to see available"}` | Arg validation |
| Standard already selected | `{"error": "owasp-top10 already in project standards"}` | Duplicate check |
| No project.md for recommend | `{"error": "project.md required for standards recommendations"}` | Missing dependency |

### 4.3 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy |
|----------|-------------|-----------|---------------------|
| Standards as Markdown file | PAN's own roadmap.md/state.md pattern | Agents read .planning/ files naturally; no special loading needed | Not JSON config (agents prefer markdown context) |
| Built-in catalog (not user-defined) | SonarQube's curated rule sets | Quality control — each standard has verified checklist items | Not open-ended user rules (Cursor approach — too much friction) |
| Advisory not blocking | PAN's health check model (W warnings, not E errors) | Standards violations should inform, not break workflow | Not quality gates (SonarQube approach — too rigid for AI workflows) |
| Project-type recommendations | Snyk's compliance dashboard | Reduces selection friction; users don't need to know the catalog | Not manual-only selection (misses the opportunity to guide) |
| Context injection via file | PAN's existing context engineering | standards.md in .planning/ is automatically visible to agents | Not prompt modification (would require changing every agent file) |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback |
|----------------|--------|------------|---------|----------|
| Storage format | standards.md | config.json section | Agents read markdown naturally; JSON needs parsing in prompts | Slightly more complex to parse programmatically |
| Catalog location | Embedded in JS module | External JSON file | Zero-dep, no file I/O needed | Catalog updates require code changes |
| Checklist granularity | Per-standard (10 items for OWASP T10) | Per-item (one line per CWE) | Too granular overwhelms agents; per-standard is right abstraction | Less precise than CWE-level tracking |
| Integration depth | Context injection + health reporting | Deep agent prompt modification | Minimally invasive; doesn't break existing agent behavior | Standards guidance is suggestive, not enforced |

### 4.5 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Standards catalog, select/remove, standards.md generation, `health --standards` | User can select standards and see compliance status | M (4 pts) |
| **v1 (Complete)** | Project-type recommendations, agent context injection (verifier + plan-checker), settings integration | Standards automatically flow through entire workflow | L (10 pts) |
| **v2 (Enhanced)** | Per-phase compliance tracking, verification-integrated checklist, external tool recommendations, focus-design standards auto-reference | Full lifecycle standards governance | L (10 pts) |

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | During `/pan:new-project` (prompted to select standards), or via `/pan:help` which lists standards subcommands |
| What's the learning curve? | Near-zero — select from a menu, then forget about it. Standards work automatically. |
| Does it require changing existing workflows? | No — standards are optional and additive. Existing workflows unchanged if no standards selected. |
| What's the "aha moment"? | When the verifier reports "OWASP A01 (Broken Access Control) not addressed in Phase 3 deliverables" — standards are working for you automatically |

---

## Phase 5: Architecture Decision Record

See: `docs/decisions/ADR-0010-standards-integration.md`

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection | Recovery | User Sees |
|-------------|----------|-----------|----------|-----------|
| Missing .planning/ directory | User error | safeReadFile returns null | JSON error with hint | "Run /pan:new-project first" |
| Unknown standard ID | User error | Catalog lookup miss | JSON error listing valid IDs | "Unknown standard: xyz. Run 'standards list'" |
| Corrupt standards.md | Data corruption | Parse failure in try-catch | Return degraded status, suggest regeneration | "standards.md parse error — run 'standards select' to regenerate" |
| Duplicate selection | User error | Check before write | JSON error | "owasp-top10 already selected" |
| standards.md write failure | Environment | try-catch on writeFileSync | JSON error | "Failed to write standards.md" |
| project.md missing for recommend | Missing dependency | safeReadFile returns null | JSON error | "project.md required for recommendations" |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| `--raw` flag | Human-readable table output | Debugging, quick checks |
| `--verbose` flag | Logs file reads and catalog lookups to stderr | Deep debugging |
| `standards status` | Full compliance report | Anytime |
| `health --standards` | Standards as part of overall health | Regular health checks |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface Inventory

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| `.planning/standards.md` | Read/Write | System-generated, user-editable |
| `.planning/project.md` | Read only | User-generated |
| `.planning/config.json` | Read/Write (standards section) | System-generated |
| Standards catalog (in-memory) | Read only | Hardcoded in module |

| Input Vector | Source | Validation Required |
|-------------|--------|-------------------|
| Standard ID argument | User-typed CLI | Must match catalog entry exactly |
| `--category` filter | User-typed CLI | Must match known categories |
| standards.md content | Disk | Structure validation on parse |

### 7.2 Path Safety

No user-supplied paths beyond `--cwd`. All file operations within `.planning/` directory. No path traversal risk.

### 7.3 Output Sanitization

- [x] No absolute filesystem paths in output
- [x] No environment variable values
- [x] No stack traces
- [x] No internal function names
- [x] Standard URLs are hardcoded constants, not user input

### 7.4 Content Validation

- standards.md: Parse with section header regex, validate against known standard IDs
- config.json: Standard JSON.parse() in try-catch (existing pattern in loadConfig)
- Standard IDs: Strict allowlist validation against catalog

### 7.5 Privilege Scope Declaration

```
Reads from: .planning/ (standards.md, project.md, config.json)
Writes to: .planning/ (standards.md, config.json)
Executes shell: No
Reads outside project: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 Standards Catalog (Built-in)

```javascript
const STANDARDS_CATALOG = {
  'owasp-top10': {
    name: 'OWASP Top 10 (2025)',
    category: 'security',
    description: 'Top 10 web application security risks',
    applicable_to: ['web', 'api', 'all'],
    level: 'foundational',
    url: 'https://owasp.org/www-project-top-ten/',
    checklist: [
      'A01: Broken Access Control — verify authorization checks on all endpoints',
      'A02: Cryptographic Failures — verify sensitive data encryption at rest and in transit',
      'A03: Injection — verify input validation and parameterized queries',
      'A04: Insecure Design — verify threat modeling and secure design patterns',
      'A05: Security Misconfiguration — verify default credentials removed, headers set',
      'A06: Vulnerable Components — verify dependency scanning, no known CVEs',
      'A07: Authentication Failures — verify MFA, session management, credential storage',
      'A08: Software and Data Integrity — verify CI/CD pipeline integrity, signed updates',
      'A09: Logging and Monitoring — verify security events logged, alerts configured',
      'A10: SSRF — verify server-side request validation, allowlists'
    ]
  },
  'owasp-asvs-l1': { ... },
  'owasp-llm-top10': { ... },
  'wcag-22': { ... },
  'nist-ssdf': { ... },
  'iso-25010': { ... },
  'stride': { ... },
  'cwe-top25': { ... },
  'owasp-agentic-top10': { ... },
  'soc2-dev': { ... },
  'togaf-adm': { ... },
  'conventional-commits': { ... }
};
```

### 8.2 Implementation Tasks

#### Task 1: Add standards constants and catalog to constants.cjs
Files: `pan-wizard-core/bin/lib/constants.cjs`
Test: `node --test tests/constants.test.cjs`
Estimate: S (2 pts)
Priority: P1

Add `STANDARDS_FILE = 'standards.md'`, `STANDARDS_CATALOG` object with 12 standards, category constants, recommendation mappings.

#### Task 2: Add standards subcommand handler in config.cjs (or new module)
Files: `pan-wizard-core/bin/lib/config.cjs`
Test: `node --test tests/config.test.cjs`
Estimate: M (4 pts)
Priority: P1

Implement `cmdStandardsList`, `cmdStandardsSelect`, `cmdStandardsRemove`, `cmdStandardsStatus`, `cmdStandardsRecommend`. Each follows existing cmd* pattern.

#### Task 3: Add standards.md template
Files: `pan-wizard-core/templates/standards.md`
Test: Integration test verifies template rendered correctly
Estimate: XS (1 pt)
Priority: P1

Markdown template with section headers per selected standard, checklist items, and external tool recommendations.

#### Task 4: Add standards routing to pan-tools.cjs dispatcher
Files: `pan-wizard-core/bin/pan-tools.cjs`
Test: `node --test tests/commands.test.cjs`
Estimate: S (2 pts)
Priority: P1

Route `standards list|select|remove|status|recommend` to config.cjs handlers.

#### Task 5: Extend health command with --standards flag
Files: `pan-wizard-core/bin/lib/verify.cjs`
Test: `node --test tests/verify.test.cjs`
Estimate: S (2 pts)
Priority: P2

Add `checkStandardsCompliance()` check to health output when `--standards` flag is passed.

#### Task 6: Add standards unit tests
Files: `tests/standards.test.cjs` (new)
Test: `node --test tests/standards.test.cjs`
Estimate: M (4 pts)
Priority: P2

Unit tests for catalog lookup, select/remove operations, standards.md generation/parsing, status reporting, recommendation logic.

#### Task 7: Add standards integration tests
Files: `tests/standards.test.cjs`
Test: `node --test tests/standards.test.cjs`
Estimate: S (2 pts)
Priority: P2

CLI integration tests via `runPanTools('standards list')`, `runPanTools('standards select owasp-top10')`, etc.

#### Task 8: Update agent prompts for standards awareness (v1)
Files: `agents/pan-verifier.md`, `agents/pan-plan-checker.md`
Test: Manual verification
Estimate: S (2 pts)
Priority: P3

Add conditional sections: "If .planning/standards.md exists, verify deliverables against listed standards checklist items."

#### Task 9: Update settings command for standards selection (v1)
Files: `commands/pan/settings.md`
Test: Manual verification
Estimate: XS (1 pt)
Priority: P3

Add standards selection option to settings interactive flow.

#### Task 10: Update new-project workflow for standards recommendation (v1)
Files: `pan-wizard-core/workflows/new-project.md`
Test: Manual verification
Estimate: XS (1 pt)
Priority: P3

Add step after requirements: "Run `pan-tools standards recommend` and present recommendations to user."

#### Task 11: Documentation updates
Files: `README.md`, `docs/USER-GUIDE.md`, `docs/CLI-REFERENCE.md`, `CHANGELOG.md`
Test: Focus-sync verification
Estimate: S (2 pts)
Priority: P4

Document standards subcommands, catalog, and workflow integration.

### 8.3 Dependency Graph

```
Task 1 (constants) ──→ Task 2 (handlers) ──→ Task 4 (dispatcher) ──→ Task 6 (unit tests)
                   └──→ Task 3 (template) ──→ Task 7 (integration tests)
Task 4 ──→ Task 5 (health extension)
Task 2 ──→ Task 8 (agent prompts)    [v1]
Task 4 ──→ Task 9 (settings)          [v1]
Task 4 ──→ Task 10 (new-project)      [v1]
Task 7 ──→ Task 11 (docs)
```

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Standards catalog becomes stale | Medium | Low | Catalog entries include version + URL; update in minor releases |
| Agent context overload | Low | Medium | Limit injected context to selected standards only; keep checklists concise (10 items max per standard) |
| Users confused by advisory-only model | Low | Low | Clear messaging: "PAN guides, external tools scan" |
| Checklist items too generic to be useful | Medium | Medium | Each item is actionable ("verify X" not "consider Y"); community feedback loop |

### 8.5 Cognitive Complexity Budget

- `cmdStandardsList`: ~15 lines (filter + map catalog)
- `cmdStandardsSelect`: ~30 lines (validate + read/write standards.md)
- `cmdStandardsRemove`: ~25 lines (validate + read/filter/write)
- `cmdStandardsStatus`: ~35 lines (read + parse + count)
- `cmdStandardsRecommend`: ~40 lines (read project.md + match patterns + suggest)
- All under 50-line limit, max 2 nesting levels, max 3 parameters

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Count | What It Catches |
|-------|---------|-------|-----------------|
| **Unit** | Test catalog, parsing, selection logic | 8+ | Catalog correctness, ID validation, parse errors |
| **Integration** | CLI `runPanTools('standards ...')` with real fs | 8+ | Arg routing, JSON output shape, file I/O |
| **E2E** | Multi-command: select → status → health | 2+ | State transitions, cross-command interaction |

### 9.2 Assertion Density

**Success tests:**
- (a) Correct JSON shape (has expected keys)
- (b) Correct values for >= 2 fields
- (c) No `error` field

**Error tests:**
- (a) `error` field with actionable message
- (b) No file corruption (standards.md unchanged on error)
- (c) Clean exit

### 9.3 Boundary Value Analysis

- [x] Empty project (no .planning/) — error with hint
- [x] Project with no standards selected — status returns empty list
- [x] Select all 12 standards — verify no performance impact
- [x] Select same standard twice — duplicate error
- [x] Remove non-existent standard — error
- [x] Corrupted standards.md — graceful degradation
- [x] Recommend with minimal project.md — returns generic recommendations
- [x] Unknown standard ID — error listing valid IDs

### 9.4 Regression Verification

- [x] Full suite (1065 tests) passes unchanged
- [x] config.test.cjs still passes (if extending config.cjs)
- [x] verify.test.cjs still passes (if extending verify.cjs)
- [x] No existing test expectations changed

### 9.5 Performance Validation

- [x] `standards list`: < 10ms (in-memory catalog)
- [x] `standards select`: < 20ms (read + write)
- [x] `standards status`: < 20ms (read + parse)
- [x] `standards recommend`: < 30ms (read project.md + match)
- [x] No regression in full test suite runtime

---

## Phase 10: Summary

### Problem & Evidence
AI-generated code has 25-45% security flaw rates. No AI workflow tool provides standards selection with planning + verification integration. PAN already has the infrastructure (health checks, verification, config system) — this connects the dots.

### Strategic Assessment
- **Blue Ocean:** CREATE standards-aware AI workflow (first mover)
- **Wardley:** Genesis → Product positioning (ahead of market)
- **Moat Score:** 28/30
- **Cognitive Load:** +0 commands, +1 concept — neutral
- **Recommendation:** BUILD — unique angle is standards as dynamic workflow context, not static rules

### Design Summary
- 12-standard built-in catalog (OWASP Top 10, ASVS L1, LLM Top 10, WCAG 2.2, NIST SSDF, ISO 25010, STRIDE, CWE Top 25, OWASP Agentic, SOC 2 Dev, TOGAF ADM, Conventional Commits)
- `.planning/standards.md` as persistent registry
- 5 subcommands: `list`, `select`, `remove`, `status`, `recommend`
- Agent context injection (verifier + plan-checker)
- Health command extension (`--standards`)
- Advisory model (guides, doesn't block)

### Feature Ladder
| Version | Effort | Value |
|---------|--------|-------|
| v0 MVP | M (4 pts) | Catalog + select/remove + standards.md + status |
| v1 Complete | L (10 pts) | Agent injection + settings + new-project + health |
| v2 Enhanced | L (10 pts) | Per-phase tracking + verification checklists + external tool recs |

### Implementation Tasks (11 tasks, ~23 points total)
Tasks 1-4 (v0 MVP): 9 pts — catalog, handlers, template, dispatcher
Tasks 5-7 (v0 tests + health): 8 pts — health extension, unit + integration tests
Tasks 8-10 (v1 agent/workflow): 4 pts — verifier, plan-checker, settings, new-project
Task 11 (docs): 2 pts — README, USER-GUIDE, CLI-REF, CHANGELOG

### Security Assessment
Minimal attack surface — reads/writes only within `.planning/`, standard IDs validated against allowlist, no shell execution, no external network calls. Low risk.

### Adoption Analysis
- Discovery: During `/pan:new-project` (prompted) or `/pan:help`
- Learning curve: Near-zero (select from menu)
- Workflow change: None required (additive, optional)
- Aha moment: Verifier catches a security gap you would have missed

### Next Steps
1. Run `/pan:focus-plan` to create execution batch from these tasks
2. Implement v0 MVP first (Tasks 1-4)
3. Add tests (Tasks 6-7) to verify
4. Iterate to v1 with agent integration (Tasks 8-10)
