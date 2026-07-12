# PAN Internals

Under-the-hood concepts for power users and contributors. This guide distills PAN's internal reference system into actionable knowledge.

For user-facing documentation, see the [User Guide](USER-GUIDE.md). For development guidance, see the [Development Guide](DEVELOPMENT.md).

## Table of Contents

- [Checkpoint System](#checkpoint-system)
- [Test-Driven Development](#test-driven-development)
- [Verification Patterns](#verification-patterns)
- [Commit Strategy](#commit-strategy)
- [Model Profiles](#model-profiles)
- [Branching Strategies](#branching-strategies)
- [UI Conventions](#ui-conventions)
- [Discussion Philosophy](#discussion-philosophy)
- [Continuation Format](#continuation-format)
- [Reference File Index](#reference-file-index)

---

## Checkpoint System

*Source: `references/checkpoints.md`*

PAN uses three checkpoint types to handle moments where human input is needed during automated execution.

### Checkpoint Types

| Type | Frequency | Purpose | Example |
|------|-----------|---------|---------|
| `checkpoint:human-verify` | ~90% | Verify automated work visually | "Check the login page renders correctly" |
| `checkpoint:decision` | ~9% | Choose between approaches | "Use SQLite or PostgreSQL?" |
| `checkpoint:human-action` | ~1% | Perform an action Claude can't | "Log into Stripe dashboard and copy API key" |

### Automation-First Philosophy

The golden rule: **Claude automates everything possible, checkpoints verify outcomes.**

Before presenting a `human-verify` checkpoint, the executor:
1. Starts the dev server automatically
2. Runs build/compile steps
3. Navigates to the right URL
4. Checks for runtime errors
5. THEN asks you to verify visually

### Auth Gates

When the executor hits an authentication error (not a code bug), it creates a dynamic `human-action` checkpoint:
1. Executor detects auth/permission error
2. Presents checkpoint with exact steps to authenticate
3. You complete the auth action
4. Executor retries the original command

### Auto-Advance Behavior

With `auto_advance: true` in config:
- `human-verify` -- Auto-approved (assumes pass)
- `decision` -- First option auto-selected
- `human-action` -- Still requires human (cannot be automated)

---

## Test-Driven Development

*Source: `references/tdd.md`*

PAN's executor follows RED-GREEN-REFACTOR discipline for tasks flagged as testable.

### When TDD Applies

**Use TDD for:**
- Business logic with defined inputs and outputs
- Data transformations, calculations, validation rules
- API endpoints with clear request/response contracts

**Skip TDD for:**
- UI components and layouts
- Configuration files
- Glue code and wiring
- One-off scripts

**Heuristic:** Can you write `expect(fn(input)).toBe(output)` before writing `fn`? If yes, use TDD.

### The Cycle

1. **RED** -- Write a failing test that defines expected behavior
2. **GREEN** -- Write the minimum code to make the test pass
3. **REFACTOR** -- Clean up while keeping tests green

**Context budget:** TDD tasks use ~40% more context than standard tasks due to the three-phase cycle. PAN accounts for this when estimating phase complexity.

### Commit Pattern

Each TDD cycle produces 2-3 commits:
- `test(phase-plan): Add failing test for {feature}`
- `feat(phase-plan): Implement {feature}`
- `refactor(phase-plan): Clean up {feature}` (optional)

---

## Verification Patterns

*Source: `references/verification-patterns.md`*

After execution, PAN's verifier checks that artifacts are real implementations -- not stubs or placeholders.

### Stub Detection

**Universal red flags:**
- Comment stubs: `// TODO`, `// FIXME`, `// placeholder`
- Placeholder text: "Lorem ipsum", "Not implemented", "Coming soon"
- Empty returns: `return null`, `return []`, `return {}`
- Trivial implementations: Single-line components, empty handlers

**Component stubs:**
- `<div>ComponentName</div>` with no real content
- `onClick={() => {}}` empty event handlers
- Props accepted but never used in render

**API route stubs:**
- `return { message: "Not implemented" }` or `res.json([])`
- No database query (missing ORM/SQL calls)
- No input validation or error handling

**Schema stubs:**
- Only `id` field defined
- All fields optional with no constraints
- Missing indexes or relations

### Wiring Verification

Each layer must connect to the next:

```
Component -> API call (fetch/axios/tRPC)
    -> API route -> Database query (Prisma/Drizzle/SQL)
        -> Schema -> Indexes + constraints
```

**What the verifier checks:**
1. Component renders data from state/props (not hardcoded)
2. Component calls API on user action
3. API route queries database with parameters
4. Database schema has correct types and relations

### Verification Report Structure

verification.md includes:
- Per-requirement pass/fail assessment
- Stub inventory (if any found)
- Wiring chain validation
- Gap analysis with suggested fixes
- Overall phase health score

---

## Commit Strategy

*Source: `references/git-integration.md`*

PAN creates granular, per-task commits during execution -- not bulk commits per phase.

### Commit Points

| Event | Commit? | Type |
|-------|---------|------|
| Project initialization (project.md, roadmap.md) | Yes | `chore(init)` |
| Plan creation (plan.md) | No | -- |
| Task completion | Yes | `feat/fix/test(phase-plan)` |
| Plan completion (summary.md metadata) | Yes | `docs(phase-plan)` |
| Phase completion | No | -- |

### Commit Message Format

```
{type}({phase}-{plan}): {description}
```

**Types:** `feat`, `fix`, `test`, `refactor`, `perf`, `chore`, `docs`

**Examples:**
```
feat(04-01): Add user authentication middleware
test(04-01): Add auth middleware test suite
fix(04-02): Handle expired JWT tokens in refresh flow
docs(04-02): Add SUMMARY with execution metrics
```

### Why Per-Task Commits?

- **Failure recovery:** If task 3 fails, tasks 1-2 are already committed
- **Observability:** `git log --grep="04-01"` shows all work for a specific plan
- **Granularity:** Each commit represents a single, logical change
- **Rollback:** Can revert individual tasks without losing the whole plan

---

## Model Profiles

*Source: `references/model-profiles.md`*

PAN uses three profiles to control which model tier each agent type uses. Tiers are provider-agnostic: `reasoning`, `mid`, `fast`.

### Tier Mapping

| Tier | Anthropic | OpenAI | Google | Default |
|------|-----------|--------|--------|---------|
| `reasoning` | inherit (Opus) | inherit | inherit | inherit |
| `mid` | Sonnet | mid | gemini-2.5-flash | Sonnet |
| `fast` | Haiku | fast | gemini-2.5-flash-lite | Haiku |

Legacy names (`opus` → `reasoning`, `sonnet` → `mid`, `haiku` → `fast`) are supported for backward compatibility.

### Profile Comparison

| Agent Role | Quality | Balanced | Budget |
|-----------|---------|----------|--------|
| Planner | reasoning | reasoning | mid |
| Researcher | reasoning | mid | fast |
| Executor | reasoning | mid | mid |
| Verifier | reasoning | mid | fast |
| Plan Checker | reasoning | mid | fast |
| Codebase Mapper | reasoning | fast | fast |

### Routing Pipeline

Model resolution follows a priority chain:

```
1. Per-agent override    → config.model_overrides[agentType]
2. Per-phase override    → <!-- model_tier: X --> in roadmap phase
3. Complexity routing    → adjusts tier ±1 based on task metadata (if strategy = "complexity")
4. Profile lookup        → MODEL_PROFILES[agentType][profile]
5. Provider resolution   → resolveTierToModel(tier, provider)
```

**Provider detection:** Explicit `routing.provider` in config → `PAN_PROVIDER` env var → runtime directory presence (`.claude/` = Anthropic, `.codex/` = OpenAI, `.gemini/` = Google) → default.

### Routing Strategies

- **static** (default): Profile assigns fixed tiers. No runtime adjustment.
- **complexity**: Scores task metadata (fileCount, waveCount, requirementCount, isArchitectural) and adjusts tier ±1 level. Configurable thresholds: `downgrade_max` (default 2), `upgrade_min` (default 6).

### Cost Multipliers

Relative cost per tier: reasoning = 15×, mid = 3×, fast = 1×. The `estimate-cost` command shows total and average multipliers per profile.

### When to Use Each

- **Quality:** Complex architectural work, critical production code, unfamiliar domains
- **Balanced (default):** Most projects -- reasoning reasons about design, mid executes instructions
- **Budget:** Prototyping, familiar patterns, cost-sensitive work

### Design Rationale

Planning is high-value reasoning (benefits from top tier). Execution follows explicit instructions (mid tier is sufficient). Research is information gathering (fast tier is cheap and adequate).

### Per-Agent Overrides

Override specific agents in config:
```json
{
  "model_overrides": {
    "pan-executor": "opus",
    "pan-researcher": "sonnet"
  }
}
```

Overrides take precedence over profile defaults, per-phase overrides, and routing strategy.

---

## Branching Strategies

*Source: `references/planning-config.md`*

PAN supports three git branching strategies for project organization.

### Strategy Options

| Strategy | When branches are created | Branch template |
|----------|--------------------------|-----------------|
| `none` (default) | No branches -- all work on current branch | -- |
| `phase` | New branch per phase | `pan/phase-{phase}-{slug}` |
| `milestone` | New branch per milestone | `pan/{milestone}-{slug}` |

### Template Variables

| Variable | Resolves to | Example |
|----------|------------|---------|
| `{phase}` | Zero-padded phase number | `01`, `02.1` |
| `{slug}` | Phase name as slug | `setup-auth` |
| `{milestone}` | Milestone version | `0.2.0` |

### Merge at Completion

When completing a phase or milestone:
- **Squash:** Clean single commit on target branch
- **Merge:** Preserve full commit history
- **Discard:** Delete branch, keep commits on original

### Config Example

```json
{
  "git": {
    "branching_strategy": "phase",
    "phase_branch_template": "pan/phase-{phase}-{slug}",
    "milestone_branch_template": "pan/{milestone}-{slug}"
  }
}
```

---

## UI Conventions

*Source: `references/ui-brand.md`*

PAN uses consistent visual patterns for all output.

### Stage Banners

Major workflow stages use boxed banners:
```
+==============================================================+
|  *  STAGE NAME                                               |
+==============================================================+
|  Description of what's happening                             |
+==============================================================+
```

### Status Symbols

| Symbol | Meaning |
|--------|---------|
| checkmark | Success / Complete |
| cross | Failure / Error |
| diamond | Active / Current |
| circle | Pending / Not started |
| lightning | In progress |
| warning | Warning |

### Checkpoint Boxes

```
+---------------------------------------------+
|  * Verification Required                     |
|                                              |
|  Check that the login page renders           |
|  correctly at http://localhost:3000/login     |
|                                              |
|  [Continue] [Reject]                         |
+---------------------------------------------+
```

### Anti-Patterns

- Don't vary box widths within the same workflow
- Don't use random symbols -- stick to the defined symbol set
- Don't mix banner styles
- Don't omit the "Next Up" block after major completions

---

## Discussion Philosophy

*Source: `references/questioning.md`*

PAN's project initialization uses a collaborative discussion model, not a requirements interview.

### Core Principle

**You are a thinking partner, not an interviewer.** The goal is to extract the user's vision, not fill out a checklist.

### Question Flow

1. **Start open:** Let them dump everything -- what they're building, why, for whom
2. **Follow energy:** What excited them? Dig deeper there
3. **Challenge vagueness:** "What does 'fast' mean?" turns into "Sub-200ms API response"
4. **Confirm scope:** "So the MVP is X, Y, Z -- does that capture it?"

### Question Types

| Type | Purpose | Example |
|------|---------|---------|
| Motivation | Why build this? | "What problem does this solve for your users?" |
| Concreteness | Turn abstract to specific | "When you say 'dashboard', what data is shown?" |
| Clarification | Resolve ambiguity | "Should users upload files or just paste text?" |
| Success | Define done | "How will you know Phase 1 succeeded?" |

### Anti-Patterns

- **Checklist walking:** Don't ask generic questions in order
- **Interrogation:** Don't ask 10 questions at once
- **Assumption:** Don't assume you know what they mean
- **Skill assessment:** Don't ask "What's your experience level?"

---

## Continuation Format

*Source: `references/continuation-format.md`*

After completing a workflow step, PAN always presents a "Next Up" block telling you what to do next.

### Structure

```
---

**Next up -- Phase 02: Authentication**
Set up user login, registration, and session management.

-> `/pan:plan-phase 2`

Also available:
- `/pan:progress` -- Review overall status
- `/pan:verify-phase 1` -- Re-verify Phase 1

Tip: Run `/clear` before starting to free context.
```

### Key Rules

- Always show the recommended next action first
- Include the phase name and description (pulled from roadmap.md)
- Commands in backtick format for easy copy-paste
- "Also available" for alternatives (not "Other options")
- Visual separator (`---`) to make it stand out

---

## Reference File Index

PAN's agents load knowledge from reference files at runtime using `@`-syntax. These files live in `pan-wizard-core/references/`.

| File | Topic | Relevance |
|------|-------|-----------|
| `checkpoints.md` | Checkpoint types, automation philosophy, auth gates | High |
| `guardrails.md` (v3.6.0+) | Behavioral guardrails — anti-patterns, Code Preservation, Stop-the-Line | High |
| `tdd.md` | Test-driven development cycle, when to apply | High |
| `verification-patterns.md` | Stub detection, wiring checks, verification scripts | High |
| `handoff-decisions.md` | Decisions-trace schema for planner/executor/verifier handoff | High |
| `git-integration.md` | Commit strategy, per-task commits, recovery | High |
| `model-profiles.md` | Agent model selection by profile | High |
| `questioning.md` | Discussion philosophy, question techniques | High |
| `planning-config.md` | Config schema, branching strategies, commit settings | Medium |
| `ui-brand.md` | Visual patterns, symbols, banner formats | Medium |
| `continuation-format.md` | "Next Up" block format and variants | Medium |
| `model-profile-resolution.md` | How orchestrators resolve model at startup | Low |
| `git-planning-commit.md` | pan-tools commit CLI for planning docs | Low |
| `decimal-phase-calculation.md` | Emergency phase insertion numbering | Low |
| `phase-argument-parsing.md` | Phase argument normalization | Low |

Agents reference these files with `@`-syntax in their markdown definitions. For example, the executor agent loads `@checkpoints.md` and `@tdd.md` at startup.

---

*For writing new reference files, see [How to Write a Reference](DEVELOPMENT.md#how-to-write-a-reference) in the Development Guide.*
