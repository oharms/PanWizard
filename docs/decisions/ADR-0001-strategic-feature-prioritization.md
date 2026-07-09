# ADR-0001: Strategic Feature Prioritization Based on Competitive Analysis

## Status
Partially Accepted — 3 of 5 features implemented (2026-02-28)

## Date
2026-02-28

## Context

PAN Wizard operates in a rapidly consolidating AI coding tool market. As of February 2026:

- **Cursor 2.0** shipped multi-agent (8 parallel), Mission Control, background agents, and Plan Mode
- **Windsurf Wave 13** added parallel multi-agent sessions, git worktrees, and Arena Mode
- **GitHub Copilot** launched agent mode with specialized sub-agents (Explore, Task, Code Review, Plan) and Copilot CLI (GA Feb 2026)
- **Devin 2.0** dropped pricing from $500/mo to $20/mo with interactive planning, Devin Search, and Devin Wiki
- **Cline** added CLI 2.0 with parallel agents and headless CI/CD mode
- **Continue.dev** pivoted to CI/CD background agents with shareable agent configurations

PAN Wizard pioneered many of these patterns (multi-agent orchestration, plan-verify loops, wave-based parallel execution) but competitors are closing the gap. The question is: what should PAN build next to maintain and extend its lead?

## Decision

**Prioritize features that make PAN's invisible strengths visible and address the primary limitation of phase-scoped execution (lack of cross-session learning), rather than copying competitor features that belong to the host tool layer.**

### Specifically:

1. **Context Budget Tracking** (P0) — Make context engineering visible — **DONE** (`context-budget.cjs`, `/pan:context-budget` command)
2. **Cross-Session Learning** (P1) — Extract patterns from completed phases — NOT STARTED
3. **Live Project Health Dashboard** (P1) — Quality + velocity + risk scoring — **PARTIAL** (`progress health` subcommand with A-D grading)
4. **Intelligent Phase Splitting** (P2) — Auto-decomposition based on context budget — NOT STARTED
5. **Comparison & Benchmark Command** (P2) — Honest, factual self-comparison — **DONE** (`docs/COMPARISON.md`, 8-tool × 18-dimension matrix)

### What we explicitly DO NOT build:

- **Browser testing** — Cline's territory. Not PAN's job
- **Autocomplete** — Host tool's job (Claude Code, OpenCode, etc.)
- **IDE-level codebase indexing** — Cursor/Windsurf's domain. PAN has `map-codebase` which is sufficient
- **Cloud sandboxed execution** — Devin's territory. PAN runs locally by design
- **Real-time collaboration** — Not aligned with CLI-first architecture

## Consequences

### Positive
- Context budget tracking makes PAN's #1 value prop (context rot prevention) tangible and measurable
- Cross-session learning addresses the most common criticism of fresh-context-per-phase architecture
- All features maintain zero-dependency constraint and cross-platform support (5 runtimes)
- All features are additive — no breaking changes to existing workflows
- Honest comparison command builds trust with evaluators

### Negative
- Static comparison data requires manual maintenance as competitors evolve rapidly
- Context quality scoring is a novel concept with no established methodology to validate against
- Cross-session patterns could become stale or misleading if not actively managed
- Not building browser testing or autocomplete means PAN remains dependent on host tool capabilities

### Neutral
- These features strengthen PAN's position as an orchestration layer, not an IDE replacement
- Compare command may be perceived as marketing rather than engineering (mitigated by factual framing)
- Phase splitting advisor is advisory, not automatic — users retain control

## Options Considered

### Option A: Copy Competitors (Rejected)
Add browser testing (from Cline), autocomplete (from Cursor), codebase indexing (from Windsurf).

**Why rejected:** Violates PAN's layered architecture. Duplicates host tool capabilities. Would require runtime dependencies (Puppeteer, embedding models). Would narrow cross-platform support. Increases maintenance burden without strengthening core moat.

### Option B: Focus on Visibility and Intelligence (Selected)
Make existing strengths visible (context budget), add intelligence (pattern learning, health scoring), and enable informed decomposition (phase splitting).

**Why selected:** Strengthens PAN's unique moat (context engineering) without scope creep. All features align with zero-dependency constraint. Each feature independently valuable. Clear implementation path through existing architecture.

### Option C: Do Nothing (Rejected)
Rely on existing differentiators and word-of-mouth.

**Why rejected:** Competitors are actively closing the gap on multi-agent execution and planning. PAN's lead is real but not visible to evaluators. Without context budget tracking, users can't see WHY PAN works better. Without cross-session learning, the fresh-context-per-phase design has a real limitation that needs addressing.

## Links
- Feature spec: `docs/specs/industry_comparison_and_feature_gaps_featureai.md`
- Related modules: all 14 core modules in `pan-wizard-core/bin/lib/`
- Related commands: `/pan:progress`, `/pan:health`, `/pan:plan-phase`, `/pan:execute-phase`
- Enables: v0.2.0 roadmap prioritization
