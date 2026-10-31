---
name: pan:new-project
group: Getting Started
description: Initialize a new project with deep context gathering and project.md
route: start a new project from an idea
argument-hint: "[--auto] [--research [market]]"
allowed-tools:
  - Read
  - Bash
  - Write
  - Task
  - AskUserQuestion
---
<context>
**Flags:**
- `--auto` — Automatic mode. Asks no questions: applies the auto-mode defaults (idea.md frontmatter can override them), then runs requirements → roadmap without interaction (research only when asked for). Needs an idea document — an @ reference, or the idea pasted after the flag.
- `--research` — Research is off by default. With this flag the workflow lists at most 5 open questions that block building and one researcher answers them, each with a source or a recorded assumption; findings settle decisions and never add v1 scope. A precise brief skips research anyway.
- `--research market` — Research, plus a comparison of at most 5 comparable products; what the brief does not cover becomes v2 candidates for you to accept.
</context>

<objective>
Initialize a new project through unified flow: questioning → research (opt-in) → requirements → roadmap.

**Creates:**
- `.planning/project.md` — project context
- `.planning/config.json` — workflow preferences
- `.planning/research/` — answers to at most 5 open questions (only with research)
- `.planning/requirements.md` — scoped requirements
- `.planning/roadmap.md` — phase structure
- `.planning/state.md` — project memory

**After this command:** Run `/pan:discuss-phase 1` to gather context, or `/pan:plan-phase 1` to plan directly. With `--auto` the workflow continues into `/pan:discuss-phase 1 --auto` itself.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/new-project.md
@~/.claude/pan-wizard-core/references/questioning.md
@~/.claude/pan-wizard-core/references/ui-brand.md
@~/.claude/pan-wizard-core/templates/project.md
@~/.claude/pan-wizard-core/templates/requirements.md
</execution_context>

<progressive_context>
Load context in layers — do NOT read everything upfront. Each layer builds on the previous.

**Layer 1: Manifest (always load first)**
- package.json / Cargo.toml / pyproject.toml — project identity, deps, scripts
- .planning/ existence check — is this a fresh start or existing project?
- README.md first 50 lines — what the project claims to be

**Layer 2: Structure (load during questioning)**
- Directory tree (Glob top-level patterns) — understand project shape
- Entry points — main files, index files, server files
- Test infrastructure — test framework, test directory

**Layer 3: Hotspots (brownfield only, when writing requirements)**
- Most-changed files (git log --name-only) — where active work happens
- Largest files — complexity centers
- Import graph roots — most-depended-on modules

**Layer 4: Baselines (load only when generating requirements/roadmap)**
- Test count + pass rate
- Build status
- Dependency audit (outdated, vulnerable)

**Why layered:** Loading everything at Layer 1 wastes 40-60% of context on information not needed until later. For greenfield projects, Layers 3-4 are empty and should be skipped entirely.
</progressive_context>

<routing_decision_tree>
Use this decision tree to select the correct path. Evaluate conditions top-to-bottom; take the FIRST match.

```
IF .planning/ already exists AND contains project.md:
  → WARN: "Project already initialized. Use /pan:progress to continue."
  → STOP (do not overwrite existing project)

ELSE IF --auto flag AND an idea document provided (@ reference or pasted text):
  → ASK nothing: apply the auto-mode defaults (workflow step 2a; idea.md frontmatter can override them)
  → SKIP interactive questioning (use the document as project context)
  → RESEARCH only with --research or frontmatter research_enabled: true (never for a precise brief)
  → GENERATE requirements from the document (research settles decisions, never adds v1 scope)
  → GENERATE roadmap from requirements
  → No further interaction until complete

ELSE IF --auto flag WITHOUT an idea document:
  → ERROR: "--auto requires an idea document" (an @ reference, or the idea pasted after the flag)
  → STOP

ELSE (interactive mode — default):
  → RUN questioning flow (freeform deep questioning — references/questioning.md)
  → IF --research: research; ELSE ASK: "Research open questions?" (default: Skip research)
    → IF research: write ≤5 blocking questions → one pan-project-researcher → research check → continue
    → IF skip (or no question blocks building): continue
  → PRESENT requirements for approval
  → PRESENT roadmap for approval
  → COMMIT if commit_docs=true
```

**Research routing:**
```
IF user asks for research: write at most 5 open questions, spawn ONE pan-project-researcher
IF user declines research (the default): skip directly to requirements generation
IF no question blocks building: no research, say so
IF codebase already has substantial code: suggest skipping research (existing code IS the context)
```
</routing_decision_tree>

<process>
Execute the new-project workflow from @~/.claude/pan-wizard-core/workflows/new-project.md end-to-end.
Preserve all workflow gates (validation, approvals, commits, routing).
</process>
