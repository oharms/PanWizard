# ADR-0010: Standards Integration

## Status
Proposed

## Context

PAN Wizard orchestrates AI-assisted development across 5 runtimes but has no systematic way for users to select and enforce industry standards (OWASP, NIST, WCAG, ISO 25010, etc.) throughout their workflow. Research shows 25-45% of AI-generated code contains security vulnerabilities (2025-2026 studies). The industry has responded with new standards (OWASP LLM Top 10 2025, OWASP Agentic Top 10 2026, NIST SP 800-218A, OpenSSF AI Code Assistant Guide), but no AI workflow tool integrates standards selection with planning and verification.

PAN already has the infrastructure: health checks (verify.cjs), 4-level verification (pan-verifier), 8-dimension plan checking (pan-plan-checker), config system (config.cjs), and STRIDE-lite in focus-design. What's missing is the connection — a way for users to declare which standards apply and have that declaration flow through every agent interaction.

Forces at play:
- AI-generated code vulnerability rates are high and well-documented
- No AI coding tool provides standards selection + verification integration
- PAN's existing architecture supports context injection via .planning/ files
- Users want "set once, enforced everywhere" — not manual reminders
- Standards should guide, not block (advisory model aligns with PAN's philosophy)
- Zero runtime dependencies must be maintained

## Decision

Add a standards integration system with:

1. **Built-in catalog** of 12 well-known standards (OWASP Top 10, ASVS L1, LLM Top 10, WCAG 2.2, NIST SSDF, ISO 25010, STRIDE, CWE Top 25, OWASP Agentic, SOC 2 Dev, TOGAF ADM, Conventional Commits)

2. **`.planning/standards.md`** as the persistent registry — a Markdown file in .planning/ that agents naturally read as context

3. **5 subcommands** under `pan-tools standards`: `list`, `select`, `remove`, `status`, `recommend`

4. **Project-type recommendations** based on project.md analysis (web app → OWASP, UI → WCAG, etc.)

5. **Agent context injection** — verifier and plan-checker gain standards-aware dimensions when standards.md exists

6. **Advisory model** — standards violations are reported as warnings, not blocking errors

Key design choices:
- Markdown file (not JSON config) because agents read .planning/ files naturally
- Built-in catalog (not user-defined rules) for quality control and zero-friction adoption
- Advisory (not blocking) to match PAN's health check philosophy
- No scanning (SonarQube/Semgrep do that) — PAN guides, external tools scan

## Consequences

### Positive
- PAN becomes the first AI workflow tool with standards-aware planning and verification
- Standards selection reduces to a menu choice during project setup
- Verifier catches standards gaps automatically
- Zero new runtime dependencies
- Existing workflows unchanged if no standards selected (fully additive)

### Negative
- Catalog maintenance burden — standards evolve, catalog needs periodic updates
- Advisory-only model may not satisfy compliance-heavy organizations
- Checklist items are necessarily high-level (10 items per standard, not CWE-granular)

### Neutral
- No new commands — extends existing settings, health, and agent prompts
- config.json gains optional `standards` section
- ADR count increases to 10

## Options Considered

1. **Static instruction files** (Cursor approach) — User writes security rules manually
   - Rejected: Too much friction, rules are forgotten, no verification loop

2. **Built-in SAST scanning** — PAN scans code for vulnerabilities
   - Rejected: Wrong tool for the job; SonarQube/Semgrep are specialized for this

3. **Standards as workflow context** (chosen) — Select from catalog, inject into agents, report in health
   - Chosen: Leverages PAN's architecture, minimal code, maximum impact

4. **External standards plugin system** — Users install standard packs
   - Rejected: Adds complexity, dependency management, breaks zero-dep promise

## Links
- Feature spec: `docs/specs/standards_integration_featureai.md`
- Related: ADR-0006 (Focus Commands — STRIDE-lite in focus-design)
- Related: ADR-0008 (Map Codebase — TOGAF alignment)
- Related: ADR-0003 (Smart Execution — commit safety checks)
