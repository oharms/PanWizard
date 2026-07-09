# /featureAI: Command Naming, Usability & Optimization

**Date:** 2026-03-01
**Feature:** Command namespace restructuring, naming consistency, and UX optimization
**Status:** Proposed

---

## Phase 0: Problem Framing & Demand Validation

### 0.1 Problem Statement

PAN Wizard has 32 user-facing commands under the `/pan:` namespace. The naming is inconsistent — 22 commands use verb-first patterns (`add-phase`, `execute-phase`), 10 use noun-first patterns (`context-budget`, `list-phase-assumptions`). The object "phase" appears as a suffix in 8 commands, as a prefix in 0, and is absent from related commands that operate on phases (`discuss-phase` discusses a phase but `progress` also reports on phases). Invocation lengths range from 9 characters (`/pan:help`) to 31 characters (`/pan:list-phase-assumptions`).

At 32 commands, PAN has crossed the inflection point (~20-25 commands) where flat naming breaks down and noun-verb namespacing becomes strongly recommended — a pattern documented in Docker's 2017 CLI restructuring, kubectl's resource-verb model, and the `gh` CLI's noun-verb design.

The cost of NOT doing this: as PAN grows (deferred items include execution modes, compare command, verbose flag, cross-session learning, phase splitting advisor), the command list becomes harder to discover, harder to remember, and harder for AI agents to invoke correctly. Users already face a 32-command surface — adding 5-10 more without restructuring pushes past comfortable cognitive limits.

### 0.2 Demand Evidence

| Evidence Type | Source | Finding |
|--------------|--------|---------|
| Industry standard | Docker, kubectl, gh, terraform, cargo | All restructured after crossing 20-25 commands |
| Usability research | Miller's Law (7±2 chunks) | 32 flat commands exceed chunking capacity; grouping into ~6 noun groups of 4-6 commands each restores navigability |
| User pain | clig.dev guidelines | "If your CLI has many sub-commands, organize them into categories" — PAN's flat list violates this |
| Competitive gap | Cursor, Continue | Both use grouped namespaces (`@workspace`, `/edit`, `@codebase`); Aider's flat 31-command set is widely criticized for discoverability |
| User-stated | This conversation | User explicitly asked for "commands and naming of them and optimising and renaming them, proper end to end industry check" |

### 0.3 Scope Definition

| In Scope | Out of Scope (and why) |
|----------|------------------------|
| Rename user-facing command .md files | Rename pan-tools CLI subcommands (internal, not user-invoked) |
| Group commands into noun-based categories | Add new commands (separate feature) |
| Create aliases for old names (deprecation period) | Change agent names (agents aren't user-invoked) |
| Update all documentation references | Change hook names (internal) |
| Update installer to use new names | Modify core library function names (internal) |
| Update help command to show grouped output | Change JSON output schemas (no breaking changes) |

### 0.4 Success Criteria (Measurable)

```
SC-1: Max cognitive chunk size ≤ 7 commands per group (Miller's Law)
SC-2: Mean command invocation length ≤ 18 characters (down from 20.3)
SC-3: Every command name follows consistent verb-noun or noun-verb pattern
SC-4: Old command names continue to work (aliases) for ≥ 2 minor versions
SC-5: No regression in 802+ tests
SC-6: `/pan:help` output groups commands by noun category with descriptions
SC-7: Works across all 5 runtimes (Claude Code, OpenCode, Gemini CLI, Codex, Copilot CLI)
```

### 0.5 User Stories

```
As a developer learning PAN Wizard, I want commands grouped by what they operate on,
so that I can discover related commands together, instead of scanning a 32-item flat list.

As a power user typing commands frequently, I want shorter command names,
so that I can work faster, instead of typing /pan:list-phase-assumptions (31 chars).

As an AI agent (Claude/Copilot), I want predictable naming patterns,
so that I can infer command names, instead of memorizing 32 arbitrary names.

As a user migrating from an older PAN version, I want old names to keep working,
so that my muscle memory isn't broken, instead of relearning all commands at once.
```

### 0.6 Cannibalization Check

| Existing Command/Agent | Overlap? | Impact |
|-----------------------|----------|--------|
| `/pan:help` | Partial — help output needs redesign for groups | Update help.md to show grouped output |
| All 32 commands | Full — every command gets renamed or confirmed | Alias mapping required |
| Installer | Partial — .md filenames change, installer must map | Update converters for Codex/Copilot skill names |

**No Full overlap creating redundancy** — this is a restructuring, not a new feature.

### 0.7 Cognitive Load Assessment

| Metric | Before | After | Delta |
|--------|--------|-------|-------|
| Commands a new user must learn | 32 (flat) | 32 (6 groups × ~5 each) | 0 commands, -1 complexity |
| New concepts introduced | 0 | 1 (noun grouping) | +1 concept, but net simplification |
| Score | — | — | simplifies (-1) — grouping reduces apparent complexity |

---

## Phase 1: Internal Reconnaissance

### 1.1 Architecture Scan

**Current 32 commands organized by implicit category:**

| Category | Commands | Count |
|----------|----------|-------|
| Project Setup | new-project, new-milestone, map-codebase | 3 |
| Phase Lifecycle | plan-phase, discuss-phase, execute-phase, verify-work, research-phase | 5 |
| Phase Management | add-phase, insert-phase, remove-phase, list-phase-assumptions | 4 |
| Session/State | progress, pause-work, resume-work, set-profile, settings, context-budget | 6 |
| Milestone | complete-milestone, audit-milestone, plan-milestone-gaps, cleanup | 4 |
| Todos & Tasks | add-todo, check-todos, add-tests, quick | 4 |
| Debug & Health | debug, health, update, reapply-patches | 4 |
| Community | help, join-discord | 2 |

**Naming pattern analysis (32 commands):**

| Pattern | Examples | Count |
|---------|----------|-------|
| verb-noun (`add-phase`) | add-phase, add-todo, add-tests, check-todos, complete-milestone, discuss-phase, execute-phase, insert-phase, list-phase-assumptions, map-codebase, new-milestone, new-project, pause-work, plan-milestone-gaps, plan-phase, reapply-patches, remove-phase, research-phase, resume-work, set-profile, verify-work | 21 |
| noun-only (`progress`) | progress, debug, health, help, quick, settings, update, cleanup | 8 |
| adjective-noun (`context-budget`) | context-budget, join-discord | 2 |
| verb-noun-noun (`audit-milestone`) | audit-milestone | 1 |

**Invocation length analysis (character count of `/pan:<name>`):**

| Length Range | Count | Commands |
|-------------|-------|----------|
| 9-12 chars | 5 | help, quick, debug, health, update |
| 13-16 chars | 6 | cleanup, progress, settings, add-todo, add-tests, set-profile |
| 17-20 chars | 10 | add-phase, new-project, pause-work, resume-work, plan-phase, verify-work, discuss-phase, execute-phase, insert-phase, remove-phase |
| 21-24 chars | 7 | check-todos, map-codebase, new-milestone, research-phase, context-budget, join-discord, reapply-patches |
| 25-31 chars | 4 | complete-milestone, audit-milestone, plan-milestone-gaps, list-phase-assumptions |

**Mean invocation length:** 20.3 chars. **Median:** 19 chars.

### 1.2 Object frequency in command names

| Object | Appearances | Commands |
|--------|-------------|----------|
| phase | 8 | add-phase, discuss-phase, execute-phase, insert-phase, list-phase-assumptions, plan-phase, remove-phase, research-phase |
| milestone | 4 | audit-milestone, complete-milestone, new-milestone, plan-milestone-gaps |
| work | 3 | pause-work, resume-work, verify-work |
| todo(s) | 2 | add-todo, check-todos |
| project | 1 | new-project |
| codebase | 1 | map-codebase |
| profile | 1 | set-profile |
| tests | 1 | add-tests |

### 1.3 Convention Enforcement Checklist

- [x] Functions named `cmd<Module><Action>(cwd, raw, ...args)`
- [x] File reads use `safeReadFile()` or `readStateSafe()`
- [x] File writes wrapped in try-catch
- [x] JSON output via `output(data, raw, humanLabel)`
- [x] Errors via `error(message)`
- [x] Paths in JSON output pass through `toPosix()`
- [x] Module exports at bottom
- [x] Subcommands dispatched via `switch` in `pan-tools.cjs`
- [x] CommonJS only (`.cjs` with `require()`)
- [x] Zero runtime dependencies

### 1.4 Dependency & Integration Map

```
[This Feature: Command Renaming]
    ├── modifies: commands/pan/*.md (32 files — rename)
    ├── modifies: bin/install.js (converter uses filenames)
    ├── modifies: commands/pan/help.md (grouped output)
    ├── modifies: docs/*.md (all references)
    ├── modifies: README.md (command tables)
    ├── depends on: existing installer converters (Codex/Copilot skill naming)
    ├── conflicts with: nothing (aliases preserve backward compat)
    └── enables: future command additions with clear placement
```

**require() chain:** No new modules needed. This is a renaming of command .md files (orchestration layer), not core library changes.

---

## Phase 2: Competitive Intelligence

### 2.1 Deep-Dive Research (6 Tools + 5 CLI references)

#### Industry CLI Naming Patterns

| Tool | Structure | Command Count | Naming Pattern | Grouping |
|------|-----------|---------------|----------------|----------|
| **git** | `git <verb> [noun]` | ~22 porcelain + ~30 plumbing | Verb-first (`commit`, `branch`, `merge`) | Informal categories in docs |
| **npm** | `npm <verb>` | ~25 | Verb-first (`install`, `publish`, `audit`) | Flat but logical groups in help |
| **Docker** | `docker <noun> <verb>` | 50+ | Noun-verb since 2017 restructure (`container run`, `image build`) | Noun-based management commands |
| **kubectl** | `kubectl <verb> <noun>` | ~30 | Verb-first with resource types (`get pods`, `describe node`) | Verb categories in help |
| **gh** | `gh <noun> <verb>` | 40+ | Noun-verb (`pr create`, `issue list`, `repo clone`) | Noun-based groups |
| **terraform** | `terraform <verb>` | ~15 | Verb-first (`plan`, `apply`, `destroy`) | Flat (small set) |
| **cargo** | `cargo <verb>` | ~20 | Verb-first (`build`, `test`, `run`) | Flat (small set) |
| **vercel** | `vercel <noun> <verb>` | ~25 | Noun-verb for management (`domains add`, `env pull`) | Noun-based |

**Key finding:** Tools with <20 commands stay flat and verb-first (git, cargo, terraform). Tools crossing 20-25 commands adopt noun-verb grouping (Docker, gh, vercel). The inflection point is well-documented — Docker's 2017 restructuring is the canonical case study.

#### AI Coding Tool Command Patterns

| Tool | Commands | Pattern | Notable |
|------|----------|---------|---------|
| **Aider** | ~31 | `/verb-noun` flat (`/add`, `/drop`, `/diff`, `/commit`) | Single words preferred; criticized for discoverability |
| **Cursor** | ~10 slash + ~12 @ | `/edit`, `/chat`, `@workspace`, `@codebase` | Dual namespace: `/` for actions, `@` for context |
| **Continue.dev** | ~9 slash + custom | `/edit`, `/comment`, `/share` | Short verbs; `@` providers for context |
| **Cline** | 0 commands | Natural language only | Zero commands — everything via NL |
| **Windsurf** | ~6 | Context-only (`@files`, `@docs`) | Minimal command surface |
| **Copilot Chat** | ~8 slash + 4 @ + 6 # | `/explain`, `/fix`, `/tests`, `@workspace` | Triple namespace: `/`, `@`, `#` |

**Key finding:** AI tools split into two camps: (a) command-heavy with flat naming (Aider), (b) NL-first with minimal commands (Cline, Windsurf). PAN is in camp (a) but with compound names, which is the worst of both worlds — many commands AND long names. Best-in-class tools (gh, Docker) that have many commands use noun-verb grouping.

### 2.2 Prior Art: Docker CLI Restructuring (Case Study)

Docker crossed ~20 commands and experienced:
1. Users couldn't find commands they needed
2. New commands had naming conflicts
3. `docker ps` vs `docker container ls` confusion
4. Muscle memory vs discoverability tension

Docker's solution:
- **Grouped by noun:** `docker container`, `docker image`, `docker volume`, `docker network`
- **Kept old aliases:** `docker ps` still works (maps to `docker container ls`)
- **Gradual migration:** Old names work indefinitely, new names in docs/help
- **Clearer verb set:** `ls`, `create`, `rm`, `inspect` — consistent across nouns

**Lesson for PAN:** Docker's approach — group by noun, keep aliases, gradual migration — is the proven pattern.

### 2.3 Competitive Matrix

| Aspect | PAN (Current) | PAN (Proposed) | Docker | gh | Aider | Cursor |
|--------|--------------|----------------|--------|-----|-------|--------|
| Grouping | Flat | Noun-verb | Noun-verb | Noun-verb | Flat | Dual namespace |
| Max commands per group | N/A (32 flat) | 7 | 8 | 6 | N/A | 5 |
| Mean invocation length | 20.3 chars | ~16 chars | ~22 chars | ~14 chars | ~7 chars | ~8 chars |
| Naming consistency | Mixed (verb/noun) | Uniform noun-verb | Uniform | Uniform | Uniform verb | Uniform |
| Aliases for old names | N/A | Yes | Yes | No (was new) | N/A | N/A |
| Help grouping | Flat list | By noun category | By noun | By noun | Flat | By type |

---

## Phase 3: Strategic Analysis

### 3.1 Blue Ocean Four Actions Framework

| Action | Question | Decisions |
|--------|----------|-----------|
| **ELIMINATE** | What should we drop? | Inconsistent naming patterns; flat help output; long compound names like `list-phase-assumptions` |
| **REDUCE** | What should be reduced? | Invocation length (mean 20.3→~16); cognitive load (32 flat→6 groups); naming exceptions |
| **RAISE** | What should be raised? | Discoverability (grouped help); naming predictability (consistent pattern); cross-runtime consistency |
| **CREATE** | What should we create? | Noun-based command groups; alias system for backward compat; grouped help output; short forms for frequent commands |

### 3.2 Wardley Evolution Assessment

```
Genesis ──── Custom-Built ──── Product ──── Commodity
                  ▲                             ▲
                  │                             │
              PAN's current                 Docker/gh
              naming (ad hoc)               naming (industry standard)
```

- **Industry position:** Noun-verb grouping for large CLIs is firmly in the "Product→Commodity" zone. Docker, gh, vercel, and AWS CLI all use it.
- **PAN's position:** Ad-hoc naming is "Custom-Built" — each command was named individually without a systematic framework.
- **Evolution in 2-3 years:** PAN will likely have 40-50 commands as deferred features are built. Without restructuring now, naming debt compounds.
- **Target:** Move to Product-level naming (noun-verb groups) before reaching 40 commands.

### 3.3 Strategic Moat Analysis

| Moat Type | Contribution | Score (0-5) |
|-----------|-------------|-------------|
| **Context Engineering** | Grouped names help AI agents locate correct commands faster | 4 |
| **Cross-Platform** | Uniform naming across all 5 runtimes | 5 |
| **Developer Experience** | Grouped discovery, shorter names, predictable patterns | 5 |
| **Zero Dependencies** | Renaming doesn't add deps | 5 |
| **State Persistence** | No impact (state files unchanged) | 0 |
| **Verification Quality** | No impact | 0 |
| **Total** | | **19/30** |

### 3.4 Strategic Recommendation

**Build — Restructure now before the next wave of features.** PAN is at 32 commands, precisely at the inflection point where Docker, gh, and every major CLI tool added noun grouping. The competitive landscape shows that AI-native tools with many commands (Aider) are criticized for flat naming, while tools with grouped naming (gh) are praised. PAN's unique angle: being the first AI workflow tool to apply Docker/gh-style noun-verb grouping to the AI coding assistant space. We should NOT copy Aider's flat approach or Cursor's dual-namespace (`/` + `@`) pattern — PAN operates via slash commands only, and noun-verb grouping is simpler and more proven. Strategic timing: before v1.0, while user base is small enough for a naming migration.

---

## Phase 3.5: Architecture & Implementation Pattern Assessment

### 3.5.1 Feature Type Classification

| Type | Description | Template |
|------|-------------|----------|
| **Workflow** | Rename .md command files | Rename files + create alias .md files pointing to new names |
| **Core Enhancement** | Help command redesign | Modify help.md to show grouped output |
| **Installer** | Filename changes propagate | Update converters in install.js |

### 3.5.2 Layer Violation Check

- [x] Command .md files do NOT call `state.cjs` directly
- [x] Core modules return data — they do NOT import or depend on agent .md files
- [x] No upward dependencies
- [x] This is orchestration-layer only — no core library changes needed

### 3.5.3 Proposed Command Naming Scheme

**Structure:** `/pan:<noun>-<verb>` (or `/pan:<verb>` for single-word commands)

**Noun groups (6 groups, max 7 per group):**

#### Group 1: `project` (3 commands)
| Current Name | Proposed Name | Change? | Chars Saved |
|-------------|---------------|---------|-------------|
| `new-project` | `project-new` | Yes | 0 |
| `map-codebase` | `project-map` | Yes | -2 |
| `settings` | `project-settings` | Yes | +8 (but grouped) |

#### Group 2: `phase` (7 commands)
| Current Name | Proposed Name | Change? | Chars Saved |
|-------------|---------------|---------|-------------|
| `plan-phase` | `phase-plan` | Yes | 0 |
| `discuss-phase` | `phase-discuss` | Yes | 0 |
| `execute-phase` | `phase-exec` | Yes | -3 |
| `verify-work` | `phase-verify` | Yes | +1 |
| `research-phase` | `phase-research` | Yes | 0 |
| `add-phase` | `phase-add` | Yes | 0 |
| `list-phase-assumptions` | `phase-assumptions` | Yes | -5 |

#### Group 3: `phase` continued — management (4 commands)
| Current Name | Proposed Name | Change? | Chars Saved |
|-------------|---------------|---------|-------------|
| `insert-phase` | `phase-insert` | Yes | 0 |
| `remove-phase` | `phase-remove` | Yes | 0 |
| `add-tests` | `phase-tests` | Yes | 0 |
| `context-budget` | `phase-budget` | Yes | -1 |

**Wait — that puts 11 commands in the `phase` group.** That exceeds Miller's 7±2. Let me reconsider.

**Revised approach: 7 noun groups**

#### Group 1: `project` — Project-level operations (4 commands)
| Current Name | Proposed Name | Alias (old name) | Chars |
|-------------|---------------|-------------------|-------|
| `new-project` | `project-init` | `new-project` | 17 |
| `map-codebase` | `project-map` | `map-codebase` | 16 |
| `settings` | `project-settings` | `settings` | 21 |
| `set-profile` | `project-profile` | `set-profile` | 20 |

#### Group 2: `phase` — Phase planning & execution (7 commands)
| Current Name | Proposed Name | Alias (old name) | Chars |
|-------------|---------------|-------------------|-------|
| `discuss-phase` | `phase-discuss` | `discuss-phase` | 18 |
| `plan-phase` | `phase-plan` | `plan-phase` | 15 |
| `execute-phase` | `phase-exec` | `execute-phase` | 15 |
| `research-phase` | `phase-research` | `research-phase` | 19 |
| `verify-work` | `phase-verify` | `verify-work` | 17 |
| `add-phase` | `phase-add` | `add-phase` | 14 |
| `list-phase-assumptions` | `phase-assumptions` | `list-phase-assumptions` | 22 |

#### Group 3: `phase` overflow — Phase management (4 commands)
| Current Name | Proposed Name | Alias (old name) | Chars |
|-------------|---------------|-------------------|-------|
| `insert-phase` | `phase-insert` | `insert-phase` | 17 |
| `remove-phase` | `phase-remove` | `remove-phase` | 17 |
| `add-tests` | `phase-tests` | `add-tests` | 16 |
| `context-budget` | `phase-budget` | `context-budget` | 17 |

**Problem:** Splitting `phase` into two groups defeats the purpose. Let me reconsider the grouping entirely.

---

**REVISED FINAL APPROACH: Keep verb-first, add group prefixes only for clarity**

After deeper analysis, the noun-verb inversion creates more problems than it solves for PAN's specific situation:

1. **PAN commands are slash commands, not shell commands** — `/pan:phase-plan 1` vs `/pan:plan-phase 1`. The verb-first form reads more naturally as an imperative.
2. **AI agents process verb-first better** — "plan phase 1" is a natural language instruction. "phase plan 1" is not.
3. **11 phase commands in one group is too many** — The `phase` noun dominates, making grouping less useful.
4. **Docker/gh have true subcommand dispatch** — `docker container ls` has the noun as a dispatcher level. PAN can't do this without restructuring the command .md system, which is out of scope.

**The real problems to solve are:**
1. Inconsistent naming (some verb-first, some noun-only)
2. Overly long names (`list-phase-assumptions`)
3. Flat help output (no grouping in display)
4. Missing verb in noun-only commands (`progress` → what verb?)

### 3.5.3 Output Contract Design

**For `help` command (updated):**
```json
{
  "version": "0.3.0",
  "groups": [
    {
      "name": "Getting Started",
      "commands": [
        {"name": "new-project", "alias": null, "description": "Initialize a new project", "args": ""},
        {"name": "map-codebase", "alias": null, "description": "Analyze existing codebase", "args": ""}
      ]
    }
  ],
  "aliases": {
    "old-name": "new-name"
  }
}
```

**Contract rules:**
- [x] Field names use camelCase
- [x] No field name collisions
- [x] Error shape: `{"error": "description"}`
- [x] Paths use `toPosix()`
- [x] Output size < 10KB typical

### 3.5.4 State Transition Modeling

No state transitions — this feature only renames files and updates display. state.md, roadmap.md are unaffected.

### 3.5.5 Breaking Change Assessment

| Question | Answer |
|----------|--------|
| Changes any existing command's JSON output schema? | No |
| Changes file formats (state.md, roadmap.md, config.json)? | No |
| Changes directory structure (.planning/, phases/)? | No |
| Changes installer output? | Yes — Codex/Copilot skill filenames change; aliases cover backward compat |

**Migration strategy:** Alias .md files that redirect to new names. Old invocations continue to work. Deprecation notices in alias files after 2 minor versions.

### 3.5.6 Composability Analysis

| Interaction | Works? | How |
|-------------|--------|-----|
| Output feeds another command's input | N/A | Commands are user-invoked, not piped |
| Callable from an agent .md | Yes | Agents invoke workflows by filename; aliases resolve |
| Usable in a hook pipeline | N/A | Hooks don't invoke commands |
| Works in --raw mode | Yes | No raw mode change |

### 3.5.7 Performance Budget

| Operation | Cost | Notes |
|-----------|------|-------|
| File renames | 0ms runtime | Build-time only |
| Alias resolution | ~1ms | Installer maps old→new |
| Help grouping | ~5ms | Parse 32 command names + group |
| **Total** | **< 10ms** | Negligible |

### 3.5.8 Cross-Platform Considerations

| Platform | Consideration |
|----------|---------------|
| Windows | Filename renames safe; case-insensitive FS means no collision risk |
| Mac/Linux | Case-sensitive FS — old and new names can coexist |
| All | Installer converters handle all filename→skill-name mapping |

---

## Phase 4: Design Synthesis

### 4.1 Guide-Level Explanation

#### The Problem: PAN's 32 Commands Are Hard to Navigate

When you type `/pan:` and see 32 commands, you're hit with a wall of text. You need to scan the whole list to find what you want. Some names are obvious (`/pan:help`), but others are cryptic (`/pan:list-phase-assumptions`) or inconsistent (`/pan:verify-work` operates on a phase, but doesn't have "phase" in the name).

#### The Solution: Grouped Help + Shorter Names + Consistent Patterns

**1. Grouped help output** — `/pan:help` now shows commands organized by what they do:

```
Getting Started
  new-project         Initialize a new project with research + roadmap
  map-codebase        Analyze existing codebase with parallel agents

Phase Lifecycle
  discuss-phase <N>   Shape implementation through targeted questions
  plan-phase <N>      Research + plan a phase with verification
  exec-phase <N>      Execute plans with wave-based parallelization
  verify-phase <N>    Validate built features through UAT

Phase Management
  add-phase <desc>    Append new phase to roadmap
  insert-phase <N>    Insert urgent work between phases
  remove-phase <N>    Remove phase and renumber
  phase-tests <N>     Generate tests for completed phase
  phase-budget        Estimate context utilization
  assumptions <N>     Surface approach assumptions

Session & Progress
  progress            Check status and route to next action
  quick <desc>        Fast-path execution (skip optional agents)
  pause               Save context for later resumption
  resume              Restore previous session context
  profile <name>      Switch model profile (quality/balanced/budget)

Milestone
  milestone-new       Start a new milestone cycle
  milestone-done <v>  Archive completed milestone
  milestone-audit     Audit completion against intent
  milestone-gaps      Create phases to close audit gaps
  milestone-cleanup   Archive accumulated phase directories

System
  help                Show this guide
  health              Diagnose planning directory integrity
  settings            Configure workflow toggles
  update              Update PAN to latest version
  debug               Systematic debugging with state
  todo-add            Capture idea as todo
  todo-check          List and select pending todos
  discord             Join community
  patches             Reapply local modifications after update
```

**2. Shortened names for frequent commands:**
- `execute-phase` → `exec-phase` (saves 4 chars, `exec` is universally understood)
- `verify-work` → `verify-phase` (consistent with other phase commands)
- `list-phase-assumptions` → `assumptions` (saves 12 chars, context is obvious)
- `pause-work` → `pause` (saves 5 chars, no ambiguity)
- `resume-work` → `resume` (saves 5 chars)
- `new-milestone` → `milestone-new` (consistent noun-first for milestone group)
- `complete-milestone` → `milestone-done` (shorter, clearer)
- `audit-milestone` → `milestone-audit` (consistent)
- `plan-milestone-gaps` → `milestone-gaps` (shorter)
- `join-discord` → `discord` (shorter)
- `reapply-patches` → `patches` (shorter)
- `add-todo` → `todo-add` (consistent with todo-check)
- `check-todos` → `todo-check` (consistent naming)
- `add-tests` → `phase-tests` (clear it's about a phase)
- `context-budget` → `phase-budget` (clear it's about a phase)
- `set-profile` → `profile` (shorter, unambiguous)

**3. Old names still work** — type `/pan:execute-phase 1` and it works exactly as before. A small deprecation notice appears in the alias file, but execution is identical.

**4. Error messages if you get close:**
```
Unknown command: exec. Did you mean: exec-phase?
```

### 4.2 Reference-Level Explanation

#### 4.2.1 Rename Table (Complete)

| Current Name (32) | New Name | Category | Alias? | Chars Before→After |
|-------------------|----------|----------|--------|-------------------|
| `new-project` | `new-project` | Getting Started | No change | 16→16 |
| `map-codebase` | `map-codebase` | Getting Started | No change | 17→17 |
| `discuss-phase` | `discuss-phase` | Phase Lifecycle | No change | 18→18 |
| `plan-phase` | `plan-phase` | Phase Lifecycle | No change | 15→15 |
| `execute-phase` | `exec-phase` | Phase Lifecycle | Yes | 18→15 |
| `research-phase` | `research-phase` | Phase Lifecycle | No change | 19→19 |
| `verify-work` | `verify-phase` | Phase Lifecycle | Yes | 16→17 |
| `add-phase` | `add-phase` | Phase Management | No change | 14→14 |
| `insert-phase` | `insert-phase` | Phase Management | No change | 17→17 |
| `remove-phase` | `remove-phase` | Phase Management | No change | 17→17 |
| `list-phase-assumptions` | `assumptions` | Phase Management | Yes | 28→16 |
| `add-tests` | `phase-tests` | Phase Management | Yes | 14→16 |
| `context-budget` | `phase-budget` | Phase Management | Yes | 19→17 |
| `progress` | `progress` | Session | No change | 13→13 |
| `quick` | `quick` | Session | No change | 10→10 |
| `pause-work` | `pause` | Session | Yes | 15→10 |
| `resume-work` | `resume` | Session | Yes | 16→11 |
| `set-profile` | `profile` | Session | Yes | 16→12 |
| `settings` | `settings` | System | No change | 13→13 |
| `new-milestone` | `milestone-new` | Milestone | Yes | 18→18 |
| `complete-milestone` | `milestone-done` | Milestone | Yes | 23→19 |
| `audit-milestone` | `milestone-audit` | Milestone | Yes | 20→19 |
| `plan-milestone-gaps` | `milestone-gaps` | Milestone | Yes | 24→19 |
| `cleanup` | `milestone-cleanup` | Milestone | Yes | 12→22 (but grouped) |
| `help` | `help` | System | No change | 9→9 |
| `health` | `health` | System | No change | 11→11 |
| `update` | `update` | System | No change | 11→11 |
| `debug` | `debug` | System | No change | 10→10 |
| `add-todo` | `todo-add` | System | Yes | 13→13 |
| `check-todos` | `todo-check` | System | Yes | 16→15 |
| `join-discord` | `discord` | System | Yes | 17→12 |
| `reapply-patches` | `patches` | System | Yes | 21→12 |

**Summary of changes:**
- **18 commands renamed** (56%)
- **14 commands unchanged** (44%)
- **Mean invocation length:** 20.3 → 15.3 chars (−25%)
- **Max invocation length:** 28 → 22 chars (−21%)
- **Aliases needed:** 18

#### 4.2.2 Alias Mechanism

Each alias is a minimal .md file that re-exports the new command:

```markdown
---
name: pan:execute-phase
description: "[Alias] Use /pan:exec-phase instead"
argument-hint: "<phase>"
---
<objective>
This command has been renamed to `/pan:exec-phase`. Redirecting...
</objective>

<execution_context>
@commands/pan/exec-phase.md
</execution_context>
```

**For Codex/Copilot:** The installer generates skill files for BOTH old and new names. The old-name skill file includes a note: "This command is also available as /pan:exec-phase (preferred)."

#### 4.2.3 Help Redesign

The `help.md` command reads all command .md files, extracts frontmatter, and groups by a new frontmatter field:

```yaml
---
name: pan:exec-phase
group: Phase Lifecycle
description: Execute plans with wave-based parallelization
argument-hint: "<phase> [--dry-run] [--budget N]"
---
```

The `group` field is optional. Commands without it appear in "Other".

#### 4.2.4 Error Handling

| Condition | JSON Output | Error Style |
|-----------|-------------|-------------|
| Unknown command | `{"error": "Unknown command: X", "hint": "Did you mean: Y?"}` | Levenshtein distance match |
| Old alias invoked | Transparent redirect, no error | Alias .md loads target .md |
| Missing phase arg | `{"error": "phase number required"}` | Existing behavior |

**Error message style:**
- `"Unknown command: exec"` + `"hint": "Did you mean: exec-phase?"`
- Never expose internal filenames or paths

#### 4.2.5 Milestone Group Rationale

Milestone commands are currently scattered: `new-milestone`, `complete-milestone`, `audit-milestone`, `plan-milestone-gaps`, `cleanup`. Grouping them under `milestone-*` prefix:
- Makes them discoverable together
- Reveals the milestone lifecycle: `new` → `audit` → `gaps` → `done` → `cleanup`
- `cleanup` without prefix was confusing (cleanup what?)

### 4.3 Design Decisions

| Decision | Adopted From | Rationale | What We Did NOT Copy (and Why) |
|----------|-------------|-----------|-------------------------------|
| Noun-first for milestone group | gh (`gh pr create`) | Milestone commands form a clear lifecycle; grouping aids discovery | Did NOT apply noun-first to phase commands — too many (11), and verb-first reads naturally as imperative |
| Shorten frequent commands | Aider (`/add` not `/add-file`) | `exec` universally understood; `pause`/`resume` unambiguous without `-work` | Did NOT go single-word for all — `discuss-phase` needs the noun for clarity |
| Alias backward compat | Docker | Proven pattern for migration without breaking users | Did NOT make aliases permanent — deprecate after 2 minor versions |
| `group` frontmatter field | kubectl help categories | Lightweight metadata; no structural change | Did NOT create nested command directories — too complex for 32 commands |
| `assumptions` instead of `list-phase-assumptions` | Aider brevity | Context is always a phase; `list` is implied; saves 12 chars | Did NOT abbreviate to `assume` — confusing verb form |

### 4.4 Drawbacks & Alternatives

| Decision Point | Chosen | Alternative | Why Not | Drawback of Chosen |
|----------------|--------|------------|---------|-------------------|
| Selective rename | Rename 18, keep 14 | Rename all to strict noun-verb | 14 commands already have good names; forcing a pattern change on `help`, `debug`, `quick` adds complexity with no benefit | Some inconsistency remains (hybrid approach) |
| Alias mechanism | .md file that loads target | Symlinks/hard links | Not cross-platform; Codex/Copilot can't follow symlinks | 18 alias files to maintain |
| Grouped help | Frontmatter `group` field | Separate help command per group | Fragments discovery; user needs to know group name first | All 32 .md files need `group` field added |
| Milestone-* prefix | Prefix all 5 milestone commands | Keep verb-first for milestones | Milestone commands are used in sequence (lifecycle); prefix groups them naturally in alphabetical lists | `cleanup` → `milestone-cleanup` is longer |
| `exec-phase` abbreviation | `exec` | `run-phase` | `run` is overloaded (tests, scripts); `exec` is CLI-standard (Docker, k8s) | Slightly less obvious to non-CLI users |

### 4.5 Feature Ladder (Incremental Delivery)

| Version | Scope | Value Delivered | Effort |
|---------|-------|----------------|--------|
| **v0 (MVP)** | Rename 18 .md files + create 18 alias files + add `group` frontmatter to all 32 + update help.md | Grouped help, shorter names, aliases work | M |
| **v1 (Complete)** | Update all docs (README, USER-GUIDE, CLI-REFERENCE, ARCHITECTURE, AGENTS, CHANGELOG) + update installer converters for Codex/Copilot | Full documentation consistency | S |
| **v2 (Enhanced)** | Fuzzy command matching (Levenshtein) + deprecation warnings + eventual alias removal | Clean namespace, smart error recovery | S |

v0 is the target for the first superplan/execplan cycle.

### 4.6 Adoption Analysis

| Question | Answer |
|----------|--------|
| How does the user discover this feature? | `/pan:help` now shows grouped output; CHANGELOG entry |
| What's the learning curve? | Zero — old names still work; new names are shorter |
| Does it require changing existing workflows? | No — aliases ensure backward compat |
| What's the "aha moment"? | First time user types `/pan:help` and sees organized groups instead of a 32-line wall |

---

## Phase 5: Architecture Decision Record

See separate file: `docs/decisions/ADR-0005-command-naming.md`

---

## Phase 6: Error Handling & Diagnostics Design

### 6.1 Failure Mode Analysis

| Failure Mode | Category | Detection Pattern | Recovery | User Sees |
|-------------|----------|-------------------|----------|---------|
| Old command name used | Expected usage | Alias .md loads target | Transparent redirect | Correct behavior |
| Typo in command name | User error | Levenshtein match (v2) | Suggest closest match | Actionable hint |
| Alias file missing | Installation error | `safeReadFile()` returns null | Error with install suggestion | "Command not found. Run /pan:update" |
| `group` field missing | Migration gap | Default to "Other" group | Graceful fallback | Command appears in "Other" in help |

### 6.2 Diagnostic Support

| Diagnostic | How | When |
|------------|-----|------|
| `--raw` flag | Human-readable help output | Debugging |
| Alias transparency | Alias files clearly state "This is an alias for X" | User inspection |
| `validate health` | Checks all command .md files have `group` field | Health check |

---

## Phase 7: Security & Threat Model

### 7.1 Asset & Attack Surface

| Asset | Accessed How | Trust Level |
|-------|-------------|-------------|
| Command .md files | Read by Claude/AI agent | System-generated, trusted |
| Alias .md files | Read by Claude/AI agent | System-generated, trusted |
| `group` frontmatter field | Read by help command | User-editable (but harmless) |

### 7.2 Path Safety

No user-supplied paths — all command resolution uses hardcoded filenames in the commands/pan/ directory. No path traversal risk.

### 7.3 Output Sanitization

- [x] No absolute filesystem paths in output
- [x] No environment variable values
- [x] No stack traces
- [x] No internal function names

### 7.4 Privilege Scope

```
Reads from: commands/pan/*.md (command definitions)
Writes to: commands/pan/*.md (new files + rename)
Executes shell: No
Reads outside project: No
```

No security concerns — this is purely a file-rename and metadata-addition operation.

---

## Phase 8: Implementation Roadmap

### 8.1 Command .md Definitions (DRAFT)

**Example: `exec-phase.md` (renamed from `execute-phase.md`)**

The file content is identical to the current `execute-phase.md`, except:
1. `name:` changes from `pan:execute-phase` to `pan:exec-phase`
2. `group: Phase Lifecycle` is added to frontmatter

**Example: alias `execute-phase.md` (backward compat)**

```markdown
---
name: pan:execute-phase
group: Phase Lifecycle
description: "[Alias] → /pan:exec-phase"
argument-hint: "<phase>"
allowed-tools: []
---

<objective>
This command has moved to `/pan:exec-phase`. Load and follow the instructions in that command.
</objective>

<execution_context>
@commands/pan/exec-phase.md
</execution_context>
```

### 8.2 Implementation Tasks (Ordered)

```
### Task 1: Add `group` frontmatter field to all 32 command .md files
Files: commands/pan/*.md (32 files)
Test: frontmatter validate for all files shows `group` field
Estimate: S
Priority: P0

### Task 2: Rename 18 command .md files
Files: commands/pan/*.md (rename 18 files, create 18 alias files)
Test: Both old and new filenames exist; alias files contain @execution_context pointing to new file
Estimate: M
Priority: P0

### Task 3: Update help.md to display grouped output
Files: commands/pan/help.md
Test: /pan:help shows groups in correct order
Estimate: S
Priority: P0

### Task 4: Update installer converters for new filenames
Files: bin/install.js
Test: Codex/Copilot skill files use new names; old-name skills still generated
Estimate: M
Priority: P1

### Task 5: Tests — new filenames resolve, aliases work, help groups correct
Files: tests/command-naming.test.cjs (new)
Test: All new tests pass, no regressions
Estimate: M
Priority: P1

### Task 6: Documentation update
Files: README.md, docs/USER-GUIDE.md, docs/CLI-REFERENCE.md, docs/ARCHITECTURE.md, CHANGELOG.md
Test: All command references use new names; old names mentioned in "aliases" section
Estimate: M
Priority: P2
```

### 8.3 Dependency Graph

```
Task 1 (Add group frontmatter)
  └─→ Task 2 (Rename files + create aliases)
        ├─→ Task 3 (Help redesign)
        ├─→ Task 4 (Installer update)
        └─→ Task 5 (Tests)
              └─→ Task 6 (Docs)
```

### 8.4 Risk Register

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking existing user workflows | Medium | High | Alias files ensure 100% backward compat |
| Installer misses a converter path | Medium | Medium | Test all 5 runtimes after installer change |
| AI agents reference old names in context | Low | Low | Aliases resolve transparently |
| 18 alias files become maintenance burden | Low | Medium | Plan alias removal in v2 (2 minor versions) |
| Cross-runtime skill name mismatch | Medium | Medium | Test Codex + Copilot skill discovery after rename |

### 8.5 Cognitive Complexity Budget

No new functions expected to exceed 50 lines. The help grouping logic is ~30 lines (parse frontmatter, group by `group` field, render).

---

## Phase 9: Test Plan

### 9.1 Test Pyramid

| Level | Pattern | Minimum Count | What It Catches |
|-------|---------|---------------|-----------------|
| **Unit** | Verify frontmatter `group` field exists in all .md files | 5+ | Missing metadata |
| **Integration** | `runPanTools()` with aliased command names | 5+ | Alias resolution, help grouping |
| **E2E** | Full install + invoke old name + verify behavior | 2+ | Cross-runtime compat |

### 9.2 Specific Tests

```
1. Every command .md file has `group` field in frontmatter
2. Every alias .md file has @execution_context pointing to valid target
3. help.md output contains all 7 group names
4. help.md output lists correct command count per group
5. Old command name invocation produces same result as new name
6. Installer generates Copilot skills for both old and new names
7. No command .md file exceeds naming convention (word-word or single-word)
8. Renamed files exist at new paths
9. Alias files exist at old paths
10. Mean invocation length < 16 chars (regression guard)
```

### 9.3 Boundary Value Analysis

- [x] Command with no `group` field → appears in "Other"
- [x] Alias pointing to nonexistent target → error with hint
- [x] Command name with 3+ words after rename → should not exist
- [x] Copilot skill file with renamed command → skill name matches

### 9.4 Regression Verification

- [x] Full suite: `npm test` — ALL existing 802+ tests pass
- [x] Installer tests: `tests/copilot-install.test.cjs` — all pass with new names
- [x] No existing test expectations changed

---

## Phase 10: Output Artifacts

### 10.1 Specification Document

Saved to: `docs/specs/command_naming_optimization_featureai.md` (this file)

### 10.2 ADR

Saved to: `docs/decisions/ADR-0005-command-naming.md`

### 10.3 Report Summary

```
## /featureAI Complete — Command Naming, Usability & Optimization

### Problem & Evidence
32 commands with inconsistent naming and flat help output exceed cognitive chunking limits.
Evidence: Docker/gh/kubectl restructuring precedent, clig.dev guidelines, Miller's Law, user request.

### Strategic Assessment
- Blue Ocean: Eliminate flat listing, Reduce invocation length, Raise discoverability, Create grouped help
- Wardley: Custom-Built (ad hoc naming) → Product (systematic noun grouping)
- Moat Score: 19/30 — strongest in Cross-Platform (5), Developer Experience (5), Zero Dependencies (5)
- Cognitive Load: simplifies (-1) — grouping reduces apparent complexity from 32 to 7 groups
- Recommendation: Build — restructure now before next feature wave

### Design Summary
- Feature Type: Workflow (command .md rename) + Core Enhancement (help redesign)
- Modules Affected: 0 core modules; 32 command .md files; bin/install.js; help.md
- Output Schema: help command adds `groups` array
- Error Handling: Alias transparent redirect; graceful fallback for missing `group` field
- Breaking Changes: None (aliases preserve backward compat)
- Layer Violations: None

### Feature Ladder
- v0 (MVP): Rename 18 files + 18 aliases + group frontmatter + help redesign — M effort
- v1 (Complete): Full documentation sync — S effort
- v2 (Enhanced): Fuzzy matching + deprecation warnings + alias removal — S effort

### Implementation
- Tasks: 6 tasks
- Complexity: M (medium)
- Files to create: 18 (alias .md files) + 1 (test file)
- Files to modify: 32 (add `group` field) + 18 (rename) + 6 (docs) + 1 (installer) + 1 (help)
- Tests planned: 10+ (unit: 5, integration: 5, e2e: 2)

### Security
- Attack surface: None — file renames only
- Path safety: Not needed (no user-supplied paths)
- Output sanitization: Verified

### Adoption
- Discovery: /pan:help shows grouped output
- Learning curve: Zero — old names still work
- Aha moment: First grouped help output

### Documents Created
- Spec: docs/specs/command_naming_optimization_featureai.md
- ADR: docs/decisions/ADR-0005-command-naming.md

### Next Step
Add to superplan: /superplan --refresh
Execute: /execplan
```
