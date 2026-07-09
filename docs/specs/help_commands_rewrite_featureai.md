# Feature Specification: Help Document & Commands End-to-End Rewrite

**Feature ID:** help-rewrite-v1
**Date:** 2026-03-02
**Mode:** `--full` (all 10 phases)
**Author:** Claude (focus-design pipeline)

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard's help document (`/pan:help`) and command descriptions are not client-friendly. The current help output is a 380-line static markdown dump that reads like internal developer documentation rather than user-facing reference material. New users face a wall of 37 commands across 8 groups with descriptions written in implementation language ("wave-based parallelization", "UAT", "context handoff") rather than outcome-oriented plain English. The command naming is inconsistent (5 Focus commands lack the `pan:` prefix, `patches.md` is missing frontmatter fields entirely), and the help document mixes quick-reference tables with detailed prose explanations in a single undifferentiated stream, making it impossible to quickly find what you need.

This matters NOW because PAN Wizard just shipped v2.2.0 with 87 internal subcommands and 37 user-facing slash commands across 5 runtimes. The gap between the tool's power and its accessibility is the primary adoption barrier. The cost of NOT doing this is that every new user's first experience with PAN is information overload followed by confusion.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| User-stated pain | This conversation | User says: "the help document and commands are not good and not client friendly" — direct request for end-to-end rewrite |
| Competitive parity | GitHub Copilot CLI (GA Feb 2026) | Ships with 4 functional groups, dropdown-on-slash discovery, `/changelog` for version discovery — PAN's flat dump falls behind |
| Community pattern | Claude Code ecosystem (DEV.to article) | Claude Code's own `/help` criticized for hidden commands, flat listing, no grouping — community created unofficial organized guides. PAN inherits the same problem |
| Industry best practice | clig.dev CLI Guidelines | Explicitly recommends: categorical grouping, progressive disclosure, outcome-oriented descriptions, argument hints — PAN violates all four |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Rewrite help.md workflow content | Adding new commands (separate feature work) |
| Rewrite all 37 command frontmatter descriptions | Changing command behavior or implementation |
| Fix naming inconsistencies (pan: prefix, patches.md) | Renaming commands (already done in v0.9.0, session 16) |
| Standardize argument-hint format | Changing argument parsing logic |
| Add progressive disclosure (quick ref vs detail) | Adding interactive help (would require new module) |
| Redesign group structure and names | Adding new groups or removing existing ones |
| Update CLI-REFERENCE.md, USER-GUIDE.md in sync | Rewriting ARCHITECTURE.md or DEVELOPMENT.md |
| Propagate to all 5 runtime directories | Changing installer behavior |

### 0.4 Success Criteria (Measurable)

```
SC-1: A new user can find the right command for their task within 10 seconds of reading /pan:help
SC-2: Every command description answers "what does this DO for me?" in plain English (no jargon)
SC-3: All 37 commands have consistent frontmatter (name with pan: prefix, group, description, argument-hint where applicable)
SC-4: Help document has clear layered structure: one-liner overview → grouped quick-ref → detailed sections (progressive disclosure)
SC-5: No regression in existing tests (1139/1139 pass)
SC-6: All 5 runtime directories receive identical updates
```

### 0.5 User Stories

```
US-1: As a developer who just installed PAN Wizard, I want to run /pan:help and immediately
understand what PAN does and which command to run first, so that I can start my first
project without reading external docs, instead of being overwhelmed by a wall of 37 commands.

US-2: As a developer mid-project who forgot the exact command name, I want to scan the help
output by group and find my command in 5 seconds, so that I don't lose my train of thought,
instead of scrolling through 380 lines of mixed tables and prose.

US-3: As a developer evaluating PAN vs competitors, I want the help output to clearly
communicate PAN's value proposition and workflow model, so that I understand why PAN
is worth learning, instead of seeing dense technical jargon that reads like internal docs.

US-4: As a developer using Focus commands on a brownfield project, I want the help output to
clearly separate the Focus workflow from the Phase Lifecycle workflow, so that I understand
which commands apply to my situation, instead of trying to figure out which of 37 commands
I actually need.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:help` | Full (this IS the target) | Rewrite in place |
| `/pan:progress` | None | Shows project state, not command reference |
| `/pan:settings` | None | Shows config, not help |
| USER-GUIDE.md | Partial | Both document commands; help = quick ref, guide = tutorial |
| CLI-REFERENCE.md | Partial | CLI-REF covers internal 87 subcommands; help covers 37 user slash commands |

**Full overlap:** `/pan:help` is the target — this is an enhancement, not a new command.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 37 (all presented equally) | 6 (highlighted starter set) | -31 initial |
| New concepts introduced | 0 | 0 | 0 |
| Score | — | — | simplifies (-1) |

---

## Phase 1: Internal Reconnaissance

### 1.1 Architecture Scan — Existing Capabilities Inventory

| Capability | Status | Location | Relevance |
|------------|--------|----------|-----------|
| Help workflow | Exists | `pan-wizard-core/workflows/help.md` | Target for rewrite |
| Help command | Exists | `commands/pan/help.md` | Orchestrator — loads workflow |
| Command frontmatter | Exists | 37 files in `commands/pan/*.md` | Descriptions need rewrite |
| Group system | Exists | Frontmatter `group:` field | 8 groups defined |
| Argument hints | Partial | Frontmatter `argument-hint:` field | 5 Focus commands missing hints |
| CLI-REFERENCE | Exists | `docs/CLI-REFERENCE.md` | Must stay in sync |
| USER-GUIDE | Exists | `docs/USER-GUIDE.md` | Must stay in sync |
| Runtime propagation | Exists | Installer handles 5 runtimes | All changes must propagate |

### 1.2 Current Help Document Analysis

**Structure (380 lines):**
1. Title + tagline (2 lines)
2. Two Workflows overview (46 lines) — good concept, too much detail
3. Focus Commands In Detail (98 lines) — full flags/modes documentation mid-help
4. All Commands table (70 lines) — 8 groups, terse descriptions
5. Common Patterns (40 lines) — useful but buried
6. Phase Lifecycle Detail (20 lines) — per-command prose
7. Milestone Management Detail (12 lines)
8. Session & Debugging Detail (12 lines)
9. Configuration (10 lines)
10. Files & Structure (25 lines)
11. Staying Updated + Getting Help (10 lines)

**Problems identified:**
1. **No progressive disclosure** — everything dumped at once (380 lines)
2. **Focus Commands get 98 lines of detail before the command table** — buries the overview
3. **Descriptions use jargon** — "wave-based parallelization", "UAT", "context handoff", "Reality Score filtering"
4. **No "start here" guidance** — new users see 37 commands with no clear entry point
5. **Common Patterns buried at line 230** — most useful section least discoverable
6. **Mixing quick-ref and deep-dive** — tables and prose interleaved without visual hierarchy

### 1.3 Command Frontmatter Issues Found

| Issue | Files Affected | Fix |
|-------|---------------|-----|
| Missing `pan:` prefix on `name` | focus-design, focus-exec, focus-plan, focus-scan, focus-sync (5) | Add `pan:` prefix |
| Missing `name` field entirely | patches.md (1) | Add `name: pan:patches` |
| Missing `group` field | patches.md (1) | Add `group: System` |
| Verbose `argument-hint` | map-codebase, milestone-new, todo-add, verify-phase (4) | Shorten to token format |
| Stray `</output>` tag | help.md (1) | Remove tag |
| Extra unique fields | milestone-done (`type:`), plan-phase (`agent:`), phase-tests (`argument-instructions:`) (3) | Leave as-is (harmless) |

### 1.4 Convention Enforcement Checklist

- [x] Function naming convention followed — N/A (content-only change)
- [x] File reads use safe read pattern — N/A
- [x] File writes wrapped in try-catch — N/A
- [x] JSON output via standard output function — N/A
- [x] Errors via standard error function — N/A
- [x] Paths in output pass through normalization — N/A
- [x] Module exports at bottom — N/A
- [x] Subcommands dispatched via standard routing — N/A
- [x] Module format CommonJS — N/A
- [x] Zero runtime dependencies — N/A (content-only)

### 1.5 Dependency & Integration Map

```
[Help Rewrite]
    ├── modifies: pan-wizard-core/workflows/help.md
    ├── modifies: 37 x commands/pan/*.md (frontmatter only)
    ├── modifies: docs/CLI-REFERENCE.md (description sync)
    ├── modifies: docs/USER-GUIDE.md (description sync)
    ├── propagates to: .claude/, .github/, .opencode/, .gemini/, .codex/
    ├── depends on: nothing (content-only)
    ├── conflicts with: nothing
    └── enables: better onboarding, reduced support questions
```

---

## Phase 2: Competitive Intelligence

### 2.1 Deep-Dive Research (6 Tools)

| Tool | Help Structure | Command Naming | Discoverability | Strengths | Weaknesses |
|------|---------------|----------------|-----------------|-----------|------------|
| **Aider** | Flat alphabetical table of 46 commands | Lowercase, hyphenated, short | `/help <question>` AI-powered | AI help answers questions naturally | 46-command flat list is dense |
| **Cursor** | VS Code Command Palette | Filename-based custom commands | Palette search | Seamless IDE integration | No built-in `/help` in chat |
| **Continue.dev** | Dropdown-on-`/` with descriptions | Ultra-short verbs (`/edit`, `/share`) | Live searchable dropdown | Dropdown surfaces all commands on demand | Only 6 built-in — limited |
| **Cline** | Sidebar GUI, minimal CLI | Short single words (`/settings`) | GUI-based exploration | Visual discovery | No command reference |
| **Claude Code** | Flat merged list in `/help` | Lowercase, hyphenated | `/help` lists all commands | Merges custom + built-in | Hidden undocumented commands, no grouping |
| **GitHub Copilot CLI** | 4 functional groups in docs + dropdown | Consistent verb-noun hyphenated | Dropdown-on-`/` + grouped docs | Clearest categorical organization | New, less community feedback |

### 2.2 Best-in-Class Help Patterns Identified

1. **Progressive disclosure** (Copilot CLI): Quick overview → grouped tables → detail sections
2. **Outcome-oriented descriptions** (Continue.dev): "Edit code" not "Execute code modification with conflict resolution"
3. **Starter command highlighting** (all tools): Clear "start here" guidance
4. **Categorical grouping** (Copilot CLI): 4 functional categories vs flat list
5. **Common patterns section early** (Aider): Recipe-style workflows as primary discovery
6. **AI-powered help** (Aider): `/help <question>` for natural language queries

### 2.3 Competitive Matrix

| Aspect | PAN (Current) | PAN (Target) | Aider | Continue | Copilot CLI | Claude Code |
|--------|--------------|-------------|-------|----------|-------------|-------------|
| Grouping | 8 groups, presented flat | 4-5 groups, progressive | None | None (tiny count) | 4 groups | None |
| Descriptions | Jargon-heavy | Plain English, outcome-focused | Terse but clear | Short verbs | Clear, concise | Mixed quality |
| Progressive disclosure | None (380-line dump) | 3-tier (overview→table→detail) | Single table | N/A (6 commands) | Grouped cheat sheet | Single list |
| Start-here guidance | None | Clear onboarding path | `/help <q>` | Tiny surface area | Getting started section | `/init` |
| Common patterns | Buried line 230 | Top section | Not in help | N/A | Cheat sheet format | Not in help |

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Drop 98 lines of Focus detail from the quick reference section. Drop interleaved prose between tables. Drop the "Files & Structure" section (move to USER-GUIDE). Drop verbose argument hints. |
| **REDUCE** | What should be reduced? | Reduce help output from 380 lines to ~150 lines. Reduce descriptions from sentences to one-liners. Reduce groups from 8 to 5 (merge Getting Started into Phase Lifecycle, merge Community into System). |
| **RAISE** | What should be raised? | Raise discoverability via "Start Here" section. Raise workflow clarity via decision tree. Raise description quality to outcome-oriented plain English. |
| **CREATE** | What should we create? | Create 3-tier progressive disclosure (overview → grouped quick-ref → detail on demand). Create "Which workflow fits you?" decision tree. Create consistent argument-hint format across all 37 commands. |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                                   ^
                            CLI Help Systems
```

Help systems are in the **Product** stage — well-understood patterns exist (clig.dev guidelines, man pages, `--help` conventions). PAN should not innovate here; it should adopt best practices flawlessly. The unique angle is the 2-workflow structure (Phase Lifecycle vs Focus) which requires clear workflow routing — something no competitor has because they don't have two distinct operating modes.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Better help = better AI context when user asks for guidance | 3 |
| **Cross-Platform** | Consistent help across 5 runtimes | 4 |
| **Developer Experience** | First impression of PAN — critical for adoption | 5 |
| **Zero Dependencies** | N/A (content-only change) | 0 |
| **State Persistence** | N/A | 0 |
| **Verification Quality** | N/A | 0 |

### 3.4 Strategic Recommendation

**Build this — high priority.** The help document is the single most-viewed artifact in PAN Wizard. Every user interaction starts with `/pan:help` or browsing command descriptions. The current help fails at its primary job: helping users find the right command quickly. The rewrite requires zero code changes — it's pure content work with high impact and minimal risk. The unique angle is PAN's dual-workflow model (Phase Lifecycle vs Focus), which is genuinely novel among AI coding tools but currently poorly communicated. The timing is ideal: PAN v2.2.0 just shipped with full standards integration, making this the right moment to polish the user-facing layer before broader adoption push.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

**Type: Content Enhancement** — modify existing workflow file + command frontmatter. No new modules, commands, agents, or hooks.

### 3.5.2 Layer Violation Check

- [x] No layer violations possible — content-only changes to .md files
- [x] No code imports or dependencies added
- [x] No dispatcher changes

### 3.5.3 Output Contract Design

N/A — help output is human-readable markdown, not JSON. The help command's output contract is "display the workflow file content as-is."

### 3.5.4 State Transition Modeling

N/A — no state mutations.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's output schema? | No |
| Changes file formats? | No (still markdown) |
| Changes directory structure? | No |
| Changes installer output? | No |

### 3.5.6 Composability Analysis

N/A — help is a read-only display command.

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| File read (help.md) | ~5ms | Single workflow file |
| Display output | ~1ms | Pass-through |
| **Total** | **< 10ms** | No computation |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| All | Markdown rendering in terminal — keep lines under 100 chars for wrapping |
| All | Table alignment — use consistent column widths |
| All 5 runtimes | Same content, different file locations (installer handles propagation) |
| Gemini CLI | TOML format for commands — frontmatter changes need TOML conversion |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation (User-Facing)

When you type `/pan:help`, you'll see a concise, layered reference designed to get you to the right command fast:

**Layer 1 — The 10-Second Overview** (what PAN is + which workflow to pick):
```
PAN — Project Automation Navigator

New project?     → /pan:new-project
Existing project? → /pan:focus-scan
```

**Layer 2 — Grouped Quick Reference** (~37 commands in 5 groups, each with a plain-English one-liner):
```
Phase Lifecycle: new-project, plan-phase, exec-phase, verify-phase, progress
Focus Pipeline:  focus-scan, focus-plan, focus-exec, focus-sync, focus-design
Phase Tools:     add-phase, insert-phase, remove-phase, assumptions, phase-tests, phase-budget
Milestones:      milestone-new, milestone-done, milestone-audit, milestone-gaps, milestone-cleanup
Session & System: quick, pause, resume, profile, help, health, settings, update, debug, todo-add, todo-check, discord, patches
```

**Layer 3 — Common Recipes** (the 7 most common workflows as copy-paste patterns):
```
New project:     /pan:new-project → /pan:plan-phase 1 → /pan:exec-phase 1
Iterative work:  /pan:focus-scan → /pan:focus-plan → /pan:focus-exec
Design a feature: /pan:focus-design "description"
```

**Layer 4 — Detailed Reference** (per-group command details — only for users who need it).

### 4.2 Reference-Level Explanation (Technical)

#### 4.2.1 Help Document Structure (New)

```
Section 1: Title + One-Line Tagline (3 lines)
Section 2: Quick Start Decision Tree (10 lines)
Section 3: Two Workflows Overview (15 lines — summary only, not full flag docs)
Section 4: Common Recipes (25 lines — most useful section, placed early)
Section 5: All Commands Quick Reference (50 lines — 5 grouped tables, outcome-oriented one-liners)
Section 6: Focus Pipeline Detail (30 lines — flags/modes, condensed from 98 lines)
Section 7: Phase Lifecycle Detail (20 lines)
Section 8: Configuration + Files (15 lines — condensed)
Section 9: Getting Help + Updates (5 lines)
```

**Total: ~175 lines** (down from 380 — 54% reduction)

#### 4.2.2 Description Style Guide

**Before (jargon-heavy):**
- "Execute all plans in a phase with wave-based parallelization"
- "Validate built features through conversational UAT"
- "Create context handoff when pausing work mid-phase"
- "Deep-dive strategic work scan with prioritized items and Reality Score filtering"

**After (outcome-oriented):**
- "Build your phase — runs all plans, commits each task"
- "Test what was built against what was planned"
- "Save your place so you can pick up later"
- "Find everything that needs work, ranked by impact"

**Rules:**
1. Start with a verb that describes the USER outcome, not the internal mechanism
2. Max 10 words for the quick-reference description
3. No acronyms (UAT, RS, ADR) in descriptions — spell out or avoid
4. No implementation details (wave-based, parallel agents, MICRO tier)
5. Use "you" language where natural ("Save your place", "Check your progress")

#### 4.2.3 Group Restructure

**Current (8 groups):**
Getting Started (2), Phase Lifecycle (5), Phase Management (6), Session & Progress (5), Milestone (5), Focus (5), System (7), Community (2)

**Proposed (5 groups):**

| Group | Commands | Count | Rationale |
|-------|----------|-------|-----------|
| **Start & Plan** | new-project, map-codebase, discuss-phase, plan-phase, research-phase, assumptions | 6 | Everything before building |
| **Build & Verify** | exec-phase, verify-phase, quick, phase-tests, phase-budget | 5 | Everything about doing the work |
| **Focus Pipeline** | focus-scan, focus-plan, focus-exec, focus-sync, focus-design | 5 | Brownfield workflow (kept distinct) |
| **Milestones & Phases** | milestone-new, milestone-done, milestone-audit, milestone-gaps, milestone-cleanup, add-phase, insert-phase, remove-phase, progress | 9 | Project structure management |
| **Session & System** | pause, resume, profile, help, health, settings, update, debug, todo-add, todo-check, discord, patches | 12 | Tools and settings |

**Why 5 not 8:** Fewer groups = faster scanning. "Getting Started" (2 commands) and "Community" (2 commands) are too small to justify their own groups. Phase Management commands naturally group with Milestones since both manage project structure.

### 4.3 Command Description Rewrites (All 37)

| Command | Current Description | Proposed Description |
|---------|--------------------|--------------------|
| `/pan:new-project` | Initialize a new project with deep context gathering and project.md | Start a new project — vision, requirements, roadmap |
| `/pan:map-codebase` | Analyze codebase with parallel mapper agents to produce .planning/codebase/ documents | Map an existing codebase before starting |
| `/pan:discuss-phase` | Gather phase context through adaptive questioning before planning | Talk through a phase before planning it |
| `/pan:plan-phase` | Create detailed phase plan (plan.md) with verification loop | Create a detailed plan for a phase |
| `/pan:research-phase` | Research how to implement a phase (standalone - usually use /pan:plan-phase instead) | Deep research for specialized domains |
| `/pan:assumptions` | Surface Claude's assumptions about a phase approach before planning | See the planned approach before committing |
| `/pan:exec-phase` | Execute all plans in a phase with wave-based parallelization | Build your phase — runs all plans, commits each task |
| `/pan:verify-phase` | Validate built features through conversational UAT | Test what was built against what was planned |
| `/pan:quick` | Execute a quick task with PAN guarantees (atomic commits, state tracking) but skip optional agents | Do a small task with automatic commits |
| `/pan:phase-tests` | Generate tests for a completed phase based on UAT criteria and implementation | Generate tests for a completed phase |
| `/pan:phase-budget` | Estimate context utilization and quality for the current phase | Check how much context this phase needs |
| `/pan:progress` | Check project progress, show context, and route to next action (execute or plan) | Check your progress and see what's next |
| `/pan:add-phase` | Add phase to end of current milestone in roadmap | Add a new phase to your roadmap |
| `/pan:insert-phase` | Insert urgent work as decimal phase (e.g., 72.1) between existing phases | Insert urgent work between phases |
| `/pan:remove-phase` | Remove a future phase from roadmap and renumber subsequent phases | Remove a phase and renumber the rest |
| `/pan:milestone-new` | Start a new milestone cycle — update project.md and route to requirements | Start a new milestone cycle |
| `/pan:milestone-done` | Archive completed milestone and prepare for next version | Archive a completed milestone |
| `/pan:milestone-audit` | Audit milestone completion against original intent before archiving | Check if a milestone is really done |
| `/pan:milestone-gaps` | Create phases to close all gaps identified by milestone audit | Create phases to close audit gaps |
| `/pan:milestone-cleanup` | Archive accumulated phase directories from completed milestones | Clean up old phase directories |
| `/pan:focus-scan` | Deep-dive strategic work scan with prioritized items and Reality Score filtering | Find everything that needs work, ranked by impact |
| `/pan:focus-plan` | Create capacity-budgeted work batch with 4 execution modes | Pick a right-sized batch of work to do next |
| `/pan:focus-exec` | Automated batch execution pipeline with 6 stages, 9 behavioral rules, 3 execution tiers | Implement the batch — build, test, verify, commit |
| `/pan:focus-sync` | Synchronize documentation after changes — check staleness and update counts | Update docs to match your changes |
| `/pan:focus-design` | Strategic 10-phase feature investigation, design, and specification pipeline | Design a new feature from research to spec |
| `/pan:pause` | Create context handoff when pausing work mid-phase | Save your place so you can pick up later |
| `/pan:resume` | Resume work from previous session with full context restoration | Pick up where you left off |
| `/pan:profile` | Switch model profile for PAN agents (quality/balanced/budget) | Switch AI model profile (quality/balanced/budget) |
| `/pan:help` | Show available PAN commands and usage guide | Show this command reference |
| `/pan:health` | Diagnose planning directory health and optionally repair issues | Check and repair planning files |
| `/pan:settings` | Configure PAN workflow toggles and model profile | Configure PAN settings |
| `/pan:update` | Update PAN to latest version with changelog display | Update PAN to the latest version |
| `/pan:debug` | Systematic debugging with persistent state across context resets | Debug an issue (survives /clear) |
| `/pan:todo-add` | Capture idea or task as todo from current conversation context | Save an idea or task for later |
| `/pan:todo-check` | List pending todos and select one to work on | See your pending todos |
| `/pan:discord` | Join the PAN Discord community | Join the PAN community |
| `/pan:patches` | Reapply local modifications after a PAN update | Reapply your customizations after updating |

### 4.4 Argument-Hint Standardization

| Command | Current | Proposed |
|---------|---------|---------|
| `map-codebase` | `[optional: specific area to map, e.g., 'api' or 'auth']` | `[area]` |
| `milestone-new` | `[milestone name, e.g., 'v1.1 Notifications']` | `[name]` |
| `todo-add` | `[optional description]` | `[description]` |
| `verify-phase` | `[phase number, e.g., '4']` | `[phase]` |
| `focus-scan` | _(missing)_ | `[--quick] [--lean] [--focus <area>]` |
| `focus-plan` | _(missing)_ | `[--mode <mode>] [--budget N]` |
| `focus-exec` | _(missing)_ | `[--continue] [--no-commit]` |
| `focus-sync` | _(missing)_ | `[--all] [--readme]` |
| `focus-design` | _(missing)_ | `<description> [--internal] [--spike]` |

### 4.5 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|
| 5 groups (from 8) | Copilot CLI (4 groups) | Fewer groups = faster scanning; 5 covers PAN's 2-workflow model | Copilot's exact 4 groups don't map to PAN's domain |
| Outcome-oriented descriptions | clig.dev, Continue.dev | Users care about what happens, not how | Aider's ultra-terse style (too cryptic for 37 commands) |
| Common Recipes section early | Aider's recipe patterns | Most useful content should be most visible | Did NOT copy AI-powered help (requires new module, too heavy) |
| 3-tier progressive disclosure | Copilot CLI cheat sheet | Respects different reading depths | Did NOT copy dropdown-on-slash (requires IDE integration) |
| Decision tree for workflow routing | Novel (PAN-specific) | PAN's 2-workflow model is unique — needs explicit routing | No competitor has this problem |

### 4.6 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| 5 groups | Merge to 5 | Keep 8 groups | 8 groups = 8 visual breaks for only 37 commands; "Getting Started" (2 cmds) and "Community" (2 cmds) are too small | Power users used to current groups need to relearn |
| Shorter descriptions | 10-word max | Keep technical descriptions | Technical descriptions fail new users | Experienced users may miss precision |
| Focus detail condensed | 30 lines (from 98) | Keep 98 lines in help | 98 lines of flags/modes in a quick reference is hostile | Users must go to USER-GUIDE for full flag docs |
| Decision tree at top | New addition | No routing guidance | PAN's 2-workflow model is the #1 confusion point | Adds 10 lines to the top |

### 4.7 Feature Ladder (Incremental Delivery)

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Rewrite help.md workflow + fix 6 frontmatter issues | Dramatically better help experience | M (4 pts) |
| **v1 (Complete)** | Rewrite all 37 command descriptions + standardize argument-hints + sync docs | Full consistency across all touchpoints | L (10 pts) |
| **v2 (Enhanced)** | Propagate to all 5 runtimes + update CLI-REFERENCE + USER-GUIDE sync | Complete cross-runtime consistency | M (4 pts) |

### 4.8 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | `/pan:help` — the same command they already use |
| What's the learning curve? | Zero — it's the same command, better content |
| Does it require changing existing workflows? | No |
| What's the "aha moment"? | Running `/pan:help` and finding the right command in 5 seconds instead of scrolling for 30 |

---

## Phase 5: Architecture Decision Record

See `docs/decisions/ADR-0011-help-commands-rewrite.md` (saved separately).

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|-----------|
| help.md workflow file missing | Environment | File read returns empty | Error message | "Help file not found — run /pan:update" |
| Command .md missing frontmatter | Data corruption | No `name:` field | Skip in listing | Command omitted from help |

### 6.2 Diagnostic Support

N/A — help is a static content display. No flags, no computation, no state.

---

## Phase 7: Security & Threat Model

### 7.0 Standards Auto-Reference

No project standards selected (`overall_status: none`). Suggested: `node ./pan-wizard-core/bin/pan-tools.cjs standards recommend` — but N/A for this content-only feature.

### 7.1 Asset & Attack Surface

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| help.md workflow | Read | System-generated (installed by PAN) |
| Command .md files | Read (frontmatter only) | System-generated |

No user input, no file writes, no shell execution, no path traversal possible. This feature has **zero attack surface**.

---

## Phase 8: Implementation Roadmap

### 8.1 New Help Document (DRAFT)

```markdown
# PAN Command Reference

**PAN** — workflow automation for building software with AI coding assistants.
Works with Claude Code, GitHub Copilot CLI, Gemini CLI, Codex, and OpenCode.

---

## Quick Start

Starting a new project?
  /pan:new-project

Working on an existing codebase?
  /pan:focus-scan

Already have a PAN project?
  /pan:progress

---

## Two Workflows

**Phase Lifecycle** — for new projects and milestone-driven development:
  new-project → plan-phase → exec-phase → verify-phase → milestone-done

**Focus Pipeline** — for existing projects and iterative improvement:
  focus-scan → focus-plan → focus-exec → focus-sync

Pick one. Both produce working code with automatic commits and verification.

---

## Common Recipes

New project from scratch:
  /pan:new-project → /clear → /pan:plan-phase 1 → /clear → /pan:exec-phase 1

Existing project, iterative work:
  /pan:focus-scan → /clear → /pan:focus-plan → /clear → /pan:focus-exec

Design a feature before building:
  /pan:focus-design "feature name" → /clear → /pan:focus-scan

Resume after a break:
  /pan:progress

Quick one-off task:
  /pan:quick "fix the login button"

Insert urgent work mid-milestone:
  /pan:insert-phase 5 "Security fix" → /pan:plan-phase 5.1 → /pan:exec-phase 5.1

Complete a milestone:
  /pan:milestone-audit → /pan:milestone-gaps → /pan:milestone-done 1.0.0

Debug an issue (survives /clear):
  /pan:debug "form submission fails"

---

## All Commands (37)

### Start & Plan
| Command | What It Does |
|---------|-------------|
| `/pan:new-project` | Start a new project — vision, requirements, roadmap |
| `/pan:map-codebase [area]` | Map an existing codebase before starting |
| `/pan:discuss-phase <N>` | Talk through a phase before planning it |
| `/pan:plan-phase <N>` | Create a detailed plan for a phase |
| `/pan:research-phase <N>` | Deep research for specialized domains |
| `/pan:assumptions <N>` | See the planned approach before committing |

### Build & Verify
| Command | What It Does |
|---------|-------------|
| `/pan:exec-phase <N>` | Build your phase — runs all plans, commits each task |
| `/pan:verify-phase <N>` | Test what was built against what was planned |
| `/pan:quick <task>` | Do a small task with automatic commits |
| `/pan:phase-tests <N>` | Generate tests for a completed phase |
| `/pan:phase-budget` | Check how much context this phase needs |

### Focus Pipeline
| Command | What It Does |
|---------|-------------|
| `/pan:focus-scan` | Find everything that needs work, ranked by impact |
| `/pan:focus-plan` | Pick a right-sized batch of work to do next |
| `/pan:focus-exec` | Implement the batch — build, test, verify, commit |
| `/pan:focus-sync` | Update docs to match your changes |
| `/pan:focus-design <desc>` | Design a new feature from research to spec |

### Milestones & Phases
| Command | What It Does |
|---------|-------------|
| `/pan:progress` | Check your progress and see what's next |
| `/pan:add-phase <desc>` | Add a new phase to your roadmap |
| `/pan:insert-phase <N> <desc>` | Insert urgent work between phases |
| `/pan:remove-phase <N>` | Remove a phase and renumber the rest |
| `/pan:milestone-new [name]` | Start a new milestone cycle |
| `/pan:milestone-done <ver>` | Archive a completed milestone |
| `/pan:milestone-audit` | Check if a milestone is really done |
| `/pan:milestone-gaps` | Create phases to close audit gaps |
| `/pan:milestone-cleanup` | Clean up old phase directories |

### Session & System
| Command | What It Does |
|---------|-------------|
| `/pan:pause` | Save your place so you can pick up later |
| `/pan:resume` | Pick up where you left off |
| `/pan:profile <name>` | Switch AI model profile (quality/balanced/budget) |
| `/pan:help` | Show this reference |
| `/pan:health [--repair]` | Check and repair planning files |
| `/pan:settings` | Configure PAN settings |
| `/pan:update` | Update PAN to the latest version |
| `/pan:debug [issue]` | Debug an issue (survives /clear) |
| `/pan:todo-add [desc]` | Save an idea or task for later |
| `/pan:todo-check [area]` | See your pending todos |
| `/pan:discord` | Join the PAN community |
| `/pan:patches` | Reapply your customizations after updating |

---

## Focus Pipeline — Flags & Modes

### focus-scan
  --quick         Skip strategic analysis
  --lean          Aggressive priority filtering
  --focus <area>  Weight items toward an area

### focus-plan
  --mode <mode>   bugfix / balanced (default) / features / full
  --budget N      Override point budget (5-100)
  --dry-run       Preview without writing

### focus-exec
  --continue      Resume a previous run
  --no-commit     Skip the commit step
  --dry-run       Preview stages 1-2 only

### focus-sync
  --all           Full sync with auto-fix
  --readme        Check README only
  --commands      Verify command files
  --agents        Verify agent files

### focus-design
  --full          All 10 phases (default)
  --internal      Skip competitive research
  --outward       Skip hardening, focus on strategy
  --spike         Fast 4-phase proof-of-concept
  --gate          Pause after strategy for review
  --audit         Verify existing implementation
  --mvp           Stop after MVP task list

---

## Configuration

Settings:    /pan:settings
Profiles:    /pan:profile quality|balanced|budget
Config file: .planning/config.json

---

## Files

.planning/
├── project.md         — your project vision
├── roadmap.md         — current phase breakdown
├── state.md           — project memory and progress
├── requirements.md    — scoped requirements
├── config.json        — workflow settings
├── focus/             — focus batch files
├── phases/            — phase plans and summaries
├── todos/             — captured ideas
└── debug/             — debug sessions

---

## Updates & Help

Update PAN:     npx pan-wizard@latest  or  /pan:update
Check progress: /pan:progress
Community:      /pan:discord
```

### 8.2 Implementation Tasks (Ordered)

```
### Task 1: Rewrite help workflow content
Files: pan-wizard-core/workflows/help.md
Test: Visual review — output is human-readable markdown
Estimate: M (4 pts)
Priority: P2

### Task 2: Fix 6 frontmatter issues in command files
Files: commands/pan/focus-*.md (5), commands/pan/patches.md (1)
Test: Grep for name: in all 37 files, verify all have pan: prefix
Estimate: S (2 pts)
Priority: P2

### Task 3: Rewrite all 37 command descriptions in frontmatter
Files: commands/pan/*.md (37 files)
Test: Grep for description: in all files, verify max 10 words
Estimate: M (4 pts)
Priority: P2

### Task 4: Standardize argument-hint in 9 command files
Files: commands/pan/{map-codebase,milestone-new,todo-add,verify-phase,focus-*}.md (9)
Test: Grep for argument-hint: in all files, verify short token format
Estimate: S (2 pts)
Priority: P3

### Task 5: Remove stray </output> tag from help.md command
Files: commands/pan/help.md
Test: Read file, verify no stray XML tags
Estimate: XS (1 pt)
Priority: P3

### Task 6: Sync CLI-REFERENCE.md command descriptions
Files: docs/CLI-REFERENCE.md
Test: Verify descriptions match frontmatter
Estimate: S (2 pts)
Priority: P3

### Task 7: Sync USER-GUIDE.md command descriptions
Files: docs/USER-GUIDE.md
Test: Verify descriptions match frontmatter
Estimate: S (2 pts)
Priority: P3

### Task 8: Propagate to all 5 runtime directories
Files: .claude/, .github/, .opencode/, .gemini/, .codex/
Test: Diff canonical vs copies
Estimate: M (4 pts)
Priority: P3

### Task 9: Update CHANGELOG.md
Files: CHANGELOG.md
Test: Version entry present
Estimate: XS (1 pt)
Priority: P4
```

### 8.3 Dependency Graph

```
Task 1 (help workflow) ─┐
Task 2 (fix frontmatter) ─┤
Task 3 (rewrite descriptions) ─┤──→ Task 6 (CLI-REF sync)
Task 4 (argument-hints) ─┤──→ Task 7 (USER-GUIDE sync)
Task 5 (stray tag) ─────┘──→ Task 8 (runtime propagation) ──→ Task 9 (CHANGELOG)
```

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Descriptions too terse — lose precision | Medium | Low | Review against current behavior, ensure accuracy |
| Group restructure confuses existing users | Low | Low | Old group names still work as search terms |
| Runtime propagation misses a file | Medium | Medium | Diff check after propagation |
| Gemini TOML conversion errors | Medium | Medium | Use tested Python script approach from session 21 |

### 8.5 Cognitive Complexity Budget

N/A — no code, only content.

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Count | What It Catches |
|-------|---------|-------|-----------------|
| **Unit** | Frontmatter field validation (grep-based) | 5+ | Missing fields, wrong format |
| **Integration** | Help workflow renders correctly | 5+ | Broken markdown, missing sections |
| **E2E** | Full /pan:help invocation on fresh project | 2+ | End-to-end display |

### 9.2 Specific Test Cases

1. All 37 command files have `name:` field with `pan:` prefix
2. All 37 command files have `group:` field
3. All commands with arguments have `argument-hint:` field
4. Help workflow contains all 5 group headers
5. Help workflow contains all 37 command names
6. Help workflow contains "Quick Start" section
7. Help workflow contains "Common Recipes" section
8. Help workflow line count < 200 (verify conciseness)
9. No jargon terms in descriptions (UAT, wave-based, parallelization, etc.)
10. All 5 runtime directories have matching help.md content
11. CLI-REFERENCE command descriptions match frontmatter
12. No stray XML tags in any command file

### 9.3 Regression Verification

- [x] Full suite passes unchanged (1139/1139)
- [x] No test expectations changed
- [x] Build hooks unaffected

---

## Phase 10: Output Artifacts

### 10.1 Specification Document
Saved to: `docs/specs/help_commands_rewrite_featureai.md` (this file)

### 10.2 ADR
Saved to: `docs/decisions/ADR-0011-help-commands-rewrite.md`

### 10.3 Report Summary

**Problem:** PAN Wizard's help output is 380 lines of jargon-heavy, flat-structured developer documentation that fails to help new users find the right command quickly.

**Evidence:** User-stated pain, competitive parity gap (Copilot CLI ships grouped categorical help), industry best practices violated (clig.dev guidelines).

**Strategic Assessment:**
- Blue Ocean: ELIMINATE verbose detail from quick-ref, REDUCE groups from 8→5, RAISE discoverability with decision tree, CREATE progressive disclosure
- Wardley: Product-stage — adopt best practices, differentiate with 2-workflow routing
- Moat Score: Developer Experience = 5/5, Cross-Platform = 4/5
- Cognitive Load: simplifies (-1) — new users face 6 highlighted commands, not 37
- Recommendation: BUILD — high priority, zero risk, high impact

**Design:**
- 3-tier progressive disclosure (10-second overview → grouped tables → detail)
- 5 command groups (from 8): Start & Plan, Build & Verify, Focus Pipeline, Milestones & Phases, Session & System
- All 37 descriptions rewritten: outcome-oriented, max 10 words, no jargon
- "Quick Start" decision tree at top, "Common Recipes" section before command tables
- 175 lines (from 380 — 54% reduction)

**Implementation:** 9 tasks, 22 points total, no code changes — all content work
- v0 (MVP): Help workflow rewrite + frontmatter fixes (6 pts)
- v1 (Complete): All 37 descriptions + argument-hints + doc sync (10 pts)
- v2 (Enhanced): 5-runtime propagation + CHANGELOG (5 pts)

**Security:** Zero attack surface (content display only)

**Next Steps:**
1. Run `/pan:focus-plan` to schedule the implementation batch
2. Run `/pan:focus-exec` to implement all tasks
3. Run `/pan:focus-sync` to verify documentation consistency
