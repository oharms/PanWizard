# Attribution & Influence Index

A complete record of every methodology, standard, tool, research finding, and external idea that influenced PAN Wizard's design. Each entry is cross-referenced to the specific file where it's used.

---

## Ancestor Project

PAN Wizard was derived from **Get Shit Done (GSD)**, an earlier workflow automation system that established the foundational architecture:

| GSD Component | Evolved Into | What Changed |
|---------------|-------------|-------------|
| `gsd-tools.cjs` dispatcher | `pan-tools.cjs` | Same dispatch pattern, expanded command set |
| 11 core modules (`commands`, `config`, `core`, `frontmatter`, `init`, `milestone`, `phase`, `roadmap`, `state`, `template`, `verify`) | 24 core modules (through v3.4.0) | Added `constants`, `context-budget`, `focus`, `utils`, `codebase`, `memory`, `bus`, `cost`, `preview`, `review-deep`, `knowledge`, `whatif`, `bridge` |
| 11 `gsd-*` agents | 18 `pan-*` agents (through v3.4.0) | Added specialized agents for verification, review, research, previewing, hardening, knowledge, counterfactual exploration, and hierarchical orchestration |
| 32 `/gsd:*` slash commands | 48 `/pan:*` slash commands (through v3.4.0) | Added focus commands, standards, settings, Spec B v2 commands (cost, preview, review-deep, knowledge, what-if, mcp-bridge) |
| Claude Code only | 5 runtimes | Added OpenCode, Gemini, Codex, Copilot CLI |
| Single install target | Per-runtime converters | TOML (Gemini), skills (Codex/Copilot), tool name mapping |

GSD's core design decisions — phase-scoped fresh context windows, the command/agent/core layered architecture, state persistence via markdown files, and the research-plan-verify loop — all carry forward into PAN Wizard.

---

## Strategic Methodologies

| Methodology | Origin | Used In | Purpose |
|------------|--------|---------|---------|
| Blue Ocean Strategy | W. Chan Kim & Renee Mauborgne (2004) | [focus-design.md](commands/pan/focus-design.md) Phase 3.1 | Four Actions Framework for competitive differentiation |
| Wardley Mapping | Simon Wardley (2005) | [focus-design.md](commands/pan/focus-design.md) Phase 3.2 | Value chain evolution assessment for feature positioning |
| STRIDE Threat Modeling | Microsoft — Loren Kohnfelder & Praerit Garg (1999) | [focus-design.md](commands/pan/focus-design.md) Phase 7 | Lightweight security threat identification |
| TOGAF ADM | The Open Group | [ADR-0008](docs/decisions/ADR-0008-map-codebase-mermaid-togaf.md), map-codebase templates | Architecture domain alignment (Business, Application, Data, Technology) |
| Spec-Driven Development | Industry practice | [focus-design.md](commands/pan/focus-design.md) pipeline | Feature specification before implementation |
| Architecture Decision Records | Michael Nygard (2011) | [docs/decisions/](docs/decisions/) | Documenting significant architectural choices with context and consequences |

## Industry Standards (12-Standard Catalog)

Integrated into the `standards` command system. See [ADR-0010](docs/decisions/ADR-0010-standards-integration.md) and [standards spec](docs/specs/standards_integration_featureai.md).

| Standard | Governing Body | Category | Checklist Items |
|----------|---------------|----------|-----------------|
| OWASP Top 10 (2025) | OWASP Foundation | Security | 10 |
| OWASP ASVS Level 1 | OWASP Foundation | Security | 8 |
| OWASP LLM Top 10 | OWASP Foundation | AI Security | 10 |
| OWASP Agentic Top 10 | OWASP Foundation | AI Security | 10 |
| WCAG 2.2 | W3C / WAI | Accessibility | 4 |
| NIST SSDF (SP 800-218A) | NIST (US) | Secure Development | 8 |
| ISO 25010 | ISO/IEC | Software Quality | 8 |
| STRIDE | Microsoft | Threat Modeling | 6 |
| CWE Top 25 | MITRE | Vulnerability Classification | 10 |
| SOC 2 Dev Controls | AICPA | Compliance | 6 |
| TOGAF ADM | The Open Group | Architecture | 6 |
| Conventional Commits | conventionalcommits.org | Commit Standards | 5 |

## Competing Tools Analyzed

Detailed comparison in [COMPARISON.md](docs/COMPARISON.md). Competitive analysis performed during feature specs.

| Tool | What We Learned | Referenced In |
|------|----------------|---------------|
| Aider | Auto-commit per edit, repo map context strategy | [COMPARISON.md](docs/COMPARISON.md), [focus-design.md](commands/pan/focus-design.md) Phase 2 |
| Cursor | Embeddings-based indexing, .cursorrules, multi-agent (8 parallel) | [COMPARISON.md](docs/COMPARISON.md), [industry comparison spec](docs/specs/industry_comparison_and_feature_gaps_featureai.md) |
| Continue.dev | IDE extension model, context providers, slash commands | [COMPARISON.md](docs/COMPARISON.md), [focus-design.md](commands/pan/focus-design.md) Phase 2 |
| Cline | Separate plan/act modes with different model configs — inspired PAN's tier-based execution (MICRO/STANDARD/FULL) | [COMPARISON.md](docs/COMPARISON.md), [focus-commands spec](docs/specs/pan_focus_commands_featureai.md) |
| Windsurf | RAG + AST indexing, Wave multi-agent execution | [COMPARISON.md](docs/COMPARISON.md), [industry comparison spec](docs/specs/industry_comparison_and_feature_gaps_featureai.md) |
| GitHub Copilot Workspace | Task decomposition, plan-execute-verify pattern | [COMPARISON.md](docs/COMPARISON.md), [focus-design.md](commands/pan/focus-design.md) Phase 2 |
| Devin | Cloud IDE with sandbox execution, parallel agents | [COMPARISON.md](docs/COMPARISON.md) |
| Taskmaster AI | Task breakdown, prioritization (high/medium/low), dependency tracking, `next` command — same problem space as focus-scan | [focus-commands spec](docs/specs/pan_focus_commands_featureai.md) |

## Scanning & Quality Tools Referenced

Referenced in the standards integration research. PAN does not embed these tools but documents their standard support.

| Tool | Standards Supported | Referenced In |
|------|-------------------|---------------|
| SonarQube | OWASP Top 10, ASVS, CWE Top 25, PCI DSS | [standards spec](docs/specs/standards_integration_featureai.md) |
| Semgrep | 4000+ rules by standard (OWASP, CWE, OWASP Mobile) | [standards spec](docs/specs/standards_integration_featureai.md) |
| Snyk | SOC 2, ISO 27001, PCI DSS compliance dashboards | [standards spec](docs/specs/standards_integration_featureai.md) |
| CodeQL | CWE Top 25, OWASP categories | [standards spec](docs/specs/standards_integration_featureai.md) |

## Community Security Initiatives

| Initiative | What | Referenced In |
|-----------|------|---------------|
| Secure Code Warrior AI Security Rules | Cross-tool AI security rules for 6 platforms (June 2025) | [standards spec](docs/specs/standards_integration_featureai.md) |
| OpenSSF Security Guide for AI Assistants | Security-focused instruction guide for AI code assistants (Sep 2025) | [standards spec](docs/specs/standards_integration_featureai.md) |
| Cloud Security Alliance R.A.I.L.G.U.A.R.D | Cursor-specific secure coding framework | [standards spec](docs/specs/standards_integration_featureai.md) |

## Development Standards

| Standard | URL | Used In |
|----------|-----|---------|
| Semantic Versioning 2.0.0 | https://semver.org/spec/v2.0.0.html | [CHANGELOG.md](CHANGELOG.md) versioning |
| Keep a Changelog 1.0.0 | https://keepachangelog.com/en/1.0.0/ | [CHANGELOG.md](CHANGELOG.md) format |
| Contributor Covenant 2.0 | https://contributor-covenant.org/version/2/0/ | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| XDG Base Directory Spec | freedesktop.org | OpenCode runtime install paths (~/.config/opencode) |

## Cognitive Science

| Concept | Origin | Used In | Application |
|---------|--------|---------|-------------|
| Miller's Law (7 +/- 2) | George A. Miller (1956) | [ADR-0006](docs/decisions/ADR-0006-focus-commands.md) | Justified grouping 5 focus commands under single "Focus" name to reduce cognitive load |

## AI Security Research

| Finding | Sources | Referenced In |
|---------|---------|---------------|
| 24.7-45% of AI-generated code has security flaws | Multiple 2025-2026 academic studies | [standards spec](docs/specs/standards_integration_featureai.md) |
| 2.74x more vulnerabilities in AI-assisted PRs | 2025-2026 research | [standards spec](docs/specs/standards_integration_featureai.md) |
| "Vibe coding" security consensus: treat AI code as untrusted | Black Duck, Palo Alto Networks, Dark Reading | [standards spec](docs/specs/standards_integration_featureai.md) |

## Visualization Standards

| Standard | Why Chosen | Alternatives Rejected | Referenced In |
|----------|-----------|----------------------|---------------|
| Mermaid Diagrams | Text-based, GitHub-native rendering, zero runtime deps | PlantUML (requires Java), D2 (fewer renderers), PNG/SVG generation (adds mmdc dependency) | [ADR-0008](docs/decisions/ADR-0008-map-codebase-mermaid-togaf.md) |

Diagram types implemented: Flowchart, Sequence, ER, Quadrant chart.

## Build & CI Tooling

| Tool | Role | Why Chosen |
|------|------|-----------|
| @playwright/test | VSCode integration test driver (devDependency) | Standard automation harness |
| @vscode/test-electron | VSCode extension host for integration tests (devDependency) | Official VS Code test runner |
| GitHub Actions | CI/CD matrix (3 OS x 4 Node versions) | Native to GitHub hosting |
| node:test | Test framework | Built-in, zero dependency, Node 18+ |
| node:assert/strict | Assertions | Built-in, zero dependency |

Hooks ship as pure Node.js (`hooks/*.js` → `hooks/dist/` via a copy-only `build:hooks` script) — there is no bundler, so PAN carries no build-tool dependency for hooks.

## PAN Wizard Innovations

Ideas that originated within PAN Wizard (not borrowed from external sources):

| Innovation | What | Status |
|-----------|------|--------|
| Phase-scoped fresh context windows | 200K fresh context per phase prevents context rot | Unique to PAN — no competitor does this |
| Research-Plan-Verify loop | Dedicated researcher agents investigate domain before planning | Unique to PAN |
| Wave-based parallel agent execution | Multi-agent orchestration with dependency-aware parallelization | Pioneered by PAN, later adopted by Cursor 2.0, Windsurf Wave 13 |
| 5-runtime installer | Single `npx` command installs to Claude Code, OpenCode, Gemini, Codex, Copilot CLI | Unique to PAN — no competitor supports more than 1-2 runtimes |
| Zero runtime dependencies | Entire system runs on Node.js built-ins only | Architectural constraint, not found in competitors |
| Reality Score prioritization | Mathematical scoring formula for work item prioritization (UV, TC, RR, JS) | focus-scan command |
| Budget point system | Token-agnostic capacity planning (XS=1, S=2, M=4, L=10, XL=20) | [ADR-0003](docs/decisions/ADR-0003-smart-execution.md) |
| Advisory standards compliance | 12-standard catalog that advises without blocking | [ADR-0010](docs/decisions/ADR-0010-standards-integration.md) |

---

## ADR & Spec Index

Every Architecture Decision Record and feature specification, in chronological order:

### ADRs (docs/decisions/)

| ADR | Title | Key Influences |
|-----|-------|---------------|
| [ADR-0001](docs/decisions/ADR-0001-strategic-feature-prioritization.md) | Strategic Feature Prioritization | Competitive gap analysis |
| [ADR-0002](docs/decisions/ADR-0002-copilot-cli-runtime.md) | Copilot CLI Runtime Support | GitHub Copilot CLI GA (Feb 2026) |
| [ADR-0003](docs/decisions/ADR-0003-smart-execution.md) | Smart Execution System | Cline plan/act modes, budget point system |
| [ADR-0004](docs/decisions/ADR-0004-copilot-cli-interaction.md) | Copilot CLI Interaction Optimization | Copilot CLI interaction model |
| [ADR-0005](docs/decisions/ADR-0005-command-naming.md) | Command Naming Restructure | CLI usability best practices |
| [ADR-0006](docs/decisions/ADR-0006-focus-commands.md) | Focus Commands | Miller's Law, Taskmaster AI problem space |
| [ADR-0007](docs/decisions/ADR-0007-ship-v1.md) | Ship v1.0.0 | Production readiness checklist |
| [ADR-0008](docs/decisions/ADR-0008-map-codebase-mermaid-togaf.md) | Map Codebase with Mermaid + TOGAF | TOGAF ADM domains, Mermaid diagrams |
| [ADR-0009](docs/decisions/ADR-0009-production-deployment-checklist.md) | Production Deployment Checklist | npm publishing, SECURITY.md |
| [ADR-0010](docs/decisions/ADR-0010-standards-integration.md) | Standards Integration | OWASP, NIST, Secure Code Warrior, OpenSSF |
| [ADR-0011](docs/decisions/ADR-0011-help-commands-rewrite.md) | Help Commands Rewrite | CLI help UX patterns |
| [ADR-0012](docs/decisions/ADR-0012-contributors-attribution-index.md) | Contributors & Attribution Index | Open-source attribution norms |

### Feature Specs (docs/specs/)

| Spec | Feature | Key Research Sources |
|------|---------|---------------------|
| [industry_comparison_and_feature_gaps](docs/specs/industry_comparison_and_feature_gaps_featureai.md) | Competitive Analysis | Aider, Cursor, Cline, Windsurf, Continue.dev, Copilot WS, Devin |
| [copilot_cli_runtime](docs/specs/copilot_cli_runtime_featureai.md) | Copilot CLI Support | GitHub Copilot CLI docs, skill/agent format |
| [copilot_cli_interaction](docs/specs/copilot_cli_interaction_featureai.md) | Copilot CLI UX | Copilot CLI interaction patterns |
| [command_naming_optimization](docs/specs/command_naming_optimization_featureai.md) | Command Rename | CLI naming conventions |
| [pan_focus_commands](docs/specs/pan_focus_commands_featureai.md) | Focus Commands | Taskmaster AI, Claude Code Plan Mode, Cline tiers |
| [production_readiness_ship_v1](docs/specs/production_readiness_ship_v1_featureai.md) | v1.0.0 Release | npm publishing best practices |
| [map_codebase_mermaid_togaf](docs/specs/map_codebase_mermaid_togaf_featureai.md) | Codebase Mapping | TOGAF ADM, Mermaid diagram spec |
| [production_deployment_readiness](docs/specs/production_deployment_readiness_featureai.md) | Deployment Checklist | Production readiness patterns |
| [documentation_alignment_cleanup](docs/specs/documentation_alignment_cleanup_featureai.md) | Doc Sync | Internal doc consistency |
| [standards_integration](docs/specs/standards_integration_featureai.md) | Standards System | OWASP, NIST, Semgrep, SonarQube, Snyk, CodeQL, Secure Code Warrior, OpenSSF |
| [help_commands_rewrite](docs/specs/help_commands_rewrite_featureai.md) | Help Rewrite | CLI help patterns |
| [contributors_attribution_index](docs/specs/contributors_attribution_index_featureai.md) | This Feature | Git history, ADR/spec cross-reference |
