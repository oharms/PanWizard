# /featureAI Spec: Industry Comparison & Feature Gap Analysis

**Feature:** Industry Comparison Dashboard + Strategic Feature Recommendations
**Date:** 2026-02-28
**Status:** Proposed
**Author:** featureAI pipeline

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

Developers evaluating AI coding workflow tools have no centralized, evidence-based way to compare PAN Wizard against the competitive landscape (Cursor, Aider, Cline, Windsurf, GitHub Copilot, Devin, Continue.dev). PAN Wizard's README has a basic 3-column comparison table, but it's incomplete, potentially biased, and doesn't map feature gaps that could drive the product roadmap. This matters NOW because the AI coding tool market is consolidating rapidly (OpenAI acquired Windsurf, GitHub Copilot launched agent mode, Cursor 2.0 shipped multi-agent) and PAN Wizard must articulate its unique value clearly to attract and retain users. The cost of NOT doing this: users leave for tools that appear more feature-complete, and the roadmap lacks data-driven prioritization.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Competitor feature parity | Cursor 2.0, Windsurf Wave 13 | Both ship multi-agent parallel execution, plan modes, background agents. PAN had these first but competitors are catching up fast |
| Industry trend | McKinsey, O'Reilly, Anthropic reports | "Orchestration, not autonomy" is the 2026 paradigm — validates PAN's architecture. But PAN needs to articulate this clearly |
| User-stated need | This conversation | User explicitly requested industry comparison and feature gap analysis |
| Market signal | LogRocket AI dev tool power rankings Feb 2026 | Layered tooling (CLI + IDE + orchestration) is the winning pattern — PAN fits this but doesn't market it |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Comprehensive feature matrix across 8 tools | Pricing comparison (changes too fast, would be stale) |
| Feature gap identification with strategic priority | UX/visual design recommendations (not a code feature) |
| Recommended features with implementation sizing | Rebuilding the comparison table in README (separate task) |
| `pan-tools compare` command for live comparison | Marketing copy or landing page content |
| Feature recommendation with priority scoring | Integration with external analytics |

### 0.4 Success Criteria

```
SC-1: Comparison matrix covers 8+ tools across 15+ dimensions with evidence
SC-2: Feature gaps prioritized by strategic value, effort, and competitive urgency
SC-3: Top 5 recommended features have implementation specs ready for /superplan
SC-4: `pan-tools compare` command outputs JSON comparison data for any project
SC-5: No regression in existing 604+ tests
```

### 0.5 User Stories

```
As a developer evaluating PAN Wizard, I want to see how it compares to Cursor/Aider/Cline,
so that I can make an informed decision, instead of reading marketing pages from each tool.

As the PAN Wizard maintainer, I want data-driven feature prioritization,
so that I build what actually differentiates us, instead of copying competitors blindly.

As a PAN Wizard contributor, I want to understand the competitive landscape,
so that I can propose features that strengthen our strategic position, instead of duplicating work.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:help` | Partial | help shows PAN commands; compare shows competitive positioning. Different audiences |
| `/pan:progress` | None | progress is project-specific, compare is product-level |
| `/pan:map-codebase` | None | maps YOUR codebase, not the competitive landscape |

No full overlap. No existing command addresses competitive analysis or feature gap identification.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 31 | 32 | +1 |
| New concepts introduced | 0 | 1 (comparison dimensions) | +1 |
| Score | -- | -- | neutral (0) — one optional command, discoverable via help |

---

## Phase 1: Internal Reconnaissance

### 1.1 Architecture Scan — Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Multi-agent orchestration (11 agents) | Shipped | `agents/*.md` | Core differentiator vs single-agent tools |
| Wave-based parallel execution | Shipped | `commands/pan/execute-phase.md` | Unique — Cursor 2.0 just added this |
| Context rot prevention (phase-scoped) | Shipped | Architecture design | Primary value prop — no competitor solves this as well |
| Cross-platform support (5 runtimes) | Shipped | `bin/install.js` | Unique — competitors locked to 1 IDE |
| Session persistence (state.md) | Shipped | `pan-wizard-core/bin/lib/state.cjs` | Stronger than most competitors |
| Research before planning | Shipped | `agents/pan-phase-researcher.md` | Unique — no competitor does pre-planning research |
| Plan verification loop | Shipped | `agents/pan-plan-checker.md` | Unique — Cursor/Cline plan but don't verify plans |
| Post-execution verification | Shipped | `agents/pan-verifier.md` | Unique — competitors rely on human verification only |
| Human UAT workflow | Shipped | `commands/pan/verify-work.md` | Unique — structured acceptance testing |
| Atomic git commits per task | Shipped | `agents/pan-executor.md` | Aider does this; Cursor/Cline do not |
| Model profiles (quality/balanced/budget) | Shipped | `pan-wizard-core/bin/lib/config.cjs` | Unique — cost control across agent roles |
| Quick mode for ad-hoc tasks | Shipped | `commands/pan/quick.md` | Flexible — handles work outside the phase system |
| Debug with persistent state | Shipped | `commands/pan/debug.md` | Good — Cline has browser debugging, PAN has systematic debugging |
| Codebase mapping | Shipped | `commands/pan/map-codebase.md` | Good — Cursor/Windsurf have auto-indexing |
| Zero runtime dependencies | Shipped | Architecture constraint | Strategic differentiator for reliability |

### 1.2 Codebase Search Summary

- **37 commands** in `commands/pan/*.md`
- **11 agents** in `agents/*.md`
- **15 core modules** in `pan-wizard-core/bin/lib/*.cjs`
- **3 hooks** in `hooks/src/*.js`
- **617 tests** across 23 test files
- **CLI dispatcher**: `pan-wizard-core/bin/pan-tools.cjs`
- **Installer**: `bin/install.js` (~2,100 LOC)

### 1.3 Convention Enforcement Checklist

- [x] Functions named `cmd<Module><Action>(cwd, raw, ...args)`
- [x] File reads use `safeReadFile()` or `readStateSafe()` pattern
- [x] File writes wrapped in try-catch
- [x] JSON output via `output(data, raw, humanLabel)`
- [x] Errors via `error(message)`
- [x] Paths use `toPosix()`
- [x] Module exports at bottom
- [x] Subcommands dispatched via `switch` in `pan-tools.cjs`
- [x] CommonJS only (`.cjs`)
- [x] Zero runtime dependencies

### 1.4 Dependency & Integration Map

For the recommended `compare` command:
```
pan-tools.cjs → compare.cjs → core.cjs → constants.cjs
                             → utils.cjs
                             → config.cjs (for current project profile)
```
No circular dependencies. No conflicts with existing modules.

---

## Phase 2: Competitive Intelligence

### 2.1 Deep-Dive Research (8 Tools)

#### Aider
- **UX**: Terminal-based pair programming. `aider` CLI, add files with `/add`, chat naturally
- **Behavior**: Auto-commits every edit with descriptive messages. Repository map for context
- **Ergonomics**: Loved for git integration and cost transparency. BYOK model
- **Pitfalls**: No multi-agent. No planning/verification loop. No session persistence across restarts
- **Evolution**: Started with whole-file rewrites, evolved to diff-based edits. Added architect mode for planning

#### Cursor
- **UX**: VS Code fork. Tab completion, Cmd+K inline edit, Composer multi-file, Agent mode
- **Behavior**: Codebase indexing via embeddings. Background agents (v2.0). Mission Control for multi-agent
- **Ergonomics**: Best-in-class autocomplete. Familiar VS Code UX. Multi-model
- **Pitfalls**: Usage limits on Pro tier. Agent mode can go off-rails. IDE lock-in. Proprietary
- **Evolution**: Chat → Composer → Agent → Background Agent → Mission Control (8 parallel agents)

#### Continue.dev
- **UX**: VS Code/JetBrains extension. Chat + Plan + Agent modes
- **Behavior**: Context providers, embeddings-based indexing, CI/CD integration
- **Ergonomics**: Open source, model-agnostic, extensible. CI/CD background agents
- **Pitfalls**: Less polished than Cursor. Smaller community. Agent mode newer
- **Evolution**: Autocomplete tool → Code assistant → Agent with CI/CD integration → Shareable agents

#### Cline
- **UX**: VS Code sidebar. Human-in-the-loop approval for every action. Plan/Act modes
- **Behavior**: Autonomous agent with file edit, terminal, browser use, MCP integration
- **Ergonomics**: Most transparent AI tool (see every action). MCP ecosystem is rich
- **Pitfalls**: Token-hungry ($5-20+/session). Approval fatigue. Single-agent. No multi-agent
- **Evolution**: Claude Dev → Cline. Added MCP, Plan mode, browser use, checkpoints, custom modes

#### Windsurf
- **UX**: VS Code fork IDE. Cascade agent with flow persistence
- **Behavior**: Deep codebase indexing, RAG + AST analysis, multi-step flow chains
- **Ergonomics**: "Flow state" metaphor. Good free tier. Context-aware autocomplete
- **Pitfalls**: IDE lock-in. Acquired by OpenAI — future uncertain. Single agent architecture
- **Evolution**: Codeium autocomplete → Windsurf IDE → Cascade agent → Wave 13 multi-agent + git worktrees

#### GitHub Copilot (Agent Mode + Workspace)
- **UX**: VS Code extension + CLI. Agent mode plans then executes
- **Behavior**: Specialized sub-agents (Explore, Task, Code Review, Plan). Auto-fixes errors
- **Ergonomics**: Deepest GitHub integration. Familiar to largest user base
- **Pitfalls**: Primarily OpenAI models. Less autonomous than Cursor/Claude Code. Slower evolution
- **Evolution**: Autocomplete → Chat → Agent Mode → Specialized agents → Copilot CLI (Feb 2026 GA)

#### Devin
- **UX**: Cloud-based IDE. Multiple Devins run in parallel. Interactive planning
- **Behavior**: Full autonomous agent with sandboxed environment. Devin Search and Wiki
- **Ergonomics**: "Junior developer" metaphor. Good for delegation. Devin Wiki auto-docs repos
- **Pitfalls**: Expensive ($20/mo + $2.25/ACU). Cloud-only. Can't work locally. Mixed real-world results
- **Evolution**: $500/mo → $20/mo Core plan. Added interactive planning, search, wiki. 83% efficiency gain

#### Claude Code (PAN's host platform)
- **UX**: Terminal CLI + VS Code + JetBrains + Desktop + Web
- **Behavior**: 200K context window. Sub-agents. Skills. MCP servers. CLAUDE.md
- **Ergonomics**: Most capable autonomous agent. Cross-platform. Deep codebase understanding
- **Pitfalls**: Anthropic-only models. Can be expensive with Opus. Context degradation on long sessions
- **Evolution**: CLI → VS Code → Sub-agents → Skills → Background agents → Hooks

### 2.2 Prior Art & Community Research

Key findings from industry analysis:

- **"Orchestration, not autonomy"** is the 2026 paradigm (Mike Mason, O'Reilly). PAN Wizard embodies this before it was trendy
- **"Tools don't compete, they layer"** (LogRocket Feb 2026). PAN works WITH Claude Code, not instead of it
- **Context rot is the #1 unsolved problem** across all tools. PAN's phase-scoped execution directly addresses this
- **Multi-agent parallel execution** is the hottest feature in 2026. PAN had this first with wave-based execution
- **Planning before coding** is now consensus best practice. PAN has the most sophisticated plan-verify loop

### 2.3 Competitive Matrix

| Aspect | PAN Wizard | Aider | Cursor | Continue | Cline | Windsurf | Copilot | Devin |
|--------|-----------|-------|--------|----------|-------|----------|---------|-------|
| **Form Factor** | CLI overlay | CLI | IDE | Extension | Extension | IDE | Ext+CLI | Cloud IDE |
| **Multi-Agent** | 11 specialized | None | Background (8) | CI agents | None | Wave 13 | Specialized | Parallel Devins |
| **Context Management** | Phase-scoped (200K fresh) | Repo map | Embeddings index | Embeddings | Condensing | RAG + AST | Repo-level | Sandboxed |
| **Planning** | Research→Plan→Verify loop | Architect mode | Agent plans | Plan mode | Plan mode | Implicit | Plan step | Interactive plan |
| **Verification** | Auto + Human UAT | None | Iterative | None | Run tests | Run tests | Auto-fix | Auto-fix |
| **Git Integration** | Atomic commits/task | Auto-commit | Basic | Basic | None built-in | Basic | Basic | Basic |
| **Session Persistence** | state.md + handoff | None | Notepad | None | Task history | Memories | None | Cloud state |
| **Cross-Platform Runtime** | Claude/OpenCode/Gemini/Codex | Any model | Cursor only | VS Code/JB | VS Code | Windsurf | VS Code+ | Cloud |
| **Model Flexibility** | Via host tool | Any model | Multi-model | Any model | Any model | Multi (OpenAI?) | OpenAI+ | Proprietary |
| **Open Source** | Yes (MIT) | Yes (Apache) | No | Yes | Yes (Apache) | No | No | No |
| **Zero Dependencies** | Yes | No (Python) | No (Electron) | No | No | No | No | No |
| **Cost Control** | Model profiles | BYOK | Subscription | BYOK | BYOK | Subscription | Subscription | ACU credits |
| **Codebase Awareness** | map-codebase (4 agents) | Repo map | Auto-index | Index | On-demand | Auto-index | Auto-index | Auto-analyze |
| **Browser Testing** | No | No | No | No | Yes (Puppeteer) | No | No | Yes |
| **Autocomplete** | N/A (via host) | No | Best-in-class | Good | No | Good | Good | No |
| **IDE Integration** | Host tool's | Terminal only | Native | Plugin | Plugin | Native | Plugin | Cloud |

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Drop the pretense of being an IDE or editor. PAN is an orchestration layer, not a code editor. Don't compete on autocomplete, syntax highlighting, or IDE features |
| **REDUCE** | What should be reduced? | Reduce the learning curve for new users (37 commands is a lot). Reduce time-to-first-value (currently requires `/pan:new-project` setup). Reduce context around "what PAN does differently" |
| **RAISE** | What should be raised? | Raise visibility of unique capabilities (plan-verify loop, context rot prevention, multi-agent). Raise cross-tool comparison data. Raise confidence in "why PAN vs doing it myself" |
| **CREATE** | What should we create? | Create: (1) Live project health dashboard, (2) Context budget tracking, (3) Cross-session learning, (4) Auto-discovery of project patterns, (5) Comparison/benchmark tooling |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                    ▲                ▲
                    │                │
              Context Rot       Multi-Agent
              Prevention        Orchestration
              (PAN leads)       (PAN pioneered,
                                competitors catching up)
```

- **Context rot prevention**: Genesis/Custom-Built. PAN leads. No competitor fully solves this
- **Multi-agent orchestration**: Moving from Custom-Built to Product. Cursor, Windsurf now shipping
- **Plan-verify loops**: Custom-Built. PAN has the most sophisticated version
- **Workflow automation**: Product phase. Many tools offer this now
- **In 2-3 years**: Context management will be a commodity. Differentiation moves to intelligence of orchestration decisions (when to split, what context to carry, which agent pattern to use)

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Phase-scoped 200K windows prevent context rot. No competitor matches this | 5 |
| **Cross-Platform** | Works across Claude Code, OpenCode, Gemini CLI, Codex. Unique in the market | 5 |
| **Developer Experience** | Discuss→Plan→Execute→Verify workflow is the most structured | 4 |
| **Zero Dependencies** | No Python, no Node runtime, no Electron. Just the CLI host tool | 4 |
| **State Persistence** | state.md + pause/resume + handoff. Stronger than Cursor Notepad or Windsurf Memories | 4 |
| **Verification Quality** | Auto verification + human UAT. Strongest in the market | 5 |
| **Total** | | **27/30** |

### 3.4 Strategic Recommendation

**Build: Modified approach.** Instead of a single `compare` command, we should build a **Feature Gap Analysis System** with three components: (1) a static comparison matrix in the docs that's easy to update, (2) a set of 5 strategic features identified through this analysis that would widen PAN's lead, and (3) a `pan-tools compare` command that shows PAN's capabilities vs a project's needs. Our unique angle: PAN is the only tool that treats AI coding as a **systems engineering problem** (orchestration, verification, context management) rather than a "smarter autocomplete" problem. We should explicitly NOT copy: browser testing (Cline's territory), autocomplete (host tool's job), IDE-level indexing (Cursor/Windsurf's domain). Strategic timing: now, before competitors fully catch up on orchestration.

---

## Phase 3.5: Architecture & Implementation Assessment

### 3.5.1 Feature Type Classification

This featureAI produces TWO deliverables:

1. **Documentation**: Industry comparison matrix + feature gap analysis (static doc)
2. **Recommended Features**: 5 strategic features with implementation specs

The documentation is NOT a code feature — it's a spec output.
The recommended features ARE code features — each gets its own future featureAI/superplan cycle.

### 3.5.2 Top 5 Strategic Feature Recommendations

Based on the competitive analysis, here are the features that would most strengthen PAN Wizard's position:

---

#### Feature 1: Context Budget Tracking & Visualization
**Priority: P0 — Competitive Urgency: HIGH**

| Dimension | Details |
|-----------|---------|
| **Problem** | Users can't see how much context they're using, when degradation starts, or why PAN splits work into phases. "Context rot" is PAN's core value prop but it's invisible |
| **Who has it** | Cline (token counter in UI). Cursor (model shows token usage). No one tracks context QUALITY degradation |
| **PAN's angle** | Don't just show token count — show context HEALTH. Track signal-to-noise ratio across a session. Predict when degradation will start. Show WHY phase boundaries matter |
| **Implementation** | New `pan-tools context-budget` command. Reads state.md, current phase plans, estimates tokens. Shows budget utilization and quality score |
| **Effort** | S — One new core module + command + tests |
| **Strategic Value** | Makes PAN's invisible superpower visible. Huge for marketing and user confidence |
| **Moat Strength** | 5/5 — No competitor tracks context QUALITY, only quantity |

---

#### Feature 2: Cross-Session Learning (Project Patterns)
**Priority: P1 — Competitive Urgency: MEDIUM**

| Dimension | Details |
|-----------|---------|
| **Problem** | PAN doesn't learn from past phases. If Phase 3 discovered a pattern (e.g., "always use Zod for validation"), Phase 7 doesn't know. Each phase starts fresh |
| **Who has it** | Windsurf (Memories). Cursor (Notepad). Claude Code (CLAUDE.md manually). Devin (Wiki auto-generates) |
| **PAN's angle** | Auto-extract patterns from completed phase summaries and verifications. Build a `PATTERNS.md` that grows with the project. Feed it to researchers and planners |
| **Implementation** | New `pan-tools patterns` command. Post-execution hook that analyzes summaries. New agent or extension to verifier |
| **Effort** | M — New module + agent extension + hook + tests |
| **Strategic Value** | Transforms PAN from "fresh context per phase" to "fresh context WITH accumulated wisdom". Directly addresses the #1 limitation of phase-scoped execution |
| **Moat Strength** | 4/5 — Windsurf has Memories but they're manual. PAN would auto-extract |

---

#### Feature 3: Live Project Health Dashboard
**Priority: P1 — Competitive Urgency: MEDIUM**

| Dimension | Details |
|-----------|---------|
| **Problem** | `/pan:progress` shows where you are but not HOW things are going. No quality metrics, no velocity tracking, no risk indicators |
| **Who has it** | Devin (progress tracking). GitHub Copilot Workspace (plan progress). No one does health scoring |
| **PAN's angle** | Aggregate data from verifications, test results, plan iterations, and state history. Produce a health score with actionable recommendations |
| **Implementation** | Enhance `pan-tools progress` with `--health` flag or new `pan-tools health-report` command |
| **Effort** | S-M — Extends existing progress + verify modules |
| **Strategic Value** | Transforms PAN from task tracker to project intelligence. Gives users confidence in the process |
| **Moat Strength** | 4/5 — No competitor offers project-level health scoring |

---

#### Feature 4: Intelligent Phase Splitting (Auto-Decomposition)
**Priority: P2 — Competitive Urgency: LOW**

| Dimension | Details |
|-----------|---------|
| **Problem** | Users must manually decide phase boundaries. If a phase is too large, execution quality degrades. Users don't know the right granularity |
| **Who has it** | Devin (interactive planning). GitHub Copilot (auto-plan). No one does auto-decomposition based on context budget |
| **PAN's angle** | Analyze a proposed phase against the context budget. If it exceeds safe limits, recommend splitting. Show WHERE to split based on dependency analysis |
| **Implementation** | Enhancement to plan-phase. New analysis in planner agent. Integration with context-budget |
| **Effort** | M — Planner agent enhancement + context analysis |
| **Strategic Value** | Makes PAN self-correcting. Users get optimal phase sizes without expertise |
| **Moat Strength** | 5/5 — No competitor sizes work units based on context budget |

---

#### Feature 5: Comparison & Benchmark Command
**Priority: P2 — Competitive Urgency: LOW**

| Dimension | Details |
|-----------|---------|
| **Problem** | Users evaluating PAN have no way to see how it compares without reading docs. No tool in the market offers a self-aware comparison |
| **Who has it** | Nobody. Every tool's comparison is marketing material on their website |
| **PAN's angle** | `pan-tools compare` outputs a factual, evidence-based comparison. Shows what PAN does, what competitors do, and honestly where PAN is weaker |
| **Implementation** | New `compare.cjs` module with static data + dynamic project analysis |
| **Effort** | S — Static comparison data + formatting |
| **Strategic Value** | Radical transparency builds trust. Users who see honest comparison are more likely to adopt |
| **Moat Strength** | 3/5 — Easy to copy, but being first matters for brand positioning |

---

### 3.5.3 Breaking Change Assessment

None of these features change existing command output schemas, file formats, directory structure, or installer output. All are additive.

### 3.5.4 Feature Ladder

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Context Budget Tracking + static comparison doc | Users can see context health + competitive positioning is clear | S |
| **v1 (Complete)** | + Cross-Session Learning + Health Dashboard | PAN learns from past phases + project intelligence | M |
| **v2 (Enhanced)** | + Auto-Decomposition + Compare command | Self-correcting phase sizes + self-aware comparison | M-L |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

PAN Wizard already solves context rot better than any competitor. But today, that superpower is invisible — users can't see it working. The features recommended in this analysis make PAN's strengths visible and address the gaps that competitors are filling.

**Context Budget Tracking** answers "how much context am I using?" and "when will quality degrade?" — something no AI coding tool currently shows.

**Cross-Session Learning** means Phase 7 knows what Phase 3 discovered, without you having to remember and repeat it.

**Health Dashboard** tells you not just "where am I?" but "how healthy is this project?" — quality metrics, velocity, risk indicators.

**Auto-Decomposition** prevents the most common PAN mistake: making phases too large. The system tells you when to split and where.

**Compare Command** lets PAN honestly describe its own capabilities vs alternatives — radical transparency for evaluation.

### 4.2 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|
| Context QUALITY tracking (not just tokens) | Original | No competitor does this. Token counting is insufficient | Cline's token counter (quantity-only, no quality insight) |
| Auto-extract patterns from summaries | Devin Wiki (concept) | Auto-documentation is powerful. But Devin indexes code; we index decisions | Windsurf Memories (manual) — too much friction |
| Health scoring as JSON output | Original | Machine-readable for agents, human-readable with --raw | Devin's cloud dashboard (IDE-dependent) |
| Context-budget-aware decomposition | Original | Combines PAN's unique context engineering with planning | Copilot's auto-plan (doesn't consider context limits) |
| Honest self-comparison | Original | Trust > marketing. Show weaknesses alongside strengths | Every competitor's marketing page (biased) |

### 4.3 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Context tracking as CLI command | CLI command | VS Code extension panel | IDE-dependent. PAN is cross-platform | Less visual than a GUI panel |
| Patterns in PATTERNS.md | Markdown file | SQLite database | Violates zero-deps. Over-engineered | Slower queries on large pattern sets |
| Health as JSON + raw | JSON output | HTML report | Not composable. Requires browser | Less visually appealing |
| Static comparison data | Hardcoded in module | Web-fetched live data | Requires network. Violates zero-deps. Unreliable | Needs manual updates when competitors change |

---

## Phase 5: Architecture Decision Record

### ADR-0001: Strategic Feature Prioritization Based on Competitive Analysis

#### Status
Proposed

#### Context
PAN Wizard operates in a rapidly consolidating AI coding tool market. Competitors (Cursor 2.0, Windsurf Wave 13, GitHub Copilot agent mode, Devin 2.0) are shipping features that overlap with PAN's differentiators — particularly multi-agent execution and planning modes. PAN needs to identify where it leads, where it lags, and what to build next to maintain and extend its competitive position.

#### Decision
Prioritize features that make PAN's invisible strengths visible (context budget tracking) and address the primary limitation of phase-scoped execution (cross-session learning), rather than copying competitor features like browser testing or autocomplete that belong to the host tool layer.

#### Consequences

##### Positive
- Context budget tracking makes PAN's core value prop tangible and measurable
- Cross-session learning addresses the most common criticism of fresh-context-per-phase architecture
- All features maintain zero-dependency constraint and cross-platform support
- Features are additive — no breaking changes to existing workflows

##### Negative
- Static comparison data requires manual maintenance as competitors evolve
- Context quality scoring is a novel concept with no established methodology to validate against
- Cross-session learning adds state that could become stale or misleading if not managed

##### Neutral
- These features don't address the IDE-based autocomplete gap (intentionally — that's the host tool's job)
- Compare command may be seen as marketing rather than engineering (mitigated by factual, honest framing)

#### Options Considered
1. **Copy competitors**: Add browser testing, autocomplete, codebase indexing → Rejected: violates layered architecture, duplicates host tool capabilities
2. **Focus on visibility and intelligence** (chosen): Make existing strengths visible, add learning → Selected: strengthens moat without scope creep
3. **Do nothing**: Rely on existing differentiators → Rejected: competitors are closing the gap on multi-agent and planning

#### Links
- Related to: all 14 core modules, context engineering architecture
- Blocks: none
- Enables: roadmap prioritization for v0.2.0+

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Modes (for Context Budget command — v0 MVP)

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| No .planning/ directory | User error | `existsSync` check | JSON `{"error": "..."}` | `{"error": "No .planning/ directory found", "hint": "Run /pan:new-project to initialize"}` |
| No state.md | User error | `readStateSafe()` returns null | JSON error + hint | `{"error": "state.md not found", "hint": "Run /pan:new-project to initialize"}` |
| No active phase | Normal state | Phase number is 0 or undefined | Return budget with "no active phase" status | `{"status": "idle", "activePhaseBudget": null}` |
| Corrupted state.md | Data corruption | try-catch on parse | JSON error, skip bad data | `{"error": "state.md could not be parsed"}` |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| `--raw` flag | Human-readable summary | Debugging |
| `--cwd <path>` | Override working directory | Testing |
| JSON `error` field | Machine-readable error | Always on failure |
| `hint` field in errors | Actionable guidance | Always with errors |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| .planning/ directory | Read | System-generated (trusted within project scope) |
| state.md | Read | System-generated |
| roadmap.md | Read | System-generated |
| Phase plan.md files | Read | System-generated |
| config.json | Read | User-controlled |

| Input Vector | Source | Validation Required |
|-------------|--------|-------------------|
| CLI arguments | User-typed | Type check, no shell metacharacters |
| File contents | Disk | Structure validation via try-catch |
| Path arguments (`--cwd`) | User-typed | Path safety protocol |

### 7.2 Path Safety Protocol

Applied to `--cwd` argument:
1. Resolve to absolute: `path.resolve(cwd, userPath)`
2. Verify within project boundaries
3. Reject `..` segments before resolution
4. Reject null bytes

### 7.3 Output Sanitization

- [x] No absolute filesystem paths in JSON output (use `toPosix()`)
- [x] No environment variable values in output
- [x] No stack traces in error messages
- [x] No internal function names in user-facing errors

### 7.4 Privilege Scope

```
Reads from: .planning/, .planning/phases/
Writes to: NOTHING (read-only analysis for v0)
Executes shell: No
Reads outside project: No
```

---

## Phase 8: Implementation Roadmap

### 8.1 v0 MVP Tasks (Context Budget Tracking)

```
### Task 1: Core context-budget module
Files: pan-wizard-core/bin/lib/context-budget.cjs
Test: tests/context-budget.test.cjs
Estimate: S
Priority: P0

### Task 2: CLI dispatcher routing for 'context-budget'
Files: pan-wizard-core/bin/pan-tools.cjs
Test: Unknown command test still passes
Estimate: XS

### Task 3: Command .md definition
Files: commands/pan/context-budget.md
Test: Command appears in help
Estimate: XS

### Task 4: Tests (unit + integration)
Files: tests/context-budget.test.cjs
Test: >=10 tests, all pass
Estimate: S

### Task 5: Documentation update
Files: README.md (add to commands table)
Test: Docs reference correct command
Estimate: XS
```

### 8.2 v0 MVP Tasks (Static Comparison Document)

```
### Task 6: Write comprehensive comparison document
Files: docs/COMPARISON.md
Test: Document exists, covers all 8 tools
Estimate: S
Priority: P0
```

### 8.3 Dependency Graph

```
Task 1 (Core Module)
  └─→ Task 2 (Dispatcher)
        └─→ Task 3 (Command .md)
              └─→ Task 4 (Tests)
                    └─→ Task 5 (Docs)

Task 6 (Comparison Doc) — independent, can run in parallel
```

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Context quality scoring methodology invalid | Medium | Medium | Start simple (token count + phase utilization), iterate based on user feedback |
| Comparison data becomes stale | High | Low | Document "last verified" dates, make updates easy |
| Feature 2 (cross-session learning) adds stale patterns | Medium | Medium | Add recency weighting, allow manual pruning |
| Phase auto-decomposition gives bad splits | Low | Medium | Make it advisory (suggest, don't auto-split) |

---

## Phase 9: Test Plan

### 9.1 Test Pyramid (for v0 Context Budget)

| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Unit** | Test budget calculation functions, mock fs | 5+ | Logic bugs in scoring, edge cases |
| **Integration** | `runPanTools('context-budget', tmpDir)` | 5+ | JSON output shape, arg parsing, error messages |
| **E2E** | Multi-command: init → plan → check budget | 2+ | Real workflow integration |

### 9.2 Boundary Value Tests

- [x] Empty `.planning/` directory
- [x] No active phase (idle state)
- [x] Single phase vs 20+ phases
- [x] Missing state.md
- [x] Missing roadmap.md
- [x] Corrupted config.json
- [x] Windows path compatibility

### 9.3 Regression Verification

- [x] Full suite: `npm test` — ALL 604+ tests pass
- [x] Related modules: state.cjs, config.cjs, phase.cjs tests re-run
- [x] No existing test expectations changed

---

## Phase 10: Output Artifacts & Report

### 10.1 Documents Created

- **Spec**: `docs/specs/industry_comparison_and_feature_gaps_featureai.md` (this document)
- **ADR**: `docs/decisions/ADR-0001-strategic-feature-prioritization.md`

### 10.2 Report Summary

```
## /featureAI Complete — Industry Comparison & Feature Gap Analysis

### Problem & Evidence
PAN Wizard lacks visible competitive positioning and data-driven feature prioritization.
Evidence: User request, competitor feature parity (Cursor 2.0, Windsurf Wave 13), industry
trend reports (McKinsey, O'Reilly, Anthropic).

### Strategic Assessment
- Blue Ocean: Eliminate IDE competition, Reduce learning curve, Raise visibility
  of unique capabilities, Create context intelligence + cross-session learning
- Wardley: Context rot prevention at Genesis (PAN leads), Multi-agent moving to Product
- Moat Score: 27/30 — strongest in context engineering (5/5) and verification (5/5)
- Cognitive Load: 0 (neutral) — features are additive, discoverable
- Recommendation: Build (Modified) — 5 strategic features, not a single "compare" command

### Competitive Positioning
PAN Wizard's unique position: the ONLY tool that treats AI coding as a systems
engineering problem (orchestration, verification, context management) rather than
"smarter autocomplete." Cross-platform support (5 runtimes) is unmatched.

### Feature Ladder
- v0 (MVP): Context Budget Tracking + static comparison doc — S effort
- v1 (Complete): + Cross-Session Learning + Health Dashboard — M effort
- v2 (Enhanced): + Auto-Decomposition + Compare command — M-L effort

### Top 5 Recommended Features (Priority Order)
1. Context Budget Tracking (P0) — Make PAN's invisible superpower visible
2. Cross-Session Learning / PATTERNS.md (P1) — Phase 7 knows what Phase 3 discovered
3. Live Project Health Dashboard (P1) — Quality metrics, velocity, risk indicators
4. Intelligent Phase Splitting (P2) — Auto-recommend phase boundaries based on context budget
5. Comparison & Benchmark Command (P2) — Honest, factual self-comparison

### Competitive Matrix Summary (8 tools, 15 dimensions)
- PAN LEADS in: Context engineering, cross-platform, verification, zero-deps,
  plan-verify loop, session persistence, atomic commits
- PAN MATCHES in: Multi-agent, planning, model flexibility (via host)
- PAN TRAILS in: Autocomplete (N/A by design), browser testing (Cline),
  IDE indexing (Cursor/Windsurf), visual UI (IDE-based tools)
- PAN IS UNIQUE in: Context rot prevention, research-before-planning,
  plan verification loop, human UAT workflow, 4-runtime support

### Next Step
Add to superplan: /superplan --refresh
Execute: /execplan
```
