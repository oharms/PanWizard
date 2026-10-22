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
3. Checks the URL it will hand you responds (`curl`)
4. Checks for runtime errors
5. THEN asks you to verify visually

### Auth Gates

When the executor hits an authentication error (not a code bug), it creates a dynamic `human-action` checkpoint:
1. Executor detects auth/permission error
2. Presents checkpoint with exact steps to authenticate
3. You complete the auth action
4. Executor retries the original command

### Auto-Advance Behavior

With `workflow.auto_advance: true` in config.json:
- `human-verify` -- Auto-approved (assumes pass)
- `decision` -- Takes the option the plan's `auto_select` names; with no `auto_select`, stops for a human (never the first option by position)
- `human-action` -- Still requires human (cannot be automated)

---

## Test-Driven Development

*Source: `references/tdd.md`*

PAN's executor follows RED-GREEN-REFACTOR discipline for a plan of `type: tdd` (the planner gives TDD work its own plan, with a `<feature>` block) or a task marked `tdd="true"`.

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

**Context budget:** TDD plans target ~40% context usage (against ~50% for standard plans) so the three-phase cycle has headroom; PAN gives each TDD feature its own plan.

### Commit Pattern

Each TDD cycle produces 2-3 commits:
- `test({phase}-{plan}): add failing test for {feature}`
- `feat({phase}-{plan}): implement {feature}`
- `refactor({phase}-{plan}): clean up {feature}` (optional, only when the refactor changed something)

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
- `Response.json({ message: "Not implemented" })`, `Response.json([])` with no database query, or an empty `new Response()`
- A handler that only logs the request body and returns `{ ok: true }`
- No input validation or error handling

**Schema stubs:**
- Only an `id` field (or a single real field) defined
- Critical fields missing (e.g. an order with no user, items, total or status)
- Expected relationships absent, or every field typed `String`

### Wiring Verification

Each layer must connect to the next:

```text
Component -> API call (fetch/axios/tRPC)
    -> API route -> Database query (Prisma/Drizzle/SQL)
        -> Schema -> Migrations applied + client generated
```

**What the verifier checks:**
1. Component renders data from state/props (not hardcoded)
2. Component calls API on user action
3. API route queries database with parameters
4. Database schema has correct types and relations, with migrations applied

### Verification Report Structure

`{phase_num}-verification.md` in the phase directory (layout from `templates/verification-report.md`) carries frontmatter `phase`, `verified`, `verified_commit` (the HEAD `pan-tools verify stale` compares against), `status` (`passed` | `gaps_found` | `human_needed`), `score` and `test_gate`, plus `not_checked`, `gaps`, `human_verification` and `unrequested` lists when they apply. The body includes:
- Observable truths, required artifacts and requirements coverage, each with a pass/fail status
- Anti-patterns found (stubs and placeholders)
- Key link verification (the wiring chain)
- Gaps summary with suggested fixes
- Unrequested work: changes no plan asked for, found with `pan-tools verify scope` (recorded, never blocking)
- Test gate: `test_gate` (`passed` | `failed` | `skipped`) in the frontmatter, copied from the record `pan-tools test run --phase N` writes rather than judged by the verifier
- Test strength: the `verify mutate` survivors on the phase's changed lines, when the test gate passed (reported, never changing the status). The section comes from the `verify-phase` workflow's `mutation_report` step, not from the template
- Overall score (N/M must-haves verified)

---

## Commit Strategy

*Source: `references/git-integration.md`*

PAN creates granular, per-task commits during execution -- not bulk commits per phase.

### Commit Points

| Event | Commit? | Type |
|-------|---------|------|
| Project initialization (project.md, roadmap.md) | Yes | planning-docs commit (`pan-tools commit`) |
| Plan creation (plan.md files, roadmap.md) | Yes | `docs({phase}): create phase plan`, by pan-planner |
| Phase research / discovery creation | Optional | the phase researcher may commit research.md (`docs({phase}): research phase domain`); nothing commits discovery.md |
| Task completion | Yes | `feat/fix/test(phase-plan)` |
| Plan completion (summary.md metadata) | Yes | `docs(phase-plan)` |
| Handoff created (`/pan:pause`) | Yes | planning-docs commit (WIP state preserved) |
| Phase completion (verification, roadmap, state) | Yes | `docs(phase-X): complete phase execution` |

### Commit Message Format

```text
{type}({phase}-{plan}): {description}
```

**Types:** task commits use `feat`, `fix`, `test`, `refactor`, `perf`, `chore` (`references/git-integration.md`); planning-doc commits go through `pan-tools commit`, whose `--type` accepts only `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`

**Examples:**
```text
feat(04-01): Add user authentication middleware
test(04-01): Add auth middleware test suite
fix(04-02): Handle expired JWT tokens in refresh flow
docs(04-02): complete refresh-token plan
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

| Tier | Resolves to |
|------|-------------|
| `reasoning` | `inherit` on every provider: the model the session was launched with |
| `mid` | the provider's mid-size model (Anthropic and the default: the `sonnet` alias) |
| `fast` | the provider's smallest, fastest model (Anthropic and the default: the `haiku` alias) |

The OpenAI and Google model ids live in `PROVIDER_MODELS` in `core.cjs`; read them there rather than from a copy here.

Legacy names (`opus` → `reasoning`, `sonnet` → `mid`, `haiku` → `fast`) are supported for backward compatibility. On an OpenCode install the mid and fast tiers resolve to provider-qualified `provider/model` ids (`OPENCODE_MODELS` in `core.cjs`), the only form OpenCode accepts.

### Profile Comparison

| Agent Role | Quality | Balanced | Budget |
|-----------|---------|----------|--------|
| Planner | reasoning | reasoning | mid |
| Researcher | reasoning | reasoning | fast |
| Executor | reasoning | reasoning | mid |
| Verifier | reasoning | reasoning | fast |
| Plan Checker | reasoning | reasoning | fast |
| Codebase Mapper (`pan-document_code`) | reasoning | reasoning | fast |

### Routing Pipeline

Model resolution follows a priority chain:

```text
1. Per-agent override    → config.model_overrides[agentType]
2. Per-phase override    → <!-- model_tier: X --> in roadmap phase
3. Profile lookup        → MODEL_PROFILES[agentType][profile]
4. Complexity routing    → adjusts that tier ±1 from task metadata (if strategy = "complexity")
5. Capability hints      → adjustTierForCapabilities(): context_estimate / needs_thinking / cache_warm
6. Failure escalation    → escalateTier(): a retry (attempt > 1) climbs toward the agent's quality tier, capped by routing.max_escalations (pins from 1–2 are never escalated)
7. Provider resolution   → resolveTierToModel(tier, provider)
```

**Provider detection:** Explicit `routing.provider` in config → `PAN_PROVIDER` env var → on an OpenCode install, the provider prefix of OpenCode's configured `model` (`opencode.json` or `.opencode/opencode.json`) → runtime directory presence (`.claude/` = Anthropic, `.codex/` and `.opencode/` = OpenAI, `.gemini/` = Google, `.github/` = default) → default.

### Routing Strategies

- **static** (default): Profile assigns the tiers; no complexity scoring. Capability hints and failure escalation (steps 5–6 above) still apply when the caller passes them.
- **complexity**: Scores task metadata (fileCount, waveCount, requirementCount, isArchitectural) and adjusts tier ±1 level. Configurable thresholds: `downgrade_max` (default 2), `upgrade_min` (default 6).

### Cost Multipliers

Relative cost per tier: reasoning = 15×, mid = 3×, fast = 1×. The `estimate-cost` command shows total and average multipliers per profile.

### When to Use Each

- **Quality:** Complex architectural work, critical production code, unfamiliar domains
- **Balanced (default):** Most projects -- both quality and balanced run every agent at the reasoning tier
- **Budget:** Prototyping, familiar patterns, cost-sensitive work

### Design Rationale

Both the quality and balanced profiles run every agent at the reasoning tier — planning, execution, research, and verification all benefit from top-tier reasoning by default. Cost savings come only from the opt-in `budget` profile, which steps agents down to mid/fast tiers for prototyping, familiar patterns, and cost-sensitive work.

### Per-Agent Overrides

Override specific agents in config:
```json
{
  "model_overrides": {
    "pan-executor": "reasoning",
    "pan-phase-researcher": "mid"
  }
}
```

Values are tiers (`reasoning`, `mid`, `fast`; the legacy names are accepted). Overrides take precedence over profile defaults, per-phase overrides, and routing strategy, and are never escalated on retry.

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
| `{slug}` | Phase name as slug (in the milestone template, the milestone name) | `setup-auth` |
| `{milestone}` | Milestone version | `v0.2.0` |

### Merge at Completion

PAN does not merge these branches itself: exec-phase leaves merging to you, and `/pan:milestone-done` tags the release without merging. Your options when a phase or milestone completes:
- **Squash:** Clean single commit on target branch
- **Merge:** Preserve full commit history
- **Delete without merging:** `git branch -D` — the branch work is discarded
- **Keep branches:** leave them for manual handling

### Config Example

```json
{
  "branching_strategy": "phase",
  "phase_branch_template": "pan/phase-{phase}-{slug}",
  "milestone_branch_template": "pan/{milestone}-{slug}"
}
```

These are top-level keys of `config.json`, the form `config-ensure-section` writes. A nested `git` form is read only when the top-level key is absent, so it is ignored in any config `config-ensure-section` created.

---

## UI Conventions

*Source: `references/ui-brand.md`*

PAN uses consistent visual patterns for all output.

### Stage Banners

Major workflow stages use a `PAN ►` banner between two rules (stage name in caps, e.g. `PLANNING PHASE 3`, `PHASE 3 COMPLETE ✓`):
```text
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► {STAGE NAME}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Status Symbols

| Symbol | Meaning |
|--------|---------|
| `✓` | Complete / Passed / Verified |
| `✗` | Failed / Missing / Blocked |
| `◆` | In progress |
| `○` | Pending |
| `⚡` | Auto-approved |
| `⚠` | Warning |
| `🎉` | Milestone complete (banner only) |

### Checkpoint Boxes

```text
╔══════════════════════════════════════════════════════════════╗
║  CHECKPOINT: Verification Required                           ║
╚══════════════════════════════════════════════════════════════╝

Check that the login page renders correctly at http://localhost:3000/login

──────────────────────────────────────────────────────────────
→ Type "approved" or describe issues
──────────────────────────────────────────────────────────────
```

62-character width. The action prompt varies by type: `→ Type "approved" or describe issues` (Verification Required), `→ Select: option-a / option-b` (Decision Required), `→ Type "done" when complete` (Action Required).

### Anti-Patterns

- Don't vary box widths within the same workflow
- Don't use random symbols -- stick to the defined symbol set
- Don't mix banner styles
- Don't drop the `PAN ►` prefix from stage banners
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
- **Interrogation:** Don't fire questions without building on the answers
- **Shallow acceptance:** Don't take vague answers without probing
- **Premature constraints:** Don't ask about the tech stack before understanding the idea
- **User skills:** Never ask about the user's technical experience

---

## Continuation Format

*Source: `references/continuation-format.md`*

After completing a workflow step, PAN always presents a "Next Up" block telling you what to do next.

### Structure

```text
---

## ▶ Next Up

**Phase 02: Authentication** — Set up user login, registration, and session management.

`/pan:plan-phase 2`

<sub>`/clear` first → fresh context window</sub>

---

**Also available:**
- `/pan:progress` — Review overall status
- `/pan:verify-phase 1` — Re-verify Phase 1

---
```

### Key Rules

- Always show the recommended next action first
- Include the phase name and description (pulled from roadmap.md)
- Commands in backtick format for easy copy-paste
- "Also available" for alternatives (not "Other options")
- Visual separator (`---`) to make it stand out

---

## Reference File Index

PAN's agents and workflows load knowledge from reference files at runtime, by path and mostly with `@`-syntax. These files live in `pan-wizard-core/references/`.

| File | Topic | Relevance |
|------|-------|-----------|
| `checkpoints.md` | Checkpoint types, automation philosophy, auth gates | High |
| `guardrails.md` | Behavioral guardrails — anti-patterns, Code Preservation, Stop-the-Line | High |
| `tdd.md` | Test-driven development cycle, when to apply | High |
| `verification-patterns.md` | Stub detection, wiring checks, verification scripts | High |
| `handoff-decisions.md` | Decisions-trace schema for planner/executor/verifier handoff | High |
| `verdict-contract.md` | The `pan-verdict` block that ends every plan-checker, reviewer and design-checker report | High |
| `design-methodology.md` | Design-phase methodology (architecture, ADR, threat-lite), shared by pan-designer and focus-design | Medium |
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

Agents reference these files by path in their markdown definitions, some with `@`-syntax and some as a plain path they are told to read. For example, the executor agent references `references/checkpoints.md` in its checkpoint protocol and `references/handoff-decisions.md` when writing its implementation decisions.

---

*For writing new reference files, see [How to Write a Reference](DEVELOPMENT.md#how-to-write-a-reference) in the Development Guide.*
