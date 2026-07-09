---
name: pan:new-project
group: Getting Started
description: Initialize a new project with deep context gathering and project.md
argument-hint: "[--auto]"
allowed-tools:
  - Read
  - Bash
  - Write
  - Task
  - AskUserQuestion
---
<context>
**Flags:**
- `--auto` — Automatic mode. After config questions, runs research → requirements → roadmap without further interaction. Expects idea document via @ reference.
</context>

<objective>
Initialize a new project through unified flow: questioning → research (optional) → requirements → roadmap.

**Creates:**
- `.planning/project.md` — project context
- `.planning/config.json` — workflow preferences
- `.planning/research/` — domain research (optional)
- `.planning/requirements.md` — scoped requirements
- `.planning/roadmap.md` — phase structure
- `.planning/state.md` — project memory

**After this command:** Run `/pan:plan-phase 1` to start execution.
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

**Layer 3: Hotspots (load during research, if research is enabled)**
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
  → WARN: "Project already initialized. Use /pan:resume to continue."
  → STOP (do not overwrite existing project)

ELSE IF --auto flag AND @ reference document provided:
  → ASK config questions only (commit_docs, model_profile)
  → SKIP interactive questioning (use the @ document as project context)
  → RUN research automatically
  → GENERATE requirements from research + @ document
  → GENERATE roadmap from requirements
  → No further interaction until complete

ELSE IF --auto flag WITHOUT @ reference:
  → ERROR: "--auto requires an @ referenced idea document"
  → STOP

ELSE (interactive mode — default):
  → RUN questioning flow (5-area deep questioning)
  → ASK: "Should I research the domain ecosystem?" (Y/N)
    → IF Y: spawn researchers → synthesize → continue
    → IF N: skip research → continue
  → PRESENT requirements for approval
  → PRESENT roadmap for approval
  → COMMIT if commit_docs=true
```

**Research routing:**
```
IF user says research: spawn pan-project-researcher agents
IF user declines research: skip directly to requirements generation
IF codebase already has substantial code: suggest skipping research (existing code IS the context)
```
</routing_decision_tree>

<process>
Execute the new-project workflow from @~/.claude/pan-wizard-core/workflows/new-project.md end-to-end.
Preserve all workflow gates (validation, approvals, commits, routing).
</process>
