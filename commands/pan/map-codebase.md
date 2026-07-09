---
name: pan:map-codebase
group: Getting Started
description: Analyze codebase with parallel mapper agents to produce .planning/codebase/ documents
argument-hint: "[optional: specific area to map, e.g., 'api' or 'auth']"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Task
---

<objective>
Analyze existing codebase using parallel pan-document_code agents to produce structured codebase documents.

Each mapper agent explores a focus area and **writes documents directly** to `.planning/codebase/`. The orchestrator only receives confirmations, keeping context usage minimal.

Output: .planning/codebase/ folder with 7 structured documents about the codebase state.
</objective>

<execution_context>
@~/.claude/pan-wizard-core/workflows/map-codebase.md
</execution_context>

<context>
Focus area: $ARGUMENTS (optional - if provided, tells agents to focus on specific subsystem)

**Load project state if exists:**
Check for .planning/state.md - loads context if project already initialized

**This command can run:**
- Before /pan:new-project (brownfield codebases) - creates codebase map first
- After /pan:new-project (greenfield codebases) - updates codebase map as code evolves
- Anytime to refresh codebase understanding
</context>

<when_to_use>
**Use map-codebase for:**
- Brownfield projects before initialization (understand existing code first)
- Refreshing codebase map after significant changes
- Onboarding to an unfamiliar codebase
- Before major refactoring (understand current state)
- When state.md references outdated codebase info

**Skip map-codebase for:**
- Greenfield projects with no code yet (nothing to map)
- Trivial codebases (<5 files)
</when_to_use>

<stage_0_ingest_mode>
**Before spawning mapper agents**, determine whether the repo fits in a single 1M-context window.

Run: `node ~/.claude/pan-wizard-core/bin/pan-tools.cjs codebase estimate-size --threshold 700000`

The CLI returns `{mode, total_tokens, file_count, languages}`:

- **`mode: "single-shot"`** — repo is small enough (≤700K tokens) for one Opus 4.7 agent to ingest the whole thing. Spawn a single `pan-document_code` agent with the full repo in context. This avoids the 6-way stitching artifacts of sharded mode (contradictory version claims, duplicated mentions, missed cross-file references).
- **`mode: "sharded"`** — repo exceeds 700K tokens. Fall back to the default 6-way parallel sharding (tech, arch, quality, concerns, relationships, practices). Each shard gets a 200K budget.

Record the chosen mode + telemetry in the final `.planning/codebase/overview.md` so future runs can reason about drift.

Opus 4.7 is required for single-shot mode (only model with a 1M context window). Other models always take the sharded path regardless of size.
</stage_0_ingest_mode>

<tool_priority>
Each mapper agent should use the simplest sufficient tool:
1. Glob — discover files by pattern (find all .ts files, config files, test files)
2. Grep — search for patterns across the codebase (imports, exports, function names)
3. Read — examine specific files found by Glob/Grep
4. Bash — only for git history or commands dedicated tools cannot handle
</tool_priority>

<progressive_context>
The orchestrator loads context in layers — NOT everything upfront. Mapper agents receive only what they need.

**Orchestrator layers (before spawning agents):**
1. **Manifest** — package.json/Cargo.toml, project identity, entry points
2. **Structure** — top-level directory listing, file count by extension, test presence
3. **Git summary** — recent commits (10), contributors, branch info

**Per-agent context (each agent loads its own):**
- Each agent starts with: project manifest + directory structure + its focus area description
- Each agent discovers its own details via Glob/Grep/Read within its focus area
- Agents do NOT receive other agents' output (parallel, independent)

**Why:** Loading the entire codebase into the orchestrator before spawning agents wastes orchestrator context. Each agent has a fresh 200k window — let them explore independently. The orchestrator only needs enough context to spawn correctly and verify outputs exist.
</progressive_context>

<process>
1. Check if .planning/codebase/ already exists (offer to refresh or skip)
2. Create .planning/codebase/ directory structure
3. Spawn 6 parallel pan-document_code agents:
   - Agent 1: tech focus → writes stack.md, integrations.md
   - Agent 2: arch focus → writes architecture.md, structure.md
   - Agent 3: quality focus → writes conventions.md, testing.md
   - Agent 4: concerns focus → writes concerns.md
   - Agent 5: relationships focus → writes relationships.md
   - Agent 6: practices focus → writes best-practices.md
4. Wait for agents to complete, collect confirmations (NOT document contents)
5. Verify all 9 documents exist with line counts
6. Commit codebase map
7. Offer next steps (typically: /pan:new-project or /pan:plan-phase)
</process>

<success_criteria>
- [ ] .planning/codebase/ directory created
- [ ] All 7 codebase documents written by mapper agents
- [ ] Documents follow template structure
- [ ] Parallel agents completed without errors
- [ ] User knows next steps
</success_criteria>
