# ADR-0011: Help Document & Command Descriptions End-to-End Rewrite

## Status
Proposed

## Context

PAN Wizard v2.2.0 ships 37 user-facing slash commands across 5 AI coding runtimes (Claude Code, GitHub Copilot CLI, Gemini CLI, Codex, OpenCode). The `/pan:help` command outputs a 380-line static markdown reference that is the first thing every user sees when they try to learn PAN.

The current help has several problems:
1. **No progressive disclosure** — 380 lines dumped at once, mixing quick-reference tables with full flag documentation
2. **Jargon-heavy descriptions** — "wave-based parallelization", "conversational UAT", "Reality Score filtering" mean nothing to new users
3. **No entry point** — 37 commands presented with equal weight, no "start here" guidance
4. **Inconsistent frontmatter** — 5 Focus commands missing `pan:` prefix, `patches.md` missing `name` and `group` fields entirely
5. **8 groups with unbalanced sizes** — "Getting Started" (2 commands) and "Community" (2 commands) are too small to justify separate groups

Competitive research shows that GitHub Copilot CLI (GA Feb 2026) ships with 4 functional groups and clear progressive disclosure, while clig.dev CLI guidelines explicitly recommend categorical grouping and outcome-oriented descriptions — patterns PAN currently violates.

## Decision

Rewrite the help document and all 37 command descriptions using these principles:

1. **Progressive disclosure** — 3-tier structure: Quick Start decision tree (10 lines) → Grouped command tables (50 lines) → Detail sections (on demand)
2. **Outcome-oriented descriptions** — max 10 words, plain English, describe what the USER gets, not how the tool works internally
3. **5 groups** (from 8): Start & Plan, Build & Verify, Focus Pipeline, Milestones & Phases, Session & System
4. **Common Recipes section placed early** — the 8 most common workflows as copy-paste patterns, before the full command listing
5. **Fix all frontmatter inconsistencies** — add `pan:` prefix to 5 Focus commands, add missing fields to `patches.md`, standardize verbose argument-hints

Target: 175 lines (from 380), 54% reduction.

## Consequences

### Positive
- New users find the right command within 10 seconds
- Every description answers "what does this DO for me?" in plain English
- Consistent frontmatter across all 37 commands
- Competitive parity with Copilot CLI's help organization
- Reduced cognitive load (6 highlighted starter commands vs 37 equal-weight)

### Negative
- Existing users accustomed to 8-group structure must relearn the 5-group layout
- Condensing Focus Pipeline detail from 98 to 30 lines means users must consult USER-GUIDE for full flag documentation
- Some precision lost in shorter descriptions (mitigated by detail sections below the tables)

### Neutral
- No code changes — purely content work
- No test regressions — static markdown content
- Must propagate to 5 runtime directories (standard process)

## Options Considered

1. **Keep 8 groups, only rewrite descriptions** — Preserves familiar structure but doesn't address the core structural problem (no progressive disclosure, no entry point). Rejected: half-measure.

2. **Reduce to 5 groups + progressive disclosure + outcome descriptions (chosen)** — Addresses all identified problems. Best balance of comprehensiveness and scannability. Competitive with Copilot CLI's 4-group approach while accommodating PAN's 2-workflow model.

3. **Reduce to 3 groups (minimal)** — Too aggressive: would force unrelated commands together (milestones + debug + settings in one group). Rejected: loses semantic clarity.

4. **Add AI-powered interactive help** — Would require new module, runtime dependency on LLM call, significant implementation. Rejected: over-engineering for the current problem. Can be v3 enhancement.

## Links
- Spec: `docs/specs/help_commands_rewrite_featureai.md`
- Related: ADR-0005 (command naming), ADR-0006 (focus commands)
- Competitive research: Aider, Cursor, Continue.dev, Cline, Claude Code, GitHub Copilot CLI
- Industry guidelines: clig.dev CLI Interface Guidelines
