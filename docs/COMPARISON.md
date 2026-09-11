# PAN Wizard vs The Competition

**Last verified:** `2026-09-10` — matrix columns refreshed from each product's own changelog or release feed; PAN's rows from the source tree; the direct-peer table from the projects' releases pages. Dated statements below say which check they rest on.

> **Verification note (`2026-09-10`).** Three statements were false against the sources read that day and were corrected in place: the MCP row, and "Where PAN Wizard Leads" items 3 and 4. The same pass refreshed the matrix: Continue.dev's repository has been read-only since June 2026, Windsurf is now Devin Desktop and removed the Cascade agent in September 2026, Aider has had no release in over a year, Cline and Cursor shipped subagents. PAN's rows now describe what ships. This matrix compares PAN with IDE and agent *products*; the spec-driven *layers* PAN actually competes with are in the direct-peer table below.

PAN Wizard occupies a unique position in the AI coding tool landscape: it's an **orchestration layer** that works WITH your AI coding tool (Claude Code, OpenCode, Gemini CLI, Codex, and Copilot CLI), not a replacement for it. While most tools try to be the smartest single agent, PAN makes any agent reliable through structured workflows, context management, and verification.

---

## Full Comparison Matrix

| Dimension | PAN Wizard | Aider (dormant) | Cursor | Continue.dev (read-only) | Cline | Devin Desktop (ex-Windsurf) | GitHub Copilot | Devin |
|-----------|:---------:|:-----:|:------:|:--------:|:-----:|:--------:|:-------:|:-----:|
| **Form Factor** | CLI overlay | CLI | IDE (VS Code fork) | IDE extension | VS Code extension | IDE (VS Code fork) | Extension + CLI | Cloud IDE |
| **Architecture** | Orchestration layer | Single agent | Single + background + cloud agents | Single + CI agents (unmaintained) | Single agent + subagents | Devin Local agent (Cascade removed) | Extension + agents | Cloud sandbox |
| **Multi-Agent** | Specialized agents (planner, executor, verifier, researchers); `/pan:army` squads with a worktree per builder and native workflow scripts on Claude Code | None | Parallel agents in worktrees, best-of-n, cloud subagents | CI/CD agents | Delegated subagents (4.1) | Subagents, individually stoppable | Custom agents run as subagents | Nested sub-Devins |
| **Context Management** | Phase-scoped fresh context windows; statusline and context-monitor hooks; scoped learnings (`learn topics-for`) | Repo map (auto) | Embeddings-based index | Embeddings + re-ranking | On-demand + condensing | RAG + AST indexing | Repository-level | Sandboxed env |
| **Context Rot Prevention** | Yes (core feature) | No | No | No | Partial (condensing) | No | No | No |
| **Planning** | Research → Plan → Verify loop | Architect mode | Agent generates plan | Plan mode (read-only) | Plan mode | Implicit planning | Plan step with markdown | Interactive planning |
| **Plan Verification** | Dedicated plan-checker agent (twelve dimensions, up to three revision passes) | None | None | None | None | Plan-file review gate before implementation | None | None |
| **Post-Execution Verification** | Auto verifier + human UAT with auto-diagnosis into fix plans | None | Iterative error-fix | None | Run tests manually | Run tests manually | Auto-fix loop | Auto-fix loop |
| **Git Integration** | Commit per task (trivial tasks coalesced); `/pan:git` subcommands; branching strategies; worktree isolation; revert-only release | Auto-commit per edit | Basic | Basic | None built-in | Basic | Basic | Basic |
| **Session Persistence** | state.md + pause/resume + handoff; stop-guard hook; `hygiene` and `health --repair`; scheduled campaigns | None | Memory tool, `/goal` objectives | None | Checkpoints with rewind | Transcripts, session duplication | Copilot Memory, CLI session recovery | Cloud state, playbooks |
| **Cross-Platform Runtime** | Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI — hooks on four, a shared `.agents/` tree, a Claude plugin and an Agent Plugins bundle | Any LLM (BYOK) | Cursor IDE only | VS Code, JetBrains | VS Code + CLI + desktop | Devin Desktop only | VS Code, JetBrains, CLI | Cloud only |
| **Model Flexibility** | Multi-model routing (tier aliases + provider mapping) | Any model (BYOK) | Multi-model + BYOK | Any model + local | Any provider | Multi-model | OpenAI + Anthropic + Google | Proprietary |
| **Open Source** | Yes (MIT) | Yes (Apache 2.0) | No | Yes (Apache 2.0) | Yes (Apache 2.0) | No | No | No |
| **Zero Dependencies** | Yes (only Node builtins) | No (Python + deps) | No (Electron) | No (Node + deps) | No (Node + deps) | No (Electron) | No | No |
| **Cost Control** | Model profiles + complexity routing + per-phase overrides; token ledger with a dated rate table; phase and campaign budgets | BYOK direct pricing | Subscription + limits | BYOK | BYOK | Subscription tiers | Subscription | ACU credits |
| **Codebase Awareness** | map-codebase: single-shot below the sharding threshold, six-way sharded above; native workflow on Claude Code | Repo map (auto) | Auto-index (embeddings) | Auto-index | On-demand reads | Auto-index (RAG + AST) | Auto-index | Auto-analyze |
| **Browser Testing** | No (not PAN's job) | No | No | No | Yes (Puppeteer) | No | No | Yes |
| **Autocomplete** | Via host tool | No | Best-in-class (Tab) | Good | No | Good | Good | No |
| **IDE Integration** | Via host tool | Terminal only | Native (is the IDE) | Plugin | Plugin | Native (is the IDE) | Plugin + web | Cloud IDE |
| **MCP Support** | Own MCP server (engine exposed as tools and resources, registered per runtime, checked `2026-09-10`) plus the host tool's | No | Limited | No | Deep (native) | Limited | No | No |

---

## Direct Peers — Spec-Driven Layers (checked `2026-09-10`)

The tools PAN actually competes with are not IDEs but orchestration layers that install into the same runtimes. Cells summarise each project's own README, docs and releases page as read on the date above; Y = present, P = partial, N = not found, — = not assessed.

| Dimension | PAN Wizard | GitHub Spec Kit | BMAD Method | gsd-core | Superpowers | OpenSpec |
|---|---|---|---|---|---|---|
| **Durable planning state on disk** | Y `.planning/` | Y `specs/`, `.specify/memory/` | Y `stories.yaml`, render snapshots | Y `.planning/` (same core file names as PAN) | P design scratch | Y `openspec/` |
| **Research before planning** | Y researcher agents | P clarify step | Y deep-recon packs | Y research step | P brainstorm | — |
| **Plan verification** | Y plan-checker agent | Y analyze + checklist | Y review lenses | Y plan-checker gate | Y pre-flight checks | — |
| **Post-execution verification / UAT** | Y verifier + UAT with auto-diagnosis | P converge, no UAT | Y verification-gap review, no UAT | Y verifier + manual UAT | Y two-stage review, no UAT | — |
| **Deterministic orchestration** | Y native Claude Code workflow scripts; markdown elsewhere | P declarative YAML workflows, Python CLI | P Python sprint script | P hooks and seam | N markdown | — |
| **Behavioural eval harness** | Y against packed installs, findings ledger | N | N | P test suites | Y Drill (tmux sessions, not in CI) | — |
| **Plugin / marketplace distribution** | P built for Claude and Agent Plugins, published to npm only | P own extension catalog | Y Claude + Codex marketplaces | Y Claude plugin + npm | Y many marketplaces | P npm |
| **MCP server exposing the engine** | Y with forbidden-verb list and human merge gate | N | N | Y | N | — |
| **Runtimes targeted** | 5 | 30+ agents | 40+ platforms | 10+ | 13 harnesses | 30+ tools |
| **Cost / model routing** | Y profiles, ledger, dated rate table | N | P handoff routing | Y model profiles | P per-subagent effort | — |
| **Release activity, Aug–Sep 2026** | steady | steady (1.0.0 on `2026-08-21`) | active | active (fork of the archived original) | one release | steady |

## Where PAN Wizard Leads

These are capabilities no other tool matches:

1. **Context Rot Prevention** — Every plan executes in a fresh context window. No accumulated garbage, no quality degradation. Checked `2026-09-10` against the products in this matrix: none isolates each unit of work in a fresh window by design. Not re-verified against the spec-driven peers below, which share PAN's lineage and may share the design
2. **Research-Before-Planning** — Dedicated researcher agents investigate the domain before the planner starts. Cursor, Cline, and Copilot all plan without research
3. **Plan Verification Loop** — A dedicated plan-checker agent verifies plans achieve phase goals before execution begins. Checked `2026-09-10`: gsd-core ships a plan-checker gate and Spec Kit ships cross-artifact analysis, so this is now a shared strength rather than a unique one; PAN's checker covers more dimensions (spec sufficiency and decision trace among them)
4. **Human UAT Workflow** — Structured acceptance testing with auto-diagnosis of failures and generated fix plans. Checked `2026-09-10`: gsd-core offers a manual UAT walkthrough; PAN's auto-diagnosis into generated fix plans remains the differentiator
5. **5-Runtime Support** — Works across Claude Code, OpenCode, Gemini CLI, Codex, and Copilot CLI. Checked `2026-09-10`: the IDE products in this matrix are each tied to one surface, but the spec-driven peers (gsd-core, Spec Kit, Superpowers) also install into many runtimes; see the queued refresh
6. **Zero Runtime Dependencies** — Only uses Node.js builtins (`fs`, `path`, `child_process`, `os`, `crypto`, `readline`). No Python, no Electron, no npm install
7. **Atomic Git Commits** — Every task gets its own commit with a descriptive message. Only Aider does this (per edit, not per task)

---

## Where PAN Wizard Matches

PAN is competitive but not uniquely differentiated:

- **Multi-Agent Orchestration** — PAN has specialized agents with wave-based parallel execution. Cursor 2.0 now has 8 parallel agents, Windsurf Wave 13 added multi-agent, and Copilot has specialized sub-agents. PAN pioneered this but competitors are catching up
- **Session Persistence** — state.md + pause/resume. Cursor has Notepad, Windsurf has Memories, Devin has cloud state
- **Model Profiles** — PAN's quality/balanced/budget profiles with provider-agnostic tier routing, complexity-based adjustment, per-phase overrides, and cost estimation. Cursor offers model selection per request

---

## Where PAN Wizard Intentionally Doesn't Compete

These are out of scope by design — they belong to the host tool layer:

- **Autocomplete/Tab Completion** — Use Cursor, Copilot, or your IDE's native autocomplete. PAN orchestrates work, not keystrokes
- **Codebase Indexing** — PAN has `map-codebase` for analysis, but real-time semantic indexing is Cursor/Windsurf's domain
- **Browser Testing** — Cline's Puppeteer integration is purpose-built for this. PAN focuses on code verification, not UI testing
- **IDE-level UX** — Inline editing, hover suggestions, and visual diff review are IDE features. PAN works through CLI commands

---

## When to Use What

| Scenario | Best Tool | Why |
|----------|-----------|-----|
| Building a feature from scratch (multi-phase) | **PAN Wizard** | Structured planning, research, execution, verification across sessions |
| Quick inline code edit | **Cursor** or **Copilot** | Tab completion and Cmd+K are faster for small changes |
| Exploring/understanding code | **Claude Code** or **Cursor** | Direct chat with codebase context |
| One-off bug fix | **PAN `/pan:quick`** or **Aider** | Quick mode for PAN, or Aider's direct terminal editing |
| Frontend visual debugging | **Cline** | Browser use for visual inspection |
| Delegating autonomous tasks | **Devin** | Cloud sandbox for fire-and-forget delegation |
| CI/CD automation | **Devin** or **Cursor cloud agents** | Background and cloud agents (Continue.dev's CI agents are unmaintained since mid-2026) |
| Cost-conscious development | **PAN (budget profile + complexity routing)** + **Aider** | PAN's model profiles with per-phase overrides + Aider's BYOK transparency |

---

## The Layering Insight

The most effective workflow in 2026 isn't picking one tool — it's layering them. PAN Wizard is designed for this:

```
Your IDE (Cursor, VS Code, etc.)     ← autocomplete, inline edits
  └── Your AI Agent (Claude Code)    ← autonomous coding, chat
        └── PAN Wizard               ← orchestration, planning, verification
```

PAN handles the macro-level workflow (what to build, in what order, with what verification). Your AI agent handles the micro-level coding. Your IDE handles the keystroke-level editing. Each layer does what it's best at.
