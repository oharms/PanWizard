# ADR-0006: PAN Focus Commands — Strategic Project Management

## Status
Proposed

## Context

PAN Wizard's shipped workflow operates at the **phase level**: plan a phase, execute a phase, verify a phase. This is effective for sequential development but leaves a gap when developers need to:

1. **Decide what to work on** — No shipped prioritization framework. Users must manually read roadmap.md and guess what's most important.
2. **Design features before building** — `/pan:discuss-phase` captures vision but doesn't do competitive research, produce ADRs, or create implementation task lists.
3. **Budget work sessions** — No capacity system. Users either over-commit (start too much) or under-commit (miss easy wins).
4. **Sync documentation** — After changes, docs drift. No automated detection of stale references.
5. **Execute mixed-size work efficiently** — All work goes through full plan.md → exec-phase pipeline, even for XS fixes.

These capabilities exist as custom `.claude/commands/` skills (superplan, execplan, featureAI, session-start/end, sync) developed during PAN Wizard's own build, but they don't ship to users. Meanwhile, competitors are filling this space:

- **Claude Code plan mode** (2026) saves plan files to projects with DAG task dependencies
- **Cline** separates plan/act modes with different model configs per mode

PAN's architecture already has the building blocks: `classifyPlanTier()`, `effortToPoints()`, `readErrorPatterns()`, `appendSessionSummary()`, `shouldSkipTests()`, `cmdRollbackSnapshot()`. The custom skills proved these concepts work across 16 sessions and 800+ tests. What's needed is integration into the shipped product.

## Decision

Ship 5 new commands under a "Focus" group that bring the COMPLETE proven custom skill pipelines into PAN as first-class shipped commands — no shortcuts, no streamlining:

| Command | Purpose | Derived From |
|---------|---------|-------------|
| `/pan:focus-scan` | Full 7-phase strategic work scan with P0-P6 prioritization, Reality Score formula, and validation | SuperPlan — ALL 7 phases (0-6) complete |
| `/pan:focus-design` | Strategic feature investigation with 4 modes: `--full` (all 10 phases), `--internal` (skip competitive research), `--outward` (strategy focus, skip hardening), `--spike` (fast 4-phase proof-of-concept) | FeatureAI — ALL 10 phases available, mode controls which run. Modifiers: `--gate`, `--audit`, `--mvp` |
| `/pan:focus-plan` | Create capacity-budgeted work batch with 4 execution modes | ExecPlan stage 2 — complete capacity budget system with all 4 modes (bugfix/balanced/features/full) |
| `/pan:focus-exec` | Full 6-stage execution pipeline with 9 mandatory behavioral rules and 3 execution tiers | ExecPlan — ALL 6 stages (1-6) complete, ALL 9 rules, ALL 3 tiers (MICRO/STANDARD/FULL) |
| `/pan:focus-sync` | Synchronize documentation after changes | Sync custom skill — complete |
| `/pan:focus-drift-walking` | Walk directories, detect doc-code drift, score severity, create/repair docs | Drift killer — 8-phase directory-walking pipeline with severity scoring |
| `/pan:focus-doc-audit` | Multi-dimensional document audit with 8-dimension scoring and auto-fix | Doc audit — claim extraction, fact verification, cross-consistency, structural linting |

**Implementation approach:**
- New `focus.cjs` core module (follows existing module pattern)
- Integrates with existing modules (phase.cjs, init.cjs, frontmatter.cjs, commands.cjs)
- Optional `priority:` (P0-P6) and `effort:` (XS-XL) fields in plan.md frontmatter
- Batch/scan files stored in `.planning/focus/`
- Two-phase delivery: v0 (scan+plan+sync), v1 (exec+design)
- Reality Score formula (RS = (UV + TC + RR) / JS) shipped in focus-scan
- All 4 execution modes (bugfix/balanced/features/full) shipped in focus-plan and focus-exec

**What we explicitly chose NOT to build:**
- Separate task/superplan file format (integrate into existing plan.md)
- PanMonty status tracker (redundant with state.md)
- Separate memory bank files (keep as dev-only)
- PAN-Wizard-specific references (generalize for any project)

## Consequences

### Positive
- Users get strategic project management without custom skill setup
- Proven capabilities (16 sessions, 800+ tests) ship as real product
- Focus commands compose with existing phase commands (not a parallel system)
- Cross-platform (all 5 runtimes) from day one
- Zero migration cost (all fields optional, all directories additive)

### Negative
- 5 more commands to learn (+15% command count, 32 → 37)
- New .planning/focus/ directory adds to project structure
- focus.cjs is a new module to maintain
- Codebase TODO scanning adds ~200ms to scan time

### Neutral
- Priority/effort fields in plan.md frontmatter are optional — existing projects work unchanged
- Focus commands can be completely ignored — the phase workflow remains the default path
- The custom skills (.claude/commands/superplan.md, etc.) continue to work for PAN Wizard's own development

## Options Considered

### 1. Do nothing — keep custom skills internal
**Pro:** Zero work, no added complexity.
**Con:** PAN's most powerful capabilities remain invisible to users. Competitors fill the gap.

### 2. Ship custom skills as-is (copy .md files to commands/pan/)
**Pro:** Quick — just copy files.
**Con:** Custom skills are PAN-Wizard-specific (reference test counts, module names). They're orchestration scripts, not integrated commands. No core module, no JSON output, no tests.

### 3. Extend existing commands (add --scan to progress, --budget to exec-phase)
**Pro:** No new commands to learn.
**Con:** Overloads existing commands with unrelated functionality. progress becomes a 200-line workflow. exec-phase becomes even more complex.

### 4. Ship 5 Focus commands (chosen)
**Pro:** Clean separation. Integrated with core. Testable. Cross-platform. Composable pipeline.
**Con:** 5 new commands. New module. But grouped under single "Focus" name.

### 5. Ship as a separate `pan-focus` tool
**Pro:** No impact on PAN's command count.
**Con:** Separate installation. Separate update cycle. Can't share modules. Users must learn two tools.

**Option 4 chosen** because it balances integration quality with minimal disruption. The Focus group name provides cognitive bundling (Miller's Law: one chunk, not five).

## Links
- Spec: `docs/specs/pan_focus_commands_featureai.md`
- Prior analysis: `docs/specs/custom-skills-assessment.md`
- Related ADRs: ADR-0003 (smart execution), ADR-0005 (command naming)
- Custom skills: `.claude/commands/superplan.md`, `execplan.md`, `featureAI.md`
- Competitor: [Taskmaster AI](https://github.com/eyaltoledano/claude-task-master)
