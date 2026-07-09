# Custom Skills Assessment — featureAI Analysis

**Generated:** 2026-03-01
**Scope:** 15 custom files in `.claude/` (1 agent, 12 commands, 2 workflows)
**Method:** Multi-discipline featureAI review — Product, Architecture, Test, Security, Code Quality

---

## Inventory

| # | File | Type | LOC | Purpose |
|---|------|------|-----|---------|
| 1 | `agents/panmonty.md` | Agent | 309 | Structured 10-phase development orchestrator |
| 2 | `commands/build.md` | Command | 22 | Build hooks and verify output |
| 3 | `commands/check.md` | Command | 48 | Project health check (package, deps, tests, build, structure) |
| 4 | `commands/commit.md` | Command | 95 | Git commit with safety checks |
| 5 | `commands/enhance_skill.md` | Command | 137 | Meta-skill: 5-discipline expert review of featureAI itself |
| 6 | `commands/execplan.md` | Command | 346 | Automated plan execution pipeline with capacity budgeting |
| 7 | `commands/featureAI.md` | Command | 731 | Strategic feature investigation, design, and specification |
| 8 | `commands/panmonty.md` | Command | 27 | Launcher for the panmonty agent workflow |
| 9 | `commands/quick.md` | Command | 25 | Quick test run with file filtering |
| 10 | `commands/review.md` | Command | 23 | Code review via git diff |
| 11 | `commands/session-end.md` | Command | 62 | Session wrap-up: commit, memory bank update, summary |
| 12 | `commands/session-start.md` | Command | 60 | Session init: load memory, check status, orient |
| 13 | `commands/superplan.md` | Command | 304 | Strategic work plan generator with priority/reality scoring |
| 14 | `commands/sync.md` | Command | 57 | Documentation synchronization |
| 15 | `commands/test.md` | Command | 67 | Test suite runner with filtering |
| 16 | `workflows/panmonty_protocol.md` | Workflow | 458 | Full 10-phase implementation protocol |
| 17 | `workflows/panmontytest_protocol.md` | Workflow | 164 | 9-phase test engineering protocol |

**Total:** ~2,935 LOC of custom orchestration logic

---

## Per-Skill Deep Dive

### 1. PanMonty Agent + Protocol + Launcher (3 files)

**Files:** `agents/panmonty.md`, `commands/panmonty.md`, `workflows/panmonty_protocol.md`

**What it does:**
- 10-phase structured development workflow: Batch Plan -> Init -> Understand -> Plan -> Implement -> Test Create -> Quick Test -> Full Test -> Fix -> Document -> Simplify -> Ship
- Adaptive tier system: MICRO (XS/S skip everything), STANDARD (skip some phases), FULL (all phases)
- Change category detection: DOCS_ONLY, TESTS_ONLY, LIB_CHANGE, HOOK_CHANGE, FULL_FEATURE
- Status tracking via `panmonty_status.md` with checkpointing and resume
- Rollback snapshots via git tags
- Memory bank integration (sessionHistory, error_patterns, context)
- Parallel processing for independent MICRO items

**Overlap with shipped PAN:**

| PanMonty Capability | PAN Equivalent | Gap |
|---------------------|----------------|-----|
| Phase lifecycle | `/pan:execute-phase` | PAN has wave-based parallelism; PanMonty has tier-based shortcuts |
| Status tracking | state.md + pan-tools state | PanMonty uses its own `panmonty_status.md` |
| Batch planning | None | PAN has no capacity budgeting or batch sizing |
| Tier assignment | None | PAN treats all work as same tier |
| Rollback snapshots | None | PAN has no git tag snapshots |
| Error pattern capture | None | PAN has no error pattern learning |
| Resume from checkpoint | `/pan:resume-work` | Similar, PanMonty is more granular (step-level) |

**Integration Recommendation: HIGH VALUE**

PanMonty's **adaptive tier system** and **batch capacity budgeting** are the highest-value additions. PAN's current workflow treats every task as FULL, which is wasteful for XS/S items. Adding tier detection would make PAN significantly faster for mixed-size work.

**What to build:**
1. **Tier detection** in `init.cjs` — classify by change category (docs-only, tests-only, lib-change, full-feature)
2. **Batch capacity budgeting** — new `budget` command in `commands.cjs` with XS=1/S=2/M=4/L=10/XL=20 point system
3. **Rollback snapshots** — `git tag` before execution, referenced in state.md
4. **Error pattern capture** — append to `.planning/patterns/error-patterns.md`

**What NOT to build:** The `panmonty_status.md` tracker — PAN already has state.md and plan.md doing this job.

---

### 2. ExecPlan (1 file)

**File:** `commands/execplan.md`

**What it does:**
- 6-stage automated pipeline: Session Start -> Plan Loading -> Execution -> Verification -> Sync -> Session End
- Reads from superplan files (`.planning/superplan_*.md`)
- Capacity budget system with 4 execution modes: bugfix, balanced, features, full
- AI behavioral rules (read-before-write, root-cause-only, one-change-one-test, revert-fast)
- Progress tracking via `panmonty_status.md`
- Flags: `--budget`, `--mode`, `--priority`, `--dry-run`, `--no-commit`, `--continue`

**Overlap with shipped PAN:**

| ExecPlan Capability | PAN Equivalent | Gap |
|---------------------|----------------|-----|
| Execute plans | `/pan:execute-phase` | PAN executes plan.md files; ExecPlan executes superplan items |
| Capacity budgeting | None | PAN has no budget limiting |
| Execution modes | None | PAN has no mode switching (bugfix vs features) |
| Dry-run | None | PAN has no dry-run for execution |
| Session lifecycle | `/pan:resume-work` + `/pan:pause-work` | ExecPlan wraps both into a single pipeline |
| AI behavioral rules | Agent .md prompts | PAN embeds rules in agent prompts; ExecPlan is more explicit |
| Doc sync stage | None | PAN relies on manual /sync |

**Integration Recommendation: MEDIUM-HIGH VALUE**

The **execution modes** and **dry-run** capability are genuinely useful. The concept of a "superplan" (prioritized work plan separate from roadmap.md) fills a gap — PAN's roadmap.md is phase-level, not item-level within a phase.

**What to build:**
1. **Execution modes** as a config option: `workflow.execution_mode: bugfix|balanced|features|full`
2. **Dry-run flag** for `/pan:execute-phase` — show what would execute without doing it
3. **Auto-sync stage** — run doc sync after phase execution completes
4. **Budget limiting** — stop execution when context or time budget is exhausted

**What NOT to build:** The superplan file format — it's redundant with plan.md. Instead, integrate budget/mode into the existing plan.md wave system.

---

### 3. SuperPlan (1 file)

**File:** `commands/superplan.md`

**What it does:**
- Deep-dive strategic work plan generator
- 7-phase process: Orientation -> Priority Classification -> Strategic Context -> Item Collection -> Effort Estimation -> Plan Assembly -> Validation
- Priority framework: P0 (crash) through P6 (documentation)
- Reality Score formula: RS = (User Value + Time Criticality + Risk Reduction) / Job Size
- Scans codebase for TODO/FIXME, cross-references tests vs implementations
- Outputs `.planning/superplan_YYYY-MM-DD.md`
- Flags: `--focus`, `--quick`, `--refresh`, `--lean`

**Overlap with shipped PAN:**

| SuperPlan Capability | PAN Equivalent | Gap |
|----------------------|----------------|-----|
| Priority classification | None | PAN has no priority framework |
| Reality scoring | None | PAN has no cost-benefit analysis |
| TODO/FIXME scanning | `list-todos` command | PAN scans `.planning/todos/`, not codebase |
| Effort estimation | None | PAN has no sizing system |
| Work plan generation | roadmap.md + plan.md | PAN plans are per-phase, not cross-phase |
| Baseline snapshot | `progress health` | Similar concept, less detailed |

**Integration Recommendation: MEDIUM VALUE**

The **Reality Score** framework is intellectually interesting but adds significant complexity. The **priority framework** (P0-P6) and **TODO/FIXME scanning** are practical wins.

**What to build:**
1. **Codebase TODO scanning** — extend `list-todos` to also scan source files for TODO/FIXME/HACK
2. **Priority classification** — add optional `priority: P0-P6` to plan.md frontmatter
3. **Effort sizing** — add optional `effort: XS|S|M|L|XL` to plan.md frontmatter

**What NOT to build:** The Reality Score formula — it requires subjective scoring that AI agents can't reliably produce. Priority + effort is sufficient.

---

### 4. FeatureAI (1 file)

**File:** `commands/featureAI.md`

**What it does:**
- 11-phase strategic feature specification pipeline
- Phase 0: Problem framing + demand validation (evidence gathering, cannibalization check, cognitive load assessment)
- Phase 1: Internal reconnaissance (codebase search, convention checklist)
- Phase 2: Competitive intelligence (6-tool deep dive, competitive matrix)
- Phase 3: Strategic analysis (Blue Ocean framework, Wardley mapping, moat analysis)
- Phase 3.5: Architecture assessment (layer violations, contract-first design, state transitions, breaking changes, performance budget)
- Phase 4: Design synthesis (guide-level + reference-level explanation, feature ladder v0/v1/v2)
- Phases 5-9: ADR, error handling, security, implementation roadmap, test plan
- Phase 10: Output artifacts (spec file, ADR, summary)
- Flags: `--gate`, `--quick`, `--audit`, `--mvp`

**Overlap with shipped PAN:**

| FeatureAI Capability | PAN Equivalent | Gap |
|----------------------|----------------|-----|
| Feature specification | `/pan:discuss-phase` + `/pan:plan-phase` | PAN does phase-level; featureAI does feature-level |
| Competitive research | `pan-project-researcher` agent | Agent does domain research; featureAI does competitive analysis |
| ADR generation | None | PAN has no ADR workflow |
| Security threat model | None | PAN has no security assessment |
| Test plan generation | `/pan:add-tests` | PAN generates tests; featureAI designs test strategy |
| Feature ladder (v0/v1/v2) | None | PAN has no incremental delivery planning |

**Integration Recommendation: HIGH VALUE**

FeatureAI is the most sophisticated skill in the collection. Its **demand validation**, **competitive intelligence**, **architecture assessment**, and **feature ladder** concepts fill real gaps in PAN's workflow.

**What to build:**
1. **`/pan:design-feature` command** — A new command that runs the featureAI pipeline adapted to PAN's file structure
2. **ADR generation** — new `template fill adr` command that scaffolds ADR files
3. **Competitive research** — enhance `pan-project-researcher` to include competitive analysis
4. **Feature ladder** in plan.md frontmatter — `delivery: [v0, v1, v2]` with scope per version
5. **Architecture assessment checklist** — new `verify architecture` command checking layer violations

**What NOT to build:** The full 11-phase pipeline as-is — too heavyweight for most features. Adapt the best parts into PAN's existing phase workflow.

---

### 5. Enhance Skill (1 file)

**File:** `commands/enhance_skill.md`

**What it does:**
- Meta-skill that enhances featureAI.md itself using 5 expert perspectives
- Product Architect: demand validation, adoption friction, cognitive load
- System Architect: layer violations, contract-first design, state machines, composability
- Test Engineer: test pyramid enforcement, mutation testing readiness, boundary value analysis
- Security Engineer: threat model, path traversal, deserialization safety, privilege boundaries
- Senior Engineer: convention enforcement, cognitive complexity budget, error message style guide

**Overlap with shipped PAN:** None — this is a meta-skill for improving other skills.

**Integration Recommendation: LOW (Meta-tool)**

This is a valuable tool for PAN Wizard's own development but shouldn't ship as a user-facing feature. Its content has already been absorbed into `featureAI.md`.

**What to build:** Nothing for users. Keep as an internal development tool.

---

### 6. Session Start + Session End (2 files)

**Files:** `commands/session-start.md`, `commands/session-end.md`

**What they do:**
- **session-start:** Load memory bank files (context, progress, sessionHistory, error_patterns), check project status, test baseline, suggest next actions
- **session-end:** Handle uncommitted work (commit/stash/wip), run final tests, update memory bank, generate session summary

**Overlap with shipped PAN:**

| Session Capability | PAN Equivalent | Gap |
|--------------------|----------------|-----|
| Load context | `/pan:resume-work` | PAN loads state.md; session-start loads broader memory bank |
| Save context | `/pan:pause-work` | PAN saves to state.md; session-end writes to memory bank |
| Error patterns | None | PAN has no error pattern learning |
| Session history | None | PAN tracks decisions in state.md but not session history |

**Integration Recommendation: MEDIUM VALUE**

The **memory bank** concept (context.md, progress.md, sessionHistory.md, error_patterns.md) is a lightweight alternative to PAN's state.md for projects that don't use full PAN planning. The session lifecycle wrapping is useful.

**What to build:**
1. **Session history** — extend `state record-session` to also append to a session history log
2. **Error pattern capture** — new command `state add-pattern` that records error patterns with wrong/right/root-cause
3. **Session summary** in `/pan:pause-work` — auto-generate a summary of what was accomplished

**What NOT to build:** Separate memory bank files — integrate into existing state.md sections.

---

### 7. Commit (1 file)

**File:** `commands/commit.md`

**What it does:**
- 6-step git commit workflow with safety checks
- Step 1: Check for deleted files (prompt user) and sensitive files (.env, .pem, .key)
- Step 2: Review changes (git status, diff)
- Step 3: Run tests (skip for .md-only changes)
- Step 4: Stage specific files, commit with conventional commit types
- Step 5: Verify commit
- Step 6: Push (only if asked)

**Overlap with shipped PAN:**

| Commit Capability | PAN Equivalent | Gap |
|-------------------|----------------|-----|
| Git commit | `pan-tools commit` | PAN commits `.planning/` only; this commits anything |
| Safety checks | None | PAN has no deleted-file or sensitive-file checks |
| Test-before-commit | None | PAN doesn't run tests before committing |
| Conventional commits | None | PAN doesn't enforce commit message types |
| Smart skip | None | PAN doesn't skip tests for docs-only changes |

**Integration Recommendation: MEDIUM-HIGH VALUE**

The **safety checks** (deleted files, sensitive files) and **smart test skipping** are immediately useful. The commit command enriches PAN's existing `pan-tools commit`.

**What to build:**
1. **Safety checks** in `commands.cjs cmdCommit()` — check for deleted files and sensitive file patterns before committing
2. **Smart test detection** — if only `.md` files changed, skip test requirement
3. **Conventional commit type** — add `--type feat|fix|docs|test|refactor|chore` flag to `pan-tools commit`

---

### 8. Check (1 file)

**File:** `commands/check.md`

**What it does:**
- 7-step project health check: package validity, dependencies, tests, build, file structure, cross-references, report
- Verifies commands/agents/modules/hooks counts match expectations

**Overlap with shipped PAN:**

| Check Capability | PAN Equivalent | Gap |
|------------------|----------------|-----|
| Project health | `validate health` | PAN checks `.planning/` only; check validates the whole project |
| Test run | None in validate | PAN validate doesn't run tests |
| Build verification | None | PAN has no build check |
| Cross-reference | `validate consistency` | Similar concept, different scope |

**Integration Recommendation: MEDIUM VALUE**

This is essentially a superset of `validate health` that also checks the codebase (not just `.planning/`). Merging would give PAN a single comprehensive health command.

**What to build:**
1. **Extended health check** — add `validate health --full` that also checks test suite, build, and file structure integrity
2. **Cross-reference check** — verify pan-tools.cjs routes match documented commands

---

### 9. Build, Quick, Test, Review, Sync (5 files)

**Files:** `commands/build.md`, `commands/quick.md`, `commands/test.md`, `commands/review.md`, `commands/sync.md`

**What they do:**
- **build:** Run `npm run build:hooks`, verify output, run tests
- **quick:** Quick `npm test` with file filtering
- **test:** Full test suite with `--file` and `--verbose` flags
- **review:** Code review via git diff with PAN-specific checklist
- **sync:** Documentation synchronization across README, commands, agents

**Overlap with shipped PAN:**

| Command | PAN Equivalent | Assessment |
|---------|----------------|------------|
| build | None | PAN has no build command |
| quick | `/pan:quick` | PAN's quick is a full task workflow; this is just test running |
| test | None | PAN has no test runner command |
| review | None | PAN has no code review command |
| sync | None | PAN has no doc sync command |

**Integration Recommendation: LOW-MEDIUM VALUE**

These are **project-specific developer tools**, not generic workflow capabilities. They're valuable for PAN Wizard development but wouldn't generalize to user projects.

**What to build:** None of these as shipped commands. They're development helpers, not workflow automation.

**Exception:** The **sync** concept (cross-referencing docs against code) could become a generic `validate docs` command, but it would need significant generalization.

---

### 10. PanMontyTest Protocol (1 file)

**File:** `workflows/panmontytest_protocol.md`

**What it does:**
- 9-phase test engineering workflow: Init -> Analysis -> Planning -> Audit -> Fix -> Expansion -> Verification -> Documentation -> Cleanup -> Summary
- Gap analysis: compares implemented features vs existing tests
- Test validation audit: checks if existing tests actually catch bugs (mental mutation testing)
- Coverage expansion: fills identified gaps

**Overlap with shipped PAN:**

| PanMontyTest Capability | PAN Equivalent | Gap |
|-------------------------|----------------|-----|
| Test gap analysis | None | PAN has no test coverage analysis |
| Test audit | None | PAN has no test quality verification |
| Coverage expansion | `/pan:add-tests` | PAN generates tests but doesn't analyze gaps first |
| Verification loop | `pan-verifier` agent | Similar concept, different scope |

**Integration Recommendation: MEDIUM VALUE**

The **gap analysis** and **test audit** concepts would strengthen PAN's `/pan:add-tests` command. Currently PAN generates tests blindly; PanMontyTest analyzes what's missing first.

**What to build:**
1. **Test gap analysis** — extend `verify phase-completeness` to also check test coverage
2. **Test quality audit** — new `verify test-quality` command checking assertion density

---

## Strategic Summary

### Tier 1: Build Into PAN (High Value, Clear Integration Path)

| Capability | Source Skill | Integration Target | Effort |
|------------|-------------|-------------------|--------|
| Adaptive tier system (MICRO/STANDARD/FULL) | PanMonty | `init.cjs` + execute-phase workflow | L |
| Batch capacity budgeting | PanMonty + ExecPlan | New `budget` module or extend `commands.cjs` | M |
| Feature design pipeline | FeatureAI | New `/pan:design-feature` command | L |
| ADR generation | FeatureAI | `template fill adr` + new template | S |
| Commit safety checks | Commit | `commands.cjs cmdCommit()` | S |
| Conventional commit types | Commit | `commands.cjs cmdCommit()` | XS |

**Total Tier 1:** ~2 L + 1 M + 2 S + 1 XS = significant but achievable in 2-3 phases

### Tier 2: Build Into PAN (Medium Value, Some Design Needed)

| Capability | Source Skill | Integration Target | Effort |
|------------|-------------|-------------------|--------|
| Execution modes (bugfix/balanced/features) | ExecPlan | Config option + execute-phase workflow | M |
| Dry-run for execution | ExecPlan | `/pan:execute-phase --dry-run` | S |
| Codebase TODO scanning | SuperPlan | Extend `list-todos` | S |
| Priority + effort in plan.md | SuperPlan | Frontmatter schema extension | XS |
| Session history logging | Session Start/End | Extend `state record-session` | S |
| Error pattern capture | PanMonty + Session End | New `state add-pattern` command | S |
| Extended health check | Check | `validate health --full` | M |
| Test gap analysis | PanMontyTest | Extend `verify phase-completeness` | M |
| Rollback snapshots | PanMonty | Git tag in execute-phase | S |
| Architecture layer checker | FeatureAI | New `verify architecture` | M |

**Total Tier 2:** ~4 M + 5 S + 1 XS

### Tier 3: Don't Ship (Internal-Only or Low Generalization)

| Capability | Reason |
|------------|--------|
| Enhance Skill | Meta-tool for PAN development, not user-facing |
| Build command | Project-specific (npm run build:hooks) |
| Quick command | Just runs npm test — too trivial to ship |
| Test command | Project-specific test runner |
| Review command | Too simple, users have their own review tools |
| SuperPlan Reality Score formula | Requires subjective scoring AI can't reliably produce |
| PanMonty status tracker file | Redundant with state.md |
| Separate memory bank files | Integrate into state.md instead |

---

## Cognitive Load Assessment

| Metric | Current | After Tier 1 | After Tier 1+2 |
|--------|---------|-------------|----------------|
| Commands users must learn | 32 | 34 (+2) | 37 (+5) |
| New concepts introduced | 0 | 3 (tiers, budgets, ADR) | 6 (+modes, patterns, priority) |
| Complexity score | -- | +1 (adds complexity) | +1 (adds complexity) |

**Justification:** Each addition serves a distinct workflow need. Tiers simplify the common case (MICRO skips overhead). Budgets prevent context window exhaustion. ADRs document decisions that otherwise get lost.

---

## Implementation Recommendation

### Phase 1: Low-Hanging Fruit (S-M effort, immediate value)

1. **Commit safety checks** — add deleted-file and sensitive-file detection to `cmdCommit()`
2. **Conventional commit types** — add `--type` flag to `pan-tools commit`
3. **ADR template** — add `template fill adr` command
4. **Priority + effort frontmatter** — extend plan.md schema with optional `priority` and `effort` fields
5. **Codebase TODO scanning** — extend `list-todos` to also search source for TODO/FIXME

### Phase 2: Core Workflow Enhancements (M-L effort)

6. **Adaptive tier detection** — classify work into MICRO/STANDARD/FULL based on file change scope
7. **Batch capacity budgeting** — budget-aware execution that stops at capacity
8. **Execution dry-run** — `--dry-run` flag for execute-phase
9. **Rollback snapshots** — git tag before execution
10. **Error pattern capture** — `state add-pattern` command

### Phase 3: Advanced Features (L effort)

11. **`/pan:design-feature` command** — adapted featureAI pipeline for PAN projects
12. **Architecture layer checker** — `verify architecture` for layer violation detection
13. **Test gap analysis** — coverage analysis in verify commands
14. **Execution modes** — bugfix/balanced/features config option

---

## Cannibalization Risk

| New Capability | Existing Command at Risk | Mitigation |
|----------------|-------------------------|------------|
| Design-feature | `/pan:discuss-phase` + `/pan:plan-phase` | Design-feature is pre-phase; discuss/plan remain for phase-level work |
| Extended health | `validate health` | Add as `--full` flag, not a new command |
| TODO scanning | `list-todos` | Extend existing command, don't create new one |
| None others | -- | All additions are net-new or flag extensions |

**Verdict:** Zero cannibalization risk. All Tier 1-2 items are either extensions of existing commands or genuinely new capabilities.
