# ADR-0020: AI Drift Prevention System

## Status
Proposed

## Context
AI coding assistants gradually deviate from project conventions during extended sessions ("AI drift"). This manifests as wrong patterns (console.log instead of output()), forgotten naming conventions, scope creep, and lost project state. PAN Wizard already has the strongest drift prevention infrastructure in the market — state tracking, deviation rules, verification, cross-session resume — but lacks active enforcement and quantitative measurement. No competitor tool (Aider, Cursor, Cline, Windsurf, Copilot WS) offers built-in drift scoring. The industry is shifting from code generation speed to code quality in 2026, making this strategically timed.

## Decision
Add a `drift-check` command to pan-tools that:
1. Loads convention rules from `.planning/codebase/CONVENTIONS.md` and `CLAUDE.md`
2. Parses conventions into matchable rules (regex patterns, anti-patterns)
3. Diffs changed files (via `git diff --name-only`) against those rules
4. Produces a quantitative Drift Score (0.0-1.0) with per-file violations
5. Outputs JSON with violations, scores, and human-readable summary

Implementation is zero-dependency (regex-based matching), read-only (no code modification), and fast (<200ms). Built-in convention rules cover PAN Wizard's own patterns. Custom rules loaded from project-specific CONVENTIONS.md.

### v0 (MVP): `drift-check` command + rule parser + scoring (20 points)
### v1: Pre-commit hook + health --drift + verify integration (16 points)
### v2: Cross-session trends + auto-discovery + custom rule DSL (30 points)

## Consequences

### Positive
- PAN becomes the only tool with quantitative drift measurement
- Convention enforcement moves from passive (advisory) to active (measurable)
- Builds on existing infrastructure (verify.cjs, standards system, git integration)
- Zero new dependencies
- Enables cross-session drift trend analysis (v2)

### Negative
- Regex-based matching has false positive risk (mitigated by severity levels and thresholds)
- Requires `.planning/codebase/CONVENTIONS.md` to exist for custom rules (built-in rules as fallback)
- Convention parsing from markdown is heuristic, not semantic (mitigated by structured format)

### Neutral
- Adds one new pan-tools subcommand (`drift-check`)
- Read-only — no state mutations in v0
- Optional integration — doesn't change existing command behavior

## Options Considered

1. **External tool integration (CodeScene/SonarQube)** — Rejected: adds dependencies, SaaS lock-in, violates zero-dep principle
2. **AST-based analysis** — Rejected: requires parser dependencies (acorn, etc.), too heavyweight for convention checking
3. **Regex-based convention matching (chosen)** — Zero deps, fast, sufficient accuracy for convention-level checking
4. **Human-in-the-loop only (Cline model)** — Rejected: too much friction, doesn't scale to autonomous execution
5. **No action (status quo)** — Rejected: competitive gap, user-stated need, strategic timing

## Links
- Spec: `docs/specs/ai_drift_prevention_featureai.md`
- Related: verify.cjs (validation infrastructure)
- Related: config.cjs (standards system)
- Related: ADR-0010 (standards integration)
- Related: ADR-0014 (internal cleanup/code quality)
