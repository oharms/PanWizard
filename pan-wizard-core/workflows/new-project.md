<purpose>
Initialize a new project through unified flow: questioning, research (opt-in: `--research`), requirements, roadmap. This is the most leveraged moment in any project — deep questioning here means better plans, better execution, better outcomes. One workflow takes you from idea to ready-for-planning.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.

@~/.claude/pan-wizard-core/references/guardrails.md
</required_reading>

<planning_write_policy>

**P-1808 — compose once, write once.** Every planning document this workflow produces (`project.md`, `requirements.md`, `roadmap.md`, `state.md`) is composed **in full, in memory, then written exactly once**. Field transcripts (PanLoop, 2026-08-08) counted `state.md` rewritten up to **12 times inside a single step**, `roadmap.md` and `project.md` 3× each, the same files re-read up to 6× — an agent failing to converge on a document it authored moments earlier. Every in-flight version of `state.md` is a chance for a later step to read a partial write, and the rewrite churn is why this workflow's duration varied 7× on similar briefs.

Rules, for this orchestrator and every subagent it spawns:

1. **Gather everything, then emit.** Do not write a skeleton and refine it in place. Not ready to write the final document = still in the gathering step.
2. **One Write per file per step.** Preparing a second Write to the same file in the same step means the first was premature — stop, finish composing, write once.
3. **Do not re-read a file you wrote this step.** You know what it says; re-reading your own output to "check" it is the non-convergence loop starting.
4. **Post-write corrections are targeted Edits for a verified defect** (wrong value, broken parse) — never a rewrite for restructuring you should have composed the first time.

"Write files first, then return" — the persistence rule — is unchanged: it orders writes **before the return**; it does not license early drafts.

</planning_write_policy>

## Phase 0 — Clarify (MANDATORY, do not skip)

Before scaffolding or coding anything, confirm with the user:

1. **What problem will this solve?** — Core purpose, not the implementation
2. **What does success look like?** — Concrete, measurable outcomes
3. **What's in scope vs out of scope?** — Boundary definition
4. **Constraints?** — Tech stack, dependencies, deadlines, runtime support requirements

**Do NOT proceed** until the user has answered. Do not assume, research, or fill in blanks yourself. The user's intent drives everything — skipping this step leads to wasted scaffolding and mis-aligned implementation.

Ask these after Step 1's checks (Step 1 runs before any user interaction) and carry the answers into project.md (Step 4); requirements.md is written in Step 7 from its template. Confirm with the user before scaffolding.

> **Auto mode exception:** If `--auto` is set with a provided idea document (see `<auto_mode>` below), the document IS the Phase 0 answer. Read it carefully and extract problem / success / scope / constraints from its contents.

<auto_mode>
## Auto Mode Detection

Check if `--auto` flag is present in $ARGUMENTS.

**If auto mode:**
- Skip brownfield mapping offer (assume greenfield)
- Skip deep questioning (extract context from provided document)
- Config: YOLO mode is implicit; depth, git and agents take their defaults (or idea.md frontmatter overrides) silently in Step 2a — no questions
- After config: run Steps 6-9 automatically with smart defaults:
  - Research: off, unless `--research` (or `--research market`) was passed or the idea frontmatter says `research_enabled: true`
  - Requirements: the features the provided document asks for; research findings settle decisions and never add v1 requirements
  - Requirements approval: Auto-approve
  - Roadmap approval: Auto-approve

**Document requirement:**
Auto mode requires an idea document — either:
- File reference: `/pan:new-project --auto @prd.md`
- Pasted/written text in the prompt

If no document content provided, error:

```
Error: --auto requires an idea document.

Usage:
  /pan:new-project --auto @your-idea.md
  /pan:new-project --auto [paste or write your idea here]

The document should describe what you want to build.
```
</auto_mode>

<process>

## 1. Setup

**MANDATORY FIRST STEP — Execute these checks before ANY user interaction:**

```bash
INIT=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs init new-project)
```

Parse JSON for: `researcher_model`, `roadmapper_model`, `commit_docs`, `project_exists`, `has_codebase_map`, `planning_exists`, `has_existing_code`, `has_package_file`, `is_brownfield`, `needs_codebase_map`, `has_git`, `project_path`.

**If `project_exists` is true:** Error — project already initialized. Use `/pan:progress`.

**If `has_git` is false:** Initialize git:
```bash
git init
```

## 2. Brownfield Offer

**If auto mode:** Skip to Step 2a (assume greenfield); Step 2a applies the config defaults and continues at Step 4, which synthesizes project.md from the provided document.

**If `needs_codebase_map` is true** (from init — existing code detected but no codebase map):

Use AskUserQuestion:
- header: "Codebase"
- question: "I detected existing code in this directory. Would you like to map the codebase first?"
- options:
  - "Map codebase first" — Run /pan:map-codebase to understand existing architecture (Recommended)
  - "Skip mapping" — Proceed with project initialization

**If "Map codebase first":**
```
Run `/pan:map-codebase` first, then return to `/pan:new-project`
```
Exit command.

**If "Skip mapping" OR `needs_codebase_map` is false:** Continue to Step 3.

## 2a. Auto Mode Config (auto mode only)

**If auto mode:** Apply defaults silently — do NOT call AskUserQuestion. The whole point of `--auto` is non-interactive execution; asking questions here blocks autonomous runs (P-1301 fix, v3.7.2).

**Auto-mode defaults (applied without asking):**

| Setting | Default | Override via |
|---------|---------|--------------|
| Depth | `quick` (3-5 phases, 1-3 plans each) | idea.md frontmatter `planning_depth: standard\|comprehensive` |
| Execution | `parallel` | idea.md frontmatter `parallelization: false` to switch to sequential |
| Git Tracking | `yes` (commit_planning_docs: true) | idea.md frontmatter `commit_planning_docs: false` |
| Research | `no` (opt-in: no project research, and no research before each phase) | `--research`, or idea.md frontmatter `research_enabled: true` |
| Plan Check | `yes` (verify plans before exec) | idea.md frontmatter `plan_checker_enabled: false` |
| Verifier | `yes` (verify work after each phase) | idea.md frontmatter `verifier_enabled: false` |
| AI Models | `balanced` profile | idea.md frontmatter `model_profile: quality\|budget` |

**To use a non-default value in auto mode, embed it in the idea.md frontmatter:**

```yaml
---
title: "..."
runtime_preference: claude
budget: 30
priority: medium
# Optional auto-mode overrides:
planning_depth: standard
parallelization: false
research_enabled: true
model_profile: quality
---
```

**Read the idea.md frontmatter once, apply the defaults, log them, proceed.** No AskUserQuestion in this block. If frontmatter is missing/silent on a setting, use the table default.

Create `.planning/config.json` with mode set to "yolo":

```json
{
  "mode": "yolo",
  "depth": "[selected]",
  "parallelization": true|false,
  "commit_docs": true|false,
  "model_profile": "quality|balanced|budget",
  "workflow": {
    "research": true|false,
    "plan_check": true|false,
    "verifier": true|false,
    "auto_advance": true
  }
}
```

**If commit_docs = No:** Add `.planning/` to `.gitignore`.

**Commit config.json:**

```bash
mkdir -p .planning
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "chore: add project config" --files .planning/config.json
```

**Persist auto-advance to config (survives context compaction):**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs config-set workflow.auto_advance true
```

Proceed to Step 4 (skip Steps 3 and 5).

## 3. Deep Questioning

**If auto mode:** Skip (already handled in Step 2a). Extract project context from provided document instead and proceed to Step 4.

**Display stage banner:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► QUESTIONING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Open the conversation:**

Ask inline (freeform, NOT AskUserQuestion):

"What do you want to build?"

Wait for their response. This gives you the context needed to ask intelligent follow-up questions.

**Follow the thread:**

Based on what they said, ask follow-up questions that dig into their response. Use AskUserQuestion with options that probe what they mentioned — interpretations, clarifications, concrete examples.

Keep following threads. Each answer opens new threads to explore. Ask about:
- What excited them
- What problem sparked this
- What they mean by vague terms
- What it would actually look like
- What's already decided

Consult `questioning.md` for techniques:
- Challenge vagueness
- Make abstract concrete
- Surface assumptions
- Find edges
- Reveal motivation

**Check context (background, not out loud):**

As you go, mentally check the context checklist from `questioning.md`, and scan the idea against its `<clarification_taxonomy>`. If gaps remain, weave questions naturally. Don't suddenly switch to checklist mode. Keep to its `<question_budget>`: at most five clarifying questions, ranked by impact × uncertainty, and every gap you did not ask about written into project.md as an `Assumed:` line.

**Decision gate:**

When you could write a clear project.md, use AskUserQuestion:

- header: "Ready?"
- question: "I think I understand what you're after. Ready to create project.md?"
- options:
  - "Create project.md" — Let's move forward
  - "Keep exploring" — I want to share more / ask me more

If "Keep exploring" — ask what they want to add, or identify gaps and probe naturally.

Loop until "Create project.md" selected.

## 4. Write project.md

**If auto mode:** Synthesize from provided document. No "Ready?" gate was shown — proceed directly to commit.

Synthesize all context into `.planning/project.md` using the template from `templates/project.md`.

**For greenfield projects:**

Initialize requirements as hypotheses:

```markdown
## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] [Requirement 1]
- [ ] [Requirement 2]
- [ ] [Requirement 3]

### Out of Scope

- [Exclusion 1] — [why]
- [Exclusion 2] — [why]
```

All Active requirements are hypotheses until shipped and validated.

**For brownfield projects (codebase map exists):**

Infer Validated requirements from existing code:

1. Read `.planning/codebase/architecture.md` and `stack.md`
2. Identify what the codebase already does
3. These become the initial Validated set

```markdown
## Requirements

### Validated

- ✓ [Existing capability 1] — existing
- ✓ [Existing capability 2] — existing
- ✓ [Existing capability 3] — existing

### Active

- [ ] [New requirement 1]
- [ ] [New requirement 2]

### Out of Scope

- [Exclusion 1] — [why]
```

**Key Decisions:**

Initialize with any decisions made during questioning:

```markdown
## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| [Choice from questioning] | [Why] | — Pending |
```

**Last updated footer:**

```markdown
---
*Last updated: [date] after initialization*
```

Do not compress. Capture everything gathered.

**Commit project.md:**

```bash
mkdir -p .planning
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: initialize project" --files .planning/project.md
```

## 5. Workflow Preferences

**If auto mode:** Skip — config was collected in Step 2a. Proceed to Step 5.5.

**Check for global defaults** at `~/.pan-wizard/defaults.json`. If the file exists, offer to use saved defaults:

```
AskUserQuestion([
  {
    question: "Use your saved default settings? (from ~/.pan-wizard/defaults.json)",
    header: "Defaults",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Use saved defaults, skip settings questions" },
      { label: "No", description: "Configure settings manually" }
    ]
  }
])
```

If "Yes": read `~/.pan-wizard/defaults.json`, use those values for config.json, and skip directly to **Commit config.json** below.

If "No" or `~/.pan-wizard/defaults.json` doesn't exist: proceed with the questions below.

**Round 1 — Core workflow settings (4 questions):**

```
questions: [
  {
    header: "Mode",
    question: "How do you want to work?",
    multiSelect: false,
    options: [
      { label: "YOLO (Recommended)", description: "Auto-approve, just execute" },
      { label: "Interactive", description: "Confirm at each step" }
    ]
  },
  {
    header: "Depth",
    question: "How thorough should planning be?",
    multiSelect: false,
    options: [
      { label: "Quick", description: "Ship fast (3-5 phases, 1-3 plans each)" },
      { label: "Standard", description: "Balanced scope and speed (5-8 phases, 3-5 plans each)" },
      { label: "Comprehensive", description: "Thorough coverage (8-12 phases, 5-10 plans each)" }
    ]
  },
  {
    header: "Execution",
    question: "Run plans in parallel?",
    multiSelect: false,
    options: [
      { label: "Parallel (Recommended)", description: "Independent plans run simultaneously" },
      { label: "Sequential", description: "One plan at a time" }
    ]
  },
  {
    header: "Git Tracking",
    question: "Commit planning docs to git?",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Planning docs tracked in version control" },
      { label: "No", description: "Keep .planning/ local-only (add to .gitignore)" }
    ]
  }
]
```

**Round 2 — Workflow agents:**

These spawn additional agents during planning/execution. They add tokens and time but improve quality.

| Agent | When it runs | What it does |
|-------|--------------|--------------|
| **Researcher** | Before planning each phase (off by default) | Answers up to 5 open questions that block planning, each with a source |
| **Plan Checker** | After plan is created | Verifies plan actually achieves the phase goal |
| **Verifier** | After phase execution | Confirms must-haves were delivered |

Plan Check and Verifier are recommended for important projects. Research is off by default: turn it on only when phases depend on things nobody on the project knows yet.

```
questions: [
  {
    header: "Research",
    question: "Research before planning each phase? (off by default; adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "No (Recommended)", description: "Plan directly from requirements; /pan:plan-phase N --research researches one phase" },
      { label: "Yes", description: "Answer up to 5 open questions per phase, each with a source" }
    ]
  },
  {
    header: "Plan Check",
    question: "Verify plans will achieve their goals? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Catch gaps before execution starts" },
      { label: "No", description: "Execute plans without verification" }
    ]
  },
  {
    header: "Verifier",
    question: "Verify work satisfies requirements after each phase? (adds tokens/time)",
    multiSelect: false,
    options: [
      { label: "Yes (Recommended)", description: "Confirm deliverables match phase goals" },
      { label: "No", description: "Trust execution, skip verification" }
    ]
  },
  {
    header: "AI Models",
    question: "Which AI models for planning agents?",
    multiSelect: false,
    options: [
      { label: "Balanced (Recommended)", description: "right-sized: a small, well-specified phase or quick task skips research and the planner/checker loop; plan-checker and researchers on the mid tier" },
      { label: "Quality", description: "the full ceremony on every piece of work, every agent on the reasoning tier: the behaviour before right-sizing, several times the cost and time" },
      { label: "Budget", description: "right-sized, plus mid tier for writing and fast tier for research/verification — fastest, lowest cost" }
    ]
  }
]
```

Create `.planning/config.json` with all settings:

```json
{
  "mode": "yolo|interactive",
  "depth": "quick|standard|comprehensive",
  "parallelization": true|false,
  "commit_docs": true|false,
  "model_profile": "quality|balanced|budget",
  "workflow": {
    "research": true|false,
    "plan_check": true|false,
    "verifier": true|false
  }
}
```

**If commit_docs = No:**
- Set `commit_docs: false` in config.json
- Add `.planning/` to `.gitignore` (create if needed)

**If commit_docs = Yes:**
- No additional gitignore entries needed

**Commit config.json:**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "chore: add project config" --files .planning/config.json
```

**Note:** Run `/pan:settings` anytime to update these preferences.

## 5.5. Resolve Model Profile

Use models from init: `researcher_model`, `roadmapper_model`.

## 6. Research Decision

Research is **off by default**. It runs only when asked: `--research` (or `--research market`, below) in `$ARGUMENTS`, idea-document frontmatter `research_enabled: true`, or the user choosing it at the question below. When it runs it answers at most five questions, with one researcher, and settles decisions; it never adds scope (2026-10-25: research that surveyed the domain never finished, and its catalogue grew v1).

**Size the brief (auto mode with an idea document):** pass the document to the engine:

```bash
BRIEF_SIZE=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs size task --file "{idea document path}" --raw)
```

`lean` means the document names what to build (its modules, functions or files) and how it behaves: it is the scope, and in steps 7 and 8 you keep to it (`BRIEF_PRECISE` below). A precise brief never needs research: skip it, even when asked, and say so (`the brief names what to build; research skipped — /pan:plan-phase N --research still researches a phase`). `full` means it leaves the work open: research runs only if it was asked for.

**If auto mode:** Do not ask. "Research open questions" when `--research` was passed or the frontmatter says `research_enabled: true` (and `BRIEF_SIZE` is not `lean`); otherwise "Skip research".

**If interactive mode and `--research` was passed:** "Research open questions" without asking. Otherwise use AskUserQuestion:
- header: "Research"
- question: "Research open questions before defining requirements?"
- options:
  - "Skip research (Recommended)" — Define requirements from what you told me
  - "Research open questions" — Answer up to 5 questions that block building, each with a source
  - "Questions + market" — Also compare up to 5 comparable products; gaps become v2 candidates

`MARKET` is true when `--research market` was passed or the user chose "Questions + market".

**If "Skip research":** Continue to Step 7.

**If researching:**

**6a. Write the questions.** List at most **5** open questions that project.md (and the idea document) leave unanswered and that block building: a technology choice, an external API's behaviour, a data format, a limit or rule. Not "what features do users expect", not "best practices for X": a question qualifies only if a requirement or the roadmap cannot be written without its answer. Write them as a numbered list:

```bash
mkdir -p .planning/research
```

Write `.planning/research/questions.md`:

```markdown
# Research questions

1. [question] — blocks: [the decision it settles]
2. ...
```

**No questions → no research.** If nothing blocks building, write no file, say `No open questions block building — research skipped`, and continue to Step 7.

**6b. Spawn one researcher.**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► RESEARCHING {N} QUESTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

```
Task(prompt="
<files_to_read>
- .planning/research/questions.md (The questions: answer these and nothing else)
- .planning/project.md (Project context)
</files_to_read>

<market>
{Only if MARKET: compare at most 5 comparable products in a `| Product | What users get | What the brief does not cover |` table; every gap goes under Ideas (v2 candidates).}
</market>

<output>
Write to: .planning/research/research-summary.md
One row per question: | # | Question | Answer | Source | Confidence | Decision it settles |, or `unknown — assume: …`. At most 4 searches or fetches per question. Anything that suggests new scope goes under ## Ideas (v2 candidates). Do not commit.
</output>
", subagent_type="pan-project-researcher", model="{researcher_model}", description="Answer research questions")
```

Leave out the `<market>` block when `MARKET` is false.

**6c. Check the answers.**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs research check .planning/research/questions.md .planning/research/research-summary.md [--market]
```

Exit 1: send its `errors` to the researcher once as a revision (`Task` with the same `subagent_type`, the errors and the file to fix). One revision at most: if the check still fails, proceed, and record each question still without a sourced answer as `unknown` with the assumption you will use, in a `## Unknowns` list at the end of research-summary.md. Research never blocks the project.

Commit `.planning/research/`:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: answer research questions" --files .planning/research/questions.md .planning/research/research-summary.md
```

Display:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► RESEARCH COMPLETE ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Decisions settled:** [one line per answered question]
**Unknown (assumed):** [question → assumption]
**Ideas (v2 candidates):** [count; offered in Step 7, never added to v1 by themselves]
```

## 7. Define Requirements

Display stage banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► DEFINING REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Load context:**

Read project.md and extract:
- Core value (the ONE thing that must work)
- Stated constraints (budget, timeline, tech limitations)
- Any explicit scope boundaries

**If research exists:** Read `.planning/research/research-summary.md`. Its answers settle decisions (a technology, an API's behaviour, a format, a limit) that the requirements and their acceptance criteria use; its `## Ideas (v2 candidates)` are not requirements. No finding moves into v1 by itself: in interactive mode offer the ideas as v2 candidates the user may promote; in auto mode they go under v2.

**If auto mode and `BRIEF_SIZE` is `lean` (`BRIEF_PRECISE`):** the document is the scope.
- One v1 requirement per behaviour the document states, written in its own terms and naming the module, function or file it names, so each requirement says exactly what to build
- Nothing the document does not ask for goes into v1: table stakes it does not mention, extra validation, hardening, tooling and infrastructure go under v2 or Out of Scope
- Skip the per-category questions, the "Any additions?" question and the approval gate; generate requirements.md and commit directly

**If auto mode otherwise:**
- Include the features the provided document asks for
- Defer everything else to v2, including research ideas and anything users of similar products might expect
- Skip per-category AskUserQuestion loops
- Skip "Any additions?" question
- Skip requirements approval gate
- Generate requirements.md and commit directly

**Gather requirements through conversation (interactive mode only):**

Ask: "What are the main things users need to be able to do?"

For each capability mentioned:
- Ask clarifying questions to make it specific
- Probe for related capabilities
- Group into categories

**Scope each category:**

For each category, use AskUserQuestion:

- header: "[Category]" (max 12 chars)
- question: "Which [category] features are in v1?"
- multiSelect: true
- options:
  - "[Feature 1]" — [brief description]
  - "[Feature 2]" — [brief description]
  - "[Feature 3]" — [brief description]
  - "None for v1" — Defer entire category

Track responses:
- Selected features → v1 requirements
- Unselected features → v2 or out of scope (ask which when unclear)
- Research ideas the user did not promote → v2

**Identify gaps:**

Use AskUserQuestion:
- header: "Additions"
- question: "Any requirements missing? (Features specific to your vision)"
- options:
  - "No, that covers it" — Proceed
  - "Yes, let me add some" — Capture additions

**Validate core value:**

Cross-check requirements against Core Value from project.md. If gaps detected, surface them.

**Generate requirements.md:**

Create `.planning/requirements.md` with:
- v1 Requirements grouped by category (checkboxes, REQ-IDs), each with at least one acceptance criterion in an EARS form as an indented sub-bullet (`WHEN … THE SYSTEM SHALL …`; see the template's `<ears_criteria>`)
- v2 Requirements (deferred)
- Out of Scope (explicit exclusions with reasoning)
- Traceability section (empty, filled by roadmap)

**REQ-ID format:** `[CATEGORY]-[NUMBER]` (AUTH-01, CONTENT-02)

**Requirement quality criteria:**

Good requirements are:
- **Specific and testable:** "User can reset password via email link" (not "Handle password reset")
- **User-centric:** "User can X" (not "System does Y")
- **Atomic:** One capability per requirement (not "User can login and manage profile")
- **Independent:** Minimal dependencies on other requirements

Reject vague requirements. Push for specificity:
- "Handle authentication" → "User can log in with email/password and stay logged in across sessions"
- "Support sharing" → "User can share post via link that opens in recipient's browser"

**Present full requirements list (interactive mode only):**

Show every requirement (not counts) for user confirmation:

```
## v1 Requirements

### Authentication
- [ ] **AUTH-01**: User can create account with email/password
- [ ] **AUTH-02**: User can log in and stay logged in across sessions
- [ ] **AUTH-03**: User can log out from any page

### Content
- [ ] **CONT-01**: User can create posts with text
- [ ] **CONT-02**: User can edit their own posts

[... full list ...]

---

Does this capture what you're building? (yes / adjust)
```

If "adjust": Return to scoping.

**Lint, then commit requirements.** A v1 requirement with no EARS criterion fails the lint; add one before committing:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs verify requirements
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: define v1 requirements" --files .planning/requirements.md
```

## 8. Create Roadmap

Display stage banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► CREATING ROADMAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

◆ Spawning roadmapper...
```

Spawn pan-roadmapper agent with path references:

```
Task(prompt="
<planning_context>

<files_to_read>
- .planning/project.md (Project context)
- .planning/requirements.md (v1 Requirements)
- .planning/research/research-summary.md (Answers to the research questions - if exists; older projects: .planning/research/summary.md)
- .planning/config.json (Depth and mode settings)
</files_to_read>

</planning_context>

<instructions>
Create roadmap:
0. Size it to the requirements: the fewest phases that deliver them (a brief for one library or tool is usually one to three phases), one plan per phase unless a phase truly needs more, and no phase for hardening, validation or infrastructure the requirements do not ask for. Over-scoping spends the run's budget on work nobody asked for (2026-10-25: a one-paragraph brief became a roadmap whose third phase built load-time validation the brief never mentioned, and the product's core API was never written)
1. Derive phases from requirements (don't impose structure)
2. Map every v1 requirement to exactly one phase
3. Derive 2-5 success criteria per phase (observable user behaviors)
4. Validate 100% coverage
5. Compose roadmap.md in full and write it exactly once, no draft-then-refine (P-1808); initialise state.md with `pan-tools state init --core-value ... --focus ... --phase ... --phase-name ... --total-phases ...`, never the Write tool; update requirements.md traceability
6. Return ROADMAP CREATED with summary

Write files first, then return — before the return, not early and often. One complete Write per file persists the artifacts without the rewrite churn (P-1808).
</instructions>
", subagent_type="pan-roadmapper", model="{roadmapper_model}", description="Create roadmap")
```

**Handle roadmapper return:**

**If `## ROADMAP BLOCKED`:**
- Present blocker information
- Work with user to resolve
- Re-spawn when resolved

**If `## ROADMAP CREATED`:**

Read the created roadmap.md and present it nicely inline:

```
---

## Proposed Roadmap

**[N] phases** | **[X] requirements mapped** | All v1 requirements covered ✓

| # | Phase | Goal | Requirements | Success Criteria |
|---|-------|------|--------------|------------------|
| 1 | [Name] | [Goal] | [REQ-IDs] | [count] |
| 2 | [Name] | [Goal] | [REQ-IDs] | [count] |
| 3 | [Name] | [Goal] | [REQ-IDs] | [count] |
...

### Phase Details

**Phase 1: [Name]**
Goal: [goal]
Requirements: [REQ-IDs]
Success criteria:
1. [criterion]
2. [criterion]
3. [criterion]

**Phase 2: [Name]**
Goal: [goal]
Requirements: [REQ-IDs]
Success criteria:
1. [criterion]
2. [criterion]

[... continue for all phases ...]

---
```

**If auto mode:** Skip approval gate — auto-approve and commit directly.

**CRITICAL: Ask for approval before committing (interactive mode only):**

Use AskUserQuestion:
- header: "Roadmap"
- question: "Does this roadmap structure work for you?"
- options:
  - "Approve" — Commit and continue
  - "Adjust phases" — Tell me what to change
  - "Review full file" — Show raw roadmap.md

**If "Approve":** Continue to commit.

**If "Adjust phases":**
- Get user's adjustment notes
- Re-spawn roadmapper with revision context:
  ```
  Task(prompt="
  <revision>
  User feedback on roadmap:
  [user's notes]

  <files_to_read>
  - .planning/roadmap.md (Current roadmap to revise)
  </files_to_read>

  Update the roadmap based on feedback: rewrite each changed file with one Write.
  Return ROADMAP REVISED with changes made.
  </revision>
  ", subagent_type="pan-roadmapper", model="{roadmapper_model}", description="Revise roadmap")
  ```
- Present revised roadmap
- Loop until user approves

**If "Review full file":** Display raw `cat .planning/roadmap.md`, then re-ask.

**Commit roadmap (after approval or auto mode):**

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: create roadmap ([N] phases)" --files .planning/roadmap.md .planning/state.md .planning/requirements.md
```

## 8.5. Standards Recommendation

**After roadmap is committed, offer standards selection based on project type.**

```bash
RECOMMEND=$(node ~/.claude/pan-wizard-core/bin/pan-tools.cjs standards recommend)
```

If the command succeeds (project.md exists and project types detected):

Parse JSON for `project_types` and `recommendations` arrays.

**If auto mode (P-1601 v3.7.5):** Auto-select ONLY `priority: "high"` recommendations. These are recommendations from explicitly-detected non-general project types (e.g., a recognized `web` or `ai` project). For `general` fallback projects with no explicit type signal, **skip auto-selection entirely** — leave `standards.md` absent rather than impose unrelated standards.

```bash
HIGH_IDS=$(printf '%s' "$RECOMMEND" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log((JSON.parse(s).recommendations||[]).filter(r=>r.priority==='high').map(r=>r.id).join('\n')))")
if [ -n "$HIGH_IDS" ]; then
  for id in $HIGH_IDS; do
    node ~/.claude/pan-wizard-core/bin/pan-tools.cjs standards select "$id"
  done
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: add recommended standards" --files .planning/standards.md
fi
```

Skipping auto-select when the project is `general` keeps `.planning/` minimal for trivial CLIs / scripts and avoids inflating agent context with irrelevant compliance checklists.

**If interactive mode:**

Present recommendations:

```
## Industry Standards

Based on your project type ([types]), these standards are recommended:

| Standard | Priority | Why |
|----------|----------|-----|
| [name] | [priority] | [reason] |
| [name] | [priority] | [reason] |
```

Use AskUserQuestion:
- header: "Standards"
- question: "Which standards would you like to apply? (advisory — guides agents, doesn't block)"
- multiSelect: true
- options: (from recommendations, max 4)
  - "[standard name]" — [reason]

For each selected standard:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs standards select [id]
```

If any selected, commit:
```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: add project standards" --files .planning/standards.md
```

Display:
```
Standards applied. Agents will reference these during planning and verification.
Run /pan:health --standards to check compliance anytime.
```

**If command fails** (no project.md or no recommendations): Skip silently — standards are optional.

## 8.8. Tell the host tools this project uses PAN

A global install writes nothing into a project, so this project's `AGENTS.md` (and, with a Claude install, the `CLAUDE.md` bridge) may not carry PAN's section yet. Write it, with the routing table the config's `instructions.routing` asks for; user content outside PAN's markers, and a section the project edited, are kept:

```bash
node ~/.claude/pan-wizard-core/bin/pan-tools.cjs memory rebuild --apply --only agents-md
```

Commit what it changed with the project files:

```bash
if [ "$(git status --porcelain AGENTS.md CLAUDE.md 2>/dev/null)" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: add PAN's section to the agent instructions" --files AGENTS.md CLAUDE.md
fi
```

## 8.9. Safety-Net Commit (P-EXP-001 fix)

**MANDATORY in auto mode, optional in interactive.** Defensive sweep — if any prior commit step was skipped (auto mode hit context budget early, interactive user dismissed a prompt, etc.), fold any uncommitted `.planning/` artifacts into a single bundle commit so the next workflow run starts from a clean tree.

```bash
if [ "$(git status --porcelain .planning/ 2>/dev/null)" ]; then
  node ~/.claude/pan-wizard-core/bin/pan-tools.cjs commit "docs: bundle remaining .planning artifacts (safety-net)" --files .planning/
fi
```

**Why:** the `whoocache` experiment (2026-05-02) finished new-project with all artifacts on disk (`project.md`, `requirements.md`, `roadmap.md`, src code) but ZERO commits — the autonomous loop reached natural completion before any per-stage `pan-tools commit` invocation. This safety-net catches that pattern.

## 9. Done

Present completion summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 PAN ► PROJECT INITIALIZED ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**[Project Name]**

| Artifact       | Location                    |
|----------------|-----------------------------|
| Project        | `.planning/project.md`      |
| Config         | `.planning/config.json`     |
| Research       | `.planning/research/`       |
| Requirements   | `.planning/requirements.md` |
| Roadmap        | `.planning/roadmap.md`      |
| Standards      | `.planning/standards.md`    |

**[N] phases** | **[X] requirements** | Ready to build ✓
```

**If auto mode:**

```
╔══════════════════════════════════════════╗
║  AUTO-ADVANCING → DISCUSS PHASE 1        ║
╚══════════════════════════════════════════╝
```

Spawn discuss-phase for Phase 1 as a Task subagent, exactly as transition.md Route A does for a phase with no context.md (discuss-phase.md as execution_context, `ARGUMENTS='1 --auto'`); do not call SlashCommand.

**If interactive mode:**

```
───────────────────────────────────────────────────────────────

## ▶ Next Up

**Phase 1: [Phase Name]** — [Goal from roadmap.md]

/pan:discuss-phase 1 — gather context and clarify approach

<sub>/clear first → fresh context window</sub>

---

**Also available:**
- /pan:plan-phase 1 — skip discussion, plan directly

───────────────────────────────────────────────────────────────
```

</process>

<output>

- `.planning/project.md`
- `.planning/config.json`
- `.planning/research/` (only if research was asked for and a question blocked building)
  - `questions.md`
  - `research-summary.md`
- `.planning/requirements.md`
- `.planning/roadmap.md`
- `.planning/state.md`
- `.planning/standards.md` (if standards selected)

</output>

<success_criteria>

- [ ] .planning/ directory created
- [ ] Git repo initialized
- [ ] Brownfield detection completed
- [ ] Deep questioning completed (threads followed, not rushed)
- [ ] project.md captures full context → **committed**
- [ ] config.json has workflow mode, depth, parallelization → **committed**
- [ ] Research only if asked for: at most 5 questions, one researcher, `research check` run → **committed**
- [ ] Requirements gathered (from the brief and conversation; research settles decisions, never adds v1 scope)
- [ ] User scoped each category (v1/v2/out of scope)
- [ ] requirements.md created with REQ-IDs → **committed**
- [ ] pan-roadmapper spawned with context
- [ ] Roadmap files written immediately (not draft)
- [ ] User feedback incorporated (if any)
- [ ] roadmap.md created with phases, requirement mappings, success criteria
- [ ] state.md initialized
- [ ] requirements.md traceability updated
- [ ] User knows next step is `/pan:discuss-phase 1`

**Atomic commits:** Each phase commits its artifacts immediately. If context is lost, artifacts persist.

</success_criteria>
