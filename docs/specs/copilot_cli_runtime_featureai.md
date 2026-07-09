# Feature Specification: GitHub Copilot CLI Runtime Support

**Feature:** Add GitHub Copilot CLI as PAN Wizard's 5th supported runtime
**Generated:** 2026-02-28
**Status:** Proposed
**ADR:** ADR-0002

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

GitHub Copilot CLI — the terminal-native coding agent — went GA on February 25, 2026 and is included in all Copilot plans (Free, Pro, Pro+, Business, Enterprise). PAN Wizard currently supports 4 runtimes (Claude Code, OpenCode, Gemini CLI, Codex) but not Copilot CLI, which means the largest commercial AI developer tool ecosystem is partially locked out. Copilot CLI supports custom agents (`.agent.md`), skills (`SKILL.md`), hooks, and MCP servers — all concepts PAN already maps to. The cost of NOT doing this is losing access to GitHub's 150M+ developer install base and ceding the "structured workflow orchestration" space on Copilot CLI to competitors or GitHub's own native planning features.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| User-stated pain | This conversation | User asked "do we cater for copilot" — direct demand signal |
| Competitor parity | GitHub Copilot CLI GA | Copilot CLI ships plan mode, skills, agents, hooks — same concepts PAN uses |
| Market timing | GitHub Changelog 2026-02-25 | GA just 3 days ago — first-mover window for structured workflow tools |
| Community signals | github.com/github/copilot-cli/issues/783 | Feature request for "Native Plan Mode Support" — users want structured planning on Copilot CLI |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Installer support: `--copilot` flag for Copilot CLI runtime | Copilot coding agent (cloud-based PR agent) — different product, different API |
| All 32 commands converted to Copilot CLI format | VS Code Copilot integration — IDE-based, not terminal CLI |
| All 11 agents converted to `.agent.md` format | Copilot Extensions marketplace — requires GitHub App registration |
| Hook installation (Copilot CLI supports hooks natively) | MCP server bundling — PAN doesn't ship MCP servers |
| Global (`~/.copilot/`) and local (`.github/`) install paths | GitHub Enterprise Server support — standard Copilot CLI only |
| Uninstall support (`--uninstall`) | Plugin distribution via `/plugin install` — future enhancement |
| Documentation updates (README, USER-GUIDE, CHANGELOG) | Custom model configuration — Copilot CLI handles models internally |

### 0.4 Success Criteria

```
SC-1: User can install PAN for Copilot CLI with `npx pan-wizard --copilot --global`
SC-2: All 32 commands work as skills via /pan-command-name in Copilot CLI
SC-3: All 11 agents available via /agent menu or @pan-agent-name invocation
SC-4: Hooks (statusline, context monitor, update check) installed and functional
SC-5: No regression in existing 644+ tests
SC-6: Installation works on Windows, Mac, and Linux
SC-7: Uninstall cleanly removes all PAN artifacts from Copilot CLI directories
```

### 0.5 User Stories

```
As a developer using GitHub Copilot CLI, I want to install PAN Wizard,
so that I get structured workflow automation (plan-execute-verify),
instead of ad-hoc prompting without context management.

As a team using GitHub Copilot Business, I want PAN Wizard in our Copilot CLI,
so that every developer gets consistent project workflows across sessions,
instead of each person managing their own prompt patterns.

As a developer switching between Claude Code and Copilot CLI, I want PAN to work in both,
so that I can use the same workflow regardless of which AI tool I'm using,
instead of learning different project management approaches per tool.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| Codex runtime support | Partial | Codex (OpenAI) and Copilot CLI (GitHub/Microsoft) are different products with different file formats. No cannibalization — additive. |
| `pan:help` command | None | Help already lists multi-runtime info. Just needs a 5th entry. |
| `pan:update` command | None | Update flow is runtime-agnostic. |

**No full overlap.** This is a new runtime, not a new command.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 32 | 32 | +0 |
| New concepts introduced | 0 | 0 | +0 |
| Runtimes supported | 4 | 5 | +1 |
| Score | -- | -- | **neutral (0)** |

No new commands or concepts. Same PAN workflow, one more runtime option.

---

## Phase 1: Internal Reconnaissance

### 1.1 Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Multi-runtime installer | Complete | `bin/install.js` | Core — must add 5th runtime branch |
| Runtime flag parsing | Complete | `bin/install.js:20-42` | Add `--copilot` flag |
| Directory name mapping | Complete | `getDirName()` | Add Copilot CLI mapping |
| Global dir resolution | Complete | `getGlobalDir()` | Add `COPILOT_CONFIG_DIR` / `~/.copilot/` |
| Command → skill conversion | Complete | `convertClaudeCommandToCodexSkill()` | Template for Copilot CLI converter |
| Agent format conversion | Complete | `convertClaudeToCodexMarkdown()` | Template — but Copilot CLI uses `.agent.md` natively |
| Hook installation | Complete | Lines 1768-1814 | Copilot CLI supports hooks natively (unlike Codex) |
| Settings.json construction | Complete | Lines 1834-1901 | Copilot CLI uses `config.json` not `settings.json` |
| Tool name mapping | Complete | Lines 327-390 | Need new Claude → Copilot CLI mapping |
| Uninstall logic | Complete | Lines 975-1225 | Add Copilot CLI cleanup paths |
| Frontmatter conversion | Complete | Multiple functions | Need Copilot CLI-specific converter |
| Attribution handling | Complete | `getCommitAttribution()` | Add Copilot CLI attribution check |

### 1.2 Key File Format Differences

| Aspect | Claude Code | Copilot CLI |
|--------|------------|-------------|
| **Commands** | `commands/pan/*.md` with YAML frontmatter | `skills/pan-*/SKILL.md` with YAML frontmatter |
| **Agents** | `agents/*.md` with YAML frontmatter | `agents/*.agent.md` with YAML frontmatter |
| **Hooks** | `settings.json` hooks section | `.github/hooks/*.json` or `~/.copilot/hooks/` |
| **Config** | `settings.json` | `config.json` |
| **Instructions** | `CLAUDE.md` | `.github/copilot-instructions.md` or `~/.copilot/copilot-instructions.md` |
| **Command prefix** | `/pan:` | `/pan-` (skills use `/skill-name`) |
| **Agent invocation** | `Task(subagent_type="pan-planner")` | `/agent` menu or `copilot --agent=pan-planner` |
| **Tool names** | `Read`, `Write`, `Edit`, `Bash`, `Glob`, `Grep` | `read`/`view`, `edit`, `bash`/`execute`, `glob`, `grep`/`search` |
| **Global path** | `~/.claude/` | `~/.copilot/` |
| **Local path** | `.claude/` | `.github/` (or `.copilot/`) |
| **MCP config** | `settings.json` mcpServers | `~/.copilot/mcp-config.json` |

### 1.3 Convention Enforcement

- [x] No new core module needed — installer-only change
- [x] No new pan-tools.cjs commands
- [x] Zero runtime dependencies maintained
- [x] CommonJS only
- [x] All paths through `toPosix()` in output
- [x] Install/uninstall follows existing patterns

### 1.4 Dependency Map

```
[Copilot CLI Runtime]
    ├── depends on: bin/install.js (installer — primary change)
    ├── depends on: pan-wizard-core/ (shared, unchanged)
    ├── extends: Runtime selection (--copilot flag)
    ├── conflicts with: nothing
    └── enables: GitHub Copilot ecosystem access
```

No new modules. No circular dependencies. Pure installer enhancement.

---

## Phase 2: Competitive Intelligence

### 2.1 Copilot CLI Native Capabilities vs PAN

| Capability | Copilot CLI Native | PAN Wizard Adds |
|------------|-------------------|-----------------|
| Plan mode | Basic: analyze → plan → execute | Structured: research → plan → verify → execute → verify |
| Context management | Auto-compact at 95%, memory across sessions | Phase-scoped 200K windows, state.md persistence |
| Multi-agent | Built-in sub-agents (Explore, Task, Code Review, Plan) | 11 specialized agents with model profile control |
| Session persistence | Built-in memory | state.md + pause/resume + handoff docs |
| Hooks | Full hook support (7 event types) | 3 PAN hooks (statusline, context monitor, update check) |
| Skills | User-created SKILL.md files | 32 pre-built workflow commands |
| Git integration | Basic commit support | Atomic commits per task, branching strategies, conventional commits |
| Verification | No post-execution verification | Auto-verifier + human UAT workflow |
| Requirement tracing | None | REQ-ID tracing from definition through implementation |

### 2.2 Why PAN on Copilot CLI Makes Sense

Copilot CLI has the infrastructure (agents, skills, hooks) but lacks structured workflow orchestration. It's like having a powerful engine without a transmission. PAN provides:

1. **Structure** — Break work into phases that fit context windows
2. **Verification** — Check work was done correctly, not just done
3. **Persistence** — `.planning/` directory survives any session boundary
4. **Reproducibility** — Same workflow regardless of developer

### 2.3 Competitive Matrix (Runtime Support)

| Tool | Claude Code | OpenCode | Gemini CLI | Codex | Copilot CLI |
|------|-----------|----------|-----------|-------|-------------|
| **PAN Wizard** | Yes | Yes | Yes | Yes | **Proposed** |
| **Aider** | No | No | No | No | No (own CLI) |
| **Cline** | No | No | No | No | No (VS Code) |
| **Cursor** | No | No | No | No | No (own IDE) |
| **Windsurf** | No | No | No | No | No (own IDE) |

PAN Wizard is unique in multi-runtime support. Adding Copilot CLI extends the lead.

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Decision |
|--------|----------|
| **ELIMINATE** | Runtime lock-in — PAN should work everywhere |
| **REDUCE** | Installation friction — one command for any runtime |
| **RAISE** | Runtime coverage — from 4 to 5, covering GitHub's massive ecosystem |
| **CREATE** | First structured workflow tool for Copilot CLI — nobody else has this |

### 3.2 Wardley Evolution

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                                   ↑
                              PAN Wizard
                          (multi-runtime workflow)
```

Multi-runtime workflow orchestration is in the **Product** phase. GitHub building native plan mode pushes it toward commodity. PAN must differentiate on **depth** (research → plan → verify → execute → verify) vs GitHub's simpler plan-execute.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score |
|-----------|-------------|-------|
| **Context Engineering** | Phase-scoped windows prevent rot; Copilot CLI's auto-compact is weaker | 4 |
| **Cross-Platform** | 5th runtime — unmatched coverage | 5 |
| **Developer Experience** | Same `/pan:` workflow on any AI tool | 4 |
| **Zero Dependencies** | Maintained — installer is pure Node builtins | 5 |
| **State Persistence** | `.planning/` works across all runtimes | 4 |
| **Verification Quality** | Post-execution verification unique to PAN | 4 |
| **Total** | | **26/30** |

### 3.4 Strategic Recommendation

**BUILD — High Priority.** Copilot CLI went GA 3 days ago with full skill/agent/hook support matching PAN's architecture. The implementation is a proven pattern (4 runtimes already working), the effort is bounded (installer changes only, no core logic), and the strategic value is enormous (GitHub's entire developer ecosystem). PAN should NOT copy Copilot CLI's native plan mode — instead, position PAN as the structured orchestration layer that turns Copilot CLI's raw agent power into a repeatable, verifiable workflow. Ship within 1-2 sessions while the first-mover window is open.

---

## Phase 3.5: Architecture & Implementation

### 3.5.1 Feature Type

**Installer Enhancement** — Modify `bin/install.js` to handle a 5th runtime. No new core modules, no new commands, no new agents.

### 3.5.2 Layer Violation Check

- [x] No command .md changes (content is converted at install time)
- [x] No core module changes
- [x] No agent definition changes
- [x] No upward dependencies
- [x] Pure installer-layer change

### 3.5.3 Output Contract

No new JSON output. The installer produces files on disk, not JSON API responses.

### 3.5.4 State Transitions

N/A — The installer does not mutate `.planning/` state files.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's JSON output schema? | No |
| Changes file formats? | No |
| Changes directory structure? | No |
| Changes installer output? | **Yes** — adds `--copilot` flag, new install target |

**Migration:** None needed. Additive change. Existing runtimes unchanged.

### 3.5.6 Composability

| Interaction | Works? | How |
|-------------|--------|-----|
| All 32 PAN commands available | Yes | Installed as SKILL.md files |
| All 11 agents available | Yes | Installed as .agent.md files |
| Hooks functional | Yes | Copilot CLI supports preToolUse, postToolUse, sessionStart |
| pan-wizard-core shared | Yes | Same lib directory, unchanged |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| File reads (32 commands + 11 agents) | ~215ms | Read source .md files |
| Frontmatter conversion | ~50ms | String replacements per file |
| File writes (32 skills + 11 agents + hooks) | ~230ms | Write converted files |
| Settings/config merge | ~10ms | Read + write config.json |
| **Total** | **~505ms** | Acceptable for one-time install |

### 3.5.8 Cross-Platform

| Platform | Consideration |
|----------|---------------|
| Windows | `~/.copilot/` resolves via `os.homedir()` — already handled for other runtimes |
| Mac/Linux | Standard `~/.copilot/` path |
| All | `path.join()` for all paths, `toPosix()` for any output |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

**GitHub Copilot CLI Runtime Support**

PAN Wizard now works with GitHub Copilot CLI — the terminal-native coding agent included in all Copilot plans. Install PAN once and get all 37 workflow commands, 11 specialized agents, and 3 hooks directly in Copilot CLI.

**Install:**
```bash
npx pan-wizard --copilot --global   # Install to ~/.copilot/
npx pan-wizard --copilot --local    # Install to ./.github/
```

**Use:**
```
copilot
> /pan-new-project            # Start a new project
> /pan-plan-phase 1            # Research + plan + verify
> /pan-execute-phase 1         # Parallel execution
> /pan-verify-work 1           # Manual UAT
```

**Agents appear in Copilot CLI's agent menu:**
```
> /agent
  pan-planner
  pan-executor
  pan-verifier
  ...
```

**What it does NOT do:**
- Does not integrate with Copilot coding agent (the cloud PR bot)
- Does not publish to GitHub's plugin marketplace
- Does not replace Copilot CLI's native plan mode (PAN adds structure on top)

### 4.2 Technical Details

#### 4.2.1 Installation Paths

| Scope | Path | Notes |
|-------|------|-------|
| Global skills | `~/.copilot/skills/pan-*/SKILL.md` | 37 skill directories |
| Global agents | `~/.copilot/agents/pan-*.agent.md` | 11 agent files |
| Global hooks | `~/.copilot/hooks/pan-*.json` | 3 hook configs |
| Global core | `~/.copilot/pan-wizard-core/` | Shared library |
| Global instructions | `~/.copilot/copilot-instructions.md` | Appended, not replaced |
| Local skills | `.github/skills/pan-*/SKILL.md` | Project-scoped |
| Local agents | `.github/agents/pan-*.agent.md` | Project-scoped |
| Local hooks | `.github/hooks/pan-*.json` | Project-scoped |
| Local core | `.github/pan-wizard-core/` | Project-scoped |

#### 4.2.2 File Format Conversions

**Commands → Skills (`SKILL.md`):**
```yaml
---
name: pan-new-project
description: Initialize a new project with deep context gathering and project.md
---

[converted command content]
```

Key conversions:
- `/pan:command` → `/pan-command`
- `$ARGUMENTS` → user prompt text (skills receive context naturally)
- Tool names: `Read` → `read`, `Write` → `edit`, `Bash` → `bash`, `Glob` → `glob`, `Grep` → `search`, `WebSearch` → `web`, `AskUserQuestion` → (natural conversation)
- `Task(subagent_type="pan-planner")` → `/agent pan-planner` or delegate pattern

**Agents → `.agent.md`:**
```yaml
---
name: pan-planner
description: Creates detailed phase execution plans with task breakdown and verification
tools: ["read", "edit", "bash", "glob", "search", "web"]
---

[converted agent instructions]
```

**Hooks → JSON config:**
```json
{
  "name": "pan-context-monitor",
  "event": "postToolUse",
  "command": "node ~/.copilot/hooks/pan-context-monitor.js"
}
```

#### 4.2.3 Tool Name Mapping

| Claude Code | Copilot CLI | Notes |
|------------|-------------|-------|
| `Read` | `read` | Also aliased as `view` |
| `Write` | `edit` | Copilot CLI uses `edit` for both write and edit |
| `Edit` | `edit` | Same tool |
| `Bash` | `bash` | Also aliased as `execute` |
| `Glob` | `glob` | Same |
| `Grep` | `search` | Aliased as `grep` |
| `WebSearch` | `web` | Web search tool |
| `WebFetch` | `web` | Same web tool |
| `TodoWrite` | `todo` | Todo management |
| `AskUserQuestion` | (native) | Copilot CLI handles conversation natively |
| `Task` / `Agent` | `agent` | Sub-agent spawning |
| MCP tools (`mcp__*`) | MCP tools | Pass through unchanged |

### 4.3 Design Decisions

| Decision | Rationale | What We Did NOT Copy |
|----------|-----------|---------------------|
| Use `/pan-` prefix for skills (not `/pan:`) | Copilot CLI skills use simple names; colons not standard | Codex's `$pan-` prefix (Copilot CLI uses `/`) |
| Install agents as `.agent.md` (not `.md`) | Copilot CLI convention for agent files | Claude's plain `.md` agent format |
| Use native hook system (not settings.json) | Copilot CLI has its own hook JSON format | Claude's settings.json hook registration |
| Local install to `.github/` (not `.copilot/`) | Copilot CLI reads skills/agents from `.github/` for project scope | Claude's `.claude/` pattern |

### 4.4 Feature Ladder

| Version | Scope | Value | Effort |
|---------|-------|-------|--------|
| **v0 (MVP)** | Installer: `--copilot` flag, all 32 commands as skills, all 11 agents as .agent.md, core lib, docs | Full PAN workflow on Copilot CLI | **M** |
| **v1 (Complete)** | Hooks installation, `copilot-instructions.md` integration, uninstall support | Hooks + instructions + clean removal | **S** |
| **v2 (Enhanced)** | Plugin distribution (`/plugin install oharms/PanWizard`), MCP server bundling | One-command install from within Copilot CLI | **L** |

### 4.5 Adoption Analysis

| Question | Answer |
|----------|--------|
| Discovery | `npx pan-wizard` interactive menu shows "GitHub Copilot CLI" as 5th option |
| Learning curve | Zero — same PAN commands, different runtime prefix |
| Workflow change | None — drop-in, same discuss → plan → execute → verify loop |
| Aha moment | Running `/pan-new-project` in Copilot CLI and seeing the full workflow work |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0002-copilot-cli-runtime.md`.

---

## Phase 6: Error Handling & Diagnostics

### 6.1 Failure Modes

| Failure Mode | Category | Detection | Recovery | User Sees |
|-------------|----------|-----------|----------|-----------|
| Copilot CLI not installed | User error | `which copilot` check | Warning message, install anyway | "Warning: copilot command not found. Files installed but verify Copilot CLI is installed." |
| `~/.copilot/` doesn't exist | First install | `fs.existsSync()` | Create directory | Silent creation |
| `.github/` doesn't exist | First local install | `fs.existsSync()` | Create directory | Silent creation |
| Skills dir has existing non-PAN skills | Normal usage | Check for `pan-` prefix only | Only modify PAN skills | Non-PAN skills untouched |
| Config.json has existing settings | Normal usage | Read-merge-write | Merge PAN settings, preserve existing | Clean merge |
| Permission denied on `~/.copilot/` | Environment | try-catch on write | Error message with sudo hint | "Permission denied writing to ~/.copilot/. Try with elevated permissions." |
| Copilot CLI version too old | Compatibility | Check for skills/agents/hooks support | Warning with version requirement | "Warning: Copilot CLI may not support skills. Version X.Y+ required." |

### 6.2 Diagnostics

| Diagnostic | How | When |
|------------|-----|------|
| `--copilot` flag | Runtime selection | Install time |
| Verification output | Lists installed skills/agents count | Post-install |
| `npx pan-wizard --copilot --global --uninstall` | Clean removal | Uninstall |

---

## Phase 7: Security & Threat Model

### 7.1 Attack Surface

| Asset | Access | Trust Level |
|-------|--------|-------------|
| `~/.copilot/skills/pan-*/SKILL.md` | Write (install), Read (Copilot CLI) | System-generated, user-writable |
| `~/.copilot/agents/pan-*.agent.md` | Write (install), Read (Copilot CLI) | System-generated, user-writable |
| `~/.copilot/hooks/pan-*.js` | Write (install), Execute (Copilot CLI) | System-generated — **executable code** |
| `~/.copilot/config.json` | Read-Modify-Write | User-controlled |

### 7.2 Key Risks

| Risk | Mitigation |
|------|-----------|
| Hook scripts execute arbitrary code | Hooks are copied from PAN's `hooks/dist/` (built from audited source). No user input in hook content. |
| Config.json tampering | Read-merge-write pattern preserves existing config. PAN only adds its own keys. |
| Path traversal in install | All paths constructed via `path.join()` from known base directories. No user-supplied path components in file content. |
| Skills injecting malicious prompts | Skills contain static PAN workflow instructions. No dynamic content injection. |

### 7.3 Output Sanitization

- [x] No absolute paths in skill/agent content (use relative references)
- [x] No environment variables exposed in skill content
- [x] No secrets in any installed file
- [x] Hook scripts use same hardened code as Claude Code hooks

---

## Phase 8: Implementation Roadmap

### 8.1 Tasks

#### Task 1: Add `--copilot` flag and runtime constants
**Files:** `bin/install.js`
**Changes:** Add flag parsing, `getDirName()`, `getGlobalDir()`, `getConfigDirFromHome()`, runtime labels
**Estimate:** S
**Priority:** P3

#### Task 2: Create Copilot CLI frontmatter converter
**Files:** `bin/install.js`
**Changes:** New function `convertClaudeToCopilotSkill()` — converts command .md to SKILL.md format with Copilot CLI tool names and conventions
**Estimate:** S
**Priority:** P3

#### Task 3: Create Copilot CLI agent converter
**Files:** `bin/install.js`
**Changes:** New function `convertClaudeToCopilotAgent()` — converts agent .md to .agent.md format with Copilot CLI YAML frontmatter (tools list, description)
**Estimate:** S
**Priority:** P3

#### Task 4: Create Copilot CLI tool name mapping
**Files:** `bin/install.js`
**Changes:** New mapping table `CLAUDE_TO_COPILOT_TOOLS` — maps Claude Code tool names to Copilot CLI equivalents
**Estimate:** XS
**Priority:** P3

#### Task 5: Implement skill installation
**Files:** `bin/install.js`
**Changes:** Function `copyCommandsAsCopilotSkills()` — creates `skills/pan-*/SKILL.md` directories, similar to existing `copyCommandsAsCodexSkills()`
**Estimate:** S
**Priority:** P3

#### Task 6: Implement agent installation
**Files:** `bin/install.js`
**Changes:** Copy agents as `.agent.md` files with converted frontmatter
**Estimate:** XS
**Priority:** P3

#### Task 7: Implement hook installation
**Files:** `bin/install.js`
**Changes:** Copy hook JS files, create hook JSON configs for Copilot CLI's hook format (sessionStart, postToolUse events)
**Estimate:** S
**Priority:** P3

#### Task 8: Implement config.json handling
**Files:** `bin/install.js`
**Changes:** Read/merge/write `~/.copilot/config.json` (or `.github/config.json` for local) — register hooks, set any required settings
**Estimate:** S
**Priority:** P3

#### Task 9: Implement uninstall
**Files:** `bin/install.js`
**Changes:** Remove PAN skills, agents, hooks, core lib from Copilot CLI directories
**Estimate:** S
**Priority:** P3

#### Task 10: Update interactive prompts
**Files:** `bin/install.js`
**Changes:** Add "GitHub Copilot CLI" to runtime selection menu, update `--all` to include copilot, add help text
**Estimate:** XS
**Priority:** P3

#### Task 11: Update documentation
**Files:** `README.md`, `docs/USER-GUIDE.md`, `CHANGELOG.md`
**Changes:** Add Copilot CLI to all runtime lists, command syntax tables, installation examples, feature availability matrix
**Estimate:** S
**Priority:** P3

#### Task 12: Add installer tests
**Files:** `tests/installer-copilot.test.cjs` (new)
**Changes:** Test skill generation, agent conversion, tool name mapping, hook installation, config merge, uninstall. Integration tests using the installer's conversion functions.
**Estimate:** M
**Priority:** P3

### 8.2 Dependency Graph

```
Task 4 (Tool mapping)
  ├─→ Task 2 (Skill converter) ─→ Task 5 (Skill install)
  └─→ Task 3 (Agent converter) ─→ Task 6 (Agent install)
                                        │
Task 1 (Flags/constants) ───────────────┤
                                        │
Task 7 (Hook install) ─→ Task 8 (Config) ─→ Task 9 (Uninstall)
                                                    │
Task 10 (Interactive prompts) ──────────────────────┤
                                                    │
Task 11 (Docs) ────────────────────────────────────┘
                                                    │
Task 12 (Tests) ───────────────────────────────────┘
```

### 8.3 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Copilot CLI file format changes post-GA | Low | Medium | Monitor GitHub Changelog; format is stable post-GA |
| Hook JS execution differences | Medium | Low | Same Node.js hooks; Copilot CLI runs them via `node` |
| `.github/` conflicts with existing repo files | Medium | Low | Only create `skills/pan-*/` and `agents/pan-*.agent.md` — namespaced |
| Installer grows too large | Low | Low | Install.js is already 2,157 lines for 4 runtimes; +200-300 lines is manageable |
| Tool name mapping incomplete | Medium | Medium | Start with documented aliases; iterate based on testing |

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Count | What |
|-------|-------|------|
| **Unit** | 8+ | Converter functions: skill, agent, tool mapping, hook config generation |
| **Integration** | 6+ | Full install/uninstall cycle, file existence checks, content validation |
| **E2E** | 2+ | Install → verify skills exist → uninstall → verify clean |

### 9.2 Key Test Cases

1. `convertClaudeToCopilotSkill()` — correct YAML frontmatter, tool names converted, prefix converted
2. `convertClaudeToCopilotAgent()` — `.agent.md` format, tools list, description
3. Tool name mapping — all Claude tools mapped to Copilot equivalents
4. Skill directory structure — `skills/pan-{name}/SKILL.md` created correctly
5. Agent file naming — `pan-{name}.agent.md` (not `.md`)
6. Hook JSON config — correct event types, command paths
7. Config.json merge — existing settings preserved, PAN settings added
8. Uninstall — all PAN files removed, non-PAN files untouched
9. `--all` flag — includes Copilot CLI in the list
10. Interactive menu — Copilot CLI appears as option 5

### 9.3 Regression

- [x] All existing 644 tests pass unchanged
- [x] Claude Code, OpenCode, Gemini, Codex installation paths unchanged
- [x] No core module changes — zero regression risk on pan-tools

---

## Summary Statistics

| Metric | Value |
|--------|-------|
| Tasks | 12 |
| New files | 1 (test file) |
| Modified files | 4 (install.js, README.md, USER-GUIDE.md, CHANGELOG.md) |
| Effort | M (total ~30-40 pts across tasks) |
| Tests planned | 16+ (unit: 8, integration: 6, e2e: 2) |
| Breaking changes | None |
| New dependencies | None |

---

## Feature Reality Score

```
User Value (UV):     4  — Common usage, most Copilot CLI users benefit
Time Criticality (TC): 4  — Copilot CLI just went GA, first-mover advantage
Risk Reduction (RR):  3  — Unblocks entire GitHub ecosystem
Job Size (JS):       3  — M effort

RS = (4 + 4 + 3) / 3 = 3.67 → DO
```

---

*Generated by /featureAI*
