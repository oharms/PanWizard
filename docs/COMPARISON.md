# PAN Wizard vs The Competition

**Last verified:** March 2026

PAN Wizard occupies a unique position in the AI coding tool landscape: it's an **orchestration layer** that works WITH your AI coding tool (Claude Code, OpenCode, Gemini CLI, Codex, and Copilot CLI), not a replacement for it. While most tools try to be the smartest single agent, PAN makes any agent reliable through structured workflows, context management, and verification.

---

## Full Comparison Matrix

| Dimension | PAN Wizard | Aider | Cursor | Continue.dev | Cline | Windsurf | GitHub Copilot | Devin |
|-----------|:---------:|:-----:|:------:|:--------:|:-----:|:--------:|:-------:|:-----:|
| **Form Factor** | CLI overlay | CLI | IDE (VS Code fork) | IDE extension | VS Code extension | IDE (VS Code fork) | Extension + CLI | Cloud IDE |
| **Architecture** | Orchestration layer | Single agent | Single + background | Single + CI agents | Single agent | Single agent (Cascade) | Extension + agents | Cloud sandbox |
| **Multi-Agent** | Specialized agents (planner, executor, verifier, researchers, etc.) | None | Up to 8 parallel | CI/CD agents | None (single) | Wave 13 multi-agent | Specialized sub-agents | Parallel Devins |
| **Context Management** | Phase-scoped fresh 200K windows | Repo map (auto) | Embeddings-based index | Embeddings + re-ranking | On-demand + condensing | RAG + AST indexing | Repository-level | Sandboxed env |
| **Context Rot Prevention** | Yes (core feature) | No | No | No | Partial (condensing) | No | No | No |
| **Planning** | Research → Plan → Verify loop | Architect mode | Agent generates plan | Plan mode (read-only) | Plan mode | Implicit planning | Plan step with markdown | Interactive planning |
| **Plan Verification** | Dedicated plan-checker agent | None | None | None | None | None | None | None |
| **Post-Execution Verification** | Auto verifier + human UAT | None | Iterative error-fix | None | Run tests manually | Run tests manually | Auto-fix loop | Auto-fix loop |
| **Git Integration** | Atomic commits per task | Auto-commit per edit | Basic | Basic | None built-in | Basic | Basic | Basic |
| **Session Persistence** | state.md + pause/resume + handoff | None | Notepad (manual) | None | Task history | Memories | None | Cloud state |
| **Cross-Platform Runtime** | Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI | Any LLM (BYOK) | Cursor IDE only | VS Code, JetBrains | VS Code | Windsurf IDE only | VS Code, JetBrains, CLI | Cloud only |
| **Model Flexibility** | Multi-model routing (tier aliases + provider mapping) | Any model (BYOK) | Multi-model + BYOK | Any model + local | Any provider | Multi-model | OpenAI + Anthropic + Google | Proprietary |
| **Open Source** | Yes (MIT) | Yes (Apache 2.0) | No | Yes (Apache 2.0) | Yes (Apache 2.0) | No | No | No |
| **Zero Dependencies** | Yes (only Node builtins) | No (Python + deps) | No (Electron) | No (Node + deps) | No (Node + deps) | No (Electron) | No | No |
| **Cost Control** | Model profiles + complexity routing + per-phase overrides | BYOK direct pricing | Subscription + limits | BYOK | BYOK | Subscription tiers | Subscription | ACU credits |
| **Codebase Awareness** | map-codebase (6 parallel agents) | Repo map (auto) | Auto-index (embeddings) | Auto-index | On-demand reads | Auto-index (RAG + AST) | Auto-index | Auto-analyze |
| **Browser Testing** | No (not PAN's job) | No | No | No | Yes (Puppeteer) | No | No | Yes |
| **Autocomplete** | Via host tool | No | Best-in-class (Tab) | Good | No | Good | Good | No |
| **IDE Integration** | Via host tool | Terminal only | Native (is the IDE) | Plugin | Plugin | Native (is the IDE) | Plugin + web | Cloud IDE |
| **MCP Support** | Via host tool | No | Limited | No | Deep (native) | Limited | No | No |

---

## Where PAN Wizard Leads

These are capabilities no other tool matches:

1. **Context Rot Prevention** — Every plan executes in a fresh 200K context window. No accumulated garbage, no quality degradation. No competitor solves this
2. **Research-Before-Planning** — Dedicated researcher agents investigate the domain before the planner starts. Cursor, Cline, and Copilot all plan without research
3. **Plan Verification Loop** — A dedicated plan-checker agent verifies plans achieve phase goals before execution begins. Nobody else does this
4. **Human UAT Workflow** — Structured acceptance testing with auto-diagnosis of failures and generated fix plans. No competitor offers structured UAT
5. **5-Runtime Support** — Works across Claude Code, OpenCode, Gemini CLI, Codex, and Copilot CLI. Every competitor is locked to one IDE or tool
6. **Zero Runtime Dependencies** — Only uses Node.js builtins (`fs`, `path`, `child_process`, `os`, `crypto`). No Python, no Electron, no npm install
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
| CI/CD automation | **Continue.dev** | Background agents in CI pipelines |
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
